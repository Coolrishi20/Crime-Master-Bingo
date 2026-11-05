'use strict';
/* 2.4 automatic backups: queued at milestones, never written while a song plays, merged per
 * game, newest N kept; one-click backup refuses mid-song. Uses the real backup writer. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { AutoBackup } = require('../../src/main/autobackup');
const backup = require('../../src/main/backup');
const { makeEngine } = require('./helpers');

test('milestones wait for a gap between songs, merge per game, and keep the newest N', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb26-'));
  const { game } = makeEngine({ cards: 6 });
  let busy = true; const done = []; let keep = 3;
  const ab = new AutoBackup({ dir: () => dir, keep: () => keep, enabled: () => true, getGame: () => game, isBusy: () => busy,
    createBackup: (g, o) => backup.createBackup(g, Object.assign({ appVersion: 'test' }, o)), onDone: (i) => done.push(i), setInterval: () => 0 });
  ab.request(game.id, 'started'); ab.request(game.id, 'winner'); ab.request(game.id, 'winner');
  await ab.pump();
  assert.strictEqual(done.length, 0, 'nothing written while a song plays');
  await assert.rejects(ab.now(game.id), /song is playing/);
  busy = false; await ab.pump();
  assert.strictEqual(done.length, 1, 'two milestones while busy → one backup');
  assert.deepStrictEqual(done[0].reasons, ['started', 'winner']);
  assert.ok(done[0].auto && fs.existsSync(done[0].file));
  const info = await backup.inspectBackup(done[0].file, {});
  assert.ok(info.ok, JSON.stringify(info).slice(0, 300)); assert.strictEqual(info.manifest.gameId, game.id);
  for (let i = 0; i < 5; i++) { await ab.now(game.id, 'manual'); await new Promise(r => setTimeout(r, 15)); }
  assert.strictEqual(ab.list(game).length, 3, 'only the newest 3 kept');
  ab.stop();
});

test('switched off: milestones are ignored; one-click still works', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb26b-'));
  const { game } = makeEngine({ cards: 2 });
  const done = [];
  const ab = new AutoBackup({ dir: () => dir, keep: () => 10, enabled: () => false, getGame: () => game, isBusy: () => false,
    createBackup: (g, o) => backup.createBackup(g, Object.assign({ appVersion: 'test' }, o)), onDone: (i) => done.push(i), setInterval: () => 0 });
  assert.strictEqual(ab.request(game.id, 'ended'), false);
  const r = await ab.now(game.id);
  assert.ok(r && !r.auto && fs.existsSync(r.file) && done.length === 1);
});
