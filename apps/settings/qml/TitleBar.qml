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
        width: Math.min(560, bar.width - 2 * 260)
        anchors.centerIn: parent
        visible: width > 160
        onAccepted: bar.searchAccepted()
    }

    Row {
        visible: appWindow.frameless
        anchors.right: parent.right
        anchors.rightMargin: 12
        anchors.verticalCenter: parent.verticalCenter
        spacing: 4
        // Кнопки окна рисуются фигурами, а не значками темы: у разных тем
        // «свернуть» бывает и чертой, и стрелкой.
        Repeater {
            model: ["minimize", "maximize", "close"]
            delegate: Rectangle {
                id: windowButton
                required property string modelData
                width: 32; height: 32
                radius: 16
                color: buttonMouse.containsMouse ? Theme.hover : "transparent"

                Rectangle {
                    visible: windowButton.modelData === "minimize"
                    anchors.centerIn: parent
                    anchors.verticalCenterOffset: 4
                    width: 11; height: 1.5
                    color: Theme.text
                }
                Rectangle {
                    visible: windowButton.modelData === "maximize"
                    anchors.centerIn: parent
                    width: appWindow.maximized ? 9 : 11
                    height: width
                    radius: 2
                    color: "transparent"
                    border.width: 1.5
                    border.color: Theme.text
                }
                Repeater {
                    model: windowButton.modelData === "close" ? [45, -45] : []
                    delegate: Rectangle {
                        required property int modelData
                        anchors.centerIn: parent
                        width: 14; height: 1.5
                        rotation: modelData
                        color: Theme.text
                    }
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
