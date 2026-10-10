// Системные переключатели: громкость, микрофон, яркость, тёмная тема, ночной свет,
// «Не беспокоить», раскладка, питание. Нужны, т. к. стандартная панель скрыта.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';

import {Emitter} from '../utils.js';

const BRIGHTNESS_IFACE = `
<node>
  <interface name="org.gnome.SettingsDaemon.Power.Screen">
    <property name="Brightness" type="i" access="readwrite"/>
  </interface>
</node>`;
const BrightnessProxy = Gio.DBusProxy.makeProxyWrapper(BRIGHTNESS_IFACE);

function trySettings(schema) {
    const src = Gio.SettingsSchemaSource.get_default();
    if (!src.lookup(schema, true))
        return null;
    return new Gio.Settings({schema_id: schema});
}

export class ControlsService extends Emitter {
    constructor() {
        super();
        this._iface = trySettings('org.gnome.desktop.interface');
        this._notif = trySettings('org.gnome.desktop.notifications');
        this._color = trySettings('org.gnome.settings-daemon.plugins.color');

        for (const s of [this._iface, this._notif, this._color])
            s?.connectObject('changed', () => this.emit('changed'), this);
        try {
            Keyboard.getInputSourceManager().connectObject('current-source-changed', () => this.emit('changed'), this);
        } catch {}

        // Громкость
        try {
            this._mixer = Volume.getMixerControl();
            this._mixer.connectObject(
                'default-sink-changed', () => this._watchStreams(),
                'default-source-changed', () => this._watchStreams(),
                'state-changed', () => this._watchStreams(),
                this);
            this._watchStreams();
        } catch (e) {
            console.error(`[dynamic-island] mixer: ${e.message}`);
        }

        // Яркость: в GNOME 49+ — встроенный менеджер яркости оболочки
        Main.brightnessManager?.connectObject('changed', () => this.emit('changed'), this);
        // Яркость (gsd-power; в старых версиях GNOME)
        this._brightness = null;
        try {
            new BrightnessProxy(Gio.DBus.session, 'org.gnome.SettingsDaemon.Power',
                '/org/gnome/SettingsDaemon/Power', (proxy, error) => {
                    if (error || this._destroyed)
                        return;
                    this._brightness = proxy;
                    proxy.connectObject('g-properties-changed', () => this.emit('changed'), this);
                    this.emit('changed');
                });
        } catch {}
    }

    _watchStreams() {
        this._sink?.disconnectObject(this);
        this._source?.disconnectObject(this);
        this._sink = this._mixer.get_default_sink();
        this._source = this._mixer.get_default_source();
        this._sink?.connectObject('notify::volume', () => this.emit('changed'),
            'notify::is-muted', () => this.emit('changed'), this);
        this._source?.connectObject('notify::is-muted', () => this.emit('changed'), this);
        this.emit('changed');
    }

    // ---------------------------------------------------------------- звук

    get hasVolume() {
        return !!this._sink;
    }

    get volume() {
        if (!this._sink)
            return 0;
        return this._sink.is_muted ? 0 : this._sink.volume / this._mixer.get_vol_max_norm();
    }

    set volume(v) {
        if (!this._sink)
            return;
        const value = Math.max(0, Math.min(1, v));
        this._sink.volume = value * this._mixer.get_vol_max_norm();
        if (this._sink.is_muted && value > 0)
            this._sink.change_is_muted(false);
        this._sink.push_volume();
    }

    get muted() {
        return !!this._sink?.is_muted;
    }

    toggleMute() {
        this._sink?.change_is_muted(!this._sink.is_muted);
    }

    get micMuted() {
        return !!this._source?.is_muted;
    }

    toggleMic() {
        this._source?.change_is_muted(!this._source.is_muted);
    }

    get volumeIcon() {
        const v = this.volume;
        if (this.muted || v <= 0)
            return 'audio-volume-muted-symbolic';
        if (v < 0.33)
            return 'audio-volume-low-symbolic';
        if (v < 0.66)
            return 'audio-volume-medium-symbolic';
        return 'audio-volume-high-symbolic';
    }

    // ---------------------------------------------------------------- яркость

    get hasBrightness() {
        if (Main.brightnessManager?.globalScale)
            return true;
        const b = this._brightness?.Brightness;
        return Number.isInteger(b) && b >= 0;
    }

    get brightness() {
        const scale = Main.brightnessManager?.globalScale;
        if (scale)
            return scale.value;
        return (this._brightness?.Brightness ?? 0) / 100;
    }

    set brightness(v) {
        const value = Math.max(0.01, Math.min(1, v));
        const scale = Main.brightnessManager?.globalScale;
        if (scale) {
            scale.value = value;
            return;
        }
        if (this._brightness)
            this._brightness.Brightness = Math.round(value * 100);
    }

    // ---------------------------------------------------------------- переключатели

    get darkMode() {
        return this._iface?.get_string('color-scheme') === 'prefer-dark';
    }

    set darkMode(on) {
        this._iface?.set_string('color-scheme', on ? 'prefer-dark' : 'default');
    }

    get nightLight() {
        return !!this._color?.get_boolean('night-light-enabled');
    }

    set nightLight(on) {
        this._color?.set_boolean('night-light-enabled', on);
    }

    get dnd() {
        return this._notif ? !this._notif.get_boolean('show-banners') : false;
    }

    set dnd(on) {
        this._notif?.set_boolean('show-banners', !on);
    }

    // ---------------------------------------------------------------- раскладка

    get inputSource() {
        try {
            const cur = Keyboard.getInputSourceManager().currentSource;
            if (cur)
                return cur.shortName;
        } catch {}
        return null;
    }

    nextInputSource() {
        try {
            const mgr = Keyboard.getInputSourceManager();
            const sources = mgr.inputSources;
            const keys = Object.keys(sources).map(Number).sort((a, b) => a - b);
            if (!keys.length)
                return;
            const cur = mgr.currentSource?.index ?? 0;
            const next = sources[keys[(keys.indexOf(cur) + 1) % keys.length]];
            next.activate(true);
        } catch (e) {
            console.error(`[dynamic-island] input source: ${e.message}`);
        }
    }

    // ---------------------------------------------------------------- питание

    async _systemActions() {
        const mod = await import('resource:///org/gnome/shell/misc/systemActions.js');
        return mod.getDefault();
    }

    async power(action) {
        const sa = await this._systemActions();
        const map = {
            lock: 'activateLockScreen',
            suspend: 'activateSuspend',
            logout: 'activateLogout',
            restart: 'activateRestart',
            poweroff: 'activatePowerOff',
        };
        const fn = map[action];
        if (fn && sa[fn])
            sa[fn]();
    }

    /** Открыть «Настройки» GNOME. */
    openSettings(panel = '') {
        const argv = ['gnome-control-center'];
        if (panel)
            argv.push(panel);
        try {
            GLib.spawn_async(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
        } catch (e) {
            console.error(`[dynamic-island] control center: ${e.message}`);
        }
    }

    destroy() {
        this._destroyed = true;
        for (const s of [this._iface, this._notif, this._color])
            s?.disconnectObject(this);
        this._mixer?.disconnectObject(this);
        this._sink?.disconnectObject(this);
        this._source?.disconnectObject(this);
        this._brightness?.disconnectObject(this);
        Main.brightnessManager?.disconnectObject(this);
        try {
            Keyboard.getInputSourceManager().disconnectObject(this);
        } catch {}
        this.disconnectAll();
    }
}
