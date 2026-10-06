// Жесты тачпада четырьмя пальцами, 1:1 — всё идёт за пальцами и
// отменяется движением назад:
//   вверх — лаунчер (или вернуть окна, убранные жестом вниз);
//   вниз  — показать рабочий стол.
// Три пальца остаются за GNOME: вверх — обзор, вбок — рабочие столы.

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {isDesktopWindow} from './util.js';

const FINGERS = 4;
const DISTANCE = 300;
const THRESHOLD = 0.3;
const TIME = 220;

export class Gestures {
    constructor(settings, launcher) {
        this._settings = settings;
        this._launcher = launcher;
        this._hidden = [];
        global.stage.connectObject('captured-event', (a, event) => this._event(event), this);
    }

    _event(event) {
        if (event.type() !== Clutter.EventType.TOUCHPAD_SWIPE ||
            event.get_touchpad_gesture_finger_count() !== FINGERS ||
            !this._settings.get_boolean('touchpad-gestures'))
            return Clutter.EVENT_PROPAGATE;
        const [, dy] = event.get_gesture_motion_delta_unaccelerated();
        const phases = {
            [Clutter.TouchpadGesturePhase.BEGIN]: 'begin',
            [Clutter.TouchpadGesturePhase.UPDATE]: 'update',
            [Clutter.TouchpadGesturePhase.END]: 'end',
            [Clutter.TouchpadGesturePhase.CANCEL]: 'cancel',
        };
        return this.swipe(phases[event.get_gesture_phase()], dy) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
    }

    // dy в пикселях тачпада: меньше нуля — пальцы идут вверх.
    swipe(phase, dy = 0) {
        if (phase === 'begin') {
            this._end(false);
            if (Main.actionMode !== Shell.ActionMode.NORMAL && !this._launcher.isOpen)
                return false;
            this._sum = 0;
            this._kind = null;
            this._active = true;
            return true;
        }
        if (!this._active)
            return false;
        if (phase === 'update') {
            this._sum += dy;
            if (!this._kind && Math.abs(this._sum) > 12)
                this._start(this._sum < 0 ? 'up' : 'down');
            if (this._kind)
                this._update(Math.max(0, (this._up ? -this._sum : this._sum) / DISTANCE));
            return true;
        }
        this._end(phase === 'end' && this._progress > THRESHOLD);
        return true;
    }

    _start(direction) {
        this._up = direction === 'up';
        // Окна, убранные жестом, ещё свёрнуты — жест вверх вернёт их.
        this._hidden = this._hidden.filter(e => e.win.minimized && e.win.get_compositor_private() === e.actor);
        if (direction === 'up' && this._hidden.length) {
            this._kind = 'restore';
            for (const e of [...this._hidden].reverse()) {
                Main.wm.skipNextEffect(e.actor);
                e.win.unminimize();
                e.actor.remove_all_transitions();
                this._place(e, 1);
            }
        } else if (direction === 'up') {
            this._kind = this._launcher.gestureBegin() ? 'launcher' : 'none';
        } else {
            this._kind = this._launcher.isOpen ? 'none' : 'desktop';
            if (this._kind === 'desktop')
                this._collect();
        }
        this._progress = 0;
    }

    _collect() {
        const ws = global.workspace_manager.get_active_workspace();
        this._windows = global.display.get_tab_list(Meta.TabList.NORMAL, ws)
            .filter(w => !w.minimized && !isDesktopWindow(w))
            .map(win => ({win, actor: win.get_compositor_private()}))
            .filter(e => e.actor);
        const monitor = Main.layoutManager.primaryMonitor;
        for (const e of this._windows) {
            e.actor.remove_all_transitions();
            // Каждое окно уходит к ближнему боковому краю и вниз.
            const center = e.actor.x + e.actor.width / 2;
            e.dx = (center < monitor.x + monitor.width / 2 ? -1 : 1) * monitor.width * 0.35;
            e.dy = monitor.height * 0.45;
        }
    }

    _update(p) {
        this._progress = p;
        const t = Math.min(1, p);
        if (this._kind === 'launcher') {
            this._launcher.gestureUpdate(t);
        } else if (this._kind === 'desktop') {
            for (const e of this._windows)
                this._place(e, t);
        } else if (this._kind === 'restore') {
            for (const e of this._hidden)
                this._place(e, 1 - t);
        }
    }

    _place(e, t) {
        e.actor.translation_x = (e.dx ?? 0) * t;
        e.actor.translation_y = (e.dy ?? 0) * t;
        e.actor.opacity = Math.round(255 * (1 - t));
    }

    _ease(e, t, done) {
        e.actor.ease({
            translation_x: (e.dx ?? 0) * t,
            translation_y: (e.dy ?? 0) * t,
            opacity: Math.round(255 * (1 - t)),
            duration: TIME,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onStopped: done,
        });
    }

    _reset(e) {
        e.actor.translation_x = 0;
        e.actor.translation_y = 0;
        e.actor.opacity = 255;
    }

    _end(commit) {
        if (!this._active)
            return;
        this._active = false;
        const kind = this._kind;
        this._kind = null;
        if (kind === 'launcher') {
            this._launcher.gestureEnd(commit);
        } else if (kind === 'desktop') {
            const list = this._windows;
            this._windows = [];
            for (const e of list) {
                this._ease(e, commit ? 1 : 0, () => {
                    if (!commit)
                        return;
                    Main.wm.skipNextEffect(e.actor);
                    e.win.minimize();
                    this._reset(e);
                });
            }
            if (commit)
                this._hidden = list;
        } else if (kind === 'restore') {
            const list = this._hidden;
            if (commit)
                this._hidden = [];
            for (const e of list) {
                this._ease(e, commit ? 0 : 1, () => {
                    if (commit)
                        return;
                    Main.wm.skipNextEffect(e.actor);
                    e.win.minimize();
                    this._reset(e);
                });
            }
            if (commit)
                list[0]?.win.activate(global.get_current_time());
        }
    }

    destroy() {
        this._end(false);
        global.stage.disconnectObject(this);
    }
}
