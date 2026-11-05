'use strict';
/**
 * Media compatibility (2.2): what is inside each video, and whether it will play smoothly.
 * - Codec, profile, resolution, frame rate and bitrates come from `ffmpeg -i` (the bundled
 *   Windows tools ship ffmpeg only, no ffprobe). Nothing is decoded and no file is written.
 * - For MP4/MOV the largest gap between keyframes is read from the file's index (stss/stts)
 *   — a long gap makes jumping to a clip start slow.
 * The verdict: ready / optimise (plays, but a smaller or simpler copy is recommended) /
 * unsupported (needs converting) / missing. Originals are never modified.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/** Parse the stream summary that `ffmpeg -hide_banner -i FILE` prints to stderr. */
function parseFfmpegInfo(text) {
  const t = String(text || '');
  const o = { duration: 0, bitrate: 0, container: null, vcodec: null, vprofile: null, width: 0, height: 0, fps: 0, vbitrate: 0, pixfmt: null, acodec: null, audio: false, video: false, readable: !/Invalid data found|No such file|could not find codec parameters|moov atom not found/i.test(t) };
  const inp = /Input #0, ([^,\n]+(?:,[^,\n]+)*?), from/.exec(t); if (inp) o.container = inp[1].split(',')[0].trim();
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(t); if (d) o.duration = Math.round(((+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3])) * 10) / 10;
  const br = /bitrate: (\d+) kb\/s/.exec(t); if (br) o.bitrate = Number(br[1]);
  // first real video stream (attached cover pictures are skipped)
  const vids = t.split('\n').filter(l => /Stream #\d+:\d+.*: Video:/.test(l) && !/attached pic/.test(l));
  if (vids.length) {
    const v = vids[0]; o.video = true;
    const m = /Video: (\w+)(?: \(([^)]*)\))?/.exec(v); if (m) { o.vcodec = m[1].toLowerCase(); o.vprofile = m[2] && !/^[a-z0-9]{4} \/ 0x/i.test(m[2]) ? m[2] : null; }
    const pf = /Video: [^,]+, (\w+)[(,]/.exec(v); if (pf) o.pixfmt = pf[1];
    const wh = /, (\d{2,5})x(\d{2,5})[ ,[]/.exec(v); if (wh) { o.width = +wh[1]; o.height = +wh[2]; }
    const fps = /, ([\d.]+) fps/.exec(v) || /, ([\d.]+) tbr/.exec(v); if (fps) o.fps = Math.round(parseFloat(fps[1]) * 100) / 100;
    const vb = /, (\d+) kb\/s/.exec(v); if (vb) o.vbitrate = Number(vb[1]);
  }
  const a = /Stream #\d+:\d+.*: Audio: (\w+)/.exec(t); if (a) { o.audio = true; o.acodec = a[1].toLowerCase(); }
  return o;
}

/* ---- MP4/MOV keyframe index ------------------------------------------------- */
function boxes(buf, start, end, cb) {
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p); const type = buf.toString('latin1', p + 4, p + 8); let h = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); h = 16; } else if (size === 0) size = end - p;
    if (size < h || p + size > end) break;
    if (cb(type, p + h, p + size) === false) return;
    p += size;
  }
}
/** Read only the moov box (the index), wherever it is in the file. */
function readMoov(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size; const hdr = Buffer.alloc(16); let pos = 0;
    while (pos + 8 <= size) {
      fs.readSync(fd, hdr, 0, 16, pos);
      let len = hdr.readUInt32BE(0); const type = hdr.toString('latin1', 4, 8); let h = 8;
      if (len === 1) { len = Number(hdr.readBigUInt64BE(8)); h = 16; } else if (len === 0) len = size - pos;
      if (len < h) return null;
      if (type === 'moov') { if (len > 64 * 1024 * 1024) return null; const b = Buffer.alloc(len - h); fs.readSync(fd, b, 0, b.length, pos + h); return b; }
      pos += len;
    }
    return null;
  } finally { fs.closeSync(fd); }
}
/** Largest gap between keyframes (seconds) of the first video track, or null if unknown. */
function maxKeyframeGap(file) {
  if (!/\.(mp4|m4v|mov)$/i.test(file)) return null;
  let moov; try { moov = readMoov(file); } catch (e) { return null; }
  if (!moov) return null;
  let result = null;
  boxes(moov, 0, moov.length, (type, s, e) => {
    if (type !== 'trak' || result !== null) return true;
    let isVideo = false, timescale = 0, stts = null, stss = null, allSync = true;
    const walk = (a, b) => boxes(moov, a, b, (t, s2, e2) => {
      if (t === 'mdia' || t === 'minf' || t === 'stbl') walk(s2, e2);
      else if (t === 'hdlr') isVideo = moov.toString('latin1', s2 + 8, s2 + 12) === 'vide';
      else if (t === 'mdhd') timescale = moov[s2] === 1 ? moov.readUInt32BE(s2 + 20) : moov.readUInt32BE(s2 + 12);
      else if (t === 'stts') stts = [s2, e2];
      else if (t === 'stss') { stss = [s2, e2]; allSync = false; }
      return true;
    });
    walk(s, e);
    if (!isVideo || !timescale || !stts) return true;
    if (allSync) { result = 0; return false; } // every frame is a keyframe
    // sample number → time
    const n = moov.readUInt32BE(stts[0] + 4); const runs = [];
    for (let i = 0; i < n; i++) { const o = stts[0] + 8 + i * 8; runs.push([moov.readUInt32BE(o), moov.readUInt32BE(o + 4)]); }
    let total = 0; runs.forEach(r => { total += r[0]; });
    const timeOf = (sample) => { let t = 0, k = sample - 1; for (const [cnt, dur] of runs) { if (k <= cnt) return (t + k * dur) / timescale; t += cnt * dur; k -= cnt; } return t / timescale; };
    const kc = moov.readUInt32BE(stss[0] + 4); let prev = 0, gap = 0;
    for (let i = 0; i < kc; i++) { const t = timeOf(moov.readUInt32BE(stss[0] + 8 + i * 4)); gap = Math.max(gap, t - prev); prev = t; }
    gap = Math.max(gap, timeOf(total + 1) - prev);
    result = Math.round(gap * 10) / 10;
    return false;
  });
  return result;
}

/** Async `ffmpeg -i` (never blocks the app). */
function probe(ffmpeg, file, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let err = ''; let done = false;
    const p = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-i', file], { windowsHide: true });
    const t = setTimeout(() => { try { p.kill(); } catch (e) { /* */ } }, timeoutMs);
    p.stderr.on('data', d => { if (err.length < 64 * 1024) err += d; });
    const fin = () => { if (done) return; done = true; clearTimeout(t); const info = parseFfmpegInfo(err); try { info.keyGap = maxKeyframeGap(file); } catch (e) { info.keyGap = null; } resolve(info); };
    p.on('close', fin); p.on('error', () => { err += '\nNo such file'; fin(); });
  });
}

const PLAYABLE_VIDEO = ['h264', 'vp8', 'vp9', 'av1'];
const PLAYABLE_AUDIO = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le', 'pcm_f32le'];
/**
 * Verdict for one library song. opts.lowRes: stricter limits for low-end laptops.
 * Returns { status: 'ready'|'optimise'|'unsupported'|'missing'|'pending', reasons: [] }.
 */
function classify(s, opts = {}) {
  const reasons = [];
  if (s.source === 'youtube') return { status: 'ready', reasons: ['YouTube (Beta) — needs internet'] };
  if (s.status === 'missing') return { status: 'missing', reasons: ['Video file not found — relink it'] };
  if (s.status === 'unsupported' || s.status === 'needs-conversion') return { status: 'unsupported', reasons: [s.statusNote || 'This video cannot be played as it is — convert it to MP4'] };
  const m = s.media;
  if (!m) return { status: s.status === 'ok' ? 'pending' : 'pending', reasons: ['Not checked yet'] };
  if (!m.readable) return { status: 'unsupported', reasons: ['The file is damaged or can\'t be read'] };
  if (!m.video) {
    // 2.6 audio songs: fine as long as the sound plays
    if (!m.audio) return { status: 'unsupported', reasons: ['No video or sound track'] };
    if (m.acodec && !PLAYABLE_AUDIO.includes(m.acodec)) return { status: 'unsupported', reasons: [`Audio codec ${m.acodec.toUpperCase()} may not play — convert to MP3`] };
    return { status: 'ready', reasons: ['Audio only: the TV shows a music card'], audioOnly: true };
  }
  if (m.vcodec && !PLAYABLE_VIDEO.includes(m.vcodec)) reasons.push({ k: 'unsupported', t: `Video codec ${m.vcodec.toUpperCase()} may not play on Windows laptops — convert to H.264` });
  if (m.audio && m.acodec && !PLAYABLE_AUDIO.includes(m.acodec)) reasons.push({ k: 'unsupported', t: `Audio codec ${m.acodec.toUpperCase()} may not play — convert to AAC` });
  if (!m.audio) reasons.push({ k: 'warn', t: 'No sound track' });
  const maxH = opts.lowRes ? 720 : 1080;
  if (m.height > maxH) reasons.push({ k: 'optimise', t: `${m.height}p is more than ${opts.lowRes ? 'a low-power laptop' : 'a 1080p TV'} needs — a ${maxH}p copy plays more smoothly` });
  if (m.fps > (opts.lowRes ? 31 : 61)) reasons.push({ k: 'optimise', t: `${Math.round(m.fps)} frames per second is heavy to decode` });
  const vb = m.vbitrate || m.bitrate;
  if (vb > (opts.lowRes ? 8000 : 16000)) reasons.push({ k: 'optimise', t: `Very high bitrate (${(vb / 1000).toFixed(1)} Mb/s)` });
  if (m.pixfmt && /10le|10be|12le|444|422/.test(m.pixfmt)) reasons.push({ k: 'optimise', t: `Uncommon picture format (${m.pixfmt}) — not all laptops decode it in hardware` });
  if (m.keyGap != null && m.keyGap > 10) reasons.push({ k: 'optimise', t: `Keyframes up to ${m.keyGap} s apart — jumping to the clip start can be slow` });
  const dur = m.duration || s.duration || 0;
  if (dur && s.clipStart != null && Number(s.clipStart) >= dur - 1) reasons.push({ k: 'clip', t: `Clip start ${Math.round(s.clipStart)} s is past the end of the video (${Math.round(dur)} s)` });
  if (dur && s.clipEnd != null && Number(s.clipEnd) > dur + 1) reasons.push({ k: 'clip', t: `Clip end ${Math.round(s.clipEnd)} s is past the end of the video` });
  const status = reasons.some(r => r.k === 'unsupported') ? 'unsupported' : reasons.some(r => r.k === 'optimise' || r.k === 'clip') ? 'optimise' : 'ready';
  return { status, reasons: reasons.map(r => r.t), fixable: reasons.some(r => r.k === 'optimise') && !reasons.some(r => r.k === 'unsupported'), clipIssue: reasons.some(r => r.k === 'clip') };
}

module.exports = { parseFfmpegInfo, maxKeyframeGap, probe, classify, PLAYABLE_VIDEO };
