'use strict';
/**
 * M3U / M3U8 playlists (VLC, Windows Media Player, Winamp, foobar2000, MusicBee, iTunes exports…).
 *
 * Reading copes with the variations found in the wild:
 *  - UTF-8 (with or without BOM), UTF-16 (BOM) and old Windows-1252 (.m3u from older players);
 *  - plain lists of paths, or extended M3U with #EXTM3U / #EXTINF:<secs>[ attrs],<Artist - Title> / #PLAYLIST:<name>;
 *  - relative paths (resolved against the playlist's own folder), absolute Windows/UNC/Unix paths
 *    and file:// URLs (percent-encoded);
 *  - a playlist copied together with its videos to another drive or folder: when the stored path
 *    no longer exists, the same file is looked for next to the playlist (keeping up to 4 trailing
 *    folders of the original path), so a USB stick that changed from D: to E: still works.
 *  - online streams (http://, rtsp://…) are reported and skipped: the app plays local files only.
 *
 * Writing produces UTF-8 extended M3U with CRLF line endings, paths relative to the playlist when
 * the videos are on the same drive (portable), absolute otherwise.
 */
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const MAX_BYTES = 8 * 1024 * 1024; // a playlist, not a database

function decode(buf) {
  const td = (enc, b) => { try { return new TextDecoder(enc).decode(b); } catch (e) { return null; } };
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.slice(3).toString('utf8');
  if (buf[0] === 0xFF && buf[1] === 0xFE) return td('utf-16le', buf.slice(2)) || buf.slice(2).toString('utf16le');
  if (buf[0] === 0xFE && buf[1] === 0xFF) { const sw = Buffer.from(buf.slice(2)); sw.swap16(); return sw.toString('utf16le'); }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { /* not UTF-8 */ }
  return td('windows-1252', buf) || buf.toString('latin1');
}

/** "Artist - Title" (also en/em dash) → { artist, title }; no separator → title only. */
function splitLabel(label) {
  const s = String(label || '').trim();
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(s);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: s };
}

/** Parse #EXTINF:<duration>[ key="value"…],<label> */
function parseExtinf(line) {
  const body = line.slice(line.indexOf(':') + 1);
  let i = 0, inQ = false;
  for (; i < body.length; i++) { const ch = body[i]; if (ch === '"') inQ = !inQ; else if (ch === ',' && !inQ) break; }
  const head = body.slice(0, i).trim(); const label = i < body.length ? body.slice(i + 1).trim() : '';
  const d = parseFloat(head); const attrs = {};
  head.replace(/([\w-]+)="([^"]*)"/g, (m, k, v) => { attrs[k.toLowerCase()] = v; return m; });
  const lab = splitLabel(attrs['tvg-name'] && !label ? attrs['tvg-name'] : label);
  return { duration: Number.isFinite(d) && d > 0 ? d : null, label, artist: lab.artist, title: lab.title };
}

/** Where does an entry point to? → { path } | { path, relocated } | { url } | { missing, path } */
function resolveEntry(raw, baseDir, exists = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) {
  let s = String(raw).trim();
  if (/^file:/i.test(s)) {
    try { s = fileURLToPath(s); } catch (e) { s = decodeURIComponent(s.replace(/^file:\/*/i, process.platform === 'win32' ? '' : '/')); }
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return { url: s };
  const winAbs = /^[a-zA-Z]:[\\/]/.test(s) || /^\\\\/.test(s);
  let cand = null;
  if (process.platform === 'win32') cand = path.resolve(baseDir, s);
  else if (!winAbs) cand = path.resolve(baseDir, s.replace(/\\/g, '/'));
  if (cand && exists(cand)) return { path: cand };
  // relocated together with the playlist: keep the longest matching tail of the original path
  const segs = s.split(/[\\/]+/).filter(x => x && !/^[a-zA-Z]:$/.test(x));
  for (let k = Math.min(4, segs.length); k >= 1; k--) {
    for (const root of [baseDir, path.dirname(baseDir)]) {
      const c = path.join(root, ...segs.slice(-k));
      if (c !== cand && exists(c)) return { path: c, relocated: true };
    }
  }
  return { missing: true, path: cand || s };
}

/** Parse playlist text. Returns { name, extended, entries: [{ line, raw, path|url, missing?, relocated?, title, artist, duration }] } */
function parseText(text, file, opts = {}) {
  const baseDir = path.dirname(path.resolve(file));
  const lines = String(text).replace(/^﻿/, '').split(/\r\n|\n|\r/);
  let name = null, pending = null, extended = false; const entries = [];
  lines.forEach((ln, idx) => {
    const t = ln.trim(); if (!t) return;
    if (/^#EXTM3U/i.test(t)) { extended = true; return; }
    if (/^#PLAYLIST:/i.test(t)) { name = t.slice(10).trim() || name; return; }
    if (/^#EXTINF:/i.test(t)) { pending = parseExtinf(t); return; }
    if (t.startsWith('#')) return; // #EXTGRP, #EXTVLCOPT, comments…
    const r = resolveEntry(t, baseDir, opts.exists);
    const fromName = r.path ? path.basename(r.path) : t;
    entries.push(Object.assign({ line: idx + 1, raw: t, title: pending ? pending.title : '', artist: pending ? pending.artist : '', duration: pending ? pending.duration : null, label: pending ? pending.label : fromName }, r));
    pending = null;
  });
  if (!name) name = path.basename(file).replace(/\.m3u8?$/i, '').replace(/[_]+/g, ' ').trim() || 'Imported playlist';
  return { name: name.slice(0, 80), extended, entries };
}

function parseFile(file, opts = {}) {
  const st = fs.statSync(file);
  if (st.size > MAX_BYTES) throw new Error('That playlist file is too large to be an M3U playlist.');
  return parseText(decode(fs.readFileSync(file)), file, opts);
}

const isM3U = (p) => /\.m3u8?$/i.test(String(p || ''));

/** Build extended-M3U text for songs [{ path, title, artist, duration }]. */
function buildText(name, songs, file, opts = {}) {
  const dir = path.dirname(path.resolve(file));
  const rootOf = (p) => path.parse(path.resolve(p)).root.toLowerCase();
  const out = ['#EXTM3U', '#PLAYLIST:' + String(name || 'Playlist').replace(/[\r\n]+/g, ' ')];
  songs.forEach(s => {
    const label = [s.artist, s.title].filter(Boolean).join(' - ').replace(/[\r\n]+/g, ' ');
    out.push(`#EXTINF:${s.duration ? Math.round(s.duration) : -1},${label}`);
    const rel = opts.relative !== false && rootOf(s.path) === rootOf(file);
    out.push(rel ? path.relative(dir, s.path) : path.resolve(s.path));
  });
  return out.join('\r\n') + '\r\n';
}

module.exports = { decode, parseText, parseFile, parseExtinf, splitLabel, resolveEntry, buildText, isM3U };
