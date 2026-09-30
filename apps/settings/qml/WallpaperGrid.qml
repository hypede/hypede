import QtQuick
import QtQuick.Effects
import HypeSettings

// Сетка обоев. Для пар «…-light» / «…-dark» ставится пара: светлая —
// для светлой темы, тёмная — для тёмной, как у обоев Chrome OS.
Item {
    id: grid
    readonly property var bg: GSettingsHub.schema("org.gnome.desktop.background")
    readonly property bool available: bg.valid
    readonly property string currentUri: bg.revision >= 0 ? bg.value(Theme.dark ? "picture-uri-dark" : "picture-uri") : ""
    readonly property var files: System.wallpapers()
                                  .filter(f => !/-dark\.[a-z]+$/.test(f) || !System.wallpapers().includes(f.replace(/-dark(\.[a-z]+)$/, "-light$1")))

    width: parent ? parent.width : 0
    implicitHeight: flow.implicitHeight + 32
    height: implicitHeight

    function apply(path) {
        const uri = "file://" + path
        let dark = uri
        const twin = path.replace(/-light(\.[a-z]+)$/, "-dark$1")
        if (twin !== path && System.wallpapers().includes(twin))
            dark = "file://" + twin
        bg.setValue("picture-uri", uri)
        bg.setValue("picture-uri-dark", dark)
    }

    Flow {
        id: flow
        x: 16
        y: 16
        width: parent.width - 32
        spacing: 12
        Repeater {
            model: grid.files
            delegate: Item {
                id: tile
                required property string modelData
                readonly property bool selected: {
                    const uri = "file://" + modelData
                    return grid.currentUri === uri
                        || grid.currentUri === "file://" + modelData.replace(/-light(\.[a-z]+)$/, "-dark$1")
                }
                width: (flow.width - 2 * flow.spacing) / 3
                height: width * 0.62

                Rectangle {
                    id: mask
                    anchors.fill: parent
                    radius: 12
                    visible: false
                    layer.enabled: true
                }
                Image {
                    id: image
                    anchors.fill: parent
                    source: "file://" + tile.modelData
                    sourceSize.width: 360
                    sourceSize.height: 240
                    fillMode: Image.PreserveAspectCrop
                    asynchronous: true
                    layer.enabled: true
                    layer.effect: MultiEffect {
                        maskEnabled: true
                        maskSource: mask
                    }
                }
                Rectangle {
                    anchors.fill: parent
                    radius: 12
                    color: "transparent"
                    border.width: tile.selected ? 3 : (tileMouse.containsMouse ? 2 : 0)
                    border.color: tile.selected ? Theme.accent : Theme.divider
                }
                Rectangle {
                    visible: tile.selected
                    width: 24; height: 24; radius: 12
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: 8
                    color: Theme.accent
                    SymbolIcon {
                        anchors.centerIn: parent
                        source: "object-select-symbolic"
                        tint: Theme.accentText
                        width: 14; height: 14
                    }
                }
                MouseArea {
                    id: tileMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: grid.apply(tile.modelData)
                }
            }
        }
    }
}
