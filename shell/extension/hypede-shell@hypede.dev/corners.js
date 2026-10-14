// Скруглённые углы и тень у окон, которые не рисуют их сами.
//
// Окна GTK и libadwaita сами рисуют скругления и тень (их буфер больше
// самого окна — по краям лежит тень). У остальных — приложения Qt без
// декораций Adwaita, Firefox, окна без рамки — углы острые, а тени нет:
// Mutter не рисует тень окнам Wayland. Таким окнам HypeDE скругляет углы
// шейдером и подкладывает под них тень, как в Chrome OS.
//
// Развёрнутые, прикреплённые к краю и полноэкранные окна остаются
// прямоугольными.

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {isDesktopWindow} from './util.js';

const DECLARATIONS = `
uniform vec2 hd_size;
uniform float hd_radius;
`;

// Пиксель в углу за дугой радиуса становится прозрачным; край дуги
// сглаживается на ширину одного пикселя. Цвет в Cogl уже умножен на
// прозрачность, поэтому умножается весь цвет.
const CODE = `
vec2 hd_p = cogl_tex_coord0_in.xy * hd_size;
vec2 hd_q = min(hd_p, hd_size - hd_p);
if (hd_q.x < hd_radius && hd_q.y < hd_radius) {
    float hd_d = length(vec2(hd_radius) - hd_q);
    cogl_color_out *= clamp(hd_radius - hd_d + 0.5, 0.0, 1.0);
}
`;

export const CornersEffect = GObject.registerClass(
class CornersEffect extends Shell.GLSLEffect {
    _init(radius) {
        super._init();
        this._radius = radius;
        this._sizeLocation = this.get_uniform_location('hd_size');
        this._radiusLocation = this.get_uniform_location('hd_radius');
    }

    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, CODE, false);
    }

    set radius(value) {
        this._radius = value;
        this.queue_repaint();
    }

    vfunc_paint_target(node, paintContext) {
        const actor = this.get_actor();
        this.set_uniform_float(this._sizeLocation, 2, [actor.width, actor.height]);
        this.set_uniform_float(this._radiusLocation, 1, [this._radius]);
        super.vfunc_paint_target(node, paintContext);
    }
});

// Тень рисуется слоями вокруг окна, а под самим окном остаётся пустой:
// иначе она просвечивала бы в вырезанных углах. Рисуется она один раз в
// маленькую картинку (углы и по пикселю края), а на окно растягивается как
// border-image: при перемещении и изменении размера окна ничего не
// перерисовывается.
const SHADOW_MARGIN = 28;
const shadowFiles = new Map();

function shadowFile(radius, focused) {
    const key = `${radius}-${focused ? 1 : 0}`;
    if (shadowFiles.has(key))
        return shadowFiles.get(key);
    const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'hypede', 'shadows']);
    const path = GLib.build_filenamev([dir, `shadow-v1-${key}.png`]);
    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
        GLib.mkdir_with_parents(dir, 0o755);
        const m = SHADOW_MARGIN, r = radius;
        const size = 2 * (m + r) + 2;
        const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, size, size);
        const cr = new Cairo.Context(surface);
        const [blur, dy, strength] = focused ? [22, 6, 0.30] : [12, 2, 0.16];
        const roundRect = (x, y, rw, rh, rr) => {
            rr = Math.max(0, Math.min(rr, rw / 2, rh / 2));
            cr.newSubPath();
            cr.arc(x + rw - rr, y + rr, rr, -Math.PI / 2, 0);
            cr.arc(x + rw - rr, y + rh - rr, rr, 0, Math.PI / 2);
            cr.arc(x + rr, y + rh - rr, rr, Math.PI / 2, Math.PI);
            cr.arc(x + rr, y + rr, rr, Math.PI, 3 * Math.PI / 2);
            cr.closePath();
        };
        const win = size - 2 * m;
        cr.setFillRule(Cairo.FillRule.EVEN_ODD); // закрашивается только кольцо вокруг окна
        for (let i = blur; i > 0; i--) {
            // Каждый слой шире предыдущего; прозрачность убывает по гауссу.
            const t = i / blur;
            const alpha = strength * Math.exp(-4 * t * t) / blur * 3;
            cr.setSourceRGBA(0, 0, 0, alpha);
            roundRect(m - i, m - i + dy * (1 - t), win + 2 * i, win + 2 * i, r + i);
            roundRect(m, m, win, win, r);
            cr.fill();
        }
        cr.$dispose();
        surface.writeToPNG(path);
        surface.finish();
    }
    const uri = GLib.filename_to_uri(path, null);
    shadowFiles.set(key, uri);
    return uri;
}

const WindowShadow = GObject.registerClass(
class WindowShadow extends St.Widget {
    _init() {
        super._init({style_class: 'hypede-window-shadow'});
        this._radius = -1;
        this._focused = false;
        this._square = false;
    }

    update(radius, focused, square) {
        if (radius === this._radius && focused === this._focused && square === this._square)
            return;
        this._radius = radius;
        this._focused = focused;
        this._square = square;
        const slice = SHADOW_MARGIN + radius + 1;
        this.style = square ? null
            : `border-image: url("${shadowFile(radius, focused)}") ${slice} ${slice} ${slice} ${slice};`;
    }
});

// Окно без собственной тени и скруглений?
function needsCorners(window) {
    if (isDesktopWindow(window))
        return false;
    const type = window.get_window_type();
    if (type !== Meta.WindowType.NORMAL && type !== Meta.WindowType.DIALOG &&
        type !== Meta.WindowType.MODAL_DIALOG)
        return false;
    // Окна X11 с рамкой Mutter: рамку со скруглёнными углами и тень
    // рисует сам Mutter.
    if (window.get_client_type() === Meta.WindowClientType.X11 && window.decorated)
        return false;
    const buffer = window.get_buffer_rect();
    const frame = window.get_frame_rect();
    return buffer.width === frame.width && buffer.height === frame.height;
}

// Окно во весь экран или у края: без скруглений.
function isSquare(window) {
    return window.fullscreen || window.maximized_horizontally ||
        window.maximized_vertically || window.minimized;
}

class RoundedWindow {
    constructor(actor, manager) {
        this._actor = actor;
        this._window = actor.meta_window;
        this._manager = manager;

        this._shadow = new WindowShadow();
        const group = actor.get_parent();
        group.insert_child_below(this._shadow, actor);
        const m = SHADOW_MARGIN * St.ThemeContext.get_for_stage(global.stage).scale_factor;
        for (const [coordinate, offset] of [[Clutter.BindCoordinate.X, -m],
            [Clutter.BindCoordinate.Y, -m], [Clutter.BindCoordinate.WIDTH, 2 * m],
            [Clutter.BindCoordinate.HEIGHT, 2 * m]]) {
            this._shadow.add_constraint(new Clutter.BindConstraint({
                source: actor, coordinate, offset,
            }));
        }
        for (const prop of ['opacity', 'visible', 'scale-x', 'scale-y',
            'translation-x', 'translation-y']) {
            actor.bind_property(prop, this._shadow, prop,
                GObject.BindingFlags.SYNC_CREATE);
        }
        // Точка масштабирования — та же, что у окна.
        const syncPivot = () => {
            const pivot = actor.pivot_point;
            const w = actor.width, h = actor.height;
            this._shadow.set_pivot_point(
                (pivot.x * w + m) / (w + 2 * m), (pivot.y * h + m) / (h + 2 * m));
        };
        actor.connectObject('notify::pivot-point', syncPivot, 'notify::size', syncPivot, this);
        syncPivot();

        this._window.connectObject(
            'notify::maximized-horizontally', () => this.sync(),
            'notify::maximized-vertically', () => this.sync(),
            'notify::fullscreen', () => this.sync(),
            'notify::appears-focused', () => this._syncFocus(),
            this);
        actor.connectObject('destroy', () => manager.forget(actor), this);
        this.sync();
    }

    sync() {
        const round = !isSquare(this._window);
        const radius = this._manager.radius;
        let effect = this._actor.get_effect('hypede-corners');
        if (round && !effect) {
            effect = new CornersEffect(radius);
            this._actor.add_effect_with_name('hypede-corners', effect);
        } else if (!round && effect) {
            this._actor.remove_effect(effect);
        } else if (effect) {
            effect.radius = radius;
        }
        this._square = !round;
        this._syncFocus();
    }

    _syncFocus() {
        this._shadow.update(this._manager.radius, this._window.appears_focused, this._square);
    }

    restack() {
        const group = this._actor.get_parent();
        if (group && this._shadow.get_parent() === group)
            group.set_child_below_sibling(this._shadow, this._actor);
    }

    destroy() {
        this._window.disconnectObject(this);
        this._actor.disconnectObject(this);
        const effect = this._actor.get_effect('hypede-corners');
        if (effect)
            this._actor.remove_effect(effect);
        this._shadow.destroy();
    }
}

export class WindowCorners {
    constructor(settings) {
        this._settings = settings;
        this._windows = new Map();

        this._settings.connectObject(
            'changed::window-corners', () => this._reset(),
            'changed::lite-mode', () => this._reset(),
            'changed::window-corner-radius', () => this._syncAll(),
            this);
        global.display.connectObject(
            'window-created', (display, window) => this._watch(window),
            'restacked', () => this._restack(),
            this);
        this._reset();
    }

    get radius() {
        return this._settings.get_int('window-corner-radius');
    }

    _reset() {
        for (const rounded of this._windows.values())
            rounded.destroy();
        this._windows.clear();
        if (!this._settings.get_boolean('window-corners') || this._settings.get_boolean('lite-mode'))
            return;
        for (const actor of global.get_window_actors())
            this._track(actor);
    }

    // Размеры буфера и рамки известны только после первой отрисовки.
    _watch(window) {
        const actor = window.get_compositor_private();
        if (!actor)
            return;
        actor.connectObject('first-frame', () => {
            actor.disconnectObject(this);
            this._track(actor);
        }, this);
    }

    _track(actor) {
        const window = actor.meta_window;
        if (!this._settings.get_boolean('window-corners') || this._settings.get_boolean('lite-mode') || !window ||
            this._windows.has(actor) || !needsCorners(window))
            return;
        this._windows.set(actor, new RoundedWindow(actor, this));
    }

    forget(actor) {
        this._windows.get(actor)?.destroy();
        this._windows.delete(actor);
    }

    _syncAll() {
        for (const rounded of this._windows.values())
            rounded.sync();
    }

    _restack() {
        for (const rounded of this._windows.values())
            rounded.restack();
    }

    destroy() {
        this._settings.disconnectObject(this);
        global.display.disconnectObject(this);
        for (const actor of global.get_window_actors())
            actor.disconnectObject(this);
        for (const rounded of this._windows.values())
            rounded.destroy();
        this._windows.clear();
    }
}
