#!/usr/bin/env python3
"""Рисует набор обоев HypeDE (светлый и тёмный вариант каждого).

Все обои построены одинаково, как «Horizon»: градиентное небо, мягкое
свечение и три слоя «холмов» с градиентами. Отличаются палитрой, формой
слоёв и деталями (солнце, звёзды). Результат — SVG в assets/wallpapers/,
плюс список для GNOME в data/backgrounds/hypede.xml.

Запуск: python3 tools/gen-wallpapers.py
"""

from pathlib import Path
import random

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/wallpapers"
XML = ROOT / "data/backgrounds/hypede.xml"

W, H = 2560, 1600

# Формы слоёв: три пути от дальнего к ближнему.
SHAPES = {
    "waves": [
        "M0 930 C 420 780, 820 1010, 1280 900 S 2140 700, 2560 820 L 2560 1600 L 0 1600 Z",
        "M0 1110 C 520 980, 900 1180, 1420 1080 S 2200 930, 2560 1030 L 2560 1600 L 0 1600 Z",
        "M0 1320 C 600 1210, 1100 1400, 1640 1300 S 2300 1200, 2560 1260 L 2560 1600 L 0 1600 Z",
    ],
    "dunes": [
        "M0 1000 C 600 860, 1100 860, 1600 960 S 2300 1080, 2560 980 L 2560 1600 L 0 1600 Z",
        "M0 1180 C 380 1080, 900 1060, 1300 1150 S 2100 1300, 2560 1160 L 2560 1600 L 0 1600 Z",
        "M0 1380 C 700 1260, 1300 1300, 1800 1390 S 2400 1420, 2560 1370 L 2560 1600 L 0 1600 Z",
    ],
    "peaks": [
        "M0 980 C 200 960, 360 760, 560 760 C 760 760, 860 960, 1080 940 C 1300 920, 1440 640, 1700 640 "
        "C 1960 640, 2080 900, 2300 900 C 2420 900, 2500 860, 2560 840 L 2560 1600 L 0 1600 Z",
        "M0 1160 C 260 1140, 420 960, 700 960 C 980 960, 1080 1160, 1380 1150 C 1640 1140, 1780 1000, "
        "2020 1000 C 2260 1000, 2400 1120, 2560 1110 L 2560 1600 L 0 1600 Z",
        "M0 1360 C 400 1300, 700 1210, 1060 1240 C 1420 1270, 1700 1380, 2100 1330 C 2320 1300, 2460 1280, "
        "2560 1290 L 2560 1600 L 0 1600 Z",
    ],
    "ripples": [
        "M0 860 C 640 980, 1280 740, 1920 860 S 2560 900, 2560 900 L 2560 1600 L 0 1600 Z",
        "M0 1060 C 520 1160, 1180 960, 1760 1060 S 2400 1120, 2560 1080 L 2560 1600 L 0 1600 Z",
        "M0 1290 C 480 1360, 1060 1210, 1600 1290 S 2320 1340, 2560 1290 L 2560 1600 L 0 1600 Z",
    ],
}

# name: (форма, детали, светлая палитра, тёмная палитра)
# Палитра: небо (2 цвета), свечение (цвет, x, y), слои (3 × 2 цвета).
THEMES = {
    "lagoon": ("ripples", {"sun": (0.26, 0.30, 120)}, {
        "sky": ("#d8f1ef", "#f4f1e6"), "glow": ("#ffffff", 0.26, 0.30),
        "layers": [("#9fdcd4", "#c3eae3"), ("#5fc2b8", "#9ad8cf"), ("#1f9a93", "#5cbfb5")],
    }, {
        "sky": ("#062326", "#12202a"), "glow": ("#1d8d8a", 0.26, 0.30),
        "layers": [("#0f4a4d", "#123b44"), ("#12615f", "#104a50"), ("#18807a", "#115a5c")],
    }),
    "ember": ("dunes", {"sun": (0.68, 0.46, 150)}, {
        "sky": ("#fde2cf", "#f8ecf1"), "glow": ("#fff4e6", 0.68, 0.46),
        "layers": [("#f8b98f", "#f6cfb6"), ("#ee8a6a", "#f3ad93"), ("#d9566a", "#ea8a8f")],
    }, {
        "sky": ("#2a1220", "#1c1422"), "glow": ("#e0633f", 0.68, 0.46),
        "layers": [("#5d2530", "#43212f"), ("#7a2d38", "#562433"), ("#a03a45", "#6a2838")],
    }),
    "aurora": ("waves", {"stars": 90, "ribbon": True}, {
        "sky": ("#e6e4fb", "#e8f6f0"), "glow": ("#ffffff", 0.32, 0.22),
        "layers": [("#c3b8f2", "#d6d0f6"), ("#9c8ae6", "#bdb0ee"), ("#6a55cf", "#9b89e2")],
    }, {
        "sky": ("#0b0b24", "#0d1a22"), "glow": ("#35c28d", 0.32, 0.22),
        "layers": [("#241e55", "#1a1a40"), ("#2f2770", "#211d4d"), ("#40349a", "#2a2364")],
    }),
    "peaks": ("peaks", {"sun": (0.22, 0.24, 90)}, {
        "sky": ("#e3ebf3", "#f2f0ec"), "glow": ("#ffffff", 0.22, 0.24),
        "layers": [("#b9c9da", "#cfdae6"), ("#8ea6c0", "#adc0d4"), ("#5e7895", "#8aa1b9")],
    }, {
        "sky": ("#0e141c", "#161a22"), "glow": ("#5a7ba6", 0.22, 0.24),
        "layers": [("#253445", "#1d2835"), ("#2d3f55", "#223042"), ("#3a5170", "#29394f")],
    }),
    "bloom": ("waves", {}, {
        "sky": ("#fbe3ee", "#f1ecfb"), "glow": ("#ffffff", 0.78, 0.30),
        "layers": [("#f5b8d2", "#f5d0e2"), ("#e98bb8", "#efb2d0"), ("#c95a9c", "#e08ab9")],
    }, {
        "sky": ("#22101f", "#1a1426"), "glow": ("#c1478c", 0.78, 0.30),
        "layers": [("#4b1f44", "#361a38"), ("#62264f", "#44203f"), ("#833063", "#56264b")],
    }),
}


def svg(shape, details, palette, dark, seed):
    sky0, sky1 = palette["sky"]
    glow, gx, gy = palette["glow"]
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">', "  <defs>"]
    out.append(f'    <linearGradient id="sky" x1="0" y1="0" x2="0.35" y2="1">'
               f'<stop offset="0" stop-color="{sky0}"/><stop offset="1" stop-color="{sky1}"/></linearGradient>')
    out.append(f'    <radialGradient id="glow" cx="{gx}" cy="{gy}" r="0.55">'
               f'<stop offset="0" stop-color="{glow}" stop-opacity="0.55"/>'
               f'<stop offset="1" stop-color="{glow}" stop-opacity="0"/></radialGradient>')
    for i, (a, b) in enumerate(palette["layers"]):
        out.append(f'    <linearGradient id="l{i}" x1="0" y1="0" x2="1" y2="1">'
                   f'<stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient>')
    if details.get("ribbon"):
        c = "#5fe0a8" if dark else "#ffffff"
        out.append(f'    <linearGradient id="ribbon" x1="0" y1="0" x2="1" y2="0">'
                   f'<stop offset="0" stop-color="{c}" stop-opacity="0"/>'
                   f'<stop offset="0.45" stop-color="{c}" stop-opacity="{0.35 if dark else 0.6}"/>'
                   f'<stop offset="1" stop-color="{c}" stop-opacity="0"/></linearGradient>')
    out.append("  </defs>")
    out.append(f'  <rect width="{W}" height="{H}" fill="url(#sky)"/>')
    out.append(f'  <rect width="{W}" height="{H}" fill="url(#glow)"/>')

    if dark and details.get("stars"):
        rnd = random.Random(seed)
        for _ in range(details["stars"]):
            x, y = rnd.uniform(0, W), rnd.uniform(0, H * 0.55)
            r = rnd.choice((1.2, 1.6, 2.2))
            o = rnd.uniform(0.35, 0.9)
            out.append(f'  <circle cx="{x:.0f}" cy="{y:.0f}" r="{r}" fill="#ffffff" opacity="{o:.2f}"/>')

    if details.get("ribbon"):
        out.append('  <path d="M-100 520 C 500 300, 1000 700, 1600 460 S 2400 380, 2700 520" '
                   'fill="none" stroke="url(#ribbon)" stroke-width="140" stroke-linecap="round" opacity="0.8"/>')
        out.append('  <path d="M-100 640 C 600 460, 1100 820, 1700 600 S 2400 520, 2700 640" '
                   'fill="none" stroke="url(#ribbon)" stroke-width="60" stroke-linecap="round" opacity="0.6"/>')

    if details.get("sun"):
        sx, sy, sr = details["sun"]
        fill = "#ffffff" if not dark else palette["glow"][0]
        opacity = 0.85 if not dark else 0.55
        out.append(f'  <circle cx="{sx * W:.0f}" cy="{sy * H:.0f}" r="{sr}" fill="{fill}" opacity="{opacity}"/>')

    for i, d in enumerate(SHAPES[shape]):
        out.append(f'  <path d="{d}" fill="url(#l{i})"/>')
    out.append("</svg>")
    return "\n".join(out) + "\n"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for seed, (name, (shape, details, light, dark)) in enumerate(THEMES.items()):
        (OUT / f"{name}-light.svg").write_text(svg(shape, details, light, False, seed))
        (OUT / f"{name}-dark.svg").write_text(svg(shape, details, dark, True, seed))

    entries = [("Horizon", "horizon", "#dce8fb", "#0d1830")]
    entries += [(name.capitalize(), name, t[2]["sky"][0], t[3]["sky"][0]) for name, t in THEMES.items()]
    xml = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<!DOCTYPE wallpapers SYSTEM "gnome-wp-list.dtd">',
           "<!-- Обои HypeDE. Файл создан tools/gen-wallpapers.py. -->",
           "<wallpapers>"]
    for title, name, pcolor, scolor in entries:
        xml += ['  <wallpaper deleted="false">',
                f"    <name>HypeDE {title}</name>",
                f"    <filename>/usr/share/hypede/wallpapers/{name}-light.svg</filename>",
                f"    <filename-dark>/usr/share/hypede/wallpapers/{name}-dark.svg</filename-dark>",
                "    <options>zoom</options>",
                "    <shade_type>solid</shade_type>",
                f"    <pcolor>{pcolor}</pcolor>",
                f"    <scolor>{scolor}</scolor>",
                "  </wallpaper>"]
    xml.append("</wallpapers>")
    XML.write_text("\n".join(xml) + "\n")


if __name__ == "__main__":
    main()
