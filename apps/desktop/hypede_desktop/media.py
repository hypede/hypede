"""Живые обои из файла: видео (через GStreamer) или анимированный GIF.

Звук всегда выключен, видео повторяется по кругу. Когда рабочий стол закрыт
развёрнутым окном, оболочка просит поставить паузу (действие app.pause).
"""

from __future__ import annotations

from gi.repository import GdkPixbuf, Gdk, Gio, GLib, Gtk

VIDEO_TYPES = {".mp4", ".webm", ".mkv", ".mov", ".m4v", ".avi", ".ogv"}


class LiveBackground(Gtk.Picture):
    def __init__(self):
        super().__init__(content_fit=Gtk.ContentFit.COVER, can_shrink=True, can_target=False,
                         hexpand=True, vexpand=True)
        self._media: Gtk.MediaFile | None = None
        self._animation: GdkPixbuf.PixbufAnimation | None = None
        self._iter = None
        self._timer = 0
        self._paused = False
        self._uri = ""
        self.set_visible(False)

    def load(self, uri: str) -> None:
        if uri == self._uri:
            return
        self._stop()
        self._uri = uri
        if not uri.startswith("file://"):
            self.set_visible(False)
            return
        file = Gio.File.new_for_uri(uri)
        path = file.get_path() or ""
        if not file.query_exists(None):
            self.set_visible(False)
            return
        if path.lower().endswith(".gif"):
            try:
                self._animation = GdkPixbuf.PixbufAnimation.new_from_file(path)
            except GLib.Error:
                self._animation = None
            if self._animation is None:
                self.set_visible(False)
                return
            if self._animation.is_static_image():
                self.set_paintable(Gdk.Texture.new_for_pixbuf(self._animation.get_static_image()))
                self._animation = None
            else:
                self._iter = self._animation.get_iter(None)
                self._show_frame()
        else:
            self._media = Gtk.MediaFile.new_for_file(file)
            self._media.set_loop(True)
            self._media.set_muted(True)
            self.set_paintable(self._media)
            if not self._paused:
                self._media.play()
        self.set_visible(True)
        self.add_css_class("appear")

    def _show_frame(self) -> bool:
        self._timer = 0
        if not self._iter:
            return GLib.SOURCE_REMOVE
        self.set_paintable(Gdk.Texture.new_for_pixbuf(self._iter.get_pixbuf()))
        if self._paused:
            return GLib.SOURCE_REMOVE
        delay = self._iter.get_delay_time()
        if delay < 0:
            return GLib.SOURCE_REMOVE
        # Слишком быстрые GIF (задержка 0–10 мс) браузеры показывают со
        # скоростью 10 кадров в секунду — так же и здесь.
        delay = max(delay, 20) if delay > 10 else 100

        def advance():
            self._timer = 0
            self._iter.advance(None)
            return self._show_frame()

        self._timer = GLib.timeout_add(delay, advance)
        return GLib.SOURCE_REMOVE

    def set_paused(self, paused: bool) -> None:
        if paused == self._paused:
            return
        self._paused = paused
        if self._media:
            if paused:
                self._media.pause()
            else:
                self._media.play()
        elif self._iter:
            if paused and self._timer:
                GLib.source_remove(self._timer)
                self._timer = 0
            elif not paused and not self._timer:
                self._show_frame()

    def _stop(self) -> None:
        if self._timer:
            GLib.source_remove(self._timer)
            self._timer = 0
        if self._media:
            self._media.pause()
            self._media = None
        self._animation = None
        self._iter = None
        self.set_paintable(None)
