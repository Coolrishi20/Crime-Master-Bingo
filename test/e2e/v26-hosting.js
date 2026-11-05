/* 2.6: Talkover and Play on (phone + laptop), MP3 songs on the TV, cards handed out tonight,
 * Help & Guide, Venue Check, and a new game being listed straight away.
 * Run: xvfb-run -a node test/e2e/v26-hosting.js <samplesDir> <mp3Dir> */
const { _electron: electron, chromium } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const ok = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failed++; };
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { } await sleep(200); } return null; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'as-v26-'));
  const app = await electron.launch({ executablePath: process.env.CMB_APP_EXE || require('electron'), args: process.env.CMB_APP_EXE ? ['--no-sandbox'] : [ROOT, '--no-sandbox'],
    env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1' }) });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings);
  host.on('pageerror', e => ok(false, 'host page error', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  const st = async () => (await inv('game:state')).game;

  /* ---- MP3 import */
  await inv('library:importPaths', [process.argv[2], process.argv[3]]);
  await waitFor(async () => { const l = (await inv('library:list')).songs; return l.length >= 51 && !l.some(s => s.status === 'unchecked'); }, 180000);
  const songs = (await inv('library:list')).songs;
  const mp3 = songs.find(s => /\.mp3$/i.test(s.path));
  ok(mp3 && mp3.kind === 'audio' && mp3.status === 'ok' && mp3.title === 'Moonlight Radio' && mp3.artist === 'Tape Deck Club' && mp3.duration > 2,
    'MP3 imports as an audio song with title and artist from its tags', mp3 && `${mp3.artist} — ${mp3.title}, ${mp3.duration}s, ${mp3.statusNote}`);
  await host.evaluate(() => App.show('library')); await sleep(1200);
  await host.screenshot({ path: path.join(OUT, 'v26-library-mp3.png') });

  /* ---- new game listed at once (2.6 fix) */
  const pl = await inv('playlists:create', { name: 'Friday Quiz Night' });
  await inv('playlists:add', { id: pl.id, songIds: [mp3.id].concat(songs.filter(s => s !== mp3).map(s => s.id)) });
  const g = await inv('games:create', { name: 'Friday Quiz Night', playlistId: pl.id, cards: 60, settings: { clipMode: 20, shuffle: false, autoAdvance: false } });
  const listed = await inv('games:list');
  ok(listed.some(x => x.id === g.id), 'A new game is listed straight away (no “Create a game first” on Cards)');
  await host.evaluate(() => App.show('cards')); await sleep(800);
  ok(!/Create a game first/.test(await host.textContent('#main')), 'Cards page opens on the new game at once');

  /* ---- TV: the MP3 plays with a music card */
  await inv('audience:open', {});
  const tv = await waitFor(async () => { for (const p of app.windows()) { if (/audience/.test(await p.url())) return p; } return null; });
  await tv.waitForLoadState('domcontentloaded'); await waitFor(async () => (await inv('audience:status')).ready, 10000);
  await inv('game:cmd', { action: 'startRound', args: { round: 1 } });
  const playing = await waitFor(async () => tv.evaluate(() => { const v = document.getElementById('video'); const c = document.getElementById('audioCard'); return !v.paused && v.currentTime > 1 && c && c.classList.contains('on') && /Song 1/.test(c.textContent) && /Listen and mark your card/.test(c.textContent); }), 20000);
  ok(!!playing, 'The MP3 plays on the TV behind a music card (“Song 1 · Listen and mark your card”)');
  ok(!(await tv.evaluate(() => document.getElementById('audioCard').textContent.includes('Moonlight'))), 'The music card never shows the title (reveal stays as before)');
  await tv.screenshot({ path: path.join(OUT, 'v26-tv-audio.png') });

  /* ---- phone: Talkover and Play on */
  await waitFor(async () => (await inv('remote:info')).running, 15000);
  const ri = await inv('remote:info');
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const phone = await ctx.newPage(); phone.on('pageerror', e => ok(false, 'phone page error', e.message));
  await phone.goto(`http://127.0.0.1:${ri.port}/#pin=${ri.pin}`); await phone.waitForSelector('#main:not(.hidden)', { timeout: 15000 });
  await sleep(800);
  const duck = () => tv.evaluate(() => window.__anthemDuck());
  await phone.dispatchEvent('#talkBtn', 'pointerdown', { pointerId: 1, isPrimary: true });
  const down = await waitFor(async () => (await duck()) < 0.3 && (await st()).playback.talkover, 4000);
  ok(!!down, 'Holding “Hold to talk” on the phone brings the music down', `level ${(await duck()).toFixed(2)}`);
  await phone.screenshot({ path: path.join(OUT, 'v26-phone-talk.png') });
  const v0 = await tv.evaluate(() => !document.getElementById('video').paused);
  await phone.dispatchEvent('#talkBtn', 'pointerup', { pointerId: 1, isPrimary: true });
  const up = await waitFor(async () => (await duck()) > 0.99 && !(await st()).playback.talkover, 4000);
  ok(!!up && v0, 'Letting go brings it back up; the song never paused');
  // phone drops while holding → released by the laptop
  await phone.dispatchEvent('#talkBtn', 'pointerdown', { pointerId: 2, isPrimary: true });
  await waitFor(async () => (await st()).playback.talkover, 3000);
  await phone.close();
  ok(!!(await waitFor(async () => !(await st()).playback.talkover && (await duck()) > 0.99, 8000)), 'A phone that disconnects mid-hold never leaves the music down');
  const phone2 = await ctx.newPage(); await phone2.goto(`http://127.0.0.1:${ri.port}/#pin=${ri.pin}`); await phone2.waitForSelector('#main:not(.hidden)', { timeout: 15000 }); await sleep(600);
  const end0 = (await st()).playback.clipEnd;
  await phone2.click('#on30');
  ok(!!(await waitFor(async () => (await st()).playback.clipEnd === Math.min(end0 + 30, mp3.duration), 4000)), 'Phone “+30 s” extends only this song', `${end0} → ${(await st()).playback.clipEnd}`);
  ok((await st()).settings.clipMode === 20, 'The game\'s clip length stays 20 s');
  await phone2.screenshot({ path: path.join(OUT, 'v26-phone-playon.png') });

  /* ---- laptop: Host Game controls + T key */
  await host.evaluate(() => App.show('host')); await sleep(800);
  ok(await host.isVisible('#cTalk') && await host.isVisible('#cOn30') && /CLIP FOR ALL SONGS/.test(await host.textContent('#main')), 'Host Game has Hold to talk, +30 s, Full song and “Clip for all songs”');
  await host.keyboard.down('t');
  ok(!!(await waitFor(async () => (await duck()) < 0.3, 4000)), 'Holding T on the laptop lowers the music');
  await host.keyboard.up('t');
  ok(!!(await waitFor(async () => (await duck()) > 0.99, 4000)), 'Releasing T brings it back');

  /* ---- cards handed out tonight */
  await inv('game:cmd', { action: 'setHandedOut', args: { spec: '1-48' } });
  await sleep(400);
  ok(/Handed out tonight:.*001-048/.test(await host.textContent('#hoLine')), 'Host Game shows “Handed out tonight: 001-048”');
  await host.evaluate(() => { App.openChecker('57'); }); await sleep(1500);
  const warn = await host.textContent('.modal-back');
  ok(/Card 057 wasn't handed out tonight/.test(warn), 'Checking card 57 warns it wasn\'t handed out (the check still runs)');
  await host.screenshot({ path: path.join(OUT, 'v26-check-warning.png') });
  await host.keyboard.press('Escape'); await sleep(300);
  await inv('game:cmd', { action: 'closeSession', args: {} }).catch(() => {});
  await inv('game:cmd', { action: 'pause', args: {} }).catch(() => {});

  /* ---- Help & Guide */
  await host.evaluate(() => App.show('host')); await sleep(400);
  await host.keyboard.press('F1'); await sleep(1200);
  ok(await host.evaluate(() => App.view) === 'help' && (await host.$$('#hpToc a')).length > 20, 'F1 opens Help & Guide with a contents list');
  const hopped = await host.evaluate(() => { const h = document.getElementById('h-running-the-rounds'); const r = h && h.getBoundingClientRect(); return !!r && r.top < 400; });
  ok(hopped, 'F1 from Host Game jumps to “Running the rounds”');
  await host.fill('#hpFind', 'talkover'); await sleep(400);
  const vis = await host.evaluate(() => Array.from(document.querySelectorAll('#hpBody h3, #hpBody h4')).filter(h => !h.hidden).map(h => h.textContent));
  ok(vis.some(t => /Talkover/.test(t)) && vis.length < 12 && (await host.$$('#hpBody mark')).length > 0, 'Searching the guide shows only matching sections, highlighted', vis.slice(0, 4).join(' | '));
  await host.screenshot({ path: path.join(OUT, 'v26-help.png') });

  /* ---- Venue Check */
  await host.evaluate(() => App.show('venuecheck')); await sleep(1000);
  await host.click('#vcShow');
  ok(!!(await waitFor(async () => tv.evaluate(() => { const v = document.getElementById('venueTest'); return v && v.classList.contains('on'); }), 6000)), 'Venue Check shows the test card on the TV');
  await tv.screenshot({ path: path.join(OUT, 'v26-tv-testcard.png') });
  await host.click('#vcAsk [data-a="ok"]'); await sleep(500);
  await host.click('#vcPlay');
  ok(!!(await waitFor(async () => /test sound/i.test(await tv.textContent('#vtSnd')), 5000)), 'The test sound plays through the TV window');
  await waitFor(async () => host.isVisible('#vcAsk'), 4000);
  await host.click('#vcAsk [data-a="ok"]'); await sleep(500);
  const phone3 = await ctx.newPage(); await phone3.goto(`http://127.0.0.1:${ri.port}/#pin=${ri.pin}`);
  ok(!!(await waitFor(async () => /connected/.test(await host.textContent('#vcRes')), 12000)), 'The phone step passes as soon as a phone connects');
  await waitFor(async () => host.isVisible('#vcRun'), 6000);
  await host.click('#vcRun');
  await waitFor(async () => /dropped frames|Not tested/.test(await host.textContent('#vcRes')), 30000);
  await waitFor(async () => host.isVisible('#vcSave'), 5000);
  await host.screenshot({ path: path.join(OUT, 'v26-venuecheck.png') });
  await host.click('#vcSave'); await sleep(500);
  const last = await inv('venue:last');
  ok(last && last.results.tv.status === 'ok' && last.results.sound.status === 'ok' && last.results.phone.status === 'ok' && last.results.video, 'Venue Check saves its results', JSON.stringify(Object.fromEntries(Object.entries(last.results).map(([k, v]) => [k, v.status]))));
  await host.evaluate(() => App.show('dashboard')); await sleep(400);
  ok(!(await tv.evaluate(() => document.getElementById('venueTest').classList.contains('on'))), 'Leaving Venue Check hides the test card');

  await br.close(); await app.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
