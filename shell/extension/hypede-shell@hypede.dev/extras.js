import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {getAssistant} from './assistant.js';
import {isDesktopWindow} from './util.js';

const HISTORY = 25;
const CLOSED = 10;

export class Extras {
    constructor(settings) {
        this._settings = settings;
        this._clips = [];
        this._closed = [];
        this._pending = null;
        this._clipboard = St.Clipboard.get_default();

        global.display.get_selection().connectObject('owner-changed', (_s, type) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD)
                this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_c, text) => this._remember(text));
        }, this);
        global.display.connectObject('window-created', (_d, win) => this._watch(win), this);
        for (const actor of global.get_window_actors())
            this._watch(actor.meta_window);

        const bind = (key, fn) => Main.wm.addKeybinding(key, settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL, fn);
        bind('clipboard-history', () => this._showClipboard());
        bind('float-window', () => this._toggleFloat());
        bind('reopen-window', () => this._reopen());
        bind('ask-selection', () => this._askSelection());
    }

    _remember(text) {
        if (!text || !text.trim() || text.length > 100000)
            return;
        this._clips = [text, ...this._clips.filter(t => t !== text)].slice(0, HISTORY);
    }

    _showClipboard() {
        const dialog = new ModalDialog.ModalDialog({styleClass: 'hypede-clipboard'});
        const title = new St.Label({text: _('Clipboard'), style_class: 'hypede-clipboard-title'});
        dialog.contentLayout.add_child(title);
        if (this._clips.length === 0) {
            dialog.contentLayout.add_child(new St.Label({text: _('Copy something — it will show up here'), style_class: 'hypede-clipboard-empty'}));
        } else {
            const list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'hypede-clipboard-list'});
            const scroll = new St.ScrollView({child: list, style_class: 'hypede-clipboard-scroll', hscrollbar_policy: St.PolicyType.NEVER});
            for (const text of this._clips) {
                const label = new St.Label({text: text.replace(/\s+/g, ' ').trim().slice(0, 140), x_align: Clutter.ActorAlign.START});
                label.clutter_text.ellipsize = 3;
                const button = new St.Button({style_class: 'hypede-clipboard-item', can_focus: true, x_expand: true, child: label});
                button.connect('clicked', () => {
                    dialog.close();
                    this._paste(text);
                });
                list.add_child(button);
            }
            dialog.contentLayout.add_child(scroll);
            dialog.setInitialKeyFocus(list.get_first_child());
        }
        dialog.addButton({label: _('Clear'), action: () => {
            this._clips = [];
            dialog.close();
        }});
        dialog.addButton({label: _('Close'), action: () => dialog.close(), key: Clutter.KEY_Escape});
        dialog.open();
    }

    _paste(text) {
        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            const seat = Clutter.get_default_backend().get_default_seat();
            this._keyboard ??= seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
            const t = GLib.get_monotonic_time();
            this._keyboard.notify_keyval(t, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
            this._keyboard.notify_keyval(t, Clutter.KEY_v, Clutter.KeyState.PRESSED);
            this._keyboard.notify_keyval(t, Clutter.KEY_v, Clutter.KeyState.RELEASED);
            this._keyboard.notify_keyval(t, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
            return GLib.SOURCE_REMOVE;
        });
    }

    _toggleFloat() {
        const win = global.display.focus_window;
        if (!win || win.window_type !== Meta.WindowType.NORMAL)
            return;
        if (win._hypedeFloat) {
            const r = win._hypedeFloat;
            win._hypedeFloat = null;
            win.unmake_above();
            win.move_resize_frame(true, r.x, r.y, r.width, r.height);
            return;
        }
        win._hypedeFloat = win.get_frame_rect();
        if (win.get_maximized?.() || win.maximized_horizontally)
            win.unmaximize(Meta.MaximizeFlags.BOTH);
        const area = Main.layoutManager.getWorkAreaForMonitor(win.get_monitor());
        const w = Math.round(area.width * 0.36), h = Math.round(area.height * 0.42);
        win.make_above();
        win.move_resize_frame(true, area.x + area.width - w - 16, area.y + area.height - h - 16, w, h);
    }

    _watch(win) {
        if (!win || win._hypedeWatched)
            return;
        win._hypedeWatched = true;
        win.connectObject('unmanaging', () => {
            if (win.window_type !== Meta.WindowType.NORMAL || isDesktopWindow(win) || win.skip_taskbar)
                return;
            const app = Shell.WindowTracker.get_default().get_window_app(win);
            if (!app || app.is_window_backed())
                return;
            this._closed = [{app: app.get_id(), rect: win.get_frame_rect(), workspace: win.get_workspace()?.index() ?? -1},
                ...this._closed].slice(0, CLOSED);
        }, this);
        if (this._pending && Shell.WindowTracker.get_default().get_window_app(win)?.get_id() === this._pending.app) {
            const entry = this._pending;
            this._pending = null;
            win.connectObject('shown', () => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
                if (entry.workspace >= 0 && entry.workspace < global.workspace_manager.n_workspaces)
                    win.change_workspace_by_index(entry.workspace, false);
                const r = entry.rect;
                win.move_resize_frame(true, r.x, r.y, r.width, r.height);
                return GLib.SOURCE_REMOVE;
            }), this);
        }
    }

    _reopen() {
        const entry = this._closed.shift();
        if (!entry)
            return;
        const app = Shell.AppSystem.get_default().lookup_app(entry.app);
        if (!app)
            return;
        this._pending = entry;
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
            if (this._pending === entry)
                this._pending = null;
            return GLib.SOURCE_REMOVE;
        });
        app.open_new_window(-1);
        Main.osdWindowManager.show(-1, app.get_icon(), _('Reopened %s').format(app.get_name()));
    }

    _askSelection() {
        const assistant = getAssistant();
        if (!assistant)
            return;
        this._clipboard.get_text(St.ClipboardType.PRIMARY, (_c, text) => {
            const selected = (text ?? '').trim().slice(0, 8000);
            assistant.ask(selected ? _('Explain this:\n\n%s').format(selected) : '');
        });
    }

    destroy() {
        for (const key of ['clipboard-history', 'float-window', 'reopen-window', 'ask-selection'])
            Main.wm.removeKeybinding(key);
        global.display.get_selection().disconnectObject(this);
        global.display.disconnectObject(this);
        for (const actor of global.get_window_actors()) {
            actor.meta_window?.disconnectObject(this);
            if (actor.meta_window)
                actor.meta_window._hypedeWatched = false;
        }
        this._keyboard?.run_dispose?.();
    }
}
