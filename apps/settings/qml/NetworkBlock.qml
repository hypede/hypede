import QtQuick
import QtQuick.Controls as QQC2
import HypeSettings

// Сеть: Wi‑Fi (каждый адаптер отдельно, если их несколько), Ethernet и VPN.
// Всё берётся у NetworkManager через Network.
Column {
    id: block
    readonly property bool available: Network.available
    readonly property var wifi: Network.devices.filter(d => d.kind === "wifi")
    readonly property var ethernet: Network.devices.filter(d => d.kind === "ethernet")
    property string selected: ""
    readonly property var device: wifi.find(d => d.path === selected) || wifi[0] || null
    readonly property var networks: device && Network.wifiEnabled ? Network.networks(device.path) : []
    property string expanded: ""
    property string error: ""
    property bool hiddenForm: false

    width: parent ? parent.width : 0

    function signalIcon(strength) {
        const level = strength > 75 ? "excellent" : strength > 50 ? "good" : strength > 25 ? "ok" : "weak"
        return "network-wireless-signal-" + level + "-symbolic"
    }
    function deviceStatus(d) {
        if (d.connected)
            return (d.connection || qsTr("Connected")) + (d.address ? " · " + d.address : "")
        if (d.connecting)
            return qsTr("Connecting…")
        if (!d.available)
            return d.kind === "ethernet" ? qsTr("Cable unplugged") : qsTr("Unavailable")
        return qsTr("Not connected")
    }

    Connections {
        target: Network
        function onFailed(message) { block.error = message }
    }
    // Список сетей обновляется при каждом изменении в NetworkManager, а
    // раз в 20 секунд адаптер ищет новые.
    Timer {
        interval: 20000
        repeat: true
        triggeredOnStart: true
        running: block.visible && block.device !== null && Network.wifiEnabled
        onTriggered: Network.scan(block.device.path)
    }

    SettingRow {
        visible: block.wifi.length > 0
        title: qsTr("Wi‑Fi")
        subtitle: !Network.wifiHardwareEnabled ? qsTr("Turned off by a switch on the device")
                  : Network.wifiEnabled ? qsTr("On") : qsTr("Off")
        showDivider: false
        ChromeSwitch {
            checked: Network.wifiEnabled
            onToggled: value => Network.wifiEnabled = value
        }
    }

    // Несколько адаптеров — выбор адаптера и его собственный переключатель.
    SettingRow {
        visible: block.wifi.length > 1 && Network.wifiEnabled
        title: qsTr("Adapter")
        subtitle: block.device ? block.device.interface : ""
        ChromeCombo {
            width: 260
            options: block.wifi.map(d => ({ value: d.path, label: d.name + " (" + d.interface + ")" }))
            currentValue: block.device ? block.device.path : ""
            onActivated: value => block.selected = value
        }
    }
    SettingRow {
        visible: block.wifi.length > 1 && Network.wifiEnabled && block.device !== null
        title: qsTr("Use this adapter")
        subtitle: block.device ? block.deviceStatus(block.device) : ""
        ChromeSwitch {
            checked: block.device !== null && block.device.autoconnect
            onToggled: value => Network.setDeviceEnabled(block.device.path, value)
        }
    }

    Repeater {
        model: block.networks
        delegate: Column {
            id: net
            required property var modelData
            required property int index
            readonly property bool open: block.expanded === modelData.ssid
            width: block.width

            function activate() {
                block.error = ""
                if (!modelData.active && (modelData.known || !modelData.secure))
                    Network.connectTo(block.device.path, modelData.ssid, "")
                block.expanded = open ? "" : modelData.ssid
            }

            Item {
                width: parent.width
                height: 56
                Rectangle {
                    anchors.fill: parent
                    color: mouse.pressed ? Theme.pressed : (mouse.containsMouse ? Theme.hover : "transparent")
                }
                Rectangle {
                    x: 60; width: parent.width - 80; height: 1
                    color: Theme.divider
                }
                SymbolIcon {
                    x: 20
                    anchors.verticalCenter: parent.verticalCenter
                    width: 20; height: 20
                    source: block.signalIcon(net.modelData.strength)
                    tint: net.modelData.active ? Theme.accent : Theme.text
                }
                Column {
                    x: 60
                    anchors.verticalCenter: parent.verticalCenter
                    width: parent.width - 140
                    spacing: 2
                    Text {
                        width: parent.width
                        text: net.modelData.ssid
                        color: net.modelData.active ? Theme.accent : Theme.text
                        font.pixelSize: 14
                        font.weight: net.modelData.active ? Font.Medium : Font.Normal
                        elide: Text.ElideRight
                    }
                    Text {
                        width: parent.width
                        visible: text !== ""
                        text: net.modelData.active ? (block.device.connected ? qsTr("Connected") : qsTr("Connecting…"))
                              : net.modelData.known ? qsTr("Saved") : ""
                        color: Theme.subtext
                        font.pixelSize: 12
                    }
                }
                SymbolIcon {
                    visible: net.modelData.secure
                    anchors.right: parent.right
                    anchors.rightMargin: 20
                    anchors.verticalCenter: parent.verticalCenter
                    width: 16; height: 16
                    source: "system-lock-screen-symbolic"
                    tint: Theme.subtext
                }
                MouseArea {
                    id: mouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: net.activate()
                }
            }

            // Раскрытая сеть: пароль для новой защищённой или действия
            // для подключённой и сохранённой.
            Item {
                visible: net.open
                width: parent.width
                height: visible ? 60 : 0
                PasswordField {
                    id: password
                    visible: !net.modelData.known && net.modelData.secure && !net.modelData.active
                    x: 60
                    anchors.verticalCenter: parent.verticalCenter
                    width: Math.min(280, parent.width - 260)
                    onAccepted: connectButton.clicked()
                }
                Row {
                    anchors.right: parent.right
                    anchors.rightMargin: 20
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: 8
                    ChromeButton {
                        visible: net.modelData.known || net.modelData.active
                        flat: true
                        text: qsTr("Forget")
                        onClicked: { Network.forget(net.modelData.ssid); block.expanded = "" }
                    }
                    ChromeButton {
                        visible: net.modelData.active
                        text: qsTr("Disconnect")
                        onClicked: { Network.disconnectDevice(block.device.path); block.expanded = "" }
                    }
                    ChromeButton {
                        id: connectButton
                        visible: password.visible
                        filled: true
                        text: qsTr("Connect")
                        onClicked: {
                            Network.connectTo(block.device.path, net.modelData.ssid, password.text)
                            block.expanded = ""
                        }
                    }
                }
            }
        }
    }

    // Скрытая сеть: имени нет в списке, его вводят вручную.
    SettingRow {
        visible: block.device !== null && Network.wifiEnabled
        title: qsTr("Hidden network…")
        clickable: true
        chevron: false
        onClicked: block.hiddenForm = !block.hiddenForm
    }
    Item {
        visible: block.hiddenForm && block.device !== null && Network.wifiEnabled
        width: parent.width
        height: visible ? 108 : 0
        Column {
            x: 20
            y: 4
            spacing: 8
            PasswordField {
                id: hiddenSsid
                width: 280
                echo: false
                placeholder: qsTr("Network name")
            }
            PasswordField {
                id: hiddenPassword
                width: 280
                placeholder: qsTr("Password (if any)")
            }
        }
        ChromeButton {
            anchors.right: parent.right
            anchors.rightMargin: 20
            anchors.bottom: parent.bottom
            anchors.bottomMargin: 8
            filled: true
            enabled: hiddenSsid.text !== ""
            text: qsTr("Connect")
            onClicked: {
                Network.connectTo(block.device.path, hiddenSsid.text, hiddenPassword.text, true)
                block.hiddenForm = false
            }
        }
    }

    SectionHeader { visible: block.ethernet.length > 0; text: qsTr("Ethernet") }
    Repeater {
        model: block.ethernet
        delegate: SettingRow {
            required property var modelData
            required property int index
            title: block.ethernet.length > 1 ? modelData.name + " (" + modelData.interface + ")" : modelData.name
            subtitle: block.deviceStatus(modelData)
            showDivider: index > 0
            ChromeSwitch {
                enabled: modelData.available
                checked: modelData.connected || modelData.connecting
                onToggled: value => value ? Network.activateDevice(modelData.path) : Network.disconnectDevice(modelData.path)
            }
        }
    }

    SectionHeader { visible: Network.vpns.length > 0; text: qsTr("VPN") }
    Repeater {
        model: Network.vpns
        delegate: SettingRow {
            required property var modelData
            required property int index
            title: modelData.name
            subtitle: modelData.active ? qsTr("Connected") : modelData.activating ? qsTr("Connecting…")
                                       : (modelData.type === "wireguard" ? "WireGuard" : qsTr("VPN"))
            showDivider: index > 0
            ChromeSwitch {
                checked: modelData.active || modelData.activating
                onToggled: value => Network.setVpnActive(modelData.path, value)
            }
        }
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

    component SectionHeader: Text {
        x: 20
        width: block.width - 40
        topPadding: 20
        bottomPadding: 4
        color: Theme.subtext
        font.pixelSize: 13
        font.weight: Font.Medium
    }

    // Поле в стиле настроек; echo: false — обычный текст, а не пароль.
    component PasswordField: QQC2.TextField {
        id: field
        property bool echo: true
        property string placeholder: qsTr("Password")
        height: 36
        echoMode: echo ? TextInput.Password : TextInput.Normal
        placeholderText: placeholder
        placeholderTextColor: Theme.subtext
        color: Theme.text
        font.pixelSize: 14
        leftPadding: 14
        rightPadding: 14
        selectByMouse: true
        background: Rectangle {
            radius: 18
            color: field.hovered ? Theme.fieldHover : Theme.field
            border.width: field.activeFocus ? 2 : 0
            border.color: Theme.accent
        }
    }
}
