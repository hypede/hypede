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
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

const OPEN_TIME = 260;
const CLOSE_TIME = 200;
const MINIMIZE_TIME = 320;

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
    return actor.meta_window?.get_window_type() === Meta.WindowType.NORMAL;
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
                    // Старт: 92 % размера, прозрачное, чуть ниже итогового места.
                    actor.set_pivot_point(0.5, 0.5);
                    actor.scale_x = 0.92;
                    actor.scale_y = 0.92;
                    actor.translation_y = 16;
                    return {
                        ...params,
                        translation_y: 0,
                        duration: OPEN_TIME,
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
    }

    get _enabled() {
        return this._settings.get_string('window-animations') === 'hypede';
    }

    destroy() {
        const shellwm = global.window_manager;
        shellwm.disconnectObject(this);
        for (const id of this._blocked)
            GObject.signal_handler_unblock(shellwm, id);
        this._blocked = [];
        this._injections.clear();
    }
}
