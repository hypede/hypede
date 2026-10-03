// Кнопки заголовка («свернуть», «во весь экран», «закрыть») — во всех
// приложениях.
//
// Рамки Mutter (окна X11 и Qt) и GTK 4 (через портал настроек) читают
// org.gnome.desktop.wm.preferences button-layout — там в сеансе HypeDE
// уже стоят все три кнопки. А вот GTK 3 смотрит только в GtkSettings
// (gtk-decoration-layout из settings.ini): если в файле осталась запись
// от другого сеанса или программы вроде «menu:close», у таких приложений
// кнопок «свернуть» и «во весь экран» нет.
//
// Поэтому при каждом изменении button-layout зеркалим его в
// gtk-decoration-layout в gtk-3.0/settings.ini и gtk-4.0/settings.ini,
// не трогая остальные ключи. Прочие файлы (gtk.css, bookmarks) не
// затрагиваются.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const WM_SCHEMA = 'org.gnome.desktop.wm.preferences';

// Варианты кнопок для GtkSettings: appmenu в GTK зовётся menu.
function toGtkLayout(layout) {
    return layout.trim().split(':')
        .map(side => side.split(',')
            .map(name => name === 'appmenu' ? 'menu' : name)
            .filter(name => ['icon', 'menu', 'minimize', 'maximize', 'close'].includes(name))
            .join(','))
        .join(':');
}

// Поставить key=value в секцию [Settings], остальное сохранить как есть.
function updateIni(text, key, value) {
    const lines = text ? text.split('\n') : [];
    let inSettings = false;
    let haveSettings = false;
    let written = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
        if (section) {
            // Конец секции [Settings] — ключ не нашёлся, дописываем в неё.
            if (inSettings && !written) {
                lines.splice(i, 0, `${key}=${value}`);
                i++;
                written = true;
            }
            inSettings = section[1] === 'Settings';
            haveSettings ||= inSettings;
            continue;
        }
        if (inSettings && line.trim().startsWith(`${key}=`)) {
            lines[i] = `${key}=${value}`;
            written = true;
        }
    }
    if (!haveSettings)
        lines.push('[Settings]');
    if (!written)
        lines.push(`${key}=${value}`);
    return lines.join('\n').replace(/^\n+/, '');
}

export class DecorationSync {
    constructor() {
        this._settings = new Gio.Settings({schema_id: WM_SCHEMA});
        this._settings.connectObject('changed::button-layout', () => this._sync(), this);
        this._sync();
    }

    _sync() {
        const layout = toGtkLayout(this._settings.get_string('button-layout'));
        if (!layout)
            return;
        const configDir = GLib.get_user_config_dir();
        for (const version of ['gtk-3.0', 'gtk-4.0']) {
            const path = GLib.build_filenamev([configDir, version, 'settings.ini']);
            try {
                let text = '';
                try {
                    text = new TextDecoder().decode(GLib.file_get_contents(path)[1]);
                } catch {
                    // файла ещё нет — создадим
                }
                const updated = updateIni(text, 'gtk-decoration-layout', layout);
                if (updated !== text) {
                    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
                    GLib.file_set_contents(path, updated);
                }
            } catch (e) {
                logError(e, 'HypeDE: не удалось обновить gtk-decoration-layout');
            }
        }
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._settings = null;
    }
}
