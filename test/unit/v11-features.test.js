'use strict';
/* v1.1 — explainable verification, round transitions, Up Next queue */
const test = require('node:test');
const assert = require('node:assert');
const rules = require('../../src/core/rules');
const { makeEngine, play } = require('./helpers');
const { GameEngine } = require('../../src/core/engine');
const cells = Array.from({ length: 25 }, (_, i) => 'x' + i);
const S = (...a) => new Set(a.flat().map(i => 'x' + i));
const row = r => [0, 1, 2, 3, 4].map(c => r * 5 + c);
const col = c => [0, 1, 2, 3, 4].map(r => r * 5 + c);
const crow = (card, r) => card.cells.slice(r * 5, r * 5 + 5);

/* ---------- Feature 1: explainable verification ---------- */
test('all five rows and all five columns win Round 1', () => {
  for (let i = 0; i < 5; i++) {
    assert.ok(rules.checkCard(cells, S(row(i)), 1).valid, 'row ' + i);
    assert.ok(rules.checkCard(cells, S(col(i)), 1).valid, 'col ' + i);
  }
});
test('every pair of parallel lines (adjacent or not) wins Round 2; mixed pairs never do', () => {
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
    assert.ok(rules.checkCard(cells, S(row(i), row(j)), 2).valid);
    assert.ok(rules.checkCard(cells, S(col(i), col(j)), 2).valid);
  }
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) assert.ok(!rules.checkCard(cells, S(row(i), col(j)), 2).valid);
});
test('best progress picks the closest qualifying pattern and the missing squares', () => {
  const b1 = rules.bestProgress(cells, S([10, 11, 12, 13]), 1);
  assert.strictEqual(b1.description, 'Row 3'); assert.strictEqual(b1.missing, 1); assert.deepStrictEqual(b1.missingCells, [14]);
  const b2 = rules.bestProgress(cells, S(row(0), [20, 21, 22]), 2);
  assert.strictEqual(b2.description, 'Rows 1 & 5'); assert.strictEqual(b2.missing, 2);
  const b3 = rules.bestProgress(cells, S([...Array(23).keys()]), 3);
  assert.strictEqual(b3.missing, 2);
});
test('explanations match the spec wording', () => {
  const r = rules.checkCard(cells, S(row(1)), 2);
  assert.match(rules.explainClaim('142', 2, r, rules.bestProgress(cells, S(row(1)), 2)), /^Not a Bingo! Card #142 has completed one line but requires two parallel lines for Round 2\./);
  const d = rules.checkCard(cells, S([0, 6, 12, 18, 24]), 1);
  assert.match(rules.explainClaim('007', 1, d, rules.bestProgress(cells, S([0, 6, 12, 18, 24]), 1)), /diagonals don't count/);
  const near = rules.checkCard(cells, S([...Array(24).keys()]), 3);
  assert.match(rules.explainClaim('9', 3, near, null), /24 of 25 songs — 1 more song needed/);
});
test('claim view: completing song, best pattern, needed squares, explanation', () => {
  const { eng, game } = makeEngine({ cards: 5 });
  eng.dispatch('startRound', { round: 1 }); eng.playerStarted(eng.loadToken);
  const card = game.cards[0]; const line = crow(card, 3);
  play(eng, line.slice(0, 4));
  let r = eng.dispatch('addClaim', { cardNo: card.no });
  assert.ok(!r.valid); assert.strictEqual(r.best.missing, 1);
  assert.strictEqual(r.grid.filter(c => c.needed).length, 1);
  assert.match(r.explanation, /^Not a Bingo! Card #\d{3} has no complete row or column yet\.$/);
  eng.dispatch('dismissClaim', { claimId: r.claimId }); eng.dispatch('closeSession', {});
  play(eng, [line[4]]);
  r = eng.dispatch('addClaim', { cardNo: card.no });
  assert.ok(r.valid);
  assert.strictEqual(r.completingSong.songId, line[4], 'shows the song that completed the line');
  assert.strictEqual(r.grid.find(c => c.completing).songId, line[4]);
  assert.match(r.explanation, /Valid for Round 1/);
});
test('scanning the same winning card repeatedly never creates a second winner', () => {
  const { eng, game } = makeEngine({ cards: 5 });
  eng.dispatch('startRound', { round: 1 }); eng.playerStarted(eng.loadToken);
  const card = game.cards[0]; play(eng, crow(card, 0));
  const a = eng.dispatch('addClaim', { qr: `CMB1|${game.id}|${card.no}` });
  const b = eng.dispatch('addClaim', { qr: `CMB1|${game.id}|${card.no}` });
  assert.strictEqual(a.claimId, b.claimId);
  eng.dispatch('confirmClaim', { claimId: a.claimId });
  eng.dispatch('confirmClaim', { claimId: a.claimId });
  assert.strictEqual(eng.winners().length, 1);
});

/* ---------- Feature 2: round transitions ---------- */
test('confirmed winner → host can complete the round; next round waits for the host', () => {
  const { eng, game, calls } = makeEngine({ cards: 10 });
  eng.dispatch('startRound', { round: 1 }); eng.playerStarted(eng.loadToken);
  const card = game.cards[0]; play(eng, crow(card, 0));
  const r = eng.dispatch('addClaim', { cardNo: card.no });
  eng.dispatch('confirmClaim', { claimId: r.claimId });
  assert.strictEqual(eng.hostState().round.winners, 1);
  assert.ok(eng.hostState().round.canComplete);
  // pending claim blocks completion
  const other = game.cards.find(c => c.no !== card.no && rules.checkCard(c.cells, eng.playedSet(), 1).valid);
  if (other) {
    const p = eng.dispatch('addClaim', { cardNo: other.no });
    assert.ok(eng.dispatch('completeRound', { fromRound: 1 }).needsDecision);
    eng.dispatch('dismissClaim', { claimId: p.claimId });
  }
  const before = game.played.length;
  const res = eng.dispatch('completeRound', { fromRound: 1 });
  assert.ok(res.ok && res.nextRound === 2);
  assert.deepStrictEqual(game.round, { number: 2, status: 'ready' });
  assert.strictEqual(game.playback.status, 'paused', 'music waits for the host');
  assert.strictEqual(game.played.length, before, 'marks preserved');
  assert.ok(!eng.activeSession(), 'resolved session closed');
  assert.strictEqual(game.rounds[1].winners.length, 1);
  const tv = calls.events.filter(e => e.n === 'tvScreen').pop().p;
  assert.strictEqual(tv.type, 'round'); assert.strictEqual(tv.from, 1); assert.strictEqual(tv.toLabel, 'TWO PARALLEL LINES');
  assert.strictEqual(eng.audienceState().round.status, 'ready');
  // double tap / phone + laptop: second completion is a no-op
  assert.ok(eng.dispatch('completeRound', { fromRound: 1 }).already);
  assert.strictEqual(game.round.number, 2);
  eng.dispatch('startRound', { round: 2 });
  assert.strictEqual(game.round.status, 'active');
  assert.strictEqual(game.playback.status, 'playing');
});
test('rounds cannot be skipped; Round 3 completion finishes the event (no Round 4)', () => {
  const { eng, game } = makeEngine();
  assert.throws(() => eng.dispatch('startRound', { round: 3 }), /in order/);
  eng.dispatch('startRound', { round: 1 });
  assert.throws(() => eng.dispatch('startRound', { round: 3 }), /in order/);
  eng.dispatch('completeRound', { fromRound: 1 });
  assert.throws(() => eng.dispatch('startRound', { round: 3 }), /in order/);
  eng.dispatch('startRound', { round: 2 });
  eng.dispatch('completeRound', { fromRound: 2 });
  eng.dispatch('startRound', { round: 3 });
  const r = eng.dispatch('completeRound', { fromRound: 3 });
  assert.ok(r.final);
  assert.strictEqual(game.status, 'finished');
  assert.throws(() => eng.dispatch('startRound', { round: 4 }), /1, 2 or 3|ended/);
});
test('cards that already satisfy the next round are reported to the host, never auto-awarded', () => {
  const { eng, game } = makeEngine({ cards: 5 });
  eng.dispatch('startRound', { round: 1 });
  const card = game.cards[0]; play(eng, crow(card, 0)); play(eng, crow(card, 2));
  const r = eng.dispatch('completeRound', { fromRound: 1 });
  assert.ok(r.preQualified.includes(String(card.no).padStart(3, '0')));
  assert.strictEqual(eng.winners().length, 0);
  assert.deepStrictEqual(eng.hostState().round.preQualified, r.preQualified);
});
test('crash during/after a transition restores the ready round without duplicates', () => {
  const { eng, game } = makeEngine({ cards: 5 });
  eng.dispatch('startRound', { round: 1 }); eng.playerStarted(eng.loadToken);
  const card = game.cards[0]; play(eng, crow(card, 1));
  const r = eng.dispatch('addClaim', { cardNo: card.no }); eng.dispatch('confirmClaim', { claimId: r.claimId });
  eng.dispatch('completeRound', { fromRound: 1 });
  const saved = JSON.parse(JSON.stringify(game));
  const e2 = new GameEngine(saved, {});
  assert.deepStrictEqual(saved.round, { number: 2, status: 'ready' });
  assert.ok(e2.dispatch('completeRound', { fromRound: 1 }).already, 'replayed command is ignored');
  assert.strictEqual(e2.winners().length, 1);
  assert.strictEqual(saved.transitions.length, 1);
});

/* ---------- Feature 3: Up Next queue ---------- */
test('Up Next shows metadata; previewing never plays or counts a song', () => {
  const { eng, game, calls } = makeEngine();
  const u = eng.hostState().upNext.next;
  assert.strictEqual(u.songId, game.order[0]); assert.strictEqual(u.source, 'playlist');
  assert.ok(u.fileName && u.clipLength === 40 && u.ready);
  assert.strictEqual(calls.player.length, 0);
  assert.strictEqual(game.played.length, 0);
  assert.ok(!JSON.stringify(eng.audienceState()).includes(u.title), 'audience never sees Up Next');
});
test('queue a specific song, skip the proposed next, then return to the playlist order', () => {
  const { eng, game, finish, runTimers } = makeEngine({ settings: { autoAdvanceGap: 0 } });
  eng.dispatch('startRound', { round: 1 });
  const pick = game.order[30];
  eng.dispatch('queueSong', { songId: pick });
  assert.strictEqual(eng.hostState().upNext.next.songId, pick);
  assert.strictEqual(eng.hostState().upNext.next.source, 'queue');
  finish(); runTimers();
  assert.strictEqual(eng.currentSongId(), pick, 'queued song plays next');
  assert.strictEqual(game.queue.length, 0);
  const proposed = eng.hostState().upNext.next.songId;
  eng.dispatch('skipNext', { expectSongId: proposed });
  assert.notStrictEqual(eng.hostState().upNext.next.songId, proposed);
  assert.ok(!eng.isPlayed(proposed), 'skipped song not counted');
  assert.ok(eng.eligibleSongs().some(s => s.songId === proposed), 'skipped song stays eligible');
  assert.throws(() => eng.dispatch('skipNext', { expectSongId: proposed }), /already changed/);
  eng.dispatch('resetQueue');
  assert.strictEqual(eng.hostState().upNext.next.songId, proposed, 'back to the saved order');
});
test('queue refuses played or current songs; never plays a song twice', () => {
  const { eng, game, finish, runTimers } = makeEngine({ settings: { autoAdvanceGap: 0 } });
  eng.dispatch('startRound', { round: 1 });
  assert.throws(() => eng.dispatch('queueSong', { songId: eng.currentSongId() }), /playing now/);
  const first = eng.currentSongId(); finish(); runTimers();
  assert.throws(() => eng.dispatch('queueSong', { songId: first }), /already been played/);
  const seen = new Set([first]);
  for (let i = 0; i < 60 && eng.currentSongId(); i++) { const c = eng.currentSongId(); if (game.playback.status === 'finished') break; if (eng.isPlayed(c)) break; seen.add(c); finish(); runTimers(); }
  assert.strictEqual(new Set(game.played.map(p => p.songId)).size, game.played.length);
});
test('deferred songs come back after the rest; excluded songs never play until included', () => {
  const { eng, game } = makeEngine({ songs: 41 });
  eng.dispatch('startRound', { round: 1, play: false });
  const a = game.order[0];
  eng.dispatch('skipNext', {});
  assert.strictEqual(eng.upNext(-1).songId, game.order[1]);
  const ex = game.order[1];
  eng.dispatch('excludeSong', { songId: ex });
  assert.strictEqual(eng.upNext(-1).songId, game.order[2]);
  // play everything else → deferred one comes back, excluded never
  game.order.slice(2).forEach(id => eng.addPlayed(id, false));
  assert.strictEqual(eng.upNext(-1).songId, a);
  eng.addPlayed(a, false);
  assert.strictEqual(eng.upNext(-1), null);
  eng.dispatch('includeSong', { songId: ex });
  assert.strictEqual(eng.upNext(-1).songId, ex);
});
test('queue and skipped songs survive a restart', () => {
  const { eng, game } = makeEngine();
  eng.dispatch('startRound', { round: 1 });
  eng.dispatch('queueSong', { songId: game.order[20] }); eng.dispatch('queueSong', { songId: game.order[21], position: 'end' });
  const saved = JSON.parse(JSON.stringify(game));
  const e2 = new GameEngine(saved, {});
  assert.deepStrictEqual(e2.hostState().upNext.queue.map(q => q.songId), [game.order[20], game.order[21]]);
  assert.strictEqual(e2.hostState().upNext.next.songId, game.order[20]);
});
test('missing next video is flagged, not hidden', () => {
  const { eng, game } = makeEngine();
  eng.setUnavailable({ [game.order[0]]: 'Video file missing' });
  const n = eng.hostState().upNext.next;
  assert.ok(!n.ready); assert.match(n.problem, /missing/);
});
