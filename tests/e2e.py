"""End-to-end browser checks for Hermes.

Usage: python3 -m http.server 8000 --directory dist  (in another terminal)
       python3 tests/e2e.py http://localhost:8000/ [chrome-path]
Requires: pip install playwright (and a Chromium/Chrome browser).
"""
import re, sys, os
from playwright.sync_api import sync_playwright, expect

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/"
CHROME = sys.argv[2] if len(sys.argv) > 2 else None
SHOTS = os.path.join(os.path.dirname(__file__), "screenshots")
os.makedirs(SHOTS, exist_ok=True)
results = []

def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))

def as_profile(page, pid):
    page.select_option("#demo-profile", str(pid))

def nav(page, name):
    page.click(f"#nav button[data-page='{name}']")

def future_local(page, days=3, hour=16, minute=0):
    return page.evaluate("""([d,h,m]) => { const t=new Date(); t.setDate(t.getDate()+d); t.setHours(h,m,0,0);
      const p=n=>String(n).padStart(2,'0'); return `${t.getFullYear()}-${p(t.getMonth()+1)}-${p(t.getDate())}T${p(h)}:${p(m)}`; }""", [days, hour, minute])

with sync_playwright() as p:
    launch = dict(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    if CHROME: launch["executable_path"] = CHROME
    browser = p.chromium.launch(**launch)
    ctx = browser.new_context(timezone_id="America/Los_Angeles", viewport={"width": 1400, "height": 950})
    ctx.grant_permissions(["camera", "microphone"])
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    native_dialogs = []
    page.on("dialog", lambda d: (native_dialogs.append(d.message), d.accept()))
    page.goto(URL)
    page.evaluate("localStorage.clear(); sessionStorage.clear()")
    page.reload()
    page.screenshot(path=f"{SHOTS}/desktop-discover.png", full_page=True)

    # 1. Discover: own profile excluded, sorted by match, mutual filter
    names = page.locator(".person-row h3").all_text_contents()
    check("discover excludes own profile", "Eric" not in names and len(names) == 4, str(names))
    check("best match first (Maya: mutual + shared time)", names[0] == "Maya Chen", str(names))
    check("shared time shown in viewer zone", "Shared time" in page.locator(".person-row").first.inner_text())
    page.click("[data-action='toggle-reciprocal']")
    check("mutual filter keeps only two-way matches", page.locator(".person-row h3").all_text_contents() == ["Maya Chen"], str(page.locator(".person-row h3").all_text_contents()))
    page.fill("[data-input='search']", "spanish")
    check("search keeps focus while filtering", page.evaluate("document.activeElement.dataset.input") == "search")
    page.fill("[data-input='search']", "")
    page.click("[data-action='toggle-reciprocal']")

    # 2. Introduction-based connection request
    page.locator(".person-row", has_text="Maya Chen").locator("[data-action='connect']").click()
    page.click("form[data-form='connect'] button:not([type=button])")
    check("intro required (inline error)", page.locator("dialog .form-error").count() == 1 or page.evaluate("!document.querySelector('dialog textarea').checkValidity()"))
    page.fill("textarea[name=intro]", "Hi Maya! I can help with Java loops if you can show me guitar chords.")
    page.fill("input[name=interest]", "First chords")
    page.click("form[data-form='connect'] button:not([type=button])")
    check("request sent flash", "Introduction sent" in page.inner_text("#flash"))
    check("no chat before acceptance", page.locator(".chat-layout [data-action='open-chat']").count() == 0)

    # 3. Recipient sees the intro and can block from it (Alex sends one too)
    as_profile(page, 2)
    nav(page, "Discover")
    page.locator(".person-row", has_text="Eric").locator("[data-action='connect']").click()
    page.fill("textarea[name=intro]", "hey")
    page.click("form[data-form='connect'] button:not([type=button])")
    as_profile(page, 0)
    nav(page, "Connections")
    alex_req = page.locator(".card", has_text="Alex Rivera")
    check("incoming intro offers report/block", alex_req.locator("[data-action='report']").count() == 1)
    alex_req.locator("[data-action='report']").click()
    page.click("dialog [data-action='block']")
    check("block asks in-page first", page.locator("#confirm-dialog").is_visible())
    page.click("#confirm-dialog [data-confirm='yes']")
    check("blocked intro disappears", page.locator(".card", has_text="Alex Rivera").count() == 0)
    nav(page, "My profile")
    check("blocked list shows Alex", "Alex Rivera" in page.inner_text("#app"))
    nav(page, "Discover")
    check("blocked person hidden from discover", "Alex Rivera" not in page.inner_text("#cards"))

    # 4. Maya accepts and chats
    as_profile(page, 1)
    check("nav shows invite count as quiet text", "1 new" in page.inner_text("#nav button[data-page='Connections']"))
    nav(page, "Connections")
    check("Maya sees Eric's intro", "Java loops if you can show me guitar" in page.inner_text("#app"))
    page.click("[data-action='connection'][data-act='accept']")
    check("accept opens chat", page.locator("#chat-text").count() == 1)
    page.fill("#chat-text", "Hi Eric!")
    page.press("#chat-text", "Enter")
    page.fill("#chat-text", "Line one")
    page.press("#chat-text", "Shift+Enter")
    page.type("#chat-text", "line two")
    page.press("#chat-text", "Enter")
    bubbles = page.locator("#chat-history .bubble").all_inner_texts()
    check("Enter sends, Shift+Enter newline", len(bubbles) == 2 and "Line one\nline two" in bubbles[1], str(bubbles))
    page.type("#chat-text", "unsent draft for Eric")

    # 5. Unread badge on the other side, draft isolation
    as_profile(page, 0)
    badge = page.locator("#nav [data-unread='all']")
    check("red unread badge shows 2", badge.is_visible() and badge.inner_text() == "2", badge.inner_text())
    color = badge.evaluate("e => getComputedStyle(e).backgroundColor")
    check("badge is red", color == "rgb(176, 46, 51)", color)
    nav(page, "Connections")
    page.click(".chat-layout [data-action='open-chat']")
    check("Eric does not see Maya's draft", page.input_value("#chat-text") == "")
    check("badge clears after reading", not page.locator("#nav [data-unread='all']").is_visible())
    check("active chat highlighted", page.locator(".chat-layout [aria-current='true']").count() == 1)
    as_profile(page, 1)
    nav(page, "Connections")
    page.click(".chat-layout [data-action='open-chat']")
    check("Maya's draft persisted", page.input_value("#chat-text") == "unsent draft for Eric")
    page.fill("#chat-text", "")

    # 6. Booking: past date rejected inline, suggested slot fills, request sent
    as_profile(page, 0)
    nav(page, "Connections")
    page.click(".chat-layout [data-action='open-chat']")
    page.click("#chat-panel [data-action='plan']")
    check("shared time suggestions offered", page.locator("dialog [data-action='fill-slot']").count() >= 1)
    page.fill("input[name=topic]", "Guitar chords")
    page.fill("input[name=goal]", "Switch between G and C")
    page.evaluate("document.querySelector('input[name=date]').removeAttribute('min')")
    page.fill("input[name=date]", "2020-01-06T16:00")
    page.click("form[data-form='booking'] button:not([type=button])")
    check("past date rejected inline", "future" in page.inner_text("dialog .form-error"))
    page.select_option("select[name=format]", "One-way tutoring")
    check("learner field shown for one-way", page.locator("[data-show-for='One-way tutoring']").is_visible() and not page.locator("[data-show-for='Skill exchange']").is_visible())
    page.select_option("select[name=format]", "Skill exchange")
    page.locator("dialog [data-action='fill-slot']").first.click()
    slot = page.input_value("input[name=date]")
    page.fill("input[name=minutes]", "2")
    page.fill("input[name=learningShare]", "50")
    page.click("form[data-form='booking'] button:not([type=button])")
    check("booking lands on My sessions", page.locator("#app h1").inner_text() == "Eric’s sessions" and "Sent requests" in page.inner_text("#app"), slot)
    check("role split described", "You learn first for 1 min, then teach for 1 min." in page.inner_text("#app"))

    # 7. Maya accepts, proposes a new time; Eric accepts it
    as_profile(page, 1)
    check("nav shows session request count", "1 new" in page.inner_text("#nav button[data-page='My sessions']"))
    nav(page, "My sessions")
    page.click("[data-action='respond-session'][data-act='accept']")
    check("accepted session upcoming", "Upcoming meetings" in page.inner_text("#app"))
    page.click("[data-action='reschedule']")
    new_time = future_local(page, 5, 17, 0)
    page.fill("dialog input[name=date]", new_time)
    page.fill("dialog textarea[name=note]", "Can we do Friday?")
    page.click("form[data-form='reschedule'] button:not([type=button])")
    check("proposer sees withdraw, not accept", page.locator("[data-action='withdraw-reschedule']").count() == 1 and page.locator("[data-action='reply-reschedule']").count() == 0)
    as_profile(page, 0)
    nav(page, "My sessions")
    page.click("[data-action='reply-reschedule'][data-act='accept']")
    check("reschedule accepted", "Meeting moved" in page.inner_text("#flash") and "New time proposed" not in page.inner_text("#app"))

    # 8. Practice: roles switch with the interval running (original bug), Escape safety, save record
    page.click("[data-action='start-practice']")
    check("practice dialog wide", page.evaluate("document.querySelector('#modal').className") == "meeting-modal")
    first_role = page.inner_text("#role")
    page.evaluate("window.__skillswap.practice.elapsed = 70")
    page.wait_for_timeout(700)
    second_role = page.inner_text("#role")
    check("role switches after learning share (was broken)", first_role == "Your turn to learn" and second_role == "Your turn to teach", f"{first_role} -> {second_role}")
    check("clock counts down", page.inner_text("#clock") == "00:50", page.inner_text("#clock"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    check("Escape with progress asks before discarding", page.locator("#confirm-dialog").is_visible())
    page.click("#confirm-dialog [data-confirm='no']")
    page.wait_for_timeout(200)
    check("choosing Cancel keeps practice open", page.evaluate("document.querySelector('#modal').open && Boolean(window.__skillswap.practice)"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    page.click("#confirm-dialog [data-confirm='yes']")
    page.wait_for_timeout(200)
    check("closing clears wide class (was leaking)", page.evaluate("!document.querySelector('#modal').open && document.querySelector('#modal').className === ''"))
    page.click("[data-action='plan']")
    check("next dialog normal width", page.evaluate("document.querySelector('#modal').getBoundingClientRect().width") < 700)
    page.click("dialog [data-action='close-dialog']")

    page.click("[data-action='start-practice']")
    page.select_option("select[name=confidenceBefore]", "2")
    page.select_option("select[name=confidenceAfter]", "4")
    page.fill("textarea[name=before]", "Could play G slowly")
    page.fill("textarea[name=outcome]", "Switched G to C four times in a row")
    page.check("input[name=achieved]")
    page.fill("input[name=nextStep]", "Add a D chord")
    page.select_option("select[name=rating]", "Very clear")
    page.fill("textarea[name=feedback]", "Showing finger placement slowly helped.")
    page.evaluate("window.__skillswap.practice.elapsed = 95")
    page.click("form[data-form='practice'] button:not([type=button])")
    body = page.inner_text("#app")
    check("progress summary", "1 practice record" in body and "1 goal achieved" in body and "2 minutes practiced" in body and "+2.0" in body, body[:300])
    check("follow-up listed", "Add a D chord" in body)
    page.click("[data-action='follow-up']")
    check("follow-up can be marked practiced", page.locator(".follow-ups li.done").count() == 1)
    check("summary uses no metric cards", page.locator(".grid .card .metric").count() == 0)
    page.screenshot(path=f"{SHOTS}/desktop-progress.png", full_page=True)

    as_profile(page, 1)
    nav(page, "Progress")
    body = page.inner_text("#app")
    check("partner sees shared feedback only", "Teaching clarity: Very clear" in body and "finger placement" in body and "four times in a row" not in body and "Could play G" not in body)
    nav(page, "My sessions")
    check("partner can still record own learning", page.locator("[data-action='start-practice']").inner_text() == "Record your learning")

    # 9. Profile edits stay with the active profile; timezone dropdown readable
    nav(page, "My profile")
    page.fill("textarea[name=teaches]", "Guitar chords\nMusic theory")
    tz_label = page.locator("select[name=timezone] option:checked").inner_text()
    check("readable time zone label", "Pacific Time" in tz_label, tz_label)
    page.click("[data-action='add-slot']")
    rows = page.locator(".availability-row")
    rows.last.locator("[name='slot-start']").fill("18:00")
    rows.last.locator("[name='slot-end']").fill("17:00")
    page.click("form[data-form='profile'] button:not([type=button])")
    check("bad window rejected", "end after" in page.inner_text("#profile-error"))
    rows.last.locator("[data-action='remove-slot']").click()
    page.click("form[data-form='profile'] button:not([type=button])")
    as_profile(page, 0)
    check("Eric sees Maya's new skill", "Music theory" in page.inner_text("#cards"))
    nav(page, "My profile")
    check("Eric's own profile unchanged", page.input_value("textarea[name=teaches]") == "Java loops")

    # 10. Two tabs: typing elsewhere is not interrupted; live chat arrives
    tab2 = ctx.new_page()
    tab2.on("dialog", lambda d: d.accept())
    tab2.goto(URL)
    check("second tab starts on stored profile", tab2.inner_text(".top h3") == "Viewing as Eric")
    as_profile(tab2, 1)
    check("tabs keep independent profiles", page.inner_text(".top h3") == "Viewing as Eric")
    nav(page, "Discover")
    page.fill("[data-input='search']", "gui")
    page.focus("[data-input='search']")
    nav(tab2, "Connections")
    tab2.click(".chat-layout [data-action='open-chat']")
    tab2.type("#chat-text", "typing in the other tab", delay=20)
    page.wait_for_timeout(300)
    check("draft typing does not steal focus in other tab (was broken)", page.evaluate("document.activeElement.dataset.input") == "search" and page.input_value("[data-input='search']") == "gui")
    nav(page, "Connections")
    page.click(".chat-layout [data-action='open-chat']")
    page.focus("#chat-text")
    page.type("#chat-text", "half")
    tab2.press("#chat-text", "Enter")
    page.wait_for_timeout(400)
    check("live message appears without losing typing", "typing in the other tab" in page.inner_text("#chat-history") and page.input_value("#chat-text") == "half" and page.evaluate("document.activeElement.id") == "chat-text")
    page.fill("#chat-text", "")

    # 11. Same-browser experimental video between the two tabs
    check("chat open before booking", page.locator("#chat-panel [data-action='plan']").count() == 1)
    page.click("#chat-panel [data-action='plan']")
    page.fill("input[name=topic]", "Java loops")
    page.fill("input[name=goal]", "Video test")
    page.fill("input[name=date]", future_local(page, 9, 16, 0))
    page.click("form[data-form='booking'] button:not([type=button])")
    tab2.reload()
    nav(tab2, "My sessions")
    tab2.click("[data-action='respond-session'][data-act='accept']")
    page.wait_for_timeout(300)
    page.reload(); nav(page, "My sessions")
    page.locator(".card", has_text="Video test").locator("[data-action='start-practice']").click()
    tab2.locator(".card", has_text="Video test").locator("[data-action='start-practice']").click()
    page.click("dialog details.meeting-tools summary")
    tab2.click("dialog details.meeting-tools summary")
    page.click("[data-action='video-join']")
    tab2.click("[data-action='video-join']")
    try:
        expect(page.locator("#call-status")).to_have_text(re.compile("Connected"), timeout=10000)
        expect(tab2.locator("#call-status")).to_have_text(re.compile("Connected"), timeout=10000)
        ok = True
    except Exception:
        ok = False
    check("same-browser video connects between two tabs (fake camera)", ok, page.inner_text("#call-status") + " / " + tab2.inner_text("#call-status"))
    remote = page.evaluate("Boolean(document.querySelector('#remote-video').srcObject)")
    check("remote stream attached", remote)
    page.click("[data-action='video-leave']")
    try:
        expect(tab2.locator("#call-status")).to_have_text(re.compile("partner left"), timeout=5000); ok = True
    except Exception: ok = False
    check("partner sees leave", ok, tab2.inner_text("#call-status"))
    page.click("dialog [data-action='close-dialog']")
    tab2.click("dialog [data-action='close-dialog']")
    tab2.close()

    # 12. Copy and layout checks across pages
    em_pages = []
    for name in ["Discover", "My sessions", "Connections", "Progress", "My profile"]:
        nav(page, name)
        if "—" in page.inner_text("body"):
            em_pages.append(name)
    check("no em dashes in UI copy", not em_pages, str(em_pages))
    check("no console errors", not errors, str(errors[:3]))
    upper = page.evaluate("""() => [...document.querySelectorAll('body *')].filter(e => getComputedStyle(e).textTransform === 'uppercase' && e.textContent.trim()).length""")
    check("no uppercase-transformed labels", upper == 0, str(upper))
    bangs = []
    for name in ["Discover", "My sessions", "Connections", "Progress", "My profile"]:
        nav(page, name)
        if re.search(r"[A-Za-z]!", page.inner_text("#app")): bangs.append(name)
    check("no exclamation marks in UI copy", not bangs, str(bangs))
    heavy = page.evaluate("""() => [...document.querySelectorAll('body *')].filter(e => +getComputedStyle(e).fontWeight > 600 && e.textContent.trim()).map(e => e.tagName + '.' + e.className).slice(0, 5)""")
    check("no weights above 600", not heavy, str(heavy))
    check("no native alert/confirm popups used", not native_dialogs, str(native_dialogs))

    # 12a. Mutual-interests switch states, every profile has a two-way match, no empty band in a tall window
    t = browser.new_context(timezone_id="America/Los_Angeles", viewport={"width": 2560, "height": 1440})
    tp = t.new_page()
    tp.goto(URL)
    sw = tp.locator("[data-action='toggle-reciprocal']")
    check("switch reads Off by default", sw.get_attribute("aria-checked") == "false" and "Off" in sw.inner_text())
    sw.click()
    sw = tp.locator("[data-action='toggle-reciprocal']")
    check("switch reads On when on", sw.get_attribute("aria-checked") == "true" and "On" in sw.inner_text())
    counts = {}
    for pid in range(5):
        tp.select_option("#demo-profile", str(pid))
        tp.click("[data-action='toggle-reciprocal']")
        counts[tp.inner_text(".top h3")] = tp.locator(".person-row").count()
        gap = tp.evaluate("scrollTo(0, document.body.scrollHeight), innerHeight - document.querySelector('.closing-note').getBoundingClientRect().bottom")
        check(f"no empty band under closing note (profile {pid})", abs(gap) <= 1, str(gap))
    check("every sample profile has a two-way match", all(v >= 1 for v in counts.values()), str(counts))
    check("sidebar tagline removed", tp.locator("aside .notice").count() == 0)
    check("renamed to Hermes", tp.inner_text("h2.logo") == "hermes." and tp.title().startswith("Hermes"))
    t.close()

    # 12b. Very wide window: content centered, closing band edge to edge, no dead space
    w = browser.new_context(timezone_id="America/Los_Angeles", viewport={"width": 2560, "height": 1300})
    wp = w.new_page()
    wp.goto(URL)
    geo = wp.evaluate("""() => { const a = document.querySelector('#app').getBoundingClientRect();
      const band = document.querySelector('.closing-note').getBoundingClientRect();
      return { left: a.left - 280, right: innerWidth - a.right, bandLeft: band.left, bandRight: innerWidth - band.right,
               below: document.documentElement.scrollHeight - (band.bottom + scrollY), overflow: document.documentElement.scrollWidth - innerWidth }; }""")
    check("wide window: content centered", abs(geo["left"] - geo["right"]) <= 2, str(geo))
    check("wide window: closing band spans to both edges", geo["bandLeft"] <= 281 and geo["bandRight"] <= 1, str(geo))
    check("wide window: nothing below the closing band", geo["below"] <= 1, str(geo))
    check("wide window: no horizontal overflow", geo["overflow"] <= 1, str(geo))
    check("demo-data footer removed", wp.locator("footer").count() == 0)
    wp.screenshot(path=f"{SHOTS}/wide-discover.png", full_page=True)
    w.close()

    # 13. Mobile layout
    m = browser.new_context(timezone_id="America/Los_Angeles", viewport={"width": 390, "height": 844}, is_mobile=True)
    mp = m.new_page()
    snapshot = page.evaluate("localStorage.getItem('skillswap3')")
    mp.goto(URL)
    mp.evaluate("s => localStorage.setItem('skillswap3', s)", snapshot)
    mp.reload()
    overflow = mp.evaluate("document.documentElement.scrollWidth - innerWidth")
    check("no horizontal overflow on 390px Discover", overflow <= 1, str(overflow))
    mp.screenshot(path=f"{SHOTS}/mobile-discover.png", full_page=True)
    for name in ["Connections", "My sessions", "Progress", "My profile"]:
        nav(mp, name)
        o = mp.evaluate("document.documentElement.scrollWidth - innerWidth")
        check(f"no horizontal overflow on 390px {name}", o <= 1, str(o))
    nav(mp, "Connections")
    mp.screenshot(path=f"{SHOTS}/mobile-connections.png", full_page=True)
    nav(mp, "My sessions")
    mp.locator("[data-action='start-practice']").first.click()
    o = mp.evaluate("document.querySelector('#modal').scrollWidth - document.querySelector('#modal').clientWidth")
    check("practice dialog fits 390px", o <= 1, str(o))
    check("practice dialog opens at the timer, not mid-form", mp.evaluate("document.querySelector('#modal').scrollTop") == 0 and mp.evaluate("document.activeElement.dataset.action") == "timer-toggle")
    mp.screenshot(path=f"{SHOTS}/mobile-practice.png")
    m.close()

    # 14. Display, language and accessibility settings
    CONTRAST_JS = """sels => { const lum = c => { const [r,g,b] = c.match(/[\\d.]+/g).slice(0,3).map(Number).map(v => { v/=255; return v<=0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; }); return 0.2126*r+0.7152*g+0.0722*b; };
      const bgOf = el => { while (el) { const c = getComputedStyle(el).backgroundColor; if (c && !c.startsWith('rgba(0, 0, 0, 0)') && c !== 'transparent') return c; el = el.parentElement; } return getComputedStyle(document.body).backgroundColor; };
      const out = {}; for (const s of sels) { const el = document.querySelector(s); if (!el) { out[s] = null; continue; }
        const a = lum(getComputedStyle(el).color), b = lum(bgOf(el)); out[s] = Math.round(((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05))*100)/100; } return out; }"""
    TEXT_SELS = ["h1", ".lead", ".person-row h3", ".muted", "#nav button span", "h2.logo", ".top-controls button"]
    s = browser.new_context(timezone_id="America/Los_Angeles", viewport={"width": 1440, "height": 900}, color_scheme="light")
    sp = s.new_page()
    sp.goto(URL)
    sp.click("[data-action='settings']")
    check("settings dialog opens from the top bar", sp.locator("dialog#modal[open] form[data-form='settings']").count() == 1)
    check("settings dialog focuses the language picker", sp.evaluate("document.activeElement.name") == "lang")
    check("settings offers 16 languages", sp.locator("form[data-form='settings'] select[name='lang'] option").count() == 16)
    light = sp.evaluate(CONTRAST_JS, TEXT_SELS)
    check("light mode text contrast at least 4.5:1", all(v is None or v >= 4.5 for v in light.values()), str(light))
    sp.check("input[name='theme'][value='dark']")
    check("dark theme applies", sp.evaluate("document.documentElement.dataset.theme") == "dark")
    sp.click("dialog#modal [data-action='close-dialog']")
    dark = sp.evaluate(CONTRAST_JS, TEXT_SELS)
    check("dark mode text contrast at least 4.5:1", all(v is None or v >= 4.5 for v in dark.values()), str(dark))
    sp.screenshot(path=f"{SHOTS}/dark-discover.png", full_page=True)
    sp.reload()
    check("dark theme persists after reload", sp.evaluate("document.documentElement.dataset.theme") == "dark")
    nav(sp, "My sessions"); sp.screenshot(path=f"{SHOTS}/dark-sessions.png", full_page=True)
    nav(sp, "Discover")

    # System theme follows the device when set to system
    sp.click("[data-action='settings']")
    sp.check("input[name='theme'][value='system']")
    sp.emulate_media(color_scheme="dark")
    sp.wait_for_function("document.documentElement.dataset.theme === 'dark'", timeout=3000)
    check("system theme follows device dark mode", sp.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(30, 30, 30)", sp.evaluate("getComputedStyle(document.body).backgroundColor"))
    sp.emulate_media(color_scheme="light")
    sp.wait_for_function("document.documentElement.dataset.theme === 'light'", timeout=3000)
    check("system theme follows device light mode", sp.evaluate("getComputedStyle(document.body).backgroundColor") != "rgb(30, 30, 30)")

    # Text size, readable font, contrast, underline, spacing, motion
    sp.check("input[name='size'][value='130']")
    check("larger text size applies", sp.evaluate("document.documentElement.dataset.size") == "130")
    for name, cls in [("readable", "pref-readable"), ("contrast", "pref-contrast"), ("underline", "pref-underline"), ("spacing", "pref-spacing"), ("motion", "pref-motion")]:
        sp.check(f"input[name='{name}']")
        check(f"{name} setting applies", sp.evaluate(f"document.documentElement.classList.contains('{cls}')"))
    check("readable font is Atkinson Hyperlegible", "Atkinson" in sp.evaluate("getComputedStyle(document.body).fontFamily"))
    sp.click("dialog#modal [data-action='close-dialog']")
    o = sp.evaluate("document.documentElement.scrollWidth - innerWidth")
    check("130% text with spacing has no horizontal overflow", o <= 1, str(o))
    hc = sp.evaluate(CONTRAST_JS, TEXT_SELS)
    check("high contrast text at least 7:1", all(v is None or v >= 7 for v in hc.values()), str(hc))
    sp.screenshot(path=f"{SHOTS}/accessibility-all-on.png", full_page=True)
    sp.click("[data-action='settings']")
    sp.click("dialog#modal [data-action='reset-settings']")
    check("reset restores defaults", sp.evaluate("document.documentElement.dataset.size") == "100" and not sp.evaluate("document.documentElement.classList.contains('pref-contrast')"))

    # Language switching
    sp.select_option("select[name='lang']", "es")
    sp.wait_for_function("document.documentElement.lang === 'es'")
    check("Spanish switches the UI", sp.inner_text("#nav button[data-page='Discover']").startswith("Descubrir") or "Descubr" in sp.inner_text("#nav"), sp.inner_text("#nav")[:80])
    check("settings dialog redraws in the new language", sp.locator("dialog#modal[open] form[data-form='settings']").count() == 1 and sp.evaluate("document.activeElement.name") == "lang")
    sp.click("dialog#modal [data-action='close-dialog']")
    sp.reload()
    check("language persists after reload", sp.evaluate("document.documentElement.lang") == "es")
    sp.click("[data-action='settings']")
    sp.select_option("select[name='lang']", "ar")
    sp.wait_for_function("document.documentElement.lang === 'ar'")
    sp.click("dialog#modal [data-action='close-dialog']")
    check("Arabic sets right-to-left", sp.evaluate("document.documentElement.dir") == "rtl")
    side = sp.evaluate("[document.querySelector('aside').getBoundingClientRect().left, innerWidth]")
    check("Arabic puts the sidebar on the right", side[0] > side[1] / 2, str(side))
    check("Arabic page title translated", "Hermes" in sp.title() and "لنتعلّم" in sp.title(), sp.title())
    sp.screenshot(path=f"{SHOTS}/arabic-discover.png", full_page=True)
    nav(sp, "My sessions"); sp.screenshot(path=f"{SHOTS}/arabic-sessions.png", full_page=True)
    sp.click("[data-action='settings']")
    sp.select_option("select[name='lang']", "ja")
    sp.wait_for_function("document.documentElement.lang === 'ja'")
    sp.click("dialog#modal [data-action='close-dialog']")
    check("Japanese returns to left-to-right", sp.evaluate("document.documentElement.dir") == "ltr")
    nav(sp, "Discover"); sp.screenshot(path=f"{SHOTS}/japanese-discover.png", full_page=True)
    s.close()

    # Every language: no overflow on mobile, no em dashes or exclamation marks in visible text
    for code in ["en", "es", "fr", "de", "pt-BR", "it", "zh-Hans", "zh-Hant", "ja", "ko", "vi", "tl", "ru", "uk", "hi", "ar"]:
        lc = browser.new_context(timezone_id="America/Los_Angeles", viewport={"width": 390, "height": 844}, is_mobile=True)
        lp = lc.new_page()
        lp.goto(URL)
        lp.evaluate("c => localStorage.setItem('hermes-prefs', JSON.stringify({lang: c}))", code)
        lp.reload()
        lp.wait_for_function("c => document.documentElement.lang === c", arg=code)
        worst, bad = 0, []
        for name in ["Discover", "Connections", "My sessions", "Progress", "My profile"]:
            nav(lp, name)
            worst = max(worst, lp.evaluate("document.documentElement.scrollWidth - innerWidth"))
            txt = lp.inner_text("body")
            if "—" in txt or "!" in txt or "！" in txt: bad.append(name)
        check(f"{code}: no horizontal overflow at 390px", worst <= 1, str(worst))
        check(f"{code}: no em dashes or exclamation marks", not bad, str(bad))
        if code in ("de", "ar", "hi"):
            nav(lp, "Discover"); lp.screenshot(path=f"{SHOTS}/mobile-{code}.png", full_page=True)
        lc.close()

    page.screenshot(path=f"{SHOTS}/desktop-profile.png", full_page=True)
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
