import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Effects
import HypeSettings

// Магазин тем: каталог с GitHub, установка в один клик и публикация своей
// темы по ссылке на репозиторий. Сеть и проверки — в hypede-theme.
Item {
    id: block
    property var themes: []
    property bool loading: false
    property string status: ""
    property bool statusError: false
    property string busy: ""

    width: parent ? parent.width : 0
    implicitHeight: column.implicitHeight + 16
    height: implicitHeight

    function load() {
        block.loading = true
        System.runAsync(["hypede-theme", "store"], "store-list")
    }
    function say(text, error) {
        block.status = text
        block.statusError = !!error
    }
    function clean(err) {
        return (err || qsTr("Something went wrong")).replace(/^hypede-theme: /, "")
    }

    Component.onCompleted: if (System.hasProgram("hypede-theme")) load()

    Connections {
        target: System
        function onProcessFinished(tag, ok, out, err) {
            if (tag === "store-list") {
                block.loading = false
                try {
                    block.themes = ok ? JSON.parse(out) : []
                } catch (e) {
                    block.themes = []
                }
                if (!ok)
                    block.say(block.clean(err), true)
            } else if (tag === "store-install") {
                block.busy = ""
                if (ok) {
                    block.say(qsTr("Theme installed and applied"))
                    block.themes = block.themes.map(t => Object.assign({}, t, { installed: t.installed || t.id === block.lastInstall }))
                } else {
                    block.say(block.clean(err), true)
                }
            } else if (tag === "store-check") {
                block.busy = ""
                if (!ok) {
                    block.say(block.clean(err), true)
                    return
                }
                const r = JSON.parse(out)
                block.say(qsTr("“%1” is ready. Confirm the request on GitHub — the bot adds it within a minute").arg(r.name))
                System.openUrl(r.issue)
            }
        }
    }
    property string lastInstall: ""

    function install(ref, id) {
        block.busy = id
        block.lastInstall = id
        block.say(qsTr("Downloading…"))
        System.runAsync(["hypede-theme", "install", ref, "--apply"], "store-install")
    }

    Column {
        id: column
        width: parent.width

        Item {
            visible: block.loading && block.themes.length === 0
            width: parent.width
            height: 120
            QQC2.BusyIndicator { anchors.centerIn: parent; running: parent.visible }
        }

        Flow {
            id: flow
            x: 16
            width: parent.width - 32
            topPadding: 16
            spacing: 12

            Repeater {
                model: block.themes
                delegate: Item {
                    id: card
                    required property var modelData
                    readonly property bool dark: modelData.scheme === "prefer-dark"
                    readonly property color accent: /^#[0-9a-fA-F]{6}$/.test(modelData.accent) ? modelData.accent
                                                     : (Theme.accents[modelData.gnomeAccent] || "#3584e4")
                    width: (flow.width - 2 * flow.spacing) / 3
                    height: preview.height + 74

                    Item {
                        id: preview
                        width: parent.width
                        height: width * 0.5625
                        Rectangle { id: mask; anchors.fill: parent; radius: 14; visible: false; layer.enabled: true }
                        Item {
                            anchors.fill: parent
                            layer.enabled: true
                            layer.effect: MultiEffect { maskEnabled: true; maskSource: mask }
                            Rectangle {
                                anchors.fill: parent
                                gradient: Gradient {
                                    GradientStop { position: 0; color: card.modelData.menus || (card.dark ? "#1b1c1e" : "#e9edf3") }
                                    GradientStop { position: 1; color: card.accent }
                                }
                            }
                            Image {
                                anchors.fill: parent
                                source: card.modelData.preview || card.modelData.wallpaper || ""
                                sourceSize.width: 400
                                fillMode: Image.PreserveAspectCrop
                                asynchronous: true
                            }
                        }
                        Rectangle {
                            anchors.fill: parent
                            radius: 14
                            color: "transparent"
                            border.width: cardMouse.containsMouse ? 2 : 0
                            border.color: Theme.divider
                        }
                        Rectangle {
                            width: 14; height: 14; radius: 7
                            anchors.right: parent.right
                            anchors.top: parent.top
                            anchors.margins: 10
                            color: card.accent
                            border.width: 2
                            border.color: "white"
                        }
                        MouseArea {
                            id: cardMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: System.openUrl(card.modelData.url)
                            QQC2.ToolTip.visible: containsMouse && card.modelData.description !== ""
                            QQC2.ToolTip.text: card.modelData.description
                            QQC2.ToolTip.delay: 500
                        }
                    }
                    Column {
                        anchors.top: preview.bottom
                        anchors.topMargin: 8
                        width: parent.width
                        spacing: 2
                        Text {
                            width: parent.width
                            text: card.modelData.name
                            color: Theme.text
                            font.pixelSize: 13
                            font.weight: Font.Medium
                            elide: Text.ElideRight
                        }
                        Item {
                            width: parent.width
                            height: 30
                            Text {
                                anchors.left: parent.left
                                anchors.right: get.left
                                anchors.rightMargin: 6
                                anchors.verticalCenter: parent.verticalCenter
                                text: card.modelData.author
                                color: Theme.subtext
                                font.pixelSize: 12
                                elide: Text.ElideRight
                            }
                            ChromeButton {
                                id: get
                                anchors.right: parent.right
                                anchors.verticalCenter: parent.verticalCenter
                                height: 30
                                text: block.busy === card.modelData.id ? qsTr("Installing…")
                                      : (card.modelData.installed ? qsTr("Apply") : qsTr("Install"))
                                filled: !card.modelData.installed
                                enabled: block.busy === ""
                                onClicked: block.install(card.modelData.repo + ":" + card.modelData.path, card.modelData.id)
                            }
                        }
                    }
                }
            }
        }

        Item { width: 1; height: 12 }

        SettingRow {
            title: qsTr("Install or publish from GitHub")
            subtitle: qsTr("Public repository with theme.json (Export current look) and preview.png in the root")
            iconName: "emblem-shared-symbolic"
            Row {
                spacing: 8
                QQC2.TextField {
                    id: repoField
                    width: 240
                    height: 36
                    placeholderText: "github.com/you/my-theme"
                    placeholderTextColor: Theme.subtext
                    color: Theme.text
                    font.pixelSize: 14
                    leftPadding: 14
                    selectByMouse: true
                    background: Rectangle {
                        radius: 18
                        color: Theme.field
                        border.width: repoField.activeFocus ? 2 : 0
                        border.color: Theme.accent
                    }
                }
                ChromeButton {
                    text: qsTr("Install")
                    enabled: repoField.text.trim() !== "" && block.busy === ""
                    onClicked: block.install(repoField.text.trim(), "link")
                }
                ChromeButton {
                    text: qsTr("Publish")
                    filled: true
                    enabled: repoField.text.trim() !== "" && block.busy === ""
                    onClicked: {
                        block.busy = "check"
                        block.say(qsTr("Checking the repository…"))
                        System.runAsync(["hypede-theme", "check", repoField.text.trim()], "store-check")
                    }
                }
            }
        }
        SettingRow {
            title: qsTr("Refresh the store")
            iconName: "view-refresh-symbolic"
            ChromeButton {
                text: block.loading ? qsTr("Loading…") : qsTr("Refresh")
                enabled: !block.loading
                onClicked: block.load()
            }
        }
        Item {
            visible: block.status !== ""
            width: parent.width
            height: statusText.implicitHeight + 20
            Text {
                id: statusText
                x: 20
                width: parent.width - 40
                anchors.verticalCenter: parent.verticalCenter
                text: block.status
                color: block.statusError ? Theme.danger : Theme.accent
                font.pixelSize: 13
                wrapMode: Text.Wrap
            }
        }
    }
}
