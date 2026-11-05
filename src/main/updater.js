'use strict';
/**
 * App updates from the project's GitHub releases.
 *
 * Click-to-update (same flow for both builds): the app checks quietly; when a new version
 * exists the host clicks "Update", sees the download progress, then chooses "Restart now"
 * (or later — an installer update then installs when the app is closed).
 * - Installer builds: electron-updater (latest.yml + blockmaps on the release).
 * - Portable builds: the new portable EXE is downloaded next to the current one, checked
 *   (size + SHA-256 from GitHub), and swapped in by a tiny helper after the app closes, keeping
 *   the same file name so shortcuts still work. If that folder can't be written, the host gets
 *   the download link instead.
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
  // same x.y.z: a pre-release (1.5.0-rc.1) is older than the release (1.5.0), as in semver
  const pre = (v) => { const m = /-(.+)$/.exec(String(v || '').trim()); return m ? m[1] : null; };
  const pa = pre(a), pb = pre(b);
  if (pa && !pb) return -1;
  if (!pa && pb) return 1;
  if (pa && pb && pa !== pb) return pa.localeCompare(pb, undefined, { numeric: true }) > 0 ? 1 : -1;
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
      au.autoInstallOnAppQuit = false;    // 2.4: only after the signed-release check has passed
      au.allowPrerelease = false;
      if (au.logger !== undefined) au.logger = o.log || null;
      au.on('checking-for-update', () => this.set({ state: 'checking' }));
      au.on('update-not-available', () => this.set({ state: 'up-to-date', checkedAt: new Date().toISOString() }));
      au.on('update-available', (info) => {
        this.set({ state: 'available', version: info.version, checkedAt: new Date().toISOString() }); // downloads only when the host clicks Update
      });
      au.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
      au.on('update-downloaded', async (info) => {
        this.set({ state: 'verifying', version: info.version, percent: 100 });
        try { if (o.verifyInstaller) await o.verifyInstaller(info); au.autoInstallOnAppQuit = true; this.set({ state: 'downloaded', version: info.version, percent: 100 }); }
        catch (e) { au.autoInstallOnAppQuit = false; this.set({ state: 'blocked', version: info.version, url: RELEASES_URL, error: e.message }); }
      });
      au.on('error', (e) => this.set({ state: this.status.version ? 'available' : 'error', error: friendly(e) }));
    }
  }

  set(patch) {
    this.status = Object.assign({}, this.status, patch);
    if (patch.state && patch.state !== 'error' && !('error' in patch)) delete this.status.error; // keep a message that comes with this change
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
        const asset = latest && (latest.assets || []).find(a => /Portable.*\.exe$/i.test(a.name));
        const signed = !this.o.requireSigned || (latest && (latest.assets || []).some(a => a.name === 'release-signature.json') && (latest.assets || []).some(a => a.name === 'release-signature.sig'));
        if (latest && compareVersions(latest.version, this.current) > 0 && asset && signed && this.o.canSelfUpdate && this.o.canSelfUpdate()) { this.latest = Object.assign({}, latest, { asset }); this.set({ state: 'available', version: latest.version.replace(/^v/, ''), url: latest.url || RELEASES_URL, size: asset.size, checkedAt: new Date().toISOString() }); }
        else if (latest && compareVersions(latest.version, this.current) > 0) this.set({ state: 'portable-available', version: latest.version.replace(/^v/, ''), url: latest.url || RELEASES_URL, unsigned: !signed, checkedAt: new Date().toISOString() });
        else this.set({ state: 'up-to-date', checkedAt: new Date().toISOString() });
      }
    } catch (e) {
      // Offline or GitHub unreachable: quiet unless the host asked.
      this.set({ state: manual ? 'error' : (this.status.version ? this.status.state : 'idle'), error: manual ? friendly(e) : undefined });
    }
    return this.status;
  }

  async download() {
    if (!['available', 'error'].includes(this.status.state) || !this.status.version) return this.status;
    if (this.o.isGameLive && this.o.isGameLive()) { this.set({ state: 'available', error: 'Finish or close the game first — updates are installed between games, never during one.' }); return this.status; }
    this.set({ state: 'downloading', percent: 0 });
    if (this.mode === 'portable') {
      try {
        const file = await this.o.downloadPortable(this.latest.asset, (pct) => { if (pct !== this.status.percent) this.set({ state: 'downloading', percent: pct }); }, this.latest);
        this.set({ state: 'downloaded', percent: 100, file });
      } catch (e) { this.set({ state: 'available', error: e.message || friendly(e) }); }
      return this.status;
    }
    // installer: progress arrives through electron-updater's events
    this.o.autoUpdater.downloadUpdate().catch(e => this.set({ state: 'available', error: friendly(e) }));
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
    if (this.mode === 'portable') { const file = this.status.file; this.set({ state: 'installing' }); this.o.installPortable(file, true); return true; }
    this.o.autoUpdater.quitAndInstall(true, true);
    return true;
  }
  /** Portable: a downloaded update that wasn't installed is still swapped in when the app closes. */
  onQuit() { if (this.mode === 'portable' && this.status.state === 'downloaded' && this.status.file && this.o.installPortable) { try { this.o.installPortable(this.status.file, false); } catch (e) { /* next time */ } } }

  stop() { clearInterval(this.timer); }
}

function friendly(e) {
  const m = String((e && e.message) || e || '');
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::ERR|getaddrinfo|network/i.test(m)) return 'No internet connection — updates will be checked next time you are online.';
  if (/404/.test(m)) return 'No published update found.';
  return 'Could not check for updates right now.';
}

module.exports = { UpdateManager, compareVersions, RELEASES_URL, REPO };
