import QtQuick
import HypeSettings

Column {
    id: block
    readonly property bool available: themes.length > 0 || dm === "gdm" || dm === "sddm"
    readonly property var themes: System.plymouthThemes()
    readonly property string dm: System.displayManager()
    property string theme: System.plymouthTheme()
    property string autologin: System.autologinUser()
    property string status: ""
    property bool busy: false
    width: parent ? parent.width : 0

    Connections {
        target: System
        function onAdminFinished(action, ok) {
            block.busy = false
            block.status = ok ? qsTr("Saved") : qsTr("Not changed")
            block.theme = System.plymouthTheme()
            block.autologin = System.autologinUser()
        }
    }

    SettingRow {
        visible: block.themes.length > 0
        showDivider: false
        title: qsTr("Boot splash")
        subtitle: block.busy ? qsTr("Rebuilding the boot image, this takes a minute…") : qsTr("Shown while the computer starts")
        iconName: "system-reboot-symbolic"
        ChromeCombo {
            width: 200
            enabled: !block.busy
            options: block.themes.map(t => ({ value: t, label: t === "hypede" ? "HypeDE" : t.charAt(0).toUpperCase() + t.slice(1) }))
            currentValue: block.theme
            onActivated: value => {
                block.busy = true
                block.status = ""
                System.admin(["plymouth", value])
            }
        }
    }
    SettingRow {
        visible: block.dm === "gdm" || block.dm === "sddm"
        title: qsTr("Sign in automatically")
        subtitle: qsTr("Skip the login screen for %1").arg(System.userName())
        iconName: "system-users-symbolic"
        ChromeSwitch {
            enabled: !block.busy
            checked: block.autologin !== "" && block.autologin === System.userName()
            onToggled: value => {
                block.busy = true
                System.admin(["autologin", value ? System.userName() : "off"])
            }
        }
    }
    Text {
        visible: block.status !== ""
        x: 20
        height: 36
        verticalAlignment: Text.AlignVCenter
        text: block.status
        color: Theme.accent
        font.pixelSize: 13
    }
}
