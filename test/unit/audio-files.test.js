'use strict';
/* Upgrade 3 — real media files through the analysis worker (skipped if ffmpeg is unavailable). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { execFileSync } = require('child_process');
const { Worker } = require('worker_threads');
const { gainFor } = require('../../src/main/loudness');
let hasFfmpeg = true; try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch (e) { hasFfmpeg = false; }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmbaudio-'));
const mk = (name, audioArgs, extra = []) => { const f = path.join(dir, name); execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', ...audioArgs, '-t', '6', ...extra, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest', f]); return f; };
const analyse = (file) => new Promise(r => { const w = new Worker(path.join(__dirname, '../../src/main/audio-worker.js'), { workerData: { ffmpeg: 'ffmpeg', file } }); w.on('message', m => { r(m); w.terminate(); }); });
const ref = (file) => { const o = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -i '${file}' -map 0:a:0 -af ebur128 -f null - 2>&1 | grep -E "^ +I:" | tail -1`], { encoding: 'utf8' }); return parseFloat(/I:\s+(-?[\d.]+)/.exec(o)[1]); };
const audio = { targetLufs: -16, ceilingDbtp: -1, maxBoostDb: 9 };

test('real files: loud, quiet, sample rates, channel layouts, peaks, no audio, corrupted', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const loud = mk('loud.mp4', ['-f', 'lavfi', '-i', 'anoisesrc=color=white:amplitude=0.7:sample_rate=44100'], ['-ac', '2', '-c:a', 'aac']);
  const quiet = mk('quiet-mono.mp4', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=22050,volume=0.02'], ['-ac', '1', '-c:a', 'aac']);
  const surround = mk('surround.mp4', ['-f', 'lavfi', '-i', 'anoisesrc=color=brown:amplitude=0.3:sample_rate=48000'], ['-ac', '6', '-c:a', 'aac']);
  const peaky = mk('peaks.mp4', ['-f', 'lavfi', '-i', "aevalsrc='if(between(t,3,3.05),0.95,0.02)*sin(2*PI*440*t)':s=48000"], ['-ac', '2', '-c:a', 'aac']);
  const noaudio = path.join(dir, 'noaudio.mp4'); execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', noaudio]);
  const corrupt = path.join(dir, 'corrupt.mp4'); fs.writeFileSync(corrupt, fs.readFileSync(loud).subarray(0, 5000));
  const L = await analyse(loud), Q = await analyse(quiet), S = await analyse(surround), P = await analyse(peaky);
  assert.ok(L.ok && Math.abs(L.lufs - ref(loud)) < 0.5, `loud ${L.lufs} vs ffmpeg ${ref(loud)}`);
  assert.ok(S.ok && Math.abs(S.lufs - ref(surround)) < 0.5, `5.1 ${S.lufs} vs ${ref(surround)}`);
  assert.strictEqual(L.source.sampleRate, 44100); assert.strictEqual(Q.source.sampleRate, 22050);
  assert.strictEqual(Q.source.channels, 1); assert.strictEqual(S.source.channels, 6);
  const gl = gainFor(L.profile, { start: 0, end: 6 }, audio), gq = gainFor(Q.profile, { start: 0, end: 6 }, audio), gp = gainFor(P.profile, { start: 0, end: 6 }, audio);
  assert.ok(gl.gainDb < 0, 'loud file is turned down: ' + L.lufs + ' LUFS, gain ' + gl.gainDb); assert.ok(gl.gainDb + L.truePeak <= -1 + 0.05);
  assert.strictEqual(gq.gainDb, 9, 'quiet file boosted by at most the maximum');
  assert.ok(gp.gainDb + P.truePeak <= -1 + 0.05, 'sudden peak never clips after levelling');
  // all levelled clips land near the same loudness (unless limited)
  [[L, gl], [S, gainFor(S.profile, { start: 0, end: 6 }, audio)]].forEach(([m, g]) => { if (!g.limited) assert.ok(Math.abs(m.lufs + g.gainDb - audio.targetLufs) < 0.6); });
  const N = await analyse(noaudio); assert.ok(!N.ok && N.noAudio, 'missing audio track reported');
  const C = await analyse(corrupt); assert.ok(!C.ok && !C.noAudio, 'corrupted media reported');
  // clip-specific: 20 s / 30 s etc. use only the selected segment
  const seg = gainFor(P.profile, { start: 0, end: 2.9 }, audio);
  assert.ok(seg.gainDb > gp.gainDb, 'a clip avoiding the peak may be boosted more');
});
