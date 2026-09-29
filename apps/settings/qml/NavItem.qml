import QtQuick

// Пункт левого меню: «пилюля» во всю ширину, как в Chrome OS.
Item {
    id: item
    property string title
    property string iconName
    property bool selected: false
    signal clicked()

    implicitHeight: Math.max(44, label.implicitHeight + 16)
    activeFocusOnTab: true

    Rectangle {
        anchors.fill: parent
        anchors.leftMargin: 0
        anchors.rightMargin: 12
        radius: height / 2
        topLeftRadius: 0
        bottomLeftRadius: 0
        // Выбранный пункт подсвечивает «пилюля» списка (Main.qml).
        color: !item.selected && mouse.containsMouse ? Theme.hover : "transparent"
        Behavior on color { ColorAnimation { duration: 120 } }
        border.width: item.activeFocus ? 2 : 0
        border.color: Theme.accent
    }
    SymbolIcon {
        id: icon
        source: item.iconName
        tint: item.selected ? Theme.onAccentContainer : Theme.subtext
        width: 20; height: 20
        anchors.left: parent.left
        anchors.leftMargin: 24
        anchors.verticalCenter: parent.verticalCenter
    }
    Text {
        id: label
        anchors.left: icon.right
        anchors.leftMargin: 18
        anchors.right: parent.right
        anchors.rightMargin: 20
        anchors.verticalCenter: parent.verticalCenter
        text: item.title
        color: item.selected ? Theme.onAccentContainer : Theme.text
        Behavior on color { ColorAnimation { duration: 180 } }
        font.pixelSize: 14
        font.weight: item.selected ? Font.Medium : Font.Normal
        wrapMode: Text.Wrap
        maximumLineCount: 2
        elide: Text.ElideRight
    }
    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: item.clicked()
    }
    Keys.onReturnPressed: item.clicked()
    Keys.onSpacePressed: item.clicked()
}
