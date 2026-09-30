import QtQuick

// Кнопка-«пилюля». filled — основное действие (залита акцентом), иначе
// тональная; flat — только текст (например, «Отмена» в диалоге).
Rectangle {
    id: button
    property alias text: label.text
    property bool filled: false
    property bool flat: false
    property bool danger: false
    property string iconName: ""
    signal clicked()

    implicitHeight: 36
    implicitWidth: row.implicitWidth + (iconName ? 36 : 40)
    radius: height / 2
    color: filled ? Theme.accent : (flat ? "transparent" : Theme.tonal)
    opacity: enabled ? 1 : 0.38
    activeFocusOnTab: true

    // Слой состояния: наведение и нажатие чуть меняют тон кнопки.
    Rectangle {
        anchors.fill: parent
        radius: parent.radius
        color: button.filled ? Theme.accentText : (button.danger ? Theme.danger : Theme.tonalText)
        opacity: mouse.pressed ? 0.12 : (mouse.containsMouse ? 0.08 : 0)
        Behavior on opacity { NumberAnimation { duration: Theme.fast } }
    }
    Rectangle {
        anchors.fill: parent
        anchors.margins: -3
        radius: height / 2
        color: "transparent"
        border.width: button.activeFocus ? 2 : 0
        border.color: Theme.accent
    }

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
            color: button.filled ? Theme.accentText
                                 : (button.danger ? Theme.danger : (button.flat ? Theme.accent : Theme.tonalText))
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
