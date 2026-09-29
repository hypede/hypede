#!/usr/bin/env python3
"""Собирает stylesheet-light.css и stylesheet-dark.css оболочки HypeDE.

Шаблон — shell/theme/stylesheet.css.in, в нём цвета записаны как @имя@.
Палитры ниже повторяют систему цветов Chrome OS («Jelly»): светлая полка с
тёмными значками и тёмная — со светлыми. Акцент берётся из системного
(-st-accent-color), поэтому выбор цвета в настройках перекрашивает и полку.

Запуск: python3 tools/gen-shell-css.py
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "shell/theme/stylesheet.css.in"
OUT_DIR = ROOT / "shell/extension/hypede-shell@hypede.dev"

ACCENT = "-st-accent-color"

PALETTES = {
    "dark": {
        "fg": "#e3e3e3",
        "dim": "#c4c7c5",
        "shelf_bg": "rgba(18, 19, 21, 0.78)",
        "shelf_bg_overview": "rgba(18, 19, 21, 0.45)",
        "hover": "rgba(255, 255, 255, 0.10)",
        "pressed": "rgba(255, 255, 255, 0.16)",
        "dot": "rgba(227, 227, 227, 0.55)",
        "tray_bg": "rgba(255, 255, 255, 0.08)",
        "tray_hover": "rgba(255, 255, 255, 0.14)",
        "tray_checked": "rgba(255, 255, 255, 0.20)",
        "tooltip_bg": "rgba(48, 49, 52, 0.96)",
        "tooltip_fg": "#e3e3e3",
        "bubble_bg": "rgba(32, 33, 36, 0.97)",
        "bubble_border": "rgba(255, 255, 255, 0.06)",
        "submenu_bg": "rgba(255, 255, 255, 0.06)",
        "separator": "rgba(255, 255, 255, 0.10)",
        "search_bg": "rgba(255, 255, 255, 0.07)",
        "search_focus_bg": "rgba(255, 255, 255, 0.10)",
        "chip_bg": "rgba(255, 255, 255, 0.06)",
        "chip_hover": "rgba(255, 255, 255, 0.12)",
        "result_selected": "rgba(255, 255, 255, 0.10)",
        "tile_off": "rgba(255, 255, 255, 0.08)",
        "tile_off_hover": "rgba(255, 255, 255, 0.14)",
        "tile_on": f"st-mix({ACCENT}, #ffffff, 45%)",
        "tile_on_hover": f"st-mix({ACCENT}, #ffffff, 38%)",
        "tile_on_fg": f"st-mix({ACCENT}, #000000, 30%)",
        "slider": f"st-mix({ACCENT}, #ffffff, 45%)",
        "slider_track": "rgba(255, 255, 255, 0.14)",
        "focus_ring": f"st-mix({ACCENT}, #ffffff, 55%)",
        "accent_fg_on_surface": f"st-mix({ACCENT}, #ffffff, 55%)",
    },
    "light": {
        "fg": "#1f1f1f",
        "dim": "#444746",
        "shelf_bg": "rgba(242, 244, 248, 0.80)",
        "shelf_bg_overview": "rgba(242, 244, 248, 0.50)",
        "hover": "rgba(0, 0, 0, 0.06)",
        "pressed": "rgba(0, 0, 0, 0.10)",
        "dot": "rgba(31, 31, 31, 0.45)",
        "tray_bg": "rgba(0, 0, 0, 0.05)",
        "tray_hover": "rgba(0, 0, 0, 0.09)",
        "tray_checked": "rgba(0, 0, 0, 0.13)",
        "tooltip_bg": "rgba(48, 49, 52, 0.96)",
        "tooltip_fg": "#f1f1f1",
        "bubble_bg": "rgba(248, 250, 253, 0.98)",
        "bubble_border": "rgba(0, 0, 0, 0.06)",
        "submenu_bg": "rgba(0, 0, 0, 0.04)",
        "separator": "rgba(0, 0, 0, 0.10)",
        "search_bg": "rgba(0, 0, 0, 0.05)",
        "search_focus_bg": "rgba(0, 0, 0, 0.04)",
        "chip_bg": "rgba(0, 0, 0, 0.04)",
        "chip_hover": "rgba(0, 0, 0, 0.08)",
        "result_selected": "rgba(0, 0, 0, 0.07)",
        "tile_off": "rgba(0, 0, 0, 0.06)",
        "tile_off_hover": "rgba(0, 0, 0, 0.10)",
        "tile_on": f"st-mix({ACCENT}, #000000, 80%)",
        "tile_on_hover": f"st-mix({ACCENT}, #000000, 72%)",
        "tile_on_fg": "#ffffff",
        "slider": f"st-mix({ACCENT}, #000000, 80%)",
        "slider_track": "rgba(0, 0, 0, 0.12)",
        "focus_ring": f"st-mix({ACCENT}, #000000, 80%)",
        "accent_fg_on_surface": f"st-mix({ACCENT}, #000000, 80%)",
    },
}


def render(template: str, palette: dict) -> str:
    def substitute(match: re.Match) -> str:
        name = match.group(1)
        if name not in palette:
            sys.exit(f"gen-shell-css: в палитре нет цвета «{name}»")
        return palette[name]

    return re.sub(r"@([a-z_]+)@", substitute, template)


def main() -> None:
    template = TEMPLATE.read_text(encoding="utf-8")
    header = "/* Сгенерировано tools/gen-shell-css.py из shell/theme/stylesheet.css.in — не править вручную. */\n"
    for variant, palette in PALETTES.items():
        out = OUT_DIR / f"stylesheet-{variant}.css"
        out.write_text(header + render(template, palette), encoding="utf-8")
        print(f"записан {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
