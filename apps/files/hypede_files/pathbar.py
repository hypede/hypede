"""Строка пути: «хлебные крошки», которые по клику превращаются в поле ввода.

Как в Nautilus: путь внутри домашней папки начинается с кнопки «Домашняя
папка», корень показан значком диска. Ctrl+L или клик по пустому месту —
ввод адреса (понимаются и пути, и ~, и адреса вида sftp://).
"""

from __future__ import annotations

import os

from gi.repository import Gdk, Gio, GLib, GObject, Gtk, Pango

from .util import _


class PathBar(Gtk.Box):
    __gtype_name__ = "HypeFilesPathBar"
    __gsignals__ = {
        "open-location": (GObject.SignalFlags.RUN_LAST, None, (Gio.File,)),
    }

    def __init__(self):
        super().__init__(css_classes=["hypede-pathbar"], hexpand=True)
        self.stack = Gtk.Stack(transition_type=Gtk.StackTransitionType.CROSSFADE, transition_duration=100,
                               hexpand=True, hhomogeneous=False)

        self.crumbs = Gtk.Box(css_classes=["hypede-crumbs", "linked"], hexpand=False)
        crumbs_scroller = Gtk.ScrolledWindow(child=self.crumbs, vscrollbar_policy=Gtk.PolicyType.NEVER,
                                             hscrollbar_policy=Gtk.PolicyType.EXTERNAL, hexpand=True,
                                             propagate_natural_width=True)
        self._crumbs_scroller = crumbs_scroller
        frame = Gtk.Box(css_classes=["hypede-crumbs-frame"], hexpand=True)
        frame.append(crumbs_scroller)
        click = Gtk.GestureClick()
        click.connect("released", self._on_frame_clicked)
        frame.add_controller(click)
        self.stack.add_named(frame, "crumbs")

        self.entry = Gtk.Entry(hexpand=True, css_classes=["hypede-location-entry"],
                               placeholder_text=_("Enter a location"),
                               primary_icon_name="folder-symbolic")
        self.entry.connect("activate", self._on_entry_activate)
        key = Gtk.EventControllerKey()
        key.connect("key-pressed", self._on_entry_key)
        self.entry.add_controller(key)
        focus = Gtk.EventControllerFocus()
        focus.connect("leave", lambda *_: self.show_crumbs())
        self.entry.add_controller(focus)
        self.stack.add_named(self.entry, "entry")

        self.append(self.stack)
        self.location: Gio.File | None = None

    def set_location(self, location: Gio.File, title: str | None = None) -> None:
        self.location = location
        child = self.crumbs.get_first_child()
        while child is not None:
            next_child = child.get_next_sibling()
            self.crumbs.remove(child)
            child = next_child

        segments = self._segments(location, title)
        for index, (label, icon, file) in enumerate(segments):
            last = index == len(segments) - 1
            button = Gtk.Button(css_classes=["flat", "hypede-crumb"] + (["current"] if last else []))
            content = Gtk.Box(spacing=6)
            if icon:
                content.append(Gtk.Image.new_from_icon_name(icon))
            if label:
                content.append(Gtk.Label(label=label, ellipsize=Pango.EllipsizeMode.MIDDLE,
                                         max_width_chars=24 if not last else 40))
            button.set_child(content)
            button.connect("clicked", lambda _b, f=file: self.emit("open-location", f))
            if index > 0:
                self.crumbs.append(Gtk.Image(icon_name="go-next-symbolic", css_classes=["dim-label", "hypede-crumb-sep"],
                                             pixel_size=12))
            self.crumbs.append(button)

        # Прокрутить к концу пути, если он не помещается.
        def scroll_end():
            adjustment = self._crumbs_scroller.get_hadjustment()
            adjustment.set_value(adjustment.get_upper())
            return GLib.SOURCE_REMOVE

        GLib.idle_add(scroll_end)
        self.show_crumbs()

    def _segments(self, location: Gio.File, title: str | None):
        scheme = location.get_uri_scheme()
        if scheme == "trash":
            return [(_("Trash"), "user-trash-symbolic", Gio.File.new_for_uri("trash:///"))]
        if scheme == "recent":
            return [(_("Recent"), "document-open-recent-symbolic", location)]

        path = location.get_path()
        if path is None:
            # Удалённые адреса: корень монтирования и путь внутри.
            segments = []
            file = location
            while file is not None:
                name = file.get_basename() or file.get_uri()
                segments.insert(0, (GLib.uri_unescape_string(name, None) or name, None, file))
                file = file.get_parent()
            if segments:
                label, _icon, file = segments[0]
                segments[0] = (title if len(segments) == 1 and title else label, "folder-remote-symbolic", file)
            return segments

        home = GLib.get_home_dir()
        segments = []
        if path == home or path.startswith(home + os.sep):
            segments.append((_("Home"), "user-home-symbolic", Gio.File.new_for_path(home)))
            relative = os.path.relpath(path, home)
            base = home
        else:
            segments.append((None, "drive-harddisk-symbolic", Gio.File.new_for_path("/")))
            relative = path.lstrip(os.sep)
            base = os.sep
        if relative not in (".", ""):
            for part in relative.split(os.sep):
                base = os.path.join(base, part)
                segments.append((GLib.filename_display_name(part), None, Gio.File.new_for_path(base)))
        return segments

    # ---------- поле ввода ----------

    def show_entry(self) -> None:
        if self.location is not None:
            path = self.location.get_path()
            self.entry.set_text(path if path else self.location.get_uri())
        self.stack.set_visible_child_name("entry")
        self.entry.grab_focus()
        self.entry.select_region(0, -1)

    def show_crumbs(self) -> None:
        self.stack.set_visible_child_name("crumbs")

    def _on_frame_clicked(self, gesture, _n, x, _y) -> None:
        # Клик мимо кнопок — редактирование адреса.
        picked = gesture.get_widget().pick(x, 1, Gtk.PickFlags.DEFAULT)
        while picked is not None and not isinstance(picked, Gtk.Button):
            picked = picked.get_parent() if picked is not gesture.get_widget() else None
        if picked is None:
            self.show_entry()

    def _on_entry_key(self, _controller, keyval, _keycode, _state) -> bool:
        if keyval == Gdk.KEY_Escape:
            self.show_crumbs()
            return True
        return False

    def _on_entry_activate(self, entry: Gtk.Entry) -> None:
        text = entry.get_text().strip()
        if not text:
            return
        if text.startswith("~"):
            text = os.path.expanduser(text)
        file = Gio.File.parse_name(text)
        self.show_crumbs()
        self.emit("open-location", file)
