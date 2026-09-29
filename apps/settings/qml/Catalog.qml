pragma Singleton

import QtQuick

// Каталог «Настроек»: разделы левого меню, их карточки и строки.
//
// Строка описывается объектом; поле type выбирает вид:
//   toggle  — переключатель GSettings    {schema, key, invert}
//   slider  — ползунок GSettings         {schema, key, from, to, step, unit}
//   combo   — выбор из списка            {schema, key, options: [{value, label}]}
//   kcm     — модуль настроек KDE        {kcm, icon, package}
//   run     — запуск программы           {argv, program}
//   power, wifi, ntp, locale, timezone, clearHistory, searchEngine
//           — строки с особой логикой (см. RowDelegate.qml)
//   wallpaper, theme, accent, inputSources, about — целые блоки
// Необязательные поля: subtitle, icon, keywords (для поиска),
//   visibleWhen: {schema, key, value} — показывать только при значении ключа.
//
// Модули KDE выбраны те, что работают вне Plasma: они говорят со
// стандартными службами (NetworkManager, BlueZ, PipeWire, CUPS,
// AccountsService, mimeapps.list, XDG autostart, Flatpak). То, что в KDE
// завязано на KWin или PowerDevil (экраны, мышь, питание, раскладки),
// сделано здесь на GSettings — ими управляет GNOME.
QtObject {
    readonly property string iface: "org.gnome.desktop.interface"
    readonly property string mouse: "org.gnome.desktop.peripherals.mouse"
    readonly property string touchpad: "org.gnome.desktop.peripherals.touchpad"
    readonly property string keyboard: "org.gnome.desktop.peripherals.keyboard"
    readonly property string color: "org.gnome.settings-daemon.plugins.color"
    readonly property string power: "org.gnome.settings-daemon.plugins.power"
    readonly property string shell: "dev.hypede.shell"

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
            id: "devices", title: qsTr("Device"), icon: "computer-symbolic",
            keywords: "device mouse touchpad keyboard display sound printer power устройство",
            sections: [
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
                ] },
                { title: qsTr("Keyboard and inputs"), rows: [
                    { type: "inputSources", title: qsTr("Input methods"), keywords: "layout раскладка язык ввода" },
                    { type: "toggle", schema: keyboard, key: "repeat", title: qsTr("Auto-repeat"),
                      icon: "input-keyboard-symbolic", keywords: "repeat повтор клавиш" },
                    { type: "slider", schema: keyboard, key: "delay", from: 100, to: 2000, step: 50,
                      unit: "ms", title: qsTr("Delay before repeat"),
                      visibleWhen: { schema: keyboard, key: "repeat", value: true } },
                    { type: "slider", schema: keyboard, key: "repeat-interval", from: 5, to: 200, step: 5,
                      unit: "ms", title: qsTr("Repeat interval"),
                      visibleWhen: { schema: keyboard, key: "repeat", value: true } },
                ] },
                { title: qsTr("Display"), rows: [
                    { type: "toggle", schema: color, key: "night-light-enabled", title: qsTr("Night Light"),
                      subtitle: qsTr("Makes it easier to look at your screen in dim light"),
                      icon: "night-light-symbolic", keywords: "night light ночной свет" },
                    { type: "slider", schema: color, key: "night-light-temperature", from: 1700, to: 4700,
                      step: 100, unit: "K", invertSlider: true, title: qsTr("Color temperature"),
                      visibleWhen: { schema: color, key: "night-light-enabled", value: true } },
                    { type: "toggle", schema: color, key: "night-light-schedule-automatic",
                      title: qsTr("Sunset to sunrise"),
                      visibleWhen: { schema: color, key: "night-light-enabled", value: true } },
                    { type: "run", argv: ["gnome-control-center", "display"], program: "gnome-control-center",
                      title: qsTr("Displays"), subtitle: qsTr("Resolution, arrangement and scale"),
                      icon: "video-display-symbolic", keywords: "resolution scale monitor экран разрешение масштаб" },
                ] },
                { title: qsTr("Sound and printing"), rows: [
                    { type: "kcm", kcm: "kcm_pulseaudio", package: "plasma-pa", title: qsTr("Sound"),
                      subtitle: qsTr("Output and input devices, volume"),
                      icon: "audio-speakers-symbolic", keywords: "audio volume microphone звук громкость микрофон" },
                    { type: "kcm", kcm: "kcm_printer_manager", package: "print-manager", title: qsTr("Printers"),
                      icon: "printer-symbolic", keywords: "printer cups принтер печать" },
                ] },
                { title: qsTr("Power"), rows: [
                    { type: "power", title: qsTr("Power mode"), icon: "power-profile-balanced-symbolic",
                      keywords: "power battery performance питание батарея производительность" },
                    { type: "toggle", schema: iface, key: "show-battery-percentage",
                      title: qsTr("Show battery percentage") },
                    { type: "combo", schema: power, key: "sleep-inactive-ac-timeout",
                      title: qsTr("Sleep when idle on power"), keywords: "sleep suspend сон",
                      options: [ { value: 900, label: qsTr("15 minutes") }, { value: 1800, label: qsTr("30 minutes") },
                                 { value: 3600, label: qsTr("1 hour") }, { value: 7200, label: qsTr("2 hours") } ] },
                    { type: "combo", schema: power, key: "sleep-inactive-ac-type", title: qsTr("When idle on power"),
                      options: [ { value: "suspend", label: qsTr("Sleep") }, { value: "nothing", label: qsTr("Stay awake") } ] },
                    { type: "combo", schema: power, key: "power-button-action", title: qsTr("Power button"),
                      options: [ { value: "interactive", label: qsTr("Ask") }, { value: "suspend", label: qsTr("Sleep") },
                                 { value: "hibernate", label: qsTr("Hibernate") }, { value: "nothing", label: qsTr("Do nothing") } ] },
                ] },
            ]
        },
        {
            id: "personalization", title: qsTr("Personalization"), icon: "applications-graphics-symbolic",
            keywords: "wallpaper theme dark light accent shelf обои тема полка",
            sections: [
                { title: qsTr("Wallpaper"), rows: [ { type: "wallpaper", title: qsTr("Wallpaper"),
                                                      keywords: "wallpaper background обои фон" } ] },
                { title: qsTr("Style"), rows: [
                    { type: "theme", title: qsTr("Theme"), keywords: "dark light тёмная светлая тема" },
                    { type: "accent", title: qsTr("Accent color"), keywords: "accent color цвет акцент" },
                ] },
                { title: qsTr("Shelf"), rows: [
                    { type: "combo", schema: shell, key: "shelf-alignment", title: qsTr("Shelf position of apps"),
                      icon: "view-app-grid-symbolic", keywords: "shelf dock полка",
                      options: [ { value: "center", label: qsTr("Center") }, { value: "left", label: qsTr("Left") } ] },
                    { type: "toggle", schema: shell, key: "shelf-autohide", title: qsTr("Autohide shelf"),
                      subtitle: qsTr("The shelf slides away when a window touches it"), keywords: "autohide скрывать" },
                    { type: "toggle", schema: shell, key: "show-date", title: qsTr("Show date on the shelf") },
                    { type: "combo", schema: iface, key: "clock-format", title: qsTr("Clock format"),
                      keywords: "clock 24 hour часы",
                      options: [ { value: "24h", label: qsTr("24-hour") }, { value: "12h", label: qsTr("12-hour") } ] },
                ] },
                { title: qsTr("Launcher"), rows: [
                    { type: "combo", schema: shell, key: "super-key-action", title: qsTr("Everything key (Super)"),
                      keywords: "super launcher лаунчер",
                      options: [ { value: "launcher", label: qsTr("Opens the launcher") },
                                 { value: "overview", label: qsTr("Opens the overview") } ] },
                    { type: "toggle", schema: shell, key: "show-recent-files",
                      title: qsTr("Show “Continue where you left off”") },
                    { type: "combo", schema: shell, key: "launcher-columns", title: qsTr("Apps per row"),
                      options: [ { value: 4, label: "4" }, { value: 5, label: "5" }, { value: 6, label: "6" } ] },
                ] },
            ]
        },
        {
            id: "privacy", title: qsTr("Security and privacy"), icon: "security-high-symbolic",
            keywords: "privacy security lock screen firewall блокировка безопасность приватность",
            sections: [
                { title: qsTr("Screen lock"), rows: [
                    { type: "toggle", schema: "org.gnome.desktop.screensaver", key: "lock-enabled",
                      title: qsTr("Lock when screen turns off"), icon: "system-lock-screen-symbolic",
                      keywords: "lock блокировка" },
                    { type: "combo", schema: "org.gnome.desktop.session", key: "idle-delay",
                      title: qsTr("Turn off screen when idle"), keywords: "blank screen idle экран",
                      options: [ { value: 60, label: qsTr("1 minute") }, { value: 300, label: qsTr("5 minutes") },
                                 { value: 600, label: qsTr("10 minutes") }, { value: 900, label: qsTr("15 minutes") },
                                 { value: 0, label: qsTr("Never") } ] },
                    { type: "toggle", schema: "org.gnome.desktop.notifications", key: "show-in-lock-screen",
                      title: qsTr("Notifications on lock screen") },
                ] },
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
                    { type: "kcm", kcm: "kcm_autostart", package: "plasma-workspace", title: qsTr("Autostart"),
                      subtitle: qsTr("Apps started when you sign in"), icon: "system-run-symbolic",
                      keywords: "autostart startup автозапуск" },
                    { type: "kcm", kcm: "kcm_app-permissions", package: "flatpak-kcm", title: qsTr("App permissions"),
                      subtitle: qsTr("Flatpak sandbox permissions"), icon: "security-low-symbolic",
                      keywords: "flatpak permissions разрешения" },
                ] },
                { title: qsTr("Notifications"), rows: [
                    { type: "toggle", schema: "org.gnome.desktop.notifications", key: "show-banners", invert: true,
                      title: qsTr("Do not disturb"), icon: "notifications-disabled-symbolic",
                      keywords: "notifications dnd уведомления не беспокоить" },
                ] },
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
                ] },
            ]
        },
        {
            id: "system", title: qsTr("System preferences"), icon: "preferences-system-symbolic",
            keywords: "system date time language users search система дата время язык",
            sections: [
                { title: qsTr("Date and time"), rows: [
                    { type: "timezone", title: qsTr("Time zone"), icon: "preferences-system-time-symbolic",
                      keywords: "timezone часовой пояс" },
                    { type: "toggle", schema: "org.gnome.desktop.datetime", key: "automatic-timezone",
                      title: qsTr("Set time zone automatically") },
                    { type: "ntp", title: qsTr("Set time automatically"), keywords: "ntp время синхронизация" },
                ] },
                { title: qsTr("Languages and inputs"), rows: [
                    { type: "locale", title: qsTr("Formats"), icon: "preferences-desktop-locale-symbolic",
                      subtitle: qsTr("Dates, numbers and currency"), keywords: "region formats регион форматы" },
                ] },
                { title: qsTr("Accounts"), rows: [
                    { type: "kcm", kcm: "kcm_users", package: "plasma-desktop", title: qsTr("Users"),
                      subtitle: qsTr("Accounts, passwords and avatars"), icon: "system-users-symbolic",
                      keywords: "user account password пользователи пароль" },
                ] },
                { title: qsTr("Search engine"), rows: [
                    { type: "searchEngine", title: qsTr("Search engine used in the launcher"),
                      icon: "web-browser-symbolic", keywords: "google yandex duckduckgo поиск" },
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
                      icon: "computer-symbolic", keywords: "cpu memory hardware железо" },
                    { type: "kcm", kcm: "kcm_energyinfo", package: "kinfocenter", title: qsTr("Battery"),
                      icon: "battery-symbolic", keywords: "battery energy батарея" },
                    { type: "kcm", kcm: "kcm_block_devices", package: "kinfocenter", title: qsTr("Storage devices"),
                      icon: "drive-harddisk-symbolic", keywords: "disk ssd диск" },
                    { type: "kcm", kcm: "kcm_usb", package: "kinfocenter", title: qsTr("USB devices"),
                      icon: "drive-removable-media-symbolic" },
                    { type: "kcm", kcm: "kcm_vulkan", package: "kinfocenter", title: qsTr("Graphics (Vulkan)"),
                      icon: "video-display-symbolic", keywords: "gpu vulkan видеокарта" },
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
