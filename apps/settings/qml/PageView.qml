import QtQuick
import QtQuick.Controls as QQC2

// Страница раздела: заголовок и карточки секций по центру колонки.
// При смене страницы колонка коротко проявляется на месте, без сдвигов:
// содержимое не «ездит» под указателем.
Flickable {
    id: view
    property var page
    signal openKcm(string kcm)

    contentHeight: column.implicitHeight + 40
    clip: true
    boundsBehavior: Flickable.StopAtBounds
    QQC2.ScrollBar.vertical: ThinScrollBar {}

    onPageChanged: {
        contentY = 0
        fadeIn.restart()
    }

    NumberAnimation {
        id: fadeIn
        target: column
        property: "opacity"
        from: 0
        to: 1
        duration: Theme.normal
        easing.type: Easing.OutCubic
    }

    Column {
        id: column
        width: Math.min(Theme.contentWidth, view.width - 48)
        x: Math.round((view.width - width) / 2)
        y: 8
        spacing: 16

        Text {
            text: view.page ? view.page.title : ""
            color: Theme.text
            font.pixelSize: 22
            topPadding: 8
            leftPadding: 4
        }

        Repeater {
            model: view.page && view.page.sections ? view.page.sections : []
            delegate: Card {
                id: section
                required property var modelData
                width: column.width
                title: modelData.title || ""
                Repeater {
                    model: section.modelData.rows
                    delegate: RowDelegate {
                        required property var modelData
                        required property int index
                        row: modelData
                        first: index === 0
                        onOpenKcm: kcm => view.openKcm(kcm)
                    }
                }
            }
        }
    }
}
