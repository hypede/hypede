// Мониторинг системы: графики, ядра, процессы.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {BasePage} from './base.js';
import * as W from '../ui/widgets.js';
import {formatBytes, formatSpeed, formatUptime} from '../pure/format.js';

/** Вертикальный столбик загрузки ядра. */
const VBar = GObject.registerClass(
class DIVBar extends St.Widget {
    _init(color) {
        super._init({
            style_class: 'di-core',
            x_expand: true,
            y_expand: true,
            layout_manager: new Clutter.BinLayout(),
        });
        this._fill = new St.Widget({style_class: 'di-core-fill', x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.END});
        this.add_child(this._fill);
        this._value = 0;
        this.setColor(color);
        this.connect('notify::height', () => this._sync());
    }

    set value(v) {
        this._value = Math.max(0, Math.min(1, v));
        this._sync();
    }

    setColor(c) {
        this._fill.style = `background-color: ${c};`;
    }

    _sync() {
        if (!this.get_stage())
            return;
        this._fill.height = Math.max(2, Math.round(this.height * this._value));
    }
});

export class SystemPage extends BasePage {
    constructor(ctx) {
        super(ctx, {cls: 'di-system'});
        const t = this.theme;
        const sys = this.services.sysmon;

        // ---------- кольца
        const rings = W.hbox({style_class: 'di-rings', x_expand: true});
        this._rings = {};
        const ring = (id, name, color) => {
            const box = W.vbox({style_class: 'di-ring-box', x_expand: true});
            const wrap = new Clutter.Actor({layout_manager: new Clutter.BinLayout(), x_align: Clutter.ActorAlign.CENTER});
            const r = new W.Ring({size: 70, thickness: 7, color, track: t.surfaceStrong});
            const v = W.label('', {cls: 'di-ring-value'});
            v.x_align = Clutter.ActorAlign.CENTER;
            v.y_align = Clutter.ActorAlign.CENTER;
            wrap.add_child(r);
            wrap.add_child(v);
            const l = W.label(name, {cls: 'di-small', style: `color: ${t.dim};`});
            l.x_align = Clutter.ActorAlign.CENTER;
            const sub = W.label('', {cls: 'di-small di-mono', style: `color: ${t.faint};`});
            sub.x_align = Clutter.ActorAlign.CENTER;
            W.add(box, wrap, l, sub);
            rings.add_child(box);
            this._rings[id] = {r, v, sub, box};
        };
        ring('cpu', 'Процессор', t.accent);
        ring('ram', 'Память', '#bf5af2');
        ring('temp', 'Температура', '#ff9f0a');
        ring('disk', 'Диск /', '#30d158');
        ring('bat', 'Батарея', '#ffd60a');

        // ---------- графики
        const graphs = W.hbox({style_class: 'di-graphs', x_expand: true});
        const graphCard = (title) => {
            const c = W.card(true, {cls: 'di-graph-card'});
            const head = W.hbox({x_expand: true});
            const val = W.label('', {cls: 'di-small di-mono', style: `color: ${t.dim};`});
            W.add(head, W.label(title, {cls: 'di-small', expand: true}), val);
            const g = new W.Sparkline({height: 54});
            W.add(c, head, g);
            graphs.add_child(c);
            return {g, val};
        };
        this._cpuGraph = graphCard('CPU, %');
        this._netGraph = graphCard('Сеть');
        this._fpsGraph = graphCard('FPS композитора');

        // ---------- нижняя часть: ядра + процессы
        const bottom = W.hbox({x_expand: true, y_expand: true, style_class: 'di-sys-bottom'});
        const coresCard = W.card(true, {cls: 'di-cores-card', expandY: true});
        this._info = W.label('', {cls: 'di-small', wrap: true, style: `color: ${t.dim};`});
        this._cores = W.hbox({style_class: 'di-cores', x_expand: true, y_expand: true});
        W.add(coresCard, W.label(sys.cpuModel(), {cls: 'di-small'}), this._cores, this._info);
        coresCard.width = 330;

        const procCard = W.card(true, {cls: 'di-proc-card', expandY: true});
        const pHead = W.hbox({x_expand: true});
        W.add(pHead, W.label('Процессы', {cls: 'di-small', expand: true}),
            W.iconButton('power-profile-performance-symbolic', () => {
                this.services.launcher.runCommand('gnome-system-monitor');
                ctx.island.collapse();
            }, {cls: 'di-flat di-mini'}));
        this._procs = W.vbox({x_expand: true});
        W.add(procCard, pHead, this._procs);

        W.add(bottom, coresCard, procCard);
        W.add(this.actor, rings, graphs, bottom);

        this.subs.on(sys, 'updated', () => this._update());
    }

    onShow() {
        super.onShow();
        this.services.sysmon.acquireFps();
        this._fpsAcquired = true;
        this.services.sysmon.readDisk('/');
        this._update();
        this._updateProcs();
        this._procLoop = this.timers.interval(3000, () => {
            this._updateProcs();
            return true;
        });
    }

    onHide() {
        super.onHide();
        if (this._fpsAcquired) {
            this.services.sysmon.releaseFps();
            this._fpsAcquired = false;
        }
        if (this._procLoop)
            this._procLoop = this.timers.clear(this._procLoop);
    }

    _update() {
        if (!this.visible)
            return;
        const s = this.services.sysmon;
        const t = this.theme;
        const R = this._rings;
        R.cpu.r.value = s.cpu;
        R.cpu.v.text = `${Math.round(s.cpu * 100)}%`;
        R.cpu.sub.text = `LA ${s.load[0].toFixed(2)}`;
        R.ram.r.value = s.mem.percent;
        R.ram.v.text = `${Math.round(s.mem.percent * 100)}%`;
        R.ram.sub.text = `${formatBytes(s.mem.used)} / ${formatBytes(s.mem.total)}`;
        R.temp.box.visible = s.temp !== null;
        if (s.temp !== null) {
            R.temp.r.value = Math.min(1, s.temp / 100);
            R.temp.r.setColor(s.temp > 85 ? t.danger : s.temp > 70 ? '#ff9f0a' : '#30d158');
            R.temp.v.text = `${Math.round(s.temp)}°`;
            R.temp.sub.text = s.temp > 85 ? 'горячо!' : 'норма';
        }
        if (s.disk) {
            R.disk.r.value = s.disk.percent;
            R.disk.v.text = `${Math.round(s.disk.percent * 100)}%`;
            R.disk.sub.text = `свободно ${formatBytes(s.disk.free)}`;
        }
        R.bat.box.visible = !!s.battery;
        if (s.battery) {
            R.bat.r.value = s.battery.percent / 100;
            R.bat.v.text = `${s.battery.percent}%`;
            R.bat.sub.text = s.battery.charging ? '⚡ заряжается' : s.battery.status === 'Discharging' ? 'от батареи' : s.battery.status;
        }

        this._cpuGraph.g.setData([{data: s.history.cpu, color: t.accent}], 100);
        this._cpuGraph.val.text = `${Math.round(s.cpu * 100)}%`;
        this._netGraph.g.setData([
            {data: s.history.rx, color: '#30d158'},
            {data: s.history.tx, color: '#ff9f0a'},
        ], null);
        this._netGraph.val.text = `↓${formatSpeed(s.net.rx)} ↑${formatSpeed(s.net.tx)}`;
        this._fpsGraph.g.setData([{data: s.history.fps, color: '#64d2ff'}], null);
        this._fpsGraph.val.text = `${s.fps}`;

        // Ядра
        if (this._cores.get_n_children() !== s.cores.length) {
            this._cores.destroy_all_children();
            this._coreBars = s.cores.map(() => {
                const bar = new VBar(t.accent);
                this._cores.add_child(bar);
                return bar;
            });
        }
        s.cores.forEach((v, i) => {
            const bar = this._coreBars[i];
            bar.value = v;
            bar.setColor(v > 0.85 ? t.danger : v > 0.6 ? '#ff9f0a' : t.accent);
        });
        this._info.text = `${s.cores.length} потоков · аптайм ${formatUptime(s.uptime)}${s.mem.swapTotal ? ` · swap ${formatBytes(s.mem.swapUsed)}` : ''}`;
    }

    async _updateProcs() {
        const list = await this.services.sysmon.topProcesses(6);
        if (!this.visible)
            return;
        const t = this.theme;
        this._procs.destroy_all_children();
        for (const p of list) {
            const row = W.hbox({x_expand: true, style_class: 'di-proc-row'});
            W.add(row,
                W.label(p.name, {cls: 'di-small', expand: true}),
                W.label(`${p.cpu.toFixed(1)}%`, {cls: 'di-small di-mono', style: `color: ${p.cpu > 50 ? t.danger : t.dim}; min-width: 52px; text-align: right;`}),
                W.label(`${p.mem.toFixed(1)}%`, {cls: 'di-small di-mono', style: `color: ${t.faint}; min-width: 46px; text-align: right;`}));
            const kill = W.iconButton('process-stop-symbolic', () => {
                if (this._confirmKill === p.pid) {
                    try {
                        GLib.spawn_command_line_async(`kill ${p.pid}`);
                        this.toast(`Процесс ${p.name} завершён`, {icon: 'process-stop-symbolic', duration: 1500});
                    } catch (e) {
                        this.toast('Не удалось завершить', {subtitle: e.message, icon: 'dialog-warning-symbolic'});
                    }
                    this._confirmKill = null;
                } else {
                    this._confirmKill = p.pid;
                    this.toast(`Нажмите ещё раз, чтобы завершить ${p.name}`, {icon: 'dialog-warning-symbolic', duration: 2000});
                }
            }, {cls: 'di-flat di-mini'});
            row.add_child(kill);
            this._procs.add_child(row);
        }
    }

    destroy() {
        this.onHide();
        super.destroy();
    }
}
