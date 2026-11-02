'use strict';
/**
 * Crime Master Bingo — authoritative game engine.
 *
 * Runs in the Electron main process (the laptop). The desktop host UI and the
 * phone remote both call `dispatch(action, args)`; the audience window is the
 * only video/audio player and reports its progress back via `player*` methods.
 *
 * The official played-song history (`game.played`) is the ONE source used by
 * the audience crawler, the host lists, the phone and the bingo checker.
 */
const crypto = require('crypto');
const rules = require('./rules');
const { shuffle, parseQrPayload, formatCardNo } = require('./cards');

const CLIP_MODES = [20, 30, 40, 60, 'full'];

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
    overlay: { enabled: true, position: 'bottom-left', titleSize: 64, artistSize: 38, opacity: 0.78, duration: 0 },
    crawler: { speed: 4, fontSize: 30, height: 72, separator: 'diamond', paused: false },
    patternPosition: 'top-right'
  };
}

function uid(prefix = '') { return prefix + crypto.randomBytes(6).toString('hex'); }

class GameEngine {
  /**
   * @param {object} game  persisted game object
   * @param {object} hooks { persist(game, urgent), changed(kind), player(cmd), event(name,payload), setTimeout, clearTimeout, now }
   */
  constructor(game, hooks = {}) {
    this.game = game;
    this.hooks = hooks;
    this._setTimeout = hooks.setTimeout || setTimeout;
    this._clearTimeout = hooks.clearTimeout || clearTimeout;
    this._now = hooks.now || (() => Date.now());
    this.loadToken = 0;
    this.advanceTimer = null;
    this.checkersOpen = 0;
    this.lastError = null;
    this.audienceConnected = false;
    GameEngine.normalise(game);
    // Crash recovery: never resume straight into playback; restore paused at the saved position.
    const pb = game.playback;
    if (['playing', 'loading', 'between'].includes(pb.status)) {
      pb.status = pb.index >= 0 ? 'paused' : 'idle';
      pb.recovered = true;
    }
    pb.pausedForClaim = false;
  }

  static normalise(game) {
    const d = defaultGameSettings();
    game.settings = Object.assign({}, d, game.settings || {});
    game.settings.overlay = Object.assign({}, d.overlay, (game.settings.overlay || {}));
    game.settings.crawler = Object.assign({}, d.crawler, (game.settings.crawler || {}));
    game.playback = Object.assign({ index: -1, status: 'idle', position: 0, recovered: false }, game.playback || {});
    game.played = game.played || [];
    game.skipped = game.skipped || [];
    game.round = game.round || { number: 0, status: 'pending' };
    game.rounds = game.rounds || {};
    game.claims = game.claims || [];
    game.cards = game.cards || [];
    game.status = game.status || 'setup';
    game.log = game.log || [];
    game.version = game.version || 0;
    return game;
  }

  /* ------------------------------------------------------------------ helpers */
  get settings() { return this.game.settings; }
  song(id) { return this.game.songs[id]; }
  currentSongId() { const i = this.game.playback.index; return i >= 0 ? this.game.order[i] : null; }
  playedSet() { return new Set(this.game.played.map(p => p.songId)); }
  isPlayed(id) { return this.game.played.some(p => p.songId === id); }

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

  log(msg) {
    this.game.log.push({ at: new Date(this._now()).toISOString(), msg });
    if (this.game.log.length > 500) this.game.log.splice(0, this.game.log.length - 500);
  }

  touch(kind = 'state', urgent = true) {
    this.game.version++;
    this.game.updatedAt = new Date(this._now()).toISOString();
    if (this.hooks.persist) this.hooks.persist(this.game, urgent);
    if (this.hooks.changed) this.hooks.changed(kind);
  }

  player(cmd) { if (this.hooks.player) this.hooks.player(cmd); }
  event(name, payload) { if (this.hooks.event) this.hooks.event(name, payload); }

  cancelAdvance() {
    if (this.advanceTimer) { this._clearTimeout(this.advanceTimer); this.advanceTimer = null; }
    if (this.game.playback.status === 'between') { this.game.playback.status = 'idle'; this.game.playback.nextAt = null; }
  }

  nextUnplayedIndex(after) {
    const g = this.game; const played = this.playedSet();
    for (let i = after + 1; i < g.order.length; i++) if (!played.has(g.order[i])) return i;
    // wrap round: songs skipped earlier come back at the end
    for (let i = 0; i <= Math.min(after, g.order.length - 1); i++) if (!played.has(g.order[i]) && i !== after) return i;
    return -1;
  }

  /* ---------------------------------------------------------- player control */
  loadIndex(index, { autoplay = true, position = null } = {}) {
    const g = this.game;
    if (index < 0 || index >= g.order.length) throw new Error('No such song in the play order');
    this.cancelAdvance();
    const song = this.song(g.order[index]);
    const clip = this.clipFor(song);
    this.loadToken++;
    g.playback.index = index;
    g.playback.status = autoplay ? 'loading' : 'paused';
    g.playback.position = position != null ? position : clip.start;
    g.playback.clipStart = clip.start;
    g.playback.clipEnd = clip.end;
    g.playback.recovered = false;
    g.playback.startedAt = new Date(this._now()).toISOString();
    this.lastError = null;
    this.player({ cmd: 'load', token: this.loadToken, index, src: song.path, start: g.playback.position, clipStart: clip.start, clipEnd: clip.end, autoplay, volume: this.settings.volume });
  }

  /** Called when the audience window (re)connects: restore what it should be showing. */
  playerReady() {
    this.audienceConnected = true;
    const pb = this.game.playback;
    if (pb.index >= 0 && ['playing', 'loading', 'paused'].includes(pb.status)) {
      const song = this.song(this.game.order[pb.index]);
      const clip = this.clipFor(song);
      this.loadToken++;
      const autoplay = pb.status === 'playing' || pb.status === 'loading';
      this.player({ cmd: 'load', token: this.loadToken, index: pb.index, src: song.path, start: pb.position || clip.start, clipStart: clip.start, clipEnd: clip.end, autoplay, volume: this.settings.volume });
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

  playerError(token, message) {
    if (token !== this.loadToken) return;
    const id = this.currentSongId();
    const s = id ? this.song(id) : null;
    this.lastError = `Could not play "${s ? s.title : 'song'}": ${message}`;
    this.log(this.lastError);
    this.game.playback.status = 'idle';
    if (id && !this.game.skipped.includes(id)) this.game.skipped.push(id);
    this.player({ cmd: 'clear' });
    if (this.hooks.event) this.hooks.event('error', { message: this.lastError });
    this.scheduleAdvance();
    this.touch('state');
  }

  scheduleAdvance() {
    const g = this.game; const s = this.settings;
    const next = this.nextUnplayedIndex(g.playback.index);
    if (next < 0) { g.playback.status = 'finished'; this.log('All songs in the playlist have been played'); return; }
    if (!s.autoAdvance || g.gamePaused || g.round.number === 0 || g.status === 'finished') return;
    const gap = Math.max(0, Number(s.autoAdvanceGap) || 0) * 1000;
    g.playback.status = 'between';
    g.playback.nextAt = this._now() + gap;
    this.advanceTimer = this._setTimeout(() => {
      this.advanceTimer = null;
      if (g.playback.status !== 'between') return;
      const n = this.nextUnplayedIndex(g.playback.index);
      if (n >= 0) { this.loadIndex(n, { autoplay: true }); this.touch('state'); }
    }, gap);
  }

  addPlayed(songId, manual) {
    if (this.isPlayed(songId)) return false; // replays never duplicate the history
    this.game.played.push({ songId, at: new Date(this._now()).toISOString(), round: this.game.round.number, manual: !!manual });
    this.game.skipped = this.game.skipped.filter(x => x !== songId);
    const s = this.song(songId);
    this.log(`Played #${this.game.played.length}: ${s.title} — ${s.artist}${manual ? ' (marked by host)' : ''}`);
    return true;
  }

  /* ----------------------------------------------------------------- actions */
  dispatch(action, args = {}, source = 'desktop') {
    const fn = this.actions[action];
    if (!fn) throw new Error(`Unknown action: ${action}`);
    if (this.game.status === 'finished' && !['openChecker', 'closeChecker', 'checkClaim', 'setCrawler', 'setOverlay', 'reopenGame', 'setVolume'].includes(action)) {
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
      setCrawler: this.aSetCrawler, setOverlay: this.aSetOverlay, setGameSettings: this.aSetGameSettings,
      openChecker: this.aOpenChecker, closeChecker: this.aCloseChecker, checkClaim: this.aCheckClaim,
      confirmClaim: this.aConfirmClaim, dismissClaim: this.aDismissClaim, revokeWinner: this.aRevokeWinner,
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
    this.loadIndex(pb.index, { autoplay: true }); // already-played songs are never re-added to history
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

  aClipMode(args) {
    const m = args.clipMode === 'full' ? 'full' : Number(args.clipMode);
    if (!CLIP_MODES.includes(m)) throw new Error('Clip length must be 20, 30, 40, 60 seconds or full song');
    this.settings.clipMode = m;
    const pb = this.game.playback;
    const id = this.currentSongId();
    if (id && ['playing', 'paused', 'loading'].includes(pb.status)) {
      const clip = this.clipFor(this.song(id));
      pb.clipStart = clip.start; pb.clipEnd = clip.end;
      this.player({ cmd: 'clip', token: this.loadToken, clipStart: clip.start, clipEnd: clip.end });
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

  aMarkPlayed(args) {
    const id = args.songId || this.currentSongId();
    if (!id || !this.song(id)) throw new Error('No song selected');
    if (this.game.round.number === 0) throw new Error('Start Round 1 first.');
    const added = this.addPlayed(id, true);
    this.touch('state');
    return { ok: true, added };
  }

  aUnmarkPlayed(args) {
    const id = args.songId;
    const before = this.game.played.length;
    this.game.played = this.game.played.filter(p => p.songId !== id);
    if (this.game.played.length === before) return { ok: false, message: 'That song is not in the played history.' };
    this.log(`Correction: removed "${this.song(id).title}" from the played history`);
    this.touch('state');
    return { ok: true };
  }

  aStartRound(args) {
    const g = this.game;
    const n = Number(args.round || (g.round.number + 1));
    if (![1, 2, 3].includes(n)) throw new Error('Round must be 1, 2 or 3');
    if (n < g.round.number) throw new Error(`Round ${g.round.number} has already started — rounds cannot go backwards.`);
    if (n === g.round.number && g.round.status === 'active') return { ok: true, already: true };
    if (g.round.number > 0 && g.round.status === 'active') {
      g.rounds[g.round.number].endedAt = new Date(this._now()).toISOString();
    }
    g.round = { number: n, status: 'active' };
    g.rounds[n] = Object.assign(g.rounds[n] || {}, { startedAt: new Date(this._now()).toISOString(), startPlayedCount: g.played.length, endedAt: null });
    g.status = 'live';
    g.gamePaused = false;
    this.log(`Round ${n} started — ${rules.ROUNDS[n].label}`);
    this.touch('round');
    // Start or continue the music
    const st = g.playback.status;
    if (args.play !== false && !['playing', 'loading', 'between'].includes(st)) {
      try { this.aPlay({}); } catch (e) { return { ok: true, warning: e.message }; }
    }
    return { ok: true };
  }

  aEndRound() {
    const g = this.game;
    if (g.round.number === 0 || g.round.status !== 'active') throw new Error('No round is in progress.');
    g.round.status = 'ended';
    g.rounds[g.round.number].endedAt = new Date(this._now()).toISOString();
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
    this.cancelAdvance();
    if (g.playback.index >= 0) this.player({ cmd: 'clear' });
    g.playback.status = 'stopped';
    if (g.round.number > 0 && g.round.status === 'active') { g.round.status = 'ended'; g.rounds[g.round.number].endedAt = new Date(this._now()).toISOString(); }
    g.status = 'finished';
    g.endedAt = new Date(this._now()).toISOString();
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
    ['enabled'].forEach(k => { if (args[k] != null) o[k] = !!args[k]; });
    if (args.position && ['bottom-left', 'bottom-center', 'top-left'].includes(args.position)) o.position = args.position;
    if (args.titleSize != null) o.titleSize = Math.max(24, Math.min(140, Number(args.titleSize)));
    if (args.artistSize != null) o.artistSize = Math.max(16, Math.min(100, Number(args.artistSize)));
    if (args.opacity != null) o.opacity = Math.max(0, Math.min(1, Number(args.opacity)));
    if (args.duration != null) o.duration = Math.max(0, Number(args.duration));
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

  aUpdateSong(args) {
    const s = this.song(args.songId);
    if (!s) throw new Error('Song not in this game');
    ['clipStart', 'clipEnd'].forEach(k => { if (k in args) s[k] = args[k] === null || args[k] === '' ? null : Math.max(0, Number(args[k])); });
    ['displayTitle', 'title', 'artist'].forEach(k => { if (typeof args[k] === 'string' && args[k].trim()) s[k] = args[k].trim(); });
    this.touch('state');
    return { ok: true };
  }

  /* -------------------------------------------------------- bingo checking */
  aOpenChecker(args, source) {
    this.checkersOpen++;
    const pb = this.game.playback;
    let paused = false;
    if (this.settings.pauseOnClaim && ['playing', 'loading', 'between'].includes(pb.status)) {
      if (pb.status === 'between') { this.cancelAdvance(); pb.pausedForClaim = 'between'; }
      else { pb.status = 'paused'; pb.pausedForClaim = true; this.player({ cmd: 'pause' }); }
      paused = true;
      this.log(`Music paused for a BINGO check (${source})`);
    }
    this.touch('state', false);
    return { ok: true, paused };
  }

  aCloseChecker(args) {
    this.checkersOpen = Math.max(0, this.checkersOpen - 1);
    const pb = this.game.playback;
    let resumed = false;
    if (args.resume && pb.pausedForClaim) {
      const wasBetween = pb.pausedForClaim === 'between';
      pb.pausedForClaim = false;
      if (wasBetween) { pb.status = 'idle'; this.scheduleAdvance(); if (pb.status !== 'between') this.aPlay({}); }
      else this.aPlay({});
      resumed = true;
    } else if (args.resume && pb.status === 'paused') {
      this.aPlay({}); resumed = true;
    }
    this.touch('state', false);
    return { ok: true, resumed };
  }

  findCard(no) { return this.game.cards.find(c => c.no === no); }

  activeCheckRound() {
    const r = this.game.round;
    if (r.number === 0) return 0;
    return r.number;
  }

  /** Verify a claim. Records it in the claim history; never confirms by itself. */
  aCheckClaim(args, source) {
    const g = this.game;
    let cardNo = null;
    if (args.qr) {
      const q = parseQrPayload(args.qr);
      if (!q) return { ok: false, error: 'That QR code is not a Crime Master Bingo card.' };
      if (q.gameId !== g.id) return { ok: false, error: 'That card belongs to a different game. Only cards printed for this game can win.' };
      cardNo = q.cardNo;
    } else {
      cardNo = parseInt(String(args.cardNo || '').trim(), 10);
    }
    if (!Number.isInteger(cardNo) || cardNo < 1 || cardNo > 999) return { ok: false, error: 'Enter a card number between 1 and 999.' };
    const card = this.findCard(cardNo);
    if (!card) return { ok: false, error: `Card ${formatCardNo(cardNo)} does not exist in this game.` };
    const round = this.activeCheckRound();
    if (!round) return { ok: false, error: 'No round has started yet.' };

    const result = this.evaluate(card, round);
    const alreadyWinner = g.claims.find(c => c.cardNo === cardNo && c.round === round && c.status === 'confirmed');
    let claim = g.claims.find(c => c.cardNo === cardNo && c.round === round && c.status === 'pending');
    const record = {
      cardNo, round, at: new Date(this._now()).toISOString(), source,
      valid: result.valid, headline: result.headline, reason: result.reason,
      playedCount: g.played.length, winningCells: result.winningCells
    };
    if (alreadyWinner) {
      record.status = 'duplicate';
      claim = Object.assign({ id: uid('c_') }, record);
      g.claims.push(claim);
    } else if (claim) {
      Object.assign(claim, record, { status: result.valid ? 'pending' : 'invalid' });
    } else {
      claim = Object.assign({ id: uid('c_') }, record, { status: result.valid ? 'pending' : 'invalid' });
      g.claims.push(claim);
    }
    this.log(`BINGO check: card ${formatCardNo(cardNo)} — ${result.valid ? 'VALID' : 'NOT VALID'} (${result.headline})`);
    this.touch('claims', true);
    return {
      ok: true, claimId: claim.id, status: claim.status, cardNo, cardLabel: formatCardNo(cardNo), round,
      roundLabel: rules.ROUNDS[round].label, roundStatus: g.round.status,
      valid: result.valid, headline: result.headline, reason: result.reason,
      alreadyWinner: !!alreadyWinner,
      otherRoundWins: g.claims.filter(c => c.cardNo === cardNo && c.status === 'confirmed' && c.round !== round).map(c => c.round),
      qualifiedAtSong: result.qualifiedAtSong, playedCount: g.played.length,
      printed: !!card.printed,
      grid: result.grid, winningCells: result.winningCells, lines: result.lines
    };
  }

  evaluate(card, round) {
    const playedIds = this.game.played.map(p => p.songId);
    const set = new Set(playedIds);
    const res = rules.checkCard(card.cells, set, round);
    const win = new Set(res.winningCells);
    const order = new Map(playedIds.map((id, i) => [id, i + 1]));
    res.grid = card.cells.map((id, i) => {
      const s = this.song(id) || { title: '?', artist: '' };
      return { songId: id, title: s.displayTitle || s.title, artist: s.artist, played: set.has(id), playedNo: order.get(id) || null, winning: win.has(i) };
    });
    res.qualifiedAtSong = res.valid ? rules.qualifiedAt(card.cells, playedIds, round) : null;
    return res;
  }

  aConfirmClaim(args) {
    const g = this.game;
    const claim = g.claims.find(c => c.id === args.claimId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status === 'confirmed') return { ok: true, already: true };
    if (g.claims.some(c => c.cardNo === claim.cardNo && c.round === claim.round && c.status === 'confirmed')) throw new Error(`Card ${formatCardNo(claim.cardNo)} is already a confirmed winner in this round.`);
    // Re-verify against the current history at the moment of confirmation.
    const card = this.findCard(claim.cardNo);
    const res = rules.checkCard(card.cells, this.playedSet(), claim.round);
    if (!res.valid) throw new Error('This card no longer meets the winning rule — it cannot be confirmed.');
    claim.status = 'confirmed';
    claim.confirmedAt = new Date(this._now()).toISOString();
    claim.headline = res.headline;
    this.log(`WINNER confirmed: card ${formatCardNo(claim.cardNo)}, Round ${claim.round} (${res.headline})`);
    if (this.settings.winnerAnimation) this.event('celebrate', { round: claim.round, label: rules.ROUNDS[claim.round].label });
    this.touch('claims');
    return { ok: true };
  }

  aDismissClaim(args) {
    const claim = this.game.claims.find(c => c.id === args.claimId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status === 'confirmed') throw new Error('Use "Undo winner" to remove a confirmed winner.');
    claim.status = claim.valid ? 'dismissed' : 'rejected';
    this.log(`Claim for card ${formatCardNo(claim.cardNo)} ${claim.status}`);
    this.touch('claims');
    return { ok: true };
  }

  aRevokeWinner(args) {
    const claim = this.game.claims.find(c => c.id === args.claimId);
    if (!claim || claim.status !== 'confirmed') throw new Error('That claim is not a confirmed winner.');
    claim.status = 'revoked';
    claim.revokedAt = new Date(this._now()).toISOString();
    this.log(`Winner REVOKED: card ${formatCardNo(claim.cardNo)}, Round ${claim.round}`);
    this.touch('claims');
    return { ok: true };
  }

  /* ------------------------------------------------------------ state views */
  historyView() {
    return this.game.played.map((p, i) => {
      const s = this.song(p.songId) || {};
      return { n: i + 1, songId: p.songId, title: s.displayTitle || s.title, artist: s.artist, round: p.round, manual: p.manual, at: p.at };
    });
  }

  winners() {
    return this.game.claims.filter(c => c.status === 'confirmed').map(c => ({ claimId: c.id, cardNo: c.cardNo, cardLabel: formatCardNo(c.cardNo), round: c.round, headline: c.headline, at: c.confirmedAt }));
  }

  currentView() {
    const pb = this.game.playback;
    const id = this.currentSongId();
    if (!id) return null;
    const s = this.song(id);
    return { songId: id, index: pb.index, number: pb.index + 1, title: s.displayTitle || s.title, artist: s.artist, played: this.isPlayed(id), duration: s.duration };
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
      history: this.game.played.map((p, i) => { const x = this.song(p.songId) || {}; return { n: i + 1, title: x.displayTitle || x.title, artist: x.artist }; }),
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
    return {
      gameId: g.id, name: g.name, venue: g.venue, date: g.date, status: g.status, gamePaused: !!g.gamePaused,
      version: g.version,
      playback: { status: pb.status, index: pb.index, position: pb.position, clipStart: pb.clipStart, clipEnd: pb.clipEnd, pausedForClaim: !!pb.pausedForClaim, recovered: !!pb.recovered, nextAt: pb.nextAt || null },
      current: this.currentView(),
      next: next ? { title: next.displayTitle || next.title, artist: next.artist, number: nextIdx + 1 } : null,
      totals: { songs: total, played: g.played.length, remaining, skipped: g.skipped.length, cards: g.cards.length, printed: g.cards.filter(c => c.printed).length },
      round: { number: g.round.number, status: g.round.status, label: g.round.number ? rules.ROUNDS[g.round.number].label : null, rule: g.round.number ? rules.ROUNDS[g.round.number].rule : null },
      history: this.historyView(),
      winners: this.winners(),
      claims: g.claims.slice(-30).reverse().map(c => ({ id: c.id, cardNo: c.cardNo, cardLabel: formatCardNo(c.cardNo), round: c.round, status: c.status, valid: c.valid, headline: c.headline, at: c.at, source: c.source })),
      settings: { clipMode: this.settings.clipMode, volume: this.settings.volume, autoAdvance: this.settings.autoAdvance, autoAdvanceGap: this.settings.autoAdvanceGap, pauseOnClaim: this.settings.pauseOnClaim, crawler: this.settings.crawler, overlay: this.settings.overlay, patternPosition: this.settings.patternPosition, winnerAnimation: this.settings.winnerAnimation, defaultStart: this.settings.defaultStart },
      audienceConnected: this.audienceConnected,
      lastError: this.lastError
    };
  }

  /** Full play order (desktop only). */
  orderView() {
    const played = new Map(this.game.played.map((p, i) => [p.songId, i + 1]));
    const skipped = new Set(this.game.skipped);
    return this.game.order.map((id, i) => { const s = this.song(id); return { index: i, songId: id, title: s.displayTitle || s.title, artist: s.artist, playedNo: played.get(id) || null, skipped: skipped.has(id), clipStart: s.clipStart, clipEnd: s.clipEnd, duration: s.duration }; });
  }
}

/** Build a brand-new game object from a playlist snapshot. */
function createGame({ name, date, venue, logo, songs, playlistId, playlistName, settings }) {
  const { MIN_SONGS } = require('./cards');
  const ids = Array.from(new Set(songs.map(s => s.id)));
  if (ids.length < MIN_SONGS) throw new Error(`A game needs at least ${MIN_SONGS} unique songs — add ${MIN_SONGS - ids.length} more.`);
  const map = {};
  songs.forEach(s => {
    map[s.id] = { id: s.id, title: s.title, artist: s.artist, displayTitle: s.displayTitle || '', printTitle: s.printTitle || '', path: s.path, duration: s.duration || 0, clipStart: s.clipStart != null ? s.clipStart : null, clipEnd: s.clipEnd != null ? s.clipEnd : null };
  });
  const st = Object.assign(defaultGameSettings(), settings || {});
  const id = 'G' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const game = {
    id, name: name || 'Music Bingo', date: date || new Date().toISOString().slice(0, 10), venue: venue || '', logo: logo || null,
    createdAt: new Date().toISOString(), playlistId, playlistName,
    songs: map, order: st.shuffle ? shuffle(ids) : ids.slice(),
    settings: st, status: 'setup'
  };
  return GameEngine.normalise(game);
}

module.exports = { GameEngine, createGame, defaultGameSettings, CLIP_MODES };
