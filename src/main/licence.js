'use strict';
/**
 * Licensing framework (2.4) — BUILT BUT SWITCHED OFF. Anthem Square is free for now:
 * `enabled` is false, so every check answers "free edition" and nothing is ever restricted.
 * It exists so commercial licensing can be switched on later without touching the game,
 * playback or card code. Policy numbers below are the PROPOSAL from the commercial review,
 * not decisions; they have no effect while licensing is off.
 *
 * Design (when switched on):
 * - A provider (e.g. Keygen / Lemon Squeezy / Paddle — not chosen) issues a licence token:
 *   base64url(JSON payload) "." base64url(Ed25519 signature). The app checks it OFFLINE with
 *   the public key built into the app; payment and accounts stay on the provider's site.
 * - Online checks only at start-up and between games, never during one. A running game is
 *   never stopped; an expired licence only blocks STARTING a new game. Existing games,
 *   printing existing cards and backups keep working.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROPOSED_POLICY = { trialDays: 14, devicesPerLicence: 2, offlineDays: 30, warnFromDay: 23 };

function b64u(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

/** Verify a signed licence token. Returns the payload or throws. */
function verifyToken(token, publicKeyPem) {
  const [p, s] = String(token || '').split('.');
  if (!p || !s) throw new Error('Not a licence token');
  const ok = crypto.verify(null, Buffer.from(p), publicKeyPem, unb64u(s));
  if (!ok) throw new Error('Licence signature is not valid');
  return JSON.parse(unb64u(p).toString('utf8'));
}
/** For tests and for a provider's server — never shipped with a private key in the app. */
function signToken(payload, privateKeyPem) { const p = b64u(JSON.stringify(payload)); return p + '.' + b64u(crypto.sign(null, Buffer.from(p), privateKeyPem)); }

class Licensing {
  /** o: { dataDir, enabled=false, publicKey, policy, provider, now() } */
  constructor(o = {}) {
    this.o = o; this.enabled = !!o.enabled; this.policy = Object.assign({}, PROPOSED_POLICY, o.policy || {});
    this.now = o.now || (() => Date.now());
    this.file = o.dataDir ? path.join(o.dataDir, 'licence.json') : null;
  }
  /** A random per-installation id (no hardware fingerprinting, nothing personal). */
  deviceId() {
    if (!this.file) return 'dev';
    const f = path.join(path.dirname(this.file), 'device.json');
    try { return JSON.parse(fs.readFileSync(f, 'utf8')).id; } catch (e) { const id = 'dv_' + crypto.randomBytes(9).toString('hex'); try { fs.writeFileSync(f, JSON.stringify({ id })); } catch (x) { /* read-only */ } return id; }
  }
  read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { return null; } }
  status() {
    if (!this.enabled) return { edition: 'free', enforced: false, canStartGame: true, message: 'Free edition — no licence or activation needed.' };
    const saved = this.read(); const day = 86400000;
    if (!saved || !saved.token) return { edition: 'unlicensed', enforced: true, canStartGame: false, message: 'No licence on this laptop.' };
    let p; try { p = verifyToken(saved.token, this.o.publicKey); } catch (e) { return { edition: 'invalid', enforced: true, canStartGame: false, message: e.message }; }
    if (p.deviceId && p.deviceId !== this.deviceId()) return { edition: 'invalid', enforced: true, canStartGame: false, message: 'This licence belongs to another laptop.' };
    const now = this.now();
    const expired = p.expires && now > Date.parse(p.expires);
    const offlineDays = saved.checkedAt ? Math.floor((now - Date.parse(saved.checkedAt)) / day) : 0;
    const graceLeft = this.policy.offlineDays - offlineDays;
    const st = { edition: p.plan || 'licensed', enforced: true, plan: p.plan, expires: p.expires || null, devices: p.devices || this.policy.devicesPerLicence, offlineDays, graceLeft };
    if (expired) return Object.assign(st, { canStartGame: false, message: 'Licence expired — renew to start new games. Existing games, printing and backups still work.' });
    if (graceLeft <= 0) return Object.assign(st, { canStartGame: false, message: 'Connect to the internet once to confirm the licence.' });
    return Object.assign(st, { canStartGame: true, warn: offlineDays >= this.policy.warnFromDay ? `Works offline for ${graceLeft} more day(s) — connect to the internet soon.` : null, message: 'Licence active.' });
  }
  /** Only ever asked when a NEW game starts — never during one. */
  canStartNewGame() { return this.status().canStartGame !== false; }
  async activate(key) {
    if (!this.enabled || !this.o.provider) throw new Error('Licensing is not switched on in this version — Anthem Square is free to use.');
    const token = await this.o.provider.activate(key, this.deviceId());
    verifyToken(token, this.o.publicKey);
    fs.writeFileSync(this.file, JSON.stringify({ token, checkedAt: new Date(this.now()).toISOString() }));
    return this.status();
  }
  async deactivate() {
    if (!this.enabled || !this.o.provider) throw new Error('Licensing is not switched on in this version.');
    const saved = this.read(); if (saved && saved.token) await this.o.provider.deactivate(saved.token, this.deviceId());
    try { fs.unlinkSync(this.file); } catch (e) { /* none */ }
    return this.status();
  }
}

module.exports = { Licensing, verifyToken, signToken, PROPOSED_POLICY };
