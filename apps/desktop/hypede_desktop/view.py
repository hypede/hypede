"""Сетка значков рабочего стола в духе KDE.

Значки стоят по сетке столбцами сверху вниз, начиная от левого верхнего
угла. Их можно перетаскивать: по рабочему столу — чтобы переставить, в окно
приложения — чтобы открыть или скопировать файл там. Файлы из других
приложений можно бросить на рабочий стол или на папку. Щелчок выделяет,
двойной щелчок открывает, рамкой выделяется несколько значков. Места значков
запоминаются в ~/.config/hypede/desktop-icons.json.
"""

from __future__ import annotations

import json
import os
from gettext import gettext as _

from gi.repository import Gdk, Gio, GLib, GObject, Graphene, Gtk

from hypede_files import thumbnails
from hypede_files.operations import Operation
from hypede_files.util import terminal_command, unique_name, validate_filename

from .items import Item, desktop_dir, list_items, trash_count

MARGIN = 12
POSITIONS = os.path.join(GLib.get_user_config_dir(), "hypede", "desktop-icons.json")


def _load_positions() -> dict:
    try:
        with open(POSITIONS, encoding="utf-8") as fh:
            data = json.load(fh)
        return {k: tuple(v) for k, v in data.get("positions", {}).items()
                if isinstance(v, list) and len(v) == 2}
    except (OSError, ValueError):
        return {}


def _save_positions(positions: dict) -> None:
    os.makedirs(os.path.dirname(POSITIONS), exist_ok=True)
    tmp = POSITIONS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"positions": {k: list(v) for k, v in positions.items()}}, fh, ensure_ascii=False)
    os.replace(tmp, POSITIONS)


def _launch(argv: list[str]) -> None:
    try:
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE)
    except GLib.Error:
        pass


class Icon(Gtk.Box):
    """Один значок: картинка и подпись в две строки."""

    def __init__(self, view: "DesktopView", item: Item, size: int):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=4, halign=Gtk.Align.CENTER,
                         valign=Gtk.Align.START)
        self.view = view
        self.item = item
        self.add_css_class("desktop-icon")
        self.add_css_class("appear")
        self.image = Gtk.Image(pixel_size=size, halign=Gtk.Align.CENTER)
        self.image.add_css_class("desktop-icon-image")
        self.append(self.image)
        self.label = Gtk.Label(label=item.label, wrap=True, wrap_mode=2, lines=2, ellipsize=3,
                               justify=Gtk.Justification.CENTER, max_width_chars=1, width_request=size + 36)
        self.label.add_css_class("desktop-icon-label")
        self.append(self.label)
        self.set_tooltip_text(item.label)
        self._size = size
        self.update_icon()

        click = Gtk.GestureClick(button=0)
        click.connect("pressed", self._on_pressed)
        click.connect("released", self._on_released)
        self.add_controller(click)

        drag = Gtk.DragSource(actions=Gdk.DragAction.COPY | Gdk.DragAction.MOVE | Gdk.DragAction.LINK)
        drag.connect("prepare", self._on_drag_prepare)
        drag.connect("drag-begin", self._on_drag_begin)
        drag.connect("drag-end", self._on_drag_end)
        self.add_controller(drag)

        # На папку и корзину можно бросать файлы.
        if item.is_dir:
            drop = Gtk.DropTarget.new(Gdk.FileList, Gdk.DragAction.COPY | Gdk.DragAction.MOVE)
            drop.connect("enter", lambda *_: (self.add_css_class("drop-target"), Gdk.DragAction.MOVE)[1])
            drop.connect("leave", lambda *_: self.remove_css_class("drop-target"))
            drop.connect("drop", self._on_drop)
            self.add_controller(drop)

    def update_icon(self) -> None:
        # Цветной значок, а не символьный: GTK иначе возьмёт «…-symbolic»
        # из темы HypeDE раньше цветного из Adwaita.
        theme = Gtk.IconTheme.get_for_display(self.get_display())
        paintable = theme.lookup_by_gicon(self.item.icon(), self._size, self.get_scale_factor(),
                                          Gtk.TextDirection.NONE, Gtk.IconLookupFlags.FORCE_REGULAR)
        self.image.set_from_paintable(paintable)
        if self.item.kind == "file" and self.item.info and thumbnails.can_thumbnail(self.item.info):
            texture = thumbnails.request(self.item.file, self.item.info, self._size * 2, self._set_texture)
            if texture:
                self._set_texture(texture)

    def _set_texture(self, texture) -> None:
        if texture:
            self.image.set_from_paintable(texture)
            self.image.add_css_class("thumbnail")

    @property
    def selected(self) -> bool:
        return self.has_css_class("selected")

    @selected.setter
    def selected(self, value: bool) -> None:
        if value:
            self.add_css_class("selected")
            self.label.set_lines(8)
        else:
            self.remove_css_class("selected")
            self.label.set_lines(2)

    def _on_pressed(self, gesture: Gtk.GestureClick, n_press: int, x: float, y: float) -> None:
        button = gesture.get_current_button()
        state = gesture.get_current_event_state()
        ctrl = bool(state & Gdk.ModifierType.CONTROL_MASK)
        shift = bool(state & Gdk.ModifierType.SHIFT_MASK)
        self.view.grab_focus()
        if button == Gdk.BUTTON_SECONDARY:
            if not self.selected:
                self.view.select([self])
            self.view.item_menu(self, x, y)
            gesture.set_state(Gtk.EventSequenceState.CLAIMED)
            return
        if button != Gdk.BUTTON_PRIMARY:
            return
        if n_press == 2:
            self.view.open_selection()
            return
        if ctrl:
            self.selected = not self.selected
        elif shift:
            self.view.select_range_to(self)
        elif not self.selected:
            self.view.select([self])
        self.view.anchor = self

    def _on_released(self, gesture, n_press, x, y) -> None:
        state = gesture.get_current_event_state()
        if (gesture.get_current_button() == Gdk.BUTTON_PRIMARY and n_press == 1
                and not state & (Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.SHIFT_MASK)):
            self.view.select([self])

    def _on_drag_prepare(self, source, x, y):
        if not self.selected:
            self.view.select([self])
        self._grab = (x, y)
        files = [icon.item.file for icon in self.view.selection()]
        uris = "".join(f.get_uri() + "\r\n" for f in files).encode()
        return Gdk.ContentProvider.new_union([
            Gdk.ContentProvider.new_for_value(Gdk.FileList.new_from_list(files)),
            Gdk.ContentProvider.new_for_bytes("text/uri-list", GLib.Bytes.new(uris)),
        ])

    def _on_drag_begin(self, source, drag) -> None:
        self.view.internal_drag = (self, self._grab)
        source.set_icon(Gtk.WidgetPaintable.new(self), int(self._grab[0]), int(self._grab[1]))
        for icon in self.view.selection():
            icon.add_css_class("dragging")

    def _on_drag_end(self, source, drag, delete) -> None:
        for icon in self.view.selection():
            icon.remove_css_class("dragging")
        GLib.idle_add(self.view.clear_internal_drag)

    def _on_drop(self, target, value, x, y) -> bool:
        self.remove_css_class("drop-target")
        files = [f for f in value.get_files() if not f.equal(self.item.file)]
        if not files:
            return False
        if self.item.kind == "trash":
            self.view.run_operation("trash", files)
        elif self.item.kind == "home" or self.item.is_dir:
            copy = self.view.ctrl_held() or not self.view.same_filesystem(files[0], self.item.file)
            self.view.run_operation("copy" if copy else "move", files, self.item.file)
        self.view.clear_internal_drag()
        return True


class DesktopView(Gtk.Widget):
    __gtype_name__ = "HypeDesktopView"

    def __init__(self, app, settings: Gio.Settings | None, show_icons: bool):
        super().__init__(focusable=True, hexpand=True, vexpand=True)
        self.app = app
        self.settings = settings
        self.show_icons = show_icons
        self.icons: dict[str, Icon] = {}
        self.positions = _load_positions()
        self.anchor: Icon | None = None
        self.internal_drag = None
        self._cut = False
        self._pending_place: dict[str, tuple[int, int]] = {}
        self._rename_after: str | None = None
        self._refresh_id = 0
        self._band = None
        self._cells: dict = {}

        self.fixed = Gtk.Fixed()
        self.fixed.set_parent(self)
        self.band_area = Gtk.DrawingArea(can_target=False)
        self.band_area.set_draw_func(self._draw_band)
        self.band_area.set_parent(self)

        click = Gtk.GestureClick(button=0)
        click.connect("pressed", self._on_background_pressed)
        self.add_controller(click)
        band = Gtk.GestureDrag()
        band.connect("drag-begin", self._on_band_begin)
        band.connect("drag-update", self._on_band_update)
        band.connect("drag-end", self._on_band_end)
        self.add_controller(band)
        drop = Gtk.DropTarget.new(Gdk.FileList, Gdk.DragAction.COPY | Gdk.DragAction.MOVE)
        drop.connect("drop", self._on_drop)
        self.add_controller(drop)
        keys = Gtk.EventControllerKey()
        keys.connect("key-pressed", self._on_key)
        self.add_controller(keys)

        self._setup_actions()
        if show_icons:
            self._monitor = desktop_dir().monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, None)
            self._monitor.connect("changed", lambda *_: self.queue_refresh())
            self._trash_monitor = Gio.File.new_for_uri("trash:///").monitor_directory(Gio.FileMonitorFlags.NONE, None)
            self._trash_monitor.connect("changed", lambda *_: self._update_trash())
            if settings:
                for key in ("desktop-icon-size", "desktop-show-home", "desktop-show-trash"):
                    settings.connect(f"changed::{key}", lambda *_: self.refresh(rebuild=True))
            self.refresh()

    def do_dispose(self):
        for child in (self.fixed, self.band_area):
            if child.get_parent():
                child.unparent()
        Gtk.Widget.do_dispose(self)

    def do_measure(self, orientation, for_size):
        for child in (self.fixed, self.band_area):
            child.measure(orientation, for_size)
        return 0, 0, -1, -1

    def do_size_allocate(self, width, height, baseline):
        for child in (self.fixed, self.band_area):
            child.allocate(width, height, baseline, None)
        # Меню — тоже дети этого виджета; GTK ждёт, что родитель сам
        # пересчитает их размер и место.
        child = self.get_first_child()
        while child:
            if isinstance(child, Gtk.Popover):
                child.present()
            child = child.get_next_sibling()
        if self.show_icons and (width, height) != getattr(self, "_size", None):
            self._size = (width, height)
            GLib.idle_add(self.layout_icons)

    # ------------------------------------------------------------------
    # Сетка

    @property
    def icon_size(self) -> int:
        return self.settings.get_int("desktop-icon-size") if self.settings else 64

    @property
    def cell(self) -> tuple[int, int]:
        size = self.icon_size
        return max(size + 40, 96), size + 62

    def grid_dims(self) -> tuple[int, int]:
        cw, ch = self.cell
        width = max(self.get_width(), cw + 2 * MARGIN)
        height = max(self.get_height(), ch + 2 * MARGIN)
        return max(1, (width - 2 * MARGIN) // cw), max(1, (height - 2 * MARGIN) // ch)

    def cell_at(self, x: float, y: float) -> tuple[int, int]:
        cw, ch = self.cell
        cols, rows = self.grid_dims()
        col = int(min(max((x - MARGIN) // cw, 0), cols - 1))
        row = int(min(max((y - MARGIN) // ch, 0), rows - 1))
        return col, row

    def queue_refresh(self) -> None:
        if self._refresh_id:
            return

        def run():
            self._refresh_id = 0
            self.refresh()
            return GLib.SOURCE_REMOVE

        self._refresh_id = GLib.timeout_add(150, run)

    def refresh(self, rebuild: bool = False) -> None:
        show_home = self.settings.get_boolean("desktop-show-home") if self.settings else True
        show_trash = self.settings.get_boolean("desktop-show-trash") if self.settings else True
        items = list_items(show_home, show_trash)
        selected = {icon.item.uri for icon in self.selection()}
        if rebuild:
            for icon in list(self.icons.values()):
                self.fixed.remove(icon)
            self.icons.clear()
        seen = set()
        for item in items:
            seen.add(item.uri)
            old = self.icons.get(item.uri)
            if old and old.item.label == item.label and not rebuild:
                old.item = item
                old.update_icon()
                continue
            if old:
                self.fixed.remove(old)
            icon = Icon(self, item, self.icon_size)
            icon.selected = item.uri in selected
            self.icons[item.uri] = icon
            self.fixed.put(icon, 0, 0)
        for uri in [u for u in self.icons if u not in seen]:
            self.fixed.remove(self.icons.pop(uri))
        self.layout_icons()
        if self._rename_after:
            icon = next((i for i in self.icons.values() if i.item.key == self._rename_after), None)
            if icon:
                self._rename_after = None
                self.select([icon])
                GLib.idle_add(lambda: self.rename(icon) and False)

    def layout_icons(self) -> bool:
        cols, rows = self.grid_dims()
        cw, ch = self.cell
        taken: dict[tuple[int, int], Icon] = {}
        placed: dict[Icon, tuple[int, int]] = {}
        icons = sorted(self.icons.values(), key=lambda i: i.item.sort_key())
        # Сначала — значки с запомненным местом (или только что брошенные).
        for icon in icons:
            pos = self._pending_place.pop(icon.item.key, None) or self.positions.get(icon.item.key)
            if pos and 0 <= pos[0] < cols and 0 <= pos[1] < rows and tuple(pos) not in taken:
                taken[tuple(pos)] = icon
                placed[icon] = tuple(pos)
        free = ((c, r) for c in range(cols) for r in range(rows))
        for icon in icons:
            if icon in placed:
                continue
            for cell in free:
                if cell not in taken:
                    taken[cell] = icon
                    placed[icon] = cell
                    break
            else:
                placed[icon] = (cols - 1, rows - 1)
        self._cells = placed
        for icon, (col, row) in placed.items():
            self.fixed.move(icon, MARGIN + col * cw + (cw - icon.label.get_size_request()[0]) // 2, MARGIN + row * ch)
        return GLib.SOURCE_REMOVE

    def remember(self, icon: Icon, cell: tuple[int, int]) -> None:
        self.positions[icon.item.key] = cell
        _save_positions(self.positions)

    def icon_cells(self) -> dict[Icon, tuple[int, int]]:
        return dict(self._cells)

    # ------------------------------------------------------------------
    # Выделение

    def selection(self) -> list[Icon]:
        return [icon for icon in self.icons.values() if icon.selected]

    def select(self, icons: list[Icon]) -> None:
        wanted = set(icons)
        for icon in self.icons.values():
            icon.selected = icon in wanted

    def select_range_to(self, target: Icon) -> None:
        order = sorted(self.icons.values(), key=lambda i: self.icon_cells().get(i, (0, 0)))
        if not self.anchor or self.anchor not in order:
            self.select([target])
            return
        a, b = order.index(self.anchor), order.index(target)
        self.select(order[min(a, b):max(a, b) + 1])

    def _icon_at(self, x: float, y: float) -> Icon | None:
        widget = self.pick(x, y, Gtk.PickFlags.DEFAULT)
        while widget and widget is not self:
            if isinstance(widget, Icon):
                return widget
            widget = widget.get_parent()
        return None

    def _on_background_pressed(self, gesture, n_press, x, y) -> None:
        if self._icon_at(x, y):
            return
        self.grab_focus()
        state = gesture.get_current_event_state()
        if not state & (Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.SHIFT_MASK):
            self.select([])
        if gesture.get_current_button() == Gdk.BUTTON_SECONDARY:
            self.background_menu(x, y)

    def _on_band_begin(self, gesture, x, y) -> None:
        if not self.show_icons or self._icon_at(x, y):
            gesture.set_state(Gtk.EventSequenceState.DENIED)
            return
        self._band = (x, y, x, y)
        self._band_base = set(self.selection())

    def _on_band_update(self, gesture, dx, dy) -> None:
        if not self._band:
            return
        x0, y0 = self._band[:2]
        self._band = (x0, y0, x0 + dx, y0 + dy)
        left, right = sorted((x0, x0 + dx))
        top, bottom = sorted((y0, y0 + dy))
        rect = Graphene.Rect().init(left, top, right - left, bottom - top)
        hit = set()
        for icon in self.icons.values():
            ok, bounds = icon.compute_bounds(self)
            if ok and rect.intersection(bounds)[0]:
                hit.add(icon)
        for icon in self.icons.values():
            icon.selected = icon in hit or icon in self._band_base
        self.band_area.queue_draw()

    def _on_band_end(self, gesture, dx, dy) -> None:
        self._band = None
        self.band_area.queue_draw()

    def _draw_band(self, area, cr, width, height) -> None:
        if not self._band:
            return
        x0, y0, x1, y1 = self._band
        accent = self.app.accent_rgb
        cr.rectangle(min(x0, x1) + 0.5, min(y0, y1) + 0.5, abs(x1 - x0), abs(y1 - y0))
        cr.set_source_rgba(*accent, 0.22)
        cr.fill_preserve()
        cr.set_source_rgba(*accent, 0.85)
        cr.set_line_width(1)
        cr.stroke()

    # ------------------------------------------------------------------
    # Перетаскивание

    def clear_internal_drag(self) -> bool:
        self.internal_drag = None
        return GLib.SOURCE_REMOVE

    def ctrl_held(self) -> bool:
        seat = self.get_display().get_default_seat()
        keyboard = seat.get_keyboard() if seat else None
        return bool(keyboard and keyboard.get_modifier_state() & Gdk.ModifierType.CONTROL_MASK)

    @staticmethod
    def same_filesystem(a: Gio.File, b: Gio.File) -> bool:
        try:
            fa = a.query_info("id::filesystem", Gio.FileQueryInfoFlags.NONE, None).get_attribute_string("id::filesystem")
            fb = b.query_info("id::filesystem", Gio.FileQueryInfoFlags.NONE, None).get_attribute_string("id::filesystem")
            return fa == fb
        except GLib.Error:
            return False

    def _on_drop(self, target, value, x, y) -> bool:
        if self.internal_drag:
            # Перестановка своих значков: вся выделенная группа сдвигается.
            leader, grab = self.internal_drag
            cells = self.icon_cells()
            start = cells.get(leader, (0, 0))
            end = self.cell_at(x - grab[0] + self.cell[0] / 2, y - grab[1] + self.cell[1] / 3)
            dc, dr = end[0] - start[0], end[1] - start[1]
            cols, rows = self.grid_dims()
            moving = self.selection()
            others = {cell for icon, cell in cells.items() if icon not in moving}
            for icon in sorted(moving, key=lambda i: cells[i]):
                col = min(max(cells[icon][0] + dc, 0), cols - 1)
                row = min(max(cells[icon][1] + dr, 0), rows - 1)
                while (col, row) in others:
                    row += 1
                    if row >= rows:
                        row, col = 0, (col + 1) % cols
                others.add((col, row))
                self.positions[icon.item.key] = (col, row)
            _save_positions(self.positions)
            self.layout_icons()
            self.clear_internal_drag()
            return True
        files = value.get_files()
        if not files:
            return False
        target_dir = desktop_dir()
        cell = self.cell_at(x, y)
        for i, f in enumerate(files):
            self._pending_place[f.get_basename()] = (cell[0], cell[1] + i)
        copy = self.ctrl_held() or not self.same_filesystem(files[0], target_dir)
        self.run_operation("copy" if copy else "move", files, target_dir)
        return True

    def run_operation(self, kind: str, files: list[Gio.File], destination: Gio.File | None = None) -> None:
        self.app.operations.run(Operation(kind, files, destination))

    # ------------------------------------------------------------------
    # Действия

    def _setup_actions(self) -> None:
        group = Gio.SimpleActionGroup()
        actions = {
            "open": lambda *_: self.open_selection(),
            "open-in-files": lambda *_: self._open_in_files(),
            "copy": lambda *_: self.copy_selection(cut=False),
            "cut": lambda *_: self.copy_selection(cut=True),
            "paste": lambda *_: self.paste(),
            "rename": lambda *_: self.selection() and self.rename(self.selection()[0]),
            "trash": lambda *_: self.trash_selection(),
            "empty-trash": lambda *_: _launch(["gio", "trash", "--empty"]),
            "allow-launch": lambda *_: self._allow_launch(),
            "new-folder": lambda *_: self.new_item(folder=True),
            "new-file": lambda *_: self.new_item(folder=False),
            "arrange": lambda *_: self.arrange(),
            "select-all": lambda *_: self.select(list(self.icons.values())),
            "open-desktop": lambda *_: _launch(["hypede-files", desktop_dir().get_path()]),
            "terminal": lambda *_: self._terminal(),
            "wallpaper": lambda *_: _launch(["hypede-settings", "--page", "personalization"]),
            "display": lambda *_: _launch(["hypede-settings", "--page", "devices"]),
        }
        for name, callback in actions.items():
            action = Gio.SimpleAction.new(name, None)
            action.connect("activate", callback)
            group.add_action(action)
        self.insert_action_group("desk", group)

    def _popup(self, menu: Gio.Menu, x: float, y: float, parent: Gtk.Widget | None = None) -> None:
        popover = Gtk.PopoverMenu.new_from_model(menu)
        popover.set_has_arrow(False)
        popover.set_halign(Gtk.Align.START)
        popover.set_parent(self)
        rect = Gdk.Rectangle()
        rect.x, rect.y, rect.width, rect.height = int(x), int(y), 1, 1
        popover.set_pointing_to(rect)
        popover.connect("closed", lambda p: GLib.idle_add(p.unparent))
        popover.popup()

    def item_menu(self, icon: Icon, x: float, y: float) -> None:
        ok, point = icon.compute_point(self, Graphene.Point().init(x, y))
        px, py = (point.x, point.y) if ok else (x, y)
        items = self.selection()
        menu = Gio.Menu()
        first = Gio.Menu()
        first.append(_("Open"), "desk.open")
        if len(items) == 1 and items[0].item.kind == "file" and not items[0].item.is_dir:
            first.append(_("Show in Files"), "desk.open-in-files")
        menu.append_section(None, first)
        if all(i.item.kind == "file" for i in items):
            edit = Gio.Menu()
            edit.append(_("Cut"), "desk.cut")
            edit.append(_("Copy"), "desk.copy")
            if len(items) == 1:
                edit.append(_("Rename…"), "desk.rename")
            if len(items) == 1 and items[0].item.is_launcher and not items[0].item.trusted:
                edit.append(_("Allow Launching"), "desk.allow-launch")
            menu.append_section(None, edit)
            danger = Gio.Menu()
            danger.append(_("Move to Trash"), "desk.trash")
            menu.append_section(None, danger)
        elif len(items) == 1 and items[0].item.kind == "trash" and trash_count():
            extra = Gio.Menu()
            extra.append(_("Empty Trash"), "desk.empty-trash")
            menu.append_section(None, extra)
        self._popup(menu, px, py)

    def background_menu(self, x: float, y: float) -> None:
        self._menu_cell = self.cell_at(x, y)
        menu = Gio.Menu()
        new = Gio.Menu()
        new.append(_("New Folder"), "desk.new-folder")
        new.append(_("New Text File"), "desk.new-file")
        new.append(_("Paste"), "desk.paste")
        menu.append_section(None, new)
        view = Gio.Menu()
        view.append(_("Arrange Icons"), "desk.arrange")
        view.append(_("Select All"), "desk.select-all")
        menu.append_section(None, view)
        open_ = Gio.Menu()
        open_.append(_("Open Desktop in Files"), "desk.open-desktop")
        if terminal_command(desktop_dir().get_path()):
            open_.append(_("Open Terminal Here"), "desk.terminal")
        menu.append_section(None, open_)
        settings = Gio.Menu()
        settings.append(_("Change Wallpaper…"), "desk.wallpaper")
        settings.append(_("Display Settings"), "desk.display")
        menu.append_section(None, settings)
        self._popup(menu, x, y)

    def open_selection(self) -> None:
        for icon in self.selection():
            self.open_item(icon.item)

    def open_item(self, item: Item) -> None:
        if item.is_launcher:
            if item.trusted:
                item.app_info.launch([], self.get_display().get_app_launch_context())
            else:
                self._ask_launch(item)
            return
        if item.kind in ("home", "trash") or item.is_dir:
            _launch(["hypede-files", item.uri if item.kind == "trash" else item.file.get_path()])
            return
        Gio.AppInfo.launch_default_for_uri_async(item.uri, self.get_display().get_app_launch_context(), None,
                                                 None, None)

    def _ask_launch(self, item: Item) -> None:
        dialog = Gtk.AlertDialog(
            message=_("Allow “%s” to run?") % item.label,
            detail=_("This app launcher is not trusted yet. Run it only if you know where it came from."),
            buttons=[_("Cancel"), _("Allow and Run")], cancel_button=0, default_button=1)

        def done(d, result):
            try:
                if d.choose_finish(result) == 1:
                    self._make_executable(item.file)
                    item.app_info.launch([], self.get_display().get_app_launch_context())
            except GLib.Error:
                pass

        dialog.choose(self.get_root(), None, done)

    @staticmethod
    def _make_executable(file: Gio.File) -> None:
        path = file.get_path()
        if path:
            mode = os.stat(path).st_mode
            os.chmod(path, mode | 0o100)

    def _allow_launch(self) -> None:
        for icon in self.selection():
            if icon.item.is_launcher:
                self._make_executable(icon.item.file)
        self.queue_refresh()

    def _open_in_files(self) -> None:
        items = self.selection()
        if items:
            _launch(["hypede-files", items[0].item.file.get_parent().get_path()])

    def _terminal(self) -> None:
        argv = terminal_command(desktop_dir().get_path())
        if argv:
            launcher = Gio.SubprocessLauncher.new(Gio.SubprocessFlags.NONE)
            launcher.set_cwd(desktop_dir().get_path())
            try:
                launcher.spawnv(argv)
            except GLib.Error:
                pass

    def trash_selection(self) -> None:
        files = [i.item.file for i in self.selection() if i.item.kind == "file"]
        if files:
            self.run_operation("trash", files)

    def copy_selection(self, cut: bool) -> None:
        files = [i.item.file for i in self.selection() if i.item.kind == "file"]
        if not files:
            return
        self._cut = cut
        self.app.clipboard_files = files
        gnome = ("cut\n" if cut else "copy\n") + "\n".join(f.get_uri() for f in files)
        provider = Gdk.ContentProvider.new_union([
            Gdk.ContentProvider.new_for_value(Gdk.FileList.new_from_list(files)),
            Gdk.ContentProvider.new_for_bytes("x-special/gnome-copied-files", GLib.Bytes.new(gnome.encode())),
            Gdk.ContentProvider.new_for_bytes("text/uri-list",
                                              GLib.Bytes.new("".join(f.get_uri() + "\r\n" for f in files).encode())),
        ])
        self.get_clipboard().set_content(provider)

    def paste(self) -> None:
        clipboard = self.get_clipboard()
        if clipboard.is_local() and self.app.clipboard_files:
            files = self.app.clipboard_files
            self.run_operation("move" if self._cut else "copy", files, desktop_dir())
            if self._cut:
                self.app.clipboard_files = []
                self._cut = False
            return

        def done(cb, result):
            try:
                value = cb.read_value_finish(result)
            except GLib.Error:
                return
            files = value.get_files() if value else []
            if files:
                self.run_operation("copy", files, desktop_dir())

        clipboard.read_value_async(Gdk.FileList, GLib.PRIORITY_DEFAULT, None, done)

    def new_item(self, folder: bool) -> None:
        directory = desktop_dir()
        directory.make_directory_with_parents(None) if not directory.query_exists(None) else None
        base = _("New Folder") if folder else _("New Text File") + ".txt"
        name = unique_name(directory.get_path(), base)
        target = directory.get_child(name)
        try:
            if folder:
                target.make_directory(None)
            else:
                target.create(Gio.FileCreateFlags.NONE, None).close(None)
        except GLib.Error:
            return
        cell = getattr(self, "_menu_cell", None)
        if cell:
            self.positions[name] = cell
            _save_positions(self.positions)
        self._rename_after = name
        self.refresh()

    def arrange(self) -> None:
        self.positions.clear()
        _save_positions(self.positions)
        self.layout_icons()

    def rename(self, icon: Icon) -> bool:
        if icon.item.kind != "file":
            return False
        popover = Gtk.Popover(has_arrow=True, position=Gtk.PositionType.BOTTOM)
        popover.set_parent(icon)
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        entry = Gtk.Entry(text=icon.item.info.get_display_name(), width_chars=24)
        error = Gtk.Label(xalign=0, visible=False)
        error.add_css_class("error")
        box.append(entry)
        box.append(error)
        popover.set_child(box)

        def apply(*_):
            name = entry.get_text().strip()
            if name == icon.item.info.get_display_name():
                popover.popdown()
                return
            problem = validate_filename(name)
            if problem:
                error.set_text(problem)
                error.set_visible(True)
                return
            try:
                new = icon.item.file.set_display_name(name, None)
            except GLib.Error as e:
                error.set_text(e.message)
                error.set_visible(True)
                return
            old_key = icon.item.key
            if old_key in self.positions:
                self.positions[new.get_basename()] = self.positions.pop(old_key)
                _save_positions(self.positions)
            popover.popdown()

        entry.connect("activate", apply)
        popover.connect("closed", lambda p: GLib.idle_add(p.unparent))
        popover.popup()
        # Выделить имя без расширения, как в файловых менеджерах.
        text = entry.get_text()
        stem = text.rfind(".") if not icon.item.is_dir and "." in text[1:] else len(text)
        entry.grab_focus()
        entry.select_region(0, stem)
        return True

    def _update_trash(self) -> None:
        icon = self.icons.get("trash:///")
        if icon:
            icon.update_icon()

    def _on_key(self, controller, keyval, keycode, state) -> bool:
        ctrl = bool(state & Gdk.ModifierType.CONTROL_MASK)
        shift = bool(state & Gdk.ModifierType.SHIFT_MASK)
        if keyval in (Gdk.KEY_Delete, Gdk.KEY_KP_Delete):
            self.trash_selection()
        elif keyval == Gdk.KEY_F2 and self.selection():
            self.rename(self.selection()[0])
        elif keyval in (Gdk.KEY_Return, Gdk.KEY_KP_Enter):
            self.open_selection()
        elif keyval == Gdk.KEY_Escape:
            self.select([])
        elif ctrl and keyval in (Gdk.KEY_a, Gdk.KEY_A):
            self.select(list(self.icons.values()))
        elif ctrl and keyval in (Gdk.KEY_c, Gdk.KEY_C):
            self.copy_selection(cut=False)
        elif ctrl and keyval in (Gdk.KEY_x, Gdk.KEY_X):
            self.copy_selection(cut=True)
        elif ctrl and keyval in (Gdk.KEY_v, Gdk.KEY_V):
            self.paste()
        elif ctrl and shift and keyval in (Gdk.KEY_n, Gdk.KEY_N):
            self._menu_cell = None
            self.new_item(folder=True)
        else:
            return False
        return True
