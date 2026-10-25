# Analysis tool

`analyze.py` downloads the audio of a YouTube video and works out its waveform and beats. It writes the result to `analysis/<videoId>.json`, and GitHub Pages serves that file to the app.

## Requirements

You need these programs on your Mac:

- uv, from `brew install uv`
- yt-dlp, from `brew install yt-dlp`
- ffmpeg, from `brew install ffmpeg`

uv installs the Python packages the first time you run the script.

## Usage

Run this from the repo root with one or more YouTube links or video IDs:

```sh
uv run tools/analyze.py https://youtu.be/Mwi9E-ztPuU
```

The script skips a video if its JSON file already exists. Add `--force` to analyze it again.

To publish the new files, commit and push them:

```sh
git add analysis && git commit -m "Add analysis" && git push
```

## Notes

Downloading audio from YouTube may conflict with YouTube's terms of service.

YouTube changes its site often, so yt-dlp needs updates from time to time. If a download fails, run `brew upgrade yt-dlp` and try again.
