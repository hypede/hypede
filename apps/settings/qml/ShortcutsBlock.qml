import QtQuick
import QtQuick.Controls as QQC2
import HypeSettings

Column {
    id: block
    readonly property bool available: media.valid
    readonly property string mediaId: "org.gnome.settings-daemon.plugins.media-keys"
    readonly property string customId: mediaId + ".custom-keybinding"
    readonly property string base: "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/"
    readonly property var media: GSettingsHub.schema(mediaId)
    readonly property var paths: media.revision >= 0 && media.valid && media.hasKey("custom-keybindings")
                                 ? media.value("custom-keybindings") : []
    readonly property var fixed: [
        ["org.gnome.desktop.wm.keybindings", "close", qsTr("Close window")],
        ["org.gnome.desktop.wm.keybindings", "toggle-maximized", qsTr("Maximize window")],
        ["org.gnome.desktop.wm.keybindings", "minimize", qsTr("Minimize window")],
        ["org.gnome.desktop.wm.keybindings", "toggle-fullscreen", qsTr("Full screen")],
        ["org.gnome.desktop.wm.keybindings", "switch-applications", qsTr("Switch apps")],
        ["org.gnome.desktop.wm.keybindings", "switch-windows", qsTr("Switch windows")],
        ["org.gnome.desktop.wm.keybindings", "show-desktop", qsTr("Show desktop")],
        ["org.gnome.desktop.wm.keybindings", "switch-to-workspace-left", qsTr("Previous desk")],
        ["org.gnome.desktop.wm.keybindings", "switch-to-workspace-right", qsTr("Next desk")],
        ["org.gnome.desktop.wm.keybindings", "move-to-workspace-left", qsTr("Move window to previous desk")],
        ["org.gnome.desktop.wm.keybindings", "move-to-workspace-right", qsTr("Move window to next desk")],
        ["org.gnome.shell.keybindings", "show-screenshot-ui", qsTr("Screenshot")],
        ["org.gnome.shell.keybindings", "toggle-message-tray", qsTr("Notifications")],
        ["org.gnome.shell.keybindings", "toggle-quick-settings", qsTr("Quick settings")],
        [mediaId, "screensaver", qsTr("Lock screen")],
        [mediaId, "home", qsTr("Home folder")],
        [mediaId, "terminal", qsTr("Terminal")],
        [mediaId, "www", qsTr("Web browser")],
        [mediaId, "calculator", qsTr("Calculator")],
    ]
    width: parent ? parent.width : 0

    function addCustom() {
        let n = 0
        while (paths.includes(base + "hypede" + n + "/"))
            n++
        const path = base + "hypede" + n + "/"
        const s = GSettingsHub.schemaAt(customId, path)
        s.setValue("name", qsTr("My shortcut"))
        s.setValue("command", "")
        s.setValue("binding", "")
        media.setValue("custom-keybindings", paths.concat([path]))
    }

    Repeater {
        model: block.fixed
        delegate: ShortcutRow {
            required property var modelData
            required property int index
            showDivider: index > 0
            settings: GSettingsHub.schema(modelData[0])
            key: modelData[1]
            title: modelData[2]
        }
    }
    Repeater {
        model: block.paths
        delegate: Column {
            id: custom
            required property string modelData
            readonly property var s: GSettingsHub.schemaAt(block.customId, modelData)
            width: block.width
            ShortcutRow {
                settings: custom.s
                key: "binding"
                resettable: false
                title: custom.s.revision >= 0 ? custom.s.value("name") : ""
                subtitle: custom.s.revision >= 0 ? custom.s.value("command") : ""
                iconName: "utilities-terminal-symbolic"
            }
            Row {
                x: 20
                spacing: 8
                bottomPadding: 10
                Repeater {
                    model: [["name", qsTr("Name"), 180], ["command", qsTr("Command"), 300]]
                    delegate: QQC2.TextField {
                        id: field
                        required property var modelData
                        width: modelData[2]
                        height: 34
                        text: custom.s.revision >= 0 ? custom.s.value(modelData[0]) : ""
                        placeholderText: modelData[1]
                        placeholderTextColor: Theme.subtext
                        color: Theme.text
                        leftPadding: 12
                        background: Rectangle { radius: 17; color: Theme.field; border.width: field.activeFocus ? 2 : 0; border.color: Theme.accent }
                        onEditingFinished: custom.s.setValue(modelData[0], text)
                    }
                }
                ChromeButton {
                    text: qsTr("Delete")
                    flat: true
                    danger: true
                    onClicked: block.media.setValue("custom-keybindings", block.paths.filter(p => p !== custom.modelData))
                }
            }
        }
    }
    SettingRow {
        title: qsTr("Add your own shortcut")
        subtitle: qsTr("Run any command with a key combination")
        iconName: "list-add-symbolic"
        ChromeButton { text: qsTr("Add"); onClicked: block.addCustom() }
    }
}
