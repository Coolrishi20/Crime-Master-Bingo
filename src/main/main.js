'use strict';
const { app, BrowserWindow, ipcMain, dialog, screen, shell, Menu, powerSaveBlocker, net, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const QRCode = require('qrcode');

const { Store } = require('./store');
const { Library } = require('./library');
const { RemoteServer } = require('./remote');
const { GameEngine, createGame, defaultGameSettings, normaliseChecklist, DEFAULT_CHECKLIST } = require('../core/engine');
const m3u = require('./m3u');
const cardsLib = require('../core/cards');
const rules = require('../core/rules');
const locking = require('../core/locking');
const { AudioAnalyser } = require('./audio');
const { Converter } = require('./converter');
const backup = require('./backup');
const { UpdateManager, RELEASES_URL, REPO } = require('./updater');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(__dirname, '..', 'renderer');
// The product is now called Anthem Square, but saved games, library, settings and backups stay in the
// original data folder so existing installs keep everything (Windows: %APPDATA%\\Crime Master Bingo).
if (!process.env.CMB_DATA_DIR) app.setPath('userData', path.join(app.getPath('appData'), 'Crime Master Bingo'));
const DATA_DIR = process.env.CMB_DATA_DIR || path.join(app.getPath('userData'), 'data');
const IS_TEST = !!process.env.CMB_TEST;

if (process.env.CMB_NO_SANDBOX) app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let store, library, settings, remote, analyser, updater, converter;
let hostWin = null, audienceWin = null, previewWin = null;
let engine = null;          // engine for the active game
let powerBlock = null;
let recoveryInfo = null;

/* ======================================================================= settings */
function defaultSettings() {
  return {
    appearance: { logo: null, scale: 1, theme: 'dark' },   // 'dark' (default) | 'light'
    video: { displayId: null, fullscreen: true, aspect: 'contain', audioDeviceId: 'default' },
    gameDefaults: defaultGameSettings(),
    cards: { textScale: 1, qr: true, bw: false, useLogo: true, showArtist: true, cutLines: true },
    remote: { port: 8787, autoStart: true, devices: [], secure: true },
    library: { autoConvert: true },
    updates: { auto: true },
    home: { shareImages: false, phoneCards: false, joinOnTv: true },
    performance: { lowResource: false, decided: false },
    customPatterns: [],   // host-designed 5×5 patterns (Settings → Bingo Rules)
    rulePresets: [],      // saved rule sets for the three rounds
    checklistPresets: [], // saved Rules Checklists [{ name, items }]
    templates: [],        // saved game set-ups [{ id, name, playlistId, cards, venue, settings }]
    slides: { enabled: true, seconds: 8, images: [] }, // intermission slides on the TV [{ id, file, name }]
    lastGameId: null,
    cleanShutdown: true
  };
}
function loadSettings() {
  const d = defaultSettings();
  const s = store.read('settings', d);
  const merged = Object.assign({}, d, s);
  ['appearance', 'video', 'cards', 'remote', 'updates', 'library', 'home', 'performance'].forEach(k => { merged[k] = Object.assign({}, d[k], s[k] || {}); });
  merged.gameDefaults = Object.assign(defaultGameSettings(), s.gameDefaults || {});
  merged.gameDefaults.overlay = Object.assign(defaultGameSettings().overlay, (s.gameDefaults || {}).overlay || {});
  merged.gameDefaults.crawler = Object.assign(defaultGameSettings().crawler, (s.gameDefaults || {}).crawler || {});
  merged.gameDefaults.audio = Object.assign(defaultGameSettings().audio, (s.gameDefaults || {}).audio || {});
  merged.gameDefaults.screens = Object.assign(defaultGameSettings().screens, (s.gameDefaults || {}).screens || {});
  merged.gameDefaults.roundCount = Math.max(1, Math.min(10, Number((s.gameDefaults || {}).roundCount) || 3));
  merged.gameDefaults.rounds = validRounds((s.gameDefaults || {}).rounds, merged.gameDefaults.roundCount);
  if (!['dark', 'light'].includes(merged.appearance.theme)) merged.appearance.theme = 'dark'; // v1 'crime-master' → Dark
  merged.customPatterns = Array.isArray(s.customPatterns) ? s.customPatterns : [];
  merged.rulePresets = Array.isArray(s.rulePresets) ? s.rulePresets : [];
  merged.checklistPresets = Array.isArray(s.checklistPresets) ? s.checklistPresets : [];
  merged.templates = Array.isArray(s.templates) ? s.templates : [];
  merged.slides = Object.assign({ enabled: true, seconds: 8, images: [] }, s.slides || {}); if (!Array.isArray(merged.slides.images)) merged.slides.images = [];
  merged.gameDefaults.mode = merged.gameDefaults.mode === 'checklist' ? 'checklist' : 'rounds';
  merged.gameDefaults.checklist = normaliseChecklist(merged.gameDefaults.checklist);
  if (!merged.gameDefaults.checklist.length) merged.gameDefaults.checklist = normaliseChecklist(DEFAULT_CHECKLIST);
  return merged;
}
/** Three valid rule sets (falls back to the standard rules for anything invalid). */
function validRounds(r, count) {
  const out = {}; const cnt = Math.max(1, Math.min(10, Number(count) || 3));
  for (let n = 1; n <= cnt; n++) { const def = rules.DEFAULT_ROUND_RULES[n] || [{ id: 'line' }]; try { out[n] = rules.normaliseRuleSet((r || {})[n] || def); } catch (e) { out[n] = def; } }
  return out;
}
function saveSettings(urgent = true) { store.write('settings', settings, urgent); }

/* ======================================================================= games */
function readGame(id) { return store.read('games/' + id, null); }
function saveGame(game, urgent = true) { store.write('games/' + game.id, game, urgent); }

function gameSummary(g) {
  const winners = (g.claims || []).filter(c => c.status === 'confirmed');
  return {
    id: g.id, name: g.name, date: g.date, venue: g.venue, status: g.status, createdAt: g.createdAt, updatedAt: g.updatedAt,
    songs: (g.order || []).length, played: (g.played || []).length, cards: (g.cards || []).length,
    printed: (g.cards || []).filter(c => c.printed).length,
    round: g.round ? g.round.number : 0, roundStatus: g.round ? g.round.status : 'pending', cardsLocked: !!g.cardsLocked, mode: (g.settings && g.settings.mode) === 'checklist' ? 'checklist' : 'rounds',
    winners: winners.map(w => ({ cardNo: w.cardNo, round: w.round })), playlistName: g.playlistName
  };
}

let tickTimer = null, remoteTickTimer = null;
function activateGame(game) {
  if (engine && engine.game.id !== game.id) { store.flush(); }
  applySavedPosition(game);
  lastHostJson = lastTvJson = null;
  engine = new GameEngine(game, {
    persist: (g, urgent) => saveGame(g, urgent),
    changed: (kind) => onEngineChanged(kind),
    player: (cmd) => { if (cmd.src) cmd.href = pathToFileURL(cmd.src).href; sendAudience('player', cmd); },
    event: (name, payload) => {
      if (flushQueued) flushEngineChanges(); // state first, then the event (same order as before coalescing)
      if (name === 'celebrate' || name === 'tvScreen') sendAudience('event', { name, payload });
      sendHost('event', { name, payload });
      if (remote) remote.broadcast({ type: 'event', name, payload });
    },
    tick: () => onTick(),
    gainFor: (song, clip, audio) => (analyser ? analyser.gain(song, clip, audio) : { gainDb: 0, status: 'pending' }),
    introFor: (song) => (analyser ? analyser.intro(song) : null)
  });
  scanGameMedia();
  engine.audienceConnected = !!(audienceWin && !audienceWin.isDestroyed() && audienceReady);
  settings.lastGameId = game.id;
  saveSettings();
  saveGame(game);
  onEngineChanged('all');
  if (audienceReady) engine.playerReady();
  return engine;
}

/** Find game videos that are missing or flagged unplayable (never auto-credited). */
function scanGameMedia() {
  if (!engine) return;
  const eng = engine; const map = {};
  const songs = Object.values(eng.game.songs);
  // async existence checks — a sleeping USB drive must not freeze the app
  const online = net.isOnline();
  return Promise.all(songs.map(s => (s.source === 'youtube' ? Promise.resolve(online) : s.path ? fs.promises.access(s.path).then(() => true, () => false) : Promise.resolve(false)).then(ok => {
    if (!ok) map[s.id] = s.source === 'youtube' ? 'YouTube video — this laptop is offline' : 'Video file missing — relink it or grant Technical Credit';
    else { const l = library.get(s.id); if (l && l.status === 'unsupported') map[s.id] = 'Video cannot be played: ' + (l.statusNote || 'unsupported'); }
  }))).then(() => {
    if (engine !== eng) return;
    const before = JSON.stringify(eng.unavailable || {});
    eng.setUnavailable(map);
    if (JSON.stringify(eng.unavailable || {}) !== before) onEngineChanged('state');
  }).catch(() => {});
}
let lastScan = 0;
setInterval(() => { if (Date.now() - lastScan < (lowRes() ? 60000 : 20000)) return; lastScan = Date.now(); try { scanGameMedia(); } catch (e) { /* */ } }, 5000);

/* Playback position is saved to games/<id>.pos.json (a few dozen bytes) instead of
   re-serialising and fsync-ing the whole game file every couple of seconds while a
   song plays. Real state changes still save the full game immediately and durably. */
let posTimer = 0, posWriting = false;
function posFile(id) { return path.join(DATA_DIR, 'games', id + '.pos.json'); }
function savePosition(game) {
  const now = Date.now(); if (posWriting || now - posTimer < 4000) return; posTimer = now; posWriting = true;
  const pb = game.playback; const f = posFile(game.id);
  const data = JSON.stringify({ index: pb.index, position: Math.round((pb.position || 0) * 10) / 10, status: pb.status, version: game.version, at: new Date().toISOString() });
  fs.promises.writeFile(f + '.tmp', data).then(() => fs.promises.rename(f + '.tmp', f)).catch(() => {}).finally(() => { posWriting = false; });
}
/** On load: take the newer position from the side file if it belongs to the same song. */
function applySavedPosition(game) {
  try { const p = JSON.parse(fs.readFileSync(posFile(game.id), 'utf8')); if (p && p.index === game.playback.index && p.version >= (game.version || 0) && p.position > 0) game.playback.position = p.position; } catch (e) { /* none */ }
}

/* ======================================================================= media probe
 * Imported videos are checked (playable here? duration, size, thumbnail) in a hidden,
 * short-lived window — not in the host window. Measured on v1.4.2: probing in the host
 * window left ~7 MB per video in the host renderer (146 MB → 880 MB after 100 videos).
 * The probe window is closed after a batch / when idle, which returns that memory, and
 * it never decodes while a song is playing on the TV (no duplicate decoding). */
let probeWin = null, probeBusy = false, probeCount = 0, probeIdleSince = 0, probeReady = null;
function probeAllowed() {
  if (!engine || engine.game.status !== 'live') return true;
  if (lowRes()) return false;                                     // Low Resource: wait until the game is over
  return !['playing', 'loading'].includes(engine.game.playback.status); // normal: only between songs
}
function closeProbeWin() { if (probeWin && !probeWin.isDestroyed()) probeWin.destroy(); probeWin = null; probeReady = null; probeCount = 0; }
function ensureProbeWin() {
  if (probeWin && !probeWin.isDestroyed()) return probeReady;
  probeWin = new BrowserWindow({ show: false, width: 340, height: 200, webPreferences: { spellcheck: false, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  probeReady = new Promise(res => ipcMain.once('probe:ready:' + probeWin.webContents.id, () => res(true)));
  probeWin.loadFile(path.join(RENDERER, 'probe', 'probe.html'));
  return probeReady;
}
async function probePump() {
  if (probeBusy || !library) return;
  const s = library.nextUnchecked();
  if (!s) { if (probeWin && Date.now() - probeIdleSince > 8000) closeProbeWin(); return; }
  if (!probeAllowed()) { closeProbeWin(); return; }
  probeBusy = true;
  try {
    await ensureProbeWin();
    const wc = probeWin.webContents;
    const result = await new Promise(res => {
      const t = setTimeout(() => { ipcMain.removeAllListeners('probe:result:' + wc.id); res({ error: 'Timed out reading the video (file may be corrupted or on a slow drive).' }); }, 25000);
      ipcMain.once('probe:result:' + wc.id, (e, d) => { clearTimeout(t); res(d.result); });
      wc.send('probe:job', { id: s.id, href: pathToFileURL(s.path).href });
    });
    library.probeResult(s.id, result, path.join(DATA_DIR, 'thumbs'));
    sendHost('library-probed', { id: s.id });
    if (++probeCount >= 15) closeProbeWin(); // recycle: give the decoder memory back regularly
  } catch (e) { console.error('probe', e); closeProbeWin(); }
  probeBusy = false; probeIdleSince = Date.now();
  setImmediate(probePump);
}
setInterval(() => { probePump().catch(() => {}); }, 1000);
ipcMain.on('probe:ready', (e) => ipcMain.emit('probe:ready:' + e.sender.id, e));
ipcMain.on('probe:result', (e, d) => ipcMain.emit('probe:result:' + e.sender.id, e, d));

/* ======================================================================= performance */
function perfStatus() {
  const songs = library ? library.songs() : [];
  const big = songs.filter(x => x.status === 'ok' && (x.height || 0) > 720 && !(x.converted && x.converted.optimised));
  const mem = app.getAppMetrics().reduce((a, m) => a + m.memory.workingSetSize, 0);
  return { totalRamGB: TOTAL_RAM_GB, lowRam: LOW_RAM, lowResource: lowRes(), appMemoryMB: Math.round(mem / 1024), over720: big.length, optimising: songs.filter(x => x.optimise).length, optimised: songs.filter(x => x.converted && x.converted.optimised).length, converter: converter ? converter.status() : null };
}
const TOTAL_RAM_GB = Math.round(os.totalmem() / 1073741824 * 10) / 10;
const LOW_RAM = os.totalmem() <= 4.6 * 1073741824; // "4 GB" laptops report a little under 4 GB
function lowRes() { return !!(settings && settings.performance && settings.performance.lowResource); }
/** Keep the TV video first: background media work yields while a game is live. */
function updateBackgroundWork() {
  const live = !!(engine && engine.game.status === 'live');
  if (analyser && analyser.setScope) {
    if (!live) analyser.setScope(null);
    else if (lowRes()) analyser.setScope({ hold: true });
    else { const up = engine.upNext ? engine.upNext() : null; const ids = [engine.currentSongId(), up && up.songId, up && engine.upNext(up.index) && engine.upNext(up.index).songId].filter(Boolean); analyser.setScope({ focus: ids }); }
  }
}

function onTick() {
  if (!tickTimer) tickTimer = setTimeout(() => { tickTimer = null; if (engine) sendHost('tick', { position: engine.game.playback.position, index: engine.game.playback.index, status: engine.game.playback.status }); }, lowRes() ? 1000 : 250);
  if (!remoteTickTimer) remoteTickTimer = setTimeout(() => {
    remoteTickTimer = null;
    if (engine && remote) remote.broadcast({ type: 'tick', position: engine.game.playback.position, index: engine.game.playback.index, status: engine.game.playback.status });
    // playback position → a tiny side file every few seconds (no full-game rewrite, no fsync)
    if (engine) savePosition(engine.game);
  }, 1000);
}

/** Host-only readiness details for Up Next (thumbnail, file present, levelling analysed). */
function enrichUpNext(st, forPhone) {
  const n = st.upNext && st.upNext.next;
  if (!n) return st;
  const gs = engine.game.songs[n.songId];
  const lib = library.get(n.songId);
  const yt = !!(gs && gs.source === 'youtube');
  const exists = yt ? net.isOnline() : !!(gs && gs.path && fs.existsSync(gs.path));
  n.fileFound = exists; n.youtube = yt;
  if (!exists) { n.ready = false; n.problem = n.problem || (yt ? 'YouTube video — no internet connection' : 'Video file missing — relink it before it is due'); }
  n.levelling = lib && lib.audio ? lib.audio.status : 'pending';
  if (lib && lib.status === 'unsupported') { n.ready = false; n.problem = n.problem || ('Video cannot be played: ' + (lib.statusNote || 'unsupported')); }
  if (!forPhone && lib && lib.thumb) n.thumb = lib.thumb;
  return st;
}

function fullHostState() {
  if (!engine) return { game: null };
  const st = enrichUpNext(engine.hostState(), false);
  st.order = engine.orderView();
  st.cardNumbers = { min: engine.game.cards.length ? Math.min(...engine.game.cards.map(c => c.no)) : null, max: engine.game.cards.length ? Math.max(...engine.game.cards.map(c => c.no)) : null };
  st.playlistName = engine.game.playlistName;
  return { game: st };
}

/* ---------------- YouTube songs (Beta) */
function youtubeIdOf(u) {
  const s = String(u || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let m = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i.exec(s);
  return m ? m[1] : null;
}
async function fetchWithTimeout(url, ms) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await net.fetch(url, { signal: ctl.signal }); } finally { clearTimeout(t); }
}
/** Title, artist and thumbnail from YouTube's public oEmbed endpoint (also tells us if embedding is allowed). */
async function youtubeMeta(id) {
  const base = (IS_TEST && process.env.CMB_YT_OEMBED) || 'https://www.youtube.com/oembed?format=json&url=';
  let res;
  try { res = await fetchWithTimeout(base + encodeURIComponent('https://www.youtube.com/watch?v=' + id), 10000); } catch (e) { throw new Error('No internet connection — YouTube could not be reached'); }
  if (res.status === 401 || res.status === 403) throw new Error('The video’s owner does not allow it to be played in other apps');
  if (res.status === 404 || res.status === 400) throw new Error('Video not found, private or removed');
  if (!res.ok) throw new Error('YouTube answered with an error (' + res.status + ')');
  const j = await res.json();
  const { parseFilename } = require('./mp4meta');
  const g = parseFilename(String(j.title || '') + '.mp4');
  const author = String(j.author_name || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').replace(/\s*Official$/i, '').trim();
  const meta = { id, title: g.title || String(j.title || ''), artist: g.artist || author, thumb: null };
  if (j.thumbnail_url && /^https:\/\//.test(j.thumbnail_url) || (IS_TEST && j.thumbnail_url)) {
    try { const tr = await fetchWithTimeout(j.thumbnail_url, 8000); if (tr.ok) { const dir = path.join(DATA_DIR, 'thumbs'); fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, 'yt_' + id + '.jpg'); fs.writeFileSync(f, Buffer.from(await tr.arrayBuffer())); meta.thumb = f; } } catch (e) { /* thumbnail optional */ }
  }
  return meta;
}

/** Library import that also understands .m3u/.m3u8 files (dropped, picked or passed together with videos). */
async function importM3UFiles(files) {
  const out = [];
  for (const f of files) { try { out.push(await library.importM3U(f)); } catch (e) { out.push({ file: f, name: path.basename(f), error: e.message }); } }
  updateBackgroundWork();
  return out;
}
async function importAny(paths) {
  const lists = (paths || []).filter(p => m3u.isM3U(p) && (() => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } })());
  const rest = (paths || []).filter(p => !lists.includes(p));
  const rep = rest.length ? await library.importPaths(rest) : { added: [], alreadyInLibrary: [], duplicates: [], unsupported: [], ignored: 0 };
  if (lists.length) rep.m3u = await importM3UFiles(lists);
  return rep;
}

/** Everything about HOW a game is played (not its cards or history) — what a template keeps. */
const TEMPLATE_KEYS = ['clipMode', 'defaultStart', 'skipIntros', 'spreadArtists', 'autoAdvance', 'autoAdvanceGap', 'shuffle', 'volume', 'pauseOnClaim', 'winnerAnimation', 'tvScreens', 'screens', 'overlay', 'crawler', 'audio', 'patternPosition', 'rounds', 'roundCount', 'mode', 'checklist', 'afterWinner', 'intermissionMinutes', 'intermissionMessage'];
function pickTemplateSettings(s) { const o = {}; TEMPLATE_KEYS.forEach(k => { if (s && s[k] !== undefined) o[k] = JSON.parse(JSON.stringify(s[k])); }); return o; }

function remoteState() {
  if (!engine) return { game: null, theme: uiTheme() };
  const st = enrichUpNext(engine.hostState(), true);
  st.audienceConnected = engine.audienceConnected;
  st.eligible = engine.eligibleSongs();
  return { game: st, theme: uiTheme() };
}
function withTheme(v) { return v ? Object.assign(v, { theme: uiTheme() }) : v; } // removed player → null (phone shows “removed”)
function uiTheme() { return settings && settings.appearance && settings.appearance.theme === 'light' ? 'light' : 'dark'; }

/* State fan-out: everything that changes during one command is coalesced into ONE update
   (setImmediate), and each consumer only receives a new state when its own view actually
   changed. A volume tap on the phone no longer re-sends the TV its full state, and the TV
   renderer (which is also the video player) is left alone. */
let lastHostJson = null, lastTvJson = null, flushQueued = false, pendingTv = false;
function flushEngineChanges() {
  flushQueued = false;
  if (!engine) return;
  const h = fullHostState(); const hj = JSON.stringify(h);
  if (hj !== lastHostJson) { lastHostJson = hj; sendHost('state', h); }
  if (pendingTv) { pendingTv = false; const a = audienceStateWithJoin(); const aj = JSON.stringify(a); if (aj !== lastTvJson) { lastTvJson = aj; sendAudience('audience-state', a); } }
  if (remote) remote.broadcastState();
}
function onEngineChanged(kind) {
  if (!engine) return;
  if (kind !== 'tickOnly') pendingTv = true;
  if (!flushQueued) { flushQueued = true; setImmediate(flushEngineChanges); }
  updateBackgroundWork();
  // keep the laptop awake while a game is live
  const live = engine.game.status === 'live';
  if (live && powerBlock === null) powerBlock = powerSaveBlocker.start('prevent-display-sleep');
  if (!live && powerBlock !== null) { powerSaveBlocker.stop(powerBlock); powerBlock = null; }
}

function sendHost(ch, data) { if (hostWin && !hostWin.isDestroyed()) hostWin.webContents.send(ch, data); }
function sendAudience(ch, data) {
  if (audienceWin && !audienceWin.isDestroyed()) audienceWin.webContents.send(ch, data);
  if (mirrorWin && !mirrorWin.isDestroyed()) mirrorWin.webContents.send(ch, data); // second screen sees exactly the same
}
let mirrorWin = null;

/* Single ordered command path for desktop + phone */
let cmdQueue = Promise.resolve();
function dispatch(action, args, source) {
  const p = cmdQueue.then(() => {
    if (!engine) throw new Error('No game is loaded. Create or resume a game first.');
    return engine.dispatch(action, args, source);
  });
  cmdQueue = p.catch(() => {});
  return p;
}

/* ======================================================================= windows */
function createHostWindow() {
  hostWin = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    backgroundColor: '#102542', title: 'Anthem Square', show: false,
    icon: path.join(ROOT, 'assets', 'icon.png'),
    webPreferences: { spellcheck: false, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  hostWin.loadFile(path.join(RENDERER, 'host', 'index.html'));
  hostWin.once('ready-to-show', () => { if (!IS_TEST || process.env.CMB_SHOW) hostWin.show(); if (!IS_TEST) hostWin.maximize(); });
  hostWin.on('close', (e) => {
    if (IS_TEST || app.isQuiting) return;
    if (engine && engine.game.status === 'live') {
      const r = dialog.showMessageBoxSync(hostWin, { type: 'question', buttons: ['Cancel', 'Save & Quit'], defaultId: 0, cancelId: 0, title: 'Quit Anthem Square?', message: 'A game is in progress.', detail: 'Everything is saved — you can resume this game next time you open Anthem Square.' });
      if (r === 0) { e.preventDefault(); return; }
    }
  });
  hostWin.on('closed', () => { hostWin = null; app.quit(); });
}

let audienceReady = false;
function pickAudienceDisplay() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  if (settings.video.displayId) { const d = displays.find(x => String(x.id) === String(settings.video.displayId)); if (d) return d; }
  return displays.find(d => d.id !== primary.id) || primary;
}

function openAudienceWindow(opts = {}) {
  if (audienceWin && !audienceWin.isDestroyed()) { audienceWin.show(); audienceWin.focus(); return; }
  const d = opts.displayId ? (screen.getAllDisplays().find(x => String(x.id) === String(opts.displayId)) || pickAudienceDisplay()) : pickAudienceDisplay();
  const external = d.id !== screen.getPrimaryDisplay().id;
  const b = d.bounds;
  audienceWin = new BrowserWindow({
    x: b.x + (external ? 0 : Math.round(b.width * 0.1)), y: b.y + (external ? 0 : Math.round(b.height * 0.1)),
    width: external ? b.width : Math.round(b.width * 0.6), height: external ? b.height : Math.round(b.width * 0.6 * 9 / 16),
    backgroundColor: '#0B1B31', title: 'Anthem Square — Audience', autoHideMenuBar: true, show: false,
    icon: path.join(ROOT, 'assets', 'icon.png'),
    webPreferences: { spellcheck: false, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
  });
  audienceWin.setMenuBarVisibility(false);
  audienceReady = false;
  audienceWin.loadFile(path.join(RENDERER, 'audience', 'index.html'));
  audienceWin.once('ready-to-show', () => {
    if (IS_TEST && !process.env.CMB_SHOW) { audienceWin.showInactive(); }
    else audienceWin.show();
    if (external && settings.video.fullscreen && !IS_TEST) audienceWin.setFullScreen(true);
  });
  audienceWin.on('closed', () => { audienceWin = null; audienceReady = false; if (engine) engine.playerGone(); sendHost('audience', { open: false }); });
  sendHost('audience', { open: true });
}


/** Second TV screen: a silent mirror of the audience window on another display. */
function openMirrorWindow(displayId) {
  if (mirrorWin && !mirrorWin.isDestroyed()) { mirrorWin.show(); mirrorWin.focus(); return mirrorStatus(); }
  const displays = screen.getAllDisplays(); const primary = screen.getPrimaryDisplay();
  const tvId = audienceWin && !audienceWin.isDestroyed() ? screen.getDisplayMatching(audienceWin.getBounds()).id : null;
  const d = (displayId && displays.find(x => String(x.id) === String(displayId))) || displays.find(x => x.id !== primary.id && x.id !== tvId) || displays.find(x => x.id !== primary.id) || primary;
  const external = d.id !== primary.id && d.id !== tvId; const b = d.bounds;
  mirrorWin = new BrowserWindow({
    x: b.x + (external ? 0 : Math.round(b.width * 0.15)), y: b.y + (external ? 0 : Math.round(b.height * 0.15)),
    width: external ? b.width : Math.round(b.width * 0.45), height: external ? b.height : Math.round(b.width * 0.45 * 9 / 16),
    backgroundColor: '#0B1B31', title: 'Anthem Square — Second screen', autoHideMenuBar: true, show: false, icon: path.join(ROOT, 'assets', 'icon.png'),
    webPreferences: { spellcheck: false, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
  });
  mirrorWin.setMenuBarVisibility(false);
  mirrorWin.loadFile(path.join(RENDERER, 'audience', 'index.html'), { query: { mirror: '1' } });
  mirrorWin.once('ready-to-show', () => { if (IS_TEST && !process.env.CMB_SHOW) mirrorWin.showInactive(); else mirrorWin.show(); if (external && settings.video.fullscreen && !IS_TEST) mirrorWin.setFullScreen(true); });
  mirrorWin.on('closed', () => { mirrorWin = null; sendHost('mirror', mirrorStatus()); });
  sendHost('mirror', { open: true });
  return { open: true, displayId: d.id, external };
}
function mirrorStatus() { return { open: !!(mirrorWin && !mirrorWin.isDestroyed()), displays: screen.getAllDisplays().length }; }

/* ======================================================================= card printing */
function cardsForPrint(game, numbers) {
  const set = numbers ? new Set(numbers) : null;
  return game.cards.filter(c => !set || set.has(c.no)).sort((a, b) => a.no - b.no);
}

/** Build the print job (the saved, locked card data + visual options). Never changes cards. */
async function buildPrintJob(game, opts) {
  const numbers = opts.range ? cardsLib.parseRange(opts.range) : (opts.onlyUnprinted ? game.cards.filter(c => !c.printed).map(c => c.no) : null);
  const list = cardsForPrint(game, numbers);
  if (!list.length) throw new Error('No cards match that selection. Generate cards first, or check the card range.');
  const cardOpts = Object.assign({}, settings.cards, opts);
  const songs = {};
  const labels = locking.labelsFor(game);
  Object.keys(labels).forEach(id => { songs[id] = { t: labels[id].title, a: labels[id].artist }; });
  const qrs = {};
  if (cardOpts.qr) {
    // QR identifies the card set: a restored separate copy keeps the original id so reprints match the printed cards
    for (const c of list) qrs[c.no] = await QRCode.toString(cardsLib.qrPayload(game.cardSetId || game.id, c.no), { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
  }
  let logo = null;
  const logoPath = game.logo || settings.appearance.logo;
  if (cardOpts.useLogo && logoPath && fs.existsSync(logoPath)) logo = 'data:image/' + (path.extname(logoPath).slice(1).replace('jpg', 'jpeg') || 'png') + ';base64,' + fs.readFileSync(logoPath).toString('base64');
  const job = {
    game: { id: game.cardSetId || game.id, internalId: game.id, name: game.name, date: game.date, venue: game.venue, total: game.cards.length },
    cards: list.map(c => ({ no: c.no, cells: c.cells, batch: c.batch || 1 })), songs, qrs, logo,
    bw: !!cardOpts.bw, textScale: Number(cardOpts.textScale) || 1, showArtist: cardOpts.showArtist !== false, cutLines: cardOpts.cutLines !== false,
    rounds: Object.keys(validRounds(game.settings.rounds, game.settings.roundCount)).map(Number).map(n => { const i = rules.roundInfo({ round: n, rules: validRounds(game.settings.rounds, game.settings.roundCount)[n] }); return { n, label: i.label, short: i.short, pattern: i.examples[0], diagonals: i.diagonalsCount }; }),
    mode: game.settings.mode === 'checklist' ? 'checklist' : 'rounds',
    checklist: (game.settings.checklist || []).map(it => { const i = rules.roundInfo({ round: 0, rules: [it.rule] }); return { label: i.label, short: i.short, pattern: i.examples[0], diagonals: i.diagonalsCount }; }),
    names: opts.names || null,
    locked: !!game.cardsLocked,
    opts: { qr: !!cardOpts.qr, bw: !!cardOpts.bw, useLogo: !!cardOpts.useLogo, textScale: Number(cardOpts.textScale) || 1, showArtist: cardOpts.showArtist !== false, cutLines: cardOpts.cutLines !== false }
  };
  return { job, list };
}

async function renderPrintJob(game, opts, mode) {
  const { job, list } = await buildPrintJob(game, opts);
  const win = new BrowserWindow({ show: mode === 'print' && false, width: 794, height: 1123, webPreferences: { spellcheck: false, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false } });
  try {
    await win.loadFile(path.join(RENDERER, 'print', 'print.html'));
    const ready = new Promise((resolve) => ipcMain.once('print:ready:' + win.webContents.id, (e, info) => resolve(info)));
    win.webContents.send('print:job', job);
    const info = await ready;
    if (mode === 'pdf') {
      const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'none' }, preferCSSPageSize: true });
      return { pdf, info, count: list.length, numbers: list.map(c => c.no) };
    }
    const ok = await new Promise((resolve) => win.webContents.print({ silent: false, printBackground: true, pageSize: 'A4', margins: { marginType: 'none' } }, (success, reason) => resolve({ success, reason })));
    return { printed: ok.success, reason: ok.reason, info, count: list.length, numbers: list.map(c => c.no) };
  } finally { if (!win.isDestroyed()) win.destroy(); }
}

/** Issue cards: lock the game (transactional — written atomically before returning). */
function issueCards(game, numbers, source) {
  locking.lockGame(game, numbers, source || 'laptop');
  if (engine && engine.game === game) engine.audit('cards-issued', { cards: numbers.length, from: Math.min(...numbers), to: Math.max(...numbers) }, source);
  else { game.audit = game.audit || []; game.audit.push({ at: new Date().toISOString(), gameId: game.id, action: 'cards-issued', cards: numbers.length, source: source || 'laptop' }); }
  store.writeNow('games/' + game.id, game);
  if (engine && engine.game === game) onEngineChanged('state');
}
function requireLockConsent(game, opts) {
  if (!game.cardsLocked && !opts.confirmLock) { const e = new Error('LOCK_REQUIRED'); e.code = 'LOCK_REQUIRED'; throw e; }
}

function getGameObj(id) { if (engine && engine.game.id === id) return engine.game; const g = readGame(id); if (!g) throw new Error('Game not found'); return GameEngine.normalise(g); }

/* ======================================================================= IPC */
const handlers = {
  'app:info': () => ({ version: app.getVersion(), dataDir: DATA_DIR, recovery: recoveryInfo, platform: process.platform, isTest: IS_TEST, totalRamGB: TOTAL_RAM_GB, recommendLowResource: LOW_RAM && !settings.performance.lowResource && !settings.performance.decided }),
  'library:optimise': ({ ids, maxHeight }) => ({ queued: converter.optimise(ids && ids.length ? ids : library.songs().map(s => s.id), Number(maxHeight) || 720) }),
  'library:restoreOriginal': ({ id }) => converter.restoreOriginal(id),
  'perf:status': () => perfStatus(),
  'settings:get': () => settings,
  'settings:update': (patch) => {
    if (patch.performance) patch.performance.decided = true;
    ['appearance', 'video', 'cards', 'remote', 'updates', 'library', 'home', 'performance'].forEach(k => { if (patch[k]) Object.assign(settings[k], patch[k]); });
    if (patch.performance) { sendAudience('app-settings', audienceAppSettings()); updateBackgroundWork(); }
    if (Array.isArray(patch.customPatterns)) settings.customPatterns = patch.customPatterns.map(p => { try { const r = rules.normaliseRule({ id: 'custom', name: p.name, cells: p.cells }); return { id: String(p.id || 'cp_' + Date.now().toString(36)).slice(0, 40), name: r.name, cells: r.cells }; } catch (e) { return null; } }).filter(Boolean).slice(0, 50);
    if (Array.isArray(patch.checklistPresets)) settings.checklistPresets = patch.checklistPresets.map(p => ({ name: String(p.name || 'Checklist').trim().slice(0, 40) || 'Checklist', items: normaliseChecklist(p.items) })).filter(p => p.items.length).slice(0, 30);
    if (Array.isArray(patch.rulePresets)) settings.rulePresets = patch.rulePresets.map(p => { const c = Math.max(1, Math.min(10, Number(p.roundCount) || Object.keys(p.rounds || {}).length || 3)); return { name: String(p.name || 'Preset').trim().slice(0, 40) || 'Preset', roundCount: c, rounds: validRounds(p.rounds, c) }; }).slice(0, 30);
    if (patch.appearance && remote) { remote.broadcastState(); if (remote.broadcastPlayers) remote.broadcastPlayers(); }
    if (patch.home) { if (remote && remote.broadcastPlayers) remote.broadcastPlayers(); if (engine) onEngineChanged('state'); }
    if (patch.updates && updater) updater.start(settings.updates.auto !== false);
    if (patch.gameDefaults) {
      const gd = patch.gameDefaults;
      if (gd.overlay) Object.assign(settings.gameDefaults.overlay, gd.overlay);
      if (gd.crawler) Object.assign(settings.gameDefaults.crawler, gd.crawler);
      if (gd.audio) settings.gameDefaults.audio = Object.assign({}, settings.gameDefaults.audio || {}, gd.audio);
      if (gd.screens) settings.gameDefaults.screens = Object.assign({}, settings.gameDefaults.screens || {}, gd.screens);
      if (gd.roundCount != null) settings.gameDefaults.roundCount = Math.max(1, Math.min(10, Number(gd.roundCount) || 3));
      if (gd.checklist) { const l = normaliseChecklist(gd.checklist); if (l.length) settings.gameDefaults.checklist = l; }
      if (gd.mode) settings.gameDefaults.mode = gd.mode === 'checklist' ? 'checklist' : 'rounds';
      if (gd.rounds || gd.roundCount != null) settings.gameDefaults.rounds = validRounds(Object.assign({}, settings.gameDefaults.rounds, gd.rounds || {}), settings.gameDefaults.roundCount);
      Object.keys(gd).forEach(k => { if (!['overlay', 'crawler', 'audio', 'screens', 'rounds', 'roundCount', 'checklist', 'mode'].includes(k)) settings.gameDefaults[k] = gd[k]; });
    }
    saveSettings();
    sendAudience('app-settings', audienceAppSettings());
    return settings;
  },
  'slides:add': async ({ files } = {}) => {
    if (!files) { const r = await dialog.showOpenDialog(hostWin, { title: 'Add intermission slides', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] }); if (r.canceled) return settings.slides; files = r.filePaths; }
    const dir = path.join(DATA_DIR, 'slides'); fs.mkdirSync(dir, { recursive: true });
    for (const f of files) {
      if (!/\.(png|jpe?g|webp|gif)$/i.test(f)) continue;
      if (fs.statSync(f).size > 25 * 1024 * 1024) continue; // a slide, not a poster print file
      const id = 'sl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const file = path.join(dir, id + path.extname(f).toLowerCase()); fs.copyFileSync(f, file);
      settings.slides.images.push({ id, file, name: path.basename(f) });
    }
    settings.slides.images = settings.slides.images.slice(-60);
    saveSettings(); sendAudience('app-settings', audienceAppSettings()); return settings.slides;
  },
  'slides:remove': ({ id }) => { const it = settings.slides.images.find(i => i.id === id); if (it) { try { fs.unlinkSync(it.file); } catch (e) { /* */ } } settings.slides.images = settings.slides.images.filter(i => i.id !== id); saveSettings(); sendAudience('app-settings', audienceAppSettings()); return settings.slides; },
  'slides:move': ({ id, dir }) => { const a = settings.slides.images; const i = a.findIndex(x => x.id === id); const j = i + (dir < 0 ? -1 : 1); if (i >= 0 && j >= 0 && j < a.length) { [a[i], a[j]] = [a[j], a[i]]; saveSettings(); sendAudience('app-settings', audienceAppSettings()); } return settings.slides; },
  'slides:set': ({ enabled, seconds }) => { if (enabled != null) settings.slides.enabled = !!enabled; if (seconds != null) settings.slides.seconds = Math.max(3, Math.min(60, Number(seconds) || 8)); saveSettings(); sendAudience('app-settings', audienceAppSettings()); return settings.slides; },
  'settings:pickLogo': async () => {
    const r = await dialog.showOpenDialog(hostWin, { title: 'Choose a logo', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const dest = path.join(DATA_DIR, 'logo' + path.extname(r.filePaths[0]).toLowerCase());
    fs.copyFileSync(r.filePaths[0], dest);
    settings.appearance.logo = dest; saveSettings();
    sendAudience('app-settings', audienceAppSettings());
    return dest;
  },
  'settings:clearLogo': () => { settings.appearance.logo = null; saveSettings(); sendAudience('app-settings', audienceAppSettings()); return true; },

  /* library */
  'library:list': () => ({ songs: library.songs() }),
  'library:nextUnchecked': () => library.nextUnchecked(),
  'library:pickFiles': async () => {
    const r = await dialog.showOpenDialog(hostWin, { title: 'Import music videos or M3U playlists', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Music videos and playlists', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'm3u', 'm3u8'] }, { name: 'M3U playlists', extensions: ['m3u', 'm3u8'] }, { name: 'All files', extensions: ['*'] }] });
    return r.canceled ? null : importAny(r.filePaths);
  },
  'library:pickFolder': async () => {
    const r = await dialog.showOpenDialog(hostWin, { title: 'Import a folder of music videos', properties: ['openDirectory'] });
    return r.canceled ? null : library.importPaths(r.filePaths);
  },
  'library:importPaths': (paths) => importAny(paths),
  'library:addYouTube': async ({ urls }) => {
    const out = { added: [], already: [], failed: [] };
    const ids = []; const seen = new Set();
    String(urls || '').split(/[\r\n,]+/).map(x => x.trim()).filter(Boolean).forEach(u => {
      const id = youtubeIdOf(u);
      if (!id) { if (/list=/.test(u)) out.failed.push({ url: u, reason: 'Playlists are not supported — add the videos one by one' }); else out.failed.push({ url: u, reason: 'Not a YouTube video link' }); return; }
      if (!seen.has(id)) { seen.add(id); ids.push([u, id]); }
    });
    for (const [u, id] of ids.slice(0, 200)) {
      try {
        const meta = await youtubeMeta(id);
        const r = library.addYouTube(meta);
        (r.already ? out.already : out.added).push({ id: r.song.id, title: r.song.title, artist: r.song.artist });
      } catch (e) { out.failed.push({ url: u, reason: e.message }); }
    }
    return out;
  },
  'library:bulkTag': ({ ids, add, remove, year }) => library.bulkTag(ids || [], { add, remove, year }),
  'library:tagSummary': () => library.tagSummary(),
  'playlists:build': (opts) => library.buildPlaylist(opts || {}),
  'playlists:importM3U': async () => {
    const r = await dialog.showOpenDialog(hostWin, { title: 'Import M3U playlists', properties: ['openFile', 'multiSelections'], filters: [{ name: 'M3U playlists', extensions: ['m3u', 'm3u8'] }, { name: 'All files', extensions: ['*'] }] });
    return r.canceled ? null : importM3UFiles(r.filePaths);
  },
  'playlists:importM3UFiles': ({ files }) => importM3UFiles(files || []),
  'playlists:exportM3U': async ({ id, file }) => {
    const p = library.playlist(id); if (!p) throw new Error('Playlist not found');
    if (!file) {
      const r = await dialog.showSaveDialog(hostWin, { title: 'Export playlist as M3U', defaultPath: path.join(app.getPath('documents'), p.name.replace(/[<>:"/\\|?*]+/g, '').trim() + '.m3u8'), filters: [{ name: 'M3U playlist (UTF-8)', extensions: ['m3u8'] }, { name: 'M3U playlist', extensions: ['m3u'] }] });
      if (r.canceled) return null; file = r.filePath;
    }
    return library.exportM3U(id, file);
  },
  'library:pickFolderPlaylists': async () => {
    const r = await dialog.showOpenDialog(hostWin, { title: 'Choose the top folder — each sub-folder becomes a playlist', properties: ['openDirectory'] });
    return r.canceled ? null : library.importFolderAsPlaylists(r.filePaths[0]);
  },
  'library:importFolderPlaylists': ({ folder }) => library.importFolderAsPlaylists(folder),
  'convert:status': () => (converter ? converter.status() : { available: false }),
  'convert:start': ({ ids }) => { converter.request(ids || []); return converter.status(); },
  'convert:cancel': ({ id }) => { converter.cancel(id); return converter.status(); },
  'library:probeResult': ({ id, result }) => library.probeResult(id, result, path.join(DATA_DIR, 'thumbs')),
  'library:update': ({ id, fields }) => library.update(id, fields),
  'library:remove': ({ ids }) => { library.remove(ids); return true; },
  'library:checkFiles': () => library.checkFiles(),
  'library:relink': async ({ id }) => {
    const r = await dialog.showOpenDialog(hostWin, { title: 'Locate the video file', properties: ['openFile'], filters: [{ name: 'Music videos', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv'] }] });
    if (r.canceled) return null;
    const s = library.relink(id, r.filePaths[0]);
    relinkInGames(s);
    return s;
  },
  'library:relinkFolder': async () => {
    const r = await dialog.showOpenDialog(hostWin, { title: 'Folder containing the moved videos', properties: ['openDirectory'] });
    if (r.canceled) return null;
    const n = library.relinkFolder(r.filePaths[0]);
    library.songs().forEach(s => relinkInGames(s));
    return n;
  },
  'library:fileUrl': (p) => pathToFileURL(p).href,

  /* playlists */
  'playlists:list': () => library.playlists().map(p => Object.assign({}, p, { validation: summariseValidation(library.validatePlaylist(p.id)) })),
  'playlists:create': ({ name }) => library.createPlaylist(name),
  'playlists:rename': ({ id, name }) => library.renamePlaylist(id, name),
  'playlists:duplicate': ({ id }) => library.duplicatePlaylist(id),
  'playlists:delete': ({ id }) => { library.deletePlaylist(id); return true; },
  'playlists:add': ({ id, songIds }) => library.addToPlaylist(id, songIds),
  'playlists:remove': ({ id, songIds }) => library.removeFromPlaylist(id, songIds),
  'playlists:reorder': ({ id, songIds }) => library.reorderPlaylist(id, songIds),
  'playlists:validate': ({ id }) => summariseValidation(library.validatePlaylist(id)),

  /* games */
  'games:list': () => store.listGames().map(gameSummary).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))),
  'templates:list': () => settings.templates.map(t => Object.assign({}, t, { playlistName: (library.playlist(t.playlistId) || {}).name || null })),
  'templates:save': ({ name, fromGameId, playlistId, cards, venue, settings: st }) => {
    name = String(name || '').trim().slice(0, 60); if (!name) throw new Error('Give the template a name.');
    let t;
    if (fromGameId) {
      const g = engine && engine.game.id === fromGameId ? engine.game : readGame(fromGameId); if (!g) throw new Error('Game not found');
      t = { playlistId: g.playlistId, cards: (g.cards || []).length || 100, venue: g.venue || '', settings: pickTemplateSettings(g.settings) };
    } else {
      const merged = JSON.parse(JSON.stringify(settings.gameDefaults));
      Object.keys(st || {}).forEach(k => { merged[k] = st[k]; });
      t = { playlistId: playlistId || null, cards: Math.max(1, Math.min(999, Number(cards) || 100)), venue: String(venue || ''), settings: pickTemplateSettings(merged) };
    }
    const old = settings.templates.find(x => x.name.toLowerCase() === name.toLowerCase());
    const tpl = Object.assign({ id: old ? old.id : 't_' + Date.now().toString(36), name, savedAt: new Date().toISOString() }, t);
    settings.templates = settings.templates.filter(x => x.id !== tpl.id).concat([tpl]).slice(-40);
    saveSettings();
    return tpl;
  },
  'templates:delete': ({ id }) => { settings.templates = settings.templates.filter(t => t.id !== id); saveSettings(); return true; },
  'games:create': (opts) => {
    const v = library.validatePlaylist(opts.playlistId);
    if (!v.ok) throw new Error(`This playlist has ${v.uniquePlayable} playable unique songs. Add ${v.needed} more song${v.needed === 1 ? '' : 's'} (minimum 40).`);
    const gs = JSON.parse(JSON.stringify(settings.gameDefaults));
    if (opts.settings) Object.keys(opts.settings).forEach(k => { if (typeof opts.settings[k] === 'object' && opts.settings[k] && !Array.isArray(opts.settings[k])) gs[k] = Object.assign(gs[k] || {}, opts.settings[k]); else gs[k] = opts.settings[k]; });
    if (opts.settings && opts.settings.rounds) gs.rounds = JSON.parse(JSON.stringify(opts.settings.rounds)); // a template's rounds replace the defaults
    const game = createGame({ name: opts.name, date: opts.date, venue: opts.venue, logo: opts.logo || null, songs: v.songs, playlistId: v.playlistId, playlistName: v.name, settings: gs });
    if (opts.cards) game.cards = cardsLib.generateCards(game.order, Number(opts.cards), []);
    saveGame(game);
    activateGame(game);
    return gameSummary(game);
  },
  'games:open': ({ id }) => { const g = readGame(id); if (!g) throw new Error('Game not found'); activateGame(g); return gameSummary(g); },
  'games:active': () => (engine ? gameSummary(engine.game) : null),
  'games:delete': ({ id }) => { if (engine && engine.game.id === id) throw new Error('Close this game before deleting it.'); store.deleteGame(id); return true; },
  'games:close': () => { if (engine) { store.flush(); engine.cancelAdvance(); sendAudience('player', { cmd: 'clear' }); engine = null; lastHostJson = lastTvJson = null; sendHost('state', { game: null }); if (remote) remote.broadcastState(); } return true; },
  'games:details': ({ id }) => {
    const g = getGameObj(id);
    const songs = g.songs;
    return Object.assign(gameSummary(g), {
      history: g.played.map((p, i) => ({ n: i + 1, title: songs[p.songId].displayTitle || songs[p.songId].title, artist: songs[p.songId].artist, round: p.round, at: p.at })),
      claims: g.claims.map(c => Object.assign({}, c, { cardLabel: cardsLib.formatCardNo(c.cardNo) })),
      log: g.log.slice(-200)
    });
  },
  'games:exportReport': async ({ id }) => {
    const g = getGameObj(id);
    const r = await dialog.showSaveDialog(hostWin, { title: 'Save game report', defaultPath: `${g.name.replace(/[^\w -]/g, '')}-${g.date}-report.txt` });
    if (r.canceled) return null;
    const lines = [`ANTHEM SQUARE — GAME REPORT`, `${g.name}  ·  ${g.date}  ·  ${g.venue || ''}`, `Game ID ${g.id}  ·  Playlist ${g.playlistName}  ·  Cards ${g.cards.length}`, '', 'WINNERS'];
    g.claims.filter(c => c.status === 'confirmed').forEach(c => lines.push(`  Round ${c.round}: Card ${cardsLib.formatCardNo(c.cardNo)} — ${c.headline}`));
    lines.push('', 'PLAYED SONGS');
    g.played.forEach((p, i) => lines.push(`  ${String(i + 1).padStart(2, '0')}. ${g.songs[p.songId].title} — ${g.songs[p.songId].artist}  (round ${p.round})`));
    fs.writeFileSync(r.filePath, lines.join('\r\n'));
    return r.filePath;
  },

  /* cards */
  'cards:generate': ({ id, count }) => {
    const g = getGameObj(id);
    const newCards = cardsLib.generateCards(g.order, Number(count), g.cards);
    g.cards.push(...newCards);
    const problems = cardsLib.validateCards(g.cards, g.order);
    if (problems.length) throw new Error('Card validation failed: ' + problems.slice(0, 3).join('; '));
    saveGame(g);
    if (engine && engine.game === g) onEngineChanged('state');
    return { added: newCards.length, from: newCards[0].no, to: newCards[newCards.length - 1].no, total: g.cards.length };
  },
  'cards:summary': ({ id }) => {
    const g = getGameObj(id);
    const batches = {};
    g.cards.forEach(c => { const b = batches[c.batch] = batches[c.batch] || { batch: c.batch, count: 0, from: 999, to: 0, printed: 0 }; b.count++; b.from = Math.min(b.from, c.no); b.to = Math.max(b.to, c.no); if (c.printed) b.printed++; });
    return { total: g.cards.length, printed: g.cards.filter(c => c.printed).length, remainingNumbers: 999 - g.cards.length, batches: Object.values(batches), problems: cardsLib.validateCards(g.cards, g.order).concat(locking.verifyLock(g)), locked: !!g.cardsLocked, lockedAt: g.lockedAt || null };
  },
  'cards:get': ({ id, no }) => {
    const g = getGameObj(id); const c = g.cards.find(x => x.no === Number(no)); if (!c) throw new Error('No such card');
    return { no: c.no, label: cardsLib.formatCardNo(c.no), printed: c.printed, cells: c.cells.map(sid => ({ title: g.songs[sid].printTitle || g.songs[sid].displayTitle || g.songs[sid].title, artist: g.songs[sid].artist })) };
  },
  /** Interactive A4 print preview (pages, zoom, find card, QR check, print / reprint / PDF). Never locks. */
  'cards:preview': async (opts) => {
    const g = getGameObj(opts.id);
    const { job } = await buildPrintJob(g, Object.assign({}, opts, { range: opts.range || null }));
    job.preview = true; job.gameKey = g.id;
    if (previewWin && !previewWin.isDestroyed()) previewWin.destroy();
    previewWin = new BrowserWindow({ width: 1100, height: 980, title: 'Print Preview — Anthem Square', backgroundColor: '#102542', parent: IS_TEST ? undefined : hostWin, show: false,
      webPreferences: { spellcheck: false, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false } });
    previewWin.setMenuBarVisibility(false);
    await previewWin.loadFile(path.join(RENDERER, 'print', 'print.html'), { query: { preview: '1' } });
    const ready = new Promise((resolve) => ipcMain.once('print:ready:' + previewWin.webContents.id, (e, info) => resolve(info)));
    previewWin.webContents.send('print:job', job);
    if (!IS_TEST || process.env.CMB_SHOW) previewWin.show();
    const info = await ready;
    return { cards: job.cards.length, sheets: Math.ceil(job.cards.length / 2), overflow: info.overflow, warnings: info.warnings, minFont: info.minFont };
  },
  'cards:exportPdf': async (opts) => {
    const g = getGameObj(opts.id);
    let file = opts.file;
    if (!file) {
      const r = await dialog.showSaveDialog(hostWin, { title: 'Export bingo cards as PDF', defaultPath: `${g.name.replace(/[^\w -]/g, '')}-cards.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (r.canceled) return null;
      file = r.filePath;
    }
    requireLockConsent(g, opts);
    const out = await renderPrintJob(g, opts, 'pdf');
    issueCards(g, out.numbers, 'laptop');
    fs.writeFileSync(file + '.partial', out.pdf); fs.renameSync(file + '.partial', file);
    return { file, cards: out.count, sheets: Math.ceil(out.count / 2), overflow: out.info.overflow, warnings: out.info.warnings, minFont: out.info.minFont };
  },
  'cards:print': async (opts) => {
    const g = getGameObj(opts.id);
    requireLockConsent(g, opts);
    const out = await renderPrintJob(g, opts, 'print');
    if (out.printed) issueCards(g, out.numbers, 'laptop');
    return { printed: out.printed, reason: out.reason, cards: out.count, sheets: Math.ceil(out.count / 2) };
  },
  /**
   * Home play: save each card as its own PNG (e.g. to send on WhatsApp). Uses exactly the
   * printed layout, so a shared image and a printed card are identical. Locks like printing.
   */
  'cards:exportImages': async (opts) => {
    if (!settings.home.shareImages) throw new Error('Turn on “Share cards as images” in Settings → Home play first.');
    const g = getGameObj(opts.id);
    let folder = opts.folder;
    if (!folder) {
      const r = await dialog.showOpenDialog(hostWin, { title: 'Choose a folder for the card images', properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      folder = r.filePaths[0];
    }
    requireLockConsent(g, opts);
    const names = {};
    const list0 = cardsForPrint(g, opts.range ? cardsLib.parseRange(opts.range) : null);
    (opts.names || []).map(x => String(x || '').trim().slice(0, 40)).forEach((n, i) => { if (n && list0[i]) names[list0[i].no] = n; });
    const { job, list } = await buildPrintJob(g, Object.assign({}, opts, { cutLines: false, names }));
    job.images = true;
    const Z = 2; // 2× = ~1590 × 1120 px per card, sharp on any phone
    const W = Math.ceil(210 * 96 / 25.4 * Z), H = Math.ceil(148.5 * 96 / 25.4 * Z);
    const win = new BrowserWindow({ show: false, useContentSize: true, width: W, height: H + 20, webPreferences: { spellcheck: false, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, offscreen: true, zoomFactor: Z } });
    const files = [];
    try {
      win.webContents.setFrameRate(10);
      await win.loadFile(path.join(RENDERER, 'print', 'print.html'), { query: { images: '1' } });
      win.webContents.setZoomFactor(Z);
      const ready = new Promise((resolve) => ipcMain.once('print:ready:' + win.webContents.id, (e, info) => resolve(info)));
      win.webContents.send('print:job', job);
      await ready;
      const safe = (x) => String(x).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 30);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        sendHost('cards-images', { done: i, total: list.length });
        await win.webContents.executeJavaScript(`window.__showCard(${c.no})`);
        const img = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
        const name = `${safe(g.name) || 'Bingo'}-Card-${cardsLib.formatCardNo(c.no)}${names[c.no] ? '-' + safe(names[c.no]) : ''}.png`;
        const f = path.join(folder, name);
        fs.writeFileSync(f, img.toPNG());
        files.push(f);
      }
    } finally { if (!win.isDestroyed()) win.destroy(); }
    issueCards(g, list.map(c => c.no), 'laptop');
    list.forEach(c => { const card = g.cards.find(x => x.no === c.no); if (card) { card.issuedVia = card.issuedVia || 'image'; if (names[c.no]) card.owner = names[c.no]; } });
    store.writeNow('games/' + g.id, g);
    sendHost('cards-images', { done: list.length, total: list.length });
    return { folder, files: files.length, first: files[0] || null, named: Object.keys(names).length };
  },
  'cards:regenerate': ({ id, count }) => {
    const g = getGameObj(id);
    if (g.cardsLocked) throw new Error('These cards have been issued (LOCKED) and can never be regenerated. You can still add extra cards with unused numbers.');
    if (g.round && g.round.number > 0) throw new Error('The game has started — cards can no longer be regenerated.');
    const n = Number(count) || g.cards.length || 100;
    g.cards = cardsLib.generateCards(g.order, n, []);
    saveGame(g); if (engine && engine.game === g) onEngineChanged('state');
    return { total: g.cards.length };
  },
  'games:rebuildFromPlaylist': ({ id }) => {
    const g = getGameObj(id);
    if (g.cardsLocked) throw new Error('This game is LOCKED — it can never be rebuilt from an edited playlist. Create a new game instead.');
    if (g.round && g.round.number > 0) throw new Error('The game has started.');
    const v = library.validatePlaylist(g.playlistId);
    if (!v.ok) throw new Error(`The playlist needs ${v.needed} more playable unique song(s).`);
    const fresh = createGame({ name: g.name, date: g.date, venue: g.venue, logo: g.logo, songs: v.songs, playlistId: v.playlistId, playlistName: v.name, settings: g.settings });
    g.songs = fresh.songs; g.order = fresh.order; g.playlistName = v.name;
    g.cards = cardsLib.generateCards(g.order, g.cards.length || 100, []);
    g.playback = { index: -1, status: 'idle', position: 0 };
    saveGame(g);
    if (engine && engine.game.id === g.id) activateGame(g);
    return gameSummary(g);
  },
  'games:relinkSong': async ({ id, songId, file, confirm }) => {
    const g = getGameObj(id);
    const s = g.songs[songId]; if (!s) throw new Error('Song not in this game');
    if (!file) {
      const r = await dialog.showOpenDialog(hostWin, { title: `Locate “${s.title} — ${s.artist}”`, properties: ['openFile'], filters: [{ name: 'Music videos', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv'] }] });
      if (r.canceled) return null; file = r.filePaths[0];
    }
    const res = backup.relinkOne(g, songId, file, { confirm });
    if (res.needsConfirm) return Object.assign(res, { file });
    if (engine && engine.game === g) { engine.audit('media-relinked', { songId, title: s.title, path: file, match: res.match }, 'laptop'); scanGameMedia(); }
    saveGame(g); if (engine && engine.game === g) onEngineChanged('state');
    return res;
  },
  'games:relinkScan': async ({ id, folder }) => {
    const g = getGameObj(id);
    if (!folder) { const r = await dialog.showOpenDialog(hostWin, { title: 'Folder containing the music videos', properties: ['openDirectory'] }); if (r.canceled) return null; folder = r.filePaths[0]; }
    return backup.scanForMatches(g, folder);
  },
  'games:relinkApply': ({ id, matches }) => {
    const g = getGameObj(id);
    const applied = backup.applyMatches(g, matches);
    saveGame(g);
    if (engine && engine.game === g) { engine.audit('media-relinked', { count: applied }, 'laptop'); scanGameMedia(); onEngineChanged('state'); }
    return { applied, missing: backup.missingMedia(g).length };
  },
  'games:missing': ({ id }) => backup.missingMedia(getGameObj(id)),
  'shell:open': (p) => shell.openPath(p),
  'shell:showItem': (p) => showInFolder(typeof p === 'string' ? p : (p && p.path)),
  /** Show a library video in File Explorer, highlighted. Missing → offer relink. */
  'library:showInFolder': ({ id }) => { const s = library.get(id); if (!s) return { ok: false, reason: 'not-found', message: 'This song is no longer in the library.' }; if (s.source === 'youtube') { shell.openExternal('https://www.youtube.com/watch?v=' + s.youtubeId); return { ok: true, opened: 'youtube' }; } return Object.assign(showInFolder(s.path), { id }); },

  /* host game */
  'game:state': () => fullHostState(),
  'game:cmd': ({ action, args }) => dispatch(action, args, 'laptop'),
  'game:preflight': () => preflight(),
  'audience:open': (o) => { openAudienceWindow(o || {}); return true; },
  'audience:close': () => { if (audienceWin) audienceWin.close(); return true; },
  'audience:fullscreen': () => { if (!audienceWin) openAudienceWindow(); else audienceWin.setFullScreen(!audienceWin.isFullScreen()); return true; },
  'audience:status': () => ({ open: !!(audienceWin && !audienceWin.isDestroyed()), ready: audienceReady, fullscreen: !!(audienceWin && !audienceWin.isDestroyed() && audienceWin.isFullScreen()) }),
  'audience:test': () => {
    if (!engine) throw new Error('Load a game first');
    const pb = engine.game.playback;
    if (['playing', 'loading'].includes(pb.status)) throw new Error('A song is playing — the test is only available while nothing is playing.');
    if (!audienceWin) openAudienceWindow();
    const s = engine.song(engine.game.order[0]);
    const start = Math.min(30, Math.max(0, (s.duration || 0) - 10));
    const send = () => sendAudience('player', { cmd: 'load', token: -1, test: true, src: s.path, href: pathToFileURL(s.path).href, start, clipStart: start, clipEnd: start + 8, autoplay: true, volume: engine.settings.volume, title: s.displayTitle || s.title, artist: s.artist });
    if (audienceReady) send(); else ipcMain.once('audience:ready-once', send);
    return { title: s.title, artist: s.artist };
  },
  'displays:list': () => screen.getAllDisplays().map(d => ({ id: d.id, label: d.label || `Display ${d.id}`, width: d.size.width, height: d.size.height, primary: d.id === screen.getPrimaryDisplay().id })),

  /* app updates */
  'update:status': () => (updater ? updater.status : { state: 'disabled' }),
  'update:check': () => updater.check(true),
  'update:download': () => updater.download(),
  'update:install': ({ force }) => updater.install(!!force),
  'update:openPage': () => { shell.openExternal(updater && updater.status.url || RELEASES_URL); return true; },

  /* audio levelling */
  'audio:status': () => (analyser ? analyser.status() : { available: false }),
  'audio:pause': () => { if (!analyser) return { available: false }; analyser.setPaused(true); return analyser.status(); },
  'audio:resume': () => { if (!analyser) return { available: false }; analyser.setPaused(false); return analyser.status(); },
  'audio:reanalyse': ({ ids }) => { if (!analyser) return { available: false }; analyser.reanalyse(ids || library.songs().map(s => s.id)); return analyser.status(); },

  /* backup & restore */
  'backup:estimate': ({ id, includeMedia }) => backup.estimate(getGameObj(id), !!includeMedia),
  'backup:create': async ({ id, includeMedia, password, file, overwrite }) => {
    const g = getGameObj(id);
    if (engine && engine.game.id === id) store.flush();
    if (!file) {
      const r = await dialog.showSaveDialog(hostWin, { title: 'Save game backup', defaultPath: `${g.name.replace(/[^\w -]/g, '')}-${g.date}${includeMedia ? '-full' : ''}.cmbbackup`, filters: [{ name: 'Anthem Square backup', extensions: ['cmbbackup'] }] });
      if (r.canceled) return null; file = r.filePath; overwrite = true; // the system dialog already asked about overwriting
    }
    if (fs.existsSync(file) && !overwrite) throw new Error('A file with that name already exists.');
    return backup.createBackup(JSON.parse(JSON.stringify(g)), { file, includeMedia: !!includeMedia, password: password || null, appVersion: app.getVersion(), onProgress: (p) => sendHost('backup-progress', p) });
  },
  'backup:pickFile': async () => {
    const r = await dialog.showOpenDialog(hostWin, { title: 'Choose an Anthem Square backup', properties: ['openFile'], filters: [{ name: 'Anthem Square backup', extensions: ['cmbbackup'] }] });
    return r.canceled ? null : r.filePaths[0];
  },
  'backup:inspect': async ({ file, password }) => {
    const info = await backup.inspectBackup(file, { password, tmpDir: path.join(DATA_DIR, 'tmp') });
    if (info && info.manifest) info.exists = !!readGame(info.manifest.gameId);
    return info;
  },
  'backup:pickFolder': async () => { const r = await dialog.showOpenDialog(hostWin, { title: 'Where should the restored videos be stored?', properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; },
  'backup:restore': async ({ file, password, mode, mediaDir }) => {
    const res = await backup.restoreBackup(file, {
      password, mode, mediaDir, tmpDir: path.join(DATA_DIR, 'tmp'),
      exists: (gid) => !!readGame(gid),
      save: (game) => store.writeNow('games/' + game.id, game),
      onProgress: (p) => sendHost('backup-progress', p)
    });
    return res;
  },

  /* remote */
  'players:join': async () => { const j = await refreshJoin(); return { enabled: phoneCardsOn(), running: !!(remote && remote.running), url: j && j.url, qr: j && j.qr, online: remote ? remote.onlinePlayers() : [] }; },
  'players:setOpen': ({ open }) => dispatch('setPlayersOpen', { open }, 'laptop'),
  'players:remove': ({ playerId }) => dispatch('playerRemove', { playerId }, 'laptop'),
  'players:rename': ({ playerId, name }) => dispatch('playerRename', { playerId, name }, 'laptop'),
  /* winning rules (v1.5) */
  'rules:catalogue': () => rules.catalogue(),
  'rules:info': ({ rules: list, round }) => rules.roundInfo({ round: Number(round) || 1, rules: list }),
  'rules:checklistInfo': ({ items }) => normaliseChecklist(items || settings.gameDefaults.checklist).map(it => Object.assign({ id: it.id, spec: it.rule }, rules.roundInfo({ round: 0, rules: [it.rule] }))),
  'rules:roundsInfo': ({ rounds, count }) => { const c = count || settings.gameDefaults.roundCount || 3; const r = validRounds(rounds || settings.gameDefaults.rounds, c); const out = {}; Object.keys(r).forEach(n => { out[n] = rules.roundInfo({ round: Number(n), rules: r[n] }); }); return out; },
  'remote:info': async () => remoteInfo(),
  'remote:start': async () => { if (!remote) createRemote(); await remote.start(); return remoteInfo(); },
  'remote:stop': async () => { if (remote) await remote.stop(); return remoteInfo(); },
  'remote:newPin': async () => { remote.regeneratePin(); return remoteInfo(); },
  'remote:revoke': async ({ deviceId }) => { remote.revoke(deviceId); return remoteInfo(); },
  'remote:setSecure': async ({ secure }) => { settings.remote.secure = !!secure; saveSettings(); if (remote) await remote.stop(); createRemote(); await remote.start(); return remoteInfo(); },
  'remote:setPort': async ({ port }) => {
    port = Number(port); if (!(port >= 1024 && port <= 65535)) throw new Error('Port must be between 1024 and 65535');
    settings.remote.port = port; saveSettings();
    if (remote) await remote.stop();
    createRemote(); await remote.start(); return remoteInfo();
  },

  /* audience-window → main */
  'player:ready': () => { audienceReady = true; lastTvJson = null; ipcMain.emit('audience:ready-once'); if (engine) engine.playerReady(); return { appSettings: audienceAppSettings(), state: engine ? audienceStateWithJoin() : null }; },
  'mirror:ready': (p, e) => {
    // joining mid-song: give the second screen the current song at the main TV's position
    setTimeout(() => { try { if (!engine || !e || e.sender.isDestroyed()) return; const pb = engine.game.playback; if (pb.index >= 0 && ['playing', 'loading', 'paused'].includes(pb.status)) e.sender.send('player', engine.loadCmd(pb.index, pb.position || 0, pb.status !== 'paused')); } catch (err) { /* */ } }, 250);
    return { appSettings: audienceAppSettings(), state: engine ? audienceStateWithJoin() : null };
  },
  'audience:openMirror': ({ displayId } = {}) => openMirrorWindow(displayId),
  'audience:closeMirror': () => { if (mirrorWin && !mirrorWin.isDestroyed()) mirrorWin.close(); return { open: false }; },
  'audience:mirrorStatus': () => mirrorStatus(),
  'player:started': ({ token }) => { if (engine) engine.playerStarted(token); return true; },
  'player:time': ({ token, t }) => { if (engine) engine.playerTime(token, t); return true; },
  'player:ended': ({ token }) => { if (engine) engine.playerEnded(token); return true; },
  'player:error': ({ token, message }) => { if (engine) engine.playerError(token, message); return true; },
  'audience:audioDevice': ({ deviceId }) => { settings.video.audioDeviceId = deviceId; saveSettings(); sendAudience('app-settings', audienceAppSettings()); return true; }
};

function audienceAppSettings() {
  const sl = settings.slides || {};
  return { logo: settings.appearance.logo ? pathToFileURL(settings.appearance.logo).href : null, aspect: settings.video.aspect, audioDeviceId: settings.video.audioDeviceId, lowResource: lowRes(),
    youtube: { embedBase: (IS_TEST && process.env.CMB_YT_EMBED) || 'https://www.youtube-nocookie.com/embed/' },
    slides: { enabled: sl.enabled !== false, seconds: Math.max(3, Math.min(60, Number(sl.seconds) || 8)), images: (sl.images || []).filter(i => fs.existsSync(i.file)).map(i => pathToFileURL(i.file).href) } };
}

/**
 * Open File Explorer at a file and highlight it (Electron's native shell.showItemInFolder).
 * Handles missing/moved files, unplugged USB/network drives, spaces, Unicode and bad paths
 * by checking first and reporting clearly instead of silently doing nothing.
 * Returns { ok, reason?, message?, openedFolder? }.
 */
function showInFolder(p) {
  if (!p || typeof p !== 'string' || p.includes('\0')) return { ok: false, reason: 'invalid', message: 'No valid file location is stored for this item.' };
  let full;
  try { full = path.resolve(path.normalize(p)); } catch (e) { return { ok: false, reason: 'invalid', message: 'The stored file location is not a valid path.' }; }
  let st = null;
  try { st = fs.statSync(full); } catch (e) {
    if (e.code === 'EACCES' || e.code === 'EPERM') return { ok: false, reason: 'permission', message: 'Windows did not allow access to this location (permissions).' };
  }
  if (st) { shell.showItemInFolder(full); return { ok: true, path: full }; }
  // file gone: open the nearest folder that still exists (USB/network drive may be unplugged)
  let dir = path.dirname(full); let opened = null;
  for (let i = 0; i < 6 && dir && dir !== path.dirname(dir); i++) { try { if (fs.statSync(dir).isDirectory()) { opened = dir; break; } } catch (e) { /* keep walking up */ } dir = path.dirname(dir); }
  const root = path.parse(full).root; const driveGone = !opened || opened === root;
  if (opened && !driveGone) shell.openPath(opened);
  return { ok: false, reason: 'missing', path: full, openedFolder: driveGone ? null : opened,
    message: driveGone ? `The drive or network location (${root || full}) is not available — plug the drive in or reconnect, then try again.` : 'The file has been moved, renamed or deleted. Its old folder has been opened.' };
}

function summariseValidation(v) { return { total: v.total, uniquePlayable: v.uniquePlayable, needed: v.needed, ok: v.ok, problems: v.problems }; }

/** Library relink → update the active game only when it is provably the same video. */
function relinkInGames(song) {
  if (!engine) return;
  const gs = engine.game.songs[song.id];
  if (!gs || gs.path === song.path) return;
  if (!gs.fingerprint || gs.fingerprint === song.fingerprint) { gs.path = song.path; saveGame(engine.game); scanGameMedia(); onEngineChanged('state'); }
}

async function remoteInfo() {
  if (!remote) return { running: false };
  const info = remote.info();
  const qrUrl = (settings.remote.secure !== false && info.secureUrl) ? info.secureUrl : info.url;
  info.qrUrl = qrUrl; info.secureMode = qrUrl === info.secureUrl;
  info.qr = await QRCode.toDataURL(qrUrl + '#pin=' + info.pin, { margin: 1, width: 320, color: { dark: '#1a1033', light: '#ffffff' } });
  if (info.secureUrl) info.plainQr = await QRCode.toDataURL(info.url + '#pin=' + info.pin, { margin: 1, width: 200, color: { dark: '#1a1033', light: '#ffffff' } });
  return info;
}

/**
 * This laptop's own HTTPS certificate for the phone remote (enables live camera QR
 * scanning, which browsers only allow on secure pages). Generated once and kept, so a
 * phone only has to accept it once; regenerated if the laptop gets a new network address.
 */
function remoteTls() {
  if (settings.remote.secure === false) return null;
  const { localAddresses } = require('./remote');
  const ips = localAddresses().map(a => a.address).concat(['127.0.0.1']).sort();
  const f = path.join(DATA_DIR, 'remote-cert.json');
  let c = null; try { c = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { /* none yet */ }
  if (c && c.key && c.cert && ips.every(ip => (c.ips || []).includes(ip))) return c;
  try {
    const selfsigned = require('selfsigned');
    const allIps = Array.from(new Set(ips.concat((c && c.ips) || [])));
    const pems = selfsigned.generate([{ name: 'commonName', value: 'Anthem Square (this laptop)' }, { name: 'organizationName', value: 'Anthem Square' }], {
      keySize: 2048, days: 3650, algorithm: 'sha256',
      extensions: [{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }, { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames: allIps.map(ip => ({ type: 7, ip })).concat([{ type: 2, value: 'localhost' }, { type: 2, value: require('os').hostname() }]) }]
    });
    c = { key: pems.private, cert: pems.cert, fingerprint: pems.fingerprint, ips: allIps, createdAt: new Date().toISOString() };
    fs.writeFileSync(f + '.tmp', JSON.stringify(c)); fs.renameSync(f + '.tmp', f);
    return c;
  } catch (e) { console.error('TLS certificate', e); return null; }
}

/* ======================================================================= home play: phone cards */
let joinCache = null;
function phoneCardsOn() { return !!(settings.home && settings.home.phoneCards); }
/** Plain http link (no certificate warning — players never need the camera). */
async function refreshJoin() {
  const was = joinCache && joinCache.url;
  if (!remote || !remote.running) joinCache = null;
  else {
    const url = remote.info().url + 'play';
    if (!joinCache || joinCache.url !== url) joinCache = { url, qr: await QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#1a1033', light: '#ffffff' } }) };
  }
  if ((joinCache && joinCache.url) !== was && engine) sendAudience('audience-state', audienceStateWithJoin());
  return joinCache;
}
function audienceStateWithJoin() {
  const st = engine.audienceState();
  if (st.screen && st.screen.mode === 'welcome' && joinCache && phoneCardsOn() && settings.home.joinOnTv !== false && engine.game.playersOpen !== false) st.screen.join = { url: joinCache.url, qr: joinCache.qr };
  // lobby: who has joined on their phone (names only)
  if (st.screen && st.screen.mode === 'welcome' && phoneCardsOn()) st.screen.players = engine.game.players.filter(p => !p.removed).map(p => p.name);
  return st;
}
function playersInfo() {
  const g = engine && engine.game;
  return { enabled: phoneCardsOn() && !!g, open: !!g && g.playersOpen !== false && g.status !== 'finished', gameName: g ? g.name : null, gameId: g ? g.id : null };
}
const playerHooks = {
  info: () => playersInfo(),
  join: async (name) => {
    const i = playersInfo();
    if (!i.enabled) throw new Error('There is no game to join right now.');
    if (!i.open) throw new Error('Joining is closed for this game — ask the host.');
    const token = require('crypto').randomBytes(24).toString('hex');
    const r = await dispatch('playerJoin', { name, tokenHash: require('crypto').createHash('sha256').update(token).digest('hex') }, 'phone-player');
    return { token, playerId: r.playerId };
  },
  auth: (token) => {
    if (!phoneCardsOn()) return { ok: false, reason: 'Phone cards are switched off.' };
    if (!engine || !token) return { ok: false, reason: 'No game is running.' };
    const h = require('crypto').createHash('sha256').update(token).digest('hex');
    const p = engine.game.players.find(x => x.tokenHash === h && !x.removed);
    return p ? { ok: true, playerId: p.id } : { ok: false, reason: 'not-in-game' };
  },
  view: (id) => !phoneCardsOn() ? { wait: 'Phone cards are switched off on the laptop.' } : !engine ? { wait: 'The host has no game open right now — it will come back automatically.' } : withTheme(engine.playerView(id)),
  bingo: async (id) => {
    const p = engine && engine.playerById(id);
    if (!p) throw new Error('You are no longer in this game.');
    return dispatch('playerBingo', { playerId: id }, 'player:' + p.name);
  }
};

function createRemote() {
  const tls = remoteTls();
  remote = new RemoteServer({
    port: settings.remote.port,
    tls: tls ? { key: tls.key, cert: tls.cert } : null,
    httpsPort: settings.remote.port + 1,
    staticDir: path.join(__dirname, '..', 'remote-web'),
    extraFiles: {
      '/jsqr.js': require.resolve('jsqr/dist/jsQR.js'),
      '/shared/patterns.js': path.join(RENDERER, 'shared', 'patterns.js'),
      '/icon.png': path.join(ROOT, 'assets', 'icon.png'),
      '/brand/icon.svg': path.join(RENDERER, 'shared', 'brand', 'icon.svg')
    },
    mounts: { '/fonts/': path.join(RENDERER, 'shared', 'fonts') },
    players: playerHooks,
    flush: () => { if (flushQueued) flushEngineChanges(); },
    getState: () => remoteState(),
    dispatch: (action, args, source) => dispatch(action, args, source),
    devices: { list: () => settings.remote.devices, save: (list) => { settings.remote.devices = list; saveSettings(); } },
    onChange: async () => { await refreshJoin(); sendHost('remote', await remoteInfo()); }
  });
}

function preflight() {
  const checks = [];
  const add = (key, label, ok, detail, warn) => checks.push({ key, label, ok: !!ok, warn: !!warn && !ok, detail });
  if (!engine) return { checks: [{ key: 'game', label: 'Game loaded', ok: false, detail: 'Create or open a game first.' }] };
  const g = engine.game;
  const missing = Object.values(g.songs).filter(s => s.source !== 'youtube' && !fs.existsSync(s.path));
  const ytSongs = Object.values(g.songs).filter(s => s.source === 'youtube');
  if (ytSongs.length) add('youtube', 'YouTube songs (Beta)', net.isOnline(), `${ytSongs.length} song(s) play from YouTube — ${net.isOnline() ? 'internet connected. Adverts may play; volume levelling does not apply to them.' : 'NO internet connection: they will be skipped.'}`, true);
  add('songs', 'Playlist size', g.order.length >= cardsLib.MIN_SONGS, `${g.order.length} unique songs (minimum ${cardsLib.MIN_SONGS})`);
  add('media', 'Media files', missing.length === 0, missing.length ? `${missing.length} file(s) missing: ${missing.slice(0, 3).map(s => s.title).join(', ')} — use “Relink videos” (the printed song identity never changes)` : 'All video files found');
  const lib = library.songs().filter(s => g.songs[s.id]);
  const bad = lib.filter(s => s.status === 'unsupported');
  add('codecs', 'Playable formats', bad.length === 0, bad.length ? `${bad.length} song(s) flagged unsupported` : 'All videos passed the playback check');
  const problems = cardsLib.validateCards(g.cards, g.order);
  add('cards', 'Bingo cards', g.cards.length > 0 && problems.length === 0, g.cards.length ? (problems.length ? problems.slice(0, 2).join('; ') : `${g.cards.length} unique cards saved (${g.cards.filter(c => c.printed).length} printed)`) : 'No cards generated yet');
  add('printed', 'Cards printed', g.cards.some(c => c.printed), g.cards.some(c => c.printed) ? 'Cards have been printed / exported' : 'No cards marked as printed yet', true);
  // Verification self-test against the real rules engine
  const fake = Array.from({ length: 25 }, (_, i) => 'x' + i);
  const t1 = rules.checkCard(fake, new Set(fake.slice(10, 15)), 1).valid;
  const t2 = !rules.checkCard(fake, new Set(['x0', 'x6', 'x12', 'x18', 'x24']), 1).valid;
  const t3 = !rules.checkCard(fake, new Set([...fake.slice(0, 5), 'x5', 'x10', 'x15', 'x20']), 2).valid;
  add('lock', 'Card lock', true, g.cardsLocked ? `LOCKED / ISSUED${g.lockedAt ? ' on ' + new Date(g.lockedAt).toLocaleString() : ''} — cards can never change` : 'DRAFT — cards lock automatically when you export the final PDF or print', true);
  const lockProblems = locking.verifyLock(g);
  if (lockProblems.length) add('lockcheck', 'Locked snapshot', false, lockProblems.join(' '));
  const st = analyser ? analyser.status() : { available: false };
  const gSongs = library.songs().filter(s => g.songs[s.id]);
  const analysed = gSongs.filter(s => s.audio && s.audio.status === 'done').length;
  add('audio', 'Volume levelling', !g.settings.audio.levelling || (st.available && analysed === gSongs.length), !g.settings.audio.levelling ? 'Automatic levelling is OFF' : (!st.available ? 'ffmpeg not found — songs will play at their original volume' : `${analysed}/${gSongs.length} songs analysed${analysed < gSongs.length ? ' (analysis continues in the background)' : ''}`), true);
  add('verify', 'Winner verification', t1 && t2 && t3, 'Rules self-test: line valid, diagonal rejected, row+column rejected');
  const aud = !!(audienceWin && !audienceWin.isDestroyed());
  add('audience', 'Audience window', aud && audienceReady, aud ? (audienceWin.isFullScreen() ? 'Open and fullscreen' : 'Open (press F to go fullscreen on the TV)') : 'Not open — click "Open audience window"');
  const displays = screen.getAllDisplays();
  add('tv', 'TV / projector', displays.length > 1, displays.length > 1 ? `${displays.length} displays detected` : 'Only one display detected — connect the TV (HDMI) and set Windows to "Extend"', true);
  add('overlay', 'Song overlay', g.settings.overlay.enabled, g.settings.overlay.enabled ? `Title/artist overlay on (${g.settings.overlay.position})` : 'Overlay is turned off', true);
  add('crawler', 'Song-history crawler', !g.settings.crawler.paused, `Speed ${g.settings.crawler.speed}/10, ${g.settings.crawler.fontSize}px text${g.settings.crawler.paused ? ' — currently paused' : ''}`, true);
  const ri = remote ? remote.info() : { running: false, connected: [] };
  add('remote', 'Mobile remote', ri.running && ri.connected.length > 0, ri.running ? (ri.connected.length ? `${ri.connected.length} phone(s) connected` : `Service running at ${ri.url} — no phone connected yet`) : 'Remote service is not running', true);
  return { checks };
}

/* ---- portable self-update: download next to the EXE, verify, swap in after the app closes */
function portableExe() { return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath; }
async function downloadPortableUpdate(asset, onProgress) {
  const dir = path.dirname(portableExe());
  const tmp = path.join(dir, '.anthem-square-update.download'); const done = path.join(dir, '.anthem-square-update.exe');
  const res = await net.fetch(asset.url, { headers: { 'User-Agent': 'Anthem-Square-Updater' } });
  if (!res.ok || !res.body) throw new Error('The download could not start (' + res.status + '). Check the internet connection and try again.');
  const total = Number(res.headers.get('content-length')) || asset.size || 0;
  const hash = require('crypto').createHash('sha256');
  const out = fs.createWriteStream(tmp); let got = 0, lastPct = -1;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done: end, value } = await reader.read(); if (end) break;
      const buf = Buffer.from(value); hash.update(buf); got += buf.length;
      if (!out.write(buf)) await new Promise(r => out.once('drain', r));
      const pct = total ? Math.min(99, Math.floor(got / total * 100)) : 0; if (pct !== lastPct) { lastPct = pct; onProgress(pct); }
    }
  } catch (e) { out.destroy(); try { fs.unlinkSync(tmp); } catch (x) { /* */ } throw new Error('The download was interrupted. Try again when the connection is stable.'); }
  await new Promise((r, j) => out.end(err => (err ? j(err) : r())));
  if (asset.size && got !== asset.size) { try { fs.unlinkSync(tmp); } catch (x) { /* */ } throw new Error('The download was incomplete. Please try again.'); }
  if (asset.digest && /^sha256:/i.test(asset.digest) && asset.digest.slice(7).toLowerCase() !== hash.digest('hex')) { try { fs.unlinkSync(tmp); } catch (x) { /* */ } throw new Error('The downloaded file did not pass its safety check. Please try again.'); }
  try { fs.unlinkSync(done); } catch (x) { /* */ }
  fs.renameSync(tmp, done);
  return done;
}
/** A tiny helper waits for the app (and the portable launcher) to close, swaps the EXE in place, then reopens it. */
function installPortableUpdate(file, relaunch) {
  const exe = portableExe();
  const helper = path.join(os.tmpdir(), 'anthem-square-update-' + Date.now() + '.cmd');
  const script = ['@echo off', 'setlocal', 'set "OLD=%~1"', 'set "NEW=%~2"', 'set n=0',
    ':move', 'timeout /t 1 /nobreak >nul', 'move /Y "%NEW%" "%OLD%" >nul 2>&1', 'if not errorlevel 1 goto moved',
    'set /a n+=1', 'if %n% geq 90 goto done', 'goto move',
    ':moved', relaunch ? 'start "" "%OLD%"' : 'rem no relaunch', ':done', '(goto) 2>nul & del "%~f0"'].join('\r\n') + '\r\n';
  fs.writeFileSync(helper, script);
  if (IS_TEST) { global.__updateInstall = { helper, exe, file, relaunch, script }; return; } // tests: inspect, don't quit
  require('child_process').spawn('cmd.exe', ['/c', helper, exe, file], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  if (relaunch) { app.isQuiting = true; app.quit(); }
}

/* App updates — optional; offline simply means "nothing to report". */
function createUpdater() {
  const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
  let mode = (IS_TEST && process.env.CMB_UPDATE_MODE) || process.env.CMB_UPDATE_MODE || (!app.isPackaged ? 'disabled' : isPortable ? 'portable' : process.platform === 'win32' ? 'installer' : 'disabled');
  let autoUpdater = null;
  if (mode === 'installer') { try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { mode = 'disabled'; } }
  const u = new UpdateManager({
    currentVersion: app.getVersion(), mode, autoUpdater,
    fetchLatest: async () => {
      const { net } = require('electron');
      const api = (IS_TEST && process.env.CMB_UPDATE_API) || `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/releases/latest`;
      const r = await net.fetch(api, { headers: { 'User-Agent': 'Anthem-Square-Updater', Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      return { version: j.tag_name, url: j.html_url, assets: (j.assets || []).map(a => ({ name: a.name, url: a.browser_download_url, size: a.size, digest: a.digest || null })) };
    },
    canSelfUpdate: () => { try { fs.accessSync(path.dirname(portableExe()), fs.constants.W_OK); return true; } catch (e) { return false; } },
    downloadPortable: (asset, onProgress) => downloadPortableUpdate(asset, onProgress),
    installPortable: (file, relaunch) => installPortableUpdate(file, relaunch),
    isGameLive: () => !!(engine && engine.game.status === 'live'),
    isGamePlaying: () => !!(engine && ['playing', 'loading', 'between'].includes(engine.game.playback.status)),
    beforeInstall: () => { app.isQuiting = true; try { store.flush(); settings.cleanShutdown = true; store.writeNow('settings', settings); } catch (e) { /* */ } },
    onChange: (st) => sendHost('update', st)
  });
  u.start(settings.updates.auto !== false);
  return u;
}

ipcMain.handle('invoke', async (e, channel, payload) => {
  const h = handlers[channel];
  if (!h) throw new Error('Unknown request: ' + channel);
  if (mirrorWin && !mirrorWin.isDestroyed() && e.sender === mirrorWin.webContents && /^player:/.test(channel)) return true; // the second screen never drives the game
  try { return await h(payload || {}, e); }
  finally { if (flushQueued) flushEngineChanges(); } // windows get the new state before the reply
});
ipcMain.on('print:ready', (e, info) => ipcMain.emit('print:ready:' + e.sender.id, e, info));
ipcMain.on('player:time-sync', (e, d) => {
  if (mirrorWin && e.sender === mirrorWin.webContents) return;
  if (engine) engine.playerTime(d.token, d.t);
  if (mirrorWin && !mirrorWin.isDestroyed()) mirrorWin.webContents.send('mirror-sync', d); // keep the second screen in step
});

/* ======================================================================= lifecycle */
const gotLock = IS_TEST ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (hostWin) { if (hostWin.isMinimized()) hostWin.restore(); hostWin.focus(); } });

  function youtubeReferrer() {
  try {
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/embed/*', 'https://www.youtube.com/embed/*'] }, (d, cb) => {
      if (!d.requestHeaders.Referer) d.requestHeaders.Referer = 'https://anthemsquare.app/';
      cb({ requestHeaders: d.requestHeaders });
    });
  } catch (e) { /* not critical */ }
}
app.whenReady().then(async () => {
  youtubeReferrer();
    Menu.setApplicationMenu(null);
    store = new Store(DATA_DIR);
    settings = loadSettings();
    library = new Library(store);
    library.checkFiles();
    updater = createUpdater();
    converter = new Converter({ dataDir: DATA_DIR, library, ffmpeg: require('./audio').findFfmpeg(process.resourcesPath), isAuto: () => settings.library.autoConvert !== false,
      hold: () => !!(engine && engine.game.status === 'live' && (lowRes() || ['playing', 'loading'].includes(engine.game.playback.status))), // TV video first
      onChange: () => { library.songs().forEach(s => { if (s.converted) relinkInGames(s); }); sendHost('library-convert', converter.status()); } });
    try { analyser = new AudioAnalyser({ dataDir: DATA_DIR, library, resourcesPath: process.resourcesPath, onChange: () => sendHost('library-audio', analyser.status()) }); }
    catch (e) { analyser = null; console.error('Volume analysis unavailable:', e); } // the app must always open; levelling just stays off
    // Crash detection: cleanShutdown is cleared while running and set on normal exit.
    const lastGame = settings.lastGameId ? readGame(settings.lastGameId) : null;
    if (lastGame && lastGame.status !== 'finished') {
      recoveryInfo = { gameId: lastGame.id, name: lastGame.name, crashed: settings.cleanShutdown === false, played: (lastGame.played || []).length, round: lastGame.round ? lastGame.round.number : 0, updatedAt: lastGame.updatedAt };
    }
    settings.cleanShutdown = false; store.writeNow('settings', settings);
    createHostWindow();
    createRemote();
    if (settings.remote.autoStart && !process.env.CMB_NO_REMOTE) remote.start();
  });

  app.on('before-quit', () => {
    app.isQuiting = true;
    if (updater && updater.onQuit) updater.onQuit(); // portable: a downloaded update is swapped in after closing
    try { if (store) { store.flush(); settings.cleanShutdown = true; store.writeNow('settings', settings); } } catch (e) { /* */ }
  });
  app.on('window-all-closed', () => app.quit());
}

// Expose for e2e tests
global.__cmb = { get updater() { return updater; }, get engine() { return engine; }, get settings() { return settings; }, get remote() { return remote; }, handlers, dispatch, store: () => store };
