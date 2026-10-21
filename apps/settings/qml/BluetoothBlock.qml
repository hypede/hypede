import QtQuick
import QtQuick.Controls as QQC2
import HypeSettings

// Bluetooth: адаптер (выбор, если их несколько), его включение, имя и
// видимость, сопряжённые и найденные устройства. Пока страница открыта,
// адаптер ищет устройства. Вопросы при сопряжении (код, PIN) — здесь же.
Column {
    id: block
    readonly property bool available: Bluetooth.available
    readonly property var adapter: Bluetooth.adapters.find(a => a.path === Bluetooth.adapter) || null
    readonly property var paired: Bluetooth.devices.filter(d => d.paired)
    readonly property var found: Bluetooth.devices.filter(d => !d.paired)
    readonly property var request: Bluetooth.request
    property string error: ""
    property string busy: ""

    width: parent ? parent.width : 0

    Component.onCompleted: Bluetooth.setDiscovery(true)
    Component.onDestruction: Bluetooth.setDiscovery(false)
    Connections {
        target: Bluetooth
        function onFailed(message) { block.error = message; block.busy = "" }
        function onChanged() { block.busy = "" }
    }

    function deviceIcon(icon) {
        if (/audio|headset|headphone/.test(icon)) return "audio-headphones-symbolic"
        if (/keyboard/.test(icon)) return "input-keyboard-symbolic"
        if (/mouse/.test(icon)) return "input-mouse-symbolic"
        if (/gaming|joystick/.test(icon)) return "input-gaming-symbolic"
        if (/phone/.test(icon)) return "phone-symbolic"
        if (/computer/.test(icon)) return "computer-symbolic"
        return "bluetooth-active-symbolic"
    }

    SettingRow {
        visible: Bluetooth.adapters.length > 1
        title: qsTr("Adapter")
        showDivider: false
        ChromeCombo {
            width: 260
            options: Bluetooth.adapters.map(a => ({ value: a.path, label: a.name + " (" + a.interface + ")" }))
            currentValue: Bluetooth.adapter
            onActivated: value => Bluetooth.adapter = value
        }
    }
    SettingRow {
        visible: block.adapter !== null
        title: qsTr("Bluetooth")
        subtitle: block.adapter ? (block.adapter.powered ? qsTr("On") : qsTr("Off")) + " · " + block.adapter.address : ""
        showDivider: Bluetooth.adapters.length > 1
        ChromeSwitch {
            checked: block.adapter !== null && block.adapter.powered
            onToggled: value => Bluetooth.setPowered(block.adapter.path, value)
        }
    }
    SettingRow {
        visible: block.adapter !== null && block.adapter.powered
        title: qsTr("Device name")
        subtitle: qsTr("What other devices see")
        QQC2.TextField {
            id: alias
            width: 220
            height: 36
            text: block.adapter ? block.adapter.name : ""
            color: Theme.text
            font.pixelSize: 14
            leftPadding: 14
            rightPadding: 14
            selectByMouse: true
            background: Rectangle {
                radius: 18
                color: alias.hovered ? Theme.fieldHover : Theme.field
                border.width: alias.activeFocus ? 2 : 0
                border.color: Theme.accent
            }
            onEditingFinished: if (block.adapter && text !== block.adapter.name) Bluetooth.setAlias(block.adapter.path, text)
        }
    }
    SettingRow {
        visible: block.adapter !== null && block.adapter.powered
        title: qsTr("Visible to other devices")
        subtitle: qsTr("Phones and computers nearby can find this device")
        ChromeSwitch {
            checked: block.adapter !== null && block.adapter.discoverable
            onToggled: value => Bluetooth.setDiscoverable(block.adapter.path, value)
        }
    }

    // Вопрос при сопряжении.
    Rectangle {
        visible: block.request.kind !== undefined
        x: 16
        width: parent.width - 32
        height: visible ? askColumn.implicitHeight + 32 : 0
        radius: 12
        color: Theme.accentContainer
        Column {
            id: askColumn
            x: 16; y: 16
            width: parent.width - 32
            spacing: 10
            Text {
                width: parent.width
                wrapMode: Text.Wrap
                color: Theme.accentContainerText
                font.pixelSize: 14
                text: {
                    const r = block.request
                    switch (r.kind) {
                    case "confirm": return qsTr("Does “%1” show this code?").arg(r.device)
                    case "display": return qsTr("Type this code on “%1” and press Enter").arg(r.device)
                    case "pin": return qsTr("Enter the PIN for “%1” (often 0000 or 1234)").arg(r.device)
                    case "passkey": return qsTr("Enter the code shown on “%1”").arg(r.device)
                    case "authorize": return qsTr("Allow “%1” to connect?").arg(r.device)
                    }
                    return ""
                }
            }
            Text {
                visible: block.request.code !== undefined && block.request.code !== ""
                text: block.request.code || ""
                color: Theme.accentContainerText
                font.pixelSize: 28
                font.weight: Font.Medium
                font.letterSpacing: 4
            }
            QQC2.TextField {
                id: pin
                visible: block.request.kind === "pin" || block.request.kind === "passkey"
                width: 200
                height: 36
                color: Theme.text
                font.pixelSize: 14
                leftPadding: 14
                inputMethodHints: block.request.kind === "passkey" ? Qt.ImhDigitsOnly : Qt.ImhNone
                background: Rectangle { radius: 18; color: Theme.surface }
                onVisibleChanged: text = ""
                onAccepted: Bluetooth.answer(true, text)
            }
            Row {
                spacing: 8
                ChromeButton {
                    flat: true
                    text: block.request.kind === "display" ? qsTr("Cancel") : qsTr("Reject")
                    onClicked: Bluetooth.answer(false)
                }
                ChromeButton {
                    visible: block.request.kind !== "display"
                    filled: true
                    text: block.request.kind === "confirm" ? qsTr("Codes match") : qsTr("Allow")
                    onClicked: Bluetooth.answer(true, pin.text)
                }
            }
        }
    }

    Text {
        visible: block.paired.length > 0 && block.adapter !== null && block.adapter.powered
        x: 20
        topPadding: 20
        bottomPadding: 4
        text: qsTr("Paired devices")
        color: Theme.subtext
        font.pixelSize: 13
        font.weight: Font.Medium
    }
    Repeater {
        model: block.adapter && block.adapter.powered ? block.paired : []
        delegate: DeviceRow {}
    }

    Row {
        visible: block.adapter !== null && block.adapter.powered
        x: 20
        topPadding: 20
        bottomPadding: 4
        spacing: 8
        Text {
            text: qsTr("Available devices")
            color: Theme.subtext
            font.pixelSize: 13
            font.weight: Font.Medium
        }
        Text {
            visible: block.adapter !== null && block.adapter.discovering
            text: qsTr("searching…")
            color: Theme.subtext
            font.pixelSize: 13
        }
    }
    Item {
        visible: block.adapter !== null && block.adapter.powered && block.found.length === 0
        width: parent.width
        height: visible ? 48 : 0
        Text {
            x: 20
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width - 40
            wrapMode: Text.Wrap
            text: qsTr("Looking for devices… Make sure the device is in pairing mode.")
            color: Theme.subtext
            font.pixelSize: 13
        }
    }
    Repeater {
        model: block.adapter && block.adapter.powered ? block.found : []
        delegate: DeviceRow {}
    }

    Text {
        visible: block.error !== ""
        x: 20
        width: parent.width - 40
        topPadding: 8
        bottomPadding: 12
        text: block.error
        color: Theme.danger
        font.pixelSize: 13
        wrapMode: Text.Wrap
    }

    Item { width: 1; height: 8 }

    component DeviceRow: Item {
        id: row
        required property var modelData
        required property int index
        readonly property bool waiting: block.busy === modelData.path
        width: block.width
        height: 56

        Rectangle {
            x: 60; width: parent.width - 80; height: 1
            visible: row.index > 0
            color: Theme.divider
        }
        SymbolIcon {
            x: 20
            anchors.verticalCenter: parent.verticalCenter
            width: 20; height: 20
            source: block.deviceIcon(row.modelData.icon)
            tint: row.modelData.connected ? Theme.accent : Theme.text
        }
        Column {
            x: 60
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width - 60 - buttons.width - 36
            spacing: 2
            Text {
                width: parent.width
                text: row.modelData.name
                color: Theme.text
                font.pixelSize: 14
                elide: Text.ElideRight
            }
            Text {
                width: parent.width
                visible: text !== ""
                text: {
                    const d = row.modelData
                    if (row.waiting) return qsTr("Please wait…")
                    const parts = []
                    if (d.connected) parts.push(qsTr("Connected"))
                    else if (d.paired) parts.push(qsTr("Not connected"))
                    if (d.battery >= 0) parts.push(qsTr("Battery %1%").arg(d.battery))
                    return parts.join(" · ")
                }
                color: Theme.subtext
                font.pixelSize: 12
            }
        }
        Row {
            id: buttons
            anchors.right: parent.right
            anchors.rightMargin: 20
            anchors.verticalCenter: parent.verticalCenter
            spacing: 8
            ChromeButton {
                visible: row.modelData.paired
                flat: true
                text: qsTr("Remove")
                onClicked: Bluetooth.remove(row.modelData.path)
            }
            ChromeButton {
                enabled: !row.waiting
                filled: !row.modelData.paired
                text: !row.modelData.paired ? qsTr("Pair")
                      : row.modelData.connected ? qsTr("Disconnect") : qsTr("Connect")
                onClicked: {
                    block.error = ""
                    block.busy = row.modelData.path
                    const d = row.modelData
                    if (!d.paired) Bluetooth.pair(d.path)
                    else if (d.connected) Bluetooth.disconnectDevice(d.path)
                    else Bluetooth.connectDevice(d.path)
                }
            }
        }
    }
}
