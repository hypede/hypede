// «Живая активность»: короткое событие в слегка расширенном острове.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {Emitter, Timers} from '../utils.js';
import * as W from './widgets.js';

export class ActivityView extends Emitter {
    constructor(ctx) {
        super();
        this.ctx = ctx;
        this._timers = new Timers();
        const t = ctx.theme;

        this.actor = new St.Widget({
            style_class: 'di-activity',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            track_hover: true,
        });
        this._box = W.hbox({style_class: 'di-activity-box', x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.actor.add_child(this._box);

        this._iconBin = new St.Bin({style_class: 'di-activity-icon', y_align: Clutter.ActorAlign.CENTER});
        this._texts = W.vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'di-activity-texts'});
        this._title = W.label('', {cls: 'di-activity-title'});
        this._subtitle = W.label('', {cls: 'di-activity-subtitle', style: `color: ${t.dim};`});
        this._progress = new W.ProgressBar({height: 4, color: t.accent});
        W.add(this._texts, this._title, this._subtitle, this._progress);
        this._actions = W.hbox({style_class: 'di-activity-actions', y_align: Clutter.ActorAlign.CENTER});
        W.add(this._box, this._iconBin, this._texts, this._actions);

        this.actor.connect('button-release-event', (a, e) => {
            if (e.get_button() === 1)
                this.emit('clicked');
            return Clutter.EVENT_STOP;
        });
    }

    /** Естественная ширина. */
    measure() {
        const [, w] = this._box.get_preferred_width(-1);
        return w;
    }

    /**
     * @param {object} a  см. Island.showActivity
     */
    show(a) {
        const t = this.ctx.theme;
        this._iconBin.set_child(null);
        let iconActor;
        if (a.image) {
            iconActor = W.image(a.image, 40, 40, 10);
        } else if (a.emoji) {
            iconActor = W.label(a.emoji, {cls: 'di-activity-emoji'});
        } else if (a.icon) {
            iconActor = W.icon(a.icon instanceof Gio.Icon ? a.icon : a.icon, 24, `color: ${a.accent ?? t.accent};`);
        }
        if (iconActor) {
            this._iconBin.set_child(iconActor);
            this._iconBin.visible = true;
        } else {
            this._iconBin.visible = false;
        }
        this._title.text = a.title ?? '';
        this._subtitle.text = (a.subtitle ?? '').replace(/\s+/g, ' ');
        this._subtitle.visible = !!a.subtitle;
        this._progress.visible = typeof a.progress === 'number';
        if (this._progress.visible) {
            this._progress.setColor(a.accent ?? t.accent);
            this._progress.value = a.progress;
        }
        this._actions.destroy_all_children();
        for (const act of a.actions ?? []) {
            const b = W.button({
                icon: act.icon,
                label: act.label,
                cls: 'di-activity-btn',
                onClick: () => {
                    act.onClick();
                    this.emit('done');
                },
            });
            this._actions.add_child(b);
        }
        this._timers.destroy();
        this._timers = new Timers();
        const duration = a.duration ?? this.ctx.settings.get_int('activity-duration');
        if (duration > 0) {
            this._timers.timeout(duration, () => {
                // Не закрываем, пока курсор над активностью
                if (this.actor.hover)
                    this._timers.timeout(800, () => this.emit('done'));
                else
                    this.emit('done');
            });
        }
        W.pulse(this._iconBin, 1.12, 160);
    }

    stop() {
        this._timers.destroy();
        this._timers = new Timers();
    }

    destroy() {
        this._timers.destroy();
        this.actor.destroy();
        this.disconnectAll();
    }
}
