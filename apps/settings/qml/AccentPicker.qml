import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Dialogs
import HypeSettings

// Цвет акцента (GNOME 47+): им красятся полка, переключатели и выделение.
SettingRow {
    id: row
    readonly property var iface: GSettingsHub.schema("org.gnome.desktop.interface")
    readonly property var shell: GSettingsHub.schema("dev.hypede.shell")
    readonly property string custom: shell.revision >= 0 && shell.valid && shell.hasKey("accent-custom")
                                     ? shell.value("accent-custom") : ""
    readonly property bool available: iface.valid && iface.hasKey("accent-color")
    title: qsTr("Accent color")
    subtitle: qsTr("Used by the shelf, apps and these settings")

    Repeater {
        model: ["blue", "teal", "green", "yellow", "orange", "red", "pink", "purple", "slate"]
        delegate: Rectangle {
            id: dot
            required property string modelData
            readonly property bool selected: row.custom === "" && row.iface.revision >= 0
                                             && row.iface.value("accent-color") === modelData
            width: 24; height: 24; radius: 12
            color: Theme.accents[modelData]
            border.width: selected ? 3 : 0
            border.color: Theme.surface
            Rectangle {
                anchors.fill: parent
                anchors.margins: -3
                radius: width / 2
                color: "transparent"
                border.width: dot.selected ? 2 : 0
                border.color: dot.color
            }
            MouseArea {
                id: dotMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                    if (row.custom !== "")
                        row.shell.setValue("accent-custom", "")
                    row.iface.setValue("accent-color", dot.modelData)
                }
            }
        }
    }

    // Любой цвет: оболочка, «Файлы» и «Настройки» берут его как есть.
    Rectangle {
        id: customDot
        readonly property bool selected: row.custom !== ""
        width: 24; height: 24; radius: 12
        color: selected ? row.custom : "transparent"
        gradient: selected ? null : rainbow
        Gradient {
            id: rainbow
            orientation: Gradient.Horizontal
            GradientStop { position: 0.0; color: "#ff5252" }
            GradientStop { position: 0.35; color: "#ffd740" }
            GradientStop { position: 0.65; color: "#40c4ff" }
            GradientStop { position: 1.0; color: "#e040fb" }
        }
        border.width: selected ? 3 : 0
        border.color: Theme.surface
        Rectangle {
            anchors.fill: parent
            anchors.margins: -3
            radius: width / 2
            color: "transparent"
            border.width: customDot.selected ? 2 : 0
            border.color: customDot.color
        }
        Text {
            visible: !customDot.selected
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
                colorDialog.selectedColor = Theme.accentBase
                colorDialog.open()
            }
        }
        QQC2.ToolTip.visible: customHover.hovered
        QQC2.ToolTip.text: qsTr("Any color")
        HoverHandler { id: customHover }
    }

    ColorDialog {
        id: colorDialog
        title: qsTr("Accent color")
        onAccepted: {
            const c = selectedColor
            const hex = v => Math.round(v * 255).toString(16).padStart(2, "0")
            row.shell.setValue("accent-custom", "#" + hex(c.r) + hex(c.g) + hex(c.b))
        }
    }
}
