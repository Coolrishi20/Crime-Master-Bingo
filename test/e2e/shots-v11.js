// Screenshots of the v1.1 features (dev aid). Run under xvfb-run with SAMPLES and SHOTS.
const { _electron: electron, chromium } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output', 'shots'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-v11-'));
  const app = await electron.launch({ executablePath: require('electron'), args: [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1' }) });
  app.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text()); });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings);
  host.on('pageerror', e => console.log('[host error]', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  const cmd = (a, b) => inv('game:cmd', { action: a, args: b || {} });
  await inv('library:importPaths', [process.env.SAMPLES]);
  for (let i = 0; i < 100; i++) { if (!(await inv('library:list')).songs.some(s => s.status === 'unchecked')) break; await sleep(400); }
  const songs = (await inv('library:list')).songs;
  // a long title to exercise fitting / warnings
  await inv('library:update', { id: songs[0].id, fields: { title: 'Supercalifragilisticexpialidocious Extraordinarily Long Title (Extended Twelve Inch Club Remix Version)', artist: 'Ünïcödé Ärtîst & The Punctuation!? Orchestra' } });
  await inv('library:update', { id: songs[1].id, fields: { title: 'Ek Pal Ka Jeena — एक पल का जीना', artist: 'Lucky Ali' } });
  const pl = await inv('playlists:create', { name: 'V11' }); await inv('playlists:add', { id: pl.id, songIds: songs.map(s => s.id) });
  const g = await inv('games:create', { name: 'Friday Fold Night', venue: 'The Crown', playlistId: pl.id, cards: 60, settings: { clipMode: 'full', autoAdvanceGap: 1 } });
  // print preview
  const pv = await inv('cards:preview', { id: g.id });
  console.log('preview', JSON.stringify(pv));
  const prevWin = app.windows().find(w => w.url().includes('print.html'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => { if (w.getTitle().includes('Print Preview')) w.setSize(1300, 1000); }));
  await sleep(800);
  await prevWin.evaluate(() => { document.getElementById('pvFind').value = '7'; document.getElementById('pvGo').click(); });
  await sleep(600);
  await prevWin.screenshot({ path: path.join(OUT, 'v11-print-preview.png') });
  const qr = await prevWin.evaluate(() => window.__checkQr());
  console.log('QR check:', qr);
  await prevWin.evaluate(() => { document.getElementById('pvIn').click(); document.getElementById('pvIn').click(); document.getElementById('pvIn').click(); document.querySelector('.card[data-card="1"]').scrollIntoView({ block: 'start' }); window.scrollBy(0, -100); });
  await sleep(500);
  await prevWin.screenshot({ path: path.join(OUT, 'v11-print-preview-zoom.png') });
  const pdf = path.join(OUT, 'v11-cards.pdf');
  await inv('cards:exportPdf', { id: g.id, file: pdf, confirmLock: true });
  // game
  await inv('audience:open'); await sleep(2500);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => { if (w.getTitle().includes('Audience')) w.setContentSize(1600, 900); }));
  await cmd('startRound', { round: 1 });
  await sleep(9000);
  const game = JSON.parse(fs.readFileSync(path.join(DATA, 'games', g.id + '.json'), 'utf8'));
  const st = (await inv('game:state')).game;
  await cmd('queueSong', { songId: st.order[30].songId });
  const card = game.cards[3];
  for (const id of card.cells.slice(5, 9)) await cmd('markPlayed', { songId: id });
  await host.evaluate(() => App.show('host')); await sleep(800);
  await host.screenshot({ path: path.join(OUT, 'v11-host-upnext.png') });
  // invalid claim explained
  await host.evaluate((n) => { App.openChecker(String(n)); }, card.no); await sleep(1500);
  await host.screenshot({ path: path.join(OUT, 'v11-check-invalid.png') });
  await host.keyboard.press('Escape'); await sleep(300);
  const r0 = (await inv('game:state')).game.session.claims[0];
  await cmd('dismissClaim', { claimId: r0.claimId, quiet: true });
  await cmd('closeSession', {});
  await cmd('markPlayed', { songId: card.cells[9] });
  await host.evaluate((n) => { App.openChecker(String(n)); }, card.no); await sleep(1500);
  await host.screenshot({ path: path.join(OUT, 'v11-check-valid.png') });
  const v = (await inv('game:state')).game.session.claims.find(c => c.status === 'pending');
  await cmd('confirmClaim', { claimId: v.claimId });
  await host.keyboard.press('Escape'); await sleep(300);
  await cmd('closeSession', {});
  await sleep(8000);
  await host.screenshot({ path: path.join(OUT, 'v11-host-round-winner.png') });
  // phone
  const ri = await inv('remote:info');
  const br = await chromium.launch();
  for (const [name, vp] of [['fold-cover', { width: 344, height: 882 }], ['fold-open', { width: 690, height: 830 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await br.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const ph = await ctx.newPage(); ph.on('pageerror', e => console.log('[phone error]', e.message));
    await ph.goto(`http://127.0.0.1:${ri.port}/#pin=${ri.pin}`); await ph.reload(); await sleep(1800);
    await ph.screenshot({ path: path.join(OUT, `v11-${name}-play.png`) });
    if (name !== 'phone') {
      await ph.click('#tabs button[data-tab=rounds]'); await sleep(400);
      await ph.screenshot({ path: path.join(OUT, `v11-${name}-rounds.png`) });
      await ph.click('#tabs button[data-tab=play]'); await sleep(300);
      await ph.click('#unPick'); await sleep(500);
      await ph.screenshot({ path: path.join(OUT, `v11-${name}-picker.png`) });
      await ph.click('#pkClose');
      await ph.click('#bingoFab'); await sleep(800);
      for (const d of String(game.cards[10].no)) await ph.click(`#keypad button:text-is("${d}")`);
      await ph.click('#ckGo'); await sleep(1200);
      await ph.screenshot({ path: path.join(OUT, `v11-${name}-check.png`), fullPage: true });
      const cl = (await inv('game:state')).game.session;
      for (const c of cl.claims) if (c.status === 'pending' || c.status === 'invalid') await cmd('dismissClaim', { claimId: c.claimId, quiet: true });
      await cmd('closeSession', {});
    }
    await ctx.close();
  }
  await br.close();
  // round transition on TV
  const aud = app.windows().find(w => w.url().includes('audience'));
  await cmd('completeRound', { fromRound: 1 });
  await sleep(1500);
  await aud.screenshot({ path: path.join(OUT, 'v11-tv-round-transition.png') });
  await sleep(9000);
  await aud.screenshot({ path: path.join(OUT, 'v11-tv-next-ready.png') });
  await host.screenshot({ path: path.join(OUT, 'v11-host-round-ready.png') });
  await cmd('startRound', { round: 2 }); await cmd('completeRound', { fromRound: 2 }); await cmd('startRound', { round: 3 });
  await cmd('completeRound', { fromRound: 3 }); await sleep(1500);
  await aud.screenshot({ path: path.join(OUT, 'v11-tv-final.png') });
  await app.close();
  console.log('done');
})().catch(e => { console.error('FAILED', e); process.exit(1); });
