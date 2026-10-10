// Погода через Open-Meteo (бесплатно, без ключа).

import GLib from 'gi://GLib';

import {Emitter, Timers, getJson} from '../utils.js';
import {weatherInfo} from '../pure/format.js';

export class WeatherService extends Emitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._timers = new Timers();
        this.data = null;
        this.location = null;
        this.error = null;
        this.loading = false;
        this._settings.connectObject(
            'changed::weather-city', () => {
                this._settings.set_string('weather-cache', '');
                this.location = null;
                this.refresh();
            },
            'changed::weather-units', () => this.refresh(),
            'changed::weather-interval', () => this._schedule(),
            this);
        try {
            const cache = this._settings.get_string('weather-cache');
            if (cache)
                this.location = JSON.parse(cache);
        } catch {}
        // Первая загрузка с небольшой задержкой, чтобы не тормозить старт оболочки
        this._timers.timeout(2500, () => this.refresh());
        this._schedule();
    }

    _schedule() {
        if (this._loopId)
            this._timers.clear(this._loopId);
        this._loopId = this._timers.interval(this._settings.get_int('weather-interval') * 60 * 1000, () => {
            this.refresh();
            return true;
        });
    }

    get units() {
        return this._settings.get_string('weather-units');
    }

    get unitSymbol() {
        return this.units === 'fahrenheit' ? '°F' : '°C';
    }

    async _locate() {
        const city = this._settings.get_string('weather-city').trim();
        if (city) {
            const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru&format=json`;
            const res = await getJson(url);
            const r = res.results?.[0];
            if (!r)
                throw new Error(`Город «${city}» не найден`);
            return {lat: r.latitude, lon: r.longitude, name: r.name, country: r.country ?? ''};
        }
        // Определение по IP
        const providers = [
            async () => {
                const j = await getJson('https://ipwho.is/?lang=ru');
                if (j.success === false)
                    throw new Error(j.message);
                return {lat: j.latitude, lon: j.longitude, name: j.city, country: j.country};
            },
            async () => {
                const j = await getJson('https://ipapi.co/json/');
                return {lat: j.latitude, lon: j.longitude, name: j.city, country: j.country_name};
            },
        ];
        let lastErr;
        for (const p of providers) {
            try {
                const loc = await p();
                if (Number.isFinite(loc.lat) && Number.isFinite(loc.lon))
                    return loc;
            } catch (e) {
                lastErr = e;
            }
        }
        throw lastErr ?? new Error('Не удалось определить местоположение');
    }

    async refresh() {
        if (this.loading)
            return;
        this.loading = true;
        this.emit('changed');
        try {
            if (!this.location) {
                this.location = await this._locate();
                this._settings.set_string('weather-cache', JSON.stringify(this.location));
            }
            const {lat, lon} = this.location;
            const params = [
                `latitude=${lat}`, `longitude=${lon}`,
                'current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day,pressure_msl,precipitation',
                'hourly=temperature_2m,weather_code,precipitation_probability,is_day',
                'daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max',
                'timezone=auto', 'forecast_days=7', 'wind_speed_unit=ms',
                `temperature_unit=${this.units}`,
            ];
            const j = await getJson(`https://api.open-meteo.com/v1/forecast?${params.join('&')}`);
            const c = j.current;
            const nowIdx = Math.max(0, (j.hourly?.time ?? []).findIndex(t => t >= c.time));
            this.data = {
                temp: c.temperature_2m,
                feels: c.apparent_temperature,
                humidity: c.relative_humidity_2m,
                wind: c.wind_speed_10m,
                windDir: c.wind_direction_10m,
                pressure: c.pressure_msl ? Math.round(c.pressure_msl * 0.750062) : null, // мм рт. ст.
                precipitation: c.precipitation,
                code: c.weather_code,
                isDay: !!c.is_day,
                ...weatherInfo(c.weather_code, !!c.is_day),
                hourly: (j.hourly?.time ?? []).slice(nowIdx, nowIdx + 24).map((t, k) => {
                    const i = nowIdx + k;
                    return {
                        time: t,
                        temp: j.hourly.temperature_2m[i],
                        code: j.hourly.weather_code[i],
                        pop: j.hourly.precipitation_probability?.[i] ?? null,
                        ...weatherInfo(j.hourly.weather_code[i], !!j.hourly.is_day?.[i]),
                    };
                }),
                daily: (j.daily?.time ?? []).map((t, i) => ({
                    date: t,
                    max: j.daily.temperature_2m_max[i],
                    min: j.daily.temperature_2m_min[i],
                    code: j.daily.weather_code[i],
                    pop: j.daily.precipitation_probability_max?.[i] ?? null,
                    uv: j.daily.uv_index_max?.[i] ?? null,
                    sunrise: j.daily.sunrise?.[i],
                    sunset: j.daily.sunset?.[i],
                    ...weatherInfo(j.daily.weather_code[i], true),
                })),
                updated: GLib.DateTime.new_now_local(),
            };
            this.error = null;
            this._fails = 0;
        } catch (e) {
            this.error = e.message;
            console.error(`[dynamic-island] weather: ${e.message}`);
            // Повтор с нарастающей задержкой: 15 с, 30 с, 1 мин… до 10 мин
            this._fails = (this._fails ?? 0) + 1;
            if (this._retryId)
                this._timers.clear(this._retryId);
            this._retryId = this._timers.timeout(Math.min(600000, 15000 * 2 ** (this._fails - 1)), () => {
                this._retryId = 0;
                this.refresh();
            });
        } finally {
            this.loading = false;
            this.emit('changed');
        }
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._timers.destroy();
        this.disconnectAll();
    }
}
