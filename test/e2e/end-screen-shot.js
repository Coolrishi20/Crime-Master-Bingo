// Renders the end-of-night screen after a realistic 3-round game (dev aid / screenshot).
const { _electron: electron } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const rules = require('../../src/core/rules');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-end-'));
  const app = await electron.launch({ executablePath: require('electron'), args: [ROOT, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1', CMB_NO_REMOTE: '1' }) });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings);
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  const cmd = (a, b) => inv('game:cmd', { action: a, args: b || {} });
  await inv('library:importPaths', [process.argv[2]]);
  for (let i = 0; i < 100; i++) { if (!(await inv('library:list')).songs.some(s => s.status === 'unchecked')) break; await sleep(400); }
  const songs = (await inv('library:list')).songs;
  const pl = await inv('playlists:create', { name: 'End' }); await inv('playlists:add', { id: pl.id, songIds: songs.map(s => s.id) });
  const g = await inv('games:create', { name: 'Decades Night', venue: 'The Crown', playlistId: pl.id, cards: 60, settings: { clipMode: 'full' } });
  await inv('audience:open'); await sleep(2500);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => { if (w.getTitle().includes('Audience')) w.setContentSize(Number(process.env.W || 1600), Number(process.env.H || 900)); }));
  const game = JSON.parse(fs.readFileSync(path.join(DATA, 'games', g.id + '.json'), 'utf8'));
  const order = game.order; const N = Number(process.env.SONGS || 40);
  const plan = [[1, 14], [2, 27], [3, N]]; let k = 0;
  for (const [round, upto] of plan) {
    await cmd('startRound', { round, play: false });
    for (; k < upto; k++) await cmd('markPlayed', { songId: order[k] });
    // make sure this round has winners: complete a pattern on a couple of cards
    const need = round === 1 ? [0, 1, 2, 3, 4] : round === 2 ? [5, 6, 7, 8, 9, 15, 16, 17, 18, 19] : [...Array(25).keys()];
    for (const c of game.cards.slice(round * 2, round * 2 + (round === 3 ? 1 : 2))) for (const i of need) { await cmd('markPlayed', { songId: c.cells[i] }); }
    const st = (await inv('game:state')).game; const set = new Set(st.history.map(h => h.songId));
    const winners = game.cards.filter(c => rules.checkCard(c.cells, set, round).valid).slice(0, round === 3 ? 1 : 2);
    if (winners.length) { await cmd('freezeClaims'); for (const w of winners) { const r = await cmd('addClaim', { cardNo: w.no }); await cmd('confirmClaim', { claimId: r.claimId }); } await cmd('closeSession', {}); }
    if (round < 3) await cmd('completeRound', { fromRound: round });
  }
  await cmd('setTvScreens', { winner: false });
  await cmd('endGame');
  const aud = app.windows().find(w => w.url().includes('audience'));
  await sleep(10000); // let the last round transition finish
  await cmd('reopenGame'); await cmd('endGame');
  await sleep(900); await aud.screenshot({ path: path.join(OUT, 'end-1-confetti.png') });
  await sleep(3000); await aud.screenshot({ path: path.join(OUT, 'end-2-settled.png') });
  await sleep(12000); await aud.screenshot({ path: path.join(OUT, 'end-3-scrolled.png') });
  await app.close(); console.log('done');
})().catch(e => { console.error('FAILED', e); process.exit(1); });
