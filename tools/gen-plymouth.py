#!/usr/bin/env python3
"""Картинки заставки загрузки HypeDE (Plymouth): data/plymouth/hypede/*.png.

Нужны rsvg-convert и Pillow.  Запуск: python3 tools/gen-plymouth.py
"""

import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/plymouth/hypede"
SCALE = 4  # рисуем крупнее и уменьшаем — так края гладкие


def svg_png(svg: Path, size: int, color: str | None = None) -> Image.Image:
    text = svg.read_text()
    if color:
        text = text.replace("<svg ", f'<svg fill="{color}" ', 1)
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.svg"
        src.write_text(text)
        dst = Path(tmp) / "out.png"
        subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), "-o", str(dst), str(src)], check=True)
        return Image.open(dst).convert("RGBA")


def circle(size: int, rgba) -> Image.Image:
    big = Image.new("RGBA", (size * SCALE, size * SCALE))
    ImageDraw.Draw(big).ellipse((0, 0, size * SCALE - 1, size * SCALE - 1), fill=rgba)
    return big.resize((size, size), Image.LANCZOS)


def rounded(w: int, h: int, r: int, fill, outline=None) -> Image.Image:
    big = Image.new("RGBA", (w * SCALE, h * SCALE))
    ImageDraw.Draw(big).rounded_rectangle((0, 0, w * SCALE - 1, h * SCALE - 1), r * SCALE, fill=fill,
                                          outline=outline, width=2 * SCALE if outline else 0)
    return big.resize((w, h), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # Логотип с мягким свечением.
    logo = svg_png(ROOT / "branding/hypede-logo.svg", 136)
    glow = Image.new("RGBA", (220, 220))
    glow.alpha_composite(logo, (42, 42))
    halo = glow.copy().filter(ImageFilter.GaussianBlur(18))
    halo.putalpha(halo.getchannel("A").point(lambda a: int(a * 0.45)))
    out = Image.new("RGBA", (220, 220))
    out.alpha_composite(halo)
    out.alpha_composite(glow)
    out.save(OUT / "logo.png")
    # Точки «волны» под логотипом.
    circle(12, (138, 180, 248, 255)).save(OUT / "dot.png")
    # Поле пароля, точки ввода и замок.
    rounded(380, 52, 26, (255, 255, 255, 26), (255, 255, 255, 60)).save(OUT / "entry.png")
    circle(10, (255, 255, 255, 235)).save(OUT / "bullet.png")
    svg_png(ROOT / "data/icons/HypeDE/symbolic/system-lock-screen-symbolic.svg", 22, "#ffffff").save(OUT / "lock.png")
    print("готово:", ", ".join(sorted(p.name for p in OUT.glob("*.png"))))


if __name__ == "__main__":
    main()
