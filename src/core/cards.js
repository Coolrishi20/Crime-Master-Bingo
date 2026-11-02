'use strict';
/**
 * Bingo card generation. Pure logic — persistence is handled by the caller.
 * Cards are permanent once generated: this module only ever ADDS new cards.
 */
const crypto = require('crypto');

const MAX_CARDS = 999;
const CARD_SIZE = 25;
const MIN_SONGS = 40;

function randInt(n) { return crypto.randomInt(n); }

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function layoutKey(cells) { return cells.join(','); }
function setKey(cells) { return cells.slice().sort().join(','); }

/**
 * Generate `count` new cards from `songIds`, continuing after any existing cards.
 * - Every card: 25 distinct songs, random positions.
 * - Fair distribution: songs used least so far are preferred (random tie-break),
 *   so across many cards every song appears a near-equal number of times.
 * - No two cards (existing or new) share the same layout, or even the same set of 25 songs.
 * Returns the array of new card objects: { no, cells, batch, createdAt, printed:false }
 */
function generateCards(songIds, count, existingCards = [], opts = {}) {
  const pool = Array.from(new Set(songIds));
  if (pool.length < MIN_SONGS) throw new Error(`At least ${MIN_SONGS} unique songs are required (have ${pool.length}; add ${MIN_SONGS - pool.length} more).`);
  if (!Number.isInteger(count) || count < 1) throw new Error('Card quantity must be at least 1.');
  const usedNumbers = new Set(existingCards.map(c => c.no));
  const free = [];
  for (let n = 1; n <= MAX_CARDS; n++) if (!usedNumbers.has(n)) free.push(n);
  if (count > free.length) throw new Error(`Only ${free.length} card numbers remain unused in this game (maximum ${MAX_CARDS}).`);

  const usage = new Map(pool.map(id => [id, 0]));
  existingCards.forEach(c => c.cells.forEach(id => { if (usage.has(id)) usage.set(id, usage.get(id) + 1); }));
  const layouts = new Set(existingCards.map(c => layoutKey(c.cells)));
  const sets = new Set(existingCards.map(c => setKey(c.cells)));
  const batch = opts.batch || (Math.max(0, ...existingCards.map(c => c.batch || 0)) + 1);
  const now = new Date().toISOString();
  const out = [];

  for (let k = 0; k < count; k++) {
    let cells = null;
    for (let attempt = 0; attempt < 200; attempt++) {
      // Sort by usage then random tie-break; take 25 least-used. Add a little
      // randomness on later attempts so a duplicate set can't recur forever.
      const jitter = attempt > 0 ? 1 + Math.floor(attempt / 10) : 0;
      const ranked = shuffle(pool).map(id => ({ id, w: usage.get(id) + (jitter ? randInt(jitter + 1) : 0) }))
        .sort((x, y) => x.w - y.w);
      const chosen = ranked.slice(0, CARD_SIZE).map(x => x.id);
      const candidate = shuffle(chosen);
      if (layouts.has(layoutKey(candidate)) || sets.has(setKey(candidate))) continue;
      cells = candidate; break;
    }
    if (!cells) throw new Error('Could not generate a unique card — add more songs to the playlist.');
    cells.forEach(id => usage.set(id, usage.get(id) + 1));
    layouts.add(layoutKey(cells)); sets.add(setKey(cells));
    out.push({ no: free[k], cells, batch, createdAt: now, printed: false, printedAt: null });
  }
  return out;
}

/** Validate a set of cards — used by tests and pre-flight. */
function validateCards(cards, songIds) {
  const problems = [];
  const pool = new Set(songIds);
  const nums = new Set(); const layouts = new Set();
  for (const c of cards) {
    if (!Number.isInteger(c.no) || c.no < 1 || c.no > MAX_CARDS) problems.push(`Card ${c.no}: invalid number`);
    if (nums.has(c.no)) problems.push(`Card ${c.no}: duplicate number`);
    nums.add(c.no);
    if (!Array.isArray(c.cells) || c.cells.length !== CARD_SIZE) problems.push(`Card ${c.no}: does not have 25 squares`);
    else {
      if (new Set(c.cells).size !== CARD_SIZE) problems.push(`Card ${c.no}: repeats a song`);
      if (c.cells.some(id => !pool.has(id))) problems.push(`Card ${c.no}: contains a song not in this game`);
      const k = layoutKey(c.cells);
      if (layouts.has(k)) problems.push(`Card ${c.no}: identical to another card`);
      layouts.add(k);
    }
  }
  return problems;
}

function formatCardNo(n) { return String(n).padStart(3, '0'); }

/** QR payload — identifies both game and card. */
function qrPayload(gameId, cardNo) { return `CMB1|${gameId}|${cardNo}`; }
function parseQrPayload(text) {
  const m = /^CMB1\|([A-Za-z0-9_-]+)\|(\d{1,3})$/.exec(String(text || '').trim());
  if (!m) return null;
  return { gameId: m[1], cardNo: parseInt(m[2], 10) };
}

/** Parse a card selection such as "1-50, 75, 101-120" into sorted numbers. */
function parseRange(spec, max = MAX_CARDS) {
  const out = new Set();
  String(spec || '').split(/[,\s]+/).filter(Boolean).forEach(part => {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) throw new Error(`Invalid range "${part}"`);
    let a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
    if (a > b) [a, b] = [b, a];
    for (let n = Math.max(1, a); n <= Math.min(max, b); n++) out.add(n);
  });
  return Array.from(out).sort((x, y) => x - y);
}

module.exports = { MAX_CARDS, CARD_SIZE, MIN_SONGS, shuffle, generateCards, validateCards, formatCardNo, qrPayload, parseQrPayload, parseRange };
