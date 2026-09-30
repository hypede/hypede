pragma Singleton

import QtQuick
import HypeSettings

// Палитра «Настроек» по системе цветов Chrome OS (Material 3): светло-серый
// фон окна, белые карточки без рамок, тональные цвета из акцента GNOME.
QtObject {
    id: theme

    readonly property var iface: GSettingsHub.schema("org.gnome.desktop.interface")
    readonly property bool dark: iface.revision >= 0 && iface.valid
                                 && iface.value("color-scheme") === "prefer-dark"
    readonly property string accentName: iface.revision >= 0 && iface.hasKey("accent-color")
                                         ? iface.value("accent-color") : "blue"

    // Акценты GNOME 47+ (org.gnome.desktop.interface accent-color)
    readonly property var accents: ({
        "blue": "#3584e4", "teal": "#2190a4", "green": "#3a944a",
        "yellow": "#c88800", "orange": "#ed5b00", "red": "#e62d42",
        "pink": "#d56199", "purple": "#9141ac", "slate": "#6f8396"
    })
    readonly property color accentBase: accents[accentName] || "#3584e4"

    // Смешать два цвета; строки вида «#ffffff» сначала становятся цветом.
    function mix(a, b, t) {
        a = Qt.lighter(a, 1)
        b = Qt.lighter(b, 1)
        return Qt.rgba(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, 1)
    }

    // Основной цвет и его тона
    readonly property color accent: dark ? mix(accentBase, "#ffffff", 0.55) : mix(accentBase, "#000000", 0.28)
    readonly property color accentText: dark ? mix(accentBase, "#000000", 0.72) : "#ffffff"
    readonly property color accentContainer: dark ? mix(accentBase, "#1b1c1e", 0.62) : mix(accentBase, "#ffffff", 0.80)
    readonly property color accentContainerText: dark ? mix(accentBase, "#ffffff", 0.78) : mix(accentBase, "#000000", 0.70)
    readonly property color tonal: dark ? mix(accentBase, "#2a2b2e", 0.80) : mix(accentBase, "#ffffff", 0.88)
    readonly property color tonalText: dark ? mix(accentBase, "#ffffff", 0.80) : mix(accentBase, "#000000", 0.62)

    // Поверхности
    readonly property color window: dark ? "#1b1c1e" : mix(accentBase, "#f6f8fb", 0.96)
    readonly property color surface: dark ? "#26272a" : "#ffffff"
    readonly property color field: dark ? "#333438" : mix(accentBase, "#eef1f5", 0.94)
    readonly property color fieldHover: dark ? "#3c3d42" : mix(accentBase, "#e4e8ee", 0.93)
    readonly property color popup: dark ? "#2f3034" : "#ffffff"
    // Для блоков, которые ещё зовут цвет по-старому
    readonly property color surfaceVariant: field

    // Текст и линии
    readonly property color text: dark ? "#e3e3e3" : "#1f1f1f"
    readonly property color subtext: dark ? "#c4c7c5" : "#444746"
    readonly property color outline: dark ? "#8e918f" : "#747775"
    readonly property color divider: dark ? Qt.rgba(1, 1, 1, 0.08) : Qt.rgba(0, 0, 0, 0.07)
    readonly property color hover: dark ? Qt.rgba(1, 1, 1, 0.06) : Qt.rgba(0, 0, 0, 0.04)
    readonly property color pressed: dark ? Qt.rgba(1, 1, 1, 0.10) : Qt.rgba(0, 0, 0, 0.08)
    readonly property color switchTrackOff: dark ? "#3c3d42" : "#e1e3e6"
    readonly property color danger: dark ? "#f2b8b5" : "#b3261e"
    readonly property color shadow: dark ? Qt.rgba(0, 0, 0, 0.5) : Qt.rgba(0.1, 0.12, 0.18, 0.18)

    readonly property int radius: 16
    readonly property int rowHeight: 56
    readonly property int contentWidth: 720
    readonly property int navWidth: 280

    // Длительности анимаций, мс
    readonly property int fast: 120
    readonly property int normal: 200
}
