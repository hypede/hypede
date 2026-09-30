"""Приложение: разбор командной строки, окна, общий буфер обмена."""

from __future__ import annotations

import gettext
import locale
import os
import sys

import gi

# В сеансе HypeDE своя база настроек (см. session/hypede-session.in) — до
# первого обращения к GSettings.
if "HypeDE" in os.environ.get("XDG_CURRENT_DESKTOP", "").split(":"):
    os.environ["DCONF_PROFILE"] = "hypede"

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
gi.require_version("Gdk", "4.0")

from gi.repository import Adw, Gdk, Gio, GLib, Gtk  # noqa: E402

from . import __version__  # noqa: E402
from .operations import OperationsManager  # noqa: E402
from .prefs import Preferences  # noqa: E402

APP_ID = "dev.hypede.Files"
_DATA_DIR = os.path.dirname(os.path.abspath(__file__))


def _setup_i18n() -> None:
    localedir = os.environ.get("HYPEDE_LOCALEDIR")
    if not localedir:
        # Установленная программа живёт в <prefix>/share/hypede/files — переводы
        # рядом, в <prefix>/share/locale. Из исходников — системные.
        marker = os.sep + os.path.join("share", "hypede", "files")
        prefix = _DATA_DIR.split(marker)[0] if marker in _DATA_DIR else "/usr"
        localedir = os.path.join(prefix, "share", "locale")
    try:
        locale.setlocale(locale.LC_ALL, "")
    except locale.Error:
        pass
    gettext.bindtextdomain("hypede", localedir)
    gettext.textdomain("hypede")


class Application(Adw.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID,
                         flags=Gio.ApplicationFlags.HANDLES_OPEN | Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
        self.version = __version__
        self.prefs: Preferences | None = None
        self.operations: OperationsManager | None = None
        self.clipboard_files: list[Gio.File] = []
        self.clipboard_cut = False
        self.add_main_option("search", ord("s"), GLib.OptionFlags.NONE, GLib.OptionArg.STRING,
                             "Search in the given (or home) folder", "QUERY")
        self.add_main_option("new-window", ord("w"), GLib.OptionFlags.NONE, GLib.OptionArg.NONE,
                             "Always open a new window", None)
        self.add_main_option("version", 0, GLib.OptionFlags.NONE, GLib.OptionArg.NONE,
                             "Show the version", None)

    def do_startup(self):
        Adw.Application.do_startup(self)
        self.prefs = Preferences()
        self.operations = OperationsManager()
        self.set_accels_for_action("app.quit", ["<Control>q"])
        quit_action = Gio.SimpleAction.new("quit", None)
        quit_action.connect("activate", lambda *_: self.quit())
        self.add_action(quit_action)

        provider = Gtk.CssProvider()
        provider.load_from_path(os.path.join(_DATA_DIR, "style.css"))
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider,
                                                  Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

    def do_handle_local_options(self, options):
        if options.contains("version"):
            print(f"hypede-files {__version__}")
            return 0
        return -1

    def do_command_line(self, command_line):
        options = command_line.get_options_dict().end().unpack()
        args = command_line.get_arguments()[1:]
        files = [command_line.create_file_for_arg(arg) for arg in args]
        search = options.get("search")
        new_window = options.get("new-window", False)
        self._open(files, search=search, new_window=new_window)
        return 0

    def do_open(self, files, _n_files, _hint):
        self._open(list(files))

    def do_activate(self):
        self._open([])

    def _open(self, files: list[Gio.File], search: str | None = None, new_window: bool = False) -> None:
        from .window import Window

        home = Gio.File.new_for_path(GLib.get_home_dir())
        # Файл (а не папка) в аргументах — открыть его папку.
        locations = []
        for file in files:
            kind = file.query_file_type(Gio.FileQueryInfoFlags.NONE, None)
            if kind not in (Gio.FileType.DIRECTORY, Gio.FileType.MOUNTABLE, Gio.FileType.UNKNOWN):
                parent = file.get_parent()
                locations.append(parent or home)
            else:
                locations.append(file)

        window = self.get_active_window()
        if window is None or new_window or search:
            window = Window(self, locations[0] if locations else home, search=search)
            locations = locations[1:]
        for location in locations:
            window.open_tab(location)
        window.present()

    def new_window(self, location: Gio.File | None = None) -> None:
        from .window import Window

        Window(self, location or Gio.File.new_for_path(GLib.get_home_dir())).present()


def main() -> int:
    _setup_i18n()
    return Application().run(sys.argv)
