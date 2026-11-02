'use strict';
/* Worker thread: decode a file's audio with ffmpeg (audio only, 48 kHz stereo
 * float) and measure it. Keeps the UI/main thread responsive. */
const { parentPort, workerData } = require('worker_threads');
const { spawn } = require('child_process');
const { LoudnessMeter, integrated, truePeak } = require('./loudness');

const { ffmpeg, file, lowPriority } = workerData;
const { spawnSync } = require('child_process');

// Probe the first audio stream (sample rate, channel layout). Mono is copied to both
// speakers by the player at full level, so it is measured the same way here.
const probe = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-i', file], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
const m = /Stream #\d+:\d+[^:]*: Audio: ([^,]+), (\d+) Hz, ([^,]+)/.exec(probe.stderr || '');
const info = m ? { codec: m[1].trim(), sampleRate: Number(m[2]), layout: m[3].trim() } : null;
const chMap = { mono: 1, stereo: 2, '2.1': 3, '4.0': 4, quad: 4, '5.0': 5, '5.1': 6, '5.1(side)': 6, '6.1': 7, '7.1': 8 };
if (info) info.channels = chMap[info.layout] || (/^(\d+) channels/.exec(info.layout) || [])[1] * 1 || null;
const mix = info && info.layout === 'mono' ? ['-af', 'pan=stereo|c0=c0|c1=c0'] : ['-ac', '2'];
const args = ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-map', '0:a:0', '-vn', '-sn', '-dn'].concat(mix, ['-ar', '48000', '-f', 'f32le', 'pipe:1']);
const proc = spawn(ffmpeg, args, { windowsHide: true });
try { if (lowPriority) require('os').setPriority(proc.pid, 10); } catch (e) { /* not permitted */ }
const meter = new LoudnessMeter(2);
let leftover = Buffer.alloc(0); let err = '';
proc.stdout.on('data', (chunk) => {
  let buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
  const usable = buf.length - (buf.length % 8);
  const f32 = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + usable));
  meter.push(f32);
  leftover = buf.subarray(usable);
});
proc.stderr.on('data', d => { err += d; if (err.length > 4000) err = err.slice(-4000); });
proc.on('error', e => parentPort.postMessage({ ok: false, error: 'ffmpeg could not be started: ' + e.message }));
proc.on('close', (code) => {
  if (code !== 0 && meter.frames === 0) {
    const noAudio = /matches no streams|does not contain any stream|Stream map '0:a:0'/i.test(err);
    parentPort.postMessage({ ok: false, noAudio, error: noAudio ? 'No audio track' : (err.trim().split('\n').pop() || ('ffmpeg exited with code ' + code)) });
    return;
  }
  const profile = meter.finish();
  if (!profile.sub.length) { parentPort.postMessage({ ok: false, noAudio: true, error: 'No audio data' }); return; }
  parentPort.postMessage({ ok: true, profile, lufs: integrated(profile), truePeak: truePeak(profile), source: info });
});
parentPort.on('message', (m) => { if (m === 'cancel') { try { proc.kill(); } catch (e) { /* */ } } });
