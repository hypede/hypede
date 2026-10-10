// Быстрые настройки острова прямо внутри него. Полные — в окне параметров расширения.

import Clutter from 'gi://Clutter';

import {BasePage} from './base.js';
import * as W from '../ui/widgets.js';
import {PRESETS} from '../theme.js';

const ANIMATIONS = [
    ['spring', '🌀 Пружина'],
    ['smooth', '🌊 Плавно'],
    ['bounce', '🏀 Отскок'],
    ['elastic', '🪀 Резинка'],
    ['linear', '➖ Линейно'],
    ['none', '⛔ Без анимаций'],
];

const ACCENTS = ['#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#64d2ff', '#ffd60a', '#ff453a', '#e95420', '#ffffff'];

export class SettingsPage extends BasePage {
    constructor(ctx) {
        super(ctx, {vertical: false, cls: 'di-settings'});
        const s = this.settings;
        const t = this.theme;

        // ---------- колонка 1: оформление
        const col1 = W.vbox({style_class: 'di-col', x_expand: true});
        col1.add_child(W.label('Тема', {cls: 'di-section-title'}));
        const presetBtns = Object.entries(PRESETS).map(([id, p]) => {
            const b = W.button({cls: 'di-preset', expand: true, onClick: () => this._applyPreset(id)});
            const box = W.hbox({x_expand: true});
            const dot = new W.Ring({size: 18, thickness: 9, color: p.accent, track: p.bg});
            dot.value = 0.5;
            W.add(box, dot, W.label(p.name, {cls: 'di-small'}));
            b.set_child(box);
            if (s.get_string('theme-preset') === id)
                W.setAccent(b, t, true);
            return b;
        });
        col1.add_child(W.grid(presetBtns, 2, {fill: true}));

        col1.add_child(W.label('Акцент', {cls: 'di-section-title'}));
        const accents = W.hbox({style_class: 'di-chips'});
        for (const c of ACCENTS) {
            const b = W.button({cls: 'di-swatch', onClick: () => s.set_string('accent-color', c)});
            b.style = `background-color: ${c};${c.toLowerCase() === s.get_string('accent-color').toLowerCase() ? ' border: 2px solid white;' : ''}`;
            b.set_size(26, 26);
            accents.add_child(b);
        }
        col1.add_child(accents);

        col1.add_child(W.label('Анимация', {cls: 'di-section-title'}));
        const animBtns = ANIMATIONS.map(([id, label]) => {
            const b = W.button({label, cls: 'di-chip-btn', expand: true, onClick: () => s.set_string('animation-style', id)});
            if (s.get_string('animation-style') === id)
                W.setAccent(b, t, true);
            return b;
        });
        col1.add_child(W.grid(animBtns, 3, {fill: true}));
        col1.add_child(this._stepper('Скорость анимации', 'animation-duration', 50, 0, 2000, v => `${v} мс`));
        col1.add_child(this._stepper('Ширина острова', 'compact-width', 20, 120, 1200, v => `${v}px`));
        col1.add_child(this._stepper('Размер раскрытого', 'expanded-width', 40, 560, 1800, v => `${v}px`));

        // ---------- колонка 2: поведение
        const col2 = W.vbox({style_class: 'di-col', x_expand: true});
        col2.add_child(W.label('Поведение', {cls: 'di-section-title'}));
        const rows = [
            ['hover-expand', 'Раскрывать при наведении'],
            ['live-activities', 'Живые активности'],
            ['island-notifications', 'Уведомления в острове'],
            ['replace-panel', 'Заменять верхнюю панель'],
            ['reserve-space', 'Резервировать место сверху'],
            ['music-visualizer', 'Эквалайзер музыки'],
            ['pet-enabled', 'Питомец'],
            ['clipboard-enabled', 'История буфера'],
            ['shelf-auto-add', 'Файлы из буфера → на полку'],
            ['shadow', 'Тень'],
        ];
        const list = W.vbox({x_expand: true});
        for (const [key, title] of rows)
            list.add_child(W.switchRow(title, s.get_boolean(key), v => s.set_boolean(key, v), t));
        col2.add_child(W.scroll(list));

        const bottom = W.hbox({style_class: 'di-chips', x_expand: true});
        W.add(bottom,
            W.button({icon: 'emblem-system-symbolic', label: 'Все настройки…', cls: 'di-chip-btn', expand: true,
                onClick: () => ctx.extension.openPreferences()}),
            W.button({icon: 'system-shutdown-symbolic', label: 'Выключить остров', cls: 'di-chip-btn', expand: true,
                onClick: () => s.set_boolean('island-enabled', false)}));
        col2.add_child(bottom);
        col2.add_child(W.label('Включить обратно: Super+Alt+D или «Расширения» → Dynamic Island',
            {cls: 'di-tiny', wrap: true, style: `color: ${t.faint};`}));

        W.add(this.actor, col1, col2);
    }

    _applyPreset(id) {
        const p = PRESETS[id];
        const s = this.settings;
        s.delay();
        s.set_string('theme-preset', id);
        s.set_string('bg-color', p.bg);
        s.set_string('fg-color', p.fg);
        s.set_string('accent-color', p.accent);
        s.set_string('border-color', p.border);
        s.apply();
    }

    _stepper(title, key, step, min, max, fmt) {
        const s = this.settings;
        const row = W.hbox({style_class: 'di-row', x_expand: true});
        const value = W.label(fmt(s.get_int(key)), {cls: 'di-small di-mono', style: `color: ${this.theme.dim};`});
        const change = d => {
            const v = Math.max(min, Math.min(max, s.get_int(key) + d));
            s.set_int(key, v);
            value.text = fmt(v);
        };
        W.add(row,
            W.label(title, {cls: 'di-row-title', expand: true}),
            W.iconButton('list-remove-symbolic', () => change(-step), {cls: 'di-flat di-mini'}),
            value,
            W.iconButton('list-add-symbolic', () => change(step), {cls: 'di-flat di-mini'}));
        row.y_align = Clutter.ActorAlign.CENTER;
        return row;
    }
}
