'use strict';
/* Skip quiet intros (detection from the loudness profile + clip start priority) and
 * artist spacing when shuffling. */
const test = require('node:test');
const assert = require('node:assert');
const { introEnd } = require('../../src/main/loudness');
const { spreadShuffle, artistKey } = require('../../src/core/cards');
const { GameEngine, createGame } = require('../../src/core/engine');
const { makeEngine } = require('./helpers');

const prof = (introSecs, secs, quietDb, loudDb, extra) => ({ duration: secs, peak: [], sub: Array.from({ length: secs * 10 }, (_, i) => (extra && extra(i)) || (i < introSecs * 10 ? quietDb : loudDb)) });

test('intro detection: silence and dialogue skipped, real (quiet) music, clicks and long doubts left alone', () => {
  assert.strictEqual(introEnd(prof(8, 200, -90, -14)), 7, '8 s silent opening → start at 7 s (0.5–1 s before the music)');
  assert.strictEqual(introEnd(prof(15, 200, -35, -14)), 14, 'dialogue/ambience 21 LU below the song');
  assert.strictEqual(introEnd(prof(0, 200, -14, -14)), 0, 'no intro');
  assert.strictEqual(introEnd(prof(1, 200, -90, -14)), 0, 'under 2 s is not worth skipping');
  assert.strictEqual(introEnd(prof(10, 200, -24, -14)), 0, 'a soft musical intro (10 LU down) is part of the song');
  assert.strictEqual(introEnd(prof(60, 200, -90, -14)), 0, 'over 45 s: detection doubt, nothing skipped');
  assert.strictEqual(introEnd(prof(30, 60, -90, -14)), 0, 'over 40% of a short clip: nothing skipped');
  assert.strictEqual(introEnd(prof(10, 200, -90, -14, i => (i === 30 ? -8 : null))), 9, 'a click at 3 s is not the start');
  assert.strictEqual(introEnd(null), 0); assert.strictEqual(introEnd({ duration: 0, sub: [] }), 0);
  assert.strictEqual(introEnd(prof(0, 200, -90, -90)), 0, 'a silent file');
});

test('clip start priority: your start > game start offset > detected intro; switchable; full songs too', () => {
  const { eng, game } = makeEngine({ cards: 2, settings: { clipMode: 40 } });
  eng.hooks.introFor = (s) => (s.id === 's0' ? 7.5 : s.id === 's1' ? 199 : 0);
  const s0 = game.songs.s0, s1 = game.songs.s1;
  assert.deepStrictEqual([eng.clipFor(s0).start, eng.clipFor(s0).end, eng.clipFor(s0).intro], [7.5, 47.5, true]);
  assert.strictEqual(eng.clipFor(s1).start, 0, 'an "intro" that runs to the end of the song is ignored');
  eng.dispatch('setGameSettings', { defaultStart: 20 });
  assert.strictEqual(eng.clipFor(s0).start, 20, 'a game-wide start offset wins over detection');
  eng.dispatch('setGameSettings', { defaultStart: 0 });
  eng.dispatch('updateSong', { songId: 's0', clipStart: 3 });
  assert.strictEqual(eng.clipFor(game.songs.s0).start, 3, 'your own start point wins');
  eng.dispatch('updateSong', { songId: 's0', clipStart: null });
  eng.dispatch('setGameSettings', { skipIntros: false });
  assert.strictEqual(eng.clipFor(game.songs.s0).start, 0, 'switched off → from the beginning');
  eng.dispatch('setGameSettings', { skipIntros: true, clipMode: 'full' });
  assert.strictEqual(eng.clipFor(game.songs.s0).start, 7.5, 'full-song mode also skips the quiet intro');
  eng.hooks.introFor = () => { throw new Error('no profile'); };
  assert.strictEqual(eng.clipFor(game.songs.s0).start, 0, 'analysis problems never block playback');
});

test('Up Next shows that the quiet intro is skipped', () => {
  const { eng } = makeEngine({ cards: 2, settings: { clipMode: 40 } });
  eng.hooks.introFor = () => 6;
  const u = eng.upNextView();
  assert.ok(u.next && u.next.clipStart === 6 && u.next.introSkipped);
});

test('artist identity: case, accents, "The", featured artists', () => {
  assert.strictEqual(artistKey('The Beatles'), artistKey('beatles'));
  assert.strictEqual(artistKey('Calvin Harris feat. Rihanna'), artistKey('CALVIN HARRIS'));
  assert.strictEqual(artistKey('Beyoncé ft. Jay-Z'), artistKey('Beyonce'));
  assert.strictEqual(artistKey('Mark Ronson (feat. Bruno Mars)'), artistKey('Mark Ronson'));
  assert.notStrictEqual(artistKey('Simon & Garfunkel'), artistKey('Simon'));
});

const adj = (order, art) => order.reduce((n, id, i) => n + (i && art(order[i - 1]) === art(id) ? 1 : 0), 0);
test('spread shuffle: never back to back when possible, 3 apart when easy, nothing lost', () => {
  const ids = Array.from({ length: 50 }, (_, i) => 'x' + i); const art = (id) => 'artist' + (Number(id.slice(1)) % 10);
  let gap3 = 0;
  for (let r = 0; r < 200; r++) {
    const o = spreadShuffle(ids, art);
    assert.deepStrictEqual(o.slice().sort(), ids.slice().sort());
    assert.strictEqual(adj(o, art), 0, 'no same artist back to back');
    if (o.every((id, i) => i < 3 || ![o[i - 1], o[i - 2], o[i - 3]].some(p => art(p) === art(id)))) gap3++;
  }
  assert.ok(gap3 >= 150, `at least 3 songs apart in most shuffles (${gap3}/200)`);
  // different every time (still a real shuffle)
  assert.notDeepStrictEqual(spreadShuffle(ids, art), spreadShuffle(ids, art));
});

test('spread shuffle: one dominant artist → as few back-to-backs as is mathematically possible', () => {
  const ids = Array.from({ length: 40 }, (_, i) => 'y' + i); const art = (id) => (Number(id.slice(1)) < 26 ? 'big' : 'other' + id);
  for (let r = 0; r < 50; r++) { const o = spreadShuffle(ids, art); assert.strictEqual(adj(o, art), 26 - 14 - 1); }
});

test('games: new game and reshuffle keep artists apart; can be switched off', () => {
  const songs = Array.from({ length: 48 }, (_, i) => ({ id: 's' + i, title: 'Song ' + i, artist: ['Queen', 'ABBA', 'Oasis', 'Adele'][i % 4] + (i % 8 === 0 ? ' feat. Someone' : ''), path: '/m/' + i + '.mp4', duration: 200, fingerprint: 'f' + i, size: 1 }));
  const art = (g) => (id) => artistKey(g.songs[id].artist);
  for (let r = 0; r < 20; r++) { const g = createGame({ name: 'T', songs, playlistId: 'p', playlistName: 'P', settings: {} }); assert.strictEqual(adj(g.order, art(g)), 0); }
  const g = createGame({ name: 'T', songs, playlistId: 'p', playlistName: 'P', settings: {} });
  const eng = new GameEngine(g, { persist() {}, player() {}, event() {}, setTimeout: () => 0, clearTimeout() {} });
  for (let r = 0; r < 10; r++) { eng.dispatch('reshuffle', {}); assert.strictEqual(adj(g.order, art(g)), 0); }
  const plain = createGame({ name: 'T', songs, playlistId: 'p', playlistName: 'P', settings: { shuffle: false } });
  assert.deepStrictEqual(plain.order, songs.map(s => s.id), 'shuffle off keeps playlist order');
});
