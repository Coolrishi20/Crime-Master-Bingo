# Anthem Square — Test report (v1.8.0)

## v1.8.0 (skip quiet intros, keep artists apart)
- **Unit tests: 169 / 169 passed.** `v19-intros-artists.test.js` has 7 new tests:
  - intro detection: silence, dialogue, a soft musical intro kept, under 2 s, over 45 s / 40%, a click, silent files;
  - clip start priority: your start, then the game offset, then the intro; on/off; full-song mode; analysis errors never block playback;
  - Up Next flag; artist identity (case, accents, "The", featured artists);
  - spacing: 200 shuffles never back to back and mostly ≥3 apart; a dominant artist gets the mathematical minimum of back-to-backs; new game and Reshuffle; shuffle off keeps order.
- **New e2e `v19-intros-artists.js`: 9 / 9 passed.** It uses real ffmpeg loudness analysis on videos with an 8 s silent opening:
  - detected start 7 s; normal videos untouched;
  - the Library shows the start; Up Next says "quiet intro skipped";
  - **the TV video actually started at 7.3 s**;
  - the console switch turns it off;
  - a shuffled 52-song / 12-artist game had no back-to-back artists.
- **Bug found by the e2e:** the host state didn't report the new setting, so the console toggle could show "on" after a refresh. Fixed.
- **Regression (all re-run on this build):**

  | Suite | Result |
  |---|---|
  | v18-m3u | 10/10 |
  | v17-brand | 22/22 |
  | v16-checklist | 34/34 |
  | acceptance | 85/85 |
  | v15 | 28/28 |
  | v14 | 38/38 |
  | v13 | 13/13 |
  | print | 12/12 |
  | reveal | 7/7 |


## v1.7.0 (full release: Anthem Square + M3U playlists)
- **Unit tests: 162 / 162 passed.** `v18-m3u.test.js` has 6 new tests:
  - decoding UTF-8 (with and without BOM), UTF-16 LE/BE and Windows-1252;
  - `#EXTINF` duration, "Artist - Title" and attributes containing commas;
  - path styles: relative with / and \, absolute, `file://` with percent-encoding, streams, a relocated drive letter, missing files;
  - library import: M3U order, `#EXTINF` names, the report of missing, audio and stream entries, re-import adding nothing twice, your edits kept;
  - a plain Windows-1252 Winamp-style list;
  - an export → re-import round trip with relative paths.
- **New e2e `v18-m3u.js`: 10 / 10 passed** (and on 4 consecutive runs):
  - *Import M3U…* with a 50-video VLC-style playlist: report, missing file with its line number, skipped stream, order kept;
  - the playlist becomes ready for a game and a game is created from it;
  - re-import; *Export M3U…* with relative paths;
  - Music Library *Import videos…* with an .m3u, and an .m3u dropped together with videos.
- **Fix found while testing:** opening another page during the first second after start-up was overridden by the Dashboard. Start-up now keeps the page you opened, and the Playlists page ignores a stale load.
- **Regression (all re-run on this build):**

  | Suite | Result |
  |---|---|
  | v17-brand | 22/22 |
  | v16-checklist | 34/34 |
  | acceptance | 85/85 |
  | v15 | 28/28 |
  | v14 | 38/38 |
  | v13 | 13/13 |
  | print | 12/12 |
  | reveal | 7/7 |


## v1.7.0-rc.1 (rebrand to Anthem Square, approved redesign)
- **Unit tests: 156 / 156 passed.** The game logic is unchanged; one message test was updated for the new name.
- **New e2e `v17-brand.js`: 22 / 22 passed.** It checks:
  - **Existing installs keep their data:** with no test data folder set, the app still uses `…/Crime Master Bingo/data`.
  - Old settings with theme `crime-master` open in Dark Mode.
  - The window title is Anthem Square; the sidebar icon loads; the navigation has 4 groups and 10 line icons.
  - Primary buttons are Dark Gray `#171717` text on `#FF5B32` (5.8:1), checked with computed styles.
  - None of the 10 laptop screens shows "Crime Master" text. The dashboard tagline and Settings → About (logo, version, tagline) are present.
  - The phone icon/favicon is served, and the phone pairing and player join pages are branded.
  - Settings → Theme → Light switches the laptop immediately (background `#FFF2CF`), and the phone remote follows. The choice is remembered after a restart.
  - The TV is branded, stays dark in Light Mode and shows the icon on the welcome screen.
  - The PDF says ANTHEM SQUARE, never the old name, and still fits 2 cards per A4.
- **Visual check against the approved mockups:** all 16 screens were captured from the built app in Dark and Light and compared side by side with the approved mockups. They match. Two issues were found and fixed during this check: the TV welcome icon was hidden by an old rule, and the phone wasn't receiving the theme.
- **Regression (all re-run on this build):**

  | Suite | Result |
  |---|---|
  | v16-checklist | 34/34 |
  | acceptance | 85/85 |
  | v15 | 28/28 |
  | v14 | 38/38 |
  | v13 | 13/13 |
  | print | 12/12 |
  | reveal | 7/7 |

  v14 first found a real regression: a removed player's phone crashed because of the new theme field. It was fixed and then passed on two consecutive runs.


## v1.6.0-rc.1 (Rules Checklist Mode)
- **Unit tests: 156 / 156 passed.** `test/unit/v16-checklist.test.js` has 12 new tests:
  - Round-Based Mode stays the default and is unchanged;
  - set-up: no rounds, a single Start, checklist and mode locked once started;
  - rules won in any order; a card that qualifies for several rules → the host must choose
    ONE (never auto-completes two); the same card later wins a different rule; RULE ALREADY
    COMPLETED;
  - NOT A VALID BINGO with played squares, the closest open rule and the open rules;
  - simultaneous winners: two cards win the same rule in one frozen session, and later
    sessions are refused;
  - corrections: change the awarded rule (only to a rule the card really completed), undo
    re-opens the rule, both written to the audit log;
  - all rules completed → host prompt, claims can be closed, end screen per rule;
  - the playlist running out first → outstanding rules listed;
  - TV and player phones: checklist with ticks, no round numbers or card numbers on the TV,
    "one away" based only on open rules;
  - crash recovery with a claim session still open; invalid stored checklists fall back;
  - **the spec §15 acceptance scenario:** Diagonal (from the phone) → Fast 5 → L Shape →
    One Line → Full House. Each confirmation was checked for no video reload, no reshuffle,
    no played songs lost and no round transition;
  - T Shape and Two Parallel Lines as checklist rules; v1.5 saved games open as Round-Based.
- **E2E (real app), `v16-checklist.js` 34/34:**
  - Create Game UI: mode cards, then remove / reorder / add rules and save a preset;
  - PDF legend;
  - Host Game checklist panel and Start game; TV welcome and checklist ticks;
  - laptop checker "valid for" with a forced choice;
  - simultaneous Diagonal winners; a rule chosen and confirmed on the phone remote;
  - Rules tab on the phone, and an award corrected on the phone;
  - a player phone BINGO;
  - restarting the app mid-game (everything restored);
  - the ALL BINGO RULES COMPLETED prompt, "continue music" refusing new claims, finishing,
    and the end screen at 5/5;
  - new games still Round-Based by default.
- **Regression (all re-run on this build):**

  | Suite | Result |
  |---|---|
  | acceptance | 85/85 |
  | v15 | 28/28 |
  | v14 | 38/38 |
  | v13 | 13/13 |
  | print | 12/12 |
  | reveal | 7/7 |
- **Not tested here:** real iPhone and Android phones on venue Wi-Fi. The phone tests use a
  mobile Chromium browser. The real-laptop hardware matrix from 1.5 is also still to do.


## v1.5.0-rc.1 (Phase 1 fixes and performance)
- **Unit tests: 144 / 144 passed.** The 18 new tests cover:
  - all 4 L Shape and 4 T Shape rotations (9 squares each, with near-misses rejected);
  - both diagonals, which stay invalid under the standard rules;
  - Fast 5 (any 5, and a set pattern of exactly 5);
  - custom patterns and validation of nonsense rules;
  - the standard rounds giving identical results and wording through the new API;
  - which song a custom pattern qualified on (fair simultaneous claims);
  - per-round rule sets in the engine (claims, Claim Freeze, phones, TV, locking once started);
  - rules surviving save/reload, with invalid stored rules falling back safely;
  - host-defined round counts (5 rounds, 1 round, limits, can't remove a started round);
  - **the same card winning 4 rounds** (once per round);
  - after-winner flow: the host is asked, intermission (round completed, music paused, TV
    break screen, next round ends it), the automatic-intermission setting, and the final
    round offering Finish.
- **Integrated live-hosting benchmark** (`test/perf/hosting-bench.js`): TV 1080p video +
  overlay + crawler + phone remote + host screen together, app pinned to 2 cores,
  75 songs, 3 rounds, phone claims and a Wi-Fi drop.
  - v1.4.2 **12/12**, 1.5 normal **10/10**, 1.5 Low Resource **12/12** checks passed.
  - Full numbers in `docs/PERFORMANCE.md`; raw data in `docs/perf-results/`.
- **E2E (real app):**
  - `v15-check.js` **28/28**: Show in Folder (spaces + Unicode, missing file, unplugged
    drive, invalid path, the PDF button), rules picked in the real Settings UI (4 rounds,
    L/Diagonal, Fast 5 pattern, T), the new game, PDF legend, TV, claims, locking, the "what
    next?" prompt, the intermission screen, Low Resource Mode on the laptop and TV, and
    recovery.
  - Also passed against the **packaged** build (`electron-builder --linux dir`): 28/28.
- **Regression:** acceptance **85/85** (83 original + 2 for the new prompt), printing
  **12/12**, v1.3 **13/13**, v1.4 phone cards **38/38**, delayed reveal **7/7**.
- **Windows build:** NSIS installer, portable EXE, `latest.yml` and blockmap built locally
  with version 1.5.0-rc.1.
- **Not tested (no hardware here):**
  - real 4 GB / 8 GB / 16 GB / 2 GB Windows laptops;
  - the installed Windows EXE's Show in Folder with File Explorer;
  - hardware video decoding;
  - real phones on venue Wi-Fi.

  See `docs/PERFORMANCE.md` → *Still to test on real hardware*.

---


## v1.4.2 additions
- Unit tests: **126 / 126 passed**. A new test covers the TV's one-away count: issued cards
  only, current round only, winners excluded, no card details sent to the TV, and the option
  turned off. The TV privacy test now allows the one new field, a plain number.
- `test/e2e/v14-check.js`: **38 / 38 passed**. New checks:
  - the TV lobby listing all 3 joined players;
  - the TV showing "1 PLAYER IS ONE SONG AWAY!" during the round;
  - the host's paired phone remote opening Priya's valid claim automatically, ready to confirm.

---


## v1.4.1 additions
- Unit tests: **125 / 125 passed**. The 2 new tests cover the one-away count (only played
  songs count, current round only) and winner names on the TV screen (several winners,
  option off, never on "Not a Bingo").
- `test/e2e/v14-check.js`: **35 / 35 passed**. New checks: the one-away banner, the played
  count and list on the phone, marking with UNDO from the message and from the Undo button,
  keep-awake starting on the first tap, and the TV showing "PRIYA WINS!".
- **Not yet verified on real phones:** keep-awake. The plain Wi-Fi link uses a tiny silent
  looping video because browsers only allow Wake Lock on secure pages. It works this way on
  current Android Chrome and iPhone Safari, but some battery-saver modes may still dim
  the screen.

---


## v1.4.0 additions (home play)
- Unit tests: **123 / 123 passed**. The 8 new tests cover:
  - the lowest free card being given out, never a printed one or another player's;
  - a new card added only when every card is taken, with existing cards unchanged;
  - duplicate names numbered;
  - closed joining refused;
  - an early BINGO giving no freeze and no claim;
  - a real BINGO freezing claims with the player's name, with no double claims;
  - the winner shown on the player's view;
  - the player view leaking no played list, other players or tokens;
  - removed players' cards retired.
- `test/e2e/v14-check.js` in the real app with phone browsers (Galaxy Fold cover 344 px and
  a 412 px phone): **27 / 27 passed**.
  - Card images: 3 PNGs at 1588 × 1123 with names in the file names, each QR code decoding
    to the right card, and the cards locked.
  - TV join QR.
  - Three players joining with different cards.
  - Marks kept after a reload.
  - An early BINGO answered "not yet" without stopping the music.
  - A real BINGO opening the claim session on the laptop.
  - The host confirming, and the phone showing "YOU WON ROUND 1!".
  - A removed player sent back to the join page.
  - A player phone refused host commands.
  - Closed joining refused.
- Regression: v1.1 acceptance **83 / 83**, printing **12 / 12**, v1.3 **13 / 13**.

---


## v1.3.0 additions
- Unit tests: **115 / 115 passed**. New tests cover:
  - folders → playlists, including nested folders, loose files and re-runs that add only new songs;
  - AVI, WMV, FLV and MPG files imported and queued for conversion;
  - **real conversions** of AVI (MPEG-4/MP3), WMV (WMV2/WMA) and FLV to H.264/AAC MP4, with originals byte-identical afterwards and a damaged file failing cleanly with no leftover partial files;
  - when the welcome and end screens appear;
  - the secure phone link: HTTPS page, `/connect.json`, pairing over WSS, and the standard link still working.
- `test/e2e/v13-check.js` in the real app: **13 / 13 passed**, from source and again against the **packaged** app. It covers decade folders becoming playlists, the AVI converted in the app and passing the playability check, the welcome screen countdown and message, and the end screen listing every played song with no card numbers.
- The live QR scan was tested with a phone browser on the secure link and a **fake camera playing a card's QR code**: card 007 was read and checked live.
- Regression: v1.1 acceptance **83 / 83**, delayed reveal **6 / 6**.
- The Windows build bundles the H.264 (libx264) encoder in ffmpeg. This was checked by inspecting the binary; it can't be run in this environment.
- **Not yet verified on real devices:** each phone accepting the secure link's certificate. Chrome/Android shows *Proceed*; iPhone Safari's handling of self-signed certificates for live connections varies by iOS version, so the standard link remains as a fallback. Conversion speed on your laptop is also untested; a 4-minute HD video should take roughly 1–3 minutes.

---


## v1.2.0 additions
- Unit tests: **109 / 109 passed**. The 8 new tests cover:
  - update manager: version comparison, background download with install only on request, no download during a live game, install refused while music plays unless forced, quiet offline behaviour, portable download link, automatic checks off;
  - the reveal-delay setting, which is clamped to 0–60 s and sent to the TV only.
- Delayed reveal on the real TV window (`test/e2e/reveal-check.js`): **6 / 6 passed**. Covered: the teaser and countdown appear, the host sees the title immediately, the countdown pauses with the music, the title is revealed after 4 s of play, and with the reveal off the title shows immediately.
- Update check against the real GitHub releases from inside the app: it found v1.1.0 and correctly reported 1.2.0 as up to date.
- Full v1.1 acceptance regression: **83 / 83 passed**.
- Windows build: installer, portable EXE, `latest.yml` and blockmap generated; the installed app carries `app-update.yml` pointing at the repo.
- **Not yet verified:** a real install-and-update cycle on Windows. The first one will happen when version 1.2.1 or later is published and 1.2.0 updates itself.

---


## Summary

| Suite | Result |
|---|---|
| Unit & integration (`npm test`) | **101 / 101 passed** |
| End-to-end acceptance, from source (`test/e2e/acceptance.js`) | **83 / 83 passed** |
| End-to-end acceptance, against the **packaged** app | **83 / 83 passed** |
| Printing QA (`test/e2e/print-counts.js`) | **12 / 12 passed** |
| Windows build (`electron-builder --win nsis portable`) | Installer + portable EXE 1.1.0 built |

The end-to-end test drives the real app with 50 royalty-free generated music videos:
- the real TV window with real playback;
- a phone browser (Chromium, iPhone-sized viewport) paired over the local network;
- a forced crash (SIGKILL);
- a restore onto a second, empty data folder (a "different laptop").

v1.1 added checks for explainable verification, round transitions, Up Next and the print preview's QR check.
Printing QA renders up to 999 cards and decodes printed QR codes from rasterised PDF pages.

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
PASS  Interactive print preview opens: 50 A4 pages, no overflow
PASS  Every printed QR code decodes to its own card number (v1.1 preview check)  — ✓ All 100 QR codes scanned and match their card numbers
PASS  Print preview finds a card by number
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
PASS  Correct title overlay on the TV  — Crimson Shadows
PASS  Correct artist overlay on the TV
PASS  Round 1 winning pattern shown on the TV
PASS  Phone never plays audio or video
PASS  Levelling gain applied through the single Web Audio chain  — 2.7 dB
PASS  Song completes and enters the official history
PASS  Played song appears in the crawler below the video  — Crimson Shadows
PASS  Crawler is below the video, not covering it
PASS  More songs play and are added in order
PASS  Pause from the phone pauses the laptop
PASS  Crawler keeps scrolling while the music is paused
PASS  Resume from the phone
PASS  Claims frozen from the phone
PASS  Freezing paused playback mid-song
PASS  Card 5 valid on the phone
PASS  Winning squares highlighted on the phone
PASS  Phone explains the win and names the completing song (v1.1)
PASS  First winner confirmed from the phone
PASS  TV winner screen appears (no card number by default)
PASS  Second card still valid against the same snapshot after a winner was confirmed
PASS  Multiple winners confirmed in one session
PASS  An invalid card is rejected with a reason
PASS  Invalid claim explains why, the closest pattern and the squares still needed (v1.1)
PASS  TV shows the “Not a Bingo” screen after rejection
PASS  TV never shows card numbers or claim details
PASS  Session closed; music resumes the same song
PASS  Up Next is host-only (never on the TV)
PASS  Phone skips the proposed next song; it stays eligible for later
PASS  Phone queues a chosen song to play next
PASS  Phone returns Up Next to the playlist order
PASS  TV plays the Round 1 complete transition
PASS  Round 2 ready; music waits for the host
PASS  Host starts Round 2 from the phone; music resumes
PASS  TV switches to the Two Parallel Lines pattern
PASS  Crawler keeps every previously played song  — 13 songs
PASS  Technical credit granted from the phone with confirmation
PASS  Crawler labels it “TECHNICAL CREDIT — Title / Artist”  — 14TECHNICAL CREDIT — Dancing Rhythm/The Sample Band◆
PASS  TV switches to the Full House pattern
PASS  Full House valid
PASS  Full House winner confirmed and session closed from the phone
PASS  Phone reconnects automatically after a network drop
PASS  Phone controls still work after reconnecting (mute)
PASS  Game ended from the phone
PASS  Card mappings identical after reopening
PASS  Song history identical after reopening  — 36 entries
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

83 passed, 0 failed
```

## Printing QA

```
PASS  999 unique cards generated
PASS  1 card(s) → 1 A4 page(s)  — 1 pages, 0.7 s, overflow 0
PASS  2 card(s) → 1 A4 page(s)  — 1 pages, 0.8 s, overflow 0
PASS  3 card(s) → 2 A4 page(s)  — 2 pages, 0.7 s, overflow 0
PASS  100 card(s) → 50 A4 page(s)  — 50 pages, 3.4 s, overflow 0
PASS  500 card(s) → 250 A4 page(s)  — 250 pages, 14.3 s, overflow 0
PASS  999 card(s) → 500 A4 page(s)  — 500 pages, 41.7 s, overflow 0
PASS  Every card number 001–999 printed once, in order
PASS  Accented characters and punctuation printed correctly
PASS  Winning-pattern legend on every card  — 999 legends
PASS  QR codes on printed pages decode to the right game and card  — 11/11 sampled cards
PASS  Card 457 reprinted after a restart with different visual settings has the identical 25 songs

12 passed, 0 failed
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
✓ all five rows and all five columns win Round 1
✓ every pair of parallel lines (adjacent or not) wins Round 2; mixed pairs never do
✓ best progress picks the closest qualifying pattern and the missing squares
✓ explanations match the spec wording
✓ claim view: completing song, best pattern, needed squares, explanation
✓ scanning the same winning card repeatedly never creates a second winner
✓ confirmed winner → host can complete the round; next round waits for the host
✓ rounds cannot be skipped; Round 3 completion finishes the event (no Round 4)
✓ cards that already satisfy the next round are reported to the host, never auto-awarded
✓ crash during/after a transition restores the ready round without duplicates
✓ Up Next shows metadata; previewing never plays or counts a song
✓ queue a specific song, skip the proposed next, then return to the playlist order
✓ queue refuses played or current songs; never plays a song twice
✓ deferred songs come back after the rest; excluded songs never play until included
✓ queue and skipped songs survive a restart
✓ missing next video is flagged, not hidden
```

## Phone layouts checked

Screenshots were taken at three sizes, with no clipped controls and no horizontal scrolling:
- 344 × 882 (Galaxy Fold cover screen): compact layout;
- 690 × 830 (Fold unfolded): two-column layout, keypad beside the result;
- 390 × 844 (typical phone).

## Not tested here (please check on the real kit)

- **Real Windows hardware.** The EXEs were built with Wine on Linux; the identical packaged app was tested on Linux. Still to check on a real laptop: HDMI sound, the firewall prompt, display detection, and the installer upgrading 1.0 → 1.1.
- **Real phones.** Tested in mobile Chromium. Please try a real Galaxy Fold (both screens) and an iPhone (Safari).
- **Physical printing.** PDFs were verified as A4, with the correct page counts and readable, decodable QR codes. A real print-and-cut test is recommended.
- **Non-Latin titles.** Devanagari and Japanese titles print correctly (checked visually), but PDF text extraction can't verify them automatically.
- **Large print runs.** Exporting 999 cards (500 pages) takes about a minute.
