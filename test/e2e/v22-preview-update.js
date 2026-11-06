/* 2.0: live TV preview (Create Game step 4 + Settings) and click-to-update (portable build,
 * against a local stand-in for the GitHub release API).
 * Run: xvfb-run -a node test/e2e/v22-preview-update.js <samplesDir> */
const { _electron: electron } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os'); const http = require('http'); const crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const ok = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failed++; };
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { } await sleep(200); } return null; };

(async () => {
  /* ---- stand-in release server: 9.0.0 with a 3 MB "portable EXE" and its sha256 */
  const BIN = crypto.randomBytes(3 * 1024 * 1024); const SHA = crypto.createHash('sha256').update(BIN).digest('hex');
  let corrupt = false, forged = false;
  // 2.4: releases carry a signed manifest; the app is told the stand-in public key
  const KP = crypto.generateKeyPairSync('ed25519'); const OTHER = crypto.generateKeyPairSync('ed25519');
  const signFor = (key) => { const text = JSON.stringify({ version: '9.0.0', files: { 'AnthemSquare-Portable-9.0.0.exe': SHA } }); return { text, sig: crypto.sign(null, Buffer.from(text), key.privateKey).toString('base64') }; };
  const srv = await new Promise(res => { const s = http.createServer((q, r) => {
    if (q.url === '/latest') { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end(JSON.stringify({ tag_name: 'v9.0.0', html_url: 'https://example/releases/v9.0.0', assets: [{ name: 'AnthemSquare-Setup-9.0.0.exe', browser_download_url: `http://127.0.0.1:${s.address().port}/setup`, size: 10 }, { name: 'AnthemSquare-Portable-9.0.0.exe', browser_download_url: `http://127.0.0.1:${s.address().port}/portable`, size: BIN.length, digest: 'sha256:' + SHA }, { name: 'release-signature.json', browser_download_url: `http://127.0.0.1:${s.address().port}/sigjson`, size: 1 }, { name: 'release-signature.sig', browser_download_url: `http://127.0.0.1:${s.address().port}/sig`, size: 1 }] })); }
    if (q.url === '/sigjson') { r.writeHead(200); return r.end(signFor(forged ? OTHER : KP).text); }
    if (q.url === '/sig') { r.writeHead(200); return r.end(signFor(forged ? OTHER : KP).sig); }
    if (q.url === '/portable') { r.writeHead(200, { 'Content-Length': BIN.length }); const data = corrupt ? Buffer.concat([BIN.slice(0, -1), Buffer.from([BIN[BIN.length - 1] ^ 1])]) : BIN; let i = 0; const step = () => { if (i >= data.length) return r.end(); r.write(data.slice(i, i + 262144)); i += 262144; setTimeout(step, 40); }; return step(); }
    r.writeHead(404); r.end(); }).listen(0, '127.0.0.1', () => res(s)); });
  const P = srv.address().port;
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'as-v22-'));
  const APPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'as-portable-')); const EXE = path.join(APPDIR, 'AnthemSquare-Portable-2.0.0.exe'); fs.writeFileSync(EXE, 'old exe');
  const app = await electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'],
    env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1', CMB_NO_REMOTE: '1', CMB_UPDATE_MODE: 'portable', CMB_UPDATE_API: `http://127.0.0.1:${P}/latest`, CMB_UPDATE_PUBKEY: KP.publicKey.export({ type: 'spki', format: 'pem' }), PORTABLE_EXECUTABLE_FILE: EXE }) });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings);
  host.on('pageerror', e => ok(false, 'host page error', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950));
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  await inv('library:importPaths', [process.argv[2]]);
  await waitFor(async () => { const l = (await inv('library:list')).songs; return l.length >= 50 && !l.some(s => s.status === 'unchecked'); }, 180000);

  /* ---------- live preview in Create Game step 4 */
  await waitFor(async () => { await host.evaluate(() => App.show('create', 'new')); await sleep(600); return host.isVisible('#gName'); });
  await host.fill('#gName', 'Preview Night'); await host.click('input[name=gmode][value=checklist]'); await sleep(300);
  await host.evaluate(() => { const v = App.views.create; v.collect(); v.step = 4; v.draw(); });
  await host.waitForSelector('#gTvp iframe');
  const frame = await waitFor(async () => host.frames().find(f => /preview=1/.test(f.url())), 10000);
  const tvq = (fn) => frame.evaluate(fn);
  await waitFor(async () => tvq(() => document.querySelectorAll('#ptList .pt-ck').length > 0), 10000);
  const before = await tvq(() => ({ crawl: document.getElementById('crawler').getBoundingClientRect().height, pat: document.getElementById('pattern').className, ov: document.getElementById('overlay').className, title: getComputedStyle(document.getElementById('ovTitle')).fontSize, items: document.querySelectorAll('#ptList .pt-ck').length }));
  ok(before.items === 5 && /pos-top-right/.test(before.pat), 'Preview shows the real TV with the game’s 5-rule checklist', JSON.stringify(before));
  await host.evaluate(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }; set('gCH', '130'); set('gTS', '100'); set('gPP', 'bottom-left'); set('gOP', 'top-left'); });
  const after = await waitFor(async () => { const a = await tvq(() => ({ crawl: document.getElementById('crawler').getBoundingClientRect().height, pat: document.getElementById('pattern').className, ov: document.getElementById('overlay').className, title: getComputedStyle(document.getElementById('ovTitle')).fontSize })); return a.crawl > before.crawl + 30 && /pos-bottom-left/.test(a.pat) && /ov-top-left/.test(a.ov) && parseFloat(a.title) > parseFloat(before.title) ? a : null; }, 6000);
  ok(!!after, 'Crawler height, title size, pattern-panel corner and title position change live in the preview', JSON.stringify(after));
  await host.screenshot({ path: path.join(OUT, 'v22-create-preview.png') });

  /* ---------- live preview in Settings */
  await waitFor(async () => { await host.evaluate(() => App.show('settings')); await sleep(800); return host.isVisible('#sTvp iframe'); });
  const sf = await waitFor(async () => host.frames().find(f => /preview=1/.test(f.url()) && f.parentFrame() === host.mainFrame()), 10000);
  await waitFor(async () => sf.evaluate(() => !!document.getElementById('crawler')), 5000);
  const c0 = await sf.evaluate(() => document.getElementById('crawler').getBoundingClientRect().height);
  await host.fill('#cH', '120'); await host.dispatchEvent('#cH', 'input');
  const c1 = await waitFor(async () => { const h = await sf.evaluate(() => document.getElementById('crawler').getBoundingClientRect().height); return h > c0 + 20 ? h : null; }, 5000);
  ok(!!c1, 'Settings preview: crawler height follows the field', `${c0} → ${c1}`);
  await host.selectOption('#pPos', 'top-left');
  ok(!!(await waitFor(async () => sf.evaluate(() => /pos-top-left/.test(document.getElementById('pattern').className)), 5000)), 'Settings preview: pattern panel moves to the chosen corner');

  /* ---------- click-to-update (portable) */
  await inv('update:check');
  const pill = await waitFor(async () => host.$('#updPill'), 5000);
  ok(pill && /Update to 9\.0\.0/.test(await pill.textContent()), 'Sidebar shows “Update to 9.0.0”');
  corrupt = true;
  await pill.click(); await host.waitForSelector('#updGo');
  ok(/3 MB/.test(await host.textContent('.modal-back')), 'Update window shows the version and download size');
  await host.click('#updGo');
  const prog = await waitFor(async () => { const t = await host.textContent('.modal-back'); return /Downloading/.test(t) && /\d+%/.test(t) ? t : null; }, 5000);
  ok(!!prog, 'Progress is shown while it downloads', (prog || '').match(/\d+%/) && prog.match(/\d+%/)[0]);
  const bad = await waitFor(async () => /did not pass its safety check/.test(await host.textContent('.modal-back')), 15000);
  ok(!!bad && !fs.existsSync(path.join(APPDIR, '.anthem-square-update.exe')), 'A corrupted download is rejected (SHA-256) and removed');
  corrupt = false; forged = true;
  await host.click('#updGo');
  const nosig = await waitFor(async () => /not signed by Anthem Square/.test(await host.textContent('.modal-back')), 15000);
  ok(!!nosig && !fs.existsSync(path.join(APPDIR, '.anthem-square-update.exe')), 'A release signed with someone else\'s key is refused before anything is downloaded');
  forged = false;
  await host.click('#updGo');
  await host.waitForSelector('#updRestart', { timeout: 20000 });
  const staged = path.join(APPDIR, '.anthem-square-update.exe');
  ok(fs.existsSync(staged) && crypto.createHash('sha256').update(fs.readFileSync(staged)).digest('hex') === SHA, 'Downloaded next to the app, signature and SHA-256 verified');
  ok(/Restart now/.test(await host.textContent('.modal-back')) && /Later/.test(await host.textContent('.modal-back')), 'Choice: Restart now or Later');
  await host.screenshot({ path: path.join(OUT, 'v22-update-ready.png') });
  await host.click('#updRestart'); await sleep(500);
  const inst = await app.evaluate(() => global.__updateInstall);
  ok(inst && inst.exe === EXE && inst.file === staged && inst.relaunch === true && /fso\.MoveFile newExe, oldExe/.test(inst.script) && /sh\.Run Chr\(34\) & oldExe/.test(inst.script) && inst.args.slice(3).join('|') === [EXE, staged, '1'].join('|'),
    'Restart now swaps the EXE in place (same name, shortcuts keep working) and reopens it');
  ok(/\.vbs$/.test(inst.helper) && inst.args[0] === '//B' && !/cmd\.exe|timeout|%~/.test(inst.script) && !inst.script.includes(EXE) && inst.script.indexOf('CopyFile oldExe, prev') < inst.script.indexOf('Do While') && /If Not fso\.FileExists\(oldExe\) And fso\.FileExists\(prev\)/.test(inst.script),
    'The swap runs in Windows Script Host only (no console, nothing can flash), keeps the old version once, never leaves the folder without the app, and paths are passed as arguments', inst.args.slice(0, 2).join(' '));
  await app.evaluate(() => global.__cmb.updater.onQuit());
  const again = await app.evaluate(() => global.__updateInstall.helper);
  ok(again === inst.helper, 'Closing the app after Restart now does not start a second helper');
  await app.close(); srv.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
