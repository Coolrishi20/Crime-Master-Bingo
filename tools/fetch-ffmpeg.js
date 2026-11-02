#!/usr/bin/env node
/* Downloads a static ffmpeg build (used ONLY to analyse audio loudness) into
 * vendor/ffmpeg/<platform>-<arch>/ together with its licence. Bundled with the
 * Windows build as a separate executable under resources/ffmpeg/.
 * Source: https://github.com/eugeneware/ffmpeg-static (b6.0 release).
 * Usage: node tools/fetch-ffmpeg.js [win32-x64] */
const https = require('https'); const fs = require('fs'); const path = require('path'); const zlib = require('zlib');
const target = process.argv[2] || 'win32-x64';
const REL = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/';
const dir = path.join(__dirname, '..', 'vendor', 'ffmpeg', target);
fs.mkdirSync(dir, { recursive: true });
function get(url, redirects = 8) {
  return new Promise((res, rej) => https.get(url, { headers: { 'User-Agent': 'crime-master-bingo-build' } }, r => {
    if ([301, 302, 303, 307, 308].includes(r.statusCode) && redirects) { r.resume(); return res(get(r.headers.location, redirects - 1)); }
    if (r.statusCode !== 200) { r.resume(); return rej(new Error(`HTTP ${r.statusCode} for ${url}`)); }
    const chunks = []; r.on('data', c => chunks.push(c)); r.on('end', () => res(Buffer.concat(chunks))); r.on('error', rej);
  }).on('error', rej));
}
(async () => {
  const exe = target.startsWith('win32') ? 'ffmpeg.exe' : 'ffmpeg';
  if (fs.existsSync(path.join(dir, exe))) { console.log('ffmpeg already present:', path.join(dir, exe)); return; }
  console.log('Downloading ffmpeg for', target, '…');
  const gz = await get(REL + `ffmpeg-${target}.gz`);
  fs.writeFileSync(path.join(dir, exe), zlib.gunzipSync(gz), { mode: 0o755 });
  for (const f of ['LICENSE', 'README']) { try { fs.writeFileSync(path.join(dir, `ffmpeg-${f}.txt`), await get(REL + `${target}.${f}`)); } catch (e) { console.warn('could not fetch', f, e.message); } }
  console.log('Saved', path.join(dir, exe), (fs.statSync(path.join(dir, exe)).size / 1048576).toFixed(1) + ' MB');
})().catch(e => { console.error(e.message); process.exit(1); });
