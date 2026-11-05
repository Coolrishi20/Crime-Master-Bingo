'use strict';
/**
 * Help → Save diagnostics (2.5.3): one readable file a host can send when something goes wrong.
 * It holds the app and Windows versions, hardware, settings, library and game status, and the
 * recent errors. It never holds phone pairing secrets, player names, backup passwords or video
 * files, and the Windows user folder is replaced with "~" in every path.
 */
const os = require('os');

const MAX_LINES = 400;
const lines = [];
/** Keep the most recent warnings and errors from the app (main process and windows). */
function record(level, where, msg) {
  lines.push(`${new Date().toISOString()} ${level.toUpperCase()} [${where}] ${String(msg).slice(0, 2000)}`);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}
function captureConsole() {
  ['warn', 'error'].forEach(level => {
    const orig = console[level].bind(console);
    console[level] = (...a) => { try { record(level, 'main', a.map(x => (x && x.stack) || (typeof x === 'object' ? safeJson(x) : String(x))).join(' ')); } catch (e) { /* */ } orig(...a); };
  });
  process.on('uncaughtException', (e) => record('error', 'main', 'Uncaught: ' + ((e && e.stack) || e)));
  process.on('unhandledRejection', (e) => record('error', 'main', 'Unhandled rejection: ' + ((e && e.stack) || e)));
}
function safeJson(x) { try { return JSON.stringify(x); } catch (e) { return String(x); } }

const SECRET_KEYS = /token|secret|password|passphrase|pin$|tokenhash|^key$|privatekey/i;
/** Copy an object without secrets, player names or home-folder paths. */
function scrub(v, home, depth = 0) {
  if (depth > 8) return '[…]';
  if (typeof v === 'string') { let s = v; if (home) s = s.split(home).join('~'); return s.length > 400 ? s.slice(0, 400) + '…' : s; }
  if (Array.isArray(v)) return v.slice(0, 50).map(x => scrub(x, home, depth + 1)).concat(v.length > 50 ? [`[… ${v.length - 50} more]`] : []);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach(k => {
      if (SECRET_KEYS.test(k)) { o[k] = '[removed]'; return; }
      if (k === 'devices' && Array.isArray(v[k])) { o[k] = `[${v[k].length} paired phone(s)]`; return; }
      if (k === 'players' && Array.isArray(v[k])) { o[k] = `[${v[k].length} player(s)]`; return; }
      o[k] = scrub(v[k], home, depth + 1);
    });
    return o;
  }
  return v;
}

/** collect: () => object with the app's own status sections (built in main.js). */
function build(collect) {
  const home = os.homedir();
  const cpus = os.cpus() || [];
  const report = {
    about: 'Anthem Square diagnostics — no videos, phone secrets, passwords or player names are included.',
    createdAt: new Date().toISOString(),
    system: {
      os: `${os.type()} ${os.release()} (${process.arch})`, platform: process.platform,
      cpu: cpus[0] ? `${cpus[0].model} × ${cpus.length}` : 'unknown',
      memoryGB: Math.round(os.totalmem() / 1073741824 * 10) / 10, freeMemoryGB: Math.round(os.freemem() / 1073741824 * 10) / 10,
      uptimeMin: Math.round(process.uptime() / 60),
      versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node }
    }
  };
  let app = {};
  try { app = collect() || {}; } catch (e) { app = { error: 'Could not collect app status: ' + e.message }; }
  Object.assign(report, scrub(app, home));
  report.recentErrors = lines.map(l => (home ? l.split(home).join('~') : l));
  return report;
}

module.exports = { record, captureConsole, build, scrub, _lines: lines };
