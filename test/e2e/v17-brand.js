/* Anthem Square rebrand end-to-end (real app): name on every visible surface (laptop views, TV,
 * phone remote, player page, PDF), Dark default + Light switch that persists and reaches the phone,
 * old 'crime-master' theme value migrated, accessible button colours, and existing installs keep
 * using the original data folder. Run: xvfb-run -a node test/e2e/v17-brand.js <samplesDir> */
const { _electron: electron, chromium } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const ok = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failed++; };
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { } await sleep(250); } return null; };
const OLD = /crime\s*master/i;

(async () => {
  /* ---- 1. a normal install (no test data dir) keeps the ORIGINAL data folder */
  const XDG = fs.mkdtempSync(path.join(os.tmpdir(), 'as-xdg-'));
  let app = await electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_NO_SANDBOX: '1', CMB_NO_REMOTE: '1', XDG_CONFIG_HOME: XDG, CMB_DATA_DIR: '' }) });
  let host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings); await host.evaluate(async () => { await window.cmb.invoke('settings:update', { gameDefaults: { screens: { welcome: true, end: true }, tvScreens: { winner: true, wrongClaim: true, showCardNumber: false, showName: true, closeCount: true, seconds: 7 } } }); window.App.settings = await window.cmb.invoke('settings:get'); }); // 2.3 made these TV extras opt-in; these tests cover them
  const info = await host.evaluate(() => window.cmb.invoke('app:info'));
  ok(info.dataDir === path.join(XDG, 'Crime Master Bingo', 'data'), 'Existing installs keep their data: same folder as before the rename', info.dataDir);
  await app.close();

  /* ---- 2. old settings (theme 'crime-master') open in Dark Mode */
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'as-brand-'));
  fs.writeFileSync(path.join(DATA, 'settings.json'), JSON.stringify({ appearance: { logo: null, scale: 1, theme: 'crime-master' } }));
  const launch = () => electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1' }) });
  app = await launch(); host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings); await host.evaluate(async () => { await window.cmb.invoke('settings:update', { gameDefaults: { screens: { welcome: true, end: true }, tvScreens: { winner: true, wrongClaim: true, showCardNumber: false, showName: true, closeCount: true, seconds: 7 } } }); window.App.settings = await window.cmb.invoke('settings:get'); }); // 2.3 made these TV extras opt-in; these tests cover them
  host.on('pageerror', e => ok(false, 'host page error', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  ok((await host.title()) === 'Anthem Square', 'Window title is Anthem Square', await host.title());
  ok(await host.evaluate(() => document.documentElement.dataset.theme) === 'dark' && (await inv('settings:get')).appearance.theme === 'dark', 'Dark Mode is the default (old “crime-master” theme value migrated)');
  ok(await host.evaluate(() => { const i = document.querySelector('.as-logo img'); return i && i.naturalWidth > 0 && getComputedStyle(i).display !== 'none'; }), 'Sidebar shows the Anthem Square icon');
  ok((await host.$$('.nav-sec')).length === 4 && (await host.$$('#nav a:not([hidden]) svg.ico')).length === 10, 'Navigation grouped (Overview / Prepare / Play / Manage) with line icons');
  const btnCol = await host.evaluate(() => { const b = document.createElement('button'); b.className = 'btn primary'; document.body.appendChild(b); const s = getComputedStyle(b); const r = [s.color, s.backgroundColor]; b.remove(); return r; });
  ok(btnCol[0] === 'rgb(23, 23, 23)' && btnCol[1] === 'rgb(255, 91, 50)', 'Primary buttons: Dark Gray text on Vivid Orange Red (5.8:1)', btnCol.join(' on '));

  await inv('library:importPaths', [process.argv[2]]);
  await waitFor(async () => { const l = (await inv('library:list')).songs; return l.length >= 40 && !l.some(s => s.status === 'unchecked'); }, 120000);
  const songs = (await inv('library:list')).songs;
  const pl = await inv('playlists:create', { name: 'Brand night' }); await inv('playlists:add', { id: pl.id, songIds: songs.map(s => s.id) });
  const g = await inv('games:create', { name: 'Brand Night', playlistId: pl.id, cards: 6 });

  // every laptop view: no old name anywhere visible
  const views = ['dashboard', 'library', 'playlists', 'create', 'cards', 'host', 'mobile', 'history', 'backup', 'settings'];
  const leaks = [];
  for (const v of views) { await host.evaluate((x) => App.show(x), v); await sleep(700); const t = await host.evaluate(() => document.body.innerText); if (OLD.test(t)) leaks.push(v); }
  ok(!leaks.length, 'No “Crime Master” text on any laptop screen', leaks.join(', ') || 'checked ' + views.length + ' screens');
  await host.evaluate(() => App.show('dashboard')); await sleep(500);
  ok(/HEAR IT\. MARK IT\. OWN IT\./.test(await host.textContent('.as-hero')), 'Dashboard welcome card carries the tagline');
  await host.evaluate(() => App.show('settings')); await host.waitForSelector('#sTheme');
  ok(/HEAR IT\. MARK IT\. OWN IT\./.test(await host.textContent('.as-about')) && (await host.textContent('.as-about')).includes(info.version), 'Settings → About: logo, version and tagline');

  // phone remote + player page
  await inv('settings:update', { home: { phoneCards: true, joinOnTv: false } });
  await waitFor(async () => (await inv('remote:info')).running, 15000);
  const ri = await inv('remote:info');
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pair = await ctx.newPage(); pair.on('pageerror', e => ok(false, 'phone page error', e.message));
  const fav = await pair.request.get(`http://127.0.0.1:${ri.port}/brand/icon.svg`);
  ok(fav.status() === 200 && /svg/.test(fav.headers()['content-type']), 'Phone favicon / icon served');
  await pair.goto(`http://127.0.0.1:${ri.port}/`); await sleep(800);
  ok(/Anthem Square/.test(await pair.title()) && !OLD.test(await pair.evaluate(() => document.body.innerText)), 'Phone pairing screen branded Anthem Square', await pair.title());
  await pair.close();
  const phone = await ctx.newPage(); phone.on('pageerror', e => ok(false, 'phone page error', e.message));
  await phone.goto(`http://127.0.0.1:${ri.port}/#pin=${ri.pin}`); await phone.waitForSelector('#main:not(.hidden)', { timeout: 15000 });
  ok(await phone.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'Phone remote starts in Dark Mode');

  // theme switch in the real Settings UI → laptop + phone, and it survives a restart
  await host.selectOption('#sTheme', 'light');
  ok(!!(await waitFor(async () => (await host.evaluate(() => document.documentElement.dataset.theme)) === 'light', 5000)), 'Settings → Theme → Light switches the laptop at once');
  ok(!!(await waitFor(async () => (await phone.evaluate(() => document.documentElement.dataset.theme)) === 'light', 5000)), 'The phone remote follows the laptop to Light Mode');
  const bgLight = await host.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bgLight === 'rgb(255, 242, 207)', 'Light Mode background is Light Cream #FFF2CF', bgLight);
  await host.screenshot({ path: path.join(OUT, 'v17-settings-light.png') });
  const j = await inv('players:join');
  const pp = await ctx.newPage(); await pp.goto(j.url.replace(/\/\/[^:/]+:/, '//127.0.0.1:')); await pp.waitForSelector('#join:not(.hidden)');
  ok(/Anthem Square/.test(await pp.title()) && /ANTHEM/.test(await pp.textContent('#join')), 'Player join page branded');
  await br.close();

  // TV
  await inv('audience:open');
  const tv = await waitFor(async () => { for (const p of app.windows()) { if (/audience/.test(await p.url())) return p; } return null; });
  await tv.waitForLoadState('domcontentloaded'); await sleep(1200);
  ok(/Anthem Square/.test(await tv.title()) && !OLD.test(await tv.evaluate(() => document.body.innerText)), 'TV window branded, no old name', await tv.title());
  ok(await tv.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'TV stays dark even when the laptop is in Light Mode');
  ok(await tv.evaluate(() => [...document.querySelectorAll('.as-tvbrand img')].some(i => i.naturalWidth > 0 && i.getBoundingClientRect().width > 0)), 'TV welcome screen shows the icon');
  await tv.screenshot({ path: path.join(OUT, 'v17-tv-welcome.png') });

  // printed cards
  const pdf = path.join(DATA, 'cards.pdf'); await inv('cards:exportPdf', { id: g.id, file: pdf, range: '1-2', confirmLock: true });
  const txt = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
  ok(/ANTHEM/.test(txt) && /SQUARE/.test(txt) && !OLD.test(txt), 'Printed cards carry the new name, never the old one');
  const pages = execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }).match(/Pages:\s+(\d+)/)[1];
  ok(pages === '1', 'Still two cards per A4 sheet', pages + ' page for cards 1–2');
  execFileSync('pdftoppm', ['-r', '70', '-png', '-f', '1', '-l', '1', '-singlefile', pdf, path.join(OUT, 'v17-card')]);

  // restart: the theme choice is remembered
  await app.close();
  app = await launch(); host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings); await host.evaluate(async () => { await window.cmb.invoke('settings:update', { gameDefaults: { screens: { welcome: true, end: true }, tvScreens: { winner: true, wrongClaim: true, showCardNumber: false, showName: true, closeCount: true, seconds: 7 } } }); window.App.settings = await window.cmb.invoke('settings:get'); }); // 2.3 made these TV extras opt-in; these tests cover them
  ok(await host.evaluate(() => document.documentElement.dataset.theme) === 'light', 'Light Mode remembered after restarting the app');
  await app.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
