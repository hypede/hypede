import QtQuick

// Кнопка: «filled» — акцентная, иначе тональная с обводкой.
Rectangle {
    id: button
    property alias text: label.text
    property bool filled: false
    property bool danger: false
    property string iconName: ""
    signal clicked()

    implicitHeight: 36
    implicitWidth: row.implicitWidth + 32
    radius: height / 2
    color: filled ? (mouse.containsMouse ? Qt.darker(Theme.accent, 1.08) : Theme.accent)
                  : (mouse.containsMouse ? Theme.hover : "transparent")
    border.width: filled ? 0 : 1
    border.color: Theme.dark ? "#5f6368" : "#c4c7c5"
    opacity: enabled ? 1 : 0.5
    activeFocusOnTab: true

    Row {
        id: row
        anchors.centerIn: parent
        spacing: 8
        SymbolIcon {
            visible: button.iconName !== ""
            source: button.iconName
            tint: label.color
            width: 18; height: 18
            anchors.verticalCenter: parent.verticalCenter
        }
        Text {
            id: label
            color: button.filled ? Theme.onAccent : (button.danger ? Theme.danger : Theme.accent)
            font.pixelSize: 14
            font.weight: Font.Medium
            anchors.verticalCenter: parent.verticalCenter
        }
    }
    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: button.clicked()
    }
    Keys.onReturnPressed: button.clicked()
    Keys.onSpacePressed: button.clicked()
}
