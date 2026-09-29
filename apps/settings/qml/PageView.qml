import QtQuick
import QtQuick.Controls as QQC2

// Страница раздела: заголовок и карточки секций, по центру колонки.
Flickable {
    id: view
    property var page
    signal openKcm(string kcm)

    contentHeight: column.implicitHeight + 48
    clip: true
    boundsBehavior: Flickable.StopAtBounds
    QQC2.ScrollBar.vertical: QQC2.ScrollBar {}

    Column {
        id: column
        width: Math.min(Theme.contentWidth, view.width - 48)
        x: (view.width - width) / 2
        y: 8
        spacing: 0

        Text {
            text: view.page ? view.page.title : ""
            color: Theme.text
            font.pixelSize: 22
            topPadding: 8
            bottomPadding: 4
            leftPadding: 4
        }

        Repeater {
            model: view.page && view.page.sections ? view.page.sections : []
            delegate: Column {
                id: section
                required property var modelData
                width: column.width
                SectionTitle {
                    visible: !!section.modelData.title
                    text: section.modelData.title || ""
                    width: parent.width
                }
                Item { width: 1; height: section.modelData.title ? 0 : 16 }
                Card {
                    width: parent.width
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
}
