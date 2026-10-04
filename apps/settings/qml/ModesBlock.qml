import QtQuick
import QtQuick.Controls as QQC2
import HypeSettings

Column {
    id: block
    readonly property var shell: GSettingsHub.schema("dev.hypede.shell")
    readonly property bool available: shell.valid && shell.hasKey("focus-modes")
    readonly property var modes: {
        if (shell.revision < 0 || !available)
            return []
        try { return JSON.parse(shell.value("focus-modes")) } catch (e) { return [] }
    }
    readonly property var apps: System.installedApps()
    readonly property var themes: {
        const r = System.runSync(["hypede-theme", "list"])
        try { return r.ok ? JSON.parse(r.out) : [] } catch (e) { return [] }
    }
    readonly property var defaultNames: ({ work: qsTr("Work"), game: qsTr("Game"), study: qsTr("Study") })
    width: parent ? parent.width : 0

    function store(list) {
        shell.setValue("focus-modes", JSON.stringify(list))
    }
    function edit(index, key, value) {
        const list = JSON.parse(JSON.stringify(modes))
        list[index][key] = value
        store(list)
    }
    function appName(id) {
        const a = apps.find(x => x.id === id)
        return a ? a.name : id
    }

    Repeater {
        model: block.modes
        delegate: Column {
            id: card
            required property var modelData
            required property int index
            width: block.width
            bottomPadding: 8

            SettingRow {
                showDivider: card.index > 0
                title: card.modelData.name || block.defaultNames[card.modelData.id] || card.modelData.id
                subtitle: qsTr("Turn on from quick settings or the launcher")
                iconName: "starred-symbolic"
                QQC2.TextField {
                    id: nameField
                    width: 200
                    height: 34
                    text: card.modelData.name || block.defaultNames[card.modelData.id] || ""
                    color: Theme.text
                    leftPadding: 12
                    background: Rectangle { radius: 17; color: Theme.field; border.width: nameField.activeFocus ? 2 : 0; border.color: Theme.accent }
                    onEditingFinished: block.edit(card.index, "name", text)
                }
            }
            SettingRow {
                title: qsTr("Do Not Disturb")
                ChromeSwitch {
                    checked: !!card.modelData.dnd
                    onToggled: value => block.edit(card.index, "dnd", value)
                }
            }
            SettingRow {
                title: qsTr("Power mode")
                ChromeCombo {
                    width: 200
                    options: [{ value: "", label: qsTr("Don't change") }, { value: "power-saver", label: qsTr("Power saver") },
                              { value: "balanced", label: qsTr("Balanced") }, { value: "performance", label: qsTr("Performance") }]
                    currentValue: card.modelData.power || ""
                    onActivated: value => block.edit(card.index, "power", value)
                }
            }
            SettingRow {
                title: qsTr("Theme")
                ChromeCombo {
                    width: 200
                    options: [{ value: "", label: qsTr("Don't change") }].concat(block.themes.map(t => ({ value: t.id, label: t.name })))
                    currentValue: card.modelData.theme || ""
                    onActivated: value => block.edit(card.index, "theme", value)
                }
            }
            SettingRow {
                title: qsTr("Open apps")
                subtitle: (card.modelData.apps || []).map(block.appName).join(", ") || qsTr("None")
                Row {
                    spacing: 8
                    ChromeCombo {
                        width: 200
                        options: [{ value: "", label: qsTr("Add app…") }].concat(block.apps.map(a => ({ value: a.id, label: a.name })))
                        currentValue: ""
                        onActivated: value => {
                            if (value)
                                block.edit(card.index, "apps", (card.modelData.apps || []).filter(x => x !== value).concat([value]))
                        }
                    }
                    ChromeButton {
                        visible: (card.modelData.apps || []).length > 0
                        flat: true
                        text: qsTr("Clear")
                        onClicked: block.edit(card.index, "apps", [])
                    }
                    ChromeButton {
                        flat: true
                        danger: true
                        text: qsTr("Delete")
                        onClicked: block.store(block.modes.filter((_, i) => i !== card.index))
                    }
                }
            }
        }
    }
    SettingRow {
        title: qsTr("New focus mode")
        iconName: "list-add-symbolic"
        ChromeButton {
            text: qsTr("Add")
            onClicked: block.store(block.modes.concat([{ id: "mode" + Date.now(), name: qsTr("My mode"), dnd: true, power: "", theme: "", apps: [] }]))
        }
    }
}
