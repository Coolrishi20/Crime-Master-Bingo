'use strict';
const { GameEngine, createGame } = require('../../src/core/engine');
const { generateCards } = require('../../src/core/cards');

function makeSongs(n) {
  return Array.from({ length: n }, (_, i) => ({ id: 's' + i, title: 'Song ' + i, artist: 'Artist ' + (i % 7), path: '/media/s' + i + '.mp4', duration: 200, fingerprint: 'fp' + i, size: 1000 + i }));
}

/** Engine with fake timers and a recorded player. */
function makeEngine({ songs = 45, cards = 10, settings = {} } = {}) {
  const game = createGame({ name: 'Test', songs: makeSongs(songs), playlistId: 'p', playlistName: 'P', settings: Object.assign({ shuffle: false }, settings) });
  game.cards = generateCards(game.order, cards, []);
  const timers = [];
  const calls = { player: [], events: [], persisted: 0 };
  const eng = new GameEngine(game, {
    persist: () => { calls.persisted++; },
    player: (c) => calls.player.push(c),
    event: (n, p) => calls.events.push({ n, p }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    gainFor: () => ({ gainDb: -3, status: 'ok', lufs: -13 })
  });
  eng.audienceConnected = true;
  const runTimers = () => { while (timers.length) { const t = timers.shift(); if (t && t.fn) t.fn(); } };
  /** Simulate the TV player finishing the current clip. */
  const finish = () => { eng.playerStarted(eng.loadToken); eng.playerEnded(eng.loadToken); };
  return { eng, game, calls, timers, runTimers, finish };
}

/** Mark specific song ids as played (official ledger). */
function play(eng, ids) { ids.forEach(id => eng.addPlayed(id, false)); }

module.exports = { makeSongs, makeEngine, play };
