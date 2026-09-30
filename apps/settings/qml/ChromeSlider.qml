import QtQuick

// Ползунок Chrome OS: залитая дорожка до ручки, светлая — после, круглая
// ручка с ореолом при наведении.
Item {
    id: control
    property real from: 0
    property real to: 1
    property real stepSize: 0
    property real value: 0
    signal moved(real value)

    implicitWidth: 220
    implicitHeight: 32
    activeFocusOnTab: true

    readonly property real position: to > from ? Math.max(0, Math.min(1, (value - from) / (to - from))) : 0

    function setFromX(x) {
        let v = from + Math.max(0, Math.min(1, x / track.width)) * (to - from)
        if (stepSize > 0)
            v = Math.round((v - from) / stepSize) * stepSize + from
        v = Math.max(from, Math.min(to, v))
        if (v !== value)
            control.moved(v)
    }

    Rectangle {
        id: track
        anchors.verticalCenter: parent.verticalCenter
        width: parent.width
        height: 4
        radius: 2
        color: Theme.accentContainer
        Rectangle {
            width: parent.width * control.position
            height: parent.height
            radius: 2
            color: Theme.accent
        }
    }
    Rectangle {
        width: 32; height: 32; radius: 16
        anchors.verticalCenter: parent.verticalCenter
        x: handle.x + handle.width / 2 - width / 2
        color: Theme.accent
        opacity: drag.pressed ? 0.16 : (drag.containsMouse || control.activeFocus ? 0.10 : 0)
        Behavior on opacity { NumberAnimation { duration: Theme.fast } }
    }
    Rectangle {
        id: handle
        width: 16; height: 16; radius: 8
        anchors.verticalCenter: parent.verticalCenter
        x: control.position * track.width - width / 2
        color: Theme.accent
    }
    MouseArea {
        id: drag
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onPressed: mouse => { control.forceActiveFocus(); control.setFromX(mouse.x) }
        onPositionChanged: mouse => { if (pressed) control.setFromX(mouse.x) }
    }
    Keys.onLeftPressed: control.moved(Math.max(from, value - (stepSize > 0 ? stepSize : (to - from) / 20)))
    Keys.onRightPressed: control.moved(Math.min(to, value + (stepSize > 0 ? stepSize : (to - from) / 20)))
}
