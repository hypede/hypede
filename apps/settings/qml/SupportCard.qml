import QtQuick
import QtQuick.Controls as QQC2
import HypeSettings

// Карточка «Support Me!» внизу левого меню. Ведёт на страницу Ko-fi.
// Правый щелчок → «Убрать»: карточка сворачивается и больше не
// показывается (вернуть — «О HypeDE → Поддержать проект»).
Item {
    id: card
    readonly property var settings: GSettingsHub.schema("dev.hypede.settings")
    readonly property bool wanted: !settings.valid || (settings.revision >= 0 && settings.value("show-support-card") !== false)
    readonly property string url: "https://ko-fi.com/pycodder"
    // Фирменный цвет Ko-fi
    readonly property color brand: "#ff5e5b"

    implicitHeight: wanted ? body.implicitHeight + 24 : 0
    height: implicitHeight
    opacity: wanted ? 1 : 0
    visible: height > 0
    clip: true
    Behavior on implicitHeight { NumberAnimation { duration: 280; easing.type: Easing.OutCubic } }
    Behavior on opacity { NumberAnimation { duration: 220 } }

    function remove() {
        settings.setValue("show-support-card", false)
    }

    Rectangle {
        id: body
        x: 12
        y: 12
        width: card.width - 24
        implicitHeight: content.implicitHeight + 32
        height: implicitHeight
        radius: 20
        color: Theme.dark ? Qt.rgba(card.brand.r, card.brand.g, card.brand.b, 0.16)
                          : Qt.rgba(card.brand.r, card.brand.g, card.brand.b, 0.10)
        border.width: 1
        border.color: Qt.rgba(card.brand.r, card.brand.g, card.brand.b, Theme.dark ? 0.35 : 0.25)
        scale: mouse.pressed ? 0.98 : (mouse.containsMouse ? 1.01 : 1)
        Behavior on scale { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }

        Column {
            id: content
            x: 16; y: 16
            width: parent.width - 32
            spacing: 12

            Row {
                spacing: 12
                // Чашка кофе — рисунок SVG, чтобы не зависеть от темы значков.
                Rectangle {
                    width: 40; height: 40; radius: 20
                    color: card.brand
                    Image {
                        id: cup
                        anchors.centerIn: parent
                        width: 22; height: 22
                        sourceSize: Qt.size(44, 44)
                        source: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>"
                                + "<path fill='white' d='M3 6h13v6a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V6zm13 1h1.5a3 3 0 0 1 0 6H16v-2h1.5a1 1 0 0 0 0-2H16V7zM4 19h14v2H4z'/>"
                                + "<path fill='%23ff5e5b' d='M9.5 9.2c.9-.9 2.4-.2 2.4 1 0 1.3-2.4 2.8-2.4 2.8S7.1 11.5 7.1 10.2c0-1.2 1.5-1.9 2.4-1z'/></svg>"
                        // Лёгкое «покачивание», когда указатель над карточкой.
                        SequentialAnimation on rotation {
                            running: mouse.containsMouse
                            loops: Animation.Infinite
                            alwaysRunToEnd: true
                            NumberAnimation { to: -8; duration: 180; easing.type: Easing.OutQuad }
                            NumberAnimation { to: 8; duration: 360; easing.type: Easing.InOutQuad }
                            NumberAnimation { to: 0; duration: 180; easing.type: Easing.InQuad }
                            PauseAnimation { duration: 600 }
                        }
                    }
                }
                Column {
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 2
                    Text {
                        text: "Support Me!"
                        color: Theme.text
                        font.pixelSize: 15
                        font.weight: Font.DemiBold
                    }
                    Text {
                        text: "Donate on Ko-Fi!"
                        color: Theme.subtext
                        font.pixelSize: 13
                    }
                }
            }

            Rectangle {
                width: parent.width
                height: 36
                radius: 18
                color: supportMouse.pressed ? Qt.darker(card.brand, 1.15)
                       : (supportMouse.containsMouse ? Qt.darker(card.brand, 1.06) : card.brand)
                Behavior on color { ColorAnimation { duration: 120 } }
                Text {
                    anchors.centerIn: parent
                    text: "Support"
                    color: "white"
                    font.pixelSize: 14
                    font.weight: Font.Medium
                }
                MouseArea {
                    id: supportMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    acceptedButtons: Qt.LeftButton
                    onClicked: Qt.openUrlExternally(card.url)
                }
            }
        }

        MouseArea {
            id: mouse
            anchors.fill: parent
            hoverEnabled: true
            acceptedButtons: Qt.RightButton
            z: -1
            onClicked: mouseEvent => menu.popup()
            onPressAndHold: menu.popup()
        }
    }

    QQC2.Menu {
        id: menu
        QQC2.MenuItem {
            text: qsTr("Remove")
            icon.name: "window-close-symbolic"
            onTriggered: card.remove()
        }
    }
}
