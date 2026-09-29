import QtQuick
import QtQuick.Dialogs
import HypeSettings

// Конфигурация HypeDE. У сеанса HypeDE своя база настроек
// (~/.config/dconf/hypede), отдельная от обычного GNOME. Здесь её можно
// сохранить в файл, загрузить из файла, начать заново и ещё раз перенести
// раскладки и прочее из GNOME.
Item {
    id: block
    readonly property bool available: true
    property string status: ""

    width: parent ? parent.width : 0
    implicitHeight: column.implicitHeight
    height: implicitHeight

    Column {
        id: column
        width: parent.width

        SettingRow {
            title: qsTr("Separate configuration")
            subtitle: System.inHypeDE
                      ? qsTr("HypeDE keeps its settings apart from GNOME: ~/.config/dconf/hypede")
                      : qsTr("Settings are opened outside the HypeDE session and change regular GNOME")
            iconName: "document-properties-symbolic"
            showDivider: false
        }
        SettingRow {
            title: qsTr("Import from GNOME")
            subtitle: qsTr("Keyboard layouts, mouse, touchpad, accessibility and shortcuts")
            iconName: "document-import-symbolic"
            ChromeButton {
                text: qsTr("Import")
                enabled: System.inHypeDE
                onClicked: block.status = System.importFromGnome() ? qsTr("Settings imported from GNOME")
                                                                   : qsTr("Could not import settings")
            }
        }
        SettingRow {
            title: qsTr("Back up to a file")
            iconName: "document-save-symbolic"
            ChromeButton {
                text: qsTr("Save…")
                onClicked: saveDialog.open()
            }
        }
        SettingRow {
            title: qsTr("Restore from a file")
            iconName: "document-open-symbolic"
            ChromeButton {
                text: qsTr("Open…")
                onClicked: openDialog.open()
            }
        }
        SettingRow {
            title: qsTr("Reset HypeDE settings")
            subtitle: qsTr("Wallpaper, shelf, launcher, theme and everything else return to defaults")
            iconName: "edit-undo-symbolic"
            ChromeButton {
                text: qsTr("Reset…")
                danger: true
                enabled: System.inHypeDE
                onClicked: confirm.visible = true
            }
        }
        Item {
            visible: block.status !== ""
            width: parent.width
            height: 44
            Text {
                x: 20
                anchors.verticalCenter: parent.verticalCenter
                text: block.status
                color: Theme.accent
                font.pixelSize: 13
            }
        }
        // Подтверждение сброса — прямо в карточке.
        Item {
            id: confirm
            visible: false
            width: parent.width
            height: visible ? 64 : 0
            Rectangle {
                anchors.fill: parent
                anchors.margins: 8
                radius: 12
                color: Qt.rgba(Theme.danger.r, Theme.danger.g, Theme.danger.b, 0.12)
                Text {
                    x: 16
                    anchors.verticalCenter: parent.verticalCenter
                    width: parent.width - buttons.width - 40
                    text: qsTr("Reset all HypeDE settings?")
                    color: Theme.text
                    font.pixelSize: 14
                    elide: Text.ElideRight
                }
                Row {
                    id: buttons
                    anchors.right: parent.right
                    anchors.rightMargin: 12
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 8
                    ChromeButton {
                        text: qsTr("Cancel")
                        onClicked: confirm.visible = false
                    }
                    ChromeButton {
                        text: qsTr("Reset")
                        filled: true
                        onClicked: {
                            confirm.visible = false
                            block.status = System.resetConfig() ? qsTr("Settings reset") : qsTr("Could not reset settings")
                        }
                    }
                }
            }
        }
    }

    FileDialog {
        id: saveDialog
        fileMode: FileDialog.SaveFile
        nameFilters: [qsTr("HypeDE settings (*.ini)")]
        selectedFile: "file://" + System.defaultExportPath()
        onAccepted: block.status = System.exportConfig(selectedFile) ? qsTr("Settings saved")
                                                                    : qsTr("Could not save settings")
    }
    FileDialog {
        id: openDialog
        fileMode: FileDialog.OpenFile
        nameFilters: [qsTr("HypeDE settings (*.ini)"), qsTr("All files (*)")]
        onAccepted: block.status = System.importConfig(selectedFile) ? qsTr("Settings restored")
                                                                    : qsTr("Could not restore settings")
    }
}
