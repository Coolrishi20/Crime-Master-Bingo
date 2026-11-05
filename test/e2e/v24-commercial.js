/* 2.2–2.4 commercial upgrade, integrated in the real app:
 * media check, relink wizard, clip editor, gap presets, quick-start presets + pacing estimate,
 * Ready for Bingo?, card footer/font, automatic + one-click backups, usage report, onboarding
 * with a rehearsal game, licence framework (free), rollback info.
 * Run: xvfb-run -a node test/e2e/v24-commercial.js <samplesDir> */
const { _electron: electron } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const ROOT = path.join(__dirname, '..', '..'); const OUT = process.env.SHOTS || path.join(ROOT, 'test-output'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0; const ok = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failed++; };
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { } await sleep(250); } return null; };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'as-v24-'));
  // a private copy of the sample videos (this test moves and renames some)
  const MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), 'as-v24m-')); const SRC = process.argv[2];
  fs.readdirSync(SRC).filter(f => /\.mp4$/i.test(f)).forEach(f => fs.copyFileSync(path.join(SRC, f), path.join(MEDIA, f)));
  const app = await electron.launch({ executablePath: require('electron'), args: [ROOT, '--no-sandbox'],
    env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1', CMB_NO_REMOTE: '1', CMB_ONBOARD: '1' }) });
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings);
  host.on('pageerror', e => ok(false, 'host page error', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 950));
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  const closeModals = () => host.evaluate(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));

  /* ---- onboarding: first run opens Get started with the rights notice */
  ok(!!(await waitFor(async () => /Welcome to Anthem Square/.test(await host.textContent('#main')), 8000)), 'First run opens the Get started guide');
  ok(await host.isVisible('#obNotice') && /software only/.test(await host.textContent('#obNotice')), 'Rights notice shown with “I understand”');
  await host.click('#obAccept'); await sleep(400);
  ok(!(await host.isVisible('#obNotice')), 'Notice accepted and remembered');
  await host.screenshot({ path: path.join(OUT, 'v24-start.png') });

  /* ---- import + media check */
  await inv('library:importPaths', [MEDIA]);
  await waitFor(async () => { const l = (await inv('library:list')).songs; return l.length >= 50 && !l.some(s => s.status === 'unchecked'); }, 180000);
  const media = await waitFor(async () => { const r = await inv('media:report', {}); return r.pending === 0 ? r : null; }, 120000);
  ok(media && media.total >= 50 && media.ready + media.optimise + media.unsupported === media.total, 'Media check: every video checked (codec, size, fps, bitrate, keyframes)', media && JSON.stringify({ ready: media.ready, optimise: media.optimise, unsupported: media.unsupported }));
  const one = media.rows.find(r => r.media);
  ok(one && one.media.vcodec === 'h264' && one.media.height > 0 && one.media.fps > 0 && one.media.keyGap != null, 'Stored per song: codec, resolution, fps, keyframe spacing', JSON.stringify(one && one.media));
  await host.evaluate(() => App.show('library')); await sleep(800);
  await host.click('#lMedia'); await host.waitForSelector('.mc-tiles');
  ok(/Ready/.test(await host.textContent('.mc-tiles')), 'Media check window opens with Ready / Needs optimisation / … tiles');
  await host.screenshot({ path: path.join(OUT, 'v24-mediacheck.png') }); await closeModals();

  /* ---- relink wizard: one file moved + renamed (same content), one replaced by a different file with the same name */
  const songs = (await inv('library:list')).songs;
  const sA = songs[0], sB = songs[1];
  const moved = fs.mkdtempSync(path.join(os.tmpdir(), 'as-v24moved-'));
  fs.renameSync(sA.path, path.join(moved, 'renamed copy.mp4'));
  fs.copyFileSync(songs[5].path, path.join(moved, path.basename(sB.path))); fs.unlinkSync(sB.path);
  await inv('library:checkFiles');
  await host.evaluate(() => App.show('library')); await sleep(800);
  ok(/2 videos can't be found/.test(await host.textContent('#lMissing')), 'Library shows a missing-videos banner naming the folder', (await host.textContent('#lMissing')).slice(0, 120));
  const scan = await inv('library:relinkScan', { folder: moved });
  const byId = Object.fromEntries(scan.results.map(r => [r.id, r.candidate]));
  ok(byId[sA.id] && byId[sA.id].auto && byId[sA.id].match === 'fingerprint', 'Renamed identical file found as SAME FILE (ticked)');
  ok(byId[sB.id] && !byId[sB.id].auto && byId[sB.id].match === 'filename', 'Same name, different content: offered as SAME NAME? (not ticked)');
  // drive the wizard UI with a scan of that folder
  await host.evaluate((folder) => { window.__rw = relinkWizard({ title: 'Find missing videos', scan: () => api('library:relinkScan', { folder }), apply: (p) => api('library:relinkConfirm', { items: p.map(x => ({ id: x.key, path: x.path })) }) }); }, moved);
  await host.waitForSelector('.rl-table');
  const ticks = await host.$$eval('.rl-table input[data-i]', els => els.map(e => e.checked));
  ok(ticks.length === 2 && ticks.filter(Boolean).length === 1, 'Wizard pre-ticks only the exact match', JSON.stringify(ticks));
  await host.screenshot({ path: path.join(OUT, 'v24-relink.png') });
  await host.click('.modal-foot .btn.primary'); await host.evaluate(() => window.__rw);
  const after = (await inv('library:list')).songs;
  ok(after.find(s => s.id === sA.id).status !== 'missing' && after.find(s => s.id === sB.id).status === 'missing', 'Only the ticked match was relinked; song IDs kept');

  /* ---- clip editor */
  await host.evaluate((s) => { setTimeout(() => window.editSong(s), 0); }, after[3]); await host.waitForSelector('#eTabs');
  await host.click('#eTabs [data-t=clip]'); await host.waitForSelector('#clTl canvas');
  await host.click('#clLen [data-l="20"]');
  const se = await host.evaluate(() => [document.getElementById('eS').value, document.getElementById('eE').value]);
  ok(se[0] !== '' && Math.abs(Number(se[1]) - Number(se[0]) - 20) < 0.6, 'Clip tab: timeline, 20 s preset sets start/end', JSON.stringify(se));
  await host.screenshot({ path: path.join(OUT, 'v24-clip.png') });
  await host.click('.modal-foot .btn.primary'); await sleep(500);
  const clipSong = (await inv('library:list')).songs.find(s => s.id === after[3].id);
  ok(clipSong.clipStart != null && clipSong.clipEnd - clipSong.clipStart === 20, 'Saved through the normal Save button');

  /* ---- presets + pacing estimate */
  const pl = await inv('playlists:create', { name: 'Quiz Night' }); await inv('playlists:add', { id: pl.id, songIds: after.filter(s => s.status !== 'missing').map(s => s.id) });
  await waitFor(async () => { await host.evaluate(() => App.show('create', 'new')); await sleep(600); return host.isVisible('#gPresets'); });
  ok((await host.$$('#gPresets .preset')).length === 5 && /Custom/.test(await host.textContent('#gPresets')), 'Step 1: four built-in presets + Custom');
  await host.click('#gPresets [data-p=quick]'); await sleep(300);
  const d = await host.evaluate(() => App.views.create.data.settings);
  ok(d.clipMode === 20 && d.roundCount === 2 && d.rounds[1][0].id === 'fast5', 'Quick Bingo Break applied (still editable)', JSON.stringify({ clip: d.clipMode, rounds: d.roundCount }));
  await host.screenshot({ path: path.join(OUT, 'v24-presets.png') });
  await host.fill('#gName', 'Commercial Night');
  await host.evaluate((pid) => { const v = App.views.create; v.collect(); v.data.playlistId = pid; v.step = 5; v.draw(); }, pl.id);
  const pace = await waitFor(async () => { const t = await host.textContent('#gPaceOut'); return /simulated shuffles/.test(t) ? t : null; }, 20000);
  ok(!!pace && /FAST 5/.test(pace) && /break/.test(pace), 'Step 5: pacing estimate (labelled ESTIMATE) with the planned-break verdict', (pace || '').slice(0, 160));
  await host.screenshot({ path: path.join(OUT, 'v24-pacing.png') });
  await host.click('#cNext'); // creates the game
  const game = await waitFor(async () => { const s = (await inv('game:state')).game; return s && s.name === 'Commercial Night' ? s : null; }, 15000);
  ok(game && game.roundCount === 2, 'Game created from the preset');

  /* ---- automatic backup after creating the game */
  const ab = await waitFor(async () => { const a = await inv('backup:auto', {}); return a.files.length ? a : null; }, 20000);
  ok(!!ab && /created/.test(ab.files[0].name), 'Automatic compact backup after creating the game', ab && ab.files[0].name);

  /* ---- card footer + font (print preview HTML) */
  await inv('settings:update', { cards: { footer: 'Shout BINGO! and bring this card to the bar', font: 'serif' } });
  const pv = await inv('cards:preview', { id: game.gameId, footer: 'Shout BINGO! and bring this card to the bar', font: 'serif' }).catch(e => ({ error: e.message }));
  const pwin = await waitFor(async () => { for (const p of app.windows()) { if (/print/.test(await p.url())) return p; } return null; }, 10000);
  if (pwin) {
    const look = await waitFor(async () => pwin.evaluate(() => { const f = document.querySelector('.footmsg'); return f ? { text: f.textContent, font: getComputedStyle(document.querySelector('.cell .t')).fontFamily, serif: document.body.classList.contains('font-serif') } : null; }), 10000);
    ok(look && /bring this card/.test(look.text) && look.serif && /Georgia|serif/i.test(look.font), 'Cards: footer message and chosen font', JSON.stringify(look));
    await pwin.screenshot({ path: path.join(OUT, 'v24-card-footer.png') });
    await pwin.close().catch(() => {});
  } else ok(false, 'Print preview opened', JSON.stringify(pv));

  /* ---- Ready for Bingo? */
  await host.evaluate(() => App.show('host')); await sleep(800);
  await host.click('#hgReady'); await host.waitForSelector('#rcAgain');
  const rc = await host.textContent('.modal-back');
  ok(/ACTION REQUIRED|WARNING/.test(rc) && /READY/.test(rc) && /Media check/.test(rc) && /Backup/.test(rc), 'Ready for Bingo? groups the checks and includes media check + backup');
  const fixBtns = await host.$$('.modal-back [data-fix]');
  ok(fixBtns.length > 0, 'Problems come with a fix button', `${fixBtns.length} buttons`);
  await host.screenshot({ path: path.join(OUT, 'v24-ready.png') });
  const dt = await inv('health:decodeTest');
  ok(dt && dt.ok && dt.total > 50, 'Decode test played 5 s of a real video off-screen', JSON.stringify({ total: dt && dt.total, dropped: dt && dt.dropped, pct: dt && dt.pct }));
  await closeModals();

  /* ---- gap presets + one-click backup + usage report */
  await host.click('#cGap [data-g="5"]'); await sleep(400);
  ok((await inv('game:state')).game.settings.autoAdvanceGap === 5 && await host.$eval('#cGap [data-g="5"]', b => b.classList.contains('on')), 'Gap preset 5 s on Host Game');
  await host.click('#hgBackup');
  const ab2 = await waitFor(async () => { const a = await inv('backup:auto', {}); return a.files.some(f => /manual/.test(f.name)) ? a : null; }, 15000);
  ok(!!ab2 && ab2.last && !ab2.last.auto, 'One-click ⤓ Back up writes a backup without a file dialog');
  await inv('audience:open', {}); await sleep(2000);
  await inv('game:cmd', { action: 'startRound', args: { round: 1 } });
  await waitFor(async () => (await inv('game:state')).game.totals.played >= 2, 90000);
  await inv('game:cmd', { action: 'pause' });
  const csv = path.join(DATA, 'usage.csv');
  const ur = await inv('usage:export', { id: game.gameId, file: csv });
  const text = fs.readFileSync(csv, 'utf8');
  ok(ur.rows >= 2 && text.startsWith('﻿Date,Event,Venue') && /Commercial Night/.test(text), 'Music usage report (CSV) with date, event, title, artist, seconds', `${ur.rows} rows`);
  const st = await waitFor(async () => { const a = await inv('backup:auto', {}); return a.files.some(f => /started/.test(f.name)) ? a : null; }, 30000);
  ok(!!st, 'Automatic backup at the start of the game (written between songs)');

  /* ---- licence (free) + rollback info */
  const lic = await inv('licence:status');
  ok(lic.edition === 'free' && lic.enforced === false && lic.canStartGame, 'Licence framework present but off: free edition, nothing enforced');
  await host.evaluate(() => App.show('settings')); await sleep(800);
  ok(/FREE EDITION/.test(await host.textContent('#licBox')), 'Settings shows “Free edition — no licence needed”');
  const rb = await inv('update:rollbackInfo');
  ok(rb && rb.available === false, 'No rollback offered before any update');

  /* ---- rehearsal (practice clips, never in history) */
  await inv('games:close'); await sleep(500);
  await host.evaluate(() => App.show('start')); await sleep(600);
  await host.evaluate(() => { const b = Array.from(document.querySelectorAll('.ob-step')).find(x => x.dataset.k === 'rehearse'); b.click(); });
  await host.waitForSelector('#obReh'); await host.click('#obReh');
  const reh = await waitFor(async () => { const s = (await inv('game:state')).game; return s && s.rehearsal ? s : null; }, 120000);
  ok(!!reh && reh.totals.songs === 40, 'Rehearsal game with 40 generated practice clips');
  ok(!(await inv('games:list')).some(g => /Rehearsal/.test(g.name)), 'Rehearsal is not listed in Game History');
  await inv('game:cmd', { action: 'startRound', args: { round: 1 } }); await waitFor(async () => (await inv('game:state')).game.totals.played >= 1, 60000);
  await inv('game:cmd', { action: 'addClaim', args: { cardNo: 1 } }).catch(() => {});
  const ob = await inv('rehearsal:end');
  ok(ob.steps.find(s => s.key === 'rehearse').done && ob.steps.find(s => s.key === 'claim').done, 'Ending the rehearsal ticks “Rehearsal game” and “Check a sample claim”');
  ok(!(await inv('backup:auto', { id: reh.gameId })).files.length, 'No backups were made of the rehearsal');
  await host.evaluate(() => App.show('start')); await sleep(800);
  await host.screenshot({ path: path.join(OUT, 'v24-start-after.png') });

  await app.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
