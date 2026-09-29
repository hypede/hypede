// Настраиваемое оформление оболочки.
//
// Основные стили лежат в stylesheet-light.css / stylesheet-dark.css. То, что
// пользователь меняет в «Настройках» (прозрачность полки и меню, скругления,
// размеры значков), собирается здесь в небольшой CSS-файл и подключается
// поверх основных стилей. Файл пересобирается при каждом изменении.
//
// Здесь же — скорость анимаций: общий множитель длительности St.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const KEYS = [
    'shelf-opacity', 'shelf-icon-size', 'shelf-size', 'corner-radius',
    'launcher-opacity', 'launcher-icon-size', 'animation-speed',
];

const BASE = {
    dark: {shelf: [18, 19, 21], bubble: [32, 33, 36]},
    light: {shelf: [242, 244, 248], bubble: [248, 250, 253]},
};

function rgba([r, g, b], percent) {
    return `rgba(${r}, ${g}, ${b}, ${(percent / 100).toFixed(2)})`;
}

export class StyleManager {
    constructor(settings) {
        this._settings = settings;
        this._stSettings = St.Settings.get();
        this._context = St.ThemeContext.get_for_stage(global.stage);
        this._dir = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'hypede']);
        this._serial = 0;
        this._file = null;
        this._theme = null;

        for (const key of KEYS)
            this._settings.connectObject(`changed::${key}`, () => this._queueUpdate(), this);
        // Смена темы или светлой/тёмной схемы: GNOME создаёт новую тему,
        // и наши стили нужно подключить к ней заново.
        // Сама загрузка нашего файла тоже вызывает «changed» — такие
        // срабатывания пропускаем, иначе стили перезагружались бы по кругу.
        this._context.connectObject('changed', () => {
            if (this._context.get_theme() !== this._theme || !this._isLast())
                this._queueUpdate();
        }, this);
        this._stSettings.connectObject('notify::color-scheme', () => this._queueUpdate(), this);

        this._update();
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

    _css() {
        const s = this._settings;
        const variant = Main.getStyleVariant?.() === 'dark' ? 'dark' : 'light';
        const base = BASE[variant];
        const radius = s.get_int('corner-radius');
        const shelfSize = s.get_int('shelf-size');
        const icon = s.get_int('shelf-icon-size');
        const item = Math.min(icon + 8, shelfSize - 4);
        const launcherIcon = s.get_int('launcher-icon-size');
        const tile = launcherIcon + 64;
        const floatRadius = Math.min(radius, Math.round(shelfSize / 2));

        return `
#panel.hypede-shelf { background-color: ${rgba(base.shelf, s.get_int('shelf-opacity'))}; }
#panel.hypede-shelf.floating { border-radius: ${floatRadius}px; }
.hypede-shelf-item { width: ${item}px; height: ${item}px; }
.popup-menu-content { background-color: ${rgba(base.bubble, s.get_int('launcher-opacity'))}; border-radius: ${radius}px; }
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
        if (this._file && this._theme === theme)
            theme.unload_stylesheet(this._file);
        this._removeFile();

        try {
            GLib.mkdir_with_parents(this._dir, 0o700);
            const path = GLib.build_filenamev([this._dir, `shell-${this._serial++}.css`]);
            GLib.file_set_contents(path, this._css());
            this._file = Gio.File.new_for_path(path);
            this._theme = theme;
            theme.load_stylesheet(this._file);
        } catch (e) {
            logError(e, 'HypeDE: не удалось применить стили');
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
        if (this._file && this._theme === this._context.get_theme())
            this._theme.unload_stylesheet(this._file);
        this._removeFile();
    }
}
