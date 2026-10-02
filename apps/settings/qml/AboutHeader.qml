import QtQuick
import HypeSettings

// «О HypeDE»: логотип, версия и из чего собрана среда.
Item {
    id: about
    width: parent ? parent.width : 0
    implicitHeight: column.implicitHeight + 40
    height: implicitHeight

    Column {
        id: column
        width: parent.width - 40
        x: 20
        y: 20
        spacing: 16

        Row {
            spacing: 20
            SymbolIcon {
                source: "hypede"
                fallback: "dev.hypede.Settings"
                width: 72; height: 72
                anchors.verticalCenter: parent.verticalCenter
            }
            Column {
                anchors.verticalCenter: parent.verticalCenter
                spacing: 4
                Text {
                    text: "HypeDE"
                    color: Theme.text
                    font.pixelSize: 26
                    font.weight: Font.Medium
                }
                Text {
                    id: version
                    property int taps: 0
                    text: qsTr("Version %1").arg(System.appVersion)
                    color: Theme.subtext
                    font.pixelSize: 14
                    scale: tapArea.pressed ? 0.94 : 1
                    Behavior on scale { NumberAnimation { duration: 90 } }
                    MouseArea {
                        id: tapArea
                        anchors.fill: parent
                        onClicked: {
                            version.taps++
                            tapReset.restart()
                            if (version.taps >= 15) {
                                version.taps = 0
                                egg.open()
                            }
                        }
                    }
                    Timer { id: tapReset; interval: 3000; onTriggered: version.taps = 0 }
                    EasterEgg { id: egg }
                }
                Text {
                    text: qsTr("GNOME in the style of Chrome OS, with KDE settings modules")
                    color: Theme.subtext
                    font.pixelSize: 13
                }
            }
        }

        Grid {
            columns: 2
            columnSpacing: 24
            rowSpacing: 8
            Repeater {
                // Пары «название — значение» в две колонки.
                model: [
                    qsTr("Operating system"), System.osName,
                    qsTr("GNOME Shell"), System.shellVersion || "—",
                    qsTr("KDE Frameworks"), System.kfVersion,
                    qsTr("Qt"), System.qtVersion,
                    qsTr("Kernel"), System.kernel,
                    qsTr("Device name"), System.hostname,
                ]
                delegate: Text {
                    required property var modelData
                    required property int index
                    text: modelData
                    color: index % 2 === 0 ? Theme.subtext : Theme.text
                    font.pixelSize: 14
                }
            }
        }

        Row {
            spacing: 12
            ChromeButton {
                text: qsTr("Project page")
                iconName: "web-browser-symbolic"
                onClicked: System.openUrl("https://hypede.github.io")
            }
            ChromeButton {
                text: qsTr("Report a problem")
                iconName: "dialog-warning-symbolic"
                onClicked: System.openUrl("https://github.com/hypede/hypede/issues")
            }
        }
    }
}
