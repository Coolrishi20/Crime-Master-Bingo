'use strict';
/**
 * Crash-safe local storage.
 * Every write goes to a temp file, is fsync'd, then atomically renamed over the
 * old file; the previous good copy is kept as `.bak`. A torn or corrupt file is
 * therefore never the only copy, and a power cut mid-write can't lose a game.
 */
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'games'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'thumbs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'exports'), { recursive: true });
    this.pending = new Map();
  }

  file(name) { return path.join(this.dir, name.endsWith('.json') ? name : name + '.json'); }

  read(name, fallback) {
    // A write still waiting to be saved is the newest copy (2.6: a game created a moment ago
    // used to be missing from lists until its delayed write reached the disk).
    const key = name.replace(/\.json$/, '');
    if (this.pending.has(key)) return JSON.parse(JSON.stringify(this.pending.get(key).data));
    const f = this.file(name);
    for (const candidate of [f, f + '.bak']) {
      try {
        if (fs.existsSync(candidate)) {
          const txt = fs.readFileSync(candidate, 'utf8');
          if (txt.trim()) return JSON.parse(txt);
        }
      } catch (e) { /* try the backup */ }
    }
    return typeof fallback === 'function' ? fallback() : fallback;
  }

  writeNow(name, data) {
    const f = this.file(name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp';
    const json = JSON.stringify(data);
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, json); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (fs.existsSync(f)) { try { fs.copyFileSync(f, f + '.bak'); } catch (e) { /* ignore */ } }
    fs.renameSync(tmp, f);
  }

  /** Debounced write — coalesces bursts of changes. `urgent` writes within 150 ms. */
  write(name, data, urgent = true) {
    const delay = urgent ? 150 : 2000;
    const p = this.pending.get(name);
    if (p) {
      p.data = data;
      if (urgent && p.delay > delay) { clearTimeout(p.timer); p.delay = delay; p.timer = setTimeout(() => this.flushOne(name), delay); }
      return;
    }
    const entry = { data, delay, timer: setTimeout(() => this.flushOne(name), delay) };
    this.pending.set(name, entry);
  }

  flushOne(name) {
    const p = this.pending.get(name);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(name);
    try { this.writeNow(name, p.data); } catch (e) { console.error('Save failed', name, e); }
  }

  flush() { Array.from(this.pending.keys()).forEach(n => this.flushOne(n)); }

  listGames() {
    const dir = path.join(this.dir, 'games');
    const ids = new Set(fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')));
    for (const k of this.pending.keys()) if (k.startsWith('games/')) ids.add(k.slice(6));
    return Array.from(ids).map(id => this.read('games/' + id, null)).filter(Boolean);
  }

  deleteGame(id) {
    const p = this.pending.get('games/' + id);
    if (p) { clearTimeout(p.timer); this.pending.delete('games/' + id); }
    ['', '.bak', '.tmp'].forEach(sfx => { const f = this.file('games/' + id) + sfx; if (fs.existsSync(f)) fs.unlinkSync(f); });
  }
}

module.exports = { Store };
