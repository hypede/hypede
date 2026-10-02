// Рабочий стол: значки и живые обои из видео или GIF.
//
// Их рисует отдельная программа hypede-desktop (GTK 4): так файлы можно
// перетаскивать между рабочим столом и любыми приложениями. Оболочка
// запускает её как своего клиента Wayland, узнаёт её окна, закрепляет их на
// всех рабочих местах, прячет из списков окон и переносит в отдельный слой
// под всеми окнами (над обоями). Видео ставится на паузу, когда рабочий
// стол закрыт развёрнутыми окнами.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {CoverWatcher} from './cover.js';

const PROGRAM = 'hypede-desktop';
const BUS_NAME = 'dev.hypede.Desktop';
const BUS_PATH = '/dev/hypede/Desktop';

export class Desktop {
    constructor(settings) {
        this._settings = settings;
        this._windows = new Set();
        this._restarts = [];

        // Свой слой: Mutter держит группы обоев (Meta.BackgroundGroup) под
        // окнами, поэтому всё, что в этом слое, всегда ниже любого окна.
        this._layer = new Meta.BackgroundGroup({name: 'hypede-desktop-layer'});
        global.window_group.add_child(this._layer);
        global.window_group.set_child_above_sibling(this._layer, Main.layoutManager._backgroundGroup);
        // Меню и диалоги рабочего стола: иначе Mutter поставил бы их сразу
        // над «родителем», то есть под всеми окнами. Обычный контейнер в
        // window_group Mutter оставляет над окнами.
        this._popups = new Clutter.Actor({name: 'hypede-desktop-popups'});
        global.window_group.add_child(this._popups);

        this._settings.connectObject(
            'changed::desktop-icons', () => this._sync(),
            'changed::wallpaper-live', () => this._sync(),
            this);
        global.display.connectObject(
            'window-created', (_d, win) => this._maybeAdopt(win),
            'workareas-changed', () => this._placeAll(),
            this);
        Main.layoutManager.connectObject('monitors-changed', () => this._placeAll(), this);
        this._cover = new CoverWatcher(covered => this._setPaused(covered.length > 0 && covered.every(c => c)));
        this._sync();
    }

    get _wanted() {
        if (!GLib.find_program_in_path(PROGRAM))
            return false;
        return this._settings.get_boolean('desktop-icons') ||
            this._settings.get_string('wallpaper-live').startsWith('file://');
    }

    _sync() {
        if (this._wanted)
            this._start();
        else
            this._stop();
    }

    _start() {
        if (this._client)
            return;
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
        let client;
        try {
            client = Meta.WaylandClient.new_subprocess(global.context, launcher, [PROGRAM]);
        } catch (e) {
            logError(e, 'HypeDE: не удалось запустить рабочий стол');
            return;
        }
        this._client = client;
        client.get_subprocess().wait_async(null, () => {
            if (this._client !== client)
                return;
            this._client = null;
            this._windows.clear();
            // Упал — перезапустить, но не чаще 5 раз в минуту.
            const now = GLib.get_monotonic_time();
            this._restarts = this._restarts.filter(t => now - t < 60e6);
            if (this._restarts.length < 5 && this._wanted) {
                this._restarts.push(now);
                this._restartId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                    this._restartId = 0;
                    this._sync();
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
    }

    _stop() {
        const client = this._client;
        this._client = null;
        this._windows.clear();
        client?.get_subprocess()?.force_exit();
    }

    _maybeAdopt(win) {
        if (!this._client?.owns_window(win))
            return;
        const adopt = () => {
            if (this._windows.has(win) || !win.get_compositor_private())
                return;
            if (!/^hypede-desktop-\d+$/.test(win.get_title() ?? '')) {
                // Всплывающее меню, поле переименования или диалог.
                const popup = win.get_compositor_private();
                popup.get_parent()?.remove_child(popup);
                this._popups.add_child(popup);
                global.window_group.set_child_above_sibling(this._popups, null);
                return;
            }
            this._windows.add(win);
            win.stick();
            win.hide_from_window_list();
            const actor = win.get_compositor_private();
            actor.get_parent()?.remove_child(actor);
            this._layer.add_child(actor);
            win.connectObject(
                'notify::title', () => this._place(win),
                'unmanaged', () => this._windows.delete(win),
                this);
            this._place(win);
        };
        if (win.get_compositor_private())
            adopt();
        win.connectObject('shown', adopt, this);
    }

    _place(win) {
        const m = /^hypede-desktop-(\d+)$/.exec(win.get_title() ?? '');
        if (!m)
            return;
        // Окно 0 (со значками) — на основной монитор, остальные — по порядку.
        const layout = Main.layoutManager;
        const order = [layout.primaryIndex,
            ...layout.monitors.map((_mon, i) => i).filter(i => i !== layout.primaryIndex)];
        const index = order[Number(m[1])];
        if (index === undefined)
            return;
        const area = layout.getWorkAreaForMonitor(index);
        win.move_resize_frame(false, area.x, area.y, area.width, area.height);
    }

    _placeAll() {
        for (const win of this._windows)
            this._place(win);
    }

    _setPaused(paused) {
        if (!this._client)
            return;
        Gio.DBus.session.call(BUS_NAME, BUS_PATH, 'org.gtk.Actions', 'Activate',
            new GLib.Variant('(sava{sv})', ['pause', [new GLib.Variant('b', paused)], {}]),
            null, Gio.DBusCallFlags.NO_AUTO_START, -1, null, null);
    }

    destroy() {
        if (this._restartId)
            GLib.source_remove(this._restartId);
        this._cover.destroy();
        this._settings.disconnectObject(this);
        global.display.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        for (const win of this._windows)
            win.disconnectObject(this);
        this._stop();
        this._layer.destroy();
        this._popups.destroy();
    }
}
