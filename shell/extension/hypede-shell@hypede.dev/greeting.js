// Приветствие при входе — по мотивам Serpantinum.
//
// Экран заливают волны цвета акцента, на тёмном фоне по буквам печатается
// «Доброе утро, Имя» (при первом входе — «Добро пожаловать в HypeDE»), под
// ним — дата. Потом волны уходят вправо и открывают рабочий стол. Каждая
// буква тихо «щёлкает», волны шуршат, в конце — звук входа (звуковая тема
// HypeDE). Любая клавиша или щелчок пропускают приветствие.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const WIPE_TIME = 1000;
const LETTER_STEP = 55;
const HOLD_TIME = 1100;
const REVEAL_TIME = 750;

const ACCENTS = {
    blue: '#3584e4', teal: '#2190a4', green: '#3a944a', yellow: '#c88800',
    orange: '#ed5b00', red: '#e62d42', pink: '#d56199', purple: '#9141ac',
    slate: '#6f8396',
};

function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255);
}

function mix(a, b, t) {
    return a.map((v, i) => v + (b[i] - v) * t);
}

function playSound(name) {
    global.display.get_sound_player().play_from_theme(name, name, null);
}

function duration(ms) {
    return ms * St.Settings.get().slow_down_factor;
}

// Волны, заливающие экран слева направо (progress 0→1) и уходящие вправо
// (progress 1→2).
const WaveWipe = GObject.registerClass(
class WaveWipe extends St.DrawingArea {
    _init(colors) {
        super._init({reactive: false});
        this._colors = colors;
        this.progress = 0;
        this.connect('repaint', () => this._draw());
    }

    _draw() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        const n = this._colors.length;
        const leaving = this.progress > 1;
        const p = leaving ? this.progress - 1 : this.progress;
        for (let k = 0; k < n; k++) {
            // Слои рисуются снизу вверх. При появлении первым идёт нижний,
            // при уходе — верхний: под ним открываются следующие.
            const order = leaving ? n - 1 - k : k;
            let q = Math.max(0, Math.min(1, (p - order * 0.07) * 1.6));
            q = 1 - (1 - q) ** 3;
            if ((!leaving && q <= 0) || (leaving && q >= 1))
                continue;
            const amp = w * 0.035 * Math.sin(q * Math.PI);
            const phase = p * 6 + k;
            cr.setSourceRGB(...this._colors[k]);
            if (!leaving) {
                const x = w * q;
                cr.moveTo(0, 0);
                cr.lineTo(x, 0);
                cr.curveTo(x + Math.sin(phase) * amp, h * 0.33, x + Math.cos(phase) * amp, h * 0.66, x, h);
                cr.lineTo(0, h);
            } else {
                const x = w * q;
                cr.moveTo(w, 0);
                cr.lineTo(x, 0);
                cr.curveTo(x + Math.sin(phase) * amp, h * 0.33, x + Math.cos(phase) * amp, h * 0.66, x, h);
                cr.lineTo(w, h);
            }
            cr.closePath();
            cr.fill();
        }
        cr.$dispose();
    }
});

export class Greeting {
    constructor(settings) {
        this._settings = settings;
        const mode = settings.get_string('greeting');
        const first = !settings.get_boolean('greeting-shown');
        if (mode === 'never' || (mode === 'first' && !first) || settings.get_boolean('lite-mode'))
            return;
        this._first = first;
        if (Main.layoutManager._startingUp)
            Main.layoutManager.connectObject('startup-complete', () => this._show(), this);
        else if (GLib.getenv('HYPEDE_GREETING_NOW') === '1')
            this._show();
    }

    _text() {
        const realName = GLib.get_real_name();
        const name = (realName && realName !== 'Unknown' ? realName : GLib.get_user_name()).split(' ')[0];
        if (this._first)
            return _('Welcome to HypeDE');
        const hour = GLib.DateTime.new_now_local().get_hour();
        if (hour < 5)
            return _('Good night, %s').format(name);
        if (hour < 12)
            return _('Good morning, %s').format(name);
        if (hour < 18)
            return _('Good afternoon, %s').format(name);
        return _('Good evening, %s').format(name);
    }

    _show() {
        Main.layoutManager.disconnectObject(this);
        // Без анимаций приветствие не нужно: оно всё из движения.
        if (!St.Settings.get().enable_animations)
            return;
        this._settings.set_boolean('greeting-shown', true);

        const accentName = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).get_string('accent-color');
        const accent = rgb(ACCENTS[accentName] ?? ACCENTS.blue);
        const base = mix([0.07, 0.075, 0.09], accent, 0.08);
        const colors = [mix(base, [0, 0, 0], 0.3), mix(base, accent, 0.4), accent,
            mix(accent, [1, 1, 1], 0.45), base];

        const monitor = Main.layoutManager.primaryMonitor;
        // Подложка на весь экран (все мониторы); волны — во всю подложку.
        this._overlay = new St.Widget({
            reactive: true,
            x: 0, y: 0,
            width: global.stage.width,
            height: global.stage.height,
        });
        this._wipe = new WaveWipe(colors);
        this._wipe.set_position(0, 0);
        this._wipe.set_size(global.stage.width, global.stage.height);
        this._overlay.add_child(this._wipe);

        // Текст — на основном мониторе.
        this._content = new St.BoxLayout({
            style_class: 'hypede-greeting',
            orientation: Clutter.Orientation.VERTICAL,
            x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
        });
        const center = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
        const column = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
        });
        this._line = new St.BoxLayout({style_class: 'hypede-greeting-title', x_align: Clutter.ActorAlign.CENTER});
        this._letters = [...this._text()].map(ch => {
            const label = new St.Label({text: ch === ' ' ? ' ' : ch, opacity: 0, translation_y: 14});
            this._line.add_child(label);
            return label;
        });
        column.add_child(this._line);
        const now = GLib.DateTime.new_now_local();
        this._subtitle = new St.Label({
            style_class: 'hypede-greeting-subtitle',
            // Translators: date under the greeting, strftime format.
            text: now.format(_('%A, %B %-d')),
            x_align: Clutter.ActorAlign.CENTER,
            opacity: 0,
        });
        column.add_child(this._subtitle);
        center.add_child(column);
        this._content.add_child(center);
        this._hint = new St.Label({
            style_class: 'hypede-greeting-hint',
            text: _('Press any key to continue'),
            x_align: Clutter.ActorAlign.CENTER,
            opacity: 0,
        });
        this._content.add_child(this._hint);
        this._overlay.add_child(this._content);

        Main.layoutManager.uiGroup.add_child(this._overlay);
        Main.layoutManager.uiGroup.set_child_above_sibling(this._overlay, null);
        this._grab = Main.pushModal(this._overlay, {actionMode: Shell.ActionMode.NONE});
        this._overlay.connect('button-press-event', () => this._finish());
        this._overlay.connect('key-press-event', () => this._finish());

        this._play();
    }

    _play() {
        playSound('hypede-swoosh');
        this._animateWipe(0, 1, duration(WIPE_TIME), () => this._type());
    }

    _animateWipe(from, to, time, onDone) {
        this._timeline?.stop();
        this._timeline = new Clutter.Timeline({actor: this._wipe, duration: Math.max(1, time)});
        this._timeline.connect('new-frame', () => {
            this._wipe.progress = from + (to - from) * this._timeline.get_progress();
            this._wipe.queue_repaint();
        });
        this._timeline.connect('completed', () => {
            this._wipe.progress = to;
            this._wipe.queue_repaint();
            onDone?.();
        });
        this._timeline.start();
    }

    // Буквы появляются одна за другой и чуть подпрыгивают.
    _type() {
        let i = 0;
        this._typeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration(LETTER_STEP), () => {
            const letter = this._letters[i++];
            if (!letter) {
                this._typeId = 0;
                this._subtitle.ease({opacity: 200, duration: duration(500), mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                this._hint.ease({opacity: 140, duration: duration(800), delay: duration(300)});
                this._holdId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration(HOLD_TIME), () => {
                    this._holdId = 0;
                    this._finish();
                    return GLib.SOURCE_REMOVE;
                });
                return GLib.SOURCE_REMOVE;
            }
            if (letter.text.trim())
                playSound('hypede-type');
            // Прозрачность — без «пружины»: перелёт за 255 дал бы мерцание.
            letter.ease({
                opacity: 255,
                duration: duration(300),
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
            letter.ease({
                translation_y: 0,
                duration: duration(420),
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            });
            return GLib.SOURCE_CONTINUE;
        });
    }

    // Уход: текст тает, волны уезжают вправо и открывают рабочий стол.
    _finish() {
        if (this._finishing || !this._overlay)
            return;
        this._finishing = true;
        for (const id of [this._typeId, this._holdId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._typeId = this._holdId = 0;
        playSound('desktop-login');
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._overlay.reactive = false;
        this._content.set_pivot_point(0.5, 0.5);
        this._content.ease({
            opacity: 0, scale_x: 0.96, scale_y: 0.96,
            duration: duration(350),
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
        });
        const from = Math.max(1, this._wipe.progress);
        this._animateWipe(from, 2, duration(REVEAL_TIME), () => this.destroy());
    }

    destroy() {
        Main.layoutManager.disconnectObject(this);
        for (const id of [this._typeId, this._holdId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._typeId = this._holdId = 0;
        this._timeline?.stop();
        this._timeline = null;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._overlay?.destroy();
        this._overlay = null;
    }
}
