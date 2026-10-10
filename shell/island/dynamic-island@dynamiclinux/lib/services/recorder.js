// Запись экрана через встроенный сервис GNOME Shell (org.gnome.Shell.Screencast).

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Emitter, Timers, expandHome} from '../utils.js';

const UI_MODE_SCREENCAST = 1;

export class RecorderService extends Emitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._timers = new Timers();
        this.started = 0;
        this.lastPath = null;
        this._ui = Main.screenshotUI;
        this._wasRecording = this.recording;
        if (this._ui) {
            this._ui.connectObject('notify::screencast-in-progress', () => this._sync(), this);
        }
        if (this.recording)
            this.started = Date.now();
    }

    get available() {
        return !!this._ui;
    }

    get recording() {
        return !!this._ui?.screencast_in_progress;
    }

    _sync() {
        const rec = this.recording;
        if (rec && !this._wasRecording) {
            this.started = Date.now();
            this.emit('started');
        } else if (!rec && this._wasRecording) {
            this.lastPath = this._ui._screencastPath ?? this.lastPath;
            this.emit('stopped', this.lastPath);
        }
        this._wasRecording = rec;
        this.emit('changed');
    }

    get elapsed() {
        return this.recording ? (Date.now() - this.started) / 1000 : 0;
    }

    _template() {
        const dir = expandHome(this._settings.get_string('recording-dir').trim());
        const name = 'Запись экрана %d %t';
        if (dir) {
            GLib.mkdir_with_parents(dir, 0o755);
            return GLib.build_filenamev([dir, name]);
        }
        return GLib.build_filenamev(['Screencasts', name]);
    }

    /** Быстрая запись всего экрана без открытия интерфейса скриншотов. */
    async recordScreen() {
        const ui = this._ui;
        if (!ui)
            throw new Error('Запись экрана недоступна');
        if (this.recording)
            return;
        const proxy = ui._screencastProxy;
        if (!proxy || typeof proxy.ScreencastAsync !== 'function' || typeof ui._setScreencastInProgress !== 'function') {
            // Запасной вариант — стандартный интерфейс GNOME
            await this.openRecorderUI();
            return;
        }
        ui._setScreencastInProgress(true);
        try {
            const [ok, path] = await proxy.ScreencastAsync(this._template(), {
                'draw-cursor': new GLib.Variant('b', this._settings.get_boolean('recording-cursor')),
            });
            if (!ok)
                throw new Error('Сервис записи отказал');
            ui._screencastPath = path;
            this.lastPath = path;
        } catch (e) {
            ui._setScreencastInProgress(false);
            throw e;
        }
    }

    /** Стандартный интерфейс GNOME для записи области/окна. */
    async openRecorderUI() {
        await this._ui.open(UI_MODE_SCREENCAST);
    }

    /** Интерфейс скриншота GNOME. */
    async openScreenshotUI() {
        await this._ui.open();
    }

    async stop() {
        if (this.recording)
            await this._ui.stopScreencast();
    }

    toggle() {
        return this.recording ? this.stop() : this.recordScreen();
    }

    destroy() {
        this._ui?.disconnectObject(this);
        this._timers.destroy();
        this.disconnectAll();
    }
}
