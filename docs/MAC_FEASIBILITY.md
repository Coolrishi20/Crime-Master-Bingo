# Anthem Square on macOS — feasibility (Phase 5, assessment only)

**Status: not built, not supported.** No Mac support is claimed until a working macOS build has
been produced and tested on real Macs.

## What already works across platforms
- Electron, Node.js and every web page (host, TV, phone remote, print layout).
- The game engine, cards, rules, Claim Freeze, backups, the usage report and the licence
  framework are plain JavaScript.
- Volume analysis and the media check call `ffmpeg`. They already work on Linux, where the
  test suite runs.

## Windows-only parts that need Mac equivalents
| Area | Today | Mac work |
|---|---|---|
| Bundled ffmpeg | `tools/fetch-ffmpeg.js` downloads win32-x64 only | Universal (Apple silicon + Intel) ffmpeg builds, signed and notarised with the app |
| Portable self-update | A `cmd.exe` helper swaps the EXE | Not needed: use a signed DMG/ZIP and electron-updater's Mac flow, with the signed-manifest check |
| Installer | NSIS + portable EXE | DMG (and ZIP for updates); `electron-builder --mac` |
| Code signing | Ed25519 release manifest; no Windows certificate yet | Apple Developer ID certificate plus notarisation (required, or Gatekeeper blocks the app) |
| Phone remote | Windows firewall prompt | macOS **Local Network** permission prompt; it needs a usage description in Info.plist |
| TV window | Full screen on the second display; Quiz mode hides/shows the window | macOS full-screen Spaces behave differently: use a borderless window sized to the display instead of native full screen, so hide/show does not switch Spaces |
| Paths | Windows drive letters in relink hints and M3U | Already handles `/` paths; check `/Volumes/<USB>` hints |

## Effort and prerequisites
- Roughly **2–3 weeks** of work, plus testing on at least one Apple-silicon Mac and one Intel Mac,
  each with an external TV.
- Needs an **Apple Developer account** (annual fee) in the owner's name, and a decision on
  distribution (direct download vs the Mac App Store; the App Store sandbox would restrict file
  access and the local web server, so direct download is recommended).
- The CI workflow needs a `macos-latest` job with the signing certificate and notarisation
  credentials stored as GitHub secrets.

## Recommendation
Treat the Mac version as a separate release after the Windows commercial launch, once there is
demand and a Mac to test on.
