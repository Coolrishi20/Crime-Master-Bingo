'use strict';
/**
 * Anthem Square — authoritative game engine.
 *
 * Runs in the Electron main process (the laptop). The desktop host UI and the
 * phone remote both call `dispatch(action, args)`; the audience window is the
 * only video/audio player and reports its progress back via `player*` methods.
 *
 * ELIGIBILITY LEDGER — `game.played` is the single authoritative list of songs
 * that count on cards. Each entry has kind 'played' (actually played) or
 * 'credit' (host-approved technical credit). The audience crawler, the host
 * lists, the phone, the bingo checker and claim-session snapshots all read it.
 */
const crypto = require('crypto');
const rules = require('./rules');
const { shuffle, spreadShuffle, artistKey, parseQrPayload, formatCardNo, generateCards, parseRange } = require('./cards');
const locking = require('./locking');

const CLIP_MODES = [20, 30, 40, 60, 'full'];
const CREDIT_REASONS = ['File missing or moved', 'Storage device disconnected', 'Video corrupted', 'Codec not supported', 'Playback failed during the event', 'Other'];

/** 2.6: a song with no picture (MP3 etc.); older games don't store `kind`, so the file name decides. */
function isAudioSong(s) { return !!s && s.source !== 'youtube' && (s.kind === 'audio' || /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus)$/i.test(String(s.path || ''))); }

/** [1,2,3,5,7,8] → "001–003, 005, 007–008" */
function rangeText(nums) {
  const a = Array.from(new Set(nums)).sort((x, y) => x - y); const out = [];
  for (let i = 0; i < a.length; i++) {
    let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    out.push(j > i ? `${formatCardNo(a[i])}-${formatCardNo(a[j])}` : formatCardNo(a[i])); i = j;
  }
  return out.join(', ');
}

function defaultAudio() {
  return { levelling: true, targetLufs: -16, ceilingDbtp: -1, maxBoostDb: 9, fadeIn: 0.5, fadeOut: 1.0, muted: false, talkoverDb: -14 };
}

function defaultGameSettings() {
  return {
    clipMode: 40,
    defaultStart: 0,
    skipIntros: true,       // start each clip where the music begins (quiet/silent video intros skipped)
    spreadArtists: true,    // shuffle keeps songs by the same artist apart
    autoAdvance: true,
    autoAdvanceGap: 3,
    shuffle: true,
    volume: 85,
    pauseOnClaim: true,
    winnerAnimation: true,
    tvScreens: { winner: true, wrongClaim: true, showCardNumber: false, showName: true, closeCount: true, seconds: 7 },
    screens: { welcome: true, startTime: '', message: '', end: true },
    overlay: { enabled: true, position: 'bottom-left', titleSize: 64, artistSize: 38, opacity: 0.78, duration: 0, revealDelay: 0 },
    crawler: { speed: 4, fontSize: 30, height: 72, separator: 'diamond', paused: false },
    audio: defaultAudio(),
    patternPosition: 'top-right',
    // winning rules per round (v1.5): one or more rules, any of which wins
    rounds: JSON.parse(JSON.stringify(rules.DEFAULT_ROUND_RULES)),
    roundCount: 3, // host-defined number of rounds (1–10); the last round ends the game
    mode: 'rounds',         // 'rounds' (Round-Based Bingo) or 'checklist' (Rules Checklist Bingo)
    checklist: JSON.parse(JSON.stringify(DEFAULT_CHECKLIST)), // checklist mode: [{ id, rule }]
    afterWinner: 'ask',      // when a round has a winner: 'ask' the host, or go to 'intermission' automatically
    intermissionMinutes: 10,
    // Quiz Intermission Mode (2.1): what the TV does while the host runs their quiz, and
    // whether a bingo break starts playing straight away.
    night: { quizTv: 'hide', autoPlay: false }
  };
}

const MAX_ROUNDS = 10;
/** Actions that would play music — refused during quiz time (the TV is hidden). */
const QUIZ_BLOCKED = ['play', 'togglePlay', 'next', 'skip', 'previous', 'replay', 'jumpTo', 'startRound', 'resumeGame'];
/** Default Rules Checklist (any order). */
const DEFAULT_CHECKLIST = [{ id: 'k1', rule: { id: 'fast5', mode: 'any' } }, { id: 'k2', rule: { id: 'line' } }, { id: 'k3', rule: { id: 'diagonal' } }, { id: 'k4', rule: { id: 'lShape' } }, { id: 'k5', rule: { id: 'full' } }];
/** Validate a checklist: keeps item ids stable (claims refer to them), gives new items an id. */
function normaliseChecklist(list) {
  const out = []; const seen = new Set();
  (Array.isArray(list) ? list : []).forEach(x => {
    const raw = x && x.rule ? x.rule : x;
    let rule; try { rule = rules.normaliseRule(raw); } catch (e) { return; }
    let id = x && typeof x.id === 'string' && /^[\w-]{1,24}$/.test(x.id) && !seen.has(x.id) ? x.id : 'k_' + crypto.randomBytes(3).toString('hex');
    seen.add(id); out.push({ id, rule });
  });
  return out.slice(0, 20);
}
/** Standard rules for rounds 1–3; any extra round starts as One Line until the host picks. */
function defaultRuleSet(n) { return JSON.parse(JSON.stringify(rules.DEFAULT_ROUND_RULES[n] || [{ id: 'line' }])); }

function uid(prefix = '') { return prefix + crypto.randomBytes(6).toString('hex'); }

class GameEngine {
  /**
   * @param {object} game  persisted game object
   * @param {object} hooks { persist(game, urgent), changed(kind), player(cmd), event(name,payload), gainFor(song, clip, audio), setTimeout, clearTimeout, now }
   */
  constructor(game, hooks = {}) {
    this.game = game;
    this.hooks = hooks;
    this._setTimeout = hooks.setTimeout || setTimeout;
    this._clearTimeout = hooks.clearTimeout || clearTimeout;
    this._now = hooks.now || (() => Date.now());
    this.loadToken = 0;
    this.advanceTimer = null;
    this.lastError = null;
    this.audienceConnected = false;
    this.unavailable = {}; // songId -> reason (missing file / playback failure)
    GameEngine.normalise(game);
    // Crash recovery: never resume straight into playback; restore paused at the saved position.
    const pb = game.playback;
    if (['playing', 'loading', 'between'].includes(pb.status)) {
      pb.status = pb.index >= 0 ? 'paused' : 'idle';
      pb.recovered = true;
    }
    pb.pausedForClaim = !!this.activeSession();
  }

  static normalise(game) {
    const d = defaultGameSettings();
    game.settings = Object.assign({}, d, game.settings || {});
    game.settings.overlay = Object.assign({}, d.overlay, (game.settings.overlay || {}));
    game.settings.crawler = Object.assign({}, d.crawler, (game.settings.crawler || {}));
    game.settings.audio = Object.assign({}, d.audio, (game.settings.audio || {}));
    game.settings.tvScreens = Object.assign({}, d.tvScreens, (game.settings.tvScreens || {}));
    game.settings.screens = Object.assign({}, d.screens, (game.settings.screens || {}));
    game.settings.night = Object.assign({}, d.night, (game.settings.night || {}));
    if (!['hide', 'hold'].includes(game.settings.night.quizTv)) game.settings.night.quizTv = 'hide';
    const cnt = Math.max(1, Math.min(MAX_ROUNDS, Number(game.settings.roundCount) || 3));
    game.settings.roundCount = cnt;
    const src = Object.assign({}, d.rounds, game.settings.rounds || {}); const rs = {};
    for (let n = 1; n <= cnt; n++) { try { rs[n] = rules.normaliseRuleSet(src[n] || defaultRuleSet(n)); } catch (e) { rs[n] = defaultRuleSet(n); } }
    game.settings.rounds = rs;
    game.settings.mode = game.settings.mode === 'checklist' ? 'checklist' : 'rounds';
    game.settings.checklist = normaliseChecklist(game.settings.checklist && game.settings.checklist.length ? game.settings.checklist : DEFAULT_CHECKLIST);
    if (game.settings.mode === 'checklist' && !game.settings.checklist.length) game.settings.checklist = normaliseChecklist(DEFAULT_CHECKLIST);
    game.playback = Object.assign({ index: -1, status: 'idle', position: 0, recovered: false }, game.playback || {});
    game.played = game.played || [];
    game.skipped = game.skipped || [];
    game.round = game.round || { number: 0, status: 'pending' };
    game.rounds = game.rounds || {};
    game.claims = game.claims || [];
    game.players = game.players || [];
    if (game.playersOpen === undefined) game.playersOpen = true;
    game.intermission = game.intermission || null;
    // Quiz Intermission Mode: the evening alternates quiz time and bingo breaks. Older games
    // load in 'break' so they behave exactly as before.
    game.night = Object.assign({ phase: 'break', breaks: [] }, game.night || {});
    if (!['quiz', 'break'].includes(game.night.phase)) game.night.phase = 'break';
    if (!Array.isArray(game.night.breaks)) game.night.breaks = [];
    game.checklistClosed = !!game.checklistClosed;
    game.claimSessions = game.claimSessions || [];
    game.queue = game.queue || [];       // host-queued songs (play next, in order)
    game.deferred = game.deferred || []; // skipped from Up Next — still eligible later
    game.excluded = game.excluded || []; // explicitly excluded by the host
    game.transitions = game.transitions || [];
    game.credits = game.credits || [];
    game.audit = game.audit || [];
    game.cards = game.cards || [];
    game.status = game.status || 'setup';
    game.log = game.log || [];
    game.version = game.version || 0;
    locking.migrate(game);
    return game;
  }

  /* ------------------------------------------------------------------ helpers */
  get settings() { return this.game.settings; }
  /** Rule set for a round (custom rules, v1.5). */
  rr(n) { return { round: n, rules: (this.settings.rounds && this.settings.rounds[n]) || defaultRuleSet(n) }; }
  roundCount() { return Math.max(1, Math.min(MAX_ROUNDS, Number(this.settings.roundCount) || 3)); }
  roundNumbers() { return Array.from({ length: this.roundCount() }, (_, i) => i + 1); }
  /** Labels, rule text and pattern diagrams for a round (cached per rule set). */
  info(n) {
    if (!n) n = 1;
    const key = n + ':' + JSON.stringify(this.rr(n).rules);
    this._info = this._info || {};
    if (!this._info[key]) this._info[key] = rules.roundInfo(this.rr(n));
    return this._info[key];
  }
  /* ------------------------------------------------ Rules Checklist mode (v1.6) */
  isChecklist() { return this.settings.mode === 'checklist'; }
  ckItems() { return this.settings.checklist || []; }
  ckItem(id) { return this.ckItems().find(i => i.id === id) || null; }
  ckInfo(item) { this._ck = this._ck || {}; const k = JSON.stringify(item.rule); if (!this._ck[k]) this._ck[k] = rules.roundInfo({ round: 0, rules: [item.rule] }); return this._ck[k]; }
  ckWinners(id) { return this.game.claims.filter(c => c.status === 'confirmed' && c.itemId === id); }
  /** A rule is completed once a winner is confirmed. Rules completed IN the given claim session stay
      open for that session only, so simultaneous winners checked against the same frozen snapshot all count. */
  ckOpen(sessionId) { return this.ckItems().filter(it => { const w = this.ckWinners(it.id); return !w.length || (sessionId && w.every(c => c.sessionId === sessionId)); }); }
  ckRuleSet(items) { return { round: 0, rules: items.map(i => i.rule) }; }
  /** Which still-open rules a card satisfies on a song set (the card can't win the same rule twice). */
  ckQualify(card, set, sessionId) {
    const open = this.ckOpen(sessionId); const out = { open, eligible: [], alreadyWon: [], completed: [] };
    const sat = (it) => rules.checkCard(card.cells, set, this.ckRuleSet([it])).valid;
    open.forEach(it => { if (!sat(it)) return; if (this.ckWinners(it.id).some(c => c.cardNo === card.no)) out.alreadyWon.push(it); else out.eligible.push(it); });
    this.ckItems().filter(it => !open.includes(it)).forEach(it => { if (sat(it)) out.completed.push(it); });
    return out;
  }
  ckOpenFor(cardNo, sessionId) { return this.ckOpen(sessionId).filter(it => !this.ckWinners(it.id).some(c => c.cardNo === cardNo)); }
  checklistView() {
    const items = this.ckItems().map((it, i) => {
      const w = this.ckWinners(it.id); const inf = this.ckInfo(it);
      return { id: it.id, n: i + 1, rule: it.rule, label: inf.label, short: inf.short, text: inf.rule, example: inf.examples[0], examples: inf.examples, status: w.length ? 'completed' : 'available', completedAt: w.length ? w.map(c => c.confirmedAt).sort()[0] : null,
        winners: w.map(c => ({ claimId: c.id, cardNo: c.cardNo, cardLabel: formatCardNo(c.cardNo), owner: this.ownerOf(c.cardNo), at: c.confirmedAt })) };
    });
    const done = items.filter(i => i.status === 'completed').length;
    return { items, total: items.length, completed: done, allDone: items.length > 0 && done === items.length, closed: !!this.game.checklistClosed };
  }
  roundLocked(n) { const r = this.game.round; return n < r.number || (n === r.number && r.status !== 'ready'); }
  roundRulesView() {
    const out = {};
    this.roundNumbers().forEach(n => { const i = this.info(n); out[n] = { label: i.label, short: i.short, rule: i.rule, examples: i.examples, rules: i.rules, legacy: i.legacy, diagonalsCount: i.diagonalsCount, locked: this.roundLocked(n) }; });
    return out;
  }
  song(id) { return this.game.songs[id]; }
  currentSongId() { const i = this.game.playback.index; return i >= 0 ? this.game.order[i] : null; }
  /** Set of every eligible song (played + technical credit). */
  playedSet() { return new Set(this.game.played.map(p => p.songId)); }
  isPlayed(id) { return this.game.played.some(p => p.songId === id); }
  ledgerEntry(id) { return this.game.played.find(p => p.songId === id); }
  activeSession() { return this.game.claimSessions.find(s => s.status === 'open') || null; }
  nowIso() { return new Date(this._now()).toISOString(); }

  clipFor(song) {
    const s = this.settings;
    const dur = Number(song.duration) || 0;
    // start: your own start point for this song > the game-wide start offset > the detected intro
    const manual = song.clipStart != null && song.clipStart !== '';
    const intro = !manual && s.skipIntros !== false ? this.introFor(song) : 0;
    if (s.clipMode === 'full') return { start: intro, end: dur || null, intro: intro > 0 };
    const len = Number(s.clipMode) || 40;
    let start = manual ? Number(song.clipStart) : (Number(s.defaultStart) > 0 ? Number(s.defaultStart) : intro);
    if (dur && start >= dur - 1) start = 0;
    let end = song.clipEnd != null && song.clipEnd !== '' ? Number(song.clipEnd) : start + len;
    if (end <= start) end = start + len;
    if (dur) end = Math.min(end, dur);
    return { start, end, intro: !manual && !(Number(s.defaultStart) > 0) && intro > 0 && start === intro };
  }
  /** Detected quiet intro (s) from the audio analysis; 0 when unknown or none. */
  introFor(song) { if (!song || !this.hooks.introFor) return 0; try { const t = Number(this.hooks.introFor(song)); return t > 0 && (!song.duration || t < song.duration - 5) ? t : 0; } catch (e) { return 0; } }

  /** Audio parameters for the player: levelling gain for this exact clip, fades, mute. */
  audioFor(song, clip) {
    const a = this.settings.audio;
    let lev = { gainDb: 0, status: 'off' };
    if (a.levelling && this.hooks.gainFor) { try { lev = this.hooks.gainFor(song, clip, a) || lev; } catch (e) { lev = { gainDb: 0, status: 'error', note: e.message }; } }
    return { gainDb: a.levelling ? (lev.gainDb || 0) : 0, levelStatus: a.levelling ? lev.status : 'off', lufs: lev.lufs, fadeIn: Number(a.fadeIn) || 0, fadeOut: Number(a.fadeOut) || 0, muted: !!a.muted };
  }

  log(msg) {
    this.game.log.push({ at: this.nowIso(), msg });
    if (this.game.log.length > 1000) this.game.log.splice(0, this.game.log.length - 1000);
  }

  /** Append-only audit trail (never pruned). */
  audit(action, data, source) {
    this.game.audit.push(Object.assign({ id: uid('a_'), at: this.nowIso(), gameId: this.game.id, action, source: source || 'laptop' }, data));
  }

  touch(kind = 'state', urgent = true) {
    this.game.version++;
    this.game.updatedAt = this.nowIso();
    if (this.hooks.persist) this.hooks.persist(this.game, urgent);
    if (this.hooks.changed) this.hooks.changed(kind);
  }

  player(cmd) { if (this.hooks.player) this.hooks.player(cmd); }
  event(name, payload) { if (this.hooks.event) this.hooks.event(name, payload); }

  cancelAdvance() {
    if (this.advanceTimer) { this._clearTimeout(this.advanceTimer); this.advanceTimer = null; }
    if (this.game.playback.status === 'between') { this.game.playback.status = 'idle'; this.game.playback.nextAt = null; }
  }

  /**
   * The next song to play (index into the saved play order):
   * 1) host-queued songs, 2) the saved shuffle order, 3) earlier skipped songs (wrap),
   * 4) songs the host skipped from Up Next. Never a played/credited or excluded song.
   */
  nextUnplayedIndex(after) { const n = this.upNext(after); return n ? n.index : -1; }

  upNext(after) {
    const g = this.game; const played = this.playedSet();
    if (after == null) after = g.playback.index;
    const cur = after >= 0 ? g.order[after] : null;
    const excluded = new Set(g.excluded); const deferred = new Set(g.deferred);
    const ok = (id) => id && id !== cur && !played.has(id) && !excluded.has(id) && this.song(id);
    const idx = (id) => g.order.indexOf(id);
    for (const id of g.queue) if (ok(id)) return { index: idx(id), songId: id, source: 'queue' };
    for (let i = after + 1; i < g.order.length; i++) if (ok(g.order[i]) && !deferred.has(g.order[i])) return { index: i, songId: g.order[i], source: 'playlist' };
    for (let i = 0; i <= Math.min(after, g.order.length - 1); i++) if (ok(g.order[i]) && !deferred.has(g.order[i])) return { index: i, songId: g.order[i], source: 'playlist' };
    for (const id of g.deferred) if (ok(id)) return { index: idx(id), songId: id, source: 'deferred' };
    return null;
  }

  upNextView() {
    const g = this.game; const n = this.upNext();
    const view = (id) => { const s = this.song(id); return { songId: id, title: s.displayTitle || s.title, artist: s.artist }; };
    let next = null;
    if (n) {
      const s = this.song(n.songId); const clip = this.clipFor(s);
      next = Object.assign(view(n.songId), {
        index: n.index, number: n.index + 1, source: n.source,
        fileName: s.fileName || String(s.path || '').split(/[\\/]/).pop(), duration: s.duration || null,
        clipStart: clip.start, introSkipped: !!clip.intro, clipEnd: clip.end, clipLength: clip.end != null ? Math.round((clip.end - clip.start) * 10) / 10 : null,
        clipMode: this.settings.clipMode, ready: !this.unavailable[n.songId], problem: this.unavailable[n.songId] || null
      });
    }
    const played = this.playedSet(); const cur = this.currentSongId();
    return {
      next,
      queue: g.queue.filter(id => !played.has(id) && id !== cur).map(view),
      deferred: g.deferred.filter(id => !played.has(id) && id !== cur).map(view),
      excluded: g.excluded.map(view),
      custom: g.queue.length > 0 || g.deferred.length > 0
    };
  }

  /** Songs the host may pick for Up Next (unplayed, not the current one). */
  eligibleSongs() {
    const played = this.playedSet(); const cur = this.currentSongId(); const ex = new Set(this.game.excluded);
    return this.game.order.filter(id => !played.has(id) && id !== cur).map((id) => { const s = this.song(id); return { songId: id, number: this.game.order.indexOf(id) + 1, title: s.displayTitle || s.title, artist: s.artist, excluded: ex.has(id), queued: this.game.queue.includes(id), unavailable: !!this.unavailable[id] }; });
  }

  /* ---------------------------------------------------------- player control */
  loadCmd(index, position, autoplay) {
    const song = this.song(this.game.order[index]);
    const clip = this.clipFor(song);
    // 2.6 Play on: an extended clip survives a TV reconnect
    const pb = this.game.playback;
    if (index === pb.index && pb.clipEndOverride !== undefined) clip.end = pb.clipEndOverride;
    return { cmd: 'load', token: this.loadToken, index, number: index + 1, audioOnly: isAudioSong(song), src: song.path, youtube: song.source === 'youtube' ? song.youtubeId : undefined, start: position != null ? position : clip.start, clipStart: clip.start, clipEnd: clip.end, autoplay, volume: this.settings.volume, audio: this.audioFor(song, clip) };
  }

  loadIndex(index, { autoplay = true, position = null } = {}) {
    const g = this.game;
    if (index < 0 || index >= g.order.length) throw new Error('No such song in the play order');
    this.cancelAdvance();
    const song = this.song(g.order[index]);
    const clip = this.clipFor(song);
    this.loadToken++;
    g.queue = g.queue.filter(id => id !== song.id);
    g.deferred = g.deferred.filter(id => id !== song.id);
    g.playback.index = index;
    g.playback.status = autoplay ? 'loading' : 'paused';
    g.playback.position = position != null ? position : clip.start;
    g.playback.clipStart = clip.start;
    g.playback.clipEnd = clip.end;
    delete g.playback.clipEndOverride;
    g.playback.recovered = false;
    g.playback.startedAt = this.nowIso();
    this.lastError = null;
    this.player(this.loadCmd(index, g.playback.position, autoplay));
  }

  /** Called when the audience window (re)connects: restore what it should be showing. */
  playerReady() {
    this.audienceConnected = true;
    const pb = this.game.playback;
    if (pb.index >= 0 && ['playing', 'loading', 'paused'].includes(pb.status)) {
      this.loadToken++;
      const autoplay = pb.status === 'playing' || pb.status === 'loading';
      const song = this.song(this.game.order[pb.index]);
      this.player(this.loadCmd(pb.index, pb.position || this.clipFor(song).start, autoplay));
    } else {
      this.player({ cmd: 'clear' });
    }
    this.player({ cmd: 'volume', volume: this.settings.volume });
    if (this.talkoverOn) this.player({ cmd: 'duck', on: true, db: Math.max(-30, Math.min(-6, Number((this.settings.audio || {}).talkoverDb) || -14)) });
    if (this.hooks.changed) this.hooks.changed('audience');
  }

  playerGone() { this.audienceConnected = false; if (this.hooks.changed) this.hooks.changed('state'); }

  playerStarted(token) {
    if (token !== this.loadToken) return;
    const pb = this.game.playback;
    if (pb.status === 'loading') { pb.status = 'playing'; this.touch('state'); }
  }

  playerTime(token, t) {
    if (token !== this.loadToken) return;
    this.game.playback.position = t;
    if (this.hooks.tick) this.hooks.tick();
  }

  /** The audience player reports the clip (or full video) finished. */
  playerEnded(token) {
    if (token !== this.loadToken) return;
    const g = this.game; const pb = g.playback;
    if (!['playing', 'loading'].includes(pb.status)) return;
    const id = this.currentSongId();
    if (id && g.round.number > 0) this.addPlayed(id, false);
    pb.status = 'idle';
    pb.position = pb.clipEnd || pb.position;
    // the TV holds the last frame (silently) during the gap when another song follows
    const hold = !!(this.settings.autoAdvance && this.nextUnplayedIndex(pb.index) >= 0 && !this.activeSession() && !(g.night && g.night.phase === 'quiz'));
    this.player(hold ? { cmd: 'clear', hold: true } : { cmd: 'clear' });
    this.scheduleAdvance();
    this.touch('state');
  }

  /** Playback failure: NEVER counted and NEVER auto-credited — the host decides. */
  playerError(token, message) {
    if (token !== this.loadToken) return;
    const id = this.currentSongId();
    const s = id ? this.song(id) : null;
    this.lastError = `Could not play "${s ? s.title : 'song'}": ${message}`;
    this.log(this.lastError);
    if (id) {
      this.unavailable[id] = 'Playback failed: ' + message;
      if (!this.game.skipped.includes(id)) this.game.skipped.push(id);
    }
    this.game.playback.status = 'idle';
    this.player({ cmd: 'clear' });
    this.event('error', { message: this.lastError + ' — skipped (not counted). You can grant Technical Credit if needed.', songId: id });
    this.scheduleAdvance();
    this.touch('state');
  }

  setUnavailable(map) {
    // map: songId -> reason, from the laptop's file checks
    Object.keys(this.unavailable).forEach(k => { if (!/^Playback failed/.test(this.unavailable[k])) delete this.unavailable[k]; });
    Object.assign(this.unavailable, map || {});
  }

  scheduleAdvance() {
    const g = this.game; const s = this.settings;
    const next = this.nextUnplayedIndex(g.playback.index);
    if (next < 0) { g.playback.status = 'finished'; this.log('All songs in the playlist have been played'); return; }
    if (!s.autoAdvance || g.gamePaused || g.round.number === 0 || g.status === 'finished' || this.activeSession() || (g.night && g.night.phase === 'quiz')) return;
    const gap = Math.max(0, Number(s.autoAdvanceGap) || 0) * 1000;
    g.playback.status = 'between';
    g.playback.nextAt = this._now() + gap;
    this.advanceTimer = this._setTimeout(() => {
      this.advanceTimer = null;
      if (g.playback.status !== 'between' || this.activeSession()) return;
      const n = this.nextUnplayedIndex(g.playback.index);
      if (n >= 0) { this.loadIndex(n, { autoplay: true }); this.touch('state'); }
    }, gap);
  }

  addPlayed(songId, manual, kind = 'played', extra = {}) {
    if (this.isPlayed(songId)) return false; // replays never duplicate the ledger
    this.game.played.push(Object.assign({ songId, at: this.nowIso(), round: this.game.round.number, manual: !!manual, kind }, extra));
    this.game.skipped = this.game.skipped.filter(x => x !== songId);
    const s = this.song(songId);
    this.log(`${kind === 'credit' ? 'TECHNICAL CREDIT' : 'Played'} #${this.game.played.length}: ${s.title} — ${s.artist}${manual && kind === 'played' ? ' (marked by host)' : ''}`);
    return true;
  }

  /* ----------------------------------------------------------------- actions */
  dispatch(action, args = {}, source = 'desktop') {
    const fn = this.actions[action];
    if (!fn) throw new Error(`Unknown action: ${action}`);
    const allowedWhenFinished = ['closeChecklist', 'endIntermission', 'startBreak', 'setNight', 'playerRemove', 'playerRename', 'setPlayersOpen', 'setScreens', 'showTvScreen', 'setTvScreens', 'openChecker', 'closeChecker', 'checkClaim', 'freezeClaims', 'addClaim', 'closeSession', 'confirmClaim', 'dismissClaim', 'removeClaim', 'viewClaim', 'setCrawler', 'setOverlay', 'reopenGame', 'setVolume', 'setAudio', 'reverseCredit', 'talkover', 'setHandedOut'];
    if (this.game.status === 'finished' && !allowedWhenFinished.includes(action)) {
      throw new Error('This game has ended. Re-open it from Game History to continue.');
    }
    if (this.game.night && this.game.night.phase === 'quiz' && QUIZ_BLOCKED.includes(action)) {
      const e = new Error('It’s quiz time — start the bingo break first.'); e.code = 'QUIZ'; throw e;
    }
    return fn.call(this, args || {}, source);
  }

  get actions() {
    return {
      play: this.aPlay, pause: this.aPause, togglePlay: this.aToggle, stop: this.aStop,
      next: this.aNext, skip: (a, s) => this.aNext(Object.assign({ mode: a.mode || 'skip' }, a), s),
      previous: this.aPrevious, replay: this.aReplay, seek: this.aSeek, setVolume: this.aVolume,
      setHandedOut: this.aSetHandedOut,
      setClipMode: this.aClipMode, playOn: this.aPlayOn, talkover: this.aTalkover, jumpTo: this.aJumpTo, markPlayed: this.aMarkPlayed, unmarkPlayed: this.aUnmarkPlayed,
      startRound: this.aStartRound, endRound: this.aEndRound, pauseGame: this.aPauseGame, resumeGame: this.aResumeGame,
      endGame: this.aEndGame, reopenGame: this.aReopenGame, reshuffle: this.aReshuffle,
      setCrawler: this.aSetCrawler, setOverlay: this.aSetOverlay, setGameSettings: this.aSetGameSettings, setAudio: this.aSetAudio,
      // claim sessions (Claim Freeze)
      freezeClaims: this.aFreeze, addClaim: this.aAddClaim, viewClaim: this.aViewClaim, confirmClaim: this.aConfirmClaim,
      dismissClaim: this.aDismissClaim, removeClaim: this.aRemoveClaim, closeSession: this.aCloseSession, revokeWinner: this.aRevokeWinner,
      // backwards-compatible names
      openChecker: this.aFreeze, checkClaim: this.aAddClaim, closeChecker: this.aCloseSession,
      // technical credit
      grantCredit: this.aGrantCredit, reverseCredit: this.aReverseCredit,
      showTvScreen: this.aShowTvScreen, setTvScreens: this.aSetTvScreens,
      completeRound: this.aCompleteRound, setScreens: this.aSetScreens,
      queueSong: this.aQueueSong, unqueueSong: this.aUnqueueSong, skipNext: this.aSkipNext, resetQueue: this.aResetQueue,
      excludeSong: this.aExcludeSong, includeSong: this.aIncludeSong,
      updateSong: this.aUpdateSong,
      // home play: phone cards for players
      setRoundRules: this.aSetRoundRules, setRoundCount: this.aSetRoundCount,
      startIntermission: this.aStartIntermission, endIntermission: this.aEndIntermission,
      startBreak: this.aStartBreak, returnToQuiz: this.aReturnToQuiz, setNight: this.aSetNight,
      setGameMode: this.aSetGameMode, changeAward: this.aChangeAward, setChecklist: this.aSetChecklist, closeChecklist: this.aCloseChecklist,
      playerJoin: this.aPlayerJoin, playerRemove: this.aPlayerRemove, playerRename: this.aPlayerRename, playerBingo: this.aPlayerBingo, setPlayersOpen: this.aSetPlayersOpen
    };
  }

  assertExpected(args) {
    if (args.expectIndex != null && Number(args.expectIndex) !== this.game.playback.index) {
      const e = new Error('The song has already changed — command ignored to avoid a double skip.');
      e.code = 'STALE'; throw e;
    }
  }

  aPlay() {
    const g = this.game; const pb = g.playback;
    if (g.night && g.night.phase === 'quiz') { const e = new Error('It’s quiz time — start the bingo break first.'); e.code = 'QUIZ'; throw e; }
    if (g.round.number === 0) throw new Error('Start Round 1 to begin playing songs.');
    if (g.gamePaused) g.gamePaused = false;
    if (pb.status === 'paused') {
      pb.status = 'playing'; pb.pausedForClaim = false;
      if (pb.recovered || !this.audienceConnected) { this.playerReady(); pb.recovered = false; }
      else this.player({ cmd: 'play' });
    } else if (pb.status === 'stopped' && pb.index >= 0) {
      this.loadIndex(pb.index, { autoplay: true });
    } else if (['idle', 'between', 'finished'].includes(pb.status)) {
      const cur = this.currentSongId();
      let n;
      if (pb.index >= 0 && cur && !this.isPlayed(cur) && pb.status === 'idle' && !g.skipped.includes(cur)) n = pb.index;
      else n = this.nextUnplayedIndex(pb.index);
      if (n < 0) throw new Error('Every song in this game has been played.');
      this.loadIndex(n, { autoplay: true });
    } else return { ok: true, already: true };
    this.touch('state');
    return { ok: true };
  }

  aPause() {
    const pb = this.game.playback;
    if (pb.status === 'between') { this.cancelAdvance(); this.touch('state'); return { ok: true }; }
    if (!['playing', 'loading'].includes(pb.status)) return { ok: true, already: true };
    pb.status = 'paused';
    this.player({ cmd: 'pause' });
    this.touch('state');
    return { ok: true };
  }

  aToggle(args) { const st = this.game.playback.status; return (st === 'playing' || st === 'loading' || st === 'between') ? this.aPause(args) : this.aPlay(args); }

  aStop() {
    const pb = this.game.playback;
    this.cancelAdvance();
    if (pb.index < 0) return { ok: true };
    pb.status = 'stopped';
    pb.position = pb.clipStart || 0;
    pb.pausedForClaim = false;
    this.player({ cmd: 'stop' });
    this.touch('state');
    return { ok: true };
  }

  /**
   * Next / skip. If the current song has not officially completed the host must
   * choose: mode 'skip' (not counted) or 'markPlayed' (counted, then next).
   */
  aNext(args = {}) {
    this.assertExpected(args);
    const g = this.game; const pb = g.playback;
    if (g.round.number === 0) throw new Error('Start Round 1 first.');
    const cur = this.currentSongId();
    const unfinished = cur && !this.isPlayed(cur) && ['playing', 'loading', 'paused', 'stopped'].includes(pb.status);
    if (unfinished && !args.mode) return { ok: false, needsConfirm: true, message: 'This song has not finished. Skip it without counting it, or mark it as played?' };
    if (unfinished && args.mode === 'markPlayed') this.addPlayed(cur, true);
    else if (unfinished && args.mode === 'skip') { if (!g.skipped.includes(cur)) g.skipped.push(cur); this.log(`Skipped: ${this.song(cur).title}`); }
    const n = this.nextUnplayedIndex(pb.index);
    if (n < 0) {
      this.player({ cmd: 'clear' }); pb.status = 'finished'; this.touch('state');
      return { ok: true, finished: true, message: 'Every song has now been played or skipped.' };
    }
    this.loadIndex(n, { autoplay: true });
    this.touch('state');
    return { ok: true };
  }

  aPrevious(args = {}) {
    this.assertExpected(args);
    const pb = this.game.playback;
    if (this.game.round.number === 0) throw new Error(this.isChecklist() ? 'Start the game first.' : 'Start Round 1 first.');
    const target = pb.index > 0 ? pb.index - 1 : 0;
    this.loadIndex(target, { autoplay: true });
    this.touch('state');
    return { ok: true };
  }

  aReplay(args = {}) {
    this.assertExpected(args);
    const pb = this.game.playback;
    if (pb.index < 0) throw new Error('No song to replay yet.');
    if (this.game.round.number === 0) throw new Error(this.isChecklist() ? 'Start the game first.' : 'Start Round 1 first.');
    // The TV still has this video loaded → just seek back to the clip start (no reload, no
    // decoder re-initialisation). Only reload when the player was cleared or after recovery.
    if (['playing', 'paused', 'loading'].includes(pb.status) && this.audienceConnected && !pb.recovered && this.loadToken != null) {
      const start = pb.clipStart || 0;
      pb.position = start; pb.status = 'playing'; pb.pausedForClaim = false;
      if (this.game.gamePaused) this.game.gamePaused = false;
      this.player({ cmd: 'seek', position: start, token: this.loadToken });
      this.player({ cmd: 'play' });
      this.touch('state');
      return { ok: true, seek: true };
    }
    this.loadIndex(pb.index, { autoplay: true }); // already-played songs are never re-added to the ledger
    this.touch('state');
    return { ok: true };
  }

  aSeek(args) {
    const pb = this.game.playback;
    if (pb.index < 0) return { ok: false };
    const t = Math.max(0, Number(args.position) || 0);
    pb.position = t;
    this.player({ cmd: 'seek', position: t });
    this.touch('state', false);
    return { ok: true };
  }

  aVolume(args) {
    const v = Math.max(0, Math.min(100, Math.round(Number(args.volume))));
    if (Number.isNaN(v)) throw new Error('Invalid volume');
    this.settings.volume = v;
    this.player({ cmd: 'volume', volume: v });
    this.touch('state', false);
    return { ok: true, volume: v };
  }

  /** Audio levelling / fades / mute — applied live to the one player on the laptop. */
  aSetAudio(args) {
    const a = this.settings.audio;
    if (args.levelling != null) a.levelling = !!args.levelling;
    if (args.toggleLevelling) a.levelling = !a.levelling;
    if (args.muted != null) a.muted = !!args.muted;
    if (args.toggleMute) a.muted = !a.muted;
    if (args.targetLufs != null) a.targetLufs = Math.max(-30, Math.min(-8, Number(args.targetLufs)));
    if (args.maxBoostDb != null) a.maxBoostDb = Math.max(0, Math.min(20, Number(args.maxBoostDb)));
    if (args.ceilingDbtp != null) a.ceilingDbtp = Math.max(-6, Math.min(0, Number(args.ceilingDbtp)));
    if (args.fadeIn != null) a.fadeIn = Math.max(0, Math.min(5, Number(args.fadeIn)));
    if (args.fadeOut != null) a.fadeOut = Math.max(0, Math.min(8, Number(args.fadeOut)));
    if (args.talkoverDb != null) a.talkoverDb = Math.max(-30, Math.min(-6, Number(args.talkoverDb)));
    const id = this.currentSongId();
    if (id) { const s = this.song(id); this.player(Object.assign({ cmd: 'audio', token: this.loadToken }, this.audioFor(s, this.clipFor(s)))); }
    else this.player({ cmd: 'audio', token: this.loadToken, gainDb: 0, muted: a.muted, fadeIn: a.fadeIn, fadeOut: a.fadeOut });
    this.touch('state', false);
    return { ok: true, audio: a };
  }

  aClipMode(args) {
    const m = args.clipMode === 'full' ? 'full' : Number(args.clipMode);
    if (!CLIP_MODES.includes(m)) throw new Error('Clip length must be 20, 30, 40, 60 seconds or full song');
    this.settings.clipMode = m;
    const pb = this.game.playback;
    const id = this.currentSongId();
    if (id && ['playing', 'paused', 'loading'].includes(pb.status)) {
      const s = this.song(id); const clip = this.clipFor(s);
      pb.clipStart = clip.start; pb.clipEnd = clip.end;
      this.player({ cmd: 'clip', token: this.loadToken, clipStart: clip.start, clipEnd: clip.end });
      this.player(Object.assign({ cmd: 'audio', token: this.loadToken }, this.audioFor(s, clip)));
    }
    this.touch('state');
    return { ok: true };
  }

  /**
   * 2.6 Play on: let the song that is playing run on (+30 s, or to the end) without
   * changing the clip length for any other song.
   */
  aPlayOn(args) {
    const g = this.game; const pb = g.playback;
    const id = this.currentSongId();
    if (!id || !['playing', 'paused', 'loading'].includes(pb.status)) throw new Error('Nothing is playing to extend.');
    const s = this.song(id); const dur = Number(s.duration) || 0;
    if (pb.clipEnd == null || (dur && pb.clipEnd >= dur - 0.5)) return { ok: true, end: null, already: true };
    let end;
    if (args.by === 'full') end = dur || null;
    else {
      const by = Math.max(5, Math.min(120, Number(args.by) || 30));
      // extend from whichever is later: the current end, or where the song is now (a clip that is fading out)
      end = Math.max(pb.clipEnd, Number(pb.position) || 0) + by;
      if (dur) end = Math.min(end, dur);
    }
    pb.clipEnd = end; pb.clipEndOverride = end;
    this.player({ cmd: 'clip', token: this.loadToken, clipStart: pb.clipStart, clipEnd: end });
    this.log(`Play on: "${s.title}" now ${end == null ? 'plays to the end' : 'ends at ' + Math.round(end) + ' s'}`);
    this.touch('state');
    return { ok: true, end };
  }

  /**
   * 2.6 Talkover: lower the music while the host speaks. Runtime only (never saved), and
   * always lets go by itself after `talkoverMaxSec` so a dropped phone can't leave it down.
   */
  aTalkover(args, source) {
    const on = !!args.on;
    if (this.talkoverTimer) { this._clearTimeout(this.talkoverTimer); this.talkoverTimer = null; }
    const a = this.settings.audio || {};
    const db = Math.max(-30, Math.min(-6, Number(a.talkoverDb) || -14));
    if (on) {
      const max = Math.max(5, Math.min(120, Number(a.talkoverMaxSec) || 30));
      this.talkoverTimer = this._setTimeout(() => { this.talkoverTimer = null; if (this.talkoverOn) { this.talkoverOn = null; this.player({ cmd: 'duck', on: false }); if (this.hooks.changed) this.hooks.changed('state'); } }, max * 1000);
      this.talkoverOn = { source: source || 'desktop', since: this.nowIso() };
    } else this.talkoverOn = null;
    this.player({ cmd: 'duck', on, db });
    if (this.hooks.changed) this.hooks.changed('state');
    return { ok: true, on, db };
  }

  /** A phone that was holding Talkover disconnected: let the music back up. */
  releaseTalkover(source) {
    if (this.talkoverOn && (!source || this.talkoverOn.source === source)) this.aTalkover({ on: false }, source);
  }

  aJumpTo(args) {
    const i = Number(args.index);
    if (this.game.round.number === 0) throw new Error(this.isChecklist() ? 'Start the game first.' : 'Start Round 1 first.');
    const cur = this.currentSongId();
    const pb = this.game.playback;
    if (cur && !this.isPlayed(cur) && ['playing', 'loading', 'paused'].includes(pb.status) && !this.game.skipped.includes(cur)) this.game.skipped.push(cur);
    this.loadIndex(i, { autoplay: true });
    this.touch('state');
    return { ok: true };
  }

  aMarkPlayed(args, source) {
    const id = args.songId || this.currentSongId();
    if (!id || !this.song(id)) throw new Error('No song selected');
    if (this.game.round.number === 0) throw new Error(this.isChecklist() ? 'Start the game first.' : 'Start Round 1 first.');
    const added = this.addPlayed(id, true);
    if (added) this.audit('mark-played', { songId: id, title: this.song(id).title, artist: this.song(id).artist }, source);
    this.touch('state');
    return { ok: true, added };
  }

  /** Who would be affected by removing a song from the ledger? */
  affectedBy(songId) {
    const g = this.game;
    const confirmed = g.claims.filter(c => c.status === 'confirmed' && (this.findCard(c.cardNo) || { cells: [] }).cells.includes(songId))
      .map(c => ({ claimId: c.id, cardNo: c.cardNo, cardLabel: formatCardNo(c.cardNo), round: c.round }));
    const sessions = g.claimSessions.filter(s => s.status === 'open' && s.snapshot.some(x => x.songId === songId)).map(s => s.id);
    return { confirmed, sessions };
  }

  aUnmarkPlayed(args, source) {
    const id = args.songId;
    const entry = this.ledgerEntry(id);
    if (!entry) return { ok: false, message: 'That song is not in the played history.' };
    if (entry.kind === 'credit') return this.aReverseCredit(Object.assign({}, args, { creditId: entry.creditId }), source);
    const aff = this.affectedBy(id);
    if ((aff.confirmed.length || aff.sessions.length) && !args.acknowledge) {
      return { ok: false, needsCorrection: true, affected: aff, message: `Removing this song affects ${aff.confirmed.length} confirmed winner(s)${aff.sessions.length ? ' and an open claim session' : ''}. Confirmed results are not changed automatically — confirm the correction to continue.` };
    }
    this.game.played = this.game.played.filter(p => p.songId !== id);
    aff.confirmed.forEach(c => { const cl = this.game.claims.find(x => x.id === c.claimId); if (cl) cl.review = `Song "${this.song(id).title}" was removed from the played list after confirmation — review this result.`; });
    this.audit('unmark-played', { songId: id, title: this.song(id).title, artist: this.song(id).artist, affected: aff }, source);
    this.log(`Correction: removed "${this.song(id).title}" from the played history`);
    this.touch('state');
    return { ok: true };
  }

  /* ------------------------------------------------------- technical credit */
  aGrantCredit(args, source) {
    const g = this.game;
    const id = args.songId;
    const s = this.song(id);
    if (!s) throw new Error('That song is not part of this game.');
    if (!args.confirm) throw new Error('Technical credit must be explicitly confirmed by the host.');
    if (g.round.number === 0) throw new Error('Start Round 1 first.');
    if (this.isPlayed(id)) throw new Error(`"${s.title}" already counts (${this.ledgerEntry(id).kind === 'credit' ? 'technical credit' : 'played'}).`);
    const reason = String(args.reason || '').trim() || 'Video unavailable';
    const credit = { id: uid('cr_'), songId: id, title: s.title, artist: s.artist, reason, at: this.nowIso(), round: g.round.number, confirmedBy: source || 'laptop', status: 'active', history: [] };
    g.credits.push(credit);
    this.addPlayed(id, true, 'credit', { creditId: credit.id });
    this.audit('technical-credit', { songId: id, title: s.title, artist: s.artist, reason, creditId: credit.id, hostConfirmed: true }, source);
    delete this.unavailable[id];
    // Never play a replacement; continue with the next available video if this was the current one.
    const pb = g.playback;
    let advanced = false;
    if (this.currentSongId() === id && ['playing', 'loading', 'paused', 'stopped', 'idle'].includes(pb.status)) {
      const wasPlaying = ['playing', 'loading'].includes(pb.status);
      const n = this.nextUnplayedIndex(pb.index);
      if (n >= 0) {
        if (wasPlaying && !this.activeSession() && !g.gamePaused) { this.loadIndex(n, { autoplay: true }); advanced = true; }
        else { this.player({ cmd: 'clear' }); pb.status = 'idle'; }
      }
    }
    this.touch('state');
    return { ok: true, creditId: credit.id, advanced };
  }

  aReverseCredit(args, source) {
    const g = this.game;
    const credit = g.credits.find(c => c.id === args.creditId) || g.credits.find(c => c.songId === args.songId && c.status === 'active');
    if (!credit || credit.status !== 'active') throw new Error('No active technical credit found.');
    const aff = this.affectedBy(credit.songId);
    if ((aff.confirmed.length || aff.sessions.length) && !args.acknowledge) {
      return { ok: false, needsCorrection: true, affected: aff, message: `Reversing this credit affects ${aff.confirmed.length} confirmed winner(s)${aff.sessions.length ? ' and an open claim session (its frozen snapshot will NOT change)' : ''}. Confirmed results stay as they are but will be flagged for review.` };
    }
    g.played = g.played.filter(p => !(p.songId === credit.songId && p.kind === 'credit'));
    credit.status = 'reversed';
    credit.history.push({ at: this.nowIso(), action: 'reversed', by: source || 'laptop', reason: args.reason || '' });
    aff.confirmed.forEach(c => { const cl = g.claims.find(x => x.id === c.claimId); if (cl) cl.review = `Technical credit for "${credit.title}" was reversed after this win was confirmed — review this result.`; });
    this.audit('technical-credit-reversed', { songId: credit.songId, title: credit.title, artist: credit.artist, creditId: credit.id, reason: args.reason || '', affected: aff, hostConfirmed: true }, source);
    this.log(`Technical credit REVERSED: ${credit.title}`);
    this.touch('state');
    return { ok: true };
  }

  aStartRound(args) {
    const g = this.game;
    if (g.intermission) { g.intermission = null; this.audit('intermission-end', { by: 'start-round' }); }
    const n = Number(args.round || (g.round.number + 1));
    if (this.isChecklist() && n !== 1) throw new Error('A Rules Checklist game has no rounds — press Start game once.');
    if (!Number.isInteger(n) || n < 1 || n > this.roundCount()) throw new Error(`Round must be between 1 and ${this.roundCount()}`);
    if (n < g.round.number) throw new Error(`Round ${g.round.number} has already started — rounds cannot go backwards.`);
    if (n === g.round.number && g.round.status === 'active') return { ok: true, already: true };
    if (n > g.round.number + 1 || (n === g.round.number + 1 && g.round.status === 'ready')) throw new Error(`Rounds are played in order — Round ${g.round.status === 'ready' ? g.round.number : g.round.number + 1} is next.`);
    if (n === g.round.number && g.round.status === 'ended') throw new Error(`Round ${n} has finished — use “Complete Round & Continue”.`);
    if (this.activeSession()) throw new Error('Close the open claim session before changing rounds.');
    if (g.round.number > 0 && g.round.status === 'active') g.rounds[g.round.number].endedAt = this.nowIso();
    g.round = { number: n, status: 'active' };
    g.rounds[n] = Object.assign(g.rounds[n] || {}, { startedAt: this.nowIso(), startPlayedCount: g.played.length, endedAt: null });
    if (g.status === 'finished') throw new Error('The game has finished.');
    g.status = 'live';
    g.gamePaused = false;
    this.log(`Round ${n} started — ${this.info(n).label}`);
    this.touch('round');
    const st = g.playback.status;
    if (args.play !== false && !['playing', 'loading', 'between'].includes(st)) {
      try { this.aPlay({}); } catch (e) { return { ok: true, warning: e.message }; }
    }
    return { ok: true };
  }

  /**
   * Complete the current round and prepare the next one (or finish the game after Round 3).
   * Atomic and idempotent: `fromRound` guards against double taps from laptop + phone and
   * against replays after a crash. Never awards or discards claims automatically.
   */
  aCompleteRound(args, source) {
    const g = this.game;
    if (this.isChecklist()) throw new Error('A Rules Checklist game has no rounds — rules are ticked off as they are won. Use End game to finish.');
    const n = g.round.number;
    // Replayed / duplicate command (double tap, laptop + phone, crash replay): harmless no-op.
    if (args.fromRound != null && (Number(args.fromRound) !== n || (g.round.status === 'ended' && g.status === 'finished'))) return { ok: true, already: true, round: g.round };
    if (!n || !['active', 'ended'].includes(g.round.status)) throw new Error(n ? `Round ${n} is not in progress.` : 'No round has started yet.');
    const s = this.activeSession();
    if (s) {
      const pending = s.claimIds.map(id => g.claims.find(c => c.id === id)).filter(c => c && c.status === 'pending');
      if (pending.length) return { ok: false, needsDecision: true, pending: pending.map(c => ({ claimId: c.id, cardLabel: formatCardNo(c.cardNo) })), message: `Resolve the ${pending.length} pending claim(s) (${pending.map(c => formatCardNo(c.cardNo)).join(', ')}) before completing the round.` };
      s.status = 'closed'; s.closedAt = this.nowIso(); s.closedBy = source || 'laptop';
      this.audit('claim-session-closed', { sessionId: s.id, reason: 'round completed', claims: s.claimIds.length }, source);
    }
    // stop the music — the next round starts only when the host is ready
    this.cancelAdvance();
    const pb = g.playback;
    if (['playing', 'loading'].includes(pb.status)) { pb.status = 'paused'; this.player({ cmd: 'pause' }); }
    pb.pausedForClaim = false;
    const winners = g.claims.filter(c => c.status === 'confirmed' && c.round === n).map(c => ({ claimId: c.id, cardNo: c.cardNo }));
    const at = this.nowIso();
    g.rounds[n] = Object.assign(g.rounds[n] || {}, { endedAt: g.rounds[n] && g.rounds[n].endedAt || at, completedAt: at, winners });
    const final = n >= this.roundCount();
    const tr = { id: uid('t_'), from: n, to: final ? null : n + 1, at, by: source || 'laptop', winners: winners.length };
    g.transitions.push(tr);
    let preQualified = [];
    if (final) {
      g.round = { number: 3, status: 'ended' };
      g.status = 'finished'; g.endedAt = at; pb.status = 'stopped';
      if (pb.index >= 0) this.player({ cmd: 'clear' });
    } else {
      g.round = { number: n + 1, status: 'ready' };
      // Cards that ALREADY meet the next round's pattern: notify the host; never auto-award.
      const set = this.playedSet();
      preQualified = g.cards.filter(c => rules.checkCard(c.cells, set, this.rr(n + 1)).valid).map(c => formatCardNo(c.no));
      g.rounds[n + 1] = Object.assign(g.rounds[n + 1] || {}, { preparedAt: at, preQualified });
      tr.preQualified = preQualified.length;
    }
    this.audit('round-completed', { round: n, winners: winners.length, next: final ? null : n + 1, preQualified: preQualified.length }, source);
    this.log(final ? `Round ${n} complete (final round) — game finished.` : `Round ${n} complete (${winners.length} winner${winners.length === 1 ? '' : 's'}). Ready for Round ${n + 1} — ${this.info(n + 1).label}.`);
    this.event('tvScreen', { type: 'round', from: n, to: final ? null : n + 1, fromLabel: this.info(n).label, toLabel: final ? null : this.info(n + 1).label, final, seconds: 9, pattern: final ? null : this.info(n + 1).examples[0], finalPattern: final ? this.info(n).examples[0] : null, finalLabel: final ? this.info(n).label : null });
    this.touch('round');
    return { ok: true, final, nextRound: final ? null : n + 1, winners: winners.length, preQualified };
  }

  /* ------------------------------------------------------- Up Next queue */
  assertQueueable(id) {
    const s = this.song(id); if (!s) throw new Error('That song is not part of this game.');
    if (this.isPlayed(id)) throw new Error(`"${s.title}" has already been played — it can't be played again.`);
    if (id === this.currentSongId()) throw new Error(`"${s.title}" is playing now.`);
    return s;
  }
  aQueueSong(args, source) {
    const g = this.game; const id = args.songId; const s = this.assertQueueable(id);
    g.queue = g.queue.filter(x => x !== id); g.deferred = g.deferred.filter(x => x !== id); g.excluded = g.excluded.filter(x => x !== id);
    if (args.position === 'end') g.queue.push(id); else g.queue.unshift(id);
    this.log(`Up Next: queued "${s.title}"${args.position === 'end' ? ' (end of queue)' : ' (play next)'}`);
    this.touch('state');
    return { ok: true, upNext: this.upNextView() };
  }
  aUnqueueSong(args) { this.game.queue = this.game.queue.filter(x => x !== args.songId); this.touch('state'); return { ok: true }; }
  /** Skip the proposed next song — it stays eligible and comes back later. */
  aSkipNext(args) {
    const g = this.game; const n = this.upNext();
    if (!n) return { ok: false, message: 'There is no next song.' };
    if (args.expectSongId && args.expectSongId !== n.songId) { const e = new Error('Up Next has already changed — showing the new next song.'); e.code = 'STALE'; throw e; }
    g.queue = g.queue.filter(x => x !== n.songId);
    g.deferred = g.deferred.filter(x => x !== n.songId); g.deferred.push(n.songId);
    this.log(`Up Next: skipped "${this.song(n.songId).title}" for now (still eligible)`);
    this.touch('state');
    return { ok: true, upNext: this.upNextView() };
  }
  aResetQueue() { this.game.queue = []; this.game.deferred = []; this.log('Up Next: back to the saved playlist order'); this.touch('state'); return { ok: true }; }
  aExcludeSong(args) { const s = this.assertQueueable(args.songId); const g = this.game; g.queue = g.queue.filter(x => x !== s.id); if (!g.excluded.includes(s.id)) g.excluded.push(s.id); this.log(`Excluded "${s.title}" from playback`); this.touch('state'); return { ok: true }; }
  aIncludeSong(args) { this.game.excluded = this.game.excluded.filter(x => x !== args.songId); this.touch('state'); return { ok: true }; }

  aEndRound() {
    const g = this.game;
    if (g.round.number === 0 || g.round.status !== 'active') throw new Error('No round is in progress.');
    g.round.status = 'ended';
    g.rounds[g.round.number].endedAt = this.nowIso();
    this.log(`Round ${g.round.number} ended`);
    this.touch('round');
    return { ok: true };
  }

  aPauseGame() {
    this.game.gamePaused = true;
    this.cancelAdvance();
    if (['playing', 'loading'].includes(this.game.playback.status)) { this.game.playback.status = 'paused'; this.player({ cmd: 'pause' }); }
    this.log('Game paused');
    this.touch('state');
    return { ok: true };
  }

  aResumeGame() {
    this.game.gamePaused = false;
    this.log('Game resumed');
    const st = this.game.playback.status;
    if (this.game.round.number > 0 && !['playing', 'loading'].includes(st)) {
      try { return this.aPlay({}); } catch (e) { this.touch('state'); return { ok: true, warning: e.message }; }
    }
    this.touch('state');
    return { ok: true };
  }

  aEndGame() {
    const g = this.game;
    const s = this.activeSession();
    if (s && s.claimIds.some(id => (g.claims.find(c => c.id === id) || {}).status === 'pending')) throw new Error('A claim session still has undecided valid claims — confirm or reject them first.');
    if (s) { s.status = 'closed'; s.closedAt = this.nowIso(); }
    this.cancelAdvance();
    if (g.playback.index >= 0) this.player({ cmd: 'clear' });
    g.playback.status = 'stopped';
    if (g.round.number > 0 && g.round.status === 'active') { g.round.status = 'ended'; g.rounds[g.round.number].endedAt = this.nowIso(); }
    g.status = 'finished';
    g.endedAt = this.nowIso();
    this.log('Game ended');
    this.touch('round');
    return { ok: true };
  }

  aReopenGame() {
    const g = this.game;
    g.status = g.round.number > 0 ? 'live' : 'setup';
    g.playback.status = g.playback.index >= 0 ? 'paused' : 'idle';
    g.playback.recovered = true;
    this.log('Game re-opened');
    this.touch('round');
    return { ok: true };
  }

  aReshuffle() {
    const g = this.game;
    if (g.played.length || g.round.number > 0) throw new Error('The play order is locked once the game has started.');
    g.order = this.settings.spreadArtists !== false ? spreadShuffle(g.order, id => artistKey((this.song(id) || {}).artist)) : shuffle(g.order);
    g.playback.index = -1;
    this.log('Play order reshuffled');
    this.touch('state');
    return { ok: true };
  }

  aSetCrawler(args) {
    const c = this.settings.crawler;
    if (args.speed != null) c.speed = Math.max(1, Math.min(10, Math.round(Number(args.speed))));
    if (args.fontSize != null) c.fontSize = Math.max(16, Math.min(72, Math.round(Number(args.fontSize))));
    if (args.height != null) c.height = Math.max(40, Math.min(160, Math.round(Number(args.height))));
    if (args.separator != null && ['diamond', 'bar', 'dot', 'star', 'note'].includes(args.separator)) c.separator = args.separator;
    if (args.paused != null) c.paused = !!args.paused;
    if (args.togglePause) c.paused = !c.paused;
    this.touch('audience', false);
    return { ok: true, crawler: c };
  }

  aSetOverlay(args) {
    const o = this.settings.overlay;
    if (args.enabled != null) o.enabled = !!args.enabled;
    if (args.position && ['bottom-left', 'bottom-center', 'top-left'].includes(args.position)) o.position = args.position;
    if (args.titleSize != null) o.titleSize = Math.max(24, Math.min(140, Number(args.titleSize)));
    if (args.artistSize != null) o.artistSize = Math.max(16, Math.min(100, Number(args.artistSize)));
    if (args.opacity != null) o.opacity = Math.max(0, Math.min(1, Number(args.opacity)));
    if (args.duration != null) o.duration = Math.max(0, Number(args.duration));
    if (args.revealDelay != null) o.revealDelay = Math.max(0, Math.min(60, Math.round(Number(args.revealDelay) || 0)));
    this.touch('audience', false);
    return { ok: true };
  }

  aSetGameSettings(args) {
    const s = this.settings;
    ['autoAdvance', 'shuffle', 'pauseOnClaim', 'winnerAnimation', 'skipIntros', 'spreadArtists'].forEach(k => { if (args[k] != null) s[k] = !!args[k]; });
    if (args.autoAdvanceGap != null) s.autoAdvanceGap = Math.max(0, Math.min(30, Number(args.autoAdvanceGap)));
    if (args.defaultStart != null) s.defaultStart = Math.max(0, Number(args.defaultStart));
    if (args.patternPosition && ['top-right', 'top-left', 'bottom-right', 'bottom-left'].includes(args.patternPosition)) s.patternPosition = args.patternPosition;
    if (args.afterWinner && ['ask', 'intermission'].includes(args.afterWinner)) s.afterWinner = args.afterWinner;
    if (args.intermissionMinutes != null) s.intermissionMinutes = Math.max(0, Math.min(120, Number(args.intermissionMinutes) || 0));
    if (args.intermissionMessage != null) s.intermissionMessage = String(args.intermissionMessage).slice(0, 140);
    if (args.clipMode != null) this.aClipMode({ clipMode: args.clipMode });
    this.touch('audience');
    return { ok: true };
  }

  /** Per-game song edits. Locked games: printed identity is fixed — only clip points may change. */
  aUpdateSong(args) {
    const s = this.song(args.songId);
    if (!s) throw new Error('Song not in this game');
    const labelKeys = ['displayTitle', 'title', 'artist', 'printTitle'];
    if (this.game.cardsLocked && labelKeys.some(k => typeof args[k] === 'string')) throw new Error('Cards for this game are locked — song titles and artists can no longer be changed in this game.');
    ['clipStart', 'clipEnd'].forEach(k => { if (k in args) s[k] = args[k] === null || args[k] === '' ? null : Math.max(0, Number(args[k])); });
    labelKeys.forEach(k => { if (typeof args[k] === 'string' && args[k].trim()) s[k] = args[k].trim(); });
    this.touch('state');
    return { ok: true };
  }

  /* -------------------------------------------- CLAIM FREEZE / claim sessions */
  /**
   * Freeze claims: pause playback and snapshot the eligibility ledger. Atomic and
   * idempotent — if a session is already open, it is returned (never two sessions).
   */
  aFreeze(args, source) {
    const g = this.game;
    const open = this.activeSession();
    if (open) return { ok: true, sessionId: open.id, existing: true, paused: !!g.playback.pausedForClaim };
    if (!g.round.number) throw new Error(this.isChecklist() ? 'Start the game first.' : 'No round has started yet.');
    if (this.isChecklist() && g.checklistClosed) throw new Error('All rules are completed and claims are closed — the music continues without further Bingo claims.');
    const pb = g.playback;
    const prevStatus = pb.status;
    let paused = false;
    if (['playing', 'loading'].includes(pb.status)) { pb.status = 'paused'; this.player({ cmd: 'pause' }); paused = true; }
    else if (pb.status === 'between') { this.cancelAdvance(); paused = true; }
    pb.pausedForClaim = paused;
    const session = {
      id: 'S' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      status: 'open', openedAt: this.nowIso(), openedBy: source || 'laptop',
      round: g.round.number, roundStatus: g.round.status,
      snapshot: g.played.map(p => ({ songId: p.songId, kind: p.kind || 'played' })),
      playback: { index: pb.index, position: pb.position, status: prevStatus },
      resumeTo: paused ? (prevStatus === 'between' ? 'between' : 'playing') : null,
      claimIds: []
    };
    g.claimSessions.push(session);
    this.audit('claim-freeze', { sessionId: session.id, round: session.round, snapshotCount: session.snapshot.length, position: session.playback.position }, source);
    this.log(`CLAIMS FROZEN (${session.id}) at ${session.snapshot.length} eligible songs — music ${paused ? 'paused' : 'not playing'}`);
    this.touch('claims', true);
    return { ok: true, sessionId: session.id, paused };
  }

  findCard(no) { return this.game.cards.find(c => c.no === no); }
  cardMatchesGame(gameId) { return gameId === this.game.id || gameId === this.game.cardSetId || (this.game.aliasIds || []).includes(gameId); }

  parseCardInput(args) {
    if (args.qr) {
      const q = parseQrPayload(args.qr);
      if (!q) return { error: 'That QR code is not an Anthem Square card.' };
      if (!this.cardMatchesGame(q.gameId)) return { error: 'That card belongs to a different game. Only cards printed for this game can win.' };
      return { cardNo: q.cardNo };
    }
    const cardNo = parseInt(String(args.cardNo || '').trim(), 10);
    if (!Number.isInteger(cardNo) || cardNo < 1 || cardNo > 999) return { error: 'Enter a card number between 1 and 999.' };
    return { cardNo };
  }

  /** Add (and check) a claimed card inside the open session — auto-freezes if needed. */
  aAddClaim(args, source) {
    const g = this.game;
    const parsed = this.parseCardInput(args);
    if (parsed.error) return { ok: false, error: parsed.error };
    const card = this.findCard(parsed.cardNo);
    if (!card) return { ok: false, error: `Card ${formatCardNo(parsed.cardNo)} does not exist in this game.` };
    let session = this.activeSession();
    if (!session) { this.aFreeze({}, source); session = this.activeSession(); }
    // Duplicate entry of the same card in this session: show the same result, no new claim.
    const existing = g.claims.find(c => c.sessionId === session.id && c.cardNo === card.no && c.status !== 'removed');
    if (existing) return Object.assign(this.claimView(existing), { duplicateEntry: true });
    const res = this.evaluate(card, session.round, session.snapshot.map(x => x.songId), session.snapshot, session.id);
    const alreadyWinner = this.isChecklist() ? (res.checklist.onlyCompleted && res.checklist.alreadyWon.length && !res.checklist.alreadyCompleted.length) : g.claims.find(c => c.cardNo === card.no && c.round === session.round && c.status === 'confirmed');
    const claim = {
      id: uid('c_'), sessionId: session.id, cardNo: card.no, round: session.round, at: this.nowIso(), source,
      valid: res.valid, headline: res.headline, reason: res.reason, playedCount: session.snapshot.length, winningCells: res.winningCells,
      status: alreadyWinner ? 'duplicate' : (res.valid ? 'pending' : 'invalid')
    };
    g.claims.push(claim);
    session.claimIds.push(claim.id);
    this.audit('claim-check', { sessionId: session.id, claimId: claim.id, cardNo: card.no, valid: res.valid, headline: res.headline }, source);
    this.log(`BINGO check [${session.id}]: card ${formatCardNo(card.no)} — ${res.valid ? 'VALID' : 'NOT VALID'} (${res.headline})`);
    this.touch('claims', true);
    return this.claimView(claim);
  }

  aViewClaim(args) {
    const c = this.game.claims.find(x => x.id === args.claimId);
    if (!c) throw new Error('Claim not found');
    return this.claimView(c);
  }

  sessionPlayedIds(session) { return session ? session.snapshot.map(x => x.songId) : this.game.played.map(p => p.songId); }

  /** Full result for one claim, always re-computed from its session's frozen snapshot. */
  claimView(claim) {
    const g = this.game;
    const session = g.claimSessions.find(s => s.id === claim.sessionId) || null;
    const card = this.findCard(claim.cardNo);
    const ids = this.sessionPlayedIds(session);
    const res = this.evaluate(card, claim.round, ids, session ? session.snapshot : null, claim.sessionId);
    const ck = this.isChecklist();
    return {
      mode: ck ? 'checklist' : 'rounds', checklist: ck ? Object.assign({}, res.checklist, { awarded: claim.itemId ? { itemId: claim.itemId, label: claim.itemLabel } : null }) : null,
      ok: true, claimId: claim.id, sessionId: claim.sessionId || null, status: claim.status, cardNo: claim.cardNo, cardLabel: formatCardNo(claim.cardNo), owner: this.ownerOf(claim.cardNo), round: claim.round,
      roundLabel: ck ? 'RULES CHECKLIST' : this.info(claim.round).label, roundStatus: g.round.status,
      valid: res.valid, headline: res.headline, reason: res.reason,
      alreadyWinner: claim.status === 'duplicate' || (!ck && claim.status !== 'confirmed' && g.claims.some(c => c.cardNo === claim.cardNo && c.round === claim.round && c.status === 'confirmed')),
      otherRoundWins: ck ? [] : g.claims.filter(c => c.cardNo === claim.cardNo && c.status === 'confirmed' && c.round !== claim.round).map(c => c.round),
      otherRuleWins: ck ? g.claims.filter(c => c.cardNo === claim.cardNo && c.status === 'confirmed' && c.id !== claim.id).map(c => c.itemLabel) : [],
      qualifiedAtSong: res.qualifiedAtSong, completingSong: res.completingSong || null, explanation: res.explanation,
      best: res.best ? { description: res.best.description, missing: res.best.missing, missingCells: res.best.missingCells, cells: res.best.cells } : null,
      roundRule: ck ? 'Any open rule, in any order' : this.info(claim.round).rule, playedCount: ids.length,
      printed: !!card.printed, review: claim.review || null,
      handedOut: this.isHandedOut(claim.cardNo), handedOutSpec: this.handedOutInfo().spec,
      grid: res.grid, winningCells: res.winningCells, lines: res.lines
    };
  }

  evaluate(card, round, playedIds, snapshot, sessionId) {
    const set = new Set(playedIds);
    if (this.isChecklist()) return this.evaluateChecklist(card, set, playedIds, snapshot, sessionId);
    const res = rules.checkCard(card.cells, set, this.rr(round));
    const win = new Set(res.winningCells);
    const order = new Map(playedIds.map((id, i) => [id, i + 1]));
    const kinds = new Map((snapshot || this.game.played.map(p => ({ songId: p.songId, kind: p.kind }))).map(x => [x.songId, x.kind || 'played']));
    res.best = res.valid ? null : rules.bestProgress(card.cells, set, this.rr(round));
    const bestCells = new Set(res.best ? res.best.cells : []);
    const needed = new Set(res.best ? res.best.missingCells : []);
    res.qualifiedAtSong = res.valid ? rules.qualifiedAt(card.cells, playedIds, this.rr(round)) : null;
    const completingId = res.qualifiedAtSong ? playedIds[res.qualifiedAtSong - 1] : null;
    res.grid = card.cells.map((id, i) => {
      const s = this.song(id) || { title: '?', artist: '' };
      const label = (this.game.cardsLocked && this.game.lockedLabels && this.game.lockedLabels[id]) || null;
      return { songId: id, title: label ? label.title : (s.displayTitle || s.title), artist: s.artist, played: set.has(id), credit: set.has(id) && kinds.get(id) === 'credit', playedNo: order.get(id) || null, winning: win.has(i), inBest: bestCells.has(i), needed: needed.has(i), completing: id === completingId };
    });
    if (completingId) { const cs = this.song(completingId) || {}; res.completingSong = { n: res.qualifiedAtSong, songId: completingId, title: cs.displayTitle || cs.title, artist: cs.artist, credit: kinds.get(completingId) === 'credit' }; }
    res.explanation = rules.explainClaim(formatCardNo(card.no), this.rr(round), res, res.best);
    return res;
  }

  /**
   * Checklist claim check — the SAME rule engine, given every still-open rule at once.
   * Reports each rule the card qualifies for; the host then picks the one to award.
   */
  evaluateChecklist(card, set, playedIds, snapshot, sessionId) {
    const q = this.ckQualify(card, set, sessionId);
    const elig = q.eligible;
    const checkSet = this.ckRuleSet(elig.length ? elig : (q.open.length ? q.open : this.ckItems()));
    const res = rules.checkCard(card.cells, set, checkSet);
    res.valid = elig.length > 0;
    const lab = (it) => this.ckInfo(it).label;
    res.checklist = {
      qualifying: elig.map(it => ({ itemId: it.id, label: lab(it) })),
      alreadyCompleted: q.completed.map(it => ({ itemId: it.id, label: lab(it) })),
      alreadyWon: q.alreadyWon.map(it => ({ itemId: it.id, label: lab(it) })),
      available: q.open.map(it => ({ itemId: it.id, label: lab(it) })),
      onlyCompleted: !elig.length && (q.completed.length > 0 || q.alreadyWon.length > 0)
    };
    if (!res.valid) { res.winningCells = []; res.lines = []; }
    const win = new Set(res.winningCells);
    const order = new Map(playedIds.map((id, i) => [id, i + 1]));
    const kinds = new Map((snapshot || this.game.played.map(p => ({ songId: p.songId, kind: p.kind }))).map(x => [x.songId, x.kind || 'played']));
    res.best = res.valid || !q.open.length ? null : rules.bestProgress(card.cells, set, this.ckRuleSet(q.open));
    const bestCells = new Set(res.best ? res.best.cells : []); const needed = new Set(res.best ? res.best.missingCells : []);
    res.qualifiedAtSong = res.valid ? rules.qualifiedAt(card.cells, playedIds, this.ckRuleSet(elig)) : null;
    const completingId = res.qualifiedAtSong ? playedIds[res.qualifiedAtSong - 1] : null;
    res.grid = card.cells.map((id, i) => {
      const s = this.song(id) || { title: '?', artist: '' };
      const label = (this.game.cardsLocked && this.game.lockedLabels && this.game.lockedLabels[id]) || null;
      return { songId: id, title: label ? label.title : (s.displayTitle || s.title), artist: s.artist, played: set.has(id), credit: set.has(id) && kinds.get(id) === 'credit', playedNo: order.get(id) || null, winning: win.has(i), inBest: bestCells.has(i), needed: needed.has(i), completing: id === completingId };
    });
    if (completingId) { const cs = this.song(completingId) || {}; res.completingSong = { n: res.qualifiedAtSong, songId: completingId, title: cs.displayTitle || cs.title, artist: cs.artist, credit: kinds.get(completingId) === 'credit' }; }
    const cardL = 'Card #' + formatCardNo(card.no);
    if (res.valid) {
      res.headline = 'Valid for: ' + res.checklist.qualifying.map(x => x.label).join(', ');
      res.reason = elig.length > 1 ? 'This card qualifies for more than one rule — choose which one to award.' : 'Confirm to award this rule.';
      res.explanation = `${cardL} — VALID for ${res.checklist.qualifying.map(x => x.label).join(' and ')}.${elig.length > 1 ? ' Choose ONE rule to award.' : ''}`;
    } else if (res.checklist.onlyCompleted) {
      const names = res.checklist.alreadyCompleted.concat(res.checklist.alreadyWon).map(x => x.label);
      res.headline = 'RULE ALREADY COMPLETED';
      res.reason = `${names.join(', ')} ${names.length > 1 ? 'have' : 'has'} already been awarded${res.checklist.alreadyWon.length ? ' (this card already won it)' : ''}. No other open rule is complete on this card.`;
      res.explanation = `${cardL}: ${res.reason}`;
    } else {
      res.headline = 'NOT A VALID BINGO';
      res.reason = !q.open.length ? 'Every rule has already been completed.' : (res.best ? `The closest open rule is ${res.best.description}, which still needs ${res.best.missing} song${res.best.missing === 1 ? '' : 's'}.` : 'No open rule is complete on this card.');
      res.explanation = `Not a Bingo! ${cardL} doesn't complete any open rule. ${res.reason} Open rules: ${q.open.map(lab).join(', ') || 'none'}.`;
    }
    return res;
  }

  aConfirmClaim(args, source) {
    const g = this.game;
    const claim = g.claims.find(c => c.id === args.claimId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status === 'confirmed') return { ok: true, already: true };
    if (['removed', 'dismissed', 'rejected'].includes(claim.status)) throw new Error('This claim was ' + claim.status + ' — check the card again to re-open it.');
    const session = g.claimSessions.find(s => s.id === claim.sessionId);
    if (session && session.status !== 'open') throw new Error('That claim session is closed.');
    if (this.isChecklist()) return this.confirmChecklistClaim(claim, session, args, source);
    if (g.claims.some(c => c.cardNo === claim.cardNo && c.round === claim.round && c.status === 'confirmed')) throw new Error(`Card ${formatCardNo(claim.cardNo)} is already a confirmed winner in this round.`);
    // Re-verify against the SAME frozen snapshot — other winners never invalidate this claim.
    const card = this.findCard(claim.cardNo);
    const res = rules.checkCard(card.cells, new Set(this.sessionPlayedIds(session)), this.rr(claim.round));
    if (!res.valid) throw new Error('This card does not meet the winning rule for its claim snapshot.');
    claim.status = 'confirmed';
    claim.confirmedAt = this.nowIso();
    claim.confirmedBy = source || 'laptop';
    claim.headline = res.headline;
    this.audit('winner-confirmed', { sessionId: claim.sessionId, claimId: claim.id, cardNo: claim.cardNo, round: claim.round, headline: res.headline }, source);
    this.log(`WINNER confirmed: card ${formatCardNo(claim.cardNo)}, Round ${claim.round} (${res.headline})`);
    if (this.settings.winnerAnimation) this.event('celebrate', { round: claim.round, label: this.info(claim.round).label });
    if (this.settings.tvScreens.winner) this.tvScreen('winner', claim, res);
    this.touch('claims');
    return this.claimView(claim);
  }

  /** Award ONE rule to a checklist claim (re-verified on the frozen snapshot). */
  confirmChecklistClaim(claim, session, args, source) {
    const card = this.findCard(claim.cardNo);
    const q = this.ckQualify(card, new Set(this.sessionPlayedIds(session)), claim.sessionId);
    let item = args.itemId ? this.ckItem(args.itemId) : null;
    if (!item) {
      if (q.eligible.length === 1) item = q.eligible[0];
      else if (!q.eligible.length) throw new Error('This card does not complete any open rule for its claim snapshot.');
      else throw new Error('This card qualifies for more than one rule — choose which rule to award.');
    }
    if (!q.eligible.includes(item)) {
      if (this.ckWinners(item.id).some(c => c.cardNo === claim.cardNo)) throw new Error(`Card ${formatCardNo(claim.cardNo)} has already won ${this.ckInfo(item).label}.`);
      if (!q.open.includes(item)) throw new Error(`RULE ALREADY COMPLETED — ${this.ckInfo(item).label} has already been awarded.`);
      throw new Error(`Card ${formatCardNo(claim.cardNo)} does not complete ${this.ckInfo(item).label} on the frozen song list.`);
    }
    const label = this.ckInfo(item).label;
    const firstForRule = !this.ckWinners(item.id).length;
    claim.status = 'confirmed'; claim.confirmedAt = this.nowIso(); claim.confirmedBy = source || 'laptop';
    claim.itemId = item.id; claim.itemLabel = label;
    const res = rules.checkCard(card.cells, new Set(this.sessionPlayedIds(session)), this.ckRuleSet([item]));
    claim.headline = `${label} — ${res.headline}`;
    this.audit('winner-confirmed', { sessionId: claim.sessionId, claimId: claim.id, cardNo: claim.cardNo, rule: item.id, ruleLabel: label, headline: res.headline }, source);
    this.log(`WINNER confirmed: card ${formatCardNo(claim.cardNo)} — ${label}${firstForRule ? ' (rule completed)' : ' (simultaneous winner)'}`);
    if (this.settings.winnerAnimation) this.event('celebrate', { label });
    this.event('ruleCompleted', { itemId: item.id, label, first: firstForRule });
    if (this.settings.tvScreens.winner) {
      const p = { type: 'winner', checklist: true, label, seconds: Math.max(3, Math.min(30, Number(this.settings.tvScreens.seconds) || 7)), winners: this.ckWinners(item.id).length, pattern: Array.from({ length: 25 }, (_, i) => res.winningCells.includes(i)), last: this.checklistView().allDone };
      if (this.settings.tvScreens.showCardNumber) p.cardLabel = formatCardNo(claim.cardNo);
      if (this.settings.tvScreens.showName !== false) { const n = this.ownerOf(claim.cardNo); if (n) p.names = [n]; }
      this.event('tvScreen', p);
    }
    this.touch('claims');
    return this.claimView(claim);
  }

  aDismissClaim(args, source) {
    const claim = this.game.claims.find(c => c.id === args.claimId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status === 'confirmed') throw new Error('Use "Undo winner" to remove a confirmed winner.');
    claim.status = claim.valid ? 'dismissed' : 'rejected';
    claim.decidedAt = this.nowIso();
    if (claim.status === 'rejected' && this.settings.tvScreens.wrongClaim && !args.quiet) this.tvScreen('wrong', claim);
    this.audit('claim-' + claim.status, { sessionId: claim.sessionId, claimId: claim.id, cardNo: claim.cardNo }, source);
    this.log(`Claim for card ${formatCardNo(claim.cardNo)} ${claim.status}`);
    this.touch('claims');
    return this.claimView(claim);
  }

  /** Remove an accidentally entered card from the session (kept in the audit trail). */
  /**
   * TV winner / wrong-claim screen. Only round, pattern and (if the host enabled it)
   * the card number are sent — never the card's songs or other claim details.
   */
  tvScreen(type, claim, res) {
    const t = this.settings.tvScreens;
    const session = this.game.claimSessions.find(s => s.id === claim.sessionId);
    const winnersInSession = session ? session.claimIds.map(id => this.game.claims.find(c => c.id === id)).filter(c => c && c.status === 'confirmed').length : 1;
    const ck = this.isChecklist();
    const payload = ck ? { type, checklist: true, last: this.checklistView().allDone, label: claim.itemLabel || 'BINGO', seconds: Math.max(3, Math.min(30, Number(t.seconds) || 7)), winners: claim.itemId ? this.ckWinners(claim.itemId).length : 1 }
      : { type, round: claim.round, last: claim.round >= this.roundCount(), label: this.info(claim.round).label, seconds: Math.max(3, Math.min(30, Number(t.seconds) || 7)), winners: winnersInSession };
    if (ck && type === 'wrong') payload.label = 'NOT A VALID BINGO';
    if (t.showCardNumber) payload.cardLabel = formatCardNo(claim.cardNo);
    // winner names (phone players / named cards) — never on the "Not a Bingo" screen
    if (type === 'winner' && t.showName !== false && ck) { const n = this.ownerOf(claim.cardNo); if (n) payload.names = [n]; }
    else if (type === 'winner' && t.showName !== false && session) {
      const names = session.claimIds.map(id => this.game.claims.find(c => c.id === id)).filter(c => c && c.status === 'confirmed').map(c => this.ownerOf(c.cardNo)).filter(Boolean);
      if (names.length) payload.names = names;
    } else if (type === 'winner' && t.showName !== false) { const n = this.ownerOf(claim.cardNo); if (n) payload.names = [n]; }
    if (type === 'winner' && res) payload.pattern = Array.from({ length: 25 }, (_, i) => res.winningCells.includes(i));
    this.event('tvScreen', payload);
  }

  aShowTvScreen(args) {
    const claim = this.game.claims.find(c => c.id === args.claimId);
    if (!claim) throw new Error('Claim not found');
    const type = args.type === 'wrong' ? 'wrong' : 'winner';
    if (type === 'winner' && claim.status !== 'confirmed') throw new Error('Only a confirmed winner can be shown as a winner.');
    if (type === 'wrong' && claim.valid) throw new Error('This claim is valid.');
    const item = claim.itemId ? this.ckItem(claim.itemId) : null;
    const res = type === 'winner' ? rules.checkCard(this.findCard(claim.cardNo).cells, new Set(this.sessionPlayedIds(this.game.claimSessions.find(s => s.id === claim.sessionId))), item ? this.ckRuleSet([item]) : this.rr(claim.round)) : null;
    this.tvScreen(type, claim, res);
    return { ok: true };
  }

  /** Welcome (before Round 1) and end-of-night TV screens. */
  aSetScreens(args) {
    const sc = this.settings.screens;
    if (args.welcome != null) sc.welcome = !!args.welcome;
    if (args.end != null) sc.end = !!args.end;
    if (args.startTime != null) {
      const t = String(args.startTime).trim();
      if (t && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error('Start time must look like 20:00');
      sc.startTime = t;
    }
    if (args.message != null) sc.message = String(args.message).slice(0, 120);
    this.touch('audience', false);
    return { ok: true, screens: sc };
  }

  aSetTvScreens(args) {
    const t = this.settings.tvScreens;
    ['winner', 'wrongClaim', 'showCardNumber', 'showName', 'closeCount'].forEach(k => { if (args[k] != null) t[k] = !!args[k]; });
    if (args.seconds != null) t.seconds = Math.max(3, Math.min(30, Number(args.seconds)));
    this.touch('state', false);
    return { ok: true, tvScreens: t };
  }

  aRemoveClaim(args, source) {
    const claim = this.game.claims.find(c => c.id === args.claimId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status === 'confirmed') throw new Error('A confirmed winner cannot be removed — use "Undo winner".');
    claim.status = 'removed';
    claim.removedAt = this.nowIso();
    this.audit('claim-removed', { sessionId: claim.sessionId, claimId: claim.id, cardNo: claim.cardNo }, source);
    this.touch('claims');
    return { ok: true };
  }

  /**
   * Close the claim session. Pending (valid, undecided) claims are never dismissed
   * silently: the host must decide them, or explicitly pass dismissPending.
   */
  aCloseSession(args, source) {
    const g = this.game;
    const s = this.activeSession();
    if (!s) {
      // legacy behaviour: resume if asked
      if (args.resume && g.playback.status === 'paused' && g.round.number) { try { this.aPlay({}); } catch (e) { /* */ } }
      return { ok: true, noSession: true };
    }
    const pending = s.claimIds.map(id => g.claims.find(c => c.id === id)).filter(c => c && c.status === 'pending');
    if (pending.length && !args.dismissPending) {
      return { ok: false, needsDecision: true, pending: pending.map(c => ({ claimId: c.id, cardLabel: formatCardNo(c.cardNo) })), message: `${pending.length} valid claim(s) are still undecided (${pending.map(c => formatCardNo(c.cardNo)).join(', ')}). Confirm or reject them before closing.` };
    }
    pending.forEach(c => { c.status = 'dismissed'; c.decidedAt = this.nowIso(); c.note = 'Dismissed by host when closing the claim session'; });
    s.status = 'closed'; s.closedAt = this.nowIso(); s.closedBy = source || 'laptop';
    this.audit('claim-session-closed', { sessionId: s.id, claims: s.claimIds.length, dismissedPending: pending.length }, source);
    this.log(`Claim session ${s.id} closed`);
    const pb = g.playback;
    let resumed = false;
    if (args.resume) {
      pb.pausedForClaim = false;
      try {
        if (s.resumeTo === 'between' || (pb.status === 'idle' && s.resumeTo)) { this.scheduleAdvance(); if (pb.status !== 'between') this.aPlay({}); }
        else if (pb.status === 'paused') this.aPlay({});
        resumed = true;
      } catch (e) { /* nothing to resume */ }
    } else if (s.resumeTo === 'between' && pb.status === 'idle') { /* stays idle until host plays */ }
    let next = null;
    if (this.isChecklist()) {
      const won = s.claimIds.some(id => { const c = g.claims.find(x => x.id === id); return c && c.status === 'confirmed'; });
      const cv = this.checklistView();
      if (won && cv.allDone && !g.checklistClosed && g.status !== 'finished') { next = { ask: true, checklistDone: true, total: cv.total }; this.event('checklistDone', next); }
      this.touch('claims');
      return { ok: true, resumed, sessionId: s.id, next };
    }
    // The round now has a winner and the host has finished checking claims → what's next?
    const r = g.round;
    const winners = g.claims.filter(c => c.status === 'confirmed' && c.round === r.number).length;
    const newWin = s.claimIds.some(id => { const c = g.claims.find(x => x.id === id); return c && c.status === 'confirmed' && c.round === r.number; });
    if (newWin && winners && ['active', 'ended'].includes(r.status) && g.status !== 'finished') {
      const final = r.number >= this.roundCount();
      if (!final && this.settings.afterWinner === 'intermission') {
        try { next = Object.assign({ auto: 'intermission' }, this.aStartIntermission({ minutes: this.settings.intermissionMinutes }, 'auto')); } catch (e) { next = null; }
      } else {
        next = { ask: true, round: r.number, winners, final, nextRound: final ? null : r.number + 1, nextLabel: final ? null : this.info(r.number + 1).label, minutes: this.settings.intermissionMinutes };
        this.event('roundWon', next);
      }
    }
    this.touch('claims');
    return { ok: true, resumed, sessionId: s.id, next };
  }

  aRevokeWinner(args, source) {
    const claim = this.game.claims.find(c => c.id === args.claimId);
    if (!claim || claim.status !== 'confirmed') throw new Error('That claim is not a confirmed winner.');
    claim.status = 'revoked';
    claim.revokedAt = this.nowIso(); if (args.reason) claim.revokeReason = String(args.reason).slice(0, 200);
    if (claim.itemId && this.game.checklistClosed && !this.checklistView().allDone) this.game.checklistClosed = false; // a rule is open again
    this.audit('winner-revoked', { claimId: claim.id, cardNo: claim.cardNo, round: claim.round, rule: claim.itemId || null, ruleLabel: claim.itemLabel || null, reason: args.reason || null }, source);
    this.log(`Winner REVOKED: card ${formatCardNo(claim.cardNo)}, ${claim.itemLabel ? claim.itemLabel : 'Round ' + claim.round}`);
    this.touch('claims');
    return { ok: true };
  }

  /** Checklist correction: move a confirmed award to another rule the card really completed (same frozen snapshot). */
  aChangeAward(args, source) {
    if (!this.isChecklist()) throw new Error('Only a Rules Checklist game awards rules.');
    const g = this.game; const claim = g.claims.find(c => c.id === args.claimId);
    if (!claim || claim.status !== 'confirmed') throw new Error('That claim is not a confirmed winner.');
    const item = this.ckItem(args.itemId); if (!item) throw new Error('Unknown rule.');
    if (item.id === claim.itemId) return { ok: true, unchanged: true };
    const session = g.claimSessions.find(x => x.id === claim.sessionId);
    const q = this.ckQualify(this.findCard(claim.cardNo), new Set(this.sessionPlayedIds(session)), claim.sessionId);
    if (!q.eligible.includes(item)) throw new Error(q.open.includes(item) ? `Card ${formatCardNo(claim.cardNo)} did not complete ${this.ckInfo(item).label} when it was checked.` : `RULE ALREADY COMPLETED — ${this.ckInfo(item).label} has already been awarded.`);
    const from = claim.itemLabel; claim.itemId = item.id; claim.itemLabel = this.ckInfo(item).label;
    claim.headline = `${claim.itemLabel} — corrected`;
    if (g.checklistClosed && !this.checklistView().allDone) g.checklistClosed = false;
    this.audit('winner-corrected', { claimId: claim.id, cardNo: claim.cardNo, from, to: claim.itemLabel, reason: args.reason || null }, source);
    this.log(`Award corrected: card ${formatCardNo(claim.cardNo)} — ${from} → ${claim.itemLabel}`);
    this.touch('claims');
    return { ok: true };
  }

  /* ------------------------------------------------------------ state views */
  historyView() {
    return this.game.played.map((p, i) => {
      const s = this.song(p.songId) || {};
      return { n: i + 1, songId: p.songId, title: s.displayTitle || s.title, artist: s.artist, round: p.round, manual: p.manual, kind: p.kind || 'played', at: p.at };
    });
  }

  /**
   * Intermission: a break between rounds. Completes the current round if it has a winner
   * (so the next round is READY), pauses the music, and the TV shows a break screen with a
   * countdown, the host's message and the next round's pattern. Starting the next round
   * (or "End intermission") brings the game back.
   */
  aStartIntermission(args, source) {
    const g = this.game; const r = g.round;
    if (g.status === 'finished') throw new Error('The game has ended.');
    if (!r.number) throw new Error('Start Round 1 first.');
    if (this.activeSession()) throw new Error('Close the open claim session first.');
    if (['active', 'ended'].includes(r.status) && !this.isChecklist()) {
      if (r.number >= this.roundCount()) throw new Error('This is the last round — complete the game instead.');
      this.aCompleteRound({ fromRound: r.number }, source);
    }
    const pb = g.playback;
    if (['playing', 'loading'].includes(pb.status)) { pb.status = 'paused'; this.player({ cmd: 'pause' }); }
    this.cancelAdvance();
    const minutes = Math.max(0, Math.min(120, Number(args.minutes != null ? args.minutes : this.settings.intermissionMinutes) || 0));
    g.intermission = { at: this.nowIso(), until: minutes ? new Date(this._now() + minutes * 60000).toISOString() : null, minutes, message: String(args.message != null ? args.message : (this.settings.intermissionMessage || '')).slice(0, 140) };
    this.audit('intermission-start', { minutes, round: g.round.number }, source);
    this.log(`Intermission${minutes ? ` (${minutes} min)` : ''} — next: Round ${g.round.number}`);
    this.touch('state', true);
    return { ok: true, intermission: g.intermission, nextRound: g.round.number };
  }
  aEndIntermission(args, source) {
    const g = this.game; if (!g.intermission) return { ok: true, already: true };
    g.intermission = null;
    this.audit('intermission-end', {}, source);
    this.touch('state', true);
    return { ok: true };
  }

  /* ------------------------------------------------ Quiz Intermission Mode (2.1)
   * The whole evening is one game. "Return to Quiz" pauses wherever the bingo is (any
   * round, mid-song, even with a claim session open), keeps the exact video position and
   * hides the TV window so the host's quiz shows. "Start Bingo Break" brings it back.
   * Nothing is completed, reshuffled or regenerated by switching. */
  confirmedCount() { return this.game.claims.filter(c => c.status === 'confirmed').length; }
  openBreak() { const b = this.game.night.breaks; const last = b[b.length - 1]; return last && !last.endedAt ? last : null; }
  aReturnToQuiz(args, source) {
    const g = this.game; const n = g.night; const pb = g.playback;
    if (g.status === 'finished') throw new Error('The game has ended.');
    if (n.phase === 'quiz') return { ok: true, already: true };
    this.cancelAdvance();
    const wasPlaying = ['playing', 'loading'].includes(pb.status);
    if (wasPlaying) { pb.status = 'paused'; this.player({ cmd: 'pause' }); }
    // the first stretch of bingo (before any switch) counts as break 1
    if (!n.breaks.length && (g.played.length || g.round.number)) n.breaks.push({ n: 1, startedAt: (g.rounds[1] && g.rounds[1].startedAt) || g.createdAt || this.nowIso(), playedAtStart: 0, winnersAtStart: 0 });
    const ob = this.openBreak();
    if (ob) { ob.endedAt = this.nowIso(); ob.playedAtEnd = g.played.length; ob.winnersAtEnd = this.confirmedCount(); }
    n.phase = 'quiz'; n.quizSince = this.nowIso();
    n.pausedAt = pb.index >= 0 ? { index: pb.index, position: Math.round((pb.position || 0) * 10) / 10, wasPlaying } : null;
    this.audit('quiz-start', { songIndex: pb.index, position: n.pausedAt ? n.pausedAt.position : null, round: g.round.number }, source);
    this.log(`Back to the quiz${n.pausedAt ? ` — bingo paused at song ${pb.index + 1} (${Math.floor(n.pausedAt.position / 60)}:${String(Math.floor(n.pausedAt.position % 60)).padStart(2, '0')})` : ''}`);
    this.touch('state', true);
    return { ok: true, phase: 'quiz', pausedAt: n.pausedAt };
  }
  aStartBreak(args, source) {
    const g = this.game; const n = g.night; const pb = g.playback;
    if (n.phase === 'break') return { ok: true, already: true };
    // after the game ended during quiz time: just bring the TV back (end screen)
    if (g.status === 'finished') { n.phase = 'break'; n.quizSince = null; n.pausedAt = null; this.touch('state', true); return { ok: true, phase: 'break', finished: true }; }
    const no = (n.breaks.length ? n.breaks[n.breaks.length - 1].n : 0) + 1;
    n.breaks.push({ n: no, startedAt: this.nowIso(), playedAtStart: g.played.length, winnersAtStart: this.confirmedCount() });
    n.phase = 'break'; n.quizSince = null; n.pausedAt = null;
    this.audit('break-start', { breakNo: no, round: g.round.number }, source);
    this.log(`Bingo break ${no}`);
    let played = false;
    const autoPlay = args.play != null ? !!args.play : !!this.settings.night.autoPlay;
    if (autoPlay && g.round.number > 0 && !this.activeSession() && !['playing', 'loading'].includes(pb.status)) {
      try { this.aPlay({}); played = true; } catch (e) { /* nothing left to play — stays paused */ }
    }
    if (!played) this.touch('state', true);
    return { ok: true, phase: 'break', breakNo: no, playing: played };
  }
  aSetNight(args, source) {
    const s = this.settings.night;
    if (args.quizTv && ['hide', 'hold'].includes(args.quizTv)) s.quizTv = args.quizTv;
    if (args.autoPlay != null) s.autoPlay = !!args.autoPlay;
    this.audit('night-settings', { quizTv: s.quizTv, autoPlay: s.autoPlay }, source);
    this.touch('state', true);
    return { ok: true };
  }
  nightView() {
    const g = this.game; const n = g.night;
    const total = g.played.length; const won = this.confirmedCount();
    const breaks = n.breaks.map(b => ({ n: b.n, startedAt: b.startedAt, endedAt: b.endedAt || null, songs: (b.endedAt ? b.playedAtEnd : total) - (b.playedAtStart || 0), winners: (b.endedAt ? b.winnersAtEnd : won) - (b.winnersAtStart || 0) }));
    const open = this.openBreak();
    return { phase: n.phase, quizSince: n.quizSince || null, pausedAt: n.pausedAt || null, breakNo: open ? open.n : (n.breaks.length ? n.breaks[n.breaks.length - 1].n : 0), nextBreak: (n.breaks.length ? n.breaks[n.breaks.length - 1].n : (total || g.round.number ? 1 : 0)) + 1, breaks, quizTv: this.settings.night.quizTv, autoPlay: !!this.settings.night.autoPlay };
  }

  /** Round-Based or Rules Checklist — chosen before the game starts. */
  aSetGameMode(args, source) {
    const m = args.mode === 'checklist' ? 'checklist' : 'rounds';
    if (this.game.round.number > 0 || this.game.claims.length) throw new Error('The game has started — the game mode can no longer be changed.');
    this.settings.mode = m;
    if (args.checklist) this.settings.checklist = normaliseChecklist(args.checklist);
    if (m === 'checklist' && !this.settings.checklist.length) this.settings.checklist = normaliseChecklist(DEFAULT_CHECKLIST);
    this._ck = {}; this.audit('game-mode', { mode: m }, source); this.touch('state', true);
    return { ok: true, mode: m };
  }
  /** Choose / reorder the checklist rules (before the game starts). Display order never decides who can win first. */
  aSetChecklist(args, source) {
    if (this.game.round.number > 0 || this.game.claims.length) throw new Error('The game has started — the checklist is locked. (Use “Correct an award” to fix a mistake.)');
    const list = normaliseChecklist(args.items);
    if (!list.length) throw new Error('Choose at least one winning rule.');
    this.settings.checklist = list; this._ck = {};
    this.audit('checklist-set', { rules: list.map(i => i.rule.id) }, source); this.touch('state', true);
    return { ok: true, checklist: this.checklistView() };
  }
  /** All rules completed → "continue music without further Bingo claims" (or reopen). */
  aCloseChecklist(args, source) {
    this.game.checklistClosed = args.closed !== false;
    this.audit(this.game.checklistClosed ? 'claims-closed' : 'claims-reopened', {}, source); this.touch('state', true);
    return { ok: true, closed: this.game.checklistClosed };
  }

  /** The host decides how many rounds the game has (1–10). Rounds already started stay. */
  aSetRoundCount(args, source) {
    const g = this.game;
    if (this.isChecklist()) throw new Error('A Rules Checklist game has no rounds — edit the checklist instead.');
    const cnt = Number(args.count);
    if (!Number.isInteger(cnt) || cnt < 1 || cnt > MAX_ROUNDS) throw new Error(`Choose between 1 and ${MAX_ROUNDS} rounds.`);
    if (g.status === 'finished') throw new Error('This game has ended.');
    const minimum = g.round.number && g.round.status !== 'ready' ? g.round.number : Math.max(1, g.round.number);
    if (cnt < minimum) throw new Error(`Round ${minimum} is already under way — the game needs at least ${minimum} round${minimum === 1 ? '' : 's'}.`);
    const rs = Object.assign({}, this.settings.rounds);
    for (let n = 1; n <= cnt; n++) if (!rs[n]) rs[n] = defaultRuleSet(n);
    Object.keys(rs).forEach(k => { if (Number(k) > cnt) delete rs[k]; });
    this.settings.rounds = rs; this.settings.roundCount = cnt; this._info = {};
    this.audit('round-count', { count: cnt }, source);
    this.log(`The game now has ${cnt} round${cnt === 1 ? '' : 's'}`);
    this.touch('state', true);
    return { ok: true, count: cnt };
  }

  /** Choose the winning rule(s) for a round that has not started yet (v1.5). */
  aSetRoundRules(args, source) {
    const n = Number(args.round);
    if (!Number.isInteger(n) || n < 1 || n > this.roundCount()) throw new Error(`Round must be between 1 and ${this.roundCount()}`);
    if (this.roundLocked(n)) throw new Error(`Round ${n} has already started — its winning rules are locked.`);
    if (this.activeSession()) throw new Error('Close the open claim session first.');
    const set = rules.normaliseRuleSet(args.rules);
    this.settings.rounds = Object.assign({}, this.settings.rounds, { [n]: set });
    this._info = {};
    this.audit('round-rules', { round: n, rules: set }, source);
    this.log(`Round ${n} winning rules: ${this.info(n).label}`);
    this.touch('state', true);
    return { ok: true, round: n, info: this.roundRulesView()[n] };
  }

  /* ------------------------------------------------------------ home play: phone cards */
  playerById(id) { return this.game.players.find(p => p.id === id && !p.removed) || null; }

  /**
   * A player joins from their phone: they get the lowest card that has not been printed,
   * shared or given to another phone. If none is left a new card is added (existing cards
   * are never changed). Giving out a card issues + locks it, exactly like printing.
   */
  aPlayerJoin(args, source) {
    const g = this.game;
    if (g.playersOpen === false) throw new Error('The host has closed joining for this game.');
    const name = String(args.name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!name) throw new Error('Please type your name.');
    if (!args.tokenHash) throw new Error('Missing device token');
    if (g.players.filter(p => !p.removed).length >= 200) throw new Error('This game already has the maximum number of phone players.');
    const taken = new Set(g.players.map(p => p.cardNo));
    let card = g.cards.slice().sort((a, b) => a.no - b.no).find(c => !c.printed && !taken.has(c.no));
    if (!card) {
      if (g.cards.length >= 999) throw new Error('All 999 card numbers are in use.');
      // all extra phone cards share one batch so the card summary stays tidy
      const fresh = generateCards(g.order, 1, g.cards, g.phoneBatch ? { batch: g.phoneBatch } : {});
      g.phoneBatch = fresh[0].batch;
      g.cards.push(...fresh); card = fresh[0];
    }
    locking.lockGame(g, [card.no], source || 'player');
    card.issuedVia = 'phone';
    // keep the name unique among active players (two "Rahul"s → "Rahul 2")
    let shown = name; let k = 2;
    const active = g.players.filter(p => !p.removed).map(p => p.name.toLowerCase());
    while (active.includes(shown.toLowerCase())) shown = `${name} ${k++}`;
    card.owner = shown;
    const pl = { id: 'p_' + crypto.randomBytes(4).toString('hex'), name: shown, cardNo: card.no, tokenHash: args.tokenHash, joinedAt: this.nowIso() };
    g.players.push(pl);
    this.audit('player-joined', { playerId: pl.id, name: shown, cardNo: card.no }, source);
    this.log(`📱 ${shown} joined on their phone — card ${formatCardNo(card.no)}`);
    this.touch('players', true);
    return { ok: true, playerId: pl.id, name: shown, cardNo: card.no };
  }

  aPlayerRemove(args, source) {
    const pl = this.playerById(args.playerId); if (!pl) return { ok: true };
    pl.removed = true; pl.removedAt = this.nowIso();
    // the card stays issued (they have seen it) and is never handed to someone else
    this.audit('player-removed', { playerId: pl.id, name: pl.name, cardNo: pl.cardNo }, source);
    this.touch('players', true);
    return { ok: true };
  }

  aPlayerRename(args, source) {
    const pl = this.playerById(args.playerId); if (!pl) throw new Error('Player not found');
    const name = String(args.name || '').replace(/\s+/g, ' ').trim().slice(0, 24); if (!name) throw new Error('Type a name');
    pl.name = name; const c = this.findCard(pl.cardNo); if (c) c.owner = name;
    this.audit('player-renamed', { playerId: pl.id, name }, source);
    this.touch('players', true);
    return { ok: true };
  }

  aSetPlayersOpen(args, source) {
    this.game.playersOpen = !!args.open;
    this.audit('players-' + (args.open ? 'open' : 'closed'), {}, source);
    this.touch('players', true);
    return { ok: true, open: this.game.playersOpen };
  }

  /**
   * BINGO pressed on a player's phone. Checked instantly against the songs played so far:
   * - not yet a bingo → only that phone is told (the music keeps going);
   * - valid → claims are frozen and the card is added to the claim session, so the host
   *   confirms it exactly like a shouted BINGO.
   */
  aPlayerBingo(args, source) {
    const g = this.game;
    const pl = this.playerById(args.playerId); if (!pl) throw new Error('You are no longer in this game.');
    const card = this.findCard(pl.cardNo);
    const r = g.round;
    if (!r.number || !['active', 'ended'].includes(r.status) || g.status === 'finished') {
      return { result: 'no-round', message: r.number ? 'This round is over — wait for the next one.' : 'The game hasn\'t started yet.' };
    }
    if (this.isChecklist() && g.checklistClosed) return { result: 'no-round', message: 'All rules have been won — thanks for playing!' };
    if (!this.isChecklist() && g.claims.some(c => c.cardNo === card.no && c.round === r.number && c.status === 'confirmed')) return { result: 'already', round: r.number };
    const open = this.activeSession();
    if (open && g.claims.some(c => c.sessionId === open.id && c.cardNo === card.no && c.status !== 'removed')) return { result: 'checking', round: r.number };
    const res = this.isChecklist() ? { valid: this.ckQualify(card, this.playedSet(), open && open.id).eligible.length > 0 } : rules.checkCard(card.cells, this.playedSet(), this.rr(r.number));
    pl.calls = (pl.calls || 0) + 1;
    if (!res.valid) {
      this.audit('player-bingo-early', { playerId: pl.id, name: pl.name, cardNo: card.no, round: r.number }, source);
      this.log(`📱 ${pl.name} (card ${formatCardNo(card.no)}) pressed BINGO — not a bingo yet`);
      this.event('playerBingo', { name: pl.name, cardNo: card.no, cardLabel: formatCardNo(card.no), valid: false, round: r.number });
      this.touch('players', false);
      return { result: 'not-yet', round: r.number, label: this.isChecklist() ? 'any open rule' : this.info(r.number).label };
    }
    const view = this.aAddClaim({ cardNo: card.no }, source || ('player:' + pl.name));
    this.event('playerBingo', { name: pl.name, cardNo: card.no, cardLabel: formatCardNo(card.no), valid: true, round: r.number, claimId: view.claimId });
    return { result: 'checking', round: r.number, claimId: view.claimId };
  }

  /** What one player's phone may see: their own card, the round, and their own claim results. */
  playerView(id) {
    const g = this.game; const pl = this.playerById(id);
    if (!pl) return null;
    const card = this.findCard(pl.cardNo);
    const cells = card.cells.map(sid => { const l = (g.lockedLabels && g.lockedLabels[sid]) || {}; const s = this.song(sid) || {}; return { t: l.title || s.displayTitle || s.title || '?', a: l.artist || s.artist || '' }; });
    const mine = g.claims.filter(c => c.cardNo === pl.cardNo && c.status !== 'removed');
    const last = mine[mine.length - 1] || null;
    const r = g.round;
    // "one away": how many more of the songs actually played this player needs for the
    // current round (songs only count once their clip has finished, so no title is spoiled)
    let away = null;
    const ck = this.isChecklist();
    if (ck) {
      const open = this.ckOpenFor(card.no);
      if (r.number && r.status === 'active' && g.status !== 'finished' && !g.checklistClosed && open.length) { const b = rules.bestProgress(card.cells, this.playedSet(), this.ckRuleSet(open)); away = b ? b.missing : null; }
    } else if (r.number && ['active', 'ended'].includes(r.status) && g.status !== 'finished' && !mine.some(c => c.status === 'confirmed' && c.round === r.number)) {
      const b = rules.bestProgress(card.cells, this.playedSet(), this.rr(r.number)); away = b ? b.missing : null;
    }
    return {
      gameId: g.id, gameName: g.name, gameStatus: g.status, away, intermission: g.intermission ? { until: g.intermission.until, message: g.intermission.message } : null,
      // the same list the TV crawler shows (newest last)
      played: g.played.map((p, i) => { const l = (g.lockedLabels && g.lockedLabels[p.songId]) || {}; const x = this.song(p.songId) || {}; return { n: i + 1, t: l.title || x.displayTitle || x.title, a: l.artist || x.artist, credit: p.kind === 'credit' }; }),
      me: { id: pl.id, name: pl.name, cardNo: pl.cardNo, cardLabel: formatCardNo(pl.cardNo) },
      cells,
      mode: ck ? 'checklist' : 'rounds',
      round: ck ? { number: r.number, status: r.status, label: 'WINNING RULES', rule: 'Win any open rule, in any order.', example: null }
        : { number: r.number, status: r.status, label: r.number ? this.info(r.number).label : null, rule: r.number ? this.info(r.number).rule : null, example: r.number ? this.info(r.number).examples[0] : null },
      checklist: ck ? this.ckItems().map(it => ({ id: it.id, label: this.ckInfo(it).label, short: this.ckInfo(it).short, example: this.ckInfo(it).examples[0], done: this.ckWinners(it.id).length > 0, mine: this.ckWinners(it.id).some(c => c.cardNo === card.no) })) : null,
      wins: mine.filter(c => c.status === 'confirmed').map(c => ck ? c.itemLabel : c.round),
      last: last ? { id: last.id, round: last.round, status: last.status } : null
    };
  }

  playersView() {
    return this.game.players.filter(p => !p.removed).map(p => ({ id: p.id, name: p.name, cardNo: p.cardNo, cardLabel: formatCardNo(p.cardNo), joinedAt: p.joinedAt, calls: p.calls || 0,
      wins: this.game.claims.filter(c => c.cardNo === p.cardNo && c.status === 'confirmed').map(c => c.itemLabel || c.round) }));
  }

  /**
   * Suspense for the TV: how many issued cards (printed, shared or on a phone) need just one
   * more played song for the current round. A count only — never which cards.
   */
  oneAwayCount() {
    const g = this.game; const r = g.round;
    if (!r.number || r.status !== 'active' || g.status === 'finished') return 0;
    // only recalculated when a song is played, a winner changes or cards are issued (not on every update)
    const key = [r.number, g.played.length, g.cards.length, g.cards.filter(c => c.printed).length, g.checklistClosed ? 1 : 0, g.claims.filter(c => c.status === 'confirmed').map(c => c.id + (c.itemId || '')).join(',')].join('|');
    if (this._oaKey === key) return this._oaVal;
    this._oaKey = key; this._oaVal = this.oneAwayCountNow();
    return this._oaVal;
  }
  oneAwayCountNow() {
    const g = this.game; const r = g.round;
    const played = this.playedSet();
    if (this.isChecklist()) {
      if (g.checklistClosed) return 0;
      let k = 0;
      for (const c of g.cards) {
        if (!c.printed) continue;
        const open = this.ckOpenFor(c.no); if (!open.length) continue;
        const b = rules.bestProgress(c.cells, played, this.ckRuleSet(open));
        if (b && b.missing === 1) k++;
      }
      return k;
    }
    const won = new Set(g.claims.filter(c => c.status === 'confirmed' && c.round === r.number).map(c => c.cardNo));
    let n = 0;
    for (const c of g.cards) {
      if (!c.printed || won.has(c.no)) continue;
      const b = rules.bestProgress(c.cells, played, this.rr(r.number));
      if (b && b.missing === 1) n++;
    }
    return n;
  }

  /**
   * 2.6 Cards handed out tonight. The host's own list wins; otherwise printed cards and
   * cards on players' phones count as handed out. null = we can't tell (nothing printed yet).
   */
  handedOutInfo() {
    const g = this.game;
    if (g.handedOut && g.handedOut.spec) {
      let nums = [];
      try { nums = parseRange(g.handedOut.spec); } catch (e) { nums = []; }
      return { source: 'host', spec: g.handedOut.spec, set: new Set(nums), count: nums.length };
    }
    const nums = g.cards.filter(c => c.printed || c.owner).map(c => c.no);
    if (!nums.length) return { source: null, spec: '', set: null, count: 0 };
    return { source: 'printed', spec: rangeText(nums), set: new Set(nums), count: nums.length };
  }
  isHandedOut(no) { const h = this.handedOutInfo(); return h.set ? h.set.has(no) : null; }

  aSetHandedOut(args) {
    const g = this.game;
    const spec = String(args.spec || '').trim();
    if (!spec) { delete g.handedOut; this.touch('state'); return { ok: true, cleared: true }; }
    let nums;
    try { nums = parseRange(spec); } catch (e) { throw new Error('Use card numbers and ranges, for example 1-48, 52, 60-65.'); }
    if (!nums.length) throw new Error('No card numbers found.');
    const missing = nums.filter(n => !this.findCard(n));
    g.handedOut = { spec: rangeText(nums), at: this.nowIso() };
    this.log(`Cards handed out tonight: ${g.handedOut.spec}`);
    this.touch('state');
    return { ok: true, spec: g.handedOut.spec, count: nums.length, notInGame: missing.length };
  }

  ownerOf(no) { const c = this.findCard(no); return (c && c.owner) || null; }

  winners() {
    return this.game.claims.filter(c => c.status === 'confirmed').map(c => ({ claimId: c.id, cardNo: c.cardNo, cardLabel: formatCardNo(c.cardNo), owner: this.ownerOf(c.cardNo), round: c.round, rule: c.itemLabel || null, itemId: c.itemId || null, headline: c.headline, at: c.confirmedAt, review: c.review || null }));
  }

  sessionView() {
    const s = this.activeSession();
    if (!s) return null;
    return {
      id: s.id, openedAt: s.openedAt, openedBy: s.openedBy, round: s.round, roundLabel: this.isChecklist() ? 'Rules checklist' : this.info(s.round).label, snapshotCount: s.snapshot.length,
      position: s.playback.position,
      claims: s.claimIds.map(id => this.game.claims.find(c => c.id === id)).filter(c => c && c.status !== 'removed')
        .map(c => ({ claimId: c.id, cardNo: c.cardNo, cardLabel: formatCardNo(c.cardNo), owner: this.ownerOf(c.cardNo), status: c.status, valid: c.valid, headline: c.headline }))
    };
  }

  currentView() {
    const pb = this.game.playback;
    const id = this.currentSongId();
    if (!id) return null;
    const s = this.song(id);
    const e = this.ledgerEntry(id);
    return { songId: id, index: pb.index, number: pb.index + 1, title: s.displayTitle || s.title, artist: s.artist, played: !!e, credit: !!(e && e.kind === 'credit'), duration: s.duration, unavailable: this.unavailable[id] || null };
  }

  /** Audience view: ONLY what the TV may show. No card numbers, no upcoming songs, no claims. */
  audienceState() {
    const g = this.game; const pb = g.playback;
    const cur = this.currentSongId();
    const showSong = cur && ['playing', 'paused', 'loading'].includes(pb.status);
    const s = showSong ? this.song(cur) : null;
    return {
      gameName: g.name,
      logo: g.logo || null,
      song: s ? { title: s.displayTitle || s.title, artist: s.artist, key: `${pb.index}:${this.loadToken}` } : null,
      playbackStatus: pb.status,
      round: { number: g.round.number, status: g.round.status, label: this.info(g.round.number || 1).label, short: this.info(g.round.number || 1).short, examples: this.info(g.round.number || 1).examples },
      mode: this.isChecklist() ? 'checklist' : 'rounds',
      rounds: this.isChecklist() ? [] : this.roundNumbers().map(n => ({ n, label: this.info(n).label, example: this.info(n).examples[0] })),
      checklist: this.isChecklist() ? (() => { const v = this.checklistView(); return { total: v.total, completed: v.completed, allDone: v.allDone, items: v.items.map(i => ({ id: i.id, label: i.label, short: i.short, example: i.example, done: i.status === 'completed' })) }; })() : null,
      diagonalsCount: this.isChecklist() ? this.ckItems().some(i => i.rule.id === 'diagonal') : this.roundNumbers().some(n => this.info(n).diagonalsCount),
      history: g.played.map((p, i) => { const x = this.song(p.songId) || {}; return { n: i + 1, title: x.displayTitle || x.title, artist: x.artist, credit: p.kind === 'credit', round: p.round || 0 }; }),
      overlay: this.settings.overlay,
      crawler: this.settings.crawler,
      patternPosition: this.settings.patternPosition,
      oneAway: this.settings.tvScreens.closeCount === false ? null : this.oneAwayCount(),
      screen: this.audienceScreen()
    };
  }

  /** Which full-screen TV page to show: welcome (before Round 1), end (after the game), or none. */
  audienceScreen() {
    const g = this.game; const sc = this.settings.screens;
    // quiz time: the window is normally hidden; the holding screen is what shows if the
    // host chose "show a still holding screen" (or the window is shown by hand)
    if (g.night && g.night.phase === 'quiz' && g.status !== 'finished') return { mode: 'quiz', name: g.name };
    if (g.intermission && g.status !== 'finished') {
      const n = g.round.number || 1;
      if (this.isChecklist()) { const v = this.checklistView(); const o = v.items.filter(i => i.status !== 'completed'); return { mode: 'intermission', checklist: true, until: g.intermission.until, message: g.intermission.message || '', name: g.name, next: { n: 0, label: o.length ? `${o.length} RULE${o.length > 1 ? 'S' : ''} STILL TO WIN` : 'ALL RULES WON', example: o.length ? o[0].example : null } }; }
      return { mode: 'intermission', until: g.intermission.until, message: g.intermission.message || '', name: g.name, next: { n, label: this.info(n).label, example: this.info(n).examples[0] } };
    }
    if (g.round.number === 0 && g.status !== 'finished' && sc.welcome) {
      return { mode: 'welcome', name: g.name, venue: g.venue || '', date: g.date || '', startTime: sc.startTime || '', message: sc.message || '' };
    }
    if (g.status === 'finished' && sc.end) {
      const won = g.claims.filter(c => c.status === 'confirmed');
      const byRound = { 1: 0, 2: 0, 3: 0 }; won.forEach(c => { byRound[c.round] = (byRound[c.round] || 0) + 1; });
      // counts only — never card numbers or claim details
      const end = { mode: 'end', name: g.name, venue: g.venue || '', date: g.date || '', winners: won.length, winnersByRound: byRound, rounds: g.round.number, songs: g.played.length };
      if (this.isChecklist()) { const v = this.checklistView(); end.checklist = true; end.byRule = v.items.map(i => ({ label: i.label, winners: i.winners.length })); end.rulesWon = v.completed; end.rulesTotal = v.total; }
      return end;
    }
    return { mode: 'none' };
  }

  /** Host view (desktop + phone). */
  hostState() {
    const g = this.game; const pb = g.playback;
    const total = g.order.length;
    const remaining = g.order.filter(id => !this.isPlayed(id)).length;
    const nextIdx = this.nextUnplayedIndex(pb.index);
    const next = nextIdx >= 0 ? this.song(g.order[nextIdx]) : null;
    const played = this.playedSet();
    return {
      gameId: g.id, name: g.name, venue: g.venue, date: g.date, status: g.status, gamePaused: !!g.gamePaused, rehearsal: !!g.rehearsal,
      version: g.version, cardsLocked: !!g.cardsLocked, lockedAt: g.lockedAt || null,
      playback: { status: pb.status, index: pb.index, position: pb.position, clipStart: pb.clipStart, clipEnd: pb.clipEnd, playedOn: pb.clipEndOverride !== undefined, talkover: !!this.talkoverOn, pausedForClaim: !!pb.pausedForClaim, recovered: !!pb.recovered, nextAt: pb.nextAt || null },
      current: this.currentView(),
      handedOut: (() => { const h = this.handedOutInfo(); return { source: h.source, spec: h.spec, count: h.count }; })(),
      next: next ? { title: next.displayTitle || next.title, artist: next.artist, number: nextIdx + 1 } : null, // (compat)
      totals: { songs: total, played: g.played.filter(p => p.kind !== 'credit').length, credited: g.played.filter(p => p.kind === 'credit').length, eligible: g.played.length, remaining, skipped: g.skipped.length, cards: g.cards.length, printed: g.cards.filter(c => c.printed).length },
      mode: this.isChecklist() ? 'checklist' : 'rounds',
      checklist: this.isChecklist() ? Object.assign(this.checklistView(), { playlistDone: remaining === 0 || pb.status === 'finished' }) : null,
      checklistRules: this.ckItems().map(it => ({ id: it.id, rule: it.rule, label: this.ckInfo(it).label, example: this.ckInfo(it).examples[0] })),
      roundRules: this.roundRulesView(), roundCount: this.roundCount(), intermission: g.intermission, night: this.nightView(),
      round: this.isChecklist() ? { number: g.round.number, status: g.round.status, label: 'RULES CHECKLIST', rule: 'Every selected rule is open from the start — win them in any order.', short: 'Any open rule',
        winners: g.claims.filter(c => c.status === 'confirmed').length, canComplete: false, preQualified: [] } :
      { number: g.round.number, status: g.round.status, label: g.round.number ? this.info(g.round.number).label : null, rule: g.round.number ? this.info(g.round.number).rule : null, short: g.round.number ? this.info(g.round.number).short : null,
        winners: g.claims.filter(c => c.status === 'confirmed' && c.round === g.round.number).length,
        canComplete: !this.isChecklist() && ['active', 'ended'].includes(g.round.status) && g.status !== 'finished',
        preQualified: (g.rounds[g.round.number] && g.rounds[g.round.number].preQualified) || [] },
      upNext: this.upNextView(),
      history: this.historyView(),
      winners: this.winners(),
      session: this.sessionView(),
      players: this.playersView(), playersOpen: g.playersOpen !== false,
      claims: g.claims.filter(c => c.status !== 'removed').slice(-30).reverse().map(c => ({ id: c.id, sessionId: c.sessionId || null, cardNo: c.cardNo, cardLabel: formatCardNo(c.cardNo), owner: this.ownerOf(c.cardNo), round: c.round, rule: c.itemLabel || null, status: c.status, valid: c.valid, headline: c.headline, at: c.at, source: c.source, revokeReason: c.revokeReason || null })),
      audit: this.isChecklist() ? (g.audit || []).filter(a => /^(winner-|claims-|checklist-|game-mode)/.test(a.type || a.action || '')).slice(-40).reverse() : undefined,
      credits: g.credits.map(c => ({ id: c.id, songId: c.songId, title: c.title, artist: c.artist, reason: c.reason, at: c.at, status: c.status })),
      unavailable: Object.keys(this.unavailable).filter(id => this.song(id) && !played.has(id)).map(id => ({ songId: id, title: this.song(id).title, artist: this.song(id).artist, reason: this.unavailable[id] })),
      creditReasons: CREDIT_REASONS,
      settings: { mode: this.settings.mode, skipIntros: this.settings.skipIntros !== false, spreadArtists: this.settings.spreadArtists !== false, afterWinner: this.settings.afterWinner, intermissionMinutes: this.settings.intermissionMinutes, clipMode: this.settings.clipMode, volume: this.settings.volume, autoAdvance: this.settings.autoAdvance, autoAdvanceGap: this.settings.autoAdvanceGap, pauseOnClaim: this.settings.pauseOnClaim, crawler: this.settings.crawler, overlay: this.settings.overlay, audio: this.settings.audio, patternPosition: this.settings.patternPosition, winnerAnimation: this.settings.winnerAnimation, tvScreens: this.settings.tvScreens, screens: this.settings.screens, defaultStart: this.settings.defaultStart },
      audienceConnected: this.audienceConnected,
      lastError: this.lastError
    };
  }

  /** Full play order (desktop only). */
  orderView() {
    const played = new Map(this.game.played.map((p, i) => [p.songId, { n: i + 1, kind: p.kind }]));
    const skipped = new Set(this.game.skipped);
    return this.game.order.map((id, i) => { const s = this.song(id); const p = played.get(id); return { index: i, songId: id, title: s.displayTitle || s.title, artist: s.artist, playedNo: p ? p.n : null, credit: !!(p && p.kind === 'credit'), skipped: skipped.has(id), unavailable: this.unavailable[id] || null, clipStart: s.clipStart, clipEnd: s.clipEnd, duration: s.duration }; });
  }
}

/** Build a brand-new game object from a playlist snapshot. */
function createGame({ name, date, venue, logo, songs, playlistId, playlistName, settings }) {
  const { MIN_SONGS } = require('./cards');
  const ids = Array.from(new Set(songs.map(s => s.id)));
  if (ids.length < MIN_SONGS) throw new Error(`A game needs at least ${MIN_SONGS} unique songs — add ${MIN_SONGS - ids.length} more.`);
  const map = {};
  songs.forEach(s => {
    map[s.id] = { id: s.id, source: s.source || undefined, youtubeId: s.youtubeId || undefined, title: s.title, artist: s.artist, displayTitle: s.displayTitle || '', printTitle: s.printTitle || '', path: s.path, kind: s.kind || undefined, fileName: s.fileName || '', size: s.size || 0, fingerprint: s.fingerprint || '', duration: s.duration || 0, clipStart: s.clipStart != null ? s.clipStart : null, clipEnd: s.clipEnd != null ? s.clipEnd : null };
  });
  const st = Object.assign(defaultGameSettings(), settings || {});
  st.audio = Object.assign(defaultAudio(), (settings && settings.audio) || {});
  const id = 'G' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const game = {
    id, schemaVersion: locking.SCHEMA_VERSION, name: name || 'Music Bingo', date: date || new Date().toISOString().slice(0, 10), venue: venue || '', logo: logo || null,
    createdAt: new Date().toISOString(), playlistId, playlistName,
    songs: map, order: st.shuffle ? (st.spreadArtists !== false ? spreadShuffle(ids, id => artistKey(map[id].artist)) : shuffle(ids)) : ids.slice(),
    settings: st, status: 'setup', cardsLocked: false
  };
  return GameEngine.normalise(game);
}

module.exports = { GameEngine, createGame, defaultGameSettings, defaultAudio, normaliseChecklist, DEFAULT_CHECKLIST, CLIP_MODES, CREDIT_REASONS };
