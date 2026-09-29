import QtQuick
import org.kde.kirigami as Kirigami

// Значок из темы; символические значки перекрашиваются в цвет текста.
Kirigami.Icon {
    property color tint: Theme.subtext
    implicitWidth: 20
    implicitHeight: 20
    color: tint
    isMask: typeof source === "string" && source.endsWith("-symbolic")
}
