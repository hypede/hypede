"""Содержимое одной вкладки: папка в виде сетки или списка.

Модель собрана из готовых кирпичей GTK: Gtk.DirectoryList читает каталог
асинхронно и следит за изменениями, дальше фильтр скрытых файлов,
сортировка «папки сначала» и множественное выделение. Сетка — Gtk.GridView
(с выделением рамкой), список — Gtk.ColumnView. Оба вида работают на одной
модели, поэтому переключение мгновенное и выделение сохраняется.
"""

from __future__ import annotations

import os

from gi.repository import Adw, Gdk, Gio, GLib, GObject, Graphene, Gtk, Pango

from . import thumbnails
from .search import Search
from .util import _, format_size

ATTRIBUTES = ",".join((
    "standard::name", "standard::display-name", "standard::type", "standard::size",
    "standard::icon", "standard::symbolic-icon", "standard::content-type",
    "standard::is-hidden", "standard::is-backup", "standard::is-symlink",
    "standard::target-uri", "time::modified", "time::created", "access::can-write",
    "access::can-trash", "access::can-delete", "access::can-rename",
    "thumbnail::path", "thumbnail::failed", "trash::orig-path", "trash::deletion-date",
    "unix::mode", "owner::user",
))


def file_of(info: Gio.FileInfo) -> Gio.File:
    return info.get_attribute_object("standard::file")


def is_dir(info: Gio.FileInfo) -> bool:
    return info.get_file_type() in (Gio.FileType.DIRECTORY, Gio.FileType.MOUNTABLE)


def _collate_key(info: Gio.FileInfo) -> str:
    key = info.get_attribute_string("hypede::collate")
    if key is None:
        key = GLib.utf8_collate_key_for_filename(info.get_display_name(), -1)
        info.set_attribute_string("hypede::collate", key)
    return key


def _cmp(a, b) -> int:
    return (a > b) - (a < b)


def format_date(date: GLib.DateTime | None) -> str:
    if date is None:
        return "—"
    local = date.to_local()
    now = GLib.DateTime.new_now_local()
    if local.get_year() == now.get_year() and local.get_day_of_year() == now.get_day_of_year():
        return local.format(_("Today, %H:%M"))
    return local.format(_("%-d %b %Y, %H:%M"))


class FolderView(Gtk.Box):
    """Вкладка: история, модель папки, два вида и пустые состояния."""

    __gtype_name__ = "HypeFilesFolderView"
    __gsignals__ = {
        "location-changed": (GObject.SignalFlags.RUN_LAST, None, ()),
        "selection-changed": (GObject.SignalFlags.RUN_LAST, None, ()),
        "contents-changed": (GObject.SignalFlags.RUN_LAST, None, ()),
        "open-files": (GObject.SignalFlags.RUN_LAST, None, (object, bool)),
        "context-menu": (GObject.SignalFlags.RUN_LAST, None, (float, float, bool)),
        "drop-files": (GObject.SignalFlags.RUN_LAST, None, (object, object, bool)),
    }

    def __init__(self, window, location: Gio.File):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, hexpand=True, vexpand=True)
        self.window = window
        self.prefs = window.prefs
        self.location: Gio.File | None = None
        self.back_stack: list[Gio.File] = []
        self.forward_stack: list[Gio.File] = []
        self.cut_uris: set[str] = set()
        self._select_after_load: str | None = None
        self.search = Search(ATTRIBUTES)
        self.search.connect("notify::running", lambda *_: self._update_status())

        # ----- модель -----
        self.dirlist = Gtk.DirectoryList(attributes=ATTRIBUTES, monitored=True)
        self.dirlist.connect("notify::loading", self._on_loading_changed)
        self.dirlist.connect("notify::error", lambda *_: self._update_status())
        self.filter = Gtk.CustomFilter.new(self._filter_func)
        self.filter_model = Gtk.FilterListModel(model=self.dirlist, filter=self.filter)
        self.sorter = Gtk.CustomSorter.new(self._compare)
        self.sort_model = Gtk.SortListModel(model=self.filter_model, sorter=self.sorter)
        self.selection = Gtk.MultiSelection(model=self.sort_model)
        self.selection.connect("selection-changed", lambda *_: self._on_selection_changed())
        self.sort_model.connect("items-changed", lambda *_: self._on_items_changed())

        # ----- виды -----
        self.grid = Gtk.GridView(
            model=self.selection, factory=self._grid_factory(), max_columns=64,
            enable_rubberband=True, css_classes=["hypede-grid"],
        )
        self.grid.connect("activate", self._on_activate)

        self.list = Gtk.ColumnView(
            model=self.selection, enable_rubberband=True, show_row_separators=False,
            css_classes=["hypede-list", "data-table"], reorderable=False,
        )
        self.list.connect("activate", self._on_activate)
        self._build_columns()

        self.stack = Gtk.Stack(transition_type=Gtk.StackTransitionType.CROSSFADE, transition_duration=120)
        for name, view in (("grid", self.grid), ("list", self.list)):
            scroller = Gtk.ScrolledWindow(child=view, hexpand=True, vexpand=True)
            self.stack.add_named(scroller, name)

        self.status_page = Adw.StatusPage(visible=False, vexpand=True, css_classes=["compact"])
        self.spinner = Adw.Spinner(width_request=32, height_request=32,
                                   halign=Gtk.Align.CENTER, valign=Gtk.Align.CENTER, visible=False)

        # Плашка внизу справа: «Выбрано 3 объекта (12 МБ)», как в Nautilus.
        self.floating_bar = Gtk.Label(css_classes=["hypede-floating-bar"], halign=Gtk.Align.END,
                                      valign=Gtk.Align.END, visible=False, margin_end=12, margin_bottom=12,
                                      ellipsize=Pango.EllipsizeMode.MIDDLE)

        overlay = Gtk.Overlay(child=self.stack, vexpand=True)
        overlay.add_overlay(self.status_page)
        overlay.add_overlay(self.spinner)
        overlay.add_overlay(self.floating_bar)
        self.append(overlay)

        # Правый клик и перетаскивание на пустое место — действия с папкой.
        background_click = Gtk.GestureClick(button=Gdk.BUTTON_SECONDARY)
        background_click.connect("pressed", self._on_background_secondary)
        self.stack.add_controller(background_click)
        long_press = Gtk.GestureLongPress(touch_only=True)
        long_press.connect("pressed", lambda _g, x, y: self._on_background_secondary(None, 1, x, y))
        self.stack.add_controller(long_press)

        drop = Gtk.DropTarget.new(Gdk.FileList, Gdk.DragAction.COPY | Gdk.DragAction.MOVE)
        drop.connect("drop", self._on_drop, None)
        self.stack.add_controller(drop)

        self.prefs.connect("changed", self._on_prefs_changed)
        self._apply_view_mode()
        self.load(location, record_history=False)

    # ================= навигация =================

    def load(self, location: Gio.File, record_history: bool = True, select_uri: str | None = None) -> None:
        if self.location is not None and self.location.equal(location) and not self.search.active:
            return
        if record_history and self.location is not None:
            self.back_stack.append(self.location)
            self.forward_stack.clear()
        self.location = location
        self.search.stop()
        self.filter_model.set_model(self.dirlist)
        self._select_after_load = select_uri
        self.dirlist.set_file(location)
        self.selection.unselect_all()
        self._scroll_to_top()
        self._update_status()
        self.emit("location-changed")

    def go_back(self) -> None:
        if self.back_stack:
            target = self.back_stack.pop()
            self.forward_stack.append(self.location)
            self.load(target, record_history=False, select_uri=self.location.get_uri())

    def go_forward(self) -> None:
        if self.forward_stack:
            target = self.forward_stack.pop()
            self.back_stack.append(self.location)
            self.load(target, record_history=False)

    def go_up(self) -> None:
        parent = self.location.get_parent() if self.location else None
        if parent is not None:
            self.load(parent, select_uri=self.location.get_uri())

    def reload(self) -> None:
        self.dirlist.set_file(None)
        self.dirlist.set_file(self.location)

    @property
    def is_trash(self) -> bool:
        return self.location is not None and self.location.get_uri_scheme() == "trash"

    @property
    def is_recent(self) -> bool:
        return self.location is not None and self.location.get_uri_scheme() == "recent"

    # ================= поиск =================

    def start_search(self, query: str) -> None:
        if not query.strip():
            self.stop_search()
            return
        self.filter_model.set_model(self.search.store)
        self.search.start(self.location, query, self.prefs["show-hidden"])
        self.list_location_column.set_visible(True)
        self._update_status()

    def stop_search(self) -> None:
        if not self.search.active:
            return
        self.search.stop()
        self.filter_model.set_model(self.dirlist)
        self.list_location_column.set_visible(False)
        self._update_status()

    # ================= выделение =================

    def selected_infos(self) -> list[Gio.FileInfo]:
        bitset = self.selection.get_selection()
        result = []
        for i in range(bitset.get_size()):
            item = self.sort_model.get_item(bitset.get_nth(i))
            if item is not None:
                result.append(item)
        return result

    def selected_files(self) -> list[Gio.File]:
        return [file_of(info) for info in self.selected_infos()]

    def select_all(self) -> None:
        self.selection.select_all()

    def select_uri(self, uri: str) -> bool:
        for position in range(self.sort_model.get_n_items()):
            info = self.sort_model.get_item(position)
            if file_of(info).get_uri() == uri:
                self.selection.select_item(position, True)
                self._scroll_to(position)
                return True
        return False

    def _on_selection_changed(self) -> None:
        self._update_floating_bar()
        self.emit("selection-changed")

    # ================= активация =================

    def _on_activate(self, _view, position: int) -> None:
        info = self.sort_model.get_item(position)
        if info is None:
            return
        selected = self.selected_infos()
        infos = selected if info in selected else [info]
        self.emit("open-files", [file_of(i) for i in infos], False)

    # ================= фабрики элементов =================

    def _grid_factory(self) -> Gtk.SignalListItemFactory:
        factory = Gtk.SignalListItemFactory()
        factory.connect("setup", self._grid_setup)
        factory.connect("bind", self._grid_bind)
        factory.connect("unbind", self._unbind)
        return factory

    def _grid_setup(self, _factory, list_item: Gtk.ListItem) -> None:
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6, css_classes=["hypede-grid-item"],
                      halign=Gtk.Align.CENTER, valign=Gtk.Align.START)
        image = Gtk.Image(halign=Gtk.Align.CENTER, css_classes=["hypede-item-icon"])
        label = Gtk.Label(wrap=True, wrap_mode=Pango.WrapMode.WORD_CHAR, lines=3,
                          ellipsize=Pango.EllipsizeMode.MIDDLE, justify=Gtk.Justification.CENTER,
                          max_width_chars=1, css_classes=["hypede-item-name"])
        box.append(image)
        box.append(label)
        box.image, box.label = image, label
        self._attach_item_controllers(box, list_item)
        list_item.set_child(box)

    def _grid_bind(self, _factory, list_item: Gtk.ListItem) -> None:
        box = list_item.get_child()
        info = list_item.get_item()
        size = self.prefs.icon_size
        box.label.set_text(info.get_display_name())
        box.label.set_size_request(max(size + 32, 96), -1)
        box.set_tooltip_text(info.get_display_name())
        self._set_icon(box.image, info, size)
        self._apply_dim(box, info)

    def _unbind(self, _factory, list_item: Gtk.ListItem) -> None:
        child = list_item.get_child()
        image = getattr(child, "image", None)
        if image is not None:
            image._hypede_uri = None

    def _set_icon(self, image: Gtk.Image, info: Gio.FileInfo, size: int) -> None:
        image.set_pixel_size(size)
        image.remove_css_class("thumbnail")
        file = file_of(info)
        uri = file.get_uri()
        image._hypede_uri = uri
        icon = info.get_icon() if size >= 32 else (info.get_symbolic_icon() or info.get_icon())
        image.set_from_gicon(icon)
        if size < 48 or not thumbnails.can_thumbnail(info):
            return

        def ready(texture):
            if texture is not None and getattr(image, "_hypede_uri", None) == uri:
                image.set_from_paintable(texture)
                image.add_css_class("thumbnail")

        texture = thumbnails.request(file, info, max(size, 128) * self.get_scale_factor(), ready)
        if texture is not None:
            image.set_from_paintable(texture)
            image.add_css_class("thumbnail")

    def _apply_dim(self, widget: Gtk.Widget, info: Gio.FileInfo) -> None:
        dim = info.get_is_hidden() or info.get_is_backup() or file_of(info).get_uri() in self.cut_uris
        widget.set_opacity(0.55 if dim else 1.0)

    def _build_columns(self) -> None:
        def column(title, setup, bind, expand=False, fixed=None):
            factory = Gtk.SignalListItemFactory()
            factory.connect("setup", setup)
            factory.connect("bind", bind)
            factory.connect("unbind", self._unbind)
            col = Gtk.ColumnViewColumn(title=title, factory=factory, expand=expand, resizable=True)
            if fixed:
                col.set_fixed_width(fixed)
            self.list.append_column(col)
            return col

        def name_setup(_f, item):
            box = Gtk.Box(spacing=10, css_classes=["hypede-list-name"])
            image = Gtk.Image()
            label = Gtk.Label(xalign=0, ellipsize=Pango.EllipsizeMode.MIDDLE, hexpand=True)
            box.append(image)
            box.append(label)
            box.image, box.label = image, label
            self._attach_item_controllers(box, item)
            item.set_child(box)

        def name_bind(_f, item):
            box, info = item.get_child(), item.get_item()
            box.label.set_text(info.get_display_name())
            self._set_icon(box.image, info, self.prefs.icon_size)
            self._apply_dim(box, info)

        def text_setup(_f, item):
            label = Gtk.Label(xalign=0, css_classes=["dim-label", "numeric"],
                              ellipsize=Pango.EllipsizeMode.END)
            item.set_child(label)

        def size_bind(_f, item):
            info = item.get_item()
            item.get_child().set_text("—" if is_dir(info) else format_size(info.get_size()))

        def modified_bind(_f, item):
            item.get_child().set_text(format_date(item.get_item().get_modification_date_time()))

        def type_bind(_f, item):
            content_type = item.get_item().get_content_type() or ""
            item.get_child().set_text(Gio.content_type_get_description(content_type))

        def location_bind(_f, item):
            parent = file_of(item.get_item()).get_parent()
            path = parent.get_path() if parent else None
            text = path.replace(GLib.get_home_dir(), "~", 1) if path else (parent.get_uri() if parent else "")
            item.get_child().set_text(text)

        column(_("Name"), name_setup, name_bind, expand=True)
        self.list_location_column = column(_("Location"), text_setup, location_bind, fixed=220)
        self.list_location_column.set_visible(False)
        column(_("Size"), text_setup, size_bind, fixed=110)
        column(_("Type"), text_setup, type_bind, fixed=160)
        column(_("Modified"), text_setup, modified_bind, fixed=170)

    # ================= жесты на элементах =================

    def _attach_item_controllers(self, widget: Gtk.Widget, list_item: Gtk.ListItem) -> None:
        widget.list_item = list_item

        click = Gtk.GestureClick(button=0)
        click.connect("pressed", self._on_item_pressed, widget)
        widget.add_controller(click)

        drag = Gtk.DragSource(actions=Gdk.DragAction.COPY | Gdk.DragAction.MOVE)
        drag.connect("prepare", self._on_drag_prepare, widget)
        widget.add_controller(drag)

        drop = Gtk.DropTarget.new(Gdk.FileList, Gdk.DragAction.COPY | Gdk.DragAction.MOVE)
        drop.connect("accept", self._on_item_drop_accept, widget)
        drop.connect("drop", self._on_drop, widget)
        widget.add_controller(drop)

    def _on_item_pressed(self, gesture: Gtk.GestureClick, _n, x, y, widget) -> None:
        button = gesture.get_current_button()
        position = widget.list_item.get_position()
        if position == Gtk.INVALID_LIST_POSITION:
            return
        info = self.sort_model.get_item(position)
        if button == Gdk.BUTTON_MIDDLE and is_dir(info):
            gesture.set_state(Gtk.EventSequenceState.CLAIMED)
            self.window.open_tab(file_of(info))
        elif button == Gdk.BUTTON_SECONDARY:
            gesture.set_state(Gtk.EventSequenceState.CLAIMED)
            if not self.selection.is_selected(position):
                self.selection.select_item(position, True)
            ok, point = widget.compute_point(self, Graphene_point(x, y))
            self.emit("context-menu", point.x if ok else x, point.y if ok else y, True)

    def _on_background_secondary(self, gesture, _n, x, y) -> None:
        if gesture is not None:
            gesture.set_state(Gtk.EventSequenceState.CLAIMED)
        self.selection.unselect_all()
        ok, point = self.stack.compute_point(self, Graphene_point(x, y))
        self.emit("context-menu", point.x if ok else x, point.y if ok else y, False)

    def _on_drag_prepare(self, _source, _x, _y, widget):
        position = widget.list_item.get_position()
        if position == Gtk.INVALID_LIST_POSITION:
            return None
        if not self.selection.is_selected(position):
            self.selection.select_item(position, True)
        files = self.selected_files()
        if not files:
            return None
        return Gdk.ContentProvider.new_for_value(Gdk.FileList.new_from_array(files))

    def _on_item_drop_accept(self, target: Gtk.DropTarget, drop: Gdk.Drop, widget) -> bool:
        info = widget.list_item.get_item()
        return info is not None and is_dir(info) and drop.get_formats().contain_gtype(Gdk.FileList)

    def _on_drop(self, target: Gtk.DropTarget, value, _x, _y, widget) -> bool:
        files = value.get_files() if hasattr(value, "get_files") else list(value)
        if widget is not None:
            info = widget.list_item.get_item()
            if info is None or not is_dir(info):
                return False
            destination = file_of(info)
        else:
            destination = self.location
        if any(f.equal(destination) for f in files):
            return False
        state = target.get_current_event_state()
        copy = bool(state & Gdk.ModifierType.CONTROL_MASK) or target.get_current_drop().get_actions() == Gdk.DragAction.COPY
        self.emit("drop-files", files, destination, copy)
        return True

    # ================= фильтр и сортировка =================

    def _filter_func(self, info: Gio.FileInfo, *_args) -> bool:
        if self.prefs["show-hidden"]:
            return True
        return not (info.get_is_hidden() or info.get_is_backup())

    def _compare(self, a: Gio.FileInfo, b: Gio.FileInfo, *_args) -> int:
        if self.prefs["folders-first"]:
            da, db = is_dir(a), is_dir(b)
            if da != db:
                return -1 if da else 1
        key = self.prefs["sort-key"]
        result = 0
        if key == "size":
            result = _cmp(a.get_size(), b.get_size())
        elif key == "modified":
            ma, mb = a.get_modification_date_time(), b.get_modification_date_time()
            result = _cmp(ma.to_unix() if ma else 0, mb.to_unix() if mb else 0)
        elif key == "type":
            result = _cmp(a.get_content_type() or "", b.get_content_type() or "")
        if result == 0:
            result = _cmp(_collate_key(a), _collate_key(b))
        return -result if self.prefs["sort-reversed"] else result

    def resort(self) -> None:
        self.sorter.changed(Gtk.SorterChange.DIFFERENT)

    def refilter(self) -> None:
        self.filter.changed(Gtk.FilterChange.DIFFERENT)

    # ================= состояние и оформление =================

    def _on_prefs_changed(self, _prefs, key: str) -> None:
        if key in ("sort-key", "sort-reversed", "folders-first"):
            self.resort()
        elif key == "show-hidden":
            self.refilter()
        elif key in ("view-mode", "grid-zoom", "list-zoom"):
            self._apply_view_mode()

    def _apply_view_mode(self) -> None:
        mode = self.prefs["view-mode"]
        self.stack.set_visible_child_name(mode)
        # Перепривязать элементы, чтобы новые размеры значков вступили в силу.
        self.grid.set_factory(self._grid_factory())
        self.list.set_model(None)
        self.list.set_model(self.selection)
        self.grid.remove_css_class("zoom-small")
        if mode == "grid" and self.prefs.icon_size <= 48:
            self.grid.add_css_class("zoom-small")

    def refresh_items(self) -> None:
        """Перерисовать элементы (например, после «вырезать»)."""
        self._apply_view_mode()

    def _on_loading_changed(self, *_args) -> None:
        self._update_status()
        if not self.dirlist.is_loading() and self._select_after_load:
            uri, self._select_after_load = self._select_after_load, None
            GLib.idle_add(lambda: self.select_uri(uri) and False)

    def _on_items_changed(self) -> None:
        self._update_status()
        self._update_floating_bar()
        self.emit("contents-changed")

    def _update_status(self) -> None:
        loading = self.dirlist.is_loading() if not self.search.active else self.search.running
        empty = self.sort_model.get_n_items() == 0
        error = self.dirlist.get_error() if not self.search.active else None
        self.spinner.set_visible(loading and empty)

        if error is not None:
            self.status_page.set_icon_name("dialog-warning-symbolic")
            self.status_page.set_title(_("Unable to open this folder"))
            self.status_page.set_description(error.message)
            self.status_page.set_visible(True)
        elif empty and not loading:
            if self.search.active:
                self.status_page.set_icon_name("edit-find-symbolic")
                self.status_page.set_title(_("No results found"))
                self.status_page.set_description(_("Try a different search"))
            elif self.is_trash:
                self.status_page.set_icon_name("user-trash-symbolic")
                self.status_page.set_title(_("Trash is empty"))
                self.status_page.set_description(None)
            elif self.is_recent:
                self.status_page.set_icon_name("document-open-recent-symbolic")
                self.status_page.set_title(_("No recent files"))
                self.status_page.set_description(None)
            else:
                self.status_page.set_icon_name("folder-symbolic")
                self.status_page.set_title(_("Folder is empty"))
                self.status_page.set_description(None)
            self.status_page.set_visible(True)
        else:
            self.status_page.set_visible(False)

    def _update_floating_bar(self) -> None:
        infos = self.selected_infos()
        if not infos:
            self.floating_bar.set_visible(False)
            return
        if len(infos) == 1:
            info = infos[0]
            detail = "" if is_dir(info) else f" ({format_size(info.get_size())})"
            text = _("“%s” selected") % info.get_display_name() + detail
        else:
            files = [i for i in infos if not is_dir(i)]
            total = sum(i.get_size() for i in files)
            text = _("%d items selected") % len(infos)
            if files:
                text += f" ({format_size(total)})"
        self.floating_bar.set_text(text)
        self.floating_bar.set_visible(True)

    def _scroll_to_top(self) -> None:
        for name in ("grid", "list"):
            scroller = self.stack.get_child_by_name(name)
            scroller.get_vadjustment().set_value(0)

    def _scroll_to(self, position: int) -> None:
        if self.prefs["view-mode"] == "grid":
            self.grid.scroll_to(position, Gtk.ListScrollFlags.FOCUS, None)
        else:
            self.list.scroll_to(position, None, Gtk.ListScrollFlags.FOCUS, None)

    def focus_view(self) -> None:
        (self.grid if self.prefs["view-mode"] == "grid" else self.list).grab_focus()


def Graphene_point(x: float, y: float) -> Graphene.Point:
    point = Graphene.Point()
    point.x, point.y = x, y
    return point


def display_path(file: Gio.File) -> str:
    path = file.get_path()
    if path:
        home = GLib.get_home_dir()
        if path == home or path.startswith(home + os.sep):
            return "~" + path[len(home):]
        return path
    return file.get_uri()
