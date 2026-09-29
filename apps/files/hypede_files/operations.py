"""Файловые операции в фоне: копирование, перемещение, корзина, удаление.

Каждая операция работает в своём потоке через синхронные вызовы Gio (они
отпускают GIL и понимают любые адреса GVfs — trash://, sftp://, smb://…),
а о ходе дел сообщает в главный поток через GLib.idle_add. Ничего не
затирается: при совпадении имён новое получает суффикс « (2)», как в COSMIC.
"""

from __future__ import annotations

import os
import threading
import time

from gi.repository import Gio, GLib, GObject

from .util import _, ngettext, unique_name

COPY_FLAGS = Gio.FileCopyFlags.NOFOLLOW_SYMLINKS | Gio.FileCopyFlags.ALL_METADATA


def _name(file: Gio.File) -> str:
    try:
        info = file.query_info("standard::display-name", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS)
        return info.get_display_name()
    except GLib.Error:
        return file.get_basename() or file.get_uri()


def _unique_child(directory: Gio.File, name: str) -> Gio.File:
    def exists(path: str) -> bool:
        return directory.get_child(os.path.basename(path)).query_exists(None)

    return directory.get_child(unique_name("", name, exists=exists))


def _is_dir(file: Gio.File) -> bool:
    return file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, None) == Gio.FileType.DIRECTORY


def _measure(file: Gio.File, cancellable: Gio.Cancellable) -> tuple[int, int]:
    """(байты, число файлов) — для полосы прогресса."""
    info = file.query_info("standard::type,standard::size", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, cancellable)
    if info.get_file_type() != Gio.FileType.DIRECTORY:
        return info.get_size(), 1
    total, count = 0, 1
    enumerator = file.enumerate_children("standard::name,standard::type,standard::size",
                                         Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, cancellable)
    for child in enumerator:
        size, n = _measure(enumerator.get_child(child), cancellable)
        total += size
        count += n
    return total, count


class Operation(GObject.Object):
    """Одна фоновая операция. Свойства меняются только в главном потоке."""

    __gtype_name__ = "HypeFilesOperation"
    __gsignals__ = {"finished": (GObject.SignalFlags.RUN_LAST, None, ())}

    title = GObject.Property(type=str, default="")
    status = GObject.Property(type=str, default="")
    fraction = GObject.Property(type=float, default=0.0)
    done = GObject.Property(type=bool, default=False)

    def __init__(self, kind: str, sources: list[Gio.File], destination: Gio.File | None = None):
        super().__init__()
        self.kind = kind
        self.sources = sources
        self.destination = destination
        self.cancellable = Gio.Cancellable()
        self.error: str | None = None
        # Пары (откуда, куда) для отмены действия.
        self.results: list[tuple[Gio.File, Gio.File | None]] = []
        self._bytes_total = 0
        self._bytes_done = 0
        self._last_report = 0.0
        count = len(sources)
        titles = {
            "copy": ngettext("Copying %d item", "Copying %d items", count),
            "move": ngettext("Moving %d item", "Moving %d items", count),
            "trash": ngettext("Moving %d item to the trash", "Moving %d items to the trash", count),
            "delete": ngettext("Deleting %d item", "Deleting %d items", count),
            "restore": ngettext("Restoring %d item", "Restoring %d items", count),
        }
        self.title = titles[kind] % count

    # --- запуск ---

    def start(self) -> None:
        threading.Thread(target=self._run, name=f"hypede-files-{self.kind}", daemon=True).start()

    def cancel(self) -> None:
        self.cancellable.cancel()

    def _report(self, status: str | None = None, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_report < 0.08:
            return
        self._last_report = now
        fraction = self._bytes_done / self._bytes_total if self._bytes_total else 0.0

        def apply():
            self.fraction = min(1.0, fraction)
            if status is not None:
                self.status = status
            return GLib.SOURCE_REMOVE

        GLib.idle_add(apply)

    def _run(self) -> None:
        try:
            getattr(self, f"_run_{self.kind}")()
        except GLib.Error as error:
            if not error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED):
                self.error = error.message
        except Exception as error:  # noqa: BLE001 — показать пользователю, а не упасть
            self.error = str(error)

        def finish():
            self.fraction = 1.0
            self.done = True
            self.emit("finished")
            return GLib.SOURCE_REMOVE

        GLib.idle_add(finish)

    # --- копирование и перемещение ---

    def _progress_callback(self, base: int):
        def callback(current: int, _total: int, *_data) -> None:
            self._bytes_done = base + current
            self._report()

        return callback

    def _copy_tree(self, source: Gio.File, target: Gio.File) -> None:
        if _is_dir(source):
            target.make_directory(self.cancellable)
            enumerator = source.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                                                   self.cancellable)
            for info in enumerator:
                name = info.get_name()
                self._copy_tree(source.get_child(name), target.get_child(name))
            return
        base = self._bytes_done
        self._report(_("Copying “%s”") % _name(source))
        source.copy(target, COPY_FLAGS, self.cancellable, self._progress_callback(base))
        size = source.query_info("standard::size", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, None).get_size()
        self._bytes_done = base + size

    def _prepare_bytes(self) -> None:
        total = 0
        for source in self.sources:
            size, _count = _measure(source, self.cancellable)
            total += size
        self._bytes_total = max(total, 1)

    def _run_copy(self) -> None:
        self._prepare_bytes()
        for source in self.sources:
            target = _unique_child(self.destination, source.get_basename())
            self._copy_tree(source, target)
            self.results.append((source, target))

    def _run_move(self) -> None:
        self._prepare_bytes()
        for source in self.sources:
            parent = source.get_parent()
            if parent and parent.equal(self.destination):
                continue  # уже на месте
            if self.destination.has_prefix(source) or self.destination.equal(source):
                raise GLib.Error(_("Cannot move a folder into itself"))
            target = _unique_child(self.destination, source.get_basename())
            self._report(_("Moving “%s”") % _name(source))
            try:
                source.move(target, Gio.FileCopyFlags.NOFOLLOW_SYMLINKS | Gio.FileCopyFlags.ALL_METADATA,
                            self.cancellable, self._progress_callback(self._bytes_done))
            except GLib.Error as error:
                # Каталог на другой файловой системе Gio целиком не переносит.
                if not error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.WOULD_RECURSE):
                    raise
                self._copy_tree(source, target)
                _delete_tree(source, self.cancellable)
            self.results.append((source, target))

    # --- корзина и удаление ---

    def _run_trash(self) -> None:
        self._bytes_total = len(self.sources)
        for source in self.sources:
            self._report(_("Moving “%s” to the trash") % _name(source))
            source.trash(self.cancellable)
            self.results.append((source, None))
            self._bytes_done += 1

    def _run_delete(self) -> None:
        self._bytes_total = len(self.sources)
        for source in self.sources:
            self._report(_("Deleting “%s”") % _name(source))
            _delete_tree(source, self.cancellable)
            self._bytes_done += 1

    def _run_restore(self) -> None:
        """Возврат из корзины: источники — адреса trash:///…"""
        self._bytes_total = len(self.sources)
        for source in self.sources:
            info = source.query_info("trash::orig-path", Gio.FileQueryInfoFlags.NONE, self.cancellable)
            original = info.get_attribute_byte_string("trash::orig-path")
            if not original:
                continue
            target = Gio.File.new_for_path(original)
            parent = target.get_parent()
            if parent and not parent.query_exists(None):
                parent.make_directory_with_parents(self.cancellable)
            if target.query_exists(None):
                target = _unique_child(parent, target.get_basename())
            source.move(target, Gio.FileCopyFlags.NOFOLLOW_SYMLINKS, self.cancellable, None)
            self.results.append((source, target))
            self._bytes_done += 1


def _delete_tree(file: Gio.File, cancellable: Gio.Cancellable) -> None:
    if _is_dir(file):
        enumerator = file.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, cancellable)
        for info in enumerator:
            _delete_tree(file.get_child(info.get_name()), cancellable)
    file.delete(cancellable)


def find_in_trash(original_paths: set[str], since: float) -> list[Gio.File]:
    """Файлы в корзине, выброшенные из original_paths не раньше since —
    для отмены «Переместить в корзину»."""
    found = []
    trash = Gio.File.new_for_uri("trash:///")
    try:
        enumerator = trash.enumerate_children("standard::name,trash::orig-path,trash::deletion-date",
                                              Gio.FileQueryInfoFlags.NONE, None)
    except GLib.Error:
        return found
    for info in enumerator:
        original = info.get_attribute_byte_string("trash::orig-path")
        if original not in original_paths:
            continue
        deleted = info.get_deletion_date()
        if deleted is not None and deleted.to_unix() + 2 < since:
            continue
        found.append(enumerator.get_child(info))
    return found


class OperationsManager(GObject.Object):
    """Все идущие операции приложения — для кнопки прогресса в заголовке."""

    __gtype_name__ = "HypeFilesOperationsManager"
    __gsignals__ = {
        "operation-finished": (GObject.SignalFlags.RUN_LAST, None, (GObject.Object,)),
    }

    def __init__(self):
        super().__init__()
        self.store = Gio.ListStore(item_type=Operation)

    @property
    def active(self) -> bool:
        return any(not op.done for op in self.store)

    def run(self, operation: Operation) -> Operation:
        operation.started_at = time.time()
        self.store.append(operation)
        operation.connect("finished", self._on_finished)
        operation.start()
        return operation

    def _on_finished(self, operation: Operation) -> None:
        self.emit("operation-finished", operation)

        # Завершённые операции исчезают из списка через несколько секунд.
        def remove():
            found, position = self.store.find(operation)
            if found:
                self.store.remove(position)
            return GLib.SOURCE_REMOVE

        GLib.timeout_add_seconds(4, remove)
