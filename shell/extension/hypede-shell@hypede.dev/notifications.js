// Всплывающие уведомления — там, где их ждут в Chrome OS: в правом нижнем
// углу над треем. Можно выбрать и верхний правый угол или центр сверху.
//
// GNOME показывает баннер сверху и «спускает» его вниз. Для нижнего угла
// контейнер баннеров прижимается к низу рабочей области, а появление идёт
// снизу вверх. Рабочая область уже учитывает полку, где бы она ни стояла.

import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {State} from 'resource:///org/gnome/shell/ui/messageTray.js';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

export class NotificationTweaks {
    constructor(settings) {
        this._settings = settings;
        this._tray = Main.messageTray;
        this._bin = this._tray._bannerBin;
        this._injections = new InjectionManager();

        if (!this._bin)
            return;

        this._originalYAlign = this._bin.y_align;
        this._originalAlignment = this._tray.bannerAlignment;

        // Перед показом баннер у нижнего края ставится ниже итогового места,
        // чтобы анимация GNOME (y → 0) подняла его вверх.
        const self = this;
        this._injections.overrideMethod(this._tray, '_updateShowingNotification',
            original => function (...args) {
                if (self._bottom &&
                    this._notificationState !== State.SHOWING &&
                    this._notificationState !== State.SHOWN &&
                    this._banner)
                    self._bin.y = this._banner.height;
                return original.apply(this, args);
            });

        this._settings.connectObject('changed::notification-position', () => this._sync(), this);
        this._sync();
    }

    _sync() {
        const position = this._settings.get_string('notification-position');
        this._bottom = position === 'bottom-right';
        this._bin.y_align = this._bottom ? Clutter.ActorAlign.END : Clutter.ActorAlign.START;
        this._tray.bannerAlignment = position === 'top-center'
            ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.END;
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._injections.clear();
        if (this._bin) {
            this._bin.y_align = this._originalYAlign;
            this._tray.bannerAlignment = this._originalAlignment;
        }
    }
}
