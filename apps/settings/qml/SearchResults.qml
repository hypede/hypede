import QtQuick
import QtQuick.Controls as QQC2

// Результаты поиска по всем разделам.
Flickable {
    id: view
    property string query
    signal activated(string page, string kcm)

    readonly property var results: Catalog.search(query)
    contentHeight: column.implicitHeight + 48
    clip: true
    QQC2.ScrollBar.vertical: QQC2.ScrollBar {}

    function activateFirst() {
        if (results.length > 0)
            activated(results[0].page, results[0].kcm)
    }

    Column {
        id: column
        width: Math.min(Theme.contentWidth, view.width - 48)
        x: (view.width - width) / 2
        y: 24

        Text {
            visible: view.results.length === 0
            width: parent.width
            topPadding: 48
            horizontalAlignment: Text.AlignHCenter
            text: qsTr("No results for “%1”").arg(view.query)
            color: Theme.subtext
            font.pixelSize: 15
        }

        Card {
            visible: view.results.length > 0
            width: parent.width
            Repeater {
                model: view.results
                delegate: SettingRow {
                    required property var modelData
                    required property int index
                    title: modelData.title
                    subtitle: modelData.subtitle
                    iconName: modelData.icon
                    showDivider: index > 0
                    clickable: true
                    onClicked: view.activated(modelData.page, modelData.kcm)
                }
            }
        }
    }
}
