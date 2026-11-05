'use strict';
/**
 * Music usage report (2.4): which songs were played in public, when, where and for how long,
 * with any rights details the host recorded (ISRC, label/publisher, licence reference).
 * Meant to help hosts with their own licensing returns. It is a record, not legal advice.
 */
function csvCell(v) { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; }

/** Rows for one game. lib(id) returns the library song (for rights fields), optional. */
function usageRows(game, lib) {
  const st = game.settings || {};
  const clipLen = Number(st.clipMode) > 0 ? Number(st.clipMode) : null;
  return (game.played || []).map((p, i) => {
    const s = (game.songs || {})[p.songId] || {}; const l = (lib && lib(p.songId)) || {}; const r = l.rights || s.rights || {};
    const full = Number(s.duration || l.duration) || null;
    const secs = p.kind === 'credit' ? 0 : (s.clipEnd != null && s.clipStart != null ? Math.max(0, s.clipEnd - s.clipStart) : (clipLen || full));
    const at = p.at ? new Date(p.at) : null;
    return {
      date: game.date || (at ? at.toISOString().slice(0, 10) : ''), event: game.name || '', venue: game.venue || '', n: i + 1,
      time: at ? at.toTimeString().slice(0, 5) : '', title: s.title || l.title || '', artist: s.artist || l.artist || '',
      seconds: secs != null ? Math.round(secs) : '', fullLength: full ? Math.round(full) : '', how: p.kind === 'credit' ? 'technical credit (not fully played)' : (p.manual ? 'marked played by host' : 'played'),
      isrc: r.isrc || '', label: r.label || '', licence: r.licence || '', source: s.source === 'youtube' ? 'YouTube (embedded player)' : 'local video file'
    };
  });
}

const COLS = [['date', 'Date'], ['event', 'Event'], ['venue', 'Venue'], ['n', 'No.'], ['time', 'Time'], ['title', 'Title'], ['artist', 'Artist'], ['seconds', 'Seconds played'], ['fullLength', 'Full length (s)'], ['how', 'How'], ['isrc', 'ISRC'], ['label', 'Label / publisher'], ['licence', 'Licence reference'], ['source', 'Source']];

function toCsv(rows) {
  const lines = [COLS.map(c => c[1]).join(',')].concat(rows.map(r => COLS.map(c => csvCell(r[c[0]])).join(',')));
  return '﻿' + lines.join('\r\n') + '\r\n'; // BOM so Excel opens UTF-8 (accents, Devanagari) correctly
}

/** Per-song totals across games (for a summary sheet). */
function summary(rows) {
  const m = new Map();
  rows.forEach(r => { if (r.how.startsWith('technical')) return; const k = r.title + '\u0000' + r.artist; const e = m.get(k) || { title: r.title, artist: r.artist, isrc: r.isrc, plays: 0, seconds: 0 }; e.plays++; e.seconds += Number(r.seconds) || 0; m.set(k, e); });
  return Array.from(m.values()).sort((a, b) => b.plays - a.plays || a.title.localeCompare(b.title));
}

module.exports = { usageRows, toCsv, summary, csvCell };
