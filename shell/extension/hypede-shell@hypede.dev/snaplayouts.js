// Меню раскладок, как в Chrome OS: если задержать указатель на кнопке
// «во весь экран» в заголовке окна на 2 секунды (просто навести или
// зажать кнопку), под ней появляется меню. В нём — схемы экрана
// («пополам», «2/3 и 1/3», «три колонки», «четверти»…): щелчок по
// части схемы ставит окно на это место. Ниже — «Во весь экран» и
// «Плавающее окно».
//
// Кнопки заголовка рисует само приложение (GTK, Qt) или Mutter, и
// оболочка не получает событий от них. Поэтому место кнопки вычисляется:
// порядок кнопок берётся из org.gnome.desktop.wm.preferences
// button-layout, а размеры — типичные для Adwaita, GTK 3 и рамок Mutter.
// Указатель отслеживается через PointerWatcher оболочки (он опрашивает
// положение, только пока мышь двигается), задержку отсчитывает таймер.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getPointerWatcher} from 'resource:///org/gnome/shell/ui/pointerWatcher.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {toggleFloat} from './extras.js';
import {isDesktopWindow, maximizeWindow, unmaximizeWindow} from './util.js';

const WATCH_INTERVAL = 100;
// Заголовок и кнопки в логических пикселях: высота полосы заголовка,
// ширина места под одну кнопку, отступ от края окна и допуск.
const TITLEBAR = 50;
const BUTTON = 34;
const EDGE = 6;
const SLACK = 4;
// Схема экрана в меню.
const CARD_W = 92;
const CARD_H = 58;
const INSET = 4;

// Части экрана: [x, y, ширина, высота] в долях рабочей области.
function layouts() {
    return [
        {label: _('Halves'), zones: [[0, 0, 1 / 2, 1], [1 / 2, 0, 1 / 2, 1]]},
        {label: _('Two thirds and one third'), zones: [[0, 0, 2 / 3, 1], [2 / 3, 0, 1 / 3, 1]]},
        {label: _('One third and two thirds'), zones: [[0, 0, 1 / 3, 1], [1 / 3, 0, 2 / 3, 1]]},
        {label: _('Three columns'), zones: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]]},
        {label: _('Half and two quarters'), zones: [[0, 0, 1 / 2, 1], [1 / 2, 0, 1 / 2, 1 / 2], [1 / 2, 1 / 2, 1 / 2, 1 / 2]]},
        {label: _('Quarters'), zones: [[0, 0, 1 / 2, 1 / 2], [1 / 2, 0, 1 / 2, 1 / 2], [0, 1 / 2, 1 / 2, 1 / 2], [1 / 2, 1 / 2, 1 / 2, 1 / 2]]},
    ];
}

function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

// Поставить окно в часть рабочей области монитора.
export function placeWindow(win, [fx, fy, fw, fh]) {
    if (win._hypedeFloat) {
        win._hypedeFloat = null;
        win.unmake_above();
    }
    if (win.fullscreen)
        win.unmake_fullscreen();
    if (win.maximized_horizontally || win.maximized_vertically)
        unmaximizeWindow(win);
    const area = Main.layoutManager.getWorkAreaForMonitor(win.get_monitor());
    // Края считаем от долей, чтобы соседние части сходились без щелей.
    const x1 = area.x + Math.round(area.width * fx), x2 = area.x + Math.round(area.width * (fx + fw));
    const y1 = area.y + Math.round(area.height * fy), y2 = area.y + Math.round(area.height * (fy + fh));
    win.move_resize_frame(true, x1, y1, x2 - x1, y2 - y1);
    win.activate(global.get_current_time());
}

// Где у окна кнопка «во весь экран»: прямоугольник в координатах экрана
// или null, если кнопки нет.
function maximizeButtonRect(win, layout) {
    const [left = '', right = ''] = layout.split(':');
    const names = side => side.split(',').map(s => s.trim()).filter(s => ['minimize', 'maximize', 'close'].includes(s));
    const scale = scaleFactor();
    const f = win.get_frame_rect();
    const slot = BUTTON * scale, edge = EDGE * scale;
    const rightButtons = names(right);
    const leftButtons = names(left);
    let x;
    if (rightButtons.includes('maximize')) {
        const fromEnd = rightButtons.length - 1 - rightButtons.indexOf('maximize');
        x = f.x + f.width - edge - (fromEnd + 1) * slot;
    } else if (leftButtons.includes('maximize')) {
        x = f.x + edge + leftButtons.indexOf('maximize') * slot;
    } else {
        return null;
    }
    return {x: x - SLACK * scale, y: f.y, width: slot + 2 * SLACK * scale, height: TITLEBAR * scale};
}

function inside(r, x, y) {
    return r && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
}

// Верхнее обычное окно под указателем на текущем столе.
function windowAt(x, y) {
    const ws = global.workspace_manager.get_active_workspace();
    const windows = global.display.sort_windows_by_stacking(
        ws.list_windows().filter(w => w.showing_on_its_workspace() && !w.minimized));
    for (let i = windows.length - 1; i >= 0; i--) {
        const win = windows[i];
        if (inside(win.get_frame_rect(), x, y))
            return win.get_window_type() === Meta.WindowType.NORMAL && !isDesktopWindow(win) ? win : null;
    }
    return null;
}

class SnapMenu {
    constructor(win, anchor, onClosed) {
        this._win = win;
        this._onClosed = onClosed;
        this._openedAt = GLib.get_monotonic_time();

        // Прозрачная подложка на весь экран: щелчок мимо меню закрывает его.
        this._backdrop = new St.Widget({reactive: true, x: 0, y: 0, width: global.stage.width, height: global.stage.height});
        this._backdrop.connect('button-press-event', () => {
            this.close();
            return Clutter.EVENT_STOP;
        });
        this._backdrop.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // Меню лежит внутри подложки: модальный захват отдаёт события только
        // ей и её детям. Нажатие на само меню до подложки не доходит.
        this.actor = new St.BoxLayout({
            style_class: 'hypede-snap-menu',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
            opacity: 0,
        });
        this.actor.connect('button-press-event', () => Clutter.EVENT_STOP);
        this.actor.add_child(new St.Label({text: _('Window layout'), style_class: 'hypede-snap-title'}));

        const grid = new St.BoxLayout({style_class: 'hypede-snap-grid', orientation: Clutter.Orientation.VERTICAL});
        const all = layouts();
        for (let row = 0; row < all.length; row += 3) {
            const line = new St.BoxLayout({style_class: 'hypede-snap-row'});
            for (const layout of all.slice(row, row + 3))
                line.add_child(this._card(layout));
            grid.add_child(line);
        }
        this.actor.add_child(grid);

        const actions = new St.BoxLayout({style_class: 'hypede-snap-actions'});
        actions.add_child(this._action('window-maximize-symbolic', _('Full screen'), () => {
            if (this._win._hypedeFloat)
                toggleFloat(this._win);
            maximizeWindow(this._win);
        }));
        actions.add_child(this._action('view-pin-symbolic', this._win._hypedeFloat ? _('Stop floating') : _('Float'),
            () => toggleFloat(this._win)));
        this.actor.add_child(actions);

        this._backdrop.add_child(this.actor);
        Main.layoutManager.uiGroup.add_child(this._backdrop);
        this._position(anchor);

        this._grab = Main.pushModal(this._backdrop);
        // Окно закрылось или ушло на другой стол — меню больше не нужно.
        win.connectObject('unmanaged', () => this.close(), 'workspace-changed', () => this.close(), this);

        this.actor.set_pivot_point(0.5, 0);
        this.actor.scale_x = this.actor.scale_y = 0.92;
        this.actor.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._backdrop.grab_key_focus();
    }

    // Схема экрана; каждая её часть — кнопка.
    _card(layout) {
        const scale = scaleFactor();
        const card = new St.Widget({
            style_class: 'hypede-snap-card',
            width: CARD_W * scale,
            height: CARD_H * scale,
            accessible_name: layout.label,
        });
        const w = (CARD_W - 2 * INSET) * scale, h = (CARD_H - 2 * INSET) * scale, gap = 3 * scale;
        for (const zone of layout.zones) {
            const [fx, fy, fw, fh] = zone;
            const x1 = Math.round(INSET * scale + w * fx), x2 = Math.round(INSET * scale + w * (fx + fw));
            const y1 = Math.round(INSET * scale + h * fy), y2 = Math.round(INSET * scale + h * (fy + fh));
            // Половина зазора с каждой внутренней стороны.
            const left = fx > 0 ? gap / 2 : 0, right = fx + fw < 1 ? gap / 2 : 0;
            const top = fy > 0 ? gap / 2 : 0, bottom = fy + fh < 1 ? gap / 2 : 0;
            const button = new St.Button({
                style_class: 'hypede-snap-zone',
                can_focus: true,
                x: x1 + left,
                y: y1 + top,
                width: Math.max(1, x2 - x1 - left - right),
                height: Math.max(1, y2 - y1 - top - bottom),
                accessible_name: layout.label,
            });
            button.connect('clicked', () => this._choose(() => placeWindow(this._win, zone)));
            card.add_child(button);
        }
        return card;
    }

    _action(iconName, text, callback) {
        const box = new St.BoxLayout({style_class: 'hypede-snap-action-box', x_align: Clutter.ActorAlign.CENTER});
        box.add_child(new St.Icon({icon_name: iconName, style_class: 'hypede-snap-action-icon'}));
        box.add_child(new St.Label({text, y_align: Clutter.ActorAlign.CENTER}));
        const button = new St.Button({style_class: 'hypede-snap-action', can_focus: true, x_expand: true, child: box});
        button.connect('clicked', () => this._choose(callback));
        return button;
    }

    _choose(callback) {
        // Отпускание кнопки, которой держали «во весь экран», — не выбор.
        if (GLib.get_monotonic_time() - this._openedAt < 250000)
            return;
        const win = this._win;
        this.close();
        if (win.get_workspace())
            callback();
    }

    // Под кнопкой «во весь экран», не выходя за монитор.
    _position(anchor) {
        const [, natW] = this.actor.get_preferred_width(-1);
        const [, natH] = this.actor.get_preferred_height(natW);
        const monitor = Main.layoutManager.monitors[this._win.get_monitor()] ?? Main.layoutManager.primaryMonitor;
        const margin = 8 * scaleFactor();
        let x = Math.round(anchor.x + anchor.width / 2 - natW / 2);
        let y = Math.round(anchor.y + anchor.height);
        x = Math.max(monitor.x + margin, Math.min(x, monitor.x + monitor.width - natW - margin));
        if (y + natH > monitor.y + monitor.height - margin)
            y = Math.max(monitor.y + margin, anchor.y - natH);
        this.actor.set_position(x, y);
    }

    close() {
        if (!this.actor)
            return;
        this._win?.disconnectObject(this);
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        const backdrop = this._backdrop;
        this.actor = null;
        this._backdrop = null;
        backdrop.reactive = false;
        backdrop.ease({
            opacity: 0,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => backdrop.destroy(),
        });
        this._onClosed?.();
    }
}

export class SnapLayouts {
    constructor(settings) {
        this._settings = settings;
        this._wm = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
        this._layout = this._wm.get_string('button-layout');
        this._wm.connectObject('changed::button-layout', () => {
            this._layout = this._wm.get_string('button-layout');
        }, this);
        settings.connectObject('changed::snap-menu', () => this._sync(), this);
        // Пока окно перетаскивают или тянут за край, меню не нужно.
        this._dragging = false;
        global.display.connectObject(
            'grab-op-begin', () => {
                this._dragging = true;
                this._cancel();
            },
            'grab-op-end', () => {
                this._dragging = false;
            }, this);
        this._sync();
    }

    _sync() {
        const enabled = this._settings.get_boolean('snap-menu');
        if (enabled && !this._watch)
            this._watch = getPointerWatcher().addWatch(WATCH_INTERVAL, (x, y) => this._moved(x, y));
        else if (!enabled && this._watch)
            this._stopWatching();
    }

    _stopWatching() {
        this._watch?.remove();
        this._watch = null;
        this._cancel();
    }

    _target(x, y) {
        if (this._menu || this._dragging || Main.modalCount > 0 || Main.overview.visible)
            return null;
        const win = windowAt(x, y);
        if (!win || win.fullscreen || !win.can_maximize())
            return null;
        const rect = maximizeButtonRect(win, this._layout);
        return inside(rect, x, y) ? {win, rect} : null;
    }

    _moved(x, y) {
        const target = this._target(x, y);
        if (!target) {
            this._cancel();
            return;
        }
        // Указатель гуляет по той же кнопке — отсчёт продолжается.
        if (this._pending?.win === target.win)
            return;
        this._cancel();
        this._pending = target;
        const delay = Math.max(300, this._settings.get_int('snap-menu-delay'));
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timer = 0;
            const [px, py] = global.get_pointer();
            const now = this._target(px, py);
            if (now && now.win === this._pending?.win)
                this._open(now);
            this._pending = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancel() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        this._pending = null;
    }

    _open({win, rect}) {
        this._menu = new SnapMenu(win, rect, () => {
            this._menu = null;
        });
    }

    destroy() {
        this._stopWatching();
        this._menu?.close();
        this._menu = null;
        this._settings.disconnectObject(this);
        global.display.disconnectObject(this);
        this._wm.disconnectObject(this);
        this._wm = null;
    }
}
