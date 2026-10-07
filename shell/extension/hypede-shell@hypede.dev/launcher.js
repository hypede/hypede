// Лаунчер в духе Chrome OS.
//
// Два вида: «пузырь» у угла полки (как в новых Chrome OS) и полноэкранный
// (как в старых). Сверху — строка поиска, под ней «Продолжить с того же
// места» (недавние файлы) и сетка приложений. Как только в строке появляется
// текст, сетка сменяется результатами: калькулятор, приложения, разделы
// настроек, файлы, поиск в интернете — что именно и в каком порядке,
// выбирается в настройках.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {evaluate as calculate, looksLikeMath} from './calculator.js';
import {loadRecentFiles, describeWhen} from './recent.js';
import {getFileIndex, destroyFileIndex, normalize as normalizeName} from './filesearch.js';
import {addSecondaryClick} from './util.js';
import {getAssistant} from './assistant.js';
import {findActions} from './actions.js';
import {Backdrop} from './backdrop.js';

const RESULT_ICON_SIZE = 32;
const MAX_APP_RESULTS = 6;
const MAX_FILE_RESULTS = 5;
const MAX_SETTINGS_RESULTS = 3;
const MAX_CONTINUE_ITEMS = 4;
const BUBBLE_MAX_HEIGHT = 688;

const SETTINGS_APP_ID = 'dev.hypede.Settings.desktop';
const FILES_APP_ID = 'dev.hypede.Files.desktop';

const MENU_SIDE = {
    bottom: St.Side.BOTTOM,
    top: St.Side.TOP,
    left: St.Side.LEFT,
    right: St.Side.RIGHT,
};

// Разделы «Настроек» HypeDE, которые можно найти прямо из лаунчера.
// id совпадает с аргументом hypede-settings --page.
const SETTINGS_PAGES = [
    {id: 'network', icon: 'network-wireless-symbolic',
        name: () => _('Network'), keywords: 'network wifi wi-fi ethernet vpn internet proxy сеть интернет'},
    {id: 'bluetooth', icon: 'bluetooth-active-symbolic',
        name: () => _('Bluetooth'), keywords: 'bluetooth headphones mouse наушники блютуз'},
    {id: 'devices', icon: 'input-mouse-symbolic',
        name: () => _('Device'), keywords: 'device mouse touchpad keyboard display monitor resolution scale sound printer устройство мышь клавиатура экран монитор разрешение масштаб звук принтер'},
    {id: 'personalization', icon: 'preferences-desktop-wallpaper-symbolic',
        name: () => _('Personalization'), keywords: 'wallpaper theme dark light accent font icons cursor обои тема тёмная светлая акцент шрифт значки курсор персонализация'},
    {id: 'shelf', icon: 'view-app-grid-symbolic',
        name: () => _('Shelf and launcher'), keywords: 'shelf panel taskbar dock launcher position autohide полка панель задач лаунчер положение скрывать'},
    {id: 'lockscreen', icon: 'system-lock-screen-symbolic',
        name: () => _('Lock screen'), keywords: 'lock screen clock password блокировка экран часы пароль'},
    {id: 'privacy', icon: 'security-high-symbolic',
        name: () => _('Security and privacy'), keywords: 'privacy security lock screen firewall приватность безопасность блокировка'},
    {id: 'apps', icon: 'view-app-grid-symbolic',
        name: () => _('Apps'), keywords: 'apps default applications autostart flatpak notifications приложения по умолчанию автозапуск уведомления'},
    {id: 'assistant', icon: 'hypede-assistant-symbolic',
        name: () => _('AI assistant'), keywords: 'ai assistant chat claude gemini chatgpt mistral grok deepseek ии помощник нейросеть'},
    {id: 'accessibility', icon: 'org.gnome.Settings-accessibility-symbolic',
        name: () => _('Accessibility'), keywords: 'accessibility zoom contrast screen reader большой текст контраст доступность'},
    {id: 'system', icon: 'preferences-system-symbolic',
        name: () => _('System preferences'), keywords: 'system date time language power users storage services startup система дата время язык питание пользователи хранилище службы автозапуск'},
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

// Одна плитка приложения в сетке. Плитку можно перетащить на полку —
// приложение закрепится.
const AppTile = GObject.registerClass(
class AppTile extends St.Button {
    _init(app, launcher, iconSize, showLabel) {
        super._init({
            style_class: 'hypede-launcher-app',
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
            accessible_name: app.get_name(),
        });
        this.app = app;
        this._launcher = launcher;
        this._iconSize = iconSize;
        this._delegate = this;

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._icon = new St.Bin({
            style_class: 'hypede-launcher-app-icon',
            child: app.create_icon_texture(iconSize),
            x_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._icon);
        if (showLabel) {
            const label = new St.Label({
                text: app.get_name(),
                style_class: 'hypede-launcher-app-label',
                x_align: Clutter.ActorAlign.CENTER,
            });
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            box.add_child(label);
        } else {
            this.add_style_class_name('no-label');
        }
        this.set_child(box);

        this._draggable = DND.makeDraggable(this, {timeoutThreshold: 200});
        this._draggable.connect('drag-begin', () => this._launcher.close());

        this.connect('clicked', (_b, button) => this._activate(button));
        this.connect('popup-menu', () => this._popupMenu());
        addSecondaryClick(this, () => this._popupMenu());
    }

    getDragActor() {
        return this.app.create_icon_texture(this._iconSize);
    }

    getDragActorSource() {
        return this._icon;
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

// Содержимое лаунчера.
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
        this._fullscreen = false;

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
        // Кнопка ИИ-помощника справа в строке поиска — если он включён.
        this._askIcon = new St.Icon({
            icon_name: 'hypede-assistant-symbolic',
            style_class: 'hypede-launcher-ask',
            reactive: true,
            track_hover: true,
        });
        this._entry.connect('secondary-icon-clicked', () => this._ask(this._entry.text));
        this._syncAssistant();
        this._entry.clutter_text.connect('text-changed', () => this._onTextChanged());
        this._entry.clutter_text.connect('key-press-event', this._onEntryKeyPress.bind(this));
        this._entry.clutter_text.connect('activate', () => this._activateSelected());
        this._entryBin = new St.Bin({
            style_class: 'hypede-launcher-search-bin',
            child: this._entry,
            x_expand: true,
        });
        this.add_child(this._entryBin);

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
            () => this._markDirty(), this);
        for (const key of ['launcher-columns', 'launcher-hidden-apps', 'launcher-icon-size',
            'launcher-show-labels', 'launcher-sort', 'launcher-style'])
            this._settings.connectObject(`changed::${key}`, () => this._markDirty(), this);
        this.connect('destroy', () => {
            for (const id of [this._warmId, this._gridChunkId])
                if (id)
                    GLib.source_remove(id);
        });
        this._warmLater(3);
    }

    get entry() {
        return this._entry;
    }

    onOpen() {
        this._fullscreen = this._settings.get_string('launcher-style') === 'fullscreen';
        if (this._fullscreen)
            this.add_style_class_name('fullscreen');
        else
            this.remove_style_class_name('fullscreen');

        this._updateSize();
        if (this._appsDirty || this._layoutFullscreen !== this._fullscreen || this._orderChanged())
            this._rebuildGrid();
        if (this._recentChanged())
            this._rebuildContinue();
        this._layoutForStyle();
        this._homeScroll.vadjustment.value = 0;
        this._animateIn();
    }

    _markDirty() {
        this._appsDirty = true;
        this._warmLater();
    }

    // Сетку собираем заранее, в простое, — чтобы открытие было мгновенным.
    _warmLater(delay = 2) {
        if (this._warmId)
            return;
        this._warmId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, delay, () => {
            this._warmId = 0;
            if (this._appsDirty)
                this._rebuildGrid();
            if (this._recentChanged())
                this._rebuildContinue();
            return GLib.SOURCE_REMOVE;
        });
    }

    _orderChanged() {
        if (this._settings.get_string('launcher-sort') !== 'usage')
            return false;
        return this._allApps().map(a => a.get_id()).join() !== this._gridOrder;
    }

    _recentChanged() {
        const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']));
        let stamp = 'none';
        try {
            stamp = String(file.query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null).get_modification_date_time().to_unix());
        } catch {}
        stamp += `:${this._settings.get_boolean('show-recent-files')}:${this._fullscreen}`;
        if (stamp === this._recentStamp)
            return false;
        this._recentStamp = stamp;
        return true;
    }

    onClosed() {
        this._entry.text = '';
    }

    // В полноэкранном виде строка поиска и сетка стоят по центру экрана.
    _layoutForStyle() {
        const full = this._fullscreen;
        this._layoutFullscreen = full;
        const align = full ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL;
        this._entry.x_expand = !full;
        this._entry.x_align = align;
        this._home.x_expand = !full;
        this._home.x_align = align;
        this._resultsBox.x_expand = !full;
        this._resultsBox.x_align = align;
        if (full) {
            const [, gridWidth] = this._grid.get_preferred_width(-1);
            this._continueGrid.width = gridWidth;
            this._resultsBox.width = Math.max(gridWidth, 600);
        } else {
            this._continueGrid.width = -1;
            this._resultsBox.width = -1;
        }
    }

    focusEntry() {
        global.stage.set_key_focus(this._entry);
    }

    // «Спросить Claude»: подпись и видимость — по настройкам помощника.
    _syncAssistant() {
        const assistant = getAssistant();
        const enabled = !!assistant?.enabled;
        this._entry.secondary_icon = enabled ? this._askIcon : null;
        if (enabled)
            this._askIcon.accessible_name = _('Ask %s').format(assistant.providerName);
    }

    _ask(text) {
        this._launcher.close();
        getAssistant()?.ask(text.trim());
    }

    // Появление вместе с пузырём: содержимое видно сразу и только чуть
    // поднимается — без пустого кадра и «волны» плиток. Полноэкранный
    // лаунчер выезжает снизу, как в Chrome OS.
    _animateIn() {
        const rise = this._fullscreen ? 40 : 24;
        for (const actor of [this._entryBin, this._homeScroll, this._resultsScroll]) {
            actor.remove_all_transitions();
            actor.opacity = 255;
        }
        this.remove_all_transitions();
        this.set_pivot_point(this._fullscreen ? 0.5 : 0.0, this._fullscreen ? 0.5 : 1.0);
        this.opacity = 0;
        this.translation_y = rise;
        this.set_scale(this._fullscreen ? 1.03 : 0.92, this._fullscreen ? 1.03 : 0.92);
        if (this._gesture)
            return;
        // Старт — после первого кадра: первая раскладка меню бывает долгой,
        // и анимация, начатая до неё, успела бы пройти незаметно.
        if (this._paintId)
            global.stage.disconnect(this._paintId);
        this._paintId = global.stage.connect('after-paint', () => {
            global.stage.disconnect(this._paintId);
            this._paintId = 0;
            const duration = this._fullscreen ? 320 : 260;
            this.ease({opacity: 255, duration: duration * 0.7, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            this.ease({translation_y: 0, scale_x: 1, scale_y: 1, duration, mode: Clutter.AnimationMode.EASE_OUT_QUINT});
        });
    }

    // Жест тачпада: лаунчер идёт за пальцами, p от 0 до 1.
    gestureProgress(p) {
        const rise = this._fullscreen ? 40 : 24;
        const from = this._fullscreen ? 1.03 : 0.92;
        p = Math.min(1, Math.max(0, p));
        this.opacity = Math.round(255 * Math.min(1, p * 1.4));
        this.translation_y = rise * (1 - p);
        this.set_scale(from + (1 - from) * p, from + (1 - from) * p);
    }

    gestureEnd(open, onClosed) {
        this._gesture = false;
        const duration = 220;
        const mode = Clutter.AnimationMode.EASE_OUT_CUBIC;
        if (open) {
            this.ease({opacity: 255, translation_y: 0, scale_x: 1, scale_y: 1, duration, mode});
            return;
        }
        this.ease({opacity: 0, duration, mode, onStopped: onClosed});
    }

    _updateSize() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        if (this._fullscreen) {
            // На весь рабочий стол, кроме полки.
            this.set_size(workArea.width, workArea.height);
        } else {
            // Chrome OS держит пузырь не выше ~688 px и оставляет зазор сверху.
            this.set_width(-1);
            this.height = Math.min(BUBBLE_MAX_HEIGHT * scale, workArea.height - 48 * scale);
        }
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
        // Intl.Collator создаётся долго (загрузка локали) — один на класс,
        // а не новый при каждой перестройке сетки приложений.
        LauncherView._collator ??= new Intl.Collator(undefined, {sensitivity: 'base', numeric: true});
        const byName = (a, b) => LauncherView._collator.compare(a.get_name(), b.get_name());
        if (this._settings.get_string('launcher-sort') === 'usage') {
            const usage = Shell.AppUsage.get_default();
            apps.sort((a, b) => usage.compare(a.get_id(), b.get_id()) || byName(a, b));
        } else {
            apps.sort(byName);
        }
        return apps;
    }

    _columns() {
        const columns = this._settings.get_int('launcher-columns');
        if (!this._fullscreen)
            return columns;
        // В полноэкранном виде — столько колонок, сколько поместится.
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const tile = (this._settings.get_int('launcher-icon-size') + 80) * scale;
        const fit = Math.floor((this.width * 0.8) / tile);
        return Math.max(columns, Math.min(fit, 10));
    }

    // Первые ряды — сразу, остальное — порциями в простое: так открытие
    // не замирает даже при сотнях приложений.
    _rebuildGrid() {
        this._appsDirty = false;
        if (this._gridChunkId)
            GLib.source_remove(this._gridChunkId);
        this._gridChunkId = 0;
        this._grid.destroy_all_children();
        const layout = this._grid.layout_manager;
        const columns = this._columns();
        const iconSize = this._settings.get_int('launcher-icon-size');
        const showLabels = this._settings.get_boolean('launcher-show-labels');
        const apps = this._allApps();
        this._gridOrder = apps.map(a => a.get_id()).join();
        let i = 0;
        const add = count => {
            for (const end = Math.min(apps.length, i + count); i < end; i++)
                layout.attach(new AppTile(apps[i], this._launcher, iconSize, showLabels), i % columns, Math.floor(i / columns), 1, 1);
            return i < apps.length;
        };
        add(columns * 4);
        if (i < apps.length) {
            this._gridChunkId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
                if (add(columns * 2))
                    return GLib.SOURCE_CONTINUE;
                this._gridChunkId = 0;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    // ---------- «Продолжить с того же места» ----------

    _rebuildContinue() {
        this._continueGrid.destroy_all_children();
        const show = this._settings.get_boolean('show-recent-files');
        const files = show ? loadRecentFiles(MAX_CONTINUE_ITEMS) : [];
        this._continueSection.visible = files.length > 0;
        this._separator.visible = files.length > 0;

        const layout = this._continueGrid.layout_manager;
        const perRow = this._fullscreen ? 4 : 2;
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
            layout.attach(chip, i % perRow, Math.floor(i / perRow), 1, 1);
        });
    }

    // ---------- Поиск ----------

    _onTextChanged() {
        const text = this._entry.text.trim();
        const searching = text.length > 0;
        const wasSearching = this._resultsScroll.visible;
        this._homeScroll.visible = !searching;
        this._resultsScroll.visible = searching;
        if (searching)
            this._search(text);
        else
            this._clearResults();

        // Смена страницы — лёгкий «наплыв».
        if (searching !== wasSearching) {
            const page = searching ? this._resultsScroll : this._homeScroll;
            page.opacity = 0;
            page.ease({opacity: 255, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    _clearResults() {
        this._resultsBox.destroy_all_children();
        this._results = [];
        this._selected = -1;
    }

    _search(text) {
        this._clearResults();
        const providers = this._settings.get_strv('launcher-search-providers');
        providers.unshift('actions');
        providers.push('assistant');
        const sections = new Map();
        for (const provider of providers) {
            const section = this[`_search_${provider}`]?.(text, _normalize(text));
            if (section)
                sections.set(provider, section);
        }
        // Если ни приложений, ни разделов настроек, ни файлов не нашлось,
        // поиск в интернете поднимается наверх: тогда Enter ищет в
        // интернете, а не открывает «Файлы».
        let order = [...sections.keys()];
        if (sections.has('web') && !sections.has('apps') && !sections.has('settings') &&
            !sections.get('files')?._matches)
            order = ['actions', 'calculator', 'web', ...order.filter(p => !['actions', 'calculator', 'web'].includes(p))];

        this._results = [];
        for (const provider of order) {
            const section = sections.get(provider);
            if (!section)
                continue;
            this._resultsBox.add_child(section);
            // Порядок строк для стрелок и Enter — как на экране.
            this._results.push(...section.get_children().filter(c => c instanceof ResultRow));
        }
        this._select(0);
    }

    _search_actions(text) {
        const actions = findActions(text);
        if (actions.length === 0)
            return null;
        const section = _section(_('Actions'));
        for (const action of actions) {
            section.add_child(this._addResult({...action, activate: () => {
                this._launcher.close();
                action.activate();
            }}));
        }
        return section;
    }

    // Калькулятор — первым, как в Chrome OS.
    _search_calculator(text) {
        if (!looksLikeMath(text))
            return null;
        const value = calculate(text);
        if (value === null)
            return null;
        const section = _section(null);
        section.add_child(this._addResult({
            iconName: 'accessories-calculator-symbolic',
            title: `= ${value}`,
            subtitle: _('Press Enter to copy the result'),
            activate: () => {
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, `${value}`);
                this._launcher.close();
            },
        }));
        return section;
    }

    // Вопрос ИИ-помощнику — последней строкой: Enter по-прежнему открывает
    // найденное или ищет в интернете.
    _search_assistant(text) {
        const assistant = getAssistant();
        if (!assistant?.enabled)
            return null;
        const section = _section(null);
        section.add_child(this._addResult({
            iconName: 'hypede-assistant-symbolic',
            title: text,
            subtitle: _('Ask %s').format(assistant.providerName),
            activate: () => this._ask(text),
        }));
        return section;
    }

    _search_apps(text) {
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
        if (apps.length === 0)
            return null;
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
        return section;
    }

    _search_settings(_text, query) {
        if (!this._appSystem.lookup_app(SETTINGS_APP_ID))
            return null;
        const pages = SETTINGS_PAGES.filter(page =>
            _normalize(`${page.name()} ${page.keywords}`).includes(query));
        if (pages.length === 0)
            return null;
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
        return section;
    }

    // Файлы: недавние и найденные в домашней папке, плюс поиск в «Файлах».
    _search_files(text, query) {
        const seen = new Set();
        const found = [];
        for (const file of loadRecentFiles(200)) {
            if (found.length >= MAX_FILE_RESULTS)
                break;
            if (normalizeName(file.name).includes(query) && !seen.has(file.path)) {
                seen.add(file.path);
                found.push({path: file.path, name: file.name, parent: file.parentPath, gicon: file.icon});
            }
        }
        for (const {path, isDir} of getFileIndex().search(query, MAX_FILE_RESULTS * 2)) {
            if (found.length >= MAX_FILE_RESULTS)
                break;
            if (seen.has(path))
                continue;
            seen.add(path);
            const name = GLib.path_get_basename(path);
            const type = isDir ? 'inode/directory' : Gio.content_type_guess(name, null)[0];
            found.push({path, name, parent: GLib.path_get_dirname(path),
                gicon: Gio.content_type_get_symbolic_icon(type)});
        }

        const filesApp = this._appSystem.lookup_app(FILES_APP_ID);
        if (found.length === 0 && !filesApp)
            return null;
        const home = GLib.get_home_dir();
        const section = _section(_('Files'));
        section._matches = found.length;
        for (const file of found) {
            const parent = file.parent === home ? '~'
                : file.parent.startsWith(`${home}/`) ? `~${file.parent.slice(home.length)}` : file.parent;
            section.add_child(this._addResult({
                gicon: file.gicon,
                title: file.name,
                subtitle: parent,
                activate: () => {
                    this._launcher.close();
                    _launchUri(Gio.File.new_for_path(file.path).get_uri());
                },
            }));
        }
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
        return section;
    }

    _search_web(text) {
        const template = this._settings.get_string('web-search-url');
        const url = template.replace('%s', encodeURIComponent(text));
        const browser = Gio.AppInfo.get_default_for_uri_scheme('https');
        // «Google», «Duckduckgo», «Yandex» — из адреса поисковика.
        let engine = '';
        try {
            engine = GLib.Uri.parse(url, GLib.UriFlags.NONE).get_host() ?? '';
        } catch {
            // адрес без хоста — подпись будет общей
        }
        engine = engine.replace(/^www\./, '').replace(/\.[a-z]+$/, '');
        engine = engine.charAt(0).toUpperCase() + engine.slice(1);
        const section = _section(_('Web'));
        section.add_child(this._addResult({
            gicon: browser?.get_icon() ?? null,
            iconName: 'web-browser-symbolic',
            title: text,
            // Translators: "Search with Google".
            subtitle: engine ? _('Search with %s').format(engine) : _('Search the web'),
            activate: () => {
                this._launcher.close();
                _launchUri(url);
            },
        }));
        return section;
    }

    _addResult(params) {
        return new ResultRow(params);
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

// Кнопка-кольцо в углу полки. Её меню — это и есть лаунчер.
const LauncherButton = GObject.registerClass(
class LauncherButton extends PanelMenu.Button {
    _init(launcher, settings) {
        super._init(0.0, _('Launcher'), false);
        this._launcher = launcher;
        this._settings = settings;
        this.add_style_class_name('hypede-launcher-button');
        this._ring = new St.Widget({
            style_class: 'hypede-launcher-ring',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(new St.Bin({style_class: 'hypede-launcher-ring-bin', child: this._ring}));

        this.menu.actor.add_style_class_name('hypede-launcher-menu');
        this.menu._boxPointer.setSourceAlignment(0.0);

        this.view = new LauncherView(launcher, settings);
        this.menu.box.add_child(this.view);

        // Под фоном пузыря — размытые обои (см. backdrop.js).
        const bin = this.menu._boxPointer.bin;
        bin.set_child(null);
        this._stack = new St.Widget({layout_manager: new Clutter.BinLayout()});
        this._backdrop = new Backdrop();
        this._stack.add_child(this._backdrop);
        this._stack.add_child(this.menu.box);
        for (const coordinate of [Clutter.BindCoordinate.POSITION, Clutter.BindCoordinate.SIZE])
            this._backdrop.add_constraint(new Clutter.BindConstraint({source: this.menu.box, coordinate}));
        bin.set_child(this._stack);
        this.menu._boxPointer.connectObject('notify::allocation', () => this._syncBackdropLater(), this);
        this.connect('destroy', () => {
            if (this._backdropLater)
                global.compositor.get_laters().remove(this._backdropLater);
            this._backdropLater = 0;
        });

        this.menu.connect('open-state-changed', (_menu, open) => {
            // Кольцо «сжимается», пока лаунчер открыт.
            this._ring.set_pivot_point(0.5, 0.5);
            this._ring.ease({
                scale_x: open ? 0.8 : 1,
                scale_y: open ? 0.8 : 1,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            });
            if (open) {
                if (this._settings.get_strv('launcher-search-providers').includes('files')) {
                    GLib.timeout_add(GLib.PRIORITY_LOW, 800, () => {
                        getFileIndex().refresh();
                        return GLib.SOURCE_REMOVE;
                    });
                }
                this._prepareOpen();
                this.view._syncAssistant();
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

    setShelf(shelf) {
        this._shelf = shelf;
        const side = MENU_SIDE[shelf.position] ?? St.Side.BOTTOM;
        this.menu._arrowSide = side;
        this.menu._boxPointer.updateArrowSide(side);
    }

    _prepareOpen() {
        const boxPointer = this.menu._boxPointer;
        // Лаунчер привязан не к кнопке, а к краю всей полки: так пузырь
        // стоит ровно у её угла, как в Chrome OS.
        if (this._shelf?.actor)
            boxPointer.setPosition(this._shelf.actor, 0.0);

        const fullscreen = this._settings.get_string('launcher-style') === 'fullscreen';
        if (fullscreen)
            this.menu.actor.add_style_class_name('fullscreen');
        else
            this.menu.actor.remove_style_class_name('fullscreen');

        this._backdrop.visible = this._settings.get_boolean('launcher-blur') && !this._settings.get_boolean('lite-mode');
        this._syncBackdropLater();
    }

    _syncBackdropLater() {
        if (this._backdropLater || !this._backdrop.visible)
            return;
        this._backdropLater = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._backdropLater = 0;
            let radius = 0;
            try {
                radius = this.menu.box.get_theme_node().get_border_radius(St.Corner.TOPLEFT);
            } catch {}
            this._backdrop.setCornerRadius(radius);
            this._backdrop.sync();
            return GLib.SOURCE_REMOVE;
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

    onShelfChanged(shelf) {
        this.close();
        this.button.setShelf(shelf);
    }

    get isOpen() {
        return this.button.menu.isOpen;
    }

    open(initialText = '') {
        if (Main.sessionMode.isLocked)
            return;
        if (!this.button.menu.isOpen)
            this.button.menu.open(BoxPointer.PopupAnimation.FULL);
        if (initialText) {
            this.button.view.entry.text = initialText;
            this.button.view.entry.clutter_text.set_cursor_position(-1);
        }
    }

    close() {
        this._appMenu?.close();
        if (this.button.menu.isOpen)
            this.button.menu.close(BoxPointer.PopupAnimation.FULL);
    }

    // Жест: begin → update(p) → end(open). Возвращает false, если лаунчер уже открыт.
    gestureBegin() {
        if (this.isOpen || Main.sessionMode.isLocked)
            return false;
        this.button.view._gesture = true;
        this.open();
        this.button.view.gestureProgress(0);
        return true;
    }

    gestureUpdate(p) {
        this.button.view.gestureProgress(p);
    }

    gestureEnd(open) {
        this.button.view.gestureEnd(open, () => this.close());
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
        destroyFileIndex();
        global.display.disconnectObject(this);
        this._settings.disconnectObject?.(this);
        this._appMenu?.destroy();
        this._appMenu = null;
        this.button.destroy();
        this.button = null;
    }
}
