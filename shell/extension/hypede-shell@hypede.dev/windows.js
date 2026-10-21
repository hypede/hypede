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
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import {isDesktopWindow} from './util.js';

const OPEN_TIME = 260;
const CLOSE_TIME = 200;
const MINIMIZE_TIME = 320;
const GENIE_TIME = 460;
const LAUNCH_TIME = 420;
const LAUNCH_WAIT = 8 * 1000 * 1000; // мкс: сколько ждать окно после запуска

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = t => t * t * (3 - 2 * t);

// Окно один раз рисуется в текстуру, а полосы показывают её куски: так
// получаются «джинн» и желе. Каждая полоса двигается и сжимается сама по
// себе. Раньше полосы были клонами окна, и каждая перерисовывала окно целиком
// (десятки раз за кадр) — это тормозило и оставляло артефакты.
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
                ? {y: at, width: this.w, height: s}
                : {x: at, width: s, height: this.h});
            strip.set_content_scaling_filters(Clutter.ScalingFilter.LINEAR, Clutter.ScalingFilter.LINEAR);
            strip.at = at;
            strip.s = s;
            this.group.add_child(strip);
            this.strips.push(strip);
        }
        this.ok = this.refresh();
        actor.opacity = 0;
    }

    // Снять окно заново (для желе: содержимое окна может меняться).
    refresh() {
        let texture;
        try {
            const opacity = this.actor.opacity;
            this.actor.opacity = 255;
            texture = this.actor.paint_to_content(null)?.get_texture();
            this.actor.opacity = opacity;
        } catch {}
        if (!texture)
            return false;
        const sx = texture.get_width() / this.w, sy = texture.get_height() / this.h;
        for (const strip of this.strips) {
            const r = this.vertical
                ? new Mtk.Rectangle({x: 0, y: Math.round(strip.at * sy), width: texture.get_width(), height: Math.max(1, Math.round(strip.s * sy))})
                : new Mtk.Rectangle({x: Math.round(strip.at * sx), y: 0, width: Math.max(1, Math.round(strip.s * sx)), height: texture.get_height()});
            strip.content = Clutter.TextureContent.new_from_texture(texture, r);
        }
        return true;
    }

    // Положение полосы: вдоль оси — начало a и длина al; поперёк оси края
    // полосы в её начале l0…r0, в конце — l1…r1. Полоса — трапеция, и края
    // соседних полос смыкаются в одну линию. Прямоугольные полосы давали
    // «лесенку»: каждая сдвигалась целиком, и текст окна съезжал кусками.
    // Прямоугольник в трапецию переводит перспективная матрица (как у
    // квадрата в четырёхугольник у Хекберта).
    placeQuad(strip, a, al, l0, r0, l1, r1) {
        const span = this.vertical ? this.w : this.h;
        const t = a - strip.at, s = strip.s;
        const w0 = Math.max(r0 - l0, 0.01), w1 = Math.max(r1 - l1, 0.01);
        const h = w0 / w1 - 1;
        const b = l1 - l0 + h * l1;
        const e = al + h * (t + al);
        // Graphene: векторы-строки, x' = x·m00 + y·m10 + m30, w' = … + m33.
        const m = this.vertical
            ? [w0 / span, 0, 0, 0, b / s, e / s, 0, h / s, 0, 0, 1, 0, l0, t, 0, 1]
            : [e / s, b / s, 0, h / s, 0, w0 / span, 0, 0, 0, 0, 1, 0, t, l0, 0, 1];
        const matrix = new Graphene.Matrix();
        matrix.init_from_float(m);
        strip.set_transform(matrix);
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
        this._genies = new Set();
        this._injections = new InjectionManager();
        const self = this;

        // Запуск приложения: запоминаем значок, по которому щёлкнули (на полке
        // или в лаунчере), — новое окно вырастет из него, как в HyperOS и One UI.
        this._launches = new Map();
        for (const method of ['activate', 'open_new_window', 'activate_full', 'launch']) {
            this._injections.overrideMethod(Shell.App.prototype, method, original => function (...args) {
                self._noteLaunch(this);
                return original.apply(this, args);
            });
        }

        this._injections.overrideMethod(Main.wm, '_mapWindow',
            original => function (shellwm, actor) {
                if (!self._enabled || !isNormal(actor))
                    return original.call(this, shellwm, actor);
                const launch = self._takeLaunch(actor);
                if (launch)
                    return tweakNextEase(actor, params => self._launchParams(actor, launch, params), () => original.call(this, shellwm, actor));
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

    // Значок под указателем в момент запуска: кнопка полки или плитка лаунчера.
    _noteLaunch(app) {
        if (!this._enabled || this._settings.get_boolean('lite-mode'))
            return;
        const [px, py] = global.get_pointer();
        let actor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, px, py);
        for (let i = 0; actor && i < 8; i++, actor = actor.get_parent()) {
            const cls = actor.style_class ?? '';
            if (/hypede-(shelf-item|launcher-app|launcher-result)/.test(cls) || actor.app === app)
                break;
        }
        if (!actor)
            return;
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        if (!(w > 0 && h > 0))
            return;
        this._launches.set(app.get_id(), {x, y, w, h, time: GLib.get_monotonic_time()});
    }

    _takeLaunch(actor) {
        const app = Shell.WindowTracker.get_default().get_window_app(actor.meta_window);
        const id = app?.get_id();
        const launch = id && this._launches.get(id);
        if (!launch)
            return null;
        this._launches.delete(id);
        return GLib.get_monotonic_time() - launch.time < LAUNCH_WAIT ? launch : null;
    }

    // Окно стартует размером со значок на его месте и разворачивается в своё.
    _launchParams(actor, launch, params) {
        const rect = actor.meta_window.get_buffer_rect();
        const w = actor.width || rect.width, h = actor.height || rect.height;
        const scale = Math.max(launch.w / w, launch.h / h, 0.04);
        actor.set_pivot_point(0, 0);
        actor.scale_x = scale;
        actor.scale_y = scale;
        actor.translation_x = launch.x + launch.w / 2 - w * scale / 2 - rect.x;
        actor.translation_y = launch.y + launch.h / 2 - h * scale / 2 - rect.y;
        actor.opacity = 0;
        // Окно сразу становится видимым и растёт из значка; завершение
        // анимации (onStopped GNOME) — по окончании роста, самой длинной части.
        // ease() сам учитывает скорость анимаций.
        const {scale_x: _x, scale_y: _y, onStopped, ...rest} = params;
        actor.ease({
            scale_x: 1,
            scale_y: 1,
            translation_x: 0,
            translation_y: 0,
            duration: LAUNCH_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onStopped,
        });
        return {
            ...rest,
            opacity: 255,
            duration: Math.round(LAUNCH_TIME / 3),
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        };
    }

    _genie(wm, shellwm, actor, minimize) {
        const win = actor.meta_window;
        if (!this._enabled || !this._settings.get_boolean('minimize-genie') || this._settings.get_boolean('lite-mode') ||
            !wm._shouldAnimate() || win.get_window_type() !== Meta.WindowType.NORMAL || win.is_monitor_sized())
            return false;
        const [ok, geom] = win.get_icon_geometry();
        if (!ok || geom.width <= 0 || geom.height <= 0)
            return false;
        // Окно, которое GNOME велел не анимировать, остаётся без анимации.
        if (wm._skippedActors.delete(actor))
            return false;
        const set = minimize ? wm._minimizing : wm._unminimizing;
        set.add(actor);
        actor.remove_all_transitions();
        actor.set_scale(1, 1);
        actor.set_pivot_point(0, 0);
        if (!minimize) {
            // Свёрнутое окно GNOME мог оставить там, куда оно улетало.
            const r = win.get_buffer_rect();
            actor.set_position(r.x, r.y);
        }
        actor.opacity = 255;
        actor.show();

        const [w, h] = actor.get_size();
        const [tx, ty, tw, th] = [geom.x - actor.x, geom.y - actor.y, geom.width, geom.height];
        const vertical = Math.abs(ty + th / 2 - h / 2) >= Math.abs(tx + tw / 2 - w / 2);
        const strips = new Strips(actor, Math.min(200, Math.ceil((vertical ? h : w) / 3)), vertical);
        if (!strips.ok) {
            strips.destroy();
            set.delete(actor);
            return false;
        }
        const [len, span, t0, tl, c0, cl] = vertical ? [h, w, ty, th, tx, tw] : [w, h, tx, tw, ty, th];
        const forward = t0 + tl / 2 > len / 2;
        // Скорость анимаций из «Настроек» (и замедление для отладки) — как у ease().
        const duration = Math.round(GENIE_TIME * St.Settings.get().slow_down_factor);
        const timeline = new Clutter.Timeline({actor: strips.group, duration});
        // Ссылка обязательна: иначе сборщик мусора заберёт таймлайн вместе
        // с обработчиками, и окно так и останется полосами.
        const run = {timeline, strips};
        this._genies.add(run);
        // Сначала к значку тянется ближний край, потом всё окно; поперёк оси
        // окно сужается до ширины значка, в самом конце гаснет.
        const step = () => {
            // Плавный разгон и торможение: линейное время выглядело рывком
            // в начале и в конце.
            const t = smooth(timeline.get_progress());
            const p = minimize ? t : 1 - t;
            const rp = a => clamp(p * 2 - (forward ? 1 - a / len : a / len), 0, 1);
            const pos = a => a + (t0 + (a / len) * tl - a) * rp(a) ** 2;
            // Поперёк оси: середина окна едет к середине значка, ширина
            // сужается до ширины значка.
            const width = a => span + (cl - span) * smooth(clamp(rp(a) * 1.6, 0, 1));
            const middle = a => span / 2 + (c0 + cl / 2 - span / 2) * smooth(clamp(rp(a) * 1.6, 0, 1));
            for (const strip of strips.strips) {
                const [a0, a1] = [strip.at, strip.at + strip.s];
                const a = pos(a0);
                const [m0, m1, w0, w1] = [middle(a0), middle(a1), width(a0), width(a1)];
                strips.placeQuad(strip, a, pos(a1) - a + 0.75, m0 - w0 / 2, m0 + w0 / 2, m1 - w1 / 2, m1 + w1 / 2);
            }
            strips.group.opacity = Math.round(255 * (1 - clamp((p - 0.85) / 0.15, 0, 1)));
        };
        step();
        timeline.connect('new-frame', step);
        timeline.connect('stopped', () => {
            this._genies.delete(run);
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
        const strips = new Strips(actor, Math.min(120, Math.ceil(actor.height / 6)));
        if (!strips.ok) {
            strips.destroy();
            return;
        }
        const gy = py - actor.y;
        const weight = y => Math.min(1, Math.abs(y - gy) / strips.h * 1.4) ** 1.3;
        const w = {win, actor, strips, ox: 0, oy: 0, vx: 0, vy: 0, held: true, frame: 0};
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
            // Содержимое окна обновляем через кадр: его почти не видно в движении.
            if (++w.frame % 2 === 0)
                strips.refresh();
            strips.group.set_position(actor.x, actor.y);
            for (const strip of strips.strips) {
                const top = weight(strip.at);
                const bottom = weight(strip.at + strip.s);
                const [x0, x1] = [w.ox * top, w.ox * bottom];
                strips.placeQuad(strip, strip.at + w.oy * top, strip.s + w.oy * (bottom - top) + 0.75,
                    x0, x0 + strips.w, x1, x1 + strips.w);
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
        for (const run of [...this._genies])
            run.timeline.stop();
        for (const w of [...this._wobbly ?? []])
            this._dropWobbly(w);
        for (const id of this._blocked)
            GObject.signal_handler_unblock(shellwm, id);
        this._blocked = [];
        this._injections.clear();
    }
}
