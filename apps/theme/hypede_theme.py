"""Темы HypeDE: применить, сохранить, импортировать и экспортировать.

Тема — JSON-файл (расширение .json или .txt — всё равно). В нём только
внешний вид: цвета, обои, полка, лаунчер, окна, экран блокировки, шрифты и
значки. Чужая тема не может поменять ничего, кроме ключей из TABLE ниже, и
значения проверяются по типам схемы.

    hypede-theme list                 темы (JSON) — встроенные и свои
    hypede-theme apply ID|ФАЙЛ        применить
    hypede-theme save "Название"      сохранить текущий вид как свою тему
    hypede-theme export ФАЙЛ [--name N] [--author A] [--no-embed]
    hypede-theme import ФАЙЛ          добавить тему в свои (не применяя)
    hypede-theme delete ID            удалить свою тему
    hypede-theme current              текущий вид в формате темы

Обои, которых нет в системе, при экспорте встраиваются в файл (base64),
поэтому тему можно просто переслать.
"""

import base64
import json
import os
import re
import sys
from pathlib import Path

FORMAT = 1
SHELL = "dev.hypede.shell"
IFACE = "org.gnome.desktop.interface"
BG = "org.gnome.desktop.background"

# Группа в файле → [(имя в файле, схема, ключ), …]
TABLE = {
    "colors": [
        ("scheme", IFACE, "color-scheme"),
        ("accent", SHELL, "accent-custom"),
        ("gnome-accent", IFACE, "accent-color"),
        ("shelf", SHELL, "shelf-color"),
        ("menus", SHELL, "launcher-color"),
    ],
    "wallpaper": [
        ("light", BG, "picture-uri"),
        ("dark", BG, "picture-uri-dark"),
        ("fit", BG, "picture-options"),
        ("color", BG, "primary-color"),
        ("animated", SHELL, "wallpaper-video"),
        ("animated-light", SHELL, "wallpaper-video-light"),
    ],
    "shelf": [
        ("position", SHELL, "shelf-position"),
        ("alignment", SHELL, "shelf-alignment"),
        ("style", SHELL, "shelf-style"),
        ("size", SHELL, "shelf-size"),
        ("icon-size", SHELL, "shelf-icon-size"),
        ("opacity", SHELL, "shelf-opacity"),
        ("blur", SHELL, "shelf-blur"),
        ("indicator", SHELL, "shelf-running-indicator"),
        ("hover-zoom", SHELL, "shelf-hover-zoom"),
        ("show-date", SHELL, "show-date"),
    ],
    "launcher": [
        ("style", SHELL, "launcher-style"),
        ("columns", SHELL, "launcher-columns"),
        ("icon-size", SHELL, "launcher-icon-size"),
        ("labels", SHELL, "launcher-show-labels"),
        ("opacity", SHELL, "launcher-opacity"),
        ("blur", SHELL, "launcher-blur"),
    ],
    "desktop": [
        ("icons", SHELL, "desktop-icons"),
        ("icon-size", SHELL, "desktop-icon-size"),
        ("show-home", SHELL, "desktop-show-home"),
        ("show-trash", SHELL, "desktop-show-trash"),
    ],
    "windows": [
        ("corner-radius", SHELL, "corner-radius"),
        ("rounded-windows", SHELL, "window-corners"),
        ("window-radius", SHELL, "window-corner-radius"),
        ("animations", SHELL, "window-animations"),
        ("animation-speed", SHELL, "animation-speed"),
        ("buttons", "org.gnome.desktop.wm.preferences", "button-layout"),
        ("notifications", SHELL, "notification-position"),
        ("greeting", SHELL, "greeting"),
    ],
    "lockscreen": [
        ("style", SHELL, "lock-style"),
        ("clock", SHELL, "lock-clock-style"),
        ("clock-color", SHELL, "lock-clock-color"),
        ("clock-size", SHELL, "lock-clock-size"),
        ("message", SHELL, "lock-message"),
        ("wallpaper", SHELL, "lock-wallpaper"),
        ("blur", SHELL, "lock-blur"),
        ("dim", SHELL, "lock-dim"),
        ("waves", SHELL, "lock-intro-animation"),
        ("cards", SHELL, "lock-show-cards"),
    ],
    "fonts": [
        ("interface", IFACE, "font-name"),
        ("documents", IFACE, "document-font-name"),
        ("monospace", IFACE, "monospace-font-name"),
    ],
    "icons": [
        ("theme", IFACE, "icon-theme"),
        ("cursor", IFACE, "cursor-theme"),
        ("cursor-size", IFACE, "cursor-size"),
    ],
    "sounds": [
        ("theme", "org.gnome.desktop.sound", "theme-name"),
    ],
}

# Ключи-адреса картинок и видео: их можно встроить в файл.
MEDIA_KEYS = {("wallpaper", "light"), ("wallpaper", "dark"), ("wallpaper", "animated"),
              ("wallpaper", "animated-light"), ("lockscreen", "wallpaper")}
MEDIA_EXT = {".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".mp4", ".webm", ".mkv", ".mov"}
RESET_IF_MISSING = [("colors", "accent"), ("colors", "shelf"), ("colors", "menus"),
                    ("wallpaper", "animated"), ("wallpaper", "animated-light"),
                    ("lockscreen", "clock-color"), ("lockscreen", "wallpaper"), ("lockscreen", "message")]
MAX_EMBED = 64 * 1024 * 1024
COLOR_KEYS = {"accent-custom", "shelf-color", "launcher-color", "lock-clock-color"}
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def _data_home():
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share")


USER_DIR = _data_home() / "hypede/themes"


def system_dirs():
    dirs = os.environ.get("XDG_DATA_DIRS") or "/usr/local/share:/usr/share"
    seen = []
    for d in dirs.split(":"):
        p = Path(d) / "hypede/themes"
        if d and p not in seen:
            seen.append(p)
    return seen


def _gio():
    import gi
    gi.require_version("Gio", "2.0")
    from gi.repository import Gio, GLib
    return Gio, GLib


_settings_cache = {}


def _settings(schema_id):
    """GSettings схемы или None, если схемы нет."""
    if schema_id not in _settings_cache:
        Gio, _ = _gio()
        source = Gio.SettingsSchemaSource.get_default()
        schema = source.lookup(schema_id, True) if source else None
        _settings_cache[schema_id] = (Gio.Settings.new(schema_id), schema) if schema else (None, None)
    return _settings_cache[schema_id]


def slug(name):
    s = re.sub(r"[^\w-]+", "-", name.strip().lower(), flags=re.UNICODE).strip("-")
    return s or "theme"


# ---------------------------------------------------------------------------
# Чтение текущего вида

def _to_json(variant):
    t = variant.get_type_string()
    if t in ("s", "b", "i", "u", "d"):
        return variant.unpack()
    if t == "as":
        return list(variant.unpack())
    return None


def current(name="", author=""):
    theme = {"hypede-theme": FORMAT, "name": name, "author": author}
    for group, rows in TABLE.items():
        out = {}
        for field, schema_id, key in rows:
            settings, schema = _settings(schema_id)
            if not settings or not schema.has_key(key):
                continue
            value = _to_json(settings.get_value(key))
            if value is not None:
                out[field] = value
        if out:
            theme[group] = out
    return theme


# ---------------------------------------------------------------------------
# Проверка и применение

class ThemeError(Exception):
    pass


def _variant_for(schema, key, value):
    """JSON-значение → GLib.Variant нужного типа, с проверкой диапазона."""
    _, GLib = _gio()
    k = schema.get_key(key)
    t = k.get_value_type().dup_string()
    try:
        if t == "s":
            if not isinstance(value, str) or len(value) > 4096:
                return None
            if key in COLOR_KEYS and value and not HEX.match(value):
                return None
            variant = GLib.Variant("s", value)
        elif t == "b":
            if not isinstance(value, bool):
                return None
            variant = GLib.Variant("b", value)
        elif t in ("i", "u"):
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return None
            variant = GLib.Variant(t, int(value))
        elif t == "d":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return None
            variant = GLib.Variant("d", float(value))
        else:
            return None
    except (TypeError, OverflowError, ValueError):
        return None
    return variant if k.range_check(variant) else None


def _safe_uri(value):
    """Обои — только локальные файлы или ресурсы GNOME."""
    return value == "" or value.startswith("file:///") or value.startswith("resource:///")


def load(path):
    path = Path(path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ThemeError(f"{path.name}: не JSON-файл темы ({e})")
    if not isinstance(data, dict) or "hypede-theme" not in data:
        raise ThemeError(f"{path.name}: это не тема HypeDE")
    if not isinstance(data.get("hypede-theme"), int) or data["hypede-theme"] > FORMAT:
        raise ThemeError(f"{path.name}: тема для более новой версии HypeDE")
    return data


def _extract_media(theme, target_dir):
    """Встроенные файлы → в каталог темы; адреса embedded:ИМЯ → file://."""
    files = theme.get("files") or {}
    if not isinstance(files, dict):
        return theme
    written = {}
    for name, blob in files.items():
        safe = Path(str(name)).name
        if not safe or Path(safe).suffix.lower() not in MEDIA_EXT or not isinstance(blob, str):
            continue
        try:
            raw = base64.b64decode(blob, validate=True)
        except ValueError:
            continue
        if len(raw) > MAX_EMBED:
            continue
        target_dir.mkdir(parents=True, exist_ok=True)
        (target_dir / safe).write_bytes(raw)
        written[safe] = (target_dir / safe).resolve().as_uri()
    for group, field in MEDIA_KEYS:
        value = (theme.get(group) or {}).get(field)
        if isinstance(value, str) and value.startswith("embedded:"):
            theme[group][field] = written.get(Path(value[9:]).name, "")
    theme.pop("files", None)
    return theme


def apply(theme):
    """Записать значения темы. Возвращает число применённых ключей."""
    count = 0
    changed = []
    for group, rows in TABLE.items():
        values = theme.get(group)
        if not isinstance(values, dict):
            continue
        for field, schema_id, key in rows:
            if field not in values:
                continue
            settings, schema = _settings(schema_id)
            if not settings or not schema.has_key(key):
                continue
            value = values[field]
            if (group, field) in MEDIA_KEYS and isinstance(value, str) and not _safe_uri(value):
                continue
            variant = _variant_for(schema, key, value)
            if variant is None:
                continue
            settings.set_value(key, variant)
            changed.append(settings)
            count += 1
    # Цвета и картинки, которых в теме нет, — по умолчанию: иначе от
    # прошлой темы остался бы, например, розовый акцент.
    for group, field in RESET_IF_MISSING:
        if field in (theme.get(group) or {}):
            continue
        schema_id, key = next((s, k) for f, s, k in TABLE[group] if f == field)
        settings, schema = _settings(schema_id)
        if settings and schema.has_key(key):
            settings.reset(key)
    settings, schema = _settings(SHELL)
    if settings and schema.has_key("theme-name"):
        settings.set_string("theme-name", str(theme.get("name", ""))[:200])
    Gio, _ = _gio()
    Gio.Settings.sync()
    return count


# ---------------------------------------------------------------------------
# Список, сохранение, экспорт

def _summary(path, builtin):
    try:
        t = load(path)
    except ThemeError:
        return None
    colors = t.get("colors") or {}
    wall = t.get("wallpaper") or {}
    return {
        "id": ("builtin:" if builtin else "user:") + path.stem,
        "name": str(t.get("name") or path.stem),
        "author": str(t.get("author") or ""),
        "description": str(t.get("description") or ""),
        "builtin": builtin,
        "path": str(path),
        "scheme": colors.get("scheme", "default"),
        "accent": colors.get("accent") or "",
        "shelf": colors.get("shelf") or "",
        "menus": colors.get("menus") or "",
        "wallpaper": wall.get("dark") if colors.get("scheme") == "prefer-dark" else wall.get("light", ""),
    }


def themes():
    out, seen = [], set()
    for d in system_dirs():
        for p in sorted(d.glob("*.json")):
            if p.stem not in seen:
                seen.add(p.stem)
                s = _summary(p, True)
                if s:
                    out.append(s)
    if USER_DIR.is_dir():
        for p in sorted(USER_DIR.glob("*.json")):
            s = _summary(p, False)
            if s:
                out.append(s)
    return out


def resolve(ref):
    """ID из списка или путь к файлу → путь."""
    if ref.startswith("builtin:"):
        for d in system_dirs():
            p = d / f"{ref[8:]}.json"
            if p.is_file():
                return p
    elif ref.startswith("user:"):
        p = USER_DIR / f"{Path(ref[5:]).name}.json"
        if p.is_file():
            return p
    elif Path(ref).is_file():
        return Path(ref)
    raise ThemeError(f"тема «{ref}» не найдена")


def _embed(theme):
    """Файлы обоев, которых нет в системных каталогах, — внутрь темы."""
    Gio, _ = _gio()
    files = {}
    for group, field in MEDIA_KEYS:
        value = (theme.get(group) or {}).get(field)
        if not isinstance(value, str) or not value.startswith("file://"):
            continue
        path = Path(Gio.File.new_for_uri(value).get_path() or "")
        if not path.is_file() or str(path).startswith(("/usr/", "/opt/")):
            continue
        if path.suffix.lower() not in MEDIA_EXT or path.stat().st_size > MAX_EMBED:
            continue
        name = path.name
        while name in files and files[name][0] != path:
            name = f"{Path(name).stem}-1{path.suffix}"
        files[name] = (path, None)
        theme[group][field] = f"embedded:{name}"
    if files:
        theme["files"] = {n: base64.b64encode(p.read_bytes()).decode() for n, (p, _) in files.items()}
    return theme


def save(name, author=""):
    USER_DIR.mkdir(parents=True, exist_ok=True)
    base = slug(name)
    path = USER_DIR / f"{base}.json"
    theme = current(name, author)
    # Свои картинки — копией рядом, чтобы тема не зависела от «Загрузок».
    media_dir = USER_DIR / base
    theme = _extract_media(_embed(theme), media_dir)
    path.write_text(json.dumps(theme, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    settings, _ = _settings(SHELL)
    if settings:
        settings.set_string("theme-name", name)
        _gio()[0].Settings.sync()
    return "user:" + base


def export(path, name="", author="", embed=True, ref=None):
    theme = load(resolve(ref)) if ref else current(name, author)
    if name:
        theme["name"] = name
    if author:
        theme["author"] = author
    if not theme.get("name"):
        settings, _ = _settings(SHELL)
        theme["name"] = (settings.get_string("theme-name") if settings else "") or "My theme"
    if embed:
        theme = _embed(theme)
    Path(path).write_text(json.dumps(theme, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def import_(path):
    theme = load(path)
    name = str(theme.get("name") or Path(path).stem)[:200]
    base = slug(name)
    target = USER_DIR / f"{base}.json"
    n = 2
    while target.exists():
        target = USER_DIR / f"{base}-{n}.json"
        n += 1
    USER_DIR.mkdir(parents=True, exist_ok=True)
    theme = _extract_media(theme, USER_DIR / target.stem)
    theme["name"] = name
    target.write_text(json.dumps(theme, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return "user:" + target.stem


def delete(ref):
    if not ref.startswith("user:"):
        raise ThemeError("встроенные темы удалить нельзя")
    path = resolve(ref)
    media = USER_DIR / path.stem
    path.unlink()
    if media.is_dir():
        for f in media.iterdir():
            f.unlink()
        media.rmdir()


def main(argv=None):
    import argparse
    if "HypeDE" in os.environ.get("XDG_CURRENT_DESKTOP", "").split(":") and "DCONF_PROFILE" not in os.environ:
        os.environ["DCONF_PROFILE"] = "hypede"
    p = argparse.ArgumentParser(prog="hypede-theme", description="Темы HypeDE")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    sub.add_parser("current")
    a = sub.add_parser("apply"); a.add_argument("theme")
    s = sub.add_parser("save"); s.add_argument("name"); s.add_argument("--author", default="")
    e = sub.add_parser("export"); e.add_argument("file"); e.add_argument("--name", default="")
    e.add_argument("--author", default=""); e.add_argument("--no-embed", action="store_true")
    e.add_argument("--theme", default=None, help="экспортировать эту тему, а не текущий вид")
    i = sub.add_parser("import"); i.add_argument("file")
    d = sub.add_parser("delete"); d.add_argument("theme")
    args = p.parse_args(argv)
    try:
        if args.cmd == "list":
            print(json.dumps(themes(), ensure_ascii=False))
        elif args.cmd == "current":
            print(json.dumps(current(), ensure_ascii=False, indent=2))
        elif args.cmd == "apply":
            path = resolve(args.theme)
            theme = load(path)
            if args.theme.startswith(("builtin:", "user:")):
                theme = _extract_media(theme, path.parent / path.stem)
            else:
                # Файл со стороны: сначала в свои темы, потом применить.
                theme = load(resolve(import_(path)))
            print(apply(theme))
        elif args.cmd == "save":
            print(save(args.name, args.author))
        elif args.cmd == "export":
            export(args.file, args.name, args.author, not args.no_embed, args.theme)
        elif args.cmd == "import":
            print(import_(args.file))
        elif args.cmd == "delete":
            delete(args.theme)
    except ThemeError as e:
        print(f"hypede-theme: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
