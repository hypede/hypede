import QtQuick

// Заголовок окна: название, поиск по центру и кнопки окна справа.
// Пустое место заголовка перетаскивает окно, двойной клик — разворачивает.
Item {
    id: bar
    property alias searchText: search.text
    signal searchAccepted()
    function focusSearch() { search.focusField() }

    implicitHeight: 64

    MouseArea {
        anchors.fill: parent
        enabled: appWindow.frameless
        acceptedButtons: Qt.LeftButton
        onPressed: appWindow.startMove()
        onDoubleClicked: appWindow.toggleMaximize()
    }

    Row {
        anchors.left: parent.left
        anchors.leftMargin: 20
        anchors.verticalCenter: parent.verticalCenter
        spacing: 14
        SymbolIcon {
            source: "dev.hypede.Settings"
            fallback: "preferences-system"
            width: 28; height: 28
            anchors.verticalCenter: parent.verticalCenter
        }
        Text {
            text: qsTr("Settings")
            color: Theme.text
            font.pixelSize: 20
            anchors.verticalCenter: parent.verticalCenter
        }
    }

    SearchField {
        id: search
        width: Math.min(560, bar.width - 2 * 240)
        anchors.centerIn: parent
        visible: width > 160
        onAccepted: bar.searchAccepted()
    }

    Row {
        visible: appWindow.frameless
        anchors.right: parent.right
        anchors.rightMargin: 14
        anchors.verticalCenter: parent.verticalCenter
        spacing: 2
        Repeater {
            model: ["minimize", "maximize", "close"]
            delegate: Rectangle {
                id: windowButton
                required property string modelData
                width: 36; height: 36
                radius: 18
                color: buttonMouse.pressed ? Theme.pressed : (buttonMouse.containsMouse ? Theme.hover : "transparent")
                Behavior on color { ColorAnimation { duration: Theme.fast } }

                SymbolIcon {
                    anchors.centerIn: parent
                    width: 20; height: 20
                    tint: Theme.text
                    source: windowButton.modelData === "minimize" ? "window-minimize-symbolic"
                          : windowButton.modelData === "close" ? "window-close-symbolic"
                          : appWindow.maximized ? "window-restore-symbolic" : "window-maximize-symbolic"
                }
                MouseArea {
                    id: buttonMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    onClicked: {
                        if (windowButton.modelData === "minimize")
                            appWindow.minimize()
                        else if (windowButton.modelData === "maximize")
                            appWindow.toggleMaximize()
                        else
                            appWindow.closeWindow()
                    }
                }
            }
        }
    }
}
