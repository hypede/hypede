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

    implicitHeight: Math.max(Theme.rowHeight, texts.implicitHeight + 28)
    width: parent ? parent.width : implicitWidth
    activeFocusOnTab: clickable

    Rectangle {
        anchors.fill: parent
        color: row.clickable ? (mouse.pressed ? Theme.pressed : (mouse.containsMouse ? Theme.hover : "transparent"))
                             : "transparent"
        Behavior on color { ColorAnimation { duration: Theme.fast } }
    }
    Rectangle {
        visible: row.showDivider
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.leftMargin: icon.visible ? 60 : 20
        anchors.rightMargin: 20
        height: 1
        color: Theme.divider
    }
    Rectangle {
        anchors.fill: parent
        anchors.margins: 3
        radius: 12
        color: "transparent"
        border.width: row.activeFocus ? 2 : 0
        border.color: Theme.accent
    }

    // Значок — только у строк-ссылок: у строк с переключателями и списками
    // текст выровнен по одной линии, как в Chrome OS.
    SymbolIcon {
        id: icon
        visible: row.iconName !== "" && row.chevron
        source: row.iconName
        width: 20; height: 20
        anchors.left: parent.left
        anchors.leftMargin: 20
        anchors.verticalCenter: parent.verticalCenter
    }

    Column {
        id: texts
        anchors.left: icon.visible ? icon.right : parent.left
        anchors.leftMargin: icon.visible ? 20 : 20
        anchors.right: trailingRow.left
        anchors.rightMargin: 16
        anchors.verticalCenter: parent.verticalCenter
        spacing: 2
        Text {
            width: parent.width
            text: row.title
            color: Theme.text
            font.pixelSize: 14
            wrapMode: Text.Wrap
            maximumLineCount: 2
            elide: Text.ElideRight
        }
        Text {
            width: parent.width
            visible: text !== ""
            text: row.subtitle
            color: Theme.subtext
            font.pixelSize: 13
            lineHeight: 1.1
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
        width: 20; height: 20
        anchors.right: parent.right
        anchors.rightMargin: 18
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
