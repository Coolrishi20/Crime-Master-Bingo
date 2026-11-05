'use strict';
/* 2.6: new game visible at once, Talkover, Play on, cards handed out tonight, MP3 songs. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { makeEngine } = require('./helpers');
const { Store } = require('../../src/main/store');
const { readId3Tags } = require('../../src/main/mp4meta');
const { Library } = require('../../src/main/library');
const mediainfo = require('../../src/main/mediainfo');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'as-v28-'));

test('store: a game saved a moment ago is listed and readable before its delayed write lands; delete cancels the write', async () => {
  const st = new Store(path.join(tmp(), 'data'));
  st.write('games/GABC', { id: 'GABC', name: 'Quiz' });
  assert.deepStrictEqual(st.listGames().map(g => g.id), ['GABC'], 'listed straight away (was empty for ~150 ms)');
  assert.strictEqual(st.read('games/GABC', null).name, 'Quiz');
  st.write('games/GDEL', { id: 'GDEL' }); st.deleteGame('GDEL');
  await new Promise(r => setTimeout(r, 300));
  assert.ok(!fs.existsSync(st.file('games/GDEL')), 'a deleted game is never written back');
  assert.deepStrictEqual(st.listGames().map(g => g.id), ['GABC']);
});

test('Play on: +30 s and full song change only the song that is playing, and survive a TV reconnect', () => {
  const { eng, game, calls, finish, runTimers } = makeEngine({ settings: { clipMode: 40 } });
  eng.dispatch('startRound', { round: 1 });
  const pb = game.playback; const end0 = pb.clipEnd;
  assert.ok(end0 > 0);
  const r = eng.dispatch('playOn', { by: 30 });
  assert.strictEqual(r.end, end0 + 30); assert.strictEqual(pb.clipEnd, end0 + 30);
  const clipCmd = calls.player.filter(c => c.cmd === 'clip').pop(); assert.strictEqual(clipCmd.clipEnd, end0 + 30);
  assert.strictEqual(game.settings.clipMode, 40, 'the game\'s clip length is unchanged');
  eng.playerReady();
  assert.strictEqual(calls.player.filter(c => c.cmd === 'load').pop().clipEnd, end0 + 30, 'TV reconnect keeps the extension');
  eng.dispatch('playOn', { by: 'full' }); assert.strictEqual(pb.clipEnd, 200);
  assert.ok(eng.dispatch('playOn', { by: 30 }).already, 'already plays to the end');
  assert.ok(eng.hostState().playback.playedOn);
  finish(); runTimers();
  const next = calls.player.filter(c => c.cmd === 'load').pop();
  assert.strictEqual(next.clipEnd - next.clipStart, 40, 'the next song uses the normal clip length');
  assert.ok(!eng.hostState().playback.playedOn);
});

test('Talkover: ducks while held, lets go on release, after the time limit, or when the phone holding it drops', () => {
  const { eng, calls, timers } = makeEngine();
  eng.dispatch('startRound', { round: 1 });
  eng.dispatch('talkover', { on: true }, 'phone:Sam');
  let d = calls.player.filter(c => c.cmd === 'duck').pop();
  assert.deepStrictEqual([d.on, d.db], [true, -14]);
  assert.ok(eng.hostState().playback.talkover);
  eng.dispatch('talkover', { on: false }, 'phone:Sam');
  assert.strictEqual(calls.player.filter(c => c.cmd === 'duck').pop().on, false);
  // auto-release after 30 s
  eng.dispatch('talkover', { on: true }, 'desktop');
  const t = timers.filter(x => x && x.fn && x.ms === 30000).pop(); assert.ok(t, '30 s safety timer'); t.fn();
  assert.strictEqual(calls.player.filter(c => c.cmd === 'duck').pop().on, false); assert.ok(!eng.hostState().playback.talkover);
  // a dropped phone releases only its own hold
  eng.dispatch('talkover', { on: true }, 'phone:Sam');
  eng.releaseTalkover('phone:Other'); assert.ok(eng.hostState().playback.talkover);
  eng.releaseTalkover('phone:Sam'); assert.ok(!eng.hostState().playback.talkover);
  // level setting, and allowed during the quiz / after the game
  eng.dispatch('setAudio', { talkoverDb: -24 }); eng.dispatch('talkover', { on: true });
  assert.strictEqual(calls.player.filter(c => c.cmd === 'duck').pop().db, -24);
  eng.dispatch('setAudio', { talkoverDb: -99 }); assert.strictEqual(eng.settings.audio.talkoverDb, -30, 'clamped');
});

test('Cards handed out tonight: printed cards by default, the host\'s own list wins, a claim on another card is flagged', () => {
  const { eng, game } = makeEngine({ cards: 60 });
  eng.dispatch('startRound', { round: 1 });
  assert.strictEqual(eng.hostState().handedOut.source, null, 'nothing printed: no warning either way');
  assert.strictEqual(eng.dispatch('addClaim', { cardNo: 57 }).handedOut, null);
  eng.dispatch('closeSession', {});
  game.cards.filter(c => c.no <= 48).forEach(c => { c.printed = true; });
  const h = eng.hostState().handedOut; assert.deepStrictEqual([h.source, h.spec, h.count], ['printed', '001-048', 48]);
  const c57 = eng.dispatch('addClaim', { cardNo: 57 }); assert.strictEqual(c57.handedOut, false); assert.strictEqual(c57.handedOutSpec, '001-048');
  assert.strictEqual(eng.dispatch('addClaim', { cardNo: 12 }).handedOut, true);
  eng.dispatch('closeSession', {});
  const r = eng.dispatch('setHandedOut', { spec: '1-20, 55-60' });
  assert.deepStrictEqual([r.spec, r.count], ['001-020, 055-060', 26]);
  assert.strictEqual(eng.dispatch('addClaim', { cardNo: 57 }).handedOut, true);
  assert.throws(() => eng.dispatch('setHandedOut', { spec: 'abc' }), /card numbers/);
  eng.dispatch('setHandedOut', { spec: '' }); assert.strictEqual(eng.hostState().handedOut.source, 'printed', 'cleared: back to printed cards');
});

test('MP3: ID3v2.3 and ID3v1 tags give title and artist', () => {
  const dir = tmp();
  const frame = (id, text) => { const body = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]); const h = Buffer.alloc(10); h.write(id, 0, 'latin1'); h.writeUInt32BE(body.length, 4); return Buffer.concat([h, body]); };
  const frames = Buffer.concat([frame('TIT2', 'Café del Mar'), frame('TPE1', 'Energy 52'), frame('TYER', '1993')]);
  const size = frames.length; const hdr = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
  const f1 = path.join(dir, 'a.mp3'); fs.writeFileSync(f1, Buffer.concat([hdr, frames, Buffer.alloc(500)]));
  assert.deepStrictEqual(readId3Tags(f1), { title: 'Café del Mar', artist: 'Energy 52', year: 1993 });
  const v1 = Buffer.alloc(128); v1.write('TAG', 0, 'latin1'); v1.write('Wonderwall', 3, 'latin1'); v1.write('Oasis', 33, 'latin1');
  const f2 = path.join(dir, 'b.mp3'); fs.writeFileSync(f2, Buffer.concat([Buffer.alloc(1000), v1]));
  assert.deepStrictEqual(readId3Tags(f2), { title: 'Wonderwall', artist: 'Oasis' });
  assert.deepStrictEqual(readId3Tags(path.join(dir, 'missing.mp3')), {});
});

test('MP3: imported as an audio song, plays with a music card, passes the media check', async () => {
  const dir = tmp(); const lib = new Library(new Store(path.join(dir, 'data')));
  const f = path.join(dir, 'Oasis - Wonderwall.mp3'); fs.writeFileSync(f, Buffer.alloc(4000, 1));
  const w = path.join(dir, 'old.wma'); fs.writeFileSync(w, 'x');
  const r = await lib.importPaths([dir]);
  assert.strictEqual(r.added.length, 1); assert.strictEqual(r.audioUnsupported.length, 1, 'WMA reported, not imported');
  const s = lib.get(r.added[0]);
  assert.deepStrictEqual([s.kind, s.status, s.title, s.artist], ['audio', 'unchecked', 'Wonderwall', 'Oasis'], 'not sent for conversion');
  lib.probeResult(s.id, { duration: 258, width: 0, height: 0 });
  assert.deepStrictEqual([lib.get(s.id).status, lib.get(s.id).kind], ['ok', 'audio']);
  const v = { id: 'v', status: 'ok', kind: 'video' };
  assert.strictEqual(mediainfo.classify(Object.assign({}, s, { media: { readable: true, video: false, audio: true, acodec: 'mp3' } })).status, 'ready');
  assert.strictEqual(mediainfo.classify(Object.assign({}, v, { media: { readable: true, video: false, audio: false } })).status, 'unsupported');
  // engine: the TV is told it's an audio song (older games without `kind` go by the file name)
  const { eng, game, calls } = makeEngine();
  const first = game.order[0]; game.songs[first].path = '/media/x.MP3'; delete game.songs[first].kind;
  eng.dispatch('startRound', { round: 1 });
  const load = calls.player.filter(c => c.cmd === 'load').pop();
  assert.ok(load.audioOnly); assert.strictEqual(load.number, 1);
});

test('the phone may send Talkover, Play on and the handed-out list', () => {
  const { REMOTE_ACTIONS } = require('../../src/main/remote');
  ['talkover', 'playOn', 'setHandedOut'].forEach(a => assert.ok(REMOTE_ACTIONS.has(a), a));
});
