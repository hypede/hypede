"""Настройки «Файлов» — маленький JSON в ~/.config/hypede/files.json.

Схема GSettings здесь была бы избыточна: настройки нужны только самому
приложению, а JSON переживает и запуск из каталога исходников.
"""

from __future__ import annotations

import json
import os

from gi.repository import GLib, GObject

GRID_ZOOM = (48, 64, 96, 128, 192)
LIST_ZOOM = (16, 24, 32, 48)

_DEFAULTS = {
    "view-mode": "grid",        # grid | list
    "grid-zoom": 1,             # индекс в GRID_ZOOM
    "list-zoom": 1,             # индекс в LIST_ZOOM
    "show-hidden": False,
    "sort-key": "name",         # name | size | modified | type
    "sort-reversed": False,
    "folders-first": True,
    "show-details": False,
    "window-width": 1060,
    "window-height": 680,
    "window-maximized": False,
}


class Preferences(GObject.Object):
    __gtype_name__ = "HypeFilesPreferences"
    __gsignals__ = {"changed": (GObject.SignalFlags.RUN_LAST, None, (str,))}

    def __init__(self):
        super().__init__()
        self._path = os.path.join(GLib.get_user_config_dir(), "hypede", "files.json")
        self._values = dict(_DEFAULTS)
        try:
            with open(self._path, encoding="utf-8") as fh:
                stored = json.load(fh)
            for key, value in stored.items():
                if key in _DEFAULTS and isinstance(value, type(_DEFAULTS[key])):
                    self._values[key] = value
        except (OSError, ValueError):
            pass
        self._save_id = 0

    def __getitem__(self, key: str):
        return self._values[key]

    def __setitem__(self, key: str, value) -> None:
        if self._values.get(key) == value:
            return
        self._values[key] = value
        self.emit("changed", key)
        self._queue_save()

    def _queue_save(self) -> None:
        if self._save_id:
            return

        def save():
            self._save_id = 0
            try:
                os.makedirs(os.path.dirname(self._path), exist_ok=True)
                tmp = self._path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as fh:
                    json.dump(self._values, fh, indent=2)
                os.replace(tmp, self._path)
            except OSError:
                pass
            return GLib.SOURCE_REMOVE

        self._save_id = GLib.timeout_add(300, save)

    @property
    def icon_size(self) -> int:
        if self["view-mode"] == "grid":
            return GRID_ZOOM[max(0, min(self["grid-zoom"], len(GRID_ZOOM) - 1))]
        return LIST_ZOOM[max(0, min(self["list-zoom"], len(LIST_ZOOM) - 1))]

    def zoom(self, step: int) -> None:
        key = "grid-zoom" if self["view-mode"] == "grid" else "list-zoom"
        levels = GRID_ZOOM if key == "grid-zoom" else LIST_ZOOM
        self[key] = max(0, min(self[key] + step, len(levels) - 1))
