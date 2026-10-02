"""Приложение рабочего стола: по окну на монитор.

Окна прозрачные и без рамки; оболочка (desktop.js) ставит каждое на свой
монитор под всеми окнами и прячет из списков окон. Значки — только на
основном мониторе (окно «hypede-desktop-0»), живые обои из файла — на всех.
"""

from __future__ import annotations

import gettext
import locale
import os
import sys

if "HypeDE" in os.environ.get("XDG_CURRENT_DESKTOP", "").split(":"):
    os.environ["DCONF_PROFILE"] = "hypede"

import gi  # noqa: E402

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
gi.require_version("GdkPixbuf", "2.0")
gi.require_version("Adw", "1")

from gi.repository import Adw, Gdk, Gio, GLib, Gtk  # noqa: E402

from hypede_files.operations import OperationsManager  # noqa: E402

from .media import LiveBackground  # noqa: E402
from .view import DesktopView  # noqa: E402

APP_ID = "dev.hypede.Desktop"
SHELL_SCHEMA = "dev.hypede.shell"
GNOME_ACCENTS = {
    "blue": "#3584e4", "teal": "#2190a4", "green": "#3a944a", "yellow": "#c88800",
    "orange": "#ed5b00", "red": "#e62d42", "pink": "#d56199", "purple": "#9141ac",
    "slate": "#6f8396",
}

CSS = """
window.hypede-desktop, window.hypede-desktop > overlay { background: none; box-shadow: none; }
.desktop-icon {
  padding: 6px 4px 4px 4px;
  border-radius: 12px;
  border: 1px solid transparent;
  transition: background-color 150ms ease-out, border-color 150ms ease-out;
}
.desktop-icon:hover { background-color: alpha(white, 0.12); }
.desktop-icon.selected { background-color: alpha(@hd_accent, 0.36); border-color: alpha(@hd_accent, 0.75); }
.desktop-icon.drop-target { background-color: alpha(@hd_accent, 0.50); border-color: @hd_accent; }
.desktop-icon.dragging { opacity: 0.45; }
.desktop-icon-image { -gtk-icon-shadow: 0 2px 6px alpha(black, 0.35); }
.desktop-icon-image.thumbnail { border-radius: 6px; }
.desktop-icon-label {
  color: white;
  font-weight: 500;
  font-size: 10pt;
  text-shadow: 0 1px 2px alpha(black, 0.9), 0 0 6px alpha(black, 0.55);
  padding: 1px 4px;
  border-radius: 6px;
}
.desktop-icon.selected .desktop-icon-label { text-shadow: 0 1px 2px alpha(black, 0.8); }
@keyframes hd-appear { from { opacity: 0; transform: scale(0.82); } to { opacity: 1; transform: none; } }
.appear { animation: hd-appear 260ms cubic-bezier(0.2, 0.8, 0.2, 1.2); }
"""


def _setup_i18n() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    marker = os.sep + os.path.join("share", "hypede", "desktop")
    prefix = here.split(marker)[0] if marker in here else "/usr"
    try:
        locale.setlocale(locale.LC_ALL, "")
    except locale.Error:
        pass
    gettext.bindtextdomain("hypede", os.environ.get("HYPEDE_LOCALEDIR") or os.path.join(prefix, "share", "locale"))
    gettext.textdomain("hypede")


def _schema(schema_id: str) -> Gio.Settings | None:
    source = Gio.SettingsSchemaSource.get_default()
    return Gio.Settings.new(schema_id) if source and source.lookup(schema_id, True) else None


class DesktopWindow(Gtk.ApplicationWindow):
    def __init__(self, app: "Application", index: int):
        super().__init__(application=app, title=f"hypede-desktop-{index}", decorated=False,
                         resizable=True, deletable=False)
        self.index = index
        self.add_css_class("hypede-desktop")
        overlay = Gtk.Overlay()
        self.background = LiveBackground()
        overlay.set_child(self.background)
        show_icons = index == 0 and (app.settings.get_boolean("desktop-icons") if app.settings else True)
        self.view = DesktopView(app, app.settings, show_icons)
        overlay.add_overlay(self.view)
        self.set_child(overlay)
        self.set_default_size(800, 600)
        self.update_background()

    def update_background(self) -> None:
        uri = self.get_application().live_uri
        self.background.load(uri if uri.startswith("file://") else "")


class Application(Adw.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.DEFAULT_FLAGS)
        self.settings = _schema(SHELL_SCHEMA)
        self.interface = _schema("org.gnome.desktop.interface")
        self.operations: OperationsManager | None = None
        self.clipboard_files: list[Gio.File] = []
        self.windows: list[DesktopWindow] = []
        self._css = Gtk.CssProvider()
        self._accent_css = Gtk.CssProvider()
        self.accent_rgb = (0.21, 0.52, 0.89)

    @property
    def live_uri(self) -> str:
        return self.settings.get_string("wallpaper-live") if self.settings else ""

    def do_startup(self):
        Adw.Application.do_startup(self)
        self.hold()
        self.operations = OperationsManager()
        display = Gdk.Display.get_default()
        self._css.load_from_string(CSS)
        Gtk.StyleContext.add_provider_for_display(display, self._accent_css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        Gtk.StyleContext.add_provider_for_display(display, self._css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1)
        self._update_accent()

        # Оболочка ставит видео на паузу, когда рабочий стол закрыт окнами.
        pause = Gio.SimpleAction.new("pause", GLib.VariantType.new("b"))
        pause.connect("activate", lambda _a, value: self._set_paused(value.get_boolean()))
        self.add_action(pause)

        if self.settings:
            self.settings.connect("changed::wallpaper-live", lambda *_: self._each(lambda w: w.update_background()))
            self.settings.connect("changed::desktop-icons", lambda *_: self._rebuild())
            self.settings.connect("changed::accent-custom", lambda *_: self._update_accent())
        if self.interface:
            self.interface.connect("changed::accent-color", lambda *_: self._update_accent())
        display.get_monitors().connect("items-changed", lambda *_: self._sync_windows())

    def do_activate(self):
        self._sync_windows()

    def _each(self, fn) -> None:
        for window in self.windows:
            fn(window)

    def _set_paused(self, paused: bool) -> None:
        self._each(lambda w: w.background.set_paused(paused))

    def _update_accent(self) -> None:
        custom = self.settings.get_string("accent-custom") if self.settings else ""
        if not (len(custom) == 7 and custom.startswith("#")):
            name = self.interface.get_string("accent-color") if self.interface else "blue"
            custom = GNOME_ACCENTS.get(name, GNOME_ACCENTS["blue"])
        rgba = Gdk.RGBA()
        rgba.parse(custom)
        self.accent_rgb = (rgba.red, rgba.green, rgba.blue)
        self._accent_css.load_from_string(f"@define-color hd_accent {custom};")

    def _sync_windows(self) -> None:
        count = max(1, Gdk.Display.get_default().get_monitors().get_n_items())
        while len(self.windows) > count:
            self.windows.pop().destroy()
        while len(self.windows) < count:
            window = DesktopWindow(self, len(self.windows))
            self.windows.append(window)
            window.present()

    def _rebuild(self) -> None:
        for window in self.windows:
            window.destroy()
        self.windows = []
        self._sync_windows()


def main() -> int:
    _setup_i18n()
    return Application().run(sys.argv)
