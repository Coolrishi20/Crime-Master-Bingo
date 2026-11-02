'use strict';
const { app, BrowserWindow, ipcMain, dialog, screen, shell, Menu, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const QRCode = require('qrcode');

const { Store } = require('./store');
const { Library } = require('./library');
const { RemoteServer } = require('./remote');
const { GameEngine, createGame, defaultGameSettings } = require('../core/engine');
const cardsLib = require('../core/cards');
const rules = require('../core/rules');
const locking = require('../core/locking');
const { AudioAnalyser } = require('./audio');
const backup = require('./backup');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(__dirname, '..', 'renderer');
const DATA_DIR = process.env.CMB_DATA_DIR || path.join(app.getPath('userData'), 'data');
const IS_TEST = !!process.env.CMB_TEST;

if (process.env.CMB_NO_SANDBOX) app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let store, library, settings, remote, analyser;
let hostWin = null, audienceWin = null, previewWin = null;
let engine = null;          // engine for the active game
let powerBlock = null;
let recoveryInfo = null;

/* ======================================================================= settings */
function defaultSettings() {
  return {
    appearance: { logo: null, scale: 1, theme: 'crime-master' },
    video: { displayId: null, fullscreen: true, aspect: 'contain', audioDeviceId: 'default' },
    gameDefaults: defaultGameSettings(),
    cards: { textScale: 1, qr: true, bw: false, useLogo: true, showArtist: true, cutLines: true },
    remote: { port: 8787, autoStart: true, devices: [] },
    lastGameId: null,
    cleanShutdown: true
  };
}
function loadSettings() {
  const d = defaultSettings();
  const s = store.read('settings', d);
  const merged = Object.assign({}, d, s);
  ['appearance', 'video', 'cards', 'remote'].forEach(k => { merged[k] = Object.assign({}, d[k], s[k] || {}); });
  merged.gameDefaults = Object.assign(defaultGameSettings(), s.gameDefaults || {});
  merged.gameDefaults.overlay = Object.assign(defaultGameSettings().overlay, (s.gameDefaults || {}).overlay || {});
  merged.gameDefaults.crawler = Object.assign(defaultGameSettings().crawler, (s.gameDefaults || {}).crawler || {});
  merged.gameDefaults.audio = Object.assign(defaultGameSettings().audio, (s.gameDefaults || {}).audio || {});
  return merged;
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
    round: g.round ? g.round.number : 0, roundStatus: g.round ? g.round.status : 'pending', cardsLocked: !!g.cardsLocked,
    winners: winners.map(w => ({ cardNo: w.cardNo, round: w.round })), playlistName: g.playlistName
  };
}

let tickTimer = null, remoteTickTimer = null;
function activateGame(game) {
  if (engine && engine.game.id !== game.id) { store.flush(); }
  engine = new GameEngine(game, {
    persist: (g, urgent) => saveGame(g, urgent),
    changed: (kind) => onEngineChanged(kind),
    player: (cmd) => { if (cmd.src) cmd.href = pathToFileURL(cmd.src).href; sendAudience('player', cmd); },
    event: (name, payload) => {
      if (name === 'celebrate' || name === 'tvScreen') sendAudience('event', { name, payload });
      sendHost('event', { name, payload });
      if (remote) remote.broadcast({ type: 'event', name, payload });
    },
    tick: () => onTick(),
    gainFor: (song, clip, audio) => (analyser ? analyser.gain(song, clip, audio) : { gainDb: 0, status: 'pending' })
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
  const map = {};
  Object.values(engine.game.songs).forEach(s => {
    if (!s.path || !fs.existsSync(s.path)) map[s.id] = 'Video file missing — relink it or grant Technical Credit';
    else { const l = library.get(s.id); if (l && l.status === 'unsupported') map[s.id] = 'Video cannot be played: ' + (l.statusNote || 'unsupported'); }
  });
  const before = JSON.stringify(engine.hostState().unavailable);
  engine.setUnavailable(map);
  if (JSON.stringify(engine.hostState().unavailable) !== before) onEngineChanged('state');
}
setInterval(() => { try { scanGameMedia(); } catch (e) { /* */ } }, 20000);

function onTick() {
  if (!tickTimer) tickTimer = setTimeout(() => { tickTimer = null; if (engine) sendHost('tick', { position: engine.game.playback.position, index: engine.game.playback.index, status: engine.game.playback.status }); }, 250);
  if (!remoteTickTimer) remoteTickTimer = setTimeout(() => {
    remoteTickTimer = null;
    if (engine && remote) remote.broadcast({ type: 'tick', position: engine.game.playback.position, index: engine.game.playback.index, status: engine.game.playback.status });
    // light persistence of the playback position (non-urgent, coalesced)
    if (engine) saveGame(engine.game, false);
  }, 1000);
}

/** Host-only readiness details for Up Next (thumbnail, file present, levelling analysed). */
function enrichUpNext(st, forPhone) {
  const n = st.upNext && st.upNext.next;
  if (!n) return st;
  const gs = engine.game.songs[n.songId];
  const lib = library.get(n.songId);
  const exists = !!(gs && gs.path && fs.existsSync(gs.path));
  n.fileFound = exists;
  if (!exists) { n.ready = false; n.problem = n.problem || 'Video file missing — relink it before it is due'; }
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

function remoteState() {
  if (!engine) return { game: null };
  const st = enrichUpNext(engine.hostState(), true);
  st.audienceConnected = engine.audienceConnected;
  st.eligible = engine.eligibleSongs();
  return { game: st };
}

function onEngineChanged(kind) {
  if (!engine) return;
  sendHost('state', fullHostState());
  if (kind !== 'tickOnly') sendAudience('audience-state', engine.audienceState());
  if (remote) remote.broadcastState();
  // keep the laptop awake while a game is live
  const live = engine.game.status === 'live';
  if (live && powerBlock === null) powerBlock = powerSaveBlocker.start('prevent-display-sleep');
  if (!live && powerBlock !== null) { powerSaveBlocker.stop(powerBlock); powerBlock = null; }
}

function sendHost(ch, data) { if (hostWin && !hostWin.isDestroyed()) hostWin.webContents.send(ch, data); }
function sendAudience(ch, data) { if (audienceWin && !audienceWin.isDestroyed()) audienceWin.webContents.send(ch, data); }

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
    backgroundColor: '#1a1033', title: 'Crime Master Bingo', show: false,
    icon: path.join(ROOT, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  hostWin.loadFile(path.join(RENDERER, 'host', 'index.html'));
  hostWin.once('ready-to-show', () => { if (!IS_TEST || process.env.CMB_SHOW) hostWin.show(); if (!IS_TEST) hostWin.maximize(); });
  hostWin.on('close', (e) => {
    if (IS_TEST || app.isQuiting) return;
    if (engine && engine.game.status === 'live') {
      const r = dialog.showMessageBoxSync(hostWin, { type: 'question', buttons: ['Cancel', 'Save & Quit'], defaultId: 0, cancelId: 0, title: 'Quit Crime Master Bingo?', message: 'A game is in progress.', detail: 'Everything is saved — you can resume this game next time you open Crime Master Bingo.' });
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
    backgroundColor: '#0f091e', title: 'Crime Master Bingo — Audience', autoHideMenuBar: true, show: false,
    icon: path.join(ROOT, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
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
    rounds: [1, 2, 3].map(n => ({ n, label: rules.ROUNDS[n].label, short: rules.ROUNDS[n].short, pattern: rules.patternExamples(n)[0] })),
    locked: !!game.cardsLocked,
    opts: { qr: !!cardOpts.qr, bw: !!cardOpts.bw, useLogo: !!cardOpts.useLogo, textScale: Number(cardOpts.textScale) || 1, showArtist: cardOpts.showArtist !== false, cutLines: cardOpts.cutLines !== false }
  };
  return { job, list };
}

async function renderPrintJob(game, opts, mode) {
  const { job, list } = await buildPrintJob(game, opts);
  const win = new BrowserWindow({ show: mode === 'print' && false, width: 794, height: 1123, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false } });
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
  'app:info': () => ({ version: app.getVersion(), dataDir: DATA_DIR, recovery: recoveryInfo, platform: process.platform, isTest: IS_TEST }),
  'settings:get': () => settings,
  'settings:update': (patch) => {
    ['appearance', 'video', 'cards', 'remote'].forEach(k => { if (patch[k]) Object.assign(settings[k], patch[k]); });
    if (patch.gameDefaults) {
      const gd = patch.gameDefaults;
      if (gd.overlay) Object.assign(settings.gameDefaults.overlay, gd.overlay);
      if (gd.crawler) Object.assign(settings.gameDefaults.crawler, gd.crawler);
      if (gd.audio) settings.gameDefaults.audio = Object.assign({}, settings.gameDefaults.audio || {}, gd.audio);
      Object.keys(gd).forEach(k => { if (!['overlay', 'crawler', 'audio'].includes(k)) settings.gameDefaults[k] = gd[k]; });
    }
    saveSettings();
    sendAudience('app-settings', audienceAppSettings());
    return settings;
  },
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
    const r = await dialog.showOpenDialog(hostWin, { title: 'Import music videos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Music videos', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv'] }, { name: 'All files', extensions: ['*'] }] });
    return r.canceled ? null : library.importPaths(r.filePaths);
  },
  'library:pickFolder': async () => {
    const r = await dialog.showOpenDialog(hostWin, { title: 'Import a folder of music videos', properties: ['openDirectory'] });
    return r.canceled ? null : library.importPaths(r.filePaths);
  },
  'library:importPaths': (paths) => library.importPaths(paths),
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
  'games:create': (opts) => {
    const v = library.validatePlaylist(opts.playlistId);
    if (!v.ok) throw new Error(`This playlist has ${v.uniquePlayable} playable unique songs. Add ${v.needed} more song${v.needed === 1 ? '' : 's'} (minimum 40).`);
    const gs = JSON.parse(JSON.stringify(settings.gameDefaults));
    if (opts.settings) Object.keys(opts.settings).forEach(k => { if (typeof opts.settings[k] === 'object' && opts.settings[k] && !Array.isArray(opts.settings[k])) gs[k] = Object.assign(gs[k] || {}, opts.settings[k]); else gs[k] = opts.settings[k]; });
    const game = createGame({ name: opts.name, date: opts.date, venue: opts.venue, logo: opts.logo || null, songs: v.songs, playlistId: v.playlistId, playlistName: v.name, settings: gs });
    if (opts.cards) game.cards = cardsLib.generateCards(game.order, Number(opts.cards), []);
    saveGame(game);
    activateGame(game);
    return gameSummary(game);
  },
  'games:open': ({ id }) => { const g = readGame(id); if (!g) throw new Error('Game not found'); activateGame(g); return gameSummary(g); },
  'games:active': () => (engine ? gameSummary(engine.game) : null),
  'games:delete': ({ id }) => { if (engine && engine.game.id === id) throw new Error('Close this game before deleting it.'); store.deleteGame(id); return true; },
  'games:close': () => { if (engine) { store.flush(); engine.cancelAdvance(); sendAudience('player', { cmd: 'clear' }); engine = null; sendHost('state', { game: null }); if (remote) remote.broadcastState(); } return true; },
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
    const lines = [`CRIME MASTER BINGO — GAME REPORT`, `${g.name}  ·  ${g.date}  ·  ${g.venue || ''}`, `Game ID ${g.id}  ·  Playlist ${g.playlistName}  ·  Cards ${g.cards.length}`, '', 'WINNERS'];
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
    previewWin = new BrowserWindow({ width: 1100, height: 980, title: 'Print Preview — Crime Master Bingo', backgroundColor: '#1a1033', parent: IS_TEST ? undefined : hostWin, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false } });
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
  'shell:showItem': (p) => { shell.showItemInFolder(p); return true; },

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

  /* audio levelling */
  'audio:status': () => (analyser ? analyser.status() : { available: false }),
  'audio:pause': () => { analyser.setPaused(true); return analyser.status(); },
  'audio:resume': () => { analyser.setPaused(false); return analyser.status(); },
  'audio:reanalyse': ({ ids }) => { analyser.reanalyse(ids || library.songs().map(s => s.id)); return analyser.status(); },

  /* backup & restore */
  'backup:estimate': ({ id, includeMedia }) => backup.estimate(getGameObj(id), !!includeMedia),
  'backup:create': async ({ id, includeMedia, password, file, overwrite }) => {
    const g = getGameObj(id);
    if (engine && engine.game.id === id) store.flush();
    if (!file) {
      const r = await dialog.showSaveDialog(hostWin, { title: 'Save game backup', defaultPath: `${g.name.replace(/[^\w -]/g, '')}-${g.date}${includeMedia ? '-full' : ''}.cmbbackup`, filters: [{ name: 'Crime Master Bingo backup', extensions: ['cmbbackup'] }] });
      if (r.canceled) return null; file = r.filePath; overwrite = true; // the system dialog already asked about overwriting
    }
    if (fs.existsSync(file) && !overwrite) throw new Error('A file with that name already exists.');
    return backup.createBackup(JSON.parse(JSON.stringify(g)), { file, includeMedia: !!includeMedia, password: password || null, appVersion: app.getVersion(), onProgress: (p) => sendHost('backup-progress', p) });
  },
  'backup:pickFile': async () => {
    const r = await dialog.showOpenDialog(hostWin, { title: 'Choose a Crime Master Bingo backup', properties: ['openFile'], filters: [{ name: 'Crime Master Bingo backup', extensions: ['cmbbackup'] }] });
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
  'remote:info': async () => remoteInfo(),
  'remote:start': async () => { if (!remote) createRemote(); await remote.start(); return remoteInfo(); },
  'remote:stop': async () => { if (remote) await remote.stop(); return remoteInfo(); },
  'remote:newPin': async () => { remote.regeneratePin(); return remoteInfo(); },
  'remote:revoke': async ({ deviceId }) => { remote.revoke(deviceId); return remoteInfo(); },
  'remote:setPort': async ({ port }) => {
    port = Number(port); if (!(port >= 1024 && port <= 65535)) throw new Error('Port must be between 1024 and 65535');
    settings.remote.port = port; saveSettings();
    if (remote) await remote.stop();
    createRemote(); await remote.start(); return remoteInfo();
  },

  /* audience-window → main */
  'player:ready': () => { audienceReady = true; ipcMain.emit('audience:ready-once'); if (engine) engine.playerReady(); return { appSettings: audienceAppSettings(), state: engine ? engine.audienceState() : null }; },
  'player:started': ({ token }) => { if (engine) engine.playerStarted(token); return true; },
  'player:time': ({ token, t }) => { if (engine) engine.playerTime(token, t); return true; },
  'player:ended': ({ token }) => { if (engine) engine.playerEnded(token); return true; },
  'player:error': ({ token, message }) => { if (engine) engine.playerError(token, message); return true; },
  'audience:audioDevice': ({ deviceId }) => { settings.video.audioDeviceId = deviceId; saveSettings(); sendAudience('app-settings', audienceAppSettings()); return true; }
};

function audienceAppSettings() {
  return { logo: settings.appearance.logo ? pathToFileURL(settings.appearance.logo).href : null, aspect: settings.video.aspect, audioDeviceId: settings.video.audioDeviceId };
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
  info.qr = await QRCode.toDataURL(info.url + '#pin=' + info.pin, { margin: 1, width: 320, color: { dark: '#1a1033', light: '#ffffff' } });
  return info;
}

function createRemote() {
  remote = new RemoteServer({
    port: settings.remote.port,
    staticDir: path.join(__dirname, '..', 'remote-web'),
    extraFiles: {
      '/jsqr.js': require.resolve('jsqr/dist/jsQR.js'),
      '/shared/patterns.js': path.join(RENDERER, 'shared', 'patterns.js'),
      '/icon.png': path.join(ROOT, 'assets', 'icon.png')
    },
    mounts: { '/fonts/': path.join(RENDERER, 'shared', 'fonts') },
    getState: () => remoteState(),
    dispatch: (action, args, source) => dispatch(action, args, source),
    devices: { list: () => settings.remote.devices, save: (list) => { settings.remote.devices = list; saveSettings(); } },
    onChange: async () => { sendHost('remote', await remoteInfo()); }
  });
}

function preflight() {
  const checks = [];
  const add = (key, label, ok, detail, warn) => checks.push({ key, label, ok: !!ok, warn: !!warn && !ok, detail });
  if (!engine) return { checks: [{ key: 'game', label: 'Game loaded', ok: false, detail: 'Create or open a game first.' }] };
  const g = engine.game;
  const missing = Object.values(g.songs).filter(s => !fs.existsSync(s.path));
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

ipcMain.handle('invoke', async (e, channel, payload) => {
  const h = handlers[channel];
  if (!h) throw new Error('Unknown request: ' + channel);
  return h(payload || {}, e);
});
ipcMain.on('print:ready', (e, info) => ipcMain.emit('print:ready:' + e.sender.id, e, info));
ipcMain.on('player:time-sync', (e, d) => { if (engine) engine.playerTime(d.token, d.t); });

/* ======================================================================= lifecycle */
const gotLock = IS_TEST ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (hostWin) { if (hostWin.isMinimized()) hostWin.restore(); hostWin.focus(); } });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    store = new Store(DATA_DIR);
    settings = loadSettings();
    library = new Library(store);
    library.checkFiles();
    analyser = new AudioAnalyser({ dataDir: DATA_DIR, library, resourcesPath: process.resourcesPath, onChange: () => sendHost('library-audio', analyser.status()) });
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
    try { if (store) { store.flush(); settings.cleanShutdown = true; store.writeNow('settings', settings); } } catch (e) { /* */ }
  });
  app.on('window-all-closed', () => app.quit());
}

// Expose for e2e tests
global.__cmb = { get engine() { return engine; }, get settings() { return settings; }, get remote() { return remote; }, handlers, dispatch, store: () => store };
