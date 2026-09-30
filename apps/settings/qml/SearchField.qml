import QtQuick

// Строка поиска в заголовке окна — как «Поиск в настройках» Chrome OS.
Rectangle {
    id: field
    property alias text: input.text
    signal accepted()

    implicitHeight: 40
    radius: height / 2
    color: input.activeFocus ? Theme.surface : Theme.field
    Behavior on color { ColorAnimation { duration: Theme.fast } }
    border.width: input.activeFocus ? 2 : 0
    border.color: Theme.accent

    function focusField() { input.forceActiveFocus() }

    SymbolIcon {
        id: icon
        source: "system-search-symbolic"
        width: 20; height: 20
        anchors.left: parent.left
        anchors.leftMargin: 14
        anchors.verticalCenter: parent.verticalCenter
    }
    TextInput {
        id: input
        anchors.left: icon.right
        anchors.leftMargin: 12
        anchors.right: clear.left
        anchors.rightMargin: 8
        anchors.verticalCenter: parent.verticalCenter
        color: Theme.text
        selectionColor: Theme.accentContainer
        selectedTextColor: Theme.accentContainerText
        font.pixelSize: 14
        clip: true
        onAccepted: field.accepted()
        Keys.onEscapePressed: text = ""

        Text {
            anchors.fill: parent
            verticalAlignment: Text.AlignVCenter
            visible: !input.text && !input.preeditText
            text: qsTr("Search settings")
            color: Theme.subtext
            font: input.font
        }
    }
    SymbolIcon {
        id: clear
        visible: input.text !== ""
        source: "edit-clear-symbolic"
        width: 20; height: 20
        anchors.right: parent.right
        anchors.rightMargin: 12
        anchors.verticalCenter: parent.verticalCenter
        MouseArea {
            anchors.fill: parent
            anchors.margins: -6
            cursorShape: Qt.PointingHandCursor
            onClicked: input.text = ""
        }
    }
}
