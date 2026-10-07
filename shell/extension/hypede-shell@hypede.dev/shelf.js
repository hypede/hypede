// Полка Chrome OS.
//
// Полка — это собственный контейнер HypeDE, в который переезжают ячейки
// панели GNOME (левая с кнопкой лаунчера, правая с индикаторами). Так все
// системные индикаторы, их меню и клавиатурная навигация работают как в
// GNOME, а сама полка может стоять у любого края экрана — снизу, слева,
// справа или сверху — и раскладываться по горизонтали или вертикали.
//
//   [ ◯ ]            [ значки приложений ]            [ 29 сент. ] [ 📶 🔋 12:30 ]
//   лаунчер            закреплённые + запущенные       меню даты     быстрые настройки
//
// Панель GNOME (Main.panel) при этом скрыта, но остаётся на месте: через неё
// оболочка по-прежнему управляет индикаторами и режимами сеанса.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';
import {InjectionManager, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {addSecondaryClick} from './util.js';
import {Backdrop} from './backdrop.js';

const TOOLTIP_DELAY = 350;
const AUTOHIDE_CHECK_INTERVAL = 350;
const AUTOHIDE_ANIMATION_TIME = 250;
const SETTINGS_APP_ID = 'dev.hypede.Settings.desktop';

// Сторона, с которой открываются меню: у полки снизу — вверх и т. д.
const MENU_SIDE = {
    bottom: St.Side.BOTTOM,
    top: St.Side.TOP,
    left: St.Side.LEFT,
    right: St.Side.RIGHT,
};

function _setMenuSide(indicator, side) {
    const menu = indicator?.menu;
    if (!menu?._boxPointer)
        return;
    menu._arrowSide = side;
    menu._boxPointer.updateArrowSide(side);
}

// ---------------------------------------------------------------------------
// Раскладка полки: начало, середина, конец вдоль длинной стороны.
// ---------------------------------------------------------------------------

const ShelfLayoutManager = GObject.registerClass(
class ShelfLayoutManager extends Clutter.LayoutManager {
    _init() {
        super._init();
        this.vertical = false;
        this.centered = true;
        this.start = null;
        this.middle = null;
        this.end = null;
    }

    _children() {
        return [this.start, this.middle, this.end].filter(c => c?.visible);
    }

    vfunc_get_preferred_width(_container, forHeight) {
        const sizes = this._children().map(c => c.get_preferred_width(this.vertical ? -1 : forHeight));
        if (this.vertical)
            return [Math.max(0, ...sizes.map(s => s[0])), Math.max(0, ...sizes.map(s => s[1]))];
        return [sizes.reduce((a, s) => a + s[0], 0), sizes.reduce((a, s) => a + s[1], 0)];
    }

    vfunc_get_preferred_height(_container, forWidth) {
        const sizes = this._children().map(c => c.get_preferred_height(this.vertical ? forWidth : -1));
        if (!this.vertical)
            return [Math.max(0, ...sizes.map(s => s[0])), Math.max(0, ...sizes.map(s => s[1]))];
        return [sizes.reduce((a, s) => a + s[0], 0), sizes.reduce((a, s) => a + s[1], 0)];
    }

    // Размер ребёнка вдоль оси полки.
    _length(child, cross) {
        if (!child?.visible)
            return 0;
        const [, nat] = this.vertical
            ? child.get_preferred_height(cross)
            : child.get_preferred_width(cross);
        return nat;
    }

    vfunc_allocate(_container, box) {
        const v = this.vertical;
        const origin = v ? box.y1 : box.x1;
        const total = v ? box.get_height() : box.get_width();
        const cross = v ? box.get_width() : box.get_height();
        const rtl = !v && Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;

        const startLen = Math.min(this._length(this.start, cross), total);
        const endLen = Math.min(this._length(this.end, cross), total - startLen);
        const free = Math.max(0, total - startLen - endLen);
        const middleLen = Math.min(this._length(this.middle, cross), free);

        let middlePos;
        if (this.centered) {
            middlePos = Math.round((total - middleLen) / 2);
            middlePos = Math.max(startLen, Math.min(middlePos, total - endLen - middleLen));
        } else {
            middlePos = startLen;
        }

        const place = (child, pos, len) => {
            if (!child?.visible)
                return;
            const childBox = new Clutter.ActorBox();
            if (v) {
                childBox.set_origin(box.x1, origin + pos);
                childBox.set_size(cross, len);
            } else {
                const x = rtl ? total - pos - len : pos;
                childBox.set_origin(origin + x, box.y1);
                childBox.set_size(len, cross);
            }
            child.allocate(childBox);
        };
        place(this.start, 0, startLen);
        place(this.middle, middlePos, middleLen);
        place(this.end, total - endLen, endLen);
    }
});

// ---------------------------------------------------------------------------
// Подсказка с названием приложения рядом со значком.
// ---------------------------------------------------------------------------

class Tooltip {
    constructor(shelf) {
        this._shelf = shelf;
        this._label = new St.Label({style_class: 'hypede-shelf-tooltip', visible: false});
        Main.uiGroup.add_child(this._label);
        this._timeoutId = 0;
        this._owner = null;
    }

    schedule(owner, text) {
        this.cancel();
        if (!this._shelf.settings.get_boolean('shelf-tooltips'))
            return;
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
        const [width, height] = owner.get_transformed_size();
        const monitor = Main.layoutManager.findMonitorForActor(owner);
        const gap = 8;
        let lx, ly, dx = 0, dy = 0;
        switch (this._shelf.position) {
        case 'left':
            lx = x + width + gap;
            ly = y + height / 2 - this._label.height / 2;
            dx = -6;
            break;
        case 'right':
            lx = x - this._label.width - gap;
            ly = y + height / 2 - this._label.height / 2;
            dx = 6;
            break;
        case 'top':
            lx = x + width / 2 - this._label.width / 2;
            ly = y + height + gap;
            dy = -6;
            break;
        default:
            lx = x + width / 2 - this._label.width / 2;
            ly = y - this._label.height - gap;
            dy = 6;
        }
        if (monitor) {
            lx = Math.max(monitor.x + 4, Math.min(lx, monitor.x + monitor.width - this._label.width - 4));
            ly = Math.max(monitor.y + 4, Math.min(ly, monitor.y + monitor.height - this._label.height - 4));
        }
        this._label.set_position(Math.round(lx), Math.round(ly));
        this._label.translation_x = dx;
        this._label.translation_y = dy;
        this._label.ease({
            opacity: 255,
            translation_x: 0,
            translation_y: 0,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    cancel(owner = null) {
        if (owner && owner !== this._owner)
            return;
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._label.remove_all_transitions();
        this._label.hide();
        this._owner = null;
    }

    destroy() {
        this.cancel();
        this._label.destroy();
    }
}

// ---------------------------------------------------------------------------
// Значок приложения на полке.
// ---------------------------------------------------------------------------

const ShelfIcon = GObject.registerClass(
class ShelfIcon extends St.Button {
    _init(app, shelfApps) {
        super._init({
            style_class: 'hypede-shelf-item',
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
            accessible_name: app.get_name(),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        this.app = app;
        this._shelfApps = shelfApps;
        this._delegate = this;

        const box = new St.Widget({layout_manager: new Clutter.BinLayout()});
        this._icon = new St.Bin({
            style_class: 'hypede-shelf-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._icon);
        this._dot = new St.Widget({
            style_class: 'hypede-shelf-dot',
            x_expand: true,
            y_expand: true,
        });
        box.add_child(this._dot);
        this.set_child(box);
        this.updateIcon();
        this.updateSide();

        // Перетаскивание значка — чтобы поменять порядок закреплённых.
        this._draggable = DND.makeDraggable(this, {timeoutThreshold: 200});
        this._draggable.connect('drag-begin', () => {
            this._shelfApps.tooltip.cancel(this);
            this._shelfApps.dragBegin(this);
        });
        this._draggable.connect('drag-end', () => this._shelfApps.dragEnd());

        this.app.connectObject(
            'notify::state', () => this._sync(),
            'windows-changed', () => {
                this._sync();
                this.updateIconGeometry();
            },
            this);

        this.connect('notify::hover', () => this._onHover());
        this.connect('clicked', (_b, button) => {
            shelfApps.tooltip.cancel(this);
            this._activate(button);
        });
        this.connect('popup-menu', () => this.popupMenu());
        this.connect('notify::allocation', () => this._queueIconGeometry());
        addSecondaryClick(this, () => this.popupMenu());

        this._sync();
    }

    // Для DND: иконка, которую тянут за указателем.
    getDragActor() {
        return this.app.create_icon_texture(this._shelfApps.iconSize);
    }

    getDragActorSource() {
        return this._icon;
    }

    updateIcon() {
        this._icon.child = this.app.create_icon_texture(this._shelfApps.iconSize);
    }

    updateSide() {
        const side = this._shelfApps.shelf.position;
        // Точка «запущено» — у края полки, ближнего к краю экрана.
        const vertical = side === 'left' || side === 'right';
        this._dot.x_align = vertical
            ? (side === 'left' ? Clutter.ActorAlign.START : Clutter.ActorAlign.END)
            : Clutter.ActorAlign.CENTER;
        this._dot.y_align = vertical
            ? Clutter.ActorAlign.CENTER
            : (side === 'top' ? Clutter.ActorAlign.START : Clutter.ActorAlign.END);
    }

    _onHover() {
        if (this.hover && !this._menu?.isOpen)
            this._shelfApps.tooltip.schedule(this, this.app.get_name());
        else
            this._shelfApps.tooltip.cancel(this);

        if (this._shelfApps.settings.get_boolean('shelf-hover-zoom')) {
            this._icon.set_pivot_point(0.5, 0.5);
            this._icon.ease({
                scale_x: this.hover ? 1.18 : 1,
                scale_y: this.hover ? 1.18 : 1,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            });
        }
    }

    _windows() {
        return this.app.get_windows().filter(w => !w.skip_taskbar);
    }

    _sync() {
        const running = this.app.state !== Shell.AppState.STOPPED &&
            this._windows().length > 0;
        if (running !== this._running) {
            this._running = running;
            // Точка появляется и пропадает плавно.
            this._dot.ease({
                opacity: running ? 255 : 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
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
            this.bounce();
            this.app.open_new_window(-1);
            return;
        }

        if (windows.length === 0) {
            this.bounce();
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

    // Запуск: значок «подпрыгивает» от края полки.
    bounce() {
        const side = this._shelfApps.shelf.position;
        const distance = 10;
        const offset = {
            bottom: [0, -distance], top: [0, distance],
            left: [distance, 0], right: [-distance, 0],
        }[side];
        this._icon.remove_all_transitions();
        this._icon.ease({
            translation_x: offset[0],
            translation_y: offset[1],
            duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._icon.ease({
                translation_x: 0,
                translation_y: 0,
                duration: 420,
                mode: Clutter.AnimationMode.EASE_OUT_BOUNCE,
            }),
        });
    }

    // Куда «улетает» окно при сворачивании.
    _queueIconGeometry() {
        if (this._geometryId)
            return;
        this._geometryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._geometryId = 0;
            this.updateIconGeometry();
            return GLib.SOURCE_REMOVE;
        });
    }

    updateIconGeometry() {
        const enabled = this._shelfApps.settings.get_boolean('minimize-to-shelf');
        let rect = null;
        if (enabled && this.mapped) {
            const [x, y] = this.get_transformed_position();
            const [width, height] = this.get_transformed_size();
            rect = new Mtk.Rectangle({
                x: Math.round(x), y: Math.round(y),
                width: Math.round(width), height: Math.round(height),
            });
        }
        for (const window of this._windows())
            window.set_icon_geometry(rect);
    }

    popupMenu() {
        this._shelfApps.tooltip.cancel(this);
        const side = MENU_SIDE[this._shelfApps.shelf.position];
        if (this._menu && this._menuSide !== side) {
            this._menu.destroy();
            this._menu = null;
        }
        if (!this._menu) {
            this._menuSide = side;
            this._menu = new AppMenu(this, side, {
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
        }
        this._menu.open(BoxPointer.PopupAnimation.FULL);
        this._menu.actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
        return Clutter.EVENT_STOP;
    }

    get menuOpen() {
        return this._menu?.isOpen ?? false;
    }

    // Плавно исчезнуть и только потом удалиться.
    vanish() {
        this.reactive = false;
        this._shelfApps.tooltip.cancel(this);
        for (const window of this._windows())
            window.set_icon_geometry(null);
        this.set_pivot_point(0.5, 0.5);
        this.ease({
            opacity: 0,
            scale_x: 0.4,
            scale_y: 0.4,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => this.destroy(),
        });
    }

    _onDestroy() {
        if (this._geometryId)
            GLib.source_remove(this._geometryId);
        this._menu?.destroy();
        this._menu = null;
    }

    vfunc_destroy() {
        this._onDestroy();
        super.vfunc_destroy();
    }
});

// ---------------------------------------------------------------------------
// Ряд значков: закреплённые (избранное) и запущенные.
// ---------------------------------------------------------------------------

const ShelfApps = GObject.registerClass(
class ShelfApps extends St.BoxLayout {
    _init(shelf) {
        super._init({
            style_class: 'hypede-shelf-apps',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        this.shelf = shelf;
        this.settings = shelf.settings;
        this._appSystem = Shell.AppSystem.get_default();
        this._tracker = Shell.WindowTracker.get_default();
        this._favorites = AppFavorites.getAppFavorites();
        this._icons = new Map();
        this._runningOrder = [];
        this._delegate = this;

        this.tooltip = new Tooltip(shelf);
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
        this.settings.connectObject(
            'changed::shelf-show-pinned', () => this._queueRebuild(),
            'changed::shelf-icon-size', () => this._updateIcons(),
            'changed::minimize-to-shelf', () => this.updateIconGeometry(),
            this);

        this.connect('destroy', () => {
            if (this._rebuildId)
                GLib.source_remove(this._rebuildId);
            this.tooltip.destroy();
        });

        this._rebuild(false);
    }

    get iconSize() {
        return this.settings.get_int('shelf-icon-size');
    }

    get anyMenuOpen() {
        return [...this._icons.values()].some(icon => icon.menuOpen);
    }

    setVertical(vertical) {
        this.orientation = vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL;
        for (const icon of this._icons.values())
            icon.updateSide();
    }

    _updateIcons() {
        for (const icon of this._icons.values())
            icon.updateIcon();
    }

    updateIconGeometry() {
        for (const icon of this._icons.values())
            icon.updateIconGeometry();
    }

    _queueRebuild() {
        if (this._rebuildId)
            return;
        this._rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._rebuildId = 0;
            this._rebuild(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuild(animate) {
        const showPinned = this.settings.get_boolean('shelf-show-pinned');
        const favorites = showPinned ? this._favorites.getFavorites() : [];
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
                if (animate) {
                    // Новый значок «вырастает» на своём месте.
                    icon.set_pivot_point(0.5, 0.5);
                    icon.opacity = 0;
                    icon.scale_x = icon.scale_y = 0.4;
                    icon.ease({
                        opacity: 255,
                        duration: 200,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });
                    icon.ease({
                        scale_x: 1,
                        scale_y: 1,
                        duration: 260,
                        mode: Clutter.AnimationMode.EASE_OUT_BACK,
                    });
                }
            } else {
                this.set_child_at_index(icon, index);
            }
            icons.set(id, icon);
        });

        for (const [id, icon] of this._icons) {
            if (!icons.has(id)) {
                if (animate)
                    icon.vanish();
                else
                    icon.destroy();
            }
        }
        this._icons = icons;
    }

    // ---------- Перетаскивание: порядок закреплённых ----------

    dragBegin(icon) {
        this._dragIcon = icon;
        this._dragPlaceholderIndex = this.get_children().indexOf(icon);
        icon.opacity = 80;
    }

    dragEnd() {
        if (this._dragIcon)
            this._dragIcon.opacity = 255;
        this._dragIcon = null;
        // Если значок бросили мимо, порядок вернётся к сохранённому.
        this._queueRebuild();
    }

    _indexAt(x, y) {
        const vertical = this.orientation === Clutter.Orientation.VERTICAL;
        const children = this.get_children().filter(c => c.visible);
        for (let i = 0; i < children.length; i++) {
            const alloc = children[i].get_allocation_box();
            const mid = vertical ? (alloc.y1 + alloc.y2) / 2 : (alloc.x1 + alloc.x2) / 2;
            if ((vertical ? y : x) < mid)
                return i;
        }
        return children.length;
    }

    handleDragOver(source, _actor, x, y) {
        if (!(source instanceof ShelfIcon) && !source?.app)
            return DND.DragMotionResult.NO_DROP;
        if (source instanceof ShelfIcon && source.get_parent() === this) {
            const index = Math.min(this._indexAt(x, y), this.get_n_children() - 1);
            if (index !== this.get_children().indexOf(source))
                this.set_child_at_index(source, index);
            return DND.DragMotionResult.MOVE_DROP;
        }
        return DND.DragMotionResult.COPY_DROP;
    }

    acceptDrop(source, _actor, x, y) {
        const app = source?.app;
        if (!app)
            return false;
        const id = app.get_id();
        const favorites = this._favorites.getFavoriteMap();
        const children = this.get_children();
        // Позиция среди закреплённых — число закреплённых значков перед местом сброса.
        let index = source instanceof ShelfIcon && source.get_parent() === this
            ? children.indexOf(source)
            : this._indexAt(x, y);
        index = children.slice(0, index).filter(c => c.app && c.app.get_id() in favorites && c !== source).length;

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (id in favorites)
                this._favorites.moveFavoriteToPos(id, index);
            else if (app.get_app_info?.())
                this._favorites.addFavoriteAtPos(id, index);
            return GLib.SOURCE_REMOVE;
        });
        return true;
    }
});

// ---------------------------------------------------------------------------
// На экране блокировки: «Выключить» и «Перезагрузить», как в Chrome OS.
// ---------------------------------------------------------------------------

const LockActions = GObject.registerClass(
class LockActions extends St.BoxLayout {
    _init() {
        super._init({style_class: 'hypede-shelf-lock-actions', y_align: Clutter.ActorAlign.CENTER});
        this._actions = SystemActions.getDefault();
        this._powerOff = this._addButton('system-shutdown-symbolic', _('Shut down'),
            () => this._actions.activatePowerOff());
        this._restart = this._addButton('system-reboot-symbolic', _('Restart'),
            () => this._actions.activateRestart());
        this._actions.connectObject(
            'notify::can-power-off', () => this._sync(),
            'notify::can-restart', () => this._sync(),
            this);
        this._sync();
    }

    _addButton(iconName, label, callback) {
        const box = new St.BoxLayout({style_class: 'hypede-shelf-lock-action-box'});
        box.add_child(new St.Icon({icon_name: iconName, style_class: 'hypede-shelf-lock-action-icon'}));
        box.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
        const button = new St.Button({
            style_class: 'hypede-shelf-lock-action',
            child: box,
            can_focus: true,
            accessible_name: label,
        });
        button.connect('clicked', callback);
        this.add_child(button);
        return button;
    }

    setVertical(vertical) {
        this.orientation = vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL;
        for (const button of [this._powerOff, this._restart])
            button.child.get_last_child().visible = !vertical;
    }

    _sync() {
        this._powerOff.visible = this._actions.can_power_off;
        this._restart.visible = this._actions.can_restart;
    }

    vfunc_destroy() {
        this._actions.disconnectObject(this);
        super.vfunc_destroy();
    }
});

// ---------------------------------------------------------------------------
// Сама полка.
// ---------------------------------------------------------------------------

export class Shelf {
    constructor(settings, launcher) {
        this.settings = settings;
        this._launcher = launcher;
        this._injections = new InjectionManager();
        this._panel = Main.panel;
        this._panelBox = Main.layoutManager.panelBox;
        this._autohide = false;
        this._hidden = false;
        this.position = settings.get_string('shelf-position');

        // Контейнер полки. Имя «panel» — чтобы на индикаторы действовали
        // стили панели GNOME (#panel .panel-button и т. д.).
        this._layout = new ShelfLayoutManager();
        this.actor = new St.Widget({
            name: 'panel',
            style_class: 'hypede-shelf',
            layout_manager: this._layout,
            reactive: true,
            x_expand: true,
            y_expand: true,
        });
        this.actor._delegate = this;

        // Ячейки панели GNOME переезжают на полку.
        this._startBox = this._panel._leftBox;
        this._centerBox = this._panel._centerBox;
        this._endBox = this._panel._rightBox;
        for (const box of [this._startBox, this._centerBox, this._endBox])
            this._panel.remove_child(box);

        this.apps = new ShelfApps(this);
        this._lockActions = new LockActions();
        this._startInner = new St.BoxLayout({style_class: 'hypede-shelf-start'});
        this._startInner.add_child(this._startBox);
        this._startInner.add_child(this._lockActions);
        this._middle = new St.BoxLayout({style_class: 'hypede-shelf-middle'});
        this._middle.add_child(this.apps);
        this._middle.add_child(this._centerBox);
        this.actor.add_child(this._startInner);
        this.actor.add_child(this._middle);
        this.actor.add_child(this._endBox);
        this._layout.start = this._startInner;
        this._layout.middle = this._middle;
        this._layout.end = this._endBox;

        this._panel.hide();
        this._panelBox.add_child(this.actor);

        // Клавиатурная навигация по полке (Ctrl+Alt+Tab).
        Main.ctrlAltTabManager.addGroup(this.actor, _('Shelf'), 'focus-top-bar-symbolic',
            {sortGroup: 0});

        // Размытые обои под полкой — отдельный слой прямо под ней.
        this._backdrop = new Backdrop();
        this._backdrop.hide();
        Main.layoutManager.uiGroup.insert_child_below(this._backdrop, this._panelBox);
        // Положение — перед ближайшей перерисовкой: двигать актёров посреди
        // раскладки Clutter не любит.
        const follow = () => {
            if (this._backdropLater)
                return;
            this._backdropLater = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
                this._backdropLater = 0;
                this._syncBackdrop();
                return GLib.SOURCE_REMOVE;
            });
        };
        this.actor.connectObject('notify::allocation', follow, 'notify::mapped', follow, 'style-changed', follow, this);
        this._panelBox.connectObject('notify::allocation', follow, 'notify::translation-x', follow,
            'notify::translation-y', follow, 'notify::opacity', follow, this);

        // Геометрию полки задаёт HypeDE: GNOME после каждого пересчёта ставит
        // панель наверх во всю ширину — возвращаем по-своему.
        const shelf = this;
        this._injections.overrideMethod(Main.layoutManager, '_updateBoxes',
            original => function (...args) {
                original.apply(this, args);
                shelf._reposition();
            });
        // Барьер у правого края нужен только верхней панели GNOME.
        this._injections.overrideMethod(Main.layoutManager, '_updatePanelBarrier',
            original => function (...args) {
                if (shelf.position === 'top')
                    return original.apply(this, args);
                return this._destroyPanelBarrier();
            });
        this._panelBox.connectObject(
            'notify::height', () => this._reposition(),
            'notify::width', () => this._reposition(),
            this);

        // Меню индикаторов открываются в сторону от края.
        this._injections.overrideMethod(this._panel, '_onMenuSet',
            original => function (indicator) {
                original.call(this, indicator);
                _setMenuSide(indicator, MENU_SIDE[shelf.position]);
            });

        this.settings.connectObject(
            'changed::shelf-position', () => this._syncPosition(),
            'changed::shelf-alignment', () => this._syncAlignment(),
            'changed::shelf-style', () => this._syncStyle(),
            'changed::shelf-blur', () => this._syncStyle(),
            'changed::lite-mode', () => this._syncStyle(),
            'changed::shelf-running-indicator', () => this._syncStyle(),
            'changed::show-date', () => this._syncDate(),
            'changed::shelf-autohide', () => this._syncAutohide(),
            'changed::shelf-size', () => this._syncSize(),
            this);
        St.ThemeContext.get_for_stage(global.stage).connectObject(
            'notify::scale-factor', () => this._syncSize(), this);

        // Трей
        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._interfaceSettings.connectObject(
            'changed::clock-format', () => this._updateTime(),
            'changed::clock-show-seconds', () => this._restartClock(),
            this);
        this._restartClock();
        this._arrangeTray();
        Main.sessionMode.connectObject('updated', () => this._onSessionModeUpdated(), this);
        this._redirectSettingsButton();

        this._syncAlignment();
        this._syncStyle();
        this._syncPosition();
        this._syncSessionMode();
        this._syncAutohide();

        // Появление полки при входе: выезжает от края.
        if (Main.layoutManager._startingUp) {
            Main.layoutManager.connectObject('startup-complete', () => this.slideIn(), this);
        }
    }

    get vertical() {
        return this.position === 'left' || this.position === 'right';
    }

    // ---------- Геометрия ----------

    _syncPosition() {
        this.position = this.settings.get_string('shelf-position');
        const vertical = this.vertical;
        for (const side of ['bottom', 'top', 'left', 'right'])
            this.actor.remove_style_class_name(`position-${side}`);
        this.actor.add_style_class_name(`position-${this.position}`);
        if (vertical)
            this.actor.add_style_class_name('vertical');
        else
            this.actor.remove_style_class_name('vertical');

        this._layout.vertical = vertical;
        const orientation = vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL;
        for (const box of [this._startInner, this._startBox, this._middle, this._centerBox, this._endBox])
            box.orientation = orientation;
        this.apps.setVertical(vertical);
        this._lockActions.setVertical(vertical);
        this._syncTrayOrientation();

        const side = MENU_SIDE[this.position];
        for (const indicator of Object.values(this._panel.statusArea))
            _setMenuSide(indicator, side);

        this._syncSize();
        this._layout.layout_changed();
        this._reposition();
        this._syncDate();
        this._updateTime();
        this._updateHotEdge();
        this.emitChanged();
    }

    // Толщина полки (в логических пикселях из настроек).
    _syncSize() {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const size = this.settings.get_int('shelf-size') * scale;
        if (this.vertical)
            this.actor.set_size(size, -1);
        else
            this.actor.set_size(-1, size);
        this._reposition();
    }

    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || this._repositioning)
            return;
        this._repositioning = true;
        const box = this._panelBox;
        if (this.vertical) {
            box.set_size(-1, monitor.height);
            const x = this.position === 'left' ? monitor.x : monitor.x + monitor.width - box.width;
            box.set_position(x, monitor.y);
        } else {
            box.set_size(monitor.width, -1);
            const y = this.position === 'top' ? monitor.y : monitor.y + monitor.height - box.height;
            box.set_position(monitor.x, y);
        }
        this._repositioning = false;
        this._updateHotEdge();
        this.apps.updateIconGeometry();
    }

    _syncAlignment() {
        this._layout.centered = this.settings.get_string('shelf-alignment') !== 'start';
        this._layout.layout_changed();
    }

    _syncStyle() {
        const floating = this.settings.get_string('shelf-style') === 'floating';
        if (floating)
            this.actor.add_style_class_name('floating');
        else
            this.actor.remove_style_class_name('floating');

        for (const kind of ['dot', 'line', 'none'])
            this.actor.remove_style_class_name(`indicator-${kind}`);
        this.actor.add_style_class_name(`indicator-${this.settings.get_string('shelf-running-indicator')}`);

        this._blurOn = this.settings.get_boolean('shelf-blur') && !this.settings.get_boolean('lite-mode');
        this._syncBackdrop();
    }

    _syncBackdrop() {
        const b = this._backdrop;
        if (!b || !this.actor)
            return;
        b.visible = !!this._blurOn && this.actor.mapped;
        if (!b.visible)
            return;
        const [x, y] = this.actor.get_transformed_position();
        const [w, h] = this.actor.get_transformed_size();
        b.set_position(Math.round(x), Math.round(y));
        b.set_size(Math.round(w), Math.round(h));
        b.opacity = this._panelBox.opacity;
        let radius = 0;
        try {
            radius = this.actor.get_theme_node().get_border_radius(St.Corner.TOPLEFT);
        } catch {}
        b.setCornerRadius(radius);
        b.sync();
    }

    // Уведомление для лаунчера и уведомлений: полка переехала.
    emitChanged() {
        this._launcher?.onShelfChanged?.(this);
        for (const callback of this._changedCallbacks ?? [])
            callback(this);
    }

    connectChanged(callback) {
        (this._changedCallbacks ??= []).push(callback);
    }

    slideIn() {
        const [dx, dy] = this._offscreenOffset();
        this.actor.translation_x = dx;
        this.actor.translation_y = dy;
        this.actor.opacity = 0;
        this.actor.ease({
            translation_x: 0,
            translation_y: 0,
            opacity: 255,
            duration: 450,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    _offscreenOffset() {
        const w = this._panelBox.width, h = this._panelBox.height;
        return {
            bottom: [0, h], top: [0, -h], left: [-w, 0], right: [w, 0],
        }[this.position];
    }

    // ---------- Режимы сеанса: экран блокировки ----------

    _onSessionModeUpdated() {
        this._arrangeTray();
        this._syncSessionMode();
        // Режим сеанса сбрасывает стороны меню индикаторов.
        const side = MENU_SIDE[this.position];
        for (const indicator of Object.values(this._panel.statusArea))
            _setMenuSide(indicator, side);
    }

    _syncSessionMode() {
        const locked = Main.sessionMode.isLocked;
        this.apps.visible = !locked;
        this._lockActions.visible = locked;
        const launcherButton = this._panel.statusArea['hypede-launcher'];
        if (launcherButton)
            launcherButton.container.visible = !locked;
        if (locked) {
            this.actor.add_style_class_name('locked');
            this._launcher?.close();
        } else {
            this.actor.remove_style_class_name('locked');
        }
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
            dateMenu.container.get_parent() !== this._endBox) {
            dateMenu.container.get_parent()?.remove_child(dateMenu.container);
            this._endBox.insert_child_below(dateMenu.container, quickSettings.container);
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
                x_align: Clutter.ActorAlign.CENTER,
            });
            this._timeLabel.clutter_text.line_alignment = 1; // PANGO_ALIGN_CENTER
            quickSettings._indicators.add_child(this._timeLabel);
        }

        this._syncTrayOrientation();
        this._updateTime();
        this._syncDate();
    }

    _syncTrayOrientation() {
        const indicators = this._panel.statusArea.quickSettings?._indicators;
        if (indicators) {
            indicators.orientation = this.vertical
                ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL;
        }
    }

    _restartClock() {
        this._clockId && GLib.source_remove(this._clockId);
        this._clockId = 0;
        const tick = () => {
            this._updateTime();
            const seconds = this._interfaceSettings.get_boolean('clock-show-seconds');
            const now = GLib.DateTime.new_now_local();
            const delay = seconds ? 1000 - Math.floor(now.get_microsecond() / 1000)
                : (60 - now.get_second()) * 1000;
            this._clockId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(delay, 50), () => {
                tick();
                return GLib.SOURCE_REMOVE;
            });
        };
        tick();
    }

    _updateTime() {
        const now = GLib.DateTime.new_now_local();
        if (this._timeLabel) {
            const twelveHour = this._interfaceSettings.get_string('clock-format') === '12h';
            const seconds = this._interfaceSettings.get_boolean('clock-show-seconds');
            const hours = now.format(twelveHour ? '%l' : '%H').trim();
            const minutes = now.format('%M');
            const secs = now.format('%S');
            // На вертикальной полке часы и минуты — друг под другом.
            this._timeLabel.text = this.vertical
                ? [hours, minutes, ...(seconds ? [secs] : [])].join('\n')
                : [hours, minutes, ...(seconds ? [secs] : [])].join(':');
        }
        if (this._dateLabel) {
            // Translators: date on the shelf, strftime format ("Sep 29").
            this._dateLabel.text = now.format(_('%b %-d')).replace(/\.$/, '');
        }
    }

    _syncDate() {
        if (this._dateMenu) {
            this._dateMenu.container.visible = !Main.sessionMode.isLocked &&
                this.settings.get_boolean('show-date') && !this.vertical;
        }
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
        const enabled = this.settings.get_boolean('shelf-autohide');
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
            this.actor.track_hover = true;
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
        switch (this.position) {
        case 'top':
            this._hotEdge.set_position(monitor.x, monitor.y);
            this._hotEdge.set_size(monitor.width, 1);
            break;
        case 'left':
            this._hotEdge.set_position(monitor.x, monitor.y);
            this._hotEdge.set_size(1, monitor.height);
            break;
        case 'right':
            this._hotEdge.set_position(monitor.x + monitor.width - 1, monitor.y);
            this._hotEdge.set_size(1, monitor.height);
            break;
        default:
            this._hotEdge.set_position(monitor.x, monitor.y + monitor.height - 1);
            this._hotEdge.set_size(monitor.width, 1);
        }
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
        if (this.actor.hover || Main.overview.visible || Main.sessionMode.isLocked)
            return true;
        if (this._panel.menuManager.activeMenu || this.apps.anyMenuOpen)
            return true;
        if (this._launcher.isOpen)
            return true;

        // Прячемся, только если какое-нибудь окно заходит на полку.
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return true;
        const box = this._panelBox;
        const shelfRect = new Mtk.Rectangle({
            x: Math.round(box.x), y: Math.round(box.y),
            width: Math.round(box.width), height: Math.round(box.height),
        });
        const workspace = global.workspace_manager.get_active_workspace();
        return !workspace.list_windows().some(w =>
            w.get_monitor() === monitor.index &&
            w.showing_on_its_workspace() &&
            w.get_window_type() === Meta.WindowType.NORMAL &&
            w.get_frame_rect().overlap(shelfRect));
    }

    _checkAutohide() {
        this._setHidden(!this._shouldStayVisible());
    }

    _setHidden(hidden) {
        if (hidden === this._hidden)
            return;
        this._hidden = hidden;
        const [dx, dy] = hidden ? this._offscreenOffset() : [0, 0];
        this._panelBox.ease({
            translation_x: dx,
            translation_y: dy,
            duration: AUTOHIDE_ANIMATION_TIME,
            mode: hidden ? Clutter.AnimationMode.EASE_IN_QUAD : Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    destroy() {
        this.settings.disconnectObject(this);
        St.ThemeContext.get_for_stage(global.stage).disconnectObject(this);
        Main.sessionMode.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        this._panelBox.disconnectObject(this);
        this._interfaceSettings.disconnectObject(this);
        if (this._clockId)
            GLib.source_remove(this._clockId);
        this._clockId = 0;

        if (this._autohide) {
            this._stopAutohide();
            Main.layoutManager.untrackChrome(this._panelBox);
            Main.layoutManager.trackChrome(this._panelBox, {
                affectsStruts: true,
                trackFullscreen: true,
            });
        }
        this._panelBox.remove_all_transitions();
        this._panelBox.translation_x = 0;
        this._panelBox.translation_y = 0;

        this._restoreSettingsButton();

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

        // Ячейки — обратно в панель GNOME, в исходном порядке и виде.
        for (const box of [this._startBox, this._centerBox, this._endBox]) {
            box.get_parent()?.remove_child(box);
            box.orientation = Clutter.Orientation.HORIZONTAL;
            this._panel.add_child(box);
        }
        const indicators = this._panel.statusArea.quickSettings?._indicators;
        if (indicators)
            indicators.orientation = Clutter.Orientation.HORIZONTAL;

        Main.ctrlAltTabManager.removeGroup(this.actor);
        this._panelBox.disconnectObject(this);
        if (this._backdropLater)
            global.compositor.get_laters().remove(this._backdropLater);
        this._backdrop.destroy();
        this._backdrop = null;
        this.actor.destroy();
        this.actor = null;
        this._panel.show();

        this._injections.clear();
        for (const indicator of Object.values(this._panel.statusArea))
            _setMenuSide(indicator, St.Side.TOP);

        // Вернуть панель наверх и индикаторы — по местам, как велит режим.
        Main.layoutManager._updateBoxes();
        Main.layoutManager._updatePanelBarrier();
        this._panelBox.set_size(-1, -1);
        Main.layoutManager._updateBoxes();
        this._panel._updatePanel();
    }
}
