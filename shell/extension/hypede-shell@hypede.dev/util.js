// Мелочи, общие для частей оболочки.

import Clutter from 'gi://Clutter';

// Правый щелчок. Clutter.ClickGesture есть с GNOME 48; на всякий случай
// оставлен и запасной путь через событие нажатия.
export function addSecondaryClick(actor, callback) {
    if (Clutter.ClickGesture) {
        const gesture = new Clutter.ClickGesture({
            required_button: Clutter.BUTTON_SECONDARY,
            recognize_on_press: true,
        });
        gesture.connect('recognize', () => callback());
        actor.add_action(gesture);
    } else {
        actor.connect('button-press-event', (_a, event) => {
            if (event.get_button() !== Clutter.BUTTON_SECONDARY)
                return Clutter.EVENT_PROPAGATE;
            callback();
            return Clutter.EVENT_STOP;
        });
    }
}

// Сторона экрана → смещение «за край» для актёра размером width × height.
export function offscreenOffset(side, width, height) {
    return {
        bottom: [0, height],
        top: [0, -height],
        left: [-width, 0],
        right: [width, 0],
    }[side] ?? [0, height];
}

// ---------------------------------------------------------------------------
// Цвета. Акцент — свой (ключ accent-custom) или один из девяти GNOME.

export const GNOME_ACCENTS = {
    blue: '#3584e4', teal: '#2190a4', green: '#3a944a', yellow: '#c88800',
    orange: '#ed5b00', red: '#e62d42', pink: '#d56199', purple: '#9141ac',
    slate: '#6f8396',
};

// '#rgb' или '#rrggbb' → [r, g, b] от 0 до 255; null, если не цвет.
export function parseHex(text) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((text ?? '').trim());
    if (!m)
        return null;
    let hex = m[1];
    if (hex.length === 3)
        hex = [...hex].map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]) {
    return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

// Относительная яркость по WCAG, 0…1.
export function luminance([r, g, b]) {
    const lin = v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Светлый ли фон: тогда на нём нужен тёмный текст.
export function isLight(rgb) {
    return luminance(rgb) > 0.4;
}

// Ближайший из акцентов GNOME — для приложений, которые умеют только их.
export function nearestGnomeAccent(rgb) {
    let best = 'blue', bestDist = Infinity;
    for (const [name, hex] of Object.entries(GNOME_ACCENTS)) {
        const c = parseHex(hex);
        // Взвешенное расстояние: глаз чувствительнее к зелёному.
        const d = 2 * (c[0] - rgb[0]) ** 2 + 4 * (c[1] - rgb[1]) ** 2 + 3 * (c[2] - rgb[2]) ** 2;
        if (d < bestDist) {
            best = name;
            bestDist = d;
        }
    }
    return best;
}

// Текущий акцент как '#rrggbb'.
export function accentHex(shellSettings, interfaceSettings) {
    const custom = parseHex(shellSettings?.get_string('accent-custom'));
    if (custom)
        return toHex(custom);
    const name = interfaceSettings?.get_string('accent-color');
    return GNOME_ACCENTS[name] ?? GNOME_ACCENTS.blue;
}

// Окно рабочего стола HypeDE (hypede-desktop): его не скругляют, не
// анимируют и не считают обычным окном.
export function isDesktopWindow(win) {
    return win?.get_wm_class?.() === 'dev.hypede.Desktop' || /^hypede-desktop-\d+$/.test(win?.get_title?.() ?? '');
}
