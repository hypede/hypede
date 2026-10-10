// Тема острова: цвета, размеры, анимации. Читается из GSettings.

import Clutter from 'gi://Clutter';

import {luminance, mix, withAlpha} from './pure/format.js';

export {PRESETS} from './pure/presets.js';

const MODES = {
    spring: Clutter.AnimationMode.EASE_OUT_BACK,
    smooth: Clutter.AnimationMode.EASE_OUT_EXPO,
    bounce: Clutter.AnimationMode.EASE_OUT_BOUNCE,
    elastic: Clutter.AnimationMode.EASE_OUT_ELASTIC,
    linear: Clutter.AnimationMode.LINEAR,
    none: Clutter.AnimationMode.LINEAR,
};

export class Theme {
    /**
     * @param {Gio.Settings} settings
     */
    constructor(settings) {
        this.settings = settings;
        this.reload();
    }

    reload() {
        const s = this.settings;
        this.bg = s.get_string('bg-color');
        this.fg = s.get_string('fg-color');
        this.accent = s.get_string('accent-color');
        this.border = s.get_string('border-color');
        this.borderWidth = s.get_int('border-width');
        this.compactRadius = s.get_int('compact-radius');
        this.expandedRadius = s.get_int('expanded-radius');
        this.compactWidth = s.get_int('compact-width');
        this.compactHeight = s.get_int('compact-height');
        this.expandedWidth = s.get_int('expanded-width');
        this.expandedHeight = s.get_int('expanded-height');
        this.topMargin = s.get_int('top-margin');
        this.fontSize = s.get_int('font-size');
        this.fontFamily = s.get_string('font-family');
        this.shadow = s.get_boolean('shadow');
        this.animStyle = s.get_string('animation-style');
        this.animDuration = this.animStyle === 'none' ? 0 : s.get_int('animation-duration');
        this.contentFade = s.get_boolean('content-fade');
        this.tabTransition = s.get_string('tab-transition');

        this.light = luminance(this.bg) > 0.5;
        // Производные цвета
        this.dim = withAlpha(this.fg, 0.62);
        this.faint = withAlpha(this.fg, 0.38);
        this.surface = withAlpha(this.fg, this.light ? 0.06 : 0.08);
        this.surfaceHover = withAlpha(this.fg, this.light ? 0.11 : 0.15);
        this.surfaceStrong = withAlpha(this.fg, this.light ? 0.14 : 0.2);
        this.accentSoft = withAlpha(this.accent, 0.22);
        this.accentText = luminance(this.accent) > 0.55 ? '#111111' : '#ffffff';
        this.danger = '#ff453a';
        this.success = '#30d158';
        this.warning = '#ffd60a';
        this.cardBg = mix(this.bg, this.fg, this.light ? 0.04 : 0.07);
    }

    /** Режим easing для изменения формы острова. */
    get mode() {
        return MODES[this.animStyle] ?? MODES.spring;
    }

    /** Режим для второстепенных анимаций (без отскока). */
    get softMode() {
        return Clutter.AnimationMode.EASE_OUT_CUBIC;
    }

    /** Длительность с учётом коэффициента. */
    dur(k = 1) {
        return Math.round(this.animDuration * k);
    }

    /** Стиль «пузыря» острова. */
    bubbleStyle(radius) {
        const parts = [
            `background-color: ${this.bg}`,
            `border-radius: ${radius}px`,
            `color: ${this.fg}`,
            `font-size: ${this.fontSize}px`,
        ];
        if (this.borderWidth > 0)
            parts.push(`border: ${this.borderWidth}px solid ${this.border}`);
        if (this.shadow)
            parts.push(`box-shadow: 0 8px 28px 0 rgba(0,0,0,${this.light ? 0.22 : 0.5})`);
        if (this.fontFamily)
            parts.push(`font-family: "${this.fontFamily}"`);
        return `${parts.join('; ')};`;
    }

    /** Стиль карточки. */
    card(extra = '') {
        return `background-color: ${this.cardBg}; border-radius: 18px; ${extra}`;
    }

    /** Стиль кнопки. */
    button(active = false, extra = '') {
        return active
            ? `background-color: ${this.accent}; color: ${this.accentText}; ${extra}`
            : `background-color: ${this.surface}; color: ${this.fg}; ${extra}`;
    }

    hoverButton(extra = '') {
        return `background-color: ${this.surfaceHover}; color: ${this.fg}; ${extra}`;
    }

    entry(extra = '') {
        return `background-color: ${this.surface}; color: ${this.fg}; caret-color: ${this.accent}; selection-background-color: ${this.accentSoft}; selected-color: ${this.fg}; ${extra}`;
    }
}
