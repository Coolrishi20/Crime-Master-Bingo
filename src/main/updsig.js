'use strict';
/**
 * Update authenticity (2.4). Every release carries `release-signature.json` (the version and
 * the SHA-256 of every release file) and `release-signature.sig` (an Ed25519 signature of that
 * JSON made in CI with a private key held only as a GitHub secret). The app checks it with the
 * PUBLIC key below before it installs anything; an unsigned or altered update is never run.
 */
const crypto = require('crypto');
const fs = require('fs');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAkzG4iqlQptF447/ACOpQHvsYx8zPB2mLZpafV+iJhP8=
-----END PUBLIC KEY-----
`;
const MANIFEST = 'release-signature.json';
const SIGNATURE = 'release-signature.sig';

/** Check the manifest's signature and version. Returns the parsed manifest or throws. */
function verifyManifest(jsonText, sigBase64, expectVersion, publicKey = PUBLIC_KEY) {
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(jsonText, 'utf8'), publicKey, Buffer.from(String(sigBase64).trim(), 'base64')); } catch (e) { ok = false; }
  if (!ok) throw new Error('This update is not signed by Anthem Square — it was not installed.');
  const m = JSON.parse(jsonText);
  const clean = (v) => String(v || '').replace(/^v/i, '');
  if (expectVersion && clean(m.version) !== clean(expectVersion)) throw new Error('The update signature belongs to a different version — it was not installed.');
  if (!m.files || typeof m.files !== 'object') throw new Error('The update signature lists no files.');
  return m;
}
/** SHA-256 of a file (streamed). */
function sha256File(file) {
  return new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
}
/** The downloaded file must be listed in the signed manifest with exactly this hash. */
async function checkFile(manifest, name, file) {
  const want = manifest.files[name];
  if (!want) throw new Error(`${name} is not part of the signed release — it was not installed.`);
  const got = await sha256File(file);
  if (got !== String(want).toLowerCase()) throw new Error('The downloaded file does not match the signed release — it was deleted and not installed.');
  return true;
}
/** Used by CI (tools/sign-release.js) and tests. */
function signManifest(manifest, privateKeyPem) { const text = JSON.stringify(manifest, null, 2); return { text, sig: crypto.sign(null, Buffer.from(text, 'utf8'), privateKeyPem).toString('base64') }; }

module.exports = { PUBLIC_KEY, MANIFEST, SIGNATURE, verifyManifest, checkFile, sha256File, signManifest };
