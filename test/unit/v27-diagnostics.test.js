'use strict';
/* 2.5.3 Help → Save diagnostics: useful facts in, secrets and personal details out. */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const d = require('../../src/main/diagnostics');

test('scrub removes pairing secrets, passwords and player names, and hides the home folder', () => {
  const home = os.homedir();
  const out = d.scrub({
    remote: { port: 8787, devices: [{ id: 'd1', name: "Sam's iPhone", tokenHash: 'abc' }, { id: 'd2' }] },
    backup: { password: 'hunter2' }, licence: { token: 'x.y' }, pin: '123456',
    players: [{ name: 'Priya' }, { name: 'Rahul' }],
    dataDir: home + '/AppData/Roaming/Anthem Square/data',
    nested: { list: Array.from({ length: 60 }, (_, i) => i) }
  }, home);
  assert.strictEqual(out.remote.devices, '[2 paired phone(s)]');
  assert.strictEqual(out.backup.password, '[removed]'); assert.strictEqual(out.licence.token, '[removed]'); assert.strictEqual(out.pin, '[removed]');
  assert.strictEqual(out.players, '[2 player(s)]');
  assert.ok(out.dataDir.startsWith('~/') && !out.dataDir.includes(home));
  assert.strictEqual(out.nested.list.length, 51, 'long lists are trimmed');
  assert.strictEqual(out.remote.port, 8787, 'useful facts are kept');
});

test('build: system facts, app status and recent errors in one report', () => {
  d.record('error', 'tv', 'Video failed: ' + os.homedir() + '/Videos/song.mp4');
  const rep = d.build(() => ({ app: { version: '9.9.9' }, settings: { remote: { devices: [{ tokenHash: 'zzz' }] } } }));
  assert.ok(rep.system.os && rep.system.memoryGB > 0 && rep.system.versions.node);
  assert.strictEqual(rep.app.version, '9.9.9');
  assert.strictEqual(rep.settings.remote.devices, '[1 paired phone(s)]');
  const last = rep.recentErrors[rep.recentErrors.length - 1];
  assert.ok(/\[tv\] Video failed: ~\/Videos\/song\.mp4/.test(last), last);
  assert.ok(!JSON.stringify(rep).includes('zzz'));
  const broken = d.build(() => { throw new Error('boom'); });
  assert.match(broken.error, /boom/, 'a failing section never stops the report');
});
