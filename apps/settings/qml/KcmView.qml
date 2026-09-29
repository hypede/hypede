import QtQuick
import HypeSettings

// Страница с модулем KDE. Сам модуль — это виджет Qt, который KcmHost
// кладёт поверх QML ровно в прямоугольник «окна» внутри карточки.
Item {
    id: view
    property string kcm
    property bool canGoBack: false
    property bool obscured: false
    signal back()

    function syncViewport() {
        const p = hole.mapToItem(null, 0, 0)
        KcmHost.setViewport(p.x, p.y, hole.width, hole.height)
        KcmHost.setShown(view.visible && !view.obscured && KcmHost.error === "")
    }

    onKcmChanged: if (kcm) KcmHost.open(kcm)
    Component.onCompleted: { if (kcm) KcmHost.open(kcm); geometryTimer.start() }
    onVisibleChanged: geometryTimer.start()
    onObscuredChanged: geometryTimer.start()
    onWidthChanged: geometryTimer.start()
    onHeightChanged: geometryTimer.start()
    Connections {
        target: KcmHost
        function onCurrentChanged() { geometryTimer.start() }
    }
    Timer {
        id: geometryTimer
        interval: 0
        onTriggered: view.syncViewport()
    }

    Column {
        id: column
        width: Math.min(Theme.contentWidth + 160, view.width - 48)
        x: (view.width - width) / 2
        height: view.height
        spacing: 12
        topPadding: 8

        // Заголовок: «‹ Звук»  …  [По умолчанию] [Сбросить] [Применить]
        Item {
            id: header
            width: parent.width
            height: 44
            Rectangle {
                id: backButton
                visible: view.canGoBack
                width: 36; height: 36
                radius: 18
                anchors.verticalCenter: parent.verticalCenter
                color: backMouse.containsMouse ? Theme.hover : "transparent"
                SymbolIcon {
                    anchors.centerIn: parent
                    source: "go-previous-symbolic"
                    tint: Theme.text
                    width: 20; height: 20
                }
                MouseArea {
                    id: backMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: view.back()
                }
            }
            Text {
                anchors.left: backButton.visible ? backButton.right : parent.left
                anchors.leftMargin: backButton.visible ? 8 : 4
                anchors.right: buttons.left
                anchors.verticalCenter: parent.verticalCenter
                text: KcmHost.ownTitle && KcmHost.error === "" ? "" : KcmHost.title
                color: Theme.text
                font.pixelSize: 22
                elide: Text.ElideRight
            }
            Row {
                id: buttons
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                spacing: 8
                ChromeButton {
                    visible: KcmHost.showDefaults
                    enabled: !KcmHost.representsDefaults
                    text: qsTr("Defaults")
                    onClicked: KcmHost.defaults()
                }
                ChromeButton {
                    visible: KcmHost.showApply
                    enabled: KcmHost.needsSave
                    text: qsTr("Reset")
                    onClicked: KcmHost.reset()
                }
                ChromeButton {
                    visible: KcmHost.showApply
                    enabled: KcmHost.needsSave
                    filled: true
                    text: qsTr("Apply")
                    onClicked: KcmHost.apply()
                }
            }
        }

        Card {
            id: card
            width: parent.width
            height: view.height - header.height - column.topPadding - column.spacing - 24

            Item {
                id: hole
                width: card.width - 16
                height: card.height - 16
                x: 8
                y: 8
                onWidthChanged: geometryTimer.start()
                onHeightChanged: geometryTimer.start()

                Column {
                    visible: KcmHost.error !== ""
                    anchors.centerIn: parent
                    spacing: 16
                    SymbolIcon {
                        anchors.horizontalCenter: parent.horizontalCenter
                        source: "dialog-warning-symbolic"
                        width: 48; height: 48
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: KcmHost.error
                        color: Theme.text
                        font.pixelSize: 15
                    }
                    ChromeButton {
                        anchors.horizontalCenter: parent.horizontalCenter
                        visible: System.hasProgram("kcmshell6")
                        text: qsTr("Open in a separate window")
                        onClicked: KcmHost.launchExternal(view.kcm)
                    }
                }
            }
        }
    }
}
