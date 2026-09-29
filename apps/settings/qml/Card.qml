import QtQuick

// Карточка-подложка раздела: белый прямоугольник со скруглением 16 px.
Rectangle {
    default property alias content: column.data
    property alias spacing: column.spacing
    color: Theme.surface
    radius: Theme.radius
    border.width: Theme.dark ? 0 : 1
    border.color: Theme.divider
    implicitHeight: column.implicitHeight
    clip: true

    Column {
        id: column
        width: parent.width
    }
}
