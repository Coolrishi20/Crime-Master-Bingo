'use strict';
/* 2.4 licensing framework: OFF (free edition) by default and never restrictive; when switched on
 * in a later version it verifies signed tokens offline, keeps a 30-day offline grace with a
 * warning, and only ever blocks STARTING a new game. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { Licensing, signToken, verifyToken } = require('../../src/main/licence');
const keys = () => { const k = crypto.generateKeyPairSync('ed25519'); return { pub: k.publicKey.export({ type: 'spki', format: 'pem' }), priv: k.privateKey.export({ type: 'pkcs8', format: 'pem' }) }; };

test('free edition: switched off, nothing restricted, activation explains it is free', async () => {
  const l = new Licensing({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lic-')) });
  assert.deepStrictEqual([l.status().edition, l.status().enforced, l.canStartNewGame()], ['free', false, true]);
  await assert.rejects(l.activate('KEY'), /free to use/);
});

test('switched on: signed token checked offline, device-bound, expiry and offline grace', async () => {
  const k = keys(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lic2-')); let now = Date.parse('2027-01-01T12:00:00Z');
  const provider = { activate: async (key, deviceId) => signToken({ plan: 'annual', expires: '2027-12-31T00:00:00Z', devices: 2, deviceId }, k.priv), deactivate: async () => true };
  const l = new Licensing({ dataDir: dir, enabled: true, publicKey: k.pub, provider, now: () => now });
  assert.strictEqual(l.canStartNewGame(), false, 'no licence yet');
  const st = await l.activate('KEY-1');
  assert.ok(st.canStartGame && st.plan === 'annual' && !st.warn);
  now += 24 * 86400000; assert.match(l.status().warn, /6 more day/, 'warning from day 23 offline');
  now += 7 * 86400000; assert.strictEqual(l.canStartNewGame(), false, 'after 30 days offline: confirm online before a new game');
  // tampering is detected
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'licence.json'), 'utf8'));
  const [p, s] = saved.token.split('.'); const forged = Buffer.from(JSON.stringify({ plan: 'annual', expires: '2099-01-01' })).toString('base64url') + '.' + s;
  assert.throws(() => verifyToken(forged, k.pub), /not valid/);
  assert.ok(p);
  // another laptop
  fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify({ id: 'dv_other' }));
  assert.match(new Licensing({ dataDir: dir, enabled: true, publicKey: k.pub, now: () => now }).status().message, /another laptop/);
});
