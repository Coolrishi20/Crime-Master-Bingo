'use strict';
/**
 * One relinking matcher for the Music Library and for games (2.1).
 * Finds moved or renamed videos in a folder and says how sure it is:
 *   fingerprint  – identical file content (auto)
 *   name-size    – same file name and exact size, used only when no fingerprint is known (auto)
 *   filename     – same file name, different content (needs the host's confirmation)
 *   title-artist – same title and artist from tags or the file name (needs confirmation)
 * Only the file location changes — song IDs, playlists, clip points and cards never do.
 */
const fs = require('fs');
const path = require('path');
const { readMp4Tags, parseFilename } = require('./mp4meta');

const VIDEO_EXT = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.ogv'];
function walk(dir, out = [], depth = 0) {
  if (depth > 64) return out;
  let items = []; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  items.forEach(d => { if (d.name.startsWith('.')) return; const p = path.join(dir, d.name); if (d.isDirectory()) walk(p, out, depth + 1); else if (VIDEO_EXT.includes(path.extname(d.name).toLowerCase())) out.push(p); });
  return out;
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const LABELS = {
  fingerprint: 'Identical video file (fingerprint match)',
  'name-size': 'Same file name and exact size',
  filename: 'Same file name but the content differs — confirm it is the same recording',
  'title-artist': 'Same title and artist — may be a different recording; confirm before using'
};

/**
 * items: [{ id, fileName, size, fingerprint, title, artist }] — the missing songs.
 * Returns the same items with `candidate: { path, match, auto, detail } | null`.
 * A file is never offered for two songs.
 */
function findMatches(items, folder, opts = {}) {
  const fingerprint = opts.fingerprint || require('./library').fingerprint;
  const files = opts.files || walk(folder);
  const info = files.map(f => { let size = 0; try { size = fs.statSync(f).size; } catch (e) { /* */ } return { path: f, name: path.basename(f).toLowerCase(), size }; });
  const fpCache = new Map();
  const fpOf = (f) => { if (!fpCache.has(f)) { try { fpCache.set(f, fingerprint(f).fp); } catch (e) { fpCache.set(f, null); } } return fpCache.get(f); };
  const tagCache = new Map();
  const keyOf = (x) => { if (!tagCache.has(x.path)) { let t = {}; try { t = /\.(mp4|m4v|mov)$/i.test(x.path) ? readMp4Tags(x.path) : {}; } catch (e) { t = {}; } const g = parseFilename(x.path); tagCache.set(x.path, norm(t.title || g.title) + '|' + norm(t.artist || g.artist)); } return tagCache.get(x.path); };
  const used = new Set();
  const cand = (hit, match, auto) => ({ path: hit.path, match, auto, detail: LABELS[match] });
  // pass 1: exact matches first, so a weaker match can never take a file another song owns
  const out = items.map(s => {
    let c = null;
    if (s.fingerprint) {
      const hit = info.find(x => !used.has(x.path) && (!s.size || x.size === s.size) && fpOf(x.path) === s.fingerprint);
      if (hit) c = cand(hit, 'fingerprint', true);
    } else if (s.size) {
      const hit = info.find(x => !used.has(x.path) && x.name === String(s.fileName || '').toLowerCase() && x.size === s.size);
      if (hit) c = cand(hit, 'name-size', true);
    }
    if (c) used.add(c.path);
    return Object.assign({}, s, { candidate: c });
  });
  // pass 2: weaker suggestions, always for the host to confirm
  out.forEach(s => {
    if (s.candidate) return;
    let hit = info.find(x => !used.has(x.path) && x.name === String(s.fileName || '').toLowerCase());
    let c = hit ? cand(hit, 'filename', false) : null;
    if (!c && (s.title || s.artist)) {
      const key = norm(s.title) + '|' + norm(s.artist);
      hit = info.find(x => !used.has(x.path) && keyOf(x) === key);
      if (hit) c = cand(hit, 'title-artist', false);
    }
    if (c) used.add(c.path);
    s.candidate = c;
  });
  return { folder, scanned: files.length, results: out, autoMatched: out.filter(r => r.candidate && r.candidate.auto).length, needsConfirm: out.filter(r => r.candidate && !r.candidate.auto).length, unmatched: out.filter(r => !r.candidate).length };
}

module.exports = { findMatches, walk, VIDEO_EXT, LABELS };
