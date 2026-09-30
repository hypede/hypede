import QtQuick
import HypeSettings

// ИИ-помощник: включение, выбор провайдера и вход в учётную запись.
//
// Помощник открывает сайт провайдера во встроенном браузере (приложение
// hypede-assistant), поэтому ключи API не нужны — вход в свою учётную запись
// прямо на сайте. После выбора провайдера сразу открывается его страница
// входа.
Item {
    id: block
    readonly property var settings: GSettingsHub.schema("dev.hypede.assistant")
    readonly property bool available: settings.valid
    readonly property bool installed: System.hasProgram("hypede-assistant")
    readonly property bool isOn: settings.revision >= 0 && settings.value("enabled") === true
    readonly property string provider: settings.revision >= 0 ? settings.value("provider") : "claude"

    // Те же провайдеры, что в apps/assistant/hypede_assistant/providers.py.
    readonly property var providers: [
        { id: "claude", name: "Claude", maker: "Anthropic", color: "#d97757" },
        { id: "gemini", name: "Gemini", maker: "Google", color: "#4285f4" },
        { id: "mistral", name: "Mistral", maker: "Mistral AI", color: "#fa520f" },
        { id: "chatgpt", name: "ChatGPT", maker: "OpenAI", color: "#10a37f" },
        { id: "grok", name: "Grok", maker: "xAI", color: "#3c3c3c" },
        { id: "deepseek", name: "DeepSeek", maker: "DeepSeek", color: "#4d6bfe" },
    ]
    readonly property string providerName: {
        for (const p of providers)
            if (p.id === provider)
                return p.name
        return "Claude"
    }

    width: parent ? parent.width : 0
    implicitHeight: column.implicitHeight
    height: implicitHeight

    function signIn() {
        System.run(["hypede-assistant", "--login"])
    }

    Column {
        id: column
        width: parent.width

        SettingRow {
            title: qsTr("AI assistant")
            subtitle: block.installed
                      ? qsTr("Adds “Ask” buttons to the launcher, Files and Settings")
                      : qsTr("Not installed — install the “webkitgtk-6.0” package")
            showDivider: false
            clickable: block.installed
            chevron: false
            onClicked: sw.toggled(!sw.checked)
            ChromeSwitch {
                id: sw
                enabled: block.installed
                checked: block.isOn
                onToggled: value => block.settings.setValue("enabled", value)
            }
        }

        // Выбор провайдера: шесть карточек в две-три колонки.
        Item {
            visible: block.isOn
            width: parent.width
            height: visible ? grid.height + 24 : 0

            Grid {
                id: grid
                x: 20
                y: 8
                width: parent.width - 40
                columns: width > 520 ? 3 : 2
                spacing: 10

                Repeater {
                    model: block.providers
                    delegate: Rectangle {
                        id: card
                        required property var modelData
                        readonly property bool current: modelData.id === block.provider
                        width: (grid.width - (grid.columns - 1) * grid.spacing) / grid.columns
                        height: 64
                        radius: 14
                        color: current ? Theme.accentContainer : (cardMouse.containsMouse ? Theme.fieldHover : Theme.field)
                        border.width: current ? 2 : 0
                        border.color: Theme.accent
                        Behavior on color { ColorAnimation { duration: Theme.fast } }

                        Rectangle {
                            id: logo
                            width: 36; height: 36; radius: 18
                            x: 14
                            anchors.verticalCenter: parent.verticalCenter
                            color: card.modelData.color
                            Text {
                                anchors.centerIn: parent
                                text: card.modelData.name.charAt(0)
                                color: "white"
                                font.pixelSize: 17
                                font.weight: Font.DemiBold
                            }
                        }
                        Column {
                            anchors.left: logo.right
                            anchors.leftMargin: 12
                            anchors.right: parent.right
                            anchors.rightMargin: 10
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 1
                            Text {
                                width: parent.width
                                text: card.modelData.name
                                color: card.current ? Theme.accentContainerText : Theme.text
                                font.pixelSize: 14
                                font.weight: Font.Medium
                                elide: Text.ElideRight
                            }
                            Text {
                                width: parent.width
                                text: card.modelData.maker
                                color: card.current ? Theme.accentContainerText : Theme.subtext
                                font.pixelSize: 12
                                elide: Text.ElideRight
                            }
                        }
                        MouseArea {
                            id: cardMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: {
                                const changed = card.modelData.id !== block.provider
                                block.settings.setValue("provider", card.modelData.id)
                                // Новый провайдер — сразу его страница входа.
                                if (changed)
                                    block.signIn()
                            }
                        }
                    }
                }
            }
        }

        SettingRow {
            visible: block.isOn
            title: qsTr("Sign in to %1").arg(block.providerName)
            subtitle: qsTr("Use your own account on the provider's website. HypeDE does not see your password.")
            ChromeButton {
                text: qsTr("Sign in")
                onClicked: block.signIn()
            }
        }
        SettingRow {
            visible: block.isOn
            title: qsTr("Open the assistant")
            subtitle: qsTr("A panel on the right side of the screen")
            clickable: true
            onClicked: System.run(["hypede-assistant"])
        }
        SettingRow {
            visible: block.isOn
            title: qsTr("What the assistant can do")
            subtitle: qsTr("Only chat. It cannot run commands or read your files: it sees just the text and files you send with an “Ask” button.")
        }
    }
}
