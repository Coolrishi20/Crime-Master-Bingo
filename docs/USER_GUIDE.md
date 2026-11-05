# Anthem Square — Host Guide

Anthem Square (formerly Crime Master Bingo) runs music-video bingo nights from a Windows laptop. The laptop
plays every video and all the sound; the TV or projector shows the audience screen;
your phone is a remote control. No internet connection or account is needed.

---

## 1. Before the night (about 15 minutes)

### Install
Run **AnthemSquare-Setup-<version>.exe** (or use the portable EXE, which needs no
install). Windows may show *"Windows protected your PC"* because the app is not
code-signed yet. Click **More info → Run anyway**.

The first time the phone remote starts, Windows Firewall asks about network access:
tick **Private networks** and click **Allow**.

### Updating from Crime Master Bingo
Install Anthem Square over your existing copy. Your music library, playlists, saved games,
printed-card numbers, backups and phone pairings are kept: the app still reads the same data
folder. Cards printed before the rename still scan and check normally.

### Dark and Light Mode — *Settings → Appearance → Theme*
**Dark** is the default and is best during a live event. **Light** suits daytime preparation
(playlists, the library, printing). The change applies straight away and is remembered. The
phone remote and player phones follow the laptop's choice. The TV always stays dark so the
video stands out.

### Import your music videos — *Music Library*
- Click **Import videos**, **Import folder**, or drag files/folders onto the page.
- Best format: **MP4 with H.264 video and AAC audio**. MOV, M4V, WebM and MKV also work
  if Windows can decode them.
- **AVI, WMV, FLV, MPG and other formats, or videos with codecs Windows can't play,
  are converted automatically.** The app makes a playable MP4 copy in the background
  and never changes your original file. The Status column shows *Converting 45%*,
  then *Ready · Converted*. If a file can't be converted (e.g. it's damaged), you'll
  see **Retry convert**. Turn automatic conversion off in Settings → Gameplay.
- **Import folders as playlists…** (Music Library or Playlists): choose a top folder
  and every sub-folder becomes a playlist with the folder's name. For example,
  *Music Videos\80s* becomes an **80s** playlist. Sub-folders inside those are
  included, and videos loose in the top folder go into a playlist named after it.
  Run it again later and only new videos are added.
- **No file size or number limit.** Videos are never copied or uploaded. The app
  remembers where each file is and plays it from there. Keep your videos in one folder
  (or on one drive) that you don't move.
- Title and artist are read from the file's tags, or from a file name like
  `Michael Jackson - Billie Jean.mp4`. Click **Edit** to change them, set a shorter
  **TV display title** or **Printed title**, and pick a **clip start / end** while
  watching the video.
- Every video is checked automatically: playable? duration? thumbnail? The **Loudness**
  column shows the measured loudness (see *Volume levelling* below).
- **Needs attention** shows missing files, unsupported videos and songs without a
  title/artist. **Duplicates** shows repeated files or songs; click *Not a duplicate*
  if a flagged song is fine.
- Moved your videos? **Relink folder…** finds them by file name.

### Build a playlist — *Playlists*
Create a playlist (e.g. *80s Classics*) and **Add songs**. Drag rows to reorder.
A game needs **at least 40 unique, playable songs**. The playlist shows exactly how
many more you need. Duplicates are never added silently.

### M3U playlists (VLC, Windows Media Player, Winamp…)
- **Import:** *Playlists → Import M3U…*, or drag `.m3u` / `.m3u8` files onto the Playlists or
  Music Library page.
- **What happens:** the videos in it join your library (checked and converted like any import)
  and a playlist with the same name keeps the same order. "Artist - Title" from the M3U fills in
  song names that the file names don't give.
- **If videos moved** to another drive letter or folder along with the playlist, they're found
  next to it.
- **The report** lists anything it couldn't use: missing files (with their line number),
  audio-only files and online streams. Anthem Square plays music **videos** from this laptop or a
  connected drive.
- **Importing again** only adds what's new.
- **Export:** *Playlists → Export M3U…* saves a `.m3u8` that opens in VLC or Windows Media Player.
  Paths are relative to where you save it, so a USB stick with the videos and the playlist works
  on any PC.

### Create the game — *Create Game*
The wizard has nine steps:
1. **Details**: name, date, venue, logo.
2. **Playlist**: only playlists with 40+ songs can be chosen.
3. **Playback**: clip length 20/30/**40**/60 s or full song, default start point, gap
   between songs, volume, shuffle, title overlay.
4. **Audience screen**: where the winning-pattern panel and song title sit, and the
   crawler speed and size (with a live preview).
5. **Bingo cards**: how many (1–999). Clicking *Next* creates the game, shuffles and
   saves the play order, and generates the cards.
6. **Printing**: see below.
7. **Pre-flight test**: open the TV window, play an 8-second sound check (not
   counted), and check files, cards, verification and phone status.
8. **Mobile remote**: pair your phone.
9. **Start**: **START ROUND 1**.

### Print the cards — *Bingo Cards & Printing*
- Every A4 sheet holds **two complete cards** (top and bottom) with a dashed
  **CUT HERE** line. 100 cards = 50 sheets.
- **🔍 Print preview** opens real A4 pages and never changes or locks anything. In the
  preview you can:
  - go page by page (◀ ▶ or PageUp/PageDown) and zoom (− + Fit);
  - **Find** a card by its number;
  - click **Check QR codes**, which scans every QR code on screen and confirms each one
    matches its card;
  - **Print all**, **Print range** (e.g. `1-50, 75`), **Reprint card** (one number), or
    **Export PDF**.
  Song titles too long to print in full are outlined in red and listed at the top. Set
  a shorter **Printed title** for them in the Music Library before locking.
- **Squares show**: choose *Song title + artist* or *Song title only*. **Cutting
  guide** turns the dashed cut line on or off. These visual options never change which
  songs are on a card.
- **Export PDF…** or **Print…** asks: **LOCK BINGO CARDS?** After you confirm, the
  cards are *issued*. Their numbers, songs, positions and printed titles can never
  change, so printed cards always match the checker. (Before locking, a game is a
  **DRAFT**: you can regenerate cards or rebuild from an edited playlist.)
- Print at **100% / Actual size**, never "Fit to page". Black-and-white mode saves ink.
- Need more cards later? **Generate more cards** continues with the next unused
  numbers (e.g. 101–120). Existing cards never change.

---

## 2. On the night

### Connect the TV
Plug in HDMI and set Windows to **Extend** (Win + P → Extend). In **Host Game** click
**Open audience window**; it opens fullscreen on the TV. Press **F** to toggle
fullscreen. Sound goes to Windows' default output. To send it to the TV/HDMI, pick
the device in **Settings → Video & TV → Audio output**.

The TV shows **only**:
1. the music video;
2. the song title and artist (lower-third overlay);
3. this round's winning pattern (small corner panel);
4. a **scrolling list of every song played so far**, in its own strip **below** the
   video. Players who missed a song can catch up from it. It keeps scrolling when the
   music is paused.

Plus the **winner** / **"Not a Bingo"** screens (section 4). The TV never shows card
numbers (unless you switch that on), upcoming songs, or anything private.

### Welcome & end-of-night screens
Before Round 1 the TV shows a **welcome screen**:
- your logo, the event name and venue;
- the three winning patterns;
- an optional message, such as *"Grab your cards at the bar!"*;
- a live countdown to your start time (*"WE START AT 8PM · 12:34 to go"*).
Set the time and message in Create Game (step 4) or during the night in Host Game → TV
crawler tab. The screen disappears automatically when Round 1 starts.

After the game, the TV shows **THANKS FOR PLAYING!** with the full numbered list of
every song played, handy for "what was that song?". Both screens can be switched off
per game, and the defaults are in Settings → Gameplay.

### Connect your phone — *Mobile Host Connection*
1. Put the phone on the **same Wi-Fi** as the laptop. No internet is needed; a phone
   hotspot or a travel router works.
2. Scan the QR code with the phone camera. It opens the remote and pairs
   automatically (or type the address and the 6-digit PIN).
   The QR code uses a **secure link**, so the phone's camera can scan card QR codes
   live. **The first time on each phone**, the browser warns that the connection
   isn't private; that's this laptop's own security certificate, which is fine on
   your own network. Tap **Advanced → Proceed** (Android/Chrome) or **Show Details →
   visit this website** (iPhone). If a phone won't accept it, use the **standard
   link** shown under the QR code; scanning then takes a photo instead.
3. No app or APK to install: the remote runs in Safari/Chrome. To get an app icon, use
   **Share → Add to Home Screen** (iPhone) or **⋮ → Add to Home screen** (Android).
4. The phone stays paired and reconnects by itself after locking or a Wi-Fi drop.
   Remove a phone at any time with **Remove**.

The phone **never plays music or video**. Everything it does happens on the laptop,
and the laptop always keeps working on its own if the phone disconnects.

### Running the rounds
| Round | To win |
|---|---|
| 1 — ONE LINE | any full row **or** column |
| 2 — TWO PARALLEL LINES | two rows, **or** two columns (a row + a column does not count) |
| 3 — FULL HOUSE | all 25 songs |

These are the **standard rules**. With them, diagonals never count. You can choose other
winning patterns (see **Winning rules** below). Players keep the same card for all three
rounds and songs stay marked.

**Number of rounds and winning rules.** You decide **how many rounds** a game has (1–10;
the last round ends the game) and **which patterns win each round**. Each round can use one
or more of these patterns. If you tick several for a round, **any one of them** wins:

| Pattern | To win |
|---|---|
| One Line | any full row or column |
| Two Parallel Lines | two rows, or two columns |
| Full House | all 25 songs |
| **L Shape** | an outer row + an outer column that meet at a corner (9 squares, any of the 4 corners) |
| **T Shape** | an outer row or column + the centre line running from it to the opposite edge (9 squares, 4 directions) |
| **Diagonal** | either 5-square diagonal (diagonals only count when this is ticked) |
| **Fast 5** | *any* 5 songs on the card, or a set pattern of 5 squares you choose |
| **Custom** | your own 5×5 pattern (e.g. Four Corners, Plus Sign) |

- **Defaults for new games:** Settings → 🎯 Bingo Rules. Use **− / ＋** to set the number of
  rounds, then **Change Round N…** to tick its patterns. You can also save presets (rounds
  and patterns together), design custom patterns and restore the standard 3 rounds there.
- **This game:** Host Game → Rounds → **🎯 Rules…**. Add or remove rounds and change a
  round's patterns until that round starts (rounds already under way can't be removed).
- The TV, the phone remote, players' phone cards and the printed legend all show the
  chosen patterns. Cards printed earlier show the rules from when they were printed, so
  tell players about any change.
- **The same card can win more than one round** (once per round). The check shows if a card
  already won an earlier round.
- Every BINGO check (laptop or phone) uses the same rules and the same frozen list of
  songs (Claim Freeze). For simultaneous claims, the result shows **which song** each card
  qualified on, so you can see who got there first.

Start Round 1 from the laptop (**Rounds** panel) or the phone (**Rounds** tab). Rounds
always go in order: 1 → 2 → 3.

**After a winner: intermission or next round.** When you close the claim session for a round
that now has a winner, the laptop and your phone ask **what's next**:
- **☕ Intermission:** choose the length (5–30 min or no countdown) and an optional message.
  The round is completed, the music pauses, and the TV shows **INTERMISSION** with a countdown,
  your message and the next round's pattern. The crawler keeps running, and players' phones
  show the break. Press **▶ Start Round N** (laptop banner or phone) when everyone is back.
- **▶ Start the next round** straight away.
- **Not yet:** keep checking claims; you can still use *Complete round* later.
- In the **last round** it offers **🏁 Finish the game**.

To skip the question and always take a break, choose Settings → Gameplay → *After a round is
won: Go to intermission automatically* and set the default length.

**Moving to the next round (manually).** As soon as you confirm a winner, a green banner appears on
the laptop and phone: *"Round 1 has 1 confirmed winner"*.
1. Check any other claims first.
2. Press **Complete Round & Continue**. It refuses while a valid claim is still
   undecided.
3. The TV plays the round-complete animation (*"ROUND 1 COMPLETE — One Line conquered!
   Time for TWO PARALLEL LINES!"*) and shows the next pattern.
4. The music stays **paused** and the round shows as **READY**.
5. Press **▶ Start Round 2** when the room is ready.

All marks and winners are kept. If any cards already have the next round's pattern, you
get a host-only warning listing them. Nothing is awarded automatically; they still have
to claim. Completing Round 3 ends the night with *"FULL HOUSE! That's a wrap!"*. A
double press, or the laptop and phone pressing at once, never skips a round.

### Rules Checklist Mode (instead of rounds)
In **Create Game → Game details**, choose the game mode:
- **Round-Based Bingo** (the default). Round 1, 2, 3… each with its own winning rule. You move
  between rounds. Nothing about this mode has changed.
- **Rules Checklist Bingo.** There are no rounds. You pick a list of winning rules, for example
  Fast 5, One Line, Diagonal, L Shape and Full House. **All of them are open from the start,
  and players can win them in any order.** Each rule is ticked off when its winner is
  confirmed. The music never stops for a round change.

Setting up the checklist: tick the rules to add (**＋ Add rules…**). That includes the custom
patterns from Settings → Bingo Rules. Use ▲ ▼ to change the order and ✕ to remove a rule.
**Save as preset…** keeps the list for next time, and **Restore default checklist** brings
back the standard five. The order is only how the list is shown; it never decides which rule
can be won first. The checklist can be changed in Host Game (**✎ Edit checklist…**) until you
press **Start game**. Cards are not changed, and the printed card legend lists the rules as
“WINNING RULES · ANY ORDER”.

During the game:
- **Host Game** shows the checklist instead of the round buttons: each rule with a mini
  pattern, AVAILABLE or ✓ COMPLETED, its winners, and **“2 OF 5 RULES COMPLETED”**.
- **Checking a BINGO** works as usual (Claim Freeze, laptop or phone). The card is checked
  against every rule that is still open, and the result lists what it is **valid for**. If it
  qualifies for more than one rule (a full row is also a Fast 5), **you choose which ONE rule to
  award**. A single claim never completes two rules.
- **RULE ALREADY COMPLETED** means the card only has patterns that someone else has already
  won. **NOT A VALID BINGO** shows the played squares, the squares still needed and the open
  rules.
- **Simultaneous winners:** while one claim session is frozen, several cards can win the same
  rule. Once the session is closed, the rule is closed for later claims.
- **The same card can win several different rules**, one per claim, but never the same rule
  twice.
- **Correct an award** (*Correct…* next to a winner, on the laptop or the phone) moves the
  award to another rule that the card had really completed, or undoes it. It always asks
  first and is recorded in the corrections log.
- **The TV** replaces the round's pattern panel with a compact **Winning Rules** checklist:
  mini patterns, ✓ ticks and “2 / 5”. A newly won rule flashes briefly (just an outline in Low
  Resource Mode). Round numbers are never shown.
- **Phone remote:** the *Rules* tab shows the checklist, winners, *Correct* buttons and Start /
  Finish game. The claim checker shows the rule choices. **Player phones** show which rules
  are still open and which ones they have won.
- **All rules won →** you're asked: **Finish game**, **View winners** or **Continue music
  without more Bingo claims**. If the playlist runs out first, Host Game lists the rules that
  weren't won and you can finish anyway. Nothing is marked as won unless it really was.

Everything is saved as it happens: the mode, the rules and their order, statuses, winners,
claim sessions and corrections. After a crash or restart the checklist comes back exactly as
it was.

### Up Next (host only)
The laptop's **Up next** panel and the phone's **Play** tab show the next song: title,
artist, file name, length, start point, clip length, and whether it's **READY** (a red
warning if the file is missing or can't play, with **Relink**).
- **Skip this one**: it comes back later; it is never lost or counted.
- **Choose…**: pick any unplayed song to **play next** or **add to the queue**. On the
  laptop, the Play order tab's ⤴ button does the same.
- **Back to playlist order**: clears your changes.
The TV never shows what's coming next. Looking at Up Next never plays or counts a
song.

### Playback controls (laptop and phone)
Play/Pause · Next (asks *skip without counting* or *mark played & next* if the song
hasn't finished) · Replay · Previous · Stop · Seek (click the progress bar) · Volume ·
Mute · Clip length.

A song only counts when its clip **finishes** or you press **Mark played**. Replays never
count twice; skipped songs don't count and come back at the end. The **Play order** tab
lets you play any song now.

**Keyboard:** `Space` play/pause · `→` next · `←` replay · `B` bingo check · `F` TV
fullscreen · `Esc` close dialog. Shortcuts are ignored while you type.

---

## 3. Checking a BINGO! — Claim Freeze

When someone shouts BINGO, press **CHECK BINGO** on the phone (or **Freeze claims** /
`B` on the laptop).

1. The music **pauses** at the exact spot and the list of songs that count is
   **frozen**. Songs that finish later can't change any claim in this session.
2. Enter each card number that called (keypad, or **📷 Scan QR**). You can enter
   several: 045, 127, 382…
3. Each card shows **VALID BINGO!** or **NOT VALID** with a plain-English explanation,
   e.g. *"Not a Bingo! Card #142 has completed one line but requires two parallel lines
   for Round 2."* You also see:
   - the exact printed 5×5 card, with played (credited) squares lit and unplayed ones
     dark;
   - for a valid card, the winning line(s) in pink and the **song that completed the
     win**, outlined in gold;
   - for an invalid card, the **closest pattern** and how many more songs it needs. The
     missing squares are dashed. Unplayed songs are never shown on the TV.
4. **Confirm winner** or **Reject claim** for each card. Several winners in the same
   round are fine, and confirming one never cancels another valid card. Entered a
   number by mistake? **Remove** it (it stays in the log).
5. **Close & resume**: the song continues from the same point. Valid claims you
   haven't decided are never thrown away silently; you'll be asked first.

If the laptop shuts down during a check, the frozen session is restored exactly when
you reopen the game.

---

## 4. TV winner & "Not a Bingo" screens

Confirming a winner shows a **BINGO!** celebration on the TV (round, the winning line
shape, confetti). Rejecting a claim shows **NOT A BINGO — Keep playing!**. Both cover
only the video. The played-songs strip stays visible.

Change them in **Host Game → TV crawler** tab: turn either screen off, choose how long
it shows, and optionally **show the card number** (off by default, so the room never
sees private claim details). You can replay either screen from the claim result.

---

## 5. When a video won't play — Technical Credit

If a video is missing (moved file, unplugged drive), corrupted, or fails during the
night, the app **never** plays a substitute and never counts it automatically. It skips
it and shows a red **video unavailable** warning on the laptop and phone.

You can:
- **Relink**: point to the right file. The printed song identity and the cards don't
  change. If the file isn't the exact same video, you'll be asked to confirm.
- **Technical credit…**: count the song for **every card** that has it. Choose a
  reason and confirm. On the TV it appears as **TECHNICAL CREDIT — Title / Artist**,
  never as a played video. Every credit is in the audit log. **Reverse** asks for a
  reason and warns you if a confirmed winner depended on it (confirmed results are
  flagged for review, never silently changed).

---

## 6. Volume levelling

Every video's loudness is measured once in the background (EBU R128 / LUFS). During
playback each clip is turned up or down to the same target loudness, **−16 LUFS** by
default, so quiet and loud videos sound equally loud. Measuring happens on the exact
clip you play, so a quiet intro won't fool it.

- The original files are never changed.
- Quiet videos are boosted by at most **+9 dB** (adjustable), and never past
  **−1 dBTP**, so nothing clips or distorts.
- Short **fade in (0.5 s)** and **fade out (1 s)** inside each clip; adjustable, or 0
  to turn off.
- Only one song ever plays at a time; skipping fades out in 50 ms with no overlap.
- Turn it on/off, mute, or change the volume from the laptop or phone.
- **Settings → Audio** holds the target, maximum boost and fade lengths.
- If a video can't be analysed, it plays at its original volume with a warning. Analysis
  can be paused/resumed in the Music Library.

---

## 7. Delayed title reveal (optional)
To make players work for it, go to **Settings → Song overlay → Reveal song title after**
and choose 5–30 seconds. Each song starts on the TV with **♪ Guess the song…** and a
countdown, then the title and artist slide in. The countdown follows the music: pause
the song and the countdown pauses too. The laptop and phone always show the title
immediately. You can change it live during a game (Host Game → TV crawler tab) or per
game (Create Game, step 4). Choose **Immediately** to turn it off.

## 8. App updates
The installed app keeps itself up to date from the official GitHub releases.
- It checks quietly in the background and downloads new versions, but never during a
  live game.
- When an update is ready, a pink **⟳ Restart to update** button appears in the
  sidebar. Click it when convenient. If a song is playing it asks first. Your game is
  saved and reopens paused exactly where it was. Closing the app also installs a
  waiting update.
- **Settings → App updates** shows your version and has **Check now** and an
  **automatic checks** on/off switch.
- No internet at the venue? Nothing happens; the app works fully offline.
- The **portable** EXE can't replace itself, so it shows a download link instead.

## 9. Saving, recovery and backups

- Everything is saved automatically and crash-safely as it happens.
- If the laptop or app shuts down unexpectedly, the Dashboard offers **RESUME LAST
  GAME**: cards, played songs, round, playback position, claims, winners and the
  crawler come back exactly. Playback stays paused until you press Play. Phones
  reconnect by themselves.
- **Game History** lists every game with its winners, claims, played songs and log, and
  can export a text report.

### Backup & Restore
- **Game backup**: everything about the game (cards with exact layouts, playlist
  snapshot, progress, claims, credits, winners). Small. Videos need relinking after
  restoring.
- **Full portable backup**: also copies the game's videos, so another laptop needs
  nothing else. The size is shown before you start.
- Optional **password** (AES-256). Without the password the backup can't be opened, so
  don't lose it.
- **Restore** checks the file completely first: structure, versions, checksums, card
  mappings. It refuses damaged or unsafe files and never overwrites an existing game.
  If the game already exists, choose **Keep existing** or **Restore as separate copy**.
  Printed cards and their QR codes still work with the copy.
- Restored cards are byte-for-byte identical: card 457 is still card 457.
- **Relink videos** finds moved videos by fingerprint (exact match). Anything less
  certain asks you to confirm.
- Phones must be paired again on a new laptop (pairings are never copied in a backup).

---

## 9a. Home play (optional)
Two extras for playing at home with family and friends. Both are **off** until you switch
them on in **Settings → 🏠 Home play**.

### Share cards as images (WhatsApp)
No printer? In **Bingo Cards & Printing**, the **📤 Share cards as images** panel saves each
card as a picture (about 1600 × 1120 pixels):
1. Type which cards to save, e.g. `1-12`.
2. Optionally type player names, one per line. The first name goes on the first card, and so on.
   The name is printed on the card ("Player: Rahul") and used in the file name
   (`Diwali-Bingo-Card-002-Rahul.png`).
3. Click **Save card images…** and choose a folder, then send the pictures on WhatsApp.

A shared image is identical to the printed card, including the QR code, so checking a BINGO
works the same way. Sharing **issues and locks** those cards, just like printing.

### Phone cards for players
Players get their own card on their phone and mark it there:
- **Joining:** they scan the QR code, either on the TV welcome screen ("Play on your phone")
  or on **Mobile Host Connection**. They type their name and get the next free card. Cards
  that are printed, shared or already given to someone else are never handed out. If none
  are left, a new card is added.
- **Marking:** they tap songs as they hear them. Marks stay on their phone, even if they
  reload or the phone locks.
- **Pressing BINGO!:** the laptop checks it instantly against the songs actually played.
  - **Not a bingo yet:** only that phone is told "keep listening". The music doesn't stop.
  - **A real bingo:** claims freeze and the card is added to the claim session, already
    checked and showing the player's name. You confirm it as usual, and their phone shows
    **"YOU WON ROUND 1!"**.
- **Managing players:** under **Mobile Host Connection → Players on their phones** you can
  see who's connected, rename or remove players, and open or close joining. A removed
  player's card is never given to anyone else.

On the player's phone:
- **Undo:** marked the wrong song? Tap **UNDO** in the message that pops up, use the
  **↶ Undo** button, or tap the song again.
- **🎵 played:** opens the list of songs played so far (newest first, the same as the TV),
  for anyone who missed one or joined late.
- **🔥 ONE SONG AWAY!:** the phone buzzes and shows a banner when the player needs just one
  more played song for this round. It's based on the songs actually played, not on their
  marks.
- **Screen stays on:** the screen doesn't dim or lock while the card is open.

**Lobby on the TV:** while the welcome screen is up, the names of everyone who has joined
pop up in the bottom-left corner ("3 PLAYERS HAVE JOINED").

**Suspense on the TV:** during a round, the winning-pattern box shows
**"🔥 3 PLAYERS ARE ONE SONG AWAY!"**. It counts every issued card (printed, shared or on a
phone) that needs one more played song, and never says which cards. Turn it off under
Host Game → TV screens.

**On your host remote:** when a player's BINGO is real, your own phone remote buzzes and
opens their claim (with their name), ready to **Confirm winner**.

**Winner's name on the TV:** when a phone player (or a card shared with a name) wins, the TV
says **"PRIYA WINS!"**. Turn it off under Host Game → TV screens → *Show the winner's name*.
Names never appear on the "Not a Bingo" screen.

Phones must be on the **same Wi-Fi** as the laptop. Players use a plain link that shows no
security warning, and they can't control the game: only you, the host, can.

---

## 9b. Low-end laptops — Low Resource Mode

Anthem Square is designed to run a full night on a **4 GB Windows laptop with
integrated graphics**. With 4 GB or less, the Dashboard suggests turning on **Low Resource
Mode** (Settings → ⚡ Performance). It keeps **every game feature**: TV video, title overlay,
winning patterns, crawler, phone remote, BINGO checks and saving. It reduces:
- animations, glows, blur and shadows on the laptop and the TV, and lighter confetti;
- background work while a game is live. Loudness analysis, video conversion and checks of
  newly imported videos wait until the game ends (the TV video always comes first);
- how often the laptop screen refreshes the progress bar and re-checks video files.

**Smaller copies of big videos.** 1080p and 4K videos are the hardest thing for a slow
laptop. Settings → ⚡ Performance → **Make 720p copies** creates a 720p copy of every video
above 720p in the app's data folder. Your original files are never changed, and a song's
**Edit** window has *Use the original file again*.

Tips for 4 GB laptops:
- Close the web browser and other apps before the night.
- Plug the laptop in and use Windows' **Best performance** power mode.
- MP4 with H.264 video plays most smoothly. Most laptops decode it in hardware.

## 10. Phone tips — including Galaxy Fold
The remote fits any phone. On a **Galaxy Fold's cover screen** it switches to a compact
layout. **Unfolded**, it uses two columns: playback beside Up Next, and the BINGO keypad
beside the card result. Add it to your home screen for an app-style icon.

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| Phone can't connect | Same Wi-Fi as the laptop? Some venue/guest Wi-Fi blocks devices from talking to each other; use a phone hotspot or travel router. Allow the app in Windows Firewall (Private). Try another address listed on the Mobile screen. |
| No sound on the TV | Settings → Video & TV → Audio output → choose the HDMI/TV device, or set it as Windows' default. |
| TV shows nothing | Open the audience window (Host Game) and press F; check Win + P is set to **Extend**. |
| Video won't play | Convert to MP4 (H.264/AAC) with HandBrake, then Relink; or grant Technical Credit for tonight. |
| Video stutters on an older laptop | Turn on Low Resource Mode, make 720p copies (Settings → ⚡ Performance), close other apps, plug in the charger. |
| Where is this video file? | Music Library → 📂 next to the song (or Edit → 📂 Show in folder). File Explorer opens with the video highlighted. If it was moved or its drive is unplugged, you're told and offered **Relink**. |
| Card text too small | Set a shorter **Printed title** for long songs **before locking**, or raise the card text size. |
| QR scan on the phone | The phone takes a photo of the QR code (works on any connection). Typing the number always works too. |
