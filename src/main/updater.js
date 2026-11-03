'use strict';
/**
 * App updates from the project's GitHub releases.
 *
 * - Installer builds: electron-updater (latest.yml + blockmaps on the release).
 *   Checks quietly, downloads in the background when no game is live, and installs
 *   only when the host chooses "Restart to update" or when the app is closed.
 * - Portable builds can't replace themselves: they only get "a new version is
 *   available" with a link to the release page.
 * - Completely optional: offline / blocked networks simply mean "no update found";
 *   nothing ever interrupts a game.
 */
const REPO = { owner: 'Coolrishi20', repo: 'Crime-Master-Bingo' };
const RELEASES_URL = `https://github.com/${REPO.owner}/${REPO.repo}/releases/latest`;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

/** Compare dotted versions: 1 if a > b, -1 if a < b, 0 if equal. "v" prefixes and pre-release tags handled. */
function compareVersions(a, b) {
  const parse = (v) => String(v || '0').trim().replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

class UpdateManager {
  /**
   * @param {object} o { currentVersion, mode: 'installer'|'portable'|'disabled', autoUpdater, fetchLatest(), isGameLive(), onChange(status), log, setTimeout, setInterval }
   */
  constructor(o) {
    this.o = o;
    this.current = o.currentVersion;
    this.mode = o.mode;
    this.enabled = true;
    this.status = { state: o.mode === 'disabled' ? 'disabled' : 'idle', current: o.currentVersion, mode: o.mode };
    this.timer = null;
    const au = o.autoUpdater;
    if (au && o.mode === 'installer') {
      au.autoDownload = false;            // we decide when to download (not during a live game)
      au.autoInstallOnAppQuit = true;     // a downloaded update installs when the app is closed
      au.allowPrerelease = false;
      if (au.logger !== undefined) au.logger = o.log || null;
      au.on('checking-for-update', () => this.set({ state: 'checking' }));
      au.on('update-not-available', () => this.set({ state: 'up-to-date', checkedAt: new Date().toISOString() }));
      au.on('update-available', (info) => {
        this.set({ state: 'available', version: info.version, notes: info.releaseNotes || null, checkedAt: new Date().toISOString() });
        if (!this.o.isGameLive || !this.o.isGameLive()) this.download();
      });
      au.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
      au.on('update-downloaded', (info) => this.set({ state: 'downloaded', version: info.version, percent: 100 }));
      au.on('error', (e) => this.set({ state: this.status.version ? 'available' : 'error', error: friendly(e) }));
    }
  }

  set(patch) {
    this.status = Object.assign({}, this.status, patch);
    if (patch.state && patch.state !== 'error') delete this.status.error;
    if (this.o.onChange) this.o.onChange(this.status);
  }

  start(enabled = true) {
    this.enabled = enabled;
    if (this.mode === 'disabled') return;
    clearInterval(this.timer); this.timer = null;
    if (!enabled) { this.set({ state: 'off' }); return; }
    if (this.status.state === 'off') this.set({ state: 'idle' });
    const st = this.o.setTimeout || setTimeout; const si = this.o.setInterval || setInterval;
    st(() => this.check(false), 20000);
    this.timer = si(() => this.check(false), CHECK_EVERY_MS);
  }

  async check(manual) {
    if (this.mode === 'disabled') return this.status;
    if (!manual && !this.enabled) return this.status;
    if (['downloading', 'downloaded', 'checking'].includes(this.status.state)) return this.status;
    try {
      if (this.mode === 'installer') {
        await this.o.autoUpdater.checkForUpdates();
      } else {
        this.set({ state: 'checking' });
        const latest = await this.o.fetchLatest();
        if (latest && compareVersions(latest.version, this.current) > 0) this.set({ state: 'portable-available', version: latest.version.replace(/^v/, ''), url: latest.url || RELEASES_URL, checkedAt: new Date().toISOString() });
        else this.set({ state: 'up-to-date', checkedAt: new Date().toISOString() });
      }
    } catch (e) {
      // Offline or GitHub unreachable: quiet unless the host asked.
      this.set({ state: manual ? 'error' : (this.status.version ? this.status.state : 'idle'), error: manual ? friendly(e) : undefined });
    }
    return this.status;
  }

  async download() {
    if (this.mode !== 'installer' || !['available', 'error'].includes(this.status.state) || !this.status.version) return this.status;
    this.set({ state: 'downloading', percent: 0 });
    try { await this.o.autoUpdater.downloadUpdate(); } catch (e) { this.set({ state: 'available', error: friendly(e) }); }
    return this.status;
  }

  /** Restart into the new version. Refused while music is playing unless forced. */
  install(force) {
    if (this.status.state !== 'downloaded') throw new Error('No update has been downloaded yet.');
    if (!force && this.o.isGamePlaying && this.o.isGamePlaying()) {
      const e = new Error('A song is playing. Pause first, or choose “Restart anyway” — the game is saved and resumes after the update.');
      e.code = 'PLAYING'; throw e;
    }
    if (this.o.beforeInstall) this.o.beforeInstall();
    this.o.autoUpdater.quitAndInstall(true, true);
    return true;
  }

  stop() { clearInterval(this.timer); }
}

function friendly(e) {
  const m = String((e && e.message) || e || '');
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::ERR|getaddrinfo|network/i.test(m)) return 'No internet connection — updates will be checked next time you are online.';
  if (/404/.test(m)) return 'No published update found.';
  return 'Could not check for updates right now.';
}

module.exports = { UpdateManager, compareVersions, RELEASES_URL, REPO };
