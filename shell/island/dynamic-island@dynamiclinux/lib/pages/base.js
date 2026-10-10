// Базовый класс страницы раскрытого острова.

import {Subscriptions, Timers} from '../utils.js';
import * as W from '../ui/widgets.js';

export class BasePage {
    constructor(ctx, opts = {}) {
        this.ctx = ctx;
        this.settings = ctx.settings;
        this.theme = ctx.theme;
        this.services = ctx.services;
        this.subs = new Subscriptions();
        this.timers = new Timers();
        this.visible = false;
        this.actor = W.box(opts.vertical ?? true, {
            style_class: `di-page ${opts.cls ?? ''}`,
            x_expand: true,
            y_expand: true,
        });
        this.actor.connect('destroy', () => {
            this.destroyed = true;
            this.subs.clear();
            this.timers.destroy();
        });
    }

    /** Показать короткое сообщение внутри острова. */
    toast(title, opts = {}) {
        this.ctx.island.showActivity({source: null, title, ...opts});
    }

    /** Скопировать текст в буфер с уведомлением. */
    copy(text, what = 'Скопировано') {
        this.services.clipboard.setText(text);
        this.toast(what, {icon: 'edit-copy-symbolic', subtitle: text.slice(0, 60), duration: 1500});
    }

    onShow() {
        this.visible = true;
    }

    onHide() {
        this.visible = false;
    }

    destroy() {
        this.subs.clear();
        this.timers.destroy();
        this.actor.destroy();
    }
}
