import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Dialogs
import QtQuick.Effects
import HypeSettings

// Темы: галерея встроенных и своих, сохранение текущего вида, импорт и
// экспорт в файл (.json или .txt). Всю работу делает hypede-theme.
Item {
    id: block
    readonly property var shell: GSettingsHub.schema("dev.hypede.shell")
    readonly property bool available: System.hasProgram("hypede-theme")
    readonly property string currentName: shell.revision >= 0 && shell.hasKey("theme-name") ? shell.value("theme-name") : ""
    property var themes: []
    property string status: ""
    property bool statusError: false
    property bool saving: false

    width: parent ? parent.width : 0
    implicitHeight: column.implicitHeight + 16
    height: implicitHeight

    function tool(args) {
        const r = System.runSync(["hypede-theme"].concat(args))
        if (!r.ok) {
            block.status = r.err || qsTr("Something went wrong")
            block.statusError = true
        }
        return r
    }
    function reload() {
        const r = System.runSync(["hypede-theme", "list"])
        try {
            block.themes = r.ok ? JSON.parse(r.out) : []
        } catch (e) {
            block.themes = []
        }
    }
    function say(text) {
        block.status = text
        block.statusError = false
    }
    function apply(t) {
        if (tool(["apply", t.id]).ok)
            say(qsTr("Theme “%1” applied").arg(t.name))
    }
    function localPath(url) {
        return decodeURIComponent(url.toString().replace(/^file:\/\//, ""))
    }

    Component.onCompleted: reload()

    readonly property var gnomeAccents: Theme.accents

    Column {
        id: column
        width: parent.width
        spacing: 0

        Flow {
            id: flow
            x: 16
            width: parent.width - 32
            topPadding: 16
            spacing: 12

            Repeater {
                model: block.themes
                delegate: Item {
                    id: card
                    required property var modelData
                    readonly property bool dark: modelData.scheme === "prefer-dark"
                    readonly property bool selected: modelData.name === block.currentName
                    readonly property color accent: /^#[0-9a-fA-F]{6}$/.test(modelData.accent) ? modelData.accent
                                                     : (block.gnomeAccents[modelData.gnomeAccent] || "#3584e4")
                    readonly property color shelf: modelData.shelf || (dark ? "#121315" : "#f2f4f8")
                    readonly property color menus: modelData.menus || (dark ? "#202124" : "#f8fafd")
                    width: (flow.width - 2 * flow.spacing) / 3
                    height: preview.height + 34

                    Item {
                        id: preview
                        width: parent.width
                        height: width * 0.62
                        scale: cardMouse.pressed ? 0.97 : 1
                        Behavior on scale { NumberAnimation { duration: Theme.fast; easing.type: Easing.OutCubic } }

                        Rectangle { id: mask; anchors.fill: parent; radius: 14; visible: false; layer.enabled: true }
                        Item {
                            anchors.fill: parent
                            layer.enabled: true
                            layer.effect: MultiEffect { maskEnabled: true; maskSource: mask }
                            Rectangle { anchors.fill: parent; color: card.dark ? "#1b1c1e" : "#e9edf3" }
                            Image {
                                anchors.fill: parent
                                source: card.modelData.wallpaper || ""
                                sourceSize.width: 360
                                sourceSize.height: 240
                                fillMode: Image.PreserveAspectCrop
                                asynchronous: true
                            }
                            // Мини-лаунчер
                            Rectangle {
                                x: parent.width * 0.06
                                y: parent.height * 0.22
                                width: parent.width * 0.42
                                height: parent.height * 0.56
                                radius: 8
                                color: card.menus
                                Rectangle {
                                    x: 6; y: 6
                                    width: parent.width - 12; height: 8; radius: 4
                                    color: "transparent"
                                    border.width: 1.5
                                    border.color: card.accent
                                }
                                Grid {
                                    x: 8; y: 22
                                    columns: 3
                                    spacing: 6
                                    Repeater {
                                        model: 6
                                        Rectangle {
                                            width: 9; height: 9; radius: 4.5
                                            color: index === 0 ? card.accent
                                                               : (card.dark ? Qt.rgba(1, 1, 1, 0.22) : Qt.rgba(0, 0, 0, 0.14))
                                        }
                                    }
                                }
                            }
                            // Мини-полка
                            Rectangle {
                                anchors.bottom: parent.bottom
                                width: parent.width
                                height: parent.height * 0.13
                                color: card.shelf
                                opacity: 0.94
                                Row {
                                    anchors.centerIn: parent
                                    spacing: 4
                                    Repeater {
                                        model: 4
                                        Rectangle {
                                            width: 7; height: 7; radius: 3.5
                                            color: index === 0 ? card.accent
                                                               : (Qt.colorEqual(card.shelf, "transparent") ? "white"
                                                                  : (card.shelf.hslLightness > 0.5 ? Qt.rgba(0, 0, 0, 0.35)
                                                                                                    : Qt.rgba(1, 1, 1, 0.55)))
                                        }
                                    }
                                }
                            }
                        }
                        Rectangle {
                            anchors.fill: parent
                            radius: 14
                            color: "transparent"
                            border.width: card.selected ? 3 : (cardMouse.containsMouse ? 2 : 0)
                            border.color: card.selected ? Theme.accent : Theme.divider
                        }
                        Rectangle {
                            visible: card.selected
                            width: 24; height: 24; radius: 12
                            anchors.right: parent.right
                            anchors.top: parent.top
                            anchors.margins: 8
                            color: Theme.accent
                            SymbolIcon {
                                anchors.centerIn: parent
                                source: "object-select-symbolic"
                                tint: Theme.accentText
                                width: 14; height: 14
                            }
                        }
                        MouseArea {
                            id: cardMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: block.apply(card.modelData)
                        }
                        // Своя тема: удалить и экспортировать.
                        Row {
                            visible: cardMouse.containsMouse || delMouse.containsMouse || expMouse.containsMouse
                            anchors.left: parent.left
                            anchors.top: parent.top
                            anchors.margins: 8
                            spacing: 6
                            Rectangle {
                                width: 26; height: 26; radius: 13
                                color: Qt.rgba(0, 0, 0, 0.55)
                                SymbolIcon { anchors.centerIn: parent; source: "document-save-symbolic"; tint: "white"; width: 14; height: 14 }
                                MouseArea {
                                    id: expMouse
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: {
                                        exportDialog.themeId = card.modelData.id
                                        exportDialog.selectedFile = "file://" + System.defaultExportPath().replace(/[^/]*$/, "")
                                                                    + card.modelData.name.replace(/[^\w\- ]+/g, "") + ".json"
                                        exportDialog.open()
                                    }
                                }
                                QQC2.ToolTip.visible: expMouse.containsMouse
                                QQC2.ToolTip.text: qsTr("Export to a file")
                            }
                            Rectangle {
                                visible: !card.modelData.builtin
                                width: 26; height: 26; radius: 13
                                color: Qt.rgba(0, 0, 0, 0.55)
                                SymbolIcon { anchors.centerIn: parent; source: "user-trash-symbolic"; tint: "white"; width: 14; height: 14 }
                                MouseArea {
                                    id: delMouse
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: {
                                        if (block.tool(["delete", card.modelData.id]).ok) {
                                            block.say(qsTr("Theme “%1” deleted").arg(card.modelData.name))
                                            block.reload()
                                        }
                                    }
                                }
                                QQC2.ToolTip.visible: delMouse.containsMouse
                                QQC2.ToolTip.text: qsTr("Delete")
                            }
                        }
                    }
                    Text {
                        anchors.top: preview.bottom
                        anchors.topMargin: 8
                        width: parent.width
                        text: card.modelData.name
                        color: Theme.text
                        font.pixelSize: 13
                        font.weight: card.selected ? Font.Medium : Font.Normal
                        elide: Text.ElideRight
                        horizontalAlignment: Text.AlignHCenter
                    }
                }
            }
        }

        Item { width: 1; height: 12 }

        // Сохранить текущий вид
        SettingRow {
            title: qsTr("Save current look as a theme")
            subtitle: qsTr("Colors, wallpaper, shelf, launcher, windows, lock screen, fonts and icons")
            iconName: "list-add-symbolic"
            Row {
                spacing: 8
                QQC2.TextField {
                    id: nameField
                    visible: block.saving
                    width: 200
                    height: 36
                    placeholderText: qsTr("Theme name")
                    placeholderTextColor: Theme.subtext
                    color: Theme.text
                    font.pixelSize: 14
                    leftPadding: 14
                    selectByMouse: true
                    background: Rectangle {
                        radius: 18
                        color: Theme.field
                        border.width: nameField.activeFocus ? 2 : 0
                        border.color: Theme.accent
                    }
                    onAccepted: saveButton.clicked()
                }
                ChromeButton {
                    id: saveButton
                    text: block.saving ? qsTr("Save") : qsTr("Save…")
                    filled: block.saving
                    enabled: !block.saving || nameField.text.trim() !== ""
                    onClicked: {
                        if (!block.saving) {
                            block.saving = true
                            nameField.text = block.currentName && !block.themes.some(t => t.builtin && t.name === block.currentName)
                                             ? block.currentName : ""
                            nameField.forceActiveFocus()
                            return
                        }
                        if (block.tool(["save", nameField.text.trim()]).ok) {
                            block.say(qsTr("Theme “%1” saved").arg(nameField.text.trim()))
                            block.saving = false
                            block.reload()
                        }
                    }
                }
                ChromeButton {
                    visible: block.saving
                    text: qsTr("Cancel")
                    flat: true
                    onClicked: block.saving = false
                }
            }
        }
        SettingRow {
            title: qsTr("Import a theme")
            subtitle: qsTr("A .json or .txt file made in HypeDE")
            iconName: "document-open-symbolic"
            ChromeButton {
                text: qsTr("Open…")
                onClicked: importDialog.open()
            }
        }
        SettingRow {
            title: qsTr("Export current look")
            subtitle: qsTr("Your own wallpapers are packed into the file, so you can just send it")
            iconName: "document-save-symbolic"
            ChromeButton {
                text: qsTr("Save to file…")
                onClicked: {
                    exportDialog.themeId = ""
                    exportDialog.selectedFile = "file://" + System.defaultExportPath().replace(/[^/]*$/, "")
                                                + (block.currentName || "HypeDE theme").replace(/[^\w\- ]+/g, "") + ".json"
                    exportDialog.open()
                }
            }
        }
        Item {
            visible: block.status !== ""
            width: parent.width
            height: 40
            Text {
                x: 20
                width: parent.width - 40
                anchors.verticalCenter: parent.verticalCenter
                text: block.status
                color: block.statusError ? Theme.danger : Theme.accent
                font.pixelSize: 13
                elide: Text.ElideRight
            }
        }
    }

    FileDialog {
        id: importDialog
        fileMode: FileDialog.OpenFile
        nameFilters: [qsTr("HypeDE themes (*.json *.txt)"), qsTr("All files (*)")]
        onAccepted: {
            const r = block.tool(["import", block.localPath(selectedFile)])
            if (r.ok) {
                const id = r.out.trim()
                block.reload()
                const t = block.themes.find(x => x.id === id)
                if (t)
                    block.apply(t)
            }
        }
    }
    FileDialog {
        id: exportDialog
        property string themeId: ""
        fileMode: FileDialog.SaveFile
        nameFilters: [qsTr("Theme (*.json)"), qsTr("Text file (*.txt)")]
        onAccepted: {
            const args = ["export", block.localPath(selectedFile)]
            if (themeId)
                args.push("--theme", themeId)
            else if (block.currentName)
                args.push("--name", block.currentName)
            if (block.tool(args).ok)
                block.say(qsTr("Saved to %1").arg(block.localPath(selectedFile)))
        }
    }
}
