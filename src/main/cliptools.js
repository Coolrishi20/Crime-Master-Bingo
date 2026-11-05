'use strict';
/**
 * Clip editor helpers (2.2). Both work on the loudness profile that volume levelling already
 * cached for the song (energy per 100 ms), so nothing new is decoded.
 *   envelope()      – a few hundred bars for the timeline
 *   loudSection()   – the loudest stretch of a given length: offered as a SUGGESTION only
 *                     (loud is not the same as recognisable; it does not claim to find a chorus)
 */
const { introEnd } = require('./loudness');

function envelope(prof, bars = 240) {
  const sub = (prof && prof.sub) || []; if (!sub.length) return null;
  const n = Math.max(1, Math.min(bars, sub.length)); const per = sub.length / n; const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * per), b = Math.max(a + 1, Math.floor((i + 1) * per)); let e = 0;
    for (let k = a; k < b; k++) e += Math.pow(10, sub[k] / 10);
    e /= (b - a); out.push(e > 0 ? Math.round(10 * Math.log10(e) * 10) / 10 : -120);
  }
  return { duration: prof.duration || sub.length / 10, bars: out, intro: introEnd(prof) };
}

/** Loudest `secs`-long window (after any quiet intro, not running into the last 2 s). */
function loudSection(prof, secs) {
  const sub = (prof && prof.sub) || []; const w = Math.round(secs * 10);
  if (!sub.length || w <= 0 || w > sub.length) return null;
  const e = sub.map(db => Math.pow(10, db / 10));
  let from = Math.max(0, Math.round(introEnd(prof) * 10)); if (from > sub.length - w) from = Math.max(0, sub.length - w);
  let last = sub.length - w - 20; if (last < from) last = Math.max(from, sub.length - w);
  let sum = 0; for (let i = from; i < from + w && i < e.length; i++) sum += e[i];
  let best = sum, at = from;
  for (let i = from + 1; i <= last; i++) { sum += e[i + w - 1] - e[i - 1]; if (sum > best) { best = sum; at = i; } }
  const start = Math.round(at / 5) / 2; // nearest 0.5 s
  return { start, end: Math.round((start + secs) * 2) / 2, lufsish: Math.round(10 * Math.log10(best / w) * 10) / 10 };
}

module.exports = { envelope, loudSection };
