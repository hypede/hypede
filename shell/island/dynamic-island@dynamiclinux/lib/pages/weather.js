// Погода: сейчас, по часам и на неделю.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import {BasePage} from './base.js';
import * as W from '../ui/widgets.js';
import {windDirection} from '../pure/format.js';

function dayName(dateStr, i) {
    if (i === 0)
        return 'Сегодня';
    if (i === 1)
        return 'Завтра';
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = GLib.DateTime.new_local(y, m, d, 12, 0, 0);
    const s = dt.format('%a, %e %b') ?? dateStr;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

export class WeatherPage extends BasePage {
    constructor(ctx) {
        super(ctx, {cls: 'di-weather'});
        const t = this.theme;

        const top = W.hbox({style_class: 'di-toolbar', x_expand: true});
        this._place = W.label('', {cls: 'di-heading', expand: true});
        this._city = W.entry({hint: 'Город (пусто — по IP)', text: this.settings.get_string('weather-city'),
            onActivate: text => this.settings.set_string('weather-city', text.trim())});
        this._city.width = 220;
        this._city.x_expand = false;
        const refresh = W.iconButton('view-refresh-symbolic', () => this.services.weather.refresh(), {cls: 'di-flat'});
        W.add(top, this._place, this._city, refresh);

        const main = W.hbox({x_expand: true, y_expand: true, style_class: 'di-weather-main'});
        // текущая погода
        const now = W.card(true, {cls: 'di-weather-now'});
        now.width = 260;
        this._emoji = W.label('', {cls: 'di-weather-big-emoji'});
        this._temp = W.label('', {cls: 'di-weather-big-temp'});
        this._desc = W.label('', {cls: 'di-weather-desc'});
        this._details = W.label('', {cls: 'di-small', wrap: true, style: `color: ${t.dim};`});
        const head = W.hbox({x_expand: true});
        W.add(head, this._emoji, this._temp);
        W.add(now, head, this._desc, this._details);

        const right = W.vbox({x_expand: true, y_expand: true, style_class: 'di-col'});
        this._hourly = W.hbox({style_class: 'di-hourly'});
        this._daily = W.vbox({style_class: 'di-daily', x_expand: true});
        W.add(right, W.scroll(this._hourly, {horizontal: true, cls: 'di-hourly-scroll'}), W.scroll(this._daily));

        W.add(main, now, right);
        this._status = W.label('', {cls: 'di-small', style: `color: ${t.faint};`});
        W.add(this.actor, top, main, this._status);

        this.subs.on(this.services.weather, 'changed', () => this._render());
        this._render();
    }

    _render() {
        const t = this.theme;
        const w = this.services.weather;
        const d = w.data;
        const loc = w.location;
        this._place.text = loc ? `${loc.name ?? ''}${loc.country ? `, ${loc.country}` : ''}` : 'Погода';
        if (w.loading && !d) {
            this._desc.text = 'Загрузка…';
            return;
        }
        if (!d) {
            this._desc.text = w.error ? `⚠ ${w.error}` : 'Нет данных';
            return;
        }
        const u = w.unitSymbol;
        this._emoji.text = d.emoji;
        this._temp.text = `${Math.round(d.temp)}${u}`;
        this._desc.text = d.text;
        this._details.text = [
            `Ощущается как ${Math.round(d.feels)}${u}`,
            `Влажность ${d.humidity}%`,
            `Ветер ${d.wind?.toFixed(1)} м/с, ${windDirection(d.windDir ?? 0)}`,
            d.pressure ? `Давление ${d.pressure} мм рт. ст.` : null,
            d.daily?.[0]?.uv !== null && d.daily?.[0]?.uv !== undefined ? `УФ-индекс ${Math.round(d.daily[0].uv)}` : null,
            d.daily?.[0]?.sunrise ? `Восход ${d.daily[0].sunrise.slice(11)} · закат ${d.daily[0].sunset.slice(11)}` : null,
        ].filter(Boolean).join('\n');

        this._hourly.destroy_all_children();
        for (const h of d.hourly ?? []) {
            const c = W.vbox({style_class: 'di-hour'});
            const time = W.label(h.time.slice(11, 16), {cls: 'di-small', style: `color: ${t.dim};`});
            const e = W.label(h.emoji, {cls: 'di-hour-emoji'});
            const tmp = W.label(`${Math.round(h.temp)}°`, {cls: 'di-mono'});
            for (const a of [time, e, tmp])
                a.x_align = Clutter.ActorAlign.CENTER;
            W.add(c, time, e, tmp);
            if (h.pop) {
                const p = W.label(`💧${h.pop}%`, {cls: 'di-tiny', style: 'color: #64d2ff;'});
                p.x_align = Clutter.ActorAlign.CENTER;
                c.add_child(p);
            }
            this._hourly.add_child(c);
        }

        this._daily.destroy_all_children();
        const all = d.daily ?? [];
        const minAll = Math.min(...all.map(x => x.min));
        const maxAll = Math.max(...all.map(x => x.max));
        all.forEach((day, i) => {
            const row = W.hbox({style_class: 'di-day-row', x_expand: true});
            const name = W.label(dayName(day.date, i), {cls: 'di-small'});
            name.width = 110;
            const e = W.label(day.emoji, {cls: 'di-day-emoji'});
            const pop = W.label(day.pop ? `💧${day.pop}%` : '', {cls: 'di-tiny', style: 'color: #64d2ff;'});
            pop.width = 52;
            const lo = W.label(`${Math.round(day.min)}°`, {cls: 'di-small di-mono', style: `color: ${t.dim};`});
            lo.width = 36;
            const range = new W.ProgressBar({height: 5, color: t.accent});
            range.value = (day.max - minAll) / Math.max(1, maxAll - minAll);
            const hi = W.label(`${Math.round(day.max)}°`, {cls: 'di-small di-mono'});
            hi.width = 36;
            W.add(row, name, e, pop, lo, range, hi);
            this._daily.add_child(row);
        });
        const upd = d.updated?.format('%H:%M') ?? '';
        this._status.text = `Обновлено в ${upd} · данные Open-Meteo${w.error ? ` · ⚠ ${w.error}` : ''}`;
    }
}
