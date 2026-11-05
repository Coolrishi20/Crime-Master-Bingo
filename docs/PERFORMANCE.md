# Anthem Square (formerly Crime Master Bingo) — Performance report

This report covers the Phase 1 fixes for tester feedback: high RAM use, stuttering video
(worse with the phone remote), Show in Folder, and custom Bingo rules. **All numbers below
were measured. Nothing is estimated.** The test environment is not a Windows laptop; see
*Limits of these measurements* before reading them as Windows numbers.

## How it was measured

`test/perf/hosting-bench.js` runs the **whole system at once**, the way a host uses it.
Isolated component benchmarks were not used.

- the laptop app (host window, 1366×768);
- the audience/TV window at 1920×1080, playing **1080p30 H.264/AAC music videos (~6 Mbps)**
  with the title/artist overlay, the winning-pattern panel and the scrolling played-song
  crawler;
- a **phone host remote** (a separate mobile browser) connected over the local network,
  which presses real buttons in the remote's UI;
- a 100-video library, a 100-song playlist and 100 cards.

The Electron app is **pinned to 2 CPU cores** (`taskset`) to approximate an entry-level
dual-core laptop. The phone runs on the other cores, as a separate device would.

| Phase | What happens |
|---|---|
| startup / idle | app opened, nothing loaded |
| import 40 → import 100 | videos imported and checked, then the library screen opened |
| pdf100 | PDF of 100 cards (50 A4 pages) |
| **T1a** | TV playing, overlay + pattern + crawler, no phone (40 s) |
| **T1b** | the same with the phone connected (40 s) |
| **T2** | phone used every 3 s while the TV plays: pause, resume, volume, replay, crawler speed, history and rounds tabs, next (60 s) |
| **T3** | BINGO check from the phone: claims frozen, card entered, result checked against an independent rule check, resume |
| **T6** | phone loses Wi-Fi for 20 s, then reconnects and controls playback again |
| **T4** | extended hosting to **75 songs**, rounds advanced from the phone, claims verified, phone used every 10 s |

The metrics are:
- **RAM:** working set summed over every Electron process (`app.getAppMetrics()`), plus the
  whole process tree including ffmpeg.
- **CPU:** summed % of one core.
- **Dropped frames:** `getVideoPlaybackQuality()` in the TV window, accumulated across songs.
- **TV stalls:** animation-frame gaps over 50 ms in the TV renderer.
- **Unexpected reloads:** video loads not requested by the game engine.
- **Main-process freezes:** event-loop lag.
- **Traffic:** IPC per window and WebSocket bytes to the phone.
- **Durable disk writes:** fsync count.
- **Phone command latency:** button → acknowledgement.

## Results

**Test PC:** Linux 6.18 container, Intel Xeon @ 2.30 GHz, 4 vCPUs (the app pinned to **2**),
16 GB RAM, **no GPU** (software rendering and software video decoding, Xvfb display).
**Builds:** v1.4.2 (baseline, commit 2401d70) and v1.5.0-rc.1, both run from source with
Electron 33. **Video:** 100 synthetic 1080p30 H.264 High + AAC 192k clips, ~6 Mbps, 12 s each.
**Duration:** about 18 minutes per run (75 songs). The three runs were done one after another
on the same machine, with nothing else heavy running during them.

| Metric | baseline-v1.4.2 | v1.5.0-rc.1 | v1.5.0-rc.1 (Low Resource) |
|---|---|---|---|
| Startup RAM (all app processes) | 493 MB | 497 MB | 491 MB |
| Idle RAM | 494 MB | 497 MB | 491 MB |
| After importing 40 videos | 993 MB | 821 MB | 807 MB |
| After importing 100 videos (library open) | 1284 MB | 850 MB | 837 MB |
| Main-process freeze during import (max event-loop lag) | 6 ms | 8 ms | 7 ms |
| PDF of 100 cards: time | 2 s | 1 s | 1 s |
| Playback RAM, TV only (T1a avg) | 1630 MB | 947 MB | 905 MB |
| Full system: TV video + overlay + crawler + phone connected (T1b avg) | 1663 MB | 1035 MB | 943 MB |
| Active phone commands + TV video (T2 avg) | 1693 MB | 1069 MB | 988 MB |
| Peak RAM (whole run) | 1800 MB | 1244 MB | 1181 MB |
| RAM after the extended session | 1242 MB | 1065 MB | 1036 MB |
| RAM growth over the extended session (last quarter − first quarter) | -304 MB | 3 MB | 34 MB |
| CPU, full system (T1b avg, % of one core, summed) | 52% | 43% | 30% |
| CPU, active phone commands (T2 avg) | 46% | 40% | 29% |
| CPU, extended session (T4 avg) | 45% | 45% | 34% |
| Dropped video frames, TV only (T1a) | 16/1094 (1.5%) | 15/1085 (1.4%) | 5/1097 (0.5%) |
| Dropped video frames, phone connected (T1b) | 21/1090 (1.9%) | 13/1089 (1.2%) | 6/1101 (0.5%) |
| Dropped video frames, active phone commands (T2) | 28/1551 (1.8%) | 13/1554 (0.8%) | 8/1536 (0.5%) |
| Dropped video frames, extended session (T4) | 336/22674 (1.5%) | 347/22684 (1.5%) | 115/22688 (0.5%) |
| TV renderer stalls > 50 ms per min (T2) | 5.9 | 1 | 0 |
| Unexpected video reloads (T2 + T4) | 0 | 0 | 0 |
| Phone command latency (T2) | median 14 ms / max 14 ms (n=12) | median 13 ms / max 14 ms (n=12) | median 14 ms / max 15 ms (n=12) |
| Data sent to the phone while idle (T1b) | 218.8 KB/min | 248.6 KB/min | 248.5 KB/min |
| Data sent to the phone during commands (T2) | 334.3 KB/min | 344.1 KB/min | 380.3 KB/min |
| Full state updates sent to the TV during phone commands (T2) | 21/min | 15/min | 18/min |
| Host-window state traffic during phone commands (T2) | 473.1 KB/min | 469.5 KB/min | 518.8 KB/min |
| Durable disk writes (fsync) while playing (T1b) | 76/min | 18/min | 10/min |

**baseline-v1.4.2** — integrated checks: 12/12 passed; duration 18 min; songs played 75
**v1.5.0-rc.1** — integrated checks: 10/10 passed; duration 18 min; songs played 75
**v1.5.0-rc.1 (Low Resource)** — integrated checks: 12/12 passed; duration 18 min; songs played 75

How to read the table:
- **RAM** is the sum of working sets of all app processes (main, GPU, utilities, host
  window, TV window, and the probe window while it's open).
- **CPU** is the sum over processes, as a % of one core; the app has 2 cores (200%).
- **Unexpected video reloads** are loads the game engine didn't ask for. Song changes and
  Replay after a song ended are normal loads, counted separately.
- **Main-process freeze during import:** this run had a warm disk cache (6–8 ms in all
  builds). In a **cold-cache run of v1.4.2** (just after a container restart, closer to a
  first import from a USB drive), the main process froze for **13,082 ms** (40 videos) and
  **13,512 ms** (100 videos). The 1.5 import reads files asynchronously and yields between
  files, so one slow file can only block for that file's read. A cold-cache run of 1.5 was
  not repeated, so the size of that improvement on a slow USB drive is **not measured**.
- **Data sent to the phone did not go down** (~250–380 KB/min, about 5 KB/s). 1.5 sends the
  per-round rules to the remote, and the updates that remain are real changes (song
  start/end, pause, volume). Command latency stayed at ~14 ms, and TV stalls during phone use
  fell from 5.9/min to 1/min (0 in Low Resource Mode). So phone traffic was not the cause of
  the stutter; the full-state fan-out to the windows and the work around it was.
- **Full state updates sent to the TV** only fell from 21 to 15 per minute, because song
  changes, pause/resume and round changes legitimately update the TV. Volume and crawler-speed
  taps no longer re-send the TV's state.

## What caused the problems (evidence from the v1.4.2 baseline) and what changed

| Finding in v1.4.2 (measured) | Cause | Fix in 1.5 |
|---|---|---|
| Host window grew from **146 MB to ~880 MB** after importing 100 videos | every imported 1080p video was decoded in the host window to read its length and take a thumbnail; Chromium kept the media buffers | videos are checked in a **separate hidden window** that's closed after a batch (memory returned) and never decodes while a song plays |
| Main process frozen for **up to 13.5 s** during import (cold disk) | synchronous file reads (fingerprint) for every file on the main thread | asynchronous reads, yielding between files |
| Every phone tap re-sent the full state to the host (~22 KB), the TV and every phone | each engine change fanned out full states to everything | one coalesced update per command; each window/phone only gets a state that actually changed; a volume/crawler tap no longer reaches the TV |
| **~1 fsync per second** while just playing | the whole game file was re-serialised and flushed every ~2 s to save the playback position | position saved to a tiny side file without fsync; real changes still saved immediately |
| Loudness analysis and conversion ran during the game | background queue had no notion of "live game" | during a live game only the next songs are analysed; conversion waits while a song plays; Low Resource Mode holds both until the game ends |
| Replay reloaded the whole video | engine always re-loaded the file | Replay **seeks** when the TV still has the song loaded |
| The host screen rebuilt its 100-row lists on every update | no change detection | lists rebuild only when their own data changes; library shows 200 rows per page |

## Limits of these measurements (read before trusting the numbers)

- **Not Windows.** Linux container, 4 virtual CPUs (2 used by the app), 16 GB RAM,
  **no GPU** (software rendering and software video decoding under Xvfb). On a Windows laptop
  with integrated graphics, Chromium normally decodes H.264 in hardware. CPU use and dropped
  frames there should be **lower**, but that is **not measured** here.
- RAM figures are Linux working sets. Windows reports memory differently (private bytes /
  commit) and typically shows different absolute values, so compare **before vs after**, not
  absolute values against Windows Task Manager.
- **A 4 GB RAM machine was not available.** The app is designed to fit (see the numbers),
  but **the 4 GB / 8 GB / 16 GB / 2 GB hardware matrix is still outstanding** and must be run
  on real laptops. At the owner's request, 1.7.0 is published as a full release (it has run
  smoothly on a 32 GB Windows laptop). The 4 GB check is still recommended and has not been done.
- Test videos are synthetic 1080p30 H.264/AAC at ~6 Mbps, 12 s each, so 75 songs take
  about 17 minutes. A real night with 3-minute songs is longer; the 75-song run checks for
  growth over many song changes, not hours of wall-clock time.
- The phone is a mobile browser on the same machine (local network), not a real phone on
  Wi-Fi. Wi-Fi loss was simulated with the browser's offline mode.

## v1.6.0-rc.1: Rules Checklist Mode vs Round-Based (same conditions)

Rules Checklist Mode adds a checklist to the TV, the host screen and the phones. To check that
it costs nothing extra, the integrated benchmark was run twice, back to back, on the same
machine: once as a **Round-Based** game and once as a **Rules Checklist** game (5 rules). Both
runs used Low Resource Mode, 2 pinned cores, 1080p video, the phone remote and 75 songs, with
claims checked and awarded from the phone (`GAME=rounds|checklist`).

| Metric | Round-Based | Rules Checklist |
|---|---|---|
| Playback RAM, TV only (T1a avg) | 903 MB | 902 MB |
| Full system with phone (T1b avg) | 948 MB | 949 MB |
| Peak RAM (extended session) | 1190 MB | 1187 MB |
| CPU, full system (T1b avg) | 46% | 48% |
| CPU, extended session (T4 avg) | 49% | 48% |
| Dropped frames, extended session (T4) | 203/22997 (0.9%) | 193/22690 (0.9%) |
| TV stalls > 50 ms, extended session (T4) | 52 | 46 |
| Unexpected video reloads | 0 | 0 |
| Data to the phone while idle (T1b) | 264 KB/min | 314 KB/min |
| Data to the phone during commands (T2) | 395 KB/min | 456 KB/min |
| Integrated checks | 10/10 passed | 14/14 passed |

- **The checklist mode costs the same RAM, CPU and frame rate as Round-Based.**
- Phone traffic is about 15–20% higher in checklist mode, because the phone receives the
  checklist with its winners. That's about 1 KB/s more, with no measurable effect on the TV.
- **These two runs are not comparable with the 1.5 table above.** On the same day the
  machine was slower: CPU for the *unchanged* Round-Based mode was 46% instead of 31%, and
  video import took about 4× longer. Only compare the two columns of this table with each
  other.
- The "one song away" count is now recalculated only when a song is played or a winner
  changes. Building the TV state costs about 0.1 ms per update in either mode (measured with
  100 cards issued).

**Field report (4 Nov 2026):** the host ran 1.6.0-rc.1 on a real **Windows laptop with 32 GB
of RAM**: smooth playback, no stuttering. That's encouraging, but it says nothing about the
4 GB target. The real-hardware checks below are still needed. A 4 GB / 2-core limit can be
simulated on a bigger laptop with *msconfig → Boot → Advanced options*. That's useful, but it
doesn't reproduce a slow processor or graphics.

## v1.7.0-rc.1: the Anthem Square redesign vs 1.6 (same conditions)

The redesign must not make hosting heavier. The integrated benchmark was run twice, back to
back, on the same machine: the unchanged **1.6.0-rc.1** build first, then **1.7.0-rc.1**.
Both runs used a Round-Based game, Low Resource Mode, 2 pinned cores, 1080p video with
overlay and crawler, the phone remote in use and 75 songs with claims.

| Metric | 1.6.0-rc.1 | 1.7.0-rc.1 (Anthem Square) |
|---|---|---|
| Playback RAM, TV only (T1a avg) | 907 MB | 889 MB |
| Full system with phone (T1b avg) | 948 MB | 937 MB |
| Peak RAM (extended session) | 1178 MB | 1165 MB |
| CPU, full system (T1b avg) | 47% | 46% |
| CPU, extended session (T4 avg) | 48% | 48% |
| Dropped frames, extended session (T4) | 186/22690 (0.8%) | 146/22686 (0.6%) |
| TV stalls > 50 ms, extended session (T4) | 44 | 24 |
| TV stalls > 50 ms, active phone commands (T2) | 3 | 0 |
| Unexpected video reloads | 0 | 0 |
| Data to the phone (T1b idle / T2 commands) | 264 / 402 KB/min | 264 / 422 KB/min |
| Integrated checks | 10/10 | 10/10 |

- **No regression.** The new look uses slightly less memory (about 10–18 MB) and the TV had
  fewer stalls, which fits the removal of the blur and glow effects on the TV panels. CPU is
  unchanged.
- Phone data during commands is about 5% higher (the theme travels with the state). That is
  about 0.3 KB/s, with no measurable effect.
- Same caveats as above: Linux container, no GPU, not a 4 GB Windows laptop.

## Still to test on real hardware (release gate for 1.5.0 final)

1. A 4 GB Windows 10/11 laptop with integrated graphics, Low Resource Mode on: the full
   simultaneous test (TV on HDMI, phone on Wi-Fi, crawler, 75+ songs, claims, 3 rounds).
2. The same laptop with Low Resource Mode off, for comparison.
3. 8 GB and 16 GB laptops with standard settings. A 2 GB laptop as a best-effort check.
4. **Show in Folder in the installed Windows EXE**, including a USB stick, a network share
   and a Unicode file name.
5. Real phones (Android and iPhone) on venue Wi-Fi, including walking out of range.

## Known hardware, codec and resolution limits

- **Recommended video:** MP4 with **H.264** video and AAC audio, **1080p or lower**. Windows
  laptops with Intel/AMD integrated graphics from roughly 2013 onwards decode this in
  hardware.
- **4K, HEVC/H.265, 10-bit or 60 fps** videos may stutter on low-end laptops even when
  everything else is idle. Use *Settings → Performance → Make 720p copies*, or convert them.
- **4 GB laptops:** turn on Low Resource Mode, close browsers and other apps, plug in the
  charger and choose Windows' *Best performance* power mode.
- **2 GB laptops:** not supported. The app may run, but Windows alone uses most of the memory.
