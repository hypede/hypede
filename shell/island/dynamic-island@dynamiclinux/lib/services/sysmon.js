// Мониторинг системы: CPU, память, температура, сеть, батарея, диск, FPS.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Emitter, Timers, readFileSync, run} from '../utils.js';

const HISTORY = 60;

export class SysMonitor extends Emitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._timers = new Timers();
        this._prevCpu = null;
        this._prevCores = [];
        this._prevNet = null;
        this._prevTime = 0;
        this._frames = 0;
        this._fpsTime = GLib.get_monotonic_time();
        this._paintId = 0;
        this._fpsUsers = 0;
        this._thermalPath = undefined;
        this._batteryPath = undefined;

        this.cpu = 0;
        this.cores = [];
        this.mem = {total: 0, used: 0, available: 0, swapTotal: 0, swapUsed: 0, percent: 0};
        this.temp = null;
        this.net = {rx: 0, tx: 0, rxTotal: 0, txTotal: 0};
        this.battery = null;
        this.disk = null;
        this.fps = 0;
        this.load = [0, 0, 0];
        this.uptime = 0;
        this.history = {cpu: [], mem: [], rx: [], tx: [], fps: [], temp: []};

        this._start();
        this._settings.connectObject('changed::update-interval', () => this._start(), this);
    }

    _start() {
        if (this._loopId)
            this._timers.clear(this._loopId);
        this._update();
        this._loopId = this._timers.interval(this._settings.get_int('update-interval'), () => {
            this._update();
            return true;
        });
    }

    /** Подписка на подсчёт FPS (включается только когда кто-то смотрит). */
    acquireFps() {
        this._fpsUsers++;
        if (this._fpsUsers === 1) {
            this._frames = 0;
            this._fpsTime = GLib.get_monotonic_time();
            this._paintId = global.stage.connect('after-paint', () => {
                this._frames++;
            });
        }
    }

    releaseFps() {
        this._fpsUsers = Math.max(0, this._fpsUsers - 1);
        if (this._fpsUsers === 0 && this._paintId) {
            global.stage.disconnect(this._paintId);
            this._paintId = 0;
            this.fps = 0;
        }
    }

    _push(name, v) {
        const h = this.history[name];
        h.push(v);
        if (h.length > HISTORY)
            h.shift();
    }

    _update() {
        try {
            this._readCpu();
            this._readMem();
            this._readNet();
            this._readTemp();
            this._readBattery();
            this._readLoad();
            this._readFps();
        } catch (e) {
            console.error(`[dynamic-island] sysmon: ${e.message}`);
        }
        this.emit('updated');
    }

    _readCpu() {
        const stat = readFileSync('/proc/stat');
        if (!stat)
            return;
        const lines = stat.split('\n').filter(l => l.startsWith('cpu'));
        const parse = l => {
            const p = l.trim().split(/\s+/).slice(1).map(Number);
            const idle = p[3] + (p[4] || 0);
            const total = p.slice(0, 8).reduce((a, b) => a + b, 0);
            return {idle, total};
        };
        const all = parse(lines[0]);
        if (this._prevCpu) {
            const dt = all.total - this._prevCpu.total;
            const di = all.idle - this._prevCpu.idle;
            this.cpu = dt > 0 ? Math.max(0, Math.min(1, 1 - di / dt)) : 0;
        }
        this._prevCpu = all;
        const cores = lines.slice(1).map(parse);
        this.cores = cores.map((c, i) => {
            const prev = this._prevCores[i];
            if (!prev)
                return 0;
            const dt = c.total - prev.total;
            return dt > 0 ? Math.max(0, Math.min(1, 1 - (c.idle - prev.idle) / dt)) : 0;
        });
        this._prevCores = cores;
        this._push('cpu', this.cpu * 100);
    }

    _readMem() {
        const info = readFileSync('/proc/meminfo');
        if (!info)
            return;
        const get = k => {
            const m = info.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'));
            return m ? Number(m[1]) * 1024 : 0;
        };
        const total = get('MemTotal');
        const available = get('MemAvailable');
        const swapTotal = get('SwapTotal');
        const swapFree = get('SwapFree');
        this.mem = {
            total,
            available,
            used: total - available,
            swapTotal,
            swapUsed: swapTotal - swapFree,
            percent: total ? (total - available) / total : 0,
        };
        this._push('mem', this.mem.percent * 100);
    }

    _readNet() {
        const dev = readFileSync('/proc/net/dev');
        if (!dev)
            return;
        let rx = 0, tx = 0;
        for (const line of dev.split('\n').slice(2)) {
            const [name, rest] = line.split(':');
            if (!rest)
                continue;
            const iface = name.trim();
            if (iface === 'lo' || iface.startsWith('veth') || iface.startsWith('docker') || iface.startsWith('br-') || iface.startsWith('virbr'))
                continue;
            const p = rest.trim().split(/\s+/).map(Number);
            rx += p[0];
            tx += p[8];
        }
        const now = GLib.get_monotonic_time();
        if (this._prevNet) {
            const dt = (now - this._prevTime) / 1e6;
            if (dt > 0) {
                this.net.rx = Math.max(0, (rx - this._prevNet.rx) / dt);
                this.net.tx = Math.max(0, (tx - this._prevNet.tx) / dt);
            }
        }
        this.net.rxTotal = rx;
        this.net.txTotal = tx;
        this._prevNet = {rx, tx};
        this._prevTime = now;
        this._push('rx', this.net.rx);
        this._push('tx', this.net.tx);
    }

    _findThermal() {
        // Предпочитаем датчики CPU в hwmon (coretemp, k10temp, zenpower), затем thermal_zone
        const preferred = ['coretemp', 'k10temp', 'zenpower', 'cpu_thermal', 'acpitz'];
        const candidates = [];
        try {
            const dir = Gio.File.new_for_path('/sys/class/hwmon');
            const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = en.next_file(null))) {
                const base = `/sys/class/hwmon/${info.get_name()}`;
                const name = (readFileSync(`${base}/name`) ?? '').trim();
                if (readFileSync(`${base}/temp1_input`) !== null)
                    candidates.push({name, path: `${base}/temp1_input`});
            }
        } catch {}
        for (const p of preferred) {
            const c = candidates.find(x => x.name === p);
            if (c)
                return c.path;
        }
        if (candidates.length)
            return candidates[0].path;
        for (let i = 0; i < 10; i++) {
            const path = `/sys/class/thermal/thermal_zone${i}/temp`;
            if (readFileSync(path) !== null)
                return path;
        }
        return null;
    }

    _readTemp() {
        if (this._thermalPath === undefined)
            this._thermalPath = this._findThermal();
        if (!this._thermalPath)
            return;
        const raw = readFileSync(this._thermalPath);
        if (raw === null)
            return;
        const v = Number(raw.trim()) / 1000;
        this.temp = Number.isFinite(v) && v > 0 ? v : null;
        if (this.temp !== null)
            this._push('temp', this.temp);
    }

    _readBattery() {
        if (this._batteryPath === undefined) {
            this._batteryPath = null;
            for (const n of ['BAT0', 'BAT1', 'BAT2', 'BATT', 'CMB0']) {
                if (readFileSync(`/sys/class/power_supply/${n}/capacity`) !== null) {
                    this._batteryPath = `/sys/class/power_supply/${n}`;
                    break;
                }
            }
        }
        if (!this._batteryPath)
            return;
        const cap = Number((readFileSync(`${this._batteryPath}/capacity`) ?? '').trim());
        const status = (readFileSync(`${this._batteryPath}/status`) ?? '').trim();
        this.battery = {
            percent: Number.isFinite(cap) ? cap : 0,
            charging: status === 'Charging' || status === 'Full',
            status,
        };
    }

    _readLoad() {
        const l = readFileSync('/proc/loadavg');
        if (l)
            this.load = l.trim().split(/\s+/).slice(0, 3).map(Number);
        const u = readFileSync('/proc/uptime');
        if (u)
            this.uptime = Number(u.split(/\s+/)[0]);
    }

    _readFps() {
        if (!this._paintId)
            return;
        const now = GLib.get_monotonic_time();
        const dt = (now - this._fpsTime) / 1e6;
        if (dt > 0)
            this.fps = Math.round(this._frames / dt);
        this._frames = 0;
        this._fpsTime = now;
        this._push('fps', this.fps);
    }

    /** Использование корневого диска. */
    readDisk(path = '/') {
        try {
            const info = Gio.File.new_for_path(path).query_filesystem_info('filesystem::size,filesystem::free', null);
            const size = info.get_attribute_uint64('filesystem::size');
            const free = info.get_attribute_uint64('filesystem::free');
            this.disk = {size, free, used: size - free, percent: size ? (size - free) / size : 0};
        } catch {
            this.disk = null;
        }
        return this.disk;
    }

    /** Топ процессов по CPU. */
    async topProcesses(n = 6) {
        const res = await run(['ps', '-eo', 'pid,pcpu,pmem,comm', '--sort=-pcpu', '--no-headers']);
        if (!res.ok)
            return [];
        return res.stdout.trim().split('\n').map(l => {
            const m = l.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/);
            return m ? {pid: Number(m[1]), cpu: Number(m[2]), mem: Number(m[3]), name: m[4]} : null;
        }).filter(p => p && p.name !== 'ps').slice(0, n);
    }

    /** Модель процессора. */
    cpuModel() {
        const info = readFileSync('/proc/cpuinfo') ?? '';
        const m = info.match(/^model name\s*:\s*(.+)$/m);
        return m ? m[1].replace(/\s+/g, ' ').trim() : 'CPU';
    }

    destroy() {
        this._settings.disconnectObject(this);
        if (this._paintId)
            global.stage.disconnect(this._paintId);
        this._paintId = 0;
        this._timers.destroy();
        this.disconnectAll();
    }
}
