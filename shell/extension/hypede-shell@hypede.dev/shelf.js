// Полка Chrome OS из верхней панели GNOME.
//
// Панель не подменяется своей: она переезжает к нижнему краю экрана и
// получает новое содержимое. Благодаря этому сохраняются все родные
// механизмы GNOME — строгое место под окна (strut), скрытие в полноэкранном
// режиме, меню индикаторов, клавиатурная навигация по панели.
//
//   [ ◯ ]            [ значки приложений ]            [ 29 сент. ] [ 📶 🔋 12:30 ]
//   лаунчер            закреплённые + запущенные       меню даты     быстрые настройки

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GnomeDesktop from 'gi://GnomeDesktop';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';
import {InjectionManager, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const ICON_SIZE = 36;
const TOOLTIP_DELAY = 350;
const AUTOHIDE_CHECK_INTERVAL = 350;
const AUTOHIDE_ANIMATION_TIME = 200;
const SETTINGS_APP_ID = 'dev.hypede.Settings.desktop';

function _addSecondaryClick(actor, callback) {
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

function _setMenuSide(indicator, side) {
    const menu = indicator?.menu;
    if (!menu?._boxPointer)
        return;
    menu._arrowSide = side;
    menu._boxPointer.updateArrowSide(side);
}

// Подсказка с названием приложения над значком.
class Tooltip {
    constructor() {
        this._label = new St.Label({style_class: 'hypede-shelf-tooltip', visible: false});
        Main.uiGroup.add_child(this._label);
        this._timeoutId = 0;
        this._owner = null;
    }

    schedule(owner, text) {
        this.cancel();
        this._owner = owner;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY, () => {
            this._timeoutId = 0;
            this._show(owner, text);
            return GLib.SOURCE_REMOVE;
        });
    }

    _show(owner, text) {
        if (!owner.mapped || !owner.hover)
            return;
        this._label.text = text;
        this._label.opacity = 0;
        this._label.show();
        Main.uiGroup.set_child_above_sibling(this._label, null);

        const [x, y] = owner.get_transformed_position();
        const [width] = owner.get_transformed_size();
        const monitor = Main.layoutManager.findMonitorForActor(owner);
        let labelX = Math.round(x + width / 2 - this._label.width / 2);
        if (monitor) {
            labelX = Math.max(monitor.x + 4,
                Math.min(labelX, monitor.x + monitor.width - this._label.width - 4));
        }
        const labelY = Math.round(y - this._label.height - 8);
        this._label.set_position(labelX, labelY);
        this._label.ease({
            opacity: 255,
            duration: 100,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    cancel(owner = null) {
        if (owner && owner !== this._owner)
            return;
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._label.hide();
        this._owner = null;
    }

    destroy() {
        this.cancel();
        this._label.destroy();
    }
}

// Значок приложения на полке.
const ShelfIcon = GObject.registerClass(
class ShelfIcon extends St.Button {
    _init(app, shelfApps) {
        super._init({
            style_class: 'hypede-shelf-item',
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
            accessible_name: app.get_name(),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.app = app;
        this._shelfApps = shelfApps;

        const box = new St.Widget({layout_manager: new Clutter.BinLayout()});
        this._icon = new St.Bin({
            style_class: 'hypede-shelf-icon',
            child: app.create_icon_texture(ICON_SIZE),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._icon);
        this._dot = new St.Widget({
            style_class: 'hypede-shelf-dot',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            x_expand: true,
            y_expand: true,
        });
        box.add_child(this._dot);
        this.set_child(box);

        this.app.connectObject(
            'notify::state', () => this._sync(),
            'windows-changed', () => this._sync(),
            this);

        this.connect('notify::hover', () => {
            if (this.hover && !this._menu?.isOpen)
                shelfApps.tooltip.schedule(this, this.app.get_name());
            else
                shelfApps.tooltip.cancel(this);
        });
        this.connect('clicked', (_b, button) => {
            shelfApps.tooltip.cancel(this);
            this._activate(button);
        });
        this.connect('popup-menu', () => this.popupMenu());
        _addSecondaryClick(this, () => this.popupMenu());

        this._sync();
    }

    _windows() {
        return this.app.get_windows().filter(w => !w.skip_taskbar);
    }

    _sync() {
        const running = this.app.state !== Shell.AppState.STOPPED &&
            this._windows().length > 0;
        this._dot.visible = running;
        this.syncFocus();
    }

    syncFocus() {
        const focused = Shell.WindowTracker.get_default().focus_app === this.app;
        if (focused)
            this.add_style_pseudo_class('active');
        else
            this.remove_style_pseudo_class('active');
    }

    // Поведение Chrome OS: запуск → фокус → свернуть; у нескольких окон —
    // перебор окон по кругу.
    _activate(button) {
        const event = Clutter.get_current_event();
        const modifiers = event ? event.get_state() : 0;
        const ctrl = (modifiers & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const windows = this._windows();

        if ((ctrl || button === Clutter.BUTTON_MIDDLE) && this.app.can_open_new_window()) {
            this._bounce();
            this.app.open_new_window(-1);
            return;
        }

        if (windows.length === 0) {
            this._bounce();
            this.app.activate();
            return;
        }

        const focusWindow = global.display.focus_window;
        const focused = windows.find(w =>
            w === focusWindow || w === focusWindow?.get_transient_for());

        if (!focused) {
            Main.activateWindow(windows[0]);
        } else if (windows.length === 1) {
            focused.minimize();
        } else {
            // get_windows() отсортирован по недавности — самое «старое» окно
            // в конце списка, его и поднимаем.
            Main.activateWindow(windows[windows.length - 1]);
        }
    }

    _bounce() {
        this._icon.set_pivot_point(0.5, 1.0);
        this._icon.ease({
            scale_x: 0.85,
            scale_y: 0.85,
            duration: 110,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._icon.ease({
                scale_x: 1,
                scale_y: 1,
                duration: 220,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            }),
        });
    }

    popupMenu() {
        this._shelfApps.tooltip.cancel(this);
        if (!this._menu) {
            this._menu = new AppMenu(this, St.Side.BOTTOM, {
                favoritesSection: true,
                showSingleWindows: true,
            });
            this._menu.setApp(this.app);
            this._menu.actor.add_style_class_name('hypede-shelf-menu');
            this._menu.connect('open-state-changed', (_m, open) => {
                if (open)
                    this.add_style_pseudo_class('checked');
                else
                    this.remove_style_pseudo_class('checked');
            });
            Main.uiGroup.add_child(this._menu.actor);
            this._shelfApps.menuManager.addMenu(this._menu);
            this.connect('destroy', () => this._menu?.destroy());
        }
        this._menu.open(BoxPointer.PopupAnimation.FULL);
        this._menu.actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
        return Clutter.EVENT_STOP;
    }

    get menuOpen() {
        return this._menu?.isOpen ?? false;
    }
});

// Ряд значков: сначала закреплённые (избранное GNOME), затем остальные
// запущенные — в порядке первого запуска, чтобы значки не прыгали.
const ShelfApps = GObject.registerClass(
class ShelfApps extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'hypede-shelf-apps',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._appSystem = Shell.AppSystem.get_default();
        this._tracker = Shell.WindowTracker.get_default();
        this._favorites = AppFavorites.getAppFavorites();
        this._icons = new Map();
        this._runningOrder = [];

        this.tooltip = new Tooltip();
        this.menuManager = new PopupMenu.PopupMenuManager(this);

        this._favorites.connectObject('changed', () => this._queueRebuild(), this);
        this._appSystem.connectObject(
            'app-state-changed', () => this._queueRebuild(),
            'installed-changed', () => this._queueRebuild(),
            this);
        this._tracker.connectObject('notify::focus-app', () => {
            for (const icon of this._icons.values())
                icon.syncFocus();
        }, this);
        global.display.connectObject('window-created', () => this._queueRebuild(), this);

        this.connect('destroy', () => {
            if (this._rebuildId)
                GLib.source_remove(this._rebuildId);
            this.tooltip.destroy();
        });

        this._rebuild();
    }

    get anyMenuOpen() {
        return [...this._icons.values()].some(icon => icon.menuOpen);
    }

    _queueRebuild() {
        if (this._rebuildId)
            return;
        this._rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._rebuildId = 0;
            this._rebuild();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuild() {
        const favorites = this._favorites.getFavorites();
        const favoriteIds = new Set(favorites.map(app => app.get_id()));

        // Запущенные приложения храним объектами, а не id: у окон без
        // .desktop-файла GNOME создаёт временное приложение («window:N»),
        // которое через lookup_app уже не найти.
        const running = new Map(this._appSystem.get_running()
            .filter(app => app.get_windows().some(w => !w.skip_taskbar))
            .map(app => [app.get_id(), app]));
        this._runningOrder = this._runningOrder.filter(id => running.has(id));
        for (const id of running.keys()) {
            if (!this._runningOrder.includes(id))
                this._runningOrder.push(id);
        }

        const apps = [...favorites];
        for (const id of this._runningOrder) {
            if (!favoriteIds.has(id))
                apps.push(running.get(id));
        }

        const icons = new Map();
        apps.filter(Boolean).forEach((app, index) => {
            const id = app.get_id();
            let icon = this._icons.get(id);
            if (!icon) {
                icon = new ShelfIcon(app, this);
                this.insert_child_at_index(icon, index);
                icon.opacity = 0;
                icon.ease({opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            } else {
                this.set_child_at_index(icon, index);
            }
            icons.set(id, icon);
        });

        for (const [id, icon] of this._icons) {
            if (!icons.has(id))
                icon.destroy();
        }
        this._icons = icons;
    }
});

export class Shelf {
    constructor(settings, launcher) {
        this._settings = settings;
        this._launcher = launcher;
        this._injections = new InjectionManager();
        this._panel = Main.panel;
        this._panelBox = Main.layoutManager.panelBox;
        this._autohide = false;
        this._hidden = false;

        this._panel.add_style_class_name('hypede-shelf');

        // Панель внизу: после каждого пересчёта геометрии GNOME ставит её
        // наверх — возвращаем обратно.
        const shelf = this;
        this._injections.overrideMethod(Main.layoutManager, '_updateBoxes',
            original => function (...args) {
                original.apply(this, args);
                shelf._reposition();
            });
        this._panelBox.connectObject('notify::height', () => this._reposition(), this);

        // Перетаскивание окна за пустое место панели здесь не нужно:
        // полка внизу, а под ней нет заголовков окон.
        this._dragAction = this._panel.get_action('window-drag');
        this._dragAction?.set_enabled(false);

        // Меню индикаторов открываются вверх.
        this._injections.overrideMethod(this._panel, '_onMenuSet',
            original => function (indicator) {
                original.call(this, indicator);
                _setMenuSide(indicator, St.Side.BOTTOM);
            });
        for (const indicator of Object.values(this._panel.statusArea))
            _setMenuSide(indicator, St.Side.BOTTOM);

        // Значки приложений
        this._apps = new ShelfApps();
        this._placeApps();
        this._settings.connectObject(
            'changed::shelf-alignment', () => this._placeApps(),
            'changed::show-date', () => this._syncDate(),
            'changed::shelf-autohide', () => this._syncAutohide(),
            this);

        // Трей
        this._clock = new GnomeDesktop.WallClock({time_only: true});
        this._clock.connectObject('notify::clock', () => this._updateTime(), this);
        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._interfaceSettings.connectObject('changed::clock-format', () => this._updateTime(), this);
        this._arrangeTray();
        Main.sessionMode.connectObject('updated', () => this._arrangeTray(), this);
        this._redirectSettingsButton();

        this._reposition();
        this._syncAutohide();
    }

    // ---------- Геометрия ----------

    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        this._panelBox.set_position(monitor.x,
            monitor.y + monitor.height - this._panelBox.height);
        this._updateHotEdge();
    }

    // ---------- Значки ----------

    _placeApps() {
        const leftAligned = this._settings.get_string('shelf-alignment') === 'left';
        const target = leftAligned ? this._panel._leftBox : this._panel._centerBox;
        const parent = this._apps.get_parent();
        if (parent === target)
            return;
        parent?.remove_child(this._apps);
        target.add_child(this._apps);
    }

    // ---------- Трей ----------

    _arrangeTray() {
        const {statusArea} = this._panel;

        // В обычном сеансе GNOME (расширение включено вручную) переносим
        // кнопку «Обзор» и дату сами; в сеансе HypeDE это делает режим.
        statusArea.activities?.container.hide();
        const dateMenu = statusArea.dateMenu;
        const quickSettings = statusArea.quickSettings;
        if (dateMenu && quickSettings &&
            dateMenu.container.get_parent() !== this._panel._rightBox) {
            dateMenu.container.get_parent()?.remove_child(dateMenu.container);
            this._panel._rightBox.insert_child_below(dateMenu.container, quickSettings.container);
            Main.messageTray.bannerAlignment = Clutter.ActorAlign.END;
        }

        if (dateMenu && !this._dateLabel) {
            dateMenu.add_style_class_name('hypede-tray-date-button');
            this._dateLabel = new St.Label({
                style_class: 'hypede-tray-date',
                y_align: Clutter.ActorAlign.CENTER,
            });
            const clockDisplay = dateMenu._clockDisplay;
            clockDisplay.get_parent().insert_child_above(this._dateLabel, clockDisplay);
            clockDisplay.hide();
            this._dateMenu = dateMenu;
        }

        if (quickSettings && !this._timeLabel) {
            quickSettings.add_style_class_name('hypede-tray-status');
            this._timeLabel = new St.Label({
                style_class: 'hypede-tray-clock',
                y_align: Clutter.ActorAlign.CENTER,
            });
            quickSettings._indicators.add_child(this._timeLabel);
        }

        this._updateTime();
        this._syncDate();
    }

    _updateTime() {
        const now = GLib.DateTime.new_now_local();
        if (this._timeLabel) {
            const twelveHour = this._interfaceSettings.get_string('clock-format') === '12h';
            this._timeLabel.text = now.format(twelveHour ? '%l:%M' : '%H:%M').trim();
        }
        if (this._dateLabel) {
            // Translators: date on the shelf, strftime format ("Sep 29").
            this._dateLabel.text = now.format(_('%b %-d')).replace(/\.$/, '');
        }
    }

    _syncDate() {
        if (this._dateMenu)
            this._dateMenu.container.visible = this._settings.get_boolean('show-date');
    }

    // Кнопка шестерёнки в быстрых настройках открывает «Настройки» HypeDE.
    _redirectSettingsButton(attempt = 0) {
        const quickSettings = this._panel.statusArea.quickSettings;
        const systemItem = quickSettings?._system?._systemItem;
        if (!systemItem) {
            // Индикаторы быстрых настроек создаются асинхронно.
            if (attempt < 50) {
                this._redirectId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                    this._redirectId = 0;
                    this._redirectSettingsButton(attempt + 1);
                    return GLib.SOURCE_REMOVE;
                });
            }
            return;
        }

        const settingsApp = Shell.AppSystem.get_default().lookup_app(SETTINGS_APP_ID);
        if (!settingsApp)
            return;
        const item = systemItem.child.get_children().find(c => '_settingsApp' in c);
        if (!item)
            return;
        this._settingsItem = item;
        this._originalSettingsApp = item._settingsApp;
        item._settingsApp = settingsApp;
        item.child.gicon = settingsApp.get_icon();
        item.accessible_name = settingsApp.get_name();
        item._sync?.();
    }

    _restoreSettingsButton() {
        if (this._redirectId) {
            GLib.source_remove(this._redirectId);
            this._redirectId = 0;
        }
        const item = this._settingsItem;
        if (!item)
            return;
        item._settingsApp = this._originalSettingsApp;
        item.child.gicon = this._originalSettingsApp?.get_icon() ?? null;
        item.accessible_name = this._originalSettingsApp?.get_name() ?? null;
        item._sync?.();
        this._settingsItem = null;
    }

    // ---------- Автоскрытие ----------

    _syncAutohide() {
        const enabled = this._settings.get_boolean('shelf-autohide');
        if (enabled === this._autohide)
            return;
        this._autohide = enabled;

        // Скрываемая полка не должна отнимать место у развёрнутых окон.
        Main.layoutManager.untrackChrome(this._panelBox);
        Main.layoutManager.trackChrome(this._panelBox, {
            affectsStruts: !enabled,
            trackFullscreen: true,
        });

        if (enabled) {
            this._hotEdge = new St.Widget({reactive: true, name: 'hypedeShelfHotEdge'});
            this._hotEdge.connect('enter-event', () => this._setHidden(false));
            Main.layoutManager.addTopChrome(this._hotEdge);
            this._updateHotEdge();
            this._panel.track_hover = true;
            this._autohideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                AUTOHIDE_CHECK_INTERVAL, () => {
                    this._checkAutohide();
                    return GLib.SOURCE_CONTINUE;
                });
        } else {
            this._stopAutohide();
            this._setHidden(false);
        }
    }

    _updateHotEdge() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!this._hotEdge || !monitor)
            return;
        this._hotEdge.set_position(monitor.x, monitor.y + monitor.height - 1);
        this._hotEdge.set_size(monitor.width, 1);
    }

    _stopAutohide() {
        if (this._autohideId) {
            GLib.source_remove(this._autohideId);
            this._autohideId = 0;
        }
        this._hotEdge?.destroy();
        this._hotEdge = null;
    }

    _shouldStayVisible() {
        if (this._panel.hover || Main.overview.visible)
            return true;
        if (this._panel.menuManager.activeMenu || this._apps.anyMenuOpen)
            return true;
        if (this._launcher.isOpen)
            return true;

        // Прячемся, только если какое-нибудь окно заходит на полку.
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return true;
        const shelfTop = monitor.y + monitor.height - this._panelBox.height;
        const workspace = global.workspace_manager.get_active_workspace();
        return !workspace.list_windows().some(w =>
            w.get_monitor() === monitor.index &&
            w.showing_on_its_workspace() &&
            w.get_window_type() === Meta.WindowType.NORMAL &&
            w.get_frame_rect().y + w.get_frame_rect().height > shelfTop);
    }

    _checkAutohide() {
        this._setHidden(!this._shouldStayVisible());
    }

    _setHidden(hidden) {
        if (hidden === this._hidden)
            return;
        this._hidden = hidden;
        this._panelBox.ease({
            translation_y: hidden ? this._panelBox.height : 0,
            duration: AUTOHIDE_ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    destroy() {
        this._settings.disconnectObject(this);
        Main.sessionMode.disconnectObject(this);
        this._panelBox.disconnectObject(this);
        this._clock.disconnectObject(this);
        this._clock = null;
        this._interfaceSettings.disconnectObject(this);

        if (this._autohide) {
            this._stopAutohide();
            Main.layoutManager.untrackChrome(this._panelBox);
            Main.layoutManager.trackChrome(this._panelBox, {
                affectsStruts: true,
                trackFullscreen: true,
            });
            this._panel.track_hover = false;
        }
        this._panelBox.remove_all_transitions();
        this._panelBox.translation_y = 0;

        this._restoreSettingsButton();
        this._apps.destroy();
        this._apps = null;

        this._timeLabel?.destroy();
        this._timeLabel = null;
        if (this._dateLabel) {
            this._dateLabel.destroy();
            this._dateLabel = null;
            this._dateMenu?._clockDisplay.show();
            this._dateMenu?.remove_style_class_name('hypede-tray-date-button');
            this._dateMenu.container.visible = true;
        }
        this._panel.statusArea.quickSettings?.remove_style_class_name('hypede-tray-status');

        this._injections.clear();
        for (const indicator of Object.values(this._panel.statusArea))
            _setMenuSide(indicator, St.Side.TOP);
        this._dragAction?.set_enabled(true);
        this._panel.remove_style_class_name('hypede-shelf');

        // Вернуть панель наверх и индикаторы — по местам, как велит режим.
        Main.layoutManager._updateBoxes();
        this._panel._updatePanel();
    }
}
