// Закрыт ли рабочий стол окнами: развёрнутым или полноэкранным окном на
// мониторе, обзором или экраном блокировки. Живым обоям и видео незачем
// работать, когда их никто не видит.

import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class CoverWatcher {
    // callback(covered: boolean[]) — по индексу монитора.
    constructor(callback) {
        this._callback = callback;
        this._last = '';
        this._windows = new Map();
        const queue = () => this._queue();

        global.display.connectObject(
            'restacked', queue,
            'window-created', (_d, win) => this._track(win),
            'notify::focus-window', queue,
            this);
        global.workspace_manager.connectObject('active-workspace-changed', queue, this);
        Main.overview.connectObject('showing', queue, 'hidden', queue, this);
        Main.sessionMode.connectObject('updated', queue, this);
        Main.layoutManager.connectObject('monitors-changed', queue, this);
        for (const actor of global.get_window_actors())
            this._track(actor.meta_window);
        this._update();
    }

    _track(win) {
        if (this._windows.has(win))
            return;
        const ids = [
            win.connect('notify::maximized-horizontally', () => this._queue()),
            win.connect('notify::maximized-vertically', () => this._queue()),
            win.connect('notify::fullscreen', () => this._queue()),
            win.connect('notify::minimized', () => this._queue()),
            win.connect('workspace-changed', () => this._queue()),
            win.connect('unmanaged', () => {
                this._untrack(win);
                this._queue();
            }),
        ];
        this._windows.set(win, ids);
    }

    _untrack(win) {
        for (const id of this._windows.get(win) ?? [])
            win.disconnect(id);
        this._windows.delete(win);
    }

    _queue() {
        if (this._idleId)
            return;
        this._idleId = setTimeout(() => {
            this._idleId = 0;
            this._update();
        }, 150);
    }

    get covered() {
        return this._covered ?? [];
    }

    _update() {
        const monitors = Main.layoutManager.monitors;
        const hidden = Main.overview.visible || Main.sessionMode.isLocked;
        const workspace = global.workspace_manager.get_active_workspace();
        const covered = monitors.map(() => hidden);
        if (!hidden) {
            for (const actor of global.get_window_actors()) {
                const win = actor.meta_window;
                if (!win || win.minimized || !win.located_on_workspace(workspace) || win.is_hidden())
                    continue;
                if (win.window_type !== Meta.WindowType.NORMAL)
                    continue;
                const full = win.fullscreen || (win.maximized_horizontally && win.maximized_vertically);
                if (full && win.get_monitor() >= 0)
                    covered[win.get_monitor()] = true;
            }
        }
        const key = covered.join(',');
        if (key === this._last)
            return;
        this._last = key;
        this._covered = covered;
        this._callback(covered);
    }

    destroy() {
        if (this._idleId)
            clearTimeout(this._idleId);
        global.display.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        Main.overview.disconnectObject(this);
        Main.sessionMode.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        for (const win of [...this._windows.keys()])
            this._untrack(win);
    }
}
