"""Локальный ИИ HypeDE: llama.cpp и маленькая модель Gemma на этом компьютере.

    hypede-ai install [--model small|large]   поставить движок и модель, включить
    hypede-ai serve                           запустить llama-server (так его
                                              запускает служба hypede-ai.service)
    hypede-ai status                          что установлено и работает ли
    hypede-ai remove                          удалить модель и выключить службу

Движок — пакет llama-cpp (его ставит pacman после пароля администратора),
модель — файл GGUF с Hugging Face в ~/.local/share/hypede/ai. Сервер слушает
только 127.0.0.1, наружу ничего не уходит. Ход установки install печатает
строками JSON: {"step": "engine"|"model"|"service"|"done"|"error", ...} — их
читает тур «Добро пожаловать».
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import urllib.request

import gi

if "HypeDE" in os.environ.get("XDG_CURRENT_DESKTOP", "").split(":"):
    os.environ["DCONF_PROFILE"] = "hypede"

from gi.repository import Gio, GLib  # noqa: E402

SCHEMA = "dev.hypede.assistant"
SERVICE = "hypede-ai.service"
PORT = 8765

# Модели: маленькая быстрая и побольше, поумнее. Обе — Gemma 3, без
# регистрации на Hugging Face (выкладка ggml-org).
MODELS = {
    "small": {
        "name": "Gemma 3 270M",
        "file": "gemma-3-270m-it-Q8_0.gguf",
        "url": "https://huggingface.co/ggml-org/gemma-3-270m-it-GGUF/resolve/main/gemma-3-270m-it-Q8_0.gguf",
        "size": 291545600,
    },
    "large": {
        "name": "Gemma 3 1B",
        "file": "gemma-3-1b-it-Q4_K_M.gguf",
        "url": "https://huggingface.co/ggml-org/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf",
        "size": 806058240,
    },
}


def data_dir() -> str:
    return os.path.join(GLib.get_user_data_dir(), "hypede", "ai")


def settings() -> Gio.Settings | None:
    source = Gio.SettingsSchemaSource.get_default()
    if source and source.lookup(SCHEMA, True):
        return Gio.Settings(schema_id=SCHEMA)
    return None


def chosen_model() -> str:
    s = settings()
    model = s.get_string("local-model") if s else "small"
    return model if model in MODELS else "small"


def model_path(model: str | None = None) -> str:
    return os.path.join(data_dir(), MODELS[model or chosen_model()]["file"])


def engine() -> str | None:
    return shutil.which("llama-server")


def report(step: str, **fields) -> None:
    print(json.dumps({"step": step, **fields}), flush=True)


def install_engine() -> bool:
    if engine():
        return True
    report("engine")
    # Пакет есть в репозитории Arch (extra/llama-cpp) и Arch Linux ARM.
    if not shutil.which("pacman"):
        report("error", message="llama.cpp is not installed and pacman is missing")
        return False
    result = subprocess.run(["pkexec", "pacman", "-S", "--needed", "--noconfirm", "llama-cpp"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0 or not engine():
        report("error", message=(result.stderr.strip().splitlines() or ["llama-cpp was not installed"])[-1])
        return False
    return True


def download_model(model: str) -> bool:
    info = MODELS[model]
    path = model_path(model)
    if os.path.exists(path) and os.path.getsize(path) == info["size"]:
        return True
    os.makedirs(data_dir(), exist_ok=True)
    partial = path + ".part"
    done = os.path.getsize(partial) if os.path.exists(partial) else 0
    request = urllib.request.Request(info["url"], headers={"User-Agent": "HypeDE"})
    if done:
        request.add_header("Range", f"bytes={done}-")
    try:
        with urllib.request.urlopen(request, timeout=60) as response, open(partial, "ab" if done else "wb") as out:
            if done and response.status != 206:
                out.truncate(0)
                done = 0
            last = -1
            while chunk := response.read(1 << 20):
                out.write(chunk)
                done += len(chunk)
                percent = int(done * 100 / info["size"])
                if percent != last:
                    report("model", done=done, total=info["size"], percent=percent)
                    last = percent
    except OSError as error:
        report("error", message=str(error))
        return False
    if os.path.getsize(partial) != info["size"]:
        report("error", message="the download is incomplete, try again")
        return False
    os.replace(partial, path)
    return True


def write_service() -> None:
    unit_dir = os.path.join(GLib.get_user_config_dir(), "systemd", "user")
    os.makedirs(unit_dir, exist_ok=True)
    program = shutil.which("hypede-ai") or os.path.abspath(sys.argv[0])
    with open(os.path.join(unit_dir, SERVICE), "w") as unit:
        unit.write(f"""[Unit]
Description=HypeDE local AI (llama.cpp)
After=graphical-session.target
PartOf=graphical-session.target

[Service]
ExecStart={program} serve
Restart=on-failure
RestartSec=5
Nice=10

[Install]
WantedBy=graphical-session.target
""")


def systemctl(*args: str) -> bool:
    return subprocess.run(["systemctl", "--user", *args], stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL).returncode == 0


def install(model: str) -> int:
    s = settings()
    if s:
        s.set_string("local-model", model)
    if not install_engine() or not download_model(model):
        return 1
    report("service")
    write_service()
    systemctl("daemon-reload")
    systemctl("enable", SERVICE)
    systemctl("restart", SERVICE)
    if s:
        s.set_string("provider", "local")
        s.set_boolean("enabled", True)
    report("done", model=MODELS[model]["name"])
    return 0


def serve() -> int:
    server = engine()
    path = model_path()
    if not server or not os.path.exists(path):
        print("hypede-ai: run «hypede-ai install» first", file=sys.stderr)
        return 1
    threads = max(1, min(os.cpu_count() or 2, 8) - 1)
    os.execv(server, [server, "-m", path, "--host", "127.0.0.1", "--port", str(PORT), "-c", "8192",
                      "-t", str(threads), "--jinja", "--no-webui"])
    return 0


def status() -> int:
    model = chosen_model()
    installed = os.path.exists(model_path(model))
    running = systemctl("is-active", "--quiet", SERVICE)
    print(json.dumps({"engine": bool(engine()), "model": MODELS[model]["name"], "installed": installed,
                      "running": running, "port": PORT}))
    return 0


def remove() -> int:
    systemctl("disable", "--now", SERVICE)
    for info in MODELS.values():
        for suffix in ("", ".part"):
            try:
                os.remove(os.path.join(data_dir(), info["file"] + suffix))
            except FileNotFoundError:
                pass
    s = settings()
    if s and s.get_string("provider") == "local":
        s.reset("provider")
    return 0


def main() -> int:
    args = sys.argv[1:]
    command = args[0] if args else "status"
    if command == "install":
        model = args[args.index("--model") + 1] if "--model" in args else "small"
        return install(model if model in MODELS else "small")
    if command == "serve":
        return serve()
    if command == "remove":
        return remove()
    if command == "status":
        return status()
    print(__doc__)
    return 2
