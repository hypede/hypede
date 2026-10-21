import QtQuick
import HypeSettings

// Несколько мониторов, как в Chrome OS: схема, на которой мониторы можно
// перетаскивать (при отпускании монитор прилипает к краю соседнего),
// «Дублировать» и выключение отдельных мониторов. Изменения применяются
// кнопкой «Применить», после неё GNOME Shell спрашивает, сохранить ли их.
Column {
    id: arrangement
    width: parent ? parent.width : 0

    // Мониторы на схеме: [{connector, name, x, y, width, height, enabled,
    // primary}], координаты — логические пиксели.
    property var items: []
    property bool mirror: false
    property bool dirty: false
    property string error: ""

    function reset() {
        const list = Displays.monitors.map(m => ({
            connector: m.connector, name: m.name, x: m.x, y: m.y,
            width: m.width, height: m.height, enabled: m.enabled, primary: m.primary
        }))
        // В «дублировании» все мониторы стоят в одной точке, а выключенные
        // нигде не стоят: для схемы ставим их справа от остальных.
        const placed = Displays.mirrored ? [] : list.filter(i => i.enabled)
        for (const item of list) {
            if (placed.includes(item))
                continue
            item.x = placed.length ? Math.max(...placed.map(p => p.x + p.width)) : 0
            item.y = placed.length ? Math.min(...placed.map(p => p.y)) : 0
            placed.push(item)
        }
        items = list
        mirror = Displays.mirrored
        dirty = false
        canvas.fit()
    }

    function overlaps(a, b) {
        return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    }
    // Касаются краем, и общий отрезок края не нулевой — так проверяет Mutter.
    function adjacent(a, b) {
        const sideBySide = (a.x === b.x + b.width || b.x === a.x + a.width)
                           && a.y < b.y + b.height && b.y < a.y + a.height
        const stacked = (a.y === b.y + b.height || b.y === a.y + a.height)
                        && a.x < b.x + b.width && b.x < a.x + a.width
        return sideBySide || stacked
    }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

    // Ближайшее к (x, y) место для item вплотную к одному из targets, где он
    // ни на кого не налезает. Общий край — не меньше near, чтобы между
    // мониторами можно было провести мышь; край, почти совпавший с краем
    // соседа, выравнивается по нему.
    function snapPosition(item, x, y, targets, all) {
        let best = null
        for (const t of targets) {
            const near = Math.min(item.width, item.height, t.width, t.height) / 8
            const alignY = v => {
                v = clamp(v, t.y - item.height + near, t.y + t.height - near)
                if (Math.abs(v - t.y) < near) return t.y
                if (Math.abs(v + item.height - t.y - t.height) < near) return t.y + t.height - item.height
                return v
            }
            const alignX = v => {
                v = clamp(v, t.x - item.width + near, t.x + t.width - near)
                if (Math.abs(v - t.x) < near) return t.x
                if (Math.abs(v + item.width - t.x - t.width) < near) return t.x + t.width - item.width
                return v
            }
            const candidates = [
                { x: t.x - item.width, y: alignY(y) }, { x: t.x + t.width, y: alignY(y) },
                { x: alignX(x), y: t.y - item.height }, { x: alignX(x), y: t.y + t.height }
            ]
            for (const c of candidates) {
                const moved = { x: Math.round(c.x), y: Math.round(c.y), width: item.width, height: item.height }
                if (all.some(o => o !== item && overlaps(moved, o)))
                    continue
                const d = Math.hypot(moved.x - x, moved.y - y)
                if (!best || d < best.d)
                    best = { x: moved.x, y: moved.y, d: d }
            }
        }
        return best
    }

    // Мониторы, которые оторвались от anchor и его соседей, подтягиваются к
    // ним: Mutter принимает только схему, где все стоят вплотную.
    function gather(on, anchor) {
        const group = [anchor]
        for (let guard = 0; guard < on.length * on.length; ++guard) {
            for (let grown = true; grown;) {
                grown = false
                for (const o of on) {
                    if (!group.includes(o) && group.some(g => adjacent(g, o))) {
                        group.push(o)
                        grown = true
                    }
                }
            }
            const next = on.find(o => !group.includes(o))
            if (!next)
                return
            const place = snapPosition(next, next.x, next.y, group, on)
            if (place) {
                next.x = place.x
                next.y = place.y
            } else {
                next.x = Math.max(...group.map(g => g.x + g.width))
                next.y = group.find(g => g.x + g.width === next.x).y
            }
        }
    }

    // Монитор отпустили в (x, y): ставим его вплотную к соседям.
    function drop(index, x, y) {
        const list = items.map(i => Object.assign({}, i))
        const on = list.filter(i => i.enabled)
        const item = list[index]
        const spot = snapPosition(item, x, y, on.filter(o => o !== item), on)
        if (spot) {
            item.x = spot.x
            item.y = spot.y
        }
        gather(on, item)
        items = list
        dirty = true
        canvas.fit()
    }

    function setEnabled(index, value) {
        const list = items.map(i => Object.assign({}, i))
        const item = list[index]
        item.enabled = value
        const on = list.filter(i => i.enabled)
        if (value && on.length > 1) {
            // Включённый монитор встаёт справа от остальных.
            const others = on.filter(o => o !== item)
            item.x = Math.max(...others.map(o => o.x + o.width))
            item.y = others.find(o => o.x + o.width === item.x).y
        } else if (!value && on.length) {
            // Выключенный мог держать соседей вместе.
            gather(on, on.find(o => o.primary) || on[0])
        }
        items = list
        dirty = true
        canvas.fit()
    }

    function apply() {
        error = ""
        if (Displays.applyLayout(items, mirror))
            dirty = false
    }

    Component.onCompleted: reset()
    Connections {
        target: Displays
        function onChanged() { arrangement.reset() }
        function onFailed(message) { arrangement.error = message }
    }

    SettingRow {
        title: qsTr("Multiple displays")
        subtitle: arrangement.mirror ? qsTr("All displays show the same picture")
                                     : qsTr("Drag the displays to match how they stand on your desk")
        showDivider: false
        ChromeCombo {
            width: 220
            options: [ { value: false, label: qsTr("Join displays") }, { value: true, label: qsTr("Mirror") } ]
            currentValue: arrangement.mirror
            onActivated: value => {
                arrangement.mirror = value
                arrangement.dirty = true
            }
        }
    }

    Item {
        id: canvas
        visible: !arrangement.mirror
        width: parent.width
        height: visible ? 220 : 0

        // Масштаб и сдвиг схемы пересчитываются только после отпускания,
        // чтобы во время перетаскивания схема не «плыла».
        property real factor: 0.1
        property real ox: 0
        property real oy: 0

        function fit() {
            const on = arrangement.items.filter(i => i.enabled)
            if (!on.length || width <= 0)
                return
            const left = Math.min(...on.map(i => i.x)), top = Math.min(...on.map(i => i.y))
            const right = Math.max(...on.map(i => i.x + i.width)), bottom = Math.max(...on.map(i => i.y + i.height))
            // Запас вокруг — чтобы монитор было куда тащить.
            const pad = Math.max(...on.map(i => Math.max(i.width, i.height))) * 0.35
            factor = Math.min((width - 40) / (right - left + 2 * pad), (height - 24) / (bottom - top + 2 * pad))
            ox = (width - (right - left) * factor) / 2 - left * factor
            oy = (height - (bottom - top) * factor) / 2 - top * factor
        }
        onWidthChanged: fit()

        Rectangle {
            anchors.fill: parent
            anchors.leftMargin: 20
            anchors.rightMargin: 20
            anchors.bottomMargin: 4
            radius: 12
            color: Theme.field
        }

        Repeater {
            model: arrangement.items
            delegate: Rectangle {
                id: screen
                required property var modelData
                required property int index
                visible: modelData.enabled
                x: canvas.ox + modelData.x * canvas.factor
                y: canvas.oy + modelData.y * canvas.factor
                width: modelData.width * canvas.factor
                height: modelData.height * canvas.factor
                radius: 6
                readonly property bool held: handle.drag.active || handle.containsMouse
                z: handle.drag.active ? 1 : 0
                color: modelData.primary ? Theme.accentContainer : Theme.surface
                border.width: held ? 2 : 1
                border.color: held ? Theme.accent : Theme.outline

                Column {
                    anchors.centerIn: parent
                    width: parent.width - 12
                    spacing: 2
                    Text {
                        width: parent.width
                        horizontalAlignment: Text.AlignHCenter
                        text: screen.modelData.name
                        color: screen.modelData.primary ? Theme.accentContainerText : Theme.text
                        font.pixelSize: 13
                        wrapMode: Text.Wrap
                        maximumLineCount: 2
                        elide: Text.ElideRight
                    }
                    Text {
                        width: parent.width
                        horizontalAlignment: Text.AlignHCenter
                        visible: screen.modelData.primary
                        text: qsTr("Main display")
                        color: Theme.accentContainerText
                        font.pixelSize: 11
                        elide: Text.ElideRight
                    }
                }

                MouseArea {
                    id: handle
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: pressed ? Qt.ClosedHandCursor : Qt.OpenHandCursor
                    drag.target: screen
                    drag.minimumX: -screen.width / 2
                    drag.maximumX: canvas.width - screen.width / 2
                    drag.minimumY: -screen.height / 2
                    drag.maximumY: canvas.height - screen.height / 2
                    onReleased: {
                        const x = (screen.x - canvas.ox) / canvas.factor
                        const y = (screen.y - canvas.oy) / canvas.factor
                        // Просто щелчок — ничего не двигаем.
                        if (Math.abs(x - screen.modelData.x) * canvas.factor > 1
                                || Math.abs(y - screen.modelData.y) * canvas.factor > 1)
                            arrangement.drop(screen.index, x, y)
                    }
                }
            }
        }
    }

    Repeater {
        model: arrangement.items
        delegate: SettingRow {
            required property var modelData
            required property int index
            title: qsTr("Use “%1”").arg(modelData.name)
            ChromeSwitch {
                checked: modelData.enabled
                onToggled: value => arrangement.setEnabled(index, value)
            }
        }
    }

    Text {
        visible: arrangement.error !== ""
        x: 20
        width: parent.width - 40
        topPadding: 8
        text: arrangement.error
        color: Theme.danger
        font.pixelSize: 13
        wrapMode: Text.Wrap
    }

    Item {
        visible: arrangement.dirty
        width: parent.width
        height: visible ? 60 : 0
        Row {
            anchors.right: parent.right
            anchors.rightMargin: 20
            anchors.verticalCenter: parent.verticalCenter
            spacing: 8
            ChromeButton {
                flat: true
                text: qsTr("Cancel")
                onClicked: arrangement.reset()
            }
            ChromeButton {
                filled: true
                text: qsTr("Apply")
                enabled: arrangement.items.some(i => i.enabled)
                onClicked: arrangement.apply()
            }
        }
    }
}
