'use strict';
/* Upgrade 1 — Claim Freeze & multiple winners */
const test = require('node:test');
const assert = require('node:assert');
const { makeEngine, play } = require('./helpers');
const { GameEngine } = require('../../src/core/engine');
const row = (card, r) => card.cells.slice(r * 5, r * 5 + 5);

function setup() {
  const h = makeEngine({ cards: 30 });
  h.eng.dispatch('startRound', { round: 1 });
  h.eng.playerStarted(h.eng.loadToken);
  return h;
}

test('freeze pauses playback, snapshots the ledger and records position', () => {
  const { eng, game } = setup();
  eng.playerTime(eng.loadToken, 9.5);
  const c1 = game.cards[0]; play(eng, row(c1, 0));
  const r = eng.dispatch('freezeClaims', {}, 'laptop');
  assert.ok(r.ok && r.paused);
  assert.strictEqual(game.playback.status, 'paused');
  const s = game.claimSessions[0];
  assert.strictEqual(s.status, 'open');
  assert.strictEqual(s.snapshot.length, 5);
  assert.strictEqual(s.playback.position, 9.5);
  assert.strictEqual(s.round, 1);
});

test('freezing twice (desktop + phone) never creates conflicting sessions', () => {
  const { eng, game } = setup();
  const a = eng.dispatch('freezeClaims', {}, 'laptop');
  const b = eng.dispatch('freezeClaims', {}, 'phone');
  assert.strictEqual(a.sessionId, b.sessionId);
  assert.strictEqual(game.claimSessions.length, 1);
});

test('one valid claim', () => {
  const { eng, game } = setup();
  play(eng, row(game.cards[0], 2));
  const r = eng.dispatch('addClaim', { cardNo: game.cards[0].no });
  assert.ok(r.valid); assert.strictEqual(r.status, 'pending');
  const c = eng.dispatch('confirmClaim', { claimId: r.claimId });
  assert.strictEqual(c.status, 'confirmed');
});

test('multiple valid claims checked against the same frozen snapshot, all confirmable', () => {
  const { eng, game } = setup();
  const [a, b, c] = game.cards;
  play(eng, row(a, 0)); play(eng, row(b, 1)); play(eng, row(c, 4));
  eng.dispatch('freezeClaims');
  const ra = eng.dispatch('addClaim', { cardNo: a.no });
  // A song completes after freezing — it must not influence the session
  eng.addPlayed(game.order.find(id => !eng.isPlayed(id)), false);
  const rb = eng.dispatch('addClaim', { cardNo: b.no });
  const rc = eng.dispatch('addClaim', { cardNo: c.no });
  assert.ok(ra.valid && rb.valid && rc.valid);
  assert.strictEqual(ra.playedCount, rb.playedCount);
  eng.dispatch('confirmClaim', { claimId: ra.claimId });
  // first winner does not invalidate others
  assert.strictEqual(eng.dispatch('confirmClaim', { claimId: rb.claimId }).status, 'confirmed');
  assert.strictEqual(eng.dispatch('confirmClaim', { claimId: rc.claimId }).status, 'confirmed');
  assert.strictEqual(eng.winners().length, 3);
});

test('songs completing after the freeze cannot make an invalid claim valid', () => {
  const { eng, game } = setup();
  const card = game.cards[0];
  const line = row(card, 3);
  play(eng, line.slice(0, 4));
  eng.dispatch('freezeClaims');
  play(eng, [line[4]]); // completes the line AFTER the freeze
  const r = eng.dispatch('addClaim', { cardNo: card.no });
  assert.ok(!r.valid);
  assert.throws(() => eng.dispatch('confirmClaim', { claimId: r.claimId }), /does not meet|Claim/);
});

test('valid and invalid claims together; checking order does not matter', () => {
  const run = (order) => {
    const { eng, game } = setup();
    const [a, b] = game.cards;
    play(eng, row(a, 0));
    eng.dispatch('freezeClaims');
    const res = {};
    order.forEach(k => { const card = k === 'a' ? a : b; res[k] = eng.dispatch('addClaim', { cardNo: card.no }).valid; });
    return res;
  };
  const x = run(['a', 'b']), y = run(['b', 'a']);
  assert.deepStrictEqual(x, y);
  assert.strictEqual(x.a, true);
});

test('duplicate card entry in a session returns the same claim, no duplicate', () => {
  const { eng, game } = setup();
  const a = eng.dispatch('addClaim', { cardNo: game.cards[0].no });
  const b = eng.dispatch('addClaim', { cardNo: String(game.cards[0].no) });
  assert.strictEqual(a.claimId, b.claimId);
  assert.ok(b.duplicateEntry);
  assert.strictEqual(game.claims.length, 1);
});

test('remove an accidentally entered claim (kept in audit)', () => {
  const { eng, game } = setup();
  const a = eng.dispatch('addClaim', { cardNo: game.cards[5].no });
  eng.dispatch('removeClaim', { claimId: a.claimId });
  assert.strictEqual(eng.sessionView().claims.length, 0);
  assert.ok(game.audit.some(x => x.action === 'claim-removed'));
});

test('a card already confirmed this round is flagged on a later claim', () => {
  const { eng, game } = setup();
  const card = game.cards[0]; play(eng, row(card, 0));
  const r = eng.dispatch('addClaim', { cardNo: card.no });
  eng.dispatch('confirmClaim', { claimId: r.claimId });
  eng.dispatch('closeSession', {});
  const r2 = eng.dispatch('addClaim', { cardNo: card.no });
  assert.strictEqual(r2.status, 'duplicate');
  assert.throws(() => eng.dispatch('confirmClaim', { claimId: r2.claimId }), /already a confirmed winner/);
});

test('closing with undecided valid claims is refused unless explicitly dismissed', () => {
  const { eng, game } = setup();
  play(eng, row(game.cards[0], 0));
  eng.dispatch('addClaim', { cardNo: game.cards[0].no });
  const r = eng.dispatch('closeSession', { resume: true });
  assert.ok(r.needsDecision);
  assert.strictEqual(eng.activeSession().status, 'open');
  const r2 = eng.dispatch('closeSession', { resume: true, dismissPending: true });
  assert.ok(r2.ok);
  assert.strictEqual(game.claims[0].status, 'dismissed');
});

test('closing a session resumes playback mid-song at the same position', () => {
  const { eng, game, calls } = setup();
  eng.playerTime(eng.loadToken, 21.25);
  const idx = game.playback.index;
  eng.dispatch('freezeClaims');
  const loadsBefore = calls.player.filter(c => c.cmd === 'load').length;
  eng.dispatch('closeSession', { resume: true });
  assert.strictEqual(game.playback.status, 'playing');
  assert.strictEqual(game.playback.index, idx);
  assert.strictEqual(game.playback.position, 21.25);
  assert.strictEqual(calls.player.filter(c => c.cmd === 'load').length, loadsBefore, 'no reload / replay');
  assert.strictEqual(calls.player.pop().cmd, 'play');
  assert.strictEqual(game.played.length, 0, 'partial song not marked complete');
});

test('auto-advance never fires while a session is open', () => {
  const { eng, game, finish, runTimers } = setup();
  finish(); // goes to "between"
  eng.dispatch('freezeClaims');
  runTimers();
  assert.notStrictEqual(game.playback.status, 'loading');
});

test('session survives restart with snapshot, claims and results intact', () => {
  const { eng, game } = setup();
  play(eng, row(game.cards[0], 1));
  eng.dispatch('freezeClaims');
  const r = eng.dispatch('addClaim', { cardNo: game.cards[0].no });
  play(eng, row(game.cards[1], 1)); // after freeze
  const saved = JSON.parse(JSON.stringify(game));
  const e2 = new GameEngine(saved, {});
  const s = e2.activeSession();
  assert.ok(s);
  assert.strictEqual(s.snapshot.length, 5);
  assert.strictEqual(e2.sessionView().claims[0].status, 'pending');
  assert.ok(saved.playback.pausedForClaim);
  const r2 = e2.dispatch('addClaim', { cardNo: game.cards[1].no });
  assert.ok(!r2.valid, 'still uses the frozen snapshot');
  assert.strictEqual(e2.dispatch('confirmClaim', { claimId: r.claimId }).status, 'confirmed');
});

test('round cannot change while a session is open', () => {
  const { eng } = setup();
  eng.dispatch('freezeClaims');
  assert.throws(() => eng.dispatch('startRound', { round: 2 }), /claim session/);
});

test('unknown card and wrong-game QR rejected', () => {
  const { eng } = setup();
  assert.match(eng.dispatch('addClaim', { cardNo: 998 }).error, /does not exist/);
  assert.match(eng.dispatch('addClaim', { qr: 'CMB1|GOTHER1|5' }).error, /different game/);
  assert.match(eng.dispatch('addClaim', { qr: 'hello' }).error, /not a Crime Master/);
});

test('QR from this game is accepted', () => {
  const { eng, game } = setup();
  const r = eng.dispatch('addClaim', { qr: `CMB1|${game.id}|${game.cards[0].no}` });
  assert.ok(r.ok); assert.strictEqual(r.cardNo, game.cards[0].no);
});

test('Round 2 and Round 3 claims use the right rule', () => {
  const { eng, game } = setup();
  const c = game.cards[0];
  play(eng, row(c, 0)); play(eng, c.cells.filter((_, i) => i % 5 === 0)); // row 1 + column 1
  eng.dispatch('endRound'); eng.dispatch('startRound', { round: 2 });
  let r = eng.dispatch('addClaim', { cardNo: c.no });
  assert.ok(!r.valid); assert.match(r.reason, /parallel/);
  eng.dispatch('dismissClaim', { claimId: r.claimId }); eng.dispatch('closeSession', {});
  play(eng, row(c, 4));
  r = eng.dispatch('addClaim', { cardNo: c.no });
  assert.ok(r.valid);
  eng.dispatch('confirmClaim', { claimId: r.claimId }); eng.dispatch('closeSession', {});
  eng.dispatch('endRound'); eng.dispatch('startRound', { round: 3 });
  r = eng.dispatch('addClaim', { cardNo: c.no });
  assert.ok(!r.valid);
  eng.dispatch('dismissClaim', { claimId: r.claimId }); eng.dispatch('closeSession', {});
  play(eng, c.cells);
  r = eng.dispatch('addClaim', { cardNo: c.no });
  assert.ok(r.valid); assert.match(r.headline, /Full House/);
});

test('TV winner / wrong-claim screens: no card number by default, never any card songs', () => {
  const { eng, game, calls } = setup();
  play(eng, row(game.cards[0], 2));
  const r = eng.dispatch('addClaim', { cardNo: game.cards[0].no });
  eng.dispatch('confirmClaim', { claimId: r.claimId });
  const win = calls.events.filter(e => e.n === 'tvScreen').pop().p;
  assert.strictEqual(win.type, 'winner'); assert.strictEqual(win.cardLabel, undefined);
  assert.deepStrictEqual(Object.keys(win).sort(), ['label', 'pattern', 'round', 'seconds', 'type', 'winners']);
  assert.strictEqual(win.pattern.filter(Boolean).length, 5);
  const bad = eng.dispatch('addClaim', { cardNo: game.cards[9].no });
  if (!bad.valid) { eng.dispatch('dismissClaim', { claimId: bad.claimId }); assert.strictEqual(calls.events.filter(e => e.n === 'tvScreen').pop().p.type, 'wrong'); }
  eng.dispatch('setTvScreens', { showCardNumber: true });
  eng.dispatch('showTvScreen', { claimId: r.claimId, type: 'winner' });
  assert.strictEqual(calls.events.filter(e => e.n === 'tvScreen').pop().p.cardLabel, String(game.cards[0].no).padStart(3, '0'));
  assert.throws(() => eng.dispatch('showTvScreen', { claimId: bad.claimId, type: 'winner' }), /confirmed/);
});
