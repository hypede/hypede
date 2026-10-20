"""«Терминал» HypeDE.

Движок — VTE (как у GNOME Terminal и Ptyxis), а из других терминалов взято:
вкладки и их перетаскивание — из Konsole, разделение окна на панели — из
kitty и Konsole, прозрачный фон — из Alacritty, быстрый запуск нового окна
уже запущенной программой — из foot (сервер) и kitty. Новая вкладка и
панель открываются в каталоге текущей.

    hypede-terminal                          новое окно
    hypede-terminal --working-directory DIR  окно в каталоге
    hypede-terminal -e команда аргументы…    выполнить команду
"""

from __future__ import annotations

import gettext
import locale
import os
import shlex
import sys

import gi

if "HypeDE" in os.environ.get("XDG_CURRENT_DESKTOP", "").split(":"):
    os.environ["DCONF_PROFILE"] = "hypede"

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
gi.require_version("Gdk", "4.0")
gi.require_version("Vte", "3.91")
gi.require_version("Pango", "1.0")
gi.require_version("Graphene", "1.0")

from gi.repository import Adw, Gdk, Gio, GLib, Graphene, Gtk, Pango, Vte  # noqa: E402

from . import __version__  # noqa: E402
from .schemes import SCHEMES, palette  # noqa: E402

APP_ID = "dev.hypede.Terminal"
SCHEMA = "dev.hypede.terminal"
_ = gettext.gettext
_DATA_DIR = os.path.dirname(os.path.abspath(__file__))
PCRE2_MULTILINE = 0x00000400
PCRE2_CASELESS = 0x00000008
URL_REGEX = r"(https?|ftp|file)://[^\s<>\"'`]+[^\s<>\"'`.,;:!?)\]]"

CSS = """
/* Прозрачен только фон под терминалом; шапка и вкладки — обычные. */
window.hypede-terminal.see-through { background-color: transparent; }
window.hypede-terminal.see-through .top-bar { background-color: var(--headerbar-bg-color); }
.hypede-terminal-search { padding: 6px; }
paned.hypede-terminal-split > separator { min-width: 2px; min-height: 2px; background: alpha(currentColor, 0.15); }
"""


def _setup_i18n() -> None:
    marker = os.sep + os.path.join("share", "hypede", "terminal")
    prefix = _DATA_DIR.split(marker)[0] if marker in _DATA_DIR else "/usr"
    try:
        locale.setlocale(locale.LC_ALL, "")
    except locale.Error:
        pass
    gettext.bindtextdomain("hypede", os.environ.get("HYPEDE_LOCALEDIR", os.path.join(prefix, "share", "locale")))
    gettext.textdomain("hypede")


def user_shell() -> str:
    shell = os.environ.get("SHELL")
    if not shell:
        try:
            import pwd
            shell = pwd.getpwuid(os.getuid()).pw_shell
        except (ImportError, KeyError):
            shell = "/bin/sh"
    return shell or "/bin/sh"


class Pane(Vte.Terminal):
    """Одна панель с оболочкой. Закрывается сама, когда оболочка выходит."""

    def __init__(self, window: "Window", directory: str | None, argv: list[str] | None = None):
        super().__init__(hexpand=True, vexpand=True)
        self.window = window
        self.set_allow_hyperlink(True)
        self.set_mouse_autohide(True)
        self.set_bold_is_bright(True)
        self.set_enable_fallback_scrolling(True)
        try:
            regex = Vte.Regex.new_for_match(URL_REGEX, -1, PCRE2_MULTILINE)
            self.url_tag = self.match_add_regex(regex, 0)
            self.match_set_cursor_name(self.url_tag, "pointer")
        except GLib.Error:
            self.url_tag = -1
        window.app.apply_settings(self)

        click = Gtk.GestureClick(button=0)
        click.connect("pressed", self._clicked)
        self.add_controller(click)
        self.connect("child-exited", lambda *_: window.close_pane(self))
        self.connect("window-title-changed", lambda *_: window.update_title(self))
        self.connect("notify::current-directory-uri", lambda *_: window.update_title(self))
        focus = Gtk.EventControllerFocus()
        focus.connect("enter", lambda *_: window.set_active_pane(self))
        self.add_controller(focus)

        command = argv or [user_shell()]
        env = [f"{k}={v}" for k, v in os.environ.items() if k not in ("COLUMNS", "LINES")]
        env += ["TERM=xterm-256color", "COLORTERM=truecolor", "TERM_PROGRAM=hypede-terminal",
                f"TERM_PROGRAM_VERSION={__version__}"]
        self.spawn_async(Vte.PtyFlags.DEFAULT, directory or GLib.get_home_dir(), command, env,
                         GLib.SpawnFlags.SEARCH_PATH, None, None, -1, None, self._spawned)

    def _spawned(self, _terminal, pid, error):
        if error is not None:
            self.feed(f"\r\n{error.message}\r\n".encode())

    def directory(self) -> str | None:
        uri = self.get_current_directory_uri()
        if uri:
            try:
                return GLib.filename_from_uri(uri)[0]
            except GLib.Error:
                return None
        return None

    def link_at(self, x: float, y: float) -> str | None:
        link = self.check_hyperlink_at(x, y)
        if link:
            return link
        match, _tag = self.check_match_at(x, y)
        return match

    def _clicked(self, gesture, _n, x, y):
        button = gesture.get_current_button()
        state = gesture.get_current_event_state()
        link = self.link_at(x, y)
        # Ctrl+щелчок по ссылке — открыть, как в kitty и Konsole.
        if button == 1 and link and state & Gdk.ModifierType.CONTROL_MASK:
            Gtk.UriLauncher(uri=link).launch(self.window, None, None, None)
            gesture.set_state(Gtk.EventSequenceState.CLAIMED)
        elif button == 3:
            self.window.show_menu(self, x, y, link)
            gesture.set_state(Gtk.EventSequenceState.CLAIMED)


class Window(Adw.ApplicationWindow):
    def __init__(self, app: "Application"):
        super().__init__(application=app, title=_("Terminal"), default_width=900, default_height=560)
        # add_css_class, а не css_classes=[…]: тот стёр бы стандартные классы
        # окна, и у него пропал бы фон.
        self.add_css_class("hypede-terminal")
        self.app = app
        self.active: Pane | None = None

        self.tabs = Adw.TabView()
        self.tabs.connect("close-page", self._close_page)
        self.tabs.connect("notify::selected-page", self._page_selected)
        self.tabs.connect("create-window", self._create_window)
        self.tabs.connect("page-detached", lambda *_: self._maybe_close())
        bar = Adw.TabBar(view=self.tabs, autohide=True)
        header = Adw.HeaderBar()
        new_tab = Gtk.Button(icon_name="tab-new-symbolic", tooltip_text=_("New tab (Ctrl+Shift+T)"))
        new_tab.set_action_name("win.new-tab")
        header.pack_start(new_tab)
        menu = Gio.Menu()
        section = Gio.Menu()
        section.append(_("New window"), "app.new-window")
        section.append(_("Split side by side"), "win.split-right")
        section.append(_("Split top and bottom"), "win.split-down")
        menu.append_section(None, section)
        section = Gio.Menu()
        section.append(_("Find…"), "win.find")
        section.append(_("Preferences"), "app.preferences")
        section.append(_("Keyboard shortcuts"), "win.shortcuts")
        section.append(_("About Terminal"), "app.about")
        menu.append_section(None, section)
        header.pack_end(Gtk.MenuButton(icon_name="open-menu-symbolic", menu_model=menu, primary=True))
        overview_button = Gtk.Button(icon_name="view-grid-symbolic", tooltip_text=_("All tabs"))
        overview_button.set_action_name("win.overview")
        header.pack_end(overview_button)

        # Поиск по выводу.
        self.search_entry = Gtk.SearchEntry(placeholder_text=_("Find in terminal"), hexpand=True)
        self.search_entry.connect("search-changed", self._search_changed)
        self.search_entry.connect("activate", lambda *_: self._search(False))
        self.search_entry.connect("stop-search", lambda *_: self.search_bar.set_search_mode(False))
        up = Gtk.Button(icon_name="go-up-symbolic", tooltip_text=_("Previous"))
        up.connect("clicked", lambda *_: self._search(True))
        down = Gtk.Button(icon_name="go-down-symbolic", tooltip_text=_("Next"))
        down.connect("clicked", lambda *_: self._search(False))
        search_box = Gtk.Box(spacing=6, css_classes=["hypede-terminal-search"])
        search_box.append(self.search_entry)
        search_box.append(up)
        search_box.append(down)
        self.search_bar = Gtk.SearchBar(child=search_box, show_close_button=True)
        self.search_bar.connect_entry(self.search_entry)

        view = Adw.ToolbarView(top_bar_style=Adw.ToolbarStyle.FLAT)
        view.add_top_bar(header)
        view.add_top_bar(bar)
        view.add_top_bar(self.search_bar)
        view.set_content(self.tabs)
        self.overview = Adw.TabOverview(view=self.tabs, child=view, enable_new_tab=True)
        self.overview.connect("create-tab", lambda *_: self.page_of(self.new_tab()))
        app.apply_window(self)
        self.toasts = Adw.ToastOverlay(child=self.overview)
        self.set_content(self.toasts)

        for name, callback in (
            ("new-tab", lambda *_: self.new_tab()), ("close-pane", lambda *_: self._close_active()),
            ("split-right", lambda *_: self.split(Gtk.Orientation.HORIZONTAL)),
            ("split-down", lambda *_: self.split(Gtk.Orientation.VERTICAL)),
            ("copy", lambda *_: self.active and self.active.copy_clipboard_format(Vte.Format.TEXT)),
            ("paste", lambda *_: self.active and self.active.paste_clipboard()),
            ("zoom-in", lambda *_: self.app.zoom(1)), ("zoom-out", lambda *_: self.app.zoom(-1)),
            ("zoom-reset", lambda *_: self.app.zoom(0)),
            ("find", lambda *_: self._open_search()), ("overview", lambda *_: self.overview.set_open(True)),
            ("next-tab", lambda *_: self.tabs.select_next_page()),
            ("previous-tab", lambda *_: self.tabs.select_previous_page()),
            ("select-all", lambda *_: self.active and self.active.select_all()),
            ("shortcuts", lambda *_: self._shortcuts()),
            ("focus-left", lambda *_: self.focus_neighbour(-1, 0)), ("focus-right", lambda *_: self.focus_neighbour(1, 0)),
            ("focus-up", lambda *_: self.focus_neighbour(0, -1)), ("focus-down", lambda *_: self.focus_neighbour(0, 1)),
        ):
            action = Gio.SimpleAction.new(name, None)
            action.connect("activate", callback)
            self.add_action(action)
        self.link_action = Gio.SimpleAction.new("open-link", GLib.VariantType.new("s"))
        self.link_action.connect("activate", lambda _a, v: Gtk.UriLauncher(uri=v.get_string()).launch(self, None, None, None))
        self.add_action(self.link_action)
        self.copy_link_action = Gio.SimpleAction.new("copy-link", GLib.VariantType.new("s"))
        self.copy_link_action.connect("activate", lambda _a, v: self.get_clipboard().set(v.get_string()))
        self.add_action(self.copy_link_action)


    # --- вкладки и панели --------------------------------------------------

    def new_tab(self, directory: str | None = None, argv: list[str] | None = None) -> Pane:
        if directory is None and self.active is not None:
            directory = self.active.directory()
        pane = Pane(self, directory, argv)
        # Вкладка держит коробку: внутри неё панель или дерево Gtk.Paned.
        box = Gtk.Box()
        box.append(pane)
        page = self.tabs.append(box)
        page.set_title(_("Terminal"))
        self.tabs.set_selected_page(page)
        self.set_active_pane(pane)
        pane.grab_focus()
        return pane

    def page_of(self, widget: Gtk.Widget) -> Adw.TabPage | None:
        for i in range(self.tabs.get_n_pages()):
            page = self.tabs.get_nth_page(i)
            if widget.is_ancestor(page.get_child()):
                return page
        return None

    def panes(self, root: Gtk.Widget | None = None) -> list[Pane]:
        if root is None:
            page = self.tabs.get_selected_page()
            if page is None:
                return []
            root = page.get_child()
        if isinstance(root, Pane):
            return [root]
        if isinstance(root, Gtk.Paned):
            return self.panes(root.get_start_child()) + self.panes(root.get_end_child())
        if isinstance(root, Gtk.Box) and root.get_first_child() is not None:
            return self.panes(root.get_first_child())
        return []

    def split(self, orientation: Gtk.Orientation):
        """Разделить текущую панель: справа или снизу появится новая."""
        old = self.active
        if old is None:
            return
        parent = old.get_parent()
        page = self.page_of(old)
        new = Pane(self, old.directory())
        size = old.get_width() if orientation == Gtk.Orientation.HORIZONTAL else old.get_height()
        paned = Gtk.Paned(orientation=orientation, hexpand=True, vexpand=True, css_classes=["hypede-terminal-split"],
                          resize_start_child=True, resize_end_child=True)
        if isinstance(parent, Gtk.Paned):
            first = parent.get_start_child() is old
            if first:
                parent.set_start_child(None)
            else:
                parent.set_end_child(None)
            paned.set_start_child(old)
            paned.set_end_child(new)
            if first:
                parent.set_start_child(paned)
            else:
                parent.set_end_child(paned)
        elif page is not None:
            self._replace_root(page, old, paned, new)
        paned.set_position(size // 2)
        new.grab_focus()
        self.set_active_pane(new)

    def _replace_root(self, page: Adw.TabPage, old: Pane, paned: Gtk.Paned, new: Pane):
        box = page.get_child()
        box.remove(old)
        paned.set_start_child(old)
        paned.set_end_child(new)
        box.append(paned)

    def close_pane(self, pane: Pane):
        parent = pane.get_parent()
        if isinstance(parent, Gtk.Paned):
            sibling = parent.get_end_child() if parent.get_start_child() is pane else parent.get_start_child()
            parent.set_start_child(None)
            parent.set_end_child(None)
            holder = parent.get_parent()
            if isinstance(holder, Gtk.Paned):
                if holder.get_start_child() is parent:
                    holder.set_start_child(sibling)
                else:
                    holder.set_end_child(sibling)
            else:
                holder.remove(parent)
                holder.append(sibling)
            target = self.panes(sibling)[0] if self.panes(sibling) else None
            if target:
                target.grab_focus()
                self.set_active_pane(target)
            return
        page = self.page_of(pane)
        if page is not None:
            self.tabs.close_page(page)

    def _close_active(self):
        if self.active is not None:
            self.close_pane(self.active)

    def _close_page(self, view, page):
        view.close_page_finish(page, True)
        if view.get_n_pages() == 0:
            self.close()
        return Gdk.EVENT_STOP

    def _maybe_close(self):
        if self.tabs.get_n_pages() == 0:
            self.close()

    def _create_window(self, _view):
        window = Window(self.app)
        window.present()
        return window.tabs

    def _page_selected(self, *_args):
        panes = self.panes()
        if panes:
            target = self.active if self.active in panes else panes[0]
            self.set_active_pane(target)
            GLib.idle_add(lambda: target.grab_focus() and False)

    def set_active_pane(self, pane: Pane):
        self.active = pane
        self.update_title(pane)

    def update_title(self, pane: Pane):
        title = pane.get_window_title() or ""
        directory = pane.directory()
        if not title and directory:
            home = GLib.get_home_dir()
            title = "~" + directory[len(home):] if directory.startswith(home) else directory
        title = title or _("Terminal")
        page = self.page_of(pane)
        if page is not None and (pane is self.active or len(self.panes(page.get_child())) == 1):
            page.set_title(title)
        if pane is self.active:
            self.set_title(title)

    def focus_neighbour(self, dx: int, dy: int):
        """Alt+стрелка — в соседнюю панель в этом направлении."""
        if self.active is None:
            return
        panes = self.panes()
        origin = center(self.active, self)
        if origin is None:
            return
        best, best_distance = None, None
        for pane in panes:
            if pane is self.active:
                continue
            point = center(pane, self)
            if point is None:
                continue
            ddx, ddy = point.x - origin.x, point.y - origin.y
            if (dx and ddx * dx <= 0) or (dy and ddy * dy <= 0):
                continue
            distance = abs(ddx) + abs(ddy) * 2 if dx else abs(ddy) + abs(ddx) * 2
            if best is None or distance < best_distance:
                best, best_distance = pane, distance
        if best is not None:
            best.grab_focus()

    # --- поиск и меню -------------------------------------------------------

    def _open_search(self):
        self.search_bar.set_search_mode(True)
        if self.active is not None and self.active.get_has_selection():
            self.search_entry.set_text(self.active.get_text_selected(Vte.Format.TEXT) or "")
        self.search_entry.grab_focus()

    def _search_changed(self, entry):
        if self.active is None:
            return
        text = entry.get_text()
        if not text:
            self.active.search_set_regex(None, 0)
            return
        try:
            regex = Vte.Regex.new_for_search(GLib.Regex.escape_string(text, -1), -1,
                                             PCRE2_MULTILINE | PCRE2_CASELESS)
        except GLib.Error:
            return
        self.active.search_set_regex(regex, 0)
        self.active.search_set_wrap_around(True)
        self._search(True)

    def _search(self, backward: bool):
        if self.active is not None:
            if backward:
                self.active.search_find_previous()
            else:
                self.active.search_find_next()

    def show_menu(self, pane: Pane, x: float, y: float, link: str | None):
        menu = Gio.Menu()
        if link:
            section = Gio.Menu()
            section.append(_("Open link"), f"win.open-link({GLib.Variant('s', link).print_(False)})")
            section.append(_("Copy link"), f"win.copy-link({GLib.Variant('s', link).print_(False)})")
            menu.append_section(None, section)
        section = Gio.Menu()
        section.append(_("Copy"), "win.copy")
        section.append(_("Paste"), "win.paste")
        section.append(_("Select all"), "win.select-all")
        menu.append_section(None, section)
        section = Gio.Menu()
        section.append(_("Split side by side"), "win.split-right")
        section.append(_("Split top and bottom"), "win.split-down")
        section.append(_("Close pane"), "win.close-pane")
        menu.append_section(None, section)
        popover = Gtk.PopoverMenu(menu_model=menu, has_arrow=False)
        popover.set_parent(pane)
        rect = Gdk.Rectangle()
        rect.x, rect.y, rect.width, rect.height = int(x), int(y), 1, 1
        popover.set_pointing_to(rect)
        popover.connect("closed", lambda p: GLib.idle_add(p.unparent))
        popover.popup()

    def _shortcuts(self):
        rows = [
            (_("New tab"), "Ctrl+Shift+T"), (_("New window"), "Ctrl+Shift+N"),
            (_("Close pane or tab"), "Ctrl+Shift+W"), (_("Split side by side"), "Ctrl+Shift+E"),
            (_("Split top and bottom"), "Ctrl+Shift+O"), (_("Move between panes"), "Alt+←↑→↓"),
            (_("Next or previous tab"), "Ctrl+Page Down / Page Up"), (_("All tabs"), "Ctrl+Shift+A"),
            (_("Copy"), "Ctrl+Shift+C"), (_("Paste"), "Ctrl+Shift+V"), (_("Find…"), "Ctrl+Shift+F"),
            (_("Larger or smaller text"), "Ctrl+= / Ctrl+-"), (_("Open a link"), _("Ctrl+click")),
        ]
        dialog = Adw.Dialog(title=_("Keyboard shortcuts"), content_width=440)
        view = Adw.ToolbarView()
        view.add_top_bar(Adw.HeaderBar())
        group = Adw.PreferencesGroup(margin_top=12, margin_bottom=18, margin_start=18, margin_end=18)
        for title, keys in rows:
            row = Adw.ActionRow(title=title)
            row.add_suffix(Gtk.Label(label=keys, css_classes=["dim-label"]))
            group.add(row)
        view.set_content(Gtk.ScrolledWindow(child=group, propagate_natural_height=True))
        dialog.set_child(view)
        dialog.present(self)


def center(widget: Gtk.Widget, window: Gtk.Widget) -> Graphene.Point | None:
    point = Graphene.Point()
    point.init(widget.get_width() / 2, widget.get_height() / 2)
    ok, result = widget.compute_point(window, point)
    return result if ok else None


class Application(Adw.Application):
    def __init__(self, dropdown: bool = False):
        # Выпадающий терминал (F12 в HypeDE) — отдельное приложение со своим
        # app_id: по нему оболочка узнаёт окно и выдвигает его сверху.
        super().__init__(application_id=APP_ID + (".Dropdown" if dropdown else ""),
                         flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
        self.settings: Gio.Settings | None = None
        self.style: Adw.StyleManager | None = None
        self.add_main_option("working-directory", ord("w"), GLib.OptionFlags.NONE, GLib.OptionArg.FILENAME,
                             "Directory to start in", "DIR")
        self.add_main_option("version", 0, GLib.OptionFlags.NONE, GLib.OptionArg.NONE, "Show the version", None)

    def do_startup(self):
        Adw.Application.do_startup(self)
        self.settings = Gio.Settings(schema_id=SCHEMA)
        self.settings.connect("changed", lambda *_: self.apply_all())
        self.interface = Gio.Settings(schema_id="org.gnome.desktop.interface")
        self.interface.connect("changed::monospace-font-name", lambda *_: self.apply_all())
        self.style = Adw.StyleManager.get_default()
        self.style.connect("notify::dark", lambda *_: self.apply_all())

        provider = Gtk.CssProvider()
        provider.load_from_string(CSS)
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider,
                                                  Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

        for name, callback in (("new-window", lambda *_: self.new_window()), ("preferences", self._preferences),
                               ("about", self._about), ("quit", lambda *_: self.quit())):
            action = Gio.SimpleAction.new(name, None)
            action.connect("activate", callback)
            self.add_action(action)
        accels = {
            "app.new-window": ["<Control><Shift>n"], "win.new-tab": ["<Control><Shift>t"],
            "win.close-pane": ["<Control><Shift>w"], "win.split-right": ["<Control><Shift>e"],
            "win.split-down": ["<Control><Shift>o"], "win.copy": ["<Control><Shift>c"],
            "win.paste": ["<Control><Shift>v", "<Shift>Insert"], "win.find": ["<Control><Shift>f"],
            "win.zoom-in": ["<Control>plus", "<Control>equal"], "win.zoom-out": ["<Control>minus"],
            "win.zoom-reset": ["<Control>0"], "win.overview": ["<Control><Shift>a"],
            "win.next-tab": ["<Control>Page_Down"], "win.previous-tab": ["<Control>Page_Up"],
            "win.focus-left": ["<Alt>Left"], "win.focus-right": ["<Alt>Right"],
            "win.focus-up": ["<Alt>Up"], "win.focus-down": ["<Alt>Down"],
            "app.preferences": ["<Control>comma"], "app.quit": ["<Control><Shift>q"],
        }
        for action, keys in accels.items():
            self.set_accels_for_action(action, keys)

    def do_command_line(self, command_line):
        options = command_line.get_options_dict().end().unpack()
        if options.get("version"):
            command_line.print_literal(f"hypede-terminal {__version__}\n")
            return 0
        args = command_line.get_arguments()[1:]
        argv = None
        if "-e" in args:
            argv = args[args.index("-e") + 1:]
        elif "--" in args:
            argv = args[args.index("--") + 1:]
        if argv and len(argv) == 1 and " " in argv[0]:
            argv = shlex.split(argv[0])
        # Путь (OptionArg.FILENAME) приходит строкой байтов «ay» — списком чисел.
        directory = options.get("working-directory")
        if isinstance(directory, list):
            directory = bytes(directory)
        if isinstance(directory, bytes):
            directory = directory.rstrip(b"\0").decode(errors="replace")
        directory = directory or command_line.get_cwd() or GLib.get_home_dir()
        self.new_window(directory, argv)
        return 0

    def new_window(self, directory: str | None = None, argv: list[str] | None = None):
        window = Window(self)
        window.new_tab(directory or GLib.get_home_dir(), argv)
        window.present()

    # --- настройки ---------------------------------------------------------

    def font(self) -> Pango.FontDescription:
        name = self.settings.get_string("font") or self.interface.get_string("monospace-font-name") or "Monospace 11"
        desc = Pango.FontDescription.from_string(name)
        zoom = self.settings.get_int("zoom")
        if zoom and desc.get_size():
            desc.set_size(max(desc.get_size() + zoom * Pango.SCALE, 6 * Pango.SCALE))
        return desc

    def zoom(self, step: int):
        self.settings.set_int("zoom", 0 if step == 0 else max(-6, min(20, self.settings.get_int("zoom") + step)))

    def apply_window(self, window: Window):
        if self.settings.get_double("opacity") < 1:
            window.add_css_class("see-through")
        else:
            window.remove_css_class("see-through")

    def apply_settings(self, pane: Pane):
        settings = self.settings
        dark = self.style.get_dark()
        fg, bg, colors = palette(settings.get_string("scheme"), dark)
        bg.alpha = settings.get_double("opacity")
        pane.set_colors(fg, bg, colors)
        pane.set_font(self.font())
        pane.set_cursor_shape({"block": Vte.CursorShape.BLOCK, "ibeam": Vte.CursorShape.IBEAM,
                               "underline": Vte.CursorShape.UNDERLINE}[settings.get_string("cursor-shape")])
        pane.set_cursor_blink_mode(Vte.CursorBlinkMode.ON if settings.get_boolean("cursor-blink")
                                   else Vte.CursorBlinkMode.OFF)
        lines = settings.get_int("scrollback")
        pane.set_scrollback_lines(-1 if lines < 0 else lines)
        pane.set_audible_bell(settings.get_boolean("bell"))
        pane.set_scroll_on_output(False)
        pane.set_scroll_on_keystroke(True)

    def apply_all(self):
        for window in self.get_windows():
            if isinstance(window, Window):
                self.apply_window(window)
                for i in range(window.tabs.get_n_pages()):
                    for pane in window.panes(window.tabs.get_nth_page(i).get_child()):
                        self.apply_settings(pane)

    def _preferences(self, *_args):
        dialog = Adw.PreferencesDialog(title=_("Preferences"))
        page = Adw.PreferencesPage(title=_("Appearance"), icon_name="applications-graphics-symbolic")
        look = Adw.PreferencesGroup(title=_("Appearance"))

        schemes = list(SCHEMES)
        scheme = Adw.ComboRow(title=_("Color scheme"), model=Gtk.StringList.new([_(SCHEMES[s]["name"]) for s in schemes]))
        scheme.set_selected(max(schemes.index(self.settings.get_string("scheme")), 0)
                            if self.settings.get_string("scheme") in schemes else 0)
        scheme.connect("notify::selected", lambda r, _p: self.settings.set_string("scheme", schemes[r.get_selected()]))
        look.add(scheme)

        font_row = Adw.ActionRow(title=_("Font"))
        font_button = Gtk.FontDialogButton(dialog=Gtk.FontDialog(), valign=Gtk.Align.CENTER, use_size=True)
        font_button.set_font_desc(Pango.FontDescription.from_string(
            self.settings.get_string("font") or self.interface.get_string("monospace-font-name")))
        font_button.connect("notify::font-desc",
                            lambda b, _p: self.settings.set_string("font", b.get_font_desc().to_string()))
        reset = Gtk.Button(icon_name="edit-undo-symbolic", valign=Gtk.Align.CENTER, css_classes=["flat"],
                           tooltip_text=_("System font"))
        reset.connect("clicked", lambda *_: self.settings.reset("font"))
        font_row.add_suffix(font_button)
        font_row.add_suffix(reset)
        look.add(font_row)

        opacity = Adw.SpinRow.new_with_range(30, 100, 5)
        opacity.set_title(_("Background opacity"))
        opacity.set_subtitle(_("Below 100% the desktop shows through"))
        opacity.set_value(round(self.settings.get_double("opacity") * 100))
        opacity.connect("notify::value", lambda r, _p: self.settings.set_double("opacity", r.get_value() / 100))
        look.add(opacity)

        cursor_shapes = ["block", "ibeam", "underline"]
        cursor = Adw.ComboRow(title=_("Cursor"), model=Gtk.StringList.new([_("Block"), _("I-beam"), _("Underline")]))
        cursor.set_selected(cursor_shapes.index(self.settings.get_string("cursor-shape")))
        cursor.connect("notify::selected",
                       lambda r, _p: self.settings.set_string("cursor-shape", cursor_shapes[r.get_selected()]))
        look.add(cursor)
        blink = Adw.SwitchRow(title=_("Blinking cursor"))
        self.settings.bind("cursor-blink", blink, "active", Gio.SettingsBindFlags.DEFAULT)
        look.add(blink)
        page.add(look)

        behaviour = Adw.PreferencesGroup(title=_("Behavior"))
        unlimited = Adw.SwitchRow(title=_("Unlimited scrollback"))
        unlimited.set_active(self.settings.get_int("scrollback") < 0)
        unlimited.connect("notify::active",
                          lambda r, _p: self.settings.set_int("scrollback", -1 if r.get_active() else 10000))
        behaviour.add(unlimited)
        bell = Adw.SwitchRow(title=_("Terminal bell sound"))
        self.settings.bind("bell", bell, "active", Gio.SettingsBindFlags.DEFAULT)
        behaviour.add(bell)
        page.add(behaviour)
        dialog.add(page)
        dialog.present(self.get_active_window())

    def _about(self, *_args):
        Adw.AboutDialog(application_name=_("Terminal"), application_icon="utilities-terminal",
                        version=__version__, developer_name="HypeDE",
                        comments=_("Tabs like Konsole, panes like kitty, a see-through background like "
                                   "Alacritty and a quick start like foot."),
                        license_type=Gtk.License.GPL_3_0).present(self.get_active_window())


def main() -> int:
    _setup_i18n()
    dropdown = "--dropdown" in sys.argv
    argv = [a for a in sys.argv if a != "--dropdown"]
    return Application(dropdown).run(argv)
