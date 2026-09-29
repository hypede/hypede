#!/bin/bash
# Снимает скриншоты для документации в безэкранном сеансе.
# Нужен установленный HypeDE и запущенный tools/dev/shell-headless.sh start.
#   tools/dev/screenshots.sh ВЫХОДНОЙ_КАТАЛОГ
set -uo pipefail
OUT=${1:-/tmp/hypede-shots}
mkdir -p "$OUT"
H="$(dirname "$0")/shell-headless.sh"

ev() { "$H" eval "$1" >/dev/null; }
shot() { sleep "${2:-1.5}"; "$H" shot "$OUT/$1.png" >/dev/null; }
kill_apps() { pkill -x python3; pkill -x hypede-settings; sleep 1; }
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
    "$H" run env LANG="${LANG:-ru_RU.UTF-8}" hypede-settings --page personalization; shot "settings-$suffix" 5
    "$H" run env LANG="${LANG:-ru_RU.UTF-8}" hypede-settings --page apps --kcm kcm_componentchooser; shot "settings-kcm-$suffix" 4
    kill_apps
done
gsettings set org.gnome.desktop.interface color-scheme default
echo "скриншоты: $OUT"
