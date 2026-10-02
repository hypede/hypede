import QtQuick
import QtQuick.Controls as QQC2
import HypeSettings

// Строка с полем ввода; значение сохраняется по Enter и при уходе из поля.
SettingRow {
    id: row
    property var settings
    property string key
    property string placeholder: ""
    readonly property bool available: settings !== null && settings.valid && settings.hasKey(key)
    readonly property string value: settings && settings.revision >= 0 && available ? settings.value(key) : ""

    QQC2.TextField {
        id: field
        width: 260
        height: 36
        text: row.value
        placeholderText: row.placeholder
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
        onEditingFinished: if (text !== row.value) row.settings.setValue(row.key, text)
    }
}
