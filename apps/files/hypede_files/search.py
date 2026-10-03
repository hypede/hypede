"""Поиск по папке и всем вложенным — в фоновом потоке.

Для локальных папок обходим дерево через os.scandir (быстро и без лишних
вызовов GIO), найденное пачками отправляем в Gio.ListStore в главном
потоке. Для удалённых адресов (sftp://, smb://…) ищем через Gio, но только
на один уровень вглубь, чтобы не нагружать сеть.
"""

from __future__ import annotations

import os
import threading
from collections import deque

from gi.repository import Gio, GLib, GObject

MAX_RESULTS = 2000
BATCH = 64
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".cache", ".local/share/Trash"}


def _matches(name: str, words: list[str]) -> bool:
    lowered = name.casefold()
    return all(word in lowered for word in words)


class Search(GObject.Object):
    __gtype_name__ = "HypeFilesSearch"

    running = GObject.Property(type=bool, default=False)

    def __init__(self, attributes: str):
        super().__init__()
        self.attributes = attributes
        self.store = Gio.ListStore(item_type=Gio.FileInfo)
        self.active = False
        self.include_hidden = False
        self._generation = 0

    def start(self, root: Gio.File, query: str, include_hidden: bool = False) -> None:
        self.stop()
        self.include_hidden = include_hidden
        self.active = True
        self._generation += 1
        generation = self._generation
        words = [w.casefold() for w in query.split()]
        self.running = True
        threading.Thread(target=self._run, args=(root, words, generation), daemon=True,
                         name="hypede-files-search").start()

    def stop(self) -> None:
        self._generation += 1
        self.active = False
        self.running = False
        self.store.remove_all()

    def _alive(self, generation: int) -> bool:
        return generation == self._generation

    def _deliver(self, batch: list[Gio.FileInfo], generation: int, finished: bool = False) -> None:
        def apply():
            if self._alive(generation):
                if batch:
                    self.store.splice(self.store.get_n_items(), 0, batch)
                if finished:
                    self.running = False
            return GLib.SOURCE_REMOVE

        GLib.idle_add(apply)

    def _info_for(self, file: Gio.File) -> Gio.FileInfo | None:
        try:
            info = file.query_info(self.attributes, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, None)
        except GLib.Error:
            return None
        info.set_attribute_object("standard::file", file)
        return info

    def _run(self, root: Gio.File, words: list[str], generation: int) -> None:
        batch: list[Gio.FileInfo] = []
        found = 0

        def emit(file: Gio.File) -> bool:
            nonlocal found
            info = self._info_for(file)
            if info is None:
                return True
            batch.append(info)
            found += 1
            if len(batch) >= BATCH:
                self._deliver(batch.copy(), generation)
                batch.clear()
            return found < MAX_RESULTS and self._alive(generation)

        path = root.get_path()
        if path:
            self._walk_local(path, words, emit, generation)
        else:
            self._walk_remote(root, words, emit, generation)
        self._deliver(batch, generation, finished=True)

    def _walk_local(self, root: str, words, emit, generation) -> None:
        pending = deque([root])
        home = GLib.get_home_dir()
        while pending and self._alive(generation):
            directory = pending.popleft()  # обход в ширину: ближние результаты раньше
            try:
                entries = list(os.scandir(directory))
            except OSError:
                continue
            for entry in entries:
                if not self._alive(generation):
                    return
                name = entry.name
                if not self.include_hidden and name.startswith("."):
                    continue
                if _matches(name, words) and not emit(Gio.File.new_for_path(entry.path)):
                    return
                try:
                    is_dir = entry.is_dir(follow_symlinks=False)
                except OSError:
                    continue
                if is_dir and name not in SKIP_DIRS:
                    relative = os.path.relpath(entry.path, home)
                    if relative not in SKIP_DIRS:
                        pending.append(entry.path)

    def _walk_remote(self, root: Gio.File, words, emit, generation) -> None:
        try:
            enumerator = root.enumerate_children("standard::name,standard::display-name",
                                                 Gio.FileQueryInfoFlags.NONE, None)
        except GLib.Error:
            return
        for info in enumerator:
            if not self._alive(generation):
                return
            if _matches(info.get_display_name(), words) and not emit(enumerator.get_child(info)):
                return
