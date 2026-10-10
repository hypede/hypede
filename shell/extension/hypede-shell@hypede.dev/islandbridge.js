// Динамический остров (расширение DynamicLinux) в духе Chrome OS.
//
// Остров сам по себе — «чёлка» iPhone вверху экрана. В HypeDE верхней панели
// нет, поэтому он живёт на полке: свёрнутый — капсулой рядом с кнопкой
// лаунчера (там, где в Chrome OS «Сейчас играет» и запись экрана), раскрытый —
// пузырём над полкой, как лаунчер и быстрые настройки. Цвета, шрифт,
// скругления и скорость анимаций берутся из темы HypeDE.
//
// Остров узнаёт место через globalThis.hypedeIsland: anchor() и listen().

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {accentHex, parseHex} from './util.js';

const SCHEMA = 'org.gnome.shell.extensions.dynamic-island';
const GAP = 8;
const BASE = {dark: [32, 33, 36], light: [248, 250, 253]};

export class IslandBridge {
    constructor(settings, shelf) {
        this._settings = settings;
        this._shelf = shelf;
        this._listeners = new Map();
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const source = Gio.SettingsSchemaSource.get_default();
        this._island = source.lookup(SCHEMA, true) ? new Gio.Settings({schema_id: SCHEMA}) : null;

        globalThis.hypedeIsland = {
            anchor: (state, w, h) => this._anchor(state, w, h),
            listen: (owner, callback) => {
                this._listeners.set(owner, callback);
                this._raise(owner);
            },
            unlisten: owner => this._listeners.delete(owner),
        };

        const changed = () => this._changedLater();
        shelf.actor.connectObject('notify::allocation', changed, this);
        settings.connectObject(
            'changed::shelf-position', changed,
            'changed::island-follow-theme', () => this._syncTheme(),
            'changed::accent-custom', () => this._syncTheme(),
            'changed::launcher-color', () => this._syncTheme(),
            'changed::launcher-opacity', () => this._syncTheme(),
            'changed::corner-radius', () => this._syncTheme(),
            'changed::shelf-size', () => this._syncTheme(),
            'changed::animation-speed', () => this._syncTheme(),
            this);
        this._iface.connectObject(
            'changed::color-scheme', () => this._syncTheme(),
            'changed::accent-color', () => this._syncTheme(),
            'changed::font-name', () => this._syncTheme(),
            this);
        this._syncTheme();
    }

    // Свёрнутый — капсула на полке справа от кнопки лаунчера; раскрытый —
    // пузырь над полкой (под ней, если полка сверху). На боковой полке
    // капсула не помещается — тогда остров остаётся сверху по центру.
    _anchor(state, w, h) {
        const shelf = this._shelf.actor;
        const position = this._settings.get_string('shelf-position');
        if (!shelf?.mapped || (position !== 'bottom' && position !== 'top'))
            return null;
        const [sx, sy] = shelf.get_transformed_position();
        const [sw, sh] = shelf.get_transformed_size();
        const monitor = Main.layoutManager.primaryMonitor;
        const ring = Main.panel.statusArea['hypede-launcher']?.container;
        let start = sx + GAP;
        if (ring?.mapped) {
            const [rx] = ring.get_transformed_position();
            start = rx + ring.get_transformed_size()[0] + GAP;
        }
        const x = Math.round(Math.max(monitor.x + GAP, Math.min(start, monitor.x + monitor.width - w - GAP)));
        if (state === 'compact')
            return {x, y: Math.round(sy + (sh - h) / 2)};
        return {x, y: Math.round(position === 'bottom' ? sy - GAP - h : sy + sh + GAP)};
    }

    // Капсула лежит на полке — значит, должна быть над ней.
    _raise(owner) {
        const actor = owner?.actor;
        const box = Main.layoutManager.panelBox;
        if (actor?.get_parent() === box.get_parent())
            actor.get_parent().set_child_above_sibling(actor, box);
    }

    _changedLater() {
        if (this._later)
            return;
        this._later = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._later = 0;
            for (const [owner, callback] of this._listeners) {
                this._raise(owner);
                callback();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // Тема острова — из темы HypeDE: фон пузырей, текст, акцент, шрифт,
    // скругления как у меню, спокойная анимация без отскока.
    _syncTheme() {
        const island = this._island;
        if (!island || !this._settings.get_boolean('island-follow-theme'))
            return;
        const dark = this._iface.get_string('color-scheme') === 'prefer-dark';
        const [r, g, b] = parseHex(this._settings.get_string('launcher-color')) ?? BASE[dark ? 'dark' : 'light'];
        const alpha = Math.max(0.85, this._settings.get_int('launcher-opacity') / 100);
        const shelfSize = this._settings.get_int('shelf-size');
        const height = Math.max(28, Math.min(40, shelfSize - 16));
        const font = this._iface.get_string('font-name').replace(/\s+\d+(\.\d+)?$/, '');
        const speed = this._settings.get_double('animation-speed') || 1;
        const values = {
            'bg-color': ['s', `rgba(${r},${g},${b},${alpha.toFixed(2)})`],
            'fg-color': ['s', dark ? '#e3e3e3' : '#1f1f1f'],
            'accent-color': ['s', accentHex(this._settings, this._iface)],
            'border-color': ['s', dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'],
            'border-width': ['i', 1],
            'compact-height': ['i', height],
            'compact-radius': ['i', Math.round(height / 2)],
            'expanded-radius': ['i', Math.min(80, this._settings.get_int('corner-radius') + 8)],
            'font-family': ['s', font],
            'animation-style': ['s', 'smooth'],
            'animation-duration': ['i', Math.round(320 / speed)],
            'blur': ['b', false],
        };
        island.delay();
        for (const [key, [type, value]] of Object.entries(values)) {
            if (!island.settings_schema.has_key(key))
                continue;
            const current = island.get_value(key).recursiveUnpack();
            if (current !== value)
                island.set_value(key, new GLib.Variant(type, value));
        }
        island.apply();
    }

    destroy() {
        if (this._later)
            global.compositor.get_laters().remove(this._later);
        this._shelf.actor?.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._iface.disconnectObject(this);
        delete globalThis.hypedeIsland;
        for (const callback of this._listeners.values())
            callback();
        this._listeners.clear();
    }
}
