// Тёмная тема для всех программ, а не только для GTK4.
//
// Программы на GTK4 и libadwaita, Firefox, Chromium и Flatpak сами следуют
// color-scheme (через портал). Остальным HypeDE говорит отдельно:
//
// * GTK3 — тема Adwaita или Adwaita-dark (gtk-theme; если выбрана другая
//   тема, её не трогаем);
// * Qt и KDE — цветовая схема HypeDELight/HypeDEDark в kdeglobals и сигнал
//   KGlobalSettings, по которому открытые программы KDE перекрашиваются.
//
// kdeglobals HypeDE лежит в ~/.config/hypede/xdg: hypede-session добавляет
// этот каталог в XDG_CONFIG_DIRS только своему сеансу. Сеанс Plasma на той
// же машине его не видит, а своя схема в ~/.config/kdeglobals главнее.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const ADWAITA = ['', 'Adwaita', 'Adwaita-dark'];
const DATA_DIRS = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()];

function findScheme(name) {
    for (const dir of DATA_DIRS) {
        const path = GLib.build_filenamev([dir, 'color-schemes', `${name}.colors`]);
        if (GLib.file_test(path, GLib.FileTest.EXISTS))
            return path;
    }
    return null;
}

// Группы файла KConfig: заголовок целиком (с вложенными «[A][B]», которых
// GLib.KeyFile не понимает) → строки ключей.
function readGroups(path) {
    const groups = new Map();
    const text = new TextDecoder().decode(GLib.file_get_contents(path)[1]);
    let lines = null;
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[')) {
            lines = [];
            groups.set(trimmed, lines);
        } else if (lines && trimmed.includes('=') && !trimmed.startsWith('#')) {
            lines.push(trimmed);
        }
    }
    return groups;
}

export class AppTheme {
    constructor() {
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._iface.connectObject('changed::color-scheme', () => this._sync(), this);
        this._sync();
    }

    _sync() {
        const dark = this._iface.get_string('color-scheme') === 'prefer-dark';
        if (ADWAITA.includes(this._iface.get_string('gtk-theme')))
            this._iface.set_string('gtk-theme', dark ? 'Adwaita-dark' : 'Adwaita');
        try {
            this._syncKde(dark ? 'HypeDEDark' : 'HypeDELight');
        } catch (e) {
            logError(e, 'HypeDE: не удалось обновить цвета программ KDE');
        }
    }

    // В kdeglobals — группы цветов из схемы целиком: так делает и
    // KColorSchemeManager, программы читают цвета оттуда, а не из файла схемы.
    _syncKde(name) {
        const schemePath = findScheme(name);
        if (!schemePath)
            return;
        const out = ['[General]', `ColorScheme=${name}`, ''];
        for (const [group, lines] of readGroups(schemePath)) {
            if (/^\[(Colors:|ColorEffects:|WM\])/.test(group))
                out.push(group, ...lines, '');
        }
        const dir = GLib.build_filenamev([GLib.get_user_config_dir(), 'hypede', 'xdg']);
        GLib.mkdir_with_parents(dir, 0o755);
        GLib.file_set_contents(GLib.build_filenamev([dir, 'kdeglobals']), out.join('\n'));
        // Открытые программы KDE перечитают палитру (0 — PaletteChanged).
        Gio.DBus.session.emit_signal(null, '/KGlobalSettings', 'org.kde.KGlobalSettings',
            'notifyChange', new GLib.Variant('(ii)', [0, 0]));
    }

    destroy() {
        this._iface.disconnectObject(this);
    }
}
