"""«Добро пожаловать в HypeDE» — короткий тур при первом входе.

Шесть страниц с анимированными сценами: что такое HypeDE, полка и лаунчер,
окна и рабочие столы, Dynamic Island, оформление и ИИ-помощник. На странице
помощника можно сразу поставить локальный ИИ (hypede-ai install) — ход
загрузки виден там же. После тура появляется ~/.config/hypede/welcome-done,
и при следующих входах тур не открывается; повторить — «Тур по HypeDE» в
лаунчере.

    hypede-welcome               тур
    hypede-welcome --first-run   тур, только если его ещё не проходили
    hypede-welcome --page ai     сразу страница ИИ-помощника
"""

from __future__ import annotations

import gettext
import json
import locale
import os
import shutil
import sys

import gi

if "HypeDE" in os.environ.get("XDG_CURRENT_DESKTOP", "").split(":"):
    os.environ["DCONF_PROFILE"] = "hypede"

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")

from gi.repository import Adw, Gio, GLib, Gtk  # noqa: E402

from . import __version__  # noqa: E402
from .scenes import SCENES  # noqa: E402

APP_ID = "dev.hypede.Welcome"
_ = gettext.gettext
_DATA_DIR = os.path.dirname(os.path.abspath(__file__))
DONE_FILE = os.path.join(GLib.get_user_config_dir(), "hypede", "welcome-done")

APP_COLORS = [(0.26, 0.52, 0.96), (0.92, 0.26, 0.21), (0.98, 0.74, 0.02), (0.20, 0.66, 0.33),
              (0.63, 0.26, 0.96), (0.07, 0.65, 0.69)]


def _setup_i18n() -> None:
    marker = os.sep + os.path.join("share", "hypede", "welcome")
    prefix = _DATA_DIR.split(marker)[0] if marker in _DATA_DIR else "/usr"
    try:
        locale.setlocale(locale.LC_ALL, "")
    except locale.Error:
        pass
    gettext.bindtextdomain("hypede", os.environ.get("HYPEDE_LOCALEDIR", os.path.join(prefix, "share", "locale")))
    gettext.textdomain("hypede")


def _rgb(color) -> tuple[float, float, float]:
    return (color.red, color.green, color.blue)


class Scene(Gtk.DrawingArea):
    """Анимация страницы: перерисовывается каждый кадр, пока видна."""

    def __init__(self, name: str):
        super().__init__(content_width=440, content_height=260, hexpand=True)
        self.draw = SCENES[name]
        self.start = None
        self.set_draw_func(self._draw)
        self.add_tick_callback(self._tick)

    def _tick(self, _widget, clock):
        now = clock.get_frame_time() / 1e6
        if self.start is None:
            self.start = now
        self.time = now - self.start
        if self.get_mapped():
            self.queue_draw()
        return GLib.SOURCE_CONTINUE

    def restart(self):
        self.start = None

    def _draw(self, _area, cr, width, height):
        style = Adw.StyleManager.get_default()
        dark = style.get_dark()
        accent = _rgb(style.get_accent_color_rgba())
        colors = {
            "accent": accent,
            "accent_soft": tuple(v * 0.3 + (0.15 if dark else 0.7) for v in accent),
            "on_accent": (1, 1, 1),
            "wall": (0.16, 0.18, 0.24) if dark else (0.91, 0.94, 0.99),
            "surface": (0.17, 0.17, 0.19) if dark else (1, 1, 1),
            "field": (0.24, 0.24, 0.27) if dark else (0.92, 0.93, 0.95),
            "text": (0.9, 0.9, 0.9) if dark else (0.12, 0.12, 0.12),
            "apps": APP_COLORS,
        }
        self.draw(cr, width, height, getattr(self, "time", 0.0), colors)


class Window(Adw.ApplicationWindow):
    def __init__(self, app: "Application", page: str | None):
        super().__init__(application=app, title=_("Welcome to HypeDE"), default_width=720, default_height=640,
                         resizable=False)
        self.installer: Gio.Subprocess | None = None

        self.carousel = Adw.Carousel(allow_scroll_wheel=False, vexpand=True, spacing=24, overflow=Gtk.Overflow.HIDDEN)
        self.carousel.connect("page-changed", self._page_changed)
        dots = Adw.CarouselIndicatorDots(carousel=self.carousel)

        self.back = Gtk.Button(label=_("Back"), css_classes=["pill"])
        self.back.connect("clicked", lambda *_: self._go(-1))
        self.next = Gtk.Button(label=_("Next"), css_classes=["pill", "suggested-action"])
        self.next.connect("clicked", lambda *_: self._go(1))
        footer = Gtk.CenterBox(margin_start=24, margin_end=24, margin_bottom=20, margin_top=8)
        footer.set_start_widget(self.back)
        footer.set_center_widget(dots)
        footer.set_end_widget(self.next)

        self.pages: list[tuple[str, Gtk.Widget]] = []
        self._add("hello", _("Welcome to HypeDE"),
                  _("A Chrome OS-style desktop for Linux: simple, quick and pretty. "
                    "This short tour shows the main things in a minute."))
        self._add("launcher", _("Shelf and launcher"),
                  _("Press Super (the Windows key) or the circle on the shelf: apps, files, settings and a "
                    "calculator in one search box. Right-click an icon to pin it to the shelf."))
        self._add("windows", _("Windows and desks"),
                  _("Drag a window to an edge to fill half the screen. Super+W shows every window and desk; "
                    "three fingers on the touchpad do the same."))
        self._add("island", _("Dynamic Island"),
                  _("The capsule at the top shows music, downloads and timers. Click it for the clipboard, a "
                    "file shelf and notes. Super+V opens clipboard history."))
        personalize = self._add("personalize", _("Make it yours"),
                                _("Themes, accent colors, wallpapers that change with the dark style, live "
                                  "wallpapers and desktop widgets."))
        buttons = Gtk.Box(spacing=8, halign=Gtk.Align.CENTER)
        dark = Gtk.ToggleButton(label=_("Dark style"), css_classes=["pill"])
        interface = Gio.Settings(schema_id="org.gnome.desktop.interface")
        dark.set_active(interface.get_string("color-scheme") == "prefer-dark")
        dark.connect("toggled", lambda b: interface.set_string("color-scheme",
                                                              "prefer-dark" if b.get_active() else "default"))
        buttons.append(dark)
        themes = Gtk.Button(label=_("Themes and wallpaper"), css_classes=["pill"])
        themes.connect("clicked", lambda *_: self._run(["hypede-settings", "--page", "personalization"]))
        buttons.append(themes)
        personalize.append(buttons)
        self._add_ai_page()
        self._add("hello", _("You are all set"),
                  _("Super opens the launcher, Super+W the overview, Super+V the clipboard. Settings has "
                    "everything else — and the assistant knows where."))

        view = Adw.ToolbarView()
        view.add_top_bar(Adw.HeaderBar(show_title=False))
        view.set_content(self.carousel)
        view.add_bottom_bar(footer)
        self.set_content(view)
        if page:
            for i, (name, widget) in enumerate(self.pages):
                if name == page:
                    GLib.idle_add(lambda w=widget: self.carousel.scroll_to(w, False) and False)
        self._page_changed(self.carousel, 0)

    def _add(self, scene: str, title: str, text: str) -> Gtk.Box:
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12, margin_start=36, margin_end=36,
                      valign=Gtk.Align.CENTER)
        box.append(Scene(scene))
        box.append(Gtk.Label(label=title, css_classes=["title-1"], wrap=True, justify=Gtk.Justification.CENTER))
        box.append(Gtk.Label(label=text, wrap=True, justify=Gtk.Justification.CENTER, max_width_chars=60,
                             css_classes=["body", "dim-label"]))
        self.carousel.append(box)
        self.pages.append((scene if scene != "hello" or not self.pages else "done", box))
        return box

    # --- ИИ-помощник -------------------------------------------------------

    def _add_ai_page(self):
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10, margin_start=36, margin_end=36,
                      valign=Gtk.Align.CENTER)
        scene = Scene("assistant")
        scene.set_content_height(200)
        box.append(scene)
        box.append(Gtk.Label(label=_("Your AI assistant"), css_classes=["title-1"]))
        box.append(Gtk.Label(label=_("A small Gemma model that runs on this computer, offline. It knows HypeDE, "
                                     "tells you where every setting is and can read your files when you ask."),
                             wrap=True, justify=Gtk.Justification.CENTER, max_width_chars=60,
                             css_classes=["dim-label"]))
        group = Gtk.ListBox(css_classes=["boxed-list"], selection_mode=Gtk.SelectionMode.NONE, margin_top=6)
        self.choice = "small"
        first = None
        for value, title, subtitle in (
            ("small", _("Install the small model"), _("Gemma 3 270M · 290 MB · runs on any computer")),
            ("large", _("Install the smarter model"), _("Gemma 3 1B · 800 MB · needs 4 GB of memory")),
            ("online", _("Use an online assistant"), _("Claude, Gemini, ChatGPT and others in Settings")),
            ("skip", _("Not now"), _("You can install it later in Settings → AI assistant")),
        ):
            check = Gtk.CheckButton(group=first, valign=Gtk.Align.CENTER, active=value == "small")
            first = first or check
            check.connect("toggled", lambda b, v=value: b.get_active() and self._choose(v))
            row = Adw.ActionRow(title=title, subtitle=subtitle, activatable_widget=check)
            row.add_prefix(check)
            group.append(row)
        self.choices = group
        box.append(group)
        self.progress = Gtk.ProgressBar(show_text=True, visible=False, margin_top=4)
        box.append(self.progress)
        self.ai_status = Gtk.Label(wrap=True, css_classes=["caption", "dim-label"], visible=False)
        box.append(self.ai_status)
        self.carousel.append(box)
        self.pages.append(("ai", box))
        self._sync_installed()

    def _choose(self, value: str):
        self.choice = value
        self._page_changed(self.carousel, round(self.carousel.get_position()))

    def _sync_installed(self):
        status = self._ai_status()
        if status.get("installed") and status.get("engine"):
            self.choices.set_visible(False)
            self.ai_status.set_label(_("%s is installed and works on this computer.") % status.get("model", "Gemma"))
            self.ai_status.set_visible(True)
            self.choice = "skip"

    def _ai_status(self) -> dict:
        program = shutil.which("hypede-ai")
        if not program:
            return {}
        try:
            process = Gio.Subprocess.new([program, "status"], Gio.SubprocessFlags.STDOUT_PIPE)
            ok, out, _err = process.communicate_utf8(None, None)
            return json.loads(out) if ok and out else {}
        except (GLib.Error, ValueError):
            return {}

    def _install(self):
        """hypede-ai install печатает ход строками JSON — показываем его."""
        self.choices.set_sensitive(False)
        self.next.set_sensitive(False)
        self.back.set_sensitive(False)
        self.progress.set_visible(True)
        self.ai_status.set_visible(True)
        self.ai_status.set_label(_("Installing llama.cpp… (asks for your password)"))
        try:
            self.installer = Gio.Subprocess.new(["hypede-ai", "install", "--model", self.choice],
                                                Gio.SubprocessFlags.STDOUT_PIPE)
        except GLib.Error as error:
            self._install_finished(False, error.message)
            return
        stream = Gio.DataInputStream.new(self.installer.get_stdout_pipe())
        self._read_line(stream)

    def _read_line(self, stream):
        def done(source, result):
            try:
                line, _length = source.read_line_finish_utf8(result)
            except GLib.Error:
                line = None
            if line is None:
                self._install_finished(self.installer.get_exit_status() == 0 if self.installer.get_if_exited()
                                       else True, None)
                return
            try:
                event = json.loads(line)
            except ValueError:
                event = {}
            step = event.get("step")
            if step == "model":
                self.progress.set_fraction(event.get("percent", 0) / 100)
                self.progress.set_text(_("Downloading the model: %d%%") % event.get("percent", 0))
                self.ai_status.set_label(_("%(done)d of %(total)d MB") % {
                    "done": event.get("done", 0) >> 20, "total": event.get("total", 0) >> 20})
            elif step == "engine":
                self.progress.pulse()
            elif step == "service":
                self.progress.set_text(_("Starting the assistant…"))
            elif step == "done":
                self._install_finished(True, None)
                return
            elif step == "error":
                self._install_finished(False, event.get("message"))
                return
            self._read_line(source)

        stream.read_line_async(GLib.PRIORITY_DEFAULT, None, done)

    def _install_finished(self, ok: bool, message: str | None):
        self.installer = None
        self.next.set_sensitive(True)
        self.back.set_sensitive(True)
        if ok:
            self.progress.set_fraction(1)
            self.progress.set_text(_("Done"))
            self.ai_status.set_label(_("The assistant is ready: Super+A, or the Ask button in the launcher."))
            self.choices.set_visible(False)
            self.choice = "skip"
        else:
            self.choices.set_sensitive(True)
            self.progress.set_visible(False)
            self.ai_status.set_label(_("Could not install: %s") % (message or _("unknown error")))

    # --- листание ----------------------------------------------------------

    def _go(self, step: int):
        index = round(self.carousel.get_position())
        name = self.pages[index][0]
        if step > 0 and name == "ai" and self.choice in ("small", "large"):
            self._install()
            return
        if step > 0 and name == "ai" and self.choice == "online":
            self._run(["hypede-settings", "--page", "assistant"])
        if step > 0 and index == len(self.pages) - 1:
            self._finish()
            return
        target = max(0, min(len(self.pages) - 1, index + step))
        self.carousel.scroll_to(self.pages[target][1], True)

    def _page_changed(self, _carousel, index):
        index = int(index)
        self.back.set_visible(index > 0)
        last = index == len(self.pages) - 1
        name = self.pages[index][0]
        if last:
            self.next.set_label(_("Start"))
        elif name == "ai" and self.choice in ("small", "large"):
            self.next.set_label(_("Install"))
        else:
            self.next.set_label(_("Next"))
        for child in self._scenes(self.pages[index][1]):
            child.restart()

    def _scenes(self, box):
        child = box.get_first_child()
        while child is not None:
            if isinstance(child, Scene):
                yield child
            child = child.get_next_sibling()

    def _run(self, argv: list[str]):
        try:
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE)
        except GLib.Error:
            pass

    def _finish(self):
        os.makedirs(os.path.dirname(DONE_FILE), exist_ok=True)
        with open(DONE_FILE, "w") as fh:
            fh.write(__version__ + "\n")
        self.close()


class Application(Adw.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
        self.add_main_option("first-run", 0, GLib.OptionFlags.NONE, GLib.OptionArg.NONE,
                             "Show only if the tour was never finished", None)
        self.add_main_option("page", 0, GLib.OptionFlags.NONE, GLib.OptionArg.STRING,
                             "Open a page: launcher, windows, island, personalize, ai", "PAGE")

    def do_command_line(self, command_line):
        options = command_line.get_options_dict().end().unpack()
        if options.get("first-run") and os.path.exists(DONE_FILE):
            return 0
        window = self.get_active_window() or Window(self, options.get("page"))
        window.present()
        return 0


def main() -> int:
    _setup_i18n()
    return Application().run(sys.argv)
