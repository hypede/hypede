// Перехват уведомлений GNOME для показа внутри острова.

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {Emitter} from '../utils.js';

const SIGNALS = ['notification-request-banner', 'notification-show'];

export class NotificationService extends Emitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._sources = new Map();
        this._notifSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this.recent = [];

        const tray = Main.messageTray;
        tray.connectObject('source-added', (t, source) => this._watch(source), this);
        for (const s of tray.getSources?.() ?? [])
            this._watch(s);

        this._settings.connectObject('changed::island-notifications', () => this._syncBlock(), this);
        this._syncBlock();
    }

    get enabled() {
        return this._settings.get_boolean('island-notifications');
    }

    get dnd() {
        return !this._notifSettings.get_boolean('show-banners');
    }

    _syncBlock() {
        const tray = Main.messageTray;
        if (this.enabled && !this._blocked) {
            this._prevBlocked = tray.bannerBlocked;
            tray.bannerBlocked = true;
            this._blocked = true;
        } else if (!this.enabled && this._blocked) {
            tray.bannerBlocked = this._prevBlocked ?? false;
            this._blocked = false;
        }
    }

    _watch(source) {
        if (this._sources.has(source))
            return;
        const ids = [];
        for (const sig of SIGNALS) {
            if (!GObject.signal_lookup(sig, source.constructor.$gtype))
                continue;
            ids.push(source.connect(sig, (s, notification) => this._onNotification(s, notification)));
            break;
        }
        ids.push(source.connect('destroy', () => this._unwatch(source)));
        this._sources.set(source, ids);
    }

    _unwatch(source) {
        const ids = this._sources.get(source);
        if (!ids)
            return;
        for (const id of ids) {
            try {
                source.disconnect(id);
            } catch {}
        }
        this._sources.delete(source);
    }

    _onNotification(source, n) {
        if (!this.enabled)
            return;
        const critical = n.urgency === (MessageTray.Urgency?.CRITICAL ?? 3);
        if (this.dnd && !critical)
            return;
        const item = {
            title: n.title ?? source.title ?? '',
            body: n.body ?? n.bannerBodyText ?? '',
            gicon: n.gicon ?? source.icon ?? null,
            app: source.title ?? '',
            critical,
            time: Date.now(),
            activate: () => {
                try {
                    n.activate();
                } catch (e) {
                    console.error(`[dynamic-island] notification activate: ${e.message}`);
                }
            },
            notification: n,
        };
        this.recent.unshift(item);
        this.recent = this.recent.slice(0, 20);
        this.emit('notification', item);
    }

    /** Переключить «Не беспокоить». */
    setDnd(on) {
        this._notifSettings.set_boolean('show-banners', !on);
    }

    destroy() {
        Main.messageTray.disconnectObject(this);
        this._settings.disconnectObject(this);
        for (const s of [...this._sources.keys()])
            this._unwatch(s);
        if (this._blocked) {
            Main.messageTray.bannerBlocked = this._prevBlocked ?? false;
            this._blocked = false;
        }
        this.disconnectAll();
    }
}
