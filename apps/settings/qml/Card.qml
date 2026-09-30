import QtQuick

// Карточка раздела, как в Chrome OS: белая подложка со скруглением 16 px
// без рамки, заголовок — внутри карточки.
Rectangle {
    id: card
    property string title: ""
    default property alias content: column.data
    property alias spacing: column.spacing
    color: Theme.surface
    radius: Theme.radius
    implicitHeight: header.height + column.implicitHeight
    clip: true

    Text {
        id: header
        visible: card.title !== ""
        height: visible ? implicitHeight : 0
        width: parent.width
        text: card.title
        color: Theme.text
        font.pixelSize: 15
        font.weight: Font.Medium
        leftPadding: 20
        rightPadding: 20
        topPadding: 18
        bottomPadding: 6
        elide: Text.ElideRight
    }

    Column {
        id: column
        y: header.height
        width: parent.width
    }
}
