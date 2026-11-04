## Anthem Square 1.7.0 (release candidate 1) — the new name and look

**Crime Master Bingo is now Anthem Square.** *Music video bingo. Hear it. Mark it. Own it.*
This is a release candidate, published as a GitHub pre-release. Game rules, cards, printing,
the phone remote, the TV and saved games all work as before.

### Your data comes with you
Install it over your existing copy. The library, playlists, saved games, settings, backups,
phone pairings and printed cards (including their QR codes) all carry over, because the app
keeps reading the same data folder. The installer upgrades the old install in place.

### New look (approved design)
- **New logo and icon:** the approved 3×3 Bingo-square icon on the window, taskbar,
  installer, desktop shortcut, phone browser tab, TV screens and printed cards. Tiny sizes
  use a simplified version without the music note.
- **Dark Mode by default, plus a full Light Mode** (*Settings → Appearance → Theme*). The
  phone remote and player phones follow the laptop. The TV always stays dark.
- **Option D colours:** Dark Blue, Light Cream, Vivid Orange Red and Dark Gray, balanced
  60–30–10. Orange now means "act here": one main button per area.
- **Easier to read:** Montserrat ExtraBold headings and song titles in normal capitalisation.
  Every button and label meets WCAG AA contrast, orange buttons use dark text, and
  valid / not valid / completed always show a word and ✓ / ✕, never colour alone.
- **Host console:** Check Bingo is the one cream "feature" panel, so it's the first thing you
  see. The navigation is grouped into Overview / Prepare / Play / Manage, with matching line
  icons.
- **TV:** flat, opaque panels with no blur or glow over the video (lighter on low-end
  laptops), a cleaner title overlay and checklist, and the new logo on the welcome, idle and
  end screens.
- **Printed cards:** a low-ink outline logo and the Anthem Square wordmark. The grid, text
  sizes, card numbers, cut line and QR codes are unchanged.
- **Settings → About** shows the logo, the version and the tagline.
- Brand files (SVG, PNG 16–1024, Windows .ico) and guidelines are in `assets/brand/` and
  `docs/BRAND.md`.

## Crime Master Bingo 1.6.0 (release candidate 1) — Rules Checklist Mode

**This is a release candidate**, published as a GitHub pre-release. It includes everything
from 1.5.0-rc.1. The real-hardware checks listed in *docs/PERFORMANCE.md* are still
outstanding.

### New: Rules Checklist Bingo (a second game mode)
- When creating a game, choose **Round-Based Bingo** (unchanged) or **Rules Checklist Bingo**.
- In the checklist mode there are no rounds. The host picks the winning rules (Fast 5, One
  Line, Two Lines, Diagonal, L Shape, T Shape, Full House and custom patterns), orders them,
  and can save them as presets. Every rule is open from the start and can be won in any
  order.
- Claims are checked by the same rule engine as before, against every open rule. When a card
  qualifies for several rules, the host chooses which one to award, so one claim completes
  one rule. Other results: **RULE ALREADY COMPLETED** and **NOT A VALID BINGO** (with the
  squares still needed and the open rules).
- Claim Freeze: several cards in one frozen session can win the same rule. Later sessions
  can't. The same card can't be entered twice in a session.
- Host Game, the phone remote, player phones and the TV all show the checklist. The TV gets a
  compact checklist with mini patterns, ticks and a short highlight (an outline only in Low
  Resource Mode). No round numbers are shown. Confirming a win never reloads the video,
  reshuffles or changes rounds.
- **Correct an award** (change the rule or undo the award) asks for confirmation and is kept
  in an audit log.
- All rules won → Finish game / View winners / Continue music without more claims. If the
  playlist ends first, the rules that weren't won are listed.
- Printed cards are unchanged. The legend lists the rules as “WINNING RULES · ANY ORDER”.
- The mode and checklist progress are saved and restored after a crash. Older saved games
  open as Round-Based games.

## Crime Master Bingo 1.5.0 (release candidate 1) — Faster on low-end laptops, custom rounds & patterns

**This is a release candidate.** It's published as a GitHub *pre-release*, so installed copies
won't update to it automatically. Download it manually to test, ideally on a 4 GB laptop.
See *docs/PERFORMANCE.md* for the measurements and for what still has to be checked on real
Windows hardware.

### Smoother video and less memory (from tester feedback)
Every fix below is based on measurements of v1.4.2 under an integrated test: TV video,
overlay, crawler, the phone remote and the host screen all running together on two CPU cores.
- **Much less memory.** New videos used to be checked in the host window, which kept about
  7 MB per video (146 → 880 MB after 100 videos). They're now checked in a small separate
  window that closes afterwards and gives the memory back.
- **Phone commands no longer disturb the TV.** Each phone tap used to re-send full state
  to every window. Updates are now combined, and each screen only receives what changed. A
  volume or crawler tap no longer reaches the TV at all.
- **Replay seeks instead of reloading the video.**
- **Far fewer disk writes while playing.** The whole game file was rewritten (with a forced
  disk flush) every couple of seconds just to save the playback position. The position now
  goes to a tiny side file. Real changes are still saved immediately and safely.
- **Background work gives way to the TV:** loudness analysis only works on the songs coming
  up next, and video conversion waits while a song plays.
- **No more freezes when importing from slow or USB drives** (up to 13 s measured before).
- The host screen no longer rebuilds its 100-song lists on every update. The library shows
  large collections in pages. Spell-check dictionaries are no longer loaded.

### ⚡ Low Resource Mode (Settings → Performance)
Recommended automatically on laptops with 4 GB of memory or less. Every game feature stays
on. Decorative animation, glow, blur and masks are switched off, and confetti is lighter.
Loudness analysis, conversion and new-video checks wait until the game ends. The host screen
refreshes less often. Optional: **make 720p copies** of big videos (originals are never
changed, and you can switch back per song).

### 🎯 Number of rounds and winning patterns: your choice
- Choose **how many rounds** (1–10). The last round ends the game.
- Choose **one or more winning patterns per round** (any of them wins): One Line, Two
  Parallel Lines, Full House, **L Shape** (4 corners), **T Shape** (4 directions),
  **Diagonal** (both), **Fast 5** (any 5 songs, or a set pattern of 5), and your own
  **custom patterns**.
- Set defaults in Settings → Bingo Rules (with presets), or per game in Host Game → 🎯 Rules
  until each round starts.
- The TV, phone remote, players' phones, printed card legend and every BINGO check use the
  same rules. Diagonals still never count unless you choose them.

### 🏆 After a winner: intermission or next round
- When a round's claims are done and it has a winner, the laptop and phone ask:
  **☕ Intermission** (with a TV countdown and your message), **▶ Next round**, or **Not yet**.
  In the last round it offers **Finish the game**.
- Or set Settings → Gameplay to go to intermission automatically.
- The same card can win several rounds (once per round); the check shows earlier wins.

### 📂 Show in Folder fixed
- After exporting a PDF, *Show in folder* didn't respond because of a clash with another
  button. Fixed.
- Videos now have **📂 Show in folder** in the Music Library and the Edit window. It handles
  moved files, unplugged USB/network drives, spaces and Unicode names, and offers Relink.

---

## Crime Master Bingo 1.4.2 — More buzz in the room

### New in 1.4.2
- **Phone BINGO alerts on your host remote.** When a player's BINGO is real, your phone
  remote buzzes and opens their claim (with their name), ready to confirm. Early presses
  show a quick "not yet" note.
- **Lobby on the TV.** The welcome screen shows the names of everyone who has joined on
  their phone, with a little pop as each new player arrives.
- **"🔥 3 PLAYERS ARE ONE SONG AWAY!"** The TV's pattern box shows how many cards need just
  one more song. It's a count only, never which cards. You can switch it off under
  Host Game → TV screens.

---

## Crime Master Bingo 1.4.1 — Better phone cards

### New in 1.4.1
- **Undo a mistaken mark.** Every tap shows "Marked 'song' · UNDO". There's also an
  **↶ Undo** button, and tapping a song again unmarks it.
- **Songs played so far on the phone.** Tap **🎵 played** to see the list (newest first),
  which helps anyone who missed a song or joined late.
- **🔥 ONE SONG AWAY!** The phone buzzes and shows a banner when a player needs just one more
  played song for the round.
- **Screen stays on.** Players' phones no longer dim or lock while the card is open.
- **Winner's name on the TV.** "PRIYA WINS!" (or "PRIYA & RAHUL WIN!") for phone players and
  cards shared with a name. You can turn it off under Host Game → TV screens.

---

## Crime Master Bingo 1.4.0 — Home play

If you have 1.3.x, this arrives in the app as **⟳ Restart to update**. Both new features
are options: switch them on in **Settings → 🏠 Home play**.

### New in 1.4
- **Share cards as images.** No printer? Save any range of cards as pictures to send on
  WhatsApp. You can add a player's name to each card (it's printed on the card and used in
  the file name). Images are identical to printed cards, QR code included.
- **Phone cards for players.**
  - Players scan a QR code, shown on the TV welcome screen or the laptop, type their name
    and get their own card on their phone.
  - They tap songs to mark them. Pressing **BINGO!** is checked instantly: an early press
    only tells that phone "not yet", and a real bingo freezes the claims on the laptop with
    the card already checked, ready for you to confirm.
  - The winner's phone celebrates with **"YOU WON!"**.
  - Manage players (rename, remove, open or close joining) under Mobile Host Connection.
- Player names now appear beside card numbers in the claim session, the claims list and
  the winners list.

---

## Crime Master Bingo 1.3.1

### New in 1.3.1
- **Redesigned "Thanks for playing!" screen.** It opens with a confetti burst and a shimmering title, your logo or the wordmark, and the event, venue and date. Stat tiles show songs played, rounds and winners (counts only). *Tonight's playlist* is grouped by round with numbered rows. The list rests at the top, scrolls gently, then loops back. It ends with "See you next time!".

---

## Crime Master Bingo 1.3.0

Offline Windows software for hosting music-video bingo nights. If you have 1.2.0, this arrives in the app as **⟳ Restart to update**.

### New in 1.3
- **Folders → playlists.** In Music Library or Playlists, click **Import folders as playlists…** and choose a top folder.
  - Each sub-folder (e.g. *80s*, *90s*, *Bollywood*) becomes a playlist with the same name.
  - Running it again only adds new videos. Duplicates are never added.
- **Built-in video converter.**
  - AVI, WMV, FLV, MPG and other files are now imported instead of refused. So are videos with codecs Windows can't play.
  - They're converted in the background to a playable MP4 copy. Your original files are never changed.
  - Progress shows in the Music Library. Failures show **Retry convert**.
  - Switch it off in Settings → Gameplay.
- **Live QR scanning on the phone.**
  - The phone link is now secure, so the camera scans a card's QR code live; no more taking a photo.
  - **First time on each phone:** the browser warns the connection isn't private, because it's this laptop's own certificate. Tap **Advanced → Proceed** (Android) or **Show Details → visit this website** (iPhone).
  - The standard link is still available under the QR code if a phone won't accept the secure one.
- **Welcome screen.** Before Round 1, the TV shows:
  - your logo, event name and venue;
  - the three winning patterns;
  - your message (e.g. *"Grab your cards at the bar!"*);
  - a countdown to your start time (*"We start at 8pm · 12:34 to go"*).
  It disappears automatically when Round 1 starts.
- **End-of-night screen.** After the game, the TV shows **THANKS FOR PLAYING!** and the full numbered list of songs played. It scrolls slowly if the list is long, and has no card numbers.
- Set the welcome and end screens per game (Create Game step 4, or Host Game → TV crawler tab). Change the defaults in Settings.
- **Fixes:** the Music Library's Clip and Loudness column headings were swapped. Leaving the Music Library while it was loading could show errors.

### First run
- Windows SmartScreen may say *"Windows protected your PC"*, because the app isn't code-signed yet. Click **More info → Run anyway**.
- Allow **Private networks** at the firewall prompt so your phone can connect. The secure phone link uses the next port up (8788 by default).

See the [Host guide](https://github.com/Coolrishi20/Crime-Master-Bingo/blob/main/docs/USER_GUIDE.md).

ffmpeg (GPL v3) is bundled as a separate program, used for loudness analysis and video conversion. Its licence is in `resources/ffmpeg/`.
