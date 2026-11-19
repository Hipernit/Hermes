# Demo video tooling

Regenerates `Hermes-demo.mp4` (about 1:55, 1080p) from the live app.

1. Serve the app: `python3 -m http.server 8102 --directory dist`
2. Record: `python3 demo-video/record.py http://localhost:8102/ /path/to/chrome` (Playwright; writes frames and scene markers next to the script)
3. Draw the cards and captions: `python3 demo-video/cards.py` (Pillow; uses the fonts in `dist/fonts`; edit paths at the top if your folder differs)
4. Edit: `python3 demo-video/build.py` (ffmpeg)

`NARRATION.md` has a timed voiceover script.

Note: the existing `Skillmark-demo.mp4` was recorded before the Hermes rename, so it still shows the Skillmark name and the navy palette. Re-record with `record.py` when ready.
