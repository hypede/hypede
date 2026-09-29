"""Боковая панель: места, закладки GTK и устройства.

Закладки берутся из ~/.config/gtk-3.0/bookmarks — это общий файл, его
читают и пишут Nautilus, диалоги открытия файлов GTK и сама «Файлы» HypeDE,
поэтому закладка, добавленная где угодно, видна везде.
"""

from __future__ import annotations

import os

from gi.repository import Gdk, Gio, GLib, GObject, Gtk, Pango

from .util import _

BOOKMARKS_PATH = os.path.join(GLib.get_user_config_dir(), "gtk-3.0", "bookmarks")

_SPECIAL_DIRS = (
    (GLib.UserDirectory.DIRECTORY_DESKTOP, "user-desktop-symbolic"),
    (GLib.UserDirectory.DIRECTORY_DOCUMENTS, "folder-documents-symbolic"),
    (GLib.UserDirectory.DIRECTORY_DOWNLOAD, "folder-download-symbolic"),
    (GLib.UserDirectory.DIRECTORY_MUSIC, "folder-music-symbolic"),
    (GLib.UserDirectory.DIRECTORY_PICTURES, "folder-pictures-symbolic"),
    (GLib.UserDirectory.DIRECTORY_VIDEOS, "folder-videos-symbolic"),
)


def read_bookmarks() -> list[tuple[str, str | None]]:
    try:
        with open(BOOKMARKS_PATH, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return []
    result = []
    for line in lines:
        if not line.strip():
            continue
        uri, _sep, label = line.partition(" ")
        result.append((uri, label or None))
    return result


def write_bookmarks(bookmarks: list[tuple[str, str | None]]) -> None:
    os.makedirs(os.path.dirname(BOOKMARKS_PATH), exist_ok=True)
    with open(BOOKMARKS_PATH, "w", encoding="utf-8") as fh:
        for uri, label in bookmarks:
            fh.write(f"{uri} {label}\n" if label else f"{uri}\n")


def add_bookmark(file: Gio.File) -> bool:
    bookmarks = read_bookmarks()
    uri = file.get_uri()
    if any(existing == uri for existing, _label in bookmarks):
        return False
    bookmarks.append((uri, None))
    write_bookmarks(bookmarks)
    return True


class SidebarRow(Gtk.ListBoxRow):
    __gtype_name__ = "HypeFilesSidebarRow"

    def __init__(self, title: str, icon, location: Gio.File | None = None, *,
                 section: str = "places", mount: Gio.Mount | None = None, volume: Gio.Volume | None = None):
        super().__init__()
        self.location = location
        self.section = section
        self.mount = mount
        self.volume = volume
        self.title = title

        box = Gtk.Box(spacing=12, css_classes=["hypede-sidebar-row"])
        image = Gtk.Image.new_from_gicon(icon) if isinstance(icon, Gio.Icon) else Gtk.Image.new_from_icon_name(icon)
        box.append(image)
        box.append(Gtk.Label(label=title, xalign=0, hexpand=True, ellipsize=Pango.EllipsizeMode.END))
        self.image = image

        can_eject = (mount is not None and (mount.can_eject() or mount.can_unmount())) or \
                    (volume is not None and volume.can_eject())
        if can_eject:
            eject = Gtk.Button(icon_name="media-eject-symbolic", css_classes=["flat", "circular"],
                               tooltip_text=_("Eject"), valign=Gtk.Align.CENTER)
            eject.connect("clicked", lambda *_: self.get_root().eject(self))
            box.append(eject)
        self.set_child(box)
        self.set_tooltip_text(location.get_parse_name() if location else title)


class Sidebar(Gtk.Box):
    __gtype_name__ = "HypeFilesSidebar"
    __gsignals__ = {
        "open-location": (GObject.SignalFlags.RUN_LAST, None, (Gio.File, bool)),
    }

    def __init__(self):
        super().__init__(orientation=Gtk.Orientation.VERTICAL)
        self.listbox = Gtk.ListBox(css_classes=["navigation-sidebar"], selection_mode=Gtk.SelectionMode.SINGLE)
        self.listbox.set_header_func(self._header_func)
        self.listbox.connect("row-activated", self._on_row_activated)
        scroller = Gtk.ScrolledWindow(child=self.listbox, vexpand=True,
                                      hscrollbar_policy=Gtk.PolicyType.NEVER)
        self.append(scroller)

        click = Gtk.GestureClick(button=0)
        click.connect("pressed", self._on_click)
        self.listbox.add_controller(click)

        self._volume_monitor = Gio.VolumeMonitor.get()
        for signal in ("mount-added", "mount-removed", "mount-changed", "volume-added", "volume-removed"):
            self._volume_monitor.connect(signal, lambda *_: self.rebuild())

        self._bookmarks_monitor = Gio.File.new_for_path(BOOKMARKS_PATH).monitor_file(Gio.FileMonitorFlags.NONE, None)
        self._bookmarks_monitor.connect("changed", lambda *_: self.rebuild())

        self._trash = Gio.File.new_for_uri("trash:///")
        try:
            self._trash_monitor = self._trash.monitor_directory(Gio.FileMonitorFlags.NONE, None)
            self._trash_monitor.connect("changed", lambda *_: self._update_trash_icon())
        except GLib.Error:
            self._trash_monitor = None

        self._current_uri: str | None = None
        self.rebuild()

    # ---------- построение ----------

    def rebuild(self) -> None:
        self.listbox.remove_all()
        home = Gio.File.new_for_path(GLib.get_home_dir())
        self._add(SidebarRow(_("Recent"), "document-open-recent-symbolic", Gio.File.new_for_uri("recent:///")))
        self._add(SidebarRow(_("Home"), "user-home-symbolic", home))
        seen = {GLib.get_home_dir()}
        for directory, icon in _SPECIAL_DIRS:
            path = GLib.get_user_special_dir(directory)
            if not path or path in seen or not os.path.isdir(path):
                continue
            seen.add(path)
            self._add(SidebarRow(os.path.basename(path), icon, Gio.File.new_for_path(path)))
        self.trash_row = SidebarRow(_("Trash"), "user-trash-symbolic", self._trash)
        self._add(self.trash_row)
        self._update_trash_icon()

        for uri, label in read_bookmarks():
            file = Gio.File.new_for_uri(uri)
            if file.get_path() in seen:
                continue
            title = label or GLib.filename_display_basename(file.get_path() or uri)
            icon = "folder-remote-symbolic" if not file.is_native() else "folder-symbolic"
            self._add(SidebarRow(title, icon, file, section="bookmarks"))

        mounted_volumes = set()
        for mount in self._volume_monitor.get_mounts():
            if mount.is_shadowed():
                continue
            volume = mount.get_volume()
            if volume is not None:
                mounted_volumes.add(volume)
            root = mount.get_default_location()
            self._add(SidebarRow(mount.get_name(), mount.get_symbolic_icon(), root,
                                 section="devices", mount=mount))
        for volume in self._volume_monitor.get_volumes():
            if volume in mounted_volumes or volume.get_mount() is not None:
                continue
            self._add(SidebarRow(volume.get_name(), volume.get_symbolic_icon(), None,
                                 section="devices", volume=volume))
        self._add(SidebarRow(_("File System"), "drive-harddisk-symbolic", Gio.File.new_for_path("/"),
                             section="devices"))
        self.highlight(self._current_uri)

    def _add(self, row: SidebarRow) -> None:
        self.listbox.append(row)

    def _header_func(self, row: SidebarRow, before: SidebarRow | None) -> None:
        if before is not None and before.section == row.section:
            row.set_header(None)
            return
        titles = {"bookmarks": _("Bookmarks"), "devices": _("Devices")}
        if row.section not in titles:
            row.set_header(None)
            return
        header = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        header.append(Gtk.Separator(margin_top=6, margin_bottom=6, margin_start=6, margin_end=6))
        header.append(Gtk.Label(label=titles[row.section], xalign=0, css_classes=["heading", "dim-label"],
                                margin_start=12, margin_bottom=4))
        row.set_header(header)

    def _update_trash_icon(self) -> None:
        try:
            info = self._trash.query_info("trash::item-count", Gio.FileQueryInfoFlags.NONE, None)
            full = info.get_attribute_uint32("trash::item-count") > 0
        except GLib.Error:
            full = False
        if getattr(self, "trash_row", None):
            self.trash_row.image.set_from_icon_name("user-trash-full-symbolic" if full else "user-trash-symbolic")

    # ---------- выбор ----------

    def highlight(self, uri: str | None) -> None:
        self._current_uri = uri
        match = None
        child = self.listbox.get_first_child()
        while child is not None:
            if isinstance(child, SidebarRow) and child.location is not None and child.location.get_uri() == uri:
                match = child
                break
            child = child.get_next_sibling()
        if match is not None:
            self.listbox.select_row(match)
        else:
            self.listbox.unselect_all()

    def _on_row_activated(self, _listbox, row: SidebarRow, new_tab: bool = False) -> None:
        if row.location is not None:
            self.emit("open-location", row.location, new_tab)
            return
        if row.volume is not None:
            operation = Gtk.MountOperation.new(self.get_root())

            def mounted(volume, result):
                try:
                    volume.mount_finish(result)
                except GLib.Error as error:
                    self.get_root().show_toast(error.message)
                    return
                mount = volume.get_mount()
                if mount is not None:
                    self.emit("open-location", mount.get_default_location(), new_tab)

            row.volume.mount(Gio.MountMountFlags.NONE, operation, None, mounted)

    def _on_click(self, gesture: Gtk.GestureClick, _n, x, y) -> None:
        button = gesture.get_current_button()
        row = self.listbox.get_row_at_y(int(y))
        if not isinstance(row, SidebarRow):
            return
        if button == Gdk.BUTTON_MIDDLE:
            gesture.set_state(Gtk.EventSequenceState.CLAIMED)
            self._on_row_activated(self.listbox, row, new_tab=True)
        elif button == Gdk.BUTTON_SECONDARY:
            gesture.set_state(Gtk.EventSequenceState.CLAIMED)
            self._popup(row, x, y)

    def _popup(self, row: SidebarRow, x: float, y: float) -> None:
        menu = Gio.Menu()
        group = Gio.SimpleActionGroup()

        def action(name, callback):
            simple = Gio.SimpleAction.new(name, None)
            simple.connect("activate", lambda *_: callback())
            group.add_action(simple)

        if row.location is not None:
            menu.append(_("Open in New Tab"), "sidebar.new-tab")
            action("new-tab", lambda: self.emit("open-location", row.location, True))
        if row.section == "bookmarks":
            menu.append(_("Remove from Sidebar"), "sidebar.remove")

            def remove():
                write_bookmarks([b for b in read_bookmarks() if b[0] != row.location.get_uri()])

            action("remove", remove)
        if row.mount is not None and (row.mount.can_eject() or row.mount.can_unmount()):
            menu.append(_("Eject") if row.mount.can_eject() else _("Unmount"), "sidebar.eject")
            action("eject", lambda: self.get_root().eject(row))
        if menu.get_n_items() == 0:
            return

        popover = Gtk.PopoverMenu.new_from_model(menu)
        popover.insert_action_group("sidebar", group)
        popover.set_parent(self.listbox)
        rect = Gdk.Rectangle()
        rect.x, rect.y, rect.width, rect.height = int(x), int(y), 1, 1
        popover.set_pointing_to(rect)
        popover.set_has_arrow(False)
        popover.connect("closed", lambda p: GLib.idle_add(p.unparent))
        popover.popup()
