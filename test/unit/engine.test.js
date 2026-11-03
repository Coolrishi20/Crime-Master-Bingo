'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeEngine, play } = require('./helpers');

test('cannot play before Round 1', () => { const { eng } = makeEngine(); assert.throws(() => eng.dispatch('play'), /Start Round 1/); });

test('starting Round 1 starts the first song; completion adds it to the ledger once', () => {
  const { eng, game, finish, runTimers } = makeEngine();
  eng.dispatch('startRound', { round: 1 });
  assert.strictEqual(game.playback.index, 0);
  assert.strictEqual(game.played.length, 0, 'history starts empty');
  finish();
  assert.strictEqual(game.played.length, 1);
  assert.strictEqual(game.played[0].songId, game.order[0]);
  runTimers(); // auto-advance gap
  assert.strictEqual(game.playback.index, 1);
  finish(); runTimers();
  assert.deepStrictEqual(game.played.map(p => p.songId), [game.order[0], game.order[1]]);
});

test('replay never duplicates a history entry', () => {
  const { eng, game, finish } = makeEngine({ settings: { autoAdvance: false } });
  eng.dispatch('startRound', { round: 1 }); finish();
  eng.dispatch('replay', {}); finish();
  eng.dispatch('previous', {}); finish();
  assert.strictEqual(game.played.length, 1);
});

test('skip requires confirmation and is not counted; mark-played is', () => {
  const { eng, game } = makeEngine();
  eng.dispatch('startRound', { round: 1 });
  const r = eng.dispatch('next', {});
  assert.ok(r.needsConfirm);
  eng.dispatch('next', { mode: 'skip' });
  assert.strictEqual(game.played.length, 0);
  assert.ok(game.skipped.includes(game.order[0]));
  eng.dispatch('next', { mode: 'markPlayed' });
  assert.strictEqual(game.played.length, 1);
  assert.strictEqual(game.played[0].songId, game.order[1]);
});

test('stale expectIndex prevents a double skip from two devices', () => {
  const { eng, game } = makeEngine();
  eng.dispatch('startRound', { round: 1 });
  const idx = game.playback.index;
  eng.dispatch('next', { mode: 'skip', expectIndex: idx });
  assert.throws(() => eng.dispatch('next', { mode: 'skip', expectIndex: idx }), /already changed/);
  assert.strictEqual(game.playback.index, idx + 1);
});

test('pause keeps position; history survives round changes', () => {
  const { eng, game, finish, runTimers } = makeEngine();
  eng.dispatch('startRound', { round: 1 }); finish(); runTimers();
  eng.playerStarted(eng.loadToken); eng.playerTime(eng.loadToken, 12.5);
  eng.dispatch('pause');
  assert.strictEqual(game.playback.status, 'paused');
  assert.strictEqual(game.playback.position, 12.5);
  eng.dispatch('endRound'); eng.dispatch('startRound', { round: 2 });
  assert.strictEqual(game.played.length, 1);
  assert.strictEqual(game.round.number, 2);
  assert.throws(() => eng.dispatch('startRound', { round: 1 }), /backwards/);
});

test('crash recovery restores paused at saved position with identical ledger', () => {
  const { eng, game, finish, runTimers } = makeEngine();
  eng.dispatch('startRound', { round: 1 }); finish(); runTimers();
  eng.playerStarted(eng.loadToken); eng.playerTime(eng.loadToken, 7);
  const saved = JSON.parse(JSON.stringify(game));
  const { GameEngine } = require('../../src/core/engine');
  const e2 = new GameEngine(saved, {});
  assert.strictEqual(saved.playback.status, 'paused');
  assert.strictEqual(saved.playback.position, 7);
  assert.ok(saved.playback.recovered);
  assert.deepStrictEqual(e2.audienceState().history.map(h => h.title), eng.audienceState().history.map(h => h.title));
  assert.deepStrictEqual(saved.cards, game.cards);
  assert.deepStrictEqual(saved.order, game.order);
});

test('audience state never exposes cards, claims or upcoming songs', () => {
  const { eng, finish } = makeEngine();
  eng.dispatch('startRound', { round: 1 }); finish();
  const keys = Object.keys(eng.audienceState()).sort();
  assert.deepStrictEqual(keys, ['crawler', 'gameName', 'history', 'logo', 'overlay', 'patternPosition', 'playbackStatus', 'round', 'screen', 'song']);
  const json = JSON.stringify(eng.audienceState());
  assert.ok(!/card/i.test(json.replace(/"crawler"/, '')));
});

test('player error is skipped, not counted and not auto-credited', () => {
  const { eng, game } = makeEngine({ settings: { autoAdvance: false } });
  eng.dispatch('startRound', { round: 1 });
  eng.playerError(eng.loadToken, 'format not supported');
  assert.strictEqual(game.played.length, 0);
  assert.strictEqual(game.credits.length, 0);
  assert.strictEqual(eng.hostState().unavailable.length, 1);
});

test('loads carry levelling gain + fades to the single player', () => {
  const { eng, calls } = makeEngine();
  eng.dispatch('startRound', { round: 1 });
  const load = calls.player.filter(c => c.cmd === 'load').pop();
  assert.strictEqual(load.audio.gainDb, -3);
  assert.strictEqual(load.audio.fadeIn, 0.5);
  assert.strictEqual(load.audio.fadeOut, 1);
  eng.dispatch('setAudio', { levelling: false });
  assert.strictEqual(calls.player.filter(c => c.cmd === 'audio').pop().gainDb, 0);
  eng.dispatch('setAudio', { toggleMute: true });
  assert.strictEqual(calls.player.filter(c => c.cmd === 'audio').pop().muted, true);
});

test('end game, then reopen', () => {
  const { eng, game } = makeEngine();
  eng.dispatch('startRound', { round: 1 });
  eng.dispatch('endGame');
  assert.strictEqual(game.status, 'finished');
  assert.throws(() => eng.dispatch('play'), /ended/);
  eng.dispatch('reopenGame');
  assert.strictEqual(game.status, 'live');
});
