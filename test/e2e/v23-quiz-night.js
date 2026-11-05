/* 2.1 Quiz Intermission Mode — integrated: laptop + TV window + phone remote together.
 * Three quiz/break cycles, an open claim session across a quiz, the holding-screen option,
 * phone control of both switches, 30 rapid switches (memory and window behaviour).
 * Run: xvfb-run -a node test/e2e/v23-quiz-night.js <samplesDir> */
const { _electron: electron, chromium } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const ok = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failed++; };
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { } await sleep(200); } return null; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'as-v23-'));
  const app = await electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'],
    env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1' }) });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings);
  host.on('pageerror', e => ok(false, 'host page error', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  const st = async () => (await inv('game:state')).game;
  await inv('library:importPaths', [process.argv[2]]);
  await waitFor(async () => { const l = (await inv('library:list')).songs; return l.length >= 50 && !l.some(s => s.status === 'unchecked'); }, 180000);
  const songs = (await inv('library:list')).songs;
  const pl = await inv('playlists:create', { name: 'Quiz Night' }); await inv('playlists:add', { id: pl.id, songIds: songs.map(s => s.id) });
  const g = await inv('games:create', { name: 'Friday Quiz Night', playlistId: pl.id, cards: 40, settings: { clipMode: 20, autoAdvanceGap: 1 } });

  await inv('audience:open', {});
  const tv = await waitFor(async () => { for (const p of app.windows()) { if (/audience/.test(await p.url())) return p; } return null; });
  await tv.waitForLoadState('domcontentloaded');
  await waitFor(async () => (await inv('audience:status')).ready, 10000);
  await host.evaluate(() => App.show('host')); await sleep(600);
  ok(/BINGO/.test(await host.textContent('#nbBar')) && await host.isVisible('#nbQuiz'), 'Host Game shows the bingo bar with RETURN TO QUIZ');

  /* ---- phone */
  await waitFor(async () => (await inv('remote:info')).running, 15000);
  const ri = await inv('remote:info');
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const phone = await ctx.newPage(); phone.on('pageerror', e => ok(false, 'phone page error', e.message));
  let patches = 0, fulls = 0; phone.on('websocket', ws => ws.on('framereceived', f => { const s = String(f.payload || ''); if (s.startsWith('{"type":"patch"')) patches++; else if (s.startsWith('{"type":"state"')) fulls++; }));
  await phone.goto(`http://127.0.0.1:${ri.port}/#pin=${ri.pin}`); await phone.waitForSelector('#main:not(.hidden)', { timeout: 15000 });

  /* ---- break 1 */
  await inv('game:cmd', { action: 'startRound', args: { round: 1 } });
  await waitFor(async () => tv.evaluate(() => { const v = document.getElementById('video'); return !v.paused && v.currentTime > 1.5; }), 20000);
  await waitFor(async () => (await st()).totals.played >= 1, 40000);
  await waitFor(async () => tv.evaluate(() => { const v = document.getElementById('video'); return !v.paused && v.currentTime > 3; }), 30000);
  const vt0 = await tv.evaluate(() => document.getElementById('video').currentTime);
  const idx0 = (await st()).playback.index;
  await host.click('#nbQuiz');
  const q1 = await waitFor(async () => { const s = await inv('audience:status'); return s.hiddenForQuiz && !s.visible ? s : null; }, 5000);
  ok(!!q1, 'Return to Quiz (laptop button): the TV window is hidden, not closed', JSON.stringify(q1));
  await waitFor(async () => tv.evaluate(() => document.getElementById('video').paused), 3000);
  const vt1 = await tv.evaluate(() => ({ paused: document.getElementById('video').paused, t: document.getElementById('video').currentTime }));
  ok(vt1.paused && Math.abs(vt1.t - vt0) < 1.5, 'Video paused at the same point', `${vt0.toFixed(1)} → ${vt1.t.toFixed(1)} s`);
  const s1 = await st();
  ok(s1.night.phase === 'quiz' && s1.night.pausedAt && s1.night.pausedAt.index === idx0 && s1.round.status === 'active', 'Engine: quiz time, position saved, round not completed', JSON.stringify(s1.night.pausedAt));
  ok(/QUIZ TIME/.test(await host.textContent('#nbBar')) && /START BINGO BREAK 2/.test(await host.textContent('#nbStart')), 'Bar turns into QUIZ TIME with START BINGO BREAK 2');
  ok(await host.isDisabled('#cPlay'), 'Play button disabled during the quiz');
  await host.screenshot({ path: path.join(OUT, 'v23-host-quiz.png') });
  ok(!!(await waitFor(async () => await phone.isVisible('#quizPane') && /START BINGO BREAK 2/.test(await phone.textContent('#qzStart')), 5000)), 'Phone shows the quiz screen with one big button');
  ok(!(await phone.isVisible('#bingoFab')), 'CHECK BINGO is hidden on the phone during the quiz');
  await phone.screenshot({ path: path.join(OUT, 'v23-phone-quiz.png') });
  const pr = await inv('game:cmd', { action: 'play' }).then(() => 'played', e => e.message);
  ok(/quiz time/.test(pr) && !(await tv.evaluate(() => !document.getElementById('video').paused)), 'Play is refused during the quiz; no sound leaks', pr);
  const focusBefore = await app.evaluate(({ BrowserWindow }) => { const f = BrowserWindow.getFocusedWindow(); return f ? f.getTitle() : null; });

  /* ---- break 2 from the phone */
  await phone.click('#qzStart');
  const b2 = await waitFor(async () => { const s = await inv('audience:status'); return !s.hiddenForQuiz && s.visible ? s : null; }, 5000);
  ok(!!b2, 'Phone START BINGO BREAK: the TV window is shown again');
  const focusAfter = await app.evaluate(({ BrowserWindow }) => { const f = BrowserWindow.getFocusedWindow(); return f ? f.getTitle() : null; });
  ok(!/Audience/.test(focusAfter || ''), 'The TV window did not take keyboard focus', `${focusBefore} → ${focusAfter}`);
  const s2 = await st();
  ok(s2.night.phase === 'break' && s2.night.breakNo === 2 && s2.playback.status === 'paused' && s2.playback.index === idx0, 'Break 2 waits for Play, on the same song');
  ok(!!(await waitFor(async () => await phone.isVisible('#nightBar') && /BINGO BREAK 2/.test(await phone.textContent('#nightBar')), 5000)), 'Phone shows the slim BINGO BREAK 2 bar');
  await phone.click('#playBtn');
  ok(!!(await waitFor(async () => tv.evaluate(() => { const v = document.getElementById('video'); return !v.paused; }), 8000)), 'Play resumes the video');
  const vt2 = await tv.evaluate(() => document.getElementById('video').currentTime);
  ok(Math.abs(vt2 - vt1.t) < 2, 'Resumed from the saved position', `${vt1.t.toFixed(1)} → ${vt2.toFixed(1)} s`);
  await phone.screenshot({ path: path.join(OUT, 'v23-phone-break.png') });
  await host.screenshot({ path: path.join(OUT, 'v23-host-break.png') });

  /* ---- claim session open across a quiz */
  await waitFor(async () => (await st()).totals.played >= 3, 90000);
  await inv('game:cmd', { action: 'freezeClaims' });
  const sid = (await st()).session.id;
  await phone.click('#nbQuiz');
  await waitFor(async () => (await inv('audience:status')).hiddenForQuiz, 5000);
  const s3 = await st();
  ok(s3.night.phase === 'quiz' && s3.session && s3.session.id === sid, 'Phone RETURN TO QUIZ during an open claim session: the session stays open');
  await inv('game:cmd', { action: 'addClaim', args: { cardNo: 1 } });
  await inv('game:cmd', { action: 'closeSession', args: { resume: true } });
  ok(!['playing', 'loading'].includes((await st()).playback.status), 'Closing the claim session during the quiz does not start the music');

  /* ---- holding screen option */
  await inv('game:cmd', { action: 'setNight', args: { quizTv: 'hold' } });
  const hold = await waitFor(async () => { const s = await inv('audience:status'); return s.visible && !s.hiddenForQuiz ? s : null; }, 5000);
  ok(!!hold && !!(await waitFor(async () => tv.evaluate(() => !document.getElementById('quizhold').classList.contains('hidden')), 5000)), '“Show a still holding screen”: TV visible with the holding screen');
  await sleep(800); await tv.screenshot({ path: path.join(OUT, 'v23-tv-holding.png') });
  await inv('game:cmd', { action: 'setNight', args: { quizTv: 'hide', autoPlay: true } });
  ok(!!(await waitFor(async () => (await inv('audience:status')).hiddenForQuiz, 5000)), 'Back to “hide”: hidden again');

  /* ---- break 3 plays straight away */
  await host.click('#nbStart');
  ok(!!(await waitFor(async () => ['playing', 'loading'].includes((await st()).playback.status), 8000)), '“Play straight away”: break 3 starts the music');
  ok(!!(await waitFor(async () => tv.evaluate(() => document.getElementById('quizhold').classList.contains('hidden')), 5000)), 'Holding screen gone during the break');

  /* ---- 30 rapid switches */
  const mem = async () => (await app.evaluate(({ app }) => app.getAppMetrics().reduce((a, m) => a + m.memory.workingSetSize, 0))) / 1024;
  const winCount = async () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const m0 = await mem(); const w0 = await winCount(); const order0 = JSON.stringify((await inv('game:state')).game.order.map(o => o.songId || o.id || o));
  const t0 = Date.now();
  for (let i = 0; i < 30; i++) { await inv('game:cmd', { action: i % 2 ? 'startBreak' : 'returnToQuiz' }); await sleep(150); }
  const per = (Date.now() - t0) / 30;
  await sleep(1500);
  const m1 = await mem(); const w1 = await winCount();
  ok(w1 === w0, 'No windows created or lost after 30 switches', `${w0} → ${w1}`);
  ok(m1 - m0 < 60, 'Memory after 30 switches', `${m0.toFixed(0)} → ${m1.toFixed(0)} MB (${(m1 - m0 >= 0 ? '+' : '') + (m1 - m0).toFixed(0)} MB)`);
  const s4 = await st();
  ok(s4.night.phase === 'break' && JSON.stringify(s4.order.map(o => o.songId || o.id || o)) === order0, '30 switches: ends in a break as expected; play order unchanged', `${per.toFixed(0)} ms per switch incl. 150 ms wait`);
  ok(s4.night.breaks.length >= 17 && s4.night.breaks.map(b => b.n).every((n, i) => n === i + 1), 'Every break numbered in order', `${s4.night.breaks.length} breaks`);
  ok(patches > 10, 'Phone receives small patches instead of whole states', `${patches} patches, ${fulls} full states`);

  /* ---- restart in quiz time: the TV stays hidden */
  await inv('game:cmd', { action: 'returnToQuiz' }); await sleep(500);
  await app.close();
  const app2 = await electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'],
    env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1', CMB_NO_REMOTE: '1' }) });
  const h2 = await app2.firstWindow(); await h2.waitForFunction(() => window.App && window.App.settings);
  const inv2 = (c, p) => h2.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  if (!(await inv2('game:state')).game) await inv2('games:open', { id: g.id });
  await inv2('audience:open', {}); await sleep(2500);
  const rs = await inv2('audience:status'); const rg = (await inv2('game:state')).game;
  ok(rg.night.phase === 'quiz' && rs.open && !rs.visible, 'After a restart in quiz time, the TV window opens hidden', JSON.stringify(rs));
  await inv2('game:cmd', { action: 'startBreak' });
  ok(!!(await waitFor(async () => (await inv2('audience:status')).visible, 5000)), '…and appears on Start Bingo Break');
  await app2.close(); await br.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
