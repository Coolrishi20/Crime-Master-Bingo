'use strict';
/**
 * Background audio-loudness analysis queue.
 * - Non-destructive: originals are only read; nothing is re-encoded.
 * - Cached by file fingerprint (data/analysis/<fp>.json) → never re-analysed while unchanged.
 * - Runs in worker threads with a concurrency limit; can be paused/resumed/cancelled.
 */
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { execFileSync } = require('child_process');
const { gainFor, introEnd } = require('./loudness');

/*
 * The analysis worker is started from CODE, not from a file on disk. Files inside the packaged
 * app (app.asar) can't be loaded by a worker thread, and the old "unpacked" copies next to the
 * app could be removed by antivirus software or Windows temp clean-up (the portable EXE runs
 * from %TEMP%) — which crashed the app at start-up (1.8.0, "ENOENT … loudness.js"). Reading the
 * two source files from inside the package always works.
 */
let WORKER_CODE = null;
function workerCode() {
  if (WORKER_CODE) return WORKER_CODE;
  const loud = fs.readFileSync(path.join(__dirname, 'loudness.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, 'audio-worker.js'), 'utf8').replace("require('./loudness')", '__loudness');
  WORKER_CODE = 'const __loudness = (function () { const module = { exports: {} }; const exports = module.exports;\n' + loud + '\n; return module.exports; })();\n' + worker;
  return WORKER_CODE;
}

function findFfmpeg(resourcesPath) {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [];
  if (process.env.CMB_FFMPEG) candidates.push(process.env.CMB_FFMPEG);
  if (resourcesPath) candidates.push(path.join(resourcesPath, 'ffmpeg', exe));
  candidates.push(path.join(__dirname, '..', '..', 'vendor', 'ffmpeg', `${process.platform}-${process.arch}`, exe));
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (e) { /* */ } }
  try { execFileSync(exe, ['-version'], { stdio: 'ignore', windowsHide: true, timeout: 5000 }); return exe; } catch (e) { return null; }
}

class AudioAnalyser {
  constructor({ dataDir, library, resourcesPath, onChange, concurrency = 1 }) {
    this.dir = path.join(dataDir, 'analysis');
    fs.mkdirSync(this.dir, { recursive: true });
    this.library = library;
    this.onChange = onChange || (() => {});
    this.concurrency = Math.max(1, Math.min(2, concurrency));
    this.ffmpeg = findFfmpeg(resourcesPath);
    this.running = new Map(); // songId -> worker
    this.paused = false;
    this.memo = new Map(); // fingerprint -> profile
    this.timer = setInterval(() => this.pump(), 1500);
  }

  status() {
    const songs = this.library.songs();
    const count = (st) => songs.filter(s => s.audio && s.audio.status === st).length;
    return { available: !!this.ffmpeg, ffmpeg: this.ffmpeg, paused: this.paused, running: this.running.size, pending: songs.filter(s => this.needs(s)).length, done: count('done'), errors: count('error'), noAudio: count('no-audio') };
  }

  cacheFile(fp) { return path.join(this.dir, String(fp).replace(/[^a-f0-9]/gi, '') + '.json'); }

  profileFor(fp) {
    if (!fp) return null;
    if (this.memo.has(fp)) return this.memo.get(fp);
    try { const p = JSON.parse(fs.readFileSync(this.cacheFile(fp), 'utf8')); this.memo.set(fp, p); return p; } catch (e) { return null; }
  }

  /** Levelling gain for a game song and clip (called synchronously at load time). */
  gain(song, clip, audio) {
    const prof = this.profileFor(song.fingerprint);
    if (!prof) { const lib = this.library.get(song.id); const st = lib && lib.audio ? lib.audio.status : 'pending'; return { gainDb: 0, status: st === 'done' ? 'pending' : st }; }
    return gainFor(prof, clip, audio);
  }

  /** Detected quiet intro (s) for a song, or null while it hasn't been analysed yet. */
  intro(song) {
    const lib = song && song.id ? this.library.get(song.id) : null;
    if (lib && lib.audio && lib.audio.status === 'done' && lib.audio.fp === song.fingerprint && lib.audio.introEnd != null) return lib.audio.introEnd;
    const prof = song && this.profileFor(song.fingerprint);
    if (!prof) return null;
    const t = introEnd(prof);
    if (lib && lib.audio && lib.audio.status === 'done' && lib.audio.introEnd == null) { lib.audio.introEnd = t; this.library.save(); } // songs analysed before 1.8
    return t;
  }

  needs(s) {
    if (s.source === 'youtube') return false; // nothing to decode: YouTube plays it
    if (['missing', 'unsupported', 'needs-conversion', 'converting'].includes(s.status) || !s.fingerprint) return false;
    const a = s.audio;
    if (!a) return true;
    if (a.fp !== s.fingerprint) return true;
    return a.status === 'pending' || a.status === 'queued';
  }

  setPaused(p) { this.paused = !!p; if (p) this.cancelAll(); this.onChange(); }
  /**
   * During a live game the TV video gets priority:
   *  - Low Resource Mode: analysis waits until the game is not live (hold);
   *  - normal mode: only the songs coming up next are analysed (focus), one at a time.
   * Running jobs are left to finish (no wasted work).
   */
  setScope(scope) { const k = JSON.stringify(scope || null); if (k === this._scopeKey) return; this._scopeKey = k; this.scope = scope || null; this.pump(); }
  cancelAll() { this.running.forEach((w, id) => { try { w.postMessage('cancel'); w.terminate(); } catch (e) { /* */ } const s = this.library.get(id); if (s && s.audio) s.audio.status = 'pending'; }); this.running.clear(); }
  reanalyse(ids) { ids.forEach(id => { const s = this.library.get(id); if (s) { if (s.audio && s.audio.fp) this.memo.delete(s.audio.fp); s.audio = { status: 'pending', fp: s.fingerprint }; } }); this.library.save(); this.onChange(); }

  pump() {
    if (this.paused || !this.ffmpeg) {
      if (!this.ffmpeg) { let changed = false; this.library.songs().forEach(s => { if (!s.audio || s.audio.status === 'pending') { s.audio = { status: 'unavailable', fp: s.fingerprint, error: 'Audio analysis tool (ffmpeg) not found — levelling disabled for this song.' }; changed = true; } }); if (changed) { this.library.save(); this.onChange(); } }
      return;
    }
    if (this.scope && this.scope.hold) return;
    const limit = this.scope && this.scope.focus ? 1 : this.concurrency;
    while (this.running.size < limit) {
      const focus = this.scope && this.scope.focus ? new Set(this.scope.focus) : null;
      const s = this.library.songs().find(x => this.needs(x) && !this.running.has(x.id) && (!focus || focus.has(x.id)));
      if (!s) return;
      // cache hit: same fingerprint already analysed (e.g. re-imported or relinked file)
      const cached = this.profileFor(s.fingerprint);
      if (cached) { s.audio = this.summary(cached, s.fingerprint); this.library.save(); this.onChange(); continue; }
      this.start(s);
    }
  }

  summary(prof, fp) { const src = prof.source || {}; return { status: 'done', fp, introEnd: introEnd(prof), lufs: prof.lufs, truePeak: prof.truePeak, duration: Math.round(prof.duration * 10) / 10, sampleRate: src.sampleRate || null, channels: src.channels || null, layout: src.layout || null, analysedAt: prof.analysedAt }; }

  start(s) {
    s.audio = { status: 'analysing', fp: s.fingerprint };
    let w;
    try { w = new Worker(workerCode(), { eval: true, workerData: { ffmpeg: this.ffmpeg, file: s.path, lowPriority: true } }); }
    catch (e) { s.audio = { status: 'error', fp: s.fingerprint, error: 'Analysis unavailable: ' + e.message }; this.library.save(); this.onChange(); return; }
    this.running.set(s.id, w);
    this.onChange();
    const done = (msg) => {
      if (!this.running.has(s.id)) return;
      this.running.delete(s.id);
      try { w.terminate(); } catch (e) { /* */ }
      if (msg && msg.ok) {
        const prof = Object.assign({ lufs: msg.lufs, truePeak: msg.truePeak, source: msg.source || null, analysedAt: new Date().toISOString(), fingerprint: s.fingerprint }, msg.profile);
        try { const f = this.cacheFile(s.fingerprint); fs.writeFileSync(f + '.tmp', JSON.stringify(prof)); fs.renameSync(f + '.tmp', f); } catch (e) { /* cache write failure is non-fatal */ }
        this.memo.set(s.fingerprint, prof);
        s.audio = this.summary(prof, s.fingerprint);
      } else {
        s.audio = { status: msg && msg.noAudio ? 'no-audio' : 'error', fp: s.fingerprint, error: (msg && msg.error) || 'Analysis failed' };
      }
      this.library.save();
      this.onChange();
    };
    w.on('message', done);
    w.on('error', (e) => done({ ok: false, error: e.message }));
    w.on('exit', () => done({ ok: false, error: 'Analysis stopped' }));
  }

  stop() { clearInterval(this.timer); this.cancelAll(); }
}

module.exports = { AudioAnalyser, findFfmpeg };
