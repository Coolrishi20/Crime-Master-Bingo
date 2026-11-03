/* v1.4 home play: share cards as images (PNG per card, names, identical QR), and phone cards
 * for players (join, own card, tap-to-mark, instant BINGO check, host confirm → phone told).
 * Run: xvfb-run -a node test/e2e/v14-check.js <samplesDir> */
const { _electron: electron, chromium } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const ok = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failed++; };
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { /* */ } await sleep(250); } return null; };
const ONLY = process.env.ONLY || 'all';
(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-v14-'));
  const app = await electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1' }) });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings);
  host.on('pageerror', e => ok(false, 'host page error', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  const cmd = (a, b) => inv('game:cmd', { action: a, args: b || {} });
  await inv('library:importPaths', [process.argv[2]]);
  await waitFor(async () => !(await inv('library:list')).songs.some(s => s.status === 'unchecked'), 60000);
  const songs = (await inv('library:list')).songs;
  const pl = await inv('playlists:create', { name: 'Home Night' }); await inv('playlists:add', { id: pl.id, songIds: songs.map(s => s.id) });
  const g = await inv('games:create', { name: 'Diwali Bingo', venue: 'Our house', playlistId: pl.id, cards: 20 });

  /* ---------------- share cards as images ---------------- */
  if (ONLY === 'all' || ONLY === 'images') {
    let err = null; try { await inv('cards:exportImages', { id: g.id, range: '1-2', folder: OUT, confirmLock: true }); } catch (e) { err = e.message; }
    ok(/Home play/.test(err || ''), 'Image export is off until enabled in Settings → Home play', err && err.replace(/^.*Error: /, ''));
    await inv('settings:update', { home: { shareImages: true } });
    const IMG = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-img-'));
    const t = Date.now();
    const r = await inv('cards:exportImages', { id: g.id, range: '1-3', names: ['Mum', 'Rahul'], folder: IMG, confirmLock: true });
    const files = fs.readdirSync(IMG).sort();
    ok(r.files === 3 && files.length === 3, '3 cards saved as 3 PNG images', `${files.join(', ')} in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    ok(files[0] === 'Diwali-Bingo-Card-001-Mum.png' && files[1] === 'Diwali-Bingo-Card-002-Rahul.png' && files[2] === 'Diwali-Bingo-Card-003.png', 'File names carry the card number and player name');
    const sum = await inv('cards:summary', { id: g.id });
    ok(sum.locked && sum.printed === 3, 'Sharing images issues + locks those cards like printing', `printed ${sum.printed}, locked ${sum.locked}`);
    // decode the QR code inside the image and check the size
    const br = await chromium.launch(); const page = await br.newPage();
    await page.addScriptTag({ path: require.resolve('jsqr/dist/jsQR.js') });
    for (const [i, f] of files.entries()) {
      const b64 = fs.readFileSync(path.join(IMG, f)).toString('base64');
      const res = await page.evaluate(async (src) => {
        const img = new Image(); img.src = src; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height);
        // blank check: count non-white pixels
        let ink = 0; for (let k = 0; k < d.data.length; k += 40) if (d.data[k] < 200) ink++;
        const q = jsQR(d.data, c.width, c.height);
        return { w: img.width, h: img.height, qr: q ? q.data : null, ink };
      }, 'data:image/png;base64,' + b64);
      ok(res.w >= 1500 && res.h >= 1050 && res.ink > 2000 && res.qr === `CMB1|${g.id}|${i + 1}`, `Image ${i + 1}: sharp (${res.w}×${res.h}), not blank, QR decodes to card ${i + 1}`, res.qr || 'no QR');
    }
    await br.close();
    fs.copyFileSync(path.join(IMG, files[1]), path.join(OUT, 'v14-card-image.png'));
    // Cards screen shows the panel
    await host.evaluate(() => { App.settings.home.shareImages = true; App.show('cards'); });
    ok(!!(await waitFor(() => host.$('#cShare #shGo'))), 'Bingo Cards screen shows “Share cards as images” when enabled');
    await host.screenshot({ path: path.join(OUT, 'v14-share-panel.png') });
  }
  /* ---------------- phone cards for players ---------------- */
  if (ONLY === 'all' || ONLY === 'phone') {
    if (!(await inv('game:state')).game) await inv('games:open', { id: g.id });
    await waitFor(async () => (await inv('remote:info')).running, 15000);
    let j = await inv('players:join');
    ok(!j.enabled, 'Phone cards are off until enabled in Settings → Home play');
    await inv('settings:update', { home: { phoneCards: true, joinOnTv: true } });
    j = await inv('players:join');
    ok(j.enabled && /^http:\/\/.+:\d+\/play$/.test(j.url) && /^data:image\/png/.test(j.qr), 'Join link + QR (plain http, no certificate warning)', j.url);
    // TV welcome screen shows the join QR
    await inv('audience:open');
    const tv = await waitFor(async () => { for (const p of app.windows()) { if (/audience/.test(await p.url())) return p; } return null; });
    await tv.waitForLoadState('domcontentloaded');
    ok(!!(await waitFor(async () => tv.evaluate(() => !document.getElementById('wlJoin').classList.contains('hidden') && document.getElementById('wlJoinQr').naturalWidth > 0))), 'TV welcome screen shows “Play on your phone” QR');
    await sleep(1200); await tv.screenshot({ path: path.join(OUT, 'v14-tv-welcome-join.png') });

    const br = await chromium.launch();
    const mk = async (w, h) => { const ctx = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); p.on('pageerror', e => ok(false, 'phone page error', e.message)); p.on('dialog', d => d.accept()); await p.goto(j.url.replace(/\/\/[^:/]+:/, '//127.0.0.1:')); return p; };
    const priya = await mk(344, 882); // Galaxy Fold cover screen
    await priya.waitForSelector('#join:not(.hidden)');
    ok((await priya.textContent('#jGame')) === 'Diwali Bingo', 'Join page shows the game name');
    await priya.fill('#jName', 'Priya'); await priya.click('#jGo');
    await priya.waitForSelector('#game:not(.hidden)');
    const pCard = await priya.textContent('#meCard');
    ok(/^0\d\d$/.test(pCard) && Number(pCard) === (ONLY === 'phone' ? 1 : 4), 'Priya gets the lowest card not printed/shared yet', 'card ' + pCard);
    ok((await priya.$$('.cell')).length === 25, 'Her phone shows all 25 songs of her card');
    const rahul = await mk(412, 915);
    await rahul.waitForSelector('#join:not(.hidden)'); await rahul.fill('#jName', 'Rahul'); await rahul.click('#jGo');
    await rahul.waitForSelector('#game:not(.hidden)');
    const rahul2 = await mk(412, 915);
    await rahul2.waitForSelector('#join:not(.hidden)'); await rahul2.fill('#jName', 'rahul'); await rahul2.click('#jGo');
    await rahul2.waitForSelector('#game:not(.hidden)');
    const c1 = Number(await rahul.textContent('#meCard')), c2 = Number(await rahul2.textContent('#meCard'));
    ok((await rahul2.textContent('#meName')) === 'rahul 2' && c1 === Number(pCard) + 1 && c2 === Number(pCard) + 2, 'Each player gets a different card; duplicate names get a number', `${await rahul.textContent('#meName')} ${c1}, ${await rahul2.textContent('#meName')} ${c2}`);
    const st0 = (await inv('game:state')).game;
    ok(st0.players.length === 3 && st0.players.every(p => !('tokenHash' in p)), 'Host sees 3 players (no secret tokens in host state)');
    ok(await priya.isDisabled('#bingo'), 'BINGO button waits until a round starts');

    // tap-to-mark is kept on the phone across a reload, and the phone rejoins the same card
    await priya.click('.cell[data-i="0"]'); await priya.click('.cell[data-i="7"]');
    await priya.reload(); await priya.waitForSelector('#game:not(.hidden)');
    ok((await priya.textContent('#meCard')) === pCard && (await priya.$$('.cell.on')).length === 2, 'After a reload the phone rejoins the same card with its marks');

    // play: Round 1, mark 4 of the 5 songs in Priya's middle row
    await cmd('startRound', { round: 1 });
    const eng = await app.evaluate(({}, no) => { const c = global.__cmb.engine.game.cards.find(x => x.no === no); return c.cells; }, Number(pCard));
    for (const i of [10, 11, 12, 13]) await cmd('markPlayed', { songId: eng[i] });
    await waitFor(async () => !(await priya.isDisabled('#bingo')));
    await priya.click('#bingo');
    await priya.waitForSelector('#pop:not(.hidden)');
    ok((await priya.textContent('#popTitle')) === 'NOT A BINGO YET' && !(await inv('game:state')).game.session, 'Early BINGO: only her phone is told “not yet”, music not interrupted');
    await priya.screenshot({ path: path.join(OUT, 'v14-phone-not-yet.png') });
    await priya.click('#popOk');
    await cmd('markPlayed', { songId: eng[14] });
    await sleep(4200); // per-phone BINGO cool-down
    await priya.click('#bingo');
    await waitFor(async () => (await priya.textContent('#popTitle')) === 'LOOKS LIKE A BINGO!');
    const st1 = (await inv('game:state')).game;
    const claim = st1.session && st1.session.claims[0];
    ok(!!claim && claim.cardNo === Number(pCard) && claim.owner === 'Priya' && claim.status === 'pending', 'Real BINGO freezes claims and adds Priya\'s card, already checked VALID', claim && `${claim.cardLabel} ${claim.owner} ${claim.status}`);
    await priya.click('#popOk');
    await host.waitForSelector('.modal-back #ckList', { timeout: 8000 }).catch(() => null);
    ok(!!(await host.$('.modal-back #ckList')), 'The claim session opens on the laptop automatically');
    await sleep(500); await host.screenshot({ path: path.join(OUT, 'v14-host-phone-claim.png') });
    await cmd('confirmClaim', { claimId: claim.claimId });
    await waitFor(async () => (await priya.textContent('#popTitle')) === 'YOU WON ROUND 1!');
    ok((await priya.textContent('#popTitle')) === 'YOU WON ROUND 1!', 'Host confirms → her phone shows “YOU WON ROUND 1!”');
    await sleep(600); await priya.screenshot({ path: path.join(OUT, 'v14-phone-won.png') });
    await priya.click('#popOk');
    ok((await priya.textContent('#bingo')).includes('WINNER'), 'Her BINGO button shows she has won this round');

    // take a player out of the game
    await host.keyboard.press('Escape');
    const rid = (await inv('game:state')).game.players.find(p => p.name === 'rahul 2').id;
    await cmd('playerRemove', { playerId: rid });
    await rahul2.waitForSelector('#join:not(.hidden)');
    ok(/removed you/.test(await rahul2.textContent('#jMsg')), 'A removed player\'s phone goes back to the join page');
    // host-side player list
    await host.evaluate(() => { document.querySelectorAll('#modalRoot .modal-back').forEach(m => m.remove()); App._checker = null; App.show('mobile'); });
    await host.waitForSelector('#mpList .check-row');
    ok((await host.$$('#mpList .check-row')).length === 2, 'Mobile Host screen lists the 2 remaining players');
    await sleep(400); await host.screenshot({ path: path.join(OUT, 'v14-host-players.png') });
    await priya.screenshot({ path: path.join(OUT, 'v14-phone-fold-cover.png') });
    await rahul.screenshot({ path: path.join(OUT, 'v14-phone-412.png') });
    // a player phone cannot use the host remote's commands
    const sneaky = await rahul.evaluate(() => new Promise(res => { const w = new WebSocket('ws://' + location.host + '/ws'); w.onopen = () => w.send(JSON.stringify({ type: 'cmd', id: 'x1', action: 'endGame', args: {} })); w.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type !== 'hello') { res(m.type); w.close(); } }; setTimeout(() => res('timeout'), 3000); }));
    ok(sneaky === 'auth-fail' && (await inv('game:state')).game.status !== 'finished', 'A player phone can\'t send host commands', sneaky);
    // joining closed
    await cmd('setPlayersOpen', { open: false });
    const late = await mk(412, 915);
    ok(!!(await late.waitForFunction(() => /closed/.test(document.getElementById('wMsg').textContent), null, { timeout: 8000 }).catch(() => null)), 'With joining closed, a new phone is told to ask the host');
    await br.close();
  }
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  await app.close(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
