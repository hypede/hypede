#!/usr/bin/env python3
"""Скачивает фотообои и картины из tools/wallpapers_photos.py.

Каждый файл уменьшается до 2560 пикселей по ширине и сохраняется как
JPEG в assets/wallpapers/<name>.jpg; у картин обрезаются поля и рамка.
Заодно пишется assets/wallpapers/CREDITS.md. Нужен Pillow.

Запуск: python3 tools/fetch-wallpapers.py [имя …]
"""

from pathlib import Path
import io
import subprocess
import sys

from PIL import Image, ImageOps, ImageStat

sys.path.insert(0, str(Path(__file__).resolve().parent))
import wallpapers_photos  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/wallpapers"
WIDTH = 2560
USER_AGENT = "HypeDE-wallpapers/1.0 (https://github.com/hypede/hypede)"


def trim(im: Image.Image, extra: float, tol: int = 28) -> Image.Image:
    """Срезать однотонные поля по краям (рамка, бумага), потом ещё extra."""
    g = im.convert("L")
    w, h = g.size

    def mean_sd(box):
        s = ImageStat.Stat(g.crop(box))
        return s.mean[0], s.stddev[0]

    def walk(line, limit):
        first, _ = line(0)
        i = 0
        while i < limit:
            m, sd = line(i)
            if abs(m - first) > tol or sd > 30:
                break
            i += 1
        return i

    left = walk(lambda i: mean_sd((i, 0, i + 1, h)), w // 6)
    right = walk(lambda i: mean_sd((w - i - 1, 0, w - i, h)), w // 6)
    top = walk(lambda i: mean_sd((0, i, w, i + 1)), h // 6)
    bottom = walk(lambda i: mean_sd((0, h - i - 1, w, h - i)), h // 6)
    ex, ey = int(w * extra), int(h * extra)
    return im.crop((left + ex, top + ey, w - right - ex, h - bottom - ey))


def fetch(url: str) -> bytes:
    # curl, а не urllib: он сам берёт настройки прокси и сертификатов.
    return subprocess.run(["curl", "-fsSL", "-A", USER_AGENT, url],
                          check=True, capture_output=True).stdout


def main() -> None:
    only = set(sys.argv[1:])
    OUT.mkdir(parents=True, exist_ok=True)
    for name, _title, _author, _page, url, _license, extra, _color in wallpapers_photos.PHOTOS:
        if only and name not in only:
            continue
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(fetch(url)))).convert("RGB")
        if extra is not None:
            im = trim(im, extra)
        if im.width > WIDTH:
            im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
        path = OUT / f"{name}.jpg"
        im.save(path, "JPEG", quality=80, optimize=True, progressive=True)
        print(f"{path.relative_to(ROOT)} {im.width}×{im.height}")
    (OUT / "CREDITS.md").write_text(wallpapers_photos.credits_markdown(), encoding="utf-8")


if __name__ == "__main__":
    main()
