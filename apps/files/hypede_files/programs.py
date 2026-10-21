"""Запуск программ из «Файлов» и с рабочего стола: AppImage и ELF.

Двойной щелчок по такому файлу запускает его, а не ищет программу для
открытия. Если права на запуск нет, сначала спрашиваем разрешения и
ставим его (как chmod +x).
"""

from __future__ import annotations

import os
from collections.abc import Callable

from gi.repository import Gio, GLib, Gtk

from .util import _, appimage_env, is_appimage, is_program, with_exec_bits

LIBFUSE2 = "/usr/lib/libfuse.so.2"


def run_program(file: Gio.File, parent: Gtk.Widget, report: Callable[[str], None]) -> bool:
    """True, если файл — программа и мы её запустили или спросили про
    запуск. False — это обычный документ, открывайте как раньше."""
    path = file.get_path()
    if not path:
        return False
    try:
        info = file.query_info("standard::content-type,unix::mode,access::can-execute",
                               Gio.FileQueryInfoFlags.NONE, None)
    except GLib.Error:
        return False
    name = file.get_basename() or ""
    content_type = info.get_content_type() or ""
    executable = info.get_attribute_boolean("access::can-execute")
    if not is_program(name, content_type, executable):
        return False

    def run() -> None:
        env = os.environ.copy()
        if is_appimage(name, content_type):
            env = appimage_env(env, os.path.exists(LIBFUSE2))
        launcher = Gio.SubprocessLauncher.new(Gio.SubprocessFlags.NONE)
        launcher.set_cwd(os.path.dirname(path))
        launcher.set_environ([f"{key}={value}" for key, value in env.items()])
        try:
            launcher.spawnv([path])
            Gtk.RecentManager.get_default().add_item(file.get_uri())
        except GLib.Error as error:
            report(_("Could not run “%s”: %s") % (name, error.message))

    if executable:
        run()
        return True

    def done(dialog: Gtk.AlertDialog, result: Gio.AsyncResult) -> None:
        try:
            if dialog.choose_finish(result) != 1:
                return
        except GLib.Error:
            return
        try:
            os.chmod(path, with_exec_bits(info.get_attribute_uint32("unix::mode") & 0o7777))
        except OSError as error:
            report(_("Could not run “%s”: %s") % (name, error.strerror))
            return
        run()

    dialog = Gtk.AlertDialog(
        message=_("Run “%s”?") % name,
        detail=_("This is a program. Run it only if you trust where it came from."),
        buttons=[_("Cancel"), _("Allow and Run")], cancel_button=0, default_button=0)
    dialog.choose(parent.get_root(), None, done)
    return True
