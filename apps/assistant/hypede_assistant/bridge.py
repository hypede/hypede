"""Доступ локального помощника к файлам — только чтение.

Чат (local/chat.html) просит через мост WebKit:
    {"cmd": "read", "path": "~/Документы/план.txt"}  файл или список папки
    {"cmd": "find", "name": "отчёт"}                  файлы с таким именем в ~
Ответ — JSON. Читается только домашняя папка и /tmp; большие файлы
обрезаются, двоичные не показываются.
"""

from __future__ import annotations

import os
import time

MAX_TEXT = 12000
MAX_ENTRIES = 200
FIND_LIMIT = 40
FIND_SECONDS = 2.0


def _allowed(path: str) -> bool:
    real = os.path.realpath(path)
    home = os.path.realpath(os.path.expanduser("~"))
    return real == home or real.startswith(home + os.sep) or real.startswith("/tmp" + os.sep)


def _expand(path: str) -> str:
    path = os.path.expanduser(path.strip())
    if not os.path.exists(path):
        # «~/Загрузки» у англоязычной системы — ~/Downloads и наоборот.
        aliases = {"Загрузки": "Downloads", "Документы": "Documents", "Изображения": "Pictures",
                   "Музыка": "Music", "Видео": "Videos", "Рабочий стол": "Desktop"}
        for ru, en in aliases.items():
            for a, b in ((ru, en), (en, ru)):
                candidate = path.replace(os.sep + a, os.sep + b, 1)
                if candidate != path and os.path.exists(candidate):
                    return candidate
    return path


def read(path: str) -> dict:
    path = _expand(path)
    if not os.path.exists(path):
        return {"kind": "missing", "path": path}
    if not _allowed(path):
        return {"kind": "denied", "path": path}
    if os.path.isdir(path):
        try:
            names = sorted(os.listdir(path), key=lambda n: (not os.path.isdir(os.path.join(path, n)), n.lower()))
        except OSError as error:
            return {"kind": "error", "message": error.strerror}
        entries = [n + ("/" if os.path.isdir(os.path.join(path, n)) else "") for n in names if not n.startswith(".")]
        return {"kind": "dir", "path": path, "entries": entries[:MAX_ENTRIES]}
    try:
        with open(path, "rb") as fh:
            data = fh.read(MAX_TEXT * 4)
    except OSError as error:
        return {"kind": "error", "message": error.strerror}
    if b"\0" in data[:4096]:
        return {"kind": "file", "path": path, "text": "(binary file, %d bytes)" % os.path.getsize(path)}
    text = data.decode("utf-8", errors="replace")
    if len(text) > MAX_TEXT:
        text = text[:MAX_TEXT] + "\n…"
    return {"kind": "file", "path": path, "text": text}


def find(name: str) -> dict:
    """Файлы и папки, в имени которых есть name, в домашней папке."""
    needle = name.lower()
    home = os.path.expanduser("~")
    found: list[str] = []
    deadline = time.monotonic() + FIND_SECONDS
    for root, dirs, files in os.walk(home):
        # Скрытые папки и кеши не смотрим: там тысячи файлов.
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "__pycache__")]
        for item in dirs + files:
            if needle in item.lower():
                found.append(os.path.join(root, item).replace(home, "~", 1))
                if len(found) >= FIND_LIMIT:
                    return {"paths": found}
        if time.monotonic() > deadline:
            break
    return {"paths": found}


def handle(command: dict) -> dict:
    cmd = command.get("cmd")
    if cmd == "read":
        return read(str(command.get("path", "")))
    if cmd == "find":
        return find(str(command.get("name", "")))
    return {"kind": "error", "message": "unknown command"}
