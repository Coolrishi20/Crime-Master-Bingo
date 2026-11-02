'use strict';
/**
 * Portable game backup & restore (.cmbbackup).
 *
 * Format: a ZIP archive containing
 *   manifest.json  – format/schema versions, game id, checksums, media manifest
 *   game.json      – the complete game (cards, ledger, claims, sessions, credits, audit…)
 *   media/<songId>.<ext> – OPTIONAL copies of the game's videos (full portable backup)
 * Optionally wrapped in standard AES-256-GCM encryption (key from scrypt) — no custom crypto.
 *
 * Writing is crash-safe: everything goes to "<file>.partial" and is renamed only when complete.
 * Restoring is transactional: validated first, media extracted to a temp folder, the game
 * saved last with an atomic write. Existing games are never overwritten.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const yazl = require('yazl');
const yauzl = require('yauzl');
const cardsLib = require('../core/cards');
const locking = require('../core/locking');
const { fingerprint } = require('./library');
const { readMp4Tags, parseFilename } = require('./mp4meta');

const FORMAT = 'cmbbackup';
const FORMAT_VERSION = 1;
const ENC_MAGIC = 'CMBENC1\n';
const LIMITS = { manifest: 50 * 1024 * 1024, game: 200 * 1024 * 1024, mediaFile: 64 * 1024 * 1024 * 1024, entries: 5000 };
const MEDIA_RE = /^media\/([A-Za-z0-9_-]{1,64})\.(mp4|m4v|mov|webm|mkv|ogv)$/;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function cardsHash(game) { return sha256(JSON.stringify(game.cards.map(c => [c.no, c.cells]))); }
function labelsHash(game) { const l = locking.labelsFor(game); return sha256(JSON.stringify(Object.keys(l).sort().map(k => [k, l[k].title, l[k].artist]))); }
function fileSha256(file) { return new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); }); }
function exists(p) { try { return fs.existsSync(p); } catch (e) { return false; } }

function commonRoot(paths) {
  const parts = paths.filter(Boolean).map(p => path.resolve(p).split(/[\\/]/));
  if (!parts.length) return '';
  let i = 0;
  while (parts.every(p => p.length > i + 1 && p[i] === parts[0][i])) i++;
  return parts[0].slice(0, i).join(path.sep);
}

function mediaManifest(game) {
  const songs = Object.values(game.songs);
  const root = commonRoot(songs.map(s => s.path));
  return songs.map(s => ({
    songId: s.id, title: s.title, artist: s.artist, fileName: s.fileName || path.basename(s.path || ''),
    originalPath: s.path, relativePath: root && s.path ? path.relative(root, s.path).split(path.sep).join('/') : null,
    size: s.size || null, fingerprint: s.fingerprint || null, ext: (path.extname(s.path || '') || '.mp4').toLowerCase()
  }));
}

/** Estimated backup size before export. */
function estimate(game, includeMedia) {
  const gameBytes = Buffer.byteLength(JSON.stringify(game));
  let mediaBytes = 0; const missing = [];
  if (includeMedia) Object.values(game.songs).forEach(s => { try { mediaBytes += fs.statSync(s.path).size; } catch (e) { missing.push({ songId: s.id, title: s.title }); } });
  return { gameBytes, mediaBytes, totalBytes: gameBytes + mediaBytes, songs: Object.keys(game.songs).length, cards: game.cards.length, missing };
}

/* ------------------------------------------------------------------ encryption */
function deriveKey(password, salt, params) {
  return crypto.scryptSync(String(password), salt, 32, { N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 });
}
async function encryptFile(src, dest, password) {
  const params = { v: 1, kdf: 'scrypt', N: 32768, r: 8, p: 1, cipher: 'aes-256-gcm', salt: crypto.randomBytes(16).toString('base64'), iv: crypto.randomBytes(12).toString('base64') };
  const key = deriveKey(password, Buffer.from(params.salt, 'base64'), params);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(params.iv, 'base64'));
  const out = fs.createWriteStream(dest);
  out.write(ENC_MAGIC + JSON.stringify(params) + '\n');
  await pipeline(fs.createReadStream(src), cipher, out, { end: false }).catch(async (e) => { out.destroy(); throw e; });
  await new Promise((res, rej) => out.end(cipher.getAuthTag(), (e) => (e ? rej(e) : res())));
}
function readHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(4096); const n = fs.readSync(fd, buf, 0, 4096, 0);
    const head = buf.subarray(0, n);
    if (head.subarray(0, ENC_MAGIC.length).toString('latin1') !== ENC_MAGIC) return null;
    const nl = head.indexOf(10, ENC_MAGIC.length);
    if (nl < 0) throw new Error('Corrupted encrypted backup header.');
    const params = JSON.parse(head.subarray(ENC_MAGIC.length, nl).toString('utf8'));
    return { params, offset: nl + 1 };
  } finally { fs.closeSync(fd); }
}
async function decryptFile(file, dest, password, header) {
  const size = fs.statSync(file).size;
  const tag = Buffer.alloc(16); const fd = fs.openSync(file, 'r'); fs.readSync(fd, tag, 0, 16, size - 16); fs.closeSync(fd);
  const key = deriveKey(password, Buffer.from(header.params.salt, 'base64'), header.params);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(header.params.iv, 'base64'));
  d.setAuthTag(tag);
  try { await pipeline(fs.createReadStream(file, { start: header.offset, end: size - 17 }), d, fs.createWriteStream(dest)); }
  catch (e) { try { fs.unlinkSync(dest); } catch (x) { /* */ } throw new Error('Wrong password, or the backup file is damaged.'); }
}

/* ------------------------------------------------------------------ create */
async function createBackup(game, { file, includeMedia = false, password = null, appVersion = '1.0.0', onProgress = () => {} }) {
  if (!file) throw new Error('No destination chosen');
  const partial = file + '.partial';
  const zipTmp = password ? file + '.zip.partial' : partial;
  // Never back up remote-control credentials (they are not part of a game anyway).
  const gameJson = Buffer.from(JSON.stringify(game));
  const media = mediaManifest(game);
  const manifest = {
    format: FORMAT, formatVersion: FORMAT_VERSION, schemaVersion: game.schemaVersion || locking.SCHEMA_VERSION, appVersion,
    createdAt: new Date().toISOString(), type: includeMedia ? 'full' : 'game',
    gameId: game.id, gameName: game.name, gameDate: game.date, venue: game.venue || '',
    counts: { songs: Object.keys(game.songs).length, cards: game.cards.length, played: (game.played || []).length, claims: (game.claims || []).length, credits: (game.credits || []).length, round: game.round ? game.round.number : 0 },
    cardsLocked: !!game.cardsLocked, cardsHash: cardsHash(game), labelsHash: labelsHash(game),
    files: [{ path: 'game.json', size: gameJson.length, sha256: sha256(gameJson) }],
    media
  };
  try {
    const zip = new yazl.ZipFile();
    const out = fs.createWriteStream(zipTmp);
    const done = new Promise((res, rej) => { out.on('close', res); out.on('error', rej); zip.outputStream.on('error', rej); });
    done.catch(() => {}); // observed below; avoids an unhandled rejection while media is streaming
    zip.outputStream.pipe(out);
    zip.addBuffer(gameJson, 'game.json', { compress: true });
    if (includeMedia) {
      const total = media.reduce((a, m) => a + (exists(m.originalPath) ? fs.statSync(m.originalPath).size : 0), 0);
      let doneBytes = 0;
      for (const m of media) {
        if (!exists(m.originalPath)) { m.included = false; m.note = 'missing when the backup was made'; continue; }
        const name = `media/${m.songId}${m.ext}`;
        const h = crypto.createHash('sha256');
        const rs = fs.createReadStream(m.originalPath);
        // Hash inside a Transform so no bytes can flow before the zip writer consumes them.
        const tap = new Transform({ transform(chunk, enc, cb) { h.update(chunk); doneBytes += chunk.length; onProgress({ phase: 'media', done: doneBytes, total, file: m.fileName }); cb(null, chunk); } });
        const finished = new Promise((res, rej) => { tap.on('end', res); tap.on('error', rej); rs.on('error', rej); });
        rs.pipe(tap);
        zip.addReadStream(tap, name, { compress: false }); // video is already compressed
        await Promise.race([finished, done.then(() => { throw new Error('Backup output closed early'); })]);
        m.included = true; m.archivePath = name; m.sha256 = h.digest('hex'); m.size = fs.statSync(m.originalPath).size;
      }
    }
    const manBuf = Buffer.from(JSON.stringify(manifest, null, 1));
    zip.addBuffer(manBuf, 'manifest.json', { compress: true });
    zip.end();
    await done;
    if (password) {
      onProgress({ phase: 'encrypt' });
      await encryptFile(zipTmp, partial, password);
      fs.unlinkSync(zipTmp);
    }
    // fsync, then publish atomically
    const fd = fs.openSync(partial, 'r+'); fs.fsyncSync(fd); fs.closeSync(fd);
    fs.renameSync(partial, file);
    const size = fs.statSync(file).size;
    onProgress({ phase: 'done', size });
    return { file, size, type: manifest.type, mediaIncluded: media.filter(m => m.included).length, mediaMissing: includeMedia ? media.filter(m => m.included === false).length : 0, encrypted: !!password };
  } catch (e) {
    [partial, zipTmp].forEach(p => { try { if (exists(p)) fs.unlinkSync(p); } catch (x) { /* */ } });
    throw e;
  }
}

/* ------------------------------------------------------------------ read / validate */
function openZip(file) { return new Promise((res, rej) => yauzl.open(file, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true, autoClose: false }, (e, z) => (e ? rej(new Error('Not a valid backup archive: ' + e.message)) : res(z)))); }
function listEntries(zip) {
  return new Promise((res, rej) => {
    const entries = [];
    zip.on('entry', (e) => { entries.push(e); if (entries.length > LIMITS.entries) { rej(new Error('Archive has too many files.')); return; } zip.readEntry(); });
    zip.on('end', () => res(entries));
    zip.on('error', (e) => rej(new Error('Archive is damaged: ' + e.message)));
    zip.readEntry();
  });
}
function readEntryBuffer(zip, entry, limit) {
  if (entry.uncompressedSize > limit) return Promise.reject(new Error(`${entry.fileName} is larger than allowed.`));
  return new Promise((res, rej) => zip.openReadStream(entry, (e, rs) => {
    if (e) return rej(e);
    const chunks = []; let n = 0;
    rs.on('data', d => { n += d.length; if (n > limit) { rs.destroy(new Error('Entry exceeds safe size')); } else chunks.push(d); });
    rs.on('end', () => res(Buffer.concat(chunks)));
    rs.on('error', rej);
  }));
}
function safeName(name) {
  if (name.includes('\\') || name.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(name) || /^[A-Za-z]:/.test(name) || name.includes('\0')) return false;
  return name === 'manifest.json' || name === 'game.json' || MEDIA_RE.test(name);
}

/** Open (decrypting if needed) and fully validate a backup. Never touches the database. */
async function loadBackup(file, { password, tmpDir }) {
  if (!exists(file)) throw new Error('Backup file not found.');
  let zipPath = file; let tmpZip = null;
  const header = readHeader(file);
  if (header) {
    if (!password) return { encrypted: true, needsPassword: true };
    fs.mkdirSync(tmpDir, { recursive: true });
    tmpZip = path.join(tmpDir, 'restore-' + crypto.randomBytes(6).toString('hex') + '.zip');
    await decryptFile(file, tmpZip, password, header);
    zipPath = tmpZip;
  }
  const zip = await openZip(zipPath);
  const cleanup = () => { try { zip.close(); } catch (e) { /* */ } if (tmpZip) { try { fs.unlinkSync(tmpZip); } catch (e) { /* */ } } };
  try {
    const entries = await listEntries(zip);
    const bad = entries.filter(e => !safeName(e.fileName));
    if (bad.length) throw new Error(`Unsafe or unexpected file in archive: "${bad[0].fileName}" — restore refused.`);
    const byName = new Map(entries.map(e => [e.fileName, e]));
    if (byName.size !== entries.length) throw new Error('Archive contains duplicate entries.');
    if (!byName.has('manifest.json')) throw new Error('Backup is incomplete (no manifest) — it may have been interrupted.');
    if (!byName.has('game.json')) throw new Error('Backup has no game data.');
    const manifest = JSON.parse((await readEntryBuffer(zip, byName.get('manifest.json'), LIMITS.manifest)).toString('utf8'));
    const checks = [];
    const check = (label, ok, detail) => { checks.push({ label, ok: !!ok, detail }); if (!ok) throw Object.assign(new Error(`${label}: ${detail}`), { checks }); };
    check('Archive structure', true, `${entries.length} files, all names safe`);
    check('Backup format', manifest.format === FORMAT, manifest.format === FORMAT ? 'Crime Master Bingo backup' : 'Not a Crime Master Bingo backup');
    check('Format version', Number(manifest.formatVersion) <= FORMAT_VERSION, Number(manifest.formatVersion) <= FORMAT_VERSION ? `v${manifest.formatVersion}` : `made by a newer version of Crime Master Bingo (format v${manifest.formatVersion}) — update the app to restore it`);
    check('Schema version', Number(manifest.schemaVersion || 1) <= locking.SCHEMA_VERSION, `schema ${manifest.schemaVersion}`);
    const gEntry = byName.get('game.json');
    const gBuf = await readEntryBuffer(zip, gEntry, LIMITS.game);
    const gDecl = (manifest.files || []).find(f => f.path === 'game.json');
    check('Game data checksum', gDecl && gDecl.sha256 === sha256(gBuf), gDecl && gDecl.sha256 === sha256(gBuf) ? 'SHA-256 verified' : 'checksum mismatch — the file is corrupted');
    const game = JSON.parse(gBuf.toString('utf8'));
    check('Game identity', game.id === manifest.gameId && /^[A-Za-z0-9_-]{2,40}$/.test(game.id), game.id);
    check('Song pool', game.songs && Array.isArray(game.order) && game.order.every(id => game.songs[id]) && Object.keys(game.songs).length === game.order.length, `${Object.keys(game.songs || {}).length} songs`);
    const problems = cardsLib.validateCards(game.cards || [], game.order);
    check('Card mappings', problems.length === 0, problems.length ? problems.slice(0, 2).join('; ') : `${(game.cards || []).length} cards, every card 25 unique songs`);
    check('Card checksum', manifest.cardsHash === cardsHash(game), manifest.cardsHash === cardsHash(game) ? 'card numbers and arrangements match the original exactly' : 'cards differ from the manifest');
    check('Printed labels', !manifest.labelsHash || manifest.labelsHash === labelsHash(game), 'labels match');
    const mediaEntries = entries.filter(e => MEDIA_RE.test(e.fileName));
    for (const e of mediaEntries) {
      const m = (manifest.media || []).find(x => x.archivePath === e.fileName);
      check('Media manifest', m && game.songs[m.songId] && e.uncompressedSize === m.size && e.uncompressedSize <= LIMITS.mediaFile, m ? `${e.fileName} (${e.uncompressedSize} bytes, manifest ${m.size}${game.songs[m.songId] ? '' : ', unknown song'})` : `${e.fileName} not listed in the manifest`);
    }
    if (manifest.type === 'full') checks.push({ label: 'Videos included', ok: true, detail: `${mediaEntries.length} of ${Object.keys(game.songs).length}` });
    return { manifest, game, checks, zip, byName, mediaEntries, cleanup, encrypted: !!header };
  } catch (e) { cleanup(); throw e; }
}

async function inspectBackup(file, opts) {
  const b = await loadBackup(file, opts).catch(e => ({ error: e.message, checks: e.checks || [] }));
  if (b.error || b.needsPassword) return b;
  b.cleanup();
  const g = b.game;
  return {
    ok: true, encrypted: b.encrypted, checks: b.checks, manifest: { gameId: b.manifest.gameId, gameName: b.manifest.gameName, gameDate: b.manifest.gameDate, venue: b.manifest.venue, type: b.manifest.type, createdAt: b.manifest.createdAt, appVersion: b.manifest.appVersion, counts: b.manifest.counts, cardsLocked: b.manifest.cardsLocked },
    summary: { status: g.status, round: g.round, played: (g.played || []).filter(p => p.kind !== 'credit').length, credits: (g.played || []).filter(p => p.kind === 'credit').length, winners: (g.claims || []).filter(c => c.status === 'confirmed').length, openSession: (g.claimSessions || []).some(s => s.status === 'open') },
    mediaIncluded: b.mediaEntries.length
  };
}

/* ------------------------------------------------------------------ restore */
async function restoreBackup(file, { password, mode, mediaDir, tmpDir, exists: gameExists, save, onProgress = () => {} }) {
  const b = await loadBackup(file, { password, tmpDir });
  if (b.needsPassword) return b;
  let extractedDir = null; let finalDir = null;
  try {
    const game = b.game;
    const originalId = game.id;
    if (gameExists(originalId)) {
      if (mode !== 'separate') return { conflict: true, gameId: originalId, gameName: game.name, message: 'This game already exists on this laptop.' };
      let newId; do { newId = 'G' + crypto.randomBytes(3).toString('hex').toUpperCase(); } while (gameExists(newId));
      game.aliasIds = Array.from(new Set([...(game.aliasIds || []), originalId])); // printed QR codes still identify this card set
      game.restoredFrom = originalId;
      game.id = newId;
      game.name = game.name + ' (restored copy)';
    }
    // Extract included videos to a temp folder, verify checksums, then publish.
    if (b.mediaEntries.length) {
      if (!mediaDir) throw new Error('Choose a folder for the restored videos.');
      const folderName = `${game.name.replace(/[^\w -]/g, '').trim() || 'Game'} - ${game.id}`;
      finalDir = path.join(mediaDir, folderName);
      if (exists(finalDir)) finalDir = finalDir + '-' + Date.now();
      extractedDir = finalDir + '.partial';
      fs.mkdirSync(extractedDir, { recursive: true });
      const total = b.mediaEntries.reduce((a, e) => a + e.uncompressedSize, 0); let doneBytes = 0;
      for (const e of b.mediaEntries) {
        const m = b.manifest.media.find(x => x.archivePath === e.fileName);
        const safeBase = (m.fileName || (m.songId + m.ext)).replace(/[^\w .()&'-]/g, '_').slice(0, 120);
        const target = path.join(extractedDir, safeBase);
        if (path.dirname(target) !== extractedDir) throw new Error('Unsafe media file name.');
        const h = crypto.createHash('sha256');
        await new Promise((res, rej) => b.zip.openReadStream(e, (err, rs) => {
          if (err) return rej(err);
          const ws = fs.createWriteStream(exists(target) ? target.replace(/(\.[^.]+)$/, `-${m.songId}$1`) : target);
          rs.on('data', d => { h.update(d); doneBytes += d.length; onProgress({ phase: 'media', done: doneBytes, total, file: m.fileName }); });
          rs.on('error', rej); ws.on('error', rej); ws.on('close', res);
          rs.pipe(ws);
          m._target = ws.path;
        }));
        if (h.digest('hex') !== m.sha256) throw new Error(`Checksum mismatch for ${m.fileName} — the backup is corrupted.`);
      }
      fs.renameSync(extractedDir, finalDir);
      extractedDir = null;
      b.mediaEntries.forEach(e => { const m = b.manifest.media.find(x => x.archivePath === e.fileName); game.songs[m.songId].path = path.join(finalDir, path.basename(m._target)); });
    }
    // Machine-specific state: resume paused, never auto-play.
    if (game.playback && ['playing', 'loading', 'between'].includes(game.playback.status)) game.playback.status = 'paused';
    if (game.playback) game.playback.recovered = true;
    game.restoredAt = new Date().toISOString();
    game.audit = game.audit || [];
    game.audit.push({ at: game.restoredAt, gameId: game.id, action: 'restored-from-backup', source: 'laptop', originalId, backupCreatedAt: b.manifest.createdAt, type: b.manifest.type });
    // Final integrity check after any id change: cards must be byte-identical
    if (cardsHash(game) !== b.manifest.cardsHash) throw new Error('Card integrity check failed — nothing was restored.');
    save(game); // atomic write
    return { ok: true, gameId: game.id, originalId, name: game.name, separateCopy: game.id !== originalId, mediaRestored: b.mediaEntries.length, missing: missingMedia(game).length, cards: game.cards.length };
  } catch (e) {
    if (extractedDir) { try { fs.rmSync(extractedDir, { recursive: true, force: true }); } catch (x) { /* */ } }
    throw e;
  } finally { b.cleanup(); }
}

/* ------------------------------------------------------------------ relinking */
function missingMedia(game) { return Object.values(game.songs).filter(s => !s.path || !exists(s.path)).map(s => ({ songId: s.id, title: s.title, artist: s.artist, fileName: s.fileName || path.basename(s.path || ''), path: s.path })); }

const VIDEO_EXT = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.ogv'];
function walk(dir, out = [], depth = 0) {
  if (depth > 64) return out;
  let items = []; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  items.forEach(d => { if (d.name.startsWith('.')) return; const p = path.join(dir, d.name); if (d.isDirectory()) walk(p, out, depth + 1); else if (VIDEO_EXT.includes(path.extname(d.name).toLowerCase())) out.push(p); });
  return out;
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Propose matches for every missing video. Strong identity (fingerprint) is auto-accepted; anything weaker needs confirmation. */
function scanForMatches(game, folder) {
  const files = walk(folder);
  const info = files.map(f => { let size = 0; try { size = fs.statSync(f).size; } catch (e) { /* */ } return { path: f, name: path.basename(f).toLowerCase(), size }; });
  const fpCache = new Map();
  const fpOf = (f) => { if (!fpCache.has(f)) { try { fpCache.set(f, fingerprint(f).fp); } catch (e) { fpCache.set(f, null); } } return fpCache.get(f); };
  const used = new Set();
  const results = missingMedia(game).map(m => {
    const s = game.songs[m.songId];
    let cand = null;
    if (s.fingerprint) {
      const hit = info.find(x => !used.has(x.path) && (!s.size || x.size === s.size) && fpOf(x.path) === s.fingerprint);
      if (hit) cand = { path: hit.path, match: 'fingerprint', auto: true, detail: 'Identical video file (fingerprint match)' };
    }
    if (!cand && !s.fingerprint && s.size) {
      const hit = info.find(x => !used.has(x.path) && x.name === String(s.fileName || '').toLowerCase() && x.size === s.size);
      if (hit) cand = { path: hit.path, match: 'name-size', auto: true, detail: 'Same file name and exact size' };
    }
    if (!cand) {
      const hit = info.find(x => !used.has(x.path) && x.name === String(s.fileName || '').toLowerCase());
      if (hit) cand = { path: hit.path, match: 'filename', auto: false, detail: 'Same file name but the content differs — confirm it is the same recording' };
    }
    if (!cand) {
      const key = norm(s.title) + '|' + norm(s.artist);
      const hit = info.find(x => {
        if (used.has(x.path)) return false;
        const t = /\.(mp4|m4v|mov)$/i.test(x.path) ? readMp4Tags(x.path) : {};
        const g = parseFilename(x.path);
        return (norm(t.title || g.title) + '|' + norm(t.artist || g.artist)) === key;
      });
      if (hit) cand = { path: hit.path, match: 'title-artist', auto: false, detail: 'Same title and artist — may be a different recording; confirm before using' };
    }
    if (cand) used.add(cand.path);
    return Object.assign({}, m, { candidate: cand });
  });
  return { folder, scanned: files.length, results, autoMatched: results.filter(r => r.candidate && r.candidate.auto).length, needsConfirm: results.filter(r => r.candidate && !r.candidate.auto).length, unmatched: results.filter(r => !r.candidate).length };
}

/** Apply host-approved matches: only the file path changes — song identity, labels and cards never do. */
function applyMatches(game, matches) {
  let n = 0;
  (matches || []).forEach(m => {
    const s = game.songs[m.songId];
    if (!s || !m.path || !exists(m.path)) return;
    s.path = m.path; n++;
    game.audit = game.audit || [];
    game.audit.push({ at: new Date().toISOString(), gameId: game.id, action: 'media-relinked', songId: s.id, title: s.title, path: m.path, match: m.match || 'host-confirmed', source: 'laptop' });
  });
  return n;
}

/** Relink one song with an identity check. */
function relinkOne(game, songId, file, { confirm } = {}) {
  const s = game.songs[songId];
  if (!exists(file)) throw new Error('File not found');
  let fp = null; try { fp = fingerprint(file); } catch (e) { throw new Error('File could not be read'); }
  if (s.fingerprint && fp.fp === s.fingerprint) { applyMatches(game, [{ songId, path: file, match: 'fingerprint' }]); return { ok: true, match: 'fingerprint' }; }
  if (!confirm) return { needsConfirm: true, reason: s.fingerprint ? 'This file is not the same video that was used to make the cards. Only continue if it is the same song and recording.' : 'This game has no stored fingerprint for this song — confirm the file is the right recording.' };
  applyMatches(game, [{ songId, path: file, match: 'host-confirmed' }]);
  return { ok: true, match: 'host-confirmed' };
}

module.exports = { FORMAT, FORMAT_VERSION, estimate, createBackup, inspectBackup, restoreBackup, missingMedia, scanForMatches, applyMatches, relinkOne, cardsHash, labelsHash, safeName };
