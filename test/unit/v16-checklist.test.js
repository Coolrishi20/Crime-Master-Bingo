'use strict';
/* Rules Checklist Mode: no rounds; every selected rule open from the start, won in any order;
 * a confirmed rule is ticked off; simultaneous winners on one frozen snapshot; host picks the
 * rule when a card qualifies for several; corrections; persistence; Round-Based Mode untouched. */
const test = require('node:test');
const assert = require('node:assert');
const { GameEngine } = require('../../src/core/engine');
const { makeEngine, play } = require('./helpers');

const LIST = [
  { id: 'k_f5', rule: { id: 'fast5', mode: 'any' } },
  { id: 'k_ln', rule: { id: 'line' } },
  { id: 'k_dg', rule: { id: 'diagonal' } },
  { id: 'k_l', rule: { id: 'lShape' } },
  { id: 'k_fh', rule: { id: 'full' } }
];
const DIAG = [0, 6, 12, 18, 24];
const ROW0 = [0, 1, 2, 3, 4];
function setup(opts) {
  const t = makeEngine(Object.assign({ cards: 8 }, opts));
  t.eng.dispatch('setGameMode', { mode: 'checklist', checklist: LIST });
  t.events = []; const orig = t.eng.hooks.event; t.eng.hooks.event = (n, p) => { t.events.push([n, p]); if (orig) orig(n, p); };
  return t;
}
const cellsOf = (card, idx) => idx.map(i => card.cells[i]);
const item = (eng, id) => eng.hostState().checklist.items.find(i => i.id === id);

test('Round-Based Mode stays the default and is unchanged', () => {
  const { eng, game } = makeEngine({ cards: 4 });
  assert.strictEqual(game.settings.mode, 'rounds');
  assert.strictEqual(eng.hostState().mode, 'rounds');
  assert.strictEqual(eng.hostState().checklist, null);
  eng.dispatch('startRound', { round: 1 });
  play(eng, cellsOf(game.cards[0], ROW0));
  const v = eng.dispatch('addClaim', { cardNo: game.cards[0].no });
  assert.ok(v.valid); assert.strictEqual(v.mode, 'rounds'); assert.strictEqual(v.checklist, null);
});

test('checklist setup: no rounds, a single Start, config locked once started', () => {
  const { eng, game, events } = setup();
  const hs = eng.hostState();
  assert.strictEqual(hs.mode, 'checklist');
  assert.strictEqual(hs.checklist.total, 5); assert.strictEqual(hs.checklist.completed, 0);
  assert.deepStrictEqual(hs.checklist.items.map(i => i.label), ['FAST 5', 'ONE LINE', 'DIAGONAL', 'L SHAPE', 'FULL HOUSE']);
  // reorder before start (display order only)
  eng.dispatch('setChecklist', { items: [LIST[4], LIST[0], LIST[1], LIST[2], LIST[3]] });
  assert.strictEqual(eng.hostState().checklist.items[0].id, 'k_fh', 'ids are kept when reordering');
  assert.throws(() => eng.dispatch('setChecklist', { items: [] }), /at least one/);
  eng.dispatch('startRound', { round: 1 });
  assert.throws(() => eng.dispatch('startRound', { round: 2 }), /no rounds/);
  assert.throws(() => eng.dispatch('completeRound', { fromRound: 1 }), /no rounds/);
  assert.throws(() => eng.dispatch('setRoundCount', { count: 4 }), /no rounds/);
  assert.throws(() => eng.dispatch('setChecklist', { items: LIST }), /locked/);
  assert.throws(() => eng.dispatch('setGameMode', { mode: 'rounds' }), /started/);
  assert.strictEqual(game.settings.mode, 'checklist');
});

test('any order; card qualifying for several rules → host chooses ONE; then RULE ALREADY COMPLETED', () => {
  const { eng, game, events } = setup();
  eng.dispatch('startRound', { round: 1 });
  const A = game.cards[0], B = game.cards[1];
  play(eng, cellsOf(A, ROW0)); // a full row = One Line AND Fast 5
  const v = eng.dispatch('addClaim', { cardNo: A.no });
  assert.ok(v.valid); assert.strictEqual(v.mode, 'checklist');
  assert.deepStrictEqual(v.checklist.qualifying.map(x => x.itemId).sort(), ['k_f5', 'k_ln']);
  assert.throws(() => eng.dispatch('confirmClaim', { claimId: v.claimId }), /more than one rule/);
  assert.throws(() => eng.dispatch('confirmClaim', { claimId: v.claimId, itemId: 'k_dg' }), /does not complete DIAGONAL/);
  const c = eng.dispatch('confirmClaim', { claimId: v.claimId, itemId: 'k_ln' });
  assert.strictEqual(c.status, 'confirmed'); assert.strictEqual(c.checklist.awarded.label, 'ONE LINE');
  assert.strictEqual(item(eng, 'k_f5').status, 'available', 'only the chosen rule is completed — never both');
  assert.strictEqual(item(eng, 'k_ln').status, 'completed');
  assert.ok(game.claims.find(x => x.id === v.claimId).itemId === 'k_ln');
  assert.ok(events.some(e => e[0] === 'ruleCompleted' && e[1].itemId === 'k_ln'));
  assert.ok(events.some(e => e[0] === 'tvScreen' && e[1].checklist && e[1].round === undefined), 'TV winner screen has no round number');
  const r = eng.dispatch('closeSession', { resume: true });
  assert.ok(!r.next, 'not all rules done — no prompt, music just continues');
  assert.strictEqual(eng.hostState().checklist.completed, 1);
  // the same card later wins Fast 5 (a different rule) in a new claim session
  const v2 = eng.dispatch('addClaim', { cardNo: A.no });
  assert.deepStrictEqual(v2.checklist.qualifying.map(x => x.itemId), ['k_f5']);
  assert.ok(v2.otherRuleWins.includes('ONE LINE'));
  eng.dispatch('confirmClaim', { claimId: v2.claimId }); // only one qualifies → no choice needed
  eng.dispatch('closeSession', {});
  // another card completes a row now → only completed rules → RULE ALREADY COMPLETED
  play(eng, cellsOf(B, ROW0));
  const v3 = eng.dispatch('addClaim', { cardNo: B.no });
  assert.ok(!v3.valid); assert.strictEqual(v3.headline, 'RULE ALREADY COMPLETED');
  assert.deepStrictEqual(v3.checklist.alreadyCompleted.map(x => x.itemId).sort(), ['k_f5', 'k_ln']);
  assert.throws(() => eng.dispatch('confirmClaim', { claimId: v3.claimId, itemId: 'k_ln' }), /RULE ALREADY COMPLETED|does not complete/);
  assert.deepStrictEqual(eng.playerView ? eng.winners().filter(w => w.cardNo === A.no).map(w => w.rule).sort() : [], ['FAST 5', 'ONE LINE']);
});

test('NOT A VALID BINGO explains completed / still-needed squares and the open rules', () => {
  const { eng, game, events } = setup();
  eng.dispatch('startRound', { round: 1 });
  const A = game.cards[2];
  play(eng, cellsOf(A, [0, 1, 2]));
  const v = eng.dispatch('addClaim', { cardNo: A.no });
  assert.ok(!v.valid); assert.strictEqual(v.headline, 'NOT A VALID BINGO');
  assert.ok(v.best && v.best.missing === 2, 'closest open rule needs 2 more');
  assert.strictEqual(v.grid.filter(g => g.played).length, 3);
  assert.match(v.explanation, /Open rules: FAST 5, ONE LINE, DIAGONAL, L SHAPE, FULL HOUSE/);
  assert.deepStrictEqual(v.checklist.available.length, 5);
});

test('simultaneous winners: two cards in one frozen session can both win the same rule', () => {
  const { eng, game, events } = setup();
  eng.dispatch('startRound', { round: 1 });
  const [A, B, C] = game.cards;
  // complete Fast 5 first so diagonals only qualify for Diagonal
  play(eng, cellsOf(C, [1, 2, 3, 5, 7]));
  const f = eng.dispatch('addClaim', { cardNo: C.no }); eng.dispatch('confirmClaim', { claimId: f.claimId, itemId: 'k_f5' }); eng.dispatch('closeSession', {});
  play(eng, cellsOf(A, DIAG).concat(cellsOf(B, DIAG)));
  eng.dispatch('freezeClaims', {});
  const a = eng.dispatch('addClaim', { cardNo: A.no });
  const b = eng.dispatch('addClaim', { cardNo: B.no });
  assert.ok(a.checklist.qualifying.some(x => x.itemId === 'k_dg'));
  eng.dispatch('confirmClaim', { claimId: a.claimId, itemId: 'k_dg' });
  // B is still checked against the same frozen snapshot — Diagonal stays available inside this session
  const bv = eng.dispatch('viewClaim', { claimId: b.claimId });
  assert.ok(bv.valid && bv.checklist.qualifying.some(x => x.itemId === 'k_dg'));
  eng.dispatch('confirmClaim', { claimId: b.claimId, itemId: 'k_dg' });
  // the same card can't be added twice to a session
  const dup = eng.dispatch('addClaim', { cardNo: A.no });
  assert.ok(dup.duplicateInSession || dup.status === 'duplicate' || dup.existing || dup.claimId === a.claimId, 'no second claim for the same card in a session');
  eng.dispatch('closeSession', {});
  assert.strictEqual(item(eng, 'k_dg').winners.length, 2);
  // a later session: Diagonal is completed for everyone
  const D = game.cards[3]; play(eng, cellsOf(D, DIAG));
  const d = eng.dispatch('addClaim', { cardNo: D.no });
  assert.strictEqual(d.headline, d.valid ? d.headline : 'RULE ALREADY COMPLETED');
  assert.ok(!d.checklist.qualifying.some(x => x.itemId === 'k_dg'));
});

test('corrections: revoke re-opens a rule; change award moves it to a rule the card really completed', () => {
  const { eng, game, events } = setup();
  eng.dispatch('startRound', { round: 1 });
  const A = game.cards[0];
  play(eng, cellsOf(A, ROW0));
  const v = eng.dispatch('addClaim', { cardNo: A.no });
  eng.dispatch('confirmClaim', { claimId: v.claimId, itemId: 'k_f5' });
  eng.dispatch('closeSession', {});
  assert.throws(() => eng.dispatch('changeAward', { claimId: v.claimId, itemId: 'k_dg' }), /did not complete/);
  eng.dispatch('changeAward', { claimId: v.claimId, itemId: 'k_ln', reason: 'meant One Line' });
  assert.strictEqual(item(eng, 'k_f5').status, 'available'); assert.strictEqual(item(eng, 'k_ln').status, 'completed');
  eng.dispatch('revokeWinner', { claimId: v.claimId, reason: 'wrong card number' });
  assert.strictEqual(item(eng, 'k_ln').status, 'available', 'revoking re-opens the rule');
  const audit = eng.hostState().audit.map(a => a.action);
  assert.ok(audit.includes('winner-corrected') && audit.includes('winner-revoked') && audit.includes('winner-confirmed'));
  assert.strictEqual(eng.hostState().claims.find(c => c.id === v.claimId).revokeReason, 'wrong card number');
});

test('all rules completed → host asked (finish / view / continue music without claims); claims close', () => {
  const { eng, game, events } = setup();
  eng.dispatch('setChecklist', { items: [LIST[1], LIST[4]] });
  eng.dispatch('startRound', { round: 1 });
  const A = game.cards[0];
  play(eng, A.cells);
  const v = eng.dispatch('addClaim', { cardNo: A.no });
  eng.dispatch('confirmClaim', { claimId: v.claimId, itemId: 'k_fh' });
  assert.ok(!eng.dispatch('closeSession', {}).next);
  const v2 = eng.dispatch('addClaim', { cardNo: A.no });
  eng.dispatch('confirmClaim', { claimId: v2.claimId, itemId: 'k_ln' });
  const r = eng.dispatch('closeSession', { resume: true });
  assert.ok(r.next && r.next.checklistDone && r.next.ask);
  assert.ok(events.some(e => e[0] === 'checklistDone'));
  assert.ok(eng.hostState().checklist.allDone);
  eng.dispatch('closeChecklist', {});
  assert.throws(() => eng.dispatch('freezeClaims', {}), /claims are closed/);
  const p = eng.dispatch('playerJoin', { name: 'Ana', tokenHash: 'ha' });
  assert.match(eng.dispatch('playerBingo', { playerId: p.playerId }).message || '', /All rules/);
  eng.dispatch('endGame', {});
  const end = eng.audienceState().screen;
  assert.strictEqual(end.mode, 'end'); assert.ok(end.checklist);
  assert.deepStrictEqual(end.byRule, [{ label: 'ONE LINE', winners: 1 }, { label: 'FULL HOUSE', winners: 1 }]);
});

test('playlist runs out first: host state lists the outstanding rules', () => {
  const { eng, game } = setup({ songs: 40 });
  eng.dispatch('startRound', { round: 1 });
  play(eng, game.order.slice());
  const ck = eng.hostState().checklist;
  assert.ok(ck.playlistDone);
  assert.strictEqual(ck.items.filter(i => i.status === 'available').length, 5);
});

test('TV + phones: checklist with ticks, no round numbers, one-away counts open rules only', () => {
  const { eng, game, events } = setup();
  const p = eng.dispatch('playerJoin', { name: 'Priya', tokenHash: 'hp' });
  eng.dispatch('startRound', { round: 1 });
  const card = game.cards.find(c => c.no === p.cardNo);
  play(eng, cellsOf(card, [0, 1, 2, 3])); // 4 of a row (and 4 of Fast 5)
  let pv = eng.playerView(p.playerId);
  assert.strictEqual(pv.mode, 'checklist'); assert.strictEqual(pv.away, 1);
  assert.strictEqual(pv.checklist.length, 5);
  assert.ok(eng.audienceState().oneAway >= 1);
  play(eng, cellsOf(card, [4]));
  const r = eng.dispatch('playerBingo', { playerId: p.playerId });
  assert.strictEqual(r.result, 'checking');
  eng.dispatch('confirmClaim', { claimId: r.claimId, itemId: 'k_ln' });
  eng.dispatch('closeSession', {});
  const tv = eng.audienceState();
  assert.strictEqual(tv.mode, 'checklist'); assert.deepStrictEqual(tv.rounds, []);
  assert.strictEqual(tv.checklist.completed, 1);
  assert.ok(tv.checklist.items.find(i => i.id === 'k_ln').done);
  assert.ok(!/cardNo|cardLabel|owner/.test(JSON.stringify(tv.checklist)), 'no card numbers or names on the TV checklist');
  pv = eng.playerView(p.playerId);
  assert.deepStrictEqual(pv.wins, ['ONE LINE']);
  assert.ok(pv.checklist.find(i => i.id === 'k_ln').mine);
  // Priya can still win Fast 5 with the same card
  assert.strictEqual(eng.dispatch('playerBingo', { playerId: p.playerId }).result, 'checking');
});

test('crash recovery: mode, checklist, statuses, winners and sessions survive save/reload', () => {
  const { eng, game, events } = setup();
  eng.dispatch('startRound', { round: 1 });
  const A = game.cards[0];
  play(eng, cellsOf(A, DIAG));
  const v = eng.dispatch('addClaim', { cardNo: A.no });
  eng.dispatch('confirmClaim', { claimId: v.claimId, itemId: 'k_dg' });
  // crash with the claim session still open
  const saved = JSON.parse(JSON.stringify(game));
  const g2 = GameEngine.normalise(saved);
  const e2 = new GameEngine(g2, { persist() {}, player() {}, event() {}, setTimeout: () => 0, clearTimeout() {}, gainFor: () => ({ gainDb: 0, status: 'ok' }) });
  const hs = e2.hostState();
  assert.strictEqual(hs.mode, 'checklist');
  assert.deepStrictEqual(hs.checklist.items.map(i => i.id), LIST.map(i => i.id));
  assert.strictEqual(hs.checklist.items.find(i => i.id === 'k_dg').status, 'completed');
  assert.ok(hs.session, 'open claim session restored');
  e2.dispatch('closeSession', {});
  assert.strictEqual(e2.hostState().checklist.completed, 1);
  // invalid stored checklist falls back to the default list
  const bad = JSON.parse(JSON.stringify(game)); bad.settings.checklist = [{ id: 'x', rule: { id: 'nonsense' } }];
  assert.ok(GameEngine.normalise(bad).settings.checklist.length >= 1);
});

test('spec §15 acceptance: Diagonal → Fast 5 → L Shape → One Line → Full House, no round changes, playback untouched', () => {
  const { eng, game, calls } = makeEngine({ cards: 10 });
  eng.dispatch('setGameMode', { mode: 'checklist', checklist: LIST });
  eng.dispatch('startRound', { round: 1 });
  const hs0 = eng.hostState();
  assert.ok(hs0.checklist.items.every(i => i.status === 'available'), '1. all five available');
  assert.strictEqual(eng.audienceState().checklist.items.length, 5, '3. TV shows the five-rule checklist');
  const order0 = game.order.slice();
  const [c1, c2, c3, c4, c5] = game.cards;
  const L_SHAPE = [0, 1, 2, 3, 4, 5, 10, 15, 20];
  const win = (card, idx, itemId, source) => {
    play(eng, idx.map(i => card.cells[i]));
    const loadsBefore = calls.player.filter(c => c.cmd === 'load').length;
    const playedBefore = game.played.length;
    const v = eng.dispatch('addClaim', { cardNo: card.no }, source);
    assert.ok(v.valid, `card ${card.no} valid for ${itemId}`);
    assert.ok(v.checklist.qualifying.some(q => q.itemId === itemId));
    const c = eng.dispatch('confirmClaim', { claimId: v.claimId, itemId }, source);
    assert.strictEqual(c.checklist.awarded.itemId, itemId);
    eng.dispatch('closeSession', { resume: true }, source);
    assert.strictEqual(item(eng, itemId).status, 'completed', itemId + ' checked off');
    // confirming never reloads the video, reshuffles, clears played songs or changes round
    assert.strictEqual(calls.player.filter(x => x.cmd === 'load').length, loadsBefore, 'no video reload');
    assert.deepStrictEqual(game.order, order0, 'no reshuffle');
    assert.ok(game.played.length >= playedBefore, 'played songs kept');
    assert.strictEqual(game.round.number, 1); assert.strictEqual(game.round.status, 'active', 'no round transition');
  };
  win(c1, DIAG, 'k_dg', 'phone:Host'); // 4–6: verified from the phone
  assert.ok(calls.events.every(e => e.n !== 'roundWon'), '7. no round change');
  win(c2, [7, 8, 9, 11, 13], 'k_f5');
  win(c3, L_SHAPE, 'k_l');
  win(c4, [5, 6, 7, 8, 9], 'k_ln');
  play(eng, c5.cells);
  const v = eng.dispatch('addClaim', { cardNo: c5.no });
  eng.dispatch('confirmClaim', { claimId: v.claimId, itemId: 'k_fh' });
  const r = eng.dispatch('closeSession', { resume: true });
  assert.ok(r.next && r.next.checklistDone, '14. all five completed detected');
  const hs = eng.hostState();
  assert.strictEqual(hs.checklist.completed, 5);
  assert.deepStrictEqual(hs.winners.map(w => w.rule), ['DIAGONAL', 'FAST 5', 'L SHAPE', 'ONE LINE', 'FULL HOUSE'], '15. winners per rule');
  eng.dispatch('endGame', {});
  assert.strictEqual(game.status, 'finished');
  assert.strictEqual(game.played.length, new Set(game.played.map(p => p.songId)).size, '16. song history intact, no duplicates');
  assert.ok(game.cards.every((c, i) => c.cells.length === 25), 'card mappings unchanged');
  assert.ok(game.transitions.length === 0, 'no round transitions recorded');
});

test('T Shape and Two Parallel Lines work as checklist rules; old saved games load as Round-Based', () => {
  const { eng, game } = makeEngine({ cards: 4 });
  eng.dispatch('setGameMode', { mode: 'checklist', checklist: [{ id: 't', rule: { id: 'tShape' } }, { id: 'p', rule: { id: 'twoLines' } }] });
  eng.dispatch('startRound', { round: 1 });
  const T = [0, 1, 2, 3, 4, 7, 12, 17, 22];
  play(eng, T.map(i => game.cards[0].cells[i]));
  const v = eng.dispatch('addClaim', { cardNo: game.cards[0].no });
  assert.deepStrictEqual(v.checklist.qualifying.map(q => q.itemId), ['t']);
  eng.dispatch('confirmClaim', { claimId: v.claimId }); eng.dispatch('closeSession', {});
  play(eng, [...ROW0, 5, 6, 7, 8, 9].map(i => game.cards[1].cells[i]));
  const w = eng.dispatch('addClaim', { cardNo: game.cards[1].no });
  assert.deepStrictEqual(w.checklist.qualifying.map(q => q.itemId), ['p']);
  // a v1.5 save without mode/checklist
  const old = JSON.parse(JSON.stringify(game)); delete old.settings.mode; delete old.settings.checklist; delete old.checklistClosed;
  const n = GameEngine.normalise(old);
  assert.strictEqual(n.settings.mode, 'rounds');
});
