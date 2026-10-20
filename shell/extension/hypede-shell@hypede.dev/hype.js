// Фичи из других рабочих столов:
//
// * выпадающий терминал по F12 — как Yakuake (KDE), Guake и «scratchpad»
//   в Hyprland: съезжает сверху, тем же сочетанием прячется;
// * «встряхни мышь — найди курсор» — как в KDE Plasma 6: если быстро
//   поводить мышью туда-сюда, курсор на миг становится большим;
// * уведомление об обновлениях — как у Chrome OS: система сама проверяет
//   обновления (checkupdates из pacman-contrib) и предлагает их поставить.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

const DROPDOWN_CLASS = 'dev.hypede.Terminal.Dropdown';
const DROPDOWN_HEIGHT = 0.45;
const SLIDE_MS = 220;

// Встряхивание: столько смен направления за SHAKE_WINDOW мс, каждый рывок
// не короче SHAKE_DISTANCE пикселей.
const SHAKE_TURNS = 4;
const SHAKE_WINDOW = 900;
const SHAKE_DISTANCE = 60;
const SHAKE_SIZE = 96;

const UPDATE_FIRST_CHECK = 10 * 60;
const UPDATE_INTERVAL = 6 * 60 * 60;

export class HypeFeatures {
    constructor(settings) {
        this._settings = settings;
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

        Main.wm.addKeybinding('dropdown-terminal', settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this._toggleDropdown());
        global.display.connectObject('window-created', (_d, win) => this._maybeDropdown(win), this);

        settings.connectObject('changed::shake-to-find', () => this._syncShake(), this);
        this._syncShake();

        settings.connectObject('changed::update-check', () => this._syncUpdates(), this);
        this._syncUpdates();
    }

    // --- выпадающий терминал ------------------------------------------------

    _dropdown() {
        return global.get_window_actors().map(a => a.meta_window)
            .find(w => w?.get_wm_class() === DROPDOWN_CLASS) ?? null;
    }

    _toggleDropdown() {
        const win = this._dropdown();
        if (!win) {
            this._launching = true;
            try {
                Gio.Subprocess.new(['hypede-terminal', '--dropdown'], Gio.SubprocessFlags.NONE);
            } catch (e) {
                this._launching = false;
                Main.notifyError(_('Could not open the terminal'), e.message);
            }
            return;
        }
        if (win.minimized || !win.has_focus())
            this._showDropdown(win);
        else
            this._hideDropdown(win);
    }

    _maybeDropdown(win) {
        if (win.get_wm_class() !== DROPDOWN_CLASS) {
            // wm_class приходит не сразу — ждём его у нового окна.
            if (this._launching)
                win.connectObject('notify::wm-class', () => this._maybeDropdown(win), this);
            return;
        }
        this._launching = false;
        win.disconnectObject(this);
        const actor = win.get_compositor_private();
        // Не внутри first-frame: менять окно посреди отрисовки кадра Mutter
        // не разрешает (assert в compositor.c) — только после него.
        actor?.connectObject('first-frame', () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._showDropdown(win);
                return GLib.SOURCE_REMOVE;
            });
        }, this);
        win.connectObject('unmanaged', () => win.disconnectObject(this), this);
    }

    _place(win) {
        const monitor = global.display.get_current_monitor();
        const area = Main.layoutManager.getWorkAreaForMonitor(monitor);
        const width = Math.round(area.width * 0.9);
        const height = Math.round(area.height * DROPDOWN_HEIGHT);
        win.stick();
        win.make_above();
        win.move_to_monitor(monitor);
        win.move_resize_frame(false, area.x + Math.round((area.width - width) / 2), area.y, width, height);
    }

    _showDropdown(win) {
        if (win.minimized)
            win.unminimize();
        this._place(win);
        win.activate(global.get_current_time());
        const actor = win.get_compositor_private();
        if (!actor)
            return;
        actor.remove_all_transitions();
        actor.translation_y = -actor.height;
        actor.ease({translation_y: 0, duration: SLIDE_MS, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
    }

    _hideDropdown(win) {
        const actor = win.get_compositor_private();
        if (!actor) {
            win.minimize();
            return;
        }
        actor.remove_all_transitions();
        actor.ease({
            translation_y: -actor.height,
            duration: SLIDE_MS,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onStopped: () => {
                win.minimize();
                actor.translation_y = 0;
            },
        });
    }

    // --- встряхни, чтобы найти курсор --------------------------------------

    _syncShake() {
        const on = this._settings.get_boolean('shake-to-find');
        if (on && !this._shakeId) {
            this._turns = [];
            this._last = null;
            this._shakeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 30, () => {
                this._sampleShake();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!on && this._shakeId) {
            GLib.source_remove(this._shakeId);
            this._shakeId = 0;
            this._restoreCursor();
        }
    }

    _sampleShake() {
        const [x] = global.get_pointer();
        const now = GLib.get_monotonic_time() / 1000;
        const last = this._last;
        this._last = {x, dir: last?.dir ?? 0, travel: last?.travel ?? 0};
        const dx = last ? x - last.x : 0;
        if (dx === 0)
            return;
        const dir = Math.sign(dx);
        if (dir !== this._last.dir) {
            // Поворот засчитывается, если до него был заметный рывок.
            if (this._last.travel >= SHAKE_DISTANCE)
                this._turns.push(now);
            this._last.dir = dir;
            this._last.travel = 0;
        }
        this._last.travel += Math.abs(dx);
        this._turns = this._turns.filter(t => now - t < SHAKE_WINDOW);
        if (this._turns.length >= SHAKE_TURNS)
            this._growCursor();
    }

    _growCursor() {
        this._turns = [];
        if (this._savedSize === undefined) {
            this._savedSize = this._interface.get_int('cursor-size');
            this._interface.set_int('cursor-size', Math.max(SHAKE_SIZE, this._savedSize * 2));
        }
        if (this._restoreId)
            GLib.source_remove(this._restoreId);
        this._restoreId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
            this._restoreId = 0;
            this._restoreCursor();
            return GLib.SOURCE_REMOVE;
        });
    }

    _restoreCursor() {
        if (this._restoreId) {
            GLib.source_remove(this._restoreId);
            this._restoreId = 0;
        }
        if (this._savedSize !== undefined) {
            this._interface.set_int('cursor-size', this._savedSize);
            this._savedSize = undefined;
        }
    }

    // --- обновления --------------------------------------------------------

    _syncUpdates() {
        const on = this._settings.get_boolean('update-check') && GLib.find_program_in_path('checkupdates');
        if (on && !this._updateId) {
            this._updateId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, UPDATE_FIRST_CHECK, () => {
                this._checkUpdates();
                this._updateId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, UPDATE_INTERVAL, () => {
                    this._checkUpdates();
                    return GLib.SOURCE_CONTINUE;
                });
                return GLib.SOURCE_REMOVE;
            });
        } else if (!on && this._updateId) {
            GLib.source_remove(this._updateId);
            this._updateId = 0;
        }
    }

    _checkUpdates() {
        let process;
        try {
            process = Gio.Subprocess.new(['checkupdates'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch {
            return;
        }
        process.communicate_utf8_async(null, null, (proc, result) => {
            let out = '';
            try {
                [, out] = proc.communicate_utf8_finish(result);
            } catch {
                return;
            }
            const packages = (out ?? '').split('\n').filter(line => line.trim());
            // Тот же набор обновлений второй раз не показываем.
            const key = packages.join('|');
            if (!packages.length || key === this._notified)
                return;
            this._notified = key;
            this._notifyUpdates(packages);
        });
    }

    _notifyUpdates(packages) {
        const source = MessageTray.getSystemSource();
        const notification = new MessageTray.Notification({
            source,
            title: _('Updates are available'),
            body: ngettext('%d package can be updated', '%d packages can be updated', packages.length)
                .format(packages.length),
            iconName: 'software-update-available-symbolic',
        });
        notification.addAction(_('Update'), () => {
            const script = 'sudo pacman -Syu; echo; read -r -p "$0"';
            try {
                Gio.Subprocess.new(['hypede-terminal', '-e', 'sh', '-c', script, _('Press Enter to close')],
                    Gio.SubprocessFlags.NONE);
            } catch (e) {
                Main.notifyError(_('Could not open the terminal'), e.message);
            }
        });
        notification.addAction(_('Later'), () => {});
        source.addNotification(notification);
    }

    destroy() {
        Main.wm.removeKeybinding('dropdown-terminal');
        global.display.disconnectObject(this);
        this._settings.disconnectObject(this);
        for (const actor of global.get_window_actors())
            actor.meta_window?.disconnectObject(this);
        if (this._shakeId)
            GLib.source_remove(this._shakeId);
        this._shakeId = 0;
        this._restoreCursor();
        if (this._updateId)
            GLib.source_remove(this._updateId);
        this._updateId = 0;
    }
}
