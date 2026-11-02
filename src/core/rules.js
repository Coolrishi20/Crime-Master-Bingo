'use strict';
/**
 * Crime Master Bingo — authoritative winning-rule engine.
 * Pure functions: no Electron, no I/O. Shared by the desktop host, the
 * mobile remote (via the laptop) and the automated tests.
 *
 * A card is an array of 25 song IDs in row-major order (index = row*5 + col).
 */

const SIZE = 5;

const ROUNDS = {
  1: { number: 1, key: 'one-line', label: 'ONE LINE', short: 'Any one full row or column', rule: 'Complete any one horizontal row or vertical column. Diagonals do not count.' },
  2: { number: 2, key: 'two-lines', label: 'TWO PARALLEL LINES', short: 'Two rows, or two columns', rule: 'Complete two different horizontal rows, or two different vertical columns. A row plus a column does not count. Diagonals do not count.' },
  3: { number: 3, key: 'full-house', label: 'FULL HOUSE', short: 'All 25 songs', rule: 'Every one of the 25 songs on the card has been played.' }
};

function rowCells(r) { return [0, 1, 2, 3, 4].map(c => r * SIZE + c); }
function colCells(c) { return [0, 1, 2, 3, 4].map(r => r * SIZE + c); }
const DIAG_MAIN = [0, 6, 12, 18, 24];
const DIAG_ANTI = [4, 8, 12, 16, 20];

/** Analyse which squares/lines of a card are complete. */
function analyseCard(cells, playedSet) {
  if (!Array.isArray(cells) || cells.length !== 25) throw new Error('A card must contain exactly 25 squares');
  const has = playedSet instanceof Set ? (id) => playedSet.has(id) : (id) => !!playedSet[id];
  const marked = cells.map(id => has(id));
  const rows = [], cols = [];
  for (let i = 0; i < SIZE; i++) {
    if (rowCells(i).every(k => marked[k])) rows.push(i);
    if (colCells(i).every(k => marked[k])) cols.push(i);
  }
  const diagonals = [];
  if (DIAG_MAIN.every(k => marked[k])) diagonals.push('main');
  if (DIAG_ANTI.every(k => marked[k])) diagonals.push('anti');
  const markedCount = marked.filter(Boolean).length;
  // How many more songs each line needs (for "closest" hints)
  const rowNeeds = [0, 1, 2, 3, 4].map(r => rowCells(r).filter(k => !marked[k]).length);
  const colNeeds = [0, 1, 2, 3, 4].map(c => colCells(c).filter(k => !marked[k]).length);
  return { marked, rows, cols, diagonals, markedCount, rowNeeds, colNeeds };
}

function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
function listNums(arr) { return arr.map(i => i + 1).join(' & '); }

/**
 * Check a card against the played history for a round.
 * Returns { valid, round, label, headline, reason, winningCells, lines, analysis }
 */
function checkCard(cells, playedSet, round) {
  const def = ROUNDS[round];
  if (!def) throw new Error('Round must be 1, 2 or 3');
  const a = analyseCard(cells, playedSet);
  const res = { valid: false, round, label: def.label, headline: '', reason: '', winningCells: [], lines: [], analysis: a };

  const diagNote = a.diagonals.length ? ' Diagonals do not count.' : '';

  if (round === 1) {
    if (a.rows.length || a.cols.length) {
      res.valid = true;
      a.rows.forEach(r => { res.lines.push({ type: 'row', index: r }); res.winningCells.push(...rowCells(r)); });
      a.cols.forEach(c => { res.lines.push({ type: 'col', index: c }); res.winningCells.push(...colCells(c)); });
      const parts = [];
      if (a.rows.length) parts.push(`Row ${listNums(a.rows)}`);
      if (a.cols.length) parts.push(`Column ${listNums(a.cols)}`);
      res.headline = `${parts.join(' + ')} complete`;
      res.reason = 'A complete horizontal or vertical line wins Round 1.';
    } else if (a.diagonals.length) {
      res.headline = 'Only a diagonal is complete';
      res.reason = 'Diagonals do not count. A full horizontal row or vertical column is needed.';
    } else {
      const best = Math.min(...a.rowNeeds, ...a.colNeeds);
      res.headline = 'No complete line';
      res.reason = `No row or column is complete. The closest line still needs ${plural(best, 'song')}.`;
    }
  } else if (round === 2) {
    if (a.rows.length >= 2 || a.cols.length >= 2) {
      res.valid = true;
      const parts = [];
      if (a.rows.length >= 2) {
        a.rows.forEach(r => { res.lines.push({ type: 'row', index: r }); res.winningCells.push(...rowCells(r)); });
        parts.push(`Rows ${listNums(a.rows)}`);
      }
      if (a.cols.length >= 2) {
        a.cols.forEach(c => { res.lines.push({ type: 'col', index: c }); res.winningCells.push(...colCells(c)); });
        parts.push(`Columns ${listNums(a.cols)}`);
      }
      res.headline = `${parts.join(' + ')} complete`;
      res.reason = 'Two parallel lines win Round 2.';
    } else if (a.rows.length === 1 && a.cols.length === 1) {
      res.headline = `Row ${a.rows[0] + 1} + Column ${a.cols[0] + 1} only`;
      res.reason = 'One row plus one column is not enough — the two lines must be parallel (two rows, or two columns).' + diagNote;
    } else if (a.rows.length + a.cols.length === 1) {
      const one = a.rows.length ? `Row ${a.rows[0] + 1}` : `Column ${a.cols[0] + 1}`;
      res.headline = `Only one line complete (${one})`;
      res.reason = 'Round 2 needs two complete rows or two complete columns.' + diagNote;
    } else if (a.diagonals.length) {
      res.headline = 'Only a diagonal is complete';
      res.reason = 'Diagonals do not count. Two complete rows or two complete columns are needed.';
    } else {
      res.headline = 'No complete lines';
      res.reason = 'Round 2 needs two complete rows or two complete columns.';
    }
  } else {
    if (a.markedCount === 25) {
      res.valid = true;
      res.winningCells = cells.map((_, i) => i);
      res.lines.push({ type: 'full' });
      res.headline = 'Full House — all 25 songs played';
      res.reason = 'Every song on the card has been played.';
    } else {
      res.headline = `${a.markedCount} of 25 songs played`;
      res.reason = `Not a Full House — ${plural(25 - a.markedCount, 'song')} on this card ${25 - a.markedCount === 1 ? 'has' : 'have'} not been played yet.`;
    }
  }
  res.winningCells = Array.from(new Set(res.winningCells)).sort((x, y) => x - y);
  return res;
}

/**
 * Earliest position in the played history (1-based song count) at which this
 * card first satisfied the round's rule, or null if it never has.
 */
function qualifiedAt(cells, playedIds, round) {
  const onCard = new Set(cells);
  const set = new Set();
  for (let i = 0; i < playedIds.length; i++) {
    set.add(playedIds[i]);
    if (!onCard.has(playedIds[i])) continue;
    if (checkCard(cells, set, round).valid) return i + 1;
  }
  return null;
}

/** Pattern diagram data for the audience panel: arrays of 25 booleans. */
function patternExamples(round) {
  const grid = (cellsOn) => { const g = new Array(25).fill(false); cellsOn.forEach(i => { g[i] = true; }); return g; };
  if (round === 1) return [grid(rowCells(2)), grid(colCells(1)), grid(rowCells(0)), grid(colCells(3)), grid(rowCells(4))];
  if (round === 2) return [grid([...rowCells(0), ...rowCells(3)]), grid([...colCells(1), ...colCells(4)]), grid([...rowCells(1), ...rowCells(2)]), grid([...colCells(0), ...colCells(2)])];
  if (round === 3) return [grid([...Array(25).keys()])];
  return [grid([])];
}

module.exports = { ROUNDS, SIZE, rowCells, colCells, analyseCard, checkCard, qualifiedAt, patternExamples };
