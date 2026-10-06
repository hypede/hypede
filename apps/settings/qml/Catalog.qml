pragma Singleton

import QtQuick

// Каталог «Настроек»: разделы левого меню, их карточки и строки.
//
// Строка описывается объектом; поле type выбирает вид:
//   toggle     — переключатель GSettings    {schema, key, invert}
//   strvToggle — есть ли элемент в списке   {schema, key, item, invert}
//   slider     — ползунок GSettings         {schema, key, from, to, step, unit, integer}
//   combo      — выбор из списка            {schema, key, options: [{value, label}]}
//   font       — шрифт «Семейство Размер»   {schema, key}
//   themeList  — тема из установленных      {schema, key, source: iconThemes|cursorThemes|gtkThemes}
//   kcm        — модуль настроек KDE        {kcm, icon, package}
//   run        — запуск программы           {argv, program}
//   note       — поясняющий текст
//   power, wifi, ntp, locale, language, timezone, clearHistory, searchEngine
//              — строки с особой логикой (см. RowDelegate.qml)
//   wallpaper, theme, accent, inputSources, about, displays, storage,
//   appList, autostart, configActions — целые блоки
// Необязательные поля: subtitle, icon, keywords (для поиска),
//   visibleWhen: {schema, key, value} — показывать только при значении ключа.
//
// Модули KDE выбраны те, что работают вне Plasma: они говорят со
// стандартными службами (NetworkManager, BlueZ, PipeWire, CUPS,
// AccountsService, mimeapps.list, XDG autostart, Flatpak). То, что в KDE
// завязано на KWin или PowerDevil (экраны, мышь, питание, раскладки),
// сделано здесь на GSettings и D-Bus GNOME — ими управляет GNOME.
QtObject {
    readonly property string iface: "org.gnome.desktop.interface"
    readonly property string wm: "org.gnome.desktop.wm.preferences"
    readonly property string mutter: "org.gnome.mutter"
    readonly property string mouse: "org.gnome.desktop.peripherals.mouse"
    readonly property string touchpad: "org.gnome.desktop.peripherals.touchpad"
    readonly property string keyboard: "org.gnome.desktop.peripherals.keyboard"
    readonly property string color: "org.gnome.settings-daemon.plugins.color"
    readonly property string power: "org.gnome.settings-daemon.plugins.power"
    readonly property string sound: "org.gnome.desktop.sound"
    readonly property string shell: "dev.hypede.shell"
    readonly property string session: "dev.hypede.session"

    readonly property var pages: [
        {
            id: "network", title: qsTr("Network"), icon: "network-wireless-symbolic",
            keywords: "network internet wifi wi-fi ethernet vpn сеть интернет",
            sections: [
                { rows: [
                    { type: "wifi", title: qsTr("Wi‑Fi"), icon: "network-wireless-symbolic",
                      keywords: "wifi wlan wireless беспроводная" },
                    { type: "kcm", kcm: "kcm_networkmanagement", package: "plasma-nm",
                      title: qsTr("Connections"), icon: "network-wired-symbolic",
                      subtitle: qsTr("Wi‑Fi, Ethernet, VPN and mobile networks"),
                      keywords: "ethernet vpn wireguard openvpn password пароль подключения" },
                ] },
                { title: qsTr("Proxy"), rows: [
                    { type: "combo", schema: "org.gnome.system.proxy", key: "mode", title: qsTr("Proxy"),
                      keywords: "proxy прокси",
                      options: [ { value: "none", label: qsTr("Off") },
                                 { value: "auto", label: qsTr("Automatic") },
                                 { value: "manual", label: qsTr("Manual") } ] },
                ] },
            ]
        },
        {
            id: "bluetooth", title: qsTr("Bluetooth"), icon: "bluetooth-active-symbolic",
            kcm: "kcm_bluetooth", package: "bluedevil",
            keywords: "bluetooth headphones mouse keyboard наушники блютуз"
        },
        {
            id: "devices", title: qsTr("Device"), icon: "hypede-device-symbolic",
            keywords: "device mouse touchpad keyboard display sound printer power storage устройство",
            sections: [
                { title: qsTr("Displays"), rows: [
                    { type: "displays", title: qsTr("Displays"), icon: "video-display-symbolic",
                      keywords: "display monitor resolution refresh rate scale rotation экран монитор разрешение частота масштаб поворот" },
                    { type: "strvToggle", schema: mutter, key: "experimental-features", item: "scale-monitor-framebuffer",
                      title: qsTr("Fractional scaling"), subtitle: qsTr("Scales like 125% and 150%"),
                      keywords: "fractional scale дробное масштабирование" },
                    { type: "toggle", schema: color, key: "night-light-enabled", title: qsTr("Night Light"),
                      subtitle: qsTr("Makes it easier to look at your screen in dim light"),
                      icon: "night-light-symbolic", keywords: "night light ночной свет" },
                    { type: "slider", schema: color, key: "night-light-temperature", from: 1700, to: 4700,
                      step: 100, unit: "K", integer: true, invertSlider: true, title: qsTr("Color temperature"),
                      visibleWhen: { schema: color, key: "night-light-enabled", value: true } },
                    { type: "toggle", schema: color, key: "night-light-schedule-automatic",
                      title: qsTr("Sunset to sunrise"),
                      visibleWhen: { schema: color, key: "night-light-enabled", value: true } },
                    { type: "run", argv: ["gnome-control-center", "display"], program: "gnome-control-center",
                      title: qsTr("Arrange displays"), subtitle: qsTr("Position of several monitors, mirroring"),
                      icon: "video-joined-displays-symbolic", keywords: "arrange mirror расположение зеркало" },
                ] },
                { title: qsTr("Mouse"), rows: [
                    { type: "slider", schema: mouse, key: "speed", from: -1, to: 1, step: 0.05,
                      title: qsTr("Mouse speed"), icon: "input-mouse-symbolic", keywords: "мышь скорость" },
                    { type: "toggle", schema: mouse, key: "natural-scroll", title: qsTr("Reverse scrolling"),
                      subtitle: qsTr("Content moves with your fingers"), keywords: "natural scroll прокрутка" },
                    { type: "toggle", schema: mouse, key: "left-handed", title: qsTr("Swap primary mouse button"),
                      keywords: "left handed левша" },
                    { type: "combo", schema: mouse, key: "accel-profile", title: qsTr("Mouse acceleration"),
                      options: [ { value: "default", label: qsTr("Default") },
                                 { value: "flat", label: qsTr("Off") },
                                 { value: "adaptive", label: qsTr("On") } ] },
                ] },
                { title: qsTr("Touchpad"), rows: [
                    { type: "toggle", schema: touchpad, key: "tap-to-click", title: qsTr("Tap to click"),
                      icon: "input-touchpad-symbolic", keywords: "touchpad тачпад" },
                    { type: "toggle", schema: touchpad, key: "natural-scroll", title: qsTr("Reverse scrolling"),
                      keywords: "touchpad natural" },
                    { type: "slider", schema: touchpad, key: "speed", from: -1, to: 1, step: 0.05,
                      title: qsTr("Touchpad speed") },
                    { type: "toggle", schema: touchpad, key: "disable-while-typing",
                      title: qsTr("Disable touchpad while typing") },
                    { type: "combo", schema: touchpad, key: "click-method", title: qsTr("Secondary click"),
                      keywords: "right click правый щелчок",
                      options: [ { value: "fingers", label: qsTr("Two-finger click") },
                                 { value: "areas", label: qsTr("Corner click") },
                                 { value: "default", label: qsTr("Default") } ] },
                    { type: "toggle", schema: touchpad, key: "two-finger-scrolling-enabled",
                      title: qsTr("Two-finger scrolling") },
                ] },
                { title: qsTr("Keyboard and inputs"), rows: [
                    { type: "inputSources", title: qsTr("Input methods"), keywords: "layout раскладка язык ввода" },
                    { type: "toggle", schema: keyboard, key: "repeat", title: qsTr("Auto-repeat"),
                      icon: "input-keyboard-symbolic", keywords: "repeat повтор клавиш" },
                    { type: "slider", schema: keyboard, key: "delay", from: 100, to: 2000, step: 50,
                      unit: "ms", integer: true, title: qsTr("Delay before repeat"),
                      visibleWhen: { schema: keyboard, key: "repeat", value: true } },
                    { type: "slider", schema: keyboard, key: "repeat-interval", from: 5, to: 200, step: 5,
                      unit: "ms", integer: true, title: qsTr("Repeat interval"),
                      visibleWhen: { schema: keyboard, key: "repeat", value: true } },
                    { type: "toggle", schema: keyboard, key: "numlock-state", title: qsTr("Num Lock on at start"),
                      keywords: "numlock цифровая клавиатура" },
                ] },
                { title: qsTr("Keyboard shortcuts"), rows: [ { type: "shortcuts", title: qsTr("Keyboard shortcuts"),
                      keywords: "shortcuts hotkeys keys сочетания клавиш горячие клавиши" } ] },
                { title: qsTr("Sound and printing"), rows: [
                    { type: "kcm", kcm: "kcm_pulseaudio", package: "plasma-pa", title: qsTr("Sound"),
                      subtitle: qsTr("Output and input devices, volume"),
                      icon: "audio-speakers-symbolic", keywords: "audio volume microphone звук громкость микрофон" },
                    { type: "toggle", schema: sound, key: "allow-volume-above-100-percent",
                      title: qsTr("Over-amplification"), subtitle: qsTr("Volume above 100%"),
                      keywords: "amplification усиление громкость" },
                    { type: "themeList", schema: sound, key: "theme-name", source: "soundThemes", title: qsTr("Sound theme"),
                      keywords: "sound theme звуковая тема" },
                    { type: "toggle", schema: sound, key: "event-sounds", title: qsTr("System sounds"),
                      keywords: "event sounds звуки системы" },
                    { type: "kcm", kcm: "kcm_printer_manager", package: "print-manager", title: qsTr("Printers"),
                      icon: "hypede-printer-symbolic", keywords: "printer cups принтер печать" },
                ] },
                { title: qsTr("Power"), rows: [
                    { type: "power", title: qsTr("Power mode"), icon: "power-profile-balanced-symbolic",
                      keywords: "power battery performance питание батарея производительность" },
                    { type: "toggle", schema: iface, key: "show-battery-percentage",
                      title: qsTr("Show battery percentage") },
                    { type: "toggle", schema: power, key: "idle-dim", title: qsTr("Dim screen when inactive") },
                    { type: "combo", schema: power, key: "sleep-inactive-ac-timeout",
                      title: qsTr("Sleep when idle on power"), keywords: "sleep suspend сон",
                      options: [ { value: 900, label: qsTr("15 minutes") }, { value: 1800, label: qsTr("30 minutes") },
                                 { value: 3600, label: qsTr("1 hour") }, { value: 7200, label: qsTr("2 hours") } ] },
                    { type: "combo", schema: power, key: "sleep-inactive-ac-type", title: qsTr("When idle on power"),
                      options: [ { value: "suspend", label: qsTr("Sleep") }, { value: "nothing", label: qsTr("Stay awake") } ] },
                    { type: "combo", schema: power, key: "sleep-inactive-battery-timeout",
                      title: qsTr("Sleep when idle on battery"),
                      options: [ { value: 300, label: qsTr("5 minutes") }, { value: 600, label: qsTr("10 minutes") },
                                 { value: 900, label: qsTr("15 minutes") }, { value: 1800, label: qsTr("30 minutes") } ] },
                    { type: "combo", schema: power, key: "power-button-action", title: qsTr("Power button"),
                      options: [ { value: "interactive", label: qsTr("Ask") }, { value: "suspend", label: qsTr("Sleep") },
                                 { value: "hibernate", label: qsTr("Hibernate") }, { value: "nothing", label: qsTr("Do nothing") } ] },
                ] },
                { title: qsTr("Storage"), rows: [
                    { type: "storage", title: qsTr("Storage"), icon: "hypede-storage-symbolic",
                      keywords: "storage disk space trash хранилище диск место корзина" },
                ] },
            ]
        },
        {
            id: "personalization", title: qsTr("Personalization"), icon: "applications-graphics-symbolic",
            keywords: "wallpaper theme dark light accent fonts icons cursor обои тема шрифты значки курсор",
            sections: [
                { title: qsTr("Themes"), rows: [ { type: "themes", title: qsTr("Themes"),
                      keywords: "theme themes export import json тема темы экспорт импорт" } ] },
                { title: qsTr("Wallpaper"), rows: [ { type: "wallpaper", title: qsTr("Wallpaper"),
                                                      keywords: "wallpaper background обои фон" } ] },
                { title: qsTr("Live wallpaper"), rows: [
                    { type: "liveWallpaper", title: qsTr("Live wallpaper"),
                      keywords: "live animated video gif wallpaper живые анимированные обои видео" },
                    { type: "slider", schema: shell, key: "wallpaper-live-speed", from: 0.25, to: 3, step: 0.25,
                      unit: "speed", title: qsTr("Animation speed"),
                      visibleWhen: { schema: shell, key: "lite-mode", value: false } },
                    { type: "toggle", schema: shell, key: "wallpaper-live-pause", title: qsTr("Pause under maximized windows"),
                      subtitle: qsTr("Saves battery: the wallpaper stops when nobody sees it") },
                ] },
                { title: qsTr("Desktop"), rows: [
                    { type: "toggle", schema: shell, key: "desktop-icons", title: qsTr("Icons on the desktop"),
                      subtitle: qsTr("Files from the Desktop folder. Drag them to apps and back"),
                      icon: "user-desktop-symbolic", keywords: "desktop icons files рабочий стол значки файлы" },
                    { type: "slider", schema: shell, key: "desktop-icon-size", from: 32, to: 128, step: 8,
                      unit: "px", integer: true, title: qsTr("Icon size"),
                      visibleWhen: { schema: shell, key: "desktop-icons", value: true } },
                    { type: "toggle", schema: shell, key: "desktop-show-home", title: qsTr("Home folder"),
                      visibleWhen: { schema: shell, key: "desktop-icons", value: true } },
                    { type: "toggle", schema: shell, key: "desktop-show-trash", title: qsTr("Trash"),
                      visibleWhen: { schema: shell, key: "desktop-icons", value: true } },
                ] },
                { title: qsTr("Widgets"), rows: [ { type: "widgets", title: qsTr("Widgets"),
                      keywords: "widgets clock weather calendar note music виджеты часы погода календарь заметка музыка" } ] },
                { title: qsTr("Style"), rows: [
                    { type: "theme", title: qsTr("Theme"), keywords: "dark light тёмная светлая тема" },
                    { type: "accent", title: qsTr("Accent color"), keywords: "accent color цвет акцент" },
                ] },
                { title: qsTr("Fonts"), rows: [
                    { type: "font", schema: iface, key: "font-name", title: qsTr("Interface"),
                      icon: "font-x-generic-symbolic", keywords: "font шрифт интерфейс" },
                    { type: "font", schema: iface, key: "document-font-name", title: qsTr("Documents"),
                      keywords: "font шрифт документы" },
                    { type: "font", schema: iface, key: "monospace-font-name", title: qsTr("Monospace"),
                      keywords: "font monospace terminal моноширинный терминал" },
                    { type: "slider", schema: iface, key: "text-scaling-factor", from: 0.75, to: 2, step: 0.05,
                      unit: "x", title: qsTr("Text size"), keywords: "font size large text размер шрифта" },
                    { type: "combo", schema: iface, key: "font-antialiasing", title: qsTr("Font smoothing"),
                      keywords: "antialiasing сглаживание",
                      options: [ { value: "grayscale", label: qsTr("Standard (grayscale)") },
                                 { value: "rgba", label: qsTr("Subpixel (for LCD)") },
                                 { value: "none", label: qsTr("None") } ] },
                    { type: "combo", schema: iface, key: "font-hinting", title: qsTr("Font hinting"),
                      keywords: "hinting хинтинг",
                      options: [ { value: "slight", label: qsTr("Slight") }, { value: "medium", label: qsTr("Medium") },
                                 { value: "full", label: qsTr("Full") }, { value: "none", label: qsTr("None") } ] },
                ] },
                { title: qsTr("Icons and pointer"), rows: [
                    { type: "themeList", schema: iface, key: "icon-theme", source: "iconThemes",
                      title: qsTr("Icon theme"), icon: "preferences-desktop-icons-symbolic",
                      keywords: "icons значки иконки" },
                    { type: "themeList", schema: iface, key: "cursor-theme", source: "cursorThemes",
                      title: qsTr("Cursor theme"), icon: "input-mouse-symbolic", keywords: "cursor pointer курсор указатель" },
                    { type: "combo", schema: iface, key: "cursor-size", title: qsTr("Cursor size"),
                      options: [ { value: 24, label: qsTr("Default") }, { value: 32, label: qsTr("Medium") },
                                 { value: 48, label: qsTr("Large") }, { value: 64, label: qsTr("Larger") },
                                 { value: 96, label: qsTr("Largest") } ] },
                ] },
                { title: qsTr("Windows"), rows: [
                    { type: "combo", schema: wm, key: "button-layout", title: qsTr("Window buttons"),
                      icon: "window-restore-symbolic", keywords: "titlebar buttons minimize maximize кнопки окна заголовок",
                      options: [ { value: "appmenu:minimize,maximize,close", label: qsTr("Minimize, maximize, close") },
                                 { value: "appmenu:minimize,close", label: qsTr("Minimize and close") },
                                 { value: "appmenu:close", label: qsTr("Close only") },
                                 { value: "close,minimize,maximize:appmenu", label: qsTr("On the left") } ] },
                    { type: "combo", schema: wm, key: "action-double-click-titlebar",
                      title: qsTr("Double-click on title bar"),
                      options: [ { value: "toggle-maximize", label: qsTr("Maximize") },
                                 { value: "minimize", label: qsTr("Minimize") },
                                 { value: "none", label: qsTr("Nothing") } ] },
                    { type: "combo", schema: wm, key: "focus-mode", title: qsTr("Window focus"),
                      keywords: "focus follows mouse фокус",
                      options: [ { value: "click", label: qsTr("Click to focus") },
                                 { value: "sloppy", label: qsTr("Focus follows mouse") } ] },
                    { type: "toggle", schema: mutter, key: "center-new-windows", title: qsTr("Open windows in the center") },
                    { type: "toggle", schema: mutter, key: "edge-tiling", title: qsTr("Snap windows to screen edges"),
                      keywords: "tiling snap прилипание" },
                    { type: "themeList", schema: iface, key: "gtk-theme", source: "gtkThemes",
                      title: qsTr("Legacy app theme (GTK 3)"), keywords: "gtk3 theme adw-gtk3" },
                ] },
                { title: qsTr("Animations and effects"), rows: [
                    { type: "toggle", schema: shell, key: "lite-mode", title: qsTr("Lite mode"),
                      subtitle: qsTr("For slower computers: no blur, rounded-corner effect, lock screen waves or greeting"),
                      keywords: "performance lite fast slow производительность лёгкий быстрый слабый" },
                    { type: "toggle", schema: iface, key: "enable-animations", title: qsTr("Animations"),
                      icon: "applications-multimedia-symbolic", keywords: "animations анимации" },
                    { type: "slider", schema: shell, key: "animation-speed", from: 0.5, to: 2, step: 0.1,
                      unit: "speed", title: qsTr("Animation speed"),
                      visibleWhen: { schema: iface, key: "enable-animations", value: true } },
                    { type: "combo", schema: shell, key: "greeting", title: qsTr("Greeting at sign-in"),
                      keywords: "greeting welcome hello приветствие вход",
                      options: [ { value: "always", label: qsTr("Every time") },
                                 { value: "first", label: qsTr("First sign-in only") },
                                 { value: "never", label: qsTr("Off") } ] },
                    { type: "toggle", schema: shell, key: "window-corners", title: qsTr("Rounded window corners"),
                      subtitle: qsTr("For apps that draw square corners without a shadow"),
                      keywords: "rounded corners shadow скругление углы тень окна" },
                    { type: "combo", schema: shell, key: "window-animations", title: qsTr("Window animations"),
                      visibleWhen: { schema: iface, key: "enable-animations", value: true },
                      options: [ { value: "hypede", label: qsTr("Soft (HypeDE)") },
                                 { value: "gnome", label: qsTr("GNOME") } ] },
                    { type: "toggle", schema: shell, key: "minimize-genie", title: qsTr("Genie minimize"),
                      subtitle: qsTr("Windows flow into their shelf icon"), keywords: "genie minimize magic lamp джинн сворачивание",
                      visibleWhen: { schema: shell, key: "window-animations", value: "hypede" } },
                    { type: "toggle", schema: shell, key: "window-wobbly", title: qsTr("Jelly windows"),
                      subtitle: qsTr("Windows bend and spring back while you drag them"), keywords: "wobbly jelly желе пружина",
                      visibleWhen: { schema: shell, key: "window-animations", value: "hypede" } },
                    { type: "slider", schema: shell, key: "corner-radius", from: 0, to: 32, step: 1,
                      unit: "px", integer: true, title: qsTr("Corner rounding"),
                      keywords: "radius corners скругление углы" },
                    { type: "slider", schema: shell, key: "launcher-opacity", from: 40, to: 100, step: 1,
                      unit: "%", integer: true, title: qsTr("Menu opacity"),
                      subtitle: qsTr("Launcher, quick settings and menus"), keywords: "opacity transparency прозрачность" },
                ] },
            ]
        },
        {
            id: "shelf", title: qsTr("Shelf and launcher"), icon: "hypede-shelf-symbolic",
            keywords: "shelf panel taskbar dock launcher полка панель задач док лаунчер",
            sections: [
                { title: qsTr("Shelf"), rows: [
                    { type: "combo", schema: shell, key: "shelf-position", title: qsTr("Position"),
                      icon: "view-dual-symbolic", keywords: "position left right top bottom положение слева справа сверху снизу",
                      options: [ { value: "bottom", label: qsTr("Bottom") }, { value: "left", label: qsTr("Left") },
                                 { value: "right", label: qsTr("Right") }, { value: "top", label: qsTr("Top") } ] },
                    { type: "combo", schema: shell, key: "shelf-style", title: qsTr("Style"),
                      options: [ { value: "full", label: qsTr("Full width") },
                                 { value: "floating", label: qsTr("Floating") } ] },
                    { type: "combo", schema: shell, key: "shelf-alignment", title: qsTr("Apps"),
                      options: [ { value: "center", label: qsTr("Centered") },
                                 { value: "start", label: qsTr("Next to the launcher") } ] },
                    { type: "slider", schema: shell, key: "shelf-size", from: 36, to: 96, step: 2,
                      unit: "px", integer: true, title: qsTr("Shelf size") },
                    { type: "slider", schema: shell, key: "shelf-icon-size", from: 20, to: 72, step: 2,
                      unit: "px", integer: true, title: qsTr("Icon size") },
                    { type: "slider", schema: shell, key: "shelf-opacity", from: 0, to: 100, step: 1,
                      unit: "%", integer: true, title: qsTr("Opacity") },
                    { type: "color", schema: shell, key: "shelf-color", title: qsTr("Shelf color"),
                      keywords: "shelf color panel цвет полки панели" },
                    { type: "color", schema: shell, key: "launcher-color", title: qsTr("Launcher and menu color"),
                      keywords: "launcher menu color цвет лаунчера меню" },
                    { type: "toggle", schema: shell, key: "shelf-blur", title: qsTr("Blur behind the shelf") },
                    { type: "toggle", schema: shell, key: "shelf-autohide", title: qsTr("Autohide shelf"),
                      subtitle: qsTr("The shelf slides away when a window touches it"), keywords: "autohide скрывать" },
                ] },
                { title: qsTr("Apps on the shelf"), rows: [
                    { type: "toggle", schema: shell, key: "shelf-show-pinned", title: qsTr("Show pinned apps"),
                      subtitle: qsTr("Drag icons to reorder them; right-click to pin or unpin") },
                    { type: "combo", schema: shell, key: "shelf-running-indicator", title: qsTr("Running app indicator"),
                      options: [ { value: "dot", label: qsTr("Dot") }, { value: "line", label: qsTr("Line") },
                                 { value: "none", label: qsTr("None") } ] },
                    { type: "toggle", schema: shell, key: "shelf-hover-zoom", title: qsTr("Magnify icon under pointer") },
                    { type: "toggle", schema: shell, key: "shelf-tooltips", title: qsTr("App names on hover") },
                    { type: "toggle", schema: shell, key: "minimize-to-shelf", title: qsTr("Minimize windows into the shelf") },
                ] },
                { title: qsTr("Status tray"), rows: [
                    { type: "toggle", schema: shell, key: "show-date", title: qsTr("Show date on the shelf") },
                    { type: "combo", schema: iface, key: "clock-format", title: qsTr("Clock format"),
                      keywords: "clock 24 hour часы",
                      options: [ { value: "24h", label: qsTr("24-hour") }, { value: "12h", label: qsTr("12-hour") } ] },
                    { type: "toggle", schema: iface, key: "clock-show-seconds", title: qsTr("Show seconds") },
                    { type: "toggle", schema: iface, key: "show-battery-percentage", title: qsTr("Show battery percentage") },
                    { type: "combo", schema: shell, key: "notification-position", title: qsTr("Notifications"),
                      keywords: "notifications banner уведомления",
                      options: [ { value: "bottom-right", label: qsTr("Bottom right") },
                                 { value: "top-right", label: qsTr("Top right") },
                                 { value: "top-center", label: qsTr("Top center") } ] },
                ] },
                { title: qsTr("Launcher"), rows: [
                    { type: "combo", schema: shell, key: "launcher-style", title: qsTr("Launcher style"),
                      icon: "view-app-grid-symbolic", keywords: "launcher fullscreen bubble лаунчер полноэкранный",
                      options: [ { value: "bubble", label: qsTr("Bubble") },
                                 { value: "fullscreen", label: qsTr("Full screen") } ] },
                    { type: "combo", schema: shell, key: "super-key-action", title: qsTr("Everything key (Super)"),
                      keywords: "super launcher",
                      options: [ { value: "launcher", label: qsTr("Opens the launcher") },
                                 { value: "overview", label: qsTr("Opens the overview") } ] },
                    { type: "slider", schema: shell, key: "launcher-columns", from: 3, to: 10, step: 1,
                      unit: "count", integer: true, title: qsTr("Apps per row") },
                    { type: "slider", schema: shell, key: "launcher-icon-size", from: 32, to: 96, step: 4,
                      unit: "px", integer: true, title: qsTr("Icon size") },
                    { type: "toggle", schema: shell, key: "launcher-show-labels", title: qsTr("App names under icons") },
                    { type: "combo", schema: shell, key: "launcher-sort", title: qsTr("Order"),
                      options: [ { value: "alphabetical", label: qsTr("Alphabetical") },
                                 { value: "usage", label: qsTr("Most used first") } ] },
                    { type: "toggle", schema: shell, key: "show-recent-files",
                      title: qsTr("Show “Continue where you left off”") },
                    { type: "toggle", schema: shell, key: "launcher-blur", title: qsTr("Blur behind the launcher") },
                ] },
                { title: qsTr("Search in the launcher"), rows: [
                    { type: "strvToggle", schema: shell, key: "launcher-search-providers", item: "calculator",
                      title: qsTr("Calculator"), icon: "accessories-calculator-symbolic" },
                    { type: "strvToggle", schema: shell, key: "launcher-search-providers", item: "apps",
                      title: qsTr("Apps") },
                    { type: "strvToggle", schema: shell, key: "launcher-search-providers", item: "settings",
                      title: qsTr("Settings") },
                    { type: "strvToggle", schema: shell, key: "launcher-search-providers", item: "files",
                      title: qsTr("Files") },
                    { type: "strvToggle", schema: shell, key: "launcher-search-providers", item: "web",
                      title: qsTr("Web") },
                    { type: "searchEngine", title: qsTr("Search engine"),
                      icon: "web-browser-symbolic", keywords: "google yandex duckduckgo поиск поисковик" },
                ] },
                { title: qsTr("Apps in the launcher"), rows: [
                    { type: "appList", mode: "launcher", title: qsTr("Show in the launcher"),
                      keywords: "hide apps hidden скрыть приложения" },
                ] },
                { title: qsTr("Desktop"), rows: [
                    { type: "toggle", schema: iface, key: "enable-hot-corners", title: qsTr("Hot corner"),
                      subtitle: qsTr("Top-left corner opens the overview"), keywords: "hot corner горячий угол" },
                    { type: "toggle", schema: mutter, key: "dynamic-workspaces", title: qsTr("Dynamic desks"),
                      subtitle: qsTr("A new desk appears when the last one is used"),
                      keywords: "workspaces desks рабочие столы" },
                    { type: "slider", schema: wm, key: "num-workspaces", from: 1, to: 12, step: 1,
                      unit: "count", integer: true, title: qsTr("Number of desks"),
                      visibleWhen: { schema: mutter, key: "dynamic-workspaces", value: false } },
                    { type: "toggle", schema: mutter, key: "workspaces-only-on-primary",
                      title: qsTr("Desks only on the main display") },
                ] },
            ]
        },
        {
            id: "lockscreen", title: qsTr("Lock screen"), icon: "system-lock-screen-symbolic",
            keywords: "lock screen clock password блокировка экран часы пароль",
            sections: [
                { title: qsTr("Look"), rows: [
                    { type: "combo", schema: shell, key: "lock-style", title: qsTr("Lock screen"),
                      icon: "system-lock-screen-symbolic",
                      options: [ { value: "hypede", label: qsTr("HypeDE") }, { value: "gnome", label: qsTr("GNOME") } ] },
                    { type: "combo", schema: shell, key: "lock-clock-style", title: qsTr("Clock"),
                      visibleWhen: { schema: shell, key: "lock-style", value: "hypede" },
                      options: [ { value: "digital", label: qsTr("Digital") }, { value: "stacked", label: qsTr("Stacked") },
                                 { value: "analog", label: qsTr("Analog") } ] },
                    { type: "toggle", schema: shell, key: "lock-intro-animation", title: qsTr("Color waves when locking"),
                      visibleWhen: { schema: shell, key: "lock-style", value: "hypede" } },
                    { type: "toggle", schema: shell, key: "lock-show-cards", title: qsTr("Battery and system cards"),
                      visibleWhen: { schema: shell, key: "lock-style", value: "hypede" } },
                    { type: "slider", schema: shell, key: "lock-blur", from: 0, to: 100, step: 5,
                      unit: "%", integer: true, title: qsTr("Wallpaper blur"),
                      visibleWhen: { schema: shell, key: "lock-style", value: "hypede" } },
                    { type: "slider", schema: shell, key: "lock-dim", from: 0, to: 90, step: 5,
                      unit: "%", integer: true, title: qsTr("Wallpaper dimming"),
                      visibleWhen: { schema: shell, key: "lock-style", value: "hypede" } },
                    { type: "picture", schema: shell, key: "lock-wallpaper", title: qsTr("Lock screen wallpaper"),
                      keywords: "lock wallpaper обои блокировки",
                      visibleWhen: { schema: shell, key: "lock-style", value: "hypede" } },
                    { type: "color", schema: shell, key: "lock-clock-color", title: qsTr("Clock color"),
                      presets: ["#e8f0ff", "#ffd6ea", "#ffd2bd", "#fff3b0", "#c8f7e1", "#e4d4ff", "#8ab4f8"],
                      visibleWhen: { schema: shell, key: "lock-style", value: "hypede" } },
                    { type: "slider", schema: shell, key: "lock-clock-size", from: 50, to: 160, step: 5,
                      unit: "%", integer: true, title: qsTr("Clock size"),
                      visibleWhen: { schema: shell, key: "lock-style", value: "hypede" } },
                    { type: "text", schema: shell, key: "lock-message", title: qsTr("Message"),
                      subtitle: qsTr("Shown under the date"), placeholder: qsTr("For example, your name"),
                      keywords: "lock message text надпись сообщение",
                      visibleWhen: { schema: shell, key: "lock-style", value: "hypede" } },
                ] },
                { title: qsTr("Screen lock"), rows: [
                    { type: "toggle", schema: "org.gnome.desktop.screensaver", key: "lock-enabled",
                      title: qsTr("Lock when screen turns off"), icon: "system-lock-screen-symbolic",
                      keywords: "lock блокировка" },
                    { type: "combo", schema: "org.gnome.desktop.session", key: "idle-delay",
                      title: qsTr("Turn off screen when idle"), keywords: "blank screen idle экран",
                      options: [ { value: 60, label: qsTr("1 minute") }, { value: 300, label: qsTr("5 minutes") },
                                 { value: 600, label: qsTr("10 minutes") }, { value: 900, label: qsTr("15 minutes") },
                                 { value: 0, label: qsTr("Never") } ] },
                    { type: "combo", schema: "org.gnome.desktop.screensaver", key: "lock-delay",
                      title: qsTr("Lock after the screen turns off"),
                      options: [ { value: 0, label: qsTr("Immediately") }, { value: 30, label: qsTr("30 seconds") },
                                 { value: 60, label: qsTr("1 minute") }, { value: 300, label: qsTr("5 minutes") } ] },
                    { type: "toggle", schema: "org.gnome.desktop.notifications", key: "show-in-lock-screen",
                      title: qsTr("Notifications on lock screen") },
                ] },
            ]
        },
        {
            id: "privacy", title: qsTr("Security and privacy"), icon: "security-high-symbolic",
            keywords: "privacy security firewall history безопасность приватность история",
            sections: [
                { title: qsTr("History"), rows: [
                    { type: "toggle", schema: "org.gnome.desktop.privacy", key: "remember-recent-files",
                      title: qsTr("Remember recent files"), icon: "document-open-recent-symbolic",
                      keywords: "recent history история недавние" },
                    { type: "clearHistory", title: qsTr("Clear recent files history") },
                    { type: "toggle", schema: "org.gnome.desktop.privacy", key: "remove-old-trash-files",
                      title: qsTr("Automatically empty trash"), keywords: "trash корзина" },
                    { type: "toggle", schema: "org.gnome.desktop.privacy", key: "remove-old-temp-files",
                      title: qsTr("Automatically delete temporary files") },
                ] },
                { title: qsTr("Protection"), rows: [
                    { type: "toggle", schema: "org.gnome.system.location", key: "enabled",
                      title: qsTr("Location services"), icon: "find-location-symbolic", keywords: "location геолокация" },
                    { type: "toggle", schema: "org.gnome.desktop.privacy", key: "usb-protection",
                      title: qsTr("USB protection"), subtitle: qsTr("Block new USB devices while the screen is locked"),
                      icon: "drive-removable-media-symbolic" },
                    { type: "toggle", schema: "org.gnome.desktop.privacy", key: "disable-camera", invert: true,
                      title: qsTr("Camera"), icon: "camera-web-symbolic", keywords: "camera камера" },
                    { type: "toggle", schema: "org.gnome.desktop.privacy", key: "disable-microphone", invert: true,
                      title: qsTr("Microphone"), icon: "audio-input-microphone-symbolic", keywords: "microphone микрофон" },
                    { type: "kcm", kcm: "kcm_firewall", package: "plasma-firewall", title: qsTr("Firewall"),
                      icon: "security-medium-symbolic", keywords: "firewall ufw firewalld брандмауэр" },
                ] },
            ]
        },
        {
            id: "apps", title: qsTr("Apps"), icon: "view-app-grid-symbolic",
            keywords: "apps default autostart notifications приложения",
            sections: [
                { rows: [
                    { type: "kcm", kcm: "kcm_componentchooser", package: "plasma-workspace",
                      title: qsTr("Default apps"), subtitle: qsTr("Browser, email, file manager, terminal"),
                      icon: "starred-symbolic", keywords: "default browser по умолчанию браузер" },
                    { type: "kcm", kcm: "kcm_filetypes", package: "kde-cli-tools", title: qsTr("File associations"),
                      subtitle: qsTr("Which app opens which file type"), icon: "document-properties-symbolic",
                      keywords: "mime file type тип файла" },
                    { type: "kcm", kcm: "kcm_autostart", package: "plasma-workspace", title: qsTr("Add to autostart"),
                      subtitle: qsTr("Apps and scripts started when you sign in"), icon: "system-run-symbolic",
                      keywords: "autostart startup автозапуск" },
                    { type: "kcm", kcm: "kcm_app-permissions", package: "flatpak-kcm", title: qsTr("App permissions"),
                      subtitle: qsTr("Flatpak sandbox permissions"), icon: "security-low-symbolic",
                      keywords: "flatpak permissions разрешения" },
                ] },
                { title: qsTr("Notifications"), rows: [
                    { type: "toggle", schema: "org.gnome.desktop.notifications", key: "show-banners", invert: true,
                      title: qsTr("Do not disturb"), icon: "notifications-disabled-symbolic",
                      keywords: "notifications dnd уведомления не беспокоить" },
                    { type: "appList", mode: "notifications", title: qsTr("Notifications from apps"),
                      keywords: "notifications apps уведомления приложений" },
                ] },
            ]
        },
        {
            id: "assistant", title: qsTr("AI assistant"), icon: "hypede-assistant-symbolic",
            keywords: "ai assistant chat claude gemini mistral chatgpt grok deepseek ии помощник ассистент нейросеть чат",
            sections: [
                { rows: [ { type: "assistant", title: qsTr("AI assistant"),
                            keywords: "ai assistant provider sign in ии помощник провайдер вход" } ] },
            ]
        },
        {
            id: "accessibility", title: qsTr("Accessibility"), icon: "preferences-desktop-accessibility-symbolic",
            keywords: "accessibility zoom contrast screen reader специальные возможности",
            sections: [
                { title: qsTr("Text and display"), rows: [
                    { type: "slider", schema: iface, key: "text-scaling-factor", from: 0.75, to: 2, step: 0.05,
                      unit: "x", title: qsTr("Text size"), icon: "format-text-larger-symbolic",
                      keywords: "font size large text размер шрифта" },
                    { type: "toggle", schema: "org.gnome.desktop.a11y.interface", key: "high-contrast",
                      title: qsTr("High contrast"), keywords: "contrast контраст" },
                    { type: "toggle", schema: "org.gnome.desktop.a11y.interface", key: "reduced-motion",
                      title: qsTr("Reduce motion"), keywords: "animations анимации" },
                    { type: "combo", schema: iface, key: "cursor-size", title: qsTr("Cursor size"),
                      options: [ { value: 24, label: qsTr("Default") }, { value: 32, label: qsTr("Medium") },
                                 { value: 48, label: qsTr("Large") }, { value: 64, label: qsTr("Larger") },
                                 { value: 96, label: qsTr("Largest") } ] },
                    { type: "toggle", schema: iface, key: "locate-pointer", title: qsTr("Locate pointer with Ctrl") },
                ] },
                { title: qsTr("Assistive tools"), rows: [
                    { type: "toggle", schema: "org.gnome.desktop.a11y.applications", key: "screen-reader-enabled",
                      title: qsTr("Screen reader"), icon: "audio-speakers-symbolic", keywords: "orca reader" },
                    { type: "toggle", schema: "org.gnome.desktop.a11y.applications", key: "screen-magnifier-enabled",
                      title: qsTr("Zoom"), icon: "zoom-in-symbolic", keywords: "magnifier лупа" },
                    { type: "toggle", schema: "org.gnome.desktop.a11y.applications", key: "screen-keyboard-enabled",
                      title: qsTr("On-screen keyboard"), icon: "input-keyboard-symbolic" },
                    { type: "toggle", schema: "org.gnome.desktop.a11y.keyboard", key: "stickykeys-enable",
                      title: qsTr("Sticky keys"), subtitle: qsTr("Press shortcuts one key at a time") },
                    { type: "toggle", schema: "org.gnome.desktop.a11y.keyboard", key: "bouncekeys-enable",
                      title: qsTr("Bounce keys"), subtitle: qsTr("Ignore fast repeated key presses") },
                ] },
            ]
        },
        {
            id: "system", title: qsTr("System preferences"), icon: "preferences-system-symbolic",
            keywords: "system date time language users services startup config система дата время язык службы автозапуск",
            sections: [
                { title: qsTr("Date and time"), rows: [
                    { type: "timezone", title: qsTr("Time zone"), icon: "preferences-system-time-symbolic",
                      keywords: "timezone часовой пояс" },
                    { type: "toggle", schema: "org.gnome.desktop.datetime", key: "automatic-timezone",
                      title: qsTr("Set time zone automatically") },
                    { type: "ntp", title: qsTr("Set time automatically"), keywords: "ntp время синхронизация" },
                    { type: "toggle", schema: "org.gnome.desktop.calendar", key: "show-weekdate",
                      title: qsTr("Week numbers in the calendar") },
                ] },
                { title: qsTr("Languages and inputs"), rows: [
                    { type: "language", title: qsTr("Language"), icon: "preferences-desktop-locale-symbolic",
                      subtitle: qsTr("Applied after you sign in again"), keywords: "language язык интерфейса" },
                    { type: "locale", title: qsTr("Formats"),
                      subtitle: qsTr("Dates, numbers and currency"), keywords: "region formats регион форматы" },
                ] },
                { title: qsTr("Boot and sign-in"), rows: [ { type: "boot", title: qsTr("Boot splash"),
                      keywords: "plymouth boot splash autologin загрузка заставка автовход" },
                    { type: "kcm", kcm: "kcm_sddm", package: "sddm-kcm", title: qsTr("Login screen (SDDM)"),
                      subtitle: qsTr("Theme and background of the login screen"), icon: "system-users-symbolic" } ] },
                { title: qsTr("Hardware and updates"), rows: [
                    { type: "kcm", kcm: "kcm_updates", package: "discover", title: qsTr("Software updates"),
                      icon: "software-update-available-symbolic", keywords: "updates обновления" },
                    { type: "kcm", kcm: "kcm_gamecontroller", package: "plasma-desktop", title: qsTr("Game controllers"),
                      icon: "input-gaming-symbolic", keywords: "gamepad joystick геймпад" },
                    { type: "kcm", kcm: "kcm_bolt", package: "plasma-thunderbolt", title: qsTr("Thunderbolt"),
                      icon: "thunderbolt-symbolic" } ] },
                { title: qsTr("Accounts"), rows: [
                    { type: "kcm", kcm: "kcm_users", package: "plasma-desktop", title: qsTr("Users"),
                      subtitle: qsTr("Accounts, passwords and avatars"), icon: "system-users-symbolic",
                      keywords: "user account password пользователи пароль" },
                ] },
                { title: qsTr("GNOME services"), rows: [
                    { type: "note", title: qsTr("HypeDE starts only the GNOME services it needs. Optional ones start after you sign in again.") },
                    { type: "strvToggle", schema: session, key: "optional-services", item: "file-indexer",
                      title: qsTr("File indexing"), subtitle: qsTr("Search inside files (LocalSearch)"),
                      icon: "system-search-symbolic", keywords: "tracker localsearch индексация" },
                    { type: "strvToggle", schema: session, key: "optional-services", item: "software-updates",
                      title: qsTr("Update notifications"), subtitle: qsTr("GNOME Software in the background"),
                      icon: "software-update-available-symbolic", keywords: "updates обновления" },
                    { type: "strvToggle", schema: session, key: "optional-services", item: "calendar-alarms",
                      title: qsTr("Calendar reminders"), icon: "x-office-calendar-symbolic" },
                    { type: "strvToggle", schema: session, key: "optional-services", item: "remote-desktop",
                      title: qsTr("Sharing and remote desktop"), icon: "preferences-desktop-remote-desktop-symbolic",
                      keywords: "remote rdp vnc sharing удалённый" },
                    { type: "strvToggle", schema: session, key: "optional-services", item: "print-notifications",
                      title: qsTr("Printer notifications"), icon: "hypede-printer-symbolic" },
                    { type: "strvToggle", schema: session, key: "optional-services", item: "disk-health",
                      title: qsTr("Disk health warnings"), icon: "hypede-storage-symbolic", keywords: "smart" },
                    { type: "strvToggle", schema: session, key: "optional-services", item: "smartcard",
                      title: qsTr("Smart cards"), icon: "auth-smartcard-symbolic" },
                    { type: "strvToggle", schema: session, key: "optional-services", item: "usb-protection",
                      title: qsTr("USB protection service"), icon: "drive-removable-media-symbolic" },
                    { type: "strvToggle", schema: session, key: "optional-services", item: "mobile-broadband",
                      title: qsTr("Mobile broadband"), subtitle: qsTr("SIM cards and modems"),
                      icon: "network-cellular-symbolic" },
                    { type: "toggle", schema: session, key: "allow-gnome-extensions", title: qsTr("GNOME extensions"),
                      subtitle: qsTr("Load extensions enabled for regular GNOME. They can break the shelf."),
                      icon: "application-x-addon-symbolic", keywords: "extensions расширения" },
                ] },
                { title: qsTr("Focus modes"), rows: [ { type: "modes", title: qsTr("Focus modes"),
                      keywords: "focus mode work game study режим фокус работа игра учёба" } ] },
                { title: qsTr("Session"), rows: [
                    { type: "combo", schema: shell, key: "session-restore", title: qsTr("Restore windows at sign-in"),
                      icon: "view-restore-symbolic", keywords: "session restore windows сеанс восстановить окна",
                      options: [ { value: "ask", label: qsTr("Ask") }, { value: "always", label: qsTr("Always") },
                                 { value: "never", label: qsTr("Never") } ] } ] },
                { title: qsTr("Startup apps"), rows: [
                    { type: "autostart", title: qsTr("Startup apps"), keywords: "autostart startup автозапуск baloo" },
                ] },
                { title: qsTr("HypeDE configuration"), rows: [
                    { type: "configActions", title: qsTr("HypeDE configuration"),
                      keywords: "config backup export import reset конфиг резервная копия экспорт импорт сброс" },
                ] },
            ]
        },
        {
            id: "about", title: qsTr("About HypeDE"), icon: "help-about-symbolic",
            keywords: "about version system info о системе версия",
            sections: [
                { rows: [ { type: "about", title: qsTr("About HypeDE") } ] },
                { title: qsTr("System information"), rows: [
                    { type: "kcm", kcm: "kcm_about-distro", package: "kinfocenter", title: qsTr("Detailed system information"),
                      icon: "hypede-device-symbolic", keywords: "cpu memory hardware железо" },
                    { type: "kcm", kcm: "kcm_energyinfo", package: "kinfocenter", title: qsTr("Battery"),
                      icon: "battery-symbolic", keywords: "battery energy батарея" },
                    { type: "kcm", kcm: "kcm_block_devices", package: "kinfocenter", title: qsTr("Storage devices"),
                      icon: "hypede-storage-symbolic", keywords: "disk ssd диск" },
                    { type: "kcm", kcm: "kcm_usb", package: "kinfocenter", title: qsTr("USB devices"),
                      icon: "drive-removable-media-symbolic" },
                    { type: "kcm", kcm: "kcm_vulkan", package: "kinfocenter", title: qsTr("Graphics (Vulkan)"),
                      icon: "video-display-symbolic", keywords: "gpu vulkan видеокарта" },
                ] },
                { title: qsTr("Support the project"), rows: [
                    { type: "toggle", schema: "dev.hypede.settings", key: "show-support-card",
                      title: qsTr("Show the “Support me” card"), icon: "emblem-favorite-symbolic",
                      keywords: "ko-fi donate support поддержать донат" },
                ] },
            ]
        },
    ]

    function page(id) {
        for (const p of pages)
            if (p.id === id)
                return p
        return pages[0]
    }

    // Плоский индекс всех строк — для поиска в заголовке окна.
    function search(text) {
        const words = text.toLocaleLowerCase().split(/\s+/).filter(w => w.length > 0)
        if (words.length === 0)
            return []
        const results = []
        const match = haystack => words.every(w => haystack.includes(w))
        for (const p of pages) {
            const pageText = (p.title + " " + (p.keywords || "")).toLocaleLowerCase()
            if (p.kcm && match(pageText))
                results.push({ page: p.id, kcm: p.kcm, title: p.title, subtitle: "", icon: p.icon })
            for (const s of (p.sections || [])) {
                for (const r of s.rows) {
                    if (r.type === "note")
                        continue
                    const text = (r.title + " " + (r.subtitle || "") + " " + (r.keywords || "") + " "
                                  + (s.title || "")).toLocaleLowerCase()
                    if (match(text) || match(pageText + " " + text))
                        results.push({ page: p.id, kcm: r.type === "kcm" ? r.kcm : "", title: r.title,
                                       subtitle: p.title + (s.title ? " › " + s.title : ""),
                                       icon: r.icon || p.icon })
                }
            }
        }
        return results
    }
}
