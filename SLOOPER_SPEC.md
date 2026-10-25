# Slooper — build instructions for Claude Code

## Goal

The app is called **Slooper**. It's for the dance group Slugah, which is slug-themed. Keep the slug mark in the header, and keep the dark red-and-black theme from the prototype: black ground, Slugah red (#e5232d) for loop markers, buttons and the lit count. Use the slug for the home-screen icon too.


A phone-first web app for practicing dance choreography. It loops one section of a YouTube video (or a local clip), changes speed without changing pitch, counts in eights (1 & 2 & … 8 &), and starts each loop with a short lead-in.

The user is a single dancer practicing on an iPhone in Safari. Optimize for that. Keep it simple and fast to operate from a few feet away.

## Starting point

`index.html` (attached) is a working single-file prototype. Use it as the base and keep its behavior and visual design unless a section below changes them. It already has:

- **Local clip mode.** Load a video or audio file and get:
  - a waveform drawn from decoded audio (Web Audio `decodeAudioData`);
  - automatic beat tracking (onset envelope, then autocorrelation tempo with a 120 BPM prior, then Ellis-style dynamic-programming beat tracking).
- **YouTube mode.** Uses the IFrame Player API, with a timeline but no waveform. The beat grid comes from "Tap beat": tap along, then a least-squares fit gives period and phase in media time.
- **Loop markers.** One loop window, A to B:
  - drag the markers on the timeline;
  - ‹ › nudges move by one beat when snapping is on, otherwise one second;
  - "Set to playhead" places a marker at the current position;
  - markers snap to beats when "Snap to beats" is on.
- **Count anchoring.** "1" is the beat nearest A. Counts run 1–8 with "&" halfway between beats. They appear as numbers above the timeline's beat lines and in a numbered strip that lights the current slot.
- **Speed.** 50–150% in 5% steps. Clip mode uses `playbackRate` with `preservesPitch`.
- **Lead-in.** An optional 3 real seconds before A, so the media pre-roll is `3 × rate`. If no beats are detected, a 3-2-1 overlay counts down.
- **Other controls:**
  - Repeat toggle (off means stop at B, and Play starts the next round);
  - "Whole / Zoom to loop" timeline view;
  - screen wake lock while playing.
- **Persistence.** Per video or clip, saved in `localStorage`: A, B, speed, toggles, and tapped beat grid.

## Tasks

### 1. Make it a real deployable site

- Set it up as a small static site. Keep it a single page; splitting CSS/JS into files is fine. No framework is needed.
- Deploy to GitHub Pages, with a GitHub Actions workflow or Pages from the main branch.
- Add a web app manifest and icons so it can be added to the iPhone home screen and opens full-screen. Skip a service worker unless it's trivial. YouTube needs the network anyway.

### 2. Verify and harden YouTube mode on iOS Safari

This was written blind: the prototype was never run against the live YouTube player.

- Confirm the API loads and that the first play from a tap works on iOS, with `playsinline: 1`. Fix any autoplay or gesture issues.
- Check which speeds `setPlaybackRate` accepts in the embedded player on iOS, using `getAvailablePlaybackRates`.
  - If only coarse steps are allowed (0.25 increments), make the speed control offer only valid rates in YouTube mode, and say so in one line.
  - If fine steps work, keep 5% steps.
- Verify the A→B loop and lead-in seeks are reliable. `seekTo` while playing on iOS can stall, so test 20 consecutive loops.
- Handle embed-blocked videos (errors 101/150) with a clear message suggesting clip mode.

### 3. Waveform and automatic beats for YouTube (needs a backend)

A browser page can't read YouTube's audio: the iframe is sealed and media URLs are signed and CORS-blocked. Add a tiny backend:

- **Endpoint:** `GET /analyze?v=<videoId>` returns JSON shaped like `{ duration, peaks: number[] (≈4000, normalized 0–1), beats: number[] (seconds), bpm }`.
- **Implementation:**
  - fetch audio with `yt-dlp` (bestaudio), decode with ffmpeg to mono 22.05 kHz;
  - compute peaks;
  - track beats with `librosa.beat.beat_track`, or port the prototype's algorithm.
- **Caching.** Cache results by video ID (disk or KV) so each video is analyzed once.
- **Hosting.** Pick something cheap that can run yt-dlp and ffmpeg: a small Fly.io or Render container, or a local-only mode the user runs on their laptop. Document the choice. Not Vercel/Netlify functions, which have no ffmpeg and short timeouts.
- **Frontend behavior:**
  - in YouTube mode, request `/analyze` after the player loads;
  - draw the waveform and use detected beats when the response arrives;
  - keep Tap beat as an override;
  - if the backend is unreachable or fails, fall back silently to the current behavior.
- Note in the README that downloading YouTube audio may conflict with YouTube's terms, and that yt-dlp needs occasional updates when YouTube changes.

### 4. Beat-grid quality-of-life

- **Shift the "1".** Add a small control that moves which beat counts as "1" by ±1 beat without moving A. Currently "1" is always the beat nearest A.
- **Half/double tempo.** One tap to halve or double the detected tempo. Beat trackers often lock to the wrong octave.
- **Tempo drift.** The tap grid is a constant tempo. Optionally, re-fit locally from the most recent taps if counts drift late in a song.

### 5. Optional, only if quick

- An optional audible click on beats or "1"s during the lead-in only.
- Big-text mode for the count strip when the phone is propped up across the room.

## Out of scope

Don't build these: mirror mode, recording yourself, multiple saved loops, accounts, Spotify (DRM-protected; not possible).

## Acceptance checks

1. **iOS YouTube loop.** On an iPhone in Safari, open the deployed URL and paste `https://youtu.be/Mwi9E-ztPuU`. Set A≈0:20 and B≈0:44 at 70% speed with lead-in on. It loops at least 20 times without stalling, and each round starts about 3 seconds before A.
2. **YouTube waveform and counts.** With the backend running, the same video shows a waveform and beat grid within about 30 s of first load, and instantly on reload. The count strip lights 1 & 2 & … in time with the music.
3. **Clip mode.** Loading a screen recording still gets the waveform and beats with no backend.
4. **Persistence.** Reloading the page restores A, B, speed, and the beat grid for that video.
