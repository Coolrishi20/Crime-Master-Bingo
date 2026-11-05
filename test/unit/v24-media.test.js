'use strict';
/* 2.2 media check: stream info from ffmpeg's summary, keyframe spacing from the MP4 index,
 * and the Ready / Needs optimisation / Unsupported / Missing verdict. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { execFileSync } = require('child_process');
const { parseFfmpegInfo, maxKeyframeGap, probe, classify } = require('../../src/main/mediainfo');
const { buildArgs } = require('../../src/main/converter');
let hasFfmpeg = true; try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch (e) { hasFfmpeg = false; }

const SAMPLE = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x.mp4':
  Metadata:
    major_brand     : isom
  Duration: 00:03:41.04, start: 0.000000, bitrate: 5120 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 4990 kb/s, 29.97 fps, 29.97 tbr, 30k tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)
  Stream #0:2[0x3](und): Video: mjpeg (Baseline), yuvj420p(pc), 300x300, 90k tbr, 90k tbn (attached pic)
At least one output file must be specified`;

test('parses codec, profile, size, frame rate, bitrates and audio; ignores cover pictures', () => {
  const o = parseFfmpegInfo(SAMPLE);
  assert.deepStrictEqual([o.container, o.vcodec, o.vprofile, o.width, o.height, o.fps, o.vbitrate, o.bitrate, o.acodec, o.duration, o.pixfmt],
    ['mov', 'h264', 'High', 1920, 1080, 29.97, 4990, 5120, 'aac', 221, 'yuv420p']);
  assert.ok(o.readable && o.video && o.audio);
  const hevc = parseFfmpegInfo('  Duration: 00:00:10.00, start: 0, bitrate: 900 kb/s\n  Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv), 3840x2160, 60 fps\n');
  assert.deepStrictEqual([hevc.vcodec, hevc.height, hevc.fps, hevc.pixfmt, hevc.audio], ['hevc', 2160, 60, 'yuv420p10le', false]);
  assert.strictEqual(parseFfmpegInfo('x.mp4: Invalid data found when processing input').readable, false);
});

test('verdicts: ready, optimise (size, fps, bitrate, keyframes, clip), unsupported codec, missing; Low Resource is stricter', () => {
  const base = { status: 'ok', media: { readable: true, video: true, audio: true, vcodec: 'h264', acodec: 'aac', width: 1280, height: 720, fps: 25, vbitrate: 3000, pixfmt: 'yuv420p', keyGap: 2, duration: 200 } };
  const v = (patch, opts) => classify(Object.assign({}, base, patch.song || {}, { media: Object.assign({}, base.media, patch.media || {}) }), opts);
  assert.strictEqual(v({}).status, 'ready');
  assert.strictEqual(v({ media: { height: 2160, width: 3840 } }).status, 'optimise');
  assert.strictEqual(v({ media: { height: 1080 } }).status, 'ready', '1080p is fine normally');
  assert.strictEqual(v({ media: { height: 1080 } }, { lowRes: true }).status, 'optimise', '…but not in Low Resource Mode');
  assert.strictEqual(v({ media: { fps: 60 } }, { lowRes: true }).status, 'optimise');
  assert.strictEqual(v({ media: { vbitrate: 25000 } }).status, 'optimise');
  assert.match(v({ media: { keyGap: 12 } }).reasons[0], /Keyframes up to 12 s apart/);
  const clip = v({ song: { clipStart: 250 } });
  assert.ok(clip.status === 'optimise' && clip.clipIssue && !clip.fixable, 'a clip past the end is flagged but not "fixed" by a copy');
  const h = v({ media: { vcodec: 'hevc' } });
  assert.strictEqual(h.status, 'unsupported'); assert.match(h.reasons[0], /HEVC/);
  assert.strictEqual(classify({ status: 'missing' }).status, 'missing');
  assert.strictEqual(classify({ status: 'needs-conversion', statusNote: 'Converting to MP4…' }).status, 'unsupported');
  assert.strictEqual(classify({ status: 'ok' }).status, 'pending');
  assert.strictEqual(classify({ source: 'youtube' }).status, 'ready');
});

test('optimised copies: keyframe every ~2 s and an optional frame-rate cap', () => {
  const a = buildArgs('/i.mp4', '/o.mp4', { maxHeight: 1080, fps: 30 });
  assert.strictEqual(a[a.indexOf('-g') + 1], '48'); assert.strictEqual(a[a.indexOf('-r') + 1], '30');
  assert.ok(!buildArgs('/i.mp4', '/o.mp4').includes('-g'), 'plain conversions unchanged');
});

test('real files: keyframe spacing from the MP4 index and an async probe', { skip: !hasFfmpeg && 'ffmpeg not installed', timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb24-'));
  const mk = (name, gop) => { const f = path.join(dir, name); execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '24', '-c:v', 'libx264', '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-c:a', 'aac', '-shortest', f]); return f; };
  const sparse = mk('sparse.mp4', 300); const dense = mk('dense.mp4', 50);
  assert.ok(maxKeyframeGap(sparse) >= 11.9, 'one keyframe every 12 s: ' + maxKeyframeGap(sparse));
  assert.ok(Math.abs(maxKeyframeGap(dense) - 2) < 0.1, 'every 2 s: ' + maxKeyframeGap(dense));
  const info = await probe('ffmpeg', sparse);
  assert.deepStrictEqual([info.vcodec, info.width, info.height, info.fps, info.acodec], ['h264', 320, 240, 25, 'aac']);
  assert.ok(info.keyGap >= 11.9);
  const bad = path.join(dir, 'bad.mp4'); fs.writeFileSync(bad, Buffer.alloc(3000, 7));
  const b = await probe('ffmpeg', bad);
  assert.strictEqual(b.readable && b.video, false);
  assert.strictEqual(maxKeyframeGap(bad), null);
});
