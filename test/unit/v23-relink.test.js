'use strict';
/* 2.1: Music Library "Relink folder" no longer relinks by file name alone. One matcher is
 * shared with the per-game relink: identical files are relinked, weaker matches need a tick. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { Store } = require('../../src/main/store');
const { Library } = require('../../src/main/library');
const { findMatches } = require('../../src/main/relink');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cmb23-'));
const write = (dir, name, buf) => { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, name); fs.writeFileSync(f, buf); return f; };

test('library relink: identical (even renamed) files relinked; same name but different content is only suggested', async () => {
  const a = tmp(); const moved = tmp();
  const bufs = [0, 1, 2].map(() => crypto.randomBytes(4000));
  const files = ['Nova Lane - Silver Disco.mp4', 'Demo Tapes - Lonely Thunder.mp4', 'DJ Placeholder - Velvet Disco.mp4'].map((n, i) => write(a, n, bufs[i]));
  const lib = new Library(new Store(tmp()));
  await lib.importPaths([a]);
  const ids = Object.fromEntries(lib.songs().map(s => [s.fileName, s.id]));
  // the folder moves: song 1 identical, song 2 renamed but identical, song 3 replaced by a different file with the same name
  write(moved, 'Nova Lane - Silver Disco.mp4', bufs[0]);
  write(path.join(moved, 'sub'), 'lonely_thunder (copy).mp4', bufs[1]);
  write(moved, 'DJ Placeholder - Velvet Disco.mp4', crypto.randomBytes(4000));
  files.forEach(f => fs.unlinkSync(f));
  assert.strictEqual(lib.checkFiles(), 3);
  const r = lib.relinkFolder(moved);
  assert.strictEqual(r.fixed, 2, 'two provably identical files relinked');
  assert.strictEqual(lib.get(ids['Demo Tapes - Lonely Thunder.mp4']).path, path.join(moved, 'sub', 'lonely_thunder (copy).mp4'), 'found although renamed');
  const velvet = lib.get(ids['DJ Placeholder - Velvet Disco.mp4']);
  assert.strictEqual(velvet.status, 'missing', 'the same-name file with different content is NOT applied silently');
  assert.strictEqual(r.needsConfirm.length, 1);
  assert.strictEqual(r.needsConfirm[0].match, 'filename');
  assert.strictEqual(r.needsConfirm[0].id, velvet.id);
  // the host ticks it → applied
  lib.relink(velvet.id, r.needsConfirm[0].path);
  assert.notStrictEqual(lib.get(velvet.id).status, 'missing');
  assert.strictEqual(lib.songs().length, 3, 'song ids kept, nothing re-imported');
});

test('matcher: exact matches are taken before weaker ones, a file is never offered twice, title + artist needs a tick', () => {
  const dir = tmp();
  const x = crypto.randomBytes(3000);
  const fx = write(dir, 'Artist - Song.mp4', x);
  const fy = write(dir, 'Other Artist - Other Song.mp4', crypto.randomBytes(3000));
  const { fingerprint } = require('../../src/main/library');
  const items = [
    { id: 'weak', fileName: 'Artist - Song.mp4', size: 1, fingerprint: 'nope', title: 'Song', artist: 'Artist' }, // listed first, would steal fx
    { id: 'exact', fileName: 'renamed.mp4', size: x.length, fingerprint: fingerprint(fx).fp, title: 'Song', artist: 'Artist' },
    { id: 'tag', fileName: 'gone.mp4', size: 5, fingerprint: 'zzz', title: 'Other Song', artist: 'Other Artist' }
  ];
  const r = findMatches(items, dir);
  const by = Object.fromEntries(r.results.map(m => [m.id, m.candidate]));
  assert.deepStrictEqual([by.exact.path, by.exact.match, by.exact.auto], [fx, 'fingerprint', true]);
  assert.strictEqual(by.weak, null, 'the identical file belongs to the exact match');
  assert.deepStrictEqual([by.tag.path, by.tag.match, by.tag.auto], [fy, 'title-artist', false]);
  assert.deepStrictEqual([r.autoMatched, r.needsConfirm, r.unmatched], [1, 1, 1]);
});
