"""Цветовые схемы «Терминала»: 16 цветов, текст и фон.

«HypeDE» следует светлой и тёмной теме системы, остальные — свои.
"""

from __future__ import annotations

import gi

gi.require_version("Gdk", "4.0")

from gi.repository import Gdk  # noqa: E402


def N_(text: str) -> str:
    return text


# fg, bg, 16 цветов (8 обычных и 8 ярких).
SCHEMES = {
    "hypede": {
        "name": N_("HypeDE (follows the system)"),
        "light": ("#1f1f1f", "#ffffff", ["#3c4043", "#c5221f", "#188038", "#b06000", "#1a73e8", "#a142f4", "#007b83",
                                         "#dadce0", "#5f6368", "#d93025", "#1e8e3e", "#e37400", "#4285f4", "#af5cf7",
                                         "#12a4af", "#ffffff"]),
        "dark": ("#e3e3e3", "#1b1c1e", ["#2b2c2f", "#f28b82", "#81c995", "#fdd663", "#8ab4f8", "#c58af9", "#78d9ec",
                                        "#e8eaed", "#5f6368", "#f6aea9", "#a8dab5", "#fde293", "#aecbfa", "#d7aefb",
                                        "#a1e4f2", "#ffffff"]),
    },
    "catppuccin": {
        "name": N_("Catppuccin Mocha"),
        "dark": ("#cdd6f4", "#1e1e2e", ["#45475a", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5",
                                        "#bac2de", "#585b70", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7",
                                        "#94e2d5", "#a6adc8"]),
    },
    "tokyonight": {
        "name": N_("Tokyo Night"),
        "dark": ("#c0caf5", "#1a1b26", ["#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff",
                                        "#a9b1d6", "#414868", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7",
                                        "#7dcfff", "#c0caf5"]),
    },
    "nord": {
        "name": N_("Nord"),
        "dark": ("#d8dee9", "#2e3440", ["#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0",
                                        "#e5e9f0", "#4c566a", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead",
                                        "#8fbcbb", "#eceff4"]),
    },
    "gruvbox": {
        "name": N_("Gruvbox"),
        "dark": ("#ebdbb2", "#282828", ["#282828", "#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a",
                                        "#a89984", "#928374", "#fb4934", "#b8bb26", "#fabd2f", "#83a598", "#d3869b",
                                        "#8ec07c", "#ebdbb2"]),
    },
    "dracula": {
        "name": N_("Dracula"),
        "dark": ("#f8f8f2", "#282a36", ["#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd",
                                        "#f8f8f2", "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df",
                                        "#a4ffff", "#ffffff"]),
    },
    "solarized": {
        "name": N_("Solarized"),
        "light": ("#657b83", "#fdf6e3", ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198",
                                         "#eee8d5", "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4",
                                         "#93a1a1", "#fdf6e3"]),
        "dark": ("#839496", "#002b36", ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198",
                                        "#eee8d5", "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4",
                                        "#93a1a1", "#fdf6e3"]),
    },
}


def _rgba(text: str) -> Gdk.RGBA:
    color = Gdk.RGBA()
    color.parse(text)
    return color


def palette(name: str, dark: bool) -> tuple[Gdk.RGBA, Gdk.RGBA, list[Gdk.RGBA]]:
    """(текст, фон, 16 цветов) схемы; у двухвариантных — по теме системы."""
    scheme = SCHEMES.get(name) or SCHEMES["hypede"]
    variant = scheme.get("dark" if dark else "light") or scheme.get("dark") or scheme.get("light")
    fg, bg, colors = variant
    return _rgba(fg), _rgba(bg), [_rgba(c) for c in colors]
