import bisect, functools, json, math, os, sys
from multiprocessing import Pool
from PIL import Image, ImageDraw, ImageFilter, ImageFont

VS = "/tmp/vs"; REC = "/tmp/rec"; FPS = 60; DUR = 30.0
FONT = "/usr/share/fonts/TTF/Roboto-%s.ttf"
ACCENT = (138, 180, 248); BLUE = (26, 115, 232); NAVY = (11, 16, 32)
MODE = sys.argv[1]; OUT = f"/tmp/frames-{MODE}"
W, H = (1920, 1080) if MODE == "wide" else (1080, 1920)
V = MODE != "wide"

def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def out_cubic(x): x = clamp(x); return 1 - (1 - x) ** 3
def in_out(x): x = clamp(x); return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2
def out_back(x, s=1.6): x = clamp(x); return 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2
def lerp(a, b, x): return a + (b - a) * x

@functools.lru_cache(maxsize=None)
def font(weight, size): return ImageFont.truetype(FONT % weight, size)

@functools.lru_cache(maxsize=24)
def still(name, w=1920, h=1080):
    return Image.open(f"{VS}/{name}.png").convert("RGB").resize((w, h), Image.LANCZOS)

@functools.lru_cache(maxsize=None)
def seg_times(name):
    times = json.load(open(f"{REC}/{name}/times.json"))
    f = float(open(f"{REC}/{name}/factor").read())
    return [x / 1e6 / f for x in times]

@functools.lru_cache(maxsize=12)
def seg_frame(name, i): return Image.open(f"{REC}/{name}/f{i:05d}.png").convert("RGB")

def seg(name, tau):
    ts = seg_times(name); i = clamp(bisect.bisect_right(ts, tau) - 1, 0, len(ts) - 1)
    return seg_frame(name, int(i))

@functools.lru_cache(maxsize=8)
def blurred(name, w, h, dark=0.45):
    im = still(name).resize((w // 8, h // 8)).filter(ImageFilter.GaussianBlur(6)).resize((w, h), Image.BILINEAR)
    return Image.blend(im, Image.new("RGB", (w, h), NAVY), dark)

def cover(img, w, h, zoom=1.0, cx=0.5, cy=0.5):
    iw, ih = img.size; s = max(w / iw, h / ih) * zoom
    nw, nh = int(iw * s), int(ih * s)
    im = img.resize((nw, nh), Image.BILINEAR)
    x = int(clamp(cx * nw - w / 2, 0, nw - w)); y = int(clamp(cy * nh - h / 2, 0, nh - h))
    return im.crop((x, y, x + w, y + h))

def coeffs(src, dst):
    import numpy as np
    A = []; B = []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return np.linalg.solve(np.array(A, float), np.array(B, float)).tolist()

@functools.lru_cache(maxsize=4)
def round_mask(w, h, r):
    m = Image.new("L", (w * 2, h * 2), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w * 2 - 1, h * 2 - 1), r * 2, fill=255)
    return m.resize((w, h), Image.LANCZOS)

def card(frame, img, cx, cy, w, ry=0.0, rx=0.0, alpha=1.0, radius=22, shadow=True):
    h = int(w * img.size[1] / img.size[0]); w = int(w)
    im = img.resize((w, h), Image.BILINEAR).convert("RGBA"); im.putalpha(round_mask(w, h, radius))
    d = 2600.0; pts = []
    for (x, y) in [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]:
        x2 = x * math.cos(ry); z = x * math.sin(ry)
        y2 = y * math.cos(rx); z += y * math.sin(rx)
        f = d / (d + z); pts.append((cx + x2 * f, cy + y2 * f))
    if shadow:
        sh = Image.new("L", (W // 4, H // 4), 0)
        ImageDraw.Draw(sh).polygon([(px / 4, py / 4 + 10) for px, py in pts], fill=int(150 * alpha))
        sh = sh.filter(ImageFilter.GaussianBlur(10)).resize((W, H), Image.BILINEAR)
        frame.paste(Image.new("RGB", (W, H), (0, 0, 0)), (0, 0), sh)
    if ry == 0 and rx == 0:
        x0, y0 = int(pts[0][0]), int(pts[0][1])
        if alpha < 1: im.putalpha(im.getchannel("A").point(lambda a: int(a * alpha)))
        frame.paste(im, (x0, y0), im); return
    minx = int(min(p[0] for p in pts)); miny = int(min(p[1] for p in pts))
    maxx = int(max(p[0] for p in pts)) + 1; maxy = int(max(p[1] for p in pts)) + 1
    loc = [(px - minx, py - miny) for px, py in pts]
    warped = im.transform((maxx - minx, maxy - miny), Image.PERSPECTIVE,
                          coeffs([(0, 0), (w, 0), (w, h), (0, h)], loc), Image.BILINEAR)
    if alpha < 1: warped.putalpha(warped.getchannel("A").point(lambda a: int(a * alpha)))
    frame.paste(warped, (minx, miny), warped)

def text(frame, lines, t, x, y, align="left", t0=0.0, color=(255, 255, 255), out=None):
    layer = Image.new("RGBA", (W, H)); shadow = Image.new("RGBA", (W, H)); dr = ImageDraw.Draw(layer); ds = ImageDraw.Draw(shadow)
    k = 0
    for weight, size, string, col in lines:
        f = font(weight, size); words = string.split(" "); space = f.getlength(" ")
        widths = [f.getlength(wd) for wd in words]; total = sum(widths) + space * (len(words) - 1)
        cx = x - (total / 2 if align == "center" else 0)
        for wd, ww in zip(words, widths):
            p = (t - t0 - k * 0.045) / 0.45; k += 1
            a = out_cubic(p) if out is None else out_cubic(p) * (1 - out_cubic((t - out) / 0.3))
            dy = (1 - out_back(p, 1.3)) * size * 0.6
            if a > 0.01:
                c = col or color
                ds.text((cx, y + dy + 3), wd, font=f, fill=(0, 0, 0, int(150 * a)))
                dr.text((cx, y + dy), wd, font=f, fill=(*c, int(255 * a)))
            cx += ww + space
        y += int(size * 1.22)
    frame.paste(shadow.filter(ImageFilter.GaussianBlur(8)), (0, 0), shadow.filter(ImageFilter.GaussianBlur(8)))
    frame.paste(layer, (0, 0), layer)

def waves_wipe(frame, p, seed=0):
    if p <= 0 or p >= 1: return
    cols = [NAVY, (24, 55, 120), BLUE, ACCENT]
    layer = ImageDraw.Draw(frame)
    for i, c in enumerate(cols):
        q = clamp(p * 1.25 - i * 0.08)
        edge_in = in_out(clamp(q * 2)); edge_out = in_out(clamp(q * 2 - 1))
        lead = lerp(-0.25, 1.25, edge_in); tail = lerp(-0.25, 1.25, edge_out)
        if lead <= tail: continue
        poly = []
        for s in range(0, 41):
            yy = s / 40 * H; amp = 0.06 * W
            poly.append((lead * W + amp * math.sin(yy / H * 5 + i + seed + p * 6), yy))
        for s in range(40, -1, -1):
            yy = s / 40 * H
            poly.append((tail * W + 0.06 * W * math.sin(yy / H * 5 + i + 2 + seed + p * 6), yy))
        layer.polygon(poly, fill=c)

def chip(label, scale=1.0):
    f = font("Medium", int(34 * scale)); w = int(f.getlength(label) + 56 * scale); h = int(64 * scale)
    im = Image.new("RGBA", (w, h)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, w - 1, h - 1), h // 2, fill=(32, 37, 52, 235), outline=(*ACCENT, 140), width=2)
    d.text((28 * scale, h / 2), label, font=f, fill=(235, 240, 255), anchor="lm"); return im

def paste_scaled(frame, im, cx, cy, s, alpha=1.0):
    if s <= 0.01 or alpha <= 0.01: return
    w, h = int(im.size[0] * s), int(im.size[1] * s)
    if w < 2 or h < 2: return
    r = im.resize((w, h), Image.BILINEAR)
    if alpha < 1: r.putalpha(r.getchannel("A").point(lambda a: int(a * alpha)))
    frame.paste(r, (int(cx - w / 2), int(cy - h / 2)), r)

CAPS = {
    "C": ("Find anything", "Apps, files, settings, math and the web"),
    "D": ("Make it yours", "Themes, colors, live wallpapers"),
    "E": ("Wallpapers that move", "They pause when windows cover them"),
    "F": ("One tap away", "Quick settings, dark style, Do Not Disturb"),
    "G": ("AI, built in", "Your account. It only chats."),
    "H": ("A lock screen that moves", "Waves, a big clock, smooth unlock"),
    "I": ("Little things, done right", "Clipboard history · Reopen closed windows"),
}

def caption(frame, key, t, t0, t1):
    head, sub = CAPS[key]
    if V:
        text(frame, [("Bold", 92, head, None), ("Regular", 44, sub, (200, 210, 230))], t, W / 2, 230, "center", t0 + 0.1, out=t1 - 0.3)
    else:
        frame.paste(Image.new("RGB", (W, H), (4, 6, 14)), (0, 0), vignette())
        text(frame, [("Bold", 76, head, None), ("Regular", 38, sub, (210, 220, 240))], t, 110, H - 250, "left", t0 + 0.1, out=t1 - 0.3)

@functools.lru_cache(maxsize=1)
def vignette():
    g = Image.new("L", (192, 108), 0); d = ImageDraw.Draw(g)
    for k in range(60):
        d.ellipse((-110 + k, 60 + k * 0.9, 110 - k * 0.2 + 60, 200), fill=int(k * 3.4))
    return g.filter(ImageFilter.GaussianBlur(14)).resize((W, H), Image.BILINEAR)

def footage(frame, img, t, t0, t1, bgname="desktop", ry0=0.0, ry1=0.0, z0=1.0, z1=1.06, dim=0.0, focus=(0.5, 0.5)):
    p = (t - t0) / (t1 - t0)
    if V:
        frame.paste(blurred(bgname, W, H, 0.55))
        crop = cover(img, 1000, 1250, lerp(z0, z1, in_out(p)) * 1.35, *focus)
        card(frame, crop, W / 2, H * 0.62, 980, ry=lerp(ry0, ry1, in_out(p)) * 0.5)
    else:
        z = lerp(z0, z1, in_out(p)); im = cover(img, W, H, z)
        if dim: im = Image.blend(im, Image.new("RGB", (W, H), NAVY), dim)
        frame.paste(im)
        grad = Image.linear_gradient("L").rotate(180).resize((W, H)).point(lambda v: int(v * 0.75) if v > 90 else 0)
        frame.paste(Image.new("RGB", (W, H), (5, 8, 18)), (0, 0), grad)

def scene(t):
    f = Image.new("RGB", (W, H), NAVY)
    if t < 3.0:
        im = seg("greeting", t / 3.0 * 4.5)
        if V:
            f.paste(cover(im, W, H, 1.0 + 0.04 * t / 3))
        else:
            f.paste(cover(im, W, H, 1.0 + 0.05 * t / 3))
    elif t < 5.5:
        p = (t - 3.0) / 2.5
        f.paste(blurred("desktop", W, H, 0.35))
        if V:
            card(f, cover(still("desktop"), 1000, 1250, 1.3, 0.3, 0.5), W / 2, H * 0.68, lerp(820, 960, out_cubic(p)), ry=lerp(0.4, 0.1, out_cubic(p)), alpha=out_cubic(p * 2))
            text(f, [("Medium", 46, "HypeDE", ACCENT), ("Bold", 104, "A Chrome OS–style", None), ("Bold", 104, "desktop for Linux", None)], t, W / 2, 330, "center", 3.05, out=5.3)
        else:
            card(f, still("desktop"), W * 0.76, H * 0.52, lerp(700, 860, out_cubic(p)), ry=lerp(-0.55, -0.32, out_cubic(p)), alpha=out_cubic(p * 2))
            text(f, [("Medium", 40, "HypeDE", ACCENT), ("Bold", 88, "A Chrome OS–style", None), ("Bold", 88, "desktop for Linux", None)], t, 110, 360, "left", 3.05, out=5.3)
    elif t < 9.0:
        p = (t - 5.5) / 3.5
        im = seg("launcher", lerp(0.0, 2.4, clamp(p * 1.15)))
        if V:
            footage(f, im, t, 5.5, 9.0, ry0=0.25, ry1=-0.05, focus=(0.5, 0.25))
        else:
            f.paste(blurred("desktop", W, H, 0.4))
            card(f, im, W * 0.62, H * 0.47, lerp(1180, 1260, in_out(p)), ry=lerp(-0.35, -0.12, in_out(p)))
        caption(f, "C", t, 5.5, 9.0)
    elif t < 12.0:
        names = ["sakura", "neon", "ember", "lagoon", "midnight", "graphite"]
        i = min(5, int((t - 9.0) / 0.5)); lt = (t - 9.0) - i * 0.5
        im = still("theme-" + names[i])
        footage(f, im, lt, 0, 0.5, bgname="theme-" + names[i], z0=1.12, z1=1.0, focus=(0.5, 0.3))
        if lt < 0.08:
            f = Image.blend(f, Image.new("RGB", (W, H), (255, 255, 255)), 0.35 * (1 - lt / 0.08))
        caption(f, "D", t, 9.0, 12.0)
    elif t < 15.0:
        p = (t - 12.0) / 3.0
        im = seg("live-aurora", lerp(0.0, 2.4, p))
        footage(f, im, t, 12.0, 15.0, bgname="live-bokeh", z0=1.0, z1=1.08)
        names = ["live-waves", "live-bokeh", "live-mesh"]
        for k, n in enumerate(names):
            q = out_back((t - 12.6 - k * 0.18) / 0.5)
            if V:
                card(f, still(n), W * (0.2 + 0.3 * k), H * 0.9 + (1 - q) * 300, 300, alpha=clamp(q))
            else:
                card(f, still(n), W - 330, 180 + k * 230 + (1 - q) * 60, lerp(280, 360, q), alpha=clamp(q))
        caption(f, "E", t, 12.0, 15.0)
    elif t < 18.0:
        p = (t - 15.0) / 3.0
        im = seg("quick", lerp(0.0, 3.2, p))
        footage(f, im, t, 15.0, 18.0, z0=1.3, z1=1.3, focus=(0.92, 0.9))
        if not V:
            zoomed = cover(im, W, H, lerp(1.0, 1.55, in_out(clamp(p * 1.4))), 0.86, 0.85)
            f.paste(zoomed)
            grad = Image.linear_gradient("L").rotate(180).resize((W, H)).point(lambda v: int(v * 0.75) if v > 90 else 0)
            f.paste(Image.new("RGB", (W, H), (5, 8, 18)), (0, 0), grad)
        caption(f, "F", t, 15.0, 18.0)
    elif t < 21.0:
        p = (t - 18.0) / 3.0
        f.paste(blurred("settings-assistant", W, H, 0.5))
        if V:
            card(f, cover(still("settings-assistant"), 1000, 1150, 1.6, 0.55, 0.3), W / 2, H * 0.55, lerp(960, 1000, in_out(p)), ry=lerp(0.15, -0.05, in_out(p)))
        else:
            card(f, still("settings-assistant"), W * 0.6, H * 0.45, lerp(1150, 1250, in_out(p)), ry=lerp(-0.3, -0.1, in_out(p)))
        provs = ["Claude", "Gemini", "ChatGPT", "Mistral", "Grok", "DeepSeek"]
        for k, n in enumerate(provs):
            q = (t - 18.5 - k * 0.12) / 0.45
            c = chip(n, 1.15 if V else 1.0)
            if V:
                cx = W / 2 + ((k % 3) - 1) * 320; cy = H * 0.86 + (k // 3) * 100
            else:
                ang = -2.3 + k * 0.55; cx = W * 0.6 + math.cos(ang) * 700; cy = H * 0.45 + math.sin(ang) * 360
            paste_scaled(f, c, cx, cy + math.sin(t * 2 + k) * 6, out_back(q), clamp(q * 2))
        caption(f, "G", t, 18.0, 21.0)
    elif t < 24.0:
        p = (t - 21.0) / 3.0
        im = seg("lock", lerp(0.15, 4.0, p))
        footage(f, im, t, 21.0, 24.0, bgname="desktop", z0=1.08, z1=1.0)
        caption(f, "H", t, 21.0, 24.0)
    elif t < 26.5:
        p = (t - 24.0) / 2.5
        im = seg("clip", lerp(0.2, 1.6, clamp(p * 1.3)))
        footage(f, im, t, 24.0, 26.5, z0=1.25, z1=1.32, focus=(0.5, 0.5))
        caption(f, "I", t, 24.0, 26.5)
    else:
        p = (t - 26.5) / 3.5
        f.paste(blurred("live-waves", W, H, 0.25))
        logo = Image.open(f"{VS}/logo.png").convert("RGBA")
        s = out_back(p * 2.2, 1.8) * (0.62 if V else 0.5)
        paste_scaled(f, logo, W / 2, H * (0.38 if V else 0.34), s + 0.01 * math.sin(t * 3), clamp(p * 4))
        y = H * (0.52 if V else 0.56)
        text(f, [("Bold", 120 if V else 110, "HypeDE", None), ("Regular", 46 if V else 40, "Free and open source", (205, 215, 235)),
                 ("Medium", 52 if V else 44, "hypede.github.io", ACCENT)], t, W / 2, y, "center", 26.8)
    for cut in [3.0, 5.5, 9.0, 12.0, 15.0, 18.0, 21.0, 24.0, 26.5]:
        if cut == 12.0 or cut == 9.0: continue
        waves_wipe(f, (t - cut + 0.25) / 0.5, seed=cut)
    if t < 0.3:
        f = Image.blend(Image.new("RGB", (W, H), (0, 0, 0)), f, t / 0.3)
    if t > DUR - 0.6:
        f = Image.blend(f, Image.new("RGB", (W, H), (0, 0, 0)), (t - (DUR - 0.6)) / 0.6)
    return f

def render(i):
    path = f"{OUT}/{i:05d}.jpg"
    if not os.path.exists(path):
        scene(i / FPS).save(path, quality=93)
    return i

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    frames = range(int(DUR * FPS)) if len(sys.argv) < 3 else [int(float(x) * FPS) for x in sys.argv[2].split(",")]
    with Pool(4) as pool:
        for k, _ in enumerate(pool.imap_unordered(render, frames, chunksize=8)):
            if k % 300 == 0: print(k, flush=True)
