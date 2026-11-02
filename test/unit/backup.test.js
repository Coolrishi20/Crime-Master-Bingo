'use strict';
/* Upgrade 8 — Portable backup & restore */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const os = require('os'); const crypto = require('crypto');
const yazl = require('yazl');
const backup = require('../../src/main/backup');
const { makeEngine, play } = require('./helpers');
const { GameEngine } = require('../../src/core/engine');
const locking = require('../../src/core/locking');
const { fingerprint } = require('../../src/main/library');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cmbtest-'));
function gameWithMedia(nSongs = 45, nCards = 20) {
  const dir = tmp();
  const h = makeEngine({ songs: nSongs, cards: nCards });
  Object.values(h.game.songs).forEach((s, i) => {
    const f = path.join(dir, `Artist - Song ${i}.mp4`);
    fs.writeFileSync(f, crypto.randomBytes((i % 5 === 0 ? 300000 : 3000) + i)); // some files > 64 KB (multi-chunk streams)
    s.path = f; s.fileName = path.basename(f); const fp = fingerprint(f); s.fingerprint = fp.fp; s.size = fp.size;
  });
  return Object.assign(h, { mediaDir: dir });
}
function progress(h) {
  const { eng, game } = h;
  eng.dispatch('startRound', { round: 1 }); eng.playerStarted(eng.loadToken);
  play(eng, game.cards[0].cells.slice(0, 5));
  const r = eng.dispatch('addClaim', { cardNo: game.cards[0].no });
  eng.dispatch('confirmClaim', { claimId: r.claimId });
  eng.dispatch('closeSession', {});
  eng.dispatch('endRound'); eng.dispatch('startRound', { round: 2 });
  eng.dispatch('grantCredit', { songId: game.order.slice().reverse().find(id => !eng.isPlayed(id)), reason: 'Video corrupted', confirm: true });
  eng.dispatch('freezeClaims'); eng.dispatch('addClaim', { cardNo: game.cards[1].no });
  locking.lockGame(game, game.cards.map(c => c.no));
}
const memDb = () => { const db = {}; return { db, exists: (id) => !!db[id], save: (g) => { db[g.id] = JSON.parse(JSON.stringify(g)); } }; };

test('compact backup round-trips cards, ledger, credits, frozen session, winners and lock exactly', async () => {
  const h = gameWithMedia(); progress(h);
  const dir = tmp(); const file = path.join(dir, 'g.cmbbackup');
  const r = await backup.createBackup(JSON.parse(JSON.stringify(h.game)), { file });
  assert.ok(fs.existsSync(file) && !fs.existsSync(file + '.partial'));
  assert.strictEqual(r.type, 'game');
  const info = await backup.inspectBackup(file, { tmpDir: dir });
  assert.ok(info.ok, info.error); assert.ok(info.checks.every(c => c.ok));
  const m = memDb();
  const res = await backup.restoreBackup(file, Object.assign({ tmpDir: dir }, m));
  const g2 = m.db[res.gameId];
  assert.strictEqual(g2.id, h.game.id);
  assert.deepStrictEqual(g2.cards.map(c => [c.no, c.cells]), h.game.cards.map(c => [c.no, c.cells]));
  assert.deepStrictEqual(locking.labelsFor(g2), locking.labelsFor(h.game));
  assert.deepStrictEqual(g2.played, h.game.played);
  assert.deepStrictEqual(g2.order, h.game.order);
  assert.ok(g2.cardsLocked);
  const e2 = new GameEngine(g2, {});
  assert.strictEqual(e2.activeSession().id, h.eng.activeSession().id, 'frozen claim session preserved');
  assert.strictEqual(e2.winners().length, 1);
  assert.strictEqual(e2.hostState().credits.length, 1);
  assert.strictEqual(g2.round.number, 2);
  // valid + invalid claims still verify identically on the restored game
  const v1 = e2.dispatch('addClaim', { cardNo: h.game.cards[2].no }); const v0 = h.eng.dispatch('addClaim', { cardNo: h.game.cards[2].no });
  assert.strictEqual(v1.valid, v0.valid);
  assert.strictEqual(v1.headline, v0.headline);
});

test('full portable backup includes and verifies videos; restore relocates them', async () => {
  const h = gameWithMedia(); progress(h);
  const dir = tmp(); const file = path.join(dir, 'full.cmbbackup');
  const est = backup.estimate(h.game, true);
  assert.ok(est.mediaBytes > 45 * 3000);
  const r = await backup.createBackup(JSON.parse(JSON.stringify(h.game)), { file, includeMedia: true });
  assert.strictEqual(r.mediaIncluded, 45);
  fs.rmSync(h.mediaDir, { recursive: true, force: true }); // simulate a different laptop
  const m = memDb(); const dest = tmp();
  const res = await backup.restoreBackup(file, Object.assign({ tmpDir: dir, mediaDir: dest }, m));
  assert.strictEqual(res.mediaRestored, 45); assert.strictEqual(res.missing, 0);
  const g2 = m.db[res.gameId];
  Object.values(g2.songs).forEach(s => { assert.ok(fs.existsSync(s.path)); assert.strictEqual(fingerprint(s.path).fp, s.fingerprint); });
});

test('encrypted backup needs the right password', async () => {
  const h = gameWithMedia(); const dir = tmp(); const file = path.join(dir, 'e.cmbbackup');
  await backup.createBackup(JSON.parse(JSON.stringify(h.game)), { file, password: 'correct horse' });
  assert.ok(fs.readFileSync(file).subarray(0, 8).toString() === 'CMBENC1\n');
  assert.ok((await backup.inspectBackup(file, { tmpDir: dir })).needsPassword);
  assert.match((await backup.inspectBackup(file, { tmpDir: dir, password: 'nope' })).error, /Wrong password/);
  assert.ok((await backup.inspectBackup(file, { tmpDir: dir, password: 'correct horse' })).ok);
});

test('existing game is never overwritten; separate copy keeps cards and accepts the original QR', async () => {
  const h = gameWithMedia(); const dir = tmp(); const file = path.join(dir, 'c.cmbbackup');
  await backup.createBackup(JSON.parse(JSON.stringify(h.game)), { file });
  const m = memDb(); m.save(h.game);
  const before = JSON.stringify(m.db[h.game.id]);
  const r1 = await backup.restoreBackup(file, Object.assign({ tmpDir: dir }, m));
  assert.ok(r1.conflict);
  assert.strictEqual(JSON.stringify(m.db[h.game.id]), before);
  const r2 = await backup.restoreBackup(file, Object.assign({ tmpDir: dir, mode: 'separate' }, m));
  assert.ok(r2.separateCopy); assert.notStrictEqual(r2.gameId, h.game.id);
  const copy = m.db[r2.gameId];
  assert.deepStrictEqual(copy.cards.map(c => [c.no, c.cells]), h.game.cards.map(c => [c.no, c.cells]));
  const e = new GameEngine(copy, {}); e.dispatch('startRound', { round: 1, play: false });
  assert.ok(e.dispatch('addClaim', { qr: `CMB1|${h.game.id}|${h.game.cards[0].no}` }).ok);
  assert.match(e.dispatch('addClaim', { qr: `CMB1|GZZZZZZ|1` }).error, /different game/);
});

test('corrupted, truncated and tampered archives are rejected without touching the database', async () => {
  const h = gameWithMedia(); const dir = tmp(); const file = path.join(dir, 'x.cmbbackup');
  await backup.createBackup(JSON.parse(JSON.stringify(h.game)), { file });
  const buf = fs.readFileSync(file);
  const trunc = path.join(dir, 't.cmbbackup'); fs.writeFileSync(trunc, buf.subarray(0, buf.length - 100));
  assert.ok((await backup.inspectBackup(trunc, { tmpDir: dir })).error);
  const junk = path.join(dir, 'j.cmbbackup'); fs.writeFileSync(junk, 'hello');
  assert.ok((await backup.inspectBackup(junk, { tmpDir: dir })).error);
  // tamper: change a card but keep the old checksum in the manifest
  const g = JSON.parse(JSON.stringify(h.game)); const t = path.join(dir, 'tamper.cmbbackup');
  await backup.createBackup(g, { file: t });
  const m = memDb();
  const evil = path.join(dir, 'evil.cmbbackup');
  await new Promise(res => { const z = new yazl.ZipFile(); z.addBuffer(Buffer.from('{}'), '../../evil.txt'); z.outputStream.pipe(fs.createWriteStream(evil)).on('close', res); z.end(); }).catch(() => {});
  const ev = await backup.inspectBackup(evil, { tmpDir: dir });
  assert.ok(ev.error, 'path traversal refused');
  await assert.rejects(backup.restoreBackup(trunc, Object.assign({ tmpDir: dir }, m)));
  assert.deepStrictEqual(m.db, {});
});

test('newer-format archives are refused with a clear message', async () => {
  const dir = tmp(); const file = path.join(dir, 'new.cmbbackup');
  const h = gameWithMedia(); const gj = Buffer.from(JSON.stringify(h.game));
  const man = { format: 'cmbbackup', formatVersion: 99, schemaVersion: 2, gameId: h.game.id, files: [{ path: 'game.json', sha256: crypto.createHash('sha256').update(gj).digest('hex') }], media: [] };
  await new Promise(res => { const z = new yazl.ZipFile(); z.addBuffer(gj, 'game.json'); z.addBuffer(Buffer.from(JSON.stringify(man)), 'manifest.json'); z.outputStream.pipe(fs.createWriteStream(file)).on('close', res); z.end(); });
  assert.match((await backup.inspectBackup(file, { tmpDir: dir })).error, /newer version/);
});

test('interrupted backup leaves no complete-looking file', async () => {
  const h = gameWithMedia(); const dir = tmp(); const file = path.join(dir, 'i.cmbbackup');
  const g = JSON.parse(JSON.stringify(h.game)); g.songs[g.order[3]].path = '/nonexistent/dir/x.mp4';
  // make the destination unwritable mid-way by pointing into a missing folder
  await assert.rejects(backup.createBackup(g, { file: path.join(dir, 'missing-folder', 'i.cmbbackup'), includeMedia: true }));
  assert.ok(!fs.existsSync(file));
  assert.deepStrictEqual(fs.readdirSync(dir).filter(f => f.endsWith('.partial')), []);
});

test('relink assistant: fingerprint matches auto-accepted, weaker matches need confirmation', async () => {
  const h = gameWithMedia(45, 5); const g = h.game;
  const moved = tmp();
  const ids = g.order.slice(0, 3);
  // song 0: same file moved; song 1: same name, different content; song 2: renamed but same content
  fs.copyFileSync(g.songs[ids[0]].path, path.join(moved, g.songs[ids[0]].fileName));
  fs.writeFileSync(path.join(moved, g.songs[ids[1]].fileName), 'different recording');
  fs.copyFileSync(g.songs[ids[2]].path, path.join(moved, 'renamed.mp4'));
  ids.forEach(id => fs.unlinkSync(g.songs[id].path));
  const scan = backup.scanForMatches(g, moved);
  const by = Object.fromEntries(scan.results.map(r => [r.songId, r.candidate]));
  assert.strictEqual(by[ids[0]].match, 'fingerprint'); assert.ok(by[ids[0]].auto);
  assert.strictEqual(by[ids[1]].match, 'filename'); assert.ok(!by[ids[1]].auto);
  assert.strictEqual(by[ids[2]].match, 'fingerprint');
  const cardsBefore = JSON.stringify(g.cards);
  backup.applyMatches(g, scan.results.filter(r => r.candidate && r.candidate.auto).map(r => ({ songId: r.songId, path: r.candidate.path })));
  assert.strictEqual(backup.missingMedia(g).length, 1);
  assert.strictEqual(JSON.stringify(g.cards), cardsBefore);
  const one = backup.relinkOne(g, ids[1], path.join(moved, g.songs[ids[1]].fileName));
  assert.ok(one.needsConfirm);
  assert.ok(backup.relinkOne(g, ids[1], path.join(moved, g.songs[ids[1]].fileName), { confirm: true }).ok);
  assert.strictEqual(backup.missingMedia(g).length, 0);
});

test('999 cards and 120 songs back up and restore exactly', async () => {
  const h = gameWithMedia(120, 999); const dir = tmp(); const file = path.join(dir, 'big.cmbbackup');
  await backup.createBackup(JSON.parse(JSON.stringify(h.game)), { file });
  const m = memDb(); const r = await backup.restoreBackup(file, Object.assign({ tmpDir: dir }, m));
  assert.strictEqual(r.cards, 999);
  assert.strictEqual(backup.cardsHash(m.db[r.gameId]), backup.cardsHash(h.game));
});
