## Crime Master Bingo 1.2.0

Offline Windows software for hosting music-video bingo nights.

### Download
- **CrimeMasterBingo-Setup-1.2.0.exe**: installer (recommended). It installs over 1.0 or 1.1 and keeps your library, games and phone pairings.
- **CrimeMasterBingo-Portable-1.2.0.exe**: runs without installing.

### New in 1.2
- **Automatic updates**
  - The installed app now checks for new versions by itself.
  - It downloads them in the background, but never while a game is live.
  - When an update is ready it shows **⟳ Restart to update**. It never restarts on its own; if you just close the app, the update installs then.
  - Your game is saved and resumes after the update.
  - Turn automatic checks off, or use **Check now**, in **Settings → App updates**. Without internet nothing happens; the app keeps working fully offline.
  - The portable version can't update itself, so it shows a **download** link instead.
  - **One-time step:** if you have 1.0 or 1.1, install this version manually once. From 1.2 onwards updates arrive automatically.
- **Delayed title reveal (optional)**
  - In **Settings → Song overlay → Reveal song title after**, choose 5, 10, 15, 20 or 30 seconds (default: immediately).
  - The TV shows **♪ Guess the song…** with a countdown, then reveals the title and artist.
  - The countdown pauses when the music pauses. Your laptop and phone always show the title straight away.
  - It can also be changed live during a game (Host Game → TV crawler tab), or per game in Create Game step 4.

### First run
- Windows SmartScreen may say *"Windows protected your PC"*, because the app isn't code-signed yet. Click **More info → Run anyway**.
- Allow **Private networks** at the firewall prompt so your phone can connect.

See the [Host guide](https://github.com/Coolrishi20/Crime-Master-Bingo/blob/main/docs/USER_GUIDE.md).

ffmpeg (GPL v3) is bundled as a separate program, used only for loudness analysis. Its licence is in `resources/ffmpeg/`.
