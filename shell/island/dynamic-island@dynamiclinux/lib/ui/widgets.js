// Небольшая библиотека UI-компонентов на St для острова.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import Cairo from 'cairo';

import {parseColor} from '../pure/format.js';

const VISUALIZER_STEP_MS = 110;

const HAS_ORIENTATION = !!St.BoxLayout.find_property('orientation');

/**
 * St.BoxLayout с учётом изменений API (vertical → orientation в GNOME 48).
 *
 * @param {boolean} vertical
 * @param {object} params
 * @returns {St.BoxLayout}
 */
export function box(vertical = false, params = {}) {
    const p = {...params};
    if (HAS_ORIENTATION)
        p.orientation = vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL;
    else
        p.vertical = vertical;
    return new St.BoxLayout(p);
}

export const vbox = (params = {}) => box(true, params);
export const hbox = (params = {}) => box(false, params);

/** Добавляет несколько дочерних элементов. */
export function add(parent, ...children) {
    for (const c of children) {
        if (c)
            parent.add_child(c);
    }
    return parent;
}

/** Растягивающийся разделитель. */
export function spacer() {
    return new St.Widget({x_expand: true, y_expand: false});
}

/**
 * @param {string} text
 * @param {object} [opts]
 * @returns {St.Label}
 */
export function label(text = '', opts = {}) {
    const l = new St.Label({
        text: String(text),
        style_class: opts.cls ?? '',
        style: opts.style ?? '',
        x_expand: opts.expand ?? false,
        y_align: Clutter.ActorAlign.CENTER,
        x_align: opts.xAlign ?? Clutter.ActorAlign.FILL,
    });
    const ct = l.clutter_text;
    if (opts.wrap) {
        ct.line_wrap = true;
        ct.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        ct.ellipsize = Pango.EllipsizeMode.NONE;
    } else {
        ct.ellipsize = Pango.EllipsizeMode.END;
    }
    if (opts.markup)
        ct.use_markup = true;
    if (opts.center)
        ct.x_align = Clutter.ActorAlign.CENTER;
    return l;
}

/**
 * @param {string|Gio.Icon} icon имя иконки или Gio.Icon
 * @param {number} size
 * @param {string} [style]
 * @returns {St.Icon}
 */
export function icon(iconName, size = 16, style = '') {
    const params = {icon_size: size, style, y_align: Clutter.ActorAlign.CENTER};
    if (iconName instanceof Gio.Icon)
        params.gicon = iconName;
    else
        params.icon_name = iconName;
    return new St.Icon(params);
}

/**
 * Кнопка с иконкой и/или подписью.
 *
 * @param {object} opts
 * @param {string} [opts.icon]
 * @param {string} [opts.label]
 * @param {Function} [opts.onClick]
 * @param {boolean} [opts.accent]
 * @param {string} [opts.cls]
 * @param {number} [opts.iconSize]
 * @param {object} [opts.theme]
 * @param {boolean} [opts.vertical]
 * @returns {St.Button}
 */
export function button(opts = {}) {
    const content = box(!!opts.vertical, {
        style_class: 'di-btn-content',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    let ic = null, lb = null;
    if (opts.icon) {
        ic = icon(opts.icon, opts.iconSize ?? 16);
        if (opts.vertical)
            ic.x_align = Clutter.ActorAlign.CENTER;
        content.add_child(ic);
    }
    if (opts.label !== undefined) {
        lb = label(opts.label, {cls: opts.labelCls ?? 'di-btn-label'});
        if (opts.vertical)
            lb.x_align = Clutter.ActorAlign.CENTER;
        content.add_child(lb);
    }
    const btn = new St.Button({
        style_class: `di-btn ${opts.cls ?? ''}`,
        child: content,
        can_focus: true,
        track_hover: true,
        reactive: true,
        x_expand: opts.expand ?? false,
        y_expand: false,
        x_align: opts.xAlign ?? Clutter.ActorAlign.FILL,
        y_align: opts.yAlign ?? Clutter.ActorAlign.CENTER,
    });
    btn._icon = ic;
    btn._label = lb;
    if (opts.style)
        btn.style = opts.style;
    if (opts.accent && opts.theme)
        setAccent(btn, opts.theme, true);
    if (opts.onClick)
        btn.connect('clicked', () => opts.onClick(btn));
    if (opts.tooltip)
        btn.accessible_name = opts.tooltip;
    return btn;
}

/** Круглая кнопка-иконка. */
export function iconButton(iconName, onClick, opts = {}) {
    return button({
        icon: iconName,
        iconSize: opts.size ?? 16,
        onClick,
        cls: `di-icon-btn ${opts.cls ?? ''}`,
        accent: opts.accent,
        theme: opts.theme,
        tooltip: opts.tooltip,
        style: opts.style,
    });
}

/** Включает/выключает акцентную подсветку кнопки. */
export function setAccent(btn, theme, on) {
    btn._accentOn = on;
    btn.style = on
        ? `background-color: ${theme.accent}; color: ${theme.accentText};`
        : '';
    if (btn._icon)
        btn._icon.style = on ? `color: ${theme.accentText};` : '';
}

/** Карточка-контейнер. */
export function card(vertical = true, opts = {}) {
    return box(vertical, {
        style_class: `di-card ${opts.cls ?? ''}`,
        x_expand: opts.expandX ?? true,
        y_expand: opts.expandY ?? false,
        style: opts.style ?? '',
    });
}

/** Заголовок секции. */
export function heading(text) {
    return label(text, {cls: 'di-heading'});
}

/**
 * Поле ввода.
 *
 * @param {object} opts
 * @returns {St.Entry}
 */
export function entry(opts = {}) {
    const e = new St.Entry({
        style_class: `di-entry ${opts.cls ?? ''}`,
        hint_text: opts.hint ?? '',
        can_focus: true,
        x_expand: opts.expand ?? true,
        y_expand: opts.expandY ?? false,
        text: opts.text ?? '',
    });
    const ct = e.clutter_text;
    if (opts.multiline) {
        ct.single_line_mode = false;
        ct.activatable = false;
        ct.line_wrap = true;
        ct.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        e.add_style_class_name('di-entry-multiline');
    }
    if (opts.password) {
        ct.password_char = 0x2022;
    }
    if (opts.onActivate)
        ct.connect('activate', () => opts.onActivate(e.get_text()));
    if (opts.onChange)
        ct.connect('text-changed', () => opts.onChange(e.get_text()));
    if (opts.primaryIcon)
        e.set_primary_icon(icon(opts.primaryIcon, 16));
    return e;
}

/**
 * Многострочный редактор: St.Entry внутри прокручиваемой «подложки».
 * Возвращает [scrollView, entry].
 *
 * @param {object} opts как у entry()
 * @returns {[St.ScrollView, St.Entry]}
 */
export function editor(opts = {}) {
    const e = entry({...opts, multiline: true, expandY: false, cls: `di-editor-entry ${opts.cls ?? ''}`});
    const wrap = vbox({style_class: 'di-editor', x_expand: true, y_expand: true, reactive: true});
    wrap.add_child(e);
    wrap.connect('button-press-event', () => {
        e.grab_key_focus();
        e.clutter_text.set_cursor_position(-1);
        return Clutter.EVENT_STOP;
    });
    const sv = scroll(wrap, {cls: 'di-editor-scroll'});
    // Курсор всегда в видимой области
    e.clutter_text.connect('cursor-changed', () => {
        const adj = sv.vadjustment ?? sv.get_vscroll_bar?.()?.get_adjustment();
        if (!adj)
            return;
        const ct = e.clutter_text;
        const pos = ct.get_cursor_position();
        const [, , y] = ct.position_to_coords(pos < 0 ? ct.text.length : pos);
        const top = e.y + y;
        if (top < adj.value)
            adj.value = top;
        else if (top + 24 > adj.value + adj.page_size)
            adj.value = top + 24 - adj.page_size;
    });
    return [sv, e];
}

/**
 * Прокручиваемая область.
 *
 * @param {Clutter.Actor} child
 * @param {object} [opts]
 * @returns {St.ScrollView}
 */
export function scroll(child, opts = {}) {
    // В ScrollView можно класть только St.Scrollable (BoxLayout/Viewport)
    if (!(child instanceof St.BoxLayout) && !(child instanceof St.Viewport)) {
        const wrap = box(!opts.horizontal, {x_expand: true});
        wrap.add_child(child);
        child = wrap;
    }
    const hidden = St.PolicyType.EXTERNAL ?? St.PolicyType.AUTOMATIC;
    const sv = new St.ScrollView({
        style_class: `di-scroll ${opts.cls ?? ''}`,
        x_expand: true,
        y_expand: !opts.horizontal,
        overlay_scrollbars: true,
        hscrollbar_policy: opts.horizontal ? hidden : St.PolicyType.NEVER,
        vscrollbar_policy: opts.horizontal ? St.PolicyType.NEVER : St.PolicyType.AUTOMATIC,
    });
    if (opts.horizontal) {
        // Колесо мыши прокручивает горизонтально
        sv.connect('scroll-event', (a, e) => {
            const adj = sv.hadjustment ?? sv.get_hscroll_bar?.()?.get_adjustment();
            if (!adj)
                return Clutter.EVENT_PROPAGATE;
            const dir = e.get_scroll_direction();
            let d = 0;
            if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.LEFT)
                d = -60;
            else if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.RIGHT)
                d = 60;
            else if (dir === Clutter.ScrollDirection.SMOOTH) {
                const [dx, dy] = e.get_scroll_delta();
                d = (Math.abs(dx) > Math.abs(dy) ? dx : dy) * 40;
            }
            adj.value = Math.max(adj.lower, Math.min(adj.upper - adj.page_size, adj.value + d));
            return Clutter.EVENT_STOP;
        });
    }
    if (sv.set_child)
        sv.set_child(child);
    else
        sv.add_actor(child);
    return sv;
}

/** Прокрутить область в самый низ. */
export function scrollToBottom(sv) {
    const adj = sv.vadjustment ?? sv.get_vscroll_bar?.()?.get_adjustment();
    if (adj)
        adj.value = adj.upper - adj.page_size;
}

/** Изображение из файла с обрезкой по размеру и скруглением. */
export function image(path, width, height, radius = 10) {
    const bin = new St.Bin({
        style_class: 'di-image',
        width,
        height,
        y_align: Clutter.ActorAlign.CENTER,
    });
    setImage(bin, path, radius);
    return bin;
}

/** Меняет картинку у image(). */
export function setImage(bin, path, radius = 10) {
    if (path) {
        const uri = path.startsWith('file://') ? path : `file://${path}`;
        bin.style = `background-image: url("${uri}"); background-size: cover; border-radius: ${radius}px;`;
    } else {
        bin.style = `border-radius: ${radius}px;`;
    }
}

/**
 * Полоса прогресса.
 */
export const ProgressBar = GObject.registerClass(
class DIProgressBar extends St.Widget {
    _init(params = {}) {
        super._init({
            style_class: 'di-progress',
            x_expand: params.x_expand ?? true,
            y_align: Clutter.ActorAlign.CENTER,
            height: params.height ?? 6,
            layout_manager: new Clutter.FixedLayout(),
        });
        this._fill = new St.Widget({style_class: 'di-progress-fill', height: params.height ?? 6});
        this.add_child(this._fill);
        this._value = 0;
        this._color = params.color ?? null;
        if (this._color)
            this._fill.style = `background-color: ${this._color};`;
        this.connect('notify::width', () => this._sync());
    }

    set value(v) {
        this._value = Math.max(0, Math.min(1, v || 0));
        this._sync();
    }

    get value() {
        return this._value;
    }

    setColor(color) {
        this._color = color;
        this._fill.style = `background-color: ${color};`;
    }

    _sync() {
        // Пока виджет не на сцене, его размер неизвестен — обновимся при размещении
        if (!this.get_stage())
            return;
        this._fill.width = Math.round(this.width * this._value);
        this._fill.height = this.height;
    }
});

/**
 * Мини-график (sparkline) на Cairo.
 */
export const Sparkline = GObject.registerClass(
class DISparkline extends St.DrawingArea {
    _init(params = {}) {
        super._init({
            style_class: 'di-sparkline',
            x_expand: params.x_expand ?? true,
            height: params.height ?? 48,
            width: params.width ?? -1,
        });
        this._series = [];
        this._max = params.max ?? null;
        this._fill = params.fill ?? true;
    }

    /**
     * @param {Array<{data: number[], color: string}>} series
     * @param {number|null} [max]
     */
    setData(series, max = this._max) {
        this._series = series;
        this._max = max;
        this.queue_repaint();
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        let max = this._max;
        if (max === null) {
            max = 1;
            for (const s of this._series)
                max = Math.max(max, ...s.data);
        }
        for (const s of this._series) {
            const d = s.data;
            if (d.length < 2)
                continue;
            const c = parseColor(s.color);
            const step = w / (d.length - 1);
            cr.moveTo(0, h - (d[0] / max) * (h - 2) - 1);
            for (let i = 1; i < d.length; i++) {
                const x0 = (i - 1) * step, x1 = i * step;
                const y0 = h - (d[i - 1] / max) * (h - 2) - 1;
                const y1 = h - (d[i] / max) * (h - 2) - 1;
                const mx = (x0 + x1) / 2;
                cr.curveTo(mx, y0, mx, y1, x1, y1);
            }
            cr.setSourceRGBA(c.r / 255, c.g / 255, c.b / 255, 0.95);
            cr.setLineWidth(2);
            if (this._fill) {
                cr.strokePreserve();
                cr.lineTo(w, h);
                cr.lineTo(0, h);
                cr.closePath();
                const grad = new Cairo.LinearGradient(0, 0, 0, h);
                grad.addColorStopRGBA(0, c.r / 255, c.g / 255, c.b / 255, 0.35);
                grad.addColorStopRGBA(1, c.r / 255, c.g / 255, c.b / 255, 0.0);
                cr.setSource(grad);
                cr.fill();
            } else {
                cr.stroke();
            }
        }
        cr.$dispose();
    }
});

/**
 * Круговой индикатор (кольцо) — для CPU/RAM/батареи.
 */
export const Ring = GObject.registerClass(
class DIRing extends St.DrawingArea {
    _init(params = {}) {
        const size = params.size ?? 64;
        super._init({width: size, height: size, y_align: Clutter.ActorAlign.CENTER});
        this._value = 0;
        this._color = params.color ?? '#0a84ff';
        this._track = params.track ?? 'rgba(255,255,255,0.12)';
        this._thickness = params.thickness ?? 6;
    }

    set value(v) {
        this._value = Math.max(0, Math.min(1, v || 0));
        this.queue_repaint();
    }

    setColor(color) {
        this._color = color;
        this.queue_repaint();
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        const r = Math.min(w, h) / 2 - this._thickness / 2 - 1;
        const t = parseColor(this._track);
        const c = parseColor(this._color);
        cr.setLineWidth(this._thickness);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setSourceRGBA(t.r / 255, t.g / 255, t.b / 255, t.a);
        cr.arc(w / 2, h / 2, r, 0, Math.PI * 2);
        cr.stroke();
        if (this._value > 0.001) {
            cr.setSourceRGBA(c.r / 255, c.g / 255, c.b / 255, c.a);
            cr.arc(w / 2, h / 2, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this._value);
            cr.stroke();
        }
        cr.$dispose();
    }
});

/**
 * Анимированный «эквалайзер» из нескольких столбиков.
 */
export const Visualizer = GObject.registerClass(
class DIVisualizer extends St.BoxLayout {
    _init(params = {}) {
        super._init({style_class: 'di-visualizer', y_align: Clutter.ActorAlign.CENTER});
        this._bars = [];
        this._height = params.height ?? 14;
        this._playing = false;
        this._animate = params.animate ?? true;
        for (let i = 0; i < (params.bars ?? 4); i++) {
            const bar = new St.Widget({
                style_class: 'di-visualizer-bar',
                width: 3,
                height: this._height,
                y_align: Clutter.ActorAlign.CENTER,
            });
            bar.set_pivot_point(0.5, 0.5);
            bar.scale_y = 0.3;
            if (params.color)
                bar.style = `background-color: ${params.color};`;
            this._bars.push(bar);
            this.add_child(bar);
        }
        this.connect('destroy', () => {
            this._destroyed = true;
            this._sync();
        });
    }

    setColor(color) {
        for (const b of this._bars)
            b.style = `background-color: ${color};`;
    }

    set playing(p) {
        if (p === this._playing)
            return;
        this._playing = p;
        this._sync();
    }

    // Столбики меняются скачками ~9 раз в секунду, без плавных переходов:
    // плавная анимация заставляла бы композитор перерисовывать кадр
    // на каждом обновлении экрана, пока играет музыка.
    _sync() {
        const run = this._playing && this._animate && this.mapped && !this._destroyed &&
            St.Settings.get().enable_animations;
        if (run && !this._tickId) {
            this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, VISUALIZER_STEP_MS, () => {
                for (const b of this._bars)
                    b.scale_y = 0.25 + Math.random() * 0.75;
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!run && this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
        if (!run && !this._destroyed) {
            for (const b of this._bars)
                b.scale_y = this._playing ? 0.6 : 0.25;
        }
    }

    vfunc_map() {
        super.vfunc_map();
        this._sync();
    }

    vfunc_unmap() {
        super.vfunc_unmap();
        this._sync();
    }
});

/**
 * Переключатель (toggle) в стиле iOS.
 */
export const Switch = GObject.registerClass(
class DISwitch extends St.Button {
    _init(params = {}) {
        super._init({
            style_class: 'di-switch',
            toggle_mode: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.END,
            width: 40,
            height: 24,
        });
        this._theme = params.theme;
        this._knob = new St.Widget({style_class: 'di-switch-knob', width: 18, height: 18, y_align: Clutter.ActorAlign.CENTER});
        const layout = new St.Widget({layout_manager: new Clutter.FixedLayout(), width: 40, height: 24});
        layout.add_child(this._knob);
        this.set_child(layout);
        this._knob.set_position(3, 3);
        this.checked = !!params.active;
        this._sync(false);
        this.connect('notify::checked', () => {
            this._sync(true);
            params.onToggle?.(this.checked);
        });
    }

    setActive(v) {
        if (this.checked !== v)
            this.checked = v;
    }

    _sync(animate) {
        const x = this.checked ? 19 : 3;
        if (animate)
            this._knob.ease({x, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_BACK});
        else
            this._knob.x = x;
        this.style = this.checked && this._theme ? `background-color: ${this._theme.accent};` : '';
    }
});

/**
 * Строка «подпись — переключатель».
 */
export function switchRow(text, active, onToggle, theme, subtitle = '') {
    const row = hbox({style_class: 'di-row', x_expand: true});
    const texts = vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    texts.add_child(label(text, {cls: 'di-row-title'}));
    if (subtitle)
        texts.add_child(label(subtitle, {cls: 'di-dim di-small'}));
    const sw = new Switch({active, onToggle, theme});
    add(row, texts, sw);
    row._switch = sw;
    return row;
}

/** Сетка из кнопок (FlowBox-подобная через строки). */
export function grid(items, columns, opts = {}) {
    const col = vbox({style_class: 'di-grid', x_expand: true});
    let row = null;
    items.forEach((it, i) => {
        if (i % columns === 0) {
            row = hbox({style_class: 'di-grid-row', x_expand: true});
            row.layout_manager.homogeneous = true;
            col.add_child(row);
        }
        it.x_expand = true;
        row.add_child(it);
    });
    if (opts.fill && row) {
        const missing = (columns - (items.length % columns)) % columns;
        for (let i = 0; i < missing; i++)
            row.add_child(new St.Widget({x_expand: true}));
    }
    return col;
}

/** Удаляет все дочерние элементы. */
export function clear(actor) {
    actor.destroy_all_children();
}

/** Небольшая «пилюля»-бейдж. */
export function chip(text, opts = {}) {
    const l = label(text, {cls: `di-chip ${opts.cls ?? ''}`});
    if (opts.color)
        l.style = `background-color: ${opts.color}; color: ${opts.textColor ?? '#fff'};`;
    return l;
}

/** Анимация «пульса» для актёра. */
export function pulse(actor, scale = 1.08, duration = 160) {
    actor.set_pivot_point(0.5, 0.5);
    actor.ease({
        scale_x: scale,
        scale_y: scale,
        duration,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => actor.ease({
            scale_x: 1,
            scale_y: 1,
            duration: duration * 1.6,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        }),
    });
}

/** Плавное появление. */
export function fadeIn(actor, duration = 200, delay = 0) {
    actor.opacity = 0;
    actor.ease({opacity: 255, duration, delay, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
}
