"""Draw the Hermes demo video's cards and lower-third captions in Hermes's own type and colors (1920x1080)."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cards")
os.makedirs(OUT, exist_ok=True)
FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist", "fonts")
W, H = 1920, 1080
PAPER, INK, MUTED, GREEN, LIME, SAGE, LINE, ONGREEN, ONGREEN2 = "#f3f1ec", "#182F57", "#4f5e66", "#182F57", "#d8ed9c", "#d3e6df", "#c5cecb", "#f2f5f9", "#c3cde0"
BAND, ACTION = "#19454B", "#1B4661"

def serif(n): return ImageFont.truetype(f"{FONTS}/bookman.otf", n)
def sans(n, w=400):
    return ImageFont.truetype(f"{FONTS}/noto-sans.ttf", n) if w == 400 else ImageFont.truetype(f"{FONTS}/noto-sans-{w}.woff2", n)

def wrap(draw, text, font, width):
    words, lines, line = text.split(), [], ""
    for w in words:
        t = (line + " " + w).strip()
        if draw.textlength(t, font=font) <= width: line = t
        else: lines.append(line); line = w
    lines.append(line)
    return lines

def highlight(draw, x, y, text, font):
    """The app's signature: a lime highlighter stroke under the lower part of the words."""
    w = draw.textlength(text, font=font)
    asc, desc = font.getmetrics()
    draw.rectangle([x - 4, y + asc * 0.62, x + w + 4, y + asc * 1.02], fill=LIME)
    draw.text((x, y), text, font=font, fill=INK)

def paragraph(draw, x, y, text, font, width, fill, lh):
    for line in wrap(draw, text, font, width):
        draw.text((x, y), line, font=font, fill=fill); y += lh
    return y

# ---- title
im = Image.new("RGB", (W, H), PAPER); d = ImageDraw.Draw(im)
d.rectangle([0, 0, 350, H], fill=GREEN)
x = 470
d.text((x, 300), "TSA Software Development · product demo", font=sans(26, 500), fill=MUTED)
d.text((x, 360), "hermes.", font=serif(150), fill=INK)
y = 580
d.text((x, y), "Students trade what they know,", font=serif(56), fill=INK)
highlight(d, x, y + 76, "and track what they actually learn", serif(56))
im.save(f"{OUT}/title.png")

# ---- purpose
im = Image.new("RGB", (W, H), PAPER); d = ImageDraw.Draw(im)
d.rectangle([0, 0, 350, H], fill=GREEN)
d.text((40, 50), "hermes.", font=serif(42), fill=ONGREEN)
x, width = 470, 1240
d.text((x, 210), "The problem", font=sans(26, 500), fill=MUTED)
y = 262
for line in wrap(d, "Every student knows something another student wants to learn", serif(68), width):
    d.text((x, y), line, font=serif(68), fill=INK); y += 86
y += 40
y = paragraph(d, x, y, "But there is no easy, safe way to find that person, agree on a time, and see whether anyone actually learned something.", sans(34), width, MUTED, 54)
y += 34
d.line([x, y, x + width, y], fill=LINE, width=2); y += 34
d.text((x, y), "What Hermes does", font=sans(26, 500), fill=MUTED)
paragraph(d, x, y + 48, "It matches students who can teach each other, connects them through an introduction, plans the session and records real learning progress.", sans(34), width, INK, 54)
im.save(f"{OUT}/purpose.png")

# ---- next steps
im = Image.new("RGB", (W, H), PAPER); d = ImageDraw.Draw(im)
d.rectangle([0, 0, 350, H], fill=GREEN)
d.text((40, 50), "hermes.", font=serif(42), fill=ONGREEN)
x, width = 470, 1260
d.text((x, 150), "Where it goes next", font=sans(26, 500), fill=MUTED)
d.text((x, 196), "Next steps in development", font=serif(72), fill=INK)
items = [
    ("Real accounts and a shared database", "so students on different devices can find and message each other"),
    ("Live chat and video calls across devices", "replacing today's same-browser experiment"),
    ("A shared whiteboard for sessions", "for sketching chords, code and diagrams together"),
    ("Follow-up sessions from “practice next”", "so every session suggests the next one"),
]
y = 340
for i, (head, sub) in enumerate(items):
    d.line([x, y, x + width, y], fill=LINE, width=2)
    d.text((x, y + 26), f"0{i + 1}", font=sans(28, 500), fill=MUTED)
    d.text((x + 80, y + 20), head, font=sans(36, 500), fill=INK)
    d.text((x + 80, y + 72), sub, font=sans(28), fill=MUTED)
    y += 132
d.line([x, y, x + width, y], fill=LINE, width=2)
d.rectangle([x, y + 44, x + 6, y + 120], fill="#1B6156")
paragraph(d, x + 30, y + 44, "Today it is a working prototype: data stays in one browser, and the profile switcher stands in for sign-in.", sans(28), width - 40, MUTED, 40)
im.save(f"{OUT}/next.png")

# ---- closing
im = Image.new("RGB", (W, H), BAND); d = ImageDraw.Draw(im)
f = serif(140); tw = d.textlength("hermes.", font=f)
d.text(((W - tw) / 2, 380), "hermes.", font=f, fill=ONGREEN)
f2 = sans(36); line = "A little help goes both ways."
d.text(((W - d.textlength(line, font=f2)) / 2, 590), line, font=f2, fill=LIME)
im.save(f"{OUT}/closing.png")

# ---- lower-third captions over the recording (content area starts at x=300)
CAPTIONS = {
    "discover": "Discover ranks partners by skills you can trade and free time you share, even across time zones",
    "introduce": "Every connection starts with an introduction, never a cold booking",
    "maya_accepts": "The demo switcher shows the other side: Maya accepts and replies",
    "plan": "Eric sees the unread message and plans a session. One click fills a time they are both free",
    "maya_books": "Maya accepts the session request",
    "practice": "In a skill exchange, the timer switches who teaches halfway through",
    "journal": "Each learner records confidence before and after, an independent task result and what to practice next",
    "progress": "Progress measures learning, not just minutes",
    "feedback": "Partners only see the feedback that was shared with them",
}
font = sans(32, 500)
for key, text in CAPTIONS.items():
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    maxw = 1180
    lines = wrap(d, text, font, maxw)
    tw = max(d.textlength(l, font=font) for l in lines)
    bw, bh = tw + 80, 46 * len(lines) + 48
    cx = 350 + (W - 350) / 2
    bx, by = cx - bw / 2, H - 64 - bh
    d.rounded_rectangle([bx + 6, by + 8, bx + bw + 6, by + bh + 8], radius=6, fill=(16, 37, 28, 70))
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=6, fill=GREEN)
    d.rectangle([bx, by, bx + 6, by + bh], fill=LIME)
    ty = by + 22
    for l in lines:
        d.text((bx + 44, ty), l, font=font, fill=ONGREEN); ty += 46
    im.save(f"{OUT}/cap_{key}.png")
print("ok", sorted(os.listdir(OUT)))
