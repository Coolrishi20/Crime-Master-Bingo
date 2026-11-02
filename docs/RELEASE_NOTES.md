## Crime Master Bingo 1.0.0

Offline Windows software for hosting music-video bingo nights.

### Download
- **CrimeMasterBingo-Setup-1.0.0.exe**: installer (recommended)
- **CrimeMasterBingo-Portable-1.0.0.exe**: runs without installing (e.g. from a USB stick)

There is nothing to install on the phone. Open **Mobile Host Connection** on the laptop and scan the QR code with the phone camera; the remote opens in Safari or Chrome.

### First run
- Windows SmartScreen may say *"Windows protected your PC"*, because the app isn't code-signed yet. Click **More info → Run anyway**.
- When asked about the firewall, allow **Private networks** so your phone can connect.

### Highlights
- 5×5 cards, two per A4 sheet. Cards lock once issued.
- Three rounds.
- Phone remote.
- Claim Freeze with multiple winners.
- TV winner and "Not a Bingo" screens.
- Continuous played-songs crawler.
- Automatic volume levelling.
- Technical credit for videos that can't play.
- Crash recovery.
- Portable `.cmbbackup` backups.

See the [Host guide](https://github.com/Coolrishi20/Crime-Master-Bingo/blob/claude/crime-master-bingo-v1/docs/USER_GUIDE.md) and the [test report](https://github.com/Coolrishi20/Crime-Master-Bingo/blob/claude/crime-master-bingo-v1/docs/TEST_REPORT.md).

ffmpeg (GPL v3) is bundled as a separate program, used only for loudness analysis. Its licence is in `resources/ffmpeg/`.
