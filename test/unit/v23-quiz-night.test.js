'use strict';
/* Quiz Intermission Mode (2.1): the evening alternates quiz time and bingo breaks. */
const test = require('node:test');
const assert = require('node:assert');
const { GameEngine } = require('../../src/core/engine');
const { makeEngine } = require('./helpers');

test('Return to Quiz pauses mid-song, keeps the exact position, completes nothing and blocks playback', () => {
  const { eng, game, calls, finish, runTimers } = makeEngine({ cards: 10 });
  eng.dispatch('startRound', { round: 1 });
  finish(); runTimers(); finish(); runTimers(); // two songs counted, third loading
  eng.playerStarted(eng.loadToken); eng.playerTime(eng.loadToken, 23.4);
  const order = game.order.slice(); const cards = JSON.stringify(game.cards);
  assert.strictEqual(game.playback.status, 'playing');
  const r = eng.dispatch('returnToQuiz', {});
  assert.strictEqual(r.phase, 'quiz');
  assert.strictEqual(game.playback.status, 'paused');
  assert.strictEqual(calls.player[calls.player.length - 1].cmd, 'pause');
  assert.deepStrictEqual([r.pausedAt.index, r.pausedAt.position], [game.playback.index, 23.4]);
  assert.strictEqual(game.round.status, 'active', 'the round is not completed');
  assert.strictEqual(game.night.breaks.length, 1, 'the first stretch of bingo counts as break 1');
  assert.strictEqual(game.night.breaks[0].playedAtEnd, 2);
  for (const a of ['play', 'togglePlay', 'next', 'skip', 'replay', 'previous']) {
    assert.throws(() => eng.dispatch(a, {}), /quiz time/, a + ' is refused during the quiz');
  }
  assert.strictEqual(eng.audienceScreen().mode, 'quiz');
  assert.strictEqual(eng.hostState().night.phase, 'quiz');
  assert.deepStrictEqual(game.order, order, 'nothing reshuffled'); assert.strictEqual(JSON.stringify(game.cards), cards, 'cards untouched');
  assert.deepStrictEqual(eng.dispatch('returnToQuiz', {}), { ok: true, already: true });
});

test('Start Bingo Break: waits for Play by default, resumes the same song at the same position, numbers the breaks', () => {
  const { eng, game, finish, runTimers } = makeEngine({ cards: 10 });
  eng.dispatch('startRound', { round: 1 }); finish(); runTimers();
  eng.playerStarted(eng.loadToken); eng.playerTime(eng.loadToken, 41);
  const idx = game.playback.index;
  eng.dispatch('returnToQuiz', {});
  const b = eng.dispatch('startBreak', {});
  assert.deepStrictEqual([b.breakNo, b.playing], [2, false]);
  assert.strictEqual(game.playback.status, 'paused', 'waits for the host to press Play');
  eng.dispatch('play', {});
  assert.deepStrictEqual([game.playback.status, game.playback.index, game.playback.position], ['playing', idx, 41]);
  finish(); runTimers(); eng.playerStarted(eng.loadToken);
  eng.dispatch('returnToQuiz', {});
  eng.dispatch('setNight', { autoPlay: true });
  const b3 = eng.dispatch('startBreak', {});
  assert.deepStrictEqual([b3.breakNo, b3.playing], [3, true], 'with "play straight away" the music starts');
  const v = eng.nightView();
  assert.deepStrictEqual(v.breaks.map(x => x.n), [1, 2, 3]);
  assert.deepStrictEqual(v.breaks.map(x => x.songs), [1, 1, 0]);
  assert.ok(game.audit.some(a => a.action === 'quiz-start') && game.audit.some(a => a.action === 'break-start'));
});

test('Quiz time during a gap between songs: auto-advance is cancelled and does not fire', () => {
  const { eng, game, timers, runTimers, finish } = makeEngine({ cards: 10 });
  eng.dispatch('startRound', { round: 1 });
  finish();
  assert.strictEqual(game.playback.status, 'between');
  eng.dispatch('returnToQuiz', {});
  runTimers();
  assert.ok(!['loading', 'playing'].includes(game.playback.status), 'no song started while the TV is hidden');
  eng.dispatch('startBreak', { play: true });
  assert.ok(['loading', 'playing'].includes(game.playback.status));
  assert.strictEqual(timers.filter(t => t && t.fn).length >= 0, true);
});

test('A claim session stays open through quiz time; closing it with "resume" does not start music during the quiz', () => {
  const { eng, game, finish, runTimers } = makeEngine({ cards: 10 });
  eng.dispatch('startRound', { round: 1 });
  for (let i = 0; i < 6; i++) { finish(); runTimers(); }
  eng.playerStarted(eng.loadToken);
  eng.dispatch('freezeClaims', {});
  const sid = eng.activeSession().id;
  eng.dispatch('returnToQuiz', {});
  assert.strictEqual(eng.activeSession().id, sid, 'session still open');
  eng.dispatch('addClaim', { cardNo: game.cards[0].no });
  eng.dispatch('closeSession', { resume: true });
  assert.notStrictEqual(game.playback.status, 'playing', 'no music during the quiz');
  eng.dispatch('startBreak', {});
  eng.dispatch('play', {});
  assert.strictEqual(game.playback.status, 'playing');
});

test('Quiz settings: holding screen option; old games load in break phase; crash recovery keeps quiz time', () => {
  const { eng, game } = makeEngine({ cards: 4 });
  eng.dispatch('setNight', { quizTv: 'hold' });
  assert.strictEqual(eng.hostState().night.quizTv, 'hold');
  eng.dispatch('setNight', { quizTv: 'bogus' });
  assert.strictEqual(game.settings.night.quizTv, 'hold');
  const old = JSON.parse(JSON.stringify(game)); delete old.night; delete old.settings.night;
  const e2 = new GameEngine(old, {});
  assert.strictEqual(e2.game.night.phase, 'break'); assert.strictEqual(e2.game.settings.night.quizTv, 'hide');
  eng.dispatch('returnToQuiz', {});
  const e3 = new GameEngine(JSON.parse(JSON.stringify(game)), {});
  assert.strictEqual(e3.game.night.phase, 'quiz', 'reopening after a crash stays in quiz time');
  assert.throws(() => e3.dispatch('play', {}), /quiz time/);
});

test('Ending the game during quiz time works; switching after the game has ended is refused', () => {
  const { eng } = makeEngine({ cards: 4 });
  eng.dispatch('startRound', { round: 1 });
  eng.dispatch('returnToQuiz', {});
  eng.dispatch('endGame', {});
  assert.throws(() => eng.dispatch('returnToQuiz', {}), /ended/);
  assert.notStrictEqual(eng.audienceScreen().mode, 'quiz');
  const r = eng.dispatch('startBreak', {});
  assert.ok(r.finished && eng.game.night.phase === 'break', 'the TV can be brought back for the end screen');
});
