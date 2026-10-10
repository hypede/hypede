// Спрайт питомца: эмодзи или нарисованный пиксель-арт (Clawd — маскот Claude).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

// Clawd в пикселях. Как и в оригинале из Claude Code (символы-«четвертинки»
// в терминале), каждый пиксель вдвое выше, чем шире.
// # — тело, o — глаз, 1/2 — ноги (переставляются по очереди при ходьбе).
const CLAWD = [
    '..############..',
    '..##o######o##..',
    '################',
    '..############..',
    '...1.2....1.2...',
];
const CLAWD_W = CLAWD[0].length;
const CLAWD_H = CLAWD.length;

const BODY = [215 / 255, 119 / 255, 87 / 255]; // #D77757
const EYE = [0.08, 0.06, 0.06];

/**
 * Clawd, нарисованный на Cairo. Умеет ходить (переставляет ноги), моргать и спать.
 */
export const ClawdSprite = GObject.registerClass(
class DIClawdSprite extends St.DrawingArea {
    _init(params = {}) {
        // Высота пикселя = 2 × ширина
        const px = Math.max(1, Math.floor((params.height ?? 20) / (CLAWD_H * 2)));
        super._init({
            width: px * CLAWD_W,
            height: px * 2 * CLAWD_H,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._px = px;
        this._step = 0;
        this._walking = false;
        this._blink = false;
        this._sleeping = false;
        this._timerIds = new Set();
        this._scheduleBlink();
        this.connect('destroy', () => {
            for (const id of this._timerIds)
                GLib.source_remove(id);
            this._timerIds.clear();
        });
    }

    _timeout(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timerIds.delete(id);
            return fn();
        });
        this._timerIds.add(id);
        return id;
    }

    _scheduleBlink() {
        this._timeout(2500 + Math.random() * 3500, () => {
            if (!this._sleeping && this.mapped) {
                this._blink = true;
                this.queue_repaint();
                this._timeout(140, () => {
                    this._blink = false;
                    this.queue_repaint();
                    return GLib.SOURCE_REMOVE;
                });
            }
            this._scheduleBlink();
            return GLib.SOURCE_REMOVE;
        });
    }

    set walking(on) {
        if (on === this._walking)
            return;
        this._walking = on;
        if (on && !this._walkId) {
            this._walkId = this._timeout(160, () => {
                this._step = (this._step + 1) % 2;
                this.queue_repaint();
                if (this._walking)
                    return GLib.SOURCE_CONTINUE;
                this._walkId = 0;
                return GLib.SOURCE_REMOVE;
            });
        } else if (!on) {
            this._step = 0;
            this.queue_repaint();
        }
    }

    set sleeping(on) {
        this._sleeping = on;
        this.queue_repaint();
    }

    /** Шаг ходьбы, управляемый снаружи (без собственного таймера). */
    advance() {
        this._stepping = true;
        this._step = (this._step + 1) % 2;
        this.queue_repaint();
    }

    stand() {
        if (!this._stepping)
            return;
        this._stepping = false;
        this._step = 0;
        this.queue_repaint();
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const p = this._px;
        const eyesClosed = this._blink || this._sleeping;
        for (let y = 0; y < CLAWD_H; y++) {
            const row = CLAWD[y];
            for (let x = 0; x < CLAWD_W; x++) {
                const c = row[x];
                let color = null;
                if (c === '#') {
                    color = BODY;
                } else if (c === 'o') {
                    color = eyesClosed ? BODY : EYE;
                } else if (c === '1' || c === '2') {
                    // При ходьбе одна пара ног «поднята»
                    const lifted = (this._walking || this._stepping) && ((c === '1') === (this._step === 0));
                    color = lifted ? null : BODY;
                }
                if (!color)
                    continue;
                cr.setSourceRGBA(color[0], color[1], color[2], 1);
                cr.rectangle(x * p, y * 2 * p, p, 2 * p);
                cr.fill();
            }
        }
        // Во сне глаза — тонкие полоски
        if (this._sleeping) {
            cr.setSourceRGBA(EYE[0], EYE[1], EYE[2], 1);
            for (const x of [4, 11])
                cr.rectangle(x * p, 2 * p + p * 1.2, p, Math.max(1, p * 0.6));
            cr.fill();
        }
        cr.$dispose();
    }
});

/**
 * Универсальный спрайт питомца: эмодзи (St.Label) или Clawd (рисунок).
 */
export const PetSprite = GObject.registerClass(
class DIPetSprite extends St.Bin {
    /**
     * @param {object} params
     * @param {number} params.size  высота спрайта в пикселях
     */
    _init(params = {}) {
        super._init({
            style_class: params.style_class ?? '',
            reactive: params.reactive ?? false,
            track_hover: params.reactive ?? false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._size = params.size ?? 20;
        // Показывать ли «💤» вместо эмодзи во сне (в комнате питомца сон рисуется частицами)
        this._emojiSleep = params.emojiSleep ?? true;
        this._kind = null;
        this._sleeping = false;
        this._walking = false;
    }

    get isDrawn() {
        return this._kind?.sprite === 'clawd';
    }

    /**
     * @param {object} kind элемент PETS
     */
    setKind(kind) {
        if (this._kind === kind)
            return;
        this._kind = kind;
        this.set_child(null);
        if (kind.sprite === 'clawd') {
            this._clawd = new ClawdSprite({height: this._size});
            this._label = null;
            this.set_child(this._clawd);
        } else {
            this._clawd = null;
            this._label = new St.Label({
                text: kind.emoji,
                style: `font-size: ${this._size}px;`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.set_child(this._label);
        }
        this._apply();
    }

    set sleeping(on) {
        this._sleeping = on;
        this._apply();
    }

    set walking(on) {
        this._walking = on;
        if (this._clawd)
            this._clawd.walking = on && !this._sleeping;
    }

    /** Один шаг (для пошаговой ходьбы в свёрнутом острове). */
    step() {
        this._clawd?.advance();
    }

    stand() {
        this._clawd?.stand();
    }

    _apply() {
        if (this._clawd) {
            this._clawd.sleeping = this._sleeping;
            this._clawd.walking = this._walking && !this._sleeping;
        } else if (this._label && this._kind) {
            // У эмодзи-питомцев во сне показываем «💤»
            this._label.text = this._sleeping && this._emojiSleep ? '💤' : this._kind.emoji;
        }
    }
});
