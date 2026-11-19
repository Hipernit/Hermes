# Hermes: handoff to Claude

Renamed from SkillSwap to Skillmark, then to Hermes, in Nov 2026. Internal storage keys (`skillswap3`, `skillswap3-drafts`, `skillswap-active-profile`) and the BroadcastChannel prefix keep the old name on purpose so saved demo data still loads.

## What I want you to do

Continue developing this existing prototype. Read the entire source first. Preserve the implemented interactions and the visual direction. Explain actual limitations honestly. Do not replace working flows with decorative buttons or claim that browser-only data is a real multi-user service. Ask before choosing paid services or deploying externally. Run both test suites before and after changes (see "Testing").

## Purpose and audience

This is Eric's TSA high-school Software Development project. The supplied challenge is to develop software that improves how people learn, teach, practice or develop skills. The initial use case is a school-community skill exchange: people list skills they can teach and skills they want to learn, find complementary partners, connect, schedule and teach each other. Measure learning progress as well as time spent.

The official current TSA rubric has not been included in this export. Do not invent rubric requirements or claim compliance without checking the actual event guide.

## Decisions already made

- Keep in-app messaging in Connections instead of requiring Discord.
- Connection requests include an introduction. Accept the connection before scheduling sessions; do not restore a separate cold-booking flow.
- Support multiple custom teach/learn skills, not three presets.
- Support editable weekday/time availability and a readable timezone dropdown, not school-hours presets or memorized timezone identifiers.
- Sessions support an optional note, goals, flexible formats and adjustable teaching time.
- Keep a demo profile switcher so judges can see both sides of requests and conversations.
- Show red unread chat badges.
- Video is desired, with external meeting links as an alternative. A whiteboard remains a requested future feature.
- (Nov 2026) Blocking someone ends the connection, withdraws pending requests and cancels future accepted meetings between the two people. Unblocking restores discovery only.
- (Nov 2026) Removing a connection withdraws pending session requests between the two people; accepted meetings stay and can still be cancelled.
- (Nov 2026) Light, dark and device ("system") themes, 16 interface languages and a set of accessibility settings live behind the "Display & language" button in the top bar. They are per browser, stored under `hermes-prefs`, separate from demo data.
- (Nov 2026) A learning record is private to its author, except the "teaching clarity" rating and an optional feedback comment, which are shown to the partner and labelled as shared in the form.

## Current architecture (refactored Nov 2026)

Buildless vanilla HTML/CSS/JavaScript using native ES modules. No framework, package manager, bundler or server application. Because it uses modules, it must be served over HTTP (see README); opening `index.html` as a file shows a notice instead of the app.

```
dist/
  index.html        Page shell only (sidebar, top bar, #app, dialog). Loads css/app.css and js/app.js.
  css/app.css       All styles. Original rules first, additions below them, media queries last.
  fonts/            Self-hosted URW Bookman, Noto Sans and Atkinson Hyperlegible plus licenses.
  i18n/en.js        Source strings (about 400 keys). Every UI string, status message and rule error comes from here.
  i18n/<code>.js    es, fr, de, pt-BR, it, zh-Hans, zh-Hant, ja, ko, vi, tl, ru, uk, hi, ar. Loaded on demand.
  js/i18n.js        t(key, vars) with {placeholders} and plural objects chosen by Intl.PluralRules; tv() for
                    stored English values (formats, statuses, ratings); language list, browser-language
                    matching, text direction and the Intl locale used for dates and numbers.
  js/util.js        esc(), parseList(), uid() with non-secure-context fallback, small string helpers.
  js/time.js        Wall-clock and UTC conversion, DST gap/repeat rejection, readable zone labels.
  js/store.js       localStorage load/save, skillswap1 migration, schema normalization, draft storage.
  js/domain.js      All business rules. DOM-free and unit tested. Each action takes (db, actorId, ...),
                    checks ownership, mutates db, and throws RuleError with a user-facing message.
  js/match.js       Skill matching and shared weekly windows computed as real instants across zones.
  js/views.js       Pure functions returning HTML strings for pages and dialogs.
  js/video.js       Experimental same-browser WebRTC (BroadcastChannel signaling).
  js/app.js         Controller: UI state, render(), event delegation via data-action / data-form,
                    dialog lifecycle, practice timer, cross-tab sync.
tests/
  domain.test.mjs   node:test suite for rules, time zones, matching, storage (26 tests).
  i18n.test.mjs     Every catalog has exactly the English keys, the same {placeholders}, the plural forms its
                    language needs, and no em dashes; also checks t() and browser-language matching.
  e2e.py            Playwright walkthrough of the real UI, both profiles, two tabs, video, mobile, wide-window, switch and unslop checks, themes, contrast, every setting, language switching, Arabic RTL, and all 16 languages at 390px (143 checks).
```

The previous single-file build layered later reassignments of earlier functions (`render = function(){ oldRender(); ... }`). That pattern is gone. There are no inline `onclick` handlers and no global functions; behavior is wired through `data-action` attributes handled in `app.js`.

State is stored in localStorage under `skillswap3` (schema `version: 5`), with migration from `skillswap1`. Existing `skillswap3` data from the old build loads and is normalized in place. Chat drafts moved to their own key `skillswap3-drafts` so typing does not trigger re-renders in other tabs. The active demo profile is kept per tab in sessionStorage (`skillswap-active-profile`), with `db.active` as the fallback for new tabs. Five seeded profiles: Eric, Maya Chen, Alex Rivera, Jordan Lee and Sam Patel. Storage events refresh same-origin tabs; BroadcastChannel is used for experimental call signaling. Neither is a cross-device backend.

`window.__skillswap` exposes read access to state for the browser tests only.

## Implemented behavior

- Discovery search, reciprocal-match filter, exclusion of your own profile and of blocked profiles. Skills that match your profile are underlined in partner rows.
- Multiple free-form teaching/learning skills (case-insensitive de-duplication); availability rows; readable time zone dropdown.
- Matching based on normalized exact skill overlap plus shared weekly availability computed as real UTC instants over the coming week, so partners in different zones are compared correctly and DST weeks are handled. Shared windows are shown in the viewer's zone and offered as one-click times in the booking form. No semantic skill matching.
- Directional connection requests with required introduction, accept/decline/withdraw, confirmed connection removal, and Report / block directly on incoming introductions.
- Connections chat, profile-specific conversations, highlighted active conversation, red unread indicators and per-pair saved drafts. Enter sends; Shift+Enter inserts a newline; IME composition is respected. Hidden tabs do not mark messages read. New messages from another tab appear without disturbing what you are typing.
- Session requests with topic, goal, note, date/time, duration, format, agenda, learning share (exchange only), who is learning (one-way tutoring only), communication method and optional HTTPS meeting link (required when "External meeting link" is chosen). Recipient accepts/declines; sender can withdraw; accepted sessions can be cancelled by either participant.
- Formats include skill exchange, one-way tutoring, study together, project collaboration, practice/feedback and custom options.
- UTC booking instants with local-time display, plus the partner's local time when their zone differs. Past bookings and conflicts with accepted meetings are rejected with inline form errors. Ambiguous or nonexistent daylight-saving times produce errors rather than silently choosing a time. Pending requests whose time has passed show as Expired and can be dismissed.
- Sessions page grouped into Requests for you, Ready to record, Upcoming meetings (sorted by time), Sent requests and a collapsible History.
- Rescheduling proposals require the other participant's acceptance. Original booking remains until acceptance; proposals can be declined or withdrawn; acceptance re-checks conflicts.
- Local practice timer with pause, added time and role display that switches at the learning share in skill exchanges, shows the learner in one-way tutoring and "Collaborate" for other formats.
- Individual learning journals: goal, confidence before/after (1 to 5), before state, notes, independent task result, goal achieved, a follow-up "practice next" step, elapsed time, plus shared clarity rating and comment. The Progress page shows a summary line, the follow-up list (mark as practiced), feedback received from partners, and records.
- Local report/block controls and an unblock list.
- Experimental WebRTC local/remote video controls, mic/camera toggles and leave controls. Signaling is same-browser only; there is no signaling server or STUN/TURN setup. Two tabs of the same Chrome profile were verified to connect with a fake camera in automated tests; real cameras and cross-device calls are not verified.
- Status messages after actions, a storage warning if the browser refuses to save, and recovery (with a backup copy) when saved data cannot be parsed.

## Themes, languages and accessibility (Nov 2026)

- Themes: light, dark, or follow the device. An inline script in `index.html` applies the saved theme and text size before first paint, so there is no flash. Dark tokens are under `:root[data-theme="dark"]`; the highlighter becomes a deep olive band (`--hl-band`) there so light text on it stays readable.
- Languages: English, Spanish, French, German, Portuguese (Brazil), Italian, Chinese (Simplified and Traditional), Japanese, Korean, Vietnamese, Filipino, Russian, Ukrainian, Hindi and Arabic. On first visit the app picks the closest match to the browser's languages. Arabic switches the page to right to left; the CSS uses logical properties (`margin-inline-start` and so on) so the layout mirrors. Dates, times, numbers and time-zone names come from `Intl` in the chosen language.
- Stored data stays in English (formats, statuses, ratings, day names, page ids) and is translated only for display, so switching language never changes saved records and the test selectors keep working. Names, skills and messages people type are shown as written.
- Translations other than English were written with AI assistance and have not been checked by native speakers. The settings dialog says so. Get them reviewed before presenting any language as finished.
- Accessibility settings: text size 100/115/130%, Atkinson Hyperlegible font, high contrast (text at least 7:1), reduced motion (also automatic under `prefers-reduced-motion`), underlined links and buttons, and wider line and letter spacing. There is a skip link, and focus moves into each dialog.
- To add a language: copy `i18n/en.js`, translate the values, add it to `LANGUAGES` in `js/i18n.js`, and add the code to the test list in `tests/e2e.py`. `node --test` will report any missing keys, placeholders or plural forms.

## Bugs fixed in the Nov 2026 refactor

1. Teaching roles never switched in "Skill exchange" sessions: `setInterval(tick, 250)` held the original `tick`, so the later override that handled learning share and new formats only ran on "+2 min" and was overwritten 250 ms later.
2. Escape on the practice dialog left the wide `meeting-modal` class on the dialog, so the next dialog opened 880px wide; it also discarded an in-progress journal without asking.
3. Cancelling the profile-switch confirmation still hung up video and cleared the open chat.
4. Every draft keystroke saved the whole database, so other tabs re-rendered and lost focus (for example in the search box).
5. Incoming introductions had no report/block control.
6. Progress put three metric cards in a two-column grid.
7. Sessions with blocked people stayed actionable; expired pending requests could not be accepted and stayed pending; blocked IDs could be duplicated; removing a connection had no confirmation; one-way tutoring could not say who was learning; the clarity rating was stored but never shown; history mixed every status unsorted; `save()` could throw on a full or blocked storage.
8. Availability overlap compared clock text only for identical zones, so partners in different zones never matched.
10. Confirmations used native `confirm()`, which sandboxed hosts (such as the claude.ai artifact preview) block, so remove/block/cancel silently did nothing there. They now use an in-page dialog, and the browser suite fails if any native popup appears.
11. Suggested booking times could be the current minute and fail as "past" on submit. They now start at least 10 minutes out, on a quarter hour.
9. The practice dialog on small screens opened scrolled to the session chat instead of the timer; the stacked chat layout kept a 500px empty minimum height.

## Design constraints to preserve

Polish pass (Nov 2026) adapted from unslop by Damir Sokolovsky (https://github.com/heydamir/unslop, CC BY 4.0, credit retained in `css/app.css`). Audit verdict: light slop, so polish mode. Palette, typefaces, layout and features were kept. Direction:
- Character: neighborly, studious, a little handmade.
- World: a school library's pinned notice board (paper, chalkboard green, index cards, a felt-tip highlighter).
- Moment: the tilted "Meet Maya" card on Discover is the one bright element.
- Signature: a lime highlighter stroke (`mark.hl`) under what two people have in common (matched skills, shared time, the pinned card's shared skills). Use it nowhere else.

Rules now enforced in `css/app.css` and checked by the browser suite:
- All colors come from the tokens at the top of `app.css` (20 values, down from 37). Text roles are `--ink`, `--text-2` and `--muted`, all at least 4.5:1 on every surface. Input outlines are 3:1.
- Spacing is on a 4px grid. Nav rows are 44px with 4px gaps at 16px type; the sidebar is 280px (`--sidebar`). The sidebar has no footer tagline (removed at Eric's request).
- Labels are sentence case, with no uppercase transforms. Weights are 400, 500 and 600 (Noto Sans 500/600 woff2 files added from Fontsource, OFL). Small text has no negative tracking, and figures are tabular.
- The Mutual interests filter is a switch (`role="switch"`) that shows On or Off in text, not only by color.
- Short pages: `main` fills the window and the closing band is pushed to the bottom, so there is never empty space below it.
- No exclamation marks in UI copy. Single-phrase titles, labels and buttons take no trailing period; the hero line "You know a thing. They know another." and the "hermes." wordmark keep theirs by decision.
- Nav counts: a quiet "N new" for waiting requests and introductions, and a red badge only for unread messages.
- Keyboard shortcuts are shown as `<kbd>` keycaps.
- Layout: content is capped at about 1520px and centered in wide windows (`--gutter` on `main`); the dark closing band bleeds to both edges and ends the page. The demo-data footer was removed at Eric's request; the in-context notes (chat, video, reports) still state the browser-only limits.
- Motion: color and background transitions of 150ms on one curve (`cubic-bezier(0.22,1,0.36,1)`), a 0.98 press scale, and one 240ms fade-and-rise for dialogs and status messages. All of it is off under `prefers-reduced-motion`.


- No purple/indigo gradients, neon hero, generic hero statistics or three-column card grids.
- Avoid rounded bordered cards around every feature and generic icon-heavy feature blocks.
- Do not switch to Inter, Roboto, Arial, Fraunces or Space Grotesk.
- Current typography: URW Bookman headings with Noto Sans body, bundled locally.
- Current palette (supplied by Eric, Nov 2026): grayscale #E8E9EB (paper), #CCCDC6 (tinted surfaces), #ACADA8 (lines), #746D69 (closing band and accent rules) and #262626 (sidebar, buttons, text). #746D69 is only 4.2:1 as small text on the paper, so muted text uses a darker #595350 instead. Dark mode uses the same five values reversed (paper #1e1e1e, text #E8E9EB). The lime highlighter #d8ed9c stays as the signature. The earlier navy and forest-green palettes are retired.
- Dark navigation and paper content; asymmetric hero, open partner directory rows and split-pane conversations. New Progress content uses open rows and an inline summary line, not cards.
- Copy should be specific and friendly. Existing line: "You know a thing. They know another." No em dashes in UI copy (the browser suite checks every page).
- Use actual product/demo data or appropriate real assets. Do not invent testimonials, learning statistics or users presented as real. Progress numbers come only from the profile's own saved records.

## Important limitations

This is not production-ready. There is no real authentication, email verification, bot check, shared database, server authorization, email notifications or realtime transport between devices. Ownership checks in `domain.js` run in the browser and are prototype rules, not security boundaries. Reports have no moderation destination. Video has only been verified between two tabs of one browser with a simulated camera. There is no whiteboard or attachment system. Timers and journals are local interactions rather than server-synchronized session state. Do not imply otherwise.

The ZIP includes the application and seeded demo data only. Browser-specific chats, connections, profile edits and meetings are not exported.

## Recommended next work

1. Choose a backend deliberately (ask before picking a paid service), then implement real accounts, shared storage, server-side authorization and realtime messaging. `domain.js` is a good starting contract: its functions map to server endpoints and its rules should be enforced server-side. Keep demonstration identities isolated from actual users.
2. Implement real meeting signaling plus TURN or a managed video service, with permission/error handling. Add the whiteboard only after the meeting foundation works.
3. Learning loop: suggest a follow-up session from an open "practice next" item, and show confidence trends per skill over several sessions.
4. Accessibility and languages: native-speaker review of the 15 translations, a full screen-reader pass (dialogs, live regions, the horizontally scrolling mobile nav) and manual keyboard testing. Automated checks currently cover layout overflow at 390px, not assistive technology.
5. Before a real school pilot, implement the moderation and privacy flows implied by report/block controls. Do not advertise unimplemented protections.

## Testing

```sh
node --test tests/*.test.mjs                 # rules, time zones, matching, storage (Node 18+)
python3 -m http.server 8000 --directory dist # then, in another terminal:
python3 tests/e2e.py http://localhost:8000/  # needs: pip install playwright && playwright install chromium
```

The browser suite drives both sides of the flow through the demo switcher: introduction, block from an intro, acceptance, chat with Enter/Shift+Enter, unread badge colour and clearing, draft isolation, booking validation and suggested times, acceptance, rescheduling ownership, role switching with the live timer, Escape safety, learning record and shared feedback visibility, profile isolation, two-tab focus preservation and live chat, same-browser video with a fake camera, an em dash scan, console errors, 390px layouts, light and dark contrast, every display setting, language switching and persistence, Arabic right to left, and every language at 390px with no overflow, em dashes or exclamation marks. It writes screenshots to `tests/screenshots/`.

## Source provenance

Originally exported from commit `c6ccd2b31f356a729d75e43f9ee21115570f7d7d` of the existing prototype (single `dist/index.html`). Refactored into modules in November 2026 with Claude; see "Bugs fixed" above. Live reference for the original: https://skill-exchange-eric.slapdap.chatgpt.site. The exported source is authoritative for what this package implements.
