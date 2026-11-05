'use strict';
/* 2.4 music usage report + rights fields. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { usageRows, toCsv, summary, csvCell } = require('../../src/core/usage');
const { Store } = require('../../src/main/store');
const { Library } = require('../../src/main/library');
const { makeEngine, play } = require('./helpers');

test('rows: one per play, seconds from the clip length, credits marked, rights from the library', () => {
  const { eng, game } = makeEngine({ cards: 2, settings: { clipMode: 30 } });
  game.venue = 'The Red Lion'; game.date = '2026-11-05';
  play(eng, ['s1', 's2']); eng.addPlayed('s3', false, 'credit');
  const rows = usageRows(game, (id) => (id === 's2' ? { rights: { isrc: 'GBAYE0601498', label: 'Demo Records', licence: 'PRS-123' } } : null));
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual([rows[0].title, rows[0].seconds, rows[0].how, rows[0].venue], ['Song 1', 30, 'played', 'The Red Lion']);
  assert.deepStrictEqual([rows[1].isrc, rows[1].label, rows[1].licence], ['GBAYE0601498', 'Demo Records', 'PRS-123']);
  assert.ok(/technical credit/.test(rows[2].how) && rows[2].seconds === 0);
  assert.deepStrictEqual(summary(rows).map(r => r.title), ['Song 1', 'Song 2'], 'credits are not counted as plays');
});

test('CSV: Excel-safe UTF-8, quoting, and no formula injection from song titles', () => {
  assert.strictEqual(csvCell('Hello, "World"'), '"Hello, ""World"""');
  assert.strictEqual(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  const csv = toCsv([{ date: '2026-11-05', event: 'Quiz', venue: '', n: 1, time: '20:15', title: 'Dil Se Re', artist: 'A. R. Rahman', seconds: 30, fullLength: 240, how: 'played', isrc: '', label: '', licence: '', source: 'local video file' }]);
  assert.ok(csv.startsWith('﻿Date,Event,Venue,No.,Time,Title,Artist,Seconds played'));
  assert.ok(/Dil Se Re,A\. R\. Rahman,30,240,played/.test(csv));
});

test('library keeps rights details (ISRC normalised) and clears them when emptied', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmb26u-'));
  fs.writeFileSync(path.join(dir, 'Artist - Song.mp4'), crypto.randomBytes(2000));
  const lib = new Library(new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'cmb26d-'))));
  await lib.importPaths([dir]);
  const id = lib.songs()[0].id;
  lib.update(id, { rights: { isrc: 'gb-aye-06-01498', label: ' Demo Records ', licence: '' } });
  assert.deepStrictEqual(lib.get(id).rights, { isrc: 'GBAYE0601498', label: 'Demo Records' });
  lib.update(id, { rights: { isrc: '', label: '', licence: '' } });
  assert.strictEqual(lib.get(id).rights, undefined);
});
