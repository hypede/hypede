"""Эскизы файлов.

Порядок, как в Nautilus: готовый эскиз из ~/.cache/thumbnails (его путь
GIO отдаёт в атрибуте thumbnail::path), затем генерация через системные
thumbnailer'ы (GnomeDesktop, если есть), и в крайнем случае — картинка,
уменьшенная прямо из файла. Всё тяжёлое — в пуле потоков.
"""

from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import gi
from gi.repository import Gdk, GdkPixbuf, Gio, GLib

try:
    gi.require_version("GnomeDesktop", "4.0")
    from gi.repository import GnomeDesktop
except (ValueError, ImportError):
    GnomeDesktop = None

MAX_DIRECT_SIZE = 40 * 1024 * 1024  # крупнее — не декодировать ради эскиза
MAX_CACHE = 500  # текстур в памяти: старые вытесняются (LRU), иначе кэш рос бы весь сеанс

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="hypede-thumbs")
_cache: OrderedDict[tuple[str, int, int], Gdk.Texture | None] = OrderedDict()
_pending: dict[tuple[str, int, int], list] = {}
_factory = None


def _get_factory():
    global _factory
    if _factory is None and GnomeDesktop is not None:
        _factory = GnomeDesktop.DesktopThumbnailFactory.new(GnomeDesktop.DesktopThumbnailSize.LARGE)
    return _factory


def can_thumbnail(info: Gio.FileInfo) -> bool:
    content_type = info.get_content_type() or ""
    if info.get_file_type() != Gio.FileType.REGULAR:
        return False
    if info.get_attribute_byte_string("thumbnail::path"):
        return True
    if content_type.startswith("image/"):
        return True
    return GnomeDesktop is not None and (
        content_type.startswith("video/") or content_type in ("application/pdf", "image/svg+xml")
    )


def _load(path: str, size: int) -> GdkPixbuf.Pixbuf | None:
    try:
        return GdkPixbuf.Pixbuf.new_from_file_at_scale(path, size, size, True)
    except GLib.Error:
        return None


def _produce(file: Gio.File, info: Gio.FileInfo, size: int) -> GdkPixbuf.Pixbuf | None:
    existing = info.get_attribute_byte_string("thumbnail::path")
    if existing:
        pixbuf = _load(existing, size)
        if pixbuf:
            return pixbuf

    uri = file.get_uri()
    mtime = info.get_modification_date_time()
    mtime_unix = mtime.to_unix() if mtime else 0
    content_type = info.get_content_type() or ""

    factory = _get_factory()
    if factory is not None and factory.can_thumbnail(uri, content_type, mtime_unix):
        try:
            thumb = factory.generate_thumbnail(uri, content_type, None)
            if thumb is not None:
                factory.save_thumbnail(thumb, uri, mtime_unix, None)
                return thumb.scale_simple(*_fit(thumb, size), GdkPixbuf.InterpType.BILINEAR)
        except GLib.Error:
            factory.create_failed_thumbnail(uri, mtime_unix, None)

    path = file.get_path()
    if path and content_type.startswith("image/") and info.get_size() <= MAX_DIRECT_SIZE:
        return _load(path, size)
    return None


def _fit(pixbuf: GdkPixbuf.Pixbuf, size: int) -> tuple[int, int]:
    width, height = pixbuf.get_width(), pixbuf.get_height()
    scale = min(size / width, size / height, 1.0)
    return max(1, int(width * scale)), max(1, int(height * scale))


def request(file: Gio.File, info: Gio.FileInfo, size: int, callback) -> Gdk.Texture | None:
    """Возвращает эскиз сразу, если он в кэше; иначе вызовет callback(texture)
    в главном потоке, когда эскиз будет готов (texture может быть None)."""
    mtime = info.get_modification_date_time()
    key = (file.get_uri(), mtime.to_unix() if mtime else 0, size)
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    if key in _pending:
        _pending[key].append(callback)
        return None
    _pending[key] = [callback]

    def work():
        pixbuf = _produce(file, info, size)

        def deliver():
            texture = Gdk.Texture.new_for_pixbuf(pixbuf) if pixbuf else None
            _cache[key] = texture
            _cache.move_to_end(key)
            while len(_cache) > MAX_CACHE:
                _cache.popitem(last=False)
            for cb in _pending.pop(key, []):
                cb(texture)
            return GLib.SOURCE_REMOVE

        GLib.idle_add(deliver)

    _executor.submit(work)
    return None
