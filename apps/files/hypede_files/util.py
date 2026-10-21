"""Мелкие помощники без зависимости от GTK — их удобно проверять тестами."""

from __future__ import annotations

import gettext
import os
import re
import shutil

_ = gettext.gettext
ngettext = gettext.ngettext


def _units() -> tuple[str, ...]:
    # Переводятся при вызове, а не при импорте: язык выбирается позже.
    return (_("kB"), _("MB"), _("GB"), _("TB"), _("PB"))


def format_size(size: int) -> str:
    """Размер в десятичных единицах, как в GNOME и COSMIC: 1 kB = 1000 B."""
    if size < 1000:
        return ngettext("%d byte", "%d bytes", size) % size
    units = _units()
    value = size / 1000
    unit = 0
    while value >= 1000 and unit < len(units) - 1:
        value /= 1000
        unit += 1
    return f"{value:.1f} {units[unit]}".replace(".0 ", " ")


def format_item_count(count: int) -> str:
    return ngettext("%d item", "%d items", count) % count


_COPY_SUFFIX = re.compile(r"^(?P<stem>.*?)(?: \((?P<n>\d+)\))?$")


def split_extension(name: str) -> tuple[str, str]:
    """Отделяет расширение, понимая двойные вроде .tar.gz; скрытые файлы
    («.bashrc») расширения не имеют."""
    if name.startswith(".") and name.count(".") == 1:
        return name, ""
    for double in (".tar.gz", ".tar.bz2", ".tar.xz", ".tar.zst"):
        if name.lower().endswith(double) and len(name) > len(double):
            return name[: -len(double)], name[-len(double):]
    stem, ext = os.path.splitext(name)
    return stem, ext


def unique_name(directory: str, name: str, exists=os.path.lexists) -> str:
    """Имя, под которым файл можно положить в каталог, ничего не затирая:
    «отчёт.pdf» → «отчёт (2).pdf» → «отчёт (3).pdf»."""
    if not exists(os.path.join(directory, name)):
        return name
    stem, ext = split_extension(name)
    match = _COPY_SUFFIX.match(stem)
    base = match.group("stem") if match else stem
    number = int(match.group("n")) + 1 if match and match.group("n") else 2
    while True:
        candidate = f"{base} ({number}){ext}"
        if not exists(os.path.join(directory, candidate)):
            return candidate
        number += 1


def validate_filename(name: str) -> str | None:
    """Возвращает текст ошибки или None, если имя годится."""
    if not name.strip():
        return _("The name cannot be empty")
    if "/" in name:
        return _("The name cannot contain “/”")
    if name in (".", ".."):
        return _("“%s” is not a valid name") % name
    if len(name.encode()) > 255:
        return _("The name is too long")
    return None


_TERMINALS = (
    ("hypede-terminal", ["--working-directory"]),
    ("xdg-terminal-exec", []),
    ("ptyxis", ["--new-window", "--working-directory"]),
    ("kgx", ["--working-directory"]),
    ("gnome-terminal", ["--working-directory"]),
    ("konsole", ["--workdir"]),
    ("cosmic-term", ["--working-directory"]),
    ("alacritty", ["--working-directory"]),
    ("kitty", ["--directory"]),
    ("wezterm", ["start", "--cwd"]),
    ("foot", ["--working-directory"]),
    ("xterm", []),
)


def terminal_command(directory: str) -> list[str] | None:
    """Команда запуска терминала в каталоге — первый найденный в PATH."""
    for program, args in _TERMINALS:
        path = shutil.which(program)
        if not path:
            continue
        if args:
            return [path, *args, directory]
        return [path]
    return None


# Файлы, которые запускаются, а не открываются: AppImage и программы ELF.
_APPIMAGE_TYPES = {"application/vnd.appimage", "application/x-iso9660-appimage"}
_ELF_TYPES = {"application/x-executable", "application/x-pie-executable"}


def is_appimage(name: str, content_type: str) -> bool:
    return name.lower().endswith(".appimage") or content_type in _APPIMAGE_TYPES


def is_program(name: str, content_type: str, executable: bool) -> bool:
    """Двойной щелчок запускает файл, а не ищет программу для открытия.
    Программы, собранные как PIE, GLib часто называет x-sharedlib — их
    отличаем от библиотек по биту запуска и отсутствию «.so» в имени."""
    if is_appimage(name, content_type) or content_type in _ELF_TYPES:
        return True
    return content_type == "application/x-sharedlib" and executable and ".so" not in name


def with_exec_bits(mode: int) -> int:
    """Право на запуск тем, кому файл можно читать (как chmod +x)."""
    return mode | ((mode & 0o444) >> 2)


def appimage_env(env: dict[str, str], has_fuse2: bool) -> dict[str, str]:
    """Старые AppImage монтируют себя через libfuse2. Без неё просим
    распаковаться во временный каталог — медленнее, но запускается."""
    env = dict(env)
    if not has_fuse2:
        env["APPIMAGE_EXTRACT_AND_RUN"] = "1"
    return env
