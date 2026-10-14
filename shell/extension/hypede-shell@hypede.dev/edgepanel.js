// Боковая панель, как Edge Panel в Galaxy (One UI).
//
// У правого края экрана — тонкий «язычок». Щелчок по нему или касание
// выдвигает панель: любимые приложения (ключ edge-panel-apps; пусто — самые
// используемые) и быстрые инструменты: снимок экрана, буфер обмена, файлы.
// Панель закрывается щелчком мимо, Escape или повторным щелчком по язычку.
// Язычок не мешает полноэкранным окнам и прячется на экране блокировки.

import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Backdrop} from './backdrop.js';

const SLIDE_TIME = 260;
const MAX_APPS = 10;

export class EdgePanel {
    constructor(settings, extras) {
        this._settings = settings;
        this._extras = extras;
        settings.connectObject('changed::edge-panel', () => this._sync(),
            'changed::lite-mode', () => this._sync(), this);
        this._sync();
    }

    _sync() {
        this._destroyActors();
        if (!this._settings.get_boolean('edge-panel'))
            return;
        this._handle = new St.Button({
            style_class: 'hypede-edge-handle',
            reactive: true,
            can_focus: false,
            track_hover: true,
            accessible_name: _('Edge panel'),
        });
        this._handle.connect('clicked', () => this.toggle());
        Main.layoutManager.addTopChrome(this._handle, {trackFullscreen: true});
        global.display.connectObject('workareas-changed', () => this._place(), this);
        Main.sessionMode.connectObject('updated', () => this._place(), this);
        this._place();
    }

    _place() {
        if (!this._handle)
            return;
        const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        const [, h] = this._handle.get_preferred_height(-1);
        const [, w] = this._handle.get_preferred_width(-1);
        this._handle.set_position(area.x + area.width - w, Math.round(area.y + area.height * 0.3 - h / 2));
        this._handle.visible = !Main.sessionMode.isLocked;
    }

    get isOpen() {
        return !!this._panel;
    }

    toggle() {
        if (this._panel)
            this.close();
        else
            this.open();
    }

    _apps() {
        const system = Shell.AppSystem.get_default();
        const chosen = this._settings.get_strv('edge-panel-apps').map(id => system.lookup_app(id)).filter(Boolean);
        if (chosen.length)
            return chosen.slice(0, MAX_APPS);
        return Shell.AppUsage.get_default().get_most_used().filter(a => a.should_show?.() ?? true).slice(0, MAX_APPS);
    }

    _tile(iconName, label, callback, gicon = null) {
        const box = new St.BoxLayout({vertical: true, style_class: 'hypede-edge-tile-box'});
        box.add_child(new St.Icon({style_class: 'hypede-edge-tile-icon', ...(gicon ? {gicon} : {icon_name: iconName})}));
        box.add_child(new St.Label({text: label, style_class: 'hypede-edge-tile-label', x_align: Clutter.ActorAlign.CENTER}));
        const button = new St.Button({style_class: 'hypede-edge-tile', child: box, can_focus: true, accessible_name: label});
        button.connect('clicked', () => {
            this.close();
            callback();
        });
        return button;
    }

    open() {
        if (this._panel || !this._handle)
            return;
        const panel = new St.BoxLayout({vertical: true, style_class: 'hypede-edge-panel', reactive: true});
        const grid = new St.Widget({layout_manager: new Clutter.GridLayout({orientation: Clutter.Orientation.HORIZONTAL}),
            style_class: 'hypede-edge-grid'});
        const layout = grid.layout_manager;
        this._apps().forEach((app, i) => {
            const tile = this._tile(null, app.get_name(), () => app.activate(), app.get_icon());
            layout.attach(tile, i % 2, Math.floor(i / 2), 1, 1);
        });
        panel.add_child(new St.Label({text: _('Apps'), style_class: 'hypede-edge-title'}));
        panel.add_child(grid);

        const tools = new St.BoxLayout({style_class: 'hypede-edge-tools'});
        tools.add_child(this._tile('camera-photo-symbolic', _('Screenshot'), () => Main.screenshotUI.open().catch(() => {})));
        tools.add_child(this._tile('edit-paste-symbolic', _('Clipboard'), () => this._extras?._showClipboard()));
        tools.add_child(this._tile('folder-symbolic', _('Files'), () =>
            Shell.AppSystem.get_default().lookup_app('dev.hypede.Files.desktop')?.activate()));
        panel.add_child(new St.Label({text: _('Tools'), style_class: 'hypede-edge-title'}));
        panel.add_child(tools);

        // Размытые обои под панелью — как под лаунчером.
        const stack = new St.Widget({layout_manager: new Clutter.BinLayout(), reactive: true});
        if (!this._settings.get_boolean('lite-mode')) {
            // Подложка чуть меньше панели: иначе её край проступал бы
            // тёмной каймой сквозь полупрозрачную рамку.
            const backdrop = new Backdrop();
            for (const [coordinate, offset] of [[Clutter.BindCoordinate.POSITION, 2], [Clutter.BindCoordinate.SIZE, -4]])
                backdrop.add_constraint(new Clutter.BindConstraint({source: panel, coordinate, offset}));
            stack.add_child(backdrop);
            this._backdrop = backdrop;
        }
        stack.add_child(panel);
        Main.layoutManager.addTopChrome(stack);
        this._panel = stack;

        const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        const [, w] = stack.get_preferred_width(-1);
        const [, h] = stack.get_preferred_height(w);
        const x = area.x + area.width - w - 12;
        const y = Math.round(Math.max(area.y + 12, Math.min(area.y + area.height * 0.3 - h / 2, area.y + area.height - h - 12)));
        stack.set_position(x, y);
        stack.translation_x = w + 24;
        stack.opacity = 0;
        stack.ease({translation_x: 0, opacity: 255, duration: SLIDE_TIME, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onStopped: () => this._syncBackdrop()});
        this._handle.ease({opacity: 0, duration: 150});
        this._syncBackdrop();

        this._grab = Main.pushModal(stack, {actionMode: Shell.ActionMode.POPUP});
        stack.connect('captured-event', (_a, event) => {
            const type = event.type();
            if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
                const [ex, ey] = event.get_coords();
                const [sx, sy] = stack.get_transformed_position();
                if (ex < sx || ey < sy || ex > sx + stack.width || ey > sy + stack.height) {
                    this.close();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _syncBackdrop() {
        if (!this._backdrop)
            return;
        let radius = 0;
        try {
            radius = this._panel.get_last_child().get_theme_node().get_border_radius(St.Corner.TOPLEFT);
        } catch {}
        this._backdrop.setCornerRadius(radius);
        this._backdrop.sync();
    }

    close() {
        const panel = this._panel;
        if (!panel)
            return;
        this._panel = null;
        this._backdrop = null;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._handle?.ease({opacity: 255, duration: 150});
        panel.ease({
            translation_x: panel.width + 24,
            opacity: 0,
            duration: Math.round(SLIDE_TIME * 0.8),
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onStopped: () => {
                Main.layoutManager.removeChrome(panel);
                panel.destroy();
            },
        });
    }

    _destroyActors() {
        if (this._panel) {
            if (this._grab)
                Main.popModal(this._grab);
            this._grab = null;
            Main.layoutManager.removeChrome(this._panel);
            this._panel.destroy();
            this._panel = null;
            this._backdrop = null;
        }
        if (this._handle) {
            global.display.disconnectObject(this);
            Main.sessionMode.disconnectObject(this);
            Main.layoutManager.removeChrome(this._handle);
            this._handle.destroy();
            this._handle = null;
        }
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._destroyActors();
    }
}
