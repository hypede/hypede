import QtQuick
import HypeSettings

// Звук: устройство вывода и ввода, их громкость и выключение, громкость
// каждой играющей программы.
Column {
    id: block
    readonly property bool available: Sound.available
    readonly property var output: Sound.outputs.find(o => o.isDefault) || Sound.outputs[0] || null
    readonly property var input: Sound.inputs.find(i => i.isDefault) || Sound.inputs[0] || null
    readonly property var gsound: GSettingsHub.schema("org.gnome.desktop.sound")
    readonly property real maxVolume: gsound.revision >= 0 && gsound.valid
                                      && gsound.value("allow-volume-above-100-percent") ? 1.5 : 1

    width: parent ? parent.width : 0

    component DeviceRows: Column {
        id: rows
        property string kind
        property var devices: []
        property var current: null
        property string title
        property string muteIcon
        property string icon
        width: block.width

        SettingRow {
            title: rows.title
            showDivider: rows.kind !== "output"
            ChromeCombo {
                width: 300
                options: rows.devices.map(d => ({ value: d.name, label: d.description }))
                currentValue: rows.current ? rows.current.name : ""
                onActivated: value => Sound.setDefault(rows.kind, value)
            }
        }
        VolumeRow {
            visible: rows.current !== null
            kind: rows.kind
            name: rows.current ? rows.current.name : ""
            volume: rows.current ? rows.current.volume : 0
            muted: rows.current ? rows.current.muted : false
            icon: rows.icon
            muteIcon: rows.muteIcon
            label: qsTr("Volume")
        }
    }

    // Строка громкости: кнопка выключения звука, ползунок и проценты.
    component VolumeRow: Item {
        id: volumeRow
        property string kind
        property string name
        property real volume
        property bool muted
        property string icon
        property string muteIcon
        property string label
        property string appIcon: ""
        width: block.width
        height: 56

        Rectangle {
            x: 20; width: parent.width - 40; height: 1
            color: Theme.divider
        }
        SymbolIcon {
            visible: volumeRow.appIcon !== ""
            x: 20
            anchors.verticalCenter: parent.verticalCenter
            width: 20; height: 20
            source: volumeRow.appIcon
        }
        Text {
            x: volumeRow.appIcon !== "" ? 52 : 20
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width - x - slider.width - 130
            text: volumeRow.label
            color: Theme.text
            font.pixelSize: 14
            elide: Text.ElideRight
        }
        Rectangle {
            id: muteButton
            anchors.right: slider.left
            anchors.rightMargin: 8
            anchors.verticalCenter: parent.verticalCenter
            width: 36; height: 36; radius: 18
            color: muteMouse.containsMouse ? Theme.hover : "transparent"
            SymbolIcon {
                anchors.centerIn: parent
                width: 20; height: 20
                source: volumeRow.muted ? volumeRow.muteIcon : volumeRow.icon
                tint: volumeRow.muted ? Theme.danger : Theme.text
            }
            MouseArea {
                id: muteMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: Sound.setMuted(volumeRow.kind, volumeRow.name, !volumeRow.muted)
            }
        }
        ChromeSlider {
            id: slider
            anchors.right: percent.left
            anchors.rightMargin: 8
            anchors.verticalCenter: parent.verticalCenter
            width: 220
            from: 0
            to: Math.max(block.maxVolume, volumeRow.volume)
            stepSize: 0.01
            value: volumeRow.volume
            onMoved: value => {
                volumeRow.volume = value
                Sound.setVolume(volumeRow.kind, volumeRow.name, value)
            }
        }
        Text {
            id: percent
            anchors.right: parent.right
            anchors.rightMargin: 20
            anchors.verticalCenter: parent.verticalCenter
            width: 44
            horizontalAlignment: Text.AlignRight
            text: Math.round(volumeRow.volume * 100) + "%"
            color: Theme.subtext
            font.pixelSize: 13
        }
    }

    DeviceRows {
        visible: Sound.outputs.length > 0
        kind: "output"
        title: qsTr("Output")
        devices: Sound.outputs
        current: block.output
        icon: "audio-volume-high-symbolic"
        muteIcon: "audio-volume-muted-symbolic"
    }
    DeviceRows {
        visible: Sound.inputs.length > 0
        kind: "input"
        title: qsTr("Input")
        devices: Sound.inputs
        current: block.input
        icon: "audio-input-microphone-symbolic"
        muteIcon: "microphone-disabled-symbolic"
    }

    Text {
        visible: Sound.apps.length > 0
        x: 20
        topPadding: 20
        bottomPadding: 4
        text: qsTr("Apps")
        color: Theme.subtext
        font.pixelSize: 13
        font.weight: Font.Medium
    }
    Repeater {
        model: Sound.apps
        delegate: VolumeRow {
            required property var modelData
            kind: "app"
            name: modelData.index
            volume: modelData.volume
            muted: modelData.muted
            label: modelData.name
            appIcon: modelData.icon || "application-x-executable-symbolic"
            icon: "audio-volume-high-symbolic"
            muteIcon: "audio-volume-muted-symbolic"
        }
    }
    Item { width: 1; height: 8 }
}
