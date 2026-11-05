'use strict';
/* 2.3 pacing estimate: plausible, ordered, honest about rules that may not finish, and it
 * never touches a real game's order or cards. */
const test = require('node:test');
const assert = require('node:assert');
const { simulate, inBreak, cardQualifies } = require('../../src/core/pacing');
const { makeEngine } = require('./helpers');
const ids = (n) => Array.from({ length: n }, (_, i) => 's' + i);

test('a card qualifies at the right song: line = 5th song of its best line, Fast 5 = 5th song on the card', () => {
  const pos = Array.from({ length: 25 }, (_, i) => 100 + i);
  [0, 1, 2, 3, 4].forEach((k, i) => { pos[k] = i; }); // first row played first
  assert.strictEqual(cardQualifies(pos, { id: 'line' }), 5);
  assert.strictEqual(cardQualifies(pos, { id: 'fast5', mode: 'any' }), 5);
  assert.strictEqual(cardQualifies(pos, { id: 'full' }), 125);
});

test('rounds: later rounds take longer; more cards win sooner; minutes follow the song length', () => {
  const few = simulate({ songIds: ids(50), cardCount: 10, mode: 'rounds', roundCount: 3, trials: 400, secsPerSong: 30, seed: 1 });
  const many = simulate({ songIds: ids(50), cardCount: 200, mode: 'rounds', roundCount: 3, trials: 400, secsPerSong: 30, seed: 1 });
  const m = (r) => r.items.map(i => i.songs.p50);
  assert.ok(m(few)[0] < m(few)[1] && m(few)[1] < m(few)[2], 'One Line < Two Lines < Full House: ' + m(few));
  assert.ok(m(many)[0] <= m(few)[0] && m(many)[2] <= m(few)[2], 'more cards → sooner');
  assert.strictEqual(few.items[0].minutes.p50, Math.round(few.items[0].songs.p50 * 30 / 60));
  assert.ok(few.items[2].songs.p50 >= 40 && few.items[2].songs.p50 <= 50, 'Full House needs most of a 50-song playlist');
});

test('checklist: rules independent; Fast 5 is quick; a 15-minute break estimate', () => {
  const r = simulate({ songIds: ids(60), cardCount: 40, mode: 'checklist', checklist: [{ id: 'a', rule: { id: 'fast5', mode: 'any' } }, { id: 'b', rule: { id: 'full' } }], trials: 300, secsPerSong: 25, seed: 2 });
  assert.ok(r.items[0].songs.p50 <= 7);
  const b = inBreak(r, 15);
  assert.strictEqual(b.songs, 36);
  assert.ok(b.likely.some(l => /FAST 5/.test(l)) && !b.likely.some(l => /FULL HOUSE/.test(l)));
});

test('warns when a rule may not finish before the playlist runs out', () => {
  // Full House with a single card needs all 25 of its songs; with 200 songs that is usually near the end
  const r = simulate({ songIds: ids(200), cardCount: 1, mode: 'rounds', roundCount: 3, trials: 200, secsPerSong: 30, seed: 3 });
  assert.ok(r.items[2].songs.p50 > 150);
  const r2 = simulate({ songIds: ids(40), cardCount: 1, mode: 'rounds', roundCount: 3, rounds: { 1: [{ id: 'full' }], 2: [{ id: 'full' }], 3: [{ id: 'full' }] }, trials: 200, secsPerSong: 30, seed: 4 });
  assert.ok(r2.items[1].mayNotFinish && r2.items[1].finishChance < 90, 'round 2 Full House after round 1 Full House cannot finish');
});

test('the estimate never changes a real game', () => {
  const { eng, game } = makeEngine({ cards: 10 });
  const order = JSON.stringify(game.order); const cards = JSON.stringify(game.cards);
  simulate({ songIds: game.order, cardCount: 10, mode: 'rounds', roundCount: 3, trials: 100, secsPerSong: 30 });
  assert.strictEqual(JSON.stringify(game.order), order); assert.strictEqual(JSON.stringify(game.cards), cards);
  assert.ok(eng);
});
