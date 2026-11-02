'use strict';
/* Upgrade 3 — loudness measurement & levelling maths */
const test = require('node:test');
const assert = require('node:assert');
const { LoudnessMeter, integrated, truePeak, gainFor } = require('../../src/main/loudness');

function tone({ seconds = 5, freq = 1000, amp = 0.1, rate = 48000, pattern }) {
  const n = seconds * rate; const f = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const a = pattern ? pattern(i / rate) : amp; const v = a * Math.sin(2 * Math.PI * freq * i / rate); f[2 * i] = v; f[2 * i + 1] = v; }
  return f;
}
const measure = (f) => { const m = new LoudnessMeter(2); for (let i = 0; i < f.length; i += 9600) m.push(f.subarray(i, i + 9600)); return m.finish(); };
const audio = { targetLufs: -16, ceilingDbtp: -1, maxBoostDb: 9 };

test('1 kHz stereo sine at -20 dBFS ≈ -20 LUFS (BS.1770 reference behaviour)', () => {
  // A full-scale 1 kHz sine in both channels reads ≈ +0 LUFS minus 3 dB RMS per channel +3 dB for two channels → ≈ -0.0 at amp 1; -20 dBFS peak → ≈ -20 LUFS
  const p = measure(tone({ amp: Math.pow(10, -20 / 20) }));
  const L = integrated(p);
  assert.ok(Math.abs(L - (-20)) < 0.6, 'measured ' + L);
});
test('true peak of a sine matches its amplitude', () => {
  const p = measure(tone({ amp: 0.5 }));
  assert.ok(Math.abs(truePeak(p) - (-6.02)) < 0.3, 'tp ' + truePeak(p));
});
test('quiet source is boosted but never more than max boost', () => {
  const p = measure(tone({ amp: 0.01 })); // ~ -40 LUFS
  const g = gainFor(p, { start: 0, end: 5 }, audio);
  assert.strictEqual(g.gainDb, 9); assert.strictEqual(g.limited, 'max-boost');
});
test('loud source is turned down to target', () => {
  const p = measure(tone({ amp: 0.9 })); // ~ -1 LUFS
  const g = gainFor(p, { start: 0, end: 5 }, audio);
  assert.ok(g.gainDb < -13 && g.gainDb > -17, 'gain ' + g.gainDb);
});
test('boost is limited so the true peak never exceeds -1 dBTP (no clipping)', () => {
  // quiet average with one sudden loud peak
  const p = measure(tone({ seconds: 6, pattern: t => (t > 3 && t < 3.05 ? 0.9 : 0.03) }));
  const g = gainFor(p, { start: 0, end: 6 }, audio);
  assert.ok(g.gainDb + truePeak(p, 0, 6) <= -1 + 0.05, `gain ${g.gainDb} tp ${truePeak(p, 0, 6)}`);
  assert.strictEqual(g.limited, 'true-peak');
});
test('clip-specific loudness: a quiet intro and loud chorus give different gains', () => {
  const p = measure(tone({ seconds: 10, pattern: t => (t < 5 ? 0.02 : 0.5) }));
  const intro = gainFor(p, { start: 0, end: 5 }, audio).gainDb;
  const chorus = gainFor(p, { start: 5, end: 10 }, audio).gainDb;
  assert.ok(intro > chorus + 5, `intro ${intro} chorus ${chorus}`);
});
test('silence is not amplified', () => {
  const p = measure(new Float32Array(48000 * 4));
  assert.strictEqual(gainFor(p, { start: 0, end: 4 }, audio).gainDb, 0);
});
test('missing analysis → neutral gain', () => { assert.strictEqual(gainFor(null, {}, audio).gainDb, 0); });
