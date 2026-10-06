// Анимации окон в духе Chrome OS.
//
// GNOME «выстреливает» новое окно из точки и схлопывает закрытое. В Chrome OS
// окно появляется мягче: чуть уменьшенным и прозрачным, а затем плавно
// вырастает до своего размера; закрытое так же плавно тает. Сворачивание
// уводит окно в значок приложения на полке (это делает сам GNOME по
// геометрии значка, которую сообщает полка).
//
// Логика GNOME — учёт окон, ожидание закрытия обзора, сигналы завершения —
// остаётся родной. Меняются только параметры анимации: для этого на время
// одного вызова подменяется метод ease() у конкретного окна.
//
// GNOME подключает свои обработчики к сигналам менеджера окон через bind(),
// поэтому подмена методов Main.wm сама по себе не сработала бы. Родные
// обработчики временно заглушаются, а вместо них подключаются свои, которые
// вызывают методы Main.wm уже с подменой.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import {isDesktopWindow} from './util.js';

const OPEN_TIME = 260;
const CLOSE_TIME = 200;
const MINIMIZE_TIME = 320;
const GENIE_TIME = 460;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = t => t * t * (3 - 2 * t);

// Окно режется на полосы-клоны, каждая двигается и сжимается сама по себе:
// так получаются «джинн» и желе без деформации текстуры.
class Strips {
    constructor(actor, n, vertical = true) {
        this.actor = actor;
        this.vertical = vertical;
        [this.w, this.h] = actor.get_size();
        this.len = vertical ? this.h : this.w;
        this.size = Math.ceil(this.len / n);
        this.group = new Clutter.Actor({x: actor.x, y: actor.y});
        global.window_group.insert_child_above(this.group, actor);
        this.strips = [];
        for (let i = 0; i * this.size < this.len; i++) {
            const at = i * this.size;
            const s = Math.min(this.size, this.len - at);
            const strip = new Clutter.Actor(vertical
                ? {y: at, width: this.w, height: s, clip_to_allocation: true}
                : {x: at, width: s, height: this.h, clip_to_allocation: true});
            strip.add_child(new Clutter.Clone(vertical ? {source: actor, y: -at} : {source: actor, x: -at}));
            strip.at = at;
            strip.s = s;
            this.group.add_child(strip);
            this.strips.push(strip);
        }
        actor.opacity = 0;
    }

    // Положение полосы: вдоль оси — начало и длина, поперёк — начало и ширина.
    place(strip, a, al, c, cl) {
        const span = this.vertical ? this.w : this.h;
        if (this.vertical) {
            strip.translation_y = a - strip.at;
            strip.scale_y = al / strip.s;
            strip.translation_x = c;
            strip.scale_x = cl / span;
        } else {
            strip.translation_x = a - strip.at;
            strip.scale_x = al / strip.s;
            strip.translation_y = c;
            strip.scale_y = cl / span;
        }
    }

    destroy() {
        this.group.destroy();
        this.actor.opacity = 255;
    }
}

// Подменить параметры ближайшего вызова actor.ease(). adjust(params)
// возвращает новые параметры; если ease() так и не вызвали, подмена
// снимается после завершения исходного метода.
function tweakNextEase(actor, adjust, call) {
    const ownEase = Object.prototype.hasOwnProperty.call(actor, 'ease');
    if (ownEase)
        return call();
    actor.ease = function (params) {
        delete this.ease;
        return this.ease(adjust(params));
    };
    const cleanup = () => {
        if (Object.prototype.hasOwnProperty.call(actor, 'ease'))
            delete actor.ease;
    };
    let result;
    try {
        result = call();
    } finally {
        if (result instanceof Promise)
            result.finally(cleanup);
        else
            cleanup();
    }
    return result;
}

function isNormal(actor) {
    return actor.meta_window?.get_window_type() === Meta.WindowType.NORMAL && !isDesktopWindow(actor.meta_window);
}

export class WindowAnimations {
    constructor(settings) {
        this._settings = settings;
        this._injections = new InjectionManager();
        const self = this;

        this._injections.overrideMethod(Main.wm, '_mapWindow',
            original => function (shellwm, actor) {
                if (!self._enabled || !isNormal(actor))
                    return original.call(this, shellwm, actor);
                return tweakNextEase(actor, params => {
                    // Старт: 86 % размера, прозрачное, чуть ниже; масштаб доходит до 100 % с лёгким перелётом, как пружина.
                    actor.set_pivot_point(0.5, 0.5);
                    actor.scale_x = 0.86;
                    actor.scale_y = 0.86;
                    actor.translation_y = 16;
                    const {scale_x: _x, scale_y: _y, ...rest} = params;
                    actor.ease({
                        scale_x: 1,
                        scale_y: 1,
                        duration: OPEN_TIME + 60,
                        mode: Clutter.AnimationMode.EASE_OUT_BACK,
                    });
                    return {
                        ...rest,
                        translation_y: 0,
                        duration: OPEN_TIME + 60,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                        onStopped: (...a) => {
                            actor.translation_y = 0;
                            params.onStopped?.(...a);
                        },
                    };
                }, () => original.call(this, shellwm, actor));
            });

        this._injections.overrideMethod(Main.wm, '_destroyWindow',
            original => function (shellwm, actor) {
                if (!self._enabled || !isNormal(actor))
                    return original.call(this, shellwm, actor);
                return tweakNextEase(actor, params => {
                    actor.set_pivot_point(0.5, 0.5);
                    return {
                        ...params,
                        scale_x: 0.94,
                        scale_y: 0.94,
                        duration: CLOSE_TIME,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    };
                }, () => original.call(this, shellwm, actor));
            });

        for (const method of ['_minimizeWindow', '_unminimizeWindow']) {
            this._injections.overrideMethod(Main.wm, method,
                original => function (shellwm, actor) {
                    if (self._genie(this, shellwm, actor, method === '_minimizeWindow'))
                        return undefined;
                    if (!self._enabled)
                        return original.call(this, shellwm, actor);
                    return tweakNextEase(actor, params => ({
                        ...params,
                        duration: MINIMIZE_TIME,
                        mode: method === '_minimizeWindow'
                            ? Clutter.AnimationMode.EASE_IN_CUBIC
                            : Clutter.AnimationMode.EASE_OUT_CUBIC,
                    }), () => original.call(this, shellwm, actor));
                });
        }

        const shellwm = global.window_manager;
        this._blocked = [];
        for (const signal of ['map', 'destroy', 'minimize', 'unminimize']) {
            const method = `_${signal}Window`;
            const id = GObject.signal_handler_find(shellwm, {signalId: signal});
            if (!id)
                continue;
            GObject.signal_handler_block(shellwm, id);
            this._blocked.push(id);
            shellwm.connectObject(signal, (wm, actor) => Main.wm[method](wm, actor), this);
        }

        global.display.connectObject(
            'grab-op-begin', (d, win, op) => this._grabBegin(win, op),
            'grab-op-end', () => this._grabEnd(),
            this);
    }

    _genie(wm, shellwm, actor, minimize) {
        const win = actor.meta_window;
        if (!this._enabled || !this._settings.get_boolean('minimize-genie') || this._settings.get_boolean('lite-mode') ||
            !wm._shouldAnimate() || !actor.get_texture() || win.get_window_type() !== Meta.WindowType.NORMAL ||
            win.is_monitor_sized())
            return false;
        const [ok, geom] = win.get_icon_geometry();
        if (!ok)
            return false;
        wm._skippedActors.delete(actor);
        const set = minimize ? wm._minimizing : wm._unminimizing;
        set.add(actor);
        if (!minimize) {
            const r = win.get_buffer_rect();
            actor.set_position(r.x, r.y);
        }
        actor.remove_all_transitions();
        actor.set_scale(1, 1);
        actor.show();
        const [w, h] = actor.get_size();
        const [tx, ty, tw, th] = [geom.x - actor.x, geom.y - actor.y, geom.width, geom.height];
        const vertical = Math.abs(ty + th / 2 - h / 2) >= Math.abs(tx + tw / 2 - w / 2);
        const strips = new Strips(actor, Math.min(160, Math.ceil((vertical ? h : w) / 4)), vertical);
        const [len, span, t0, tl, c0, cl] = vertical ? [h, w, ty, th, tx, tw] : [w, h, tx, tw, ty, th];
        const forward = t0 + tl / 2 > len / 2;
        const timeline = new Clutter.Timeline({actor: strips.group, duration: GENIE_TIME});
        const step = () => {
            const t = timeline.get_progress();
            const p = minimize ? t : 1 - t;
            const rp = y => clamp(p * 2 - (forward ? 1 - y / len : y / len), 0, 1);
            const pos = y => y + (t0 + (y / len) * tl - y) * rp(y) ** 2;
            for (const strip of strips.strips) {
                const r = rp(strip.at + strip.s / 2);
                const squeeze = smooth(clamp(r * 1.6, 0, 1));
                const a = pos(strip.at);
                strip.opacity = Math.round(255 * (1 - clamp((r - 0.8) * 5, 0, 1)));
                strips.place(strip, a, pos(strip.at + strip.s) - a + 0.6, c0 * squeeze, span + (cl - span) * squeeze);
            }
        };
        step();
        timeline.connect('new-frame', step);
        timeline.connect('stopped', () => {
            strips.destroy();
            if (minimize)
                wm._minimizeWindowDone(shellwm, actor);
            else
                wm._unminimizeWindowDone(shellwm, actor);
        });
        timeline.start();
        return true;
    }

    _grabBegin(win, op) {
        this._grabEnd();
        if (!win || !this._enabled || !this._settings.get_boolean('window-wobbly') ||
            this._settings.get_boolean('lite-mode') || !St.Settings.get().enable_animations ||
            (op !== Meta.GrabOp.MOVING && op !== Meta.GrabOp.MOVING_UNCONSTRAINED) ||
            win.get_window_type() !== Meta.WindowType.NORMAL)
            return;
        const actor = win.get_compositor_private();
        if (!actor)
            return;
        const [, py] = global.get_pointer();
        const strips = new Strips(actor, 32);
        const gy = py - actor.y;
        const weight = y => Math.min(1, Math.abs(y - gy) / strips.h * 1.4) ** 1.3;
        const w = {win, actor, strips, ox: 0, oy: 0, vx: 0, vy: 0, held: true};
        let [lx, ly] = [win.get_frame_rect().x, win.get_frame_rect().y];
        let last = GLib.get_monotonic_time();
        w.timeline = new Clutter.Timeline({actor: strips.group, duration: 1000, repeat_count: -1});
        w.timeline.connect('new-frame', () => {
            const now = GLib.get_monotonic_time();
            const dt = Math.min(0.033, (now - last) / 1e6);
            last = now;
            const r = win.get_frame_rect();
            w.ox = clamp(w.ox - (r.x - lx) * 0.9, -110, 110);
            w.oy = clamp(w.oy - (r.y - ly) * 0.9, -110, 110);
            [lx, ly] = [r.x, r.y];
            w.vx += (-220 * w.ox - 12 * w.vx) * dt;
            w.vy += (-220 * w.oy - 12 * w.vy) * dt;
            w.ox += w.vx * dt;
            w.oy += w.vy * dt;
            strips.group.set_position(actor.x, actor.y);
            for (const strip of strips.strips) {
                const top = weight(strip.at);
                const bottom = weight(strip.at + strip.s);
                strips.place(strip, strip.at + w.oy * top, strip.s + w.oy * (bottom - top),
                    w.ox * weight(strip.at + strip.s / 2), strips.w);
            }
            if (!w.held && Math.abs(w.ox) + Math.abs(w.oy) < 0.3 && Math.abs(w.vx) + Math.abs(w.vy) < 3)
                this._dropWobbly(w);
        });
        actor.connectObject('destroy', () => this._dropWobbly(w), 'notify::size', () => this._dropWobbly(w), this);
        w.timeline.start();
        this._wobbly?.forEach?.(o => o !== w && this._dropWobbly(o));
        this._wobbly = [w];
    }

    _grabEnd() {
        for (const w of this._wobbly ?? [])
            w.held = false;
    }

    _dropWobbly(w) {
        if (w.dropped)
            return;
        w.dropped = true;
        w.timeline.stop();
        w.actor.disconnectObject(this);
        w.strips.destroy();
        this._wobbly = (this._wobbly ?? []).filter(o => o !== w);
    }

    get _enabled() {
        return this._settings.get_string('window-animations') === 'hypede';
    }

    destroy() {
        const shellwm = global.window_manager;
        shellwm.disconnectObject(this);
        global.display.disconnectObject(this);
        for (const w of [...this._wobbly ?? []])
            this._dropWobbly(w);
        for (const id of this._blocked)
            GObject.signal_handler_unblock(shellwm, id);
        this._blocked = [];
        this._injections.clear();
    }
}
