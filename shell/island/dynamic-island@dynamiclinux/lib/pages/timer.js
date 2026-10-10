// Таймер, секундомер и помодоро.

import Clutter from 'gi://Clutter';

import {BasePage} from './base.js';
import * as W from '../ui/widgets.js';
import {formatDuration} from '../pure/format.js';

const PRESETS = [1, 3, 5, 10, 15, 25, 45, 60];

/** «90», «5:30», «1:02:03», «2ч 15м», «45с» → секунды */
export function parseTime(text) {
    const s = text.trim().toLowerCase();
    if (!s)
        return 0;
    if (/^\d+(:\d{1,2}){1,2}$/.test(s)) {
        const p = s.split(':').map(Number);
        return p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2];
    }
    let total = 0, matched = false;
    for (const [, num, unit] of s.matchAll(/(\d+(?:[.,]\d+)?)\s*(ч|h|м|m|мин|min|с|s|сек|sec)?/g)) {
        const n = parseFloat(num.replace(',', '.'));
        matched = true;
        if (!unit || unit.startsWith('м') || unit.startsWith('m'))
            total += n * 60;
        else if (unit.startsWith('ч') || unit.startsWith('h'))
            total += n * 3600;
        else
            total += n;
    }
    return matched ? Math.round(total) : 0;
}

export class TimerPage extends BasePage {
    constructor(ctx) {
        super(ctx, {vertical: false, cls: 'di-timer'});
        const t = this.theme;
        const tm = this.services.timer;

        // ---------- таймер
        const left = W.card(true, {cls: 'di-timer-card', expandY: true});
        left.add_child(W.label('⏱  Таймер', {cls: 'di-heading'}));
        const ringWrap = new Clutter.Actor({layout_manager: new Clutter.BinLayout(), x_align: Clutter.ActorAlign.CENTER});
        this._ring = new W.Ring({size: 150, thickness: 9, color: t.accent, track: t.surfaceStrong});
        const center = W.vbox({x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this._display = W.label('0:00', {cls: 'di-timer-display di-mono'});
        this._display.x_align = Clutter.ActorAlign.CENTER;
        this._tLabel = W.label('', {cls: 'di-small', style: `color: ${t.dim};`});
        this._tLabel.x_align = Clutter.ActorAlign.CENTER;
        W.add(center, this._display, this._tLabel);
        ringWrap.add_child(this._ring);
        ringWrap.add_child(center);

        const presets = W.hbox({style_class: 'di-chips', x_align: Clutter.ActorAlign.CENTER});
        for (const m of PRESETS)
            presets.add_child(W.button({label: `${m}м`, cls: 'di-chip-btn', onClick: () => tm.startTimer(m * 60, `${m} мин`)}));

        const custom = W.hbox({x_expand: true, style_class: 'di-toolbar'});
        this._entry = W.entry({hint: 'Своё время: 90, 5:30, 1ч 20м…', onActivate: text => this._startCustom(text)});
        W.add(custom, this._entry, W.button({icon: 'media-playback-start-symbolic', cls: 'di-chip-btn', onClick: () => this._startCustom(this._entry.get_text())}));

        const ctrls = W.hbox({style_class: 'di-chips', x_align: Clutter.ActorAlign.CENTER});
        this._pause = W.button({icon: 'media-playback-pause-symbolic', label: 'Пауза', cls: 'di-chip-btn', onClick: () => tm.pauseTimer()});
        const plus = W.button({label: '+1 мин', cls: 'di-chip-btn', onClick: () => tm.addTime(60)});
        const stop = W.button({icon: 'media-playback-stop-symbolic', label: 'Сброс', cls: 'di-chip-btn', onClick: () => tm.stopTimer()});
        this._pomo = W.button({label: '🍅 Помодоро 25/5', cls: 'di-chip-btn', onClick: () => tm.startPomodoro()});
        W.add(ctrls, this._pause, plus, stop, this._pomo);
        W.add(left, ringWrap, presets, custom, ctrls);

        // ---------- секундомер
        const right = W.card(true, {cls: 'di-timer-card', expandY: true});
        right.width = 280;
        right.add_child(W.label('⏲  Секундомер', {cls: 'di-heading'}));
        this._sw = W.label('0:00.0', {cls: 'di-stopwatch di-mono'});
        this._sw.x_align = Clutter.ActorAlign.CENTER;
        const swCtrls = W.hbox({style_class: 'di-chips', x_align: Clutter.ActorAlign.CENTER});
        this._swBtn = W.button({icon: 'media-playback-start-symbolic', label: 'Старт', cls: 'di-chip-btn', onClick: () => tm.toggleStopwatch()});
        W.add(swCtrls, this._swBtn,
            W.button({label: 'Круг', cls: 'di-chip-btn', onClick: () => tm.lap()}),
            W.button({label: 'Сброс', cls: 'di-chip-btn', onClick: () => tm.resetStopwatch()}));
        this._laps = W.vbox({x_expand: true});
        W.add(right, this._sw, swCtrls, W.scroll(this._laps));

        W.add(this.actor, left, right);

        this.subs.on(tm, 'tick', () => this._update());
        this.subs.on(tm, 'changed', () => this._update(true));
        this._update(true);
    }

    focus() {
        this._entry.grab_key_focus();
    }

    _startCustom(text) {
        const sec = parseTime(text);
        if (sec > 0) {
            this.services.timer.startTimer(sec, text.trim());
            this._entry.set_text('');
        } else {
            this.toast('Не понял время', {icon: 'dialog-warning-symbolic', subtitle: 'Примеры: 90, 5:30, 1ч 20м, 45с', duration: 2000});
        }
    }

    _fmtSw(sec) {
        return `${formatDuration(sec)}.${Math.floor((sec % 1) * 10)}`;
    }

    _update(full = false) {
        if (!this.visible && !full)
            return;
        const tm = this.services.timer;
        const t = this.theme;
        const tt = tm.timer;
        const active = tt.running || tt.paused;
        const remaining = active ? tt.remaining : 0;
        this._display.text = formatDuration(Math.ceil(remaining));
        this._ring.value = active && tt.total ? remaining / tt.total : 0;
        this._tLabel.text = active ? (tt.label || '') : 'Выберите время';
        this._pause._label.text = tt.paused ? 'Продолжить' : 'Пауза';
        this._pause._icon.icon_name = tt.paused ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic';
        W.setAccent(this._pomo, t, tm.pomodoro.active);

        const sw = tm.stopwatch;
        this._sw.text = this._fmtSw(tm.stopwatchTime);
        this._swBtn._label.text = sw.running ? 'Пауза' : 'Старт';
        if (full) {
            this._laps.destroy_all_children();
            sw.laps.forEach((l, i) => {
                const row = W.hbox({x_expand: true});
                W.add(row, W.label(`Круг ${sw.laps.length - i}`, {cls: 'di-small', expand: true, style: `color: ${t.dim};`}),
                    W.label(this._fmtSw(l), {cls: 'di-small di-mono'}));
                this._laps.add_child(row);
            });
        }
    }

    onShow() {
        super.onShow();
        this._update(true);
    }
}
