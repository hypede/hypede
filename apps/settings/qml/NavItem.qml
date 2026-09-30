import QtQuick

// Пункт левого меню. Выбранный подсвечивает «пилюля» списка (Main.qml),
// прижатая к левому краю, как в Chrome OS.
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
        anchors.rightMargin: 12
        topLeftRadius: 0
        bottomLeftRadius: 0
        topRightRadius: height / 2
        bottomRightRadius: height / 2
        color: !item.selected && mouse.containsMouse ? Theme.hover : "transparent"
        Behavior on color { ColorAnimation { duration: Theme.fast } }
        border.width: item.activeFocus ? 2 : 0
        border.color: Theme.accent
    }
    SymbolIcon {
        id: icon
        source: item.iconName
        tint: item.selected ? Theme.accentContainerText : Theme.subtext
        width: 20; height: 20
        anchors.left: parent.left
        anchors.leftMargin: 24
        anchors.verticalCenter: parent.verticalCenter
    }
    Text {
        id: label
        anchors.left: icon.right
        anchors.leftMargin: 20
        anchors.right: parent.right
        anchors.rightMargin: 24
        anchors.verticalCenter: parent.verticalCenter
        text: item.title
        color: item.selected ? Theme.accentContainerText : Theme.text
        font.pixelSize: 14
        font.weight: item.selected ? Font.Medium : Font.Normal
        wrapMode: Text.Wrap
        maximumLineCount: 2
        elide: Text.ElideRight
    }
    MouseArea {
        id: mouse
        anchors.fill: parent
        anchors.rightMargin: 12
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: item.clicked()
    }
    Keys.onReturnPressed: item.clicked()
    Keys.onSpacePressed: item.clicked()
}
