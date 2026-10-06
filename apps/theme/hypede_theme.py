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
    hypede-theme store                каталог тем с GitHub (JSON)
    hypede-theme install РЕПОЗИТОРИЙ  установить тему из репозитория GitHub
    hypede-theme check РЕПОЗИТОРИЙ    проверить репозиторий перед публикацией

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
        ("live", SHELL, "wallpaper-live"),
        ("live-speed", SHELL, "wallpaper-live-speed"),
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
        ("genie", SHELL, "minimize-genie"),
        ("jelly", SHELL, "window-wobbly"),
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
MEDIA_KEYS = {("wallpaper", "light"), ("wallpaper", "dark"), ("wallpaper", "live"),
              ("lockscreen", "wallpaper")}
MEDIA_EXT = {".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".mp4", ".webm", ".mkv", ".mov"}
RESET_IF_MISSING = [("colors", "accent"), ("colors", "shelf"), ("colors", "menus"),
                    ("wallpaper", "live"), ("windows", "genie"), ("windows", "jelly"),
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


def _safe_uri(value, strict=False):
    """Обои — только локальные файлы, ресурсы GNOME и встроенные живые обои.

    Чужой теме (магазин, импорт) можно брать файлы только из системных
    каталогов и из папок тем, а не откуда угодно с диска."""
    if value == "" or value.startswith("resource:///") or re.fullmatch(r"hypede:[a-z-]+", value):
        return True
    if not value.startswith("file:///"):
        return False
    from urllib.parse import unquote
    path = Path(unquote(value[7:]))
    if ".." in path.parts:
        return False
    roots = [Path(d) for d in (os.environ.get("XDG_DATA_DIRS") or "/usr/local/share:/usr/share").split(":") if d]
    roots += [Path("/usr/share"), USER_DIR]
    try:
        real = path.resolve()
    except OSError:
        return False
    if any(real.is_relative_to(r.resolve()) for r in roots):
        return True
    if strict:
        return False
    # Своя тема: любой файл из домашней папки, кроме скрытых каталогов.
    home = Path.home().resolve()
    return real.is_relative_to(home) and not any(p.startswith(".") for p in real.relative_to(home).parts[:-1])


def load(path):
    path = Path(path)
    try:
        return parse(path.read_text(encoding="utf-8"), path.name)
    except (OSError, UnicodeDecodeError) as e:
        raise ThemeError(f"{path.name}: не JSON-файл темы ({e})")


def parse(text, name):
    path = Path(name)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ThemeError(f"{path.name}: не JSON-файл темы ({e})")
    if not isinstance(data, dict) or "hypede-theme" not in data:
        raise ThemeError(f"{path.name}: это не тема HypeDE")
    if not isinstance(data.get("hypede-theme"), int) or data["hypede-theme"] > FORMAT:
        raise ThemeError(f"{path.name}: тема для более новой версии HypeDE")
    return data


# ---------------------------------------------------------------------------
# Проверка файлов из чужих тем. Тема — данные, но картинки и видео разбирают
# системные библиотеки, и испорченный файл может бить по их уязвимостям.
# Поэтому: сигнатура должна совпасть с расширением; картинки пересобираются
# заново в отдельном процессе с лимитами памяти и времени (из файла остаются
# только пиксели); SVG — без скриптов, внешних ссылок и сущностей; видео
# проверяется разбором контейнера; если есть ClamAV — ещё и им.

MAGIC = {
    ".png": [(0, b"\x89PNG\r\n\x1a\n")],
    ".jpg": [(0, b"\xff\xd8\xff")],
    ".jpeg": [(0, b"\xff\xd8\xff")],
    ".gif": [(0, b"GIF87a"), (0, b"GIF89a")],
    ".webp": [(8, b"WEBP")],
    ".mp4": [(4, b"ftyp")],
    ".mov": [(4, b"ftyp"), (4, b"moov"), (4, b"wide"), (4, b"mdat")],
    ".webm": [(0, b"\x1a\x45\xdf\xa3")],
    ".mkv": [(0, b"\x1a\x45\xdf\xa3")],
}
PIXBUF_FORMAT = {".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".gif": "gif", ".webp": "webp"}
MAX_PIXELS = 64_000_000
MAX_SVG = 8 * 1024 * 1024

# Отдельный процесс: падение или зависание декодера не трогает hypede-theme.
_REBUILD = r"""
import resource, sys
resource.setrlimit(resource.RLIMIT_AS, (1 << 30, 1 << 30))
resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
import gi
gi.require_version("GdkPixbuf", "2.0")
from gi.repository import GdkPixbuf
src, dst, fmt, max_side = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
info, w, h = GdkPixbuf.Pixbuf.get_file_info(src)
if info and (info.get_name() != fmt or w * h > %d):
    sys.exit(3)
if fmt == "gif":
    anim = GdkPixbuf.PixbufAnimation.new_from_file(src)
    sys.exit(0 if anim.get_width() * anim.get_height() <= %d else 3)
pb = GdkPixbuf.Pixbuf.new_from_file(src)
w, h = pb.get_width(), pb.get_height()
if w <= 0 or h <= 0 or w * h > %d:
    sys.exit(3)
if max_side and max(w, h) > max_side:
    k = max_side / max(w, h)
    pb = pb.scale_simple(max(1, int(w * k)), max(1, int(h * k)), GdkPixbuf.InterpType.BILINEAR)
if fmt == "jpeg":
    pb.savev(dst, "jpeg", ["quality"], ["92"])
else:
    pb.savev(dst, "png", [], [])
""" % (MAX_PIXELS, MAX_PIXELS, MAX_PIXELS)


def _limited(argv, timeout=30):
    import subprocess
    env = dict(os.environ)
    # Декодеры (glycin, GStreamer) ищут свои модули в системных каталогах.
    env["XDG_DATA_DIRS"] = ":".join(filter(None, [env.get("XDG_DATA_DIRS"), "/usr/local/share", "/usr/share"]))
    try:
        return subprocess.run(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              timeout=timeout, env=env).returncode
    except (OSError, subprocess.TimeoutExpired):
        return -1


def _have_pixbuf():
    try:
        import gi
        gi.require_version("GdkPixbuf", "2.0")
        from gi.repository import GdkPixbuf  # noqa: F401
        return True
    except (ImportError, ValueError):
        return False


def _check_svg(raw):
    import xml.etree.ElementTree as ET
    if len(raw) > MAX_SVG:
        raise ThemeError("SVG слишком большой")
    text = raw.decode("utf-8", "strict")
    if re.search(r"<!DOCTYPE|<!ENTITY|<\?xml-stylesheet", text, re.I):
        raise ThemeError("SVG с DOCTYPE или сущностями")
    root = ET.fromstring(text)
    if root.tag.rsplit("}", 1)[-1] != "svg":
        raise ThemeError("это не SVG")
    bad_tags = {"script", "foreignobject", "iframe", "embed", "object", "audio", "video", "image", "use"}
    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1].lower()
        if tag in bad_tags and not (tag == "use" and all(
                v.startswith("#") for k, v in el.attrib.items() if k.rsplit("}", 1)[-1] == "href")):
            raise ThemeError(f"в SVG запрещённый элемент <{tag}>")
        for k, v in el.attrib.items():
            name = k.rsplit("}", 1)[-1].lower()
            if name.startswith("on"):
                raise ThemeError("в SVG обработчик событий")
            if name == "href" and not v.startswith("#"):
                raise ThemeError("в SVG внешняя ссылка")
            if re.search(r"url\(\s*['\"]?(?!#)", v, re.I) or "javascript:" in v.lower():
                raise ThemeError("в SVG внешний адрес")
        if tag == "style" and re.search(r"@import|url\(\s*['\"]?(?!#)", el.text or "", re.I):
            raise ThemeError("в SVG внешний стиль")
    return raw


def _clamscan(path):
    import shutil
    scanner = shutil.which("clamdscan") or shutil.which("clamscan")
    if scanner and _limited([scanner, "--no-summary", str(path)], timeout=120) == 1:
        raise ThemeError("антивирус ClamAV нашёл угрозу")


def check_media(name, raw, max_side=0):
    """Проверить и пересобрать файл темы. Возвращает (имя, байты) или ThemeError."""
    import shutil
    import tempfile
    ext = Path(name).suffix.lower()
    if ext not in MEDIA_EXT:
        raise ThemeError(f"{name}: такие файлы в темах не разрешены")
    if ext == ".svg":
        return name, _check_svg(raw)
    if not any(raw[off:off + len(sig)] == sig for off, sig in MAGIC[ext]):
        raise ThemeError(f"{name}: содержимое не совпадает с расширением {ext}")
    if ext == ".webp" and raw[:4] != b"RIFF":
        raise ThemeError(f"{name}: повреждённый WebP")
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / ("in" + ext)
        src.write_bytes(raw)
        _clamscan(src)
        if ext in PIXBUF_FORMAT:
            if not _have_pixbuf():
                return name, raw
            fmt = PIXBUF_FORMAT[ext]
            out_ext = ".gif" if fmt == "gif" else (".jpg" if fmt == "jpeg" else ".png")
            dst = Path(d) / ("out" + out_ext)
            code = _limited([sys.executable, "-I", "-c", _REBUILD, str(src), str(dst), fmt, str(max_side)])
            if code != 0:
                raise ThemeError(f"{name}: картинка не прошла проверку")
            if fmt == "gif":
                return name, raw
            return str(Path(name).with_suffix(out_ext)), dst.read_bytes()
        discoverer = shutil.which("gst-discoverer-1.0")
        if discoverer and _limited([discoverer, "-t", "15", src.as_uri()], timeout=30) != 0:
            raise ThemeError(f"{name}: видео не прошло проверку")
    return name, raw


def _extract_media(theme, target_dir, check=True):
    """Встроенные файлы → в каталог темы; адреса embedded:ИМЯ → file://."""
    files = theme.get("files") or {}
    if not isinstance(files, dict):
        return theme
    written = {}
    for name, blob in files.items():
        safe = Path(str(name)).name
        if not safe or safe.startswith(".") or Path(safe).suffix.lower() not in MEDIA_EXT or not isinstance(blob, str):
            continue
        try:
            raw = base64.b64decode(blob, validate=True)
        except ValueError:
            continue
        if len(raw) > MAX_EMBED:
            continue
        out = safe
        if check:
            try:
                out, raw = check_media(safe, raw)
            except (ThemeError, UnicodeDecodeError, SyntaxError) as e:
                print(f"hypede-theme: {safe} пропущен: {e}", file=sys.stderr)
                continue
        target_dir.mkdir(parents=True, exist_ok=True)
        (target_dir / out).write_bytes(raw)
        written[safe] = (target_dir / out).resolve().as_uri()
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
            if (group, field) in MEDIA_KEYS and isinstance(value, str) and \
                    not _safe_uri(value, strict=bool(theme.get("source") or theme.get("imported"))):
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
        "gnomeAccent": colors.get("gnome-accent") or "blue",
        "shelf": colors.get("shelf") or "",
        "menus": colors.get("menus") or "",
        "wallpaper": wall.get("dark") if colors.get("scheme") == "prefer-dark" else wall.get("light", ""),
        "source": str(t.get("source") or ""),
    }


def themes():
    out, seen = [], set()
    for d in system_dirs():
        # Тема по умолчанию — первой.
        for p in sorted(d.glob("*.json"), key=lambda p: (p.stem != "hypede", p.stem)):
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
    theme = _extract_media(_embed(theme), media_dir, check=False)
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
    theme["imported"] = True
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


# Магазин тем. Каталог — список репозиториев в store/themes.json репозитория
# HypeDE; сами темы лежат в репозиториях авторов (theme.json и preview.png
# в корне). Публикация — issue с адресом репозитория: GitHub Actions
# проверяет тему и дописывает её в каталог.
STORE_INDEX = os.environ.get("HYPEDE_STORE_INDEX") or \
    "https://raw.githubusercontent.com/hypede/hypede/main/store/themes.json"
STORE_ISSUE = "https://github.com/hypede/hypede/issues/new?template=theme.yml&title=Theme:+{repo}&repo={repo}"
REPO = re.compile(r"^(?:(?:https?://)?(?:www\.)?github\.com/)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:/.*)?$")
CACHE_DIR = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "hypede/store"


def parse_repo(text):
    m = REPO.match(text.strip().rstrip("/"))
    if not m or m.group(2) in (".", ".."):
        raise ThemeError(f"«{text}» — не адрес репозитория GitHub (нужно github.com/автор/репозиторий)")
    return f"{m.group(1)}/{m.group(2)}"


def fetch(url, limit=MAX_EMBED * 3 // 2):
    import urllib.error
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "hypede-theme"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read(limit + 1)
    except urllib.error.HTTPError as e:
        raise ThemeError("файл не найден" if e.code == 404 else f"GitHub ответил {e.code}")
    except (urllib.error.URLError, OSError) as e:
        raise ThemeError(f"нет связи с GitHub ({getattr(e, 'reason', e)})")
    if len(data) > limit:
        raise ThemeError("файл слишком большой")
    return data


SHA = re.compile(r"^[0-9a-f]{40}$")
OFFICIAL = "hypede/hypede"


def _raw(repo, path, ref="HEAD"):
    return f"https://raw.githubusercontent.com/{repo}/{ref}/{path}"


def validate(theme):
    """Все встроенные файлы темы проходят check_media — иначе ThemeError."""
    files = theme.get("files") or {}
    if not isinstance(files, dict):
        raise ThemeError("поле files должно быть объектом")
    for name, blob in files.items():
        safe = Path(str(name)).name
        try:
            raw = base64.b64decode(blob, validate=True)
        except (ValueError, TypeError):
            raise ThemeError(f"{safe}: испорченный base64")
        if len(raw) > MAX_EMBED:
            raise ThemeError(f"{safe}: файл больше {MAX_EMBED >> 20} МБ")
        try:
            check_media(safe, raw)
        except (UnicodeDecodeError, SyntaxError) as e:
            raise ThemeError(f"{safe}: {e}")


def fetch_theme(repo, path="theme.json", ref="HEAD"):
    try:
        text = fetch(_raw(repo, path, ref)).decode("utf-8")
    except UnicodeDecodeError:
        raise ThemeError(f"{repo}: {path} — не текстовый файл")
    except ThemeError as e:
        raise ThemeError(f"{repo}: нет {path} в корне репозитория" if "не найден" in str(e) else f"{repo}: {e}")
    theme = parse(text, path)
    if not str(theme.get("name") or "").strip():
        raise ThemeError(f"{repo}: у темы нет названия (поле name)")
    return theme


def _store_entry(entry):
    repo = parse_repo(str(entry.get("repo", "")))
    path = str(entry.get("path") or "theme.json")
    commit = str(entry.get("commit") or "")
    # Тема в каталоге закреплена за коммитом: автор не может тихо подменить её.
    if not SHA.match(commit) and repo.lower() != OFFICIAL:
        raise ThemeError(f"{repo}: в каталоге нет коммита")
    ref = commit or "HEAD"
    theme = fetch_theme(repo, path, ref)
    colors = theme.get("colors") or {}
    wall = theme.get("wallpaper") or {}
    wallpaper = wall.get("dark") if colors.get("scheme") == "prefer-dark" else wall.get("light", "")
    preview = ""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    target = CACHE_DIR / (repo.replace("/", "_") + "_" + Path(path).stem + ".png")
    try:
        raw = fetch(_raw(repo, str(Path(path).with_suffix(".png")) if path != "theme.json" else "preview.png", ref),
                    4 * 1024 * 1024)
        _, raw = check_media("preview.png", raw, max_side=1280)
        target.write_bytes(raw)
        preview = target.as_uri()
    except ThemeError:
        pass
    return {
        "id": f"store:{repo}:{path}",
        "repo": repo,
        "path": path,
        "ref": f"{repo}:{path}" + (f"@{commit}" if commit else ""),
        "verified": entry.get("verified") is True,
        "url": f"https://github.com/{repo}",
        "name": str(theme.get("name"))[:80],
        "author": str(theme.get("author") or repo.split("/")[0])[:80],
        "description": str(theme.get("description") or "")[:300],
        "scheme": colors.get("scheme", "default"),
        "accent": colors.get("accent") or "",
        "gnomeAccent": colors.get("gnome-accent") or "blue",
        "shelf": colors.get("shelf") or "",
        "menus": colors.get("menus") or "",
        "wallpaper": wallpaper if isinstance(wallpaper, str) and wallpaper.startswith("file:///usr/") else "",
        "preview": preview,
    }


def store():
    from concurrent.futures import ThreadPoolExecutor
    cache = CACHE_DIR / "store.json"
    try:
        index = json.loads(fetch(STORE_INDEX, 1024 * 1024))
        entries = [e for e in index.get("themes", []) if isinstance(e, dict)][:200]
    except (ThemeError, ValueError, AttributeError) as e:
        if cache.is_file():
            return json.loads(cache.read_text(encoding="utf-8"))
        raise ThemeError(f"каталог недоступен: {e}")

    def one(entry):
        try:
            return _store_entry(entry)
        except ThemeError:
            return None
    with ThreadPoolExecutor(8) as pool:
        out = [t for t in pool.map(one, entries) if t]
    installed = {t["source"] for t in themes() if t.get("source")}
    for t in out:
        t["installed"] = f"{t['repo']}:{t['path']}" in installed
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


def install(ref):
    """owner/repo, ссылка на репозиторий или owner/repo:путь/к/теме.json[@коммит]."""
    import tempfile
    repo, _, path = ref.partition(":") if not ref.startswith(("http:", "https:")) else (ref, "", "")
    path, _, commit = path.partition("@")
    if commit and not SHA.match(commit):
        raise ThemeError("неверный коммит")
    repo = parse_repo(repo)
    path = path or "theme.json"
    theme = fetch_theme(repo, path, commit or "HEAD")
    validate(theme)
    theme["source"] = f"{repo}:{path}"
    for t in themes():
        if t.get("source") == theme["source"] and t["id"].startswith("user:"):
            delete(t["id"])
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d) / "theme.json"
        tmp.write_text(json.dumps(theme, ensure_ascii=False), encoding="utf-8")
        return import_(tmp)


def check(ref):
    repo = parse_repo(ref)
    theme = fetch_theme(repo)
    validate(theme)
    return {"repo": repo, "name": str(theme.get("name")), "issue": STORE_ISSUE.format(repo=repo)}


def main(argv=None):
    import argparse
    if "HypeDE" in os.environ.get("XDG_CURRENT_DESKTOP", "").split(":") and "DCONF_PROFILE" not in os.environ:
        os.environ["DCONF_PROFILE"] = "hypede"
    p = argparse.ArgumentParser(prog="hypede-theme", description="Темы HypeDE")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    sub.add_parser("current")
    a = sub.add_parser("apply"); a.add_argument("theme")
    a.add_argument("--direct", action="store_true", help="свой файл: применить, не добавляя в темы")
    s = sub.add_parser("save"); s.add_argument("name"); s.add_argument("--author", default="")
    e = sub.add_parser("export"); e.add_argument("file"); e.add_argument("--name", default="")
    e.add_argument("--author", default=""); e.add_argument("--no-embed", action="store_true")
    e.add_argument("--theme", default=None, help="экспортировать эту тему, а не текущий вид")
    i = sub.add_parser("import"); i.add_argument("file")
    d = sub.add_parser("delete"); d.add_argument("theme")
    sub.add_parser("store")
    n = sub.add_parser("install"); n.add_argument("repo"); n.add_argument("--apply", action="store_true")
    c = sub.add_parser("check"); c.add_argument("repo")
    args = p.parse_args(argv)
    try:
        if args.cmd == "list":
            print(json.dumps(themes(), ensure_ascii=False))
        elif args.cmd == "current":
            print(json.dumps(current(), ensure_ascii=False, indent=2))
        elif args.cmd == "apply":
            path = resolve(args.theme)
            theme = load(path)
            if args.direct:
                theme.pop("imported", None)
                theme.pop("source", None)
                theme.pop("files", None)
            elif args.theme.startswith(("builtin:", "user:")):
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
        elif args.cmd == "store":
            print(json.dumps(store(), ensure_ascii=False))
        elif args.cmd == "install":
            ref = install(args.repo)
            if args.apply:
                path = resolve(ref)
                apply(_extract_media(load(path), path.parent / path.stem))
            print(ref)
        elif args.cmd == "check":
            print(json.dumps(check(args.repo), ensure_ascii=False))
    except ThemeError as e:
        print(f"hypede-theme: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
