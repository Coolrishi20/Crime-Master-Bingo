# Building, testing and installing Crime Master Bingo

## Requirements
- Node.js 22+ and npm
- Windows 10/11 (to build the installer natively), **or** Linux with Wine (32- and 64-bit)
- For tests: `ffmpeg` on PATH (makes the sample videos), `poppler-utils` (`pdfinfo`, `pdftotext`), and on Linux `xvfb`

## Run from source
```bash
npm ci
npm start
```

## Build the Windows installer and portable EXE
```bash
npm run dist:win
```
This downloads a static ffmpeg build into `vendor/ffmpeg/win32-x64/`; it's used only
for loudness analysis and ships as a separate program with its GPL licence. It then
produces:
- `dist/CrimeMasterBingo-Setup-<version>.exe`: installer (choose folder, desktop shortcut)
- `dist/CrimeMasterBingo-Portable-<version>.exe`: single EXE, no install

Builds include `latest.yml` and a `.blockmap`. Uploaded to the GitHub release next to
the installer, they let installed copies update themselves (electron-updater, GitHub
provider, public repo, no token needed).

The EXEs are not code-signed. To sign them, set `CSC_LINK` / `CSC_KEY_PASSWORD`
(see electron-builder docs) before building.

### Automatic builds on GitHub
`.github/workflows/build-windows.yml` runs the unit tests, then builds both EXEs on a
real Windows machine. **Every push to `main` publishes a release automatically** for the version in
`package.json` (e.g. `v1.1.0`), once per version. Bump the version to release again. It
can also be run by hand from the **Actions** tab (*Build Windows app → Run workflow*).

## Tests
```bash
npm test          # 109 unit/integration tests (rules, cards, engine, claim sessions,
                  # credit & locking, loudness, backup/restore, crawler, storage, remote)
npm run test:e2e  # makes 50 royalty-free sample videos, then runs the full acceptance
                  # scenario in the real app + a phone browser (83 checks)
xvfb-run -a node test/e2e/print-counts.js sample-videos   # printing QA (1/2/3/100/500/999 cards, QR decoding, reprints)
xvfb-run -a node test/e2e/reveal-check.js sample-videos   # delayed title reveal on the real TV window
```
To run the acceptance test against a packaged build, set `CMB_APP_EXE` to the built
executable.

## Where data lives
`%APPDATA%\Crime Master Bingo\data\`:
- `games\*.json`: one file per game (atomic writes + `.bak`)
- `library.json`
- `playlists.json`
- `settings.json` (includes phone pairings)
- `analysis\`: loudness cache, keyed by file fingerprint
- `thumbs\`
- `exports\`

To move everything, copy that folder. To move one game, use **Backup & Restore**.

## Project layout
```
src/core/        pure game logic (rules, cards, engine, locking) — no Electron
src/main/        Electron main process: windows, storage, library, printing, phone server,
                 loudness analysis (worker thread + ffmpeg), backup/restore
src/renderer/    host UI, audience (TV) window, print layout, shared theme/crawler/patterns
src/remote-web/  phone remote (served by the laptop over local Wi-Fi)
test/unit, test/e2e, tools/
```
