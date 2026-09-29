import QtQuick
import HypeSettings

// Программы автозапуска и переключатели «запускать в HypeDE».
// Выключенные попадают в dev.hypede.session disabled-autostart: их не
// запустит только сеанс HypeDE, обычный GNOME и Plasma их по-прежнему
// запускают. Добавить свою программу — модуль KDE «Автозапуск» (Приложения).
Item {
    id: block
    readonly property var session: GSettingsHub.schema("dev.hypede.session")
    readonly property bool available: session.valid
    readonly property var entries: System.autostartEntries()
    readonly property var disabled: session.revision >= 0 ? (session.value("disabled-autostart") || []) : []

    width: parent ? parent.width : 0
    implicitHeight: column.implicitHeight
    height: implicitHeight

    function setEnabled(id, enabled) {
        let list = disabled.filter(item => item !== id)
        if (!enabled)
            list.push(id)
        session.setValue("disabled-autostart", list)
    }

    Column {
        id: column
        width: parent.width

        Item {
            visible: block.entries.length === 0
            width: parent.width
            height: 56
            Text {
                x: 20
                anchors.verticalCenter: parent.verticalCenter
                text: qsTr("No startup apps")
                color: Theme.subtext
                font.pixelSize: 14
            }
        }

        Repeater {
            model: block.entries
            delegate: SettingRow {
                id: entryRow
                required property var modelData
                required property int index
                title: modelData.name
                subtitle: (modelData.comment ? modelData.comment + " · " : "")
                          + (modelData.system ? qsTr("System") : qsTr("Yours"))
                iconName: modelData.icon || "system-run-symbolic"
                showDivider: index > 0
                clickable: true
                chevron: false
                onClicked: toggle.toggled(!toggle.checked)
                ChromeSwitch {
                    id: toggle
                    checked: block.disabled.indexOf(entryRow.modelData.id) < 0
                    onToggled: value => block.setEnabled(entryRow.modelData.id, value)
                }
            }
        }
    }
}
