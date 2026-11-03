'use strict';
/**
 * Crime Master Bingo — authoritative game engine.
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
const { shuffle, parseQrPayload, formatCardNo } = require('./cards');
const locking = require('./locking');

const CLIP_MODES = [20, 30, 40, 60, 'full'];
const CREDIT_REASONS = ['File missing or moved', 'Storage device disconnected', 'Video corrupted', 'Codec not supported', 'Playback failed during the event', 'Other'];

function defaultAudio() {
  return { levelling: true, targetLufs: -16, ceilingDbtp: -1, maxBoostDb: 9, fadeIn: 0.5, fadeOut: 1.0, muted: false };
}

function defaultGameSettings() {
  return {
    clipMode: 40,
    defaultStart: 0,
    autoAdvance: true,
    autoAdvanceGap: 3,
    shuffle: true,
    volume: 85,
    pauseOnClaim: true,
    winnerAnimation: true,
    tvScreens: { winner: true, wrongClaim: true, showCardNumber: false, seconds: 7 },
    overlay: { enabled: true, position: 'bottom-left', titleSize: 64, artistSize: 38, opacity: 0.78, duration: 0, revealDelay: 0 },
    crawler: { speed: 4, fontSize: 30, height: 72, separator: 'diamond', paused: false },
    audio: defaultAudio(),
    patternPosition: 'top-right'
  };
}

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
    game.playback = Object.assign({ index: -1, status: 'idle', position: 0, recovered: false }, game.playback || {});
    game.played = game.played || [];
    game.skipped = game.skipped || [];
    game.round = game.round || { number: 0, status: 'pending' };
    game.rounds = game.rounds || {};
    game.claims = game.claims || [];
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
    if (s.clipMode === 'full') return { start: 0, end: dur || null };
    const len = Number(s.clipMode) || 40;
    let start = song.clipStart != null && song.clipStart !== '' ? Number(song.clipStart) : Number(s.defaultStart) || 0;
    if (dur && start >= dur - 1) start = 0;
    let end = song.clipEnd != null && song.clipEnd !== '' ? Number(song.clipEnd) : start + len;
    if (end <= start) end = start + len;
    if (dur) end = Math.min(end, dur);
    return { start, end };
  }

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
        clipStart: clip.start, clipEnd: clip.end, clipLength: clip.end != null ? Math.round((clip.end - clip.start) * 10) / 10 : null,
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
    return { cmd: 'load', token: this.loadToken, index, src: song.path, start: position != null ? position : clip.start, clipStart: clip.start, clipEnd: clip.end, autoplay, volume: this.settings.volume, audio: this.audioFor(song, clip) };
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
    this.player({ cmd: 'clear' });
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
    if (!s.autoAdvance || g.gamePaused || g.round.number === 0 || g.status === 'finished' || this.activeSession()) return;
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
    const allowedWhenFinished = ['showTvScreen', 'setTvScreens', 'openChecker', 'closeChecker', 'checkClaim', 'freezeClaims', 'addClaim', 'closeSession', 'confirmClaim', 'dismissClaim', 'removeClaim', 'viewClaim', 'setCrawler', 'setOverlay', 'reopenGame', 'setVolume', 'setAudio', 'reverseCredit'];
    if (this.game.status === 'finished' && !allowedWhenFinished.includes(action)) {
      throw new Error('This game has ended. Re-open it from Game History to continue.');
    }
    return fn.call(this, args || {}, source);
  }

  get actions() {
    return {
      play: this.aPlay, pause: this.aPause, togglePlay: this.aToggle, stop: this.aStop,
      next: this.aNext, skip: (a, s) => this.aNext(Object.assign({ mode: a.mode || 'skip' }, a), s),
      previous: this.aPrevious, replay: this.aReplay, seek: this.aSeek, setVolume: this.aVolume,
      setClipMode: this.aClipMode, jumpTo: this.aJumpTo, markPlayed: this.aMarkPlayed, unmarkPlayed: this.aUnmarkPlayed,
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
      completeRound: this.aCompleteRound,
      queueSong: this.aQueueSong, unqueueSong: this.aUnqueueSong, skipNext: this.aSkipNext, resetQueue: this.aResetQueue,
      excludeSong: this.aExcludeSong, includeSong: this.aIncludeSong,
      updateSong: this.aUpdateSong
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
    if (this.game.round.number === 0) throw new Error('Start Round 1 first.');
    const target = pb.index > 0 ? pb.index - 1 : 0;
    this.loadIndex(target, { autoplay: true });
    this.touch('state');
    return { ok: true };
  }

  aReplay(args = {}) {
    this.assertExpected(args);
    const pb = this.game.playback;
    if (pb.index < 0) throw new Error('No song to replay yet.');
    if (this.game.round.number === 0) throw new Error('Start Round 1 first.');
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

  aJumpTo(args) {
    const i = Number(args.index);
    if (this.game.round.number === 0) throw new Error('Start Round 1 first.');
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
    if (this.game.round.number === 0) throw new Error('Start Round 1 first.');
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
    const n = Number(args.round || (g.round.number + 1));
    if (![1, 2, 3].includes(n)) throw new Error('Round must be 1, 2 or 3');
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
    this.log(`Round ${n} started — ${rules.ROUNDS[n].label}`);
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
    const final = n === 3;
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
      preQualified = g.cards.filter(c => rules.checkCard(c.cells, set, n + 1).valid).map(c => formatCardNo(c.no));
      g.rounds[n + 1] = Object.assign(g.rounds[n + 1] || {}, { preparedAt: at, preQualified });
      tr.preQualified = preQualified.length;
    }
    this.audit('round-completed', { round: n, winners: winners.length, next: final ? null : n + 1, preQualified: preQualified.length }, source);
    this.log(final ? 'Round 3 complete — FULL HOUSE! Game finished.' : `Round ${n} complete (${winners.length} winner${winners.length === 1 ? '' : 's'}). Ready for Round ${n + 1} — ${rules.ROUNDS[n + 1].label}.`);
    this.event('tvScreen', { type: 'round', from: n, to: final ? null : n + 1, fromLabel: rules.ROUNDS[n].label, toLabel: final ? null : rules.ROUNDS[n + 1].label, final, seconds: 9, pattern: final ? null : rules.patternExamples(n + 1)[0] });
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
    g.order = shuffle(g.order);
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
    ['autoAdvance', 'shuffle', 'pauseOnClaim', 'winnerAnimation'].forEach(k => { if (args[k] != null) s[k] = !!args[k]; });
    if (args.autoAdvanceGap != null) s.autoAdvanceGap = Math.max(0, Math.min(30, Number(args.autoAdvanceGap)));
    if (args.defaultStart != null) s.defaultStart = Math.max(0, Number(args.defaultStart));
    if (args.patternPosition && ['top-right', 'top-left', 'bottom-right', 'bottom-left'].includes(args.patternPosition)) s.patternPosition = args.patternPosition;
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
    if (!g.round.number) throw new Error('No round has started yet.');
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
      if (!q) return { error: 'That QR code is not a Crime Master Bingo card.' };
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
    const res = this.evaluate(card, session.round, session.snapshot.map(x => x.songId));
    const alreadyWinner = g.claims.find(c => c.cardNo === card.no && c.round === session.round && c.status === 'confirmed');
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
    const res = this.evaluate(card, claim.round, ids, session ? session.snapshot : null);
    return {
      ok: true, claimId: claim.id, sessionId: claim.sessionId || null, status: claim.status, cardNo: claim.cardNo, cardLabel: formatCardNo(claim.cardNo), round: claim.round,
      roundLabel: rules.ROUNDS[claim.round].label, roundStatus: g.round.status,
      valid: res.valid, headline: res.headline, reason: res.reason,
      alreadyWinner: claim.status === 'duplicate' || (claim.status !== 'confirmed' && g.claims.some(c => c.cardNo === claim.cardNo && c.round === claim.round && c.status === 'confirmed')),
      otherRoundWins: g.claims.filter(c => c.cardNo === claim.cardNo && c.status === 'confirmed' && c.round !== claim.round).map(c => c.round),
      qualifiedAtSong: res.qualifiedAtSong, completingSong: res.completingSong || null, explanation: res.explanation,
      best: res.best ? { description: res.best.description, missing: res.best.missing, missingCells: res.best.missingCells, cells: res.best.cells } : null,
      roundRule: rules.ROUNDS[claim.round].rule, playedCount: ids.length,
      printed: !!card.printed, review: claim.review || null,
      grid: res.grid, winningCells: res.winningCells, lines: res.lines
    };
  }

  evaluate(card, round, playedIds, snapshot) {
    const set = new Set(playedIds);
    const res = rules.checkCard(card.cells, set, round);
    const win = new Set(res.winningCells);
    const order = new Map(playedIds.map((id, i) => [id, i + 1]));
    const kinds = new Map((snapshot || this.game.played.map(p => ({ songId: p.songId, kind: p.kind }))).map(x => [x.songId, x.kind || 'played']));
    res.best = res.valid ? null : rules.bestProgress(card.cells, set, round);
    const bestCells = new Set(res.best ? res.best.cells : []);
    const needed = new Set(res.best ? res.best.missingCells : []);
    res.qualifiedAtSong = res.valid ? rules.qualifiedAt(card.cells, playedIds, round) : null;
    const completingId = res.qualifiedAtSong ? playedIds[res.qualifiedAtSong - 1] : null;
    res.grid = card.cells.map((id, i) => {
      const s = this.song(id) || { title: '?', artist: '' };
      const label = (this.game.cardsLocked && this.game.lockedLabels && this.game.lockedLabels[id]) || null;
      return { songId: id, title: label ? label.title : (s.displayTitle || s.title), artist: s.artist, played: set.has(id), credit: set.has(id) && kinds.get(id) === 'credit', playedNo: order.get(id) || null, winning: win.has(i), inBest: bestCells.has(i), needed: needed.has(i), completing: id === completingId };
    });
    if (completingId) { const cs = this.song(completingId) || {}; res.completingSong = { n: res.qualifiedAtSong, songId: completingId, title: cs.displayTitle || cs.title, artist: cs.artist, credit: kinds.get(completingId) === 'credit' }; }
    res.explanation = rules.explainClaim(formatCardNo(card.no), round, res, res.best);
    return res;
  }

  aConfirmClaim(args, source) {
    const g = this.game;
    const claim = g.claims.find(c => c.id === args.claimId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status === 'confirmed') return { ok: true, already: true };
    if (['removed', 'dismissed', 'rejected'].includes(claim.status)) throw new Error('This claim was ' + claim.status + ' — check the card again to re-open it.');
    if (g.claims.some(c => c.cardNo === claim.cardNo && c.round === claim.round && c.status === 'confirmed')) throw new Error(`Card ${formatCardNo(claim.cardNo)} is already a confirmed winner in this round.`);
    const session = g.claimSessions.find(s => s.id === claim.sessionId);
    if (session && session.status !== 'open') throw new Error('That claim session is closed.');
    // Re-verify against the SAME frozen snapshot — other winners never invalidate this claim.
    const card = this.findCard(claim.cardNo);
    const res = rules.checkCard(card.cells, new Set(this.sessionPlayedIds(session)), claim.round);
    if (!res.valid) throw new Error('This card does not meet the winning rule for its claim snapshot.');
    claim.status = 'confirmed';
    claim.confirmedAt = this.nowIso();
    claim.confirmedBy = source || 'laptop';
    claim.headline = res.headline;
    this.audit('winner-confirmed', { sessionId: claim.sessionId, claimId: claim.id, cardNo: claim.cardNo, round: claim.round, headline: res.headline }, source);
    this.log(`WINNER confirmed: card ${formatCardNo(claim.cardNo)}, Round ${claim.round} (${res.headline})`);
    if (this.settings.winnerAnimation) this.event('celebrate', { round: claim.round, label: rules.ROUNDS[claim.round].label });
    if (this.settings.tvScreens.winner) this.tvScreen('winner', claim, res);
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
    const payload = { type, round: claim.round, label: rules.ROUNDS[claim.round].label, seconds: Math.max(3, Math.min(30, Number(t.seconds) || 7)), winners: winnersInSession };
    if (t.showCardNumber) payload.cardLabel = formatCardNo(claim.cardNo);
    if (type === 'winner' && res) payload.pattern = Array.from({ length: 25 }, (_, i) => res.winningCells.includes(i));
    this.event('tvScreen', payload);
  }

  aShowTvScreen(args) {
    const claim = this.game.claims.find(c => c.id === args.claimId);
    if (!claim) throw new Error('Claim not found');
    const type = args.type === 'wrong' ? 'wrong' : 'winner';
    if (type === 'winner' && claim.status !== 'confirmed') throw new Error('Only a confirmed winner can be shown as a winner.');
    if (type === 'wrong' && claim.valid) throw new Error('This claim is valid.');
    const res = type === 'winner' ? rules.checkCard(this.findCard(claim.cardNo).cells, new Set(this.sessionPlayedIds(this.game.claimSessions.find(s => s.id === claim.sessionId))), claim.round) : null;
    this.tvScreen(type, claim, res);
    return { ok: true };
  }

  aSetTvScreens(args) {
    const t = this.settings.tvScreens;
    ['winner', 'wrongClaim', 'showCardNumber'].forEach(k => { if (args[k] != null) t[k] = !!args[k]; });
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
    this.touch('claims');
    return { ok: true, resumed, sessionId: s.id };
  }

  aRevokeWinner(args, source) {
    const claim = this.game.claims.find(c => c.id === args.claimId);
    if (!claim || claim.status !== 'confirmed') throw new Error('That claim is not a confirmed winner.');
    claim.status = 'revoked';
    claim.revokedAt = this.nowIso();
    this.audit('winner-revoked', { claimId: claim.id, cardNo: claim.cardNo, round: claim.round }, source);
    this.log(`Winner REVOKED: card ${formatCardNo(claim.cardNo)}, Round ${claim.round}`);
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

  winners() {
    return this.game.claims.filter(c => c.status === 'confirmed').map(c => ({ claimId: c.id, cardNo: c.cardNo, cardLabel: formatCardNo(c.cardNo), round: c.round, headline: c.headline, at: c.confirmedAt, review: c.review || null }));
  }

  sessionView() {
    const s = this.activeSession();
    if (!s) return null;
    return {
      id: s.id, openedAt: s.openedAt, openedBy: s.openedBy, round: s.round, roundLabel: rules.ROUNDS[s.round].label, snapshotCount: s.snapshot.length,
      position: s.playback.position,
      claims: s.claimIds.map(id => this.game.claims.find(c => c.id === id)).filter(c => c && c.status !== 'removed')
        .map(c => ({ claimId: c.id, cardNo: c.cardNo, cardLabel: formatCardNo(c.cardNo), status: c.status, valid: c.valid, headline: c.headline }))
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
      round: { number: g.round.number, status: g.round.status, label: g.round.number ? rules.ROUNDS[g.round.number].label : 'ONE LINE' },
      history: g.played.map((p, i) => { const x = this.song(p.songId) || {}; return { n: i + 1, title: x.displayTitle || x.title, artist: x.artist, credit: p.kind === 'credit' }; }),
      overlay: this.settings.overlay,
      crawler: this.settings.crawler,
      patternPosition: this.settings.patternPosition
    };
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
      gameId: g.id, name: g.name, venue: g.venue, date: g.date, status: g.status, gamePaused: !!g.gamePaused,
      version: g.version, cardsLocked: !!g.cardsLocked, lockedAt: g.lockedAt || null,
      playback: { status: pb.status, index: pb.index, position: pb.position, clipStart: pb.clipStart, clipEnd: pb.clipEnd, pausedForClaim: !!pb.pausedForClaim, recovered: !!pb.recovered, nextAt: pb.nextAt || null },
      current: this.currentView(),
      next: next ? { title: next.displayTitle || next.title, artist: next.artist, number: nextIdx + 1 } : null, // (compat)
      totals: { songs: total, played: g.played.filter(p => p.kind !== 'credit').length, credited: g.played.filter(p => p.kind === 'credit').length, eligible: g.played.length, remaining, skipped: g.skipped.length, cards: g.cards.length, printed: g.cards.filter(c => c.printed).length },
      round: { number: g.round.number, status: g.round.status, label: g.round.number ? rules.ROUNDS[g.round.number].label : null, rule: g.round.number ? rules.ROUNDS[g.round.number].rule : null,
        winners: g.claims.filter(c => c.status === 'confirmed' && c.round === g.round.number).length,
        canComplete: ['active', 'ended'].includes(g.round.status) && g.status !== 'finished',
        preQualified: (g.rounds[g.round.number] && g.rounds[g.round.number].preQualified) || [] },
      upNext: this.upNextView(),
      history: this.historyView(),
      winners: this.winners(),
      session: this.sessionView(),
      claims: g.claims.filter(c => c.status !== 'removed').slice(-30).reverse().map(c => ({ id: c.id, sessionId: c.sessionId || null, cardNo: c.cardNo, cardLabel: formatCardNo(c.cardNo), round: c.round, status: c.status, valid: c.valid, headline: c.headline, at: c.at, source: c.source })),
      credits: g.credits.map(c => ({ id: c.id, songId: c.songId, title: c.title, artist: c.artist, reason: c.reason, at: c.at, status: c.status })),
      unavailable: Object.keys(this.unavailable).filter(id => this.song(id) && !played.has(id)).map(id => ({ songId: id, title: this.song(id).title, artist: this.song(id).artist, reason: this.unavailable[id] })),
      creditReasons: CREDIT_REASONS,
      settings: { clipMode: this.settings.clipMode, volume: this.settings.volume, autoAdvance: this.settings.autoAdvance, autoAdvanceGap: this.settings.autoAdvanceGap, pauseOnClaim: this.settings.pauseOnClaim, crawler: this.settings.crawler, overlay: this.settings.overlay, audio: this.settings.audio, patternPosition: this.settings.patternPosition, winnerAnimation: this.settings.winnerAnimation, tvScreens: this.settings.tvScreens, defaultStart: this.settings.defaultStart },
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
    map[s.id] = { id: s.id, title: s.title, artist: s.artist, displayTitle: s.displayTitle || '', printTitle: s.printTitle || '', path: s.path, fileName: s.fileName || '', size: s.size || 0, fingerprint: s.fingerprint || '', duration: s.duration || 0, clipStart: s.clipStart != null ? s.clipStart : null, clipEnd: s.clipEnd != null ? s.clipEnd : null };
  });
  const st = Object.assign(defaultGameSettings(), settings || {});
  st.audio = Object.assign(defaultAudio(), (settings && settings.audio) || {});
  const id = 'G' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const game = {
    id, schemaVersion: locking.SCHEMA_VERSION, name: name || 'Music Bingo', date: date || new Date().toISOString().slice(0, 10), venue: venue || '', logo: logo || null,
    createdAt: new Date().toISOString(), playlistId, playlistName,
    songs: map, order: st.shuffle ? shuffle(ids) : ids.slice(),
    settings: st, status: 'setup', cardsLocked: false
  };
  return GameEngine.normalise(game);
}

module.exports = { GameEngine, createGame, defaultGameSettings, defaultAudio, CLIP_MODES, CREDIT_REASONS };
