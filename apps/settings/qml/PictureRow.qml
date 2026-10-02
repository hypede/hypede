import QtQuick
import QtQuick.Dialogs
import HypeSettings

// Картинка в ключе-адресе (file://…). Пусто — «как на рабочем столе».
SettingRow {
    id: row
    property var settings
    property string key
    property string emptyText: qsTr("Same as desktop")
    readonly property bool available: settings !== null && settings.valid && settings.hasKey(key)
    readonly property string value: settings && settings.revision >= 0 && available ? settings.value(key) : ""
    subtitle: value === "" ? emptyText : decodeURIComponent(value.replace(/^.*\//, ""))

    Row {
        spacing: 8
        anchors.verticalCenter: parent ? parent.verticalCenter : undefined
        Rectangle {
            visible: row.value !== ""
            width: 64; height: 36; radius: 8
            clip: true
            color: Theme.field
            Image {
                anchors.fill: parent
                source: row.value
                sourceSize.width: 128
                fillMode: Image.PreserveAspectCrop
                asynchronous: true
            }
        }
        ChromeButton {
            visible: row.value !== ""
            text: qsTr("Reset")
            flat: true
            onClicked: row.settings.setValue(row.key, "")
        }
        ChromeButton {
            text: qsTr("Choose…")
            onClicked: dialog.open()
        }
    }

    FileDialog {
        id: dialog
        title: row.title
        fileMode: FileDialog.OpenFile
        nameFilters: [qsTr("Images (*.png *.jpg *.jpeg *.webp *.svg)")]
        onAccepted: row.settings.setValue(row.key, selectedFile.toString())
    }
}
