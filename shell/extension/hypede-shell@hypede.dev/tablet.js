// Режим планшета, как в Chrome OS.
//
// Включается сам, когда Mutter переводит ввод в сенсорный режим (крышка
// 2-в-1 перевёрнута, клавиатура отстёгнута — переключатель SW_TABLET_MODE),
// или вручную кнопкой в быстрых настройках. В режиме планшета лаунчер
// открывается на весь экран, полка и значки крупнее, окна развёрнуты, а
// экранная клавиатура включена. Прежние значения настроек запоминаются
// (tablet-saved) и возвращаются при выходе — даже если оболочка
// перезапускалась.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {isDesktopWindow, showOsd} from './util.js';

// [схема, ключ, значение в режиме планшета]
const OVERRIDES = [
    ['dev.hypede.shell', 'launcher-style', new GLib.Variant('s', 'fullscreen')],
    ['dev.hypede.shell', 'shelf-size', new GLib.Variant('i', 60)],
    ['dev.hypede.shell', 'shelf-icon-size', new GLib.Variant('i', 44)],
    ['dev.hypede.shell', 'shelf-hover-zoom', new GLib.Variant('b', false)],
    ['dev.hypede.shell', 'shelf-autohide', new GLib.Variant('b', false)],
    ['dev.hypede.shell', 'shelf-overview-button', new GLib.Variant('b', true)],
    ['org.gnome.desktop.a11y.applications', 'screen-keyboard-enabled', new GLib.Variant('b', true)],
];

const TabletToggle = GObject.registerClass(
class TabletToggle extends QuickToggle {
    _init(tablet) {
        super._init({title: _('Tablet'), iconName: 'hypede-tablet-symbolic', toggleMode: false});
        this._tablet = tablet;
        this.connect('clicked', () => tablet.setManual(!tablet.active));
        this.sync();
    }

    sync() {
        this.checked = this._tablet.active;
        this.subtitle = this._tablet.mode === 'auto' ? _('Automatic') : null;
    }
});

export class TabletMode {
    constructor(settings) {
        this._settings = settings;
        this._schemas = new Map();
        this._maximized = new Set();
        this._seat = Clutter.get_default_backend().get_default_seat();
        this.active = false;

        this._indicator = new SystemIndicator();
        this._toggle = new TabletToggle(this);
        this._indicator.quickSettingsItems.push(this._toggle);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        this._seat.connectObject('notify::touch-mode', () => this._sync(), this);
        settings.connectObject('changed::tablet-mode', () => this._sync(), this);
        global.display.connectObject('window-created', (_d, win) => this._onWindow(win), this);
        this._sync();
    }

    get mode() {
        return this._settings.get_string('tablet-mode');
    }

    // Кнопка переключает вручную; повторное нажатие в сенсорном режиме
    // выключает планшет до следующего переключения крышки.
    setManual(on) {
        const auto = this._seat.touch_mode;
        this._settings.set_string('tablet-mode', on === auto ? 'auto' : on ? 'on' : 'off');
    }

    _gsettings(schema) {
        if (!this._schemas.has(schema)) {
            const source = Gio.SettingsSchemaSource.get_default();
            this._schemas.set(schema, source.lookup(schema, true) ? new Gio.Settings({schema_id: schema}) : null);
        }
        return this._schemas.get(schema);
    }

    _sync() {
        const mode = this.mode;
        const active = mode === 'on' || (mode === 'auto' && this._seat.touch_mode);
        if (active !== this.active) {
            this.active = active;
            if (active)
                this._enter();
            else
                this._leave();
            showOsd(Gio.ThemedIcon.new(active ? 'hypede-tablet-symbolic' : 'hypede-laptop-symbolic'),
                active ? _('Tablet mode') : _('Laptop mode'));
        } else if (!active && this._settings.get_string('tablet-saved')) {
            // Оболочку перезапустили посреди режима планшета.
            this._leave();
        }
        this._toggle.sync();
    }

    _enter() {
        if (!this._settings.get_string('tablet-saved')) {
            const saved = {};
            for (const [schema, key] of OVERRIDES) {
                const s = this._gsettings(schema);
                if (s)
                    saved[`${schema}/${key}`] = s.get_user_value(key)?.print(true) ?? null;
            }
            this._settings.set_string('tablet-saved', JSON.stringify(saved));
        }
        for (const [schema, key, value] of OVERRIDES)
            this._gsettings(schema)?.set_value(key, value);
        for (const actor of global.get_window_actors())
            this._maximize(actor.meta_window, true);
    }

    _leave() {
        let saved = {};
        try {
            saved = JSON.parse(this._settings.get_string('tablet-saved') || '{}');
        } catch {}
        for (const [schema, key] of OVERRIDES) {
            const s = this._gsettings(schema);
            const text = saved[`${schema}/${key}`];
            if (!s || text === undefined)
                continue;
            if (text === null)
                s.reset(key);
            else
                s.set_value(key, GLib.Variant.parse(null, text, null, null));
        }
        this._settings.set_string('tablet-saved', '');
        for (const win of this._maximized) {
            if (!win.get_compositor_private())
                continue;
            win.unmaximize(Meta.MaximizeFlags.BOTH);
        }
        this._maximized.clear();
    }

    _maximize(win, remember) {
        if (!win || isDesktopWindow(win) || win.get_window_type() !== Meta.WindowType.NORMAL ||
            !win.can_maximize() || win.maximized_horizontally && win.maximized_vertically)
            return;
        win.maximize(Meta.MaximizeFlags.BOTH);
        if (remember)
            this._maximized.add(win);
        win.connectObject('unmanaged', () => this._maximized.delete(win), this);
    }

    _onWindow(win) {
        if (!this.active)
            return;
        // Размер окна известен после первого кадра.
        const actor = win.get_compositor_private();
        if (!actor)
            return;
        actor.connectObject('first-frame', () => {
            actor.disconnectObject(this);
            if (this.active)
                this._maximize(win, true);
        }, this);
    }

    destroy() {
        this._seat.disconnectObject(this);
        this._settings.disconnectObject(this);
        global.display.disconnectObject(this);
        for (const win of this._maximized)
            win.disconnectObject(this);
        // Настройки планшета остаются как есть: при следующем включении
        // расширения _sync() вернёт их, если режим уже не нужен.
        this._toggle.destroy();
        this._indicator.destroy();
    }
}
