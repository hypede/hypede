import QtQuick
import HypeSettings

// Выбор светлой или тёмной темы — две карточки-превью.
Item {
    id: picker
    property bool showDivider: true
    readonly property var iface: GSettingsHub.schema("org.gnome.desktop.interface")
    readonly property bool available: iface.valid
    width: parent ? parent.width : 0
    implicitHeight: 196
    height: implicitHeight

    Rectangle {
        visible: picker.showDivider
        width: parent.width; height: 1
        color: Theme.divider
    }
    Text {
        x: 20; y: 16
        text: qsTr("Theme")
        color: Theme.text
        font.pixelSize: 14
    }
    Row {
        x: 20; y: 48
        spacing: 16
        Repeater {
            model: [
                { value: "default", label: qsTr("Light"), bg: "#f1f4f9", card: "#ffffff", bar: "#dfe5ee" },
                { value: "prefer-dark", label: qsTr("Dark"), bg: "#1b1c1f", card: "#2d2e32", bar: "#3a3b40" },
            ]
            delegate: Column {
                id: option
                required property var modelData
                readonly property bool selected: picker.iface.revision >= 0
                    && (picker.iface.value("color-scheme") === modelData.value
                        || (modelData.value === "default" && picker.iface.value("color-scheme") === "prefer-light"))
                spacing: 8
                Rectangle {
                    width: 180; height: 104
                    radius: 14
                    color: option.modelData.bg
                    border.width: option.selected ? 3 : 1
                    border.color: option.selected ? Theme.accent : Theme.divider
                    Rectangle { x: 14; y: 14; width: 60; height: 76; radius: 8; color: option.modelData.card }
                    Rectangle { x: 84; y: 14; width: 82; height: 34; radius: 8; color: option.modelData.card }
                    Rectangle { x: 84; y: 56; width: 82; height: 34; radius: 8; color: option.modelData.card }
                    Rectangle { x: 22; y: 24; width: 40; height: 8; radius: 4; color: Theme.accentBase }
                    Rectangle { x: 22; y: 40; width: 34; height: 6; radius: 3; color: option.modelData.bar }
                    Rectangle { x: 22; y: 52; width: 38; height: 6; radius: 3; color: option.modelData.bar }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: picker.iface.setValue("color-scheme", option.modelData.value)
                    }
                }
                Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: option.modelData.label
                    color: option.selected ? Theme.accent : Theme.text
                    font.pixelSize: 13
                    font.weight: option.selected ? Font.Medium : Font.Normal
                }
            }
        }
    }
}
