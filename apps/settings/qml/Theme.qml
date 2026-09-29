pragma Singleton

import QtQuick
import HypeSettings

// Палитра «Настроек» в духе Chrome OS (Material You): спокойный фон,
// белые карточки, тональные выделения из системного акцента GNOME.
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

    readonly property color accent: dark ? Qt.lighter(accentBase, 1.55) : Qt.darker(accentBase, 1.2)
    readonly property color onAccent: dark ? Qt.darker(accentBase, 2.6) : "#ffffff"
    readonly property color accentContainer: dark
        ? Qt.rgba(accentBase.r, accentBase.g, accentBase.b, 0.32)
        : Qt.tint("#ffffff", Qt.rgba(accentBase.r, accentBase.g, accentBase.b, 0.20))
    readonly property color onAccentContainer: dark ? Qt.lighter(accentBase, 1.8) : Qt.darker(accentBase, 2.1)

    readonly property color window: dark ? "#1b1c1f" : "#f1f4f9"
    readonly property color surface: dark ? "#26272b" : "#ffffff"
    readonly property color surfaceVariant: dark ? "#303136" : "#e7ebf2"
    readonly property color text: dark ? "#e3e3e3" : "#1f1f1f"
    readonly property color subtext: dark ? "#b9bcc1" : "#5f6368"
    readonly property color divider: dark ? "#37383d" : "#e6e9ef"
    readonly property color hover: dark ? Qt.rgba(1, 1, 1, 0.06) : Qt.rgba(0, 0, 0, 0.045)
    readonly property color pressed: dark ? Qt.rgba(1, 1, 1, 0.10) : Qt.rgba(0, 0, 0, 0.08)
    readonly property color switchTrackOff: dark ? "#5f6368" : "#dadce0"
    readonly property color danger: dark ? "#f28b82" : "#c5221f"

    readonly property int radius: 16
    readonly property int rowHeight: 56
    readonly property int contentWidth: 720
    readonly property int navWidth: 300
}
