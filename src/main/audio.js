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
const { gainFor } = require('./loudness');

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

  needs(s) {
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

  summary(prof, fp) { const src = prof.source || {}; return { status: 'done', fp, lufs: prof.lufs, truePeak: prof.truePeak, duration: Math.round(prof.duration * 10) / 10, sampleRate: src.sampleRate || null, channels: src.channels || null, layout: src.layout || null, analysedAt: prof.analysedAt }; }

  start(s) {
    s.audio = { status: 'analysing', fp: s.fingerprint };
    const workerFile = path.join(__dirname, 'audio-worker.js').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    const w = new Worker(workerFile, { workerData: { ffmpeg: this.ffmpeg, file: s.path, lowPriority: true } });
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
