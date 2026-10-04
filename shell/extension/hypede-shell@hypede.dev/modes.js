import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const ICONS = {work: 'hypede-work-symbolic', game: 'input-gaming-symbolic', study: 'accessories-dictionary-symbolic'};
const STATE = GLib.build_filenamev([GLib.get_user_state_dir(), 'hypede', 'before-mode.json']);

let instance = null;
export const getModes = () => instance;

function spawn(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
    } catch {}
}

function powerProfile(value) {
    const args = value
        ? ['net.hadess.PowerProfiles', 'ActiveProfile', new GLib.Variant('s', value)]
        : ['net.hadess.PowerProfiles', 'ActiveProfile'];
    try {
        const reply = Gio.DBus.system.call_sync('net.hadess.PowerProfiles', '/net/hadess/PowerProfiles',
            'org.freedesktop.DBus.Properties', value ? 'Set' : 'Get', new GLib.Variant(value ? '(ssv)' : '(ss)', args),
            null, Gio.DBusCallFlags.NONE, 500, null);
        return value ? value : reply.deepUnpack()[0].deepUnpack();
    } catch {
        return '';
    }
}

export function modeName(mode) {
    if (mode.name)
        return mode.name;
    return {work: _('Work'), game: _('Game'), study: _('Study')}[mode.id] ?? mode.id;
}

export function modeIcon(mode) {
    return ICONS[mode.id] ?? 'starred-symbolic';
}

const FocusToggle = GObject.registerClass(
class FocusToggle extends QuickMenuToggle {
    _init(modes) {
        super._init({title: _('Focus'), iconName: 'hypede-work-symbolic', toggleMode: false});
        this._modes = modes;
        this.menu.setHeader('hypede-work-symbolic', _('Focus mode'));
        this._section = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._section);
        this.connect('clicked', () => {
            const active = this._modes.active;
            this._modes.set(active ? '' : (this._modes.list[0]?.id ?? ''));
        });
        this.sync();
    }

    sync() {
        const active = this._modes.active;
        const mode = this._modes.list.find(m => m.id === active);
        this.checked = !!mode;
        this.subtitle = mode ? modeName(mode) : null;
        this.iconName = mode ? modeIcon(mode) : 'hypede-work-symbolic';
        this._section.removeAll();
        for (const m of this._modes.list) {
            const item = new PopupMenu.PopupImageMenuItem(modeName(m), modeIcon(m));
            item.setOrnament(m.id === active ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            item.connect('activate', () => this._modes.set(m.id === active ? '' : m.id));
            this._section.addMenuItem(item);
        }
    }
});

export class FocusModes {
    constructor(settings) {
        instance = this;
        this._settings = settings;
        this._notifications = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._indicator = new SystemIndicator();
        this._toggle = new FocusToggle(this);
        this._indicator.quickSettingsItems.push(this._toggle);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
        this._settings.connectObject(
            'changed::focus-modes', () => this._toggle.sync(),
            'changed::focus-mode', () => this._toggle.sync(),
            this);
    }

    get list() {
        try {
            const list = JSON.parse(this._settings.get_string('focus-modes'));
            return Array.isArray(list) ? list.filter(m => m && m.id) : [];
        } catch {
            return [];
        }
    }

    get active() {
        return this._settings.get_string('focus-mode');
    }

    set(id) {
        const current = this.active;
        if (current === id)
            return;
        if (current)
            this._restore();
        const mode = this.list.find(m => m.id === id);
        if (!mode) {
            this._settings.set_string('focus-mode', '');
            if (current)
                Main.osdWindowManager.show(-1, Gio.ThemedIcon.new('hypede-work-symbolic'), _('Focus mode off'));
            return;
        }
        const before = {dnd: !this._notifications.get_boolean('show-banners'), power: powerProfile(''), theme: false};
        if (mode.theme) {
            GLib.mkdir_with_parents(GLib.path_get_dirname(STATE), 0o700);
            spawn(['hypede-theme', 'export', STATE.replace(/\.json$/, '-theme.json'), '--no-embed']);
            before.theme = true;
        }
        GLib.file_set_contents(STATE, JSON.stringify(before));
        if (mode.dnd)
            this._notifications.set_boolean('show-banners', false);
        if (mode.power)
            powerProfile(mode.power);
        if (mode.theme)
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                spawn(['hypede-theme', 'apply', mode.theme]);
                return GLib.SOURCE_REMOVE;
            });
        for (const appId of mode.apps ?? [])
            Shell.AppSystem.get_default().lookup_app(appId)?.activate();
        this._settings.set_string('focus-mode', mode.id);
        Main.osdWindowManager.show(-1, Gio.ThemedIcon.new(modeIcon(mode)), _('Focus mode: %s').format(modeName(mode)));
    }

    _restore() {
        let before = null;
        try {
            before = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(STATE)[1]));
        } catch {}
        if (!before)
            return;
        this._notifications.set_boolean('show-banners', !before.dnd);
        if (before.power)
            powerProfile(before.power);
        if (before.theme)
            spawn(['hypede-theme', 'apply', STATE.replace(/\.json$/, '-theme.json')]);
        GLib.unlink(STATE);
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._toggle.destroy();
        this._indicator.destroy();
        instance = null;
    }
}
