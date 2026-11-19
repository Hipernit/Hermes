"""Edit the recorded frames and cards into the final demo video (1920x1080, 30 fps, H.264 + silent AAC)."""
import json, os, subprocess, shutil

D = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(D, "scenes"); os.makedirs(OUT, exist_ok=True)
frames = json.load(open(f"{D}/frames.json"))
markers = json.load(open(f"{D}/markers.json"))
T0 = frames[0]["t"]
ENC = ["-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", "30", "-g", "60", "-an"]
PAPER, GREEN = "0xf3f1ec", "0x19454B"
SPEED = {"introduce": 1.25, "plan": 1.15, "journal": 1.5}
CAP_DELAY = {"practice": 5.0}  # wait until the practice dialog is on screen
CAPTIONED = ["discover", "introduce", "maya_accepts", "plan", "maya_books", "practice", "journal", "progress", "feedback"]

def run(args, name):
    tmp = f"{OUT}/{name}.tmp.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args, *ENC, tmp], check=True)
    os.replace(tmp, f"{OUT}/{name}.mp4")
    return f"{OUT}/{name}.mp4"

def still(name, png, dur, fade_in=None, fade_out=None):
    vf = f"format=yuv420p,loop=-1:1,trim=duration={dur}"
    if fade_in: vf += f",fade=t=in:st=0:d=0.5:color={fade_in}"
    if fade_out: vf += f",fade=t=out:st={dur - 0.5}:d=0.5:color={fade_out}"
    return run(["-framerate", "30", "-i", png, "-vf", vf], name)

def scene(i, name, start, end, first=False, last=False):
    speed = SPEED.get(name, 1.0)
    lines, picked = [], [f for f in frames if start <= f["t"] - T0 < end]
    before = [f for f in frames if f["t"] - T0 < start]
    if before: picked = [before[-1]] + picked
    for k, f in enumerate(picked):
        t = max(f["t"] - T0, start)
        nxt = (picked[k + 1]["t"] - T0) if k + 1 < len(picked) else end
        lines.append(f"file '{D}/frames/{f['file']}'\nduration {max(nxt - t, 0.001):.4f}")
    lines.append(f"file '{D}/frames/{picked[-1]['file']}'")
    lst = f"{OUT}/{name}.txt"; open(lst, "w").write("\n".join(lines) + "\n")
    dur = (end - start) / speed
    fc = f"[0:v]setpts=(PTS-STARTPTS)/{speed},fps=30,scale=1920:1080,format=yuv420p[v];" \
         f"[1:v]format=rgba,fade=t=in:st={0.3 + CAP_DELAY.get(name, 0)}:d=0.35:alpha=1,fade=t=out:st={dur - 0.55:.3f}:d=0.35:alpha=1[c];" \
         f"[v][c]overlay=0:0:shortest=1,trim=duration={dur:.3f}"
    if first: fc += f",fade=t=in:st=0:d=0.5:color={PAPER}"
    if last: fc += f",fade=t=out:st={dur - 0.6:.3f}:d=0.6:color={PAPER}"
    fc += "[out]"
    return run(["-f", "concat", "-safe", "0", "-i", lst, "-loop", "1", "-framerate", "30", "-i", f"{D}/cards/cap_{name}.png",
                "-filter_complex", fc, "-map", "[out]"], f"{i:02d}_{name}"), dur

parts, total = [], 0
parts.append(still("00_title", f"{D}/cards/title.png", 4.0, fade_in=PAPER, fade_out=PAPER)); total += 4.0
parts.append(still("01_purpose", f"{D}/cards/purpose.png", 7.5, fade_in=PAPER, fade_out=PAPER)); total += 7.5
times = {m["scene"]: m["t"] - T0 for m in markers}
order = CAPTIONED + ["end"]
for k, name in enumerate(CAPTIONED):
    start, end = times[name], times[order[k + 1]]
    if name == "feedback": end = min(end, frames[-1]["t"] - T0 + 1.0)
    path, dur = scene(10 + k, name, start, end, first=(k == 0), last=(name == CAPTIONED[-1]))
    parts.append(path); total += dur
    print(f"{name:14} {dur:5.1f}s")
parts.append(still("90_next", f"{D}/cards/next.png", 9.5, fade_in=PAPER, fade_out=GREEN)); total += 9.5
parts.append(still("91_closing", f"{D}/cards/closing.png", 3.5, fade_in=GREEN, fade_out=GREEN)); total += 3.5

open(f"{OUT}/concat.txt", "w").write("".join(f"file '{p}'\n" for p in parts))
video = f"{D}/hermes-demo-video-only.mp4"
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", f"{OUT}/concat.txt", "-c", "copy", video], check=True)
final_tmp = f"{D}/Hermes-demo.tmp.mp4"
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", video, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
                "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", final_tmp], check=True)
os.replace(final_tmp, f"{D}/Hermes-demo.mp4")
print(f"planned total {total:.1f}s")
