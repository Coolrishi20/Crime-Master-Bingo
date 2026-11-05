/* 2.5: simpler Settings page (sections, search, auto-save) and the new "a" logo everywhere.
 * Run: xvfb-run -a node test/e2e/v25-settings-brand.js */
const { _electron: electron } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const ok = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failed++; };
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { } await sleep(200); } return null; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'as-v25-'));
  const app = await electron.launch({ executablePath: require('electron'), args: [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1', CMB_NO_REMOTE: '1' }) });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings);
  host.on('pageerror', e => ok(false, 'host page error', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);

  /* logo */
  const side = await host.evaluate(() => { const i = document.querySelector('.as-logo img'); return { src: i.getAttribute('src'), w: i.naturalWidth }; });
  ok(/icon-small\.svg$/.test(side.src) && side.w > 0, 'Sidebar uses the simplified small logo', side.src);
  const svg = fs.readFileSync(path.join(ROOT, 'src/renderer/shared/brand/icon.svg'), 'utf8');
  ok(/#102542/.test(svg) && /#FFF2CF/.test(svg) && /#FF5B32/.test(svg) && /rx="/.test(svg), 'App icon: rounded Dark Blue tile with the cream "a" and orange grid');
  const ico = fs.readFileSync(path.join(ROOT, 'build/icon.ico'));
  ok(ico.readUInt16LE(2) === 1 && ico.readUInt16LE(4) >= 7, 'Windows icon file has 7 sizes', `${ico.readUInt16LE(4)} images`);

  /* settings layout */
  await host.evaluate(() => App.show('settings')); await host.waitForSelector('#stNav');
  const nav = await host.$$eval('#stNav a', as => as.map(a => a.textContent));
  ok(nav.length === 9 && nav[0] === 'General' && nav.includes('TV screen') && nav.includes('Bingo rules'), 'Nine sections in the side menu', nav.join(' · '));
  ok(!!(await waitFor(async () => await host.isVisible('#sTvp iframe') && await host.isVisible('#rulesPanel [data-chg="1"]') && (await host.$('#pfLow')) !== null)), 'Live TV preview, Bingo rules and Low Resource Mode are all there');
  await host.screenshot({ path: path.join(OUT, 'v25-settings.png') });

  /* auto-save */
  await host.fill('#cH', '110'); await host.dispatchEvent('#cH', 'input');
  const saved = await waitFor(async () => (await inv('settings:get')).gameDefaults.crawler.height === 110 && /All changes saved/.test(await host.textContent('#stSaved')));
  ok(!!saved, 'A change saves by itself (no Save button needed)');
  await host.click('#st-play .st-tog:has(#gS) .sw');
  ok(!!(await waitFor(async () => (await inv('settings:get')).gameDefaults.shuffle === false)), 'Toggles save by themselves too');

  /* find a setting */
  await host.fill('#stFind', 'crawler');
  const vis = await host.$$eval('.st-sec', s => s.filter(x => !x.classList.contains('st-hide')).map(x => x.dataset.sec));
  ok(vis.includes('tv') && !vis.includes('sound') && (await host.$$('.st-hit')).length > 0, '“Find a setting…” shows only matching sections and highlights the fields', vis.join(','));
  await host.fill('#stFind', ''); await host.dispatchEvent('#stFind', 'input');

  /* a loaded game: offer, never automatic */
  ok(!(await host.isVisible('#stApply .banner')), 'No “apply to this game” bar without a loaded game');
  await host.click('#stNav [data-go="about"]'); await sleep(600);
  ok(await host.isVisible('#upCheck') && /FREE EDITION/.test(await host.textContent('#licBox')), 'Side menu jumps to Updates & about');
  /* 2.5.3: Help → Save diagnostics */
  const df = path.join(DATA, 'diag.json');
  await host.evaluate(() => window.cmb.invoke('diag:log', { where: 'laptop', msg: 'test error from the laptop window' }));
  const dr = await inv('diag:save', { file: df });
  const rep = JSON.parse(fs.readFileSync(df, 'utf8'));
  ok(await host.isVisible('#stDiag') && dr && rep.system && rep.app.version && rep.library && rep.displays.length >= 1 && rep.recentErrors.some(l => /test error from the laptop window/.test(l)),
    'Save diagnostics writes one readable file (system, app, library, displays, recent errors)', `${dr.bytes} bytes`);
  ok(!/tokenHash"\s*:\s*"[0-9a-f]{20}/.test(JSON.stringify(rep)) && !JSON.stringify(rep).includes(os.homedir() + path.sep), 'No phone secrets or home-folder paths in the file');
  await app.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
