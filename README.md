# Crime Master Bingo

Offline Windows software for hosting **music-video bingo** nights.

The laptop plays the videos and all audio. The TV shows the video, the song title,
the round's winning pattern and a continuously scrolling list of every song played.
Your phone is a remote control over local Wi-Fi.

- **Music library & playlists**: import local music videos with no size or count
  limits, automatic checks, duplicate detection, and a minimum of 40 songs per game.
- **Bingo cards**: up to 999 unique, numbered 5×5 cards per game, printed **two per A4
  sheet** with a cut line, optional QR codes, and an ink-saving design. Cards lock once
  issued.
- **Three rounds, one card**: one line → two parallel lines → full house; diagonals
  never count.
- **TV (audience) window**: video, title/artist overlay, winning-pattern panel, a
  played-songs crawler below the video, and winner / "Not a Bingo" screens.
- **Phone remote**: QR + PIN pairing, playback, rounds, volume and mute, crawler
  controls, BINGO checks, technical credit, and automatic reconnection. The phone
  never plays media.
- **Claim Freeze**: pause, freeze the song list, check several cards against the same
  moment, and confirm multiple winners.
- **Automatic volume levelling**: EBU R128 analysis of each clip, −16 LUFS target,
  true-peak safe, adjustable fades; original files are never changed.
- **Technical credit**: count an unplayable song for all cards, with an audit trail.
- **Crash-safe saving**, **RESUME LAST GAME**, and portable **.cmbbackup** backup and
  restore (optional AES-256 password, relink assistant).

📖 [Host guide](docs/USER_GUIDE.md) · 🛠 [Build & install](docs/BUILD.md) · ✅ [Test report](docs/TEST_REPORT.md)

```bash
npm ci
npm start          # run from source
npm test           # unit/integration tests
npm run dist:win   # Windows installer + portable EXE
```
