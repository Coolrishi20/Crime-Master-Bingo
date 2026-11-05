/* v1.3 end-to-end: folders → playlists, AVI conversion in the app, welcome & end TV screens,
 * live camera QR scanning on the phone over the secure link (fake camera playing a QR code).
 * Run: xvfb-run -a node test/e2e/v13-check.js <samplesDir> */
const { _electron: electron, chromium } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const { execFileSync } = require('child_process');
const QRCode = require('qrcode');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const results = []; const ok = (c, n, d = '') => { const l = `${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`; results.push(l); console.log(l); if (!c) failed++; };
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { /* */ } await sleep(300); } return null; };
(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-v13-'));
  // build a folder tree: Decades/<folder>/videos, plus an AVI that needs converting
  const TREE = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-tree-'));
  const samples = fs.readdirSync(process.argv[2]).filter(f => f.endsWith('.mp4')).sort();
  const folders = ['80s', '90s', '00s'];
  samples.forEach((f, i) => { const d = path.join(TREE, 'Decades', folders[i % 3]); fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(path.join(process.argv[2], f), path.join(d, f)); });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=500', '-t', '5', '-c:v', 'mpeg4', '-c:a', 'mp3', '-shortest', path.join(TREE, 'Decades', '80s', 'Old Skool - Converted Classic.avi')]);

  const app = await electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1' }) });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings); await host.evaluate(async () => { await window.cmb.invoke('settings:update', { gameDefaults: { screens: { welcome: true, end: true }, tvScreens: { winner: true, wrongClaim: true, showCardNumber: false, showName: true, closeCount: true, seconds: 7 } } }); window.App.settings = await window.cmb.invoke('settings:get'); }); // 2.3 made these TV extras opt-in; these tests cover them
  host.on('pageerror', e => ok(false, 'host page error', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  const cmd = (a, b) => inv('game:cmd', { action: a, args: b || {} });

  /* folders → playlists */
  const r = await inv('library:importFolderPlaylists', { folder: path.join(TREE, 'Decades') });
  ok(JSON.stringify(r.playlists.map(p => p.name)) === JSON.stringify(['00s', '80s', '90s']), 'Each decade folder became a playlist', r.playlists.map(p => `${p.name} (${p.total})`).join(', '));
  ok(r.totals.converting === 1, 'The AVI was imported and queued for conversion (not refused)');
  await host.evaluate(() => App.show('library')); await sleep(1500);
  await host.screenshot({ path: path.join(OUT, 'v13-library-converting.png') });
  const conv = await waitFor(async () => { const s = (await inv('library:list')).songs.find(x => x.fileName.endsWith('.avi')); return s && s.converted && s.status === 'ok' ? s : null; }, 90000);
  ok(!!conv && conv.path.endsWith('.mp4') && conv.height > 0, 'AVI converted to MP4 and passed the playability check in the app', conv ? `${conv.width}x${conv.height}, ${conv.duration}s` : 'not converted');
  ok(!!conv && fs.existsSync(path.join(TREE, 'Decades', '80s', 'Old Skool - Converted Classic.avi')), 'Original AVI left untouched');
  await host.evaluate(() => App.show('library')); await sleep(800);
  await host.screenshot({ path: path.join(OUT, 'v13-library-converted.png') });
  await host.evaluate(() => App.show('playlists')); await sleep(800);
  await host.screenshot({ path: path.join(OUT, 'v13-playlists.png') });

  /* game from a merged playlist (need ≥ 40) — wait until every video has been checked */
  await waitFor(async () => !(await inv('library:list')).songs.some(x => ['unchecked', 'needs-conversion', 'converting'].includes(x.status)), 120000);
  const all = (await inv('library:list')).songs;
  const big = await inv('playlists:create', { name: 'Everything' }); await inv('playlists:add', { id: big.id, songIds: all.map(s => s.id) });
  const g = await inv('games:create', { name: 'Decades Night', venue: 'The Crown', playlistId: big.id, cards: 20, settings: { clipMode: 'full', autoAdvanceGap: 1 } });
  const soon = new Date(Date.now() + 75 * 60000); const hhmm = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
  await cmd('setScreens', { startTime: hhmm, message: 'Grab your bingo cards at the bar!' });
  await inv('audience:open'); await sleep(2500);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => { if (w.getTitle().includes('Audience')) w.setContentSize(1600, 900); }));
  const aud = app.windows().find(w => w.url().includes('audience'));
  await sleep(1500);
  const wl = await aud.evaluate(() => ({ shown: !document.getElementById('welcome').classList.contains('hidden'), name: document.getElementById('wlName').textContent, count: document.getElementById('wlCount').textContent, msg: document.getElementById('wlMsg').textContent }));
  ok(wl.shown && wl.name === 'Decades Night' && /to go/.test(wl.count) && /bar/.test(wl.msg), 'Welcome screen with event name, countdown and message before Round 1', `${wl.count}`);
  await aud.screenshot({ path: path.join(OUT, 'v13-tv-welcome.png') });
  await cmd('startRound', { round: 1 });
  ok(!!(await waitFor(() => aud.evaluate(() => document.getElementById('welcome').classList.contains('hidden') && !document.getElementById('video').paused), 10000)), 'Welcome screen disappears when Round 1 starts');
  await waitFor(async () => (await inv('game:state')).game.history.length >= 2, 30000);

  /* live QR scanning over the secure link with a fake camera */
  const game = JSON.parse(fs.readFileSync(path.join(DATA, 'games', g.id + '.json'), 'utf8'));
  const qrPng = path.join(OUT, 'qr-card7.png'); await QRCode.toFile(qrPng, `CMB1|${game.id}|7`, { width: 360, margin: 4 });
  const y4m = path.join(OUT, 'qr-card7.y4m');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', qrPng, '-vf', 'pad=640:480:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p', '-t', '2', '-r', '15', y4m]);
  const ri = await inv('remote:info');
  ok(!!ri.secureUrl && ri.secureMode, 'Secure phone link offered in the QR code', ri.secureUrl);
  const br = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true /* = the one-time “Proceed” */, permissions: ['camera'] });
  const phone = await ctx.newPage(); phone.on('pageerror', e => ok(false, 'phone page error', e.message));
  await phone.goto(`https://127.0.0.1:${ri.httpsPort}/#pin=${ri.pin}`); await phone.reload();
  ok(!!(await waitFor(() => phone.textContent('#connTxt').then(t => t === 'Connected'), 15000)), 'Phone connects over the secure link (https + wss)');
  ok(await phone.evaluate(() => window.isSecureContext && !!navigator.mediaDevices), 'Secure context: camera available to the page');
  await phone.click('#bingoFab'); await phone.waitForSelector('#checker:not(.hidden)');
  await phone.click('#ckScan');
  const v = await waitFor(() => phone.textContent('#ckResult .hl').then(t => /Card #007/.test(t) ? t : null), 20000);
  ok(!!v, 'Live camera scan read card 007 and checked it — no photo needed', v || '');
  await phone.screenshot({ path: path.join(OUT, 'v13-phone-livescan.png'), fullPage: true });
  const s = (await inv('game:state')).game.session;
  for (const c of s.claims) if (['pending', 'invalid'].includes(c.status)) await cmd('dismissClaim', { claimId: c.claimId, quiet: true });
  await cmd('closeSession', {});
  await br.close();

  /* end-of-night screen */
  await cmd('endGame');
  ok(!!(await waitFor(() => aud.evaluate(() => !document.getElementById('endscreen').classList.contains('hidden') && document.querySelectorAll('#esList .es-item').length > 0), 8000)), 'End-of-night screen shows “Thanks for playing!” and the played-song list');
  const hist = (await inv('game:state')).game.history.length;
  ok(await aud.evaluate((n) => document.querySelectorAll('#esList .es-item').length === n, hist), 'Every played song listed', `${hist} songs`);
  ok(!(await aud.evaluate(() => /CARD\s*\d|Card #/i.test(document.getElementById('endscreen').innerText))), 'No card numbers on the end screen');
  await sleep(1200);
  await aud.screenshot({ path: path.join(OUT, 'v13-tv-end.png') });
  await host.evaluate(() => App.show('mobile')); await sleep(900);
  await host.screenshot({ path: path.join(OUT, 'v13-mobile-secure.png') });
  await app.close();
  fs.writeFileSync(path.join(OUT, 'v13-results.txt'), results.join('\n') + `\n\n${results.length - failed} passed, ${failed} failed\n`);
  console.log(failed ? `${failed} failed` : 'all passed'); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('CRASHED', e); process.exit(2); });
