import QtQuick
import QtQuick.Dialogs
import QtQuick.Effects
import HypeSettings

// Живые обои: встроенные (шейдеры оболочки) или своё видео / GIF.
Item {
    id: block
    readonly property var shell: GSettingsHub.schema("dev.hypede.shell")
    readonly property bool available: shell.valid && shell.hasKey("wallpaper-live")
    readonly property string current: shell.revision >= 0 && available ? shell.value("wallpaper-live") : ""
    readonly property bool customFile: current.startsWith("file://")

    readonly property var builtins: [
        { id: "", name: qsTr("Off"), image: "" },
        { id: "hypede:waves", name: qsTr("Waves"), image: System.dataUrl("live/waves.jpg") },
        { id: "hypede:aurora", name: qsTr("Aurora"), image: System.dataUrl("live/aurora.jpg") },
        { id: "hypede:bokeh", name: qsTr("Bokeh"), image: System.dataUrl("live/bokeh.jpg") },
        { id: "hypede:mesh", name: qsTr("Gradient"), image: System.dataUrl("live/mesh.jpg") },
    ]

    width: parent ? parent.width : 0
    implicitHeight: flow.implicitHeight + 32
    height: implicitHeight

    Flow {
        id: flow
        x: 16
        y: 16
        width: parent.width - 32
        spacing: 12

        Repeater {
            model: block.builtins.concat([{ id: "file", name: block.customFile
                                            ? decodeURIComponent(block.current.replace(/^.*\//, ""))
                                            : qsTr("Video or GIF…"), image: "" }])
            delegate: Item {
                id: tile
                required property var modelData
                readonly property bool isFile: modelData.id === "file"
                readonly property bool selected: isFile ? block.customFile : block.current === modelData.id
                width: (flow.width - 2 * flow.spacing) / 3
                height: width * 0.56 + 30

                Item {
                    id: preview
                    width: parent.width
                    height: parent.width * 0.56
                    scale: tileMouse.pressed ? 0.97 : 1
                    Behavior on scale { NumberAnimation { duration: Theme.fast; easing.type: Easing.OutCubic } }
                    Rectangle { id: mask; anchors.fill: parent; radius: 12; visible: false; layer.enabled: true }
                    Rectangle {
                        anchors.fill: parent
                        radius: 12
                        color: Theme.field
                        Image {
                            anchors.fill: parent
                            visible: tile.modelData.image !== ""
                            source: tile.modelData.image
                            fillMode: Image.PreserveAspectCrop
                            asynchronous: true
                            layer.enabled: true
                            layer.effect: MultiEffect { maskEnabled: true; maskSource: mask }
                        }
                        SymbolIcon {
                            anchors.centerIn: parent
                            visible: tile.modelData.image === ""
                            source: tile.isFile ? "video-x-generic-symbolic" : "action-unavailable-symbolic"
                            tint: Theme.subtext
                            width: 28; height: 28
                        }
                    }
                    Rectangle {
                        anchors.fill: parent
                        radius: 12
                        color: "transparent"
                        border.width: tile.selected ? 3 : (tileMouse.containsMouse ? 2 : 0)
                        border.color: tile.selected ? Theme.accent : Theme.divider
                    }
                    MouseArea {
                        id: tileMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: tile.isFile ? fileDialog.open() : block.shell.setValue("wallpaper-live", tile.modelData.id)
                    }
                }
                Text {
                    anchors.top: preview.bottom
                    anchors.topMargin: 8
                    width: parent.width
                    text: tile.modelData.name
                    color: Theme.text
                    font.pixelSize: 13
                    font.weight: tile.selected ? Font.Medium : Font.Normal
                    elide: Text.ElideMiddle
                    horizontalAlignment: Text.AlignHCenter
                }
            }
        }
    }

    FileDialog {
        id: fileDialog
        title: qsTr("Live wallpaper")
        fileMode: FileDialog.OpenFile
        nameFilters: [qsTr("Videos and GIFs (*.mp4 *.webm *.mkv *.mov *.gif)")]
        onAccepted: block.shell.setValue("wallpaper-live", selectedFile.toString())
    }
}
