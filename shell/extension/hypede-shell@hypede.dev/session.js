import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import {InjectionManager, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {isDesktopWindow} from './util.js';

const FILE = GLib.build_filenamev([GLib.get_user_state_dir(), 'hypede', 'session.json']);

let instance = null;
export const getSession = () => instance;

function read() {
    try {
        const list = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(FILE)[1]));
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

export class SessionKeeper {
    constructor(settings) {
        instance = this;
        this._settings = settings;
        this._previous = read();
        this._ready = false;
        this._frozen = false;
        this._pending = new Map();
        this._injections = new InjectionManager();

        const self = this;
        const freeze = name => this._injections.overrideMethod(SystemActions.getDefault(), name, original => function (...args) {
            self.save();
            self._frozen = true;
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 120, () => {
                self._frozen = false;
                return GLib.SOURCE_REMOVE;
            });
            return original.apply(this, args);
        });
        for (const name of ['activateLogout', 'activatePowerOff', 'activateRestart', 'activateSwitchUser'])
            freeze(name);

        global.display.connectObject('window-created', (_d, win) => this._track(win), this);
        global.window_manager.connectObject('size-change', () => this._queue(), 'switch-workspace', () => this._queue(), this);
        for (const actor of global.get_window_actors())
            this._track(actor.meta_window);

        if (Main.layoutManager._startingUp)
            Main.layoutManager.connectObject('startup-complete', () => this._offer(), this);
        else
            this._ready = true;
    }

    _offer() {
        Main.layoutManager.disconnectObject(this);
        const mode = this._settings.get_string('session-restore');
        const windows = this._previous.length;
        if (!windows || mode === 'never') {
            this._ready = true;
            return;
        }
        if (mode === 'always') {
            this.restore();
            return;
        }
        const source = MessageTray.getSystemSource();
        const notification = new MessageTray.Notification({
            source,
            title: _('Restore your windows?'),
            body: _('%d windows were open when you left').format(windows),
            iconName: 'view-restore-symbolic',
        });
        notification.addAction(_('Restore'), () => this.restore());
        notification.addAction(_('No thanks'), () => (this._ready = true));
        notification.connect('destroy', () => (this._ready = true));
        source.addNotification(notification);
    }

    _usable(win) {
        if (!win || win.window_type !== Meta.WindowType.NORMAL || win.skip_taskbar || isDesktopWindow(win))
            return null;
        const app = Shell.WindowTracker.get_default().get_window_app(win);
        return app && !app.is_window_backed() ? app : null;
    }

    _track(win) {
        if (!win || win._hypedeSession)
            return;
        win._hypedeSession = true;
        win.connectObject('unmanaged', () => this._queue(), 'workspace-changed', () => this._queue(), this);
        win.connectObject('shown', () => {
            const app = this._usable(win);
            const entry = app ? this._pending.get(app.get_id())?.shift() : null;
            if (!entry)
                return;
            for (const delay of [100, 600]) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                    this._place(win, entry);
                    return GLib.SOURCE_REMOVE;
                });
            }
        }, this);
        this._queue();
    }

    _place(win, e) {
        if (e.ws >= 0) {
            while (global.workspace_manager.n_workspaces <= e.ws)
                global.workspace_manager.append_new_workspace(false, global.get_current_time());
            win.change_workspace_by_index(e.ws, false);
        }
        if (e.max) {
            win.maximize(Meta.MaximizeFlags.BOTH);
        } else if (e.rect) {
            const [x, y, w, h] = e.rect;
            win.move_resize_frame(true, x, y, w, h);
        }
    }

    _queue() {
        if (!this._ready || this._frozen || this._saveId)
            return;
        this._saveId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 4, () => {
            this._saveId = 0;
            this.save();
            return GLib.SOURCE_REMOVE;
        });
    }

    snapshot() {
        const out = [];
        for (const win of global.display.list_all_windows()) {
            const app = this._usable(win);
            if (!app)
                continue;
            const r = win.get_frame_rect();
            out.push({app: app.get_id(), ws: win.get_workspace()?.index() ?? -1, rect: [r.x, r.y, r.width, r.height],
                max: !!(win.maximized_horizontally && win.maximized_vertically), seq: win.get_stable_sequence()});
        }
        return out.sort((a, b) => a.seq - b.seq).map(({seq: _s, ...e}) => e);
    }

    save() {
        if (!this._ready || this._frozen)
            return;
        GLib.mkdir_with_parents(GLib.path_get_dirname(FILE), 0o700);
        GLib.file_set_contents(FILE, JSON.stringify(this.snapshot()));
    }

    restore(entries = this._previous) {
        this._ready = true;
        const running = new Set(this.snapshot().map(e => e.app));
        let count = 0;
        for (const entry of entries) {
            const app = Shell.AppSystem.get_default().lookup_app(entry.app);
            if (!app || running.has(entry.app) && !this._pending.has(entry.app))
                continue;
            if (!this._pending.has(entry.app))
                this._pending.set(entry.app, []);
            const queue = this._pending.get(entry.app);
            queue.push(entry);
            if (queue.length === 1)
                app.activate();
            else
                app.open_new_window(-1);
            count++;
        }
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            this._pending.clear();
            return GLib.SOURCE_REMOVE;
        });
        return count;
    }

    destroy() {
        if (this._saveId)
            GLib.source_remove(this._saveId);
        this._injections.clear();
        global.display.disconnectObject(this);
        global.window_manager.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        for (const actor of global.get_window_actors()) {
            actor.meta_window?.disconnectObject(this);
            if (actor.meta_window)
                actor.meta_window._hypedeSession = false;
        }
        instance = null;
    }
}
