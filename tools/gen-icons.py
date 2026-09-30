#!/usr/bin/env python3
"""Собирает тему значков HypeDE из Material Symbols (Rounded).

Chrome OS рисует значки в одном стиле — Material Symbols. Тема HypeDE
кладёт их под стандартными именами freedesktop (network-wireless-…,
audio-volume-…, battery-level-…), поэтому их подхватывают и оболочка
(полка, быстрые настройки, лаунчер), и «Настройки», и приложения GTK.
Всё, чего нет в теме, берётся из Adwaita (Inherits в index.theme).

Значки: пакет @material-symbols/svg-400 (Apache 2.0). Скачать и
распаковать, затем:

    curl -sSLo ms.tgz https://registry.npmjs.org/@material-symbols/svg-400/-/svg-400-0.47.5.tgz
    tar xzf ms.tgz
    python3 tools/gen-icons.py package/rounded

Результат лежит в репозитории (data/icons/HypeDE), так что для сборки
пакета скрипт запускать не нужно.
"""

from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/icons/HypeDE"

# Имя freedesktop (без -symbolic) → имя Material Symbols.
# «-fill» — закрашенный вариант, как у Chrome OS в трее.
ICONS = {
    # Сеть
    "network-wireless": "wifi",
    "network-wireless-connected": "wifi",
    "network-wireless-signal-excellent": "signal_wifi_4_bar",
    "network-wireless-signal-good": "network_wifi_3_bar",
    "network-wireless-signal-ok": "network_wifi_2_bar",
    "network-wireless-signal-weak": "network_wifi_1_bar",
    "network-wireless-signal-none": "signal_wifi_0_bar",
    "network-wireless-offline": "signal_wifi_off",
    "network-wireless-disabled": "wifi_off",
    "network-wireless-hardware-disabled": "wifi_off",
    "network-wireless-acquiring": "wifi_find",
    "network-wireless-no-route": "signal_wifi_statusbar_not_connected",
    "network-wireless-hotspot": "wifi_tethering",
    "network-wired": "lan",
    "network-wired-acquiring": "lan",
    "network-wired-disconnected": "lan",
    "network-wired-offline": "lan",
    "network-wired-no-route": "lan",
    "network-vpn": "vpn_key",
    "network-vpn-acquiring": "vpn_key",
    "network-vpn-disconnected": "vpn_key_off",
    "network-vpn-disabled": "vpn_key_off",
    "network-cellular": "signal_cellular_alt",
    "network-cellular-signal-excellent": "signal_cellular_4_bar",
    "network-cellular-signal-good": "signal_cellular_3_bar",
    "network-cellular-signal-ok": "signal_cellular_2_bar",
    "network-cellular-signal-weak": "signal_cellular_1_bar",
    "network-cellular-signal-none": "signal_cellular_0_bar",
    "network-cellular-offline": "signal_cellular_off",
    "network-cellular-disabled": "signal_cellular_off",
    "airplane-mode": "flight",
    "airplane-mode-disabled": "airplanemode_inactive",
    # Bluetooth
    "bluetooth": "bluetooth",
    "bluetooth-active": "bluetooth",
    "bluetooth-disabled": "bluetooth_disabled",
    "bluetooth-hardware-disabled": "bluetooth_disabled",
    "bluetooth-acquiring": "bluetooth_searching",
    # Звук
    "audio-volume-high": "volume_up",
    "audio-volume-overamplified": "volume_up",
    "audio-volume-medium": "volume_down",
    "audio-volume-low": "volume_mute",
    "audio-volume-muted": "volume_off",
    "audio-speakers": "speaker",
    "audio-headphones": "headphones",
    "audio-headset": "headset_mic",
    "audio-input-microphone": "mic",
    "microphone-sensitivity-high": "mic",
    "microphone-sensitivity-medium": "mic",
    "microphone-sensitivity-low": "mic",
    "microphone-sensitivity-muted": "mic_off",
    "microphone-disabled": "mic_off",
    # Экран
    "display-brightness": "light_mode",
    "keyboard-brightness": "backlight_high",
    "night-light": "nightlight",
    "night-light-disabled": "nightlight",
    "dark-mode": "dark_mode",
    "video-display": "monitor",
    "video-joined-displays": "display_settings",
    "screen-shared": "screen_share",
    "preferences-desktop-display": "monitor",
    # Питание
    "battery": "battery_full-fill",
    "battery-full": "battery_full-fill",
    "battery-full-charged": "battery_charging_full-fill",
    "battery-full-charging": "battery_charging_full-fill",
    "battery-good": "battery_5_bar-fill",
    "battery-good-charging": "battery_charging_80-fill",
    "battery-low": "battery_2_bar-fill",
    "battery-low-charging": "battery_charging_30-fill",
    "battery-caution": "battery_1_bar-fill",
    "battery-caution-charging": "battery_charging_20-fill",
    "battery-empty": "battery_alert-fill",
    "battery-empty-charging": "battery_charging_20-fill",
    "battery-missing": "battery_unknown-fill",
    "battery-level-100-charged": "battery_charging_full-fill",
    "ac-adapter": "power",
    "system-shutdown": "power_settings_new",
    "system-reboot": "restart_alt",
    "system-log-out": "logout",
    "system-suspend": "bedtime",
    "system-lock-screen": "lock",
    "changes-prevent": "lock",
    "changes-allow": "lock_open",
    "system-switch-user": "switch_account",
    "power-profile-performance": "speed",
    "power-profile-balanced": "balance",
    "power-profile-power-saver": "energy_savings_leaf",
    # Система и настройки
    "emblem-system": "settings",
    "preferences-system": "settings",
    "org.gnome.Settings": "settings",
    "applications-system": "settings_applications",
    "preferences-other": "tune",
    "preferences-system-time": "schedule",
    "preferences-desktop-locale": "language",
    "preferences-desktop-wallpaper": "wallpaper",
    "preferences-desktop-appearance": "palette",
    "applications-graphics": "palette",
    "preferences-desktop-accessibility": "accessibility_new",
    "org.gnome.Settings-accessibility": "accessibility_new",
    "preferences-desktop-icons": "category",
    "preferences-desktop-remote-desktop": "screen_share",
    "preferences-system-notifications": "notifications",
    "notifications-disabled": "notifications_off",
    "preferences-system-privacy": "shield",
    "system-users": "group",
    "avatar-default": "account_circle",
    "system-run": "rocket_launch",
    "software-update-available": "install_desktop",
    "application-x-addon": "extension",
    "auth-smartcard": "badge",
    "security-high": "verified_user",
    "security-medium": "shield",
    "security-low": "gpp_maybe",
    "find-location": "location_on",
    "location-services-active": "location_on",
    "location-services-disabled": "location_off",
    "applications-multimedia": "animation",
    "utilities-system-monitor": "monitoring",
    "utilities-terminal": "terminal",
    "accessories-calculator": "calculate",
    "font-x-generic": "text_fields",
    "format-text-larger": "format_size",
    "web-browser": "public",
    "x-office-calendar": "calendar_month",
    "alarm": "alarm",
    "mail-unread": "mail",
    "help-about": "info",
    "help-browser": "help",
    "starred": "star",
    "non-starred": "star",
    "emblem-favorite": "favorite",
    "view-pin": "keep",
    "view-unpin": "keep_off",
    # Устройства
    "input-keyboard": "keyboard",
    "input-mouse": "mouse",
    "input-touchpad": "touchpad_mouse",
    "media-eject": "eject",
    "screenshot-recorded": "screenshot_region",
    "media-record": "radio_button_checked",
    # Файлы и папки
    "go-home": "home",
    "document-open-recent": "history",
    "document-save": "save",
    "document-open": "folder_open",
    "document-properties": "description",
    "document-import": "upload",
    # Действия
    "edit-find": "search",
    "system-search": "search",
    "edit-clear": "cancel",
    "edit-undo": "undo",
    "edit-redo": "redo",
    "edit-copy": "content_copy",
    "edit-paste": "content_paste",
    "edit-cut": "content_cut",
    "edit-delete": "delete",
    "edit-select-all": "select_all",
    "list-add": "add",
    "list-remove": "remove",
    "go-next": "chevron_right",
    "go-previous": "chevron_left",
    "go-down": "keyboard_arrow_down",
    "go-up": "keyboard_arrow_up",
    "pan-down": "arrow_drop_down",
    "pan-up": "arrow_drop_up",
    "pan-end": "arrow_right",
    "pan-start": "arrow_left",
    "window-close": "close",
    "window-maximize": "crop_square",
    "window-minimize": "remove",
    "window-restore": "filter_none",
    "view-app-grid": "apps",
    "view-grid": "grid_view",
    "view-list": "list",
    "view-more": "more_vert",
    "open-menu": "more_vert",
    "view-refresh": "refresh",
    "object-select": "check",
    "dialog-warning": "warning",
    "dialog-information": "info",
    "dialog-error": "error",
    "dialog-question": "help",
    "zoom-in": "zoom_in",
    "zoom-out": "zoom_out",
    "media-playback-start": "play_arrow",
    "media-playback-pause": "pause",
    "media-playback-stop": "stop_circle",
    "media-skip-forward": "skip_next",
    "media-skip-backward": "skip_previous",
    "adw-external-link": "open_in_new",
    "external-link": "open_in_new",
    # Свои значки HypeDE. Устройства — под своими именами, чтобы не
    # подменять цветные значки мест и дисков в приложениях.
    "hypede-shelf": "dock_to_bottom",
    "hypede-device": "computer",
    "hypede-printer": "print",
    "hypede-storage": "hard_drive",
    "hypede-trash": "delete",
}

# Значки, которых нет в Material Symbols, — нарисованы здесь.
CUSTOM = {
    # Искра ИИ-помощника: четырёхлучевая звезда и маленькая рядом.
    "hypede-assistant": (
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 -960 960 960">'
        '<path d="M440-840q20 180 110 270t270 110q-180 20-270 110T440-80q-20-180-110-270T60-460'
        'q180-20 270-110t110-270Z"/>'
        '<path d="M780-900q8 62 38 92t92 38q-62 8-92 38t-38 92q-8-62-38-92t-92-38q62-8 92-38t38-92Z"/>'
        '</svg>\n'),
}

# Уровни заряда: battery-level-N-symbolic и battery-level-N-charging-symbolic.
LEVELS = {0: "battery_alert", 10: "battery_1_bar", 20: "battery_1_bar", 30: "battery_2_bar",
          40: "battery_3_bar", 50: "battery_3_bar", 60: "battery_4_bar", 70: "battery_5_bar",
          80: "battery_5_bar", 90: "battery_6_bar", 100: "battery_full"}
CHARGING = {0: "battery_charging_20", 10: "battery_charging_20", 20: "battery_charging_20",
            30: "battery_charging_30", 40: "battery_charging_50", 50: "battery_charging_50",
            60: "battery_charging_60", 70: "battery_charging_80", 80: "battery_charging_80",
            90: "battery_charging_90", 100: "battery_charging_full"}
for level, name in LEVELS.items():
    ICONS[f"battery-level-{level}"] = f"{name}-fill"
for level, name in CHARGING.items():
    ICONS[f"battery-level-{level}-charging"] = f"{name}-fill"

# Места, устройства и типы файлов сюда не входят: GTK 4 ищет значок сначала
# по всей теме HypeDE, и символьная папка заменила бы цветную в «Файлах».

INDEX = """[Icon Theme]
Name=HypeDE
Comment=Material Symbols for HypeDE, on top of Adwaita
Inherits=Adwaita,breeze,hicolor
Hidden=false
Directories=symbolic

[symbolic]
Context=Actions
Size=16
MinSize=8
MaxSize=512
Type=Scalable
"""


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    source = Path(sys.argv[1])
    missing = [m for m in set(ICONS.values()) if not (source / f"{m}.svg").exists()]
    if missing:
        print("нет в Material Symbols:", ", ".join(sorted(missing)))
        return 1

    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "symbolic").mkdir(parents=True)
    for name, material in sorted(ICONS.items()):
        svg = (source / f"{material}.svg").read_text()
        # 16×16 — естественный размер символьного значка; путь без цвета
        # GTK и GNOME Shell перекрашивают в цвет текста.
        svg = re.sub(r'width="\d+" height="\d+"', 'width="16" height="16"', svg, count=1)
        (OUT / "symbolic" / f"{name}-symbolic.svg").write_text(svg)
    for name, svg in CUSTOM.items():
        (OUT / "symbolic" / f"{name}-symbolic.svg").write_text(svg)
    (OUT / "index.theme").write_text(INDEX)
    shutil.copy(source.parent / "LICENSE", OUT / "LICENSE")
    print(f"записано значков: {len(ICONS) + len(CUSTOM)} → {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
