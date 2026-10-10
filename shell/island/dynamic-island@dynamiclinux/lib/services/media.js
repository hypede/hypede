// Музыка и видео: клиент MPRIS (Spotify, браузеры, Rhythmbox, VLC и т. д.).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Emitter, Timers, cacheDir, download} from '../utils.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';

const PLAYER_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Pause"/>
    <method name="PlayPause"/>
    <method name="Stop"/>
    <method name="Play"/>
    <method name="Seek"><arg direction="in" type="x" name="Offset"/></method>
    <method name="SetPosition"><arg direction="in" type="o" name="TrackId"/><arg direction="in" type="x" name="Position"/></method>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="LoopStatus" type="s" access="readwrite"/>
    <property name="Shuffle" type="b" access="readwrite"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Volume" type="d" access="readwrite"/>
    <property name="Position" type="x" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <signal name="Seeked"><arg name="Position" type="x"/></signal>
  </interface>
</node>`;

const ROOT_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="Identity" type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
  </interface>
</node>`;

const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(PLAYER_IFACE);
const RootProxy = Gio.DBusProxy.makeProxyWrapper(ROOT_IFACE);

function unpack(v) {
    if (v instanceof GLib.Variant)
        return v.recursiveUnpack();
    return v;
}

class Player extends Emitter {
    constructor(busName) {
        super();
        this.busName = busName;
        this.lastActive = Date.now();
        this.identity = busName.slice(MPRIS_PREFIX.length).replace(/\.instance.*$/, '');
        this.desktopEntry = '';
        this._ready = false;
        this._artCache = new Map();

        new PlayerProxy(Gio.DBus.session, busName, MPRIS_PATH, (proxy, error) => {
            if (error) {
                console.error(`[dynamic-island] mpris ${busName}: ${error.message}`);
                return;
            }
            if (this._closed)
                return;
            this._proxy = proxy;
            this._propsId = proxy.connect('g-properties-changed', () => this._onChanged());
            this._seekId = proxy.connectSignal('Seeked', () => this.emit('seeked'));
            this._ready = true;
            this._onChanged();
        }, null, Gio.DBusProxyFlags.NONE);

        new RootProxy(Gio.DBus.session, busName, MPRIS_PATH, (proxy, error) => {
            if (error || this._closed)
                return;
            this._root = proxy;
            if (proxy.Identity)
                this.identity = proxy.Identity;
            this.desktopEntry = proxy.DesktopEntry ?? '';
            this.emit('changed');
        });
    }

    get ready() {
        return this._ready;
    }

    get status() {
        return this._proxy?.PlaybackStatus ?? 'Stopped';
    }

    get playing() {
        return this.status === 'Playing';
    }

    get metadata() {
        const md = this._proxy?.Metadata;
        if (!md)
            return {};
        const out = {};
        for (const [k, v] of Object.entries(md))
            out[k] = unpack(v);
        return out;
    }

    get title() {
        return String(this.metadata['xesam:title'] ?? '');
    }

    get artist() {
        const a = this.metadata['xesam:artist'];
        if (Array.isArray(a))
            return a.join(', ');
        return String(a ?? '');
    }

    get album() {
        return String(this.metadata['xesam:album'] ?? '');
    }

    get length() {
        const l = Number(this.metadata['mpris:length'] ?? 0);
        return l / 1e6;
    }

    get trackId() {
        return this.metadata['mpris:trackid'] ?? null;
    }

    get artUrl() {
        return String(this.metadata['mpris:artUrl'] ?? '');
    }

    get canNext() {
        return !!this._proxy?.CanGoNext;
    }

    get canPrevious() {
        return !!this._proxy?.CanGoPrevious;
    }

    get canSeek() {
        return !!this._proxy?.CanSeek;
    }

    get shuffle() {
        return !!this._proxy?.Shuffle;
    }

    get loop() {
        return this._proxy?.LoopStatus ?? 'None';
    }

    get volume() {
        return this._proxy?.Volume ?? null;
    }

    /** Путь к локальной обложке (скачивает http-обложки в кэш). */
    async artPath() {
        const url = this.artUrl;
        if (!url)
            return null;
        if (url.startsWith('file://'))
            return GLib.filename_from_uri(url)[0];
        if (url.startsWith('/'))
            return url;
        if (this._artCache.has(url))
            return this._artCache.get(url);
        if (url.startsWith('http')) {
            const name = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, url, -1);
            const path = GLib.build_filenamev([cacheDir('art'), `${name}.img`]);
            if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
                try {
                    await download(url, path);
                } catch {
                    return null;
                }
            }
            this._artCache.set(url, path);
            return path;
        }
        return null;
    }

    _call(method, args = null) {
        if (!this._proxy)
            return;
        this._proxy.call(method, args, Gio.DBusCallFlags.NONE, -1, null, (p, res) => {
            try {
                p.call_finish(res);
            } catch (e) {
                console.error(`[dynamic-island] mpris ${method}: ${e.message}`);
            }
        });
    }

    playPause() {
        this._call('PlayPause');
    }

    next() {
        this._call('Next');
    }

    previous() {
        this._call('Previous');
    }

    stop() {
        this._call('Stop');
    }

    seekTo(seconds) {
        const id = this.trackId;
        if (!id)
            return;
        this._call('SetPosition', new GLib.Variant('(ox)', [id, Math.round(seconds * 1e6)]));
    }

    seekBy(seconds) {
        this._call('Seek', new GLib.Variant('(x)', [Math.round(seconds * 1e6)]));
    }

    _setProp(name, variant) {
        Gio.DBus.session.call(this.busName, MPRIS_PATH, 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', ['org.mpris.MediaPlayer2.Player', name, variant]),
            null, Gio.DBusCallFlags.NONE, -1, null, (c, res) => {
                try {
                    c.call_finish(res);
                } catch {}
            });
    }

    toggleShuffle() {
        this._setProp('Shuffle', new GLib.Variant('b', !this.shuffle));
    }

    cycleLoop() {
        const next = {None: 'Playlist', Playlist: 'Track', Track: 'None'}[this.loop] ?? 'None';
        this._setProp('LoopStatus', new GLib.Variant('s', next));
    }

    setVolume(v) {
        this._setProp('Volume', new GLib.Variant('d', Math.max(0, Math.min(1, v))));
    }

    raise() {
        this._root?.call('Raise', null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    /** Текущая позиция (свойство Position не кэшируется, читаем напрямую). */
    position() {
        return new Promise(resolve => {
            Gio.DBus.session.call(this.busName, MPRIS_PATH, 'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
                null, Gio.DBusCallFlags.NONE, 1000, null, (c, res) => {
                    try {
                        const [v] = c.call_finish(res).deepUnpack();
                        resolve(Number(v.deepUnpack()) / 1e6);
                    } catch {
                        resolve(null);
                    }
                });
        });
    }

    _onChanged() {
        if (this.playing)
            this.lastActive = Date.now();
        this.emit('changed');
    }

    close() {
        this._closed = true;
        if (this._proxy) {
            if (this._propsId)
                this._proxy.disconnect(this._propsId);
            if (this._seekId)
                this._proxy.disconnectSignal(this._seekId);
        }
        this._proxy = null;
        this._root = null;
        this.disconnectAll();
    }
}

export class MediaService extends Emitter {
    constructor() {
        super();
        this._players = new Map();
        this._timers = new Timers();
        this._lastTrackKey = '';
        this._nameWatchId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => {
                const [name, oldOwner, newOwner] = params.deepUnpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;
                if (newOwner && !oldOwner)
                    this._addPlayer(name);
                else if (oldOwner && !newOwner)
                    this._removePlayer(name);
            });
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, null, Gio.DBusCallFlags.NONE, -1, null, (c, res) => {
                try {
                    const [names] = c.call_finish(res).deepUnpack();
                    for (const n of names) {
                        if (n.startsWith(MPRIS_PREFIX))
                            this._addPlayer(n);
                    }
                } catch (e) {
                    console.error(`[dynamic-island] mpris ListNames: ${e.message}`);
                }
            });
    }

    _addPlayer(name) {
        if (this._players.has(name))
            return;
        const p = new Player(name);
        p.on('changed', () => this._onPlayerChanged(p));
        p.on('seeked', () => this.emit('seeked'));
        this._players.set(name, p);
    }

    _removePlayer(name) {
        const p = this._players.get(name);
        if (!p)
            return;
        p.close();
        this._players.delete(name);
        this.emit('changed');
    }

    _onPlayerChanged(player) {
        // Сообщаем о смене трека (для живой активности)
        if (player === this.current && player.playing) {
            const key = `${player.title}|${player.artist}`;
            if (player.title && key !== this._lastTrackKey) {
                this._lastTrackKey = key;
                this.emit('track-changed', player);
            }
        }
        this.emit('changed');
    }

    /** Все готовые плееры. */
    get players() {
        return [...this._players.values()].filter(p => p.ready && (p.title || p.status !== 'Stopped'));
    }

    /** Активный плеер: играющий, либо последний активный. */
    get current() {
        const list = this.players;
        if (!list.length)
            return null;
        if (this._pinned && list.includes(this._pinned))
            return this._pinned;
        const playing = list.filter(p => p.playing);
        const pool = playing.length ? playing : list;
        return pool.sort((a, b) => b.lastActive - a.lastActive)[0];
    }

    /** Закрепить выбранный плеер (или null — автоматически). */
    pin(player) {
        this._pinned = player;
        this.emit('changed');
    }

    destroy() {
        if (this._nameWatchId)
            Gio.DBus.session.signal_unsubscribe(this._nameWatchId);
        for (const p of this._players.values())
            p.close();
        this._players.clear();
        this._timers.destroy();
        this.disconnectAll();
    }
}
