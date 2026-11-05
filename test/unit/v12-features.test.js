'use strict';
/* v1.2 — auto-update manager + delayed title reveal setting */
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { UpdateManager, compareVersions } = require('../../src/main/updater');
const { makeEngine } = require('./helpers');

function fakeUpdater(behaviour) {
  const au = new EventEmitter();
  au.calls = [];
  au.checkForUpdates = async () => { au.calls.push('check'); au.emit('checking-for-update'); if (behaviour.offline) throw new Error('net::ERR_INTERNET_DISCONNECTED'); if (behaviour.version) au.emit('update-available', { version: behaviour.version }); else au.emit('update-not-available', {}); };
  au.downloadUpdate = async () => { au.calls.push('download'); au.emit('download-progress', { percent: 50 }); au.emit('update-downloaded', { version: behaviour.version }); };
  au.quitAndInstall = () => au.calls.push('install');
  return au;
}
const noTimers = { setTimeout: () => 0, setInterval: () => 0 };

test('version comparison', () => {
  assert.strictEqual(compareVersions('1.2.0', '1.1.0'), 1);
  assert.strictEqual(compareVersions('v1.10.0', '1.9.9'), 1);
  assert.strictEqual(compareVersions('1.1.0', 'v1.1.0'), 0);
  assert.strictEqual(compareVersions('1.1.0', '1.2.0'), -1);
  assert.strictEqual(compareVersions('1.2', '1.2.0'), 0);
});

test('installer: click-to-update — finds it, downloads only when the host clicks, installs only when asked', async () => {
  const au = fakeUpdater({ version: '1.3.0' }); const seen = [];
  const u = new UpdateManager(Object.assign({ currentVersion: '1.2.0', mode: 'installer', autoUpdater: au, isGameLive: () => false, isGamePlaying: () => false, onChange: (s) => seen.push(s.state) }, noTimers));
  assert.strictEqual(au.autoDownload, false); assert.strictEqual(au.autoInstallOnAppQuit, true);
  await u.check(false); await new Promise(r => setImmediate(r));
  assert.strictEqual(u.status.state, 'available', 'found, not downloaded by itself'); assert.ok(!au.calls.includes('download'));
  await u.download(); await new Promise(r => setImmediate(r));
  assert.ok(seen.includes('downloading'), 'progress shown');
  assert.strictEqual(u.status.state, 'downloaded'); assert.strictEqual(u.status.version, '1.3.0');
  assert.ok(!au.calls.includes('install'), 'never installs by itself');
  u.install(false);
  assert.ok(au.calls.includes('install'));
});

test('installer: no background download while a game is live; install refused while music plays', async () => {
  const au = fakeUpdater({ version: '1.3.0' }); let live = true; let playing = true;
  const u = new UpdateManager(Object.assign({ currentVersion: '1.2.0', mode: 'installer', autoUpdater: au, isGameLive: () => live, isGamePlaying: () => playing }, noTimers));
  await u.check(false);
  assert.strictEqual(u.status.state, 'available'); assert.ok(!au.calls.includes('download'));
  await u.download();
  assert.strictEqual(u.status.state, 'downloaded');
  assert.throws(() => u.install(false), /playing/);
  assert.ok(!au.calls.includes('install'));
  u.install(true);
  assert.ok(au.calls.includes('install'), 'host may force after confirming');
});

test('offline: silent on automatic checks, friendly message on manual checks', async () => {
  const au = fakeUpdater({ offline: true });
  const u = new UpdateManager(Object.assign({ currentVersion: '1.2.0', mode: 'installer', autoUpdater: au }, noTimers));
  await u.check(false);
  assert.notStrictEqual(u.status.state, 'error');
  await u.check(true);
  assert.strictEqual(u.status.state, 'error'); assert.match(u.status.error, /No internet/);
});

test('up to date', async () => {
  const u = new UpdateManager(Object.assign({ currentVersion: '1.2.0', mode: 'installer', autoUpdater: fakeUpdater({}) }, noTimers));
  await u.check(true); assert.strictEqual(u.status.state, 'up-to-date');
});

test('portable: only offers a download link', async () => {
  const u = new UpdateManager(Object.assign({ currentVersion: '1.2.0', mode: 'portable', fetchLatest: async () => ({ version: 'v1.4.0', url: 'https://github.com/x/y/releases/tag/v1.4.0' }) }, noTimers));
  await u.check(true);
  assert.strictEqual(u.status.state, 'portable-available'); assert.strictEqual(u.status.version, '1.4.0');
  await u.download(); assert.strictEqual(u.status.state, 'portable-available');
  const same = new UpdateManager(Object.assign({ currentVersion: '1.4.0', mode: 'portable', fetchLatest: async () => ({ version: 'v1.4.0' }) }, noTimers));
  await same.check(true); assert.strictEqual(same.status.state, 'up-to-date');
});

test('automatic checks can be switched off; development builds never update', async () => {
  const au = fakeUpdater({ version: '9.9.9' });
  const u = new UpdateManager(Object.assign({ currentVersion: '1.2.0', mode: 'installer', autoUpdater: au }, noTimers));
  u.start(false);
  await u.check(false); assert.ok(!au.calls.includes('check'));
  await u.check(true); assert.ok(au.calls.includes('check'), 'manual check still works');
  const d = new UpdateManager(Object.assign({ currentVersion: '1.2.0', mode: 'disabled' }, noTimers));
  await d.check(true); assert.strictEqual(d.status.state, 'disabled');
});

test('delayed title reveal is a clamped overlay setting sent to the TV only', () => {
  const { eng } = makeEngine();
  assert.strictEqual(eng.audienceState().overlay.revealDelay, 0, 'off by default');
  eng.dispatch('setOverlay', { revealDelay: 15 });
  assert.strictEqual(eng.audienceState().overlay.revealDelay, 15);
  eng.dispatch('setOverlay', { revealDelay: 500 });
  assert.strictEqual(eng.audienceState().overlay.revealDelay, 60);
  eng.dispatch('setOverlay', { revealDelay: -3 });
  assert.strictEqual(eng.audienceState().overlay.revealDelay, 0);
  eng.dispatch('setOverlay', { revealDelay: 10 });
  eng.dispatch('startRound', { round: 1 });
  assert.ok(eng.hostState().current.title, 'host still sees the title immediately');
});
