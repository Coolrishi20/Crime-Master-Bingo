## Anthem Square 2.6.0 — Talkover, Play on, MP3 songs and a Venue Check

- **Talkover:** hold **🎙 Hold to talk** on the phone or Host Game (or hold `T`) and the music
  glides down while you speak, then comes back. It lets go by itself after 30 seconds or if the
  phone drops. Set how far it drops in *Settings → Sound*.
- **Play on:** **+30 s** or **Full song** lets the song that's playing run on, on the phone or
  laptop. Other songs keep their normal clip length.
- **MP3 and other audio files:** MP3, M4A, AAC, FLAC, WAV, OGG and Opus songs now import and play.
  The TV shows a music card instead of a picture; the title appears just as it does for videos. Tags
  from MP3 files fill in the title and artist.
- **Cards handed out tonight:** checking a card number that wasn't handed out shows a warning, so a
  misheard number is caught before you announce a winner. Uses your printed cards, or your own
  list.
- **Venue Check:** a two-minute check when you arrive: TV picture (including cropped edges), sound,
  your phone reaching the laptop over the venue Wi-Fi, and smooth video.
- **Help & Guide:** the full host guide inside the app, searchable and offline. Press **F1** on
  any screen.
- **Fixed:** opening *Bingo Cards & Printing* straight after creating a game could say “Create a
  game first”, because the new game hadn't reached the disk yet. A game deleted within a moment of
  a change could also be saved again.
- Updates now come from the public **anthem-square-releases** page (the source code is private).

## Anthem Square 2.5.3 — polish and a diagnostics button

- **Save diagnostics** (*Settings → Updates & about → Help*): one file to send when something
  goes wrong. It contains:
  - the app and Windows versions and the hardware;
  - the displays;
  - settings, library and game status;
  - the most recent errors from the laptop and TV windows.

  It never contains videos, phone pairing secrets, passwords or player names, and your Windows
  user folder is shown as “~”.
- **Print preview** now uses the Anthem Square colours (it still had the old pink and purple).
- **Settings → Bingo rules** explains itself in one line instead of a paragraph.

## Anthem Square 2.5.2 — quieter portable updates

- **Fixed:** after clicking *Restart now* on the portable EXE, a “timeout /t 1 /nobreak” window
  kept flashing for about 90 seconds. Closing the app started a second swap helper that had
  nothing left to do and kept retrying in a visible window. The update itself was already
  installed.
  - Only one helper now runs.
  - It runs hidden.
  - It stops as soon as the swap is done.
  - A newly opened app ends any helper an older version left running.
- The previous version is kept once for *Go back* (instead of being copied every second while
  waiting), and *Go back* is only offered when that copy really is a different version.
- **Note:** this update is installed by the version you are on now (2.5.1 or older). It may show
  the flashing window one last time, briefly, until 2.5.2 starts and ends the helper.

## Anthem Square 2.5.1 — signed updates switched on

- The first release signed with Anthem Square's update key. From now on, copies on 2.4 or
  later check this signature and install updates with one click. Copies on 2.4 that showed
  2.5.0 as a manual download can update straight to 2.5.1.
- Everything else is the same as 2.5.0 (new logo, simpler Settings page).

## Anthem Square 2.5.0 — new logo and a simpler Settings page

### New logo
- The new lowercase **“a” with a round bingo grid** inside, traced from the approved artwork
  and coloured in Cream, Dark Blue and Orange Red.
- It appears on the Windows icon, taskbar, installer, sidebar, dashboard, TV screens, phone
  remote and printed cards.
- Small logos (the sidebar, phone header and Windows icons at 32 px and below) use a simplified
  version with bold bands, so they stay crisp.

### Settings, simplified
- **Nine sections** with a side menu that follows you as you scroll: General, TV screen,
  Gameplay, Bingo rules, Sound, Cards & printing, Phone & home play, Library & performance,
  Updates & about. Every setting is still there.
- **Find a setting…** shows only the sections that match and highlights the fields.
- **Changes save by themselves** (“✓ All changes saved”). When a game is loaded, a bar offers to
  apply the new defaults to it as well. It never does that automatically.
- The live TV preview sits next to the TV fields, and the optional TV screens (winner, welcome,
  “Thanks for playing!”, intermission slides) are together in *TV screen*.
- Advanced audio values are folded under *Levelling details*.

## Anthem Square 2.4.0 — media check, presets, Ready for Bingo?, automatic backups, signed updates

2.4 brings together the planned 2.2 (media), 2.3 (game preparation) and 2.4 (recovery and
commercial readiness) work in one release.

### Getting started
- **Get started guide** on first launch: nine set-up steps that tick themselves, from importing
  videos to checking a sample claim. You can skip it and reopen it from the Dashboard.
- **Rehearsal game**: a practice game with 40 generated test-pattern clips. No commercial
  music is included. Nothing from it goes into your Game History, and it is deleted when you
  end the rehearsal.
- A short notice explains that **you are responsible for the rights to the music** you play.
  Anthem Square is software only. *(The wording is a draft awaiting legal review.)*

### Media
- **Media check** (*Music Library → Media check…*): every video is checked for codec,
  resolution, frame rate, bitrate, keyframe spacing and clip points, then marked **Ready**,
  **Needs optimisation**, **Unsupported** or **Missing**, with the reason.
  **Optimise all flagged** makes smaller or simpler copies. Your original files are never
  changed. Nothing is decoded during the check.
- **Find missing videos…**: one relink wizard for the library and for games. A banner names
  where the videos used to be (for example a USB drive that isn't plugged in).
  - Identical files are found even if renamed, and ticked for you.
  - Same-name or same-title files are shown with a **Preview** for you to decide.
- **Clip editor** (*Edit song → Clip*):
  - a timeline over the song's loudness with draggable start and end markers;
  - 20 / 30 / 40 / 60 s / Full length buttons;
  - Play selection, Set start here, Set end here, Reset;
  - a **loud section** suggestion. It is a suggestion, not chorus detection.
- **Gap between songs**: None / 3 / 5 / 10 s / custom on Host Game. During the gap the TV holds
  the last picture instead of going blank. On the phone, Next becomes **Skip gap**.
- **Peak ceiling** for volume levelling is now adjustable in Settings.

### Preparing a game
- **Quick-start presets** at the top of Create Game:
  - **Quick Bingo Break**;
  - **Standard Bingo**;
  - **Rules Checklist**;
  - **Full Music Bingo Night**;
  - **Custom**, which keeps your own choices.

  Your saved templates are listed as *My presets*. Every value stays editable.
- **Pacing estimate** (Create Game → cards step): 1,500 simulated shuffles of your playlist
  against simulated cards show which song each round or rule is usually won by, how long it
  takes, and what a planned break of N minutes is likely to produce. It is an estimate only and
  never touches the real play order or cards.
- **Ready for Bingo?** (Dashboard, Host Game, Create Game): every pre-game check in one place.
  Problems are grouped as *Action required* / *Warning* / *Ready*, each with a button that fixes
  it. New checks:
  - media check;
  - clip points;
  - last backup;
  - laptop memory;
  - a 5-second off-screen **decode test** that counts dropped frames.
- **Card footer message** and **song font** (Modern, Bold, Classic, Serif) for printed cards.
  They only change how cards look: numbers and songs never change.
- The TV extras (welcome and end screens, “Not a Bingo”, “one away” count) stay available, but
  for **new installations** only the winner screen is on by default. Existing settings are
  unchanged.

### Backups and recovery
- **⤓ Back up** on Host Game and **Back up game** on Backup & Restore: a compact backup in one
  click, with no file dialog.
- **Automatic backups** at five safe moments: after creating the game, after printing, at the
  start, after confirming winners, and when the game ends.
  - Never written while a song plays.
  - Saved in *Documents\Anthem Square Backups*, keeping the last 10 per game.
- **Music usage report (CSV)** in Game History: date, event, venue, time, title, artist,
  seconds played and how. Optional **rights details** per song (ISRC, label/publisher, licence
  reference) are included. It is a record to help with licensing returns, not legal advice.

### Updates
- **Signed updates**: from 2.4 on, an update is installed only if its files are signed with
  Anthem Square's key, which is checked on the laptop. An unsigned or altered file is never
  run; you get the download page instead.
- Updates are installed **between games only**, never during one.
- Your games and settings are **copied before every update**, and **Go back to x.y.z**
  (Settings → App updates) returns to the previous version.

### Licensing
- The licensing framework is built in but **switched off**: Anthem Square is free, with no
  licence, account or activation. *Settings → Licence & devices* says so.

## Anthem Square 2.1.0 — Quiz Intermission Mode

### Quiz Intermission Mode: switch between your quiz and the bingo in one click
For quiz nights where the bingo runs in breaks between quiz rounds. The whole evening is one
game, with the same cards all night.
- **❚❚ Return to Quiz** (on Host Game, on the phone, or the **Q** key) pauses the bingo
  wherever it is: mid-song, between songs, even with a claim session open. The exact video
  position is kept, and **the TV window is hidden** so your quiz (PowerPoint, Mind It!…) shows
  on the TV. Nothing is completed, reshuffled or regenerated.
- **▶ Start Bingo Break** brings the TV window back without taking the keyboard away from
  your quiz app. By default it waits for you to press Play. You can choose *Play straight
  away* instead.
- Prefer the TV to show something? Choose **Show a still holding screen** (“Bingo is back
  soon”) instead of hiding the window.
- Breaks are numbered (Break 1, Break 2…) with the songs played and winners in each; the
  phone has a new **Winners** tab with tonight's breaks.
- If the laptop restarts during quiz time, the game reopens in quiz time with the TV hidden.
- The existing round-based **Intermission** screen is unchanged for venues that use it.

### Phone remote
- During the quiz the phone shows one big **START BINGO BREAK** button. During a break, a
  slim orange bar always offers **RETURN TO QUIZ**.
- Commands carry sequence numbers, so a command that arrives late after a Wi-Fi hiccup is
  refused instead of running out of order.
- The phone now receives only what changed, instead of the whole game every time.
- Pairing pauses for a minute after 20 wrong PINs from any phones (on top of the existing
  limit of 5 per phone). Making a new PIN on the laptop lifts the pause.

### Safer relinking
- **Music Library → Relink folder…** used to relink by file name alone, silently. It now
  relinks only files that are provably the same video (even if renamed); a file with the same
  name or the same title and artist is shown for you to tick.

## Anthem Square 2.0.0 — click-to-update, live TV preview, YouTube (Beta) and a start-up fix

2.0 includes everything from 1.9.0 (templates, smart playlists, song check, intermission
slides, second TV) plus the following.

### Fixed: the portable EXE could fail to open (1.8.0 / 1.9.0)
- Some laptops showed *“Uncaught Exception … ENOENT … loudness.js”* when opening the portable
  EXE. Windows or the antivirus had cleaned out part of the temporary folder the portable EXE
  unpacks into.
- The app no longer needs any unpacked files, so this can't happen any more. If volume
  analysis ever fails, the app still opens and the songs simply play at their own volume.

### Click to update — with a progress bar and “Restart now”
- When a new version is out, the sidebar shows **⬆ Update to 2.x.x**. Click it, then
  **⬇ Update now**: the new version downloads with a progress bar while you keep working.
- When it's done, choose **⟳ Restart now** (the app reopens on the new version, your game
  saved and paused exactly where it was) or **Later** (it is installed when you next close the
  app).
- This now works for **both** the installer and the **portable EXE**. The portable EXE swaps
  itself in place under the same file name, so shortcuts and pinned icons keep working. Every
  download is checked (size and SHA-256 from GitHub) before it is used; a damaged download is
  thrown away and you can retry.
- Nothing downloads without your click, and a restart during a song asks first.
- *Note:* 1.8.0/1.9.0 portable users need to download 2.0.0 by hand once. From 2.0 on, it's
  one click.

### Live TV preview
- **Create Game → Audience screen** and **Settings** now show a live, scaled-down copy of the
  real TV screen. Move a slider and it changes immediately:
  - crawler speed, text size, height and separator;
  - the winning-pattern panel corner, with your actual rounds or your Rules Checklist;
  - song title position, size, background and reveal;
  - picture fit (fit / fill / stretch).
- It uses your own song titles and a video thumbnail from your library, so what you see is
  what the room sees.

### YouTube songs (Beta)
- **Music Library → ＋ YouTube…**: paste one or more YouTube links (one per line). The app
  fetches the title, artist and thumbnail; they behave like any other song in playlists, cards
  and the crawler.
- They play through YouTube's **official embedded player** on the TV. Nothing is downloaded.
- **Please read the limits:**
  - it needs a working internet connection at the venue;
  - YouTube may show adverts;
  - volume levelling and quiet-intro detection don't apply;
  - some owners block embedding (the app tells you when you add the link);
  - the song check skips YouTube songs.
- The pre-flight test warns when a game contains YouTube songs and the laptop is offline.
  If a YouTube video fails during a game, the app moves on as with any broken video
  (Technical Credit).
- **Beta:** tested against a stand-in for YouTube's player, not against live YouTube. Try it
  at home before relying on it at a venue.

## Anthem Square 1.9.0 — templates, smart playlists, song check, slides and a second TV

### Game templates
- Save a whole game set-up and start the next game from it in one click. A template keeps the
  playlist, number of cards, venue, game mode, rounds or checklist, clip length, intro and
  artist settings, and TV screens.
- *Create Game → Save these choices as a template…*, or *Game History → Save as template…*
  (copies a game you've already played).
- *Create Game → Start from a template* fills everything in; you can still change anything.

### Decades, tags and the playlist builder
- Songs now have a **year** and **tags** (Bollywood, Dance, Party…). Videos whose files contain
  a year or genre are tagged automatically on import.
- **Music Library:** *Tag selected…* tags many songs at once, and a new filter shows one decade
  or tag. The song editor has Year and Tags fields.
- **Playlists → Build a playlist…:** pick decades and/or tags (for example 1980s + Bollywood).
  It shows live how many songs match, then picks 75 (or your number) at random. Only playable
  songs count, never two versions of the same song.

### Song check run-through
- *Playlists → ▶ Check songs…* plays 3, 5 or 8 seconds of every song from where the game will
  start it (your start point, then the default start, then the detected intro). It plays on the
  laptop only; the TV is never used.
- Flag problems with one tap (wrong video, bad start, sound, picture), and fix a start point
  straight away. The summary lists the flagged songs. Flags stay on the songs (*Music Library
  → Flagged*) until you clear them.

### Intermission slides
- *Settings → Intermission slides* lets you add your own pictures: venue, food & drink offers,
  sponsors, next week's date. They rotate full-screen on the TV during intermissions, with the
  countdown and your message in a band at the bottom.
- Choose 5–30 seconds per slide. The images are copied into the app, so moving the originals is
  fine.

### Second TV screen
- *Host Game → ＋ TV 2* mirrors the audience screen on another display, for big rooms.
- It's always silent (no echo), stays in step with the main TV, and can never move the game on
  by itself. On a 4 GB laptop it plays the video twice, so use it with care in Low Resource
  Mode.

## Anthem Square 1.8.0 — songs start where the music starts, and artists stay apart

### Skip quiet intros automatically (on by default)
- Many music videos open with silence, dialogue or a slow scene. Each clip now starts where the
  music actually begins, about half a second before the first beat.
- It uses the volume analysis the app already runs. Nothing extra is decoded, and the TV,
  phone and Low Resource Mode are unaffected.
- It's careful about what counts as an intro:
  - a soft musical intro is kept;
  - openings under 2 seconds aren't touched;
  - anything over 45 seconds (or 40% of the song) is left alone as doubtful.
- Your own start point for a song, or a game-wide clip start above 0, always wins.
- **Where you see it:** the Music Library shows "from 0:07 (intro)", the song editor shows the
  detected start, and Up Next says "(quiet intro skipped)".
- **Switching it off:** in Create Game, in Settings → Gameplay, or live from the host console
  ("Skip quiet intros").
- Songs not analysed yet (for example while Low Resource Mode holds the analysis during a game)
  simply start from the beginning, as before.

### Keep songs by the same artist apart (on by default)
- Shuffled games never play the same artist back to back when the playlist allows it, and keep
  them three or more songs apart when they easily can.
- "The Beatles" / "Beatles" and "Calvin Harris feat. Rihanna" / "Calvin Harris" count as the same
  artist.
- If one artist dominates a playlist, they're spread as evenly as is mathematically possible.
- It applies to new games and to Reshuffle, and can be switched off in Create Game or Settings.

### Fixes
- The host console's new toggle always shows the real setting after a refresh.

## Anthem Square 1.7.0 — the new name and look, plus M3U playlists

**Crime Master Bingo is now Anthem Square.** *Music video bingo. Hear it. Mark it. Own it.*
This is a full release and includes everything from 1.5 and 1.6 (Low Resource Mode, custom
rounds and patterns, Rules Checklist Mode). Game rules, cards, printing, the phone remote, the TV
and saved games all work as before. Hardware note: it has been run on a 32 GB Windows laptop and
in an integrated test environment. A real **4 GB** laptop test is still recommended
(*docs/PERFORMANCE.md*).

### New: M3U / M3U8 playlists
- **Import:** *Playlists → Import M3U…*, or drop `.m3u` / `.m3u8` files on the Playlists or
  Music Library page. *Import videos…* in the Music Library also accepts them.
  - Works with playlists from VLC, Windows Media Player, Winamp, foobar2000, MusicBee and iTunes
    exports.
  - Reads UTF-8, UTF-16 and old Windows-1252 files.
  - Understands relative, absolute and `file://` paths.
- **Order and names:** the playlist keeps the M3U's order and name. `#EXTINF` "Artist - Title"
  fills in names a file name lacks; it never replaces embedded tags or your edits.
- **Moved files:** if the videos moved with the playlist (another USB drive letter or folder),
  they're found next to it automatically.
- **Clear report:** missing files (with their line in the M3U), audio-only files and online
  streams are listed; nothing is silently dropped. Importing the same M3U again only adds
  what's new.
- **Export:** *Playlists → Export M3U…* writes a UTF-8 `.m3u8` with paths relative to the
  playlist, so a USB stick of videos plus the playlist opens in VLC.

### Fixes
- Clicking another page in the first second after start-up no longer jumps back to the
  Dashboard.


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
