'use strict';
/* Upgrade 7 — Printed card locking & technical credit */
const test = require('node:test');
const assert = require('node:assert');
const { makeEngine, play } = require('./helpers');
const locking = require('../../src/core/locking');
const { generateCards } = require('../../src/core/cards');
const { GameEngine } = require('../../src/core/engine');
const row = (card, r) => card.cells.slice(r * 5, r * 5 + 5);

test('new games are DRAFT; locking fixes labels, ids and marks issued cards', () => {
  const { game } = makeEngine({ cards: 10 });
  assert.strictEqual(game.cardsLocked, false);
  locking.lockGame(game, [1, 2, 3]);
  assert.ok(game.cardsLocked);
  assert.strictEqual(game.cards.filter(c => c.printed).length, 3);
  assert.ok(game.cards.every(c => c.locked));
  assert.deepStrictEqual(locking.verifyLock(game), []);
  game.songs.s1.title = 'Changed';
  assert.ok(locking.verifyLock(game).length >= 1);
  assert.strictEqual(locking.labelsFor(game).s1.title, 'Song 1', 'printing uses locked labels');
});

test('locked game refuses label changes but allows clip changes', () => {
  const { eng, game } = makeEngine();
  locking.lockGame(game, [1]);
  assert.throws(() => eng.dispatch('updateSong', { songId: 's1', title: 'New' }), /locked/);
  eng.dispatch('updateSong', { songId: 's1', clipStart: 12 });
  assert.strictEqual(game.songs.s1.clipStart, 12);
});

test('extra cards on a locked game reuse the same snapshot and leave issued cards untouched', () => {
  const { game } = makeEngine({ cards: 10 });
  locking.lockGame(game, game.cards.map(c => c.no));
  const before = JSON.stringify(game.cards);
  const more = generateCards(game.order, 5, game.cards);
  assert.deepStrictEqual(more.map(c => c.no), [11, 12, 13, 14, 15]);
  assert.strictEqual(JSON.stringify(game.cards), before);
  assert.ok(more.every(c => c.cells.every(id => game.songs[id])));
});

test('migration: older saved games with printed cards become locked; ledger gets kinds', () => {
  const { game } = makeEngine({ cards: 4 });
  delete game.schemaVersion; delete game.cardsLocked;
  game.cards[0].printed = true;
  game.played = [{ songId: 's1', at: 'x', round: 1 }];
  const e = new GameEngine(game, {});
  assert.ok(game.cardsLocked);
  assert.strictEqual(game.played[0].kind, 'played');
  assert.strictEqual(game.schemaVersion, 2);
  assert.ok(e);
});

test('technical credit requires explicit confirmation', () => {
  const { eng } = makeEngine();
  eng.dispatch('startRound', { round: 1 });
  assert.throws(() => eng.dispatch('grantCredit', { songId: 's5', reason: 'File missing' }), /explicitly confirmed/);
});

test('technical credit counts for bingo, is labelled, audited and kept separate from played', () => {
  const { eng, game } = makeEngine({ cards: 5 });
  eng.dispatch('startRound', { round: 1 });
  eng.playerStarted(eng.loadToken);
  const card = game.cards[0]; const line = row(card, 2);
  play(eng, line.slice(0, 4));
  eng.dispatch('grantCredit', { songId: line[4], reason: 'Video corrupted', confirm: true }, 'phone:iPhone');
  const h = eng.hostState();
  assert.strictEqual(h.totals.credited, 1);
  assert.strictEqual(h.totals.played, 4);
  const aud = eng.audienceState().history.pop();
  assert.ok(aud.credit, 'crawler marks it as technical credit');
  const audit = game.audit.find(a => a.action === 'technical-credit');
  assert.strictEqual(audit.songId, line[4]); assert.strictEqual(audit.reason, 'Video corrupted'); assert.ok(audit.hostConfirmed); assert.strictEqual(audit.gameId, game.id);
  const r = eng.dispatch('addClaim', { cardNo: card.no });
  assert.ok(r.valid);
  assert.ok(r.grid.some(c => c.credit));
});

test('credit for the current song moves on to the next video without a replacement', () => {
  const { eng, game } = makeEngine();
  eng.dispatch('startRound', { round: 1 }); eng.playerStarted(eng.loadToken);
  const cur = eng.currentSongId();
  const r = eng.dispatch('grantCredit', { songId: cur, reason: 'Playback failed during the event', confirm: true });
  assert.ok(r.advanced);
  assert.strictEqual(game.playback.index, 1);
  assert.strictEqual(game.played.filter(p => p.kind === 'played').length, 0);
});

test('technical credit during a frozen session does not change that session', () => {
  const { eng, game } = makeEngine({ cards: 5 });
  eng.dispatch('startRound', { round: 1 }); eng.playerStarted(eng.loadToken);
  const card = game.cards[0]; const line = row(card, 0);
  play(eng, line.slice(0, 4));
  eng.dispatch('freezeClaims');
  eng.dispatch('grantCredit', { songId: line[4], reason: 'File missing or moved', confirm: true });
  assert.ok(!eng.dispatch('addClaim', { cardNo: card.no }).valid);
});

test('reversing a credit that a confirmed win relied on needs explicit correction and is audited', () => {
  const { eng, game } = makeEngine({ cards: 5 });
  eng.dispatch('startRound', { round: 1 }); eng.playerStarted(eng.loadToken);
  const card = game.cards[0]; const line = row(card, 1);
  play(eng, line.slice(0, 4));
  const g = eng.dispatch('grantCredit', { songId: line[4], reason: 'Other', confirm: true });
  const r = eng.dispatch('addClaim', { cardNo: card.no });
  eng.dispatch('confirmClaim', { claimId: r.claimId });
  eng.dispatch('closeSession', {});
  const x = eng.dispatch('reverseCredit', { creditId: g.creditId });
  assert.ok(x.needsCorrection);
  assert.strictEqual(game.credits[0].status, 'active');
  eng.dispatch('reverseCredit', { creditId: g.creditId, acknowledge: true, reason: 'File found' });
  assert.strictEqual(game.credits[0].status, 'reversed');
  assert.ok(!eng.isPlayed(line[4]));
  const win = game.claims.find(c => c.id === r.claimId);
  assert.strictEqual(win.status, 'confirmed', 'confirmed result is not silently changed');
  assert.ok(win.review);
  assert.ok(game.audit.some(a => a.action === 'technical-credit-reversed'));
  assert.ok(game.audit.some(a => a.action === 'technical-credit'), 'history is never deleted');
});

test('credits survive restart', () => {
  const { eng, game } = makeEngine();
  eng.dispatch('startRound', { round: 1 });
  eng.dispatch('grantCredit', { songId: 's9', reason: 'Other', confirm: true });
  const saved = JSON.parse(JSON.stringify(game));
  const e2 = new GameEngine(saved, {});
  assert.ok(e2.isPlayed('s9'));
  assert.strictEqual(e2.hostState().credits[0].status, 'active');
});
