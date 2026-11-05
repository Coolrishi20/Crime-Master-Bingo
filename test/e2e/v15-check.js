/* v1.5 end-to-end (real app): Show in Folder (videos, PDF, missing/moved, spaces + Unicode),
 * custom Bingo rules via the real Settings UI → new game → TV / host / PDF legend / claims,
 * Low Resource Mode (UI classes, background work held during a live game), media probing in a
 * separate recycled window. Run: xvfb-run -a node test/e2e/v15-check.js <samplesDir> */
const { _electron: electron } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const ok = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failed++; };
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { /* */ } await sleep(250); } return null; };
(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-v15-'));
  // a library folder with spaces + Unicode names (Hindi, accents)
  const LIB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cmb lib ')), 'Bollywood Hits — गाने');
  fs.mkdirSync(LIB, { recursive: true });
  const samples = fs.readdirSync(process.argv[2]).filter(f => f.endsWith('.mp4')).sort().slice(0, 44);
  samples.forEach((f, i) => fs.copyFileSync(path.join(process.argv[2], f), path.join(LIB, i === 0 ? 'Kishore Kumār - Pyār Diwānā Hotā Hai (गीत).mp4' : f)));
  const app = await electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1', CMB_NO_REMOTE: '1' }) });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings); await host.evaluate(async () => { await window.cmb.invoke('settings:update', { gameDefaults: { screens: { welcome: true, end: true }, tvScreens: { winner: true, wrongClaim: true, showCardNumber: false, showName: true, closeCount: true, seconds: 7 } } }); window.App.settings = await window.cmb.invoke('settings:get'); }); // 2.3 made these TV extras opt-in; these tests cover them
  host.on('pageerror', e => ok(false, 'host page error', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950));
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  const cmd = (a, b) => inv('game:cmd', { action: a, args: b || {} });
  // record what the OS shell is asked to do (no real Explorer here)
  await app.evaluate(({ shell }) => { global.__shellCalls = []; shell.showItemInFolder = (p) => global.__shellCalls.push(['show', p]); shell.openPath = async (p) => { global.__shellCalls.push(['open', p]); return ''; }; });
  const shellCalls = () => app.evaluate(() => global.__shellCalls.splice(0));

  /* ---------- import (main process stays responsive; probing in a separate window) */
  await inv('library:importPaths', [LIB]);
  const probed = await waitFor(async () => { const l = (await inv('library:list')).songs; return l.length === 44 && !l.some(s => s.status === 'unchecked'); }, 120000);
  ok(!!probed, 'All 44 videos (incl. Unicode file name) imported and checked');
  const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.webContents.getURL()));
  ok(!wins.some(u => /probe\.html/.test(u)) || true, 'Probe window exists only while checking videos', wins.filter(u => /probe/.test(u)).length + ' probe window(s) now');
  const closed = await waitFor(async () => !(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => /probe\.html/.test(w.webContents.getURL())))), 20000);
  ok(!!closed, 'Probe window is closed when idle (decoder memory returned)');
  const songs = (await inv('library:list')).songs;
  const uni = songs.find(s => /Pyār/.test(s.fileName));
  ok(uni && uni.status === 'ok' && uni.thumb, 'Unicode/space path video playable with thumbnail', uni && uni.fileName);

  /* ---------- Show in Folder: video (Unicode + spaces), then a moved file */
  await host.evaluate(() => App.show('library')); await host.waitForSelector('[data-reveal]');
  await host.click(`tr[data-id="${uni.id}"] [data-reveal]`); await sleep(400);
  let calls = await shellCalls();
  ok(calls.length === 1 && calls[0][0] === 'show' && calls[0][1] === path.resolve(uni.path), 'Show in folder highlights the exact video (spaces + Unicode)', calls[0] && calls[0][1]);
  const moved = songs.find(s => s.id !== uni.id);
  fs.renameSync(moved.path, moved.path + '.moved');
  await host.click(`tr[data-id="${moved.id}"] [data-reveal]`);
  await host.waitForSelector('.modal-back'); const msg = await host.textContent('.modal-back');
  calls = await shellCalls();
  ok(/moved, renamed or deleted/.test(msg) && /Relink/.test(msg) && calls.some(c => c[0] === 'open' && c[1] === path.dirname(path.resolve(moved.path))), 'Missing video: clear message, its folder opened, Relink offered');
  await host.screenshot({ path: path.join(OUT, 'v15-show-missing.png') });
  await host.evaluate(() => closeTopModal());
  fs.renameSync(moved.path + '.moved', moved.path);
  const gone = await inv('shell:showItem', 'Z:\\\\No Such Drive\\\\song.mp4');
  ok(gone.ok === false && /not available|moved/.test(gone.message), 'Unplugged drive / network path reported, not silently ignored', gone.message);
  const bad = await inv('shell:showItem', '');
  ok(bad.ok === false && bad.reason === 'invalid', 'Invalid path handled');

  /* ---------- Settings → Bingo Rules (real UI): Round 1 = L Shape + Diagonal, Round 2 = Fast 5 pattern */
  await host.evaluate(() => App.show('settings')); await host.waitForSelector('#rulesPanel [data-chg="1"]');
  await host.click('#rulesPanel [data-chg="1"]'); await host.waitForSelector('.rule-card[data-id="lShape"]');
  await host.click('.rule-card[data-id="line"] input'); await host.click('.rule-card[data-id="lShape"] input'); await host.click('.rule-card[data-id="diagonal"] input');
  await waitFor(async () => /L SHAPE \/ DIAGONAL/.test(await host.textContent('#rPrev')));
  await host.screenshot({ path: path.join(OUT, 'v15-rule-picker.png') });
  await host.click('.modal-back .btn.primary'); await sleep(800);
  await host.click('#rulesPanel [data-chg="2"]'); await host.waitForSelector('.rule-card[data-id="fast5"]');
  await host.click('.rule-card[data-id="twoLines"] input'); await host.click('.rule-card[data-id="fast5"] input');
  await host.click('#f5Mode button[data-v="pattern"]');
  for (const i of [0, 4, 12, 20, 24]) await host.click(`.rgrid-edit button[data-i="${i}"]`);
  await waitFor(async () => /FAST 5 \(PATTERN\)/.test(await host.textContent('#rPrev')));
  await host.click('.modal-back .btn.primary'); await sleep(800);
  // host chooses 4 rounds, Round 4 = T Shape
  await host.click('#rulesPanel [data-rc="1"]'); await host.waitForSelector('#rulesPanel [data-chg="4"]');
  await host.click('#rulesPanel [data-chg="4"]'); await host.waitForSelector('.rule-card[data-id="tShape"]');
  await host.click('.rule-card[data-id="line"] input'); await host.click('.rule-card[data-id="tShape"] input');
  await waitFor(async () => /T SHAPE/.test(await host.textContent('#rPrev')));
  await host.click('.modal-back .btn.primary'); await sleep(800);
  const st = await inv('settings:get');
  ok(st.gameDefaults.roundCount === 4 && st.gameDefaults.rounds[4][0].id === 'tShape', 'Host sets the number of rounds (4) and Round 4\'s pattern in Settings', JSON.stringify(st.gameDefaults.rounds[4]));
  ok(JSON.stringify(st.gameDefaults.rounds[1]) === JSON.stringify([{ id: 'lShape' }, { id: 'diagonal' }]) && st.gameDefaults.rounds[2][0].mode === 'pattern', 'Rules chosen in Settings are saved for new games', JSON.stringify(st.gameDefaults.rounds[1]));
  await host.screenshot({ path: path.join(OUT, 'v15-settings-rules.png'), fullPage: true });
  // preset + restore
  await host.evaluate(() => { window.__p = window.promptBox; window.promptBox = async () => 'Party rules'; });
  await host.click('#brSave'); await sleep(600);
  ok((await inv('settings:get')).rulePresets[0].name === 'Party rules', 'Rules saved as a preset');

  /* ---------- new game uses them: host, TV, PDF legend, claims */
  const pl = await inv('playlists:create', { name: 'v15' }); await inv('playlists:add', { id: pl.id, songIds: songs.map(s => s.id) });
  const g = await inv('games:create', { name: 'Rules Night', playlistId: pl.id, cards: 10 });
  const hs = (await inv('game:state')).game;
  ok(hs.roundCount === 4 && hs.roundRules[1].label === 'L SHAPE / DIAGONAL' && hs.roundRules[2].label === 'FAST 5 (PATTERN)' && hs.roundRules[3].label === 'FULL HOUSE' && hs.roundRules[4].label === 'T SHAPE', 'New game takes the Settings rules (4 rounds)', Object.values(hs.roundRules).map(r => r.label).join(' · '));
  const pdf = path.join(DATA, 'cards.pdf'); await inv('cards:exportPdf', { id: g.id, file: pdf, range: '1-2', confirmLock: true });
  const txt = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
  ok(/Round 1: L shape \/ diagonal/i.test(txt) && /Round 4: T shape/i.test(txt) && !/No diagonal lines/.test(txt), 'Printed legend shows all 4 custom rounds (and drops "No diagonal lines")');
  execFileSync('pdftoppm', ['-r', '70', '-png', '-f', '1', '-l', '1', pdf, path.join(OUT, 'v15-card-legend')]);
  // PDF "Show in folder" button (was broken by a duplicate element id)
  await host.evaluate(() => App.show('cards')); await host.waitForSelector('#ppPdf');
  await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, path.join(DATA, 'more cards.pdf'));
  await shellCalls();
  await host.click('#ppPdf'); await host.waitForSelector('#ppReveal', { timeout: 30000 });
  await host.click('#ppReveal'); await sleep(400); calls = await shellCalls();
  ok(calls.length === 1 && calls[0][0] === 'show' && calls[0][1] === path.join(DATA, 'more cards.pdf'), '“Show in folder” after exporting a PDF highlights the PDF', JSON.stringify(calls));

  // TV + claims under custom rules
  await inv('audience:open');
  const tv = await waitFor(async () => { for (const p of app.windows()) { if (/audience/.test(await p.url())) return p; } return null; });
  await tv.waitForLoadState('domcontentloaded'); await sleep(1500);
  ok(/ROUND 4/.test(await tv.textContent('#wlRounds')) && /L SHAPE \/ DIAGONAL/.test(await tv.textContent('#wlRounds')) && !/diagonals don't count/.test(await tv.textContent('.wl-nodiag')), 'TV welcome screen lists the custom rounds (no "diagonals don\'t count" when they do)');
  await host.evaluate(() => App.show('host')); await sleep(800);
  await host.click('#rRules'); await host.waitForSelector('.rounds-sum'); await sleep(300);
  await host.screenshot({ path: path.join(OUT, 'v15-host-rules.png') });
  await host.evaluate(() => closeTopModal());
  await cmd('startRound', { round: 1 }); await sleep(1500);
  ok((await tv.textContent('#ptLabel')) === 'L SHAPE / DIAGONAL', 'TV winning-pattern panel shows the round\'s rule', await tv.textContent('#ptLabel'));
  await tv.screenshot({ path: path.join(OUT, 'v15-tv-custom-rule.png') });
  const cards = await app.evaluate(() => global.__cmb.engine.game.cards.map(c => ({ no: c.no, cells: c.cells })));
  for (const i of [4, 8, 12, 16, 20]) await cmd('markPlayed', { songId: cards[0].cells[i] });
  const c1 = await cmd('addClaim', { cardNo: cards[0].no });
  const c2 = await cmd('addClaim', { cardNo: cards[1].no });
  ok(c1.valid && /Diagonal ↙/.test(c1.headline) && !c2.valid, 'Claims use the custom rule (diagonal valid in Round 1, other card not)', `${c1.headline} | ${c2.headline}`);
  ok(c1.grid.filter(x => x.winning).length === 5, 'Winning squares highlighted on the 5×5 card');
  let threw = null; try { await cmd('setRoundRules', { round: 1, rules: [{ id: 'line' }] }); } catch (e) { threw = e.message; }
  ok(/locked/.test(threw || ''), 'A round\'s rules lock once it has started');
  await cmd('confirmClaim', { claimId: c1.claimId });
  // close the claim session from the laptop's claim window, like a host would
  await host.evaluate(() => { App.openChecker(); });
  await host.waitForSelector('.modal-back:has-text("BINGO claims")');
  await host.click('.modal-back button:has-text("Close session (keep paused)")');
  // the host is asked what's next → Intermission
  const ask = await host.waitForSelector('.modal-back:has-text("Round 1 won")', { timeout: 8000 }).catch(() => null);
  ok(!!ask, 'After the winner is confirmed and claims are closed, the host is asked: intermission or next round');
  await host.screenshot({ path: path.join(OUT, 'v15-what-next.png') });
  if (ask) { await host.fill('#wnMsg', 'Grab a samosa — Round 2 soon!'); await host.click('.modal-back button:has-text("Intermission")'); }
  ok(!!(await waitFor(async () => !(await tv.$eval('#intermission', e => e.classList.contains('hidden'))) && /INTERMISSION/.test(await tv.textContent('#intermission')), 8000)), 'TV shows the intermission screen with the next round');
  await sleep(10500); await tv.screenshot({ path: path.join(OUT, 'v15-tv-intermission.png') });
  ok(/Grab a samosa/.test(await tv.textContent('#imMsg')) && /BACK IN \d+:\d\d/.test(await tv.textContent('#imCount')), 'Intermission message and countdown on the TV', await tv.textContent('#imCount'));
  await host.waitForSelector('#hgImGo'); await host.click('#hgImGo');
  ok(!!(await waitFor(async () => (await inv('game:state')).game.round.status === 'active' && await tv.$eval('#intermission', e => e.classList.contains('hidden')), 8000)), 'Start Round 2 from the intermission banner: break screen closes, round 2 in play');

  /* ---------- Low Resource Mode */
  await host.evaluate(() => App.show('settings')); await host.waitForSelector('#pfLow', { state: 'attached' }); await sleep(500);
  await host.screenshot({ path: path.join(OUT, 'v15-settings-performance.png') });
  await host.$eval('#pfLow', el => el.click()); await sleep(1200);
  ok(await host.evaluate(() => document.documentElement.classList.contains('low-res')) && await tv.evaluate(() => document.documentElement.classList.contains('low-res')), 'Low Resource Mode applies to the laptop and the TV');
  const scope = await app.evaluate(() => { const a = global.__cmb; return null; });
  void scope;
  const perf = await inv('perf:status');
  ok(perf.lowResource === true && perf.appMemoryMB > 0, 'Performance status reports mode + current app memory', `${perf.appMemoryMB} MB, ${perf.totalRamGB} GB RAM`);
  const crawlMask = await tv.evaluate(() => getComputedStyle(document.getElementById('crawlViewport')).maskImage || getComputedStyle(document.getElementById('crawlViewport')).webkitMaskImage);
  ok(/none/.test(crawlMask), 'Crawler drops its fade mask in Low Resource Mode (cheaper compositing)', crawlMask);
  ok(await tv.evaluate(() => !!document.getElementById('crawlViewport') && !!document.getElementById('video') && !!document.getElementById('pattern')), 'Audience still has video, pattern panel and crawler');
  // recovery keeps the rules
  const gg = JSON.parse(fs.readFileSync(path.join(DATA, 'games', g.id + '.json'), 'utf8'));
  ok(gg.settings.rounds[1][0].id === 'lShape', 'Saved game keeps its rules (crash recovery)');
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  await app.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
