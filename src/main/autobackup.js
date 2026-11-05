'use strict';
/**
 * Automatic and one-click backups (2.4). Compact game backups (no videos) are written at safe
 * moments — after creating the game, after printing, at the start, after confirming winners and
 * when the game ends — to a folder in Documents, keeping the newest N per game. A backup is
 * never written while a song is playing: it waits for the next pause or gap.
 */
const fs = require('fs');
const path = require('path');

const REASONS = { created: 'after creating the game', printed: 'after printing', started: 'at the start', winner: 'after confirming a winner', ended: 'when the game ended', manual: 'backed up by you', update: 'before an app update' };

class AutoBackup {
  /** o: { dir(), keep(), enabled(), getGame(id), isBusy(), createBackup(game, opts), onDone(info), setInterval } */
  constructor(o) { this.o = o; this.queue = []; this.running = false; this.timer = (o.setInterval || setInterval)(() => this.pump(), 4000); }
  folderFor(game) { return path.join(this.o.dir(), String(game.name || 'Game').replace(/[^\w \-]/g, '').trim().slice(0, 40) + ' - ' + String(game.id).slice(-8)); }
  /** Queue an automatic backup (merged with any already waiting for the same game). */
  request(gameId, reason) {
    if (!this.o.enabled()) return false;
    const q = this.queue.find(x => x.gameId === gameId);
    if (q) { if (!q.reasons.includes(reason)) q.reasons.push(reason); } else this.queue.push({ gameId, reasons: [reason] });
    setImmediate(() => this.pump());
    return true;
  }
  /** One-click backup now (still never mid-song). */
  async now(gameId, reason = 'manual') {
    if (this.o.isBusy()) throw new Error('A song is playing — pause first, or the backup will be made at the next pause.');
    return this.write(gameId, [reason]);
  }
  async pump() {
    if (this.running || !this.queue.length || this.o.isBusy()) return;
    this.running = true;
    const job = this.queue.shift();
    try { await this.write(job.gameId, job.reasons, true); } catch (e) { if (this.o.onError) this.o.onError(e); } finally { this.running = false; }
    if (this.queue.length) setImmediate(() => this.pump());
  }
  async write(gameId, reasons, auto = false) {
    const game = this.o.getGame(gameId); if (!game) return null;
    const dir = this.folderFor(game); fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    let file = path.join(dir, `${stamp} ${reasons[0]}.cmbbackup`);
    for (let k = 2; fs.existsSync(file); k++) file = path.join(dir, `${stamp} ${reasons[0]} (${k}).cmbbackup`); // never overwrite
    const res = await this.o.createBackup(JSON.parse(JSON.stringify(game)), { file, includeMedia: false });
    this.prune(dir);
    const info = { gameId, file, at: new Date().toISOString(), kind: 'compact', auto, reasons, why: reasons.map(r => REASONS[r] || r).join(', '), bytes: res && res.bytes };
    if (this.o.onDone) this.o.onDone(info);
    return info;
  }
  prune(dir) {
    const keep = Math.max(1, Number(this.o.keep()) || 10);
    let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.cmbbackup')).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })); } catch (e) { return; }
    files.sort((a, b) => b.t - a.t).slice(keep).forEach(x => { try { fs.unlinkSync(path.join(dir, x.f)); } catch (e) { /* in use */ } });
  }
  list(game) {
    const dir = this.folderFor(game);
    try { return fs.readdirSync(dir).filter(f => f.endsWith('.cmbbackup')).map(f => { const st = fs.statSync(path.join(dir, f)); return { file: path.join(dir, f), name: f, at: st.mtime.toISOString(), bytes: st.size }; }).sort((a, b) => b.at.localeCompare(a.at)); } catch (e) { return []; }
  }
  stop() { clearInterval(this.timer); }
}

module.exports = { AutoBackup, REASONS };
