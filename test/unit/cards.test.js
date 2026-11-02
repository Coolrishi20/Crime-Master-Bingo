'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../../src/core/cards');
const pool = n => Array.from({ length: n }, (_, i) => 's' + i);

test('rejects fewer than 40 songs, with exact shortfall', () => { assert.throws(() => C.generateCards(pool(39), 1), /add 1 more/); });
test('accepts 40, 75 and 100 songs', () => { [40, 75, 100].forEach(n => assert.strictEqual(C.generateCards(pool(n), 5).length, 5)); });
test('999 cards: 25 unique songs each, unique layouts, numbered 1..999', () => {
  const cards = C.generateCards(pool(75), 999);
  assert.strictEqual(cards.length, 999);
  assert.deepStrictEqual(C.validateCards(cards, pool(75)), []);
  assert.deepStrictEqual(cards.map(c => c.no), Array.from({ length: 999 }, (_, i) => i + 1));
  cards.forEach(c => { assert.strictEqual(c.cells.length, 25); assert.strictEqual(new Set(c.cells).size, 25); });
});
test('fair distribution: song usage spread is tight', () => {
  const cards = C.generateCards(pool(50), 200);
  const use = {}; cards.forEach(c => c.cells.forEach(id => { use[id] = (use[id] || 0) + 1; }));
  const v = Object.values(use); assert.strictEqual(v.length, 50);
  assert.ok(Math.max(...v) - Math.min(...v) <= 2, 'spread ' + (Math.max(...v) - Math.min(...v)));
});
test('additional batch continues numbering and never alters existing cards', () => {
  const first = C.generateCards(pool(45), 20);
  const snapshot = JSON.stringify(first);
  const more = C.generateCards(pool(45), 10, first);
  assert.deepStrictEqual(more.map(c => c.no), Array.from({ length: 10 }, (_, i) => 21 + i));
  assert.strictEqual(JSON.stringify(first), snapshot);
  assert.strictEqual(more[0].batch, 2);
  assert.deepStrictEqual(C.validateCards(first.concat(more), pool(45)), []);
});
test('cannot exceed 999 numbers', () => { const c = C.generateCards(pool(45), 999); assert.throws(() => C.generateCards(pool(45), 1, c), /Only 0/); });
test('QR payload round-trips and rejects junk', () => {
  assert.deepStrictEqual(C.parseQrPayload(C.qrPayload('GABC123', 457)), { gameId: 'GABC123', cardNo: 457 });
  assert.strictEqual(C.parseQrPayload('https://example.com'), null);
});
test('parseRange', () => { assert.deepStrictEqual(C.parseRange('3-1, 7, 9-10'), [1, 2, 3, 7, 9, 10]); assert.throws(() => C.parseRange('a-b')); });
test('formatCardNo', () => { assert.strictEqual(C.formatCardNo(7), '007'); });
