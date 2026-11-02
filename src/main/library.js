'use strict';
/**
 * Music video library + playlists. Pure Node (no Electron) so it can be tested.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readMp4Tags, parseFilename } = require('./mp4meta');
const { MIN_SONGS } = require('../core/cards');

const PLAYABLE_EXT = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.ogv'];
const KNOWN_VIDEO_EXT = PLAYABLE_EXT.concat(['.avi', '.wmv', '.flv', '.mpg', '.mpeg', '.3gp', '.ts', '.vob', '.divx', '.m2ts']);

function uid(p) { return p + crypto.randomBytes(5).toString('hex'); }
function norm(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').replace(/^the /, '').trim(); }
function songKey(s) { return norm(s.title) + '|' + norm(s.artist); }

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
  importPaths(paths) {
    const files = [];
    (paths || []).forEach(p => walk(p, files));
    const report = { added: [], alreadyInLibrary: [], duplicates: [], unsupported: [], ignored: 0 };
    const byPath = new Map(this.data.songs.map(s => [path.resolve(s.path).toLowerCase(), s]));
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (!KNOWN_VIDEO_EXT.includes(ext)) { report.ignored++; continue; }
      if (!PLAYABLE_EXT.includes(ext)) { report.unsupported.push({ path: f, reason: `${ext.toUpperCase().slice(1)} files are not supported — convert to MP4 (H.264 video, AAC audio).` }); continue; }
      if (byPath.has(path.resolve(f).toLowerCase())) { report.alreadyInLibrary.push(f); continue; }
      let fp; try { fp = fingerprint(f); } catch (e) { report.unsupported.push({ path: f, reason: 'File could not be read: ' + e.message }); continue; }
      const tags = ['.mp4', '.m4v', '.mov'].includes(ext) ? readMp4Tags(f) : {};
      const guess = parseFilename(f);
      const song = {
        id: uid('s_'), path: f, fileName: path.basename(f), ext,
        title: tags.title || guess.title || '', artist: tags.artist || guess.artist || '',
        displayTitle: '', printTitle: '',
        duration: 0, width: 0, height: 0, thumb: null,
        clipStart: null, clipEnd: null,
        size: fp.size, fingerprint: fp.fp,
        status: 'unchecked', statusNote: '', addedAt: new Date().toISOString()
      };
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
      if (!s.width || !s.height) { s.status = 'unsupported'; s.statusNote = 'No playable video track (audio-only or unsupported video codec). Use MP4 H.264/AAC.'; }
      else { s.status = 'ok'; s.statusNote = ''; }
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

  /** Search a folder for missing files with the same file name. */
  relinkFolder(folder) {
    const files = []; walk(folder, files);
    const byName = new Map(files.map(f => [path.basename(f).toLowerCase(), f]));
    let fixed = 0;
    this.data.songs.filter(s => s.status === 'missing').forEach(s => {
      const f = byName.get(String(s.fileName || path.basename(s.path)).toLowerCase());
      if (f) { s.path = f; s.status = 'unchecked'; s.statusNote = ''; fixed++; }
    });
    this.save();
    return fixed;
  }

  isPlayable(s) { return s && s.status === 'ok' && !!String(s.title || '').trim() && !!String(s.artist || '').trim(); }

  problemFor(s) {
    if (!s) return 'Song was removed from the library';
    if (s.status === 'missing') return 'File missing';
    if (s.status === 'unsupported') return s.statusNote || 'Unsupported media';
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

module.exports = { Library, PLAYABLE_EXT, KNOWN_VIDEO_EXT, songKey, fingerprint };
