// Форматирование чисел, размеров, времени и цветов (без зависимостей от GNOME).

/**
 * @param {number} bytes
 * @param {number} [digits]
 * @returns {string}
 */
export function formatBytes(bytes, digits = 1) {
    if (!Number.isFinite(bytes) || bytes < 0)
        return '—';
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${i === 0 ? v.toFixed(0) : v.toFixed(v >= 100 ? 0 : digits)} ${units[i]}`;
}

/**
 * @param {number} bytesPerSec
 * @returns {string}
 */
export function formatSpeed(bytesPerSec) {
    return `${formatBytes(bytesPerSec)}/с`;
}

/**
 * Длительность в виде 1:05 или 1:02:03.
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0)
        seconds = 0;
    const s = Math.floor(seconds % 60);
    const m = Math.floor(seconds / 60) % 60;
    const h = Math.floor(seconds / 3600);
    const ss = String(s).padStart(2, '0');
    if (h > 0)
        return `${h}:${String(m).padStart(2, '0')}:${ss}`;
    return `${m}:${ss}`;
}

/**
 * Человекочитаемая длительность: «2 ч 5 мин».
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor(seconds / 3600) % 24;
    const m = Math.floor(seconds / 60) % 60;
    const parts = [];
    if (d)
        parts.push(`${d} д`);
    if (h)
        parts.push(`${h} ч`);
    parts.push(`${m} мин`);
    return parts.join(' ');
}

/**
 * «только что», «5 мин назад» и т. п.
 *
 * @param {number} timestampMs
 * @param {number} [nowMs]
 * @returns {string}
 */
export function timeAgo(timestampMs, nowMs = Date.now()) {
    const diff = Math.max(0, (nowMs - timestampMs) / 1000);
    if (diff < 45)
        return 'только что';
    if (diff < 3600)
        return `${Math.round(diff / 60)} мин назад`;
    if (diff < 86400)
        return `${Math.round(diff / 3600)} ч назад`;
    return `${Math.round(diff / 86400)} д назад`;
}

/**
 * Склонение существительных: plural(5, ['файл', 'файла', 'файлов']).
 *
 * @param {number} n
 * @param {string[]} forms
 * @returns {string}
 */
export function plural(n, forms) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20)
        return forms[2];
    if (b > 1 && b < 5)
        return forms[1];
    if (b === 1)
        return forms[0];
    return forms[2];
}

/**
 * Обрезает строку с многоточием.
 *
 * @param {string} s
 * @param {number} max
 * @returns {string}
 */
export function ellipsize(s, max) {
    const str = String(s ?? '');
    const chars = [...str];
    return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : str;
}

/**
 * Однострочное превью текста.
 *
 * @param {string} s
 * @param {number} max
 * @returns {string}
 */
export function preview(s, max = 80) {
    return ellipsize(String(s ?? '').replace(/\s+/g, ' ').trim(), max);
}

// ---------------------------------------------------------------- цвета

/**
 * Разбирает CSS-цвет (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba()).
 *
 * @param {string} str
 * @returns {{r: number, g: number, b: number, a: number}}
 */
export function parseColor(str) {
    const s = String(str ?? '').trim().toLowerCase();
    let m = s.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
        let h = m[1];
        if (h.length === 3 || h.length === 4)
            h = [...h].map(c => c + c).join('');
        const n = parseInt(h.slice(0, 6), 16);
        const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
        return {r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a};
    }
    m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(x => parseFloat(x));
        return {r: p[0] ?? 0, g: p[1] ?? 0, b: p[2] ?? 0, a: p[3] ?? 1};
    }
    const named = {black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], transparent: [0, 0, 0, 0]};
    if (named[s]) {
        const [r, g, b, a = 1] = named[s];
        return {r, g, b, a};
    }
    return {r: 0, g: 0, b: 0, a: 1};
}

/**
 * @param {{r: number, g: number, b: number, a: number}} c
 * @returns {string}
 */
export function toCss(c) {
    const r = Math.round(c.r), g = Math.round(c.g), b = Math.round(c.b);
    return `rgba(${r},${g},${b},${Math.round(c.a * 1000) / 1000})`;
}

/**
 * Тот же цвет с другой прозрачностью.
 *
 * @param {string} color
 * @param {number} alpha
 * @returns {string}
 */
export function withAlpha(color, alpha) {
    return toCss({...parseColor(color), a: alpha});
}

/**
 * Смешивает два цвета.
 *
 * @param {string} a
 * @param {string} b
 * @param {number} t 0..1
 * @returns {string}
 */
export function mix(a, b, t) {
    const x = parseColor(a), y = parseColor(b);
    return toCss({
        r: x.r + (y.r - x.r) * t,
        g: x.g + (y.g - x.g) * t,
        b: x.b + (y.b - x.b) * t,
        a: x.a + (y.a - x.a) * t,
    });
}

/**
 * Относительная яркость 0..1.
 *
 * @param {string} color
 * @returns {number}
 */
export function luminance(color) {
    const {r, g, b} = parseColor(color);
    const f = v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
export function rgbToHex(r, g, b) {
    return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {{h: number, s: number, l: number}}
 */
export function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r)
            h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g)
            h = (b - r) / d + 2;
        else
            h = (r - g) / d + 4;
        h /= 6;
    }
    return {h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100)};
}

// ---------------------------------------------------------------- погода

const WMO = {
    0: ['☀️', '🌙', 'Ясно', 'weather-clear-symbolic', 'weather-clear-night-symbolic'],
    1: ['🌤️', '🌙', 'Преимущественно ясно', 'weather-few-clouds-symbolic', 'weather-few-clouds-night-symbolic'],
    2: ['⛅', '☁️', 'Переменная облачность', 'weather-few-clouds-symbolic', 'weather-few-clouds-night-symbolic'],
    3: ['☁️', '☁️', 'Пасмурно', 'weather-overcast-symbolic'],
    45: ['🌫️', '🌫️', 'Туман', 'weather-fog-symbolic'],
    48: ['🌫️', '🌫️', 'Изморозь', 'weather-fog-symbolic'],
    51: ['🌦️', '🌧️', 'Лёгкая морось', 'weather-showers-scattered-symbolic'],
    53: ['🌦️', '🌧️', 'Морось', 'weather-showers-scattered-symbolic'],
    55: ['🌧️', '🌧️', 'Сильная морось', 'weather-showers-symbolic'],
    56: ['🌧️', '🌧️', 'Ледяная морось', 'weather-showers-symbolic'],
    57: ['🌧️', '🌧️', 'Ледяная морось', 'weather-showers-symbolic'],
    61: ['🌦️', '🌧️', 'Небольшой дождь', 'weather-showers-scattered-symbolic'],
    63: ['🌧️', '🌧️', 'Дождь', 'weather-showers-symbolic'],
    65: ['🌧️', '🌧️', 'Ливень', 'weather-showers-symbolic'],
    66: ['🌧️', '🌧️', 'Ледяной дождь', 'weather-showers-symbolic'],
    67: ['🌧️', '🌧️', 'Ледяной дождь', 'weather-showers-symbolic'],
    71: ['🌨️', '🌨️', 'Небольшой снег', 'weather-snow-symbolic'],
    73: ['🌨️', '🌨️', 'Снег', 'weather-snow-symbolic'],
    75: ['❄️', '❄️', 'Сильный снег', 'weather-snow-symbolic'],
    77: ['🌨️', '🌨️', 'Снежная крупа', 'weather-snow-symbolic'],
    80: ['🌦️', '🌧️', 'Ливневый дождь', 'weather-showers-scattered-symbolic'],
    81: ['🌧️', '🌧️', 'Ливни', 'weather-showers-symbolic'],
    82: ['⛈️', '⛈️', 'Сильные ливни', 'weather-storm-symbolic'],
    85: ['🌨️', '🌨️', 'Снегопад', 'weather-snow-symbolic'],
    86: ['❄️', '❄️', 'Сильный снегопад', 'weather-snow-symbolic'],
    95: ['⛈️', '⛈️', 'Гроза', 'weather-storm-symbolic'],
    96: ['⛈️', '⛈️', 'Гроза с градом', 'weather-storm-symbolic'],
    99: ['⛈️', '⛈️', 'Сильная гроза с градом', 'weather-storm-symbolic'],
};

/**
 * Описание погодного кода WMO.
 *
 * @param {number} code
 * @param {boolean} [isDay]
 * @returns {{emoji: string, text: string, icon: string}}
 */
export function weatherInfo(code, isDay = true) {
    const w = WMO[code] ?? ['🌡️', '🌡️', 'Нет данных', 'weather-severe-alert-symbolic'];
    return {
        emoji: isDay ? w[0] : w[1],
        text: w[2],
        icon: (!isDay && w[4]) ? w[4] : w[3],
    };
}

/**
 * Направление ветра по градусам.
 *
 * @param {number} deg
 * @returns {string}
 */
export function windDirection(deg) {
    const dirs = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
    return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}
