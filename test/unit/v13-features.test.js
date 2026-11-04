'use strict';
/* v1.3 — folders → playlists, built-in converter, welcome/end screens, secure phone link */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Store } = require('../../src/main/store');
const { Library } = require('../../src/main/library');
const { Converter, buildArgs } = require('../../src/main/converter');
const { RemoteServer } = require('../../src/main/remote');
const { makeEngine } = require('./helpers');
const WebSocket = require('ws');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cmb13-'));
let hasFfmpeg = true; try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch (e) { hasFfmpeg = false; }

function fakeVideo(dir, name) { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, name); fs.writeFileSync(f, crypto.randomBytes(2000)); return f; }

test('folder tree → one playlist per sub-folder; loose files → playlist named after the top folder; re-run adds only new', async () => {
  const root = path.join(tmp(), 'Music Videos');
  ['80s', '90s', 'Bollywood'].forEach((d, i) => { for (let k = 0; k < 3; k++) fakeVideo(path.join(root, d, k === 2 ? 'nested' : ''), `${d} Artist ${k} - Song ${k}.mp4`); });
  fakeVideo(root, 'Loose Artist - Loose Song.mp4');
  fakeVideo(path.join(root, 'Empty'), 'notes.txt');
  const lib = new Library(new Store(tmp()));
  const r = await lib.importFolderAsPlaylists(root);
  assert.deepStrictEqual(r.playlists.map(p => p.name), ['Music Videos', '80s', '90s', 'Bollywood']);
  assert.ok(r.playlists.every(p => p.created));
  assert.strictEqual(r.playlists.find(p => p.name === '80s').total, 3, 'includes nested sub-folders');
  assert.strictEqual(r.totals.added, 10);
  fakeVideo(path.join(root, '80s'), 'New Artist - New Song.mp4');
  const r2 = await lib.importFolderAsPlaylists(root);
  const p80 = r2.playlists.find(p => p.name === '80s');
  assert.ok(!p80.created); assert.strictEqual(p80.added, 1); assert.strictEqual(p80.total, 4);
  assert.strictEqual(lib.playlists().length, 4, 'no duplicate playlists');
  assert.strictEqual(lib.songs().length, 11, 'no duplicate songs');
});

test('AVI / WMV / FLV are imported (not refused) and queued for conversion', async () => {
  const dir = tmp(); ['a.avi', 'b.wmv', 'c.flv', 'd.mpg'].forEach(n => fakeVideo(dir, 'Artist - ' + n));
  const lib = new Library(new Store(tmp()));
  const r = await lib.importPaths([dir]);
  assert.strictEqual(r.added.length, 4); assert.strictEqual(r.unsupported.length, 0); assert.strictEqual(r.converting, 4);
  assert.ok(lib.songs().every(s => s.status === 'needs-conversion'));
  assert.ok(lib.songs().every(s => lib.problemFor(s) === 'Converting to MP4…'), 'not playable in a game until converted');
});

test('converter arguments make a H.264/AAC MP4 copy (original never written)', () => {
  const a = buildArgs('/in/x.avi', '/out/y.mp4.partial');
  assert.ok(a.includes('libx264') && a.includes('aac') && a.includes('+faststart'));
  assert.strictEqual(a[a.indexOf('-i') + 1], '/in/x.avi'); assert.strictEqual(a[a.length - 1], '/out/y.mp4.partial');
});

test('real conversion: AVI, WMV and FLV become playable MP4 copies; originals untouched; corrupt file fails cleanly', { skip: !hasFfmpeg && 'ffmpeg not installed', timeout: 180000 }, async () => {
  const src = tmp(); const data = tmp();
  const make = (name, vcodec, acodec) => { const f = path.join(src, name); execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', vcodec, '-c:a', acodec, '-shortest', f]); return f; };
  const files = [make('Artist A - Old Song.avi', 'mpeg4', 'mp3'), make('Artist B - Windows Song.wmv', 'wmv2', 'wmav2'), make('Artist C - Flash Song.flv', 'flv', 'mp3')];
  const bad = path.join(src, 'Artist D - Broken.avi'); fs.writeFileSync(bad, crypto.randomBytes(5000));
  const before = files.map(f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'));
  const lib = new Library(new Store(data));
  await lib.importPaths([src]);
  const conv = new Converter({ dataDir: data, library: lib, ffmpeg: 'ffmpeg', onChange: () => {} });
  for (let i = 0; i < 120 && lib.songs().some(s => ['needs-conversion', 'converting'].includes(s.status)); i++) { conv.pump(); await new Promise(r => setTimeout(r, 500)); }
  conv.stop();
  const ok = lib.songs().filter(s => s.converted);
  assert.strictEqual(ok.length, 3, JSON.stringify(lib.songs().map(s => [s.fileName, s.status, s.statusNote])));
  for (const s of ok) {
    assert.ok(s.path.endsWith('.mp4') && fs.existsSync(s.path) && s.path.startsWith(path.join(data, 'converted')));
    assert.strictEqual(s.status, 'unchecked', 'goes back through the normal playability check');
    const probe = execFileSync('ffmpeg', ['-hide_banner', '-i', s.path, '-f', 'null', '-t', '0.1', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    assert.ok(fs.statSync(s.path).size > 1000);
  }
  const info = execFileSync('sh', ['-c', `ffmpeg -hide_banner -i '${ok[0].path}' 2>&1 || true`], { encoding: 'utf8' });
  assert.match(info, /Video: h264/); assert.match(info, /Audio: aac/);
  assert.deepStrictEqual(files.map(f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex')), before, 'originals unchanged');
  const broken = lib.songs().find(s => s.fileName.includes('Broken'));
  assert.strictEqual(broken.status, 'unsupported'); assert.strictEqual(broken.conversion.state, 'failed'); assert.ok(broken.statusNote.length > 5);
  assert.ok(!fs.readdirSync(path.join(data, 'converted')).some(f => f.endsWith('.partial')), 'no half-written files left behind');
});

test('welcome screen before Round 1, nothing during play, end screen after the game', () => {
  const { eng, game } = makeEngine();
  game.venue = 'The Crown';
  eng.dispatch('setScreens', { startTime: '20:00', message: 'Grab your cards at the bar!' });
  let sc = eng.audienceState().screen;
  assert.strictEqual(sc.mode, 'welcome'); assert.strictEqual(sc.startTime, '20:00'); assert.strictEqual(sc.venue, 'The Crown');
  assert.throws(() => eng.dispatch('setScreens', { startTime: '8pm' }), /20:00/);
  eng.dispatch('startRound', { round: 1 });
  assert.strictEqual(eng.audienceState().screen.mode, 'none');
  eng.dispatch('endGame');
  sc = eng.audienceState().screen;
  assert.strictEqual(sc.mode, 'end'); assert.ok(!JSON.stringify(sc).match(/card/i), 'no card details on the end screen');
  eng.dispatch('setScreens', { end: false });
  assert.strictEqual(eng.audienceState().screen.mode, 'none');
});

test('secure phone link: HTTPS page + WSS on the twin port with the laptop certificate', async () => {
  const selfsigned = require('selfsigned');
  const pems = selfsigned.generate([{ name: 'commonName', value: 'CMB test' }], { keySize: 2048, days: 30, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }] });
  let devices = [];
  const srv = new RemoteServer({ port: 18800, tls: { key: pems.private, cert: pems.cert }, staticDir: path.join(__dirname, '../../src/remote-web'), getState: () => ({ game: null }), dispatch: async () => ({ ok: true }), devices: { list: () => devices, save: l => { devices = l; } } });
  await srv.start(); await new Promise(r => setTimeout(r, 300));
  try {
    const info = srv.info();
    assert.strictEqual(info.httpsPort, 18801); assert.match(info.secureUrl, /^https:\/\/.+:18801\/$/);
    const https = require('https');
    const html = await new Promise((res, rej) => https.get({ host: '127.0.0.1', port: 18801, path: '/', ca: pems.cert }, r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => res(b)); }).on('error', rej));
    assert.match(html, /CHECK BINGO/);
    const cj = await new Promise((res, rej) => https.get({ host: '127.0.0.1', port: 18801, path: '/connect.json', ca: pems.cert }, r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => res(JSON.parse(b))); }).on('error', rej));
    assert.deepStrictEqual(cj, { httpPort: 18800, httpsPort: 18801 });
    const ws = new WebSocket('wss://127.0.0.1:18801/ws', { ca: pems.cert });
    const hello = await new Promise((res, rej) => { ws.on('message', d => res(JSON.parse(d))); ws.on('error', rej); });
    assert.strictEqual(hello.type, 'hello');
    ws.send(JSON.stringify({ type: 'pair', pin: srv.pin, deviceName: 'secure phone' }));
    const paired = await new Promise(res => ws.on('message', d => { const m = JSON.parse(d); if (m.type === 'paired') res(m); }));
    assert.ok(paired.token, 'pairing works over the secure link');
    ws.close();
    // the plain link keeps working too
    const ws2 = new WebSocket('ws://127.0.0.1:18800/ws');
    assert.strictEqual((await new Promise(res => ws2.on('message', d => res(JSON.parse(d))))).type, 'hello'); ws2.close();
  } finally { await srv.stop(); }
});
