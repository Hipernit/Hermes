# Hermes prototype

Peer skill exchange prototype for TSA Software Development. People list what they can teach and what they want to learn, introduce themselves, chat once connected, plan sessions, practice with a timer and keep a personal learning journal.

## Run locally

Requires Python 3 and a modern browser. From this folder:

```sh
python -m http.server 8000 --directory dist
```

On Windows, `py` can replace `python`. Visit http://localhost:8000. No npm installation or build step is required. The app uses JavaScript modules, so it must be served from localhost (or any static host). Opening `index.html` directly from disk shows a notice instead of the app.

## Contents

- `dist/index.html`: page shell. `dist/css/app.css`: styles. `dist/js/`: source modules (see `CLAUDE_HANDOFF.md` for what each one does). Despite the directory name, nothing here is compiled; edit the files directly.
- `dist/i18n/`: one translation file per language. `en.js` is the source; the others were written with AI assistance and have not yet been reviewed by native speakers.
- `dist/fonts/`: self-hosted fonts and their license notices.
- `tests/`: automated rule tests (Node) and a browser walkthrough (Playwright).
- `CLAUDE_HANDOFF.md`: product decisions, architecture, implemented behavior, limitations and development priorities.

## Demo walkthrough

1. As Eric, open Discover and choose "Introduce yourself & connect" on Maya's row.
2. Switch to Maya with the demo profile dropdown, open Connections and accept.
3. Message Eric, then switch back to see the red unread indicator.
4. From the conversation, choose "Plan a session". Pick one of the suggested shared times, add a goal and send. Switch to Maya to accept.
5. Try "Suggest another time", then "Start practice": the role line switches from learning to teaching at the learning share. Save a learning record with confidence before and after and a "practice next" step.
6. Open Progress as Eric, then as Maya to see the feedback that was shared with her.

7. Choose "Display & language" in the top bar to switch between light, dark and device themes, change the language (16 languages, including Arabic right to left), enlarge text, or turn on a readable font, high contrast, reduced motion, underlined links and wider spacing.

Tip: open a second tab and choose a different profile there. Each tab keeps its own profile, and messages appear in the other tab as they are sent.

Demo data persists in this browser's localStorage (`skillswap3`, plus `skillswap3-drafts` for unsent chat drafts). Display, language and accessibility settings are kept separately under `hermes-prefs`. Clearing site data resets changes; a legacy `skillswap1` key may also be present. Profile switching is a demo mechanism, not authentication.

The app is a frontend prototype. It has no production backend, real sign-up, email delivery or cross-device messaging. Experimental video only connects two tabs of the same browser; cross-device calling is not implemented. See the handoff before extending it.

## Tests

```sh
node --test tests/*.test.mjs                  # rules, plus a completeness check for every translation
python3 tests/e2e.py http://localhost:8000/   # with the server above running; needs Playwright
```

Git history, hosting-specific configuration, credentials and browser data are excluded. Retain the included font licenses when distributing the project.
