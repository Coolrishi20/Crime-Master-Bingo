'use strict';
/**
 * Minimal MP4/M4V/MOV metadata reader: finds moov/udta/meta/ilst and reads
 * title (©nam) and artist (©ART / aART). Reads only the boxes it needs.
 */
const fs = require('fs');

function readBoxes(fd, start, end, cb) {
  let pos = start;
  const hdr = Buffer.alloc(16);
  while (pos + 8 <= end) {
    fs.readSync(fd, hdr, 0, 16, pos);
    let size = hdr.readUInt32BE(0);
    const type = hdr.toString('latin1', 4, 8);
    let headerLen = 8;
    if (size === 1) { size = Number(hdr.readBigUInt64BE(8)); headerLen = 16; }
    else if (size === 0) size = end - pos;
    if (size < headerLen || pos + size > end + 8) break;
    if (cb(type, pos + headerLen, pos + size) === false) return;
    pos += size;
  }
}

function readMp4Tags(file) {
  const out = {};
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    readBoxes(fd, 0, size, (type, s, e) => {
      if (type !== 'moov') return true;
      readBoxes(fd, s, e, (t2, s2, e2) => {
        if (t2 !== 'udta') return true;
        readBoxes(fd, s2, e2, (t3, s3, e3) => {
          if (t3 !== 'meta') return true;
          // 'meta' is a full box: 4 bytes version/flags (QuickTime variant has none)
          const peek = Buffer.alloc(8); fs.readSync(fd, peek, 0, 8, s3);
          const off = peek.toString('latin1', 4, 8) === 'hdlr' ? 0 : 4;
          readBoxes(fd, s3 + off, e3, (t4, s4, e4) => {
            if (t4 !== 'ilst') return true;
            readBoxes(fd, s4, e4, (tag, s5, e5) => {
              readBoxes(fd, s5, e5, (dt, s6, e6) => {
                if (dt !== 'data' || e6 - s6 > 4096) return true;
                const buf = Buffer.alloc(e6 - s6); fs.readSync(fd, buf, 0, buf.length, s6);
                const val = buf.toString('utf8', 8).replace(/\0+$/, '').trim();
                if (tag === '©nam') out.title = val;
                else if (tag === '©ART') out.artist = val;
                else if (tag === 'aART' && !out.artist) out.artist = val;
                else if (tag === '©day') { const y = /(19|20)\d\d/.exec(val); if (y) out.year = Number(y[0]); }
                else if (tag === '©gen' && val) out.genre = val.slice(0, 30);
                return true;
              });
              return true;
            });
            return false;
          });
          return false;
        });
        return false;
      });
      return false;
    });
  } catch (e) { /* not an MP4 or unreadable — ignore */ }
  finally { if (fd != null) try { fs.closeSync(fd); } catch (e) { /* */ } }
  return out;
}

/** "Artist - Title (Official Video).mp4" -> { artist, title } */
function parseFilename(file) {
  let base = require('path').basename(file).replace(/\.[^.]+$/, '');
  base = base.replace(/_/g, ' ')
    .replace(/\s*[([](official\s*(music\s*)?video|official|music video|hd|hq|4k|lyrics?|video|remastered[^)\]]*|audio)[)\]]/gi, '')
    .replace(/^\d{1,3}\s*[-.)]\s*/, '')
    .replace(/\s+/g, ' ').trim();
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { title: base, artist: '' };
}

/**
 * 2.6: title / artist / year / genre from an MP3's ID3 tags (v2.2–2.4, falling back to ID3v1).
 * Reads at most the first 1 MB and the last 128 bytes. Never throws.
 */
function readId3Tags(file) {
  const out = {};
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(10); fs.readSync(fd, head, 0, 10, 0);
    if (head.toString('latin1', 0, 3) === 'ID3') {
      const ver = head[3]; const flags = head[5];
      const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
      const len = Math.min(size, 1024 * 1024); const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, 10);
      let i = 0;
      if (flags & 0x40 && ver >= 3) { const ext = ver === 4 ? (((buf[0] & 0x7f) << 21) | ((buf[1] & 0x7f) << 14) | ((buf[2] & 0x7f) << 7) | (buf[3] & 0x7f)) : buf.readUInt32BE(0) + 4; i = ext; }
      const want = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TYER: 'year', TDRC: 'year', TYE: 'year', TCON: 'genre', TCO: 'genre' };
      while (i < len - 6) {
        let id, fsz, hdr;
        if (ver === 2) { id = buf.toString('latin1', i, i + 3); fsz = (buf[i + 3] << 16) | (buf[i + 4] << 8) | buf[i + 5]; hdr = 6; }
        else { if (i + 10 > len) break; id = buf.toString('latin1', i, i + 4); fsz = ver === 4 ? (((buf[i + 4] & 0x7f) << 21) | ((buf[i + 5] & 0x7f) << 14) | ((buf[i + 6] & 0x7f) << 7) | (buf[i + 7] & 0x7f)) : buf.readUInt32BE(i + 4); hdr = 10; }
        if (!/^[A-Z0-9]{3,4}$/.test(id) || fsz <= 0 || i + hdr + fsz > len) break;
        const key = want[id];
        if (key && !out[key]) { const t = id3Text(buf.slice(i + hdr, i + hdr + fsz)); if (t) out[key] = t; }
        i += hdr + fsz;
      }
    }
    if (!out.title || !out.artist) {
      const st = fs.fstatSync(fd);
      if (st.size > 128) {
        const t = Buffer.alloc(128); fs.readSync(fd, t, 0, 128, st.size - 128);
        if (t.toString('latin1', 0, 3) === 'TAG') {
          const f = (a, b) => t.toString('latin1', a, b).replace(/\0.*$/, '').trim();
          if (!out.title) out.title = f(3, 33) || undefined; if (!out.artist) out.artist = f(33, 63) || undefined; if (!out.year) out.year = f(93, 97) || undefined;
        }
      }
    }
  } catch (e) { /* tags are optional */ } finally { if (fd != null) try { fs.closeSync(fd); } catch (e) { /* */ } }
  if (out.year) { const m = /(19|20)\d\d/.exec(out.year); out.year = m ? Number(m[0]) : undefined; }
  if (out.genre) out.genre = out.genre.replace(/^\(\d+\)/, '').trim() || undefined;
  Object.keys(out).forEach(k => { if (out[k] == null || out[k] === '') delete out[k]; });
  return out;
}
function id3Text(b) {
  if (!b.length) return '';
  const enc = b[0]; const d = b.slice(1); let s;
  if (enc === 1 || enc === 2) {
    let le = enc === 1, start = 0;
    if (d[0] === 0xff && d[1] === 0xfe) { le = true; start = 2; } else if (d[0] === 0xfe && d[1] === 0xff) { le = false; start = 2; }
    const u = Buffer.from(d.slice(start)); if (!le) u.swap16 && u.length % 2 === 0 && u.swap16();
    s = u.toString('utf16le');
  } else s = d.toString(enc === 3 ? 'utf8' : 'latin1');
  return s.split('\0').filter(Boolean)[0] ? s.split('\0').filter(Boolean)[0].trim() : '';
}

module.exports = { readMp4Tags, readId3Tags, parseFilename };
