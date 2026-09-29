import QtQuick
import HypeSettings

// Хранилище: занятое и свободное место на дисках, очистка корзины.
Item {
    id: block
    property bool showDivider: true
    property var volumes: System.storage()
    readonly property bool available: volumes.length > 0

    width: parent ? parent.width : 0
    implicitHeight: column.implicitHeight
    height: implicitHeight

    Rectangle {
        visible: block.showDivider
        width: parent.width; height: 1
        color: Theme.divider
    }

    Column {
        id: column
        width: parent.width
        topPadding: 8
        bottomPadding: 8

        Repeater {
            model: block.volumes
            delegate: Item {
                id: volume
                required property var modelData
                readonly property real usedFraction: 1 - modelData.free / modelData.total
                width: column.width
                height: 76

                SymbolIcon {
                    id: icon
                    source: volume.modelData.path === "/" ? "drive-harddisk-system-symbolic" : "drive-harddisk-symbolic"
                    width: 20; height: 20
                    x: 20
                    anchors.verticalCenter: parent.verticalCenter
                }
                Column {
                    anchors.left: icon.right
                    anchors.leftMargin: 16
                    anchors.right: parent.right
                    anchors.rightMargin: 20
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 8
                    Item {
                        width: parent.width
                        height: nameText.implicitHeight
                        Text {
                            id: nameText
                            text: volume.modelData.name
                            color: Theme.text
                            font.pixelSize: 14
                        }
                        Text {
                            anchors.right: parent.right
                            text: qsTr("%1 free of %2").arg(System.formatSize(volume.modelData.free))
                                                      .arg(System.formatSize(volume.modelData.total))
                            color: Theme.subtext
                            font.pixelSize: 13
                        }
                    }
                    Rectangle {
                        width: parent.width
                        height: 8
                        radius: 4
                        color: Theme.switchTrackOff
                        Rectangle {
                            id: fill
                            height: parent.height
                            radius: 4
                            width: 0
                            color: volume.usedFraction > 0.9 ? Theme.danger : Theme.accent
                            Component.onCompleted: width = Qt.binding(() => parent.width * volume.usedFraction)
                            Behavior on width { NumberAnimation { duration: 700; easing.type: Easing.OutCubic } }
                        }
                    }
                }
            }
        }

        SettingRow {
            id: trashRow
            property bool done: false
            title: qsTr("Trash")
            subtitle: done ? qsTr("Trash emptied") : qsTr("Permanently delete files in the trash")
            iconName: "user-trash-symbolic"
            ChromeButton {
                text: qsTr("Empty trash")
                danger: true
                onClicked: {
                    trashRow.done = System.emptyTrash()
                    block.volumes = System.storage()
                }
            }
        }
    }
}
