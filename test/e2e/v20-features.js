/* 1.9 features end-to-end (real app): game templates, tags + playlist builder, song check
 * run-through, intermission slides on the TV, second TV screen (silent mirror).
 * Run: xvfb-run -a node test/e2e/v20-features.js <samplesDir> <slidesDir> */
const { _electron: electron } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const ok = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failed++; };
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { } await sleep(250); } return null; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'as-v19-'));
  const SLIDES = process.argv[3];
  const app = await electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1', CMB_NO_REMOTE: '1' }) });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings);
  host.on('pageerror', e => ok(false, 'host page error', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  const cmd = (a, b) => inv('game:cmd', { action: a, args: b || {} });
  const show = async (v, sel) => { await waitFor(async () => { await host.evaluate((x) => App.show(x), v); await sleep(900); return !sel || host.isVisible(sel); }, 20000); };

  await inv('library:importPaths', [process.argv[2]]);
  await waitFor(async () => { const l = (await inv('library:list')).songs; return l.length >= 50 && !l.some(s => s.status === 'unchecked'); }, 180000);
  const songs = (await inv('library:list')).songs;
  const pl = await inv('playlists:create', { name: 'All 50' }); await inv('playlists:add', { id: pl.id, songIds: songs.map(s => s.id) });

  /* ---------- tags + builder */
  await inv('library:bulkTag', { ids: songs.slice(0, 30).map(s => s.id), year: 1986 });
  await inv('library:bulkTag', { ids: songs.slice(30).map(s => s.id), year: 1997 });
  await inv('library:bulkTag', { ids: songs.filter((_, i) => i % 2 === 0).map(s => s.id), add: 'Bollywood' });
  await show('library', '#lTag');
  const opts = await host.$$eval('#lTag option', o => o.map(x => x.textContent));
  ok(opts.includes('1980s (30)') && opts.includes('Bollywood (25)'), 'Library filter lists decades and tags with counts', opts.join(' | '));
  await host.selectOption('#lTag', 'd:1990s'); await sleep(400);
  ok((await host.$$('#lBody tr[data-id]')).length === 20, 'Filter by decade shows only those songs');
  await show('playlists', '#pBuild');
  await host.click('#pBuild'); await host.waitForSelector('[data-d="1980s"]');
  await host.click('[data-d="1980s"]'); await host.click('[data-t="Bollywood"]');
  await waitFor(async () => /15<\/b> song/.test(await host.innerHTML('#bInfo')), 5000);
  ok(/<b>15<\/b> song\(s\) match/.test(await host.innerHTML('#bInfo')), '1980s AND Bollywood → 15 matching songs, with a 40-minimum warning', (await host.textContent('#bInfo')));
  await host.click('[data-t="Bollywood"]'); await sleep(400);
  await host.fill('#bN', '25'); await host.dispatchEvent('#bN', 'input'); await sleep(300);
  await host.screenshot({ path: path.join(OUT, 'v20-builder.png') });
  await host.click('.modal-foot button:has-text("Build playlist")');
  const built = await waitFor(async () => (await inv('playlists:list')).find(p => p.name === '1980s'));
  ok(built && built.songIds.length === 25, 'Builder made “1980s” with 25 random songs from that decade', built && built.songIds.length);

  /* ---------- song check run-through (on the built playlist, quickly) */
  await show('playlists', '#pCheck');
  await host.evaluate((id) => { const r = document.querySelector(`#pList [data-id="${id}"]`); if (r) r.click(); }, built.id);
  await host.waitForSelector('#pCheck'); await sleep(500);
  await host.click('#pCheck');
  await host.waitForSelector('#scV');
  const playing = await waitFor(async () => host.evaluate(() => { const v = document.getElementById('scV'); return v && !v.paused && v.currentTime > 0; }), 10000);
  ok(!!playing && /Song 1 of 25/.test(await host.textContent('#scN')), 'Song check plays song 1 of 25 on the laptop', await host.textContent('#scStart'));
  ok(await host.evaluate(() => { for (const w of []) return false; return true; }) && !(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => /audience/.test(w.webContents.getURL())))), 'The TV is not used by the song check');
  await host.evaluate(() => window.__songCheck.next()); await sleep(600);
  await host.click('#scFlags [data-r="Bad start"]'); await sleep(500);
  ok(/Flagged: Bad start/.test(await host.textContent('#scFlagNow')), 'One tap flags “Bad start” on song 2');
  await host.screenshot({ path: path.join(OUT, 'v20-songcheck.png') });
  const auto = await waitFor(async () => /Song 3 of 25/.test(await host.textContent('#scN')), 9000);
  ok(!!auto, 'Moves on by itself after the chosen seconds');
  await host.evaluate(() => { const b = [...document.querySelectorAll('.modal-back .btn')].find(x => x.textContent === 'Stop'); b.click(); });
  await waitFor(async () => /Song check finished/.test(await host.textContent('.modal-back')), 5000);
  ok(/1 flagged/.test(await host.textContent('.modal-back')), 'Summary lists the flagged song');
  await host.evaluate(() => closeTopModal());
  const flaggedSongs = (await inv('library:list')).songs.filter(s => s.flag);
  ok(flaggedSongs.length === 1 && flaggedSongs[0].flag.reason === 'Bad start', 'Flag saved on the song (Music Library → Flagged)');

  /* ---------- templates */
  const t = await inv('templates:save', { name: 'Friday Checklist', playlistId: pl.id, cards: 12, venue: 'The Red Lion', settings: { mode: 'checklist', clipMode: 20, skipIntros: false, checklist: [{ id: 'a', rule: { id: 'line' } }, { id: 'b', rule: { id: 'full' } }] } });
  ok(t && t.settings.mode === 'checklist' && t.settings.rounds && t.cards === 12, 'Template saved with the game set-up');
  await show('create', '#gTplSel'); await host.evaluate(() => App.show('create', 'new')); await host.waitForSelector('#gTplSel', { timeout: 10000 });
  await host.selectOption('#gTplSel', t.id); await sleep(800);
  ok(await host.isChecked('input[name=gmode][value=checklist]') && (await host.$$('#gCk .ck-row')).length === 2, 'Choosing the template fills in the mode and checklist');
  await host.fill('#gName', 'From template');
  await host.click('#cNext'); await host.waitForSelector(`input[name=pl][value="${pl.id}"]`);
  ok(await host.isChecked(`input[name=pl][value="${pl.id}"]`), 'Template pre-selects its playlist');
  await host.click('#cNext'); await host.waitForSelector('#gClip');
  ok(/on/.test(await host.getAttribute('#gClip button[data-m="20"]', 'class')) && !(await host.isChecked('#gIntro')), 'Template clip length (20 s) and intro setting applied');
  await host.click('#cNext'); await host.waitForSelector('#gPP'); await host.click('#cNext'); await host.waitForSelector('#gCards');
  ok((await host.inputValue('#gCards')) === '12', 'Template card count applied');
  await host.click('#cNext');
  const gT = await waitFor(async () => { const g = (await inv('game:state')).game; return g && g.name === 'From template' ? g : null; });
  ok(gT && gT.mode === 'checklist' && gT.checklist.total === 2 && gT.settings.clipMode === 20 && gT.settings.skipIntros === false && gT.totals.cards === 12, 'Game created from the template has its rules, clips and cards');
  const t2 = await inv('templates:save', { name: 'Copy of that night', fromGameId: gT.gameId });
  ok(t2.settings.mode === 'checklist' && t2.cards === 12, 'Game History → Save as template copies a played game’s set-up');

  /* ---------- intermission slides */
  await inv('slides:add', { files: [path.join(SLIDES, 'slide1.png'), path.join(SLIDES, 'slide2.png')] });
  await inv('slides:set', { seconds: 3 });
  const gR = await inv('games:create', { name: 'Slides night', playlistId: pl.id, cards: 4, settings: { mode: 'rounds' } });
  await inv('audience:open');
  const tv = await waitFor(async () => { for (const p of app.windows()) { if (/audience/.test(await p.url()) && !/mirror=1/.test(await p.url())) return p; } return null; });
  await tv.waitForLoadState('domcontentloaded');
  await cmd('startRound', { round: 1 }); await sleep(2500);
  await cmd('startIntermission', { minutes: 10, message: 'Back soon — two for one at the bar' });
  const on = await waitFor(async () => tv.evaluate(() => document.getElementById('intermission').classList.contains('with-slides') && [...document.querySelectorAll('.im-slides img.on')].some(i => i.naturalWidth > 0)), 8000);
  ok(!!on, 'TV intermission shows the host’s slides');
  ok(/BACK IN/.test(await tv.textContent('#imBandCount')) && /two for one/.test(await tv.textContent('#imBandMsg')), 'Countdown and message stay visible in the band', await tv.textContent('#imBandCount'));
  const src1 = await tv.evaluate(() => document.querySelector('.im-slides img.on').src);
  await sleep(3800);
  const src2 = await tv.evaluate(() => document.querySelector('.im-slides img.on').src);
  ok(src1 !== src2, 'Slides rotate every few seconds');
  await tv.screenshot({ path: path.join(OUT, 'v20-tv-slides.png') });
  await cmd('endIntermission');
  ok(!!(await waitFor(async () => !(await tv.evaluate(() => document.getElementById('intermission').classList.contains('with-slides'))), 5000)), 'Slides stop when the intermission ends');

  /* ---------- second TV (mirror) */
  await cmd('startRound', { round: 1 }).catch(() => {}); await cmd('play').catch(() => {});
  await sleep(1500);
  const r = await inv('audience:openMirror', {});
  ok(r.open, 'Second screen opens');
  const mir = await waitFor(async () => { for (const p of app.windows()) { if (/mirror=1/.test(await p.url())) return p; } return null; }, 10000);
  ok(!!mir, 'Second window loaded in mirror mode');
  const synced = await waitFor(async () => { const a = await tv.evaluate(() => ({ src: document.getElementById('video').currentSrc, t: document.getElementById('video').currentTime })); const b = await mir.evaluate(() => ({ src: document.getElementById('video').currentSrc, t: document.getElementById('video').currentTime, muted: document.getElementById('video').muted || document.getElementById('video').volume === 0 })); return a.src && a.src === b.src && b.t > 0 && Math.abs(a.t - b.t) < 1.2 && b.muted ? { a, b } : null; }, 15000);
  ok(!!synced, 'Second screen shows the same song, in step, and silent', synced ? `TV ${synced.a.t.toFixed(1)}s / TV2 ${synced.b.t.toFixed(1)}s` : 'not in sync');
  const before = (await inv('game:state')).game.playback.index;
  await mir.evaluate(() => window.cmb.invoke('player:ended', { token: 999999 }));
  await sleep(500);
  ok((await inv('game:state')).game.playback.index === before, 'The second screen can never move the game on');
  await mir.screenshot({ path: path.join(OUT, 'v20-tv2.png') });
  await inv('audience:closeMirror');
  ok(!(await inv('audience:mirrorStatus')).open, 'Second screen closes');
  await app.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
