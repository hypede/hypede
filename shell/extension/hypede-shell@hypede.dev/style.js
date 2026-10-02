// Настраиваемое оформление оболочки.
//
// Основные стили лежат в stylesheet-light.css / stylesheet-dark.css. То, что
// пользователь меняет в «Настройках» (прозрачность полки и меню, скругления,
// размеры значков), собирается здесь в небольшой CSS-файл и подключается
// поверх основных стилей. Файл пересобирается при каждом изменении.
//
// Здесь же — свой цвет акцента, цвета полки и меню, часы экрана блокировки
// и скорость анимаций (общий множитель длительности St).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {isLight, nearestGnomeAccent, parseHex, toHex} from './util.js';

const KEYS = [
    'shelf-opacity', 'shelf-icon-size', 'shelf-size', 'corner-radius',
    'launcher-opacity', 'launcher-icon-size', 'animation-speed',
    'accent-custom', 'shelf-color', 'launcher-color', 'lock-clock-color', 'lock-clock-size',
];

const BASE = {
    dark: {shelf: [18, 19, 21], bubble: [32, 33, 36]},
    light: {shelf: [242, 244, 248], bubble: [248, 250, 253]},
};

function rgba([r, g, b], percent) {
    return `rgba(${r}, ${g}, ${b}, ${(percent / 100).toFixed(2)})`;
}

// Правила CSS без комментариев: [[селектор, объявления], …]. В стилях
// оболочки нет вложенных блоков, поэтому хватает простого разбора.
function parseRules(text) {
    const rules = [];
    const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g))
        rules.push([m[1].trim(), m[2]]);
    return rules;
}

function readText(file) {
    try {
        const [, bytes] = file.load_contents(null);
        return new TextDecoder().decode(bytes);
    } catch {
        return '';
    }
}

// Правило из нашего файла должно побеждать такое же из основных стилей,
// но при равной специфичности St не обещает, что выиграет файл, подключённый
// позже. Повтор класса (.a.a) добавляет специфичности, не меняя смысла.
function boost(selector) {
    return selector.split(',').map(part => {
        part = part.trim();
        const start = Math.max(part.lastIndexOf(' '), part.lastIndexOf('>')) + 1;
        const last = part.slice(start);
        const m = /\.[\w-]+/.exec(last) ?? /#[\w-]+/.exec(last);
        if (!m)
            return part;
        const at = start + m.index + m[0].length;
        return part.slice(0, at) + m[0] + part.slice(at);
    }).join(', ');
}

// То же для готового CSS: каждое правило — с усиленным селектором.
function boostCss(css) {
    return parseRules(css).map(([selector, body]) => `${boost(selector)} {${body}}`).join('\n');
}

const SHELF_SELECTOR = /#panel|hypede-shelf|hypede-tray/;
const OWN_ONLY = /hypede-lock|hypede-greeting/;

export class StyleManager {
    constructor(settings) {
        this._settings = settings;
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._stSettings = St.Settings.get();
        this._context = St.ThemeContext.get_for_stage(global.stage);
        this._dir = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'hypede']);
        this._extDir = Gio.File.new_for_uri(import.meta.url).get_parent();
        this._sheetCache = new Map();
        this._serial = 0;
        this._file = null;
        this._theme = null;

        for (const key of KEYS)
            this._settings.connectObject(`changed::${key}`, () => this._queueUpdate(), this);
        this._settings.connectObject('changed::accent-custom', () => this._syncGnomeAccent(), this);
        // Смена темы или светлой/тёмной схемы: GNOME создаёт новую тему,
        // и наши стили нужно подключить к ней заново.
        // Сама загрузка нашего файла тоже вызывает «changed» — такие
        // срабатывания пропускаем, иначе стили перезагружались бы по кругу.
        this._context.connectObject('changed', () => {
            if (this._busy)
                return;
            if (this._context.get_theme() !== this._theme || !this._isLast())
                this._queueUpdate();
        }, this);
        this._stSettings.connectObject('notify::color-scheme', () => this._queueUpdate(), this);

        this._syncGnomeAccent();
        this._update();
    }

    // Свой акцент приложения GTK не понимают — им достаётся ближайший из
    // акцентов GNOME, чтобы переключатели в окнах были того же оттенка.
    _syncGnomeAccent() {
        const custom = parseHex(this._settings.get_string('accent-custom'));
        if (!custom || !this._interface.settings_schema.has_key('accent-color'))
            return;
        const name = nearestGnomeAccent(custom);
        if (this._interface.get_string('accent-color') !== name)
            this._interface.set_string('accent-color', name);
    }

    // Наш файл должен идти последним: при смене схемы GNOME перезагружает
    // стили расширения, и они оказались бы поверх наших.
    _isLast() {
        const sheets = this._context.get_theme()?.get_custom_stylesheets() ?? [];
        const last = sheets[sheets.length - 1];
        return !this._file || (last && last.equal(this._file));
    }

    _queueUpdate() {
        if (this._updateId)
            return;
        this._updateId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._updateId = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Разобранные правила файла (кэшируются: файлы не меняются за сеанс).
    _rules(key, file) {
        if (!this._sheetCache.has(key))
            this._sheetCache.set(key, file ? parseRules(readText(file)) : []);
        return this._sheetCache.get(key);
    }

    _ownRules(variant) {
        return this._rules(`own-${variant}`, this._extDir.get_child(`stylesheet-${variant}.css`));
    }

    // Свой акцент: все правила темы GNOME и HypeDE, где встречается
    // -st-accent-color, повторяем с подставленным цветом. Наш файл
    // подключён последним, поэтому эти правила побеждают.
    _accentCss(variant, accent) {
        const fg = isLight(accent) ? 'rgba(0, 0, 0, 0.80)' : '#ffffff';
        const hex = toHex(accent);
        const gnome = this._context.get_theme()?.application_stylesheet;
        const sources = [
            this._rules(`gnome-${gnome?.get_uri()}`, gnome),
            this._ownRules(variant),
        ];
        const out = [];
        for (const rules of sources) {
            for (const [selector, body] of rules) {
                if (!body.includes('-st-accent'))
                    continue;
                const decls = body.split(';')
                    .filter(d => d.includes('-st-accent'))
                    .map(d => d.trim()
                        .replaceAll('-st-accent-fg-color', fg)
                        .replaceAll('-st-accent-color', hex));
                out.push(`${boost(selector)} { ${decls.join('; ')}; }`);
            }
        }
        return out.join('\n');
    }

    // Фон, слишком светлый для тёмной схемы (или наоборот): берём правила
    // нужной части из стилей другой схемы, чтобы текст и значки читались.
    _contrastCss(variant, color, shelf) {
        const want = isLight(color) ? 'light' : 'dark';
        if (want === variant)
            return '';
        return this._ownRules(want)
            .filter(([selector]) => !OWN_ONLY.test(selector) && SHELF_SELECTOR.test(selector) === shelf)
            .map(([selector, body]) => `${boost(selector)} {${body}}`)
            .join('\n');
    }

    _css() {
        const s = this._settings;
        const variant = Main.getStyleVariant?.() === 'dark' ? 'dark' : 'light';
        const base = BASE[variant];
        const shelfColor = parseHex(s.get_string('shelf-color')) ?? base.shelf;
        const bubbleColor = parseHex(s.get_string('launcher-color')) ?? base.bubble;
        const accent = parseHex(s.get_string('accent-custom'));

        return `
${accent ? this._accentCss(variant, accent) : ''}
${parseHex(s.get_string('shelf-color')) ? this._contrastCss(variant, shelfColor, true) : ''}
${parseHex(s.get_string('launcher-color')) ? this._contrastCss(variant, bubbleColor, false) : ''}
${boostCss(this._baseCss(s, shelfColor, bubbleColor))}`;
    }

    // Настройки пользователя: прозрачность, скругления, размеры, часы.
    _baseCss(s, shelfColor, bubbleColor) {
        const radius = s.get_int('corner-radius');
        const shelfSize = s.get_int('shelf-size');
        const icon = s.get_int('shelf-icon-size');
        const item = Math.min(icon + 8, shelfSize - 4);
        const launcherIcon = s.get_int('launcher-icon-size');
        const tile = launcherIcon + 64;
        const floatRadius = Math.min(radius, Math.round(shelfSize / 2));
        const clockScale = s.get_int('lock-clock-size') / 100;
        const clockColor = parseHex(s.get_string('lock-clock-color'));
        const px = v => `${Math.round(v * clockScale)}px`;
        return `
#panel.hypede-shelf { background-color: ${rgba(shelfColor, s.get_int('shelf-opacity'))}; transition-duration: 300ms; }
#panel.hypede-shelf.floating { border-radius: ${floatRadius}px; }
.hypede-shelf-item { width: ${item}px; height: ${item}px; }
.popup-menu-content { background-color: ${rgba(bubbleColor, s.get_int('launcher-opacity'))}; border-radius: ${radius}px; }
.hypede-launcher-menu .popup-menu-content { border-radius: ${radius + 4}px; }
.quick-settings { border-radius: ${radius + 4}px; }
.quick-toggle-menu, .datemenu-popover, #calendarArea { border-radius: ${radius}px; }
.popup-menu-item { border-radius: ${Math.max(0, radius - 10)}px; }
#notification-container .message, .message { border-radius: ${Math.max(0, radius - 4)}px; }
.calendar, .events-button, .world-clocks-button, .weather-button, .datemenu-today-button { border-radius: ${Math.max(0, radius - 4)}px; }
.hypede-launcher-app { width: ${tile}px; border-radius: ${Math.max(0, radius - 4)}px; }
.hypede-launcher-app-label { max-width: ${tile - 12}px; }
.hypede-launcher-chip, .hypede-launcher-result { border-radius: ${Math.max(0, radius - 6)}px; }
.hypede-lock-card { border-radius: ${radius + 4}px; }
.hypede-lock-hours, .hypede-lock-minutes, .hypede-lock-colon { font-size: ${px(150)};${clockColor ? ` color: ${toHex(clockColor)};` : ''} }
.hypede-lock-clock.stacked .hypede-lock-hours, .hypede-lock-clock.stacked .hypede-lock-minutes { font-size: ${px(118)}; }
.hypede-lock-analog { width: ${px(300)}; height: ${px(300)}; }
.hypede-lock-date { font-size: ${(20 * clockScale).toFixed(1)}pt; }
`;
    }

    _update() {
        this._scheduleRecheck();
        // Скорость анимаций: множитель длительности обратен скорости.
        const speed = this._settings.get_double('animation-speed');
        this._stSettings.slow_down_factor = 1 / Math.max(0.1, speed);

        const theme = this._context.get_theme();
        if (!theme)
            return;
        // Загрузка и выгрузка сами вызывают «changed» — их пропускаем.
        this._busy = true;
        try {
            this._unloadOwn(theme);
            this._removeFile();
            GLib.mkdir_with_parents(this._dir, 0o700);
            const path = GLib.build_filenamev([this._dir, `shell-${this._serial++}.css`]);
            GLib.file_set_contents(path, this._css());
            this._file = Gio.File.new_for_path(path);
            this._theme = theme;
            theme.load_stylesheet(this._file);
        } catch (e) {
            logError(e, 'HypeDE: не удалось применить стили');
        } finally {
            this._busy = false;
        }
    }

    // GNOME, пересоздавая тему, переносит в неё все подключённые файлы —
    // и наши прошлые тоже. Убираем из темы все файлы из нашего каталога.
    _unloadOwn(theme) {
        for (const file of theme.get_custom_stylesheets()) {
            if (file.get_parent()?.get_path() === this._dir)
                theme.unload_stylesheet(file);
        }
    }

    // Светлая и тёмная схема переключаются в несколько шагов, и цвета
    // могли быть собраны по старой схеме — проверяем ещё раз чуть позже.
    _scheduleRecheck() {
        if (this._recheckId)
            GLib.source_remove(this._recheckId);
        this._variant = Main.getStyleVariant?.();
        this._recheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            this._recheckId = 0;
            if (Main.getStyleVariant?.() !== this._variant || !this._isLast())
                this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

    _removeFile() {
        if (!this._file)
            return;
        try {
            this._file.delete(null);
        } catch {
            // файла уже нет — не страшно
        }
        this._file = null;
    }

    destroy() {
        if (this._updateId)
            GLib.source_remove(this._updateId);
        if (this._recheckId)
            GLib.source_remove(this._recheckId);
        this._settings.disconnectObject(this);
        this._context.disconnectObject(this);
        this._stSettings.disconnectObject(this);
        this._stSettings.slow_down_factor = 1;
        const theme = this._context.get_theme();
        if (theme)
            this._unloadOwn(theme);
        this._removeFile();
    }
}
