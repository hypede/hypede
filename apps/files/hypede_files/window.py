"""Главное окно «Файлов».

    ┌──────────────┬──────────────────────────────────────────────┬───────────┐
    │  Файлы    ☰  │ ‹ ›  ⌂ Домашняя › Документы       🔍 ▦ ⋯    │           │
    │──────────────│ [вкладка 1] [вкладка 2]                      │  сведения │
    │ Недавние     │                                              │  о файле  │
    │ Домашняя     │         сетка или список файлов              │  (COSMIC) │
    │ Документы    │                                              │           │
    │ …            │                          «Выбрано: 2 (4 МБ)» │           │
    └──────────────┴──────────────────────────────────────────────┴───────────┘

Раскладка и поведение — от Nautilus (боковая панель, крошки пути, поиск,
плашка выделения, двойной клик), вкладки и панель сведений — от COSMIC Files.
"""

from __future__ import annotations

import os

from gi.repository import Adw, Gdk, Gio, GLib, GObject, Gtk

from .details import DetailsPane
from .folder_view import FolderView, display_path, file_of, is_dir
from .operations import Operation, find_in_trash
from .pathbar import PathBar
from .sidebar import Sidebar, add_bookmark
from .util import _, ngettext, split_extension, terminal_command, unique_name, validate_filename


class Window(Adw.ApplicationWindow):
    __gtype_name__ = "HypeFilesWindow"

    def __init__(self, application, location: Gio.File, search: str | None = None):
        super().__init__(application=application)
        self.app = application
        self.prefs = application.prefs
        self.operations = application.operations
        self.set_default_size(self.prefs["window-width"], self.prefs["window-height"])
        if self.prefs["window-maximized"]:
            self.maximize()
        self.add_css_class("hypede-files")
        self.set_size_request(360, 320)

        self._build_ui()
        self._install_actions()
        self.open_tab(location, select=True)
        if search:
            GLib.idle_add(lambda: self._begin_search(search) and False)

        self.connect("close-request", self._on_close_request)
        self.operations.connect("operation-finished", self._on_operation_finished)

    # ================================================================
    # Интерфейс
    # ================================================================

    def _build_ui(self) -> None:
        # ----- боковая панель -----
        self.sidebar = Sidebar()
        self.sidebar.connect("open-location", lambda _s, f, new_tab: self.open_location(f, new_tab))

        app_menu = Gio.Menu()
        section = Gio.Menu()
        section.append(_("New Window"), "win.new-window")
        section.append(_("New Tab"), "win.new-tab")
        app_menu.append_section(None, section)
        section = Gio.Menu()
        section.append(_("Show Hidden Files"), "win.show-hidden")
        section.append(_("Show Details Pane"), "win.details")
        section.append(_("Sort Folders Before Files"), "win.folders-first")
        app_menu.append_section(None, section)
        section = Gio.Menu()
        section.append(_("Keyboard Shortcuts"), "win.shortcuts")
        section.append(_("About Files"), "win.about")
        app_menu.append_section(None, section)

        sidebar_header = Adw.HeaderBar(show_end_title_buttons=False, title_widget=Adw.WindowTitle(title=_("Files")))
        sidebar_header.pack_end(Gtk.MenuButton(icon_name="open-menu-symbolic", menu_model=app_menu,
                                               tooltip_text=_("Main Menu"), primary=True))
        sidebar_view = Adw.ToolbarView(content=self.sidebar)
        sidebar_view.add_top_bar(sidebar_header)

        # ----- заголовок содержимого -----
        self.header = Adw.HeaderBar(css_classes=["hypede-content-header"])
        self.sidebar_button = Gtk.ToggleButton(icon_name="sidebar-show-symbolic", tooltip_text=_("Show Sidebar"),
                                               visible=False)
        self.header.pack_start(self.sidebar_button)
        nav = Gtk.Box(css_classes=["linked"])
        self.back_button = Gtk.Button(icon_name="go-previous-symbolic", action_name="win.back",
                                      tooltip_text=_("Back"))
        self.forward_button = Gtk.Button(icon_name="go-next-symbolic", action_name="win.forward",
                                         tooltip_text=_("Forward"))
        nav.append(self.back_button)
        nav.append(self.forward_button)
        self.header.pack_start(nav)

        self.pathbar = PathBar()
        self.pathbar.connect("open-location", lambda _p, f: self.open_location(f))
        self.header.set_title_widget(self.pathbar)

        view_menu = Gio.Menu()
        section = Gio.Menu()
        section.append(_("A–Z"), "win.sort::name")
        section.append(_("Last Modified"), "win.sort::modified")
        section.append(_("Size"), "win.sort::size")
        section.append(_("Type"), "win.sort::type")
        view_menu.append_section(_("Sort"), section)
        section = Gio.Menu()
        section.append(_("Reversed Order"), "win.sort-reversed")
        view_menu.append_section(None, section)
        zoom = Gio.Menu()
        zoom_item = Gio.MenuItem()
        zoom_item.set_attribute_value("custom", GLib.Variant.new_string("zoom"))
        zoom.append_item(zoom_item)
        view_menu.append_section(None, zoom)

        view_popover = Gtk.PopoverMenu.new_from_model(view_menu)
        zoom_box = Gtk.Box(css_classes=["linked"], halign=Gtk.Align.CENTER, margin_top=6, margin_bottom=6)
        zoom_box.append(Gtk.Button(icon_name="zoom-out-symbolic", action_name="win.zoom-out",
                                   tooltip_text=_("Zoom Out"), css_classes=["flat"]))
        zoom_box.append(Gtk.Button(label="100%", action_name="win.zoom-reset", css_classes=["flat"],
                                   tooltip_text=_("Reset Zoom")))
        zoom_box.append(Gtk.Button(icon_name="zoom-in-symbolic", action_name="win.zoom-in",
                                   tooltip_text=_("Zoom In"), css_classes=["flat"]))
        view_popover.add_child(zoom_box, "zoom")

        self.view_toggle = Adw.ToggleGroup(css_classes=["round"], valign=Gtk.Align.CENTER)
        self.view_toggle.add(Adw.Toggle(name="grid", icon_name="view-grid-symbolic", tooltip=_("Grid View")))
        self.view_toggle.add(Adw.Toggle(name="list", icon_name="view-list-symbolic", tooltip=_("List View")))
        self.view_toggle.set_active_name(self.prefs["view-mode"])
        self.view_toggle.connect("notify::active-name",
                                 lambda g, _p: self._set_view_mode(g.get_active_name()))

        self.header.pack_end(Gtk.MenuButton(icon_name="view-more-symbolic", popover=view_popover,
                                            tooltip_text=_("View Options")))
        self.header.pack_end(self.view_toggle)
        self.search_button = Gtk.ToggleButton(icon_name="system-search-symbolic", tooltip_text=_("Search"))
        self.header.pack_end(self.search_button)

        self.ops_button = Gtk.MenuButton(icon_name="folder-download-symbolic", visible=False,
                                         tooltip_text=_("File Operations"), popover=self._build_ops_popover())
        self.header.pack_end(self.ops_button)
        self.operations.store.connect("items-changed", lambda *_: self._sync_ops_button())

        # ----- вкладки, поиск, баннер корзины -----
        self.tab_view = Adw.TabView()
        self.tab_view.connect("notify::selected-page", lambda *_: self._on_tab_switched())
        self.tab_view.connect("page-detached", lambda *_: self._on_page_detached())
        self.tab_view.connect("create-window", self._on_create_window)
        self.tab_bar = Adw.TabBar(view=self.tab_view, autohide=True)

        self.search_entry = Gtk.SearchEntry(placeholder_text=_("Search files and folders"), hexpand=True)
        self.search_entry.connect("search-changed", self._on_search_changed)
        self.search_entry.connect("stop-search", lambda *_: self.search_button.set_active(False))
        clamp = Adw.Clamp(child=self.search_entry, maximum_size=520)
        self.search_bar = Gtk.SearchBar(child=clamp, show_close_button=False)
        self.search_bar.connect_entry(self.search_entry)
        self.search_bar.set_key_capture_widget(self)
        self.search_bar.bind_property("search-mode-enabled", self.search_button, "active",
                                      GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE)
        self.search_bar.connect("notify::search-mode-enabled", self._on_search_mode_changed)

        self.trash_banner = Adw.Banner(title=_("Trash"), button_label=_("Empty Trash…"), revealed=False)
        self.trash_banner.connect("button-clicked", lambda *_: self.activate_action("win.empty-trash"))

        # ----- панель сведений -----
        self.details = DetailsPane()
        details_box = Gtk.Box()
        details_box.append(Gtk.Separator(orientation=Gtk.Orientation.VERTICAL))
        details_box.append(self.details)
        self.details_revealer = Gtk.Revealer(child=details_box, reveal_child=self.prefs["show-details"],
                                             transition_type=Gtk.RevealerTransitionType.SLIDE_LEFT)
        # Явный hexpand=False не даёт растягивающимся подписям внутри панели
        # отобрать у списка файлов половину окна.
        self.details_revealer.set_hexpand(False)

        body = Gtk.Box(vexpand=True)
        body.append(self.tab_view)
        self.tab_view.set_hexpand(True)
        body.append(self.details_revealer)

        self.toasts = Adw.ToastOverlay(child=body)
        content_view = Adw.ToolbarView(content=self.toasts, top_bar_style=Adw.ToolbarStyle.RAISED)
        content_view.add_top_bar(self.header)
        content_view.add_top_bar(self.tab_bar)
        content_view.add_top_bar(self.search_bar)
        content_view.add_top_bar(self.trash_banner)

        self.split = Adw.OverlaySplitView(sidebar=sidebar_view, content=content_view,
                                          min_sidebar_width=200, max_sidebar_width=260,
                                          sidebar_width_fraction=0.22)
        self.split.bind_property("show-sidebar", self.sidebar_button, "active",
                                 GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE)
        self.split.bind_property("collapsed", self.sidebar_button, "visible", GObject.BindingFlags.SYNC_CREATE)

        breakpoint = Adw.Breakpoint.new(Adw.BreakpointCondition.parse("max-width: 720sp"))
        breakpoint.add_setter(self.split, "collapsed", GObject.Value(bool, True))
        breakpoint.add_setter(self.details_revealer, "visible", GObject.Value(bool, False))
        self.add_breakpoint(breakpoint)

        self.set_content(self.split)

    def _build_ops_popover(self) -> Gtk.Popover:
        listbox = Gtk.ListBox(selection_mode=Gtk.SelectionMode.NONE, css_classes=["boxed-list"])

        def create_row(operation: Operation) -> Gtk.Widget:
            box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6,
                          margin_top=10, margin_bottom=10, margin_start=12, margin_end=12)
            top = Gtk.Box(spacing=8)
            title = Gtk.Label(xalign=0, hexpand=True, css_classes=["heading"])
            operation.bind_property("title", title, "label", GObject.BindingFlags.SYNC_CREATE)
            cancel = Gtk.Button(icon_name="process-stop-symbolic", css_classes=["flat", "circular"],
                                tooltip_text=_("Cancel"))
            cancel.connect("clicked", lambda *_: operation.cancel())
            operation.bind_property("done", cancel, "sensitive",
                                    GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.INVERT_BOOLEAN)
            top.append(title)
            top.append(cancel)
            progress = Gtk.ProgressBar()
            operation.bind_property("fraction", progress, "fraction", GObject.BindingFlags.SYNC_CREATE)
            status = Gtk.Label(xalign=0, css_classes=["dim-label", "caption"], ellipsize=3)
            operation.bind_property("status", status, "label", GObject.BindingFlags.SYNC_CREATE)
            box.append(top)
            box.append(progress)
            box.append(status)
            return box

        listbox.bind_model(self.operations.store, create_row)
        return Gtk.Popover(child=Gtk.ScrolledWindow(child=listbox, propagate_natural_height=True,
                                                    max_content_height=400, min_content_width=320))

    def _sync_ops_button(self) -> None:
        self.ops_button.set_visible(self.operations.store.get_n_items() > 0)

    # ================================================================
    # Вкладки
    # ================================================================

    @property
    def view(self) -> FolderView | None:
        page = self.tab_view.get_selected_page()
        return page.get_child() if page else None

    def open_tab(self, location: Gio.File, select: bool = True) -> FolderView:
        view = FolderView(self, location)
        view.connect("location-changed", self._on_view_location_changed)
        view.connect("selection-changed", lambda v: self._sync_selection(v))
        view.connect("contents-changed", lambda v: self._queue_details_update(v))
        view.connect("open-files", lambda _v, files, new_tab: self.open_files(files, new_tab))
        view.connect("context-menu", self._on_context_menu)
        view.connect("drop-files", lambda _v, files, dest, copy: self.transfer(files, dest, copy))
        page = self.tab_view.append(view)
        self._update_page(page)
        if select:
            self.tab_view.set_selected_page(page)
            GLib.idle_add(lambda: view.focus_view() and False)
        return view

    def _update_page(self, page: Adw.TabPage) -> None:
        view = page.get_child()
        location = view.location
        page.set_title(self._location_title(location))
        page.set_tooltip(display_path(location))
        page.set_icon(Gio.ThemedIcon.new(self._location_icon(location)))

    def _location_title(self, location: Gio.File) -> str:
        scheme = location.get_uri_scheme()
        if scheme == "trash":
            return _("Trash")
        if scheme == "recent":
            return _("Recent")
        path = location.get_path()
        if path == GLib.get_home_dir():
            return _("Home")
        if path == "/":
            return _("File System")
        try:
            info = location.query_info("standard::display-name", Gio.FileQueryInfoFlags.NONE, None)
            return info.get_display_name()
        except GLib.Error:
            return location.get_basename() or location.get_uri()

    @staticmethod
    def _location_icon(location: Gio.File) -> str:
        scheme = location.get_uri_scheme()
        if scheme == "trash":
            return "user-trash-symbolic"
        if scheme == "recent":
            return "document-open-recent-symbolic"
        if location.get_path() == GLib.get_home_dir():
            return "user-home-symbolic"
        return "folder-symbolic"

    def _on_view_location_changed(self, view: FolderView) -> None:
        page = self.tab_view.get_page(view)
        self._update_page(page)
        if view is self.view:
            self._sync_header()

    def _on_tab_switched(self) -> None:
        view = self.view
        if view is None:
            return
        self.search_entry.set_text("")
        self.search_bar.set_search_mode(view.search.active)
        self._sync_header()

    def _on_page_detached(self) -> None:
        if self.tab_view.get_n_pages() == 0:
            self.close()

    def _on_create_window(self, _tab_view) -> Adw.TabView:
        window = Window(self.app, Gio.File.new_for_path(GLib.get_home_dir()))
        # Новое окно создаётся с домашней вкладкой — убираем её, туда
        # переедет перетащенная.
        first = window.tab_view.get_nth_page(0)
        window.present()
        GLib.idle_add(lambda: window.tab_view.close_page(first) and False)
        return window.tab_view

    # ================================================================
    # Синхронизация заголовка и панелей
    # ================================================================

    def _sync_header(self) -> None:
        view = self.view
        if view is None:
            return
        location = view.location
        self.pathbar.set_location(location, self._location_title(location))
        self.sidebar.highlight(location.get_uri())
        self.set_title(self._location_title(location))
        self.lookup_action("back").set_enabled(bool(view.back_stack))
        self.lookup_action("forward").set_enabled(bool(view.forward_stack))
        self.lookup_action("up").set_enabled(location.get_parent() is not None)
        self.trash_banner.set_revealed(view.is_trash)
        self._sync_selection(view)

    def _sync_selection(self, view: FolderView) -> None:
        if view is not self.view:
            return
        infos = view.selected_infos()
        has = bool(infos)
        in_trash = view.is_trash
        for name in ("open", "copy", "copy-path"):
            self.lookup_action(name).set_enabled(has)
        for name in ("cut", "trash", "rename"):
            self.lookup_action(name).set_enabled(has and not in_trash and not view.is_recent)
        self.lookup_action("rename").set_enabled(len(infos) == 1 and not in_trash and not view.is_recent)
        self.lookup_action("restore").set_enabled(has and in_trash)
        self.lookup_action("delete").set_enabled(has and not view.is_recent)
        self.lookup_action("open-with").set_enabled(len(infos) == 1 and not is_dir(infos[0]))
        if self.details_revealer.get_reveal_child():
            self._update_details()

    def _queue_details_update(self, view: FolderView) -> None:
        # Пока папка грузится, состав меняется десятки раз — обновляем
        # панель сведений не чаще раза в 200 мс.
        if view is not self.view or not self.details_revealer.get_reveal_child():
            return
        if getattr(self, "_details_timeout", 0):
            return

        def update():
            self._details_timeout = 0
            self._update_details()
            return GLib.SOURCE_REMOVE

        self._details_timeout = GLib.timeout_add(200, update)

    def _update_details(self) -> None:
        view = self.view
        if view is None:
            return
        folder_info = None
        try:
            folder_info = view.location.query_info("standard::*,time::*,unix::mode", Gio.FileQueryInfoFlags.NONE, None)
        except GLib.Error:
            pass
        self.details.show_for(folder_info, view.location, view.selected_infos(), view.sort_model.get_n_items())

    # ================================================================
    # Навигация и открытие
    # ================================================================

    def open_location(self, location: Gio.File, new_tab: bool = False) -> None:
        if new_tab or self.view is None:
            self.open_tab(location)
        else:
            self.search_bar.set_search_mode(False)
            self.view.load(location)
            self.view.focus_view()

    def open_files(self, files: list[Gio.File], new_tab: bool = False) -> None:
        folders, documents = [], []
        for file in files:
            target = self._resolve(file)
            kind = target.query_file_type(Gio.FileQueryInfoFlags.NONE, None)
            if kind in (Gio.FileType.DIRECTORY, Gio.FileType.MOUNTABLE):
                folders.append(target)
            else:
                documents.append(target)

        if self.view and self.view.is_trash and documents:
            self.show_toast(_("Restore the file from the trash to open it"))
            return

        for index, folder in enumerate(folders):
            self.open_location(folder, new_tab=new_tab or index > 0)
        for document in documents:
            self._launch(document)

    @staticmethod
    def _resolve(file: Gio.File) -> Gio.File:
        """recent:/// и прочие виртуальные адреса указывают на настоящий файл."""
        try:
            info = file.query_info("standard::target-uri", Gio.FileQueryInfoFlags.NONE, None)
            target = info.get_attribute_string("standard::target-uri")
            if target:
                return Gio.File.new_for_uri(target)
        except GLib.Error:
            pass
        return file

    def _launch(self, file: Gio.File, ask: bool = False) -> None:
        launcher = Gtk.FileLauncher(file=file, always_ask=ask)

        def done(launcher, result):
            try:
                launcher.launch_finish(result)
                Gtk.RecentManager.get_default().add_item(file.get_uri())
            except GLib.Error as error:
                if not error.matches(Gtk.dialog_error_quark(), Gtk.DialogError.DISMISSED):
                    self.show_toast(_("Could not open “%s”: %s") % (file.get_basename(), error.message))

        launcher.launch(self, None, done)

    def _begin_search(self, text: str) -> None:
        self.search_bar.set_search_mode(True)
        self.search_entry.set_text(text)
        self.search_entry.set_position(-1)

    def _on_search_changed(self, entry: Gtk.SearchEntry) -> None:
        if self.view is not None and self.search_bar.get_search_mode():
            self.view.start_search(entry.get_text())

    def _on_search_mode_changed(self, bar, _pspec) -> None:
        if not bar.get_search_mode() and self.view is not None:
            self.search_entry.set_text("")
            self.view.stop_search()
            self.view.focus_view()

    # ================================================================
    # Контекстные меню
    # ================================================================

    def _on_context_menu(self, view: FolderView, x: float, y: float, on_item: bool) -> None:
        menu = self._item_menu(view) if on_item else self._background_menu(view)
        popover = Gtk.PopoverMenu.new_from_model(menu)
        popover.set_parent(view)
        popover.set_has_arrow(False)
        popover.set_halign(Gtk.Align.START)
        rect = Gdk.Rectangle()
        rect.x, rect.y, rect.width, rect.height = int(x), int(y), 1, 1
        popover.set_pointing_to(rect)
        popover.connect("closed", lambda p: GLib.idle_add(p.unparent))
        popover.popup()

    def _item_menu(self, view: FolderView) -> Gio.Menu:
        infos = view.selected_infos()
        single_dir = len(infos) == 1 and is_dir(infos[0])
        menu = Gio.Menu()

        section = Gio.Menu()
        section.append(_("Open"), "win.open")
        if single_dir:
            section.append(_("Open in New Tab"), "win.open-new-tab")
            section.append(_("Open in Terminal"), "win.open-terminal-selected")
        elif len(infos) == 1:
            section.append(_("Open With…"), "win.open-with")
        menu.append_section(None, section)

        if view.is_trash:
            section = Gio.Menu()
            section.append(_("Restore From Trash"), "win.restore")
            section.append(_("Delete Permanently…"), "win.delete")
            menu.append_section(None, section)
        else:
            section = Gio.Menu()
            section.append(_("Cut"), "win.cut")
            section.append(_("Copy"), "win.copy")
            if single_dir:
                section.append(_("Paste Into Folder"), "win.paste-into")
            menu.append_section(None, section)
            section = Gio.Menu()
            section.append(_("Rename…"), "win.rename")
            section.append(_("Move to Trash"), "win.trash")
            menu.append_section(None, section)

        section = Gio.Menu()
        section.append(_("Copy Path"), "win.copy-path")
        if single_dir:
            section.append(_("Add to Bookmarks"), "win.bookmark-selected")
        section.append(_("Show Details"), "win.details")
        menu.append_section(None, section)
        return menu

    def _background_menu(self, view: FolderView) -> Gio.Menu:
        menu = Gio.Menu()
        if view.is_trash:
            menu.append(_("Empty Trash…"), "win.empty-trash")
            return menu
        section = Gio.Menu()
        section.append(_("New Folder…"), "win.new-folder")
        section.append(_("Paste"), "win.paste")
        section.append(_("Select All"), "win.select-all")
        menu.append_section(None, section)
        section = Gio.Menu()
        section.append(_("Open in Terminal"), "win.open-terminal")
        section.append(_("Add to Bookmarks"), "win.bookmark")
        section.append(_("Show Hidden Files"), "win.show-hidden")
        menu.append_section(None, section)
        return menu

    # ================================================================
    # Действия
    # ================================================================

    def _install_actions(self) -> None:
        def add(name, callback, accels=(), parameter=None):
            action = Gio.SimpleAction.new(name, GLib.VariantType.new(parameter) if parameter else None)
            action.connect("activate", lambda _a, p: callback(p) if parameter else callback())
            self.add_action(action)
            if accels:
                self.app.set_accels_for_action(f"win.{name}", list(accels))

        def add_toggle(name, key, accels=()):
            action = Gio.SimpleAction.new_stateful(name, None, GLib.Variant.new_boolean(self.prefs[key]))

            def toggled(action, _param):
                value = not action.get_state().get_boolean()
                action.set_state(GLib.Variant.new_boolean(value))
                self.prefs[key] = value

            action.connect("activate", toggled)
            self.add_action(action)
            if accels:
                self.app.set_accels_for_action(f"win.{name}", list(accels))
            return action

        add("back", lambda: self.view.go_back(), ("<Alt>Left", "Back"))
        add("forward", lambda: self.view.go_forward(), ("<Alt>Right", "Forward"))
        add("up", lambda: self.view.go_up(), ("<Alt>Up",))
        add("home", lambda: self.open_location(Gio.File.new_for_path(GLib.get_home_dir())), ("<Alt>Home",))
        add("reload", lambda: self.view.reload(), ("<Control>r", "F5"))
        add("location", lambda: self.pathbar.show_entry(), ("<Control>l",))
        add("search", lambda: self.search_bar.set_search_mode(True), ("<Control>f",))
        add("sidebar", lambda: self.split.set_show_sidebar(not self.split.get_show_sidebar()), ("F9",))

        add("new-window", lambda: self.app.new_window(self.view.location if self.view else None), ("<Control>n",))
        add("new-tab", lambda: self.open_tab(self.view.location if self.view else
                                             Gio.File.new_for_path(GLib.get_home_dir())), ("<Control>t",))
        add("close-tab", self._close_tab, ("<Control>w",))
        add("next-tab", lambda: self.tab_view.select_next_page(), ("<Control>Page_Down",))
        add("previous-tab", lambda: self.tab_view.select_previous_page(), ("<Control>Page_Up",))

        add("open", lambda: self.open_files(self.view.selected_files()), ("<Control>o",))
        add("open-new-tab", lambda: self.open_files(self.view.selected_files(), new_tab=True), ("<Control>Return",))
        add("open-with", lambda: self._launch(self._resolve(self.view.selected_files()[0]), ask=True))
        add("open-terminal", lambda: self._open_terminal(self.view.location))
        add("open-terminal-selected", lambda: self._open_terminal(self.view.selected_files()[0]))

        add("new-folder", self._new_folder, ("<Control><Shift>n",))
        add("cut", lambda: self._set_clipboard(cut=True), ("<Control>x",))
        add("copy", lambda: self._set_clipboard(cut=False), ("<Control>c",))
        add("paste", lambda: self._paste(self.view.location), ("<Control>v",))
        add("paste-into", lambda: self._paste(self.view.selected_files()[0]))
        add("rename", self._rename, ("F2",))
        add("trash", self._trash, ("Delete", "KP_Delete"))
        add("delete", self._delete, ("<Shift>Delete",))
        add("restore", self._restore)
        add("empty-trash", self._empty_trash)
        add("select-all", lambda: self.view.select_all(), ("<Control>a",))
        add("copy-path", self._copy_path, ("<Control><Shift>c",))
        add("bookmark", lambda: self._bookmark(self.view.location), ("<Control>d",))
        add("bookmark-selected", lambda: self._bookmark(self.view.selected_files()[0]))

        add("zoom-in", lambda: self.prefs.zoom(+1), ("<Control>plus", "<Control>equal", "<Control>KP_Add"))
        add("zoom-out", lambda: self.prefs.zoom(-1), ("<Control>minus", "<Control>KP_Subtract"))
        add("zoom-reset", self._zoom_reset, ("<Control>0",))

        add_toggle("show-hidden", "show-hidden", ("<Control>h",))
        add_toggle("folders-first", "folders-first")
        add_toggle("sort-reversed", "sort-reversed")
        details = add_toggle("details", "show-details", ("<Control>i", "<Alt>Return"))
        self.prefs.connect("changed", self._on_prefs_changed)
        self._details_action = details

        sort = Gio.SimpleAction.new_stateful("sort", GLib.VariantType.new("s"),
                                             GLib.Variant.new_string(self.prefs["sort-key"]))

        def on_sort(action, value):
            action.set_state(value)
            self.prefs["sort-key"] = value.get_string()

        sort.connect("activate", on_sort)
        self.add_action(sort)

        add("grid-view", lambda: self.view_toggle.set_active_name("grid"), ("<Control>1",))
        add("list-view", lambda: self.view_toggle.set_active_name("list"), ("<Control>2",))
        add("about", self._about, ("F1",))
        add("shortcuts", self._shortcuts, ("<Control>question",))

    def _on_prefs_changed(self, _prefs, key: str) -> None:
        if key == "show-details":
            revealed = self.prefs["show-details"]
            self.details_revealer.set_reveal_child(revealed)
            if revealed:
                self._update_details()
        action = self.lookup_action({"show-details": "details"}.get(key, key))
        if action is not None and action.get_state() is not None and isinstance(self.prefs[key], bool):
            action.set_state(GLib.Variant.new_boolean(self.prefs[key]))

    def _set_view_mode(self, mode: str | None) -> None:
        if mode:
            self.prefs["view-mode"] = mode

    def _zoom_reset(self) -> None:
        key = "grid-zoom" if self.prefs["view-mode"] == "grid" else "list-zoom"
        self.prefs[key] = 1

    def _close_tab(self) -> None:
        page = self.tab_view.get_selected_page()
        if page is not None:
            self.tab_view.close_page(page)

    # ---------- буфер обмена ----------

    def _set_clipboard(self, cut: bool) -> None:
        files = self.view.selected_files()
        if not files:
            return
        self.app.clipboard_files = files
        self.app.clipboard_cut = cut
        uris = "\n".join(f.get_uri() for f in files)
        gnome = ("cut\n" if cut else "copy\n") + uris
        provider = Gdk.ContentProvider.new_union([
            Gdk.ContentProvider.new_for_value(Gdk.FileList.new_from_array(files)),
            Gdk.ContentProvider.new_for_bytes("x-special/gnome-copied-files",
                                              GLib.Bytes.new(gnome.encode())),
            Gdk.ContentProvider.new_for_bytes("text/plain;charset=utf-8",
                                              GLib.Bytes.new("\n".join(display_path(f) for f in files).encode())),
        ])
        self.get_clipboard().set_content(provider)
        for window in self.app.get_windows():
            for i in range(window.tab_view.get_n_pages()):
                folder = window.tab_view.get_nth_page(i).get_child()
                folder.cut_uris = {f.get_uri() for f in files} if cut else set()
                folder.refresh_items()
        count = len(files)
        self.show_toast(ngettext("%d item cut", "%d items cut", count) % count if cut
                        else ngettext("%d item copied", "%d items copied", count) % count)

    def _paste(self, destination: Gio.File) -> None:
        if self.app.clipboard_files:
            files, cut = self.app.clipboard_files, self.app.clipboard_cut
            if cut:
                self.app.clipboard_files = []
                for window in self.app.get_windows():
                    for i in range(window.tab_view.get_n_pages()):
                        window.tab_view.get_nth_page(i).get_child().cut_uris = set()
            self.transfer(files, destination, copy=not cut)
            return

        # Файлы, скопированные в другой программе.
        clipboard = self.get_clipboard()

        def read(clipboard, result):
            try:
                value = clipboard.read_value_finish(result)
            except GLib.Error:
                self.show_toast(_("Nothing to paste"))
                return
            files = value.get_files() if value is not None else []
            if files:
                self.transfer(list(files), destination, copy=True)

        clipboard.read_value_async(Gdk.FileList, GLib.PRIORITY_DEFAULT, None, read)

    # ---------- операции ----------

    def transfer(self, files: list[Gio.File], destination: Gio.File, copy: bool) -> None:
        kind = "copy" if copy else "move"
        operation = Operation(kind, files, destination)
        operation.undo_label = (_("Copied to “%s”") if copy else _("Moved to “%s”")) % \
            self._location_title(destination)
        self.operations.run(operation)

    def _trash(self) -> None:
        files = self.view.selected_files()
        if not files:
            return
        operation = Operation("trash", files)
        operation.original_paths = {f.get_path() for f in files if f.get_path()}
        count = len(files)
        if count == 1:
            operation.undo_label = _("“%s” moved to the trash") % files[0].get_basename()
        else:
            operation.undo_label = ngettext("%d item moved to the trash", "%d items moved to the trash",
                                            count) % count
        self.operations.run(operation)

    def _restore(self) -> None:
        files = self.view.selected_files()
        if files:
            operation = Operation("restore", files)
            operation.undo_label = ngettext("%d item restored", "%d items restored", len(files)) % len(files)
            self.operations.run(operation)

    def _delete(self) -> None:
        files = self.view.selected_files()
        if not files:
            return
        count = len(files)
        heading = (_("Permanently delete “%s”?") % files[0].get_basename() if count == 1 else
                   ngettext("Permanently delete %d item?", "Permanently delete %d items?", count) % count)
        self._confirm(heading, _("Deleted items cannot be restored."), _("Delete"),
                      lambda: self.operations.run(Operation("delete", files)))

    def _empty_trash(self) -> None:
        def run():
            trash = Gio.File.new_for_uri("trash:///")
            try:
                enumerator = trash.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, None)
                files = [enumerator.get_child(info) for info in enumerator]
            except GLib.Error as error:
                self.show_toast(error.message)
                return
            if files:
                self.operations.run(Operation("delete", files))

        self._confirm(_("Empty all items from the trash?"), _("All items in the trash will be permanently deleted."),
                      _("Empty Trash"), run)

    def _on_operation_finished(self, _manager, operation: Operation) -> None:
        if operation.error:
            self.show_toast(operation.error)
            return
        self.sidebar._update_trash_icon()
        label = getattr(operation, "undo_label", None)
        if not label or self.get_root() is None or not self.is_active():
            return
        toast = Adw.Toast(title=label, timeout=6)
        if operation.kind in ("trash", "move", "copy", "restore") and operation.results is not None:
            toast.set_button_label(_("Undo"))
            toast.connect("button-clicked", lambda *_: self._undo(operation))
        self.toasts.add_toast(toast)

    def _undo(self, operation: Operation) -> None:
        if operation.kind == "trash":
            found = find_in_trash(operation.original_paths, operation.started_at)
            if found:
                self.operations.run(Operation("restore", found))
        elif operation.kind == "restore":
            self.operations.run(Operation("trash", [target for _src, target in operation.results if target]))
        elif operation.kind == "copy":
            self.operations.run(Operation("trash", [target for _src, target in operation.results if target]))
        elif operation.kind == "move":
            by_parent: dict[str, list[Gio.File]] = {}
            parents: dict[str, Gio.File] = {}
            for source, target in operation.results:
                parent = source.get_parent()
                by_parent.setdefault(parent.get_uri(), []).append(target)
                parents[parent.get_uri()] = parent
            for uri, targets in by_parent.items():
                self.operations.run(Operation("move", targets, parents[uri]))

    # ---------- диалоги ----------

    def _confirm(self, heading: str, body: str, action_label: str, callback) -> None:
        dialog = Adw.AlertDialog(heading=heading, body=body)
        dialog.add_response("cancel", _("Cancel"))
        dialog.add_response("ok", action_label)
        dialog.set_response_appearance("ok", Adw.ResponseAppearance.DESTRUCTIVE)
        dialog.set_default_response("cancel")
        dialog.connect("response", lambda _d, response: callback() if response == "ok" else None)
        dialog.present(self)

    def _ask_name(self, heading: str, initial: str, action_label: str, callback, select_stem: bool) -> None:
        dialog = Adw.AlertDialog(heading=heading)
        entry = Gtk.Entry(text=initial, activates_default=True)
        error_label = Gtk.Label(css_classes=["error", "caption"], xalign=0, visible=False, margin_top=6)
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        box.append(entry)
        box.append(error_label)
        dialog.set_extra_child(box)
        dialog.add_response("cancel", _("Cancel"))
        dialog.add_response("ok", action_label)
        dialog.set_response_appearance("ok", Adw.ResponseAppearance.SUGGESTED)
        dialog.set_default_response("ok")
        dialog.set_close_response("cancel")

        def validate(*_args):
            error = validate_filename(entry.get_text())
            error_label.set_text(error or "")
            error_label.set_visible(bool(error) and bool(entry.get_text()))
            dialog.set_response_enabled("ok", error is None)

        entry.connect("changed", validate)
        validate()
        dialog.connect("response", lambda _d, response: callback(entry.get_text()) if response == "ok" else None)
        dialog.present(self)

        def focus():
            entry.grab_focus()
            stem, _ext = split_extension(initial)
            entry.select_region(0, len(stem) if select_stem else -1)
            return GLib.SOURCE_REMOVE

        GLib.idle_add(focus)

    def _new_folder(self) -> None:
        view = self.view
        location = view.location
        path = location.get_path() or ""

        def exists(candidate):
            return location.get_child(os.path.basename(candidate)).query_exists(None)

        initial = unique_name(path, _("Untitled Folder"), exists=exists)

        def create(name):
            folder = location.get_child(name)
            try:
                folder.make_directory(None)
            except GLib.Error as error:
                self.show_toast(error.message)
                return
            view._select_after_load = folder.get_uri()
            GLib.timeout_add(250, lambda: view.select_uri(folder.get_uri()) and False)

        self._ask_name(_("New Folder"), initial, _("Create"), create, select_stem=False)

    def _rename(self) -> None:
        infos = self.view.selected_infos()
        if len(infos) != 1:
            return
        info = infos[0]
        file = file_of(info)
        old_name = info.get_display_name()
        view = self.view

        def rename(new_name):
            if new_name == old_name:
                return
            try:
                renamed = file.set_display_name(new_name, None)
            except GLib.Error as error:
                self.show_toast(error.message)
                return
            GLib.timeout_add(250, lambda: view.select_uri(renamed.get_uri()) and False)
            toast = Adw.Toast(title=_("Renamed to “%s”") % new_name, button_label=_("Undo"), timeout=6)

            def undo(*_args):
                try:
                    renamed.set_display_name(old_name, None)
                except GLib.Error as error:
                    self.show_toast(error.message)

            toast.connect("button-clicked", undo)
            self.toasts.add_toast(toast)

        heading = _("Rename Folder") if is_dir(info) else _("Rename File")
        self._ask_name(heading, old_name, _("Rename"), rename, select_stem=not is_dir(info))

    def _copy_path(self) -> None:
        files = self.view.selected_files() or [self.view.location]
        text = "\n".join(f.get_path() or f.get_uri() for f in files)
        self.get_clipboard().set(text)
        self.show_toast(_("Path copied"))

    def _bookmark(self, file: Gio.File) -> None:
        if add_bookmark(file):
            self.show_toast(_("“%s” added to bookmarks") % self._location_title(file))
        else:
            self.show_toast(_("Already in bookmarks"))

    def _open_terminal(self, folder: Gio.File) -> None:
        path = folder.get_path()
        if not path:
            self.show_toast(_("Only local folders can be opened in a terminal"))
            return
        command = terminal_command(path)
        if command is None:
            self.show_toast(_("No terminal found"))
            return
        try:
            GLib.spawn_async(command, working_directory=path, flags=GLib.SpawnFlags.SEARCH_PATH)
        except GLib.Error as error:
            self.show_toast(error.message)

    def eject(self, row) -> None:
        operation = Gtk.MountOperation.new(self)

        def done(obj, result):
            try:
                if row.mount is not None and row.mount.can_eject():
                    obj.eject_with_operation_finish(result)
                elif row.mount is not None:
                    obj.unmount_with_operation_finish(result)
                else:
                    obj.eject_with_operation_finish(result)
            except GLib.Error as error:
                self.show_toast(error.message)

        if row.mount is not None and row.mount.can_eject():
            row.mount.eject_with_operation(Gio.MountUnmountFlags.NONE, operation, None, done)
        elif row.mount is not None:
            row.mount.unmount_with_operation(Gio.MountUnmountFlags.NONE, operation, None, done)
        elif row.volume is not None:
            row.volume.eject_with_operation(Gio.MountUnmountFlags.NONE, operation, None, done)

    def show_toast(self, text: str) -> None:
        self.toasts.add_toast(Adw.Toast(title=GLib.markup_escape_text(text), timeout=4))

    def _about(self) -> None:
        about = Adw.AboutDialog(
            application_name=_("Files"),
            application_icon="dev.hypede.Files",
            developer_name="HypeDE",
            version=self.app.version,
            website="https://hypede.github.io",
            license_type=Gtk.License.GPL_3_0,
            comments=_("File manager of the HypeDE desktop: the layout of GNOME Files with tabs and "
                       "a details pane inspired by COSMIC Files."),
        )
        about.present(self)

    def _shortcuts(self) -> None:
        rows = (
            (_("Navigation"), (("<Alt>Left", _("Back")), ("<Alt>Right", _("Forward")), ("<Alt>Up", _("Parent Folder")),
                               ("<Control>l", _("Enter Location")), ("<Control>f", _("Search")),
                               ("F9", _("Toggle Sidebar")))),
            (_("Tabs"), (("<Control>t", _("New Tab")), ("<Control>w", _("Close Tab")),
                         ("<Control>Page_Down", _("Next Tab")))),
            (_("Files"), (("<Control><Shift>n", _("New Folder")), ("F2", _("Rename")),
                          ("Delete", _("Move to Trash")), ("<Shift>Delete", _("Delete Permanently")),
                          ("<Control>c", _("Copy")), ("<Control>x", _("Cut")), ("<Control>v", _("Paste")),
                          ("<Control>a", _("Select All")))),
            (_("View"), (("<Control>1", _("Grid View")), ("<Control>2", _("List View")),
                         ("<Control>plus", _("Zoom In")), ("<Control>minus", _("Zoom Out")),
                         ("<Control>h", _("Show Hidden Files")), ("<Control>i", _("Show Details Pane")))),
        )
        dialog = Adw.ShortcutsDialog()
        for title, items in rows:
            section = Adw.ShortcutsSection(title=title)
            for accel, label in items:
                section.add(Adw.ShortcutsItem(title=label, accelerator=accel))
            dialog.add(section)
        dialog.present(self)

    def _on_close_request(self, *_args) -> bool:
        if not self.is_maximized():
            width, height = self.get_default_size()
            self.prefs["window-width"] = width
            self.prefs["window-height"] = height
        self.prefs["window-maximized"] = self.is_maximized()
        return False
