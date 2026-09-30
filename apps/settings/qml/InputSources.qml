import QtQuick
import HypeSettings

// Раскладки клавиатуры (org.gnome.desktop.input-sources): список,
// удаление, добавление и сочетание для переключения.
Item {
    id: block
    property bool showDivider: true
    readonly property var sources: GSettingsHub.schema("org.gnome.desktop.input-sources")
    readonly property bool available: sources.valid
    readonly property var list: sources.revision >= 0 ? sources.tuples("sources") : []

    readonly property var known: ({
        "xkb:us": qsTr("English (US)"), "xkb:gb": qsTr("English (UK)"), "xkb:ru": qsTr("Russian"),
        "xkb:ua": qsTr("Ukrainian"), "xkb:by": qsTr("Belarusian"), "xkb:kz": qsTr("Kazakh"),
        "xkb:de": qsTr("German"), "xkb:fr": qsTr("French"), "xkb:es": qsTr("Spanish"),
        "xkb:it": qsTr("Italian"), "xkb:pl": qsTr("Polish"), "xkb:tr": qsTr("Turkish"),
        "xkb:jp": qsTr("Japanese"), "xkb:cn": qsTr("Chinese"), "xkb:us+intl": qsTr("English (international)"),
        "xkb:ru+phonetic": qsTr("Russian (phonetic)"),
    })
    function label(id) { return known[id] || id.replace(/^xkb:/, "").toUpperCase() }

    readonly property var switchOptions: [
        { value: "", label: "Super+Space" },
        { value: "grp:alt_shift_toggle", label: "Alt+Shift" },
        { value: "grp:ctrl_shift_toggle", label: "Ctrl+Shift" },
        { value: "grp:caps_toggle", label: "Caps Lock" },
    ]
    readonly property string currentSwitch: {
        if (sources.revision < 0)
            return ""
        const opts = sources.value("xkb-options") || []
        for (const o of opts)
            if (o.startsWith("grp:"))
                return o
        return ""
    }

    width: parent ? parent.width : 0
    implicitHeight: column.implicitHeight
    height: implicitHeight

    Column {
        id: column
        width: parent.width

        Repeater {
            model: block.list
            delegate: SettingRow {
                required property string modelData
                required property int index
                title: block.label(modelData)
                subtitle: index === 0 ? qsTr("Default") : ""
                iconName: index === 0 ? "input-keyboard-symbolic" : ""
                showDivider: block.showDivider || index > 0
                Rectangle {
                    visible: block.list.length > 1
                    width: 32; height: 32; radius: 16
                    color: removeMouse.containsMouse ? Theme.hover : "transparent"
                    SymbolIcon {
                        anchors.centerIn: parent
                        source: "hypede-trash-symbolic"
                        width: 16; height: 16
                    }
                    MouseArea {
                        id: removeMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: block.sources.setTuples("sources", block.list.filter(s => s !== modelData))
                    }
                }
            }
        }

        SettingRow {
            title: qsTr("Add input method")
            ChromeCombo {
                options: Object.keys(block.known).filter(k => !block.list.includes(k))
                    .map(k => ({ value: k, label: block.known[k] }))
                    .sort((a, b) => a.label.localeCompare(b.label))
                currentValue: undefined
                onActivated: value => block.sources.setTuples("sources", block.list.concat([value]))
            }
        }

        SettingRow {
            title: qsTr("Switch input method with")
            ChromeCombo {
                options: block.switchOptions
                currentValue: block.currentSwitch
                onActivated: value => {
                    const rest = (block.sources.value("xkb-options") || []).filter(o => !o.startsWith("grp:"))
                    block.sources.setValue("xkb-options", value ? rest.concat([value]) : rest)
                }
            }
        }
    }
}
