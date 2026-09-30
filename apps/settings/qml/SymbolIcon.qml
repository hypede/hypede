import QtQuick
import org.kde.kirigami as Kirigami
import HypeSettings

// Значок. Символьные (…-symbolic) берутся из темы HypeDE — Material Symbols,
// как в Chrome OS, — и перекрашиваются в цвет tint. Остальные — из темы
// значков системы.
Item {
    id: root
    property var source
    property string fallback: ""
    property color tint: Theme.subtext
    readonly property bool symbolic: typeof source === "string" && source.endsWith("-symbolic")

    implicitWidth: 20
    implicitHeight: 20

    Kirigami.Icon {
        anchors.fill: parent
        source: root.symbolic ? System.iconSource(root.source) : root.source
        fallback: root.fallback
        color: root.tint
        isMask: root.symbolic
        // Иначе Kirigami округлит 20 px до ближайшего стандартного 16.
        roundToIconSize: false
    }
}
