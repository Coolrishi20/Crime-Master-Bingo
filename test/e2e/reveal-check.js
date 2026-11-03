// v1.2: delayed title reveal on the real TV window (+ screenshots). Run under xvfb-run.
const { _electron: electron } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const ok = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failed++; };
(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-rev-'));
  const app = await electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1', CMB_NO_REMOTE: '1' }) });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  const cmd = (a, b) => inv('game:cmd', { action: a, args: b || {} });
  await inv('library:importPaths', [process.argv[2]]);
  for (let i = 0; i < 100; i++) { if (!(await inv('library:list')).songs.some(s => s.status === 'unchecked')) break; await sleep(400); }
  const songs = (await inv('library:list')).songs;
  const pl = await inv('playlists:create', { name: 'Reveal' }); await inv('playlists:add', { id: pl.id, songIds: songs.map(s => s.id) });
  // Set the default in Settings (as a host would), then create a game that inherits it
  await inv('settings:update', { gameDefaults: { overlay: { revealDelay: 4 } } });
  const g = await inv('games:create', { name: 'Reveal Night', playlistId: pl.id, cards: 10, settings: { clipMode: 'full', autoAdvanceGap: 2 } });
  ok((await inv('game:state')).game.settings.overlay.revealDelay === 4, 'Settings default (4 s) carried into the new game');
  await inv('audience:open'); await sleep(2500);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => { if (w.getTitle().includes('Audience')) w.setContentSize(1600, 900); }));
  const aud = app.windows().find(w => w.url().includes('audience'));
  await cmd('startRound', { round: 1 });
  await aud.waitForFunction(() => !document.getElementById('video').paused && document.getElementById('video').currentTime > 0.6, null, { timeout: 15000 });
  const t1 = await aud.evaluate(() => ({ title: document.getElementById('ovTitle').textContent, sub: document.getElementById('ovArtist').textContent, hidden: document.getElementById('overlay').classList.contains('hidden') }));
  const cur = (await inv('game:state')).game.current;
  ok(!t1.hidden && /Guess the song/.test(t1.title) && /Title in \ds/.test(t1.sub), 'TV shows the “Guess the song…” teaser with a countdown', `${t1.title} / ${t1.sub}`);
  ok(cur && cur.title && cur.title !== t1.title, 'Host still sees the real title immediately', cur.title);
  await aud.screenshot({ path: path.join(OUT, 'v12-tv-teaser.png') });
  // pause: countdown must not advance
  await cmd('pause'); const a = await aud.evaluate(() => document.getElementById('ovArtist').textContent); await sleep(2500); const b = await aud.evaluate(() => document.getElementById('ovArtist').textContent);
  ok(a === b && /Title in/.test(b), 'Countdown pauses while the music is paused', b);
  await cmd('play');
  await aud.waitForFunction((t) => document.getElementById('ovTitle').textContent === t, cur.title, { timeout: 8000 }).catch(() => {});
  const t2 = await aud.evaluate(() => ({ title: document.getElementById('ovTitle').textContent, artist: document.getElementById('ovArtist').textContent, at: document.getElementById('video').currentTime }));
  ok(t2.title === cur.title && t2.artist === cur.artist && t2.at >= 3.9, 'Real title and artist revealed after 4 seconds of play', `${t2.title} at ${t2.at.toFixed(1)}s`);
  await sleep(700);
  await aud.screenshot({ path: path.join(OUT, 'v12-tv-revealed.png') });
  // switch off live from the host → next song shows immediately
  await cmd('setOverlay', { revealDelay: 0 });
  await cmd('next', { mode: 'skip' });
  await aud.waitForFunction(() => !document.getElementById('video').paused && document.getElementById('video').currentTime > 0.5, null, { timeout: 15000 });
  const t3 = await aud.evaluate(() => document.getElementById('ovTitle').textContent);
  await sleep(400); const t3b = await aud.evaluate(() => document.getElementById('ovTitle').textContent); const exp3 = (await inv('game:state')).game.current.title;
  ok(t3b === exp3, 'With reveal off, the next song shows its title immediately', 'tv=' + t3 + ' / ' + t3b + ' expected=' + exp3);
  await host.evaluate(() => App.show('settings')); await sleep(900);
  await host.evaluate(() => document.getElementById('oR').scrollIntoView({ block: 'center' })); await sleep(300);
  await host.screenshot({ path: path.join(OUT, 'v12-settings.png') });
  const st = await inv('update:status');
  ok(st.state === 'disabled' || st.mode, 'Update status available to the UI', st.state);
  await app.close();
  console.log(failed ? `${failed} failed` : 'all passed'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); process.exit(2); });
