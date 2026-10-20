"""Анимированные мини-сцены тура: маленький «экран» HypeDE, нарисованный cairo.

Каждая сцена — функция (cr, w, h, t, colors), где t — секунды с начала
показа; сцены зациклены. Рисуется только примитивами, без картинок, поэтому
сцены следуют светлой и тёмной теме и акцентному цвету.
"""

from __future__ import annotations

import math

import cairo  # noqa: F401  — без него PyGObject не передаст cairo.Context в draw_func


def ease(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3


def phase(t: float, start: float, length: float) -> float:
    return ease((t - start) / length)


def rounded(cr, x, y, w, h, r):
    r = min(r, w / 2, h / 2)
    cr.new_sub_path()
    cr.arc(x + w - r, y + r, r, -math.pi / 2, 0)
    cr.arc(x + w - r, y + h - r, r, 0, math.pi / 2)
    cr.arc(x + r, y + h - r, r, math.pi / 2, math.pi)
    cr.arc(x + r, y + r, r, math.pi, 3 * math.pi / 2)
    cr.close_path()


def fill(cr, color, alpha=1.0):
    cr.set_source_rgba(color[0], color[1], color[2], alpha)
    cr.fill()


def screen(cr, w, h, c):
    """Экран с обоями-волнами и полкой; возвращает (x, y, sw, sh) экрана."""
    sw, sh = w * 0.86, w * 0.86 * 0.6
    if sh > h * 0.9:
        sh = h * 0.9
        sw = sh / 0.6
    x, y = (w - sw) / 2, (h - sh) / 2
    rounded(cr, x, y, sw, sh, 14)
    cr.save()
    cr.clip_preserve()
    fill(cr, c["wall"])
    for i, a in enumerate((0.25, 0.4, 0.6)):
        cr.move_to(x, y + sh * (0.55 + i * 0.13))
        cr.curve_to(x + sw * 0.3, y + sh * (0.45 + i * 0.13), x + sw * 0.6, y + sh * (0.7 + i * 0.1),
                    x + sw, y + sh * (0.5 + i * 0.13))
        cr.line_to(x + sw, y + sh)
        cr.line_to(x, y + sh)
        cr.close_path()
        fill(cr, c["accent"], a)
    cr.restore()
    return x, y, sw, sh


def shelf(cr, x, y, sw, sh, c, lift=0.0):
    bar = sh * 0.09
    rounded(cr, x + 6, y + sh - bar - 6, sw - 12, bar, bar / 2)
    fill(cr, c["surface"], 0.92)
    # Кнопка лаунчера и значки программ.
    cr.arc(x + 6 + bar * 0.7, y + sh - 6 - bar / 2, bar * 0.28, 0, 2 * math.pi)
    cr.set_source_rgba(*c["text"], 0.8)
    cr.set_line_width(2)
    cr.stroke()
    n = 5
    size = bar * 0.62
    start = x + sw / 2 - (n * size * 1.4) / 2
    palette = c["apps"]
    for i in range(n):
        bounce = math.sin(max(0.0, lift - i * 0.12) * math.pi) * size * 0.25 if 0 < lift - i * 0.12 < 1 else 0
        rounded(cr, start + i * size * 1.4, y + sh - 6 - bar / 2 - size / 2 - bounce, size, size, size * 0.3)
        fill(cr, palette[i % len(palette)])


def window(cr, x, y, w, h, c, title_color=None):
    rounded(cr, x, y, w, h, 8)
    fill(cr, c["surface"])
    rounded(cr, x, y, w, min(16, h * 0.18), 8)
    fill(cr, title_color or c["field"])
    for i in range(3):
        cr.arc(x + w - 10 - i * 9, y + 8, 2.5, 0, 2 * math.pi)
        fill(cr, c["text"], 0.35)
    for i in range(3):
        rounded(cr, x + 10, y + 26 + i * 12, w * (0.7 - i * 0.15), 5, 2.5)
        fill(cr, c["text"], 0.12)


def hello(cr, w, h, t, c):
    cx, cy = w / 2, h / 2
    r = min(w, h) * 0.26
    # Кольцо из акцентных дуг вращается, логотип «дышит».
    for i in range(6):
        a = t * 0.8 + i * math.pi / 3
        cr.arc(cx, cy, r, a, a + math.pi / 4)
        cr.set_source_rgba(*c["apps"][i % len(c["apps"])], 0.9)
        cr.set_line_width(r * 0.16)
        cr.set_line_cap(1)
        cr.stroke()
    pulse = 1 + 0.05 * math.sin(t * 2.4)
    cr.arc(cx, cy, r * 0.55 * pulse, 0, 2 * math.pi)
    fill(cr, c["accent"])
    cr.set_source_rgba(*c["on_accent"], 1)
    cr.select_font_face("Sans", 0, 1)
    cr.set_font_size(r * 0.55)
    ext = cr.text_extents("H")
    cr.move_to(cx - ext.width / 2 - ext.x_bearing, cy - ext.height / 2 - ext.y_bearing)
    cr.show_text("H")


def launcher(cr, w, h, t, c):
    t = t % 5.0
    x, y, sw, sh = screen(cr, w, h, c)
    shelf(cr, x, y, sw, sh, c, lift=t * 1.2 if t < 1.5 else 0)
    up = phase(t, 0.8, 0.6) - phase(t, 4.2, 0.5)
    if up > 0:
        pw, ph = sw * 0.62, sh * 0.62 * up
        px, py = x + (sw - pw) / 2, y + sh - sh * 0.12 - ph
        rounded(cr, px, py, pw, ph, 14)
        fill(cr, c["surface"], 0.96)
        if up > 0.7:
            rounded(cr, px + 14, py + 12, pw - 28, 18, 9)
            fill(cr, c["field"])
            # Набор текста в поиске.
            letters = int(max(0, (t - 1.6) * 6))
            cr.set_source_rgba(*c["text"], 0.75)
            cr.select_font_face("Sans", 0, 0)
            cr.set_font_size(10)
            cr.move_to(px + 24, py + 25)
            cr.show_text("12*(3+4)"[:letters] + ("  = 84" if letters >= 8 else ""))
            for row in range(2):
                for col in range(5):
                    gx = px + 18 + col * (pw - 36) / 5
                    gy = py + 44 + row * 30
                    if gy + 18 < py + ph - 6:
                        rounded(cr, gx + 6, gy, 18, 18, 6)
                        fill(cr, c["apps"][(row * 5 + col) % len(c["apps"])])


def windows(cr, w, h, t, c):
    t = t % 6.0
    x, y, sw, sh = screen(cr, w, h, c)
    shelf(cr, x, y, sw, sh, c)
    area = sh * 0.86
    # Два окна прилипают к половинам экрана, потом обзор уменьшает их.
    snap = phase(t, 0.6, 0.8)
    zoom = phase(t, 3.0, 0.7) - phase(t, 5.3, 0.6)
    for i, start in enumerate(((0.12, 0.18, 0.5, 0.5), (0.36, 0.28, 0.5, 0.5))):
        target = (0.0, 0.0, 0.5, 1.0) if i == 0 else (0.5, 0.0, 0.5, 1.0)
        fx = start[0] + (target[0] - start[0]) * snap
        fy = start[1] + (target[1] - start[1]) * snap
        fw = start[2] + (target[2] - start[2]) * snap
        fh = start[3] + (target[3] - start[3]) * snap
        scale = 1 - 0.35 * zoom
        wx = x + sw * (0.5 + (fx + fw / 2 - 0.5) * scale) - sw * fw * scale / 2
        wy = y + area * (0.5 + (fy + fh / 2 - 0.5) * scale) - area * fh * scale / 2
        window(cr, wx + 3, wy + 3, sw * fw * scale - 6, area * fh * scale - 6, c,
               c["accent_soft"] if i == 1 else None)
    if zoom > 0.1:
        # Рабочие столы сверху в обзоре.
        for i in range(3):
            rounded(cr, x + sw / 2 - 75 + i * 52, y + 8, 44, 26, 5)
            fill(cr, c["surface"] if i else c["accent"], 0.5 + 0.4 * zoom)


def island(cr, w, h, t, c):
    t = t % 5.0
    x, y, sw, sh = screen(cr, w, h, c)
    shelf(cr, x, y, sw, sh, c)
    grow = phase(t, 0.8, 0.6) - phase(t, 4.0, 0.6)
    iw = sw * (0.22 + 0.36 * grow)
    ih = sh * (0.08 + 0.2 * grow)
    ix, iy = x + (sw - iw) / 2, y + 8
    rounded(cr, ix, iy, iw, ih, min(ih / 2, 18))
    fill(cr, (0.08, 0.08, 0.09))
    # Обложка и «эквалайзер» играющей музыки.
    cover = ih * 0.6
    rounded(cr, ix + ih * 0.2, iy + (ih - cover) / 2, cover, cover, cover * 0.25)
    fill(cr, c["accent"])
    for i in range(5):
        level = 0.3 + 0.7 * abs(math.sin(t * 5 + i * 1.3))
        bh = ih * 0.5 * level
        rounded(cr, ix + iw - ih * 0.3 - (5 - i) * 7, iy + (ih - bh) / 2, 4, bh, 2)
        fill(cr, (1, 1, 1), 0.85)
    if grow > 0.6:
        cr.set_source_rgba(1, 1, 1, (grow - 0.6) / 0.4)
        cr.select_font_face("Sans", 0, 1)
        cr.set_font_size(11)
        cr.move_to(ix + ih * 0.2 + cover + 10, iy + ih / 2 - 2)
        cr.show_text("Lo-fi beats")
        cr.select_font_face("Sans", 0, 0)
        cr.set_font_size(9)
        cr.set_source_rgba(1, 1, 1, 0.6 * (grow - 0.6) / 0.4)
        cr.move_to(ix + ih * 0.2 + cover + 10, iy + ih / 2 + 11)
        cr.show_text("HypeDE Radio")


def personalize(cr, w, h, t, c):
    # Акцент перебирает цвета: экран перекрашивается.
    accents = c["apps"]
    k = (t / 1.6) % len(accents)
    i, f = int(k), ease(k - int(k))
    a, b = accents[i], accents[(i + 1) % len(accents)]
    mixed = tuple(a[j] + (b[j] - a[j]) * f for j in range(3))
    local = dict(c, accent=mixed, accent_soft=tuple(v * 0.3 + 0.7 for v in mixed))
    x, y, sw, sh = screen(cr, w, h, local)
    shelf(cr, x, y, sw, sh, local)
    window(cr, x + sw * 0.22, y + sh * 0.14, sw * 0.5, sh * 0.55, local, local["accent_soft"])
    for n, color in enumerate(accents):
        cr.arc(x + sw * 0.78, y + sh * 0.2 + n * 18, 6 + (2 if n == i else 0), 0, 2 * math.pi)
        fill(cr, color)


def assistant(cr, w, h, t, c):
    t = t % 6.0
    x, y, sw, sh = screen(cr, w, h, c)
    shelf(cr, x, y, sw, sh, c)
    slide = phase(t, 0.4, 0.6) - phase(t, 5.2, 0.5)
    pw = sw * 0.36
    px = x + sw - pw * slide
    rounded(cr, px, y + 8, pw - 8, sh * 0.8, 12)
    fill(cr, c["surface"], 0.97)
    # Пузыри чата появляются по очереди.
    bubbles = [(0.2, True, 0.55), (1.4, False, 0.75), (2.6, True, 0.4), (3.4, False, 0.65)]
    by = y + 22
    for start, mine, width in bubbles:
        show = phase(t, start, 0.4)
        if show <= 0:
            continue
        bw = (pw - 30) * width
        bx = px + pw - 18 - bw if mine else px + 10
        rounded(cr, bx, by, bw, 18, 9)
        fill(cr, c["accent"] if mine else c["field"], show)
        by += 26
    # Сияющий шар помощника.
    cr.arc(px + pw / 2 - 4, y + sh * 0.8 - 18, 9 + math.sin(t * 3) * 1.5, 0, 2 * math.pi)
    fill(cr, c["accent"], 0.9 * slide)


SCENES = {
    "hello": hello, "launcher": launcher, "windows": windows, "island": island,
    "personalize": personalize, "assistant": assistant,
}
