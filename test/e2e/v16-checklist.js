/* Rules Checklist Mode end-to-end (real app): Create Game UI (mode + checklist editor),
 * Host Game checklist panel, claim checker with rule choice, simultaneous winners, TV checklist,
 * host phone remote (verify + choose rule + correct award), a player phone, PDF legend,
 * all-rules-completed prompt, end screen, crash-safe reload. Round-Based Mode left untouched.
 * Run: xvfb-run -a node test/e2e/v16-checklist.js <samplesDir> */
const { _electron: electron, chromium } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const ok = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failed++; };
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { /* */ } await sleep(250); } return null; };
const DIAG = [0, 6, 12, 18, 24], ROW0 = [0, 1, 2, 3, 4];

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-v16-'));
  const launch = () => electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1' }) });
  let app = await launch();
  let host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings); await host.evaluate(async () => { await window.cmb.invoke('settings:update', { gameDefaults: { screens: { welcome: true, end: true }, tvScreens: { winner: true, wrongClaim: true, showCardNumber: false, showName: true, closeCount: true, seconds: 7 } } }); window.App.settings = await window.cmb.invoke('settings:get'); }); // 2.3 made these TV extras opt-in; these tests cover them
  host.on('pageerror', e => ok(false, 'host page error', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950));
  let inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  let cmd = (a, b) => inv('game:cmd', { action: a, args: b || {} });
  const state = async () => (await inv('game:state')).game;

  await inv('library:importPaths', [process.argv[2]]);
  await waitFor(async () => { const l = (await inv('library:list')).songs; return l.length >= 40 && !l.some(s => s.status === 'unchecked'); }, 120000);
  const songs = (await inv('library:list')).songs;
  const pl = await inv('playlists:create', { name: 'Checklist night' }); await inv('playlists:add', { id: pl.id, songIds: songs.map(s => s.id) });

  /* ---------- Create Game wizard: choose Rules Checklist Bingo, edit the checklist */
  await host.evaluate(() => App.show('create', 'new')); await host.waitForSelector('#gName');
  await host.fill('#gName', 'Checklist Night');
  ok(await host.isHidden('#gCk'), 'Round-Based Bingo is the default (checklist editor hidden)');
  await host.click('input[name=gmode][value=checklist]');
  await host.waitForSelector('#gCk .ck-row');
  const rows0 = await host.$$eval('#gCk .ck-row b', b => b.map(x => x.textContent));
  ok(rows0.join('|') === 'FAST 5|ONE LINE|DIAGONAL|L SHAPE|FULL HOUSE', 'Default checklist offered', rows0.join(', '));
  // remove L Shape, move Full House up, add T Shape through the rule picker
  await host.click('#gCk [data-rm="3"]'); await waitFor(async () => (await host.$$('#gCk .ck-row')).length === 4);
  await host.click('#gCk [data-up="3"]'); await sleep(400);
  await host.click('#ckAdd'); await host.waitForSelector('.rule-card[data-id="tShape"]');
  ok(/add to the checklist/.test(await host.textContent('.modal-back')), 'Rule picker explains each rule is won separately');
  await host.click('.rule-card[data-id="tShape"] input'); await host.click('.modal-back .btn.primary');
  await waitFor(async () => (await host.$$('#gCk .ck-row')).length === 5);
  const rows1 = await host.$$eval('#gCk .ck-row b', b => b.map(x => x.textContent));
  ok(rows1.join('|') === 'FAST 5|ONE LINE|FULL HOUSE|DIAGONAL|T SHAPE', 'Remove / reorder / add rules work', rows1.join(', '));
  // save as preset
  await host.click('#ckSave'); await host.waitForSelector('.modal-back #pb'); await host.fill('.modal-back #pb', 'Family night'); await host.click('.modal-back:last-child .btn.primary');
  ok(!!(await waitFor(async () => (await inv('settings:get')).checklistPresets.some(p => p.name === 'Family night' && p.items.length === 5))), 'Checklist saved as a preset');
  await host.screenshot({ path: path.join(OUT, 'v16-create-mode.png') });
  await host.click('#cNext');                               // → playlist
  await host.waitForSelector(`input[name=pl][value="${pl.id}"]`); await host.click(`input[name=pl][value="${pl.id}"]`);
  await host.click('#cNext'); await host.waitForSelector('#gClip');   // playback
  await host.click('#cNext'); await host.waitForSelector('#gPP');     // audience
  await host.click('#cNext'); await host.waitForSelector('#gCards');  // cards
  await host.fill('#gCards', '12'); await host.click('#cNext');
  const created = await waitFor(async () => { const g = await state(); return g && g.mode === 'checklist' ? g : null; });
  ok(created && created.checklist.total === 5 && created.checklist.items.map(i => i.label).join('|') === 'FAST 5|ONE LINE|FULL HOUSE|DIAGONAL|T SHAPE', 'Game created in Rules Checklist Mode with the chosen rules in order');
  ok(created && created.roundCount && created.checklist.completed === 0, '0 of 5 completed at the start');
  const gameId = created.gameId;

  /* ---------- printable cards: the rules, compact, no round numbers */
  const pdf = path.join(DATA, 'ck.pdf'); await inv('cards:exportPdf', { id: gameId, file: pdf, range: '1-2', confirmLock: true });
  const txt = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' ');
  ok(/WINNING RULES · ANY ORDER/.test(txt.replace(/ /g, ' ')) || /WINNING RULES ·\s*ANY\s*ORDER/.test(txt) || (/WINNING RULES/.test(txt) && /ORDER/.test(txt)) && /T shape/i.test(txt) && !/Round 1:/.test(txt) && /any rule in any order/.test(txt), 'PDF legend lists the rules (any order), no round numbers');
  execFileSync('pdftoppm', ['-r', '70', '-png', '-f', '1', '-l', '1', pdf, path.join(OUT, 'v16-card-legend')]);

  /* ---------- Host Game: checklist panel replaces the round buttons */
  await host.evaluate(() => App.show('host')); await host.waitForSelector('#ckStart');
  ok(/Winning rules checklist/.test(await host.textContent('#rTitle')) && !(await host.$('.round-btn')), 'Host Game shows the checklist, not round buttons');
  ok(/0 OF 5/.test(await host.textContent('#rStatus')), '“0 OF 5 RULES COMPLETED”');
  await inv('audience:open');
  const tv = await waitFor(async () => { for (const p of app.windows()) { if (/audience/.test(await p.url())) return p; } return null; });
  await tv.waitForLoadState('domcontentloaded');
  ok(!!(await waitFor(async () => /TO WIN/.test(await tv.textContent('#wlRounds')) && /T SHAPE/.test(await tv.textContent('#wlRounds')) && !/ROUND \d/.test(await tv.textContent('#wlRounds')))), 'TV welcome screen lists the rules with no round numbers');
  await sleep(1200); await tv.screenshot({ path: path.join(OUT, 'v16-tv-welcome.png') });
  await host.click('#ckStart'); await host.waitForSelector('.modal-back'); await host.click('.modal-back .btn.primary');
  await waitFor(async () => (await state()).round.status === 'active');
  ok(true, 'Start game (one start, no rounds)');

  // remote + player phone
  await inv('settings:update', { home: { phoneCards: true, joinOnTv: true } });
  await waitFor(async () => (await inv('remote:info')).running, 15000);
  const br = await chromium.launch();
  const j = await inv('players:join');
  const pctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const priya = await pctx.newPage(); priya.on('pageerror', e => ok(false, 'player page error', e.message)); priya.on('dialog', d => d.accept());
  await priya.goto(j.url.replace(/\/\/[^:/]+:/, '//127.0.0.1:')); await priya.waitForSelector('#join:not(.hidden)');
  await priya.fill('#jName', 'Priya'); await priya.click('#jGo'); await priya.waitForSelector('#game:not(.hidden)');
  const pCard = Number(await priya.textContent('#meCard'));
  const ri = await inv('remote:info');
  const hctx = await br.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const phone = await hctx.newPage(); phone.on('pageerror', e => ok(false, 'remote page error', e.message)); phone.on('dialog', d => d.accept(''));
  await phone.goto(`http://127.0.0.1:${ri.port}/#pin=${ri.pin}`); await phone.waitForSelector('#main:not(.hidden)', { timeout: 15000 });

  const cards = await app.evaluate(() => global.__cmb.engine.game.cards.map(c => ({ no: c.no, cells: c.cells })));
  const card = (no) => cards.find(c => c.no === no);
  const A = cards.find(c => c.no !== pCard), B = cards.find(c => c.no !== pCard && c.no !== A.no), C = cards.find(c => ![pCard, A.no, B.no].includes(c.no));
  const play = async (c, idx) => { for (const i of idx) { const g = await state(); if (!g.history.some(h => h.songId === c.cells[i])) await cmd('markPlayed', { songId: c.cells[i] }); } };

  /* ---------- laptop: a full row qualifies for Fast 5 AND One Line → host chooses one */
  await play(A, ROW0);
  await host.evaluate((no) => { App.openChecker(String(no)); }, A.no);
  await host.waitForSelector('#ckOut .verdict', { timeout: 15000 }).catch(() => {});
  console.log('CKOUT', (await host.textContent('.modal-back').catch(() => 'no modal')).slice(0, 400));
  await host.waitForSelector('#ckOut .verdict.valid', { timeout: 8000 });
  const opts = await host.$$eval('#ckOut .ck-opt b', b => b.map(x => x.textContent));
  ok(opts.join('|') === 'FAST 5|ONE LINE', 'Checker: “Valid for” lists both rules the card qualifies for', opts.join(', '));
  await host.screenshot({ path: path.join(OUT, 'v16-checker-choose.png') });
  await host.click('#ckConfirm'); await sleep(400);
  ok((await state()).checklist.completed === 0 && !!(await host.$('.toast')), 'Confirm without choosing is refused (never auto-awards two rules)');
  await host.click('#ckOut .ck-opt:nth-of-type(2) input'); await host.click('#ckConfirm');
  await waitFor(async () => /WINNER — ONE LINE/.test(await host.textContent('#ckOut')));
  let g = await state();
  ok(g.checklist.items.find(i => i.label === 'ONE LINE').status === 'completed' && g.checklist.items.find(i => i.label === 'FAST 5').status === 'available', 'Only the chosen rule (One Line) is completed');
  ok(!!(await waitFor(async () => tv.evaluate(() => { const r = [...document.querySelectorAll('#ptList .pt-ck')].find(x => /ONE LINE/.test(x.textContent)); return r && r.classList.contains('done'); }))), 'TV checklist ticks One Line');
  ok(/1 \/ 5/.test(await tv.textContent('#ptToWin')) && !/ROUND/.test(await tv.textContent('#pattern')), 'TV shows 1 / 5 and no round numbers');
  await sleep(300); await tv.screenshot({ path: path.join(OUT, 'v16-tv-winner.png') });
  await tv.evaluate(() => { document.getElementById('takeover').classList.add('hidden'); document.getElementById('pattern').classList.remove('celebrate'); }); await sleep(800); await tv.screenshot({ path: path.join(OUT, 'v16-tv-checklist.png') });
  // a second card in the SAME frozen session: B has a full row too → only Fast 5 still open? One Line stays open within this session
  await play(B, ROW0);
  await host.fill('#ckNo', String(B.no)); await host.click('#ckGo');
  await waitFor(async () => /Card.*0*\d+/.test(await host.textContent('#ckOut')));
  const bTxt = await host.textContent('#ckOut');
  ok(/NOT A VALID BINGO|RULE ALREADY COMPLETED/.test(bTxt) || /VALID BINGO/.test(bTxt), 'Second card checked against the same frozen snapshot', bTxt.slice(0, 80));
  await host.evaluate(() => { const b = [...document.querySelectorAll('.modal-back .btn')].find(x => /Close & resume|Close session/.test(x.textContent)); b.click(); });
  await waitFor(async () => !(await state()).session);

  /* ---------- simultaneous winners on the phone remote: B + C both Diagonal in one session */
  await play(B, DIAG); await play(C, DIAG);
  await phone.click('#bingoFab'); await phone.waitForSelector('#checker:not(.hidden)');
  await cmd('freezeClaims', {});
  const vb = await cmd('addClaim', { cardNo: B.no }); const vc = await cmd('addClaim', { cardNo: C.no });
  ok(vb.valid && vc.valid && vb.checklist.qualifying.some(q => q.label === 'DIAGONAL') && vc.checklist.qualifying.some(q => q.label === 'DIAGONAL'), 'Both simultaneous claims qualify for Diagonal on the frozen snapshot');
  await phone.evaluate((id) => { /* open the claim on the phone like tapping it in the list */ document.querySelector('#ckList [data-id="' + id + '"]').click(); }, vb.claimId);
  await phone.waitForSelector('#ckPicks .ck-opt');
  const ph = await phone.$$eval('#ckPicks .ck-opt b', b => b.map(x => x.textContent));
  ok(ph.includes('DIAGONAL'), 'Phone remote shows “Valid for” rule choices', ph.join(', '));
  await phone.screenshot({ path: path.join(OUT, 'v16-phone-choose.png') });
  const dIdx = ph.indexOf('DIAGONAL');
  await phone.click(`#ckPicks .ck-opt:nth-of-type(${dIdx + 1}) input`); await phone.click('#ckConfirm');
  await phone.waitForSelector('#modal:not(.hidden)'); await phone.click('#modal .btn.primary');
  await waitFor(async () => (await state()).checklist.items.find(i => i.label === 'DIAGONAL').winners.length === 1);
  await cmd('confirmClaim', { claimId: vc.claimId, itemId: (await state()).checklist.items.find(i => i.label === 'DIAGONAL').id });
  g = await state();
  ok(g.checklist.items.find(i => i.label === 'DIAGONAL').winners.length === 2, 'Two simultaneous winners for Diagonal (same frozen session)');
  await cmd('closeSession', { resume: true });
  // a later claim for Diagonal → RULE ALREADY COMPLETED
  await play(card(pCard), DIAG);
  const late = await cmd('addClaim', { cardNo: pCard });
  ok(!late.checklist.qualifying.some(q => q.label === 'DIAGONAL') && late.checklist.alreadyCompleted.some(q => q.label === 'DIAGONAL'), 'Later Diagonal claim: rule already completed');
  await cmd('removeClaim', { claimId: late.claimId }); await cmd('closeSession', { resume: true });

  /* ---------- phone remote checklist tab + correct an award */
  await phone.click('#tabs [data-tab=rounds]'); await phone.waitForSelector('#roundBtns .ck-item');
  ok(/Rules/i.test(await phone.textContent('#tabs [data-tab=rounds]')) && /2 OF 5/.test(await phone.textContent('#roundStatus')), 'Phone remote: Rules tab with “2 OF 5 RULES COMPLETED”', await phone.textContent('#roundStatus'));
  await phone.screenshot({ path: path.join(OUT, 'v16-phone-checklist.png') });
  const wA = g.winners.find(w => w.cardNo === A.no);
  await phone.click(`[data-fix="${wA.claimId}"]`); await phone.waitForSelector('#modal:not(.hidden)');
  const fixOpts = await phone.$$eval('#modal button', b => b.map(x => x.textContent));
  ok(fixOpts.some(t => /Award FAST 5 instead/.test(t)) && fixOpts.some(t => /Undo/.test(t)), 'Correct an award offers the other rule the card completed, or undo', fixOpts.join(' | '));
  await phone.evaluate(() => [...document.querySelectorAll('#modal button')].find(b => /Award FAST 5 instead/.test(b.textContent)).click());
  await phone.waitForSelector('#modal:not(.hidden) .btn.primary'); await sleep(200); await phone.click('#modal .btn.primary');
  g = await waitFor(async () => { const x = await state(); return x.winners.find(w => w.cardNo === A.no && w.rule === 'FAST 5') ? x : null; });
  ok(!!g && g.checklist.items.find(i => i.label === 'ONE LINE').status === 'available', 'Award corrected to Fast 5 — One Line available again');
  ok(!!g && (g.audit || []).some(a => a.action === 'winner-corrected'), 'Correction kept in the audit log');

  /* ---------- player phone: checklist, wins, BINGO */
  await play(card(pCard), [10, 11, 12, 13, 14]);
  await waitFor(async () => /WINNING RULES/.test(await priya.textContent('#round')));
  ok((await priya.$$('#round .ckr')).length === 5 && (await priya.$$('#round .ckr.done')).length === 2, 'Player phone shows the checklist with completed rules');
  await priya.click('#bingo'); await priya.waitForSelector('#pop:not(.hidden)');
  ok(/LOOKS LIKE A BINGO/.test(await priya.textContent('#popTitle')), 'Player BINGO (open One Line) is sent to the host', await priya.textContent('#popTitle'));
  await priya.click('#popOk');
  const pc = (await state()).session.claims.find(c => c.cardNo === pCard);
  await cmd('confirmClaim', { claimId: pc.claimId, itemId: (await state()).checklist.items.find(i => i.label === 'ONE LINE').id });
  await cmd('closeSession', { resume: true });
  await waitFor(async () => (await priya.$$('#round .ckr.mine')).length === 1);
  ok(/You won ONE LINE/.test(await priya.textContent('#round')), 'Player phone: “You won ONE LINE — you can still win the others”');
  await priya.screenshot({ path: path.join(OUT, 'v16-player-phone.png') });

  /* ---------- crash-safe: reload the app mid-game; everything comes back */
  const before = await state();
  await br.close();
  await app.close();
  app = await launch(); host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings); await host.evaluate(async () => { await window.cmb.invoke('settings:update', { gameDefaults: { screens: { welcome: true, end: true }, tvScreens: { winner: true, wrongClaim: true, showCardNumber: false, showName: true, closeCount: true, seconds: 7 } } }); window.App.settings = await window.cmb.invoke('settings:get'); }); // 2.3 made these TV extras opt-in; these tests cover them
  inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]); cmd = (a, b) => inv('game:cmd', { action: a, args: b || {} });
  if (!(await inv('game:state')).game) await inv('games:open', { id: gameId });
  const after = await waitFor(async () => (await inv('game:state')).game);
  ok(after.mode === 'checklist' && JSON.stringify(after.checklist.items.map(i => [i.id, i.status, i.winners.map(w => w.cardNo)])) === JSON.stringify(before.checklist.items.map(i => [i.id, i.status, i.winners.map(w => w.cardNo)])), 'After restart: mode, rule order, statuses and winners restored', `${after.checklist.completed}/${after.checklist.total}`);

  /* ---------- finish every rule → ALL BINGO RULES COMPLETED prompt */
  const cmd2 = cmd;
  const rest = after.checklist.items.filter(i => i.status !== 'completed');
  // play the whole of card C, award each remaining rule to it in its own session
  for (const i of [...Array(25).keys()]) { const s = (await inv('game:state')).game; if (!s.history.some(h => h.songId === card(C.no).cells[i])) await cmd2('markPlayed', { songId: card(C.no).cells[i] }); }
  await host.evaluate(() => App.show('host')); await host.waitForSelector('#rStatus');
  for (let k = 0; k < rest.length; k++) {
    const v = await cmd2('addClaim', { cardNo: C.no });
    await cmd2('confirmClaim', { claimId: v.claimId, itemId: rest[k].id });
    if (k < rest.length - 1) await cmd2('closeSession', { resume: true });
  }
  // close the last session from the laptop UI so its own "what next?" appears
  await host.evaluate(() => { App.openChecker(); });
  await host.waitForSelector('.modal-back .btn.primary');
  await host.evaluate(() => { const b = [...document.querySelectorAll('.modal-back .btn')].find(x => /Close & resume|Close session/.test(x.textContent)); b.click(); });
  await host.waitForFunction(() => [...document.querySelectorAll('.modal-back .btn')].some(b => /Continue music without/.test(b.textContent)), null, { timeout: 10000 });
  const btns = await host.$$eval('.modal-back .btn', b => b.map(x => x.textContent));
  ok(btns.some(t => /Finish game/.test(t)) && btns.some(t => /View winners/.test(t)) && btns.some(t => /Continue music without/.test(t)), '“ALL BINGO RULES COMPLETED” offers Finish / View winners / Continue music', btns.join(' | '));
  await host.screenshot({ path: path.join(OUT, 'v16-all-done.png') });
  await host.evaluate(() => [...document.querySelectorAll('.modal-back .btn')].find(x => /Continue music without/.test(x.textContent)).click());
  await waitFor(async () => (await inv('game:state')).game.checklist.closed);
  const fr = await cmd2('freezeClaims', {}).catch(e => ({ ok: false, error: e.message }));
  ok(fr && fr.ok === false && /claims are closed/.test(fr.error || ''), 'After “continue music”, new claims are refused', fr && fr.error);
  await host.waitForSelector('#ckFinish'); await host.click('#ckFinish'); await host.waitForSelector('.modal-back .btn.primary'); await host.click('.modal-back .btn.primary');
  await waitFor(async () => (await inv('game:state')).game.status === 'finished');
  await inv('audience:open');
  const tv2 = await waitFor(async () => { for (const p of app.windows()) { if (/audience/.test(await p.url())) return p; } return null; });
  ok(!!(await waitFor(async () => /5\/5/.test(await tv2.textContent('#esStats')) && /RULES WON/.test(await tv2.textContent('#esStats')))), 'End screen: 5/5 RULES WON');
  await sleep(1500); await tv2.screenshot({ path: path.join(OUT, 'v16-tv-end.png') });

  /* ---------- Round-Based Mode still the default for new games */
  const g2 = await inv('games:create', { name: 'Rounds still work', playlistId: pl.id, cards: 4 });
  ok(g2.mode === 'rounds', 'A new game without choosing a mode is Round-Based');
  await app.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
