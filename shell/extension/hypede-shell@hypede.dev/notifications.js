// Всплывающие уведомления — в правом нижнем углу над треем, как в Chrome OS.
//
// GNOME показывает баннер сверху и «спускает» его вниз. Здесь контейнер
// баннеров прижат к низу рабочей области (то есть к полке), а появление
// идёт снизу вверх.

import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {State} from 'resource:///org/gnome/shell/ui/messageTray.js';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

export class NotificationTweaks {
    constructor() {
        this._tray = Main.messageTray;
        this._bin = this._tray._bannerBin;
        this._injections = new InjectionManager();

        if (!this._bin)
            return;

        this._originalAlign = this._bin.y_align;
        this._bin.y_align = Clutter.ActorAlign.END;
        this._tray.bannerAlignment = Clutter.ActorAlign.END;

        // Перед показом баннер ставится ниже итогового места, чтобы
        // анимация GNOME (y → 0) подняла его вверх.
        const bin = this._bin;
        this._injections.overrideMethod(this._tray, '_updateShowingNotification',
            original => function (...args) {
                if (this._notificationState !== State.SHOWING &&
                    this._notificationState !== State.SHOWN &&
                    this._banner)
                    bin.y = this._banner.height;
                return original.apply(this, args);
            });
    }

    destroy() {
        this._injections.clear();
        if (this._bin)
            this._bin.y_align = this._originalAlign;
    }
}
