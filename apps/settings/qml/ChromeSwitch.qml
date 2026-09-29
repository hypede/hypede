import QtQuick

// Переключатель как в Chrome OS: тонкая дорожка и круглый «бегунок».
Item {
    id: control
    property bool checked: false
    signal toggled(bool value)

    implicitWidth: 40
    implicitHeight: 24
    activeFocusOnTab: true
    Accessible.role: Accessible.CheckBox
    Accessible.checked: checked

    Rectangle {
        anchors.verticalCenter: parent.verticalCenter
        width: parent.width
        height: 14
        radius: 7
        color: control.checked ? Qt.rgba(Theme.accent.r, Theme.accent.g, Theme.accent.b, 0.45) : Theme.switchTrackOff
        Behavior on color { ColorAnimation { duration: 120 } }
    }
    Rectangle {
        width: 20
        height: 20
        radius: 10
        anchors.verticalCenter: parent.verticalCenter
        x: control.checked ? parent.width - width : 0
        color: control.checked ? Theme.accent : (Theme.dark ? "#e3e3e3" : "#ffffff")
        border.width: control.checked ? 0 : 1
        border.color: Theme.dark ? "transparent" : "#c4c7c5"
        Behavior on x { NumberAnimation { duration: 140; easing.type: Easing.OutCubic } }
    }
    Rectangle {
        anchors.fill: parent
        anchors.margins: -4
        radius: height / 2
        color: "transparent"
        border.width: control.activeFocus ? 2 : 0
        border.color: Theme.accent
    }
    MouseArea {
        anchors.fill: parent
        anchors.margins: -6
        cursorShape: Qt.PointingHandCursor
        onClicked: control.toggled(!control.checked)
    }
    Keys.onSpacePressed: control.toggled(!control.checked)
}
