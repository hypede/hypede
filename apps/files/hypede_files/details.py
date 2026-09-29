"""Панель сведений справа — идея из COSMIC Files.

Показывает крупный эскиз и свойства выделенного файла; без выделения —
сведения о текущей папке; при нескольких выделенных — их число и общий
размер. Размер папки считается в фоне, чтобы не тормозить интерфейс.
"""

from __future__ import annotations

import os
import stat
import threading

from gi.repository import Gio, GLib, Gtk, Pango

from . import thumbnails
from .folder_view import file_of, format_date, is_dir, display_path
from .util import _, format_item_count, format_size, ngettext

PREVIEW_SIZE = 160


def _count_children(path: str) -> tuple[int, int]:
    """(число объектов, суммарный размер файлов) — рекурсивно, без ссылок."""
    count = total = 0
    stack = [path]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    count += 1
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
                        elif entry.is_file(follow_symlinks=False):
                            total += entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        continue
        except OSError:
            continue
    return count, total


class DetailsPane(Gtk.Box):
    __gtype_name__ = "HypeFilesDetailsPane"

    def __init__(self):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, width_request=300, hexpand=False,
                         css_classes=["hypede-details"])
        content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12,
                          margin_top=24, margin_bottom=24, margin_start=18, margin_end=18)
        self.preview = Gtk.Image(pixel_size=PREVIEW_SIZE, halign=Gtk.Align.CENTER,
                                 css_classes=["hypede-details-preview"])
        self.title = Gtk.Label(wrap=True, wrap_mode=Pango.WrapMode.WORD_CHAR, justify=Gtk.Justification.CENTER,
                               css_classes=["title-3"], selectable=True)
        self.subtitle = Gtk.Label(css_classes=["dim-label"], wrap=True, justify=Gtk.Justification.CENTER)
        self.grid = Gtk.Grid(column_spacing=12, row_spacing=10, margin_top=12)
        self.open_button = Gtk.Button(label=_("Open"), css_classes=["pill", "suggested-action"],
                                      halign=Gtk.Align.CENTER, margin_top=6)
        self.open_button.set_action_name("win.open")

        content.append(self.preview)
        content.append(self.title)
        content.append(self.subtitle)
        content.append(self.open_button)
        content.append(self.grid)
        self.append(Gtk.ScrolledWindow(child=content, vexpand=True, hscrollbar_policy=Gtk.PolicyType.NEVER))
        self._generation = 0

    def _clear_grid(self) -> None:
        child = self.grid.get_first_child()
        while child is not None:
            next_child = child.get_next_sibling()
            self.grid.remove(child)
            child = next_child
        self._row = 0

    def _add_row(self, key: str, value: str) -> Gtk.Label:
        self.grid.attach(Gtk.Label(label=key, xalign=1, valign=Gtk.Align.START, css_classes=["dim-label"]),
                         0, self._row, 1, 1)
        label = Gtk.Label(label=value, xalign=0, wrap=True, wrap_mode=Pango.WrapMode.WORD_CHAR,
                          selectable=True, max_width_chars=22)
        self.grid.attach(label, 1, self._row, 1, 1)
        self._row += 1
        return label

    def show_for(self, folder_info: Gio.FileInfo | None, folder: Gio.File, selected: list[Gio.FileInfo],
                 folder_item_count: int) -> None:
        self._generation += 1
        self._clear_grid()
        self.preview.remove_css_class("thumbnail")

        if len(selected) > 1:
            self.preview.set_from_icon_name("edit-select-all-symbolic")
            self.preview.set_pixel_size(96)
            self.title.set_text(_("%d items selected") % len(selected))
            files = [i for i in selected if not is_dir(i)]
            folders = len(selected) - len(files)
            parts = []
            if folders:
                parts.append(ngettext("%d folder", "%d folders", folders) % folders)
            if files:
                parts.append(ngettext("%d file", "%d files", len(files)) % len(files))
            self.subtitle.set_text(", ".join(parts))
            self.open_button.set_visible(True)
            if files:
                self._add_row(_("Size"), format_size(sum(i.get_size() for i in files)))
            return

        if selected:
            info = selected[0]
            file = file_of(info)
        else:
            info = folder_info
            file = folder
        self.open_button.set_visible(bool(selected))

        self.preview.set_pixel_size(128 if info is None or is_dir(info) else PREVIEW_SIZE)
        if info is not None:
            self.preview.set_from_gicon(info.get_icon())
            self.title.set_text(info.get_display_name())
            if thumbnails.can_thumbnail(info):
                uri = file.get_uri()
                self._preview_uri = uri

                def ready(texture):
                    if texture is not None and self._preview_uri == uri:
                        self.preview.set_from_paintable(texture)
                        self.preview.add_css_class("thumbnail")

                texture = thumbnails.request(file, info, 256 * self.get_scale_factor(), ready)
                if texture is not None:
                    ready(texture)
        else:
            self.preview.set_from_icon_name("folder")
            self.title.set_text(file.get_basename() or file.get_uri())

        content_type = (info.get_content_type() if info else None) or "inode/directory"
        self.subtitle.set_text(Gio.content_type_get_description(content_type))

        if info is not None and is_dir(info):
            if not selected:
                self._add_row(_("Contents"), format_item_count(folder_item_count))
            else:
                size_label = self._add_row(_("Contents"), _("Counting…"))
                path = file.get_path()
                if path:
                    self._count_async(path, size_label)
                else:
                    size_label.set_text("—")
        elif info is not None:
            self._add_row(_("Size"), format_size(info.get_size()))

        if info is not None:
            self._add_row(_("Modified"), format_date(info.get_modification_date_time()))
            created = info.get_creation_date_time() if hasattr(info, "get_creation_date_time") else None
            if created is not None:
                self._add_row(_("Created"), format_date(created))
            original = info.get_attribute_byte_string("trash::orig-path")
            if original:
                self._add_row(_("Original location"), display_path(Gio.File.new_for_path(original)))
            mode = info.get_attribute_uint32("unix::mode")
            if mode:
                self._add_row(_("Permissions"), stat.filemode(mode))
        parent = file.get_parent()
        if parent is not None:
            self._add_row(_("Location"), display_path(parent))

    def _count_async(self, path: str, label: Gtk.Label) -> None:
        generation = self._generation

        def work():
            count, total = _count_children(path)

            def apply():
                if generation == self._generation:
                    label.set_text(f"{format_item_count(count)}, {format_size(total)}")
                return GLib.SOURCE_REMOVE

            GLib.idle_add(apply)

        threading.Thread(target=work, daemon=True, name="hypede-files-count").start()
