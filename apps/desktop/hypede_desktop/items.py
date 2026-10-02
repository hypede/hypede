"""Что лежит на рабочем столе: файлы из папки «Рабочий стол», домашняя
папка и корзина."""

from __future__ import annotations

from gettext import gettext as _

from gi.repository import Gio, GLib

ATTRIBUTES = ",".join([
    "standard::name", "standard::display-name", "standard::icon", "standard::content-type",
    "standard::type", "standard::is-hidden", "standard::is-backup", "standard::size",
    "standard::symbolic-icon", "time::modified", "access::can-execute", "unix::mode",
])


def desktop_dir() -> Gio.File:
    path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP)
    if not path or path == GLib.get_home_dir():
        path = GLib.build_filenamev([GLib.get_home_dir(), "Desktop"])
    return Gio.File.new_for_path(path)


class Item:
    """Значок на рабочем столе. kind: file, home, trash."""

    def __init__(self, kind: str, file: Gio.File, info: Gio.FileInfo | None = None):
        self.kind = kind
        self.file = file
        self.info = info
        self.app_info: Gio.DesktopAppInfo | None = None
        if kind == "file" and info and info.get_name().endswith(".desktop"):
            try:
                self.app_info = Gio.DesktopAppInfo.new_from_filename(file.get_path())
            except TypeError:
                self.app_info = None

    @property
    def key(self) -> str:
        """Имя для запоминания места: у файлов — имя файла."""
        if self.kind != "file":
            return f"::{self.kind}"
        return self.info.get_name()

    @property
    def uri(self) -> str:
        return self.file.get_uri()

    @property
    def label(self) -> str:
        if self.kind == "home":
            return _("Home")
        if self.kind == "trash":
            return _("Trash")
        if self.app_info:
            return self.app_info.get_name()
        return self.info.get_display_name()

    @property
    def is_dir(self) -> bool:
        if self.kind != "file":
            return True
        return self.info.get_file_type() == Gio.FileType.DIRECTORY

    @property
    def is_launcher(self) -> bool:
        return self.app_info is not None

    @property
    def trusted(self) -> bool:
        """Ярлык приложения запускается, только если у файла есть право на
        выполнение — как в GNOME и KDE: чужой файл не запустится сам."""
        return bool(self.info and self.info.get_attribute_boolean("access::can-execute"))

    def icon(self) -> Gio.Icon:
        if self.kind == "home":
            return Gio.ThemedIcon.new("user-home")
        if self.kind == "trash":
            return Gio.ThemedIcon.new("user-trash-full" if trash_count() else "user-trash")
        if self.app_info and self.app_info.get_icon():
            return self.app_info.get_icon()
        return self.info.get_icon() or Gio.ThemedIcon.new("text-x-generic")

    def sort_key(self):
        order = {"home": 0, "trash": 1}.get(self.kind, 2)
        return (order, not self.is_dir, GLib.utf8_collate_key_for_filename(self.label.lower(), -1))


def trash_count() -> int:
    try:
        info = Gio.File.new_for_uri("trash:///").query_info("trash::item-count", Gio.FileQueryInfoFlags.NONE, None)
        return info.get_attribute_uint32("trash::item-count")
    except GLib.Error:
        return 0


def list_items(show_home: bool, show_trash: bool) -> list[Item]:
    items = []
    if show_home:
        items.append(Item("home", Gio.File.new_for_path(GLib.get_home_dir())))
    if show_trash:
        items.append(Item("trash", Gio.File.new_for_uri("trash:///")))
    folder = desktop_dir()
    try:
        enumerator = folder.enumerate_children(ATTRIBUTES, Gio.FileQueryInfoFlags.NONE, None)
    except GLib.Error:
        return items
    for info in enumerator:
        if info.get_is_hidden() or info.get_is_backup():
            continue
        items.append(Item("file", folder.get_child(info.get_name()), info))
    return items
