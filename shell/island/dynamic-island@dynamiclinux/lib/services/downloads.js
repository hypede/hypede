// Отслеживание текущих загрузок браузеров по временным файлам в папке «Загрузки».

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Emitter, Timers, expandHome} from '../utils.js';

// Firefox: .part, Chrome/Chromium/Edge/Brave/Yandex: .crdownload, Epiphany: .download,
// Opera: .opdownload, wget/curl через расширения: .partial
const TEMP_SUFFIXES = ['.part', '.crdownload', '.download', '.opdownload', '.partial', '.!qB', '.aria2'];

/**
 * @typedef {object} Download
 * @property {string} tempName
 * @property {string} name
 * @property {number} size
 * @property {number} speed
 * @property {number} started
 */

export class DownloadsService extends Emitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._timers = new Timers();
        /** @type {Map<string, Download>} */
        this.active = new Map();
        this.recent = [];
        this._setupMonitor();
        this._settings.connectObject('changed::downloads-dir', () => this._setupMonitor(), this);
    }

    get dir() {
        const custom = expandHome(this._settings.get_string('downloads-dir'));
        return custom || GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) ||
            GLib.build_filenamev([GLib.get_home_dir(), 'Downloads']);
    }

    _setupMonitor() {
        if (this._monitor) {
            this._monitor.cancel();
            this._monitor = null;
        }
        try {
            const dir = Gio.File.new_for_path(this.dir);
            this._monitor = dir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
            this._monitor.set_rate_limit(500);
            this._monitor.connect('changed', () => this._queueScan());
        } catch (e) {
            console.error(`[dynamic-island] downloads monitor: ${e.message}`);
        }
        this._scan();
    }

    _queueScan() {
        if (this._scanId)
            return;
        this._scanId = this._timers.timeout(300, () => {
            this._scanId = 0;
            this._scan();
        });
    }

    _isTemp(name) {
        return TEMP_SUFFIXES.some(s => name.endsWith(s));
    }

    _finalName(name) {
        for (const s of TEMP_SUFFIXES) {
            if (name.endsWith(s))
                return name.slice(0, -s.length);
        }
        return name;
    }

    _scan() {
        const seen = new Set();
        const now = GLib.get_monotonic_time();
        try {
            const dir = Gio.File.new_for_path(this.dir);
            const en = dir.enumerate_children('standard::name,standard::size,standard::type',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            let info;
            while ((info = en.next_file(null))) {
                const name = info.get_name();
                if (!this._isTemp(name))
                    continue;
                seen.add(name);
                const size = info.get_size();
                const prev = this.active.get(name);
                if (prev) {
                    const dt = (now - prev._t) / 1e6;
                    if (dt > 0.2) {
                        const inst = Math.max(0, (size - prev.size) / dt);
                        prev.speed = prev.speed ? prev.speed * 0.6 + inst * 0.4 : inst;
                        prev.size = size;
                        prev._t = now;
                    }
                } else {
                    const d = {tempName: name, name: this._finalName(name), size, speed: 0, started: Date.now(), _t: now};
                    this.active.set(name, d);
                    this.emit('started', d);
                }
            }
            en.close(null);
        } catch {}

        // Завершённые загрузки
        for (const [name, d] of [...this.active]) {
            if (seen.has(name))
                continue;
            this.active.delete(name);
            const finalPath = GLib.build_filenamev([this.dir, d.name]);
            if (GLib.file_test(finalPath, GLib.FileTest.EXISTS)) {
                try {
                    d.size = Gio.File.new_for_path(finalPath).query_info('standard::size', 0, null).get_size();
                } catch {}
                d.path = finalPath;
                d.finished = Date.now();
                this.recent.unshift(d);
                this.recent = this.recent.slice(0, 10);
                this.emit('finished', d);
            } else {
                this.emit('cancelled', d);
            }
        }

        // Пока есть активные загрузки — опрашиваем размер каждую секунду
        if (this.active.size && !this._pollId) {
            this._pollId = this._timers.interval(1000, () => {
                this._scan();
                if (!this.active.size) {
                    this._pollId = 0;
                    return false;
                }
                return true;
            });
        }
        this.emit('changed');
    }

    /** Суммарная скорость. */
    get totalSpeed() {
        let s = 0;
        for (const d of this.active.values())
            s += d.speed;
        return s;
    }

    destroy() {
        this._settings.disconnectObject(this);
        if (this._monitor)
            this._monitor.cancel();
        this._timers.destroy();
        this.disconnectAll();
    }
}
