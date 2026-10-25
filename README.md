# Slooper

Slooper is a small web app for practicing dance choreography. It was made for the dance group Slugah. It loops one section of a YouTube video, slows it down without changing the pitch, counts in eights (1 & 2 & … 8 &), and starts each loop with a short lead-in.

It is built for one dancer practicing on an iPhone in Safari. It is a plain static site with no framework and no build step.

## How to use it

1. When the page opens, it loads the song you used last, or the first song in the list. To switch, tap the song name at the top right and pick another song.
2. Drag the red A and B markers on the timeline to choose the section to loop. The ‹ and › buttons move a marker by one beat, and **Set to playhead** puts it where the video is now. **Undo** puts the markers back where they were before your last change. Press it again to step further back.
3. Set the speed and press **Play**. To type a speed, tap the percentage. With the lead-in on, each loop starts 3 seconds before A.

On the timeline, tap to jump there, and drag anywhere away from the markers to scroll it. To make a new loop, hold a finger still on the timeline for a moment until the A marker appears, then drag to where the loop should end. You can also tap **Set to playhead** under A or B. That makes a loop about 8 beats long, starting or ending at the playhead. Double-tap to clear the loop. With no loop, Play just plays the song from the playhead. **Undo** brings back a loop you cleared or replaced.

On a computer, the space bar plays and pauses. Press it twice quickly to start again from the beginning of the loop (from the lead-in, if it is on). Click the timeline to jump there, and click and drag to make a new loop, like selecting text. Scroll sideways with the trackpad to scroll the timeline. Scroll up and down, or pinch, to zoom in and out around the pointer.

The − and + buttons zoom out and in, **Fit loop** shows the whole loop, and **Fit song** shows the whole song. The zoom stays where you put it. Thin lines mark each "1". While the song plays, the timeline follows the playhead, like a map app following you: the playhead stays at the same spot on the screen and the timeline moves under it. That spot is wherever the playhead was when following started, so after you tap the timeline, the playhead stays where you tapped. When you scroll the timeline yourself, or tap Fit loop or Fit song, it stops following and shows a **Re-center** button. Tap Re-center to put the playhead a quarter of the way in from the left and follow it from there. Play, Restart and tapping the timeline also start following again.

The count strip lights up the current count. The "1" belongs to the song, so it stays on the same beat wherever you put A. The beats and which beat is the "1" come from the song's analysis file. The label next to A shows which count A is on.

Other options are **Lead-in click**, which plays a click on each beat of the lead-in, and **Big count**, which makes the count strip large enough to read from across the room. Note that the iPhone silent switch mutes the click.

Slooper remembers the loop points and speed for each video on your phone.

To put it on your home screen, open the site in Safari, tap Share, then tap **Add to Home Screen**. It then opens full screen.

## Waveforms and beats

A web page can't read the audio of a YouTube video. So the waveform and beats come from a file that is made ahead of time on a laptop and committed to this repo. Each song has a file `analysis/<videoId>.json`. It holds the waveform, the beat times, and an optional field `one`, the index of a beat that is a "1" (0 if it is missing). A song with no analysis file has no beats, so it has no counts and the markers don't snap. With the lead-in on, it shows a 3, 2, 1 countdown on the video instead. The file `analysis/index.json` lists all the songs, and the app shows that list in the song menu.

Slooper used to also open local video and audio files and find their beats in the browser. That was removed to keep the app simple, so the clip-mode items in `SLOOPER_SPEC.md` are dropped on purpose.

## Adding a song

From the repo root, run the analysis script with the YouTube link or video ID. Then commit and push the new files:

```sh
uv run tools/analyze.py https://youtu.be/Mwi9E-ztPuU
git add analysis && git commit -m "Add analysis" && git push
```

The script writes `analysis/<videoId>.json` and updates the song list in `analysis/index.json`. Once GitHub Pages has updated, which takes a minute or two, the song shows up in the list in the app. See `tools/README.md` for what the script needs installed.

Downloading audio from YouTube may conflict with YouTube's terms of service. The script uses yt-dlp, which breaks from time to time when YouTube changes. If it stops working, update it with `brew upgrade yt-dlp`.

## Local development

Serve the project folder and open it in a browser:

```sh
python3 -m http.server
```

Then go to http://localhost:8000. YouTube needs the page to come from a web address, so opening `index.html` as a file won't work.

The app is three files: `index.html`, `style.css` and `app.js`. The icons in `icons/` were made from `icons/icon.svg` with `rsvg-convert`.

## Deploying

The workflow in `.github/workflows/pages.yml` publishes the repo root to GitHub Pages on every push to `main`. To turn it on, go to the repo's Settings, then Pages, and set the source to **GitHub Actions**. The site is then at https://joshpoll.github.io/slooper/.
