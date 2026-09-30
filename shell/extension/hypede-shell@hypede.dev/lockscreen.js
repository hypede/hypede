// Экран блокировки HypeDE.
//
// Идея подсмотрена у Serpantinum: при блокировке экран заливают цветные
// волны, под ними проступают размытые обои и большие часы с мигающим
// двоеточием. Стоит нажать клавишу или щёлкнуть — часы уменьшаются и уходят
// вверх, поле пароля «выпрыгивает» с лёгким перелётом, а по бокам
// раскрываются карточки с зарядом и загрузкой системы. После ввода пароля
// экран «сворачивается» и тает.
//
// Уведомления, медиаплеер и выбор пользователя по-прежнему показывает родной
// экран блокировки GNOME — HypeDE только меняет его облик и анимации.
// Пароль проверяет GDM, а без него — hypede-auth (см. locker.js).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {InjectionManager, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {getShield} from './locker.js';

const INTRO_TIME = 1100;
const REVEAL_TIME = 420;
const UNLOCK_TIME = 380;
const STATS_INTERVAL = 2000;

// Акцентные цвета GNOME (org.gnome.desktop.interface accent-color).
const ACCENTS = {
    blue: '#3584e4', teal: '#2190a4', green: '#3a944a', yellow: '#c88800',
    orange: '#ed5b00', red: '#e62d42', pink: '#d56199', purple: '#9141ac',
    slate: '#6f8396',
};

function _hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255);
}

function _mix(a, b, t) {
    return a.map((v, i) => v + (b[i] - v) * t);
}

// Функции плавности для ручных анимаций.
const easeOutCubic = t => 1 - (1 - t) ** 3;
const easeOutBack = (t, s = 1.4) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;

// Длительность с учётом скорости анимаций и их отключения.
function _duration(ms) {
    const settings = St.Settings.get();
    if (!settings.enable_animations)
        return 0;
    return ms * settings.slow_down_factor;
}

function _readFile(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Волны при блокировке: пять цветных слоёв прокатываются сверху вниз.
// ---------------------------------------------------------------------------

const WaveCurtain = GObject.registerClass(
class WaveCurtain extends St.DrawingArea {
    _init(colors) {
        super._init({reactive: false});
        this._colors = colors;
        this._progress = 0;
        this.connect('repaint', () => this._draw());
    }

    play(onDone) {
        const duration = _duration(INTRO_TIME);
        if (duration === 0) {
            onDone?.();
            this.destroy();
            return;
        }
        this._timeline = new Clutter.Timeline({actor: this, duration});
        this._timeline.connect('new-frame', () => {
            this._progress = this._timeline.get_progress();
            // Когда волны накрыли экран, занавес тает.
            this.opacity = this._progress < 0.72 ? 255
                : Math.round(255 * Math.max(0, 1 - (this._progress - 0.72) / 0.28));
            this.queue_repaint();
        });
        this._timeline.connect('completed', () => {
            onDone?.();
            this.destroy();
        });
        this._timeline.start();
    }

    _draw() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        const rev = Math.min(1, this._progress / 0.72);
        const n = this._colors.length;

        // Слой, уже накрывший экран целиком, — просто заливка.
        let full = -1;
        for (let k = n - 1; k >= 0; k--) {
            if ((rev - k * 0.08) * 1.5 >= 1) {
                full = k;
                break;
            }
        }
        if (full >= 0) {
            cr.setSourceRGB(...this._colors[full]);
            cr.paint();
        }

        const amp = h * 0.035;
        for (let i = full + 1; i < n; i++) {
            const prog = (rev - i * 0.08) * 1.5;
            if (prog <= 0)
                continue;
            const p = prog ** 1.4;
            const y = h * p;
            const wave = amp * Math.sin(p * Math.PI) * (1.5 - i * 0.2);
            const phase = rev * 7.85 + i * 0.5;
            cr.moveTo(0, 0);
            cr.lineTo(0, y);
            cr.curveTo(w * 0.38, y + Math.sin(phase) * wave,
                w * 0.72, y + Math.cos(phase + Math.PI) * wave,
                w, y);
            cr.lineTo(w, 0);
            cr.closePath();
            cr.setSourceRGB(...this._colors[i]);
            cr.fill();
        }
        cr.$dispose();
    }
});

// ---------------------------------------------------------------------------
// Часы: цифровые с мигающим двоеточием, «столбиком» или стрелочные.
// ---------------------------------------------------------------------------

const LockClock = GObject.registerClass(
class LockClock extends St.BoxLayout {
    _init(style) {
        super._init({
            style_class: `hypede-lock-clock ${style}`,
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

        if (style === 'analog') {
            this._face = new St.DrawingArea({style_class: 'hypede-lock-analog', x_align: Clutter.ActorAlign.CENTER});
            this._face.connect('repaint', () => this._drawFace());
            this.add_child(this._face);
        } else {
            this._time = new St.BoxLayout({
                style_class: 'hypede-lock-time',
                x_align: Clutter.ActorAlign.CENTER,
                orientation: style === 'stacked'
                    ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL,
            });
            this._hours = new St.Label({style_class: 'hypede-lock-hours', x_align: Clutter.ActorAlign.CENTER});
            this._minutes = new St.Label({style_class: 'hypede-lock-minutes', x_align: Clutter.ActorAlign.CENTER});
            this._time.add_child(this._hours);
            if (style !== 'stacked') {
                this._colon = new St.Label({style_class: 'hypede-lock-colon', text: ':', y_align: Clutter.ActorAlign.CENTER});
                this._time.add_child(this._colon);
            }
            this._time.add_child(this._minutes);
            this.add_child(this._time);
            // «Столбиком» цифры стоят плотнее: у крупного шрифта большие
            // поля сверху и снизу.
            if (style === 'stacked') {
                this._minutes.connect('notify::height', () => {
                    const shift = -Math.round(this._minutes.height * 0.22);
                    this._minutes.translation_y = shift;
                    this._date.translation_y = shift;
                });
            }
        }

        this._date = new St.Label({style_class: 'hypede-lock-date', x_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._date);

        this._update();
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });

        // Двоеточие «дышит», как в Serpantinum: полсекунды гаснет,
        // полсекунды разгорается.
        if (this._colon) {
            let dim = true;
            this._pulseId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._colon.ease({
                    opacity: dim ? 90 : 255,
                    duration: 450,
                    mode: dim ? Clutter.AnimationMode.EASE_IN_CUBIC : Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
                dim = !dim;
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _update() {
        const now = GLib.DateTime.new_now_local();
        const twelve = this._interface.get_string('clock-format') === '12h';
        if (this._hours) {
            this._hours.text = now.format(twelve ? '%l' : '%H').trim();
            this._minutes.text = now.format('%M');
        }
        // Translators: date on the lock screen, strftime format.
        this._date.text = now.format(_('%A, %B %-d'));
        this._face?.queue_repaint();
    }

    _drawFace() {
        const cr = this._face.get_context();
        const [w, h] = this._face.get_surface_size();
        const r = Math.min(w, h) / 2 - 2;
        const cx = w / 2, cy = h / 2;
        const now = GLib.DateTime.new_now_local();
        const sec = now.get_second();
        const min = now.get_minute() + sec / 60;
        const hour = (now.get_hour() % 12) + min / 60;

        cr.setSourceRGBA(1, 1, 1, 0.14);
        cr.arc(cx, cy, r, 0, 2 * Math.PI);
        cr.fill();
        cr.setSourceRGBA(1, 1, 1, 0.5);
        for (let i = 0; i < 12; i++) {
            const a = i * Math.PI / 6;
            const inner = i % 3 === 0 ? r * 0.8 : r * 0.87;
            cr.setLineWidth(i % 3 === 0 ? 4 : 2);
            cr.moveTo(cx + Math.sin(a) * inner, cy - Math.cos(a) * inner);
            cr.lineTo(cx + Math.sin(a) * r * 0.93, cy - Math.cos(a) * r * 0.93);
            cr.stroke();
        }
        const hand = (angle, length, width, rgba) => {
            cr.setSourceRGBA(...rgba);
            cr.setLineWidth(width);
            cr.setLineCap(1); // ROUND
            cr.moveTo(cx, cy);
            cr.lineTo(cx + Math.sin(angle) * length, cy - Math.cos(angle) * length);
            cr.stroke();
        };
        hand(hour * Math.PI / 6, r * 0.5, 8, [1, 1, 1, 0.95]);
        hand(min * Math.PI / 30, r * 0.74, 5, [1, 1, 1, 0.85]);
        hand(sec * Math.PI / 30, r * 0.8, 2, [...(this._accent ?? [0.53, 0.72, 1]), 1]);
        cr.setSourceRGBA(1, 1, 1, 1);
        cr.arc(cx, cy, 6, 0, 2 * Math.PI);
        cr.fill();
        cr.$dispose();
    }

    set accent(rgb) {
        this._accent = rgb;
    }

    vfunc_destroy() {
        for (const id of [this._timerId, this._pulseId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._timerId = this._pulseId = 0;
        super.vfunc_destroy();
    }
});

// ---------------------------------------------------------------------------
// Карточки по бокам от поля пароля.
// ---------------------------------------------------------------------------

function _bar(styleClass = '') {
    const track = new St.Widget({
        style_class: `hypede-lock-bar ${styleClass}`,
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
    });
    const fill = new St.Widget({
        style_class: 'hypede-lock-bar-fill',
        x_align: Clutter.ActorAlign.START,
        y_expand: true,
    });
    fill.width = 0;
    track.add_child(fill);
    track.setValue = value => {
        const width = Math.round(track.width * Math.max(0, Math.min(1, value)));
        fill.ease({width, duration: 800, mode: Clutter.AnimationMode.EASE_OUT_QUINT});
    };
    return track;
}

function _card(title, iconName) {
    const card = new St.BoxLayout({
        style_class: 'hypede-lock-card',
        orientation: Clutter.Orientation.VERTICAL,
    });
    const header = new St.BoxLayout({style_class: 'hypede-lock-card-header'});
    header.add_child(new St.Icon({icon_name: iconName, style_class: 'hypede-lock-card-icon'}));
    header.add_child(new St.Label({text: title, style_class: 'hypede-lock-card-title', y_align: Clutter.ActorAlign.CENTER}));
    card.add_child(header);
    return card;
}

function _row(card, label) {
    const row = new St.BoxLayout({style_class: 'hypede-lock-row', orientation: Clutter.Orientation.VERTICAL});
    const line = new St.BoxLayout();
    line.add_child(new St.Label({text: label, style_class: 'hypede-lock-row-label', x_expand: true}));
    const value = new St.Label({style_class: 'hypede-lock-row-value', text: '—'});
    line.add_child(value);
    row.add_child(line);
    const bar = _bar();
    row.add_child(bar);
    card.add_child(row);
    return {value, bar};
}

class SystemCard {
    constructor() {
        this.actor = _card(_('System'), 'utilities-system-monitor-symbolic');
        this._cpu = _row(this.actor, _('Processor'));
        this._ram = _row(this.actor, _('Memory'));
        this._uptime = new St.Label({style_class: 'hypede-lock-card-footnote'});
        this.actor.add_child(this._uptime);
        this._lastCpu = null;
    }

    update() {
        const stat = _readFile('/proc/stat')?.split('\n')[0]?.trim().split(/\s+/).slice(1).map(Number);
        if (stat?.length >= 4) {
            const idle = stat[3] + (stat[4] ?? 0);
            const total = stat.reduce((a, b) => a + b, 0);
            if (this._lastCpu) {
                const dTotal = total - this._lastCpu.total;
                const usage = dTotal > 0 ? 1 - (idle - this._lastCpu.idle) / dTotal : 0;
                this._cpu.value.text = `${Math.round(usage * 100)} %`;
                this._cpu.bar.setValue(usage);
            }
            this._lastCpu = {idle, total};
        }

        const mem = _readFile('/proc/meminfo');
        if (mem) {
            const get = key => Number(mem.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] ?? 0);
            const total = get('MemTotal');
            const used = total - get('MemAvailable');
            if (total > 0) {
                // Translators: memory usage, "3.1 / 16.0 GB".
                this._ram.value.text = _('%s / %s GB').format(
                    (used / 1048576).toFixed(1), (total / 1048576).toFixed(1));
                this._ram.bar.setValue(used / total);
            }
        }

        const uptime = Number(_readFile('/proc/uptime')?.split(' ')[0] ?? 0);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        this._uptime.text = _('Up for %d h %d min').format(hours, minutes);
    }
}

class PowerCard {
    constructor() {
        this._battery = this._findBattery();
        if (this._battery) {
            this.actor = _card(_('Battery'), 'battery-symbolic');
            this._percent = new St.Label({style_class: 'hypede-lock-big'});
            this.actor.add_child(this._percent);
            this._bar = _bar('battery');
            this.actor.add_child(this._bar);
            this._state = new St.Label({style_class: 'hypede-lock-card-footnote'});
            this.actor.add_child(this._state);
        } else {
            // Без батареи — карточка «Сегодня» с календарным листком.
            this.actor = _card(_('Today'), 'x-office-calendar-symbolic');
            this._day = new St.Label({style_class: 'hypede-lock-big'});
            this.actor.add_child(this._day);
            this._month = new St.Label({style_class: 'hypede-lock-card-footnote'});
            this.actor.add_child(this._month);
        }
        this.update();
    }

    _findBattery() {
        const dir = Gio.File.new_for_path('/sys/class/power_supply');
        try {
            const children = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = children.next_file(null))) {
                const path = `/sys/class/power_supply/${info.get_name()}`;
                if (_readFile(`${path}/type`)?.trim() === 'Battery')
                    return path;
            }
        } catch {
            // нет /sys/class/power_supply — значит, нет и батареи
        }
        return null;
    }

    update() {
        if (this._battery) {
            const capacity = Number(_readFile(`${this._battery}/capacity`) ?? 0);
            const status = _readFile(`${this._battery}/status`)?.trim();
            this._percent.text = `${capacity} %`;
            this._bar.setValue(capacity / 100);
            this._state.text = {
                Charging: _('Charging'),
                Full: _('Fully charged'),
                Discharging: _('On battery'),
            }[status] ?? _('Plugged in');
            if (capacity <= 15 && status !== 'Charging')
                this._bar.add_style_class_name('low');
            else
                this._bar.remove_style_class_name('low');
        } else {
            const now = GLib.DateTime.new_now_local();
            this._day.text = now.format('%-d');
            // Translators: month and weekday on the lock screen card.
            this._month.text = now.format(_('%B, %A'));
        }
    }
}

// ---------------------------------------------------------------------------
// Оформление одного экземпляра экрана блокировки GNOME.
// ---------------------------------------------------------------------------

class HypeLockDecoration {
    constructor(dialog, settings) {
        this._dialog = dialog;
        this._settings = settings;
        this._reveal = 0;

        const interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const accentName = interfaceSettings.get_string('accent-color');
        this._accent = _hexToRgb(ACCENTS[accentName] ?? ACCENTS.blue);

        dialog.add_style_class_name('hypede-lock-dialog');

        // Затемнение поверх размытых обоев.
        this._dim = new St.Widget({style_class: 'hypede-lock-dim'});
        this._dim.add_constraint(new Clutter.BindConstraint({
            source: dialog, coordinate: Clutter.BindCoordinate.SIZE,
        }));
        dialog.insert_child_above(this._dim, dialog._backgroundGroup);

        // Слой HypeDE: часы, подсказка, карточки. На основном мониторе.
        this._layer = new St.Widget({style_class: 'hypede-lock-layer'});
        const monitor = Main.layoutManager.primaryMonitor;
        this._layer.set_position(monitor.x, monitor.y);
        this._layer.set_size(monitor.width, monitor.height);
        dialog.insert_child_above(this._layer, this._dim);

        this._clock = new LockClock(settings.get_string('lock-clock-style'));
        this._clock.accent = this._accent;
        this._layer.add_child(this._clock);

        this._hint = new St.Label({
            style_class: 'hypede-lock-hint',
            text: _('Press any key or click to unlock'),
        });
        this._layer.add_child(this._hint);

        this._cards = [];
        if (settings.get_boolean('lock-show-cards')) {
            this._power = new PowerCard();
            this._system = new SystemCard();
            this._cards = [this._power, this._system];
            for (const card of this._cards) {
                card.actor.opacity = 0;
                this._layer.add_child(card.actor);
            }
        }

        // Родные часы GNOME не нужны — их место заняли наши.
        dialog._clock.opacity = 0;

        this._applyBlur(false);
        this._update(0);
        // Размеры надписей известны только после применения стилей.
        this._clock.connect('notify::width', () => this._layout());
        for (const card of this._cards)
            card.actor.connect('notify::height', () => this._layout());
        this._layoutLaterId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._layoutLaterId = 0;
            this._layout();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Размытие обоев: сильнее, когда появилось поле пароля.
    _applyBlur(prompt) {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const strength = this._settings.get_int('lock-blur') / 100;
        const radius = Math.round(strength * (prompt ? 140 : 100) * scale);
        const brightness = prompt ? 0.62 : 0.78;
        for (const widget of this._dialog._backgroundGroup) {
            const effect = widget.get_effect('blur');
            if (!effect)
                continue;
            effect.enabled = radius > 0;
            if (radius > 0) {
                widget.ease_property('@effects.blur.radius', radius, {
                    duration: _duration(500), mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            }
            widget.ease_property('@effects.blur.brightness', brightness, {
                duration: _duration(500), mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        }
    }

    // Расстановка: часы в центре (или выше, когда открыт ввод пароля),
    // карточки — по бокам от поля пароля.
    _layout() {
        const w = this._layer.width, h = this._layer.height;
        if (!w || !h)
            return;
        const p = this._reveal;
        // Размер берётся из стилей: слой — это FixedLayout, он сам отдаёт
        // детям их естественный размер.
        const [, clockW] = this._clock.get_preferred_width(-1);
        const [, clockH] = this._clock.get_preferred_height(clockW);
        this._clock.set_pivot_point(0.5, 0.0);
        const idleY = h * 0.5 - clockH * 0.62;
        const promptY = h * 0.07;
        this._clock.set_position(Math.round((w - clockW) / 2),
            Math.round(idleY + (promptY - idleY) * easeOutCubic(p)));
        const scale = 1 - 0.4 * easeOutCubic(p);
        this._clock.set_scale(scale, scale);

        const [, hintW] = this._hint.get_preferred_width(-1);
        this._hint.set_position(Math.round((w - hintW) / 2), Math.round(h * 0.8));
        this._hint.opacity = Math.round(230 * (1 - p));

        // Карточки «раскрываются крыльями» с небольшим перелётом.
        const cardP = Math.max(0, (p - 0.3) / 0.7);
        const wing = easeOutBack(cardP);
        const gap = Math.min(w * 0.2, 330);
        this._cards.forEach((card, i) => {
            const actor = card.actor;
            const [, cw] = actor.get_preferred_width(-1);
            const [, ch] = actor.get_preferred_height(cw);
            const side = i === 0 ? -1 : 1;
            const cx = w / 2 + side * (gap + cw / 2);
            actor.set_position(Math.round(cx - cw / 2), Math.round(h * 0.52 - ch / 2));
            actor.set_pivot_point(side < 0 ? 1 : 0, 0.5);
            actor.translation_x = side * 70 * (1 - wing);
            actor.set_scale(0.85 + 0.15 * wing, 0.85 + 0.15 * wing);
            actor.opacity = Math.round(255 * Math.min(1, cardP * 1.4));
        });
    }

    // Вызывается из _setTransitionProgress экрана блокировки GNOME:
    // 0 — только часы, 1 — поле пароля.
    _update(progress) {
        const was = this._reveal;
        this._reveal = progress;
        this._dialog._clock.opacity = 0;

        // Поле пароля — с «перелётом».
        const box = this._dialog._promptBox;
        if (box) {
            const s = 0.82 + 0.18 * easeOutBack(progress, 1.7);
            box.set_scale(s, s);
        }
        this._dim.opacity = Math.round(255 * (0.3 + 0.25 * progress));
        this._layout();

        if (progress > 0 && was === 0) {
            this._applyBlur(true);
            this._startStats();
        } else if (progress === 0 && was > 0) {
            this._applyBlur(false);
            this._stopStats();
        }
    }

    _startStats() {
        if (this._statsId || this._cards.length === 0)
            return;
        const tick = () => {
            for (const card of this._cards)
                card.update();
        };
        tick();
        this._statsId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, STATS_INTERVAL, () => {
            tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopStats() {
        if (this._statsId)
            GLib.source_remove(this._statsId);
        this._statsId = 0;
    }

    // Вступление: волны цветов акцента, потом проявление часов.
    playIntro(onDone) {
        global.display.get_sound_player().play_from_theme('hypede-lock', 'lock', null);
        // Экран блокировки GNOME переиспользуется между блокировками —
        // вернуть то, что свернула прошлая разблокировка.
        for (const actor of [this._clock, ...this._cards.map(c => c.actor)]) {
            actor.remove_all_transitions();
            actor.opacity = 255;
            actor.set_scale(1, 1);
        }
        this._layout();
        this._layer.opacity = 0;
        const reveal = () => {
            this._clock.ease({
                scale_x: 1, scale_y: 1,
                duration: REVEAL_TIME + 200,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            });
            this._layer.ease({
                opacity: 255,
                duration: REVEAL_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        };
        if (!this._settings.get_boolean('lock-intro-animation') || this._settings.get_boolean('lite-mode') ||
            _duration(INTRO_TIME) === 0) {
            reveal();
            onDone?.();
            return;
        }
        const dark = [0.07, 0.08, 0.1];
        const colors = [
            dark,
            _mix(dark, this._accent, 0.35),
            this._accent,
            _mix(this._accent, [1, 1, 1], 0.35),
            _mix(dark, this._accent, 0.15),
        ];
        const curtain = new WaveCurtain(colors);
        curtain.add_constraint(new Clutter.BindConstraint({
            source: this._dialog, coordinate: Clutter.BindCoordinate.SIZE,
        }));
        this._dialog.add_child(curtain);
        this._clock.set_scale(0.86, 0.86);
        curtain.play(onDone);
        this._revealId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(_duration(INTRO_TIME) * 0.6), () => {
            this._revealId = 0;
            reveal();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Разблокировка: содержимое «сворачивается» к центру.
    playUnlock() {
        global.display.get_sound_player().play_from_theme('hypede-unlock', 'unlock', null);
        for (const actor of [this._clock, ...this._cards.map(c => c.actor)]) {
            actor.set_pivot_point(0.5, 0.5);
            // Масштаб — с «оттяжкой», прозрачность — ровно: перелёт
            // прозрачности за 0 дал бы вспышку.
            actor.ease({
                scale_x: 0.6,
                scale_y: 0.6,
                duration: UNLOCK_TIME * 0.8,
                mode: Clutter.AnimationMode.EASE_IN_BACK,
            });
            actor.ease({
                opacity: 0,
                duration: UNLOCK_TIME * 0.8,
                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            });
        }
    }

    destroy() {
        this._stopStats();
        if (this._revealId)
            GLib.source_remove(this._revealId);
        if (this._layoutLaterId)
            GLib.source_remove(this._layoutLaterId);
        this._revealId = this._layoutLaterId = 0;
    }
}

// ---------------------------------------------------------------------------

export class LockScreen {
    constructor(settings) {
        this._settings = settings;
        this._shield = getShield();
        this._injections = new InjectionManager();
        if (!this._shield)
            return;

        const self = this;

        // Каждый раз, когда GNOME создаёт экран блокировки, — оформить его.
        this._injections.overrideMethod(this._shield, '_ensureUnlockDialog',
            original => function (...args) {
                const result = original.apply(this, args);
                if (this._dialog && !this._dialog._hypede && self._enabled)
                    self._decorate(this._dialog);
                return result;
            });

        // Появление: вместо «шторки» сверху — волны и проявление.
        this._injections.overrideMethod(this._shield, '_resetLockScreen',
            original => function (params) {
                const wasHidden = this._lockScreenState === MessageTray.State.HIDDEN;
                original.call(this, params);
                const decoration = this._dialog?._hypede;
                if (!wasHidden || !decoration)
                    return;
                if (!params.animateLockScreen) {
                    decoration.playIntro();
                    return;
                }
                // Размытые обои появляются сразу, по ним катятся волны.
                const group = this._lockDialogGroup;
                group.remove_all_transitions();
                group.translation_y = 0;
                group.opacity = 255;
                // GNOME сразу после «шторки» гасит экран. Здесь экран
                // блокировки остаётся видимым, а гаснет, как обычно, по
                // таймеру бездействия.
                decoration.playIntro(() => this._lockScreenShown({
                    fadeToBlack: false, animateFade: true,
                }));
            });

        // Уход: экран «сворачивается» и тает, а не уезжает вверх.
        this._injections.overrideMethod(this._shield, '_hideLockScreen',
            original => function (animate) {
                const decoration = this._dialog?._hypede;
                if (!decoration || !animate ||
                    this._lockScreenState === MessageTray.State.HIDDEN)
                    return original.call(this, animate);

                this._lockScreenState = MessageTray.State.HIDING;
                const group = this._lockDialogGroup;
                group.remove_all_transitions();
                group.set_pivot_point(0.5, 0.5);
                decoration.playUnlock();
                group.ease({
                    opacity: 0,
                    duration: UNLOCK_TIME,
                    mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                });
                group.ease({
                    scale_x: 0.92,
                    scale_y: 0.92,
                    duration: UNLOCK_TIME,
                    mode: Clutter.AnimationMode.EASE_IN_BACK,
                    onComplete: () => {
                        group.set_scale(1, 1);
                        group.opacity = 255;
                        group.translation_y = -global.stage.height;
                        this._hideLockScreenComplete();
                    },
                });
                this._showPointer();
                return undefined;
            });
    }

    get _enabled() {
        return this._settings.get_string('lock-style') === 'hypede';
    }

    _decorate(dialog) {
        let decoration;
        try {
            decoration = new HypeLockDecoration(dialog, this._settings);
        } catch (e) {
            logError(e, 'HypeDE: не удалось оформить экран блокировки');
            return;
        }
        dialog._hypede = decoration;

        // Переход «часы ↔ пароль» GNOME вызывает через стрелочную функцию,
        // поэтому метод можно подменить прямо у экземпляра.
        const original = dialog._setTransitionProgress;
        dialog._setTransitionProgress = function (progress) {
            original.call(this, progress);
            decoration._update(progress);
        };
        dialog.connect('destroy', () => decoration.destroy());
    }

    destroy() {
        this._injections.clear();
    }
}
