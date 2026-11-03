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
