import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Effects
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

    implicitHeight: wanted ? body.height + 24 : 0
    height: implicitHeight
    opacity: wanted ? 1 : 0
    visible: height > 0
    clip: true
    Behavior on implicitHeight { NumberAnimation { duration: Theme.normal; easing.type: Easing.OutCubic } }
    Behavior on opacity { NumberAnimation { duration: Theme.normal } }

    function remove() {
        settings.setValue("show-support-card", false)
    }

    Rectangle {
        id: body
        x: 12
        y: 12
        width: card.width - 24
        height: content.implicitHeight + 28
        radius: Theme.radius
        color: Theme.surface

        Column {
            id: content
            x: 14; y: 14
            width: parent.width - 28
            spacing: 12

            Row {
                spacing: 12
                Rectangle {
                    width: 36; height: 36; radius: 18
                    color: Qt.rgba(card.brand.r, card.brand.g, card.brand.b, Theme.dark ? 0.22 : 0.14)
                    Image {
                        anchors.centerIn: parent
                        width: 20; height: 20
                        sourceSize: Qt.size(40, 40)
                        source: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>"
                                + "<path fill='%23ff5e5b' d='M3 6h13v6a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V6zm13 1h1.5a3 3 0 0 1 0 6H16v-2h1.5a1 1 0 0 0 0-2H16V7zM4 19h14v2H4z'/>"
                                + "<path fill='white' d='M9.5 9.2c.9-.9 2.4-.2 2.4 1 0 1.3-2.4 2.8-2.4 2.8S7.1 11.5 7.1 10.2c0-1.2 1.5-1.9 2.4-1z'/></svg>"
                    }
                }
                Column {
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 1
                    Text {
                        text: "Support Me!"
                        color: Theme.text
                        font.pixelSize: 14
                        font.weight: Font.Medium
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
                height: 34
                radius: 17
                color: card.brand
                Rectangle {
                    anchors.fill: parent
                    radius: parent.radius
                    color: "black"
                    opacity: supportMouse.pressed ? 0.14 : (supportMouse.containsMouse ? 0.07 : 0)
                    Behavior on opacity { NumberAnimation { duration: Theme.fast } }
                }
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
            anchors.fill: parent
            acceptedButtons: Qt.RightButton
            z: -1
            onClicked: mouse => menu.openAt(mouse.x, mouse.y)
            onPressAndHold: mouse => menu.openAt(mouse.x, mouse.y)
        }
    }

    // Контекстное меню в стиле остальных всплывающих окон «Настроек».
    QQC2.Popup {
        id: menu
        parent: body
        padding: 6
        width: 168
        function openAt(x, y) {
            menu.x = Math.min(x, body.width - width)
            menu.y = y - height - 4
            open()
        }
        enter: Transition {
            NumberAnimation { property: "opacity"; from: 0; to: 1; duration: Theme.fast }
        }
        background: Item {
            Rectangle {
                id: menuBg
                anchors.fill: parent
                color: Theme.popup
                radius: 12
                visible: false
            }
            MultiEffect {
                source: menuBg
                anchors.fill: menuBg
                shadowEnabled: true
                shadowColor: Theme.shadow
                shadowBlur: 0.6
                shadowVerticalOffset: 4
                autoPaddingEnabled: true
            }
        }
        contentItem: Rectangle {
            implicitHeight: 40
            radius: 8
            color: removeMouse.containsMouse ? Theme.hover : "transparent"
            Row {
                anchors.left: parent.left
                anchors.leftMargin: 12
                anchors.verticalCenter: parent.verticalCenter
                spacing: 12
                SymbolIcon {
                    source: "window-close-symbolic"
                    width: 18; height: 18
                    anchors.verticalCenter: parent.verticalCenter
                }
                Text {
                    text: qsTr("Remove")
                    color: Theme.text
                    font.pixelSize: 14
                    anchors.verticalCenter: parent.verticalCenter
                }
            }
            MouseArea {
                id: removeMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                    menu.close()
                    card.remove()
                }
            }
        }
    }
}
