import QtQuick
import QtQuick.Controls as QQC2

// Выпадающий список: кнопка-«пилюля» и всплывающее меню вариантов.
// options: [{value, label}]
Item {
    id: combo
    property var options: []
    property var currentValue
    property string placeholder: qsTr("Choose…")
    signal activated(var value)

    readonly property int currentIndex: {
        for (let i = 0; i < options.length; ++i)
            if (options[i].value === currentValue)
                return i
        return -1
    }

    implicitWidth: Math.max(160, labelMetrics.width + 56)
    implicitHeight: 36
    activeFocusOnTab: true

    TextMetrics {
        id: labelMetrics
        font.pixelSize: 14
        text: {
            let longest = ""
            for (const o of combo.options)
                if (o.label.length > longest.length)
                    longest = o.label
            return longest
        }
    }

    Rectangle {
        anchors.fill: parent
        radius: 8
        color: mouse.containsMouse || popup.opened ? Theme.hover : "transparent"
        border.width: 1
        border.color: combo.activeFocus || popup.opened ? Theme.accent : (Theme.dark ? "#5f6368" : "#c4c7c5")

        Text {
            anchors.left: parent.left
            anchors.leftMargin: 12
            anchors.right: chevron.left
            anchors.verticalCenter: parent.verticalCenter
            text: combo.currentIndex >= 0 ? combo.options[combo.currentIndex].label : combo.placeholder
            color: combo.currentIndex >= 0 ? Theme.text : Theme.subtext
            font.pixelSize: 14
            elide: Text.ElideRight
        }
        SymbolIcon {
            id: chevron
            source: "pan-down-symbolic"
            width: 16; height: 16
            anchors.right: parent.right
            anchors.rightMargin: 10
            anchors.verticalCenter: parent.verticalCenter
        }
    }
    MouseArea {
        id: mouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: popup.open()
    }
    Keys.onSpacePressed: popup.open()
    Keys.onReturnPressed: popup.open()

    QQC2.Popup {
        id: popup
        y: combo.height + 4
        width: Math.max(combo.width, 200)
        padding: 6
        modal: false
        focus: true
        background: Rectangle {
            color: Theme.surface
            radius: 12
            border.width: 1
            border.color: Theme.divider
        }
        contentItem: ListView {
            implicitHeight: Math.min(contentHeight, 320)
            clip: true
            model: combo.options
            delegate: Rectangle {
                required property var modelData
                required property int index
                width: ListView.view.width
                height: 40
                radius: 8
                color: itemMouse.containsMouse ? Theme.hover
                       : (index === combo.currentIndex ? Theme.accentContainer : "transparent")
                Text {
                    anchors.left: parent.left
                    anchors.leftMargin: 12
                    anchors.right: parent.right
                    anchors.rightMargin: 12
                    anchors.verticalCenter: parent.verticalCenter
                    text: modelData.label
                    color: index === combo.currentIndex ? Theme.onAccentContainer : Theme.text
                    font.pixelSize: 14
                    elide: Text.ElideRight
                }
                MouseArea {
                    id: itemMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    onClicked: {
                        popup.close()
                        combo.activated(modelData.value)
                    }
                }
            }
        }
    }
}
