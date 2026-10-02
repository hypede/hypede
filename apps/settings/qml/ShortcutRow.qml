import QtQuick
import HypeSettings

SettingRow {
    id: row
    property var settings
    property string key
    property bool resettable: true
    readonly property bool available: settings !== null && settings.valid && settings.hasKey(key)
    readonly property var value: settings && settings.revision >= 0 && available ? settings.value(key) : []
    readonly property string accel: Array.isArray(value) ? (value[0] || "") : value
    property bool capturing: false

    function pretty(a) {
        if (!a)
            return qsTr("Disabled")
        return a.replace(/<Primary>|<Control>/g, "Ctrl+").replace(/<Super>/g, "Super+").replace(/<Alt>/g, "Alt+")
                .replace(/<Shift>/g, "Shift+").replace(/\+([a-z])$/, (m, c) => "+" + c.toUpperCase())
                .replace(/^([a-z])$/, c => c.toUpperCase())
    }
    function store(a) {
        settings.setValue(key, Array.isArray(value) ? (a ? [a] : []) : a)
        capturing = false
    }

    Row {
        spacing: 8
        anchors.verticalCenter: parent ? parent.verticalCenter : undefined
        ChromeButton {
            id: button
            text: row.capturing ? qsTr("Press keys…") : row.pretty(row.accel)
            filled: row.capturing
            onClicked: {
                row.capturing = true
                catcher.forceActiveFocus()
            }
        }
        ChromeButton {
            visible: row.resettable && !row.capturing
            flat: true
            text: qsTr("Reset")
            onClicked: row.settings.reset(row.key)
        }
    }

    Item {
        id: catcher
        focus: row.capturing
        onActiveFocusChanged: if (!activeFocus) row.capturing = false
        Keys.onPressed: event => {
            event.accepted = true
            const k = event.key
            if (k === Qt.Key_Escape) { row.capturing = false; return }
            if (k === Qt.Key_Backspace && !event.modifiers) { row.store(""); return }
            if ([Qt.Key_Control, Qt.Key_Shift, Qt.Key_Alt, Qt.Key_Meta, Qt.Key_Super_L, Qt.Key_Super_R].includes(k))
                return
            const names = { [Qt.Key_Return]: "Return", [Qt.Key_Tab]: "Tab", [Qt.Key_Space]: "space",
                [Qt.Key_Print]: "Print", [Qt.Key_Delete]: "Delete", [Qt.Key_Home]: "Home", [Qt.Key_End]: "End",
                [Qt.Key_Left]: "Left", [Qt.Key_Right]: "Right", [Qt.Key_Up]: "Up", [Qt.Key_Down]: "Down",
                [Qt.Key_PageUp]: "Page_Up", [Qt.Key_PageDown]: "Page_Down", [Qt.Key_Backspace]: "BackSpace" }
            let name = names[k]
            if (!name && k >= Qt.Key_F1 && k <= Qt.Key_F12)
                name = "F" + (k - Qt.Key_F1 + 1)
            if (!name && k >= Qt.Key_A && k <= Qt.Key_Z)
                name = String.fromCharCode(k).toLowerCase()
            if (!name && k >= Qt.Key_0 && k <= Qt.Key_9)
                name = String.fromCharCode(k)
            if (!name)
                return
            let mods = ""
            if (event.modifiers & Qt.MetaModifier) mods += "<Super>"
            if (event.modifiers & Qt.ControlModifier) mods += "<Control>"
            if (event.modifiers & Qt.AltModifier) mods += "<Alt>"
            if (event.modifiers & Qt.ShiftModifier) mods += "<Shift>"
            row.store(mods + name)
        }
    }
}
