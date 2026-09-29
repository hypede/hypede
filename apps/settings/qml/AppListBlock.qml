import QtQuick
import QtQuick.Controls as QQC2
import HypeSettings

// Список приложений с переключателями.
//   mode "launcher"      — показывать ли приложение в лаунчере
//                          (dev.hypede.shell launcher-hidden-apps)
//   mode "notifications" — разрешены ли уведомления приложения
//                          (org.gnome.desktop.notifications.application)
// Список длинный, поэтому свёрнут: сначала видна строка со счётчиком.
Item {
    id: block
    property string mode: "launcher"
    property string title
    property bool expanded: false
    property string filter: ""
    readonly property bool available: true
    readonly property var shell: GSettingsHub.schema("dev.hypede.shell")
    readonly property var notifications: GSettingsHub.schema("org.gnome.desktop.notifications")
    readonly property var apps: System.installedApps()
    readonly property var shown: apps.filter(a => filter === ""
                                             || a.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
    readonly property var hidden: shell.revision >= 0 ? (shell.value("launcher-hidden-apps") || []) : []

    width: parent ? parent.width : 0
    implicitHeight: column.implicitHeight
    height: implicitHeight
    clip: true

    // Путь настроек уведомлений приложения, как у gnome-control-center:
    // org.gnome.Nautilus.desktop → org-gnome-nautilus
    function notificationId(appId) {
        return appId.replace(/\.desktop$/, "").toLowerCase().replace(/[._]/g, "-")
    }
    function appNotifications(appId) {
        return GSettingsHub.schemaAt("org.gnome.desktop.notifications.application",
                                     "/org/gnome/desktop/notifications/application/" + notificationId(appId) + "/")
    }
    function setNotifications(appId, enabled) {
        const settings = appNotifications(appId)
        settings.setValue("enable", enabled)
        // GNOME учитывает только приложения из этого списка.
        const children = notifications.value("application-children") || []
        const id = notificationId(appId)
        if (children.indexOf(id) < 0)
            notifications.setValue("application-children", children.concat([id]))
    }
    function setShown(appId, show) {
        let list = hidden.filter(id => id !== appId)
        if (!show)
            list.push(appId)
        shell.setValue("launcher-hidden-apps", list)
    }

    Column {
        id: column
        width: parent.width

        SettingRow {
            title: block.title
            subtitle: block.mode === "launcher"
                      ? qsTr("Hidden: %1").arg(block.hidden.length)
                      : qsTr("Choose which apps may show notifications")
            iconName: block.mode === "launcher" ? "view-app-grid-symbolic" : "preferences-system-notifications-symbolic"
            showDivider: block.mode === "notifications"
            clickable: true
            chevron: false
            onClicked: block.expanded = !block.expanded
            SymbolIcon {
                source: "pan-down-symbolic"
                width: 18; height: 18
                rotation: block.expanded ? 180 : 0
                Behavior on rotation { NumberAnimation { duration: 200; easing.type: Easing.OutCubic } }
            }
        }

        Item {
            width: parent.width
            height: block.expanded ? list.height : 0
            opacity: block.expanded ? 1 : 0
            clip: true
            Behavior on height { NumberAnimation { duration: 260; easing.type: Easing.OutCubic } }
            Behavior on opacity { NumberAnimation { duration: 200 } }

            Column {
                id: list
                width: parent.width

                Item {
                    width: parent.width
                    height: 52
                    Rectangle {
                        x: 20; y: 8
                        width: parent.width - 40
                        height: 36
                        radius: 18
                        color: Theme.surfaceVariant
                        SymbolIcon {
                            id: searchIcon
                            source: "system-search-symbolic"
                            width: 16; height: 16
                            x: 12
                            anchors.verticalCenter: parent.verticalCenter
                        }
                        TextInput {
                            anchors.left: searchIcon.right
                            anchors.leftMargin: 10
                            anchors.right: parent.right
                            anchors.rightMargin: 12
                            anchors.verticalCenter: parent.verticalCenter
                            color: Theme.text
                            font.pixelSize: 14
                            selectByMouse: true
                            onTextChanged: block.filter = text
                            Text {
                                visible: parent.text === ""
                                text: qsTr("Find an app")
                                color: Theme.subtext
                                font.pixelSize: 14
                            }
                        }
                    }
                }

                Repeater {
                    model: block.expanded ? block.shown : []
                    delegate: SettingRow {
                        id: appRow
                        required property var modelData
                        readonly property var appSettings: block.mode === "notifications"
                                                           ? block.appNotifications(modelData.id) : null
                        readonly property bool appEnabled: block.mode === "launcher"
                            ? block.hidden.indexOf(modelData.id) < 0
                            : (appSettings && appSettings.valid && appSettings.revision >= 0
                               ? appSettings.value("enable") !== false : true)
                        title: modelData.name
                        subtitle: modelData.comment
                        iconName: modelData.icon
                        clickable: true
                        chevron: false
                        onClicked: toggle.toggled(!toggle.checked)
                        ChromeSwitch {
                            id: toggle
                            checked: appRow.appEnabled
                            onToggled: value => block.mode === "launcher"
                                ? block.setShown(appRow.modelData.id, value)
                                : block.setNotifications(appRow.modelData.id, value)
                        }
                    }
                }
            }
        }
    }
}
