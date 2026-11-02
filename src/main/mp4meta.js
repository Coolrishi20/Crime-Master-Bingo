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

module.exports = { readMp4Tags, parseFilename };
