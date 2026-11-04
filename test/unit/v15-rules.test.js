'use strict';
/* v1.5 custom Bingo rules: L Shape, T Shape, Diagonal, Fast 5 (any / pattern), custom patterns,
 * multiple eligible patterns per round, engine integration (claims, Claim Freeze, phones). */
const test = require('node:test');
const assert = require('node:assert');
const R = require('../../src/core/rules');
const { makeEngine, play } = require('./helpers');

const CELLS = [...Array(25).keys()].map(i => 's' + i);
const played = (idx) => new Set(idx.map(i => 's' + i));
const rr = (round, ...rules) => ({ round, rules });
const row = (r) => [0, 1, 2, 3, 4].map(c => r * 5 + c);
const col = (c) => [0, 1, 2, 3, 4].map(r => r * 5 + c);
const uniq = (a) => Array.from(new Set(a));

test('L Shape: all four rotations win with exactly their 9 squares', () => {
  const shapes = [uniq([...row(0), ...col(0)]), uniq([...row(0), ...col(4)]), uniq([...row(4), ...col(0)]), uniq([...row(4), ...col(4)])];
  shapes.forEach((cells, k) => {
    assert.strictEqual(cells.length, 9, 'nine distinct squares');
    const res = R.checkCard(CELLS, played(cells), rr(1, { id: 'lShape' }));
    assert.ok(res.valid, 'rotation ' + k);
    assert.deepStrictEqual(res.winningCells, cells.slice().sort((a, b) => a - b));
    // one square short is not valid, and the explanation says how close it is
    const short = R.checkCard(CELLS, played(cells.slice(1)), rr(1, { id: 'lShape' }));
    assert.ok(!short.valid); assert.match(short.reason, /needs 1 song/);
  });
});

test('L Shape is not satisfied by an inner row + column, or a row alone', () => {
  assert.ok(!R.checkCard(CELLS, played(uniq([...row(2), ...col(2)])), rr(1, { id: 'lShape' })).valid);
  assert.ok(!R.checkCard(CELLS, played(row(0)), rr(1, { id: 'lShape' })).valid);
});

test('T Shape: four rotations (outer bar + centre stem to the opposite edge), 9 squares', () => {
  const shapes = [uniq([...row(0), ...col(2)]), uniq([...row(4), ...col(2)]), uniq([...col(0), ...row(2)]), uniq([...col(4), ...row(2)])];
  shapes.forEach((cells) => {
    assert.strictEqual(cells.length, 9);
    assert.ok(R.checkCard(CELLS, played(cells), rr(2, { id: 'tShape' })).valid);
  });
  // a cross (+) through the middle is not a T
  assert.ok(!R.checkCard(CELLS, played(uniq([...row(2), ...col(2)])), rr(2, { id: 'tShape' })).valid);
});

test('Diagonal: both diagonals win only when the rule is enabled', () => {
  const main = [0, 6, 12, 18, 24], anti = [4, 8, 12, 16, 20];
  [main, anti].forEach(d => {
    assert.ok(R.checkCard(CELLS, played(d), rr(1, { id: 'diagonal' })).valid);
    // standard Round 1 still refuses diagonals, with the original wording
    const std = R.checkCard(CELLS, played(d), 1);
    assert.ok(!std.valid); assert.match(std.reason, /Diagonals do not count/);
  });
});

test('One Line + Diagonal together: either wins; info says diagonals count', () => {
  const set = rr(1, { id: 'line' }, { id: 'diagonal' });
  assert.ok(R.checkCard(CELLS, played(row(3)), set).valid);
  assert.ok(R.checkCard(CELLS, played([4, 8, 12, 16, 20]), set).valid);
  const info = R.roundInfo(set);
  assert.strictEqual(info.label, 'ONE LINE / DIAGONAL');
  assert.ok(info.diagonalsCount);
  assert.doesNotMatch(info.rule, /Diagonals do not count/);
});

test('Fast 5 (any): any five distinct played squares; four is not enough', () => {
  const r = rr(1, { id: 'fast5' });
  assert.ok(R.checkCard(CELLS, played([2, 9, 13, 17, 21]), r).valid);
  const four = R.checkCard(CELLS, played([2, 9, 13, 17]), r);
  assert.ok(!four.valid); assert.match(four.reason, /needs 1 song/);
  // songs not on the card never count
  const off = new Set(['s1', 's2', 's3', 's4', 'x9']);
  assert.ok(!R.checkCard(CELLS, off, r).valid);
});

test('Fast 5 (pattern): exactly the five chosen squares; validation rejects 4 or 6', () => {
  const r = rr(1, { id: 'fast5', mode: 'pattern', cells: [0, 4, 12, 20, 24] });
  assert.ok(R.checkCard(CELLS, played([0, 4, 12, 20, 24]), r).valid);
  assert.ok(!R.checkCard(CELLS, played([0, 4, 12, 20, 23]), r).valid);
  assert.throws(() => R.normaliseRule({ id: 'fast5', mode: 'pattern', cells: [0, 1, 2, 3] }), /exactly 5/);
  assert.throws(() => R.normaliseRule({ id: 'fast5', mode: 'pattern', cells: [0, 1, 2, 3, 4, 5] }), /exactly 5/);
  assert.strictEqual(R.roundInfo(r).label, 'FAST 5 (PATTERN)');
});

test('Custom pattern + validation of nonsense rules', () => {
  const corners = rr(3, { id: 'custom', name: 'Four Corners', cells: [0, 4, 20, 24] });
  assert.ok(R.checkCard(CELLS, played([0, 4, 20, 24]), corners).valid);
  assert.strictEqual(R.roundInfo(corners).label, 'FOUR CORNERS');
  assert.throws(() => R.normaliseRule({ id: 'custom', name: 'x', cells: [3] }), /at least 2/);
  assert.throws(() => R.normaliseRule({ id: 'custom', name: 'x', cells: [0, 99] }), /at least 2|Unknown/);
  assert.throws(() => R.normaliseRule({ id: 'bogus' }), /Unknown winning rule/);
  assert.throws(() => R.normaliseRuleSet([]), /at least one/);
});

test('Standard rounds keep identical results and wording through the new API', () => {
  [1, 2, 3].forEach(n => {
    const sets = [played(row(1)), played([...row(1), ...row(3)]), played([...Array(25).keys()]), played([0, 6, 12, 18, 24])];
    sets.forEach(s => {
      const a = R.checkCard(CELLS, s, n); const b = R.checkCard(CELLS, s, { round: n, rules: R.DEFAULT_ROUND_RULES[n] });
      assert.deepStrictEqual(JSON.parse(JSON.stringify(Object.assign({}, a, { analysis: null }))), JSON.parse(JSON.stringify(Object.assign({}, b, { analysis: null }))));
    });
    assert.deepStrictEqual(R.patternExamples(n), R.patternExamples({ round: n, rules: R.DEFAULT_ROUND_RULES[n] }));
  });
});

test('qualifiedAt finds the song that completed a custom pattern (fair simultaneous claims)', () => {
  const order = ['s0', 'x', 's6', 's12', 'y', 's18', 's24'];
  assert.strictEqual(R.qualifiedAt(CELLS, order, rr(1, { id: 'diagonal' })), 7);
  assert.strictEqual(R.qualifiedAt(CELLS, ['s3', 's9', 's1', 's22', 's14'], rr(1, { id: 'fast5' })), 5);
});

/* ---------------------------------------------------------------- engine */
test('engine: rules per round drive claims, phones and TV; locked once the round starts', () => {
  const { eng, game } = makeEngine({ cards: 10 });
  eng.dispatch('setRoundRules', { round: 1, rules: [{ id: 'lShape' }, { id: 'diagonal' }] });
  eng.dispatch('setRoundRules', { round: 2, rules: [{ id: 'fast5', mode: 'pattern', cells: [0, 4, 12, 20, 24] }] });
  assert.strictEqual(eng.audienceState().round.label, 'L SHAPE / DIAGONAL');
  assert.strictEqual(eng.hostState().roundRules[2].label, 'FAST 5 (PATTERN)');
  eng.dispatch('startRound', { round: 1 });
  assert.throws(() => eng.dispatch('setRoundRules', { round: 1, rules: [{ id: 'line' }] }), /locked/);
  // round 2 can still be changed while round 1 plays
  eng.dispatch('setRoundRules', { round: 2, rules: [{ id: 'tShape' }] });
  const card = game.cards[0];
  play(eng, [0, 6, 12, 18, 24].map(i => card.cells[i]));
  const r = eng.dispatch('addClaim', { cardNo: card.no });
  assert.ok(r.valid, 'diagonal valid in a round that allows it');
  assert.match(r.explanation, /Diagonal/);
  assert.strictEqual(r.roundLabel, 'L SHAPE / DIAGONAL');
  const c2 = game.cards[1]; const c2r = eng.dispatch('addClaim', { cardNo: c2.no });
  // both claims are checked against the same frozen snapshot (Claim Freeze)
  assert.strictEqual(game.claimSessions.length, 1);
  assert.strictEqual(eng.sessionView().claims.length, 2);
  void c2r;
});

test('engine: rules survive save/reload (crash recovery) and invalid stored rules fall back safely', () => {
  const { eng, game } = makeEngine({ cards: 5 });
  eng.dispatch('setRoundRules', { round: 3, rules: [{ id: 'custom', name: 'Plus', cells: [2, 7, 10, 11, 12, 13, 14, 17, 22] }] });
  const saved = JSON.parse(JSON.stringify(game));
  const { GameEngine } = require('../../src/core/engine');
  const g2 = GameEngine.normalise(saved);
  assert.strictEqual(g2.settings.rounds[3][0].name, 'Plus');
  const broken = JSON.parse(JSON.stringify(game)); broken.settings.rounds[2] = [{ id: 'nonsense' }];
  const g3 = GameEngine.normalise(broken);
  assert.deepStrictEqual(g3.settings.rounds[2], R.DEFAULT_ROUND_RULES[2]);
  void eng;
});

test('engine: phone player BINGO and "one away" follow the custom rule', () => {
  const { eng, game } = makeEngine({ cards: 5 });
  eng.dispatch('setRoundRules', { round: 1, rules: [{ id: 'fast5' }] });
  const p = eng.dispatch('playerJoin', { name: 'Nani', tokenHash: 'h1' });
  eng.dispatch('startRound', { round: 1 });
  const card = game.cards.find(c => c.no === p.cardNo);
  play(eng, [3, 9, 14, 20].map(i => card.cells[i]));
  assert.strictEqual(eng.playerView(p.playerId).away, 1);
  assert.strictEqual(eng.dispatch('playerBingo', { playerId: p.playerId }).result, 'not-yet');
  play(eng, [card.cells[7]]);
  assert.strictEqual(eng.dispatch('playerBingo', { playerId: p.playerId }).result, 'checking');
  assert.ok(eng.playerView(p.playerId).round.example, 'phone gets the pattern diagram for its round');
});

/* ---------------------------------------------------------------- host-defined number of rounds */
test('host sets the number of rounds: 5-round game, any patterns per round, last round ends the game', () => {
  const { eng, game } = makeEngine({ cards: 10 });
  eng.dispatch('setRoundCount', { count: 5 });
  assert.strictEqual(eng.hostState().roundCount, 5);
  assert.deepStrictEqual(Object.keys(eng.hostState().roundRules), ['1', '2', '3', '4', '5']);
  assert.deepStrictEqual(game.settings.rounds[4], [{ id: 'line' }], 'new rounds start as One Line until the host picks');
  eng.dispatch('setRoundRules', { round: 4, rules: [{ id: 'tShape' }, { id: 'lShape' }] });
  eng.dispatch('setRoundRules', { round: 5, rules: [{ id: 'full' }] });
  assert.strictEqual(eng.audienceState().rounds.length, 5);
  for (let n = 1; n <= 5; n++) {
    eng.dispatch('startRound', { round: n });
    const r = eng.dispatch('completeRound', { fromRound: n, force: true });
    if (n < 5) { assert.ok(!r.final, `round ${n} is not final`); assert.strictEqual(r.nextRound, n + 1); }
    else assert.ok(r.final, 'round 5 ends the game');
  }
  assert.strictEqual(game.status, 'finished');
});

test('a 1-round game; rounds already under way cannot be removed; limits 1–10', () => {
  const { eng, game } = makeEngine({ cards: 5 });
  eng.dispatch('setRoundCount', { count: 1 });
  eng.dispatch('setRoundRules', { round: 1, rules: [{ id: 'fast5' }] });
  assert.throws(() => eng.dispatch('setRoundRules', { round: 2, rules: [{ id: 'line' }] }), /between 1 and 1/);
  eng.dispatch('startRound', { round: 1 });
  assert.ok(eng.dispatch('completeRound', { fromRound: 1, force: true }).final);
  assert.strictEqual(game.status, 'finished');
  const b = makeEngine({ cards: 5 }).eng;
  b.dispatch('setRoundCount', { count: 4 }); b.dispatch('startRound', { round: 1 });
  b.dispatch('completeRound', { fromRound: 1, force: true }); b.dispatch('startRound', { round: 2 });
  assert.throws(() => b.dispatch('setRoundCount', { count: 1 }), /at least 2/);
  b.dispatch('setRoundCount', { count: 2 });
  assert.throws(() => b.dispatch('setRoundCount', { count: 11 }), /between 1 and 10/);
  assert.throws(() => b.dispatch('setRoundCount', { count: 0 }), /between 1 and 10/);
});

/* ---------------------------------------------------------------- one card, several rounds */
test('the same card can win several rounds (each round once), with custom rules and phone players', () => {
  const { eng, game } = makeEngine({ cards: 6 });
  eng.dispatch('setRoundCount', { count: 4 });
  eng.dispatch('setRoundRules', { round: 2, rules: [{ id: 'diagonal' }] });
  eng.dispatch('setRoundRules', { round: 4, rules: [{ id: 'fast5' }] });
  const p = eng.dispatch('playerJoin', { name: 'Priya', tokenHash: 'hp' });
  const card = game.cards.find(c => c.no === p.cardNo);
  const winRound = (n, idx) => {
    if (n > 1) eng.dispatch('completeRound', { fromRound: n - 1 });
    eng.dispatch('startRound', { round: n });
    play(eng, idx.map(i => card.cells[i]));
    const r = eng.dispatch('playerBingo', { playerId: p.playerId });
    assert.strictEqual(r.result, 'checking', `round ${n} claim is valid`);
    const v = eng.dispatch('confirmClaim', { claimId: r.claimId });
    assert.strictEqual(v.status, 'confirmed');
    eng.dispatch('closeSession', { resume: false });
    // the same card cannot win the same round twice
    assert.strictEqual(eng.dispatch('playerBingo', { playerId: p.playerId }).result, 'already');
    return v;
  };
  winRound(1, [0, 1, 2, 3, 4]);                 // One Line
  const v2 = winRound(2, [0, 6, 12, 18, 24]);   // Diagonal
  assert.deepStrictEqual(v2.otherRoundWins, [1], 'host sees the card already won Round 1');
  winRound(3, [...Array(25).keys()]);           // Full House
  eng.dispatch('completeRound', { fromRound: 3 });
  eng.dispatch('startRound', { round: 4 });
  const r4 = eng.dispatch('addClaim', { cardNo: card.no }); // Fast 5 — already has all 25 songs
  assert.ok(r4.valid && !r4.alreadyWinner);
  eng.dispatch('confirmClaim', { claimId: r4.claimId });
  assert.deepStrictEqual(eng.playerView(p.playerId).wins, [1, 2, 3, 4], 'one card, four rounds won');
  assert.strictEqual(eng.hostState().winners.filter(w => w.cardNo === card.no).length, 4);
});

/* ---------------------------------------------------------------- after a winner: ask / intermission */
test('after a round is won the host is asked what next (intermission or next round)', () => {
  const { eng, game } = makeEngine({ cards: 6 });
  const events = []; const orig = eng.hooks.event; eng.hooks.event = (n, p) => { events.push([n, p]); if (orig) orig(n, p); };
  eng.dispatch('startRound', { round: 1 });
  const card = game.cards[0]; play(eng, card.cells.slice(0, 5));
  const c = eng.dispatch('addClaim', { cardNo: card.no });
  assert.ok(!events.some(e => e[0] === 'roundWon'), 'no prompt while claims are still being checked');
  eng.dispatch('confirmClaim', { claimId: c.claimId });
  const r = eng.dispatch('closeSession', { resume: true });
  const ask = events.find(e => e[0] === 'roundWon');
  assert.ok(ask && r.next && r.next.ask, 'host asked once the claim session is done');
  assert.strictEqual(ask[1].round, 1); assert.strictEqual(ask[1].nextRound, 2); assert.ok(!ask[1].final);
  // host picks Intermission
  const i = eng.dispatch('startIntermission', { minutes: 10, message: 'Samosas at the bar!' });
  assert.strictEqual(game.round.number, 2); assert.strictEqual(game.round.status, 'ready', 'round completed, next one ready');
  assert.notStrictEqual(game.playback.status, 'playing', 'music paused for the break');
  const scr = eng.audienceState().screen;
  assert.strictEqual(scr.mode, 'intermission'); assert.strictEqual(scr.message, 'Samosas at the bar!');
  assert.strictEqual(scr.next.n, 2); assert.ok(scr.until && i.intermission.minutes === 10);
  // starting the next round ends the break
  eng.dispatch('startRound', { round: 2 });
  assert.strictEqual(game.intermission, null);
  assert.notStrictEqual(eng.audienceState().screen.mode, 'intermission');
});

test('"go to intermission automatically" setting; final round asks to finish instead', () => {
  const { eng, game } = makeEngine({ cards: 6 });
  eng.dispatch('setGameSettings', { afterWinner: 'intermission', intermissionMinutes: 5 });
  eng.dispatch('setRoundCount', { count: 2 });
  eng.dispatch('startRound', { round: 1 });
  const card = game.cards[0]; play(eng, card.cells.slice(0, 5));
  eng.dispatch('confirmClaim', { claimId: eng.dispatch('addClaim', { cardNo: card.no }).claimId });
  const r = eng.dispatch('closeSession', {});
  assert.strictEqual(r.next.auto, 'intermission');
  assert.ok(game.intermission && game.intermission.minutes === 5);
  assert.strictEqual(eng.audienceState().screen.mode, 'intermission');
  eng.dispatch('startRound', { round: 2 });
  play(eng, card.cells.slice(5, 10));
  const events = []; eng.hooks.event = (n, p) => events.push([n, p]);
  eng.dispatch('confirmClaim', { claimId: eng.dispatch('addClaim', { cardNo: card.no }).claimId });
  const r2 = eng.dispatch('closeSession', {});
  assert.ok(r2.next.ask && r2.next.final, 'last round: host is asked to finish the game');
  assert.throws(() => eng.dispatch('startIntermission', {}), /last round/);
  assert.ok(!game.intermission);
});
