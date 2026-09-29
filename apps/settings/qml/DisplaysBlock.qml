import QtQuick
import HypeSettings

// Мониторы: для каждого — разрешение, частота обновления, масштаб и
// поворот. После применения GNOME Shell спрашивает, сохранить ли настройки,
// и сам откатывает их через 20 секунд без ответа.
Item {
    id: block
    property bool showDivider: true
    readonly property bool available: Displays.available && Displays.monitors.length > 0

    width: parent ? parent.width : 0
    implicitHeight: column.implicitHeight
    height: implicitHeight

    function resolutions(monitor) {
        const seen = {}
        const list = []
        for (const m of monitor.modes) {
            const key = m.width + "×" + m.height
            if (!seen[key]) {
                seen[key] = true
                list.push({ value: key, label: key + (m.preferred ? " " + qsTr("(recommended)") : ""),
                            w: m.width, h: m.height })
            }
        }
        list.sort((a, b) => b.w * b.h - a.w * a.h)
        return list
    }
    function currentMode(monitor) {
        for (const m of monitor.modes)
            if (m.current)
                return m
        return monitor.modes.length ? monitor.modes[0] : null
    }
    function modesFor(monitor, resolution) {
        return monitor.modes.filter(m => m.width + "×" + m.height === resolution)
                            .sort((a, b) => b.refresh - a.refresh)
    }
    function pick(monitor, resolution, refresh) {
        const modes = modesFor(monitor, resolution)
        let best = modes[0]
        for (const m of modes)
            if (Math.abs(m.refresh - refresh) < Math.abs(best.refresh - refresh))
                best = m
        return best
    }
    function nearestScale(mode, scale) {
        let best = mode.scales[0] || 1
        for (const s of mode.scales)
            if (Math.abs(s - scale) < Math.abs(best - scale))
                best = s
        return best
    }
    function apply(monitor, mode, scale, transform) {
        Displays.apply(monitor.connector, mode.id, nearestScale(mode, scale), transform, monitor.primary)
    }

    Rectangle {
        visible: block.showDivider
        width: parent.width; height: 1
        color: Theme.divider
    }

    Column {
        id: column
        width: parent.width

        Repeater {
            model: Displays.monitors
            delegate: Column {
                id: monitorItem
                required property var modelData
                required property int index
                readonly property var mode: block.currentMode(modelData)
                readonly property string resolution: mode ? mode.width + "×" + mode.height : ""
                width: column.width

                SettingRow {
                    title: monitorItem.modelData.name
                    subtitle: (monitorItem.modelData.builtin ? qsTr("Built-in display") : monitorItem.modelData.connector)
                              + (monitorItem.modelData.primary && Displays.monitors.length > 1 ? " · " + qsTr("Main display") : "")
                    iconName: monitorItem.modelData.builtin ? "computer-symbolic" : "video-display-symbolic"
                    showDivider: monitorItem.index > 0
                    ChromeButton {
                        visible: Displays.monitors.length > 1 && !monitorItem.modelData.primary
                        text: qsTr("Make main")
                        onClicked: Displays.apply(monitorItem.modelData.connector, monitorItem.mode.id,
                                                  monitorItem.modelData.scale, monitorItem.modelData.transform, true)
                    }
                }
                SettingRow {
                    title: qsTr("Resolution")
                    ChromeCombo {
                        width: 220
                        options: block.resolutions(monitorItem.modelData)
                        currentValue: monitorItem.resolution
                        onActivated: value => block.apply(monitorItem.modelData,
                            block.pick(monitorItem.modelData, value, monitorItem.mode.refresh),
                            monitorItem.modelData.scale, monitorItem.modelData.transform)
                    }
                }
                SettingRow {
                    title: qsTr("Refresh rate")
                    ChromeCombo {
                        width: 220
                        options: block.modesFor(monitorItem.modelData, monitorItem.resolution)
                                      .map(m => ({ value: m.id, label: qsTr("%1 Hz").arg(m.refresh.toFixed(2).replace(/\.?0+$/, "")) }))
                        currentValue: monitorItem.mode ? monitorItem.mode.id : ""
                        onActivated: value => {
                            const m = monitorItem.modelData.modes.find(x => x.id === value)
                            block.apply(monitorItem.modelData, m, monitorItem.modelData.scale, monitorItem.modelData.transform)
                        }
                    }
                }
                SettingRow {
                    title: qsTr("Display size")
                    subtitle: qsTr("Makes text and apps larger or smaller")
                    ChromeCombo {
                        width: 220
                        options: (monitorItem.mode ? monitorItem.mode.scales : [1])
                                      .map(s => ({ value: s, label: Math.round(s * 100) + "%" }))
                        currentValue: monitorItem.modelData.scale
                        onActivated: value => block.apply(monitorItem.modelData, monitorItem.mode, value,
                                                          monitorItem.modelData.transform)
                    }
                }
                SettingRow {
                    title: qsTr("Orientation")
                    ChromeCombo {
                        width: 220
                        options: [ { value: 0, label: qsTr("Standard") }, { value: 1, label: qsTr("90°") },
                                   { value: 2, label: qsTr("180°") }, { value: 3, label: qsTr("270°") } ]
                        currentValue: monitorItem.modelData.transform
                        onActivated: value => block.apply(monitorItem.modelData, monitorItem.mode,
                                                          monitorItem.modelData.scale, value)
                    }
                }
            }
        }
    }
}
