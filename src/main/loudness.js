'use strict';
/**
 * ITU-R BS.1770-4 / EBU R128 loudness meter (integrated LUFS) + 4x-oversampled
 * true-peak, computed incrementally from 48 kHz float PCM.
 *
 * It keeps a compact PROFILE (energy of every 100 ms sub-block + true peak of
 * every second) so the loudness of ANY clip segment can be computed later
 * without decoding the file again.
 */
const RATE = 48000;
const SUB = RATE / 10; // 100 ms

// K-weighting coefficients for 48 kHz (BS.1770-4)
const K1 = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] };
const K2 = { b: [1.0, -2.0, 1.0], a: [-1.99004745483398, 0.99007225036621] };

// 4x oversampling interpolation filter (windowed sinc, 12 taps per phase)
const TAPS = 12, PHASES = 4;
const FIR = (() => {
  const n = TAPS * PHASES; const h = new Float64Array(n); const c = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const x = (i - c) / PHASES;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (n - 1)); // Blackman
    h[i] = sinc * w;
  }
  const phases = [];
  for (let p = 0; p < PHASES; p++) { const ph = new Float64Array(TAPS); for (let t = 0; t < TAPS; t++) ph[t] = h[t * PHASES + p]; phases.push(ph); }
  // normalise each phase to unity DC gain
  phases.forEach(ph => { const s = ph.reduce((a, b) => a + b, 0); for (let t = 0; t < TAPS; t++) ph[t] /= s; });
  return phases;
})();

class LoudnessMeter {
  constructor(channels = 2) {
    this.ch = channels;
    this.z1 = Array.from({ length: channels }, () => [0, 0, 0, 0]);
    this.z2 = Array.from({ length: channels }, () => [0, 0, 0, 0]);
    this.hist = Array.from({ length: channels }, () => new Float64Array(TAPS));
    this.hpos = 0;
    this.subEnergy = [];  // mean-square (channel-summed) per 100 ms
    this.secPeak = [];    // linear true-peak per second
    this.acc = 0; this.accN = 0;
    this.peak = 0; this.peakN = 0;
    this.samplePeak = 0;
    this.frames = 0;
  }

  /** Feed interleaved float32 samples. */
  push(f32) {
    const ch = this.ch; const n = Math.floor(f32.length / ch);
    for (let i = 0; i < n; i++) {
      let e = 0;
      for (let c = 0; c < ch; c++) {
        const x = f32[i * ch + c];
        // K-weighting, two biquads (direct form I)
        const s1 = this.z1[c];
        const y1 = K1.b[0] * x + K1.b[1] * s1[0] + K1.b[2] * s1[1] - K1.a[0] * s1[2] - K1.a[1] * s1[3];
        s1[1] = s1[0]; s1[0] = x; s1[3] = s1[2]; s1[2] = y1;
        const s2 = this.z2[c];
        const y2 = K2.b[0] * y1 + K2.b[1] * s2[0] + K2.b[2] * s2[1] - K2.a[0] * s2[2] - K2.a[1] * s2[3];
        s2[1] = s2[0]; s2[0] = y1; s2[3] = s2[2]; s2[2] = y2;
        e += y2 * y2;
        // true peak (4x oversampled)
        const h = this.hist[c]; h[this.hpos] = x;
        const ax = x < 0 ? -x : x; if (ax > this.samplePeak) this.samplePeak = ax;
        for (let p = 0; p < PHASES; p++) {
          const ph = FIR[p]; let v = 0;
          for (let t = 0; t < TAPS; t++) v += ph[t] * h[(this.hpos - t + TAPS) % TAPS];
          const av = v < 0 ? -v : v; if (av > this.peak) this.peak = av;
        }
      }
      this.hpos = (this.hpos + 1) % TAPS;
      this.acc += e; this.accN++;
      if (this.accN === SUB) { this.subEnergy.push(this.acc / SUB); this.acc = 0; this.accN = 0; }
      this.peakN++;
      if (this.peakN === RATE) { this.secPeak.push(this.peak); this.peak = 0; this.peakN = 0; }
      this.frames++;
    }
  }

  finish() {
    if (this.accN > SUB / 2) this.subEnergy.push(this.acc / this.accN);
    if (this.peakN > 0) this.secPeak.push(this.peak);
    return {
      duration: this.frames / RATE,
      sub: this.subEnergy.map(v => (v > 0 ? Math.round(10 * Math.log10(v) * 100) / 100 : -200)), // dB, 0.01 precision
      peak: this.secPeak.map(v => (v > 0 ? Math.round(20 * Math.log10(v) * 100) / 100 : -200))
    };
  }
}

/** Integrated loudness (LUFS) of a profile segment [start,end] seconds with BS.1770 gating. */
function integrated(profile, start = 0, end = Infinity) {
  const sub = profile.sub; // dB energies per 100 ms
  const a = Math.max(0, Math.floor(start * 10)); const b = Math.min(sub.length, Math.ceil(Math.min(end, profile.duration || Infinity) * 10));
  const blocks = [];
  for (let i = a; i + 4 <= b; i++) { // 400 ms blocks, 100 ms hop
    let s = 0; for (let k = 0; k < 4; k++) s += Math.pow(10, sub[i + k] / 10);
    blocks.push(s / 4);
  }
  if (!blocks.length) return null;
  const L = e => -0.691 + 10 * Math.log10(e);
  const abs = blocks.filter(e => e > 0 && L(e) > -70);
  if (!abs.length) return -70;
  const meanAbs = abs.reduce((x, y) => x + y, 0) / abs.length;
  const relGate = L(meanAbs) - 10;
  const rel = abs.filter(e => L(e) > relGate);
  const m = rel.reduce((x, y) => x + y, 0) / rel.length;
  return Math.round(L(m) * 10) / 10;
}

function truePeak(profile, start = 0, end = Infinity) {
  const a = Math.max(0, Math.floor(start)); const b = Math.min(profile.peak.length, Math.ceil(Math.min(end, profile.duration || Infinity)));
  let m = -200; for (let i = a; i < b; i++) if (profile.peak[i] > m) m = profile.peak[i];
  return m;
}

/**
 * Gain (dB) to bring a clip to the target loudness without exceeding the
 * true-peak ceiling and without boosting quiet sources more than maxBoostDb.
 */
function gainFor(profile, clip, audio) {
  if (!profile) return { gainDb: 0, status: 'pending' };
  const start = clip && clip.start != null ? clip.start : 0;
  const end = clip && clip.end != null ? clip.end : Infinity;
  const L = integrated(profile, start, end);
  if (L == null || L <= -69) return { gainDb: 0, status: 'silent', lufs: L };
  const tp = truePeak(profile, start, end);
  let g = audio.targetLufs - L;
  let limited = null;
  if (g > audio.maxBoostDb) { g = audio.maxBoostDb; limited = 'max-boost'; }
  const headroom = audio.ceilingDbtp - tp;
  if (g > headroom) { g = headroom; limited = 'true-peak'; }
  g = Math.max(-30, Math.round(g * 10) / 10);
  return { gainDb: g, status: 'ok', lufs: L, truePeak: tp, limited };
}

/**
 * Where does the song really start? Many music videos open with silence, dialogue or a quiet
 * scene. Returns the time (s) where 400 ms of audio first reaches normal song level
 * (within 14 LU of the whole song) AND the three seconds from there stay musical (within 16 LU),
 * backed off by 0.5 s so the first beat is never clipped. 0 = nothing to skip.
 * Conservative: < 2 s is ignored, and anything over 45 s (or 40% of the song) is treated as
 * a detection doubt and not skipped.
 */
const INTRO = { relLU: 14, sustainLU: 16, minSkip: 2, maxSkip: 45, maxFrac: 0.4, backoff: 0.5 };
function introEnd(profile) {
  if (!profile || !profile.sub || !profile.sub.length) return 0;
  const L = integrated(profile, 0, Infinity);
  if (L == null || L <= -60) return 0;
  const e = profile.sub.map(db => Math.pow(10, db / 10));
  const win = (i, n) => { if (i + n > e.length) return -Infinity; let s = 0; for (let k = 0; k < n; k++) s += e[i + k]; return -0.691 + 10 * Math.log10(s / n || 1e-12); };
  const dur = profile.duration || e.length / 10;
  const limit = Math.min(INTRO.maxSkip, dur * INTRO.maxFrac) * 10;
  for (let i = 0; i + 40 <= e.length && i <= limit; i++) {
    if (win(i, 4) >= L - INTRO.relLU && win(i + 5, 25) >= L - INTRO.sustainLU) { // 400 ms onset, then the following 2.5 s stay musical (a click is not a start)
      const t = i / 10;
      if (t < INTRO.minSkip) return 0;
      return Math.max(0, Math.floor((t - INTRO.backoff) * 2) / 2);
    }
  }
  return 0; // never clearly started within the limit: don't guess
}

module.exports = { LoudnessMeter, integrated, truePeak, gainFor, introEnd, INTRO, RATE };
