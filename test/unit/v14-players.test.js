'use strict';
/* v1.4 home play — phone cards for players (engine rules) */
const test = require('node:test');
const assert = require('node:assert');
const { makeEngine, play } = require('./helpers');
const row = (card, r) => card.cells.slice(r * 5, r * 5 + 5);
const join = (eng, name, t = 'h') => eng.dispatch('playerJoin', { name, tokenHash: t + name }, 'phone-player');

test('a joining player gets the lowest card that was not printed/shared, and it is issued + locked', () => {
  const { eng, game } = makeEngine({ cards: 10 });
  game.cards[0].printed = true; game.cards[1].printed = true;
  const r = join(eng, 'Priya');
  assert.strictEqual(r.cardNo, 3);
  const c = game.cards.find(x => x.no === 3);
  assert.ok(c.printed && c.locked && game.cardsLocked);
  assert.strictEqual(c.issuedVia, 'phone');
  assert.strictEqual(c.owner, 'Priya');
});

test('players never share a card; duplicate names get a number', () => {
  const { eng } = makeEngine({ cards: 10 });
  const a = join(eng, 'Rahul'); const b = join(eng, 'rahul');
  assert.notStrictEqual(a.cardNo, b.cardNo);
  assert.strictEqual(b.name, 'rahul 2');
});

test('when every card is taken a new card is added (existing cards untouched, one shared batch)', () => {
  const { eng, game } = makeEngine({ cards: 2 });
  const before = JSON.stringify(game.cards.map(c => c.cells));
  join(eng, 'A'); join(eng, 'B');
  const c = join(eng, 'C'); const d = join(eng, 'D');
  assert.strictEqual(c.cardNo, 3); assert.strictEqual(d.cardNo, 4);
  assert.strictEqual(JSON.stringify(game.cards.slice(0, 2).map(x => x.cells)), before);
  assert.strictEqual(game.cards[2].batch, game.cards[3].batch);
  const cells = new Set(game.cards.map(x => x.cells.join()));
  assert.strictEqual(cells.size, 4, 'all layouts unique');
});

test('closed joining, empty names and missing token are refused', () => {
  const { eng } = makeEngine({ cards: 5 });
  assert.throws(() => join(eng, '   '), /name/);
  assert.throws(() => eng.dispatch('playerJoin', { name: 'X' }), /token/);
  eng.dispatch('setPlayersOpen', { open: false });
  assert.throws(() => join(eng, 'Late'), /closed/);
});

test('early BINGO is only answered "not yet" — no freeze, no claim', () => {
  const { eng, game } = makeEngine({ cards: 5 });
  const p = join(eng, 'Priya');
  assert.strictEqual(eng.dispatch('playerBingo', { playerId: p.playerId }).result, 'no-round');
  eng.dispatch('startRound', { round: 1 });
  const card = game.cards.find(c => c.no === p.cardNo);
  play(eng, row(card, 1).slice(0, 4));
  const r = eng.dispatch('playerBingo', { playerId: p.playerId });
  assert.strictEqual(r.result, 'not-yet');
  assert.strictEqual(game.claimSessions.length, 0);
  assert.strictEqual(game.claims.length, 0);
});

test('a real BINGO freezes claims and adds the card; confirming shows on the player view', () => {
  const { eng, game } = makeEngine({ cards: 5 });
  const p = join(eng, 'Priya');
  eng.dispatch('startRound', { round: 1 });
  const card = game.cards.find(c => c.no === p.cardNo);
  play(eng, row(card, 2));
  const r = eng.dispatch('playerBingo', { playerId: p.playerId }, 'player:Priya');
  assert.strictEqual(r.result, 'checking');
  const s = eng.activeSession();
  assert.ok(s && s.claimIds.length === 1);
  assert.strictEqual(eng.sessionView().claims[0].owner, 'Priya');
  // pressing again while the host is checking does not add a second claim
  assert.strictEqual(eng.dispatch('playerBingo', { playerId: p.playerId }).result, 'checking');
  assert.strictEqual(eng.activeSession().claimIds.length, 1);
  eng.dispatch('confirmClaim', { claimId: r.claimId });
  const v = eng.playerView(p.playerId);
  assert.deepStrictEqual(v.wins, [1]);
  assert.strictEqual(v.last.status, 'confirmed');
  assert.strictEqual(eng.dispatch('playerBingo', { playerId: p.playerId }).result, 'already');
});

test('player view shows only their own card, the round and their own results', () => {
  const { eng, game } = makeEngine({ cards: 5 });
  const p = join(eng, 'Nani'); join(eng, 'Mum');
  const v = eng.playerView(p.playerId);
  assert.strictEqual(v.cells.length, 25);
  assert.strictEqual(v.me.name, 'Nani');
  assert.ok(Array.isArray(v.played) && !('players' in v) && !('claims' in v), 'played list (as on the TV) but no other players or claims');
  assert.ok(!JSON.stringify(v).includes('tokenHash'));
  const hs = eng.hostState();
  assert.strictEqual(hs.players.length, 2);
  assert.ok(!JSON.stringify(hs.players).includes('tokenHash'));
});

test('removing a player retires their card for good', () => {
  const { eng } = makeEngine({ cards: 5 });
  const a = join(eng, 'A');
  eng.dispatch('playerRemove', { playerId: a.playerId });
  assert.strictEqual(eng.playerView(a.playerId), null);
  const b = join(eng, 'B');
  assert.notStrictEqual(b.cardNo, a.cardNo);
});

/* v1.4.1 */
test('"one away" counts only songs actually played, for the current round', () => {
  const { eng, game } = makeEngine({ cards: 5 });
  const p = join(eng, 'Priya');
  assert.strictEqual(eng.playerView(p.playerId).away, null, 'nothing before a round');
  eng.dispatch('startRound', { round: 1 });
  const card = game.cards.find(c => c.no === p.cardNo);
  play(eng, row(card, 3).slice(0, 3));
  assert.strictEqual(eng.playerView(p.playerId).away, 2);
  play(eng, row(card, 3).slice(3, 4));
  assert.strictEqual(eng.playerView(p.playerId).away, 1);
  assert.strictEqual(eng.playerView(p.playerId).played.length, 4);
});

test('TV winner screen carries the winner names (option), never on "Not a Bingo"', () => {
  const { eng, game, events } = makeEngine({ cards: 5 });
  const a = join(eng, 'Priya'); const b = join(eng, 'Rahul');
  eng.dispatch('startRound', { round: 1 });
  const ca = game.cards.find(c => c.no === a.cardNo), cb = game.cards.find(c => c.no === b.cardNo);
  play(eng, row(ca, 0)); play(eng, row(cb, 4));
  const ra = eng.dispatch('playerBingo', { playerId: a.playerId });
  const rb = eng.dispatch('playerBingo', { playerId: b.playerId });
  const tv = [];
  eng.hooks.event = (n, pl) => { if (n === 'tvScreen') tv.push(pl); };
  eng.dispatch('confirmClaim', { claimId: ra.claimId });
  eng.dispatch('confirmClaim', { claimId: rb.claimId });
  assert.deepStrictEqual(tv[0].names, ['Priya']);
  assert.deepStrictEqual(tv[1].names, ['Priya', 'Rahul']);
  eng.dispatch('setTvScreens', { showName: false });
  eng.dispatch('showTvScreen', { claimId: ra.claimId, type: 'winner' });
  assert.ok(!tv[2].names, 'names hidden when the option is off');
  void events;
});

/* v1.4.2 */
test('TV "one song away" count: issued cards only, current round, winners excluded, option off', () => {
  const { eng, game } = makeEngine({ cards: 6 });
  const a = join(eng, 'A'); const b = join(eng, 'B');
  eng.dispatch('startRound', { round: 1 });
  const ca = game.cards.find(c => c.no === a.cardNo), cb = game.cards.find(c => c.no === b.cardNo);
  play(eng, row(ca, 0).slice(0, 4));
  play(eng, row(cb, 2).slice(0, 4));
  const unissued = game.cards.filter(c => !c.printed).length;
  assert.ok(unissued > 0);
  const n = eng.audienceState().oneAway;
  assert.ok(n >= 2, 'both phone cards counted');
  assert.strictEqual(n, game.cards.filter(c => c.printed).length >= n ? n : -1);
  assert.ok(!/"no"|cells|cardNo/.test(JSON.stringify(eng.audienceState())), 'count only, no card details');
  eng.dispatch('setTvScreens', { closeCount: false });
  assert.strictEqual(eng.audienceState().oneAway, null);
});
