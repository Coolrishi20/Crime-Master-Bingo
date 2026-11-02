// Captures the TV winner / wrong-claim screens from the real audience window.
const { _electron: electron } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-tv-'));
  const app = await electron.launch({ executablePath: require('electron'), args: [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1', CMB_NO_REMOTE: '1' }) });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings);
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  await inv('library:importPaths', [process.argv[2]]);
  for (let i = 0; i < 100; i++) { if (!(await inv('library:list')).songs.some(s => s.status === 'unchecked')) break; await sleep(400); }
  const songs = (await inv('library:list')).songs;
  const pl = await inv('playlists:create', { name: 'TV' }); await inv('playlists:add', { id: pl.id, songIds: songs.map(s => s.id) });
  const g = await inv('games:create', { name: 'Thursday Night Music Bingo', playlistId: pl.id, cards: 50, settings: { clipMode: 'full', autoAdvanceGap: 2 } });
  await inv('audience:open'); await sleep(2500);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => { if (w.getTitle().includes('Audience')) w.setContentSize(1600, 900); }));
  await inv('game:cmd', { action: 'startRound', args: { round: 1 } });
  await sleep(14000);
  const game = JSON.parse(fs.readFileSync(path.join(DATA, 'games', g.id + '.json'), 'utf8'));
  const card = game.cards[6];
  for (const id of card.cells.slice(10, 15)) await inv('game:cmd', { action: 'markPlayed', args: { songId: id } });
  await sleep(1200);
  const aud = app.windows().find(w => w.url().includes('audience'));
  await inv('game:cmd', { action: 'freezeClaims' });
  const bad = await inv('game:cmd', { action: 'addClaim', args: { cardNo: 31 } });
  await inv('game:cmd', { action: 'dismissClaim', args: { claimId: bad.claimId } });
  await sleep(1500); await aud.screenshot({ path: path.join(OUT, 'tv-wrong-claim.png') });
  const r = await inv('game:cmd', { action: 'addClaim', args: { cardNo: card.no } });
  await inv('game:cmd', { action: 'confirmClaim', args: { claimId: r.claimId } });
  await sleep(1400); await aud.screenshot({ path: path.join(OUT, 'tv-winner.png') });
  await inv('game:cmd', { action: 'setTvScreens', args: { showCardNumber: true } });
  await inv('game:cmd', { action: 'showTvScreen', args: { claimId: r.claimId, type: 'winner' } });
  await sleep(1400); await aud.screenshot({ path: path.join(OUT, 'tv-winner-with-card.png') });
  await app.close();
})().catch(e => { console.error(e); process.exit(1); });
