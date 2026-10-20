// Авто-тайлинг, как в COSMIC, Hyprland (dwindle) и Niri: окна рабочего
// стола сами делят экран — первое занимает половину, следующие делят
// оставшееся пополам, по очереди по ширине и по высоте. Super+T включает
// и выключает раскладку для текущего стола. Окно, перетащенное мышью на
// место другого, меняется с ним местами; плавающие (Super+Z), диалоги и
// окна во весь экран в раскладку не входят.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {isDesktopWindow, showOsd, unmaximizeWindow} from './util.js';

const GAP = 8;

export class AutoTiling {
    constructor(settings) {
        this._settings = settings;
        // Рабочие столы с раскладкой и порядок окон в ней.
        this._tiled = new Set();
        this._order = new Map();
        if (settings.get_boolean('auto-tile'))
            this._tiled.add(global.workspace_manager.get_active_workspace());

        // Переключатель в Настройках — сразу для всех столов.
        settings.connectObject('changed::auto-tile', () => {
            this._tiled.clear();
            if (settings.get_boolean('auto-tile')) {
                for (let i = 0; i < global.workspace_manager.get_n_workspaces(); i++)
                    this._tiled.add(global.workspace_manager.get_workspace_by_index(i));
            }
            this._retileAll();
        }, this);
        Main.wm.addKeybinding('toggle-tiling', settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL,
            () => this._toggle());
        global.display.connectObject(
            'window-created', (_d, win) => this._watch(win),
            'grab-op-end', (_d, win) => this._dropped(win),
            'workareas-changed', () => this._retileAll(),
            this);
        global.workspace_manager.connectObject('active-workspace-changed', () => {
            // Новый стол наследует раскладку, если она включена по умолчанию.
            const ws = global.workspace_manager.get_active_workspace();
            if (this._settings.get_boolean('auto-tile') && !this._seen?.has(ws))
                this._tiled.add(ws);
            (this._seen ??= new Set()).add(ws);
        }, this);
        for (const actor of global.get_window_actors())
            this._watch(actor.meta_window);
        this._retileAll();
    }

    _tileable(win) {
        return win && win.get_window_type() === Meta.WindowType.NORMAL && !isDesktopWindow(win) &&
            !win.is_above() && !win.fullscreen && !win.minimized && !win.get_transient_for() &&
            !win.is_on_all_workspaces() && win.allows_resize() && win.get_workspace();
    }

    _watch(win) {
        if (!win || win._hypedeTiling)
            return;
        win._hypedeTiling = true;
        const later = () => this._schedule();
        win.connectObject(
            'shown', later,
            'workspace-changed', later,
            'notify::minimized', later,
            'notify::above', later,
            'notify::fullscreen', later,
            'unmanaged', () => {
                win.disconnectObject(this);
                later();
            }, this);
        later();
    }

    _schedule() {
        if (this._idle)
            return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this._retileAll();
            return GLib.SOURCE_REMOVE;
        });
    }

    _toggle() {
        const ws = global.workspace_manager.get_active_workspace();
        if (this._tiled.has(ws)) {
            this._tiled.delete(ws);
            showOsd(Gio.ThemedIcon.new('view-restore-symbolic'), _('Auto-tiling off'));
        } else {
            this._tiled.add(ws);
            showOsd(Gio.ThemedIcon.new('view-grid-symbolic'), _('Auto-tiling on'));
        }
        this._retileAll();
    }

    // Окна стола на мониторе в порядке раскладки: старые — в прежнем
    // порядке, новые — в конец.
    _windows(ws, monitor) {
        const present = ws.list_windows().filter(w => this._tileable(w) && w.get_monitor() === monitor);
        const key = `${ws.index()}:${monitor}`;
        const order = (this._order.get(key) ?? []).filter(w => present.includes(w));
        for (const win of present.sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence())) {
            if (!order.includes(win))
                order.push(win);
        }
        this._order.set(key, order);
        return order;
    }

    _slots(area, count) {
        const slots = [];
        let rest = {x: area.x + GAP, y: area.y + GAP, width: area.width - 2 * GAP, height: area.height - 2 * GAP};
        for (let i = 0; i < count; i++) {
            if (i === count - 1) {
                slots.push(rest);
                break;
            }
            // Делим по длинной стороне, как dwindle в Hyprland.
            const wide = rest.width >= rest.height;
            const half = Math.floor(((wide ? rest.width : rest.height) - GAP) / 2);
            if (wide) {
                slots.push({x: rest.x, y: rest.y, width: half, height: rest.height});
                rest = {x: rest.x + half + GAP, y: rest.y, width: rest.width - half - GAP, height: rest.height};
            } else {
                slots.push({x: rest.x, y: rest.y, width: rest.width, height: half});
                rest = {x: rest.x, y: rest.y + half + GAP, width: rest.width, height: rest.height - half - GAP};
            }
        }
        return slots;
    }

    _retileAll() {
        for (const ws of this._tiled) {
            if (ws.index() < 0) {
                this._tiled.delete(ws);
                continue;
            }
            for (let monitor = 0; monitor < global.display.get_n_monitors(); monitor++)
                this._retile(ws, monitor);
        }
    }

    _retile(ws, monitor) {
        const windows = this._windows(ws, monitor);
        const slots = this._slots(ws.get_work_area_for_monitor(monitor), windows.length);
        windows.forEach((win, i) => {
            if (win.maximized_horizontally || win.maximized_vertically)
                unmaximizeWindow(win);
            const r = slots[i];
            const f = win.get_frame_rect();
            if (f.x !== r.x || f.y !== r.y || f.width !== r.width || f.height !== r.height)
                win.move_resize_frame(true, r.x, r.y, r.width, r.height);
        });
    }

    // Окно перетащили: если отпустили над другим окном раскладки — меняем
    // их местами, иначе возвращаем окно на его место.
    _dropped(win) {
        const ws = win?.get_workspace();
        if (!ws || !this._tiled.has(ws) || !this._tileable(win))
            return;
        const monitor = win.get_monitor();
        const key = `${ws.index()}:${monitor}`;
        const order = this._windows(ws, monitor);
        const [x, y] = global.get_pointer();
        const target = order.find(w => {
            if (w === win)
                return false;
            const r = w.get_frame_rect();
            return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
        });
        if (target) {
            const a = order.indexOf(win), b = order.indexOf(target);
            [order[a], order[b]] = [order[b], order[a]];
            this._order.set(key, order);
        }
        this._schedule();
    }

    destroy() {
        Main.wm.removeKeybinding('toggle-tiling');
        this._settings.disconnectObject(this);
        if (this._idle)
            GLib.source_remove(this._idle);
        global.display.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        for (const actor of global.get_window_actors()) {
            actor.meta_window?.disconnectObject(this);
            if (actor.meta_window)
                actor.meta_window._hypedeTiling = false;
        }
    }
}
