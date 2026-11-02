# Crime Master Bingo — Test report

Generated on 2026-11-02 from the `claude/crime-master-bingo-v1` branch.

## Summary

| Suite | Result |
|---|---|
| Unit & integration (`npm test`) | **85 / 85 passed** |
| End-to-end acceptance, from source (`npm run test:e2e`) | **71 / 71 passed** |
| End-to-end acceptance, against the **packaged** app build | **71 / 71 passed** |
| Windows build (`electron-builder --win nsis portable`) | Installer + portable EXE built (≈103 MB each) |

The end-to-end test drives the real Electron app with 50 royalty-free generated music videos,
the real TV (audience) window with real video playback, and a phone browser (Chromium, iPhone
viewport) paired over the local network. It follows the 40-step acceptance scenario from the
specification plus the four feature upgrades, including a forced crash (SIGKILL) and a restore
onto a second, empty data folder ("different laptop").

## End-to-end acceptance checks

```
PASS  Import ≥40 music videos  — 50 imported
PASS  All videos probed playable (duration + video track)
PASS  Background loudness analysis completed (Upgrade 3)  — 50/50, e.g. -18.9 LUFS
PASS  39 songs rejected with exact shortfall  — needs 1
PASS  Game creation blocked below 40 songs
PASS  Duplicate song refused in a playlist
PASS  Playlist of 40+ accepted  — 50 songs
PASS  Generate 100 unique cards
PASS  Cards valid and in DRAFT state
PASS  Print preview does NOT lock cards
PASS  Final export requires the LOCK confirmation
PASS  PDF has 50 A4 sheets for 100 cards
PASS  Pages are A4 portrait
PASS  Each sheet has two complete cards and a cut line
PASS  No clipped / overflowing card text
PASS  Cards LOCKED / ISSUED after export (Upgrade 7)
PASS  Locked cards cannot be regenerated
PASS  Extra cards use unused numbers 101–104
PASS  Remote service running with a pairing PIN
PASS  Wrong PIN refused
PASS  Phone paired via QR link + PIN
PASS  Round 1 started from the phone; laptop is playing
PASS  TV is playing the music video
PASS  Correct title overlay on the TV  — Neon Heart
PASS  Correct artist overlay on the TV
PASS  Round 1 winning pattern shown on the TV
PASS  Phone never plays audio or video
PASS  Levelling gain applied through the single Web Audio chain  — 3 dB
PASS  Song completes and enters the official history
PASS  Played song appears in the crawler below the video  — Neon Heart
PASS  Crawler is below the video, not covering it
PASS  More songs play and are added in order
PASS  Pause from the phone pauses the laptop
PASS  Crawler keeps scrolling while the music is paused
PASS  Resume from the phone
PASS  Claims frozen from the phone
PASS  Freezing paused playback mid-song
PASS  Card 5 valid on the phone
PASS  Winning squares highlighted on the phone
PASS  First winner confirmed from the phone
PASS  TV winner screen appears (no card number by default)
PASS  Second card still valid against the same snapshot after a winner was confirmed
PASS  Multiple winners confirmed in one session
PASS  An invalid card is rejected with a reason
PASS  TV shows the “Not a Bingo” screen after rejection
PASS  TV never shows card numbers or claim details
PASS  Session closed; music resumes the same song
PASS  TV switches to the Two Parallel Lines pattern
PASS  Crawler keeps every previously played song  — 12 songs
PASS  Technical credit granted from the phone with confirmation
PASS  Crawler labels it “TECHNICAL CREDIT — Title / Artist”  — 13TECHNICAL CREDIT — Summer Echoes/DJ Placeholder◆
PASS  TV switches to the Full House pattern
PASS  Full House valid
PASS  Full House winner confirmed and session closed from the phone
PASS  Phone reconnects automatically after a network drop
PASS  Phone controls still work after reconnecting (mute)
PASS  Game ended from the phone
PASS  Card mappings identical after reopening
PASS  Song history identical after reopening  — 31 entries
PASS  Winners, progress and lock preserved
PASS  Unexpected shutdown detected → RESUME LAST GAME offered
PASS  Frozen claim session restored after the crash, playback paused
PASS  History and current song restored after the crash
PASS  Encrypted full portable backup created  — 69.9 MB
PASS  Encrypted backup asks for its password
PASS  Backup integrity verified before restoring  — Archive structure, Backup format, Format version, Schema version, Game data checksum, Game identity, Song pool, Card mappings, Card checksum, Printed labels, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Media manifest, Videos included
PASS  Restored on a second laptop with all videos
PASS  Restored game prints exactly the same 100 bingo cards
PASS  Claims verify on the restored game (Full House card, already a winner)
PASS  QR from another game rejected on the restored game
PASS  Restored laptop does not trust the old phone (fresh pairing needed)

71 passed, 0 failed
```

## Unit & integration tests

```
✓ real files: loud, quiet, sample rates, channel layouts, peaks, no audio, corrupted
✓ compact backup round-trips cards, ledger, credits, frozen session, winners and lock exactly
✓ full portable backup includes and verifies videos; restore relocates them
✓ encrypted backup needs the right password
✓ existing game is never overwritten; separate copy keeps cards and accepts the original QR
✓ corrupted, truncated and tampered archives are rejected without touching the database
✓ newer-format archives are refused with a clear message
✓ interrupted backup leaves no complete-looking file
✓ relink assistant: fingerprint matches auto-accepted, weaker matches need confirmation
✓ 999 cards and 120 songs back up and restore exactly
✓ rejects fewer than 40 songs, with exact shortfall
✓ accepts 40, 75 and 100 songs
✓ 999 cards: 25 unique songs each, unique layouts, numbered 1..999
✓ fair distribution: song usage spread is tight
✓ additional batch continues numbering and never alters existing cards
✓ cannot exceed 999 numbers
✓ QR payload round-trips and rejects junk
✓ parseRange
✓ formatCardNo
✓ freeze pauses playback, snapshots the ledger and records position
✓ freezing twice (desktop + phone) never creates conflicting sessions
✓ one valid claim
✓ multiple valid claims checked against the same frozen snapshot, all confirmable
✓ songs completing after the freeze cannot make an invalid claim valid
✓ valid and invalid claims together; checking order does not matter
✓ duplicate card entry in a session returns the same claim, no duplicate
✓ remove an accidentally entered claim (kept in audit)
✓ a card already confirmed this round is flagged on a later claim
✓ closing with undecided valid claims is refused unless explicitly dismissed
✓ closing a session resumes playback mid-song at the same position
✓ auto-advance never fires while a session is open
✓ session survives restart with snapshot, claims and results intact
✓ round cannot change while a session is open
✓ unknown card and wrong-game QR rejected
✓ QR from this game is accepted
✓ Round 2 and Round 3 claims use the right rule
✓ TV winner / wrong-claim screens: no card number by default, never any card songs
✓ new games are DRAFT; locking fixes labels, ids and marks issued cards
✓ locked game refuses label changes but allows clip changes
✓ extra cards on a locked game reuse the same snapshot and leave issued cards untouched
✓ migration: older saved games with printed cards become locked; ledger gets kinds
✓ technical credit requires explicit confirmation
✓ technical credit counts for bingo, is labelled, audited and kept separate from played
✓ credit for the current song moves on to the next video without a replacement
✓ technical credit during a frozen session does not change that session
✓ reversing a credit that a confirmed win relied on needs explicit correction and is audited
✓ credits survive restart
✓ cannot play before Round 1
✓ starting Round 1 starts the first song; completion adds it to the ledger once
✓ replay never duplicates a history entry
✓ skip requires confirmation and is not counted; mark-played is
✓ stale expectIndex prevents a double skip from two devices
✓ pause keeps position; history survives round changes
✓ crash recovery restores paused at saved position with identical ledger
✓ audience state never exposes cards, claims or upcoming songs
✓ player error is skipped, not counted and not auto-credited
✓ loads carry levelling gain + fades to the single player
✓ end game, then reopen
✓ 1 kHz stereo sine at -20 dBFS ≈ -20 LUFS (BS.1770 reference behaviour)
✓ true peak of a sine matches its amplitude
✓ quiet source is boosted but never more than max boost
✓ loud source is turned down to target
✓ boost is limited so the true peak never exceeds -1 dBTP (no clipping)
✓ clip-specific loudness: a quiet intro and loud chorus give different gains
✓ silence is not amplified
✓ missing analysis → neutral gain
✓ Round 1: horizontal line valid
✓ Round 1: vertical line valid
✓ Round 1: diagonal invalid with explanation
✓ Round 1: anti-diagonal invalid
✓ Round 1: 4 of 5 is not a line
✓ Round 2: two horizontal rows valid
✓ Round 2: two vertical columns valid
✓ Round 2: row + column invalid
✓ Round 2: row + column + another row valid (qualifying pair exists)
✓ Round 2: one line only invalid
✓ Round 2: two diagonals invalid
✓ Round 3: full house valid
✓ Round 3: 24 of 25 invalid
✓ Played songs not on the card are ignored
✓ qualifiedAt finds the earliest song that completed the pattern
✓ card must have 25 squares
✓ crawler queue loops the FULL history in order and extends without reset
✓ store: atomic writes with .bak recovery from a corrupted file
✓ remote: PIN pairing, token auth, revocation, duplicate-command protection and ordering
```

## What was not tested here

- **Real Windows hardware.** The Windows EXEs were built on Linux (with Wine) and the identical packaged
  app was tested on Linux. Windows-only items still need a check on a real laptop: HDMI audio output,
  the Windows Firewall prompt, display detection with a real TV, and the installer itself.
- **Real phones.** The phone remote was tested in mobile Chromium. Please try it once on an iPhone (Safari)
  and an Android phone on your venue Wi-Fi.
- **Physical printing.** PDFs were verified as A4 with two cards per sheet, 50 sheets for 100 cards and no text
  overflow. A real print-and-cut test is still recommended.
- **Live QR scanning on phones** needs HTTPS, so over the local http:// connection the phone takes a
  photo of the QR code instead (works on iOS and Android); typing the number always works.
- The EXEs are **not code-signed**, so Windows SmartScreen will warn on first run.
