/* Skip quiet intros + artist spacing, end-to-end in the real app: real ffmpeg loudness analysis
 * of videos with an 8 s silent opening, the library shows the detected intro, Up Next says it is
 * skipped, the TV video actually starts at ~7 s, the host can switch it off; a shuffled game never
 * plays the same artist back to back.
 * Run: xvfb-run -a node test/e2e/v19-intros-artists.js <samplesDir> <introVideosDir> */
const { _electron: electron } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const ok = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failed++; };
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { } await sleep(300); } return null; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'as-intro-'));
  const app = await electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1', CMB_NO_REMOTE: '1' }) });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings);
  host.on('pageerror', e => ok(false, 'host page error', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  const cmd = (a, b) => inv('game:cmd', { action: a, args: b || {} });

  await inv('library:importPaths', [process.argv[2], process.argv[3]]);
  await waitFor(async () => { const l = (await inv('library:list')).songs; return l.length >= 52 && !l.some(s => s.status === 'unchecked'); }, 180000);
  // the volume analysis (ffmpeg) runs in the background; wait for the two intro videos
  const analysed = await waitFor(async () => { const l = (await inv('library:list')).songs.filter(s => /Quiet Start/.test(s.title)); return l.length === 2 && l.every(s => s.audio && s.audio.status === 'done') ? l : null; }, 240000);
  ok(!!analysed, 'Volume analysis finished for the videos with a silent opening');
  const intros = analysed ? analysed.map(s => s.audio.introEnd) : [];
  ok(intros.length === 2 && intros.every(t => t >= 6.5 && t <= 8), 'Detected intro ≈ 7 s for 8 s of silence (starts just before the music)', intros.join(', '));
  const plain = await waitFor(async () => { const l = (await inv('library:list')).songs.filter(s => !/Quiet Start/.test(s.title) && s.audio && s.audio.status === 'done'); return l.length >= 5 ? l : null; }, 120000);
  ok(!!plain && plain.slice(0, 5).every(s => !(s.audio.introEnd > 0)), 'Videos whose music starts straight away are left alone', plain && plain.slice(0, 5).map(s => s.audio.introEnd).join(','));

  await host.evaluate(() => App.show('library')); await sleep(1500);
  ok(/from 0:0[67] \(intro\)/.test(await host.textContent('#main')), 'Music Library shows where those songs will start');

  // a game: intro videos first in the queue
  const songs = (await inv('library:list')).songs;
  const pl = await inv('playlists:create', { name: 'Intro test' }); await inv('playlists:add', { id: pl.id, songIds: songs.map(s => s.id) });
  const g = await inv('games:create', { name: 'Intro Night', playlistId: pl.id, cards: 4, settings: { clipMode: 20, autoAdvance: false } });
  const st0 = (await inv('game:state')).game;
  const order = st0.order.map(o => o.artist.toLowerCase());
  ok(order.every((a, i) => !i || a !== order[i - 1]), 'Shuffled play order never has the same artist back to back', `${order.length} songs, ${new Set(order).size} artists`);
  const introSong = analysed[0];
  await cmd('queueSong', { songId: introSong.id });
  await host.evaluate(() => App.show('host')); await sleep(1200);
  const un = await host.textContent('#hgUpNext');
  ok(/starts at 0:0[67] \(quiet intro skipped\)/.test(un), 'Up Next: “starts at 0:07 (quiet intro skipped)”', (un.match(/starts at[^·]*/) || [''])[0]);

  await inv('audience:open');
  const tv = await waitFor(async () => { for (const p of app.windows()) { if (/audience/.test(await p.url())) return p; } return null; });
  await tv.waitForLoadState('domcontentloaded');
  await cmd('startRound', { round: 1 });
  const t0 = await waitFor(async () => { const t = await tv.evaluate(() => { const v = document.getElementById('video'); return v && !v.paused && v.currentTime > 0 ? v.currentTime : 0; }); return t || null; }, 20000);
  ok(t0 && t0 >= 6.4 && t0 < 10, 'The TV video starts at the music, not at the silent opening', 'currentTime ' + (t0 && t0.toFixed(1)));
  await host.screenshot({ path: path.join(OUT, 'v19-host-intro.png') });

  // host switches it off → next song from the very beginning
  await host.click('label:has(#cIntro)'); await sleep(700);
  ok((await inv('game:state')).game.settings.skipIntros === false, 'Host can switch “Skip quiet intros” off from the console');
  await cmd('queueSong', { songId: analysed[1].id });
  await sleep(300);
  const un2 = await host.textContent('#hgUpNext');
  ok(/starts at 0:00/.test(un2) && !/intro skipped/.test(un2), 'Switched off: the next song starts from 0:00');
  await app.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
