'use strict';
/* Click-to-update for the PORTABLE build: available → download with progress → restart swaps the
 * EXE; a folder that can't be written falls back to the download link; a failed download can be
 * retried; an update downloaded but not installed is applied when the app closes. */
const test = require('node:test');
const assert = require('node:assert');
const { UpdateManager } = require('../../src/main/updater');
const noTimers = { setTimeout: () => 0, setInterval: () => 0 };
const latest = { version: 'v2.1.0', url: 'https://github.com/x/y/releases/tag/v2.1.0', assets: [{ name: 'AnthemSquare-Setup-2.1.0.exe', url: 'https://x/setup.exe', size: 9 }, { name: 'AnthemSquare-Portable-2.1.0.exe', url: 'https://x/portable.exe', size: 104000000, digest: 'sha256:ab' }] };

function make(over = {}) {
  const calls = { installs: [], downloads: 0 }; const states = [];
  const u = new UpdateManager(Object.assign({
    currentVersion: '2.0.0', mode: 'portable', fetchLatest: async () => latest, canSelfUpdate: () => true,
    downloadPortable: async (asset, progress) => { calls.downloads++; calls.asset = asset; progress(10); progress(55); progress(99); return '/apps/.anthem-square-update.exe'; },
    installPortable: (file, relaunch) => calls.installs.push({ file, relaunch }),
    isGamePlaying: () => false, onChange: (s) => states.push(s.state + (s.percent != null ? ':' + s.percent : ''))
  }, noTimers, over));
  return { u, calls, states };
}

test('portable: Update → progress → downloaded → Restart now swaps and relaunches', async () => {
  const { u, calls, states } = make();
  await u.check(true);
  assert.strictEqual(u.status.state, 'available'); assert.strictEqual(u.status.version, '2.1.0'); assert.strictEqual(u.status.size, 104000000);
  assert.strictEqual(calls.downloads, 0, 'nothing downloads until the host clicks Update');
  await u.download();
  assert.strictEqual(calls.asset.name, 'AnthemSquare-Portable-2.1.0.exe', 'the portable EXE is chosen, not the installer');
  assert.ok(states.includes('downloading:55'), 'progress reported'); assert.strictEqual(u.status.state, 'downloaded');
  u.install(false);
  assert.deepStrictEqual(calls.installs, [{ file: '/apps/.anthem-square-update.exe', relaunch: true }]);
});

test('portable: install refused while a song plays unless forced; Later → applied when the app closes', async () => {
  const { u, calls } = make({ isGamePlaying: () => true });
  await u.check(true); await u.download();
  assert.throws(() => u.install(false), /playing/);
  u.onQuit();
  assert.deepStrictEqual(calls.installs, [{ file: '/apps/.anthem-square-update.exe', relaunch: false }], 'swapped in after closing, no relaunch');
});

test('portable: folder not writable → download link instead; failed download → can retry', async () => {
  const ro = make({ canSelfUpdate: () => false });
  await ro.u.check(true); assert.strictEqual(ro.u.status.state, 'portable-available');
  let fail = true;
  const f = make({ downloadPortable: async () => { if (fail) { fail = false; throw new Error('The download was interrupted. Try again when the connection is stable.'); } return '/apps/x.exe'; } });
  await f.u.check(true); await f.u.download();
  assert.strictEqual(f.u.status.state, 'available'); assert.match(f.u.status.error, /interrupted/);
  await f.u.download(); assert.strictEqual(f.u.status.state, 'downloaded');
  const same = make({ currentVersion: '2.1.0' }); await same.u.check(true); assert.strictEqual(same.u.status.state, 'up-to-date');
  same.u.onQuit(); assert.strictEqual(same.calls.installs.length, 0, 'nothing to apply');
});
