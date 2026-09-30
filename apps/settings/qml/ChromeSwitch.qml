import QtQuick

// Переключатель Material 3, как в Chrome OS: выключенный — пустая дорожка с
// обводкой и маленьким бегунком, включённый — залитая дорожка и крупный
// бегунок с галочкой.
Item {
    id: control
    property bool checked: false
    signal toggled(bool value)

    implicitWidth: 44
    implicitHeight: 26
    activeFocusOnTab: true
    Accessible.role: Accessible.CheckBox
    Accessible.checked: checked

    Rectangle {
        id: track
        anchors.verticalCenter: parent.verticalCenter
        width: parent.width
        height: 24
        radius: 12
        color: control.checked ? Theme.accent : Theme.switchTrackOff
        border.width: control.checked ? 0 : 1.5
        border.color: Theme.outline
        Behavior on color { ColorAnimation { duration: Theme.fast } }

        Rectangle {
            id: thumb
            property real thumbSize: mouse.pressed ? 20 : (control.checked ? 18 : 12)
            width: thumbSize
            height: thumbSize
            radius: thumbSize / 2
            anchors.verticalCenter: parent.verticalCenter
            x: control.checked ? track.width - thumbSize - 3 : 6 - (thumbSize - 12) / 2
            color: control.checked ? Theme.accentText : Theme.outline
            Behavior on x { NumberAnimation { duration: Theme.normal; easing.type: Easing.OutCubic } }
            Behavior on thumbSize { NumberAnimation { duration: Theme.fast; easing.type: Easing.OutCubic } }
            Behavior on color { ColorAnimation { duration: Theme.fast } }

            SymbolIcon {
                anchors.centerIn: parent
                width: 12; height: 12
                source: "object-select-symbolic"
                tint: Theme.accent
                opacity: control.checked ? 1 : 0
                Behavior on opacity { NumberAnimation { duration: Theme.fast } }
            }
        }
    }
    // Ореол при наведении, как у Material
    Rectangle {
        width: 36; height: 36; radius: 18
        anchors.verticalCenter: parent.verticalCenter
        x: thumb.x + thumb.width / 2 - width / 2
        color: control.checked ? Theme.accent : Theme.text
        opacity: mouse.containsMouse ? 0.08 : 0
        Behavior on opacity { NumberAnimation { duration: Theme.fast } }
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
        id: mouse
        anchors.fill: parent
        anchors.margins: -6
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: control.toggled(!control.checked)
    }
    Keys.onSpacePressed: control.toggled(!control.checked)
}
