// Раскрытый остров: вкладки сверху + содержимое страниц.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Emitter, Timers} from '../utils.js';
import * as W from './widgets.js';
import {PAGES} from '../pages/index.js';

const HEADER_HEIGHT = 44;

export class ExpandedView extends Emitter {
    constructor(ctx) {
        super();
        this.ctx = ctx;
        this._timers = new Timers();
        this._pages = new Map();
        this._current = null;

        this.actor = W.vbox({style_class: 'di-expanded', reactive: true});

        // ---------- шапка
        this._header = W.hbox({style_class: 'di-header', height: HEADER_HEIGHT});
        this._tabs = W.hbox({style_class: 'di-tabs', y_align: Clutter.ActorAlign.CENTER});
        this._tabButtons = new Map();
        this._tabIds = ctx.settings.get_strv('enabled-tabs').filter(id => PAGES[id]);
        if (!this._tabIds.length)
            this._tabIds = ['home'];
        for (const id of this._tabIds) {
            const info = PAGES[id];
            const b = W.button({
                icon: info.icon,
                iconSize: 16,
                cls: 'di-tab',
                onClick: () => this.showTab(id),
            });
            b.accessible_name = info.title;
            b.connect('notify::hover', () => {
                if (b.hover)
                    this._showHint(info.title);
                else
                    this._showHint(null);
            });
            this._tabButtons.set(id, b);
            this._tabs.add_child(b);
        }

        this._title = W.label('', {cls: 'di-header-title', expand: true});
        this._toastBox = W.hbox({style_class: 'di-toast', y_align: Clutter.ActorAlign.CENTER});
        this._clock = W.label('', {cls: 'di-header-clock'});
        this._pinBtn = W.iconButton('view-pin-symbolic', () => {
            if (ctx.island.pinned)
                this.emit('request-collapse');
            else
                this.emit('request-pin');
        }, {cls: 'di-header-btn'});
        this._closeBtn = W.iconButton('window-close-symbolic', () => this.emit('request-collapse'), {cls: 'di-header-btn'});
        W.add(this._header, this._tabs, this._title, this._toastBox, this._clock, this._pinBtn, this._closeBtn);
        this._toastBox.visible = false;

        // ---------- содержимое
        this._stack = new St.Widget({
            style_class: 'di-stack',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            clip_to_allocation: true,
        });
        W.add(this.actor, this._header, this._stack);

        this._tick = ctx.tick.on('second', () => this._updateClock());
        this._updateClock();

        const remember = ctx.settings.get_boolean('remember-tab');
        const first = remember ? ctx.settings.get_string('last-tab') : ctx.settings.get_string('default-tab');
        this._initialTab = this._tabIds.includes(first) ? first : this._tabIds[0];
    }

    setSize(w, h) {
        this.actor.set_size(w, h);
    }

    _updateClock() {
        if (!this.actor.visible)
            return;
        const text = GLib.DateTime.new_now_local().format('%H:%M') ?? '';
        if (this._clock.text !== text)
            this._clock.text = text;
    }

    _showHint(text) {
        const info = this._current ? PAGES[this._current] : null;
        this._title.text = text ?? info?.title ?? '';
        this._title.opacity = text ? 200 : 255;
    }

    _getPage(id) {
        let page = this._pages.get(id);
        if (!page) {
            try {
                page = new PAGES[id].Page(this.ctx);
            } catch (e) {
                logError(e, `[dynamic-island] страница ${id}`);
                page = {actor: W.label(`Ошибка страницы: ${e.message}`, {wrap: true}), onShow() {}, onHide() {}, destroy() {}};
            }
            page.actor.x_expand = true;
            page.actor.y_expand = true;
            this._stack.add_child(page.actor);
            page.actor.visible = false;
            this._pages.set(id, page);
        }
        return page;
    }

    /**
     * Показать вкладку.
     *
     * @param {string} id
     * @param {boolean} [animate]
     */
    showTab(id, animate = true) {
        if (!this._tabIds.includes(id))
            id = this._tabIds[0];
        if (this._current === id) {
            if (this.actor.visible)
                this._getPage(id).onShow?.();
            return;
        }
        const prevId = this._current;
        const prev = prevId ? this._pages.get(prevId) : null;
        const page = this._getPage(id);
        this._current = id;
        this.ctx.settings.set_string('last-tab', id);

        for (const [tid, b] of this._tabButtons) {
            if (tid === id)
                b.add_style_pseudo_class('checked');
            else
                b.remove_style_pseudo_class('checked');
            W.setAccent(b, this.ctx.theme, tid === id);
        }
        this._showHint(null);

        const t = this.ctx.theme;
        const style = t.tabTransition;
        const d = animate && this.actor.visible ? Math.round(t.dur(0.6)) : 0;
        const dir = prevId && this._tabIds.indexOf(id) < this._tabIds.indexOf(prevId) ? -1 : 1;

        if (prev) {
            prev.onHide?.();
            prev.actor.remove_all_transitions();
            if (d > 0 && style !== 'none') {
                const props = {opacity: 0, duration: Math.round(d * 0.6), mode: Clutter.AnimationMode.EASE_OUT_QUAD};
                if (style === 'slide')
                    props.translation_x = -40 * dir;
                if (style === 'zoom') {
                    prev.actor.set_pivot_point(0.5, 0.5);
                    props.scale_x = props.scale_y = 0.94;
                }
                prev.actor.ease({
                    ...props,
                    onComplete: () => {
                        prev.actor.visible = false;
                        prev.actor.translation_x = 0;
                        prev.actor.scale_x = prev.actor.scale_y = 1;
                    },
                });
            } else {
                prev.actor.visible = false;
            }
        }

        page.actor.remove_all_transitions();
        page.actor.visible = true;
        if (d > 0 && style !== 'none') {
            page.actor.opacity = 0;
            if (style === 'slide')
                page.actor.translation_x = 40 * dir;
            if (style === 'zoom') {
                page.actor.set_pivot_point(0.5, 0.5);
                page.actor.scale_x = page.actor.scale_y = 1.05;
            }
            page.actor.ease({
                opacity: 255,
                translation_x: 0,
                scale_x: 1,
                scale_y: 1,
                duration: d,
                mode: t.mode === Clutter.AnimationMode.EASE_OUT_BOUNCE ? Clutter.AnimationMode.EASE_OUT_CUBIC : t.mode,
            });
        } else {
            page.actor.opacity = 255;
            page.actor.translation_x = 0;
            page.actor.scale_x = page.actor.scale_y = 1;
        }
        if (this.actor.visible)
            page.onShow?.();
    }

    /** Страница по id (создаётся при необходимости), null — если вкладка выключена. */
    getPage(id) {
        return this._tabIds.includes(id) ? this._getPage(id) : null;
    }

    hasTab(id) {
        return this._tabIds.includes(id);
    }

    showTabIndex(i) {
        if (i >= 0 && i < this._tabIds.length)
            this.showTab(this._tabIds[i]);
    }

    cycleTab(delta) {
        const i = this._tabIds.indexOf(this._current);
        const n = this._tabIds.length;
        this.showTab(this._tabIds[(i + delta + n) % n]);
    }

    get currentPage() {
        return this._current ? this._pages.get(this._current) : null;
    }

    focusCurrent() {
        this.currentPage?.focus?.();
    }

    /** Escape: сначала спрашиваем страницу (например, закрыть подменю). */
    handleEscape() {
        return !!this.currentPage?.handleEscape?.();
    }

    onShow() {
        if (!this._current)
            this.showTab(this._initialTab, false);
        else
            this.currentPage?.onShow?.();
        this._updateClock();
    }

    onHide() {
        this.currentPage?.onHide?.();
    }

    setPinned(pinned) {
        W.setAccent(this._pinBtn, this.ctx.theme, pinned);
    }

    /** Короткое уведомление в шапке, когда остров раскрыт. */
    toast(a) {
        this._toastBox.destroy_all_children();
        if (a.emoji)
            this._toastBox.add_child(W.label(a.emoji));
        else if (a.icon)
            this._toastBox.add_child(W.icon(a.icon, 14));
        this._toastBox.add_child(W.label([a.title, a.subtitle].filter(Boolean).join(' · ').slice(0, 70), {cls: 'di-toast-text'}));
        this._toastBox.visible = true;
        this._title.visible = false;
        W.fadeIn(this._toastBox, 200);
        if (this._toastId)
            this._timers.clear(this._toastId);
        this._toastId = this._timers.timeout(a.duration ?? 3000, () => {
            this._toastId = 0;
            this._toastBox.ease({
                opacity: 0,
                duration: 250,
                onComplete: () => {
                    this._toastBox.visible = false;
                    this._title.visible = true;
                },
            });
        });
    }

    destroy() {
        this.ctx.tick.off(this._tick);
        for (const p of this._pages.values()) {
            try {
                p.destroy();
            } catch (e) {
                logError(e, '[dynamic-island] destroy page');
            }
        }
        this._pages.clear();
        this._timers.destroy();
        this.actor.destroy();
        this.disconnectAll();
    }
}
