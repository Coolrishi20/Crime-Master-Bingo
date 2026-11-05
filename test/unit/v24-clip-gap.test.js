'use strict';
/* 2.2: clip editor helpers (bars + loud-section suggestion from the cached loudness profile)
 * and the gap between songs (the TV holds the last frame when another song follows). */
const test = require('node:test');
const assert = require('node:assert');
const { envelope, loudSection } = require('../../src/main/cliptools');
const { makeEngine } = require('./helpers');

// 200 s song: 6 s silent intro, verse at -22 dB, a loud stretch 120–150 s at -10 dB
const prof = { duration: 200, sub: Array.from({ length: 2000 }, (_, i) => (i < 60 ? -90 : i >= 1200 && i < 1500 ? -10 : -22)) };

test('envelope: a few hundred bars covering the whole song', () => {
  const e = envelope(prof, 200);
  assert.strictEqual(e.bars.length, 200); assert.strictEqual(e.duration, 200);
  assert.ok(e.bars[0] < -80 && Math.abs(e.bars[130] + 10) < 0.5 && Math.abs(e.bars[50] + 22) < 0.5);
  assert.ok(e.intro >= 5 && e.intro <= 6, 'intro end ' + e.intro);
  assert.strictEqual(envelope({ sub: [] }), null);
});

test('loud section: the loudest stretch of the chosen length, after the intro', () => {
  const s = loudSection(prof, 30);
  assert.deepStrictEqual([s.start, s.end], [120, 150]);
  const s20 = loudSection(prof, 20);
  assert.ok(s20.start >= 120 && s20.end <= 150);
  const flat = loudSection({ duration: 60, sub: Array(600).fill(-20) }, 30);
  assert.ok(flat.start >= 0 && flat.end <= 60);
  assert.strictEqual(loudSection(prof, 500), null, 'longer than the song');
});

test('gap: TV holds the last frame when the next song follows; clears when nothing follows or auto-play is off', () => {
  const { eng, calls, finish } = makeEngine({ cards: 4 });
  eng.dispatch('startRound', { round: 1 });
  finish();
  assert.deepStrictEqual(calls.player.filter(c => c.cmd === 'clear').pop(), { cmd: 'clear', hold: true });
  eng.dispatch('setGameSettings', { autoAdvance: false });
  eng.dispatch('play', {}); finish();
  assert.deepStrictEqual(calls.player.filter(c => c.cmd === 'clear').pop(), { cmd: 'clear' }, 'auto-play off → TV cleared');
  eng.dispatch('setGameSettings', { autoAdvance: true, autoAdvanceGap: 10 });
  assert.strictEqual(eng.settings.autoAdvanceGap, 10);
  eng.dispatch('setGameSettings', { autoAdvanceGap: 99 });
  assert.strictEqual(eng.settings.autoAdvanceGap, 30, 'capped at 30 s');
});
