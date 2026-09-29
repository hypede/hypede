// Лаунчер в духе Chrome OS: «пузырь» над левым углом полки.
//
// Сверху — строка поиска, под ней «Продолжить с того же места» (недавние
// файлы) и сетка всех приложений по алфавиту. Как только в строке появляется
// текст, сетка сменяется списком результатов: приложения, разделы настроек,
// недавние файлы, калькулятор и поиск в интернете.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {evaluate as calculate, looksLikeMath} from './calculator.js';
import {loadRecentFiles, describeWhen} from './recent.js';

const APP_ICON_SIZE = 48;
const RESULT_ICON_SIZE = 32;
const MAX_APP_RESULTS = 6;
const MAX_FILE_RESULTS = 4;
const MAX_SETTINGS_RESULTS = 3;
const MAX_CONTINUE_ITEMS = 4;

const SETTINGS_APP_ID = 'dev.hypede.Settings.desktop';
const FILES_APP_ID = 'dev.hypede.Files.desktop';

// Разделы «Настроек» HypeDE, которые можно найти прямо из лаунчера.
// id совпадает с аргументом hypede-settings --page.
const SETTINGS_PAGES = [
    {id: 'network', icon: 'network-wireless-symbolic',
        name: () => _('Network'), keywords: 'network wifi wi-fi ethernet vpn internet proxy сеть интернет'},
    {id: 'bluetooth', icon: 'bluetooth-active-symbolic',
        name: () => _('Bluetooth'), keywords: 'bluetooth headphones mouse наушники блютуз'},
    {id: 'devices', icon: 'input-mouse-symbolic',
        name: () => _('Device'), keywords: 'device mouse touchpad keyboard display sound printer устройство мышь клавиатура экран звук принтер'},
    {id: 'personalization', icon: 'preferences-desktop-wallpaper-symbolic',
        name: () => _('Personalization'), keywords: 'wallpaper theme dark light accent shelf обои тема тёмная светлая полка персонализация'},
    {id: 'privacy', icon: 'security-high-symbolic',
        name: () => _('Security and privacy'), keywords: 'privacy security lock screen firewall приватность безопасность блокировка'},
    {id: 'apps', icon: 'view-app-grid-symbolic',
        name: () => _('Apps'), keywords: 'apps default applications autostart flatpak приложения по умолчанию автозапуск'},
    {id: 'accessibility', icon: 'org.gnome.Settings-accessibility-symbolic',
        name: () => _('Accessibility'), keywords: 'accessibility zoom contrast screen reader большой текст контраст доступность'},
    {id: 'system', icon: 'preferences-system-symbolic',
        name: () => _('System preferences'), keywords: 'system date time language power users система дата время язык питание пользователи'},
    {id: 'about', icon: 'help-about-symbolic',
        name: () => _('About HypeDE'), keywords: 'about version system info о системе версия'},
];

function _normalize(text) {
    return text.toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

function _launchUri(uri) {
    try {
        Gio.AppInfo.launch_default_for_uri(uri,
            global.create_app_launch_context(0, -1));
    } catch (e) {
        Main.notifyError(_('Could not open'), e.message);
    }
}

function _spawnApp(appId, args) {
    const app = Shell.AppSystem.get_default().lookup_app(appId);
    const exe = app?.get_app_info()?.get_executable();
    Util.spawn([exe ?? appId.replace(/\.desktop$/, ''), ...args]);
}

// Одна плитка приложения в сетке.
const AppTile = GObject.registerClass(
class AppTile extends St.Button {
    _init(app, launcher) {
        super._init({
            style_class: 'hypede-launcher-app',
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
            accessible_name: app.get_name(),
        });
        this.app = app;
        this._launcher = launcher;

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(new St.Bin({
            style_class: 'hypede-launcher-app-icon',
            child: app.create_icon_texture(APP_ICON_SIZE),
            x_align: Clutter.ActorAlign.CENTER,
        }));
        const label = new St.Label({
            text: app.get_name(),
            style_class: 'hypede-launcher-app-label',
            x_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(label);
        this.set_child(box);

        this.connect('clicked', (_b, button) => this._activate(button));
        this.connect('popup-menu', () => this._popupMenu());
        _addSecondaryClick(this, () => this._popupMenu());
    }

    _activate(button) {
        const event = Clutter.get_current_event();
        const ctrl = event &&
            (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;
        if ((ctrl || button === Clutter.BUTTON_MIDDLE) &&
            this.app.can_open_new_window())
            this.app.open_new_window(-1);
        else
            this.app.activate();
        this._launcher.close();
    }

    _popupMenu() {
        this._launcher.showAppMenu(this, this.app);
    }
});

// Строка результата поиска: значок, заголовок и подпись.
const ResultRow = GObject.registerClass(
class ResultRow extends St.Button {
    _init({icon, gicon, iconName, title, subtitle, activate}) {
        super._init({
            style_class: 'hypede-launcher-result',
            can_focus: true,
            track_hover: true,
            x_expand: true,
            accessible_name: title,
        });
        this._activateFunc = activate;

        const box = new St.BoxLayout({style_class: 'hypede-launcher-result-box', x_expand: true});
        let iconActor = icon;
        if (!iconActor) {
            // Передаём только одно из gicon/icon_name: пустое icon_name
            // сбрасывает уже выставленный gicon.
            iconActor = new St.Icon({icon_size: RESULT_ICON_SIZE});
            if (gicon)
                iconActor.gicon = gicon;
            else
                iconActor.icon_name = iconName ?? 'system-search-symbolic';
        }
        box.add_child(new St.Bin({
            style_class: 'hypede-launcher-result-icon',
            child: iconActor,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const texts = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        const titleLabel = new St.Label({text: title, style_class: 'hypede-launcher-result-title'});
        titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        texts.add_child(titleLabel);
        if (subtitle) {
            const sub = new St.Label({text: subtitle, style_class: 'hypede-launcher-result-subtitle'});
            sub.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            texts.add_child(sub);
        }
        box.add_child(texts);
        this.set_child(box);

        this.connect('clicked', () => this.activate());
    }

    activate() {
        this._activateFunc();
    }
});

// Раздел выдачи с заголовком («Приложения», «Файлы»…).
function _section(title) {
    const box = new St.BoxLayout({
        style_class: 'hypede-launcher-section',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    if (title) {
        box.add_child(new St.Label({
            text: title,
            style_class: 'hypede-launcher-section-title',
        }));
    }
    return box;
}

function _addSecondaryClick(actor, callback) {
    // Clutter.ClickGesture есть с GNOME 48; на всякий случай оставлен и
    // запасной путь через событие нажатия.
    if (Clutter.ClickGesture) {
        const gesture = new Clutter.ClickGesture({
            required_button: Clutter.BUTTON_SECONDARY,
            recognize_on_press: true,
        });
        gesture.connect('recognize', () => callback());
        actor.add_action(gesture);
    } else {
        actor.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== Clutter.BUTTON_SECONDARY)
                return Clutter.EVENT_PROPAGATE;
            callback();
            return Clutter.EVENT_STOP;
        });
    }
}

// Содержимое пузыря лаунчера.
const LauncherView = GObject.registerClass(
class LauncherView extends St.BoxLayout {
    _init(launcher, settings) {
        super._init({
            style_class: 'hypede-launcher',
            orientation: Clutter.Orientation.VERTICAL,
        });
        this._launcher = launcher;
        this._settings = settings;
        this._appSystem = Shell.AppSystem.get_default();
        this._appsDirty = true;
        this._results = [];
        this._selected = -1;

        // Строка поиска
        this._entry = new St.Entry({
            style_class: 'hypede-launcher-search',
            hint_text: _('Search your device, apps, settings, web…'),
            can_focus: true,
            x_expand: true,
            primary_icon: new St.Icon({
                icon_name: 'system-search-symbolic',
                style_class: 'hypede-launcher-search-icon',
            }),
        });
        this._entry.clutter_text.connect('text-changed', () => this._onTextChanged());
        this._entry.clutter_text.connect('key-press-event', this._onEntryKeyPress.bind(this));
        this._entry.clutter_text.connect('activate', () => this._activateSelected());
        this.add_child(this._entry);

        // Домашняя страница: «Продолжить» + сетка приложений
        this._home = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._continueSection = _section(_('Continue where you left off'));
        this._continueGrid = new St.Widget({
            style_class: 'hypede-launcher-continue',
            layout_manager: new Clutter.GridLayout({
                column_homogeneous: true,
                column_spacing: 8,
                row_spacing: 8,
            }),
            x_expand: true,
        });
        this._continueSection.add_child(this._continueGrid);
        this._home.add_child(this._continueSection);

        this._separator = new St.Widget({style_class: 'hypede-launcher-separator', x_expand: true});
        this._home.add_child(this._separator);

        this._grid = new St.Widget({
            style_class: 'hypede-launcher-grid',
            layout_manager: new Clutter.GridLayout({column_homogeneous: true}),
            x_expand: true,
        });
        this._home.add_child(this._grid);

        this._homeScroll = new St.ScrollView({
            style_class: 'hypede-launcher-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
            child: this._home,
        });
        this.add_child(this._homeScroll);

        // Страница результатов поиска
        this._resultsBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._resultsScroll = new St.ScrollView({
            style_class: 'hypede-launcher-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
            child: this._resultsBox,
            visible: false,
        });
        this.add_child(this._resultsScroll);

        this._appSystem.connectObject('installed-changed',
            () => (this._appsDirty = true), this);
        this._settings.connectObject(
            'changed::launcher-columns', () => (this._appsDirty = true),
            'changed::launcher-hidden-apps', () => (this._appsDirty = true),
            this);
    }

    get entry() {
        return this._entry;
    }

    onOpen() {
        this._updateSize();
        if (this._appsDirty)
            this._rebuildGrid();
        this._rebuildContinue();
        this._homeScroll.vadjustment.value = 0;
    }

    onClosed() {
        this._entry.text = '';
    }

    focusEntry() {
        global.stage.set_key_focus(this._entry);
    }

    _updateSize() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        // Chrome OS держит пузырь не выше ~688 px и оставляет зазор сверху.
        const height = Math.min(688 * scale, workArea.height - 48 * scale);
        this.height = height;
    }

    // ---------- Сетка приложений ----------

    _isHidden(appId) {
        return this._settings.get_strv('launcher-hidden-apps').includes(appId);
    }

    _allApps() {
        const apps = [];
        const seen = new Set();
        for (const info of this._appSystem.get_installed()) {
            if (!info.should_show() || this._isHidden(info.get_id()))
                continue;
            const app = this._appSystem.lookup_app(info.get_id());
            if (!app || seen.has(app.get_id()))
                continue;
            seen.add(app.get_id());
            apps.push(app);
        }
        const collator = new Intl.Collator(undefined, {sensitivity: 'base', numeric: true});
        apps.sort((a, b) => collator.compare(a.get_name(), b.get_name()));
        return apps;
    }

    _rebuildGrid() {
        this._appsDirty = false;
        this._grid.destroy_all_children();
        const layout = this._grid.layout_manager;
        const columns = this._settings.get_int('launcher-columns');
        this._allApps().forEach((app, i) => {
            const tile = new AppTile(app, this._launcher);
            layout.attach(tile, i % columns, Math.floor(i / columns), 1, 1);
        });
    }

    // ---------- «Продолжить с того же места» ----------

    _rebuildContinue() {
        this._continueGrid.destroy_all_children();
        const show = this._settings.get_boolean('show-recent-files');
        const files = show ? loadRecentFiles(MAX_CONTINUE_ITEMS) : [];
        this._continueSection.visible = files.length > 0;
        this._separator.visible = files.length > 0;

        const layout = this._continueGrid.layout_manager;
        files.forEach((file, i) => {
            const chip = new St.Button({
                style_class: 'hypede-launcher-chip',
                can_focus: true,
                track_hover: true,
                x_expand: true,
                accessible_name: file.name,
            });
            const box = new St.BoxLayout({
                style_class: 'hypede-launcher-chip-box',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
            });
            box.add_child(new St.Icon({
                gicon: file.icon,
                icon_size: 20,
                style_class: 'hypede-launcher-chip-icon',
                y_align: Clutter.ActorAlign.CENTER,
            }));
            const texts = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const name = new St.Label({text: file.name, style_class: 'hypede-launcher-chip-title'});
            name.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
            texts.add_child(name);
            texts.add_child(new St.Label({
                text: describeWhen(file.when),
                style_class: 'hypede-launcher-chip-subtitle',
            }));
            box.add_child(texts);
            chip.set_child(box);
            chip.connect('clicked', () => {
                this._launcher.close();
                _launchUri(file.uri);
            });
            layout.attach(chip, i % 2, Math.floor(i / 2), 1, 1);
        });
    }

    // ---------- Поиск ----------

    _onTextChanged() {
        const text = this._entry.text.trim();
        const searching = text.length > 0;
        this._homeScroll.visible = !searching;
        this._resultsScroll.visible = searching;
        if (searching)
            this._search(text);
        else
            this._clearResults();
    }

    _clearResults() {
        this._resultsBox.destroy_all_children();
        this._results = [];
        this._selected = -1;
    }

    _search(text) {
        this._clearResults();
        const query = _normalize(text);

        // Калькулятор — самым первым, как в Chrome OS.
        if (looksLikeMath(text)) {
            const value = calculate(text);
            if (value !== null) {
                const section = _section(null);
                section.add_child(this._addResult({
                    iconName: 'accessories-calculator-symbolic',
                    title: `= ${value}`,
                    subtitle: _('Press Enter to copy the result'),
                    activate: () => {
                        St.Clipboard.get_default().set_text(
                            St.ClipboardType.CLIPBOARD, `${value}`);
                        this._launcher.close();
                    },
                }));
                this._resultsBox.add_child(section);
            }
        }

        // Приложения
        const apps = [];
        const seen = new Set();
        for (const group of Shell.AppSystem.search(text)) {
            for (const id of group) {
                const app = this._appSystem.lookup_app(id);
                if (!app || seen.has(id) || !app.get_app_info()?.should_show() || this._isHidden(id))
                    continue;
                seen.add(id);
                apps.push(app);
            }
        }
        if (apps.length > 0) {
            const section = _section(_('Apps'));
            apps.slice(0, MAX_APP_RESULTS).forEach(app => {
                section.add_child(this._addResult({
                    icon: app.create_icon_texture(RESULT_ICON_SIZE),
                    title: app.get_name(),
                    subtitle: app.get_description() ?? '',
                    activate: () => {
                        app.activate();
                        this._launcher.close();
                    },
                }));
            });
            this._resultsBox.add_child(section);
        }

        // Разделы настроек
        const settingsApp = this._appSystem.lookup_app(SETTINGS_APP_ID);
        if (settingsApp) {
            const pages = SETTINGS_PAGES.filter(page =>
                _normalize(`${page.name()} ${page.keywords}`).includes(query));
            if (pages.length > 0) {
                const section = _section(_('Settings'));
                pages.slice(0, MAX_SETTINGS_RESULTS).forEach(page => {
                    section.add_child(this._addResult({
                        iconName: page.icon,
                        title: page.name(),
                        subtitle: _('Settings'),
                        activate: () => {
                            this._launcher.close();
                            _spawnApp(SETTINGS_APP_ID, ['--page', page.id]);
                        },
                    }));
                });
                this._resultsBox.add_child(section);
            }
        }

        // Файлы: совпадения среди недавних и поиск в «Файлах»
        const recent = loadRecentFiles(200)
            .filter(file => _normalize(file.name).includes(query))
            .slice(0, MAX_FILE_RESULTS);
        const filesApp = this._appSystem.lookup_app(FILES_APP_ID);
        if (recent.length > 0 || filesApp) {
            const section = _section(_('Files'));
            recent.forEach(file => {
                section.add_child(this._addResult({
                    gicon: file.icon,
                    title: file.name,
                    subtitle: file.parentPath,
                    activate: () => {
                        this._launcher.close();
                        _launchUri(file.uri);
                    },
                }));
            });
            if (filesApp) {
                section.add_child(this._addResult({
                    gicon: filesApp.get_icon(),
                    title: _('Search for “%s” in Files').format(text),
                    subtitle: _('Search in the home folder'),
                    activate: () => {
                        this._launcher.close();
                        _spawnApp(FILES_APP_ID, ['--search', text]);
                    },
                }));
            }
            this._resultsBox.add_child(section);
        }

        // Интернет
        const webSection = _section(_('Web'));
        webSection.add_child(this._addResult({
            iconName: 'web-browser-symbolic',
            title: text,
            subtitle: _('Search the web'),
            activate: () => {
                this._launcher.close();
                const template = this._settings.get_string('web-search-url');
                _launchUri(template.replace('%s', encodeURIComponent(text)));
            },
        }));
        this._resultsBox.add_child(webSection);

        this._select(0);
    }

    _addResult(params) {
        const row = new ResultRow(params);
        this._results.push(row);
        return row;
    }

    _select(index) {
        if (this._results.length === 0) {
            this._selected = -1;
            return;
        }
        index = Math.max(0, Math.min(index, this._results.length - 1));
        this._results[this._selected]?.remove_style_pseudo_class('selected');
        this._selected = index;
        const row = this._results[index];
        row.add_style_pseudo_class('selected');

        // Прокрутить так, чтобы выбранная строка была видна.
        const adj = this._resultsScroll.vadjustment;
        const [, y] = row.get_transformed_position();
        const [, boxY] = this._resultsBox.get_transformed_position();
        const top = y - boxY;
        if (top < adj.value)
            adj.value = top;
        else if (top + row.height > adj.value + adj.page_size)
            adj.value = top + row.height - adj.page_size;
    }

    _activateSelected() {
        if (this._entry.text.trim().length === 0)
            return;
        this._results[this._selected]?.activate();
    }

    _onEntryKeyPress(_actor, event) {
        const symbol = event.get_key_symbol();
        const searching = this._entry.text.trim().length > 0;

        if (searching && symbol === Clutter.KEY_Down) {
            this._select(this._selected + 1);
            return Clutter.EVENT_STOP;
        }
        if (searching && symbol === Clutter.KEY_Up) {
            this._select(this._selected - 1);
            return Clutter.EVENT_STOP;
        }
        if (!searching && symbol === Clutter.KEY_Down) {
            // Из пустой строки стрелка вниз уводит фокус в сетку.
            const first = this._continueSection.visible
                ? this._continueGrid.get_first_child()
                : this._grid.get_first_child();
            first?.grab_key_focus();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }
});

// Кнопка-кольцо в левом углу полки. Её меню — это и есть пузырь лаунчера.
const LauncherButton = GObject.registerClass(
class LauncherButton extends PanelMenu.Button {
    _init(launcher, settings) {
        super._init(0.0, _('Launcher'), false);
        this._launcher = launcher;
        this.add_style_class_name('hypede-launcher-button');
        this.add_child(new St.Widget({
            style_class: 'hypede-launcher-ring',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        }));

        this.menu.actor.add_style_class_name('hypede-launcher-menu');
        this.menu._arrowSide = St.Side.BOTTOM;
        this.menu._boxPointer.updateArrowSide(St.Side.BOTTOM);
        this.menu._boxPointer.setSourceAlignment(0.0);

        this.view = new LauncherView(launcher, settings);
        this.menu.box.add_child(this.view);

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                // Пузырь привязан не к кнопке, а к левому краю всей полки:
                // так он стоит ровно над её углом, как в Chrome OS.
                this.menu._boxPointer.setPosition(Main.panel, 0.0);
                this.view.onOpen();
                // Фокус в строку поиска — после того, как меню заберёт ввод.
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this.view.focusEntry();
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                this.view.onClosed();
            }
        });
    }
});

export class Launcher {
    constructor(settings) {
        this._settings = settings;
        this._appMenuManager = null;

        this.button = new LauncherButton(this, settings);
        Main.panel.addToStatusArea('hypede-launcher', this.button, 0, 'left');

        // Лаунчер закрывается, как только появляется или меняется активное
        // окно — например, запущенное из меню значка.
        global.display.connectObject('notify::focus-window', () => {
            if (global.display.focus_window)
                this.close();
        }, this);
    }

    get isOpen() {
        return this.button.menu.isOpen;
    }

    open(initialText = '') {
        if (!this.button.menu.isOpen)
            this.button.menu.open();
        if (initialText) {
            this.button.view.entry.text = initialText;
            this.button.view.entry.clutter_text.set_cursor_position(-1);
        }
    }

    close() {
        this._appMenu?.close();
        if (this.button.menu.isOpen)
            this.button.menu.close();
    }

    toggle() {
        if (this.button.menu.isOpen)
            this.close();
        else
            this.open();
    }

    showAppMenu(sourceActor, app) {
        this._appMenu?.destroy();
        this._appMenu = new AppMenu(sourceActor, St.Side.TOP, {
            favoritesSection: true,
            showSingleWindows: true,
        });
        this._appMenu.setApp(app);
        Main.uiGroup.add_child(this._appMenu.actor);
        this._appMenuManager ??= new PopupMenu.PopupMenuManager(this.button.view);
        this._appMenuManager.addMenu(this._appMenu);
        this._appMenu.connect('menu-closed', () => sourceActor.grab_key_focus());
        this._appMenu.open(BoxPointer.PopupAnimation.FULL);
    }

    destroy() {
        global.display.disconnectObject(this);
        this._appMenu?.destroy();
        this._appMenu = null;
        this.button.destroy();
        this.button = null;
    }
}
