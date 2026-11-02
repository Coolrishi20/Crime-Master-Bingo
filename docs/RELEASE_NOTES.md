## Crime Master Bingo 1.1.0

Offline Windows software for hosting music-video bingo nights.

### Download
- **CrimeMasterBingo-Setup-1.1.0.exe**: installer (recommended). It upgrades 1.0 in place. Your library, games and phone pairings are kept.
- **CrimeMasterBingo-Portable-1.1.0.exe**: runs without installing.

There's nothing to install on the phone. Scan the QR code on the laptop's **Mobile Host Connection** screen.

### New in 1.1
- **Explainable BINGO checks**
  - Every check shows the exact card, which squares have been played, and the winning line.
  - A valid claim names the song that completed it.
  - An invalid claim gives a plain-English reason, the closest pattern, and how many more songs it needs. For example: *"Not a Bingo! Card #142 has completed one line but requires two parallel lines for Round 2."*
- **Smooth round transitions**
  - After a winner is confirmed, press **Complete Round & Continue** on the laptop or phone.
  - The TV plays a round-complete animation and shows the next pattern. The music waits until you start the next round.
  - Rounds can't be skipped by accident. Round 3 ends the night with *"That's a wrap!"*.
  - You're told if any card already has the next round's pattern. Nothing is awarded automatically.
- **Up Next (host only)**
  - See the next song, its file, length, clip and readiness on the laptop and phone.
  - Skip it (it comes back later), pick any other unplayed song, queue songs, or go back to the playlist order.
  - The TV never shows what's coming.
- **Better printed cards**
  - Larger QR codes and a *Winning Patterns* legend with mini diagrams and "No diagonal lines".
  - Batch number on each card.
  - Choose *title + artist* or *title only*.
  - Smarter text fitting, with a warning (never a silent cut-off) when a title is too long.
- **New print preview**
  - Real A4 pages with page navigation and zoom.
  - Find a card by number, and a **Check QR codes** button that scans every QR code on screen.
  - Print all, print a range, reprint one card, or export a PDF. Reprints are always identical.
- **Galaxy Fold–friendly phone remote**
  - A compact layout for the cover screen.
  - A two-column layout when unfolded: controls beside Up Next, keypad beside the card.

### First run
- Windows SmartScreen may say *"Windows protected your PC"*, because the app isn't code-signed yet. Click **More info → Run anyway**.
- Allow **Private networks** at the firewall prompt so your phone can connect.

See the [Host guide](https://github.com/Coolrishi20/Crime-Master-Bingo/blob/main/docs/USER_GUIDE.md).

ffmpeg (GPL v3) is bundled as a separate program, used only for loudness analysis. Its licence is in `resources/ffmpeg/`.
