// ИИ-помощник в оболочке.
//
// Сам помощник — отдельное приложение (apps/assistant): встроенный браузер с
// чатом выбранного провайдера. Оболочка ставит его окно боковой панелью у
// правого края экрана, как в Chrome OS, и даёт другим частям (лаунчеру)
// функцию «спросить» и название провайдера для кнопок.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const APP_ID = 'dev.hypede.Assistant';
const MARGIN = 8;

// Те же провайдеры, что в apps/assistant/hypede_assistant/providers.py.
const PROVIDER_NAMES = {
    claude: 'Claude', gemini: 'Gemini', mistral: 'Mistral',
    chatgpt: 'ChatGPT', grok: 'Grok', deepseek: 'DeepSeek',
};

let instance = null;

export function getAssistant() {
    return instance;
}

export class Assistant {
    constructor() {
        const source = Gio.SettingsSchemaSource.get_default();
        this._settings = source?.lookup('dev.hypede.assistant', true)
            ? new Gio.Settings({schema_id: 'dev.hypede.assistant'}) : null;
        global.display.connectObject('window-created', (_d, window) => this._onWindow(window), this);
        instance = this;
    }

    get enabled() {
        return !!this._settings?.get_boolean('enabled') &&
            GLib.find_program_in_path('hypede-assistant') !== null;
    }

    get providerName() {
        return PROVIDER_NAMES[this._settings?.get_string('provider')] ?? 'Claude';
    }

    connectChanged(callback, owner) {
        this._settings?.connectObject('changed', () => callback(), owner);
    }

    disconnectChanged(owner) {
        this._settings?.disconnectObject(owner);
    }

    // Открыть помощника с вопросом и файлами (пути).
    ask(prompt = '', files = []) {
        const argv = ['hypede-assistant'];
        if (prompt)
            argv.push('--prompt', prompt);
        for (const file of files)
            argv.push('--file', file);
        try {
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
            launcher.spawnv(argv);
        } catch (e) {
            Main.notifyError('HypeDE', e.message);
        }
    }

    // Окно помощника — боковая панель во всю высоту рабочей области.
    _onWindow(window) {
        // На Wayland идентификатор приложения приходит чуть позже самого окна.
        const isAssistant = () => window.get_wm_class() === APP_ID ||
            window.get_gtk_application_id() === APP_ID;
        if (!isAssistant()) {
            const check = () => {
                if (!isAssistant())
                    return;
                window.disconnectObject(this);
                this._dock(window);
            };
            window.connectObject(
                'notify::wm-class', check,
                'notify::gtk-application-id', check,
                'unmanaged', () => window.disconnectObject(this),
                this);
            return;
        }
        this._dock(window);
    }

    _dock(window) {
        const actor = window.get_compositor_private();
        const place = () => {
            const monitor = window.get_monitor();
            const area = window.get_work_area_for_monitor(monitor);
            const width = Math.min(this._settings?.get_int('panel-width') ?? 440, area.width - 2 * MARGIN);
            window.move_resize_frame(false,
                area.x + area.width - width - MARGIN, area.y + MARGIN,
                width, area.height - 2 * MARGIN);
            window.make_above();
        };
        // Если окно уже показано — сразу, иначе после первого кадра.
        if (actor && !actor.visible) {
            actor.connectObject('first-frame', () => {
                actor.disconnectObject(this);
                place();
            }, this);
        } else {
            place();
        }
        window.connectObject('unmanaged', () => window.disconnectObject(this), this);
    }

    destroy() {
        global.display.disconnectObject(this);
        this._settings?.disconnectObject(this);
        if (instance === this)
            instance = null;
    }
}
