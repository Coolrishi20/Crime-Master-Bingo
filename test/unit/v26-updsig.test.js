'use strict';
/* 2.4 signed updates: the manifest signature, per-file hashes, and the CI signing script that
 * refuses to publish without the right key. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { verifyManifest, checkFile, signManifest, PUBLIC_KEY } = require('../../src/main/updsig');
const kp = () => { const k = crypto.generateKeyPairSync('ed25519'); return { pub: k.publicKey.export({ type: 'spki', format: 'pem' }), priv: k.privateKey.export({ type: 'pkcs8', format: 'pem' }) }; };

test('a genuine manifest is accepted; altered, re-signed with another key, or for another version is refused', async () => {
  const k = kp(); const other = kp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-')); const exe = path.join(dir, 'AnthemSquare-Portable-2.4.0.exe'); fs.writeFileSync(exe, crypto.randomBytes(5000));
  const files = { 'AnthemSquare-Portable-2.4.0.exe': crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex') };
  const { text, sig } = signManifest({ version: '2.4.0', files }, k.priv);
  const m = verifyManifest(text, sig, 'v2.4.0', k.pub);
  assert.ok(await checkFile(m, 'AnthemSquare-Portable-2.4.0.exe', exe));
  assert.throws(() => verifyManifest(text.replace('2.4.0', '2.4.1'), sig, '2.4.1', k.pub), /not signed/, 'edited manifest');
  const forged = signManifest({ version: '2.4.0', files }, other.priv);
  assert.throws(() => verifyManifest(forged.text, forged.sig, '2.4.0', k.pub), /not signed/, 'someone else\'s key');
  assert.throws(() => verifyManifest(text, sig, '2.5.0', k.pub), /different version/);
  fs.appendFileSync(exe, 'x');
  await assert.rejects(checkFile(m, 'AnthemSquare-Portable-2.4.0.exe', exe), /does not match/);
  await assert.rejects(checkFile(m, 'evil.exe', exe), /not part of the signed release/);
});

test('the app ships a real Ed25519 public key', () => {
  const k = crypto.createPublicKey(PUBLIC_KEY);
  assert.strictEqual(k.asymmetricKeyType, 'ed25519');
});

test('CI signing script refuses without the key, or with a key that does not match the app', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig2-')); fs.writeFileSync(path.join(dir, 'AnthemSquare-Setup-9.9.9.exe'), 'x');
  const run = (env) => spawnSync(process.execPath, [path.join(__dirname, '../../tools/sign-release.js'), dir], { env: Object.assign({}, process.env, env), encoding: 'utf8' });
  const a = run({ ANTHEM_UPDATE_SIGNING_KEY: '' });
  assert.strictEqual(a.status, 1); assert.match(a.stderr, /refusing to publish an unsigned release/);
  const b = run({ ANTHEM_UPDATE_SIGNING_KEY: kp().priv });
  assert.strictEqual(b.status, 1); assert.match(b.stderr, /does not match the public key built into the app/);
  assert.ok(!fs.existsSync(path.join(dir, 'release-signature.json')));
});
