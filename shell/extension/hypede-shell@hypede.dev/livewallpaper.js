// Встроенные живые обои: шейдеры поверх обычных обоев.
//
// Каждый рисуется на видеокарте целиком, без видеофайла, поэтому почти не
// нагружает систему: 30 кадров в секунду, а когда рабочий стол закрыт
// развёрнутым окном, обзором или экраном блокировки — пауза. Цвета берутся
// из акцента, светлая и тёмная схема — свои.
//
// Видео и GIF пользователя показывает hypede-desktop (desktop.js).

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {CoverWatcher} from './cover.js';
import {accentHex, parseHex} from './util.js';

const FPS = 30;

const DECLARATIONS = `
uniform float hd_time;
uniform vec2 hd_size;
uniform vec3 hd_c0;
uniform vec3 hd_c1;
uniform vec3 hd_c2;
uniform vec3 hd_c3;
uniform float hd_dark;

float hd_hash(float n) { return fract(sin(n) * 43758.5453); }
float hd_hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

// Каждый шейдер вычисляет vec3 col по uv (0…1, y вниз), t и p (uv с учётом
// пропорций экрана).
const PRELUDE = `
vec2 uv = cogl_tex_coord0_in.xy;
float t = hd_time;
float aspect = hd_size.x / max(hd_size.y, 1.0);
vec2 p = vec2(uv.x * aspect, uv.y);
float px = 1.5 / max(hd_size.y, 1.0);
vec3 col;
`;

const SHADERS = {
    // Слои волн, как на обоях HypeDE, медленно перекатываются.
    waves: `
col = mix(hd_c0, mix(hd_c0, hd_c1, 0.55), smoothstep(0.0, 1.0, uv.y));
vec2 glow = vec2(0.72 * aspect + 0.08 * sin(t * 0.07), 0.28 + 0.04 * cos(t * 0.05));
col += hd_c2 * 0.18 * exp(-6.0 * dot(p - glow, p - glow));
for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float base = 0.50 + fi * 0.095;
    float y = base
        + 0.045 * sin(uv.x * (2.2 + fi * 0.55) + t * (0.16 + fi * 0.05) + fi * 1.9)
        + 0.020 * sin(uv.x * (5.3 + fi) - t * (0.23 + fi * 0.03) + fi * 3.1);
    float m = smoothstep(y - px, y + px, uv.y);
    vec3 layer = mix(mix(hd_c1, hd_c2, fi / 4.0), hd_c3, fi * fi / 32.0);
    layer *= 0.92 + 0.08 * (1.0 - uv.y);
    col = mix(col, layer, m);
}
`,
    // Северное сияние: занавеси из вертикальных лучей колышутся над
    // тёмным небом со звёздами.
    aurora: `
col = mix(hd_c0 * 0.7, hd_c0, uv.y);
vec2 cell = floor(uv * hd_size / 3.0);
float star = step(0.997, hd_hash2(cell)) * (0.5 + 0.5 * sin(t * 2.0 + hd_hash2(cell + 1.0) * 6.28));
col += vec3(star) * (1.0 - uv.y) * hd_dark * 0.8;
for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = uv.x + 0.04 * sin(uv.y * 3.0 + t * 0.2 + fi);
    float y = 0.42 + fi * 0.08
        + 0.10 * sin(x * (1.4 + fi * 0.5) + t * (0.08 + 0.03 * fi) + fi * 2.0)
        + 0.03 * sin(x * 5.0 + t * 0.25 + fi);
    float d = uv.y - y;
    // Резкий нижний край и длинный хвост вверх, как у настоящих лучей.
    float shape = d > 0.0 ? exp(-d * d * 900.0) : exp(d * (5.0 + fi * 2.0));
    float rays = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(x * 140.0 + 3.0 * sin(x * 9.0 + t * 0.35 + fi)), 3.0);
    float fade = smoothstep(0.0, 0.15, uv.x) * smoothstep(1.0, 0.85, uv.x) * 0.7 + 0.3;
    vec3 c = mix(hd_c2, hd_c3, clamp(-d * 3.0 + 0.2 * fi, 0.0, 1.0));
    col += c * shape * rays * fade * (0.85 - fi * 0.15);
}
`,
    // Боке: мягкие круги света медленно поднимаются.
    bokeh: `
col = mix(hd_c0, hd_c1 * 0.7 + hd_c0 * 0.3, uv.y);
for (int i = 0; i < 28; i++) {
    float fi = float(i);
    float speed = 0.008 + 0.018 * hd_hash(fi * 3.7);
    vec2 c = vec2(hd_hash(fi * 1.3) * aspect + 0.03 * sin(t * 0.2 + fi),
                  1.15 - fract(hd_hash(fi * 7.1) + t * speed) * 1.3);
    float r = 0.025 + 0.07 * hd_hash(fi * 5.3);
    float d = length(p - c);
    float a = smoothstep(r, r * 0.5, d) * (0.22 + 0.30 * hd_hash(fi * 9.1));
    a += smoothstep(r, r - px * 2.0, d) * smoothstep(r - px * 8.0, r - px * 2.0, d) * 0.18;
    vec3 tint = mix(hd_c2, hd_c3, hd_hash(fi * 2.9));
    col = mix(col, tint, a);
    col += tint * 0.06 * exp(-d * d / (r * r * 4.0));
}
`,
    // Меш-градиент: четыре цветных пятна плавно перетекают.
    mesh: `
vec2 a = vec2(0.20 * aspect + 0.15 * sin(t * 0.11), 0.25 + 0.15 * cos(t * 0.09));
vec2 b = vec2(0.80 * aspect + 0.12 * cos(t * 0.08), 0.30 + 0.18 * sin(t * 0.12));
vec2 c = vec2(0.35 * aspect + 0.18 * cos(t * 0.07 + 1.0), 0.80 + 0.10 * sin(t * 0.10));
vec2 d = vec2(0.75 * aspect + 0.16 * sin(t * 0.06 + 2.0), 0.85 + 0.12 * cos(t * 0.13));
float wa = 1.0 / (0.02 + dot(p - a, p - a));
float wb = 1.0 / (0.02 + dot(p - b, p - b));
float wc = 1.0 / (0.02 + dot(p - c, p - c));
float wd = 1.0 / (0.02 + dot(p - d, p - d));
col = (hd_c0 * wa + hd_c1 * wb + hd_c2 * wc + hd_c3 * wd) / (wa + wb + wc + wd);
col += (hd_hash2(uv * hd_size + t) - 0.5) / 255.0;
`,
};

export const LIVE_NAMES = Object.keys(SHADERS);

// Shell.GLSLEffect собирает шейдер один раз на класс, поэтому у каждого
// вида обоев — свой подкласс.
const LiveEffectBase = GObject.registerClass(
class LiveEffectBase extends Shell.GLSLEffect {
    _init() {
        super._init();
        this._time = 0;
        this._palette = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
        this._dark = 1;
        this._loc = {};
        for (const name of ['hd_time', 'hd_size', 'hd_c0', 'hd_c1', 'hd_c2', 'hd_c3', 'hd_dark'])
            this._loc[name] = this.get_uniform_location(name);
    }

    setState(time, palette, dark) {
        this._time = time;
        this._palette = palette;
        this._dark = dark;
        this.queue_repaint();
    }

    vfunc_paint_target(node, paintContext) {
        const actor = this.get_actor();
        this.set_uniform_float(this._loc.hd_time, 1, [this._time]);
        this.set_uniform_float(this._loc.hd_size, 2, [actor.width, actor.height]);
        this._palette.forEach((c, i) => this.set_uniform_float(this._loc[`hd_c${i}`], 3, c));
        this.set_uniform_float(this._loc.hd_dark, 1, [this._dark]);
        super.vfunc_paint_target(node, paintContext);
    }
});

const effectClasses = {};

function effectClass(kind) {
    effectClasses[kind] ??= GObject.registerClass({GTypeName: `HypeDELiveEffect_${kind}`},
        class extends LiveEffectBase {
            vfunc_build_pipeline() {
                const code = `${PRELUDE}${SHADERS[kind]}\ncogl_color_out = vec4(clamp(col, 0.0, 1.0), 1.0);\n`;
                this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, code, false);
            }
        });
    return effectClasses[kind];
}

function mix(a, b, t) {
    return a.map((v, i) => v + (b[i] - v) * t);
}

// rgb (0…1) → поворот оттенка: соседний цвет для третьего и четвёртого слоя.
function hueShift([r, g, b], degrees) {
    const a = degrees * Math.PI / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    const m = [
        0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
        0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283,
        0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
    ];
    return [
        m[0] * r + m[1] * g + m[2] * b,
        m[3] * r + m[4] * g + m[5] * b,
        m[6] * r + m[7] * g + m[8] * b,
    ].map(v => Math.min(1, Math.max(0, v)));
}

export class LiveWallpaper {
    constructor(settings) {
        this._settings = settings;
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._actors = [];
        this._time = 0;
        this._covered = [];
        this._settings.connectObject(
            'changed::wallpaper-live', () => this._rebuild(),
            'changed::lite-mode', () => this._rebuild(),
            'changed::accent-custom', () => this._updatePalette(),
            'changed::wallpaper-live-pause', () => this._updateRunning(),
            this);
        this._interface.connectObject(
            'changed::accent-color', () => this._updatePalette(),
            'changed::color-scheme', () => this._updatePalette(),
            this);
        St.Settings.get().connectObject('notify::enable-animations', () => this._updateRunning(), this);
        Main.layoutManager.connectObject('monitors-changed', () => this._rebuild(), this);
        this._rebuild();
    }

    get _kind() {
        const value = this._settings.get_string('wallpaper-live');
        const m = /^hypede:([a-z]+)$/.exec(value);
        if (!m || !SHADERS[m[1]] || this._settings.get_boolean('lite-mode'))
            return null;
        return m[1];
    }

    _destroyActors() {
        this._timeline?.stop();
        this._timeline = null;
        this._cover?.destroy();
        this._cover = null;
        Main.layoutManager._backgroundGroup.disconnectObject(this);
        for (const actor of this._actors)
            actor.destroy();
        this._actors = [];
    }

    _rebuild() {
        this._destroyActors();
        const kind = this._kind;
        if (!kind)
            return;
        const group = Main.layoutManager._backgroundGroup;
        for (const monitor of Main.layoutManager.monitors) {
            const actor = new Clutter.Actor({
                x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
                background_color: new Cogl.Color({red: 0, green: 0, blue: 0, alpha: 255}),
                reactive: false,
            });
            actor.add_effect_with_name('live', new (effectClass(kind))());
            actor.opacity = 0;
            group.add_child(actor);
            actor.ease({opacity: 255, duration: 600, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            this._actors.push(actor);
        }
        // Новые обои GNOME добавляет поверх — возвращаем свои наверх.
        group.connectObject('child-added', (_g, child) => {
            if (!this._actors.includes(child))
                this._raise();
        }, this);
        this._updatePalette();

        this._timeline = new Clutter.Timeline({actor: this._actors[0], duration: 1000, repeat_count: -1});
        let last = GLib.get_monotonic_time();
        let sinceDraw = 1e9;
        this._timeline.connect('new-frame', () => {
            const now = GLib.get_monotonic_time();
            const dt = (now - last) / 1e6;
            last = now;
            this._time += Math.min(dt, 0.1) * this._settings.get_double('wallpaper-live-speed');
            sinceDraw += dt;
            if (sinceDraw < 1 / FPS - 0.002)
                return;
            sinceDraw = 0;
            this._draw();
        });
        this._cover = new CoverWatcher(covered => {
            this._covered = covered;
            this._updateRunning();
        });
        this._updateRunning();
    }

    _raise() {
        const group = Main.layoutManager._backgroundGroup;
        for (const actor of this._actors)
            group.set_child_above_sibling(actor, null);
    }

    _updatePalette() {
        const accent = parseHex(accentHex(this._settings, this._interface)).map(v => v / 255);
        const dark = this._interface.get_string('color-scheme') === 'prefer-dark';
        const neighbour = hueShift(accent, 38);
        const far = hueShift(accent, -52);
        this._palette = dark ? [
            mix([0.04, 0.045, 0.06], accent, 0.10),
            mix([0.06, 0.07, 0.10], accent, 0.45),
            mix(accent, [1, 1, 1], 0.10),
            mix(neighbour, far, 0.5),
        ] : [
            mix([0.97, 0.975, 0.985], accent, 0.08),
            mix([1, 1, 1], accent, 0.45),
            mix(accent, [1, 1, 1], 0.15),
            mix(mix(neighbour, far, 0.5), [1, 1, 1], 0.35),
        ];
        this._dark = dark ? 1 : 0;
        this._draw();
    }

    _draw() {
        for (const actor of this._actors)
            actor.get_effect('live')?.setState(this._time, this._palette, this._dark);
    }

    _updateRunning() {
        if (!this._timeline)
            return;
        const pause = this._settings.get_boolean('wallpaper-live-pause');
        const allCovered = this._covered.length > 0 && this._covered.every(c => c);
        const run = St.Settings.get().enable_animations && !(pause && allCovered);
        if (run && !this._timeline.is_playing())
            this._timeline.start();
        else if (!run && this._timeline.is_playing())
            this._timeline.stop();
    }

    destroy() {
        this._destroyActors();
        this._settings.disconnectObject(this);
        this._interface.disconnectObject(this);
        St.Settings.get().disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
    }
}
