'use strict';
/**
 * Pacing estimate (2.3): how many songs, and roughly how many minutes, until each round or
 * rule is likely to be won with THIS playlist and THIS many cards.
 * It plays thousands of random song orders against simulated cards (generated exactly like
 * real ones, then thrown away). It is an ESTIMATE: it never looks at, changes or predicts the
 * real shuffle of a game, and never decides winners.
 */
const rules = require('./rules');
const { generateCards } = require('./cards');

function shuffleInPlace(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function mulberry(seed) { let t = seed >>> 0; return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }

/** Song number (1-based) at which a card first satisfies one rule, given song positions. */
function cardQualifies(cardPos, rule) {
  const c = rules.candidates(rule);
  if (!c) { const s = cardPos.slice().sort((x, y) => x - y); return s[4] + 1; } // Fast 5 (any 5)
  let best = Infinity;
  for (const cand of c) { let m = -1; for (const k of cand.cells) { const p = cardPos[k]; if (p > m) m = p; } if (m < best) best = m; }
  return best + 1;
}
const ruleSetAt = (cardPos, rs) => Math.min(...rs.map(r => cardQualifies(cardPos, r)));

/**
 * opts: { songIds, cardCount, mode: 'rounds'|'checklist', rounds: { n: [rule…] }, roundCount,
 *         checklist: [{ id, rule }], trials, secsPerSong, seed }
 * Returns per round/rule the 10th, 50th and 90th percentile song numbers and minutes.
 */
function simulate(opts) {
  const songIds = Array.from(new Set(opts.songIds || []));
  const n = songIds.length;
  const cardsN = Math.max(1, Math.min(999, Number(opts.cardCount) || 1));
  const trials = Math.max(50, Math.min(5000, Number(opts.trials) || 1000));
  const rnd = mulberry(opts.seed != null ? opts.seed : 12345);
  const secs = Math.max(5, Number(opts.secsPerSong) || 35);
  const cards = generateCards(songIds, cardsN, []).map(c => c.cells);
  const idx = new Map(songIds.map((id, i) => [id, i]));
  const cardIdx = cards.map(cells => cells.map(id => idx.get(id)));
  const items = opts.mode === 'checklist'
    ? (opts.checklist || []).map(it => ({ key: it.id, label: rules.ruleLabel ? rules.ruleLabel(it.rule) : (rules.RULE_DEFS[it.rule.id] || {}).label || it.rule.id, rules: [rules.normaliseRule ? rules.normaliseRule(it.rule) : it.rule] }))
    : Array.from({ length: Math.max(1, Number(opts.roundCount) || 3) }, (_, i) => { const rs = rules.normaliseRuleSet((opts.rounds || {})[i + 1] || rules.DEFAULT_ROUND_RULES[i + 1] || [{ id: 'full' }]); return { key: 'r' + (i + 1), label: 'Round ' + (i + 1) + ' · ' + rs.map(r => (rules.RULE_DEFS[r.id] || {}).label || r.id).join(' / '), rules: rs }; });
  const results = items.map(() => []);
  const order = songIds.map((_, i) => i); const pos = new Int32Array(n);
  for (let t = 0; t < trials; t++) {
    shuffleInPlace(order, rnd); for (let i = 0; i < n; i++) pos[order[i]] = i;
    const perCard = cardIdx.map(ci => ci.map(k => pos[k]));
    if (opts.mode === 'checklist') {
      items.forEach((it, j) => { let best = Infinity; for (const cp of perCard) { const q = ruleSetAt(cp, it.rules); if (q < best) best = q; } results[j].push(best); });
    } else {
      let after = 0; // songs stay marked; the next round starts after the previous one is won
      items.forEach((it, j) => { let best = Infinity; for (const cp of perCard) { const q = ruleSetAt(cp, it.rules); if (q < best) best = q; } const at = Math.max(best, after + 1); results[j].push(at); after = at; });
    }
  }
  const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const out = items.map((it, j) => {
    const a = results[j]; const p10 = pct(a, 0.1), p50 = pct(a, 0.5), p90 = pct(a, 0.9);
    const over = a.filter(x => x > n).length / a.length;
    return { key: it.key, label: it.label, songs: { p10: Math.min(p10, n), p50: Math.min(p50, n), p90: Math.min(p90, n) }, minutes: { p10: Math.round(p10 * secs / 60), p50: Math.round(p50 * secs / 60), p90: Math.round(Math.min(p90, n) * secs / 60) }, mayNotFinish: over > 0.1, finishChance: Math.round((1 - over) * 100) };
  });
  return { trials, cards: cardsN, songs: n, secsPerSong: secs, items: out };
}

/** How many winners (rounds / rules) are likely within a break of the given minutes. */
function inBreak(sim, minutes) {
  const songs = Math.floor(minutes * 60 / sim.secsPerSong);
  return { songs, likely: sim.items.filter(i => i.songs.p50 <= songs).map(i => i.label), possible: sim.items.filter(i => i.songs.p10 <= songs && i.songs.p50 > songs).map(i => i.label) };
}

module.exports = { simulate, inBreak, cardQualifies };
