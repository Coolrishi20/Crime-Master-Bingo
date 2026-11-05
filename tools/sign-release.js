#!/usr/bin/env node
/* CI: sign the release files. Writes dist/release-signature.json (version + SHA-256 of every
 * release file) and dist/release-signature.sig (Ed25519). The private key comes from the
 * ANTHEM_UPDATE_SIGNING_KEY secret; without it this step FAILS, so an unsigned release is never
 * published. Usage: node tools/sign-release.js dist */
'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const { signManifest, verifyManifest, MANIFEST, SIGNATURE } = require('../src/main/updsig');

const dir = process.argv[2] || 'dist';
const key = process.env.ANTHEM_UPDATE_SIGNING_KEY;
if (!key || !/BEGIN PRIVATE KEY/.test(key)) { console.error('ANTHEM_UPDATE_SIGNING_KEY is not set — refusing to publish an unsigned release.'); process.exit(1); }
const version = require(path.join(__dirname, '..', 'package.json')).version;
const files = {};
fs.readdirSync(dir).filter(f => /\.(exe|yml|blockmap)$/i.test(f) && f !== 'builder-debug.yml').sort().forEach(f => { files[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex'); });
if (!Object.keys(files).length) { console.error('No release files found in ' + dir); process.exit(1); }
const { text, sig } = signManifest({ app: 'Anthem Square', version, signedAt: new Date().toISOString(), files }, key);
verifyManifest(text, sig, version, crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' })); // self-check
// the key built into the app must be the matching public key
const builtIn = require('../src/main/updsig').PUBLIC_KEY.replace(/\s+/g, '');
const mine = crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }).replace(/\s+/g, '');
if (builtIn !== mine) { console.error('The signing key does not match the public key built into the app (src/main/updsig.js).'); process.exit(1); }
fs.writeFileSync(path.join(dir, MANIFEST), text); fs.writeFileSync(path.join(dir, SIGNATURE), sig + '\n');
console.log(`Signed ${Object.keys(files).length} file(s) for ${version}`);
