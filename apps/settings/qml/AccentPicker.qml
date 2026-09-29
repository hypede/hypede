import QtQuick
import QtQuick.Controls as QQC2
import HypeSettings

// Цвет акцента (GNOME 47+): им красятся полка, переключатели и выделение.
SettingRow {
    id: row
    readonly property var iface: GSettingsHub.schema("org.gnome.desktop.interface")
    readonly property bool available: iface.valid && iface.hasKey("accent-color")
    title: qsTr("Accent color")
    subtitle: qsTr("Used by the shelf, apps and these settings")

    Repeater {
        model: ["blue", "teal", "green", "yellow", "orange", "red", "pink", "purple", "slate"]
        delegate: Rectangle {
            id: dot
            required property string modelData
            readonly property bool selected: row.iface.revision >= 0 && row.iface.value("accent-color") === modelData
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
                onClicked: row.iface.setValue("accent-color", dot.modelData)
            }
        }
    }
}
