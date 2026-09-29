import QtQuick

// Строка карточки: значок, заголовок с подписью и элемент справа.
// Кликабельная строка подсвечивается и показывает стрелку «›».
Item {
    id: row
    property string title
    property string subtitle
    property string iconName
    property bool clickable: false
    property bool chevron: clickable
    property bool external: false
    property bool showDivider: true
    default property alias trailing: trailingRow.data
    signal clicked()

    implicitHeight: Math.max(Theme.rowHeight, texts.implicitHeight + 24)
    width: parent ? parent.width : implicitWidth
    activeFocusOnTab: clickable

    Rectangle {
        anchors.fill: parent
        color: mouse.containsMouse && row.clickable ? Theme.hover : "transparent"
    }
    Rectangle {
        visible: row.showDivider
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.leftMargin: row.iconName ? 56 : 20
        height: 1
        color: Theme.divider
    }
    Rectangle {
        anchors.fill: parent
        anchors.margins: 2
        radius: 8
        color: "transparent"
        border.width: row.activeFocus ? 2 : 0
        border.color: Theme.accent
    }

    SymbolIcon {
        id: icon
        visible: row.iconName !== ""
        source: row.iconName
        width: 20; height: 20
        anchors.left: parent.left
        anchors.leftMargin: 20
        anchors.verticalCenter: parent.verticalCenter
    }

    Column {
        id: texts
        anchors.left: icon.visible ? icon.right : parent.left
        anchors.leftMargin: icon.visible ? 16 : 20
        anchors.right: trailingRow.left
        anchors.rightMargin: 16
        anchors.verticalCenter: parent.verticalCenter
        spacing: 2
        Text {
            width: parent.width
            text: row.title
            color: Theme.text
            font.pixelSize: 14
            elide: Text.ElideRight
        }
        Text {
            width: parent.width
            visible: text !== ""
            text: row.subtitle
            color: Theme.subtext
            font.pixelSize: 13
            wrapMode: Text.Wrap
            maximumLineCount: 3
            elide: Text.ElideRight
        }
    }

    Row {
        id: trailingRow
        anchors.right: arrow.visible ? arrow.left : parent.right
        anchors.rightMargin: arrow.visible ? 8 : 20
        anchors.verticalCenter: parent.verticalCenter
        spacing: 12
    }
    SymbolIcon {
        id: arrow
        visible: row.chevron
        source: row.external ? "adw-external-link-symbolic" : "go-next-symbolic"
        fallback: "go-next-symbolic"
        width: 18; height: 18
        anchors.right: parent.right
        anchors.rightMargin: 20
        anchors.verticalCenter: parent.verticalCenter
    }

    MouseArea {
        id: mouse
        anchors.fill: parent
        enabled: row.clickable
        hoverEnabled: true
        cursorShape: row.clickable ? Qt.PointingHandCursor : Qt.ArrowCursor
        onClicked: row.clicked()
        z: -1
    }
    Keys.onReturnPressed: if (clickable) row.clicked()
    Keys.onSpacePressed: if (clickable) row.clicked()
}
