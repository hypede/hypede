#!/bin/bash
# Запускает GNOME Shell с HypeDE без экрана (виртуальный монитор) — для
# проверки расширения и скриншотов в контейнере или по SSH.
#
#   tools/dev/shell-headless.sh start [WxH]   — запустить
#   tools/dev/shell-headless.sh shot FILE     — снимок экрана
#   tools/dev/shell-headless.sh eval 'JS'     — выполнить JS в оболочке
#   tools/dev/shell-headless.sh stop
set -euo pipefail

STATE=${HYPEDE_DEV_STATE:-/tmp/hypede-dev}
mkdir -p "$STATE"
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-$STATE/run}
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"

bus() {
    DBUS_SESSION_BUS_ADDRESS=$(cat "$STATE/bus") "$@"
}

case "${1:-}" in
start)
    size=${2:-1600x900}
    # Файл-предохранитель остаётся после аварийного выхода и выключает
    # расширения при следующем запуске — для отладки он только мешает.
    rm -f "$XDG_RUNTIME_DIR/gnome-shell-disable-extensions"
    dbus-daemon --session --fork --print-address=1 --print-pid=1 > "$STATE/dbus.out"
    head -1 "$STATE/dbus.out" > "$STATE/bus"
    export DBUS_SESSION_BUS_ADDRESS=$(cat "$STATE/bus")
    export XDG_CURRENT_DESKTOP=HypeDE:GNOME XDG_SESSION_TYPE=wayland
    # Как в настоящем сеансе (см. session/hypede-session.in): своя база
    # настроек и каталог оболочки HypeDE.
    export DCONF_PROFILE=hypede HYPEDE_SESSION=1
    export XDG_DATA_DIRS=/usr/share/hypede/shell:/usr/local/share:/usr/share
    nohup gnome-shell --headless --wayland --no-x11 --virtual-monitor "$size" \
        --mode="${HYPEDE_MODE:-hypede-dev}" > "$STATE/shell.log" 2>&1 &
    echo $! > "$STATE/shell.pid"
    for _ in $(seq 60); do
        if bus gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
            --method org.freedesktop.DBus.Peer.Ping >/dev/null 2>&1; then
            sleep 3
            echo "оболочка запущена, WAYLAND_DISPLAY=wayland-0"
            exit 0
        fi
        sleep 1
    done
    echo "оболочка не ответила, см. $STATE/shell.log" >&2
    exit 1
    ;;
shot)
    # Снимок через Eval: D-Bus-метод Screenshot запрещён на экране блокировки.
    bus gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "(async () => {
            const file = imports.gi.Gio.File.new_for_path('$2');
            const stream = file.replace(null, false, 0, null);
            await new imports.gi.Shell.Screenshot().screenshot(false, stream);
            stream.close(null);
        })(); '$2'"
    sleep 0.3
    ;;
eval)
    bus gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$2"
    ;;
run)
    shift
    export DBUS_SESSION_BUS_ADDRESS=$(cat "$STATE/bus") WAYLAND_DISPLAY=wayland-0
    export XDG_CURRENT_DESKTOP=HypeDE:GNOME XDG_SESSION_TYPE=wayland GDK_BACKEND=wayland QT_QPA_PLATFORM=wayland
    export DCONF_PROFILE=hypede HYPEDE_SESSION=1
    nohup "$@" > "$STATE/app-$(basename "$1").log" 2>&1 &
    ;;
stop)
    kill "$(cat "$STATE/shell.pid")" 2>/dev/null || true
    kill "$(sed -n 2p "$STATE/dbus.out")" 2>/dev/null || true
    ;;
*)
    sed -n '2,9p' "$0"
    exit 1
    ;;
esac
