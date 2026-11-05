/* End-to-end acceptance test — the real Electron app, a real phone browser
 * (Playwright Chromium, iPhone viewport) and real video playback.
 * Run:  xvfb-run -a node test/e2e/acceptance.js <samplesDir>
 * Samples: node tools/make-sample-videos.js <dir> 50 6 */
const { _electron: electron, chromium } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SAMPLES = path.resolve(process.argv[2] || process.env.SAMPLES || path.join(ROOT, 'sample-videos'));
const OUT = path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; let failed = 0;
function ok(cond, name, detail = '') { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!cond) failed++; console.log(results[results.length - 1]); }
async function waitFor(fn, ms = 20000, step = 250) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { /* retry */ } await sleep(step); } return null; }

async function launch(dataDir) {
  const exe = process.env.CMB_APP_EXE; // optional: test a packaged build
  const app = await electron.launch({ executablePath: exe || require('electron'), args: exe ? ['--no-sandbox'] : [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_DATA_DIR: dataDir, CMB_NO_SANDBOX: '1' }) });
  const host = await app.firstWindow();
  host.on('pageerror', e => ok(false, 'host page error', e.message));
  await host.waitForFunction(() => window.App && window.App.settings); await host.evaluate(async () => { await window.cmb.invoke('settings:update', { gameDefaults: { screens: { welcome: true, end: true }, tvScreens: { winner: true, wrongClaim: true, showCardNumber: false, showName: true, closeCount: true, seconds: 7 } } }); window.App.settings = await window.cmb.invoke('settings:get'); }); // 2.3 made these TV extras opt-in; these tests cover them
  const inv = (ch, p) => host.evaluate(([c, x]) => window.cmb.invoke(c, x), [ch, p]);
  const audience = async () => { const w = await waitFor(async () => app.windows().find(x => x.url().includes('audience')), 10000); return w; };
  return { app, host, inv, audience };
}
const pdfText = (f, first, last) => execFileSync('pdftotext', ['-f', String(first), '-l', String(last), '-layout', f, '-'], { encoding: 'utf8' });

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-e2e-'));
  let L = await launch(DATA);
  let { app, host, inv } = L;

  /* 1-3: import ≥40 videos, playlist */
  const rep = await inv('library:importPaths', [SAMPLES]);
  ok(rep.added.length >= 40, 'Import ≥40 music videos', `${rep.added.length} imported`);
  await waitFor(async () => !(await inv('library:list')).songs.some(s => s.status === 'unchecked'), 120000);
  const lib = (await inv('library:list')).songs;
  ok(lib.filter(s => s.status === 'ok').length === lib.length, 'All videos probed playable (duration + video track)');
  await waitFor(async () => (await inv('library:list')).songs.every(s => s.audio && ['done', 'error', 'no-audio', 'unavailable'].includes(s.audio.status)), 180000, 1000);
  const analysed = (await inv('library:list')).songs.filter(s => s.audio && s.audio.status === 'done');
  ok(analysed.length === lib.length, 'Background loudness analysis completed (Upgrade 3)', `${analysed.length}/${lib.length}, e.g. ${analysed[0] && analysed[0].audio.lufs} LUFS`);
  const pl = await inv('playlists:create', { name: 'Acceptance Mix' });
  const add39 = await inv('playlists:add', { id: pl.id, songIds: lib.slice(0, 39).map(s => s.id) });
  let v = await inv('playlists:validate', { id: pl.id });
  ok(!v.ok && v.needed === 1, '39 songs rejected with exact shortfall', `needs ${v.needed}`);
  let createErr = null; try { await inv('games:create', { name: 'x', playlistId: pl.id, cards: 10 }); } catch (e) { createErr = e.message; }
  ok(/Add 1 more song/.test(createErr || ''), 'Game creation blocked below 40 songs');
  await inv('playlists:add', { id: pl.id, songIds: lib.slice(39).map(s => s.id) });
  const dupe = await inv('playlists:add', { id: pl.id, songIds: [lib[0].id] });
  ok(dupe.rejected.length === 1 && dupe.added.length === 0, 'Duplicate song refused in a playlist');
  v = await inv('playlists:validate', { id: pl.id });
  ok(v.ok && v.uniquePlayable === lib.length, 'Playlist of 40+ accepted', `${v.uniquePlayable} songs`);

  /* 4-8: game, 100 cards, PDF 50 sheets, lock */
  const g = await inv('games:create', { name: 'Acceptance Night', venue: 'Test Pub', playlistId: pl.id, cards: 100, settings: { clipMode: 'full', autoAdvanceGap: 1 } });
  ok(g.cards === 100, 'Generate 100 unique cards');
  const sum = await inv('cards:summary', { id: g.id });
  ok(sum.problems.length === 0 && !sum.locked, 'Cards valid and in DRAFT state');
  const prev = await inv('cards:preview', { id: g.id });
  ok(prev.sheets === 50 && prev.overflow === 0, 'Interactive print preview opens: 50 A4 pages, no overflow');
  const pvw = await waitFor(async () => app.windows().find(w => w.url().includes('print.html')), 10000);
  const qrRes = await pvw.evaluate(() => window.__checkQr());
  ok(/All 100 QR codes scanned and match/.test(qrRes), 'Every printed QR code decodes to its own card number (v1.1 preview check)', qrRes);
  ok(await pvw.evaluate(() => { document.getElementById('pvFind').value = '57'; document.getElementById('pvGo').click(); return !!document.querySelector('.card[data-card="57"].hl'); }), 'Print preview finds a card by number');
  await pvw.close();
  ok(!(await inv('cards:summary', { id: g.id })).locked, 'Print preview does NOT lock cards');
  let lockErr = null; try { await inv('cards:exportPdf', { id: g.id, file: path.join(OUT, 'x.pdf') }); } catch (e) { lockErr = e.message; }
  ok(/LOCK_REQUIRED/.test(lockErr || ''), 'Final export requires the LOCK confirmation');
  const pdf1 = path.join(OUT, 'acceptance-cards.pdf');
  const exp = await inv('cards:exportPdf', { id: g.id, file: pdf1, confirmLock: true });
  const info = execFileSync('pdfinfo', [pdf1], { encoding: 'utf8' });
  ok(/Pages:\s+50\b/.test(info), 'PDF has 50 A4 sheets for 100 cards');
  ok(/Page size:\s+59[45]\.\d+ x 84[12]\.\d+ pts \(A4\)/.test(info), 'Pages are A4 portrait');
  const p1 = pdfText(pdf1, 1, 1);
  ok((p1.match(/CARD No\./g) || []).length === 2 && /001/.test(p1) && /002/.test(p1) && /CUT HERE/.test(p1), 'Each sheet has two complete cards and a cut line');
  ok(exp.overflow === 0, 'No clipped / overflowing card text');
  const sum2 = await inv('cards:summary', { id: g.id });
  ok(sum2.locked && sum2.printed === 100, 'Cards LOCKED / ISSUED after export (Upgrade 7)');
  let regenErr = null; try { await inv('cards:regenerate', { id: g.id }); } catch (e) { regenErr = e.message; }
  ok(/LOCKED/.test(regenErr || ''), 'Locked cards cannot be regenerated');
  const more = await inv('cards:generate', { id: g.id, count: 4 });
  ok(more.from === 101 && more.to === 104, 'Extra cards use unused numbers 101–104');

  /* 9-11: audience window + phone pairing */
  await inv('audience:open');
  const aud = await L.audience();
  await aud.waitForFunction(() => window.__audience, null, { timeout: 15000 });
  const ri = await inv('remote:info');
  ok(ri.running && /^\d{6}$/.test(ri.pin), 'Remote service running with a pairing PIN');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await ctx.newPage();
  phone.on('pageerror', e => ok(false, 'phone page error', e.message));
  await phone.goto(`http://127.0.0.1:${ri.port}/`);
  await phone.fill('#pin', '000000'); await phone.click('#pairBtn');
  ok(!!(await waitFor(() => phone.textContent('#pairMsg').then(t => /Wrong PIN/.test(t)), 5000)), 'Wrong PIN refused');
  await phone.goto(`http://127.0.0.1:${ri.port}/#pin=${ri.pin}`); await phone.reload();
  ok(!!(await waitFor(() => phone.textContent('#connTxt').then(t => t === 'Connected'))), 'Phone paired via QR link + PIN');
  const tapConfirm = async () => { await phone.waitForSelector('#modal:not(.hidden)'); await phone.click('#mBtns button >> nth=0'); };

  /* 12-15: start Round 1 from the phone → TV plays, overlay + pattern */
  await phone.click('#tabs button[data-tab=rounds]');
  await phone.click('#roundBtns .round-btn >> nth=0'); await tapConfirm();
  ok(!!(await waitFor(async () => (await inv('game:state')).game.playback.status === 'playing', 15000)), 'Round 1 started from the phone; laptop is playing');
  const st1 = (await inv('game:state')).game;
  ok(!!(await waitFor(() => aud.evaluate(() => !document.getElementById('video').paused && document.getElementById('video').currentTime > 0.3))), 'TV is playing the music video');
  const ovTitle = await aud.textContent('#ovTitle');
  ok(ovTitle === st1.current.title, 'Correct title overlay on the TV', ovTitle);
  ok((await aud.textContent('#ovArtist')) === st1.current.artist, 'Correct artist overlay on the TV');
  ok((await aud.textContent('#ptLabel')) === 'ONE LINE', 'Round 1 winning pattern shown on the TV');
  ok(await phone.evaluate(() => document.querySelectorAll('audio').length === 0 && Array.from(document.querySelectorAll('video')).every(v => v.paused || !v.srcObject)), 'Phone never plays audio or video');
  // Volume levelling actually applied in the single player
  const audState = await aud.evaluate(() => ({ g: window.__audience.audio.gainDb, ctx: !!window.__audience.context }));
  ok(audState.ctx && audState.g !== 0, 'Levelling gain applied through the single Web Audio chain', `${audState.g} dB`);

  /* 16-20: song completes → crawler */
  ok(!!(await waitFor(async () => (await inv('game:state')).game.history.length >= 1, 20000)), 'Song completes and enters the official history');
  const firstTitle = (await inv('game:state')).game.history[0].title;
  ok(!!(await waitFor(() => aud.evaluate((t) => Array.from(document.querySelectorAll('.tk-item')).some(n => n.textContent.includes('01') && n.textContent.includes(t)), firstTitle), 10000)), 'Played song appears in the crawler below the video', firstTitle);
  const geo = await aud.evaluate(() => { const v = document.getElementById('stage').getBoundingClientRect(); const c = document.getElementById('crawler').getBoundingClientRect(); return { vb: v.bottom, ct: c.top }; });
  ok(geo.ct >= geo.vb - 1, 'Crawler is below the video, not covering it');
  ok(!!(await waitFor(async () => (await inv('game:state')).game.history.length >= 3, 30000)), 'More songs play and are added in order');

  /* 21-23: pause from phone, crawler keeps moving, resume */
  await phone.click('#tabs button[data-tab=play]');
  await waitFor(async () => (await inv('game:state')).game.playback.status === 'playing', 10000);
  await phone.click('#playBtn');
  ok(!!(await waitFor(async () => (await inv('game:state')).game.playback.status === 'paused', 5000)), 'Pause from the phone pauses the laptop');
  const tx = () => aud.evaluate(() => window.__audience.ticker.offset + window.__audience.ticker.widths.length * 1e6 + window.__audience.ticker.queue.cursor * 1e9);
  const a1 = await tx(); await sleep(1200); const a2 = await tx();
  ok(a1 !== a2, 'Crawler keeps scrolling while the music is paused');
  await phone.click('#playBtn');
  ok(!!(await waitFor(async () => (await inv('game:state')).game.playback.status === 'playing', 5000)), 'Resume from the phone');

  /* 24-30: CLAIM FREEZE from the phone with multiple cards */
  const full = JSON.parse(fs.readFileSync(path.join(DATA, 'games', g.id + '.json'), 'utf8'));
  const cardA = full.cards[4], cardB = full.cards[5];
  for (const id of cardA.cells.slice(0, 5)) await host.evaluate((sid) => App.cmd('markPlayed', { songId: sid }), id);
  for (const id of cardB.cells.slice(10, 15)) await host.evaluate((sid) => App.cmd('markPlayed', { songId: sid }), id);
  const posBefore = (await inv('game:state')).game.playback;
  await phone.click('#bingoFab');
  ok(!!(await waitFor(async () => !!(await inv('game:state')).game.session, 5000)), 'Claims frozen from the phone');
  const frozen = (await inv('game:state')).game;
  ok(frozen.playback.status === 'paused' && frozen.playback.pausedForClaim, 'Freezing paused playback mid-song');
  const enter = async (n) => { await phone.click('#ckAgain').catch(() => {}); for (const d of String(n)) await phone.click(`#keypad button:text-is("${d}")`); await phone.click('#ckGo'); await phone.waitForSelector('#ckResult .verdict'); return phone.textContent('#ckResult .verdict .vt'); };
  ok((await enter(cardA.no)) === 'VALID BINGO!', `Card ${cardA.no} valid on the phone`);
  ok(await phone.evaluate(() => document.querySelectorAll('#ckResult .mini .w').length === 5), 'Winning squares highlighted on the phone');
  ok(/Valid for Round 1/.test(await phone.textContent('#ckResult .hl')) && /Won on song #/.test(await phone.textContent('#ckResult')), 'Phone explains the win and names the completing song (v1.1)');
  await phone.click('#ckConfirm'); await tapConfirm();
  ok(!!(await waitFor(async () => (await inv('game:state')).game.winners.length === 1, 5000)), 'First winner confirmed from the phone');
  ok(!!(await waitFor(() => aud.evaluate(() => { const t = document.getElementById('takeover'); return t.classList.contains('winner') && !t.classList.contains('hidden') && document.getElementById('toTitle').textContent === 'BINGO!'; }), 4000)), 'TV winner screen appears (no card number by default)');
  ok((await enter(cardB.no)) === 'VALID BINGO!', 'Second card still valid against the same snapshot after a winner was confirmed');
  await phone.click('#ckConfirm'); await tapConfirm();
  ok(!!(await waitFor(async () => (await inv('game:state')).game.winners.length === 2, 5000)), 'Multiple winners confirmed in one session');
  const rules = require('../../src/core/rules');
  const frozenSet = new Set(frozen.history.map(h => h.songId));
  const bad = full.cards.find(c => c.no > 10 && !rules.checkCard(c.cells, frozenSet, 1).valid);
  ok((await enter(bad.no)) === 'NOT VALID', 'An invalid card is rejected with a reason');
  ok(/^Not a Bingo! Card #\d{3}/.test(await phone.textContent('#ckResult .hl')) && /more needed/.test(await phone.textContent('#ckResult')) && (await phone.$$('#ckResult .mini .nd')).length > 0, 'Invalid claim explains why, the closest pattern and the squares still needed (v1.1)');
  await phone.click('#ckReject');
  ok(!!(await waitFor(() => aud.evaluate(() => document.getElementById('takeover').classList.contains('wrong') && document.getElementById('toTitle').textContent === 'NOT A BINGO'), 4000)), 'TV shows the “Not a Bingo” screen after rejection');
  const audText = await aud.evaluate(() => document.body.innerText);
  ok(!audText.includes(String(cardA.no).padStart(3, '0')) && !/CARD\s*(No\.?\s*)?\d/i.test(audText) && !audText.includes(full.cards[4].cells.map(()=>'').join('x')), 'TV never shows card numbers or claim details');
  await phone.click('#ckResume');
  ok(!!(await waitFor(async () => { const s = (await inv('game:state')).game; return !s.session && s.playback.status === 'playing' && s.playback.index === posBefore.index; }, 5000)), 'Session closed; music resumes the same song');
  // v1.5: the device that closed the session is asked what's next (intermission / next round)
  const askEl = await phone.waitForSelector('#modal:not(.hidden)', { timeout: 5000 }).catch(() => null);
  ok(!!askEl && /Round 1 won/.test(await phone.textContent('#mTitle')), 'v1.5: after the winners, the phone asks: intermission or next round');
  if (askEl) await phone.click('#mBtns button:has-text("Not yet")');

  /* 31-34: Round 2 from the phone */
  /* v1.1 Up Next from the phone */
  const un1 = (await inv('game:state')).game.upNext.next;
  ok(!!un1 && !(await aud.evaluate(() => document.body.innerText)).includes(un1.title), 'Up Next is host-only (never on the TV)');
  await phone.click('#unSkip');
  ok(!!(await waitFor(async () => { const u = (await inv('game:state')).game.upNext; return u.next && u.next.songId !== un1.songId && u.deferred.some(d => d.songId === un1.songId); }, 5000)), 'Phone skips the proposed next song; it stays eligible for later');
  await phone.click('#unPick'); await phone.waitForSelector('#picker:not(.hidden)');
  const pickId = await phone.getAttribute('#pkList [data-next] >> nth=5', 'data-next');
  await phone.click('#pkList [data-next] >> nth=5');
  ok(!!(await waitFor(async () => (await inv('game:state')).game.upNext.next.songId === pickId, 5000)), 'Phone queues a chosen song to play next');
  await phone.click('#unReset');
  ok(!!(await waitFor(async () => !(await inv('game:state')).game.upNext.custom, 5000)), 'Phone returns Up Next to the playlist order');

  /* v1.1 round transition: Complete Round & Continue from the phone */
  await phone.click('#tabs button[data-tab=rounds]');
  await phone.waitForSelector('#completeBig');
  await phone.click('#completeBig'); await tapConfirm();
  ok(!!(await waitFor(() => aud.evaluate(() => document.getElementById('takeover').className === 'round' && /ROUND 1 COMPLETE/.test(document.getElementById('toTitle').textContent)), 5000)), 'TV plays the Round 1 complete transition');
  const rd = (await inv('game:state')).game;
  ok(rd.round.number === 2 && rd.round.status === 'ready' && rd.playback.status === 'paused', 'Round 2 ready; music waits for the host');
  await phone.click('#startReady');
  ok(!!(await waitFor(async () => { const x = (await inv('game:state')).game; return x.round.status === 'active' && x.playback.status === 'playing'; }, 5000)), 'Host starts Round 2 from the phone; music resumes');
  ok(!!(await waitFor(() => aud.textContent('#ptLabel').then(t => t === 'TWO PARALLEL LINES'), 5000)), 'TV switches to the Two Parallel Lines pattern');
  const hl = (await inv('game:state')).game.history.length;
  ok(!!(await waitFor(() => aud.evaluate((n) => window.__audience.ticker.queue.items.length === n, hl), 5000)), 'Crawler keeps every previously played song', `${hl} songs`);

  /* Technical credit from the phone (Upgrade 7) */
  await waitFor(async () => { const c = (await inv('game:state')).game.current; return c && !c.played && (await inv('game:state')).game.playback.status === 'playing'; }, 20000);
  await inv('game:cmd', { action: 'pause' });
  const cur = (await inv('game:state')).game.current;
  await phone.click('#tabs button[data-tab=history]'); await phone.click('#creditBtn');
  await phone.waitForSelector('#modal:not(.hidden)'); await phone.click('#mBtns button >> nth=4'); // "Playback failed during the event"
  await tapConfirm();
  ok(!!(await waitFor(async () => (await inv('game:state')).game.credits.length === 1, 5000)), 'Technical credit granted from the phone with confirmation');
  await inv('game:cmd', { action: 'play' }).catch(() => {});
  const crText = await waitFor(() => aud.evaluate(() => { const t = window.__audience.ticker; const it = t.queue.items.find(i => i.credit); return it ? t.makeNode(it).textContent : null; }), 8000);
  ok(!!crText && /TECHNICAL CREDIT — /.test(crText) && crText.includes(cur.title + '/' + cur.artist), 'Crawler labels it “TECHNICAL CREDIT — Title / Artist”', crText);

  /* 35-38: Round 3, full house */
  await phone.click('#tabs button[data-tab=rounds]');
  await phone.click('#endRound'); await tapConfirm();
  await phone.waitForSelector('#startReady'); await phone.click('#startReady');
  ok(!!(await waitFor(() => aud.textContent('#ptLabel').then(t => t === 'FULL HOUSE'), 5000)), 'TV switches to the Full House pattern');
  const cardC = full.cards[20];
  for (const id of cardC.cells) await host.evaluate((sid) => App.cmd('markPlayed', { songId: sid }), id);
  await phone.click('#tabs button[data-tab=play]');
  await phone.click('#bingoFab'); await waitFor(async () => !!(await inv('game:state')).game.session, 5000);
  ok((await enter(cardC.no)) === 'VALID BINGO!', 'Full House valid');
  await phone.click('#ckConfirm'); await tapConfirm();
  await waitFor(async () => (await inv('game:state')).game.winners.length === 3, 5000);
  await phone.click('#ckCloseKeep');
  ok(!!(await waitFor(async () => !(await inv('game:state')).game.session, 5000)), 'Full House winner confirmed and session closed from the phone');
  const fin = await phone.waitForSelector('#modal:not(.hidden)', { timeout: 5000 }).catch(() => null);
  ok(!!fin && /Round 3 won/.test(await phone.textContent('#mTitle')) && /Finish the game/.test(await phone.textContent('#mBtns')), 'v1.5: last round won → phone offers “Finish the game”');
  if (fin) await phone.click('#mBtns button:has-text("Not yet")');

  /* Phone reconnection after a network drop / screen lock */
  await ctx.setOffline(true); await sleep(1500);
  await phone.evaluate(() => { window.dispatchEvent(new Event('offline')); });
  await ctx.setOffline(false);
  await phone.evaluate(() => { window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
  ok(!!(await waitFor(() => phone.textContent('#connTxt').then(t => t === 'Connected'), 20000)), 'Phone reconnects automatically after a network drop');
  await phone.click('#muteBtn');
  ok(!!(await waitFor(async () => (await inv('game:state')).game.settings.audio.muted, 5000)), 'Phone controls still work after reconnecting (mute)');
  await phone.click('#muteBtn');

  /* 39-40: end, save, reopen */
  const before = (await inv('game:state')).game;
  await phone.click('#tabs button[data-tab=rounds]'); await phone.click('#endGame'); await tapConfirm();
  ok(!!(await waitFor(async () => (await inv('game:state')).game.status === 'finished', 5000)), 'Game ended from the phone');
  await browser.close();
  await app.close();
  L = await launch(DATA); ({ app, host, inv } = L);
  await inv('games:open', { id: g.id });
  const after = (await inv('game:state')).game;
  const gameFile = JSON.parse(fs.readFileSync(path.join(DATA, 'games', g.id + '.json'), 'utf8'));
  ok(JSON.stringify(gameFile.cards.slice(0, 100).map(c => [c.no, c.cells])) === JSON.stringify(full.cards.slice(0, 100).map(c => [c.no, c.cells])), 'Card mappings identical after reopening');
  ok(JSON.stringify(after.history) === JSON.stringify(before.history), 'Song history identical after reopening', `${after.history.length} entries`);
  ok(after.winners.length === 3 && after.status === 'finished' && after.cardsLocked, 'Winners, progress and lock preserved');

  /* Crash recovery */
  await inv('game:cmd', { action: 'reopenGame' });
  await inv('audience:open'); await sleep(1500);
  await inv('game:cmd', { action: 'play' }).catch(() => {});
  await sleep(1500);
  await inv('game:cmd', { action: 'freezeClaims' });
  await sleep(500);
  const crashState = (await inv('game:state')).game;
  app.process().kill('SIGKILL');
  await sleep(1000);
  L = await launch(DATA); ({ app, host, inv } = L);
  const ai = await inv('app:info');
  ok(ai.recovery && ai.recovery.crashed && ai.recovery.gameId === g.id, 'Unexpected shutdown detected → RESUME LAST GAME offered');

  await inv('games:open', { id: g.id });
  const rec = (await inv('game:state')).game;
  ok(rec.session && rec.session.id === crashState.session.id && rec.playback.status === 'paused', 'Frozen claim session restored after the crash, playback paused');
  ok(rec.history.length === crashState.history.length && rec.playback.index === crashState.playback.index, 'History and current song restored after the crash');
  await inv('game:cmd', { action: 'closeSession', args: {} });

  /* Backup → restore on a "different laptop" → identical PDF + claims (Upgrade 8) */
  const bk = path.join(OUT, 'acceptance.cmbbackup');
  if (fs.existsSync(bk)) fs.unlinkSync(bk);
  const b = await inv('backup:create', { id: g.id, includeMedia: true, file: bk, password: 'pub quiz 2026' });
  ok(b && b.mediaIncluded === lib.length && b.encrypted, 'Encrypted full portable backup created', `${(b.size / 1048576).toFixed(1)} MB`);
  await app.close();
  const DATA2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-e2e-laptop2-'));
  L = await launch(DATA2); ({ app, host, inv } = L);
  const insp = await inv('backup:inspect', { file: bk });
  ok(insp.needsPassword, 'Encrypted backup asks for its password');
  const insp2 = await inv('backup:inspect', { file: bk, password: 'pub quiz 2026' });
  ok(insp2.ok && insp2.checks.every(c => c.ok), 'Backup integrity verified before restoring', insp2.checks.map(c => c.label).join(', '));
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-media-'));
  const rs = await inv('backup:restore', { file: bk, password: 'pub quiz 2026', mediaDir });
  ok(rs.ok && rs.gameId === g.id && rs.missing === 0 && rs.mediaRestored === lib.length, 'Restored on a second laptop with all videos');
  const pdf2 = path.join(OUT, 'acceptance-cards-restored.pdf');
  await inv('cards:exportPdf', { id: g.id, file: pdf2, range: '1-100' });
  ok(pdfText(pdf1, 1, 50) === pdfText(pdf2, 1, 50), 'Restored game prints exactly the same 100 bingo cards');
  await inv('games:open', { id: g.id });
  await inv('game:cmd', { action: 'reopenGame' });
  const rv = await inv('game:cmd', { action: 'addClaim', args: { cardNo: cardC.no } });
  ok(rv.valid && rv.alreadyWinner, 'Claims verify on the restored game (Full House card, already a winner)');
  const rv2 = await inv('game:cmd', { action: 'addClaim', args: { qr: `CMB1|GBADBAD|${cardC.no}` } });
  ok(/different game/.test(rv2.error || ''), 'QR from another game rejected on the restored game');
  const ri2 = await inv('remote:info');
  ok(ri2.devices.length === 0, 'Restored laptop does not trust the old phone (fresh pairing needed)');
  await app.close();

  fs.writeFileSync(path.join(OUT, 'e2e-results.txt'), results.join('\n') + `\n\n${results.length - failed} passed, ${failed} failed\n`);
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('E2E CRASHED', e); fs.writeFileSync(path.join(OUT, 'e2e-results.txt'), results.join('\n') + '\nCRASHED: ' + e.stack); process.exit(2); });
