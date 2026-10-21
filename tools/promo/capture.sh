#!/bin/bash
# Снимает кадры (/tmp/vs) и анимированные сцены (/tmp/rec) для promo.py.
# Нужен безэкранный сеанс в 1920x1080 с анимациями:
#   HYPEDE_DEV_ANIMATIONS=1 tools/dev/shell-headless.sh start 1920x1080
# Затем:
#   tools/promo/capture.sh [часть…]   — части: greeting launcher desktop quick
#                                       clip live themes settings lock (по умолчанию все)
#   python3 tools/promo/music.py && python3 tools/promo/promo.py wide   (и vertical)
#   ffmpeg -framerate 60 -i /tmp/frames-wide/%05d.jpg -i /tmp/vs/music.wav \
#          -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -shortest promo-wide.mp4
# Сцены пишутся по одной: пока идёт запись, оболочка занята снимками экрана.
set -u
cd "$(dirname "$0")/../.."
VS=/tmp/vs; mkdir -p "$VS" /tmp/rec
STATE=${HYPEDE_DEV_STATE:-/tmp/hypede-dev}
H=tools/dev/shell-headless.sh
REC="bash tools/promo/recseg.sh"
L='Main.panel.statusArea["hypede-launcher"]'
EXT='Main.extensionManager.lookup("hypede-shell@hypede.dev").stateObj'
cp tools/promo/rec.js /tmp/rec.js
rsvg-convert -w 640 branding/hypede-logo.svg -o "$VS/logo.png"

export DBUS_SESSION_BUS_ADDRESS=$(cat "$STATE/bus") DCONF_PROFILE=hypede
ev() { "$H" eval "$1" >/dev/null; }
shot() { sleep "${2:-1.5}"; "$H" shot "$VS/$1.png" >/dev/null; }
gs() { gsettings "$@"; }
kill_apps() { pkill -f hypede_files; pkill -x hypede-settings; pkill -x gnome-text-edit; sleep 1; }
scheme() { gs set org.gnome.desktop.interface color-scheme "$1"; sleep 2; }
theme() { HYPEDE_SESSION=1 hypede-theme apply "$1" >/dev/null 2>&1; sleep 3; }
lock() { gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver \
    --method "org.gnome.ScreenSaver.$1" "${@:2}" >/dev/null; }

PARTS=" ${*:-greeting launcher desktop quick clip live themes settings lock} "
has() { [[ "$PARTS" == *" $1 "* ]]; }

theme builtin:hypede; scheme default; kill_apps
ev "$L.menu.close(); Main.panel.closeQuickSettings()"

# Приветствие при входе
if has greeting; then
    printf '0.2 %s\n5.2\n' "const g = $EXT._greeting; g._first = false; g._finishing = false; g._show(); 1" | $REC greeting 4
    sleep 2
fi

# Лаунчер: открыть и набрать пример
if has launcher; then
    {
        echo "0.15 $L.menu.open(); 1"
        s='12*(3+4)'; t=1.0
        for i in $(seq 1 ${#s}); do
            echo "$t $L.view.entry.text = '${s:0:$i}'; 1"
            t=$(python3 -c "print(round($t + 0.11, 2))")
        done
        echo "2.9"
    } | $REC launcher 4
    ev "$L.menu.close()"; sleep 1
fi

# Рабочий стол с «Файлами»
if has desktop; then
    "$H" run hypede-files "$HOME/Pictures"
    shot desktop 6
    kill_apps
fi

# Быстрые настройки: открыть и включить тёмную тему
if has quick; then
    printf '0.2 Main.panel.toggleQuickSettings(); 1\n1.7 SH:DCONF_PROFILE=hypede gsettings set org.gnome.desktop.interface color-scheme prefer-dark\n3.6\n' | $REC quick 4
    ev 'Main.panel.closeQuickSettings()'; scheme default
fi

# История буфера обмена поверх текстового редактора
if has clip; then
    "$H" run gnome-text-editor "$HOME/Documents/plan.md"
    sleep 8
    ev "$EXT._extras._clips = ['Bike ride by the lake, Saturday 10:00', 'https://hypede.xyz', 'git clone https://github.com/hypede/hypede', 'Call grandma', '#8ab4f8']; 1"
    printf '0.2 %s\n2.0\n' "$EXT._extras._showClipboard(); 1" | $REC clip 10
    ev 'Main.layoutManager.modalDialogGroup.get_children().forEach(d => d.constructor.name === "ModalDialog" && d.close()); 1'
    kill_apps
fi

# Живые обои (в тёмной теме они ярче). Шейдер на программной отрисовке
# медленный — замедляем сильнее.
if has live; then
    scheme prefer-dark
    for w in waves bokeh mesh aurora; do
        gs set dev.hypede.shell wallpaper-live "hypede:$w"; shot "live-$w" 3
    done
    printf '2.8\n' | $REC live-aurora 16
    gs set dev.hypede.shell wallpaper-live ''; sleep 2
    scheme default
fi

# Темы с открытым лаунчером. Стиль лаунчера и полки сбрасываем перед каждой:
# тема, в которой его нет, оставила бы стиль предыдущей.
if has themes; then
    for t in sakura neon ember lagoon midnight graphite; do
        gs reset dev.hypede.shell launcher-style; gs reset dev.hypede.shell shelf-style
        theme "builtin:$t"
        ev "$L.menu.open()"; shot "theme-$t" 2
        ev "$L.menu.close()"; sleep 1
    done
    theme builtin:hypede
    gs reset dev.hypede.shell launcher-style; gs reset dev.hypede.shell shelf-style
fi

# Настройки, раздел ИИ-помощника (тёмная тема)
if has settings; then
    scheme prefer-dark
    gs set dev.hypede.assistant enabled true
    "$H" run hypede-settings --page assistant; shot settings-assistant 9
    kill_apps
fi

# Экран блокировки: волны, часы, затем поле пароля
if has lock; then
    scheme prefer-dark
    dialog='Main.layoutManager.screenShieldGroup.get_children().find(c => c.name === "lockDialogGroup").get_first_child()'
    printf '0.1 SH:DBUS_SESSION_BUS_ADDRESS=%s gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver --method org.gnome.ScreenSaver.Lock\n2.8 %s._showPrompt(); 1\n4.4\n' \
        "$DBUS_SESSION_BUS_ADDRESS" "$dialog" | $REC lock 12
    lock SetActive false; sleep 2
    scheme default
fi
echo "кадры: $VS, сцены: /tmp/rec"
