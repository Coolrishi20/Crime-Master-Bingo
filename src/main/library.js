'use strict';
/**
 * Music video library + playlists. Pure Node (no Electron) so it can be tested.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readMp4Tags, readId3Tags, parseFilename } = require('./mp4meta');
const { MIN_SONGS } = require('../core/cards');
const m3u = require('./m3u');
const AUDIO_EXT = ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.oga', '.wma', '.opus', '.aif', '.aiff'];
/** 2.6: audio files Windows laptops play directly (the TV shows a music card instead of a video) */
const PLAYABLE_AUDIO_EXT = ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.oga', '.opus'];
const isAudioPath = (p) => PLAYABLE_AUDIO_EXT.includes(path.extname(String(p || '')).toLowerCase());

const PLAYABLE_EXT = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.ogv'];
const KNOWN_VIDEO_EXT = PLAYABLE_EXT.concat(['.avi', '.wmv', '.flv', '.mpg', '.mpeg', '.3gp', '.ts', '.vob', '.divx', '.m2ts']);

/** Tags: trimmed, de-duplicated (case-insensitive), at most 12 of 30 characters. */
function cleanTags(t) {
  const arr = Array.isArray(t) ? t : String(t || '').split(',');
  const seen = new Set(); const out = [];
  arr.forEach(x => { const v = String(x || '').trim().replace(/\s+/g, ' ').slice(0, 30); const k = v.toLowerCase(); if (v && !seen.has(k)) { seen.add(k); out.push(v); } });
  return out.slice(0, 12);
}
const decadeOf = (y) => (y ? Math.floor(y / 10) * 10 + 's' : null);
function uid(p) { return p + crypto.randomBytes(5).toString('hex'); }
function norm(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').replace(/^the /, '').trim(); }
function songKey(s) { return norm(s.title) + '|' + norm(s.artist); }

/** Same fingerprint, read without blocking the main process (imports from slow USB/network drives). */
async function fingerprintAsync(file) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const st = await fh.stat();
    const h = crypto.createHash('sha1');
    const n = Math.min(65536, st.size);
    const a = Buffer.alloc(n); await fh.read(a, 0, n, 0); h.update(a);
    if (st.size > n) { const b = Buffer.alloc(n); await fh.read(b, 0, n, Math.max(0, st.size - n)); h.update(b); }
    h.update(String(st.size));
    return { size: st.size, fp: h.digest('hex') };
  } finally { await fh.close(); }
}
const yieldLoop = () => new Promise(r => setImmediate(r));

function fingerprint(file) {
  const st = fs.statSync(file);
  const fd = fs.openSync(file, 'r');
  try {
    const h = crypto.createHash('sha1');
    const n = Math.min(65536, st.size);
    const a = Buffer.alloc(n); fs.readSync(fd, a, 0, n, 0); h.update(a);
    if (st.size > n) { const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, Math.max(0, st.size - n)); h.update(b); }
    h.update(String(st.size));
    return { size: st.size, fp: h.digest('hex') };
  } finally { fs.closeSync(fd); }
}

function walk(p, out, depth = 0) {
  let st; try { st = fs.statSync(p); } catch (e) { return; }
  if (st.isDirectory()) {
    if (depth > 64) return; // only guards against symlink loops — no practical limit
    let items = []; try { items = fs.readdirSync(p); } catch (e) { return; }
    items.sort().forEach(n => { if (!n.startsWith('.')) walk(path.join(p, n), out, depth + 1); });
  } else if (st.isFile()) out.push(p);
}

class Library {
  constructor(store) {
    this.store = store;
    this.data = store.read('library', () => ({ songs: [] }));
    this.pl = store.read('playlists', () => ({ playlists: [] }));
  }

  save() { this.store.write('library', this.data); }
  savePl() { this.store.write('playlists', this.pl); }

  songs() { return this.data.songs; }
  nextUnchecked() { return this.data.songs.find(s => s.status === 'unchecked') || null; }
  get(id) { return this.data.songs.find(s => s.id === id); }

  /** Import files and/or folders. Returns a report. */
  async importPaths(paths) {
    const files = [];
    (paths || []).forEach(p => walk(p, files));
    const report = { added: [], alreadyInLibrary: [], duplicates: [], unsupported: [], ignored: 0 };
    const byPath = new Map(this.data.songs.map(s => [path.resolve(s.path).toLowerCase(), s]));
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      const isAudio = PLAYABLE_AUDIO_EXT.includes(ext);
      if (!KNOWN_VIDEO_EXT.includes(ext) && !isAudio) { if (AUDIO_EXT.includes(ext)) (report.audioUnsupported = report.audioUnsupported || []).push(f); else report.ignored++; continue; }
      if (byPath.has(path.resolve(f).toLowerCase())) { report.alreadyInLibrary.push(f); continue; }
      const needsConversion = !isAudio && !PLAYABLE_EXT.includes(ext); // AVI, WMV, FLV, MPG… → converted to an MP4 copy
      await yieldLoop(); // keep the app (TV, phone, host) responsive during big imports
      let fp; try { fp = await fingerprintAsync(f); } catch (e) { report.unsupported.push({ path: f, reason: 'File could not be read: ' + e.message }); continue; }
      const tags = ['.mp4', '.m4v', '.mov', '.m4a'].includes(ext) ? readMp4Tags(f) : ext === '.mp3' ? readId3Tags(f) : {};
      const guess = parseFilename(f);
      const song = {
        id: uid('s_'), path: f, fileName: path.basename(f), ext, kind: isAudio ? 'audio' : 'video',
        title: tags.title || guess.title || '', artist: tags.artist || guess.artist || '',
        year: tags.year || null, tags: tags.genre ? [tags.genre] : [],
        displayTitle: '', printTitle: '',
        duration: 0, width: 0, height: 0, thumb: null,
        clipStart: null, clipEnd: null,
        size: fp.size, fingerprint: fp.fp,
        status: needsConversion ? 'needs-conversion' : 'unchecked', statusNote: needsConversion ? `${ext.toUpperCase().slice(1)} — converting to a playable MP4 copy` : '', addedAt: new Date().toISOString()
      };
      if (needsConversion) report.converting = (report.converting || 0) + 1;
      const dupMedia = this.data.songs.find(s => s.fingerprint === fp.fp && s.size === fp.size);
      if (dupMedia) { song.duplicateOf = dupMedia.id; report.duplicates.push({ path: f, of: dupMedia.title || dupMedia.fileName, kind: 'same video file' }); }
      else if (song.title && song.artist) {
        const k = songKey(song); const dupSong = this.data.songs.find(s => songKey(s) === k);
        if (dupSong) { song.duplicateOf = dupSong.id; report.duplicates.push({ path: f, of: `${dupSong.title} — ${dupSong.artist}`, kind: 'same title and artist' }); }
      }
      this.data.songs.push(song);
      byPath.set(path.resolve(f).toLowerCase(), song);
      report.added.push(song.id);
    }
    this.save();
    return report;
  }

  /** Result of the renderer probing the media (duration, dimensions, thumbnail, or error). */
  probeResult(id, r, thumbDir) {
    const s = this.get(id); if (!s) return null;
    if (r.error) { s.status = 'unsupported'; s.statusNote = r.error; }
    else {
      s.duration = Math.round((Number(r.duration) || 0) * 10) / 10;
      s.width = r.width || 0; s.height = r.height || 0;
      if (!s.width || !s.height) {
        // 2.6: no picture but it plays → an audio song (the TV shows a music card)
        if (s.duration > 0 && (s.kind === 'audio' || r.hasAudio !== false)) { s.status = 'ok'; s.kind = 'audio'; s.statusNote = 'Audio only: the TV shows a music card'; }
        else { s.status = 'unsupported'; s.statusNote = 'No playable video or audio (unsupported codec). Use MP4 H.264/AAC or MP3.'; }
      } else { s.status = 'ok'; s.kind = 'video'; s.statusNote = ''; }
      if (r.thumb && thumbDir) {
        try {
          const b64 = String(r.thumb).replace(/^data:image\/\w+;base64,/, '');
          const tf = path.join(thumbDir, s.id + '.jpg');
          fs.writeFileSync(tf, Buffer.from(b64, 'base64'));
          s.thumb = tf;
        } catch (e) { /* thumbnail optional */ }
      }
    }
    this.save();
    return s;
  }

  update(id, fields) {
    const s = this.get(id); if (!s) throw new Error('Song not found');
    ['title', 'artist', 'displayTitle', 'printTitle'].forEach(k => { if (k in fields) s[k] = String(fields[k] || '').trim(); });
    if ('year' in fields) { const y = Number(fields.year); s.year = Number.isInteger(y) && y >= 1900 && y <= 2100 ? y : null; }
    if ('tags' in fields) s.tags = cleanTags(fields.tags);
    if (fields.rights && typeof fields.rights === 'object') { const r = {}; ['isrc', 'label', 'licence'].forEach(k => { const v = String(fields.rights[k] || '').trim().slice(0, 120); if (v) r[k] = k === 'isrc' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '') : v; }); if (Object.keys(r).length) s.rights = r; else delete s.rights; }
    if ('flag' in fields) s.flag = fields.flag && fields.flag.reason ? { reason: String(fields.flag.reason).slice(0, 60), note: String(fields.flag.note || '').slice(0, 200), at: new Date().toISOString() } : null;
    ['clipStart', 'clipEnd'].forEach(k => {
      if (k in fields) {
        const v = fields[k];
        s[k] = (v === null || v === '' || v === undefined) ? null : Math.max(0, Number(v));
        if (Number.isNaN(s[k])) s[k] = null;
      }
    });
    if (s.clipStart != null && s.clipEnd != null && s.clipEnd <= s.clipStart) throw new Error('Clip end must be after clip start.');
    if ('duplicateOf' in fields && !fields.duplicateOf) delete s.duplicateOf; // host reviewed: not a duplicate
    this.save();
    return s;
  }

  remove(ids) {
    const set = new Set(ids);
    this.data.songs = this.data.songs.filter(s => !set.has(s.id));
    this.pl.playlists.forEach(p => { p.songIds = p.songIds.filter(id => !set.has(id)); });
    this.save(); this.savePl();
  }

  /** Check every file still exists; flag missing ones. */
  checkFiles() {
    let missing = 0;
    this.data.songs.forEach(s => {
      // converted copy deleted but the original is still there → convert again
      if (s.originalPath && !fs.existsSync(s.path) && fs.existsSync(s.originalPath)) { s.path = s.originalPath; delete s.converted; s.status = 'needs-conversion'; s.statusNote = 'Converted copy missing — converting again'; s.conversion = null; return; }
      if (s.source === 'youtube') return; // not a file
      const exists = fs.existsSync(s.path);
      if (!exists) { if (s.status !== 'missing') { s.prevStatus = s.status; } s.status = 'missing'; s.statusNote = 'File not found — relink it.'; missing++; }
      else if (s.status === 'missing') { s.status = s.prevStatus && s.prevStatus !== 'missing' ? s.prevStatus : 'unchecked'; s.statusNote = ''; }
    });
    this.save();
    return missing;
  }

  relink(id, newPath) {
    const s = this.get(id); if (!s) throw new Error('Song not found');
    if (!fs.existsSync(newPath)) throw new Error('File does not exist');
    s.path = newPath; s.fileName = path.basename(newPath);
    const fp = fingerprint(newPath); s.size = fp.size; s.fingerprint = fp.fp;
    s.status = 'unchecked'; s.statusNote = '';
    this.save();
    return s;
  }

  /** Look for missing videos in a folder without changing anything (for the relink wizard). */
  scanRelink(folder) {
    const missing = this.data.songs.filter(s => s.status === 'missing');
    const r = require('./relink').findMatches(missing.map(s => ({ id: s.id, key: s.id, fileName: s.fileName || path.basename(s.path || ''), size: s.size, fingerprint: s.fingerprint, title: s.title, artist: s.artist })), folder, { fingerprint });
    r.results.forEach(x => { delete x.size; delete x.fingerprint; });
    return r;
  }

  /** Where the missing videos used to be: their common folder, and whether its drive is there. */
  missingInfo() {
    const miss = this.data.songs.filter(s => s.status === 'missing' && s.path);
    if (!miss.length) return { count: 0 };
    const parts = miss.map(s => path.dirname(s.path).split(/[\\/]/));
    let common = parts[0];
    parts.forEach(p => { let i = 0; while (i < common.length && i < p.length && common[i].toLowerCase() === p[i].toLowerCase()) i++; common = common.slice(0, i); });
    const sep = miss[0].path.includes('\\') ? '\\' : '/';
    const folder = common.join(sep) || null;
    const root = /^[A-Za-z]:/.test(miss[0].path) ? miss[0].path.slice(0, 3) : (folder ? folder.split(sep).slice(0, 3).join(sep) || '/' : null);
    let rootThere = true; try { rootThere = !!root && fs.existsSync(root); } catch (e) { rootThere = false; }
    return { count: miss.length, folder, root, rootThere };
  }

  /**
   * Search a folder for missing videos. Only provably identical files (fingerprint, or name +
   * exact size when no fingerprint is known) are relinked straight away; a same-name or
   * same-title file is returned for the host to confirm — never applied silently (2.1).
   */
  relinkFolder(folder) {
    const missing = this.data.songs.filter(s => s.status === 'missing');
    const r = require('./relink').findMatches(missing.map(s => ({ id: s.id, fileName: s.fileName || path.basename(s.path || ''), size: s.size, fingerprint: s.fingerprint, title: s.title, artist: s.artist })), folder, { fingerprint });
    let fixed = 0;
    r.results.forEach(x => { if (x.candidate && x.candidate.auto) { const s = this.get(x.id); s.path = x.candidate.path; s.fileName = path.basename(x.candidate.path); s.status = 'unchecked'; s.statusNote = ''; fixed++; } });
    this.save();
    return { fixed, scanned: r.scanned, missing: missing.length, unmatched: r.unmatched,
      needsConfirm: r.results.filter(x => x.candidate && !x.candidate.auto).map(x => ({ id: x.id, title: x.title, artist: x.artist, fileName: x.fileName, path: x.candidate.path, match: x.candidate.match, detail: x.candidate.detail })) };
  }

  /**
   * Import a folder tree as playlists: every sub-folder that contains videos becomes a
   * playlist with the folder's name (videos loose in the top folder go into a playlist
   * named after the top folder). Re-running adds only new songs; duplicates are refused.
   */
  async importFolderAsPlaylists(root) {
    const st = fs.statSync(root);
    if (!st.isDirectory()) throw new Error('Choose a folder.');
    const groups = [];
    const loose = [];
    fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach(d => {
      if (d.name.startsWith('.')) return;
      const p = path.join(root, d.name);
      if (d.isDirectory()) groups.push({ name: d.name, dir: p });
      else if (KNOWN_VIDEO_EXT.includes(path.extname(d.name).toLowerCase()) || PLAYABLE_AUDIO_EXT.includes(path.extname(d.name).toLowerCase())) loose.push(p);
    });
    if (loose.length) groups.unshift({ name: path.basename(root), files: loose });
    const total = { added: 0, alreadyInLibrary: 0, duplicates: 0, unsupported: [], converting: 0 };
    const out = [];
    for (const g of groups) {
      const files = g.files || (() => { const f = []; walk(g.dir, f); return f; })();
      const vids = files.filter(f => KNOWN_VIDEO_EXT.includes(path.extname(f).toLowerCase()) || PLAYABLE_AUDIO_EXT.includes(path.extname(f).toLowerCase()));
      if (!vids.length) continue;
      const rep = await this.importPaths(g.files ? g.files : [g.dir]);
      total.added += rep.added.length; total.alreadyInLibrary += rep.alreadyInLibrary.length; total.duplicates += rep.duplicates.length; total.converting += rep.converting || 0; total.unsupported.push(...rep.unsupported);
      const byPath = new Map(this.data.songs.map(s => [path.resolve(s.originalPath || s.path).toLowerCase(), s]));
      this.data.songs.forEach(s => byPath.set(path.resolve(s.path).toLowerCase(), s));
      const ids = vids.map(f => byPath.get(path.resolve(f).toLowerCase())).filter(Boolean).map(s => s.id);
      let pl = this.pl.playlists.find(p => p.name.trim().toLowerCase() === g.name.trim().toLowerCase());
      const created = !pl;
      if (!pl) pl = this.createPlaylist(g.name);
      const r = this.addToPlaylist(pl.id, ids);
      out.push({ name: pl.name, playlistId: pl.id, created, videos: vids.length, added: r.added.length, already: ids.length - r.added.length - r.rejected.length, rejected: r.rejected, total: pl.songIds.length });
    }
    return { playlists: out, totals: total };
  }

  /**
   * Import an .m3u / .m3u8 playlist: its videos join the library (same checks, conversion and
   * duplicate rules as any import) and a playlist with the M3U's name keeps the M3U's order.
   * Re-importing the same M3U only adds what is new. Nothing in the M3U file is changed.
   */
  async importM3U(file) {
    const pl = m3u.parseFile(file);
    const rep = { name: pl.name, file, entries: pl.entries.length, missing: [], streams: [], audio: [], notVideo: [], relocated: 0, unsupported: [], duplicates: 0, newToLibrary: 0, converting: 0, addedToPlaylist: 0, alreadyInPlaylist: 0, rejected: [], playlistId: null, created: false };
    if (!pl.entries.length) throw new Error('This playlist file has no songs in it.');
    const vids = []; const seen = new Set();
    pl.entries.forEach(e => {
      const label = e.label || e.raw;
      if (e.url) return rep.streams.push({ line: e.line, label });
      if (e.missing) return rep.missing.push({ line: e.line, label, path: e.path });
      const ext = path.extname(e.path).toLowerCase();
      if (AUDIO_EXT.includes(ext) && !PLAYABLE_AUDIO_EXT.includes(ext)) return rep.audio.push({ line: e.line, label });
      if (!KNOWN_VIDEO_EXT.includes(ext) && !PLAYABLE_AUDIO_EXT.includes(ext)) return rep.notVideo.push({ line: e.line, label });
      if (e.relocated) rep.relocated++;
      const k = path.resolve(e.path).toLowerCase(); if (seen.has(k)) return; seen.add(k);
      vids.push(e);
    });
    const imp = vids.length ? await this.importPaths(vids.map(e => e.path)) : { added: [], duplicates: [], unsupported: [], converting: 0 };
    rep.newToLibrary = imp.added.length; rep.duplicates = imp.duplicates.length; rep.unsupported = imp.unsupported; rep.converting = imp.converting || 0;
    const byPath = new Map();
    this.data.songs.forEach(x => { byPath.set(path.resolve(x.path).toLowerCase(), x); if (x.originalPath) byPath.set(path.resolve(x.originalPath).toLowerCase(), x); });
    const fresh = new Set(imp.added); let changed = false;
    const ids = [];
    vids.forEach(e => {
      const s = byPath.get(path.resolve(e.path).toLowerCase()); if (!s) return;
      // #EXTINF "Artist - Title" fills in when the file name alone doesn't give both; it never replaces
      // embedded tags, a clean "Artist - Title" file name, or your own edits
      if (fresh.has(s.id) && e.title) { const g = parseFilename(s.path); if (!(g.artist && g.title) && (!s.title || s.title === g.title) && (!s.artist || s.artist === g.artist)) { s.title = e.title; if (e.artist) s.artist = e.artist; changed = true; } }
      if (!ids.includes(s.id)) ids.push(s.id);
    });
    if (changed) this.save();
    let p = this.pl.playlists.find(x => x.name.trim().toLowerCase() === pl.name.trim().toLowerCase());
    rep.created = !p; if (!p) p = this.createPlaylist(pl.name);
    const before = new Set(p.songIds);
    const r = this.addToPlaylist(p.id, ids);
    rep.playlistId = p.id; rep.playlistName = p.name; rep.addedToPlaylist = r.added.length;
    rep.alreadyInPlaylist = ids.filter(id => before.has(id)).length;
    rep.rejected = r.rejected.filter(x => !/already in this playlist/.test(x.reason));
    rep.total = p.songIds.length;
    return rep;
  }

  /** Write a playlist as UTF-8 extended M3U (opens in VLC, Windows Media Player, foobar2000…). */
  exportM3U(id, file, opts = {}) {
    const p = this.playlist(id); if (!p) throw new Error('Playlist not found');
    const songs = p.songIds.map(x => this.get(x)).filter(Boolean);
    fs.writeFileSync(file, m3u.buildText(p.name, songs.map(s => ({ path: s.path, title: s.title, artist: s.artist, duration: s.duration })), file, opts), 'utf8');
    return { file, count: songs.length, missing: songs.filter(s => s.status === 'missing').length };
  }

  /** Add / remove tags and set the year on many songs at once. */
  bulkTag(ids, { add = [], remove = [], year } = {}) {
    const rm = new Set(cleanTags(remove).map(x => x.toLowerCase())); const ad = cleanTags(add); let n = 0;
    ids.forEach(id => { const s = this.get(id); if (!s) return;
      s.tags = cleanTags((s.tags || []).filter(t => !rm.has(t.toLowerCase())).concat(ad));
      if (year !== undefined) { const y = Number(year); s.year = Number.isInteger(y) && y >= 1900 && y <= 2100 ? y : null; }
      n++; });
    this.save(); return { updated: n };
  }

  /** Tag and decade counts over songs that could go into a game. */
  tagSummary() {
    const tags = new Map(), decades = new Map(); let untagged = 0;
    this.data.songs.filter(s => this.isPlayable(s) && !s.duplicateOf).forEach(s => {
      (s.tags || []).forEach(t => { const k = t.toLowerCase(); const e = tags.get(k) || { tag: t, count: 0 }; e.count++; tags.set(k, e); });
      const d = decadeOf(s.year); if (d) decades.set(d, (decades.get(d) || 0) + 1);
      if (!(s.tags || []).length && !s.year) untagged++;
    });
    return { tags: Array.from(tags.values()).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)), decades: Array.from(decades.entries()).map(([decade, count]) => ({ decade, count })).sort((a, b) => a.decade.localeCompare(b.decade)), untagged };
  }

  /**
   * Smart playlist: playable, unique songs matching the chosen decades (any of them) AND the
   * chosen tags (any of them). Picks `count` at random, never two versions of the same song.
   */
  buildPlaylist({ name, decades = [], tags = [], count = 75, dryRun = false } = {}, pick = (arr, n) => arr.sort(() => Math.random() - 0.5).slice(0, n)) {
    const dset = new Set(decades); const tset = new Set(cleanTags(tags).map(t => t.toLowerCase()));
    const seen = new Set(); const pool = [];
    this.data.songs.forEach(s => {
      if (!this.isPlayable(s)) return;
      if (dset.size && !dset.has(decadeOf(s.year))) return;
      if (tset.size && !(s.tags || []).some(t => tset.has(t.toLowerCase()))) return;
      const k = songKey(s); if (seen.has(k) || seen.has(s.fingerprint)) return; seen.add(k); seen.add(s.fingerprint);
      pool.push(s.id);
    });
    if (dryRun) return { matching: pool.length };
    if (!pool.length) throw new Error('No playable songs match those choices.');
    const n = Math.max(1, Math.min(Number(count) || 75, pool.length));
    let base = String(name || '').trim() || [Array.from(dset).join(' + '), Array.from(cleanTags(tags)).join(' + ')].filter(Boolean).join(' · ') || 'Mixed playlist';
    let nm = base, k = 2; while (this.pl.playlists.some(p => p.name.toLowerCase() === nm.toLowerCase())) nm = `${base} (${k++})`;
    const p = this.createPlaylist(nm.slice(0, 80));
    this.addToPlaylist(p.id, pick(pool.slice(), n));
    return { playlistId: p.id, name: p.name, added: p.songIds.length, matching: pool.length, enoughForGame: p.songIds.length >= MIN_SONGS };
  }

  /** Add a YouTube video as a song (Beta). meta = { id, title, artist, thumb } from YouTube's oEmbed. */
  addYouTube(meta) {
    const existing = this.data.songs.find(s => s.source === 'youtube' && s.youtubeId === meta.id);
    if (existing) return { song: existing, already: true };
    const song = { id: uid('s_'), source: 'youtube', youtubeId: meta.id, path: 'https://www.youtube.com/watch?v=' + meta.id, fileName: 'YouTube · ' + meta.id, ext: '.youtube',
      title: meta.title || '', artist: meta.artist || '', year: null, tags: [], displayTitle: '', printTitle: '', duration: 0, width: 1280, height: 720, thumb: meta.thumb || null,
      clipStart: null, clipEnd: null, size: 0, fingerprint: 'yt:' + meta.id, status: 'ok', statusNote: 'YouTube — needs internet at the venue', addedAt: new Date().toISOString() };
    if (song.title && song.artist) { const k = songKey(song); const d = this.data.songs.find(s => songKey(s) === k); if (d) song.duplicateOf = d.id; }
    this.data.songs.push(song); this.save();
    return { song, already: false };
  }

  isPlayable(s) { return s && s.status === 'ok' && !!String(s.title || '').trim() && !!String(s.artist || '').trim(); }

  problemFor(s) {
    if (!s) return 'Song was removed from the library';
    if (s.status === 'missing') return 'File missing';
    if (s.status === 'unsupported') return s.statusNote || 'Unsupported media';
    if (s.status === 'needs-conversion' || s.status === 'converting') return 'Converting to MP4…';
    if (s.status === 'unchecked') return 'Not yet checked';
    if (!String(s.title || '').trim()) return 'Title is required';
    if (!String(s.artist || '').trim()) return 'Artist is required';
    return null;
  }

  /* ------------------------------------------------------------ playlists */
  playlists() { return this.pl.playlists; }
  playlist(id) { return this.pl.playlists.find(p => p.id === id); }

  createPlaylist(name) {
    name = String(name || '').trim(); if (!name) throw new Error('Playlist name is required');
    const p = { id: uid('p_'), name, songIds: [], createdAt: new Date().toISOString() };
    this.pl.playlists.push(p); this.savePl(); return p;
  }
  renamePlaylist(id, name) { const p = this.playlist(id); if (!p) throw new Error('Playlist not found'); name = String(name || '').trim(); if (!name) throw new Error('Name required'); p.name = name; this.savePl(); return p; }
  duplicatePlaylist(id) { const p = this.playlist(id); if (!p) throw new Error('Playlist not found'); const c = { id: uid('p_'), name: p.name + ' (copy)', songIds: p.songIds.slice(), createdAt: new Date().toISOString() }; this.pl.playlists.push(c); this.savePl(); return c; }
  deletePlaylist(id) { this.pl.playlists = this.pl.playlists.filter(p => p.id !== id); this.savePl(); }

  /** Add songs; duplicates (same id, same media, or same title+artist) are refused and reported. */
  addToPlaylist(id, songIds) {
    const p = this.playlist(id); if (!p) throw new Error('Playlist not found');
    const added = [], rejected = [];
    for (const sid of songIds) {
      const s = this.get(sid); if (!s) continue;
      if (p.songIds.includes(sid)) { rejected.push({ songId: sid, title: s.title, reason: 'already in this playlist' }); continue; }
      const k = songKey(s);
      const clash = p.songIds.map(x => this.get(x)).find(o => o && ((o.fingerprint && o.fingerprint === s.fingerprint) || (s.title && songKey(o) === k)));
      if (clash) { rejected.push({ songId: sid, title: s.title, reason: `duplicate of "${clash.title} — ${clash.artist}"` }); continue; }
      p.songIds.push(sid); added.push(sid);
    }
    this.savePl();
    return { added, rejected };
  }
  removeFromPlaylist(id, songIds) { const p = this.playlist(id); if (!p) throw new Error('Playlist not found'); const set = new Set(songIds); p.songIds = p.songIds.filter(x => !set.has(x)); this.savePl(); return p; }
  reorderPlaylist(id, songIds) {
    const p = this.playlist(id); if (!p) throw new Error('Playlist not found');
    const a = new Set(p.songIds), b = new Set(songIds);
    if (a.size !== b.size || [...a].some(x => !b.has(x))) throw new Error('Reorder must contain the same songs');
    p.songIds = songIds.slice(); this.savePl(); return p;
  }

  /** Validate a playlist for a game: unique, playable, ≥ 40 songs. */
  validatePlaylist(id) {
    const p = this.playlist(id); if (!p) throw new Error('Playlist not found');
    const problems = []; const playable = []; const seen = new Set(); const seenFp = new Set();
    p.songIds.forEach(sid => {
      const s = this.get(sid);
      const issue = this.problemFor(s);
      if (issue) { problems.push({ songId: sid, title: s ? s.title || s.fileName : '(removed)', issue }); return; }
      const k = songKey(s);
      if (seen.has(k) || seenFp.has(s.fingerprint)) { problems.push({ songId: sid, title: s.title, issue: 'Duplicate song' }); return; }
      seen.add(k); seenFp.add(s.fingerprint);
      playable.push(s);
    });
    const needed = Math.max(0, MIN_SONGS - playable.length);
    return { playlistId: id, name: p.name, total: p.songIds.length, uniquePlayable: playable.length, needed, ok: needed === 0, problems, songs: playable };
  }
}

module.exports = { Library, PLAYABLE_EXT, KNOWN_VIDEO_EXT, PLAYABLE_AUDIO_EXT, isAudioPath, songKey, fingerprint, cleanTags, decadeOf };
