#!/bin/bash
# Снимает скриншоты для документации в безэкранном сеансе.
# Нужен установленный HypeDE и запущенный tools/dev/shell-headless.sh start
# (для экрана блокировки — с HYPEDE_DEV_ANIMATIONS=1 и фиктивными GDM/logind,
# без них экран блокировки просто пропускается).
#   tools/dev/screenshots.sh ВЫХОДНОЙ_КАТАЛОГ
set -uo pipefail
OUT=${1:-/tmp/hypede-shots}
mkdir -p "$OUT"
H="$(dirname "$0")/shell-headless.sh"

ev() { "$H" eval "$1" >/dev/null; }
ev_out() { "$H" eval "$1" | sed -n "s/^(true, '\"\(.*\)\"')$/\1/p"; }
shot() { sleep "${2:-1.5}"; "$H" shot "$OUT/$1.png" >/dev/null; }
kill_apps() { pkill -x python3; pkill -x hypede-settings; sleep 1; }
gs() { DCONF_PROFILE=hypede gsettings set dev.hypede.shell "$1" "$2"; sleep 1; }
launcher() { echo 'Main.panel.statusArea["hypede-launcher"]'; }

# Уведомление «небезопасный режим» от devkit — убрать.
ev 'Main.messageTray._notificationQueue = []; Main.messageTray._hideNotification?.(false); Main.panel.statusArea.dateMenu._messageList?._sectionList?.get_children().forEach(s => s.clear?.())'

for scheme in default prefer-dark; do
    suffix=$([ "$scheme" = default ] && echo light || echo dark)
    gsettings set org.gnome.desktop.interface color-scheme "$scheme"
    kill_apps
    sleep 2

    ev "$(launcher).menu.open()"; shot "launcher-$suffix"
    ev "$(launcher).view.entry.text = '12*(3+4)'"; shot "launcher-calc-$suffix" 1
    ev "$(launcher).menu.close()"

    ev 'Main.panel.toggleQuickSettings()'; shot "quick-settings-$suffix"
    ev 'Main.panel.closeQuickSettings(); Main.panel.toggleCalendar()'; shot "calendar-$suffix"
    ev 'Main.panel.closeCalendar()'

    "$H" run env LANG="${LANG:-ru_RU.UTF-8}" hypede-files "$HOME/Изображения"; shot "files-$suffix" 5
    kill_apps
    "$H" run env LANG="${LANG:-ru_RU.UTF-8}" hypede-settings --page personalization; shot "settings-$suffix" 8
    "$H" run env LANG="${LANG:-ru_RU.UTF-8}" hypede-settings --page apps --kcm kcm_componentchooser; shot "settings-kcm-$suffix" 6
    kill_apps
    "$H" run env LANG="${LANG:-ru_RU.UTF-8}" hypede-settings --page shelf; shot "settings-shelf-$suffix" 7
    kill_apps

    # Полка слева и полноэкранный лаунчер
    gs shelf-position left
    ev "$(launcher).menu.open()"; shot "shelf-left-$suffix"
    ev "$(launcher).menu.close()"
    gs shelf-position bottom
    gs launcher-style fullscreen
    ev "$(launcher).menu.open()"; shot "launcher-fullscreen-$suffix"
    ev "$(launcher).menu.close()"
    gs launcher-style bubble

    # Экран блокировки: часы, затем поле пароля с карточками. Через D-Bus —
    # так работает и с GDM, и без него (экран блокировки HypeDE).
    ss() { DBUS_SESSION_BUS_ADDRESS=$(cat "${HYPEDE_DEV_STATE:-/tmp/hypede-dev}/bus") \
        gdbus call --session --dest org.gnome.ScreenSaver --object-path /org/gnome/ScreenSaver \
        --method "org.gnome.ScreenSaver.$1" "${@:2}" >/dev/null; }
    dialog='Main.layoutManager.screenShieldGroup.get_children().find(c => c.name === "lockDialogGroup").get_first_child()'
    ss Lock; shot "lock-$suffix" 2.5
    ev "$dialog._showPrompt()"; shot "lock-prompt-$suffix" 2
    ss SetActive false; sleep 1

    # Раздел ИИ-помощника
    gsettings set dev.hypede.assistant enabled true
    "$H" run env LANG="${LANG:-ru_RU.UTF-8}" hypede-settings --page assistant; shot "settings-assistant-$suffix" 7
    kill_apps
done
gsettings set org.gnome.desktop.interface color-scheme default
echo "скриншоты: $OUT"
