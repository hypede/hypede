import QtQuick
import HypeSettings

Column {
    id: block
    readonly property var shell: GSettingsHub.schema("dev.hypede.shell")
    readonly property var list: {
        if (shell.revision < 0 || !shell.valid || !shell.hasKey("desktop-widgets"))
            return []
        try { return JSON.parse(shell.value("desktop-widgets")) } catch (e) { return [] }
    }
    readonly property var types: [
        { id: "clock", title: qsTr("Clock"), icon: "preferences-system-time-symbolic" },
        { id: "calendar", title: qsTr("Calendar"), icon: "x-office-calendar-symbolic" },
        { id: "weather", title: qsTr("Weather"), subtitle: qsTr("City is taken from the Weather app"), icon: "weather-few-clouds-symbolic" },
        { id: "system", title: qsTr("System"), subtitle: qsTr("Processor, memory and battery"), icon: "utilities-system-monitor-symbolic" },
        { id: "media", title: qsTr("Music"), subtitle: qsTr("Shown while something is playing"), icon: "audio-x-generic-symbolic" },
        { id: "note", title: qsTr("Note"), icon: "accessories-text-editor-symbolic" },
    ]
    width: parent ? parent.width : 0

    Repeater {
        model: block.types
        delegate: SettingRow {
            required property var modelData
            required property int index
            showDivider: index > 0
            title: modelData.title
            subtitle: modelData.subtitle || ""
            iconName: modelData.icon
            ChromeSwitch {
                checked: block.list.some(w => w.type === modelData.id)
                onToggled: value => {
                    const rest = block.list.filter(w => w.type !== modelData.id)
                    block.shell.setValue("desktop-widgets", JSON.stringify(value ? rest.concat([{ type: modelData.id }]) : rest))
                }
            }
        }
    }
}
