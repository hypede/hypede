// Свёрнутый остров: маленькие виджеты слева / по центру / справа + индикаторы.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Emitter, Subscriptions, Timers} from '../utils.js';
import {formatDuration, formatSpeed} from '../pure/format.js';
import * as W from './widgets.js';
import {PetSprite} from './petSprite.js';

const PET_STEP_MS = 125;

// Порядок отображения виджетов внутри слота
export const WIDGET_ORDER = ['media', 'pet', 'clock', 'date', 'weather', 'cpu', 'ram', 'temp', 'fps', 'net', 'battery', 'keyboard'];

export const WIDGET_NAMES = {
    media: 'Музыка (обложка и эквалайзер)',
    pet: 'Питомец',
    clock: 'Часы',
    date: 'Дата',
    weather: 'Погода',
    cpu: 'Загрузка CPU',
    ram: 'Память',
    temp: 'Температура',
    fps: 'FPS',
    net: 'Скорость сети',
    battery: 'Батарея',
    keyboard: 'Раскладка',
};

/** Базовый класс маленького виджета. */
class CompactWidget {
    constructor(ctx) {
        this.ctx = ctx;
        this.subs = new Subscriptions();
        this.actor = W.hbox({style_class: 'di-cw', y_align: Clutter.ActorAlign.CENTER});
        // Актёра могут уничтожить «снаружи» (например, при остановке оболочки) —
        // подписки на сервисы снимаем сразу, чтобы не трогать мёртвые объекты
        this.actor.connect('destroy', () => {
            this._destroyed = true;
            this.subs.clear();
        });
    }

    /** Повторно применить состояние (Clutter показывает актёра при добавлении в родителя). */
    refresh() {
        this._update?.();
        this._sync?.();
    }

    destroy() {
        this.subs.clear();
        this.actor.destroy();
    }
}

class ClockWidget extends CompactWidget {
    constructor(ctx, kind) {
        super(ctx);
        this._kind = kind;
        this._label = W.label('', {cls: kind === 'clock' ? 'di-cw-clock' : 'di-cw-text'});
        this.actor.add_child(this._label);
        this.subs.on(ctx.tick, 'second', () => this._update());
        this._update();
    }

    _update() {
        const fmt = this.ctx.settings.get_string(this._kind === 'clock' ? 'clock-format' : 'date-format');
        const text = GLib.DateTime.new_now_local().format(fmt) ?? '';
        if (this._label.text !== text)
            this._label.text = text;
    }
}

class MediaWidget extends CompactWidget {
    constructor(ctx) {
        super(ctx);
        const t = ctx.theme;
        const size = Math.max(16, t.compactHeight - 14);
        this._art = W.image(null, size, size, 6);
        this._art.add_style_class_name('di-cw-art');
        this._icon = W.icon('folder-music-symbolic', Math.round(size * 0.8));
        this._viz = new W.Visualizer({
            bars: 4,
            height: Math.round(size * 0.75),
            color: t.accent,
            animate: ctx.settings.get_boolean('music-visualizer'),
        });
        W.add(this.actor, this._art, this._icon, this._viz);
        this.actor.reactive = false;
        this.subs.on(ctx.services.media, 'changed', () => this._update());
        this._update();
    }

    async _update() {
        const p = this.ctx.services.media.current;
        const visible = !!p && (p.playing || p.status === 'Paused');
        if (this.actor.visible !== visible) {
            this.actor.visible = visible;
            this.ctx.compactView.queueSize();
        }
        if (!p)
            return;
        this._viz.playing = p.playing;
        this._viz.opacity = p.playing ? 255 : 120;
        const path = await p.artPath();
        if (this._destroyed)
            return;
        if (path !== this._artPath) {
            this._artPath = path;
            W.setImage(this._art, path, 6);
        }
        this._art.visible = !!path;
        this._icon.visible = !path;
    }

    destroy() {
        this._destroyed = true;
        super.destroy();
    }
}

class PetWidget extends CompactWidget {
    constructor(ctx) {
        super(ctx);
        this._area = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            width: 58,
            height: ctx.theme.compactHeight - 4,
            y_align: Clutter.ActorAlign.CENTER,
            clip_to_allocation: false,
        });
        this._pet = new PetSprite({size: Math.max(14, ctx.theme.compactHeight - 14)});
        this._pet.set_pivot_point(0.5, 0.5);
        this._area.add_child(this._pet);
        this.actor.add_child(this._area);
        this._timers = new Timers();
        this._x = 20;
        this._dir = 1;
        this.subs.on(ctx.services.pet, 'changed', () => this._sync());
        this.subs.on(ctx.services.pet, 'action', (kind, emoji) => this._react(emoji));
        this.subs.connect(this._area, 'notify::mapped', () => this._sync());
        this._sync();
        this._timers.timeout(1500, () => this._walk());
    }

    _sync() {
        const pet = this.ctx.services.pet;
        this.actor.visible = pet.enabled;
        this._pet.setKind(pet.kind);
        this._pet.sleeping = pet.state.sleeping;
        if (this._area.get_stage())
            this._pet.y = Math.round((this._area.height - this._pet.height) / 2);
    }

    // Питомец ходит «шагами» ~8 раз в секунду и подолгу отдыхает: плавная
    // анимация заставляла бы композитор перерисовывать каждый кадр экрана.
    _walk() {
        if (this._destroyed)
            return;
        const pet = this.ctx.services.pet;
        if (!pet.enabled || pet.state.sleeping || !this.actor.mapped || !St.Settings.get().enable_animations) {
            this._timers.timeout(3000, () => this._walk());
            return;
        }
        // Чаще отдыхает, чем ходит
        if (Math.random() < 0.45) {
            if (Math.random() < 0.3)
                this._hop();
            this._timers.timeout(2500 + Math.random() * 6000, () => this._walk());
            return;
        }
        const maxX = Math.max(0, this._area.width - this._pet.width);
        const target = Math.round(Math.random() * maxX);
        const dir = target >= this._pet.x ? 1 : -1;
        // Эмодзи по умолчанию смотрят влево; отражаем при ходьбе вправо
        this._pet.scale_x = (dir > 0) === pet.kind.facesLeft ? -1 : 1;
        const stepPx = 1 + Math.round(this.ctx.settings.get_int('pet-speed') / 3);
        const baseY = Math.round((this._area.height - this._pet.height) / 2);
        let up = false;
        this._timers.interval(PET_STEP_MS, () => {
            if (this._destroyed)
                return false;
            const dx = target - this._pet.x;
            if (!this._area.mapped || Math.abs(dx) <= stepPx) {
                this._pet.x = this._area.mapped ? target : this._pet.x;
                this._pet.y = baseY;
                this._pet.stand();
                this._timers.timeout(1500 + Math.random() * 4500, () => this._walk());
                return false;
            }
            this._pet.x += Math.sign(dx) * stepPx;
            this._pet.step();
            // Эмодзи слегка подпрыгивают на каждом шаге
            up = !up;
            if (!this._pet.isDrawn)
                this._pet.y = baseY - (up ? 1 : 0);
            return true;
        });
    }

    _hop() {
        W.pulse(this._pet, 1.15, 140);
    }

    _react(emoji) {
        if (!this._area.mapped)
            return;
        const bubble = new St.Label({text: emoji, style: 'font-size: 12px;', opacity: 0});
        this._area.add_child(bubble);
        bubble.set_position(this._pet.x + this._pet.width / 2 - 6, 0);
        bubble.ease({
            opacity: 255,
            translation_y: -6,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => bubble.ease({
                opacity: 0,
                translation_y: -14,
                delay: 700,
                duration: 400,
                onComplete: () => bubble.destroy(),
            }),
        });
        this._hop();
    }

    destroy() {
        this._destroyed = true;
        this._timers.destroy();
        super.destroy();
    }
}

class WeatherWidget extends CompactWidget {
    constructor(ctx) {
        super(ctx);
        this._emoji = W.label('', {cls: 'di-cw-emoji'});
        this._temp = W.label('', {cls: 'di-cw-text'});
        W.add(this.actor, this._emoji, this._temp);
        this.subs.on(ctx.services.weather, 'changed', () => this._update());
        this._update();
    }

    _update() {
        const w = this.ctx.services.weather;
        const d = w.data;
        this.actor.visible = !!d;
        if (!d)
            return;
        this._emoji.text = d.emoji;
        this._temp.text = `${Math.round(d.temp)}°`;
    }
}

class StatWidget extends CompactWidget {
    constructor(ctx, kind) {
        super(ctx);
        this._kind = kind;
        const icons = {
            cpu: 'power-profile-performance-symbolic',
            ram: 'media-flash-symbolic',
            temp: 'weather-clear-symbolic',
            fps: 'video-x-generic-symbolic',
            net: 'network-transmit-receive-symbolic',
            battery: 'battery-good-symbolic',
            keyboard: 'preferences-desktop-keyboard-symbolic',
        };
        this._icon = W.icon(icons[kind], 13, `color: ${ctx.theme.dim};`);
        this._text = W.label('', {cls: 'di-cw-text di-mono'});
        W.add(this.actor, this._icon, this._text);
        const sys = ctx.services.sysmon;
        if (kind === 'fps')
            sys.acquireFps();
        if (kind === 'keyboard')
            this.subs.on(ctx.services.controls, 'changed', () => this._update());
        else
            this.subs.on(sys, 'updated', () => this._update());
        this._update();
    }

    _update() {
        if (this._destroyed)
            return;
        const s = this.ctx.services.sysmon;
        let text = '';
        switch (this._kind) {
        case 'cpu':
            text = `${Math.round(s.cpu * 100)}%`;
            break;
        case 'ram':
            text = `${Math.round(s.mem.percent * 100)}%`;
            break;
        case 'temp':
            text = s.temp !== null ? `${Math.round(s.temp)}°C` : '—';
            break;
        case 'fps':
            text = `${s.fps}`;
            break;
        case 'net':
            text = `↓${formatSpeed(s.net.rx).replace(' ', '')}`;
            break;
        case 'battery':
            this.actor.visible = !!s.battery;
            if (s.battery) {
                text = `${s.battery.percent}%`;
                const lvl = s.battery.percent > 80 ? 'full' : s.battery.percent > 40 ? 'good' : s.battery.percent > 15 ? 'low' : 'caution';
                this._icon.icon_name = `battery-${lvl}${s.battery.charging ? '-charging' : ''}-symbolic`;
            }
            break;
        case 'keyboard':
            text = (this.ctx.services.controls.inputSource ?? '').toUpperCase();
            this.actor.visible = !!text;
            break;
        }
        if (this._text.text !== text)
            this._text.text = text;
    }

    destroy() {
        if (this._kind === 'fps')
            this.ctx.services.sysmon.releaseFps();
        super.destroy();
    }
}

/** Индикаторы активных процессов: запись, таймер, голос, загрузки, ИИ. */
class Indicators extends CompactWidget {
    constructor(ctx) {
        super(ctx);
        const t = ctx.theme;
        this.actor.add_style_class_name('di-indicators');
        // Запись экрана
        this._rec = W.hbox({style_class: 'di-ind'});
        this._recDot = new St.Widget({style_class: 'di-rec-dot', width: 8, height: 8, y_align: Clutter.ActorAlign.CENTER});
        this._recLabel = W.label('', {cls: 'di-cw-text di-mono', style: `color: ${t.danger};`});
        W.add(this._rec, this._recDot, this._recLabel);
        // Голос
        this._voice = W.hbox({style_class: 'di-ind'});
        this._voiceIcon = W.icon('audio-input-microphone-symbolic', 14, `color: ${t.danger};`);
        this._voiceLabel = W.label('', {cls: 'di-cw-text di-mono'});
        W.add(this._voice, this._voiceIcon, this._voiceLabel);
        // Таймер
        this._timer = W.hbox({style_class: 'di-ind'});
        this._timerIcon = W.icon('alarm-symbolic', 13, `color: ${t.warning};`);
        this._timerLabel = W.label('', {cls: 'di-cw-text di-mono', style: `color: ${t.warning};`});
        W.add(this._timer, this._timerIcon, this._timerLabel);
        // Загрузки
        this._dl = W.hbox({style_class: 'di-ind'});
        this._dlIcon = W.icon('folder-download-symbolic', 13, `color: ${t.accent};`);
        this._dlLabel = W.label('', {cls: 'di-cw-text di-mono'});
        W.add(this._dl, this._dlIcon, this._dlLabel);
        // ИИ думает
        this._ai = W.label('✦', {cls: 'di-cw-text', style: `color: ${t.accent};`});

        W.add(this.actor, this._rec, this._voice, this._timer, this._dl, this._ai);

        const s = ctx.services;
        this.subs.on(s.recorder, 'changed', () => this._update());
        this.subs.on(s.voice, 'changed', () => this._update());
        this.subs.on(s.timer, 'changed', () => this._update());
        this.subs.on(s.timer, 'tick', () => this._update());
        this.subs.on(s.downloads, 'changed', () => this._update());
        this.subs.on(s.ai, 'changed', () => this._update());
        this.subs.on(ctx.tick, 'second', () => this._update());
        this._update();
    }

    _update() {
        const s = this.ctx.services;
        const before = [this._rec, this._voice, this._timer, this._dl, this._ai].map(a => a.visible).join();

        this._rec.visible = s.recorder.recording;
        if (this._rec.visible) {
            this._recLabel.text = formatDuration(s.recorder.elapsed);
            this._recDot.opacity = Math.floor(Date.now() / 1000) % 2 ? 255 : 90;
        }

        this._voice.visible = s.voice.state !== 'idle';
        if (this._voice.visible) {
            this._voiceLabel.text = s.voice.state === 'recording'
                ? formatDuration((Date.now() - s.voice.started) / 1000)
                : '…';
        }

        const tm = s.timer;
        this._timer.visible = tm.timer.running || tm.timer.paused || tm.stopwatch.running;
        if (this._timer.visible) {
            this._timerLabel.text = tm.timer.running || tm.timer.paused
                ? formatDuration(Math.ceil(tm.timer.remaining))
                : formatDuration(tm.stopwatchTime);
        }

        this._dl.visible = s.downloads.active.size > 0;
        if (this._dl.visible)
            this._dlLabel.text = formatSpeed(s.downloads.totalSpeed).replace(' ', '');

        this._ai.visible = s.ai.busy;
        if (this._ai.visible)
            this._ai.opacity = 120 + Math.round(Math.abs(Math.sin(Date.now() / 300)) * 135);

        const after = [this._rec, this._voice, this._timer, this._dl, this._ai].map(a => a.visible).join();
        this.actor.visible = this._rec.visible || this._voice.visible || this._timer.visible || this._dl.visible || this._ai.visible;
        if (before !== after)
            this.ctx.compactView.queueSize();
    }
}

const FACTORIES = {
    clock: ctx => new ClockWidget(ctx, 'clock'),
    date: ctx => new ClockWidget(ctx, 'date'),
    media: ctx => new MediaWidget(ctx),
    pet: ctx => new PetWidget(ctx),
    weather: ctx => new WeatherWidget(ctx),
    cpu: ctx => new StatWidget(ctx, 'cpu'),
    ram: ctx => new StatWidget(ctx, 'ram'),
    temp: ctx => new StatWidget(ctx, 'temp'),
    fps: ctx => new StatWidget(ctx, 'fps'),
    net: ctx => new StatWidget(ctx, 'net'),
    battery: ctx => new StatWidget(ctx, 'battery'),
    keyboard: ctx => new StatWidget(ctx, 'keyboard'),
};

/** Разбирает настройку compact-layout. */
export function parseLayout(json) {
    let layout = {};
    try {
        layout = JSON.parse(json);
    } catch {}
    return layout;
}

export class CompactView extends Emitter {
    constructor(ctx) {
        super();
        this.ctx = ctx;
        ctx.compactView = this;
        this._timers = new Timers();
        this._widgets = [];

        this.actor = new St.Widget({
            style_class: 'di-compact',
            layout_manager: new Clutter.BinLayout(),
        });
        this._box = W.hbox({
            style_class: 'di-compact-box',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._left = W.hbox({style_class: 'di-slot di-slot-left', x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER});
        this._center = W.hbox({style_class: 'di-slot di-slot-center', x_expand: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this._right = W.hbox({style_class: 'di-slot di-slot-right', x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.CENTER});
        // Боковые слоты в St.Bin одинаковой ширины — так центр всегда по центру
        this._leftBin = new St.Bin({child: this._left, y_align: Clutter.ActorAlign.CENTER});
        this._rightBin = new St.Bin({child: this._right, y_align: Clutter.ActorAlign.CENTER});
        W.add(this._box, this._leftBin, this._center, this._rightBin);
        this.actor.add_child(this._box);

        this._build();
        ctx.settings.connectObject('changed::compact-layout', () => this._rebuild(), this);
        // Содержимое слотов изменилось (новый текст, показ/скрытие виджета) — пересчитываем ширину
        for (const slot of [this._left, this._center, this._right])
            slot.connect('queue-relayout', () => this.queueSize());
    }

    _build() {
        const layout = parseLayout(this.ctx.settings.get_string('compact-layout'));
        const slots = {left: this._left, center: this._center, right: this._right};
        for (const id of WIDGET_ORDER) {
            const slot = layout[id];
            if (!slot || slot === 'hidden' || !slots[slot] || !FACTORIES[id])
                continue;
            try {
                const w = FACTORIES[id](this.ctx);
                slots[slot].add_child(w.actor);
                w.refresh();
                this._widgets.push(w);
            } catch (e) {
                console.error(`[dynamic-island] compact widget ${id}: ${e.message}`);
            }
        }
        // Индикаторы всегда в правом слоте, первыми
        this._indicators = new Indicators(this.ctx);
        this._right.insert_child_at_index(this._indicators.actor, 0);
        this._indicators.refresh();
        this._widgets.push(this._indicators);
        this.queueSize();
    }

    _rebuild() {
        for (const w of this._widgets)
            w.destroy();
        this._widgets = [];
        this._build();
    }

    /** Естественная ширина содержимого. */
    measure() {
        // Левая и правая части должны быть одинаковой ширины, чтобы центр был по центру
        const [, l] = this._left.get_preferred_width(-1);
        const [, c] = this._center.get_preferred_width(-1);
        const [, r] = this._right.get_preferred_width(-1);
        const side = Math.ceil(Math.max(l, r));
        this._leftBin.width = side;
        this._rightBin.width = side;
        let pad = 24;
        try {
            pad = this._box.get_theme_node().get_horizontal_padding();
        } catch {}
        return side * 2 + c + pad + 12;
    }

    queueSize() {
        if (this._sizeId)
            return;
        this._sizeId = this._timers.timeout(80, () => {
            this._sizeId = 0;
            const w = this.measure();
            if (w !== this._lastWidth) {
                this._lastWidth = w;
                this.emit('size-changed');
            }
        });
    }

    destroy() {
        this.ctx.settings.disconnectObject(this);
        for (const w of this._widgets)
            w.destroy();
        this._widgets = [];
        this._timers.destroy();
        this.actor.destroy();
        this.disconnectAll();
    }
}
