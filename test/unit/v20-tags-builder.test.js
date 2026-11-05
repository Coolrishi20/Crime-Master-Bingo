'use strict';
/* Decade / genre tags and the playlist builder. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Library, cleanTags, decadeOf } = require('../../src/main/library');
const { Store } = require('../../src/main/store');

function lib50() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-'));
  const lib = new Library(new Store(path.join(dir, 'data')));
  for (let i = 0; i < 60; i++) lib.data.songs.push({ id: 's' + i, path: '/v/' + i + '.mp4', fileName: i + '.mp4', title: 'Song ' + i, artist: 'Artist ' + (i % 9), status: 'ok', fingerprint: 'f' + i, size: 1, tags: [] });
  lib.data.songs.push({ id: 'dup', path: '/v/dup.mp4', fileName: 'dup.mp4', title: 'Song 1', artist: 'Artist 1', status: 'ok', fingerprint: 'fd', size: 1, tags: [], duplicateOf: 's1' });
  lib.data.songs.push({ id: 'bad', path: '/v/bad.mp4', fileName: 'bad.mp4', title: 'Broken', artist: 'X', status: 'missing', fingerprint: 'fb', size: 1, tags: ['Bollywood'], year: 1985 });
  return lib;
}

test('tags are cleaned: trimmed, de-duplicated ignoring case, limited', () => {
  assert.deepStrictEqual(cleanTags(' Bollywood, bollywood ,Dance,, 80s  Party '), ['Bollywood', 'Dance', '80s Party']);
  assert.strictEqual(cleanTags(Array.from({ length: 20 }, (_, i) => 'T' + i)).length, 12);
  assert.strictEqual(decadeOf(1987), '1980s'); assert.strictEqual(decadeOf(2003), '2000s'); assert.strictEqual(decadeOf(null), null);
});

test('song editor fields and bulk tagging', () => {
  const lib = lib50();
  lib.update('s0', { year: '1984', tags: 'Bollywood, Retro' });
  assert.deepStrictEqual([lib.get('s0').year, lib.get('s0').tags], [1984, ['Bollywood', 'Retro']]);
  lib.update('s0', { year: 'nonsense' }); assert.strictEqual(lib.get('s0').year, null);
  const r = lib.bulkTag(['s1', 's2', 's3'], { add: 'Party, Bollywood', year: 1999 });
  assert.strictEqual(r.updated, 3); assert.deepStrictEqual(lib.get('s2').tags, ['Party', 'Bollywood']); assert.strictEqual(lib.get('s3').year, 1999);
  lib.bulkTag(['s1'], { remove: 'party' }); assert.deepStrictEqual(lib.get('s1').tags, ['Bollywood']);
  assert.strictEqual(lib.get('s1').year, 1999, 'year kept when not given');
});

test('builder: any decade AND any tag; playable, unique; preview count; unique names', () => {
  const lib = lib50();
  // 0–29: 1980s, 30–59: 1990s; Bollywood on every 3rd song; Dance on 0–9
  lib.bulkTag(Array.from({ length: 30 }, (_, i) => 's' + i), { year: 1985 });
  lib.bulkTag(Array.from({ length: 30 }, (_, i) => 's' + (i + 30)), { year: 1994 });
  lib.bulkTag(Array.from({ length: 60 }, (_, i) => 's' + i).filter((_, i) => i % 3 === 0), { add: 'Bollywood' });
  lib.bulkTag(Array.from({ length: 10 }, (_, i) => 's' + i), { add: 'Dance' });
  assert.strictEqual(lib.buildPlaylist({ decades: ['1980s'], dryRun: true }).matching, 30);
  assert.strictEqual(lib.buildPlaylist({ decades: ['1980s', '1990s'], dryRun: true }).matching, 60, 'decades: any of them');
  assert.strictEqual(lib.buildPlaylist({ decades: ['1980s'], tags: ['bollywood'], dryRun: true }).matching, 10, 'decade AND tag');
  assert.strictEqual(lib.buildPlaylist({ tags: ['Bollywood', 'Dance'], dryRun: true }).matching, 20 + 6, 'tags: any of them (missing file and duplicate never count)');
  const r = lib.buildPlaylist({ decades: ['1980s', '1990s'], count: 45 });
  assert.strictEqual(r.added, 45); assert.ok(r.enoughForGame); assert.strictEqual(r.name, '1980s + 1990s');
  const ids = lib.playlist(r.playlistId).songIds; assert.strictEqual(new Set(ids).size, 45); assert.ok(!ids.includes('dup') && !ids.includes('bad'));
  const r2 = lib.buildPlaylist({ decades: ['1980s', '1990s'], count: 45 });
  assert.strictEqual(r2.name, '1980s + 1990s (2)');
  const small = lib.buildPlaylist({ decades: ['1980s'], tags: ['Bollywood'], count: 75, name: 'Retro Bolly' });
  assert.strictEqual(small.added, 10); assert.ok(!small.enoughForGame);
  assert.throws(() => lib.buildPlaylist({ tags: ['Nothing'] }), /No playable songs/);
  const sum = lib.tagSummary();
  assert.deepStrictEqual(sum.decades, [{ decade: '1980s', count: 30 }, { decade: '1990s', count: 30 }]);
  assert.deepStrictEqual(sum.tags.map(t => [t.tag, t.count]), [['Bollywood', 20], ['Dance', 10]]);
});
