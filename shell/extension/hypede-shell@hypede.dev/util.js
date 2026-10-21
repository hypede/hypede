// Мелочи, общие для частей оболочки.

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

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

// Всплывающая подсказка со значком на всех мониторах. В GNOME 50 у show()
// другие аргументы, а showAll() появился только в нём.
export function showOsd(icon, text) {
    const manager = Main.osdWindowManager;
    if (manager.showAll)
        manager.showAll(icon, text);
    else
        manager.show(-1, icon, text);
}

// Развернуть и восстановить окно. В GNOME 51 maximize()/unmaximize() — без
// флагов (направления задаёт set_maximize_flags), в 48–50 — с флагами.
const NEW_MAXIMIZE = typeof Meta.Window.prototype.set_maximize_flags === 'function';

export function maximizeWindow(win) {
    if (NEW_MAXIMIZE)
        win.maximize();
    else
        win.maximize(Meta.MaximizeFlags.BOTH);
}

export function unmaximizeWindow(win) {
    if (NEW_MAXIMIZE)
        win.unmaximize();
    else
        win.unmaximize(Meta.MaximizeFlags.BOTH);
}

// Левая и средняя кнопки мыши. В GNOME 51 ONE и TWO переименовали.
export const PRIMARY_AND_MIDDLE = (St.ButtonMask.PRIMARY ?? St.ButtonMask.ONE) |
    (St.ButtonMask.MIDDLE ?? St.ButtonMask.TWO);

// Окна программы, которые GNOME приписал не ей: имя класса окна, его
// app_id или «песочный» id совпадает с id ярлыка, StartupWMClass или
// названием программы. Такие окна иначе не открыть по значку на полке.
export function strayWindows(app) {
    const tracker = Shell.WindowTracker.get_default();
    const normalize = text => (text ?? '').toLowerCase().replace(/\.desktop$/, '').replace(/[\s_]+/g, '-');
    const id = normalize(app.get_id());
    const names = new Set([id, id.split('.').pop(), normalize(app.get_name()),
        normalize(app.get_name()).replace(/-/g, ''), normalize(app.app_info?.get_startup_wm_class?.())]);
    names.delete('');
    return global.get_window_actors().map(actor => actor.meta_window).filter(win =>
        win && win.get_window_type() === Meta.WindowType.NORMAL && !win.skip_taskbar &&
        tracker.get_window_app(win) !== app &&
        [win.get_wm_class(), win.get_wm_class_instance(), win.get_gtk_application_id(), win.get_sandboxed_app_id()]
            .some(name => name && (names.has(normalize(name)) || names.has(normalize(name).replace(/-/g, '')))));
}

// Открыть программу по значку: её «потерянное» окно, если оно есть; если
// программа работает, но спрятала окно в трей (Claude Desktop, Discord,
// Telegram), — запустить ещё раз: так она показывает окно, а activate() в
// этом случае ничего не делает. Возвращает true, если окно уже было.
export function openApp(app) {
    if (app.get_n_windows() > 0) {
        app.activate();
        return true;
    }
    const stray = strayWindows(app);
    if (stray.length) {
        Main.activateWindow(stray[0]);
        return true;
    }
    if (app.state === Shell.AppState.RUNNING)
        app.launch(0, -1, Shell.AppLaunchGpu.APP_PREF);
    else
        app.activate();
    return false;
}
