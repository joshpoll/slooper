#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "librosa>=0.10",
#     "numpy",
#     "scipy",
# ]
# ///
"""Precompute Slooper analysis (waveform peaks + beats) for YouTube videos.

Usage: uv run tools/analyze.py <youtube-url-or-id> [more ...] [--force]

Writes analysis/<videoId>.json next to this repo's tools/ directory:
  {"title": str, "duration": s, "peaks": [0..1 x ~4000], "beats": [s, ...], "bpm": n}
and then rebuilds analysis/index.json, the song list the app shows:
  [{"id": str, "title": str, "duration": s}, ...]  (sorted by title)

A video whose JSON already exists is skipped; if that JSON has no title yet,
only the title is fetched and added.

yt-dlp and ffmpeg are called as external binaries (Homebrew), so updating
yt-dlp is just `brew upgrade yt-dlp` and never depends on a pinned Python
package in uv's cache.
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

SR = 22050
N_PEAKS = 4000
HOP = 512
FIT_BEATS = 8  # beats either side used to fit each beat's time
ATTACK_WINDOW = 0.1  # s either side of a tracked beat to look for its kick
START_BPM = 120.0
SILENCE_DB = 40  # below peak; quieter audio at either end counts as silence
OUT_DIR = Path(__file__).resolve().parent.parent / "analysis"

ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
URL_PATTERNS = [
    re.compile(r"youtu\.be/([A-Za-z0-9_-]{11})"),
    re.compile(r"[?&]v=([A-Za-z0-9_-]{11})"),
    re.compile(r"/(?:shorts|embed|live|v)/([A-Za-z0-9_-]{11})"),
]


class AnalyzeError(Exception):
    pass


def parse_video_id(s: str) -> str:
    s = s.strip()
    if ID_RE.match(s):
        return s
    for pat in URL_PATTERNS:
        m = pat.search(s)
        if m:
            return m.group(1)
    raise AnalyzeError(f"could not find a YouTube video ID in {s!r}")


def yt_dlp_error(video_id: str, proc: subprocess.CompletedProcess) -> AnalyzeError:
    detail = (proc.stderr or proc.stdout).strip() or f"exit code {proc.returncode}"
    return AnalyzeError(
        f"yt-dlp failed for {video_id}:\n{detail}\n"
        "YouTube changes often; try `brew upgrade yt-dlp` and run again."
    )


def download_audio(video_id: str, tmp: Path) -> tuple[Path, str]:
    """Download the audio and return (file, video title)."""
    cmd = [
        "yt-dlp",
        "--no-playlist",
        "--quiet",
        "--no-warnings",
        "--print", "title",
        "--no-simulate",
        "-f", "bestaudio/best",
        "-o", str(tmp / "audio.%(ext)s"),
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    files = [p for p in tmp.glob("audio.*") if not p.name.endswith(".part")]
    if proc.returncode != 0 or not files:
        raise yt_dlp_error(video_id, proc)
    return files[0], proc.stdout.strip()


def fetch_title(video_id: str) -> str:
    cmd = ["yt-dlp", "--no-playlist", "--no-warnings", "--print", "title",
           f"https://www.youtube.com/watch?v={video_id}"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise yt_dlp_error(video_id, proc)
    return proc.stdout.strip()


def decode_audio(path: Path) -> np.ndarray:
    # Decode to mono float32 PCM at SR on stdout. ffmpeg applies the
    # container's encoder-delay trimming, so sample 0 is media time 0.
    cmd = [
        "ffmpeg", "-v", "error", "-nostdin", "-i", str(path),
        "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise AnalyzeError(f"ffmpeg failed: {proc.stderr.decode(errors='replace').strip()}")
    y = np.frombuffer(proc.stdout, dtype=np.float32)
    if y.size < SR:
        raise AnalyzeError("decoded audio is shorter than one second")
    return y


def compute_peaks(y: np.ndarray, n: int = N_PEAKS) -> list[float]:
    n = min(n, y.size)
    edges = np.linspace(0, y.size, n + 1).astype(np.int64)
    peaks = np.maximum.reduceat(np.abs(y), edges[:-1])
    top = float(peaks.max())
    if top > 0:
        peaks = peaks / top
    return [round(float(v), 3) for v in peaks]


def kick_envelope(y: np.ndarray) -> np.ndarray:
    """Amplitude envelope of the kick-drum band (40-150 Hz), one value per sample.

    Both filters run forwards and backwards (zero phase), so the envelope is
    not delayed against the audio.
    """
    from scipy.signal import butter, hilbert, sosfiltfilt

    band = sosfiltfilt(butter(4, [40, 150], btype="band", fs=SR, output="sos"), y)
    return sosfiltfilt(butter(2, 60, fs=SR, output="sos"), np.abs(hilbert(band)))


def kick_attack(env: np.ndarray, t: float) -> float | None:
    """Time of the kick attack within ATTACK_WINDOW of t, or None if no clear kick.

    Finds the steepest rise of the envelope, follows it down to where the rise
    starts and up to its peak, and returns the moment the envelope has climbed
    10% of the way. That point is where the kick body becomes audible, a few
    ms before its steepest rise. (The kick's high click, and claps, can start
    a few ms earlier still; this low-band point is the robust one to find.)
    """
    a = max(0, int((t - ATTACK_WINDOW) * SR))
    e = env[a:int((t + ATTACK_WINDOW) * SR)]
    if e.size < 3:
        return None
    i = j = int(np.argmax(np.diff(e)))
    while i > 0 and e[i - 1] < e[i]:
        i -= 1
    while j < e.size - 1 and e[j + 1] > e[j]:
        j += 1
    lo, hi = e[i], e[j]
    if hi < 2 * lo:  # less than a doubling: no kick here
        return None
    return (a + i + int(np.argmax(e[i:j + 1] >= lo + 0.1 * (hi - lo)))) / SR


def compute_beats(y: np.ndarray) -> tuple[float, list[float]]:
    import librosa

    # Track only over the non-silent span of the audio, with librosa's own
    # edge trimming off: on long tracks it can drop tens of seconds of loud
    # music at the end. Times are shifted back so they stay in media time.
    # Onsets come from the kick-drum band only (below 150 Hz). Full-band onsets
    # let loud hats and claps on the "&" pull the tracker half a beat off.
    start, end = librosa.effects.trim(y, top_db=SILENCE_DB)[1]
    onset_env = librosa.onset.onset_strength(y=y[start:end], sr=SR, hop_length=HOP, fmax=150, n_mels=32)
    _, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=SR, hop_length=HOP, start_bpm=START_BPM, trim=False
    )
    coarse = librosa.frames_to_time(beat_frames, sr=SR, hop_length=HOP) + start / SR

    # The tracker decides which beat is which, but its times sit on a 23 ms
    # frame grid and trail the kick by tens of ms. Measure the kick attack
    # near each beat on the raw samples, then place each beat on a straight
    # line fitted through the attacks of its neighbours. Dance tracks keep a
    # steady tempo, so the line removes jitter and outvotes misreadings (a
    # bass note taken for a kick, a beat with no kick) while still following
    # slow tempo changes. Theil-Sen keeps the fit robust to those misreadings.
    env = kick_envelope(y)
    attacks = np.array([np.nan if (a := kick_attack(env, t)) is None else a for t in coarse])
    if np.isnan(attacks).all():
        raise AnalyzeError("no kick drum found to place the beats on")
    times = np.empty_like(coarse)
    for i in range(coarse.size):
        lo, hi = max(0, i - FIT_BEATS), min(coarse.size, i + FIT_BEATS + 1)
        n = np.arange(lo, hi)[~np.isnan(attacks[lo:hi])]
        if n.size < 4:  # long stretch without kicks: shift the tracked beat
            times[i] = coarse[i] + np.nanmedian(attacks - coarse)
            continue
        a = attacks[n]
        jj, kk = np.triu_indices(n.size, 1)
        slope = np.median((a[kk] - a[jj]) / (n[kk] - n[jj]))
        times[i] = np.median(a - slope * (n - i))
    bpm = 60 / float(np.median(np.diff(times)))
    return round(bpm, 1), [round(float(t), 3) for t in times]


def analyze(video_id: str) -> dict:
    with tempfile.TemporaryDirectory(prefix="slooper-") as d:
        audio, title = download_audio(video_id, Path(d))
        y = decode_audio(audio)
    bpm, beats = compute_beats(y)
    return {
        "title": title or video_id,
        "duration": round(y.size / SR, 3),
        "peaks": compute_peaks(y),
        "beats": beats,
        "bpm": bpm,
    }


def write_index() -> Path:
    songs = []
    for p in OUT_DIR.glob("*.json"):
        if p.name == "index.json":
            continue
        d = json.loads(p.read_text())
        songs.append({"id": p.stem, "title": d.get("title") or p.stem, "duration": d.get("duration", 0)})
    songs.sort(key=lambda s: s["title"].casefold())
    out = OUT_DIR / "index.json"
    out.write_text(json.dumps(songs, indent=1, ensure_ascii=False) + "\n")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Precompute Slooper analysis JSON for YouTube videos.")
    ap.add_argument("videos", nargs="+", help="YouTube URLs or 11-character video IDs")
    ap.add_argument("--force", action="store_true", help="re-analyze even if the JSON exists")
    args = ap.parse_args()

    for tool in ("yt-dlp", "ffmpeg"):
        if not shutil.which(tool):
            print(f"error: {tool} not found on PATH (brew install {tool})", file=sys.stderr)
            return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    failed = 0
    for arg in args.videos:
        try:
            vid = parse_video_id(arg)
            out = OUT_DIR / f"{vid}.json"
            if out.exists() and not args.force:
                data = json.loads(out.read_text())
                if not data.get("title"):
                    data = {"title": fetch_title(vid) or vid, **data}
                    out.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
                    print(f"{vid}: added title {data['title']!r}")
                print(f"{vid}: skipped, {out.relative_to(OUT_DIR.parent)} exists (use --force)")
                continue
            result = analyze(vid)
            out.write_text(json.dumps(result, separators=(",", ":"), ensure_ascii=False))
            print(
                f"{vid}: duration {result['duration']:.1f}s, bpm {result['bpm']}, "
                f"{len(result['beats'])} beats, {out.stat().st_size / 1024:.1f} KB "
                f"-> {out.relative_to(OUT_DIR.parent)}"
            )
        except AnalyzeError as e:
            failed += 1
            print(f"error: {e}", file=sys.stderr)
    index = write_index()
    print(f"wrote {index.relative_to(OUT_DIR.parent)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
