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
