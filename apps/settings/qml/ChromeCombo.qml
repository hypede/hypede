import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Effects

// Выпадающий список Chrome OS: тональная кнопка со стрелкой и всплывающее
// меню с тенью. options: [{value, label}]
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

    implicitWidth: Math.min(280, Math.max(140, labelMetrics.width + 52))
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
        color: mouse.containsMouse || popup.opened ? Theme.fieldHover : Theme.field
        Behavior on color { ColorAnimation { duration: Theme.fast } }
        border.width: combo.activeFocus ? 2 : 0
        border.color: Theme.accent

        Text {
            anchors.left: parent.left
            anchors.leftMargin: 14
            anchors.right: chevron.left
            anchors.rightMargin: 4
            anchors.verticalCenter: parent.verticalCenter
            text: combo.currentIndex >= 0 ? combo.options[combo.currentIndex].label : combo.placeholder
            color: combo.currentIndex >= 0 ? Theme.text : Theme.subtext
            font.pixelSize: 14
            elide: Text.ElideRight
        }
        SymbolIcon {
            id: chevron
            source: "pan-down-symbolic"
            tint: Theme.subtext
            width: 20; height: 20
            anchors.right: parent.right
            anchors.rightMargin: 8
            anchors.verticalCenter: parent.verticalCenter
            rotation: popup.opened ? 180 : 0
            Behavior on rotation { NumberAnimation { duration: Theme.normal; easing.type: Easing.OutCubic } }
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
        y: combo.height + 6
        width: Math.max(combo.width, 200)
        padding: 6
        modal: false
        focus: true
        transformOrigin: QQC2.Popup.Top

        enter: Transition {
            NumberAnimation { property: "opacity"; from: 0; to: 1; duration: Theme.fast }
            NumberAnimation { property: "scale"; from: 0.94; to: 1; duration: Theme.normal; easing.type: Easing.OutCubic }
        }
        exit: Transition {
            NumberAnimation { property: "opacity"; to: 0; duration: 90 }
        }

        background: Item {
            Rectangle {
                id: popupBg
                anchors.fill: parent
                color: Theme.popup
                radius: 12
                visible: false
            }
            MultiEffect {
                source: popupBg
                anchors.fill: popupBg
                shadowEnabled: true
                shadowColor: Theme.shadow
                shadowBlur: 0.6
                shadowVerticalOffset: 4
                autoPaddingEnabled: true
            }
        }
        contentItem: ListView {
            implicitHeight: Math.min(contentHeight, 320)
            clip: true
            model: combo.options
            boundsBehavior: Flickable.StopAtBounds
            currentIndex: combo.currentIndex
            QQC2.ScrollBar.vertical: ThinScrollBar {}
            delegate: Rectangle {
                required property var modelData
                required property int index
                readonly property bool current: index === combo.currentIndex
                width: ListView.view.width
                height: 40
                radius: 8
                color: current ? Theme.accentContainer : (itemMouse.containsMouse ? Theme.hover : "transparent")
                Text {
                    anchors.left: parent.left
                    anchors.leftMargin: 12
                    anchors.right: check.left
                    anchors.rightMargin: 8
                    anchors.verticalCenter: parent.verticalCenter
                    text: modelData.label
                    color: current ? Theme.accentContainerText : Theme.text
                    font.pixelSize: 14
                    elide: Text.ElideRight
                }
                SymbolIcon {
                    id: check
                    visible: current
                    source: "object-select-symbolic"
                    tint: Theme.accentContainerText
                    width: 18; height: 18
                    anchors.right: parent.right
                    anchors.rightMargin: 10
                    anchors.verticalCenter: parent.verticalCenter
                }
                MouseArea {
                    id: itemMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        popup.close()
                        combo.activated(modelData.value)
                    }
                }
            }
        }
    }
}
