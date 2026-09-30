import QtQuick
import QtQuick.Controls as QQC2

// Тонкая полоса прокрутки поверх содержимого, как в Chrome OS: появляется
// при прокрутке или наведении и расширяется под указателем.
QQC2.ScrollBar {
    id: bar
    policy: QQC2.ScrollBar.AsNeeded
    padding: 2
    minimumSize: 0.08

    contentItem: Rectangle {
        implicitWidth: bar.hovered || bar.pressed ? 8 : 4
        implicitHeight: implicitWidth
        radius: width / 2
        color: Theme.text
        opacity: bar.pressed ? 0.45 : (bar.hovered ? 0.35 : (bar.active ? 0.25 : 0))
        Behavior on opacity { NumberAnimation { duration: Theme.normal } }
        Behavior on implicitWidth { NumberAnimation { duration: Theme.fast } }
    }
    background: Item {}
}
