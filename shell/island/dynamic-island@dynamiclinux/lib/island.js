// Сам «остров»: форма, состояния (свёрнут / живая активность / раскрыт), анимации, наведение.

import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Theme} from './theme.js';
import {Emitter, Timers, addChrome, safe} from './utils.js';
import {CompactView} from './ui/compact.js';
import {ExpandedView} from './ui/expanded.js';
import {ActivityView} from './ui/activity.js';

export const State = {
    COMPACT: 'compact',
    ACTIVITY: 'activity',
    EXPANDED: 'expanded',
};

const ACTIVITY_HEIGHT_EXTRA = 34;

export class Island extends Emitter {
    /**
     * @param {object} ctx  {extension, settings, services}
     */
    constructor(ctx) {
        super();
        this.ctx = ctx;
        this.settings = ctx.settings;
        this.services = ctx.services;
        this.theme = new Theme(this.settings);
        this.ctx.theme = this.theme;
        this.ctx.island = this;
        this._timers = new Timers();
        this.state = State.COMPACT;
        this._grab = null;
        this._activityQueue = [];
        this._currentActivity = null;
        this._radius = this.theme.compactRadius;

        try {
            this._build();
            this._connect();
            this._place(false);
        } catch (e) {
            // Не оставляем на экране недостроенный остров
            this._abort();
            throw e;
        }
    }

    /** Убирает всё, что успело создаться, если сборка острова не удалась. */
    _abort() {
        this._timers.destroy();
        Main.layoutManager.disconnectObject(this);
        Main.overview.disconnectObject(this);
        for (const a of [this._strut, this.actor]) {
            if (!a)
                continue;
            safe(() => Main.layoutManager.removeChrome(a), 'removeChrome');
            safe(() => a.destroy(), 'destroy');
        }
        for (const v of [this.compact, this.activity, this.expanded])
            safe(() => v?.destroy(), 'destroy view');
    }

    // ================================================================ построение

    _build() {
        const t = this.theme;
        this.actor = new St.Widget({
            name: 'dynamicIsland',
            style_class: `di-island ${t.light ? 'di-light' : 'di-dark'}`,
            reactive: true,
            track_hover: true,
            can_focus: true,
            layout_manager: new Clutter.FixedLayout(),
            width: t.compactWidth,
            height: t.compactHeight,
        });
        this.actor.set_pivot_point(0.5, 0.5);
        this.actor.style = t.bubbleStyle(this._radius);
        this.actor._delegate = this;

        if (this.settings.get_boolean('blur'))
            this._addBlur();

        this.compact = new CompactView(this.ctx);
        this.activity = new ActivityView(this.ctx);
        this.expanded = new ExpandedView(this.ctx);

        // Обрезка содержимого — во внутреннем контейнере, чтобы не обрезать тень острова
        this._clip = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            clip_to_allocation: true,
            x: 0,
            y: 0,
        });
        this._clip.add_constraint(new Clutter.BindConstraint({source: this.actor, coordinate: Clutter.BindCoordinate.SIZE}));
        this.actor.add_child(this._clip);
        this._clip.add_child(this.compact.actor);
        this._clip.add_child(this.activity.actor);
        this._clip.add_child(this.expanded.actor);
        // Дочерние виды имеют фиксированный размер и всегда центрированы:
        // при анимации остров «раскрывает» их, а не сжимает.
        this.actor.connect('notify::width', () => this._centerChildren());
        this.activity.actor.visible = false;
        this.activity.actor.opacity = 0;
        this.expanded.actor.visible = false;
        this.expanded.actor.opacity = 0;

        addChrome(Main.layoutManager, this.actor, {
            affectsInputRegion: true,
            trackFullscreen: this.settings.get_boolean('hide-in-fullscreen'),
        });

        // Резерв места сверху (струт), чтобы развёрнутые окна не заезжали под остров
        if (this.settings.get_boolean('reserve-space')) {
            this._strut = new St.Widget({reactive: false, opacity: 0, name: 'dynamicIslandStrut'});
            addChrome(Main.layoutManager, this._strut, {
                affectsStruts: true,
                affectsInputRegion: false,
                trackFullscreen: true,
            });
        }
    }

    _addBlur() {
        safe(() => {
            const effect = new Shell.BlurEffect({mode: Shell.BlurMode.BACKGROUND, brightness: 0.75});
            if (effect.find_property?.('radius') || 'radius' in effect)
                effect.radius = 36;
            else
                effect.sigma = 18;
            this.actor.add_effect_with_name('di-blur', effect);
        }, 'blur');
    }

    _connect() {
        this.actor.connect('notify::hover', () => this._onHover());
        this.actor.connect('button-press-event', (a, e) => this._onPress(e));
        this.actor.connect('touch-event', (a, e) => {
            if (e.type() === Clutter.EventType.TOUCH_BEGIN)
                return this._onPress(e);
            return Clutter.EVENT_PROPAGATE;
        });
        this.actor.connect('captured-event', (a, e) => this._onCapturedEvent(e));
        this.actor.connect('scroll-event', (a, e) => this._onScroll(e));

        Main.layoutManager.connectObject('monitors-changed', () => this._place(false), this);
        globalThis.hypedeIsland?.listen(this, () => this._place(false));
        Main.overview.connectObject(
            'showing', () => this._onOverview(true),
            'hiding', () => this._onOverview(false),
            this);

        this.compact.on('size-changed', () => {
            if (this.state === State.COMPACT)
                this._queueResize();
        });
        this.activity.on('done', () => this._endActivity());
        this.activity.on('clicked', () => {
            const a = this._currentActivity;
            this._endActivity(true);
            if (a?.onClick)
                a.onClick();
            else if (a?.tab)
                this.expand({tab: a.tab, pin: false});
        });
        this.expanded.on('request-collapse', () => this.collapse());
        this.expanded.on('request-pin', () => this._pin());
    }

    // ================================================================ геометрия

    get monitor() {
        return Main.layoutManager.primaryMonitor ?? {x: 0, y: 0, width: global.stage.width, height: global.stage.height};
    }

    _compactSize() {
        const t = this.theme;
        const natW = this.compact.measure();
        const w = Math.max(t.compactWidth, Math.ceil(natW) + 8);
        return [Math.min(w, this.monitor.width - 40), t.compactHeight];
    }

    _activitySize() {
        const t = this.theme;
        const natW = this.activity.measure();
        const w = Math.max(t.compactWidth + 80, Math.min(t.expandedWidth, Math.ceil(natW) + 24));
        return [Math.min(w, this.monitor.width - 40), t.compactHeight + ACTIVITY_HEIGHT_EXTRA];
    }

    _centerChildren() {
        const w = this.actor.width;
        for (const v of [this.compact.actor, this.activity.actor, this.expanded.actor])
            v.x = Math.round((w - v.width) / 2);
    }

    _sizeChildren() {
        const [cw, ch] = this._compactSize();
        this.compact.actor.set_size(cw, ch);
        if (this.state === State.ACTIVITY) {
            const [aw, ah] = this._activitySize();
            this.activity.actor.set_size(aw, ah);
        }
        const [ew, eh] = this._expandedSize();
        this.expanded.setSize(ew, eh);
        this._centerChildren();
    }

    _expandedSize() {
        const t = this.theme;
        return [Math.min(t.expandedWidth, this.monitor.width - 24), Math.min(t.expandedHeight, this.monitor.height - 60)];
    }

    _targetSize() {
        if (this.state === State.EXPANDED)
            return this._expandedSize();
        if (this.state === State.ACTIVITY)
            return this._activitySize();
        return this._compactSize();
    }

    _targetRadius() {
        const t = this.theme;
        if (this.state === State.EXPANDED)
            return t.expandedRadius;
        if (this.state === State.ACTIVITY)
            return Math.min(t.expandedRadius, Math.round((t.compactHeight + ACTIVITY_HEIGHT_EXTRA) / 2));
        return t.compactRadius;
    }

    /**
     * Ставит остров в нужное место с нужным размером.
     *
     * @param {boolean} animate
     */
    _place(animate = true) {
        const mon = this.monitor;
        const t = this.theme;
        this._sizeChildren();
        const [w, h] = this._targetSize();
        // Оболочка может задать своё место (HypeDE ставит остров на полку).
        const anchor = globalThis.hypedeIsland?.anchor(this.state === State.COMPACT ? 'compact' : 'open', w, h);
        const x = anchor ? anchor.x : Math.round(mon.x + (mon.width - w) / 2);
        const y = anchor ? anchor.y : mon.y + t.topMargin;

        if (this._strut) {
            this._strut.set_position(mon.x, mon.y);
            this._strut.set_size(mon.width, t.compactHeight + t.topMargin * 2);
        }

        const duration = animate ? t.dur(this.state === State.COMPACT ? 0.85 : 1) : 0;
        this.actor.remove_transition('x');
        this.actor.remove_transition('width');
        this.actor.remove_transition('height');
        if (duration > 0) {
            this.actor.ease({
                x, y, width: w, height: h,
                duration,
                mode: t.mode,
            });
        } else {
            this.actor.set_position(x, y);
            this.actor.set_size(w, h);
        }
        this._animateRadius(this._targetRadius(), duration);
    }

    /** Плавное изменение скругления (CSS-свойства нельзя анимировать через ease). */
    _animateRadius(target, duration) {
        if (this._radiusTimeline) {
            this._radiusTimeline.stop();
            this._radiusTimeline = null;
        }
        const from = this._radius;
        if (duration <= 0 || from === target) {
            this._radius = target;
            this.actor.style = this.theme.bubbleStyle(target);
            return;
        }
        const tl = new Clutter.Timeline({actor: this.actor, duration: Math.round(duration * 0.8)});
        tl.set_progress_mode(Clutter.AnimationMode.EASE_OUT_CUBIC);
        tl.connect('new-frame', () => {
            const p = tl.get_progress();
            this._radius = Math.round(from + (target - from) * p);
            this.actor.style = this.theme.bubbleStyle(this._radius);
        });
        tl.connect('completed', () => {
            this._radius = target;
            this.actor.style = this.theme.bubbleStyle(target);
            if (this._radiusTimeline === tl)
                this._radiusTimeline = null;
        });
        this._radiusTimeline = tl;
        tl.start();
    }

    _queueResize() {
        if (this._resizeId)
            return;
        this._resizeId = this._timers.idle(() => {
            this._resizeId = 0;
            this._place(true);
        });
    }

    // ================================================================ состояния

    /**
     * Раскрыть остров.
     *
     * @param {{tab?: string, pin?: boolean, focus?: boolean}} [opts]
     */
    expand(opts = {}) {
        this._cancelTimers();
        if (opts.tab)
            this.expanded.showTab(opts.tab, false);
        if (this.state !== State.EXPANDED) {
            const prev = this.state;
            this.state = State.EXPANDED;
            if (prev === State.ACTIVITY)
                this._hideActivityView();
            this._crossfade(this.compact.actor, this.expanded.actor, true);
            this._place(true);
            this.expanded.onShow();
            this.emit('state-changed', this.state);
        }
        if (opts.pin)
            this._pin();
        if (opts.focus)
            this._timers.timeout(Math.min(250, this.theme.dur(0.5)), () => this.expanded.focusCurrent());
    }

    /** Свернуть остров. */
    collapse() {
        this._cancelTimers();
        this._unpin();
        if (this.state === State.COMPACT)
            return;
        const wasExpanded = this.state === State.EXPANDED;
        this.state = State.COMPACT;
        if (wasExpanded) {
            this.expanded.onHide();
            this._crossfade(this.expanded.actor, this.compact.actor, false);
        } else {
            this._hideActivityView();
            this._showView(this.compact.actor, this.theme.dur(0.4));
        }
        this._place(true);
        this.emit('state-changed', this.state);
        // Отложенные живые активности
        this._timers.timeout(this.theme.dur(1) + 200, () => this._nextActivity());
    }

    toggle() {
        if (this.state === State.EXPANDED)
            this.collapse();
        else
            this.expand({pin: true});
    }

    _crossfade(from, to, expanding) {
        const t = this.theme;
        const d = t.dur(1);
        from.remove_all_transitions();
        to.remove_all_transitions();
        if (d <= 0 || !t.contentFade) {
            from.visible = false;
            from.opacity = 0;
            to.visible = true;
            to.opacity = 255;
            to.scale_x = to.scale_y = 1;
            to.translation_y = 0;
            return;
        }
        from.ease({
            opacity: 0,
            duration: Math.round(d * 0.25),
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                from.visible = false;
            },
        });
        to.visible = true;
        to.opacity = 0;
        to.set_pivot_point(0.5, 0);
        to.scale_x = to.scale_y = expanding ? 0.94 : 1.06;
        to.translation_y = expanding ? -8 : 0;
        to.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            translation_y: 0,
            delay: Math.round(d * (expanding ? 0.22 : 0.45)),
            duration: Math.round(d * 0.6),
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    _showView(view, duration) {
        view.remove_all_transitions();
        view.visible = true;
        view.ease({opacity: 255, duration, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _hideView(view, duration) {
        view.remove_all_transitions();
        view.ease({
            opacity: 0,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                view.visible = false;
            },
        });
    }

    // ================================================================ живые активности

    /**
     * Показать короткое событие (как «живая активность» в iPhone).
     *
     * @param {object} a
     * @param {string} a.source  тип источника (для фильтра в настройках)
     * @param {string} [a.emoji]
     * @param {string|Gio.Icon} [a.icon]
     * @param {string} [a.image]
     * @param {string} a.title
     * @param {string} [a.subtitle]
     * @param {string} [a.accent]
     * @param {number} [a.duration]
     * @param {number} [a.progress]
     * @param {Function} [a.onClick]
     * @param {string} [a.tab]
     * @param {Array<{icon: string, label?: string, onClick: Function}>} [a.actions]
     * @param {string} [a.key]  одинаковый ключ заменяет предыдущую активность
     */
    showActivity(a) {
        if (!this.settings.get_boolean('live-activities'))
            return;
        const sources = this.settings.get_strv('activity-sources');
        if (a.source && !sources.includes(a.source))
            return;
        if (this.settings.get_boolean('pulse-on-activity'))
            this.pulse();
        if (this.state === State.EXPANDED) {
            this.expanded.toast(a);
            return;
        }
        if (a.key) {
            this._activityQueue = this._activityQueue.filter(x => x.key !== a.key);
            if (this._currentActivity?.key === a.key && this.state === State.ACTIVITY) {
                this._currentActivity = a;
                this.activity.show(a);
                this._queueResize();
                return;
            }
        }
        this._activityQueue.push(a);
        if (this._activityQueue.length > 6)
            this._activityQueue.shift();
        if (this.state === State.COMPACT && !this.actor.hover)
            this._nextActivity();
    }

    _nextActivity() {
        if (this.state !== State.COMPACT || this.actor.hover)
            return;
        const a = this._activityQueue.shift();
        if (!a)
            return;
        this._currentActivity = a;
        this.state = State.ACTIVITY;
        this.activity.show(a);
        this._hideView(this.compact.actor, this.theme.dur(0.25));
        this.activity.actor.visible = true;
        this.activity.actor.opacity = 0;
        this.activity.actor.ease({
            opacity: 255,
            delay: this.theme.dur(0.2),
            duration: this.theme.dur(0.5),
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._place(true);
        this.emit('state-changed', this.state);
    }

    _hideActivityView() {
        this.activity.stop();
        this._hideView(this.activity.actor, this.theme.dur(0.2));
        this._currentActivity = null;
    }

    _endActivity(immediate = false) {
        if (this.state !== State.ACTIVITY)
            return;
        this._hideActivityView();
        this.state = State.COMPACT;
        this._showView(this.compact.actor, this.theme.dur(0.5));
        this._place(true);
        this.emit('state-changed', this.state);
        if (!immediate)
            this._timers.timeout(this.theme.dur(1) + 250, () => this._nextActivity());
    }

    /** Лёгкая «пульсация» острова. */
    pulse() {
        if (this.theme.animDuration <= 0)
            return;
        this.actor.set_pivot_point(0.5, 0.5);
        this.actor.ease({
            scale_x: 1.04,
            scale_y: 1.08,
            duration: 140,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this.actor.ease({
                scale_x: 1,
                scale_y: 1,
                duration: 420,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            }),
        });
    }

    // ================================================================ ввод

    _cancelTimers() {
        this._expandTimer = this._timers.clear(this._expandTimer);
        this._collapseTimer = this._timers.clear(this._collapseTimer);
    }

    _onHover() {
        const hover = this.actor.hover;
        if (hover) {
            this._collapseTimer = this._timers.clear(this._collapseTimer);
            if (this.state !== State.EXPANDED && this.settings.get_boolean('hover-expand') && !this._expandTimer) {
                // Над живой активностью ждём дольше, чтобы по ней можно было кликнуть
                const delay = this.state === State.ACTIVITY
                    ? Math.max(800, this.settings.get_int('hover-delay'))
                    : this.settings.get_int('hover-delay');
                this._expandTimer = this._timers.timeout(delay, () => {
                    this._expandTimer = 0;
                    if (this.actor.hover)
                        this.expand();
                });
            }
        } else {
            this._expandTimer = this._timers.clear(this._expandTimer);
            if (this.state === State.EXPANDED && !this._grab) {
                this._collapseTimer = this._timers.clear(this._collapseTimer);
                this._collapseTimer = this._timers.timeout(this.settings.get_int('collapse-delay'), () => {
                    this._collapseTimer = 0;
                    if (!this.actor.hover && !this._grab)
                        this.collapse();
                });
            } else if (this.state === State.COMPACT) {
                this._timers.timeout(400, () => this._nextActivity());
            }
        }
    }

    _onPress(event) {
        if (this.state === State.COMPACT) {
            // Средняя кнопка — play/pause, правая — сразу настройки острова
            const button = event.get_button?.() ?? 1;
            if (button === 2) {
                this.services.media.current?.playPause();
                return Clutter.EVENT_STOP;
            }
            this.expand({pin: true, tab: button === 3 ? 'settings' : undefined});
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onScroll(event) {
        if (this.state !== State.COMPACT)
            return Clutter.EVENT_PROPAGATE;
        // Прокрутка над свёрнутым островом меняет громкость
        const dir = event.get_scroll_direction();
        const c = this.services.controls;
        if (!c.hasVolume)
            return Clutter.EVENT_PROPAGATE;
        let delta = 0;
        if (dir === Clutter.ScrollDirection.UP)
            delta = 0.05;
        else if (dir === Clutter.ScrollDirection.DOWN)
            delta = -0.05;
        else if (dir === Clutter.ScrollDirection.SMOOTH)
            delta = -event.get_scroll_delta()[1] * 0.05;
        if (delta) {
            c.volume = c.volume + delta;
            this.showActivity({
                source: 'system',
                key: 'volume',
                icon: c.volumeIcon,
                title: 'Громкость',
                progress: c.volume,
                subtitle: `${Math.round(c.volume * 100)}%`,
                duration: 1200,
            });
        }
        return Clutter.EVENT_STOP;
    }

    _isInside(event) {
        const [x, y] = event.get_coords();
        const [ax, ay] = this.actor.get_transformed_position();
        const [aw, ah] = this.actor.get_transformed_size();
        return x >= ax && x <= ax + aw && y >= ay && y <= ay + ah;
    }

    _onCapturedEvent(event) {
        const type = event.type();
        const press = type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN;

        if (this._grab) {
            if (press && !this._isInside(event)) {
                this.collapse();
                return Clutter.EVENT_STOP;
            }
            if (type === Clutter.EventType.KEY_PRESS) {
                const sym = event.get_key_symbol();
                if (sym === Clutter.KEY_Escape) {
                    if (!this.expanded.handleEscape())
                        this.collapse();
                    return Clutter.EVENT_STOP;
                }
                const mods = event.get_state();
                if (mods & Clutter.ModifierType.MOD1_MASK && sym >= Clutter.KEY_1 && sym <= Clutter.KEY_9) {
                    this.expanded.showTabIndex(sym - Clutter.KEY_1);
                    return Clutter.EVENT_STOP;
                }
                if (mods & Clutter.ModifierType.CONTROL_MASK && (sym === Clutter.KEY_Page_Down || sym === Clutter.KEY_Tab)) {
                    this.expanded.cycleTab(1);
                    return Clutter.EVENT_STOP;
                }
                if (mods & Clutter.ModifierType.CONTROL_MASK && (sym === Clutter.KEY_Page_Up || sym === Clutter.KEY_ISO_Left_Tab)) {
                    this.expanded.cycleTab(-1);
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        }

        // Первый клик внутри раскрытого острова «закрепляет» его и включает клавиатуру
        if (press && this.state === State.EXPANDED)
            this._pin();
        return Clutter.EVENT_PROPAGATE;
    }

    get pinned() {
        return !!this._grab;
    }

    _pin() {
        if (this._grab || this.state !== State.EXPANDED)
            return;
        const grab = Main.pushModal(this.actor, {actionMode: Shell.ActionMode.POPUP});
        if (!grab)
            return;
        if (!this._grabUsable(grab)) {
            Main.popModal(grab);
            return;
        }
        // Если система отняла захват (например, открылось меню), сворачиваемся
        grab.connectObject('notify::revoked', () => {
            if (this._grab === grab && grab.revoked)
                this.collapse();
        }, this);
        this._grab = grab;
        this._collapseTimer = this._timers.clear(this._collapseTimer);
        this.expanded.setPinned(true);
        this.emit('pinned', true);
    }

    /** Получили ли мы действительно клавиатуру (API захвата отличается в GNOME 50). */
    _grabUsable(grab) {
        if (typeof grab.get_seat_state === 'function')
            return (grab.get_seat_state() & Clutter.GrabState.KEYBOARD) !== 0;
        if (typeof grab.is_revoked === 'function')
            return !grab.is_revoked();
        return true;
    }

    _unpin() {
        if (!this._grab)
            return;
        const grab = this._grab;
        this._grab = null;
        safe(() => grab.disconnectObject(this), 'grab disconnect');
        safe(() => Main.popModal(grab), 'popModal');
        this.expanded.setPinned(false);
        this.emit('pinned', false);
    }

    /** Временно отпустить клавиатуру (например, чтобы вставить текст в окно). */
    releaseFocus() {
        this.collapse();
    }

    _onOverview(showing) {
        const hide = showing && this.ctx.extension.panelVisibleInOverview;
        if (showing)
            this.collapse();
        this.actor.remove_transition('opacity');
        this.actor.ease({
            opacity: hide ? 0 : 255,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this.actor.reactive = !hide;
    }

    // ================================================================ уничтожение

    destroy() {
        this._unpin();
        this._timers.destroy();
        if (this._radiusTimeline)
            this._radiusTimeline.stop();
        Main.layoutManager.disconnectObject(this);
        globalThis.hypedeIsland?.unlisten(this);
        Main.overview.disconnectObject(this);
        this.compact.destroy();
        this.activity.destroy();
        this.expanded.destroy();
        if (this._strut) {
            Main.layoutManager.removeChrome(this._strut);
            this._strut.destroy();
            this._strut = null;
        }
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
        this.disconnectAll();
    }
}
