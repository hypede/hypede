import QtQuick
import HypeSettings

// Одна строка карточки. Вид выбирается по row.type (см. Catalog.qml).
Loader {
    id: loader
    property var row
    property bool first: false
    signal openKcm(string kcm)

    width: parent ? parent.width : 0
    visible: status === Loader.Ready && item && item.available !== false && conditionMet

    readonly property var settings: row.schema ? GSettingsHub.schema(row.schema) : null
    readonly property var watched: row.visibleWhen ? GSettingsHub.schema(row.visibleWhen.schema) : null
    readonly property bool conditionMet: !row.visibleWhen
        || (watched.revision >= 0 && watched.value(row.visibleWhen.key) === row.visibleWhen.value)

    sourceComponent: {
        switch (row.type) {
        case "toggle": return toggleRow
        case "strvToggle": return strvToggleRow
        case "slider": return sliderRow
        case "font": return fontRow
        case "themeList": return themeListRow
        case "note": return noteRow
        case "language": return languageRow
        case "displays": return displaysBlock
        case "storage": return storageBlock
        case "appList": return appListBlock
        case "autostart": return autostartBlock
        case "configActions": return configBlock
        case "assistant": return assistantBlock
        case "combo": return comboRow
        case "kcm": return kcmRow
        case "run": return runRow
        case "wifi": return wifiRow
        case "power": return powerRow
        case "ntp": return ntpRow
        case "timezone": return timezoneRow
        case "locale": return localeRow
        case "clearHistory": return clearHistoryRow
        case "searchEngine": return searchEngineRow
        case "wallpaper": return wallpaperBlock
        case "theme": return themeBlock
        case "accent": return accentBlock
        case "inputSources": return inputSourcesBlock
        case "about": return aboutBlock
        case "themes": return themesBlock
        case "color": return colorRow
        case "text": return textRow
        case "picture": return pictureRow
        }
        return null
    }

    function current() {
        return settings && settings.revision >= 0 ? settings.value(row.key) : undefined
    }

    Component {
        id: toggleRow
        SettingRow {
            readonly property bool available: loader.settings !== null && loader.settings.valid
                                              && loader.settings.hasKey(loader.row.key)
            title: loader.row.title
            subtitle: loader.row.subtitle || ""
            iconName: loader.row.icon || ""
            showDivider: !loader.first
            clickable: true
            chevron: false
            onClicked: sw.toggled(!sw.checked)
            ChromeSwitch {
                id: sw
                checked: loader.row.invert ? !loader.current() : !!loader.current()
                onToggled: value => loader.settings.setValue(loader.row.key, loader.row.invert ? !value : value)
            }
        }
    }

    Component {
        id: sliderRow
        SettingRow {
            readonly property bool available: loader.settings !== null && loader.settings.valid
                                              && loader.settings.hasKey(loader.row.key)
            title: loader.row.title
            iconName: loader.row.icon || ""
            showDivider: !loader.first
            subtitle: {
                const v = Number(loader.current())
                switch (loader.row.unit) {
                case "ms": return qsTr("%1 ms").arg(Math.round(v))
                case "K": return qsTr("%1 K").arg(Math.round(v))
                case "x": return qsTr("%1%").arg(Math.round(v * 100))
                case "%": return qsTr("%1%").arg(Math.round(v))
                case "px": return qsTr("%1 px").arg(Math.round(v))
                case "count": return String(Math.round(v))
                case "speed": return v === 1 ? qsTr("Normal") : qsTr("×%1").arg(v.toFixed(1))
                default: return loader.row.subtitle || ""
                }
            }
            ChromeSlider {
                width: 220
                from: loader.row.from
                to: loader.row.to
                stepSize: loader.row.step || 0
                // Для цветовой температуры «теплее» — вправо.
                value: loader.row.invertSlider ? loader.row.to + loader.row.from - Number(loader.current())
                                               : Number(loader.current())
                onMoved: v => {
                    const real = loader.row.invertSlider ? loader.row.to + loader.row.from - v : v
                    loader.settings.setValue(loader.row.key, loader.row.integer ? Math.round(real) : real)
                }
            }
        }
    }

    Component {
        id: comboRow
        SettingRow {
            readonly property bool available: loader.settings !== null && loader.settings.valid
                                              && loader.settings.hasKey(loader.row.key)
            title: loader.row.title
            subtitle: loader.row.subtitle || ""
            iconName: loader.row.icon || ""
            showDivider: !loader.first
            ChromeCombo {
                options: loader.row.options
                currentValue: loader.current()
                onActivated: value => loader.settings.setValue(loader.row.key, value)
            }
        }
    }

    Component {
        id: kcmRow
        SettingRow {
            readonly property bool installed: KcmHost.isAvailable(loader.row.kcm)
            title: loader.row.title
            subtitle: installed ? (loader.row.subtitle || "")
                                : qsTr("Not installed — install the “%1” package").arg(loader.row.package || loader.row.kcm)
            iconName: loader.row.icon || ""
            showDivider: !loader.first
            clickable: installed
            opacity: installed ? 1 : 0.6
            onClicked: loader.openKcm(loader.row.kcm)
        }
    }

    Component {
        id: runRow
        SettingRow {
            readonly property bool available: System.hasProgram(loader.row.program)
            title: loader.row.title
            subtitle: loader.row.subtitle || ""
            iconName: loader.row.icon || ""
            showDivider: !loader.first
            clickable: true
            external: true
            onClicked: System.run(loader.row.argv)
        }
    }

    Component {
        id: wifiRow
        SettingRow {
            readonly property bool available: System.wifiAvailable
            title: loader.row.title
            subtitle: System.wifiEnabled ? qsTr("On") : qsTr("Off")
            iconName: System.wifiEnabled ? "network-wireless-symbolic" : "network-wireless-disabled-symbolic"
            showDivider: !loader.first
            ChromeSwitch {
                checked: System.wifiEnabled
                onToggled: value => System.wifiEnabled = value
            }
        }
    }

    Component {
        id: powerRow
        SettingRow {
            readonly property bool available: System.powerProfilesAvailable
            title: loader.row.title
            subtitle: qsTr("Power profiles daemon")
            iconName: "power-profile-" + (System.powerProfile === "power-saver" ? "power-saver"
                      : System.powerProfile === "performance" ? "performance" : "balanced") + "-symbolic"
            showDivider: !loader.first
            ChromeCombo {
                readonly property var labels: ({ "performance": qsTr("Performance"),
                                                 "balanced": qsTr("Balanced"),
                                                 "power-saver": qsTr("Power saver") })
                options: System.powerProfiles.map(p => ({ value: p, label: labels[p] || p }))
                currentValue: System.powerProfile
                onActivated: value => System.powerProfile = value
            }
        }
    }

    Component {
        id: ntpRow
        SettingRow {
            readonly property bool available: System.ntpAvailable
            title: loader.row.title
            subtitle: qsTr("Uses network time servers")
            showDivider: !loader.first
            ChromeSwitch {
                checked: System.ntp
                onToggled: value => System.ntp = value
            }
        }
    }

    Component {
        id: timezoneRow
        SettingRow {
            title: loader.row.title
            iconName: loader.row.icon || ""
            subtitle: System.timezone.replace(/_/g, " ")
            showDivider: !loader.first
        }
    }

    Component {
        id: localeRow
        SettingRow {
            id: localeItem
            readonly property var locale: GSettingsHub.schema("org.gnome.system.locale")
            readonly property bool available: locale.valid
            title: loader.row.title
            iconName: loader.row.icon || ""
            subtitle: locale.revision >= 0 && locale.value("region")
                      ? System.formatSample(locale.value("region")) : qsTr("Same as the language")
            showDivider: !loader.first
            ChromeCombo {
                options: [{ value: "", label: qsTr("Same as the language") }].concat(
                    System.locales().map(code => ({ value: code, label: System.localeName(code) })))
                currentValue: localeItem.locale.revision >= 0 ? localeItem.locale.value("region") : ""
                onActivated: value => GSettingsHub.schema("org.gnome.system.locale").setValue("region", value)
            }
        }
    }

    Component {
        id: clearHistoryRow
        SettingRow {
            id: clearRow
            property bool done: false
            title: loader.row.title
            subtitle: done ? qsTr("History cleared") : qsTr("Removes the list shown in the launcher and apps")
            showDivider: !loader.first
            ChromeButton {
                text: qsTr("Clear")
                danger: true
                onClicked: clearRow.done = System.clearRecentFiles()
            }
        }
    }

    Component {
        id: searchEngineRow
        SettingRow {
            id: engineItem
            readonly property var shell: GSettingsHub.schema("dev.hypede.shell")
            readonly property bool available: shell.valid
            title: loader.row.title
            iconName: loader.row.icon || ""
            showDivider: !loader.first
            ChromeCombo {
                options: [
                    { value: "https://www.google.com/search?q=%s", label: "Google" },
                    { value: "https://duckduckgo.com/?q=%s", label: "DuckDuckGo" },
                    { value: "https://yandex.ru/search/?text=%s", label: "Яндекс" },
                    { value: "https://www.bing.com/search?q=%s", label: "Bing" },
                    { value: "https://www.startpage.com/do/search?q=%s", label: "Startpage" },
                ]
                currentValue: engineItem.shell.revision >= 0 ? engineItem.shell.value("web-search-url") : ""
                onActivated: value => GSettingsHub.schema("dev.hypede.shell").setValue("web-search-url", value)
            }
        }
    }


    // Есть ли элемент в списке строк (as). invert — включено, когда элемента нет.
    Component {
        id: strvToggleRow
        SettingRow {
            id: strvItem
            readonly property bool available: loader.settings !== null && loader.settings.valid
                                              && loader.settings.hasKey(loader.row.key)
            readonly property var list: loader.current() || []
            readonly property bool present: list.indexOf(loader.row.item) >= 0
            title: loader.row.title
            subtitle: loader.row.subtitle || ""
            iconName: loader.row.icon || ""
            showDivider: !loader.first
            clickable: true
            chevron: false
            onClicked: sw.toggled(!sw.checked)
            ChromeSwitch {
                id: sw
                checked: loader.row.invert ? !strvItem.present : strvItem.present
                onToggled: value => {
                    const want = loader.row.invert ? !value : value
                    let items = (loader.current() || []).filter(i => i !== loader.row.item)
                    if (want)
                        items.push(loader.row.item)
                    loader.settings.setValue(loader.row.key, items)
                }
            }
        }
    }

    // Шрифт в GSettings хранится строкой «Семейство Размер».
    Component {
        id: fontRow
        SettingRow {
            id: fontItem
            readonly property bool available: loader.settings !== null && loader.settings.valid
                                              && loader.settings.hasKey(loader.row.key)
            readonly property string value: String(loader.current() || "")
            readonly property string family: value.replace(/\s+[\d.]+$/, "")
            readonly property int size: Number((value.match(/([\d.]+)$/) || [0, 11])[1])
            title: loader.row.title
            subtitle: value
            iconName: loader.row.icon || ""
            showDivider: !loader.first
            function write(family, size) {
                loader.settings.setValue(loader.row.key, family + " " + size)
            }
            ChromeCombo {
                width: 200
                options: System.fontFamilies().map(f => ({ value: f, label: f }))
                currentValue: fontItem.family
                onActivated: value => fontItem.write(value, fontItem.size)
            }
            ChromeCombo {
                implicitWidth: 80
                options: [8, 9, 10, 10.5, 11, 12, 13, 14, 16, 18, 20].map(n => ({ value: n, label: String(n) }))
                currentValue: fontItem.size
                onActivated: value => fontItem.write(fontItem.family, value)
            }
        }
    }

    // Тема из установленных в системе (значки, курсоры, GTK 3).
    Component {
        id: themeListRow
        SettingRow {
            id: themeItem
            readonly property var themes: System[loader.row.source]()
            readonly property bool available: loader.settings !== null && loader.settings.valid
                                              && loader.settings.hasKey(loader.row.key) && themes.length > 0
            title: loader.row.title
            subtitle: loader.row.subtitle || ""
            iconName: loader.row.icon || ""
            showDivider: !loader.first
            ChromeCombo {
                width: 220
                options: themeItem.themes.map(t => ({ value: t, label: t }))
                currentValue: loader.current()
                onActivated: value => loader.settings.setValue(loader.row.key, value)
            }
        }
    }

    // Поясняющий текст внутри карточки.
    Component {
        id: noteRow
        Item {
            width: parent ? parent.width : 0
            implicitHeight: noteText.implicitHeight + 28
            Text {
                id: noteText
                x: 20
                width: parent.width - 40
                anchors.verticalCenter: parent.verticalCenter
                text: loader.row.title
                color: Theme.subtext
                font.pixelSize: 13
                wrapMode: Text.Wrap
            }
        }
    }

    // Язык интерфейса (AccountsService).
    Component {
        id: languageRow
        SettingRow {
            title: loader.row.title
            subtitle: loader.row.subtitle || ""
            iconName: loader.row.icon || ""
            showDivider: !loader.first
            ChromeCombo {
                width: 240
                options: System.locales().map(code => ({ value: code, label: System.localeName(code) }))
                currentValue: System.language
                onActivated: value => System.language = value
            }
        }
    }

    Component { id: displaysBlock; DisplaysBlock { showDivider: !loader.first } }
    Component { id: storageBlock; StorageBlock { showDivider: !loader.first } }
    Component { id: appListBlock; AppListBlock { mode: loader.row.mode; title: loader.row.title } }
    Component { id: autostartBlock; AutostartBlock {} }
    Component { id: configBlock; ConfigBlock {} }
    Component { id: assistantBlock; AssistantBlock {} }

    Component { id: wallpaperBlock; WallpaperGrid {} }
    Component { id: themesBlock; ThemesBlock {} }
    Component {
        id: colorRow
        ColorRow {
            settings: loader.settings
            presets: loader.row.presets || ["#202124", "#0b57d0", "#0f9d8f", "#d6337a", "#ff7a45", "#7c4dff", "#e8ecf4", "#fbe7f0"]
            key: loader.row.key
            title: loader.row.title
            subtitle: loader.row.subtitle || ""
            iconName: loader.row.icon || ""
            showDivider: !loader.first
        }
    }
    Component {
        id: textRow
        TextRow {
            settings: loader.settings
            key: loader.row.key
            title: loader.row.title
            subtitle: loader.row.subtitle || ""
            placeholder: loader.row.placeholder || ""
            iconName: loader.row.icon || ""
            showDivider: !loader.first
        }
    }
    Component {
        id: pictureRow
        PictureRow {
            settings: loader.settings
            key: loader.row.key
            title: loader.row.title
            iconName: loader.row.icon || ""
            showDivider: !loader.first
        }
    }
    Component { id: themeBlock; ThemePicker { showDivider: !loader.first } }
    Component { id: accentBlock; AccentPicker { showDivider: !loader.first } }
    Component { id: inputSourcesBlock; InputSources { showDivider: !loader.first } }
    Component { id: aboutBlock; AboutHeader {} }
}
