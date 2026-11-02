'use strict';
/**
 * Local Wi-Fi remote-control service (HTTP + WebSocket).
 * The phone is ONLY a controller: it sends commands, the laptop executes them
 * and broadcasts state. No media is ever served to the phone.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const MIME = { '.woff2': 'font/woff2', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const REMOTE_ACTIONS = new Set([
  'play', 'pause', 'togglePlay', 'stop', 'next', 'skip', 'previous', 'replay', 'seek', 'setVolume', 'markPlayed',
  'startRound', 'endRound', 'pauseGame', 'resumeGame', 'endGame', 'setCrawler',
  'openChecker', 'closeChecker', 'checkClaim', 'confirmClaim', 'dismissClaim', 'revokeWinner', 'setClipMode',
  'freezeClaims', 'addClaim', 'viewClaim', 'removeClaim', 'closeSession', 'grantCredit', 'reverseCredit', 'setAudio', 'showTvScreen', 'setTvScreens', 'completeRound', 'queueSong', 'unqueueSong', 'skipNext', 'resetQueue', 'jumpTo'
]);

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

function localAddresses() {
  const out = [];
  const ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(name => (ifs[name] || []).forEach(a => {
    if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
  }));
  // Prefer typical home/venue LAN ranges first
  const rank = a => (/^192\.168\./.test(a.address) ? 0 : /^10\./.test(a.address) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 2 : 3);
  return out.sort((x, y) => rank(x) - rank(y));
}

class RemoteServer {
  /**
   * opts: { port, staticDir, extraFiles:{'/x.js': absPath}, getState(), dispatch(action,args,source), devices: {list(), save(list)}, onChange() }
   */
  constructor(opts) {
    this.opts = opts;
    this.port = opts.port || 8787;
    this.pin = RemoteServer.newPin();
    this.clients = new Set();
    this.ackCache = new Map();   // command id -> ack (duplicate-command protection)
    this.queue = Promise.resolve(); // strict command ordering
    this.failures = new Map();   // ip -> {count, until}
    this.running = false;
    this.lastError = null;
  }

  static newPin() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }
  regeneratePin() { this.pin = RemoteServer.newPin(); this.changed(); return this.pin; }
  changed() { if (this.opts.onChange) this.opts.onChange(); }

  info() {
    const addrs = localAddresses();
    return {
      running: this.running, port: this.port, pin: this.pin, error: this.lastError,
      addresses: addrs.map(a => ({ name: a.name, address: a.address, url: `http://${a.address}:${this.port}/` })),
      url: addrs.length ? `http://${addrs[0].address}:${this.port}/` : `http://localhost:${this.port}/`,
      connected: Array.from(this.clients).filter(c => c.authed).map(c => ({ deviceId: c.deviceId, name: c.deviceName, ip: c.ip, since: c.since })),
      devices: this.opts.devices.list().map(d => ({ id: d.id, name: d.name, pairedAt: d.pairedAt, lastSeen: d.lastSeen, online: Array.from(this.clients).some(c => c.authed && c.deviceId === d.id) }))
    };
  }

  start() {
    return new Promise((resolve) => {
      if (this.running) return resolve(this.info());
      this.server = http.createServer((req, res) => this.handleHttp(req, res));
      this.wss = new WebSocketServer({ server: this.server, path: '/ws', maxPayload: 256 * 1024 });
      this.wss.on('connection', (ws, req) => this.handleWs(ws, req));
      this.server.on('error', (e) => { this.lastError = e.code === 'EADDRINUSE' ? `Port ${this.port} is already in use — choose another port in Settings.` : e.message; this.running = false; this.changed(); resolve(this.info()); });
      this.server.listen(this.port, '0.0.0.0', () => {
        this.running = true; this.lastError = null;
        this.heartbeat = setInterval(() => this.clients.forEach(c => {
          if (c.alive === false) { try { c.ws.terminate(); } catch (e) { /* */ } return; }
          c.alive = false; try { c.ws.ping(); } catch (e) { /* */ }
        }), 15000);
        this.changed(); resolve(this.info());
      });
    });
  }

  stop() {
    return new Promise(resolve => {
      clearInterval(this.heartbeat);
      this.clients.forEach(c => { try { c.ws.close(1001, 'server stopping'); } catch (e) { /* */ } });
      this.clients.clear();
      if (!this.server) { this.running = false; return resolve(); }
      try { this.wss.close(); } catch (e) { /* */ }
      this.server.close(() => { this.running = false; this.changed(); resolve(); });
      setTimeout(() => { this.running = false; resolve(); }, 1500);
    });
  }

  handleHttp(req, res) {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') p = '/index.html';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (p === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, app: 'Crime Master Bingo' })); }
    let file = null;
    if (this.opts.extraFiles && this.opts.extraFiles[p]) file = this.opts.extraFiles[p];
    else if (this.opts.mounts && Object.keys(this.opts.mounts).some(m => p.startsWith(m))) {
      const m = Object.keys(this.opts.mounts).find(x => p.startsWith(x));
      const base = path.normalize(this.opts.mounts[m]);
      const resolved = path.normalize(path.join(base, p.slice(m.length)));
      if (resolved.startsWith(base + path.sep)) file = resolved;
    } else {
      const resolved = path.normalize(path.join(this.opts.staticDir, p));
      if (resolved.startsWith(path.normalize(this.opts.staticDir) + path.sep)) file = resolved;
    }
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }

  handleWs(ws, req) {
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const c = { ws, ip, authed: false, alive: true, since: new Date().toISOString() };
    this.clients.add(c);
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (raw) => {
      c.alive = true;
      let msg; try { msg = JSON.parse(String(raw)); } catch (e) { return; }
      this.handleMsg(c, msg);
    });
    ws.on('close', () => { this.clients.delete(c); if (c.authed) this.changed(); });
    ws.on('error', () => { /* handled by close */ });
    this.send(c, { type: 'hello', app: 'Crime Master Bingo', needAuth: true });
  }

  send(c, obj) { if (c.ws.readyState === 1) { try { c.ws.send(JSON.stringify(obj)); } catch (e) { /* */ } } }

  authOk(c, device) {
    c.authed = true; c.deviceId = device.id; c.deviceName = device.name;
    device.lastSeen = new Date().toISOString();
    this.opts.devices.save(this.opts.devices.list());
    this.send(c, { type: 'auth-ok', deviceId: device.id, deviceName: device.name });
    this.send(c, { type: 'state', state: this.opts.getState() });
    this.changed();
  }

  handleMsg(c, msg) {
    if (msg.type === 'ping') return this.send(c, { type: 'pong', t: msg.t });
    if (msg.type === 'auth') {
      const list = this.opts.devices.list();
      const d = msg.token ? list.find(x => x.tokenHash === sha(msg.token)) : null;
      if (d) return this.authOk(c, d);
      return this.send(c, { type: 'auth-fail', reason: 'This phone is not paired (or was removed). Enter the PIN shown on the laptop.' });
    }
    if (msg.type === 'pair') {
      const f = this.failures.get(c.ip) || { count: 0, until: 0 };
      if (Date.now() < f.until) return this.send(c, { type: 'auth-fail', reason: `Too many wrong PINs. Try again in ${Math.ceil((f.until - Date.now()) / 1000)} s.` });
      if (String(msg.pin || '').trim() !== this.pin) {
        f.count++; if (f.count >= 5) { f.until = Date.now() + 60000; f.count = 0; }
        this.failures.set(c.ip, f);
        return this.send(c, { type: 'auth-fail', reason: 'Wrong PIN. Check the PIN on the laptop (Mobile Host screen).' });
      }
      this.failures.delete(c.ip);
      const token = crypto.randomBytes(24).toString('hex');
      const device = { id: 'd_' + crypto.randomBytes(4).toString('hex'), name: String(msg.deviceName || 'Phone').slice(0, 60), tokenHash: sha(token), pairedAt: new Date().toISOString(), lastSeen: null };
      const list = this.opts.devices.list(); list.push(device); this.opts.devices.save(list);
      this.send(c, { type: 'paired', token, deviceId: device.id });
      return this.authOk(c, device);
    }
    if (!c.authed) return this.send(c, { type: 'auth-fail', reason: 'Not paired' });
    // device may have been revoked while connected
    if (!this.opts.devices.list().some(d => d.id === c.deviceId)) { this.send(c, { type: 'revoked' }); try { c.ws.close(4001, 'revoked'); } catch (e) { /* */ } return; }
    if (msg.type === 'getState') return this.send(c, { type: 'state', state: this.opts.getState() });
    if (msg.type === 'cmd') return this.handleCmd(c, msg);
  }

  handleCmd(c, msg) {
    const id = String(msg.id || '');
    if (!id) return;
    const cached = this.ackCache.get(id);
    if (cached) {
      // Duplicate (a retry after reconnect): never execute twice, just repeat the answer.
      if (cached.done) this.send(c, cached.ack); else cached.waiters.push(c);
      return;
    }
    const entry = { done: false, ack: null, waiters: [c] };
    this.ackCache.set(id, entry);
    if (this.ackCache.size > 2000) { const k = this.ackCache.keys().next().value; this.ackCache.delete(k); }
    this.queue = this.queue.then(async () => {
      let ack;
      try {
        if (!REMOTE_ACTIONS.has(msg.action)) throw new Error('Action not allowed from the phone: ' + msg.action);
        const result = await this.opts.dispatch(msg.action, msg.args || {}, `phone:${c.deviceName || 'phone'}`);
        ack = { type: 'ack', id, ok: true, result }; // decisions/needsConfirm/validation messages travel in result
      } catch (e) { ack = { type: 'ack', id, ok: false, error: e.message, code: e.code }; }
      entry.done = true; entry.ack = ack;
      entry.waiters.forEach(w => this.send(w, ack));
      entry.waiters = [];
    });
  }

  broadcast(obj) { const s = JSON.stringify(obj); this.clients.forEach(c => { if (c.authed && c.ws.readyState === 1) { try { c.ws.send(s); } catch (e) { /* */ } } }); }
  broadcastState() { if (this.clients.size) this.broadcast({ type: 'state', state: this.opts.getState() }); }

  revoke(deviceId) {
    const list = this.opts.devices.list().filter(d => d.id !== deviceId);
    this.opts.devices.save(list);
    this.clients.forEach(c => { if (c.deviceId === deviceId) { this.send(c, { type: 'revoked' }); try { c.ws.close(4001, 'revoked'); } catch (e) { /* */ } } });
    this.changed();
  }
}

module.exports = { RemoteServer, localAddresses, REMOTE_ACTIONS };
