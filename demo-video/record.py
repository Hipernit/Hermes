"""Record a scripted Hermes walkthrough in Chrome at 1920x1080 using the CDP screencast.

Writes frames/NNNNNN.jpg, frames.json (timestamps) and markers.json (scene start times).
Usage: python3 record.py http://localhost:8102/ /usr/bin/google-chrome
"""
import base64, json, os, sys, time, math
from playwright.sync_api import sync_playwright

URL, CHROME = sys.argv[1], sys.argv[2]
OUT = os.path.dirname(os.path.abspath(__file__))
FR = os.path.join(OUT, "frames")
os.makedirs(FR, exist_ok=True)
for f in os.listdir(FR): os.remove(os.path.join(FR, f))

frames, markers = [], []
offsets = []

# A visible cursor for the recording only. It lives in a manual popover so it stays above modal dialogs.
CURSOR = r"""
(() => {
  const css = document.createElement('style');
  css.textContent = `
    ::-webkit-scrollbar{display:none} html{scrollbar-width:none}
    #demo-cursor{position:fixed;inset:auto;left:0;top:0;margin:0;padding:0;border:0;background:transparent;overflow:visible;
      width:26px;height:26px;pointer-events:none;transform:translate(-100px,-100px)}
    #demo-cursor svg{display:block;filter:drop-shadow(0 2px 3px #0005)}
    #demo-cursor .ring{position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:2px solid #bd572d;opacity:0}
    #demo-cursor.down .ring{animation:ring 420ms ease-out}
    @keyframes ring{from{opacity:.9;transform:scale(.4)}to{opacity:0;transform:scale(1.6)}}`;
  const c = document.createElement('div');
  c.id = 'demo-cursor'; c.setAttribute('popover', 'manual');
  c.innerHTML = '<div class="ring"></div><svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.6 15 L17.5 15 Z" fill="#fff" stroke="#182F57" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const raise = () => { try { c.hidePopover(); c.showPopover(); } catch {} };
  const boot = () => {
    document.head.appendChild(css); document.body.appendChild(c); raise();
    new MutationObserver(raise).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  addEventListener('mousemove', e => { c.style.transform = `translate(${e.clientX - 2}px, ${e.clientY - 2}px)`; }, true);
  addEventListener('mousedown', () => { c.classList.remove('down'); void c.offsetWidth; c.classList.add('down'); }, true);
})();
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=["--hide-scrollbars", "--force-color-profile=srgb", "--force-device-scale-factor=1.25"])
    ctx = b.new_context(viewport={"width": 1536, "height": 864}, timezone_id="America/Los_Angeles")
    ctx.add_init_script(CURSOR)
    page = ctx.new_page()
    page.on("dialog", lambda d: d.accept())
    page.goto(URL)
    page.evaluate("localStorage.clear(); sessionStorage.clear()")
    page.reload()
    page.wait_for_timeout(800)

    cdp = ctx.new_cdp_session(page)
    def on_frame(ev):
        ts = ev["metadata"]["timestamp"]
        offsets.append(time.time() - ts)
        path = os.path.join(FR, f"{len(frames):06d}.jpg")
        with open(path, "wb") as fh: fh.write(base64.b64decode(ev["data"]))
        frames.append({"file": os.path.basename(path), "t": ts})
        try: cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]})
        except Exception: pass
    cdp.on("Page.screencastFrame", on_frame)
    cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": 1920, "maxHeight": 1080, "everyNthFrame": 1})

    pos = {"x": 760, "y": 500}
    def wait(ms): page.wait_for_timeout(ms)
    def mark(name): markers.append({"scene": name, "wall": time.time()})
    def move(loc, dx=0.5, dy=0.5):
        loc.scroll_into_view_if_needed()
        bb = loc.bounding_box()
        x, y = bb["x"] + bb["width"] * dx, bb["y"] + bb["height"] * dy
        steps = max(8, int(math.dist((pos["x"], pos["y"]), (x, y)) / 22))
        page.mouse.move(x, y, steps=steps)
        pos.update(x=x, y=y)
        wait(120)
    def click(sel, pause=450, **kw):
        loc = page.locator(sel).first if isinstance(sel, str) else sel
        move(loc, **kw); page.mouse.down(); page.mouse.up(); wait(pause)
    def type_in(sel, text, delay=26, pause=250):
        click(sel, pause=150); page.keyboard.type(text, delay=delay); wait(pause)
    def choose(sel, value, pause=500):
        loc = page.locator(sel).first; move(loc); loc.select_option(value); wait(pause)
    def smooth_scroll(y, ms=900):
        page.evaluate(f"window.scrollTo({{top:{y},behavior:'smooth'}})"); wait(ms)
    def dialog_scroll(sel, ms=800):
        page.evaluate("s => document.querySelector(s).scrollIntoView({behavior:'smooth',block:'center'})", sel); wait(ms)

    page.mouse.move(pos["x"], pos["y"]); wait(300)

    # ---- 1. Discover
    mark("discover")
    wait(1800)
    move(page.locator(".exchange-note h3")); wait(1200)
    smooth_scroll(560, 1400)
    move(page.locator(".person-row").first.locator(".tag").first); wait(900)
    move(page.locator(".person-row").first.locator(".overlap")); wait(1300)
    type_in("[data-input='search']", "java", delay=90, pause=900)
    page.fill("[data-input='search']", ""); wait(300)
    click("[data-action='toggle-reciprocal']", pause=1300)

    # ---- 2. Introduce yourself
    mark("introduce")
    click(page.locator(".person-row", has_text="Maya Chen").locator("[data-action='connect']"), pause=600)
    type_in("textarea[name=intro]", "Hi Maya, I'm learning guitar and I can teach Java loops in return. Want to trade a session?", delay=18)
    type_in("input[name=interest]", "First chords for beginners", delay=22)
    click("form[data-form='connect'] button:not([type=button])", pause=1600)

    # ---- 3. Maya's side
    mark("maya_accepts")
    choose("#demo-profile", "1", pause=900)
    click("#nav button[data-page='Connections']", pause=1400)
    move(page.locator(".card", has_text="Eric").locator("p.multiline")); wait(900)
    click("[data-action='connection'][data-act='accept']", pause=1100)
    type_in("#chat-text", "Hi Eric! Wednesday after school works for me.", delay=24)
    page.keyboard.press("Enter"); wait(1400)

    # ---- 4. Eric plans a session
    mark("plan")
    choose("#demo-profile", "0", pause=700)
    move(page.locator("#nav button[data-page='Connections']")); wait(1200)
    click("#nav button[data-page='Connections']", pause=700)
    click(".chat-layout [data-action='open-chat']", pause=1300)
    click("#chat-panel [data-action='plan']", pause=900)
    click(page.locator("dialog [data-action='fill-slot']").first, pause=500)
    type_in("input[name=topic]", "Guitar chords", delay=30)
    type_in("input[name=goal]", "Switch between G and C without stopping", delay=22)
    page.fill("input[name=minutes]", ""); type_in("input[name=minutes]", "30", delay=60)
    dialog_scroll("input[name=learningShare]", 700)
    move(page.locator("input[name=learningShare]")); wait(800)
    dialog_scroll("form[data-form='booking'] .actions", 700)
    click("form[data-form='booking'] button:not([type=button])", pause=1500)

    # ---- 5. Maya accepts
    mark("maya_books")
    choose("#demo-profile", "1", pause=900)
    move(page.locator("#nav button[data-page='My sessions']")); wait(700)
    click("#nav button[data-page='My sessions']", pause=1100)
    click("[data-action='respond-session'][data-act='accept']", pause=1600)

    # ---- 6. Practice and record learning
    mark("practice")
    choose("#demo-profile", "0", pause=700)
    click("#nav button[data-page='My sessions']", pause=900)
    click("[data-action='start-practice']", pause=900)
    click("dialog [data-action='timer-toggle']", pause=1800)
    page.evaluate("window.__skillswap.practice.elapsed = 899")  # jump to the halfway switch
    wait(2200)
    mark("journal")
    dialog_scroll("form[data-form='practice']", 900)
    choose("select[name=confidenceBefore]", "2", pause=300)
    type_in("textarea[name=before]", "I could play G slowly but froze switching to C.", delay=14)
    type_in("textarea[name=outcome]", "Switched G to C four times in a row at a slow tempo.", delay=14)
    choose("select[name=confidenceAfter]", "4", pause=300)
    click("input[name=achieved]", pause=300)
    type_in("input[name=nextStep]", "Add a D chord to the progression", delay=18)
    dialog_scroll("fieldset.shared", 700)
    choose("select[name=rating]", "Very clear", pause=300)
    type_in("textarea[name=feedback]", "Showing finger placement slowly really helped.", delay=14)
    click("form[data-form='practice'] button:not([type=button])", pause=1500)

    # ---- 7. Progress
    mark("progress")
    wait(1200)
    move(page.locator(".summary-line span").last, dx=0.8, dy=0.9); wait(1400)
    move(page.locator(".follow-ups li strong").first); wait(900)
    smooth_scroll(520, 1500)
    wait(1200)

    # ---- 8. Feedback on Maya's side
    mark("feedback")
    choose("#demo-profile", "1", pause=700)
    click("#nav button[data-page='Progress']", pause=900)
    move(page.locator(".feedback-row p")); wait(2400)
    mark("end")
    wait(300)

    cdp.send("Page.stopScreencast")
    b.close()

off = sorted(offsets)[len(offsets) // 2]
for m in markers: m["t"] = m["wall"] - off
json.dump(frames, open(os.path.join(OUT, "frames.json"), "w"))
json.dump(markers, open(os.path.join(OUT, "markers.json"), "w"), indent=1)
dur = frames[-1]["t"] - frames[0]["t"]
print(f"{len(frames)} frames over {dur:.1f}s ({len(frames)/dur:.1f} fps avg)")
for m in markers: print(f"  {m['scene']:14} {m['t'] - frames[0]['t']:6.1f}s")
