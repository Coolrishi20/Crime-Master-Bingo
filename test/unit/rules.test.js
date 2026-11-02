'use strict';
const test = require('node:test');
const assert = require('node:assert');
const rules = require('../../src/core/rules');
const cells = Array.from({ length: 25 }, (_, i) => 'x' + i);
const set = (...idx) => new Set(idx.flat().map(i => 'x' + i));
const row = r => [0, 1, 2, 3, 4].map(c => r * 5 + c);
const col = c => [0, 1, 2, 3, 4].map(r => r * 5 + c);

test('Round 1: horizontal line valid', () => { const r = rules.checkCard(cells, set(row(2)), 1); assert.ok(r.valid); assert.match(r.headline, /Row 3/); assert.deepStrictEqual(r.winningCells, row(2)); });
test('Round 1: vertical line valid', () => { const r = rules.checkCard(cells, set(col(4)), 1); assert.ok(r.valid); assert.match(r.headline, /Column 5/); });
test('Round 1: diagonal invalid with explanation', () => { const r = rules.checkCard(cells, set([0, 6, 12, 18, 24]), 1); assert.ok(!r.valid); assert.match(r.reason, /Diagonals do not count/); });
test('Round 1: anti-diagonal invalid', () => { assert.ok(!rules.checkCard(cells, set([4, 8, 12, 16, 20]), 1).valid); });
test('Round 1: 4 of 5 is not a line', () => { assert.ok(!rules.checkCard(cells, set([10, 11, 12, 13]), 1).valid); });
test('Round 2: two horizontal rows valid', () => { const r = rules.checkCard(cells, set(row(0), row(4)), 2); assert.ok(r.valid); assert.match(r.headline, /Rows 1 & 5/); });
test('Round 2: two vertical columns valid', () => { assert.ok(rules.checkCard(cells, set(col(1), col(3)), 2).valid); });
test('Round 2: row + column invalid', () => { const r = rules.checkCard(cells, set(row(1), col(2)), 2); assert.ok(!r.valid); assert.match(r.reason, /parallel/); });
test('Round 2: row + column + another row valid (qualifying pair exists)', () => { assert.ok(rules.checkCard(cells, set(row(1), col(2), row(3)), 2).valid); });
test('Round 2: one line only invalid', () => { assert.ok(!rules.checkCard(cells, set(row(1)), 2).valid); });
test('Round 2: two diagonals invalid', () => { assert.ok(!rules.checkCard(cells, set([0, 6, 12, 18, 24, 4, 8, 16, 20]), 2).valid); });
test('Round 3: full house valid', () => { assert.ok(rules.checkCard(cells, set([...Array(25).keys()]), 3).valid); });
test('Round 3: 24 of 25 invalid', () => { const r = rules.checkCard(cells, set([...Array(24).keys()]), 3); assert.ok(!r.valid); assert.match(r.reason, /1 song on this card has/); });
test('Played songs not on the card are ignored', () => { assert.ok(!rules.checkCard(cells, new Set(['zz', 'yy']), 1).valid); });
test('qualifiedAt finds the earliest song that completed the pattern', () => {
  const hist = ['a', 'x0', 'x1', 'b', 'x2', 'x3', 'x4', 'x5'];
  assert.strictEqual(rules.qualifiedAt(cells, hist, 1), 7);
});
test('card must have 25 squares', () => { assert.throws(() => rules.checkCard(['a'], new Set(), 1)); });
