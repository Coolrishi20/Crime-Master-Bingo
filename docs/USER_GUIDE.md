# Crime Master Bingo — Host Guide

Crime Master Bingo runs music-video bingo nights from a Windows laptop. The laptop
plays every video and all the sound; the TV or projector shows the audience screen;
your phone is a remote control. No internet connection or account is needed.

---

## 1. Before the night (about 15 minutes)

### Install
Run **CrimeMasterBingo-Setup-1.0.0.exe** (or use the portable EXE, which needs no
install). Windows may show *"Windows protected your PC"* because the app is not
code-signed yet. Click **More info → Run anyway**.

The first time the phone remote starts, Windows Firewall asks about network access:
tick **Private networks** and click **Allow**.

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

Diagonals never count. Players keep the same card for all three rounds and songs stay
marked.

Start Round 1 from the laptop (**Rounds** panel) or the phone (**Rounds** tab). Rounds
always go in order: 1 → 2 → 3.

**Moving to the next round.** As soon as you confirm a winner, a green banner appears on
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

Phones must be on the **same Wi-Fi** as the laptop. Players use a plain link that shows no
security warning, and they can't control the game: only you, the host, can.

---

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
| Card text too small | Set a shorter **Printed title** for long songs **before locking**, or raise the card text size. |
| QR scan on the phone | The phone takes a photo of the QR code (works on any connection). Typing the number always works too. |
