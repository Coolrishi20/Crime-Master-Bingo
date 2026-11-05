'use strict';
/* M3U / M3U8 playlist import & export: encodings, #EXTINF, path styles, relocated files, streams,
 * library + playlist integration (order, metadata, duplicates, re-import), export round trip. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const M = require('../../src/main/m3u');
const { Library } = require('../../src/main/library');
const { Store } = require('../../src/main/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'm3u-'));
const fakeVideo = (file, seed) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from('video-' + seed + '-' + 'x'.repeat(2000 + seed * 37))); };

test('decoding: UTF-8 (BOM or not), UTF-16 LE/BE, and old Windows-1252 playlists', () => {
  const s = '#EXTM3U\n#EXTINF:200,Beyoncé - Halo\nhalo.mp4\n';
  assert.strictEqual(M.decode(Buffer.from('\uFEFF' + s, 'utf8')), s);
  assert.strictEqual(M.decode(Buffer.from(s, 'utf8')), s);
  assert.strictEqual(M.decode(Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(s, 'utf16le')])), s);
  const be = Buffer.from(s, 'utf16le'); be.swap16();
  assert.strictEqual(M.decode(Buffer.concat([Buffer.from([0xFE, 0xFF]), be])), s);
  assert.strictEqual(M.decode(Buffer.from(s, 'latin1')), s, 'é as a single Windows-1252 byte');
});

test('#EXTINF: duration, "Artist - Title", attributes with commas, no-separator labels', () => {
  assert.deepStrictEqual(M.parseExtinf('#EXTINF:215,Queen - Bohemian Rhapsody'), { duration: 215, label: 'Queen - Bohemian Rhapsody', artist: 'Queen', title: 'Bohemian Rhapsody' });
  const a = M.parseExtinf('#EXTINF:-1 tvg-id="x" group-title="Hits, 80s",A-ha – Take On Me');
  assert.strictEqual(a.duration, null); assert.strictEqual(a.artist, 'A-ha'); assert.strictEqual(a.title, 'Take On Me');
  assert.deepStrictEqual([M.parseExtinf('#EXTINF:100,Wonderwall').artist, M.parseExtinf('#EXTINF:100,Wonderwall').title], ['', 'Wonderwall']);
});

test('paths: relative (/ and \\), absolute, file:// URLs, streams, relocated drive, missing', () => {
  const base = path.join(path.sep, 'usb', 'Bingo');
  const have = new Set([path.join(base, 'Videos', 'a.mp4'), path.join(path.sep, 'media', 'b c.mp4'), path.join(base, 'Videos', 'Dé jà.mp4'), path.join(base, 'Old', 'Videos', 'z.mp4')]);
  const ex = (p) => have.has(p);
  assert.deepStrictEqual(M.resolveEntry('Videos/a.mp4', base, ex), { path: path.join(base, 'Videos', 'a.mp4') });
  assert.deepStrictEqual(M.resolveEntry('Videos\\a.mp4', base, ex), { path: path.join(base, 'Videos', 'a.mp4') });
  assert.deepStrictEqual(M.resolveEntry(path.join(path.sep, 'media', 'b c.mp4'), base, ex), { path: path.join(path.sep, 'media', 'b c.mp4') });
  assert.deepStrictEqual(M.resolveEntry('file:///media/b%20c.mp4', base, ex), { path: path.join(path.sep, 'media', 'b c.mp4') });
  assert.deepStrictEqual(M.resolveEntry('https://example.com/live.m3u8', base, ex), { url: 'https://example.com/live.m3u8' });
  // made on another PC: D:\Bingo\Videos\Dé jà.mp4 — the playlist now lives on the USB stick next to Videos\
  assert.deepStrictEqual(M.resolveEntry('D:\\Bingo\\Videos\\Dé jà.mp4', base, ex), { path: path.join(base, 'Videos', 'Dé jà.mp4'), relocated: true });
  assert.ok(M.resolveEntry('D:\\Gone\\nothing.mp4', base, ex).missing);
});

test('importM3U: playlist in M3U order, EXTINF titles, report of missing/audio/streams, re-import adds nothing twice', async () => {
  const dir = tmp(); const lib = new Library(new Store(path.join(dir, 'data')));
  const V = path.join(dir, 'Party');
  ['Queen_rhapsody.mp4', 'abba.mp4', 'Prince - Purple Rain.mp4', 'sub/oasis.mp4'].forEach((f, i) => fakeVideo(path.join(V, f), i));
  fs.writeFileSync(path.join(V, 'song.mp3'), 'mp3');
  const list = path.join(V, 'Friday Hits.m3u8');
  fs.writeFileSync(list, ['#EXTM3U', '#PLAYLIST:Friday Night Hits',
    '#EXTINF:354,Queen - Bohemian Rhapsody', 'Queen_rhapsody.mp4',
    '#EXTINF:232,Oasis - Wonderwall', 'sub\\oasis.mp4',
    '#EXTINF:180,ABBA - Dancing Queen', 'file://' + encodeURI(path.join(V, 'abba.mp4').split(path.sep).join('/')),
    '#EXTINF:0,Should Not Win - Guess', 'Prince - Purple Rain.mp4',
    'Queen_rhapsody.mp4',
    '#EXTINF:200,Lost - Song', 'missing.mp4', 'song.mp3', 'http://radio.example/stream'].join('\r\n'));
  const r = await lib.importM3U(list);
  assert.strictEqual(r.name, 'Friday Night Hits'); assert.ok(r.created);
  assert.strictEqual(r.newToLibrary, 4); assert.strictEqual(r.addedToPlaylist, 4);
  assert.strictEqual(r.missing.length, 1); assert.strictEqual(r.missing[0].label, 'Lost - Song');
  assert.strictEqual(r.audio.length, 1); assert.strictEqual(r.streams.length, 1);
  const pl = lib.playlist(r.playlistId);
  const titles = pl.songIds.map(id => lib.get(id)).map(s => s.artist + ' - ' + s.title);
  assert.deepStrictEqual(titles, ['Queen - Bohemian Rhapsody', 'Oasis - Wonderwall', 'ABBA - Dancing Queen', 'Prince - Purple Rain'], 'M3U order; EXTINF titles fill in names the file name lacks; a clean "Artist - Title" file name is kept');
  // re-import: nothing new, nothing doubled
  const r2 = await lib.importM3U(list);
  assert.ok(!r2.created); assert.strictEqual(r2.newToLibrary, 0); assert.strictEqual(r2.addedToPlaylist, 0); assert.strictEqual(r2.alreadyInPlaylist, 4);
  assert.strictEqual(lib.playlist(r.playlistId).songIds.length, 4);
  // your own edits win over the M3U on a later import
  lib.update(pl.songIds[0], { title: 'Bohemian Rhapsody (Live Aid)' });
  await lib.importM3U(list);
  assert.strictEqual(lib.get(pl.songIds[0]).title, 'Bohemian Rhapsody (Live Aid)');
});

test('plain (non-extended) Windows-1252 M3U with relative backslash paths; name from file name', async () => {
  const dir = tmp(); const lib = new Library(new Store(path.join(dir, 'data')));
  fakeVideo(path.join(dir, 'Clips', 'Beyoncé - Halo.mp4'), 7); fakeVideo(path.join(dir, 'Clips', 'Adele - Hello.mp4'), 8);
  const list = path.join(dir, 'old_winamp_list.m3u');
  fs.writeFileSync(list, Buffer.from('Clips\\Beyoncé - Halo.mp4\r\nClips\\Adele - Hello.mp4\r\n', 'latin1'));
  const r = await lib.importM3U(list);
  assert.strictEqual(r.name, 'old winamp list');
  const pl = lib.playlist(r.playlistId);
  assert.deepStrictEqual(pl.songIds.map(id => lib.get(id).artist), ['Beyoncé', 'Adele']);
  await assert.rejects(() => { fs.writeFileSync(list, '#EXTM3U\n'); return lib.importM3U(list); }, /no songs/);
});

test('exportM3U writes UTF-8 extended M3U with relative paths that re-imports identically', async () => {
  const dir = tmp(); const lib = new Library(new Store(path.join(dir, 'data')));
  ['A - One.mp4', 'B - Twö.mp4', 'C - Three.mp4'].forEach((f, i) => fakeVideo(path.join(dir, 'Vids', f), i + 20));
  await lib.importPaths([path.join(dir, 'Vids')]);
  const p = lib.createPlaylist('Export Me'); lib.addToPlaylist(p.id, lib.songs().map(s => s.id).reverse());
  const out = path.join(dir, 'Export Me.m3u8');
  const res = lib.exportM3U(p.id, out);
  assert.strictEqual(res.count, 3);
  const text = fs.readFileSync(out, 'utf8');
  assert.ok(text.startsWith('#EXTM3U\r\n#PLAYLIST:Export Me\r\n'));
  assert.ok(text.includes('B - Twö') && text.includes(path.join('Vids', 'B - Twö.mp4')) && !text.includes(dir), 'relative paths, UTF-8 names');
  const parsed = M.parseFile(out);
  assert.deepStrictEqual(parsed.entries.map(e => e.path), lib.playlist(p.id).songIds.map(id => lib.get(id).path));
  assert.deepStrictEqual(parsed.entries.map(e => e.artist), ['C', 'B', 'A']);
});
