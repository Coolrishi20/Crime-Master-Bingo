'use strict';
/**
 * Built-in video converter. Videos the player can't handle (AVI, WMV, FLV, MPG…, or
 * MP4/MKV files with unsupported codecs) are converted in the background to an
 * H.264/AAC MP4 COPY in the app's data folder. Originals are never modified.
 * One conversion at a time, low priority; progress and failures are reported.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

function buildArgs(src, out) {
  return ['-hide_banner', '-nostdin', '-y', '-i', src,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    '-movflags', '+faststart', '-f', 'mp4', '-progress', 'pipe:1', '-nostats', out];
}

function probeDuration(ffmpeg, file) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-i', file], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr || '');
  const hasVideo = /Stream #\d+:\d+[^:]*: Video:/.test(r.stderr || '');
  return { duration: m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0, hasVideo, readable: !/Invalid data found|No such file/i.test(r.stderr || '') };
}

class Converter {
  constructor({ dataDir, library, ffmpeg, onChange, isAuto }) {
    this.dir = path.join(dataDir, 'converted');
    fs.mkdirSync(this.dir, { recursive: true });
    this.library = library; this.ffmpeg = ffmpeg; this.onChange = onChange || (() => {});
    this.isAuto = isAuto || (() => true);
    this.current = null; // { songId, proc, percent }
    this.timer = setInterval(() => this.pump(), 2000);
  }

  wants(s) {
    if (s.status === 'needs-conversion') return true;
    if (s.status === 'unsupported' && this.isAuto() && !(s.conversion && ['failed', 'done'].includes(s.conversion.state))) return true;
    return false;
  }

  status() {
    const songs = this.library.songs();
    return { available: !!this.ffmpeg, running: this.current ? { songId: this.current.songId, percent: this.current.percent } : null, queued: songs.filter(s => this.wants(s)).length, failed: songs.filter(s => s.conversion && s.conversion.state === 'failed').length, converted: songs.filter(s => s.converted).length };
  }

  /** Host asks to convert (or retry) specific songs. */
  request(ids) {
    ids.forEach(id => { const s = this.library.get(id); if (s && ['unsupported', 'needs-conversion'].includes(s.status)) { s.status = 'needs-conversion'; s.conversion = null; s.statusNote = 'Queued for conversion to MP4'; } });
    this.library.save(); this.onChange(); this.pump();
  }

  cancel(id) {
    if (this.current && this.current.songId === id) { this.current.cancelled = true; try { this.current.proc.kill(); } catch (e) { /* */ } }
    const s = this.library.get(id);
    if (s && s.status === 'needs-conversion') { s.status = 'unsupported'; s.statusNote = 'Conversion cancelled — click Convert to try again'; s.conversion = { state: 'failed', error: 'Cancelled' }; this.library.save(); this.onChange(); }
  }

  pump() {
    if (this.current || !this.ffmpeg) {
      if (!this.ffmpeg) {
        let changed = false;
        this.library.songs().forEach(s => { if (s.status === 'needs-conversion') { s.status = 'unsupported'; s.statusNote = 'Needs converting to MP4, but the converter (ffmpeg) is missing.'; s.conversion = { state: 'failed', error: 'ffmpeg not found' }; changed = true; } });
        if (changed) { this.library.save(); this.onChange(); }
      }
      return;
    }
    const s = this.library.songs().find(x => this.wants(x));
    if (!s) return;
    this.start(s);
  }

  start(s) {
    const src = s.originalPath || s.path;
    if (!fs.existsSync(src)) { s.status = 'missing'; s.statusNote = 'File not found — relink it.'; this.library.save(); this.onChange(); return; }
    const info = probeDuration(this.ffmpeg, src);
    if (!info.readable || !info.hasVideo) {
      s.status = 'unsupported'; s.conversion = { state: 'failed', error: !info.readable ? 'File is damaged or not a video' : 'No video track' };
      s.statusNote = 'Could not convert: ' + s.conversion.error; this.library.save(); this.onChange(); return;
    }
    const out = path.join(this.dir, `${s.id}-${String(s.fingerprint || '').slice(0, 8)}.mp4`);
    const partial = out + '.partial';
    s.status = 'converting'; s.statusNote = 'Converting to MP4…'; s.conversion = { state: 'running', percent: 0 };
    this.library.save();
    const proc = spawn(this.ffmpeg, buildArgs(src, partial), { windowsHide: true });
    try { os.setPriority(proc.pid, 10); } catch (e) { /* */ }
    const cur = this.current = { songId: s.id, proc, percent: 0 };
    let errTail = '';
    proc.stdout.on('data', (d) => {
      const m = /out_time_(?:us|ms)=(\d+)/.exec(String(d));
      if (m && info.duration) {
        const pct = Math.min(99, Math.round(Number(m[1]) / 1e6 / info.duration * 100));
        if (pct !== cur.percent) { cur.percent = pct; s.conversion.percent = pct; this.onChange(); }
      }
    });
    proc.stderr.on('data', (d) => { errTail = (errTail + d).slice(-2000); });
    proc.on('error', (e) => { errTail += e.message; });
    proc.on('close', (code) => {
      this.current = null;
      if (code === 0 && fs.existsSync(partial) && fs.statSync(partial).size > 0) {
        fs.renameSync(partial, out);
        s.originalPath = s.originalPath || s.path;
        s.path = out;
        s.converted = { from: s.originalPath, file: out, at: new Date().toISOString() };
        s.status = 'unchecked'; s.statusNote = ''; s.conversion = { state: 'done', percent: 100 };
        s.audio = null; // re-measure loudness on the converted copy
      } else {
        try { if (fs.existsSync(partial)) fs.unlinkSync(partial); } catch (e) { /* */ }
        s.status = 'unsupported';
        const err = cur.cancelled ? 'Cancelled' : (errTail.trim().split('\n').filter(Boolean).pop() || `ffmpeg exited with code ${code}`);
        s.conversion = { state: 'failed', error: err.slice(0, 200) };
        s.statusNote = 'Conversion failed: ' + s.conversion.error;
      }
      this.library.save();
      this.onChange();
    });
    this.onChange();
  }

  stop() { clearInterval(this.timer); if (this.current) try { this.current.proc.kill(); } catch (e) { /* */ } }
}

module.exports = { Converter, buildArgs, probeDuration };
