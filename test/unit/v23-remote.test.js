'use strict';
/* Phone remote hardening (2.1): sequence numbers, small state patches, a pairing pause when
 * many wrong PINs arrive from different addresses, and the quiz/break commands. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const WebSocket = require('ws');
const { RemoteServer, REMOTE_ACTIONS } = require('../../src/main/remote');

function client(port) {
  return new Promise((res) => { const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); const msgs = []; const waiters = [];
    ws.on('message', d => { const m = JSON.parse(d); msgs.push(m); waiters.splice(0).forEach(w => w()); });
    ws.on('open', () => res({ ws, msgs, send: o => ws.send(JSON.stringify(o)), wait: async (pred, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { const m = msgs.find(pred); if (m) return m; await new Promise(r => waiters.push(r) || setTimeout(r, 50)); } return null; } })); });
}

test('phone may switch between quiz and bingo', () => {
  assert.ok(REMOTE_ACTIONS.has('startBreak') && REMOTE_ACTIONS.has('returnToQuiz'));
  assert.ok(!REMOTE_ACTIONS.has('setNight'), 'TV behaviour settings stay on the laptop');
});

test('sequence numbers: a late command from the same phone page is refused, retries still de-duplicate', async () => {
  let devices = []; const calls = [];
  const srv = new RemoteServer({ port: 18797, staticDir: path.join(__dirname, '../../src/remote-web'), getState: () => ({ game: { gameId: 'G', n: calls.length } }), devices: { list: () => devices, save: l => { devices = l; } },
    dispatch: async (action) => { calls.push(action); return { ok: true }; } });
  await srv.start();
  try {
    const a = await client(18797);
    a.send({ type: 'pair', pin: srv.pin, deviceName: 'P' }); await a.wait(m => m.type === 'auth-ok');
    a.send({ type: 'cmd', id: 'a1', sid: 'S1', seq: 1, action: 'play' });
    a.send({ type: 'cmd', id: 'a3', sid: 'S1', seq: 3, action: 'pause' });
    await a.wait(m => m.id === 'a3' && m.type === 'ack');
    a.send({ type: 'cmd', id: 'a2', sid: 'S1', seq: 2, action: 'next' });
    const late = await a.wait(m => m.id === 'a2');
    assert.strictEqual(late.ok, false); assert.strictEqual(late.code, 'STALE');
    a.send({ type: 'cmd', id: 'a3', sid: 'S1', seq: 3, action: 'pause' }); // retry of the same command
    await new Promise(r => setTimeout(r, 150));
    assert.deepStrictEqual(calls, ['play', 'pause'], 'late command not run, retry not run twice');
    a.send({ type: 'cmd', id: 'b1', sid: 'S2', seq: 1, action: 'play' }); // a reloaded page starts again at 1
    assert.ok((await a.wait(m => m.id === 'b1')).ok);
    a.ws.close();
  } finally { await srv.stop(); }
});

test('state: full on connect, then only the changed parts; a new game sends the whole state again', async () => {
  let devices = []; let st = { game: { gameId: 'G1', name: 'Quiz', playback: { status: 'paused' }, history: [1, 2, 3], big: 'x'.repeat(5000) }, theme: 'dark' };
  const srv = new RemoteServer({ port: 18798, staticDir: path.join(__dirname, '../../src/remote-web'), getState: () => JSON.parse(JSON.stringify(st)), devices: { list: () => devices, save: l => { devices = l; } }, dispatch: async () => ({ ok: true }) });
  await srv.start();
  try {
    const a = await client(18798);
    a.send({ type: 'pair', pin: srv.pin, deviceName: 'P' });
    assert.ok(await a.wait(m => m.type === 'state'));
    st.game.playback = { status: 'playing' }; srv.broadcastState();
    const p = await a.wait(m => m.type === 'patch');
    assert.deepStrictEqual(Object.keys(p.set), ['playback'], 'only the changed part travels');
    assert.ok(JSON.stringify(p).length < 200, 'small message: ' + JSON.stringify(p).length + ' bytes');
    const before = a.msgs.length; srv.broadcastState(); await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(a.msgs.length, before, 'nothing changed → nothing sent');
    delete st.game.big; srv.broadcastState();
    const p2 = await a.wait(m => m.type === 'patch' && m.del && m.del.includes('big'));
    assert.ok(p2);
    st = { game: { gameId: 'G2', name: 'Other' }, theme: 'dark' }; srv.broadcastState();
    assert.ok(await a.wait(m => m.type === 'state' && m.state.game.gameId === 'G2'), 'another game → full state');
    st = { game: null, theme: 'dark' }; srv.broadcastState();
    assert.ok(await a.wait(m => m.type === 'state' && m.state.game === null), 'game closed → full state');
    a.ws.close();
  } finally { await srv.stop(); }
});

test('pairing pauses for everyone after 20 wrong PINs within a minute from different addresses', async () => {
  let devices = [];
  const srv = new RemoteServer({ port: 18799, staticDir: path.join(__dirname, '../../src/remote-web'), getState: () => ({ game: null }), devices: { list: () => devices, save: l => { devices = l; } }, dispatch: async () => ({ ok: true }) });
  await srv.start();
  try {
    const wrong = srv.pin === '000000' ? '111111' : '000000';
    for (let i = 0; i < 20; i++) { srv.handleMsg({ ip: '10.0.0.' + i, ws: { readyState: 3 } }, { type: 'pair', pin: wrong }); }
    const a = await client(18799);
    a.send({ type: 'pair', pin: srv.pin, deviceName: 'P' });
    const m = await a.wait(x => x.type === 'auth-fail');
    assert.ok(m && /Pairing is paused/.test(m.reason), 'even the right PIN waits while pairing is paused');
    srv.regeneratePin(); // a new PIN on the laptop lifts the pause
    a.send({ type: 'pair', pin: srv.pin, deviceName: 'P' });
    assert.ok(await a.wait(x => x.type === 'paired'), 'works again afterwards');
    a.ws.close();
  } finally { await srv.stop(); }
});
