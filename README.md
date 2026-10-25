# Slooper

Slooper is a small web app for practicing dance choreography. It was made for the dance group Slugah. It loops one section of a YouTube video or a local clip, slows it down without changing the pitch, counts in eights (1 & 2 & … 8 &), and starts each loop with a short lead-in.

It is built for one dancer practicing on an iPhone in Safari. It is a plain static site with no framework and no build step.

## How to use it

1. Pick a song from the **Songs** list, or tap **Load clip** to open a video or audio file from your phone. A screen recording works. The list puts the song you used last at the top. After a song loads, the list folds up. Tap **Songs** to open it again.
2. Drag the red A and B markers on the timeline to choose the section to loop. The ‹ and › buttons move a marker by one beat, and **Set to playhead** puts it where the video is now. **Undo** puts the markers back where they were before your last change. Press it again to step further back. Drag anywhere else on the timeline to scroll it, and tap to jump there. The − and + buttons zoom out and in, **Fit loop** shows the whole loop, and **Fit song** shows the whole song. The zoom stays where you put it, and while the song plays the timeline turns a page when the playhead reaches the edge. Thin lines mark each "1".
3. Set the speed and press **Play**. To type a speed, tap the percentage. With the lead-in on, each loop starts 3 seconds before A.

The count strip lights up the current count. The "1" belongs to the song, so it stays on the same beat wherever you put A. The label next to A shows which count A is on. If the counts are off:

- **½× tempo** and **2× tempo** fix a beat grid that runs at half or double the real speed.
- **Move the 1** shifts which beat counts as "1" by one beat, for the whole song. Set it once and it stays.
- **Tap beat** lets you tap along with the music to set your own beat grid. Your tapped grid wins over the detected beats. **Use detected** goes back to the detected beats.

Other options are **Lead-in click**, which plays a click on each beat of the lead-in, and **Big count**, which makes the count strip large enough to read from across the room. Note that the iPhone silent switch mutes the click.

Slooper remembers the loop points, speed, beat grid and count settings for each video on your phone.

To put it on your home screen, open the site in Safari, tap Share, then tap **Add to Home Screen**. It then opens full screen.

## Waveforms and beats

Clips get a waveform and beats right away, because the app reads the audio in the browser.

A web page can't read the audio of a YouTube video. So for YouTube, the waveform and beats come from a file that is made ahead of time on a laptop and committed to this repo. Each song has a file `analysis/<videoId>.json`. The file `analysis/index.json` lists all the songs, and the app shows that list.

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
