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
function legacyCheck(cells, playedSet, round) {
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

/**
 * Best progress towards the round's pattern (for explaining invalid claims):
 * the qualifying pattern that needs the fewest more songs.
 * Returns { lines:[{type,index}], cells:[...pattern cells], missingCells:[...], missing, description }
 */
function legacyBest(cells, playedSet, round) {
  const a = analyseCard(cells, playedSet);
  const lineName = (t, i) => (t === 'row' ? 'Row ' : 'Column ') + (i + 1);
  const make = (lines, patternCells) => {
    const missingCells = patternCells.filter(k => !a.marked[k]);
    let description;
    if (round === 3) description = 'Full House';
    else if (lines.length === 1) description = lineName(lines[0].type, lines[0].index);
    else description = (lines[0].type === 'row' ? 'Rows ' : 'Columns ') + (lines[0].index + 1) + ' & ' + (lines[1].index + 1);
    return { lines, cells: patternCells, missingCells, missing: missingCells.length, description };
  };
  if (round === 3) return make([{ type: 'full' }], [...Array(25).keys()]);
  const cands = [];
  if (round === 1) {
    for (let i = 0; i < SIZE; i++) {
      cands.push(make([{ type: 'row', index: i }], rowCells(i)));
      cands.push(make([{ type: 'col', index: i }], colCells(i)));
    }
  } else {
    for (let i = 0; i < SIZE; i++) for (let j = i + 1; j < SIZE; j++) {
      cands.push(make([{ type: 'row', index: i }, { type: 'row', index: j }], rowCells(i).concat(rowCells(j))));
      cands.push(make([{ type: 'col', index: i }, { type: 'col', index: j }], colCells(i).concat(colCells(j))));
    }
  }
  // deterministic: fewest missing, then rows before columns, then lowest index
  cands.sort((x, y) => x.missing - y.missing);
  return cands[0];
}

function plural2(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

/**
 * Plain-English explanation for the host, e.g.
 * "Not a Bingo! Card #142 has completed one line but requires two parallel lines for Round 2."
 */
function legacyExplain(cardLabel, round, result, best) {
  const a = result.analysis; const def = ROUNDS[round];
  const card = 'Card #' + cardLabel;
  if (result.valid) return `${card} — ${result.headline}. Valid for Round ${round} (${def.label}).`;
  const closest = ''; // the closest pattern is shown separately (best.description / best.missing)
  const lines = a.rows.length + a.cols.length;
  if (round === 1) {
    if (a.diagonals.length) return `Not a Bingo! ${card} only has a diagonal line — diagonals don't count in Round 1.${closest}`;
    return `Not a Bingo! ${card} has no complete row or column yet.${closest}`;
  }
  if (round === 2) {
    if (a.rows.length === 1 && a.cols.length === 1) return `Not a Bingo! ${card} has one row and one column, but Round 2 needs two parallel lines (two rows or two columns).${closest}`;
    if (lines === 1) return `Not a Bingo! ${card} has completed one line but requires two parallel lines for Round 2.${closest}`;
    if (a.diagonals.length && !lines) return `Not a Bingo! ${card} only has a diagonal — diagonals don't count.${closest}`;
    return `Not a Bingo! ${card} has no complete lines yet — Round 2 needs two parallel lines.${closest}`;
  }
  return `Not a Bingo! ${card} has ${a.markedCount} of 25 songs — ${plural2(25 - a.markedCount, 'more song')} needed for a Full House.`;
}

/** Pattern diagram data for the audience panel: arrays of 25 booleans. */
function legacyExamples(round) {
  const grid = (cellsOn) => { const g = new Array(25).fill(false); cellsOn.forEach(i => { g[i] = true; }); return g; };
  if (round === 1) return [grid(rowCells(2)), grid(colCells(1)), grid(rowCells(0)), grid(colCells(3)), grid(rowCells(4))];
  if (round === 2) return [grid([...rowCells(0), ...rowCells(3)]), grid([...colCells(1), ...colCells(4)]), grid([...rowCells(1), ...rowCells(2)]), grid([...colCells(0), ...colCells(2)])];
  if (round === 3) return [grid([...Array(25).keys()])];
  return [grid([])];
}


/* =====================================================================
 * Custom rules (v1.5). A round has a RULE SET: one or more rules, any of
 * which wins. The three standard rounds keep the original code path above
 * (identical verdicts and wording); every other combination uses the
 * generic pattern engine below. Pure functions, shared by desktop + phone.
 * Rule spec: { id: 'line'|'twoLines'|'full'|'lShape'|'tShape'|'diagonal'|'fast5'|'custom',
 *              mode?: 'any'|'pattern' (fast5), cells?: [indices] (fast5 pattern / custom), name?: string }
 * ===================================================================== */
const DEFAULT_ROUND_RULES = { 1: [{ id: 'line' }], 2: [{ id: 'twoLines' }], 3: [{ id: 'full' }] };
const LEGACY_ID = { 1: 'line', 2: 'twoLines', 3: 'full' };
const FAST5_ANY_EXAMPLE = [1, 8, 12, 15, 23];

function dedupeCells(c) { return Array.from(new Set(c)).sort((x, y) => x - y); }
const L_SHAPES = [
  { desc: 'L shape — top row + left column', cells: dedupeCells([...rowCells(0), ...colCells(0)]) },
  { desc: 'L shape — top row + right column', cells: dedupeCells([...rowCells(0), ...colCells(4)]) },
  { desc: 'L shape — bottom row + left column', cells: dedupeCells([...rowCells(4), ...colCells(0)]) },
  { desc: 'L shape — bottom row + right column', cells: dedupeCells([...rowCells(4), ...colCells(4)]) }
];
const T_SHAPES = [
  { desc: 'T shape — top row + centre column', cells: dedupeCells([...rowCells(0), ...colCells(2)]) },
  { desc: 'T shape — bottom row + centre column', cells: dedupeCells([...rowCells(4), ...colCells(2)]) },
  { desc: 'T shape — left column + centre row', cells: dedupeCells([...colCells(0), ...rowCells(2)]) },
  { desc: 'T shape — right column + centre row', cells: dedupeCells([...colCells(4), ...rowCells(2)]) }
];
const DIAGONALS = [{ desc: 'Diagonal ↘ (top-left to bottom-right)', cells: DIAG_MAIN.slice() }, { desc: 'Diagonal ↙ (top-right to bottom-left)', cells: DIAG_ANTI.slice() }];

const RULE_DEFS = {
  line: { label: 'ONE LINE', short: 'Any full row or column', rule: 'Complete any one horizontal row or vertical column.' },
  twoLines: { label: 'TWO PARALLEL LINES', short: 'Two rows, or two columns', rule: 'Complete two different rows, or two different columns (a row plus a column does not count).' },
  full: { label: 'FULL HOUSE', short: 'All 25 songs', rule: 'Every one of the 25 songs on the card has been played.' },
  lShape: { label: 'L SHAPE', short: 'Outer row + outer column at a corner', rule: 'Complete an outer row and an outer column that meet at one corner (9 squares, any of the 4 corners).' },
  tShape: { label: 'T SHAPE', short: 'Outer row/column + centre stem', rule: 'Complete an outer row or column plus the centre line running from it to the opposite edge (9 squares, any of the 4 directions).' },
  diagonal: { label: 'DIAGONAL', short: 'Either corner-to-corner diagonal', rule: 'Complete either five-square diagonal.' },
  fast5: { label: 'FAST 5', short: 'Any 5 songs on the card', rule: 'Any five different songs on the card have been played.' },
  custom: { label: 'CUSTOM PATTERN', short: 'The pattern shown', rule: 'Complete every square of the pattern shown.' }
};
const RULE_IDS = Object.keys(RULE_DEFS);

/** Validate + normalise one rule spec (throws on nonsense). */
function normaliseRule(r) {
  if (typeof r === 'string') r = { id: r };
  if (!r || !RULE_DEFS[r.id]) throw new Error('Unknown winning rule: ' + (r && r.id));
  const out = { id: r.id };
  const cellsOk = (c) => Array.isArray(c) && c.every(i => Number.isInteger(i) && i >= 0 && i < 25);
  if (r.id === 'fast5') {
    out.mode = r.mode === 'pattern' ? 'pattern' : 'any';
    if (out.mode === 'pattern') {
      const c = dedupeCells(r.cells || []);
      if (!cellsOk(c) || c.length !== 5) throw new Error('A Fast 5 pattern needs exactly 5 different squares.');
      out.cells = c;
    }
  }
  if (r.id === 'custom') {
    const c = dedupeCells(r.cells || []);
    if (!cellsOk(c) || c.length < 2) throw new Error('A custom pattern needs at least 2 squares.');
    out.cells = c; out.name = String(r.name || 'Custom pattern').trim().slice(0, 24) || 'Custom pattern';
  }
  return out;
}
function normaliseRuleSet(list) {
  const arr = (Array.isArray(list) ? list : [list]).filter(Boolean).map(normaliseRule);
  if (!arr.length) throw new Error('Choose at least one winning pattern for the round.');
  const seen = new Set(); return arr.filter(r => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Accepts a round number (standard rules) or { round, rules }. */
function resolveRound(arg) {
  if (arg && typeof arg === 'object') return { round: Number(arg.round) || 0, rules: normaliseRuleSet(arg.rules) };
  const n = Number(arg); if (!DEFAULT_ROUND_RULES[n]) throw new Error('Round must be 1, 2 or 3');
  return { round: n, rules: DEFAULT_ROUND_RULES[n] };
}
function isLegacy(rr) { return rr.rules.length === 1 && LEGACY_ID[rr.round] === rr.rules[0].id; }

function ruleLabel(r) { return r.id === 'custom' ? r.name.toUpperCase() : r.id === 'fast5' && r.mode === 'pattern' ? 'FAST 5 (PATTERN)' : RULE_DEFS[r.id].label; }
function ruleShort(r) { return r.id === 'fast5' && r.mode === 'pattern' ? 'The 5 squares shown' : r.id === 'custom' ? `The ${r.cells.length} squares shown` : RULE_DEFS[r.id].short; }
function ruleText(r) { return r.id === 'fast5' && r.mode === 'pattern' ? 'Complete the five squares shown.' : r.id === 'custom' ? `Complete all ${r.cells.length} squares of the "${r.name}" pattern.` : RULE_DEFS[r.id].rule; }

/** Candidate winning patterns for a rule (count-rules return null). */
function candidates(r) {
  switch (r.id) {
    case 'line': { const c = []; for (let i = 0; i < SIZE; i++) { c.push({ desc: `Row ${i + 1}`, cells: rowCells(i), line: { type: 'row', index: i } }); c.push({ desc: `Column ${i + 1}`, cells: colCells(i), line: { type: 'col', index: i } }); } return c; }
    case 'twoLines': { const c = []; for (let i = 0; i < SIZE; i++) for (let j = i + 1; j < SIZE; j++) { c.push({ desc: `Rows ${i + 1} & ${j + 1}`, cells: rowCells(i).concat(rowCells(j)) }); c.push({ desc: `Columns ${i + 1} & ${j + 1}`, cells: colCells(i).concat(colCells(j)) }); } return c; }
    case 'full': return [{ desc: 'Full House', cells: [...Array(25).keys()] }];
    case 'lShape': return L_SHAPES;
    case 'tShape': return T_SHAPES;
    case 'diagonal': return DIAGONALS;
    case 'fast5': return r.mode === 'pattern' ? [{ desc: 'Fast 5 pattern', cells: r.cells }] : null;
    case 'custom': return [{ desc: r.name, cells: r.cells }];
  }
  return [];
}

/** Generic evaluation of a rule set. */
function evaluateRules(cells, playedSet, rr) {
  const a = analyseCard(cells, playedSet);
  const matched = []; const options = [];
  rr.rules.forEach(r => {
    const cands = candidates(r);
    if (!cands) { // Fast 5, any squares
      const markedCells = a.marked.map((m, i) => (m ? i : -1)).filter(i => i >= 0);
      if (a.markedCount >= 5) matched.push({ rule: r, desc: `Fast 5 (${a.markedCount} songs on the card)`, cells: markedCells });
      else options.push({ rule: r, desc: 'Fast 5 (any 5 squares)', cells: markedCells, missingCells: [], missing: 5 - a.markedCount });
      return;
    }
    cands.forEach(c => {
      const missingCells = c.cells.filter(k => !a.marked[k]);
      if (!missingCells.length) matched.push({ rule: r, desc: c.desc, cells: c.cells, line: c.line });
      else options.push({ rule: r, desc: c.desc, cells: c.cells, missingCells, missing: missingCells.length });
    });
  });
  options.sort((x, y) => x.missing - y.missing);
  return { analysis: a, matched, best: options[0] || null };
}

function infoFor(rr) {
  const labels = rr.rules.map(ruleLabel);
  const diagonalsCount = rr.rules.some(r => r.id === 'diagonal');
  return {
    round: rr.round, rules: rr.rules, legacy: isLegacy(rr), diagonalsCount,
    label: labels.join(' / '),
    short: rr.rules.map(ruleShort).join(' — or — '),
    rule: rr.rules.map(ruleText).join(' Or: ') + (diagonalsCount || rr.rules.every(r => ['full', 'fast5', 'custom'].includes(r.id)) ? '' : ' Diagonals do not count.')
  };
}

/** Public: check a card. `roundArg` = round number (standard rule) or { round, rules }. */
function checkCard(cells, playedSet, roundArg) {
  const rr = resolveRound(roundArg);
  if (isLegacy(rr)) return legacyCheck(cells, playedSet, rr.round);
  const info = infoFor(rr);
  const ev = evaluateRules(cells, playedSet, rr); const a = ev.analysis;
  const res = { valid: ev.matched.length > 0, round: rr.round, label: info.label, headline: '', reason: '', winningCells: [], lines: [], analysis: a };
  if (res.valid) {
    ev.matched.forEach(m => { res.winningCells.push(...m.cells); res.lines.push(m.line || { type: 'pattern', rule: m.rule.id, desc: m.desc }); });
    const names = Array.from(new Set(ev.matched.map(m => m.desc)));
    res.headline = names.length > 2 ? `${names.slice(0, 2).join(' + ')} + ${names.length - 2} more complete` : `${names.join(' + ')} complete`;
    res.reason = `${info.label} wins Round ${rr.round}.`;
  } else {
    const b = ev.best;
    res.headline = `No ${info.label.toLowerCase()} yet`;
    res.reason = b ? `The closest is ${b.desc}, which still needs ${plural(b.missing, 'song')}.` : 'No winning pattern is complete.';
    if (a.diagonals.length && !info.diagonalsCount) res.reason += ' Diagonals do not count this round.';
  }
  res.winningCells = Array.from(new Set(res.winningCells)).sort((x, y) => x - y);
  return res;
}

function bestProgress(cells, playedSet, roundArg) {
  const rr = resolveRound(roundArg);
  if (isLegacy(rr)) return legacyBest(cells, playedSet, rr.round);
  const b = evaluateRules(cells, playedSet, rr).best;
  if (!b) return { lines: [], cells: [], missingCells: [], missing: 0, description: 'Complete' };
  return { lines: [], cells: b.cells, missingCells: b.missingCells, missing: b.missing, description: b.desc };
}

function explainClaim(cardLabel, roundArg, result, best) {
  const rr = resolveRound(roundArg);
  if (isLegacy(rr)) return legacyExplain(cardLabel, rr.round, result, best);
  const info = infoFor(rr); const card = 'Card #' + cardLabel;
  if (result.valid) return `${card} — ${result.headline}. Valid for Round ${rr.round} (${info.label}).`;
  return `Not a Bingo! ${card} has no ${info.label.toLowerCase()} yet. ${result.reason}`;
}

/** Pattern diagrams (arrays of 25 booleans) for the TV, cards, host and phones. */
function patternExamples(roundArg) {
  const rr = resolveRound(roundArg);
  if (isLegacy(rr)) return legacyExamples(rr.round);
  const grid = (on) => { const g = new Array(25).fill(false); on.forEach(i => { g[i] = true; }); return g; };
  const out = [];
  rr.rules.forEach(r => { const c = candidates(r); if (!c) out.push(grid(FAST5_ANY_EXAMPLE)); else c.slice(0, r.id === 'line' ? 4 : r.id === 'twoLines' ? 2 : 4).forEach(x => out.push(grid(x.cells))); });
  return out.slice(0, 10);
}

/** Everything a screen needs to describe a round's rules. */
function roundInfo(roundArg) {
  const rr = resolveRound(roundArg);
  if (isLegacy(rr)) { const d = ROUNDS[rr.round]; return { round: rr.round, rules: rr.rules, legacy: true, diagonalsCount: false, label: d.label, short: d.short, rule: d.rule, examples: legacyExamples(rr.round) }; }
  return Object.assign(infoFor(rr), { examples: patternExamples(rr) });
}

/** Catalogue for rule pickers (Settings → Bingo Rules). */
function catalogue() {
  return RULE_IDS.filter(id => id !== 'custom').map(id => { const r = id === 'fast5' ? { id, mode: 'any' } : { id }; return { id, label: RULE_DEFS[id].label, short: RULE_DEFS[id].short, rule: RULE_DEFS[id].rule, examples: patternExamples({ round: 0, rules: [r] }) }; });
}

module.exports = { ROUNDS, SIZE, rowCells, colCells, analyseCard, checkCard, qualifiedAt, bestProgress, explainClaim, patternExamples, DEFAULT_ROUND_RULES, RULE_DEFS, RULE_IDS, normaliseRule, normaliseRuleSet, resolveRound, roundInfo, catalogue, candidates };
