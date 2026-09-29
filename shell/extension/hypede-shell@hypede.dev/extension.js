// HypeDE Shell — превращает GNOME Shell в среду с обликом Chrome OS.
//
// Расширение ничего не рисует поверх GNOME «сбоку»: оно переставляет и
// перекрашивает родные части оболочки. Верхняя панель становится полкой внизу
// экрана, меню даты и быстрые настройки — треем в правом углу полки, кнопка
// «Обзор» — кнопкой лаунчера. Поэтому всё, что умеет GNOME (сеть, звук,
// Bluetooth, уведомления, блокировка), продолжает работать как есть.

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Shelf} from './shelf.js';
import {Launcher} from './launcher.js';
import {OverviewTweaks} from './overview.js';
import {NotificationTweaks} from './notifications.js';

export default class HypeDEShellExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._launcher = new Launcher(this._settings);
        this._shelf = new Shelf(this._settings, this._launcher);
        this._overview = new OverviewTweaks(this._settings, this._launcher);
        this._notifications = new NotificationTweaks();
    }

    disable() {
        // Порядок обратный: полка держит кнопку лаунчера, поэтому уходит
        // раньше самого лаунчера.
        this._notifications?.destroy();
        this._notifications = null;
        this._overview?.destroy();
        this._overview = null;
        this._shelf?.destroy();
        this._shelf = null;
        this._launcher?.destroy();
        this._launcher = null;
        this._settings = null;
    }
}
