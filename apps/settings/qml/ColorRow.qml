import QtQuick
import QtQuick.Dialogs
import HypeSettings

// Цвет строкой '#rrggbb' в ключе GSettings. Пустая строка — «Авто»
// (цвет по умолчанию для светлой или тёмной схемы).
SettingRow {
    id: row
    property var settings
    property string key
    property var presets: ["#202124", "#0b57d0", "#0f9d8f", "#d6337a", "#ff7a45", "#7c4dff", "#e8ecf4", "#fbe7f0"]
    property bool allowAuto: true
    readonly property bool available: settings !== null && settings.valid && settings.hasKey(key)
    readonly property string value: settings && settings.revision >= 0 && available ? settings.value(key) : ""

    function pick(color) {
        settings.setValue(key, color)
    }

    Row {
        spacing: 8
        anchors.verticalCenter: parent ? parent.verticalCenter : undefined

        // «Авто»
        Rectangle {
            visible: row.allowAuto
            width: autoLabel.implicitWidth + 20; height: 28; radius: 14
            color: row.value === "" ? Theme.accentContainer : Theme.field
            border.width: autoMouse.containsMouse && row.value !== "" ? 1 : 0
            border.color: Theme.outline
            Text {
                id: autoLabel
                anchors.centerIn: parent
                text: qsTr("Auto")
                font.pixelSize: 12
                color: row.value === "" ? Theme.accentContainerText : Theme.text
            }
            MouseArea {
                id: autoMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: row.pick("")
            }
        }

        Repeater {
            model: row.presets
            delegate: Rectangle {
                id: swatch
                required property string modelData
                readonly property bool selected: row.value.toLowerCase() === modelData.toLowerCase()
                width: 24; height: 24; radius: 12
                color: modelData
                border.width: 1
                border.color: Theme.divider
                Rectangle {
                    anchors.fill: parent
                    anchors.margins: -4
                    radius: width / 2
                    color: "transparent"
                    border.width: swatch.selected ? 2 : 0
                    border.color: Theme.accent
                }
                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: row.pick(swatch.modelData)
                }
            }
        }

        // Свой цвет: круг с радугой; если выбран цвет не из набора — он сам.
        Rectangle {
            id: customDot
            readonly property bool custom: row.value !== "" && !row.presets.some(p => p.toLowerCase() === row.value.toLowerCase())
            width: 24; height: 24; radius: 12
            gradient: custom ? null : rainbow
            color: custom ? row.value : "transparent"
            Gradient {
                id: rainbow
                orientation: Gradient.Horizontal
                GradientStop { position: 0.0; color: "#ff5252" }
                GradientStop { position: 0.35; color: "#ffd740" }
                GradientStop { position: 0.65; color: "#40c4ff" }
                GradientStop { position: 1.0; color: "#e040fb" }
            }
            Rectangle {
                anchors.fill: parent
                anchors.margins: -4
                radius: width / 2
                color: "transparent"
                border.width: customDot.custom ? 2 : 0
                border.color: Theme.accent
            }
            Text {
                visible: !customDot.custom
                anchors.centerIn: parent
                text: "+"
                color: "#ffffff"
                font.pixelSize: 15
                font.bold: true
            }
            MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                    dialog.selectedColor = row.value !== "" ? row.value : Theme.accentBase
                    dialog.open()
                }
            }
        }
    }

    ColorDialog {
        id: dialog
        title: row.title
        onAccepted: {
            const c = selectedColor
            const hex = v => Math.round(v * 255).toString(16).padStart(2, "0")
            row.pick("#" + hex(c.r) + hex(c.g) + hex(c.b))
        }
    }
}
