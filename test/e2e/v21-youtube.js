/* YouTube songs (Beta) end-to-end against a LOCAL STAND-IN for YouTube that speaks the same
 * embedded-player postMessage protocol and oEmbed responses (real YouTube is not reachable from
 * the test environment). Proves Anthem Square's side: adding links, rejected links with reasons,
 * the TV layout never covering the player, start/pause/clip-end/error handling, silent mirror.
 * Run: xvfb-run -a node test/e2e/v21-youtube.js <samplesDir> */
const { _electron: electron } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os'); const http = require('http');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const ok = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failed++; };
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { } await sleep(250); } return null; };

/* ---- the stand-in: /oembed and /embed/<id> (player page implementing the message protocol) */
const PLAYER = `<!doctype html><html><body style="margin:0;background:#200;color:#fff;font:20px sans-serif"><div id="l" style="padding:20px">STAND-IN PLAYER</div><script>
var id = location.pathname.split('/').pop(), q = new URLSearchParams(location.search), t = Number(q.get('start')) || 0, st = -1, last = performance.now(), vol = 100, muted = q.get('mute') === '1', parent_ = null;
document.getElementById('l').textContent = 'STAND-IN PLAYER ' + id;
function out(m) { if (parent_) parent_.postMessage(JSON.stringify(m), '*'); }
function tick() { var n = performance.now(); if (st === 1) t += (n - last) / 1000; last = n; }
window.addEventListener('message', function (e) { var d; try { d = JSON.parse(e.data); } catch (x) { return; } parent_ = e.source;
  if (d.event === 'listening') { out({ event: 'onReady' }); if (id === 'errorvid001') setTimeout(function () { out({ event: 'onError', info: 150 }); }, 300); if (q.get('autoplay') === '1' && id !== 'errorvid001') { st = 1; out({ event: 'onStateChange', info: 1 }); } return; }
  if (d.event !== 'command') return; tick();
  if (d.func === 'playVideo' && id !== 'errorvid001') { st = 1; out({ event: 'onStateChange', info: 1 }); }
  if (d.func === 'pauseVideo') { st = 2; out({ event: 'onStateChange', info: 2 }); }
  if (d.func === 'seekTo') t = d.args[0];
  if (d.func === 'setVolume') vol = d.args[0];
  if (d.func === 'mute') muted = true;
});
setInterval(function () { tick(); out({ event: 'infoDelivery', info: { currentTime: t, playerState: st, volume: vol, muted: muted } }); }, 200);
</script></body></html>`;
function standIn() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/oembed') {
        const id = (/v=([A-Za-z0-9_-]{11})/.exec(u.searchParams.get('url') || '') || [])[1];
        if (id === 'blockedvid1') { rsp.writeHead(401); return rsp.end('Unauthorized'); }
        if (id === 'missingvid1') { rsp.writeHead(404); return rsp.end('Not Found'); }
        rsp.writeHead(200, { 'Content-Type': 'application/json' });
        return rsp.end(JSON.stringify({ title: `Band ${id.slice(-1)} - Song ${id} (Official Music Video)`, author_name: `Band ${id.slice(-1)}VEVO`, thumbnail_url: `http://127.0.0.1:${srv.address().port}/thumb.png` }));
      }
      if (u.pathname === '/thumb.png') { rsp.writeHead(200, { 'Content-Type': 'image/png' }); return rsp.end(Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f80f0000010101005d8ab3e30000000049454e44ae426082', 'hex')); }
      if (u.pathname.startsWith('/embed/')) { rsp.writeHead(200, { 'Content-Type': 'text/html' }); return rsp.end(PLAYER); }
      rsp.writeHead(404); rsp.end();
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

(async () => {
  const srv = await standIn(); const P = srv.address().port;
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'as-yt-'));
  const app = await electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'],
    env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1', CMB_NO_REMOTE: '1', CMB_YT_EMBED: `http://127.0.0.1:${P}/embed/`, CMB_YT_OEMBED: `http://127.0.0.1:${P}/oembed?url=` }) });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings);
  host.on('pageerror', e => ok(false, 'host page error', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  const cmd = (a, b) => inv('game:cmd', { action: a, args: b || {} });
  const state = async () => (await inv('game:state')).game;

  /* adding links */
  const r = await inv('library:addYouTube', { urls: ['https://www.youtube.com/watch?v=okvideo0001&t=10', 'https://youtu.be/okvideo0002', 'https://www.youtube.com/shorts/okvideo0003', 'https://music.youtube.com/watch?v=okvideo0004', 'https://www.youtube.com/watch?v=okvideo0001', 'https://youtube.com/watch?v=blockedvid1', 'https://youtu.be/missingvid1', 'https://www.youtube.com/playlist?list=PL123', 'not a link', 'https://youtu.be/errorvid001'].join('\n') });
  ok(r.added.length === 5 && r.added[0].title === 'Song okvideo0001' && r.added[0].artist === 'Band 1', 'Watch, youtu.be, shorts and music links added; "(Official Music Video)" and "VEVO" cleaned off', JSON.stringify(r.added[0]));
  const reasons = r.failed.map(f => f.reason).join(' | ');
  ok(r.failed.length === 4 && /does not allow it to be played in other apps/.test(reasons) && /not found, private or removed/.test(reasons) && /Playlists are not supported/.test(reasons) && /Not a YouTube video link/.test(reasons), 'Rejected links explain why', reasons);
  const again = await inv('library:addYouTube', { urls: 'https://youtu.be/okvideo0002' });
  ok(again.already.length === 1 && again.added.length === 0, 'The same video is never added twice');
  await host.evaluate(() => App.show('library')); await sleep(1500);
  ok(/YOUTUBE/.test(await host.textContent('#lBody')), 'Library marks YouTube songs');
  const yts = (await inv('library:list')).songs.filter(s => s.source === 'youtube');
  ok(yts.every(s => s.thumb && fs.existsSync(s.thumb)), 'Thumbnails are saved locally (work offline afterwards)');

  /* a game with 3 YouTube songs */
  await inv('library:importPaths', [process.argv[2]]);
  await waitFor(async () => { const l = (await inv('library:list')).songs; return l.filter(s => s.status === 'ok').length >= 50; }, 180000);
  const songs = (await inv('library:list')).songs;
  const pl = await inv('playlists:create', { name: 'With YouTube' });
  await inv('playlists:add', { id: pl.id, songIds: songs.filter(s => s.source !== 'youtube').slice(0, 44).map(s => s.id).concat(yts.map(s => s.id)) });
  await inv('games:create', { name: 'YT night', playlistId: pl.id, cards: 4, settings: { clipMode: 20, autoAdvance: false } });
  const pf = await inv('game:preflight');
  const ytCheck = (pf.checks || []).find(c => c.key === 'youtube');
  ok(ytCheck && /5 song\(s\) play from YouTube/.test(ytCheck.detail), 'Pre-flight check names the YouTube songs and the internet requirement', ytCheck && ytCheck.detail);
  await inv('audience:open');
  const tv = await waitFor(async () => { for (const p of app.windows()) { if (/audience/.test(await p.url()) && !/mirror=1/.test(await p.url())) return p; } return null; });
  await tv.waitForLoadState('domcontentloaded');
  const yt1 = yts.find(s => s.youtubeId === 'okvideo0001');
  await cmd('queueSong', { songId: yt1.id });
  await cmd('startRound', { round: 1 });
  const frame = await waitFor(async () => tv.evaluate(() => { const f = document.getElementById('ytFrame'); return f && document.body.classList.contains('yt-mode') ? f.src : null; }), 10000);
  ok(frame && /\/embed\/okvideo0001\?/.test(frame) && /enablejsapi=1/.test(frame), 'TV plays the song in the embedded YouTube player', frame);
  const started = await waitFor(async () => { const g = await state(); return g.playback.status === 'playing' && g.playback.position > 1 ? g : null; }, 15000);
  ok(!!started, 'The game hears the player start and follows its time', started && started.playback.position.toFixed(1) + ' s');
  await sleep(1500);
  const boxes = await tv.evaluate(() => { const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; }; return { f: r('ytFrame'), p: r('pattern'), o: r('overlay') }; });
  const overlaps = (a, b) => b.w > 0 && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  ok(!overlaps(boxes.f, boxes.p) && !overlaps(boxes.f, boxes.o), 'Nothing on the TV covers the YouTube player (title and pattern in a side column)', JSON.stringify(boxes));
  await tv.screenshot({ path: path.join(OUT, 'v21-tv-youtube.png') });
  // pause / resume
  await cmd('togglePlay'); await sleep(1200);
  const p1 = (await state()).playback.position; await sleep(1200); const p2 = (await state()).playback.position;
  ok((await state()).playback.status === 'paused' && Math.abs(p2 - p1) < 0.3, 'Pause stops the YouTube player', `${p1.toFixed(1)} → ${p2.toFixed(1)}`);
  await cmd('togglePlay');
  // clip end: jump to 2 s before the end of the 20-second clip
  const pb = (await state()).playback;
  await cmd('seek', { position: pb.clipEnd - 2 });
  const ended = await waitFor(async () => { const g = await state(); return g.history.some(h => h.songId === yt1.id) ? g : null; }, 15000);
  ok(!!ended, 'At the clip end the song counts as played, like any video');
  // a video whose owner blocks playing elsewhere: skipped like an unplayable file
  const bad = yts.find(s => s.youtubeId === 'errorvid001');
  await cmd('queueSong', { songId: bad.id }); await cmd('next', { mode: 'skip' });
  const err = await waitFor(async () => { const g = await state(); return /does not allow it to be played in other apps/.test(g.lastError || '') ? g : null; }, 20000);
  ok(!!err && !err.history.some(h => h.songId === bad.id), 'A video that YouTube refuses is reported and never counted as played', err && err.lastError);
  /* second screen: the YouTube player there is muted */
  const yt2 = yts.find(s => s.youtubeId === 'okvideo0002');
  await cmd('queueSong', { songId: yt2.id }); await cmd('next', { mode: 'skip' }); await sleep(1500);
  await inv('audience:openMirror', {});
  const mir = await waitFor(async () => { for (const p of app.windows()) { if (/mirror=1/.test(await p.url())) return p; } return null; }, 10000);
  await mir.waitForLoadState('domcontentloaded');
  await mir.evaluate(() => { window.__m = []; window.addEventListener('message', (e) => { try { window.__m.push(JSON.parse(e.data)); } catch (x) { /* */ } }); });
  const muted = await waitFor(async () => mir.evaluate(() => (window.__m || []).some(m => m.event === 'infoDelivery' && m.info && m.info.muted === true) && /okvideo0002/.test((document.getElementById('ytFrame') || {}).src || '')), 15000);
  ok(!!muted, 'The second screen shows the same YouTube video, muted');
  await inv('audience:closeMirror');
  /* back to a local video: normal TV layout again */
  const histIds = (await state()).history.map(h => h.songId); const inGame = new Set((await state()).order.map(o => o.songId));
  const local = songs.find(x => x.source !== 'youtube' && inGame.has(x.id) && !histIds.includes(x.id));
  await cmd('queueSong', { songId: local.id }); await cmd('next', { mode: 'skip' });
  const back = await waitFor(async () => tv.evaluate(() => !document.body.classList.contains('yt-mode') && !document.getElementById('ytFrame') && !!document.getElementById('video').getAttribute('src')), 15000);
  ok(!!back, 'A local video after a YouTube song: normal layout, YouTube player removed');
  if (!back) console.log('DIAG', JSON.stringify(await tv.evaluate(() => ({ yt: document.body.classList.contains('yt-mode'), frame: !!document.getElementById('ytFrame'), src: document.getElementById('video').getAttribute('src') }))), JSON.stringify((await state()).current), (await state()).playback.status, (await state()).lastError, local && local.title);
  await app.close(); srv.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
