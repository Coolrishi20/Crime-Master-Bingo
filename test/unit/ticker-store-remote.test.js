'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { TickerQueue } = require('../../src/renderer/shared/ticker');
const { Store } = require('../../src/main/store');
const { RemoteServer } = require('../../src/main/remote');
const WebSocket = require('ws');

test('crawler queue loops the FULL history in order and extends without reset', () => {
  const q = new TickerQueue();
  const items = n => Array.from({ length: n }, (_, i) => ({ n: i + 1, title: 'T' + (i + 1), artist: 'A' }));
  assert.strictEqual(q.setItems([]), 'same'); assert.strictEqual(q.next(), null);
  q.setItems(items(3));
  assert.deepStrictEqual([q.next(), q.next(), q.next(), q.next()].map(x => x.n), [1, 2, 3, 1]);
  assert.strictEqual(q.setItems(items(4)), 'extended');
  assert.deepStrictEqual([q.next(), q.next(), q.next(), q.next()].map(x => x.n), [2, 3, 4, 1]);
  const big = items(150); q.setItems(big);
  const seen = new Set(); for (let i = 0; i < 300; i++) seen.add(q.next().n);
  assert.strictEqual(seen.size, 150, 'all 150 songs stay in the loop');
  assert.strictEqual(q.setItems(items(2)), 'reset', 'corrections rebuild');
});

test('store: atomic writes with .bak recovery from a corrupted file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbstore-'));
  const s = new Store(dir);
  s.writeNow('games/G1', { a: 1 }); s.writeNow('games/G1', { a: 2 });
  fs.writeFileSync(path.join(dir, 'games', 'G1.json'), '{"a": 3, BROKEN');
  assert.deepStrictEqual(s.read('games/G1', null), { a: 1 }, 'falls back to the last good copy');
  s.write('x', { v: 1 }); s.write('x', { v: 2 }); s.flush();
  assert.deepStrictEqual(s.read('x'), { v: 2 });
});

function client(port) {
  return new Promise((res) => { const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); const msgs = []; const waiters = [];
    ws.on('message', d => { const m = JSON.parse(d); msgs.push(m); waiters.splice(0).forEach(w => w()); });
    ws.on('open', () => res({ ws, msgs, send: o => ws.send(JSON.stringify(o)), wait: async (pred, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { const m = msgs.find(pred); if (m) return m; await new Promise(r => waiters.push(r) || setTimeout(r, 50)); } return null; } })); });
}

test('remote: PIN pairing, token auth, revocation, duplicate-command protection and ordering', async () => {
  let devices = []; const calls = [];
  const srv = new RemoteServer({ port: 18787, staticDir: path.join(__dirname, '../../src/remote-web'), getState: () => ({ game: { n: calls.length } }), devices: { list: () => devices, save: l => { devices = l; } },
    dispatch: async (action, args) => { calls.push(action + ':' + (args.k || '')); if (action === 'pause') await new Promise(r => setTimeout(r, 120)); return { ok: true, n: calls.length }; } });
  await srv.start();
  try {
    const a = await client(18787);
    a.send({ type: 'pair', pin: '000000' === srv.pin ? '111111' : '000000' });
    assert.ok(await a.wait(m => m.type === 'auth-fail'));
    a.send({ type: 'cmd', id: 'x1', action: 'play' });
    assert.ok(await a.wait(m => m.type === 'auth-fail' && /Not paired/.test(m.reason)), 'unpaired commands refused');
    a.send({ type: 'pair', pin: srv.pin, deviceName: 'Test phone' });
    const paired = await a.wait(m => m.type === 'paired');
    assert.ok(paired && await a.wait(m => m.type === 'state'));
    // ordering: slow then fast must execute in order
    a.send({ type: 'cmd', id: 'c1', action: 'pause', args: { k: 1 } });
    a.send({ type: 'cmd', id: 'c2', action: 'play', args: { k: 2 } });
    await a.wait(m => m.type === 'ack' && m.id === 'c2');
    assert.deepStrictEqual(calls, ['pause:1', 'play:2']);
    // duplicate id (retry after reconnect) executes only once
    a.send({ type: 'cmd', id: 'c2', action: 'play', args: { k: 2 } });
    await new Promise(r => setTimeout(r, 200));
    assert.strictEqual(calls.length, 2);
    a.send({ type: 'cmd', id: 'c3', action: 'deleteEverything' });
    assert.match((await a.wait(m => m.id === 'c3')).error, /not allowed/);
    a.ws.close();
    // reconnect with the stored token
    const b = await client(18787);
    b.send({ type: 'auth', token: paired.token });
    assert.ok(await b.wait(m => m.type === 'auth-ok'));
    srv.revoke(devices[0].id);
    assert.ok(await b.wait(m => m.type === 'revoked'));
    const c = await client(18787);
    c.send({ type: 'auth', token: paired.token });
    assert.ok(await c.wait(m => m.type === 'auth-fail'), 'revoked token no longer works');
    c.ws.close();
    // rate limiting after 5 wrong PINs
    const d = await client(18787);
    for (let i = 0; i < 6; i++) d.send({ type: 'pair', pin: 'xxxxxx' });
    assert.ok(await d.wait(m => m.type === 'auth-fail' && /Too many/.test(m.reason)));
    d.ws.close();
  } finally { await srv.stop(); }
});
