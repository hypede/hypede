import QtQuick
import QtQuick.Controls as QQC2

// Страница раздела: заголовок и карточки секций, по центру колонки.
Flickable {
    id: view
    property var page
    signal openKcm(string kcm)

    contentHeight: column.implicitHeight + 48
    clip: true

    // При смене страницы карточки появляются «волной» сверху вниз.
    property int revision: 0
    onPageChanged: {
        contentY = 0
        revision++
    }
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
                required property int index
                width: column.width
                opacity: 0
                transform: Translate { id: shift; y: 14 }

                function enter() {
                    enterAnimation.restart()
                }
                Component.onCompleted: enter()
                Connections {
                    target: view
                    function onRevisionChanged() { section.enter() }
                }
                SequentialAnimation {
                    id: enterAnimation
                    PropertyAction { target: section; property: "opacity"; value: 0 }
                    PropertyAction { target: shift; property: "y"; value: 14 }
                    PauseAnimation { duration: Math.min(section.index, 6) * 45 }
                    ParallelAnimation {
                        NumberAnimation { target: section; property: "opacity"; to: 1; duration: 260; easing.type: Easing.OutCubic }
                        NumberAnimation { target: shift; property: "y"; to: 0; duration: 320; easing.type: Easing.OutCubic }
                    }
                }
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
