/* M3U playlists end-to-end (real app): Playlists → Import M3U… (VLC-style .m3u8 with #EXTINF,
 * relative + absolute + file:// paths, a missing file, a stream), report modal, playlist order,
 * game from the imported playlist, Export M3U…, and .m3u dropped/picked in the Music Library.
 * Run: xvfb-run -a node test/e2e/v18-m3u.js <samplesDir> */
const { _electron: electron } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os'); const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const ok = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failed++; };
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { } await sleep(250); } return null; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'as-m3u-'));
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'as-m3u-media-'));
  const vids = fs.readdirSync(process.argv[2]).filter(f => f.endsWith('.mp4')).sort().slice(0, 50);
  fs.mkdirSync(path.join(DIR, 'Videos'));
  vids.forEach(f => fs.copyFileSync(path.join(process.argv[2], f), path.join(DIR, 'Videos', f)));
  // a VLC-style playlist: mixed path styles, EXTINF labels, one missing file, one stream, reversed order
  const order = vids.slice().reverse();
  const lines = ['#EXTM3U', '#PLAYLIST:Quiz Night Anthems'];
  order.forEach((f, i) => {
    lines.push(`#EXTINF:12,${f.replace(/\.mp4$/, '')}`);
    lines.push(i % 3 === 0 ? 'Videos\\' + f : i % 3 === 1 ? path.join(DIR, 'Videos', f) : pathToFileURL(path.join(DIR, 'Videos', f)).href);
  });
  lines.push('#EXTINF:200,Nobody - Missing Song', 'Videos/missing.mp4', 'https://radio.example/live');
  const LIST = path.join(DIR, 'Quiz Night Anthems.m3u8'); fs.writeFileSync(LIST, '﻿' + lines.join('\r\n'));

  const app = await electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1', CMB_NO_REMOTE: '1' }) });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings);
  host.on('pageerror', e => ok(false, 'host page error', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  const setOpen = (files) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: f }); }, files);
  const setSave = (file) => app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, file);

  /* Playlists → Import M3U… */
  // the app opens its own first screen during start-up; wait for Playlists to stay put
  let tries = 0;
  await waitFor(async () => { tries++; await host.evaluate(() => App.show('playlists')); await sleep(1500); return host.isVisible('#pM3U'); }, 30000);
  if (tries > 1) console.log('NOTE  Playlists screen needed ' + tries + ' attempts to show during start-up');
  if (!(await host.isVisible('#pM3U'))) { await host.screenshot({ path: path.join(OUT, 'v18-debug.png') }); console.log('DEBUG view', await host.evaluate(() => App.view), 'MAIN', (await host.evaluate(() => document.getElementById('main').innerHTML)).slice(0, 400)); }
  await setOpen([LIST]);
  await host.click('#pM3U');
  await host.waitForSelector('.modal-back');
  const rep = await host.textContent('.modal-back');
  ok(/Quiz Night Anthems/.test(rep) && /NEW/.test(rep) && /50 song\(s\) added/.test(rep), 'Import M3U… creates the playlist with all 50 videos', rep.slice(0, 160).replace(/\s+/g, ' '));
  ok(/1 file\(s\) not found/.test(rep) && /Missing Song/.test(rep) && /online stream/.test(rep), 'Report names the missing file (with its line) and the skipped stream');
  await host.screenshot({ path: path.join(OUT, 'v18-m3u-report.png') });
  await host.evaluate(() => closeTopModal());
  const pls = await inv('playlists:list'); const pl = pls.find(p => p.name === 'Quiz Night Anthems');
  const lib = (await inv('library:list')).songs; const byId = new Map(lib.map(s => [s.id, s]));
  ok(pl && pl.songIds.map(id => byId.get(id).fileName).join('|') === order.join('|'), 'Playlist keeps the M3U order (reversed on purpose here)');
  // videos get checked like any import, then the playlist is ready for a game
  const ready = await waitFor(async () => { const p = (await inv('playlists:list')).find(x => x.id === pl.id); return p.validation.uniquePlayable === 50 ? p : null; }, 120000);
  ok(!!ready && ready.validation.uniquePlayable === 50, 'Imported playlist is ready for a game (50 unique playable songs)', ready && ready.validation.uniquePlayable);
  const g = await inv('games:create', { name: 'From M3U', playlistId: pl.id, cards: 4 });
  ok(g && g.songs === 50, 'A game can be created from the imported playlist');
  await inv('games:close');

  /* re-import: nothing doubles */
  const again = await inv('playlists:importM3UFiles', { files: [LIST] });
  ok(again[0].addedToPlaylist === 0 && again[0].alreadyInPlaylist === 50 && again[0].newToLibrary === 0, 'Importing the same M3U again adds nothing twice');

  /* Export M3U… from the playlist page */
  await host.evaluate(() => App.show('playlists')); await host.waitForSelector('#pExp');
  const EXP = path.join(DIR, 'exported.m3u8'); await setSave(EXP);
  await host.click('#pExp'); await waitFor(() => fs.existsSync(EXP), 5000);
  const txt = fs.existsSync(EXP) ? fs.readFileSync(EXP, 'utf8') : '';
  const entries = txt.split(/\r\n/).filter(l => l && !l.startsWith('#'));
  ok(txt.startsWith('#EXTM3U') && entries.length === 50 && entries.every(l => !path.isAbsolute(l)), 'Export M3U… writes 50 entries with paths relative to the playlist (portable)');
  ok(entries[0] === path.join('Videos', order[0]), 'Exported order matches', entries[0]);

  /* Music Library: an .m3u picked with Import videos… (and the same path used by drag & drop) */
  const L2 = path.join(DIR, 'short list.m3u'); fs.writeFileSync(L2, vids.slice(0, 3).map(f => 'Videos/' + f).join('\n'));
  await host.evaluate(() => App.show('library')); await host.waitForSelector('#lFiles');
  await setOpen([L2]);
  await host.click('#lFiles');
  await host.waitForSelector('.modal-back');
  ok(/short list/.test(await host.textContent('.modal-back')), 'Music Library → Import videos… accepts an .m3u and makes a playlist');
  await host.evaluate(() => closeTopModal());
  const dropped = await inv('library:importPaths', [L2, path.join(DIR, 'Videos', vids[5])]);
  ok(dropped.m3u && dropped.m3u[0].playlistName === 'short list' && dropped.alreadyInLibrary.length === 1, 'Dropping an .m3u together with videos imports both');

  await app.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
