// Главная: часы, погода, музыка, системные переключатели и быстрые действия.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {BasePage} from './base.js';
import {MediaCard} from '../ui/mediaCard.js';
import * as W from '../ui/widgets.js';
import {formatSpeed} from '../pure/format.js';

export class HomePage extends BasePage {
    constructor(ctx) {
        super(ctx, {vertical: false, cls: 'di-home'});
        const t = this.theme;

        // ---------------- Колонка 1: время, погода, система
        const col1 = W.vbox({style_class: 'di-col', width: 220});

        const clockCard = W.card(true, {cls: 'di-clock-card'});
        this._time = W.label('', {cls: 'di-big-clock'});
        this._date = W.label('', {cls: 'di-dim', style: `color: ${t.dim};`});
        W.add(clockCard, this._time, this._date);

        this._weatherCard = W.button({cls: 'di-card di-weather-mini', onClick: () => ctx.expandedTab('weather')});
        const wb = W.hbox({x_expand: true});
        this._wEmoji = W.label('🌡️', {cls: 'di-weather-emoji'});
        const wTexts = W.vbox({y_align: Clutter.ActorAlign.CENTER});
        this._wTemp = W.label('—', {cls: 'di-weather-temp'});
        this._wDesc = W.label('Загрузка погоды…', {cls: 'di-small', style: `color: ${t.dim};`});
        W.add(wTexts, this._wTemp, this._wDesc);
        W.add(wb, this._wEmoji, wTexts);
        this._weatherCard.set_child(wb);

        const sysCard = W.button({cls: 'di-card di-sys-mini', onClick: () => ctx.expandedTab('system')});
        const sysBox = W.vbox({x_expand: true});
        this._cpuBar = this._statRow(sysBox, 'CPU', t.accent);
        this._ramBar = this._statRow(sysBox, 'RAM', '#bf5af2');
        this._net = W.label('', {cls: 'di-small di-mono', style: `color: ${t.dim};`});
        sysBox.add_child(this._net);
        sysCard.set_child(sysBox);

        // Последнее в буфере обмена
        this._clipCard = W.button({cls: 'di-card di-clip-mini', onClick: () => ctx.expandedTab('clipboard')});
        const cb = W.vbox({x_expand: true});
        this._clipTitle = W.label('📋 Буфер обмена', {cls: 'di-small', style: `color: ${t.dim};`});
        this._clipText = W.label('Пока пусто', {cls: 'di-small', wrap: true});
        this._clipText.clutter_text.ellipsize = 3;
        W.add(cb, this._clipTitle, this._clipText);
        this._clipCard.set_child(cb);

        W.add(col1, clockCard, this._weatherCard, sysCard, this._clipCard);

        // ---------------- Колонка 2: музыка
        const col2 = W.vbox({style_class: 'di-col', x_expand: true});
        this._media = new MediaCard(ctx, {artSize: 92});
        col2.add_child(this._media.actor);
        // Закреплённая (или последняя) заметка
        this._noteCard = W.button({cls: 'di-card di-note-mini', onClick: () => ctx.expandedTab('notes')});
        const nb = W.vbox({x_expand: true});
        this._noteTitle = W.label('', {cls: 'di-small di-note-mini-title'});
        this._noteText = W.label('', {cls: 'di-small', wrap: true, style: `color: ${t.dim};`});
        this._noteText.clutter_text.ellipsize = 3;
        W.add(nb, this._noteTitle, this._noteText);
        this._noteCard.set_child(nb);
        col2.add_child(this._noteCard);

        // ---------------- Колонка 3: переключатели и действия
        const col3 = W.vbox({style_class: 'di-col', width: 250});
        const c = this.services.controls;

        const toggles = W.hbox({style_class: 'di-toggles', x_expand: true});
        this._toggles = [
            this._toggle(toggles, 'weather-clear-night-symbolic', 'Тёмная тема', () => c.darkMode, v => (c.darkMode = v)),
            this._toggle(toggles, 'night-light-symbolic', 'Ночной свет', () => c.nightLight, v => (c.nightLight = v)),
            this._toggle(toggles, 'notifications-disabled-symbolic', 'Не беспокоить', () => c.dnd, v => (c.dnd = v)),
            this._toggle(toggles, 'microphone-sensitivity-muted-symbolic', 'Микрофон выкл.', () => c.micMuted, () => c.toggleMic()),
            this._toggle(toggles, 'view-conceal-symbolic', 'Приватный буфер', () => this.settings.get_boolean('clipboard-private'),
                v => this.settings.set_boolean('clipboard-private', v)),
        ];

        const sliders = W.card(true, {cls: 'di-sliders'});
        this._sliders = sliders;
        this._volRow = W.hbox({x_expand: true, style_class: 'di-slider-row'});
        this._volIcon = W.iconButton(c.volumeIcon, () => c.toggleMute(), {cls: 'di-flat'});
        this._vol = new Slider(c.volume);
        this._vol.x_expand = true;
        this._vol.connect('notify::value', () => {
            if (!this._syncing)
                c.volume = this._vol.value;
        });
        W.add(this._volRow, this._volIcon, this._vol);
        this._brRow = W.hbox({x_expand: true, style_class: 'di-slider-row'});
        this._br = new Slider(c.brightness);
        this._br.x_expand = true;
        this._br.connect('notify::value', () => {
            if (!this._syncing)
                c.brightness = this._br.value;
        });
        W.add(this._brRow, W.icon('display-brightness-symbolic', 16, 'padding: 0 6px;'), this._br);
        W.add(sliders, this._volRow, this._brRow);

        const s = this.services;
        const actions = [
            ['camera-photo-symbolic', 'Скриншот', () => this._run(() => s.recorder.openScreenshotUI())],
            ['media-record-symbolic', 'Запись', () => this._run(() => s.recorder.toggle())],
            ['insert-text-symbolic', 'Текст с экрана', () => ctx.actions.ocr()],
            ['audio-input-microphone-symbolic', 'Голос', () => ctx.actions.voice()],
            ['color-select-symbolic', 'Пипетка', () => ctx.actions.pickColor()],
            ['view-app-grid-symbolic', 'Обзор', () => this._run(() => ctx.extension.toggleOverview())],
        ];
        this._recBtn = null;
        const actionBtns = actions.map(([icon, label, fn]) => {
            const b = W.button({icon, label, vertical: true, iconSize: 18, cls: 'di-action', onClick: fn});
            if (icon === 'media-record-symbolic')
                this._recBtn = b;
            return b;
        });
        const actionGrid = W.grid(actionBtns, 3);

        const system = W.hbox({style_class: 'di-power-row', x_expand: true});
        const sys = [
            ['emblem-system-symbolic', 'Быстрые настройки GNOME', () => ctx.extension.openQuickSettings()],
            ['x-office-calendar-symbolic', 'Календарь и уведомления', () => ctx.extension.openCalendar()],
            ['system-lock-screen-symbolic', 'Заблокировать', () => this._run(() => c.power('lock'))],
            ['weather-clear-night-symbolic', 'Сон', () => this._run(() => c.power('suspend'))],
            ['system-shutdown-symbolic', 'Выключение…', () => this._run(() => c.power('poweroff'))],
        ];
        for (const [icon, tip, fn] of sys) {
            const b = W.iconButton(icon, fn, {cls: 'di-power-btn'});
            b.accessible_name = tip;
            b.x_expand = true;
            system.add_child(b);
        }

        W.add(col3, toggles, sliders, actionGrid, system);
        W.add(this.actor, col1, col2, col3);

        this.subs.on(ctx.tick, 'second', () => this._updateClock());
        this.subs.on(s.weather, 'changed', () => this._updateWeather());
        this.subs.on(s.sysmon, 'updated', () => this._updateSys());
        this.subs.on(s.controls, 'changed', () => this._updateControls());
        this.subs.on(s.recorder, 'changed', () => this._updateControls());
        this.subs.connect(this.settings, 'changed::clipboard-private', () => this._updateControls());
        this.subs.on(s.clipboard, 'changed', () => this._updateClip());
        this.subs.on(s.notes, 'changed', () => this._updateNote());
        this.subs.on(s.notes, 'updated', () => this._updateNote());
        this._updateClip();
        this._updateNote();
        this._updateClock();
        this._updateWeather();
        this._updateSys();
        this._updateControls();
    }

    _statRow(parent, name, color) {
        const row = W.hbox({x_expand: true, style_class: 'di-stat-row'});
        const l = W.label(name, {cls: 'di-small di-stat-name'});
        const bar = new W.ProgressBar({height: 6, color});
        const v = W.label('', {cls: 'di-small di-mono di-stat-value'});
        W.add(row, l, bar, v);
        parent.add_child(row);
        return {bar, v};
    }

    _toggle(parent, icon, tip, get, set) {
        const b = W.iconButton(icon, () => {
            set(!get());
            this.timers.timeout(100, () => this._updateControls());
        }, {cls: 'di-toggle', size: 18});
        b.accessible_name = tip;
        b.x_expand = true;
        b._get = get;
        parent.add_child(b);
        return b;
    }

    async _run(fn) {
        try {
            await fn();
        } catch (e) {
            this.toast('Ошибка', {icon: 'dialog-warning-symbolic', subtitle: e.message});
        }
    }

    _updateClock() {
        if (!this.visible && this._time.text)
            return;
        const now = GLib.DateTime.new_now_local();
        this._time.text = now.format(this.settings.get_string('clock-format')) ?? '';
        this._date.text = now.format('%A, %-d %B') ?? '';
    }

    _updateWeather() {
        const w = this.services.weather;
        if (w.data) {
            this._wEmoji.text = w.data.emoji;
            this._wTemp.text = `${Math.round(w.data.temp)}${w.unitSymbol}`;
            this._wDesc.text = `${w.data.text}${w.location?.name ? ` · ${w.location.name}` : ''}`;
        } else if (w.error) {
            this._wDesc.text = w.error;
        }
    }

    _updateSys() {
        if (!this.visible)
            return;
        const s = this.services.sysmon;
        this._cpuBar.bar.value = s.cpu;
        this._cpuBar.v.text = `${Math.round(s.cpu * 100)}%`;
        this._ramBar.bar.value = s.mem.percent;
        this._ramBar.v.text = `${Math.round(s.mem.percent * 100)}%`;
        const temp = s.temp !== null ? `  🌡 ${Math.round(s.temp)}°C` : '';
        this._net.text = `↓ ${formatSpeed(s.net.rx)}  ↑ ${formatSpeed(s.net.tx)}${temp}`;
    }

    _updateClip() {
        const item = this.services.clipboard.items[0];
        if (!item) {
            this._clipText.text = 'Пока пусто — скопируйте что-нибудь';
            return;
        }
        if (item.type === 'text')
            this._clipText.text = item.text.replace(/\s+/g, ' ').trim().slice(0, 160);
        else if (item.type === 'image')
            this._clipText.text = '🖼 Изображение';
        else
            this._clipText.text = `🗂 Файлы: ${item.uris?.length ?? 0}`;
    }

    _updateNote() {
        const notes = this.services.notes;
        const n = notes.sorted[0];
        this._noteCard.visible = !!n;
        if (!n)
            return;
        this._noteTitle.text = `${n.pinned ? '📌' : '📝'} ${notes.title(n)}`;
        this._noteTitle.style = `color: ${n.color}; font-weight: 700;`;
        const body = n.text.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim();
        this._noteText.text = body.slice(0, 200) || 'Нажмите, чтобы открыть заметки';
    }

    _updateControls() {
        const c = this.services.controls;
        this._syncing = true;
        for (const b of this._toggles)
            W.setAccent(b, this.theme, !!b._get());
        this._volRow.visible = c.hasVolume;
        this._vol.value = c.volume;
        this._volIcon._icon.icon_name = c.volumeIcon;
        this._brRow.visible = c.hasBrightness;
        this._sliders.visible = c.hasVolume || c.hasBrightness;
        if (c.hasBrightness)
            this._br.value = c.brightness;
        if (this._recBtn) {
            const rec = this.services.recorder.recording;
            this._recBtn._label.text = rec ? 'Стоп' : 'Запись';
            this._recBtn.style = rec ? `background-color: ${this.theme.danger}; color: #fff;` : '';
        }
        this._syncing = false;
    }

    onShow() {
        super.onShow();
        this._media.setActive(true);
        this._updateClock();
        this._updateSys();
        this._updateControls();
    }

    onHide() {
        super.onHide();
        this._media.setActive(false);
    }

    destroy() {
        this._media.destroy();
        super.destroy();
    }
}
