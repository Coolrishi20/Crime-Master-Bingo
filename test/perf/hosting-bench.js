/* Integrated live-hosting benchmark (release gate).
 *
 * Runs the WHOLE system together, the way a host uses it:
 *   laptop app (host window) + audience/TV window playing 1080p video with overlay,
 *   winning-pattern panel and the scrolling crawler + a phone host remote over Wi-Fi.
 * and measures RAM, CPU, video dropped frames, TV-renderer jank, unexpected video reloads,
 * main-process event-loop lag, IPC/WebSocket traffic, disk writes and phone command latency.
 *
 * Phases: startup/idle → import 40 → import 100 → PDF → T1 playback (no phone / full system)
 *   → T2 active phone commands → T3 phone bingo check → T6 phone disconnect/reconnect
 *   → T4 extended hosting to N songs across 3 rounds (claims via phone).
 *
 * Usage (from any dir):
 *   APP=<repo dir> LABEL=<name> MODE=normal|lowres SONGS=75 CPUS=0,1 \
 *   xvfb-run -a -s "-screen 0 3400x1200x24" taskset -c 2,3 node hosting-bench.js <mediaDir> <out.json>
 * The Electron app is pinned to CPUS (default two cores) to approximate an entry-level laptop.
 */
'use strict';
const { _electron: electron, chromium } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const APP = path.resolve(process.env.APP || path.join(__dirname, '..', '..'));
const LABEL = process.env.LABEL || 'run'; const MODE = process.env.MODE || 'normal';
const GAME = process.env.GAME === 'checklist' ? 'checklist' : 'rounds'; // Round-Based or Rules Checklist game
const SONGS = Number(process.env.SONGS || 75); const CPUS = process.env.CPUS || '0,1';
const MEDIA = process.argv[2]; const OUTF = process.argv[3] || path.join(os.tmpdir(), `bench-${LABEL}.json`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now(); const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s]`, ...a);
const waitFor = async (fn, ms = 30000, step = 250) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) { /* */ } await sleep(step); } return null; };
const R = { label: LABEL, mode: MODE, game: GAME, cpus: CPUS, startedAt: new Date().toISOString(), host: { cpus: os.cpus().length, cpuModel: os.cpus()[0].model, totalMemMB: Math.round(os.totalmem() / 1048576), platform: `${os.platform()} ${os.release()}` }, samples: [], phases: {}, checks: [], notes: [] };
const check = (ok, name, detail) => { R.checks.push({ ok: !!ok, name, detail: detail == null ? '' : String(detail) }); log(ok ? 'PASS' : 'FAIL', name, detail == null ? '' : '— ' + detail); };

(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb-bench-'));
  // pin Electron (all its processes inherit the affinity)
  const wrapper = path.join(DATA, 'electron-pinned.sh');
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec taskset -c ${CPUS} "${require(path.join(APP, 'node_modules', 'electron'))}" "$@"\n`, { mode: 0o755 });
  const app = await electron.launch({ executablePath: wrapper, args: [APP, '--no-sandbox'], env: Object.assign({}, process.env, { CMB_TEST: '1', CMB_SHOW: '1', CMB_DATA_DIR: DATA, CMB_NO_SANDBOX: '1' }), timeout: 60000 });
  // Playwright occasionally drops an Electron evaluate under load ("promise was garbage collected"): retry
  const ev = async (fn, arg) => { for (let k = 0; ; k++) { try { return await app.evaluate(fn, arg); } catch (e) { if (!/garbage collected|Target closed/.test(e.message) || k >= 6) throw e; await sleep(300); } } };
  const host = await app.firstWindow(); await host.waitForFunction(() => window.App && window.App.settings, null, { timeout: 60000 });
  R.app = await host.evaluate(() => ({ version: App.info && App.info.version }));
  await ev(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1366, 768); });
  const inv = (c, p) => host.evaluate(([a, b]) => window.cmb.invoke(a, b), [c, p]);
  const cmd = (a, b) => inv('game:cmd', { action: a, args: b || {} });

  /* ---- main-process instrumentation: event-loop lag, IPC per channel, disk writes ---- */
  await ev(() => {
    const g = global.__bench = { lagMax: 0, lagSum: 0, lagN: 0, lag50: 0, ipc: {}, ipcBytes: {}, fsyncs: 0, writeBytes: 0, writes: {} };
    let t = Date.now(); setInterval(() => { const d = Date.now() - t - 100; t = Date.now(); if (d > 0) { g.lagSum += d; if (d > g.lagMax) g.lagMax = d; if (d > 50) g.lag50++; } g.lagN++; }, 100);
    // every durable store write (atomic tmp + fsync + rename); bytes = serialized size
    const st = global.__cmb.store(); const wn = st.writeNow.bind(st);
    st.writeNow = function (name, data) { g.fsyncs++; const k = String(name).split('/')[0]; g.writes[k] = (g.writes[k] || 0) + 1; const r = wn(name, data); try { g.writeBytes += require_size(st, name); } catch (e) { /* */ } return r; };
    function require_size() { return 0; }
    g.wrap = (wc, who) => { if (!wc || wc.__benched) return; wc.__benched = true; const s = wc.send.bind(wc); wc.send = (ch, d) => { const k = who + ':' + ch; g.ipc[k] = (g.ipc[k] || 0) + 1; try { g.ipcBytes[k] = (g.ipcBytes[k] || 0) + JSON.stringify(d === undefined ? null : d).length; } catch (e) { /* */ } return s(ch, d); }; };
    g.reset = () => { g.lagMax = 0; g.lagSum = 0; g.lagN = 0; g.lag50 = 0; g.ipc = {}; g.ipcBytes = {}; g.fsyncs = 0; g.writeBytes = 0; g.writes = {}; };
  });
  await ev(({ BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(w => global.__bench.wrap(w.webContents, /Audience/.test(w.getTitle()) ? 'tv' : 'host')); });

  /* ---- process metrics ---- */
  const metrics = async () => ev(({ app }) => app.getAppMetrics().map(m => ({ type: m.type, name: m.name || '', pid: m.pid, cpu: m.cpu.percentCPUUsage, wsKB: m.memory.workingSetSize, privKB: m.memory.privateBytes || 0 })));
  await metrics(); // primes cpu counters
  let sampler = null; let phaseName = 'startup';
  const sample = async (tag) => {
    const m = await metrics();
    const s = { t: Math.round((Date.now() - t0) / 1000), phase: phaseName, tag: tag || null, totalMB: Math.round(m.reduce((a, x) => a + x.wsKB, 0) / 1024), privMB: Math.round(m.reduce((a, x) => a + x.privKB, 0) / 1024), cpu: Math.round(m.reduce((a, x) => a + x.cpu, 0) * 10) / 10, byType: {} };
    m.forEach(x => { const k = x.type + (x.name ? ':' + x.name : ''); const b = s.byType[k] = s.byType[k] || { mb: 0, cpu: 0, n: 0 }; b.mb += Math.round(x.wsKB / 1024); b.cpu = Math.round((b.cpu + x.cpu) * 10) / 10; b.n++; });
    // whole process tree incl. non-Chromium children (ffmpeg analysis/conversion) — Linux /proc
    try { const browser = m.find(x => x.type === 'Browser'); if (browser) { const t = treeRss(browser.pid); s.treeMB = t.mb; s.children = t.extra; } } catch (e) { /* */ }
    R.samples.push(s); return s;
  };
  function treeRss(root) {
    const kids = {}; const names = {};
    for (const d of fs.readdirSync('/proc')) { if (!/^\d+$/.test(d)) continue; try { const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8'); const close = st.lastIndexOf(')'); const ppid = Number(st.slice(close + 2).split(' ')[1]); (kids[ppid] = kids[ppid] || []).push(Number(d)); names[d] = st.slice(st.indexOf('(') + 1, close); } catch (e) { /* gone */ } }
    let kb = 0; const extra = {}; const stack = [root];
    while (stack.length) { const pid = stack.pop(); try { const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); const v = m ? Number(m[1]) : 0; kb += v; const n = names[pid] || ''; if (!/electron|chrome|zygote/i.test(n)) extra[n] = (extra[n] || 0) + Math.round(v / 1024); } catch (e) { /* */ } (kids[pid] || []).forEach(k => stack.push(k)); }
    return { mb: Math.round(kb / 1024), extra };
  }
  const startSampler = () => { sampler = setInterval(() => { sample().catch(() => {}); }, 2000); };
  const mark = async (tag) => { const s = await sample(tag); log(`MEM ${tag}: ${s.totalMB} MB (whole process tree ${s.treeMB} MB ${JSON.stringify(s.children || {})}), CPU ${s.cpu}%`); return s; };

  let tv = null, phone = null, phoneCtx = null; const wsTraffic = { frames: 0, bytes: 0 };
  const tvPerf = () => tv.evaluate(() => { const v = document.getElementById('video'); const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : { droppedVideoFrames: 0, totalVideoFrames: 0 }; const p = window.__perf; void q; return { frames: p.frames, gaps50: p.gaps50, gaps100: p.gaps100, maxGap: Math.round(p.maxGap), longTasks: p.longTasks, longTaskMs: Math.round(p.longTaskMs), loadstarts: p.loadstarts, dropped: p.cumDrop - p.baseDrop, decoded: p.cumTot - p.baseTot, t: v.currentTime, paused: v.paused, src: v.getAttribute('src') }; });
  const phase = async (name, fn) => {
    phaseName = name; log('── PHASE', name);
    await ev(() => global.__bench.reset());
    if (tv) await tv.evaluate(() => { const p = window.__perf; p.frames = 0; p.gaps50 = 0; p.gaps100 = 0; p.maxGap = 0; p.longTasks = 0; p.longTaskMs = 0; p.loadstarts = 0; p.baseDrop = p.cumDrop; p.baseTot = p.cumTot; });
    const ws0 = Object.assign({}, wsTraffic); const songs0 = engineInfo ? (await engineInfo()).played : 0; const loads0 = engineLoads ? await engineLoads() : 0;
    const s0 = R.samples.length; const ts = Date.now();
    const extra = (await fn()) || {};
    const secs = (Date.now() - ts) / 1000;
    const main = await ev(() => { const g = global.__bench; return { lagMax: g.lagMax, lagAvg: g.lagN ? Math.round(g.lagSum / g.lagN * 10) / 10 : 0, lag50: g.lag50, ipc: g.ipc, ipcBytes: g.ipcBytes, fsyncs: g.fsyncs, writes: g.writes }; });
    const ss = R.samples.slice(s0).filter(s => s.phase === name);
    const p = { seconds: Math.round(secs), memAvgMB: ss.length ? Math.round(ss.reduce((a, s) => a + s.totalMB, 0) / ss.length) : null, memMaxMB: ss.length ? Math.max(...ss.map(s => s.totalMB)) : null, cpuAvg: ss.length ? Math.round(ss.reduce((a, s) => a + s.cpu, 0) / ss.length) : null, cpuMax: ss.length ? Math.max(...ss.map(s => s.cpu)) : null, main, extra };
    p.ipcPerMin = {}; Object.keys(main.ipc).forEach(k => { p.ipcPerMin[k] = Math.round(main.ipc[k] / secs * 60); });
    p.ipcKBPerMin = {}; Object.keys(main.ipcBytes).forEach(k => { p.ipcKBPerMin[k] = Math.round(main.ipcBytes[k] / 1024 / secs * 60 * 10) / 10; });
    p.wsPerMin = Math.round((wsTraffic.frames - ws0.frames) / secs * 60); p.wsKBPerMin = Math.round((wsTraffic.bytes - ws0.bytes) / 1024 / secs * 60 * 10) / 10;
    if (tv) { const tp = await tvPerf(); p.tv = tp; p.tv.droppedPct = tp.decoded ? Math.round(tp.dropped / tp.decoded * 1000) / 10 : 0; p.tv.janky50PerMin = Math.round(tp.gaps50 / secs * 60 * 10) / 10; }
    if (engineInfo) { const e = await engineInfo(); p.songsPlayed = e.played - songs0; p.engineLoads = (await engineLoads()) - loads0; if (p.tv) p.unexpectedReloads = Math.max(0, p.tv.loadstarts - p.engineLoads); }
    R.phases[name] = p;
    log(`   ${name}: mem avg ${p.memAvgMB} / max ${p.memMaxMB} MB, CPU avg ${p.cpuAvg}%` + (p.tv ? `, dropped ${p.tv.dropped}/${p.tv.decoded} (${p.tv.droppedPct}%), TV jank>50ms ${p.tv.gaps50}, loads ${p.tv.loadstarts} (engine ${p.engineLoads})` : '') + `, main lag max ${main.lagMax} ms, fsyncs ${main.fsyncs}, ws ${p.wsKBPerMin} KB/min`);
    return p;
  };
  let engineInfo = null, engineLoads = null;

  startSampler();
  await sleep(6000); await mark('startup');
  await sleep(15000); await mark('idle');

  /* ---- settings for this run ---- */
  if (MODE === 'lowres') { try { await inv('settings:update', { performance: { lowResource: true } }); R.notes.push('Low Resource Mode ON'); } catch (e) { R.notes.push('Low Resource Mode not available in this build'); } }

  /* ---- import ---- */
  const files = fs.readdirSync(MEDIA).filter(f => f.endsWith('.mp4')).sort().map(f => path.join(MEDIA, f));
  const ready = async (n) => waitFor(async () => { const l = (await inv('library:list')).songs; return l.length >= n && !l.some(s => s.status === 'unchecked'); }, 600000, 1000);
  await phase('import40', async () => { const t = Date.now(); await inv('library:importPaths', files.slice(0, 40)); await ready(40); const s = await mark('after import 40'); return { importSec: Math.round((Date.now() - t) / 1000), memMB: s.totalMB }; });
  await phase('import100', async () => { const t = Date.now(); await inv('library:importPaths', files.slice(40, 100)); await ready(100); await host.evaluate(() => App.show('library')); await sleep(3000); const s = await mark('after import 100 (library open)'); return { importSec: Math.round((Date.now() - t) / 1000), memMB: s.totalMB }; });
  const songs = (await inv('library:list')).songs;
  const pl = await inv('playlists:create', { name: 'Bench 100' }); await inv('playlists:add', { id: pl.id, songIds: songs.map(s => s.id) });
  const g = await inv('games:create', { name: 'Bench Night', venue: 'Lab', playlistId: pl.id, cards: 100, settings: Object.assign({ clipMode: 'full', autoAdvance: true, autoAdvanceGap: 1 }, GAME === 'checklist' ? { mode: 'checklist' } : {}) });
  await phase('pdf100', async () => { const t = Date.now(); const f = path.join(DATA, 'cards.pdf'); await inv('cards:exportPdf', { id: g.id, file: f, confirmLock: true }); const s = await mark('after PDF of 100 cards'); return { pdfSec: Math.round((Date.now() - t) / 1000), memMB: s.totalMB, pdfKB: Math.round(fs.statSync(f).size / 1024) }; });

  engineInfo = () => ev(() => { const e = global.__cmb.engine; return { played: e.game.played.length, index: e.game.playback.index, status: e.game.playback.status, round: e.game.round.number, rstatus: e.game.round.status }; });
  await ev(() => { const e = global.__cmb.engine; global.__bench.loads = 0; const orig = e.hooks.player; e.hooks.player = (c) => { if (c.cmd === 'load') global.__bench.loads++; return orig(c); }; });
  engineLoads = () => ev(() => global.__bench.loads);

  /* ---- audience window ---- */
  await inv('audience:open');
  tv = await waitFor(async () => { for (const p of app.windows()) { if (/audience/.test(await p.url())) return p; } return null; });
  await tv.waitForLoadState('domcontentloaded');
  await ev(({ BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(w => { if (/Audience/.test(w.getTitle())) { w.setContentSize(1920, 1080); global.__bench.wrap(w.webContents, 'tv'); } }); });
  await tv.evaluate(() => {
    const p = window.__perf = { frames: 0, gaps50: 0, gaps100: 0, maxGap: 0, longTasks: 0, longTaskMs: 0, loadstarts: 0, cumDrop: 0, cumTot: 0, baseDrop: 0, baseTot: 0 };
    const v = document.getElementById('video');
    v.addEventListener('loadstart', () => { p.loadstarts++; });
    // the browser's counters restart on every new video → accumulate deltas
    let lq = { d: 0, t: 0 };
    setInterval(() => { const q = v.getVideoPlaybackQuality(); const d = q.droppedVideoFrames, t = q.totalVideoFrames; if (t < lq.t || d < lq.d) { p.cumDrop += d; p.cumTot += t; } else { p.cumDrop += d - lq.d; p.cumTot += t - lq.t; } lq = { d, t }; }, 200);
    let last = performance.now(); (function f(t) { const d = t - last; last = t; p.frames++; if (d > 50) p.gaps50++; if (d > 100) p.gaps100++; if (d > p.maxGap) p.maxGap = d; requestAnimationFrame(f); })(last);
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) { p.longTasks++; p.longTaskMs += e.duration; } }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* */ }
  });
  await host.evaluate(() => App.show('host'));
  await cmd('setClipMode', { clipMode: 'full' }).catch(() => {});
  await cmd('setGameSettings', { autoAdvance: true, autoAdvanceGap: 1 }).catch(() => {});
  await cmd('startRound', { round: 1 });
  await waitFor(async () => (await engineInfo()).status === 'playing', 30000);
  await sleep(4000);

  /* T1a: playback without phone */
  await phase('T1a_playback_no_phone', async () => { await sleep(40000); });

  /* phone host remote (separate device: runs outside the pinned cores) */
  const br = await chromium.launch();
  const ri = await inv('remote:info');
  phoneCtx = await br.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  phone = await phoneCtx.newPage();
  phone.on('websocket', ws => { ws.on('framereceived', f => { wsTraffic.frames++; wsTraffic.bytes += (f.payload && f.payload.length) || 0; }); });
  await phone.addInitScript(() => {
    const S = WebSocket.prototype.send; window.__lat = []; window.__pend = {};
    WebSocket.prototype.send = function (d) { try { const m = JSON.parse(d); if (m.type === 'cmd') window.__pend[m.id] = performance.now(); } catch (e) { /* */ } if (!this.__h) { this.__h = 1; this.addEventListener('message', ev => { try { const m = JSON.parse(ev.data); if (m.type === 'ack' && window.__pend[m.id]) { window.__lat.push(performance.now() - window.__pend[m.id]); delete window.__pend[m.id]; } } catch (e) { /* */ } }); } return S.call(this, d); };
  });
  await phone.goto(`http://127.0.0.1:${ri.port}/#pin=${ri.pin}`);
  check(!!(await phone.waitForSelector('#main:not(.hidden)', { timeout: 20000 }).catch(() => null)), 'Phone remote pairs and connects');
  const lat = async () => { const a = await phone.evaluate(() => { const x = window.__lat.slice(); window.__lat.length = 0; return x; }); a.sort((x, y) => x - y); return { n: a.length, median: a.length ? Math.round(a[Math.floor(a.length / 2)]) : null, max: a.length ? Math.round(a[a.length - 1]) : null }; };
  const tab = async (t) => { await phone.click(`#tabs button[data-tab="${t}"]`); await sleep(300); };
  const modalOk = async () => { const b = await phone.waitForSelector('#modal:not(.hidden) #mBtns button', { timeout: 5000 }).catch(() => null); if (b) await b.click(); };

  /* T1b: full system — video + overlay + pattern + crawler + phone connected (idle) */
  await phase('T1b_full_system_phone_connected', async () => { await sleep(40000); });

  /* T2: active phone hosting while the TV plays */
  await phase('T2_active_phone_commands', async () => {
    const actions = [];
    const end = Date.now() + 60000; let i = 0;
    while (Date.now() < end) {
      const k = i++ % 8;
      try {
        if (k === 0) { await tab('play'); await phone.click('#playBtn'); actions.push('pause'); }
        else if (k === 1) { await phone.click('#playBtn'); actions.push('resume'); }
        else if (k === 2) { await phone.fill('#vol', String(70 + (i % 20))); await phone.dispatchEvent('#vol', 'input'); actions.push('volume'); }
        else if (k === 3) { await phone.click('[data-cmd="replay"]'); actions.push('replay'); }
        else if (k === 4) { await tab('history'); await phone.fill('#crSpeed', String(3 + (i % 5))); await phone.dispatchEvent('#crSpeed', 'input'); actions.push('crawler speed'); }
        else if (k === 5) { await phone.evaluate(() => window.scrollTo(0, 99999)); actions.push('view history'); }
        else if (k === 6) { await tab('rounds'); actions.push('view rounds'); }
        else if (k === 7) { await tab('play'); await phone.click('#nextBtn'); await modalOk(); actions.push('next'); }
      } catch (e) { actions.push('ERR ' + e.message.slice(0, 60)); }
      await sleep(3000);
    }
    const st = await engineInfo(); if (st.status === 'paused') await cmd('play');
    return { actions, latency: await lat() };
  });

  /* T3: bingo check from the phone while everything runs */
  const cardsTruth = await ev(() => { const g = global.__cmb.engine.game; return g.cards.slice(0, 30).map(c => ({ no: c.no, cells: c.cells })); });
  const rules = require(path.join(APP, 'src', 'core', 'rules'));
  const openRules = (cardNo) => ev((no) => { const g = global.__cmb.engine.game; const s = g.claimSessions[g.claimSessions.length - 1]; const sid = s && s.status === 'open' ? s.id : null;
    return (g.settings.checklist || []).filter(it => { const w = g.claims.filter(c => c.status === 'confirmed' && c.itemId === it.id); return (!w.length || (sid && w.every(c => c.sessionId === sid))) && !w.some(c => c.cardNo === no); }).map(it => it.rule); }, cardNo);
  const truthFor = async (card, set, round) => { if (GAME !== 'checklist') return rules.checkCard(card.cells, set, round).valid; const open = await openRules(card.no); return open.some(r => rules.checkCard(card.cells, set, { round: 0, rules: [r] }).valid); };
  const phoneCheck = async (cardNo, decide) => {
    await tab('play');
    const before = await tvPerf(); const eBefore = await engineLoads();
    await phone.click('#bingoFab');
    await phone.waitForSelector('#checker:not(.hidden)', { timeout: 8000 });
    for (const d of String(cardNo)) { const btns = await phone.$$('#keypad button'); for (const b of btns) { if ((await b.textContent()).trim() === d) { await b.click(); break; } } }
    await phone.click('#ckGo');
    await phone.waitForSelector('#ckResult:not(.hidden) .verdict', { timeout: 8000 });
    const verdict = (await phone.textContent('#ckResult .verdict .vt')).trim();
    const e = await ev(() => { const g = global.__cmb.engine.game; const s = g.claimSessions[g.claimSessions.length - 1]; return { snapshot: s ? s.snapshot.map(x => x.songId) : [], round: g.round.number, pos: g.playback.position }; });
    const card = cardsTruth.find(c => c.no === cardNo);
    const truth = await truthFor(card, new Set(e.snapshot), e.round);
    const phoneValid = /VALID BINGO|WINNER/.test(verdict) && !/NOT (A )?VALID|ALREADY/.test(verdict);
    let decided = null;
    if (decide && phoneValid && await phone.$('#ckPicks input') && !(await phone.$('#ckPicks input:checked'))) await phone.click('#ckPicks .ck-opt input');
    if (decide && phoneValid && await phone.$('#ckConfirm')) { await phone.click('#ckConfirm'); await modalOk(); decided = 'confirmed'; await sleep(800); }
    else if (await phone.$('#ckReject')) { await phone.click('#ckReject'); await modalOk(); decided = 'rejected'; await sleep(500); }
    await phone.click('#ckResume').catch(() => {}); await modalOk(); await sleep(1500);
    const after = await tvPerf(); const eAfter = await engineLoads();
    const desk = await host.evaluate(() => App.game && App.game.claims && App.game.claims[0] ? App.game.claims[0].valid : null);
    return { cardNo, verdict, phoneValid, truth, accurate: phoneValid === truth, desktopAgrees: desk === phoneValid, decided, resumed: !after.paused, posBefore: before.t, posAfter: after.t, reloads: Math.max(0, (after.loadstarts - before.loadstarts) - (eAfter - eBefore)), songChanges: eAfter - eBefore, srcSame: before.src === after.src || eAfter !== eBefore };
  };
  // pick a card that is (likely) valid for round 1 now, and one that is not
  const pickCard = async (wantValid) => { const e = await ev(() => { const g = global.__cmb.engine.game; return { played: g.played.map(p => p.songId), round: g.round.number }; }); const set = new Set(e.played); for (const c of cardsTruth) { if ((await truthFor(c, set, e.round)) === wantValid) return c.no; } return null; };
  await phase('T3_phone_bingo_check', async () => {
    const out = [];
    const bad = await pickCard(false); if (bad) out.push(await phoneCheck(bad, false));
    return { claims: out, latency: await lat() };
  });
  (R.phases.T3_phone_bingo_check.extra.claims || []).forEach(c => { check(c.accurate, `Phone verdict matches independent rule check (card ${c.cardNo})`, `${c.verdict} vs truth ${c.truth}`); check(c.desktopAgrees, 'Desktop shows the same result as the phone'); check(c.reloads === 0 && c.srcSame, 'Bingo check did not reload the video', `unexpected reloads ${c.reloads}, natural song changes ${c.songChanges}`); check(c.resumed, 'Playback resumed after the check'); });

  /* T6: phone loses Wi-Fi while the video plays */
  await phase('T6_phone_disconnect', async () => {
    const a = await tvPerf();
    await phoneCtx.setOffline(true); await sleep(20000);
    const b = await tvPerf();
    await phoneCtx.setOffline(false);
    const back = await waitFor(async () => /Connected/.test(await phone.textContent('#connTxt')), 40000, 500);
    await phone.fill('#vol', '80'); await phone.dispatchEvent('#vol', 'input'); await sleep(1500);
    const e = await engineInfo();
    return { videoKeptPlaying: !b.paused && (b.loadstarts - a.loadstarts) <= 2, loadsWhileOffline: b.loadstarts - a.loadstarts, reconnected: !!back, latencyAfter: await lat(), engineStatus: e.status };
  });
  const t6 = R.phases.T6_phone_disconnect.extra;
  check(t6.videoKeptPlaying, 'TV kept playing while the phone was offline', `loads while offline ${t6.loadsWhileOffline} (song changes are normal)`);
  check(t6.reconnected, 'Phone reconnected by itself');
  check(t6.latencyAfter.n >= 1, 'Phone command works after reconnecting', JSON.stringify(t6.latencyAfter));

  /* T4: extended hosting — N songs, 3 rounds, regular phone use and claims */
  await phase('T4_extended', async () => {
    const memTrail = []; let lastCmd = Date.now(); let claims = []; let completed = [];
    const target = SONGS; let n = 0;
    while ((await engineInfo()).played < target) {
      const e = await engineInfo();
      if (Date.now() - lastCmd > 10000) {
        lastCmd = Date.now(); n++;
        try { if (n % 2) { await tab('play'); await phone.fill('#vol', String(75 + (n % 10))); await phone.dispatchEvent('#vol', 'input'); } else { await tab('history'); await phone.fill('#crSpeed', String(3 + (n % 4))); await phone.dispatchEvent('#crSpeed', 'input'); } } catch (err) { /* */ }
      }
      // round changes from the phone: after ~1/3 and ~2/3 of the songs
      const wantRound = e.played >= Math.round(target * 2 / 3) ? 3 : e.played >= Math.round(target / 3) ? 2 : 1;
      if (GAME === 'checklist') {
        if (wantRound > completed.length + 1 && e.rstatus === 'active') { const good = await pickCard(true); if (good) claims.push(await phoneCheck(good, true)); completed.push((await ev(() => global.__cmb.engine.checklistView().completed))); const ee = await engineInfo(); if (ee.status !== "playing" && ee.status !== "loading" && ee.status !== "between") await cmd("play").catch(() => {}); }
      } else if (wantRound > e.round && e.rstatus === 'active') {
        const good = await pickCard(true); if (good) claims.push(await phoneCheck(good, true));
        try { await tab('rounds'); await phone.click('#endRound'); await modalOk(); await sleep(1500); const sb = await phone.$('#startReady'); if (sb) { await sb.click(); await modalOk(); } } catch (err) { /* */ }
        await sleep(2000);
        let ee = await engineInfo(); if (ee.rstatus === 'ready') { await cmd('startRound', { round: ee.round }); }
        ee = await engineInfo(); if (ee.status !== 'playing' && ee.status !== 'loading' && ee.status !== 'between') await cmd('play').catch(() => {});
        completed.push(ee.round);
      }
      const s = R.samples[R.samples.length - 1]; if (s && (!memTrail.length || memTrail[memTrail.length - 1].played !== e.played)) memTrail.push({ played: e.played, mb: s.totalMB, cpu: s.cpu });
      await sleep(2000);
    }
    return { memTrail, claims, roundsReached: completed, latency: await lat() };
  });
  const t4 = R.phases.T4_extended.extra;
  t4.claims.forEach(c => { check(c.accurate, `Extended: phone verdict correct (card ${c.cardNo})`); check(c.reloads === 0, 'Extended: claim check did not reload the video'); });
  if (t4.memTrail.length > 4) { const a = t4.memTrail.slice(0, Math.ceil(t4.memTrail.length / 4)); const b = t4.memTrail.slice(-Math.ceil(t4.memTrail.length / 4)); const avg = x => x.reduce((s, y) => s + y.mb, 0) / x.length; R.phases.T4_extended.memGrowthMB = Math.round(avg(b) - avg(a)); }
  await mark(`after ${SONGS} songs`);
  const fin = await engineInfo(); R.final = fin;
  check(fin.played >= SONGS, `${SONGS} songs played`, fin.played);
  if (GAME === 'checklist') { const rr = R.phases.T4_extended.extra.roundsReached; check(rr.length >= 2 && rr[rr.length - 1] >= 2, 'Checklist: rules awarded from the phone, no round changes', JSON.stringify(rr)); }
  else check(R.phases.T4_extended.extra.roundsReached.length >= 2, 'Advanced through 3 rounds from the phone', JSON.stringify(R.phases.T4_extended.extra.roundsReached));
  clearInterval(sampler);
  R.durationMin = Math.round((Date.now() - t0) / 60000);
  fs.writeFileSync(OUTF, JSON.stringify(R, null, 1));
  log('saved', OUTF);
  await br.close(); await app.close();
  process.exit(0);
})().catch(e => { console.error(e); try { fs.writeFileSync(OUTF, JSON.stringify(Object.assign(R, { error: String(e.stack || e) }), null, 1)); } catch (x) { /* */ } process.exit(2); });
