"""Обои с природой: лес, озеро, луг, побережье, осень, каньон.

Плоские иллюстрации в стиле остальных обоев HypeDE: градиентное небо,
солнце или луна, слои пейзажа от дальнего к ближнему. Только пути, круги,
прямоугольники и градиенты — без фильтров, масок и узоров, чтобы картинка
одинаково рисовалась в GNOME (librsvg) и в «Настройках» (Qt SVG).

Каждая сцена — функция scene(dark, rnd) → список элементов SVG поверх неба.
"""

from __future__ import annotations

import random
from math import cos, pi, sin

W, H = 2560, 1600


def _f(v: float) -> str:
    return f"{v:.0f}"


class Svg:
    def __init__(self) -> None:
        self.defs: list[str] = []
        self.body: list[str] = []
        self._n = 0

    def gradient(self, stops, vertical=True, x1=0.0, y1=0.0, x2=None, y2=None) -> str:
        """Линейный градиент, stops — [(offset, цвет, прозрачность), …]."""
        self._n += 1
        gid = f"g{self._n}"
        if x2 is None:
            x2, y2 = (0.0, 1.0) if vertical else (1.0, 0.0)
        s = "".join(f'<stop offset="{o}" stop-color="{c}" stop-opacity="{a}"/>' for o, c, a in stops)
        self.defs.append(f'<linearGradient id="{gid}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">{s}</linearGradient>')
        return f"url(#{gid})"

    def radial(self, cx, cy, r, color, opacity) -> str:
        self._n += 1
        gid = f"g{self._n}"
        self.defs.append(f'<radialGradient id="{gid}" cx="{cx}" cy="{cy}" r="{r}">'
                         f'<stop offset="0" stop-color="{color}" stop-opacity="{opacity}"/>'
                         f'<stop offset="1" stop-color="{color}" stop-opacity="0"/></radialGradient>')
        return f"url(#{gid})"

    def add(self, element: str) -> None:
        self.body.append("  " + element)

    def render(self) -> str:
        return "\n".join([f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">',
                          "  <defs>", *("    " + d for d in self.defs), "  </defs>", *self.body, "</svg>"]) + "\n"


# ---------------------------------------------------------------- примитивы

def ridge(rnd, base, amp, step=80, rough=0.55, y_jitter=0.0):
    """Линия хребта слева направо: случайное блуждание с затуханием."""
    pts, y, v = [], base, 0.0
    for x in range(-step, W + 2 * step, step):
        v = v * rough + rnd.uniform(-amp, amp)
        y = base + v + rnd.uniform(-y_jitter, y_jitter)
        pts.append((x, y))
    return pts


def smooth_path(pts, bottom=H + 10) -> str:
    """Плавная кривая через точки (Catmull-Rom → Безье) и низ экрана."""
    d = [f"M{_f(pts[0][0])} {_f(bottom)} L{_f(pts[0][0])} {_f(pts[0][1])}"]
    for i in range(len(pts) - 1):
        p0 = pts[max(i - 1, 0)]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[min(i + 2, len(pts) - 1)]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d.append(f"C{_f(c1[0])} {_f(c1[1])} {_f(c2[0])} {_f(c2[1])} {_f(p2[0])} {_f(p2[1])}")
    d.append(f"L{_f(pts[-1][0])} {_f(bottom)} Z")
    return " ".join(d)


def peaks_path(rnd, base, height, count, bottom=H + 10):
    """Горы с острыми вершинами: седловина — вершина — седловина слева
    направо, примерно count вершин на экран."""
    width = (W + 600) / count
    pts, x = [(-300.0, base - rnd.uniform(0.05, 0.2) * height)], -300.0
    while x < W + 300:
        w = width * rnd.uniform(0.7, 1.3)
        pts.append((x + w * rnd.uniform(0.4, 0.6), base - rnd.uniform(0.55, 1.0) * height))
        x += w
        pts.append((x, base - rnd.uniform(0.05, 0.3) * height))
    d = f"M-300 {_f(bottom)} " + " ".join(f"L{_f(px)} {_f(py)}" for px, py in pts) + f" L{_f(x)} {_f(bottom)} Z"
    return d, pts


def snow_caps(pts, depth=0.22):
    """Снежные шапки: треугольники у самых высоких вершин."""
    tops = [p for p in pts[1::2] if -100 < p[0] < W + 100]
    tops.sort(key=lambda p: p[1])
    caps = []
    for x, y in tops[:4]:
        h = depth * 300
        caps.append(f"M{_f(x)} {_f(y)} L{_f(x - h * 0.9)} {_f(y + h)} L{_f(x - h * 0.35)} {_f(y + h * 0.8)} "
                    f"L{_f(x)} {_f(y + h * 1.05)} L{_f(x + h * 0.4)} {_f(y + h * 0.75)} L{_f(x + h * 0.85)} {_f(y + h)} Z")
    return caps


def pine(x, y, h):
    """Ель: ствол и три яруса лап."""
    w = h * 0.42
    parts = [f"M{_f(x - h * 0.03)} {_f(y)} L{_f(x - h * 0.03)} {_f(y - h * 0.18)} "
             f"L{_f(x + h * 0.03)} {_f(y - h * 0.18)} L{_f(x + h * 0.03)} {_f(y)} Z"]
    for k, (top, bot, wid) in enumerate(((1.0, 0.55, 0.55), (0.78, 0.33, 0.8), (0.55, 0.12, 1.0))):
        parts.append(f"M{_f(x)} {_f(y - h * top)} L{_f(x - w * wid)} {_f(y - h * bot)} "
                     f"L{_f(x + w * wid)} {_f(y - h * bot)} Z")
    return " ".join(parts)


def tree_round(x, y, h, rnd):
    """Лиственное дерево: ствол и крона из нескольких кругов (путь)."""
    r = h * 0.28
    trunk = f"M{_f(x - h * 0.04)} {_f(y)} L{_f(x - h * 0.03)} {_f(y - h * 0.55)} L{_f(x + h * 0.03)} {_f(y - h * 0.55)} L{_f(x + h * 0.04)} {_f(y)} Z"
    blobs = []
    for dx, dy, k in ((0, -0.72, 1.0), (-0.22, -0.6, 0.78), (0.22, -0.6, 0.8), (0.0, -0.95, 0.7)):
        cx, cy, rr = x + dx * h, y + dy * h, r * k * rnd.uniform(0.9, 1.1)
        blobs.append(f"M{_f(cx - rr)} {_f(cy)} a{_f(rr)} {_f(rr)} 0 1 0 {_f(2 * rr)} 0 a{_f(rr)} {_f(rr)} 0 1 0 {_f(-2 * rr)} 0 Z")
    return trunk, " ".join(blobs)


def stars(svg, rnd, count, top=0.0, bottom=0.55):
    # Своё зерно: иначе звёзды сдвинули бы случайные числа, и тёмный
    # вариант пейзажа не совпал бы со светлым.
    rnd = random.Random(count)
    for _ in range(count):
        x, y = rnd.uniform(0, W), rnd.uniform(top * H, bottom * H)
        svg.add(f'<circle cx="{_f(x)}" cy="{_f(y)}" r="{rnd.choice((1.2, 1.6, 2.2))}" fill="#ffffff" opacity="{rnd.uniform(0.3, 0.9):.2f}"/>')


def cloud(svg, x, y, s, color, opacity):
    d = []
    for dx, dy, r in ((0, 0, 1.0), (-1.1, 0.25, 0.7), (1.1, 0.2, 0.75), (-0.5, -0.45, 0.75), (0.55, -0.4, 0.7)):
        cx, cy, rr = x + dx * s, y + dy * s, r * s
        d.append(f"M{_f(cx - rr)} {_f(cy)} a{_f(rr)} {_f(rr)} 0 1 0 {_f(2 * rr)} 0 a{_f(rr)} {_f(rr)} 0 1 0 {_f(-2 * rr)} 0 Z")
    svg.add(f'<path d="{" ".join(d)}" fill="{color}" opacity="{opacity}"/>')


def sky(svg, top, bottom, glow=None):
    svg.add(f'<rect width="{W}" height="{H}" fill="{svg.gradient([(0, top, 1), (1, bottom, 1)])}"/>')
    if glow:
        color, cx, cy, opacity = glow
        svg.add(f'<rect width="{W}" height="{H}" fill="{svg.radial(cx, cy, 0.5, color, opacity)}"/>')


def disc(svg, x, y, r, color, opacity=1.0, halo=None):
    if halo:
        svg.add(f'<circle cx="{_f(x)}" cy="{_f(y)}" r="{_f(r * 3)}" fill="{svg.radial(0.5, 0.5, 0.5, halo, 0.45)}"/>')
    svg.add(f'<circle cx="{_f(x)}" cy="{_f(y)}" r="{_f(r)}" fill="{color}" opacity="{opacity}"/>')


def fog(svg, y, height, color, opacity):
    fill = svg.gradient([(0, color, 0), (0.5, color, opacity), (1, color, 0)])
    svg.add(f'<rect x="0" y="{_f(y)}" width="{W}" height="{_f(height)}" fill="{fill}"/>')


# ------------------------------------------------------------------- сцены

def forest(dark, rnd):
    """Еловый лес в тумане: горы, ряды елей, полосы тумана между ними."""
    svg = Svg()
    if dark:
        sky(svg, "#0b1622", "#1b2d38", ("#5c88a6", 0.7, 0.2, 0.35))
        stars(svg, rnd, 80, 0, 0.4)
        disc(svg, 0.72 * W, 0.18 * H, 60, "#e8eef5", 0.9, "#9fb8cf")
        hills, rows, mist = ["#1d3140", "#183041"], ["#15283a", "#11222f", "#0c1924", "#08121a"], "#3d5a6e"
    else:
        sky(svg, "#cfe3e6", "#eef3ea", ("#fff8e8", 0.3, 0.25, 0.7))
        disc(svg, 0.3 * W, 0.24 * H, 85, "#fffdf6", 0.95, "#ffffff")
        hills, rows, mist = ["#a9c4c4", "#8fb2ae"], ["#79a39a", "#5d8a7f", "#3f6d62", "#24504a"], "#ffffff"
    for i, color in enumerate(hills):
        d, _ = peaks_path(rnd, 0.52 * H + i * 60, 260 - i * 60, 6)
        svg.add(f'<path d="{d}" fill="{color}"/>')
    for i, color in enumerate(rows):
        base = 0.62 * H + i * 0.11 * H
        fog(svg, base - 160, 220, mist, 0.35 if not dark else 0.18)
        svg.add(f'<path d="{smooth_path(ridge(rnd, base + 30, 10))}" fill="{color}"/>')
        h0 = 150 + i * 70
        x = rnd.uniform(-60, 0)
        trees = []
        while x < W + 60:
            trees.append(pine(x, base + 40 + rnd.uniform(-10, 10), h0 * rnd.uniform(0.75, 1.15)))
            x += h0 * rnd.uniform(0.28, 0.5)
        svg.add(f'<path d="{" ".join(trees)}" fill="{color}"/>')
    return svg.render()


def lake(dark, rnd):
    """Горное озеро: снежные вершины и их отражение в воде."""
    svg = Svg()
    if dark:
        sky(svg, "#0a1020", "#1d2440", ("#8a7bd6", 0.5, 0.3, 0.3))
        stars(svg, rnd, 110, 0, 0.45)
        disc(svg, 0.5 * W, 0.2 * H, 55, "#f1f0ff", 0.92, "#b7b0ff")
        far, near, snow, water, shore = "#2c3155", "#20264a", "#c9cdf0", ("#1b2142", "#0d1228"), "#0b1022"
    else:
        sky(svg, "#bfdcf5", "#f4efe6", ("#ffffff", 0.5, 0.3, 0.6))
        disc(svg, 0.5 * W, 0.22 * H, 80, "#fffaf0", 0.95, "#ffffff")
        far, near, snow, water, shore = "#9db5cf", "#7c97b6", "#ffffff", ("#9cc3df", "#d8e8f1"), "#4f6e5e"
    horizon = 0.62 * H
    d1, p1 = peaks_path(rnd, horizon, 520, 5, bottom=horizon)
    d2, p2 = peaks_path(rnd, horizon, 330, 7, bottom=horizon)
    svg.add(f'<path d="{d1}" fill="{far}"/>')
    svg.add(f'<path d="{" ".join(snow_caps(p1))}" fill="{snow}" opacity="0.9"/>')
    svg.add(f'<path d="{d2}" fill="{near}"/>')
    svg.add(f'<rect x="0" y="{_f(horizon)}" width="{W}" height="{_f(H - horizon)}" fill="{svg.gradient([(0, water[0], 1), (1, water[1], 1)])}"/>')
    # Отражение — те же горы, отражённые вниз от линии воды.
    svg.add(f'<g transform="translate(0 {_f(2 * horizon)}) scale(1 -1)" opacity="0.35">'
            f'<path d="{d1}" fill="{far}"/><path d="{d2}" fill="{near}"/></g>')
    for _ in range(26):
        y = rnd.uniform(horizon + 20, H - 40)
        x = rnd.uniform(0, W)
        w = rnd.uniform(80, 360)
        svg.add(f'<rect x="{_f(x)}" y="{_f(y)}" width="{_f(w)}" height="3" rx="1.5" fill="#ffffff" opacity="{rnd.uniform(0.08, 0.25):.2f}"/>')
    svg.add(f'<path d="{smooth_path(ridge(rnd, H - 70, 16, step=160))}" fill="{shore}"/>')
    return svg.render()


def meadow(dark, rnd):
    """Луг: холмы, одинокое дерево, облака (ночью — светлячки)."""
    svg = Svg()
    if dark:
        sky(svg, "#0d1a2b", "#24304a", ("#e6c37a", 0.8, 0.3, 0.18))
        stars(svg, rnd, 70, 0, 0.5)
        disc(svg, 0.82 * W, 0.2 * H, 50, "#fff2cf", 0.9, "#f5d78c")
        hills = ["#22344a", "#1c2d3f", "#152434"]
        tree, glow = "#0e1a26", True
    else:
        sky(svg, "#a9d6f5", "#eef8f0", ("#ffffff", 0.75, 0.22, 0.6))
        disc(svg, 0.78 * W, 0.2 * H, 90, "#fffbea", 0.95, "#ffffff")
        for x, y, s in ((0.18, 0.2, 70), (0.45, 0.13, 55), (0.62, 0.3, 45)):
            cloud(svg, x * W, y * H, s, "#ffffff", 0.85)
        hills = ["#a8d5a2", "#7fc27c", "#5aa95d"]
        tree, glow = "#3c7a45", False
    bases = (0.6, 0.72, 0.84)
    for base, color in zip(bases, hills):
        svg.add(f'<path d="{smooth_path(ridge(rnd, base * H, 50, step=320, rough=0.4))}" fill="{color}"/>')
    trunk, crown = tree_round(0.3 * W, 0.735 * H, 360, rnd)
    svg.add(f'<path d="{trunk}" fill="{tree}"/>')
    svg.add(f'<path d="{crown}" fill="{tree}"/>')
    if glow:
        for _ in range(40):
            x, y = rnd.uniform(0, W), rnd.uniform(0.62 * H, 0.97 * H)
            svg.add(f'<circle cx="{_f(x)}" cy="{_f(y)}" r="{rnd.uniform(2, 4):.1f}" fill="#f6e27a" opacity="{rnd.uniform(0.4, 0.95):.2f}"/>')
    else:
        colors = ("#ffffff", "#ffd54f", "#f48fb1", "#ce93d8")
        for _ in range(140):
            x, y = rnd.uniform(0, W), rnd.uniform(0.8 * H, H)
            svg.add(f'<circle cx="{_f(x)}" cy="{_f(y)}" r="{rnd.uniform(3, 6):.1f}" fill="{rnd.choice(colors)}" opacity="0.9"/>')
    return svg.render()


def coast(dark, rnd):
    """Побережье: море до горизонта, скалы, дорожка от солнца на воде."""
    svg = Svg()
    horizon = 0.6 * H
    if dark:
        sky(svg, "#091424", "#20314d", ("#6c8fc7", 0.62, 0.42, 0.3))
        stars(svg, rnd, 90, 0, 0.45)
        sun = (0.62 * W, 0.34 * H, 60, "#eef3ff", "#9db7ff")
        sea, cliff, path = ("#14243d", "#060c18"), ("#0c1626", "#111d31"), "#cfdcff"
    else:
        sky(svg, "#ffd1a8", "#ffefe0", ("#fff3dc", 0.62, 0.45, 0.8))
        sun = (0.62 * W, 0.47 * H, 110, "#fff6e3", "#ffe1b8")
        sea, cliff, path = ("#f0a67e", "#4c6f97"), ("#6b4a5a", "#4a3448"), "#fff2d6"
    disc(svg, sun[0], sun[1], sun[2], sun[3], 0.95, sun[4])
    svg.add(f'<rect x="0" y="{_f(horizon)}" width="{W}" height="{_f(H - horizon)}" fill="{svg.gradient([(0, sea[0], 1), (1, sea[1], 1)])}"/>')
    # Дорожка: короткие блики, к берегу шире.
    for i in range(46):
        t = i / 45
        y = horizon + 8 + t * (H - horizon - 20)
        w = 40 + t * 520 * rnd.uniform(0.5, 1.0)
        x = sun[0] - w / 2 + rnd.uniform(-30, 30) * t
        svg.add(f'<rect x="{_f(x)}" y="{_f(y)}" width="{_f(w)}" height="{_f(4 + 6 * t)}" rx="3" fill="{path}" opacity="{0.55 - 0.35 * t:.2f}"/>')
    # Скалы слева и справа.
    left = [(-50, 0.42 * H), (180, 0.4 * H), (330, 0.47 * H), (520, 0.5 * H), (640, 0.62 * H), (820, 0.78 * H), (980, H + 10)]
    svg.add('<path d="M-50 ' + _f(H + 10) + " " + " ".join(f"L{_f(x)} {_f(y)}" for x, y in left) + f' Z" fill="{cliff[0]}"/>')
    right = [(W + 50, 0.55 * H), (W - 180, 0.56 * H), (W - 300, 0.64 * H), (W - 520, 0.7 * H), (W - 700, 0.86 * H), (W - 820, H + 10)]
    svg.add(f'<path d="M{W + 50} {_f(H + 10)} ' + " ".join(f"L{_f(x)} {_f(y)}" for x, y in right) + f' Z" fill="{cliff[1]}"/>')
    # Пена у скал.
    for x0, x1, y0, y1 in ((560, 900, 0.66 * H, 0.84 * H), (W - 760, W - 420, 0.74 * H, 0.9 * H)):
        for _ in range(8):
            x, y = rnd.uniform(x0, x1), rnd.uniform(y0, y1)
            svg.add(f'<rect x="{_f(x)}" y="{_f(y)}" width="{_f(rnd.uniform(40, 140))}" height="4" rx="2" fill="#ffffff" opacity="{rnd.uniform(0.25, 0.6):.2f}"/>')
    return svg.render()


def autumn(dark, rnd):
    """Осень: холмы и рощи в рыжем и красном."""
    svg = Svg()
    if dark:
        sky(svg, "#1a0f1e", "#3a2230", ("#ff9a5a", 0.3, 0.6, 0.35))
        stars(svg, rnd, 40, 0, 0.3)
        disc(svg, 0.3 * W, 0.42 * H, 80, "#ffb27a", 0.7, "#ff8a50")
        hills = ["#3a2433", "#2e1c2a", "#241622"]
        crowns = ["#5a2a2e", "#6e3326", "#4a2430", "#7a3a22"]
        trunk = "#1b1018"
    else:
        sky(svg, "#ffe2c2", "#fff5e8", ("#fff0d6", 0.3, 0.5, 0.8))
        disc(svg, 0.3 * W, 0.42 * H, 100, "#fff4dc", 0.95, "#ffe0b0")
        hills = ["#e9b98a", "#d99a62", "#c27a45"]
        crowns = ["#e2703a", "#f0a030", "#c94a32", "#f2c14e"]
        trunk = "#6b4430"
    for i, (base, color) in enumerate(zip((0.6, 0.72, 0.85), hills)):
        pts = ridge(rnd, base * H, 45, step=300, rough=0.4)
        svg.add(f'<path d="{smooth_path(pts)}" fill="{color}"/>')
        x = rnd.uniform(-40, 40)
        size = 110 + i * 70
        trunks, by_color = [], {c: [] for c in crowns}
        while x < W + 60:
            y = base * H + 20 + rnd.uniform(-8, 12)
            t, c = tree_round(x, y, size * rnd.uniform(0.8, 1.2), rnd)
            trunks.append(t)
            by_color[rnd.choice(crowns)].append(c)
            x += size * rnd.uniform(0.45, 0.9)
        svg.add(f'<path d="{" ".join(trunks)}" fill="{trunk}"/>')
        for color, parts in by_color.items():
            if parts:
                svg.add(f'<path d="{" ".join(parts)}" fill="{color}" opacity="{0.85 + 0.05 * i:.2f}"/>')
    return svg.render()


def canyon(dark, rnd):
    """Каньон: столовые горы с плоскими вершинами в тёплых тонах."""
    svg = Svg()
    if dark:
        sky(svg, "#120c1f", "#3b2236", ("#ff8a65", 0.5, 0.65, 0.3))
        stars(svg, rnd, 120, 0, 0.55)
        disc(svg, 0.7 * W, 0.2 * H, 45, "#ffe9d6", 0.9, "#ffb48a")
        layers = ["#3b2133", "#4a2532", "#5a2a30", "#2a1622"]
    else:
        sky(svg, "#f9d3b0", "#fde9d8", ("#ffffff", 0.7, 0.3, 0.6))
        disc(svg, 0.7 * W, 0.26 * H, 95, "#fff6ea", 0.95, "#ffffff")
        layers = ["#e3a27a", "#d0805a", "#b9603f", "#8f4632"]
    for i, color in enumerate(layers):
        base = (0.55 + 0.12 * i) * H
        x, pts = -100.0, [(-100.0, base)]
        while x < W + 100:
            w = rnd.uniform(160, 420)
            top = base - rnd.uniform(60, 220) * (1 - i * 0.15)
            slope = rnd.uniform(30, 70)
            pts += [(x + slope, top), (x + w - slope, top), (x + w, base - rnd.uniform(0, 40))]
            x += w + rnd.uniform(0, 120)
            pts.append((x, base))
        d = f"M-100 {_f(H + 10)} " + " ".join(f"L{_f(px)} {_f(py)}" for px, py in pts) + f" L{_f(x)} {_f(H + 10)} Z"
        svg.add(f'<path d="{d}" fill="{color}"/>')
    return svg.render()


# name: (функция, цвет неба светлый, тёмный — для списка обоев GNOME)
SCENES = {
    "forest": (forest, "#cfe3e6", "#0b1622"),
    "lake": (lake, "#bfdcf5", "#0a1020"),
    "meadow": (meadow, "#a9d6f5", "#0d1a2b"),
    "coast": (coast, "#ffd1a8", "#091424"),
    "autumn": (autumn, "#ffe2c2", "#1a0f1e"),
    "canyon": (canyon, "#f9d3b0", "#120c1f"),
}


def render(name: str, dark: bool) -> str:
    func = SCENES[name][0]
    # Одинаковое зерно для светлого и тёмного варианта: один и тот же пейзаж.
    return func(dark, random.Random(f"hypede-{name}"))
