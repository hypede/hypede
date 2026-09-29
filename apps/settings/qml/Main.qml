import QtQuick
import HypeSettings

// Окно «Настроек» целиком:
//
//   ┌───────────────────────────────────────────────────────────┐
//   │ ⚙ Настройки        [ 🔍 Поиск в настройках ]       – □ × │
//   ├──────────────┬────────────────────────────────────────────┤
//   │ ● Сеть       │  Сеть                                      │
//   │   Bluetooth  │  ┌──────────────────────────────────────┐  │
//   │   Устройство │  │ Wi‑Fi                          [on]  │  │
//   │   …          │  │ Соединения                        ›  │  │
//   └──────────────┴──┴──────────────────────────────────────┴──┘
Rectangle {
    id: root
    property string initialPage
    property string initialKcm

    property string currentPage: "network"
    // Открытый из строки модуль KDE (для разделов-модулей — пусто).
    property string openedKcm: ""
    property var pendingNavigation: null

    readonly property var page: Catalog.page(currentPage)
    readonly property string activeKcm: searching ? "" : (openedKcm || page.kcm || "")
    readonly property bool searching: titleBar.searchText.trim().length > 0

    color: Theme.window
    border.width: appWindow.frameless && !appWindow.maximized ? 1 : 0
    border.color: Theme.dark ? "#3c3d42" : "#d5dae3"

    Component.onCompleted: {
        if (initialPage)
            currentPage = Catalog.page(initialPage).id
        if (initialKcm)
            openKcm(initialKcm)
    }

    Connections {
        target: appWindow
        function onPageRequested(page, kcm) {
            titleBar.searchText = ""
            navigate(page || root.currentPage, kcm)
        }
    }

    // ----- переходы с проверкой несохранённых изменений модуля -----

    function navigate(pageId, kcm) {
        if (KcmHost.needsSave) {
            pendingNavigation = { page: pageId, kcm: kcm || "" }
            return
        }
        doNavigate(pageId, kcm)
    }

    function doNavigate(pageId, kcm) {
        currentPage = Catalog.page(pageId).id
        openedKcm = kcm || ""
        if (!activeKcm)
            KcmHost.close()
    }

    function openKcm(kcm) {
        navigate(currentPage, kcm)
    }

    function goBack() {
        navigate(currentPage, "")
    }

    // ----- раскладка -----

    TitleBar {
        id: titleBar
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        onSearchAccepted: results.activateFirst()
    }

    ListView {
        id: nav
        anchors.top: titleBar.bottom
        anchors.bottom: supportCard.top
        anchors.left: parent.left
        width: root.width > 960 ? Theme.navWidth : 232
        topMargin: 4
        spacing: 2
        clip: true
        model: Catalog.pages
        boundsBehavior: Flickable.StopAtBounds
        // Выделение — «пилюля», которая плавно переезжает к выбранному пункту.
        currentIndex: root.searching ? -1 : Catalog.pages.findIndex(p => p.id === root.currentPage)
        highlightFollowsCurrentItem: true
        highlightMoveDuration: 240
        highlightMoveVelocity: -1
        highlightResizeDuration: 0
        highlight: Rectangle {
            width: nav.width - 12
            radius: height / 2
            topLeftRadius: 0
            bottomLeftRadius: 0
            color: Theme.accentContainer
        }
        delegate: NavItem {
            required property var modelData
            width: ListView.view.width
            title: modelData.title
            iconName: modelData.icon
            selected: !root.searching && modelData.id === root.currentPage
            onClicked: {
                titleBar.searchText = ""
                root.navigate(modelData.id, "")
            }
        }
    }

    // Карточка «Support Me!» под меню разделов.
    SupportCard {
        id: supportCard
        anchors.left: parent.left
        anchors.bottom: parent.bottom
        anchors.bottomMargin: 8
        width: nav.width
    }

    Item {
        id: content
        anchors.top: titleBar.bottom
        anchors.bottom: parent.bottom
        anchors.left: nav.right
        anchors.right: parent.right

        // Страницы сменяют друг друга плавно: уходящая гаснет, новая
        // проявляется и чуть поднимается.
        PageView {
            readonly property bool shown: !root.searching && !root.activeKcm
            anchors.fill: parent
            opacity: shown ? 1 : 0
            visible: opacity > 0
            Behavior on opacity { NumberAnimation { duration: 180; easing.type: Easing.OutCubic } }
            page: root.page
            onOpenKcm: kcm => root.openKcm(kcm)
        }

        KcmView {
            readonly property bool shown: root.activeKcm !== ""
            anchors.fill: parent
            opacity: shown ? 1 : 0
            visible: shown || opacity > 0
            Behavior on opacity { NumberAnimation { duration: 180; easing.type: Easing.OutCubic } }
            kcm: root.activeKcm
            canGoBack: root.openedKcm !== ""
            obscured: root.pendingNavigation !== null
            onBack: root.goBack()
        }

        SearchResults {
            id: results
            readonly property bool shown: root.searching
            anchors.fill: parent
            opacity: shown ? 1 : 0
            visible: opacity > 0
            Behavior on opacity { NumberAnimation { duration: 150; easing.type: Easing.OutCubic } }
            query: titleBar.searchText
            onActivated: (page, kcm) => {
                titleBar.searchText = ""
                root.navigate(page, kcm)
            }
        }
    }

    Shortcut {
        sequences: [StandardKey.Find]
        onActivated: titleBar.focusSearch()
    }
    Shortcut {
        sequence: "Escape"
        enabled: root.searching
        onActivated: titleBar.searchText = ""
    }
    Shortcut {
        sequences: [StandardKey.Quit, "Ctrl+W"]
        onActivated: appWindow.closeWindow()
    }

    // ----- «Применить изменения?» при уходе со страницы модуля -----

    Rectangle {
        anchors.fill: parent
        opacity: root.pendingNavigation !== null ? 1 : 0
        visible: opacity > 0
        Behavior on opacity { NumberAnimation { duration: 160 } }
        color: Qt.rgba(0, 0, 0, 0.35)
        MouseArea { anchors.fill: parent }

        Rectangle {
            anchors.centerIn: parent
            scale: root.pendingNavigation !== null ? 1 : 0.92
            Behavior on scale { NumberAnimation { duration: 220; easing.type: Easing.OutBack } }
            width: 420
            height: dialogColumn.implicitHeight + 48
            radius: 24
            color: Theme.surface

            Column {
                id: dialogColumn
                x: 24; y: 24
                width: parent.width - 48
                spacing: 12
                Text {
                    width: parent.width
                    text: qsTr("Apply changes?")
                    color: Theme.text
                    font.pixelSize: 20
                }
                Text {
                    width: parent.width
                    text: qsTr("The settings of “%1” have been changed. Apply them or discard?").arg(KcmHost.title)
                    color: Theme.subtext
                    font.pixelSize: 14
                    wrapMode: Text.Wrap
                }
                Row {
                    anchors.right: parent.right
                    spacing: 8
                    topPadding: 12
                    ChromeButton {
                        text: qsTr("Cancel")
                        onClicked: root.pendingNavigation = null
                    }
                    ChromeButton {
                        text: qsTr("Discard")
                        danger: true
                        onClicked: {
                            const target = root.pendingNavigation
                            root.pendingNavigation = null
                            KcmHost.reset()
                            root.doNavigate(target.page, target.kcm)
                        }
                    }
                    ChromeButton {
                        text: qsTr("Apply")
                        filled: true
                        onClicked: {
                            const target = root.pendingNavigation
                            root.pendingNavigation = null
                            KcmHost.apply()
                            root.doNavigate(target.page, target.kcm)
                        }
                    }
                }
            }
        }
    }

    // ----- края окна без рамки: изменение размера -----

    Repeater {
        model: appWindow.frameless && !appWindow.maximized ? [
            { edges: Qt.LeftEdge, x: 0, y: 8, w: 6, h: -16, cursor: Qt.SizeHorCursor },
            { edges: Qt.RightEdge, x: -6, y: 8, w: 6, h: -16, cursor: Qt.SizeHorCursor },
            { edges: Qt.TopEdge, x: 8, y: 0, w: -16, h: 6, cursor: Qt.SizeVerCursor },
            { edges: Qt.BottomEdge, x: 8, y: -6, w: -16, h: 6, cursor: Qt.SizeVerCursor },
            { edges: Qt.TopEdge | Qt.LeftEdge, x: 0, y: 0, w: 10, h: 10, cursor: Qt.SizeFDiagCursor },
            { edges: Qt.TopEdge | Qt.RightEdge, x: -10, y: 0, w: 10, h: 10, cursor: Qt.SizeBDiagCursor },
            { edges: Qt.BottomEdge | Qt.LeftEdge, x: 0, y: -10, w: 10, h: 10, cursor: Qt.SizeBDiagCursor },
            { edges: Qt.BottomEdge | Qt.RightEdge, x: -10, y: -10, w: 10, h: 10, cursor: Qt.SizeFDiagCursor },
        ] : []
        delegate: MouseArea {
            required property var modelData
            x: modelData.x < 0 ? root.width + modelData.x : modelData.x
            y: modelData.y < 0 ? root.height + modelData.y : modelData.y
            width: modelData.w <= 0 ? root.width + modelData.w : modelData.w
            height: modelData.h <= 0 ? root.height + modelData.h : modelData.h
            cursorShape: modelData.cursor
            onPressed: appWindow.startResize(modelData.edges)
        }
    }
}
