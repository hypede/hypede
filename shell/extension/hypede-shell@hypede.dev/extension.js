// HypeDE Shell — превращает GNOME Shell в среду с обликом Chrome OS.
//
// HypeDE ничего не рисует поверх GNOME «сбоку»: он переставляет и
// перекрашивает родные части оболочки. Ячейки верхней панели переезжают на
// полку у края экрана, меню даты и быстрые настройки становятся треем в её
// углу, кнопка «Обзор» — кнопкой лаунчера. Поэтому всё, что умеет GNOME
// (сеть, звук, Bluetooth, уведомления), продолжает работать как есть.
//
// В сеансе HypeDE эти компоненты загружает сам режим оболочки
// (modes/hypede.json); они остаются включены и на экране блокировки, где
// HypeDE показывает собственный экран с часами.

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ExtensionGuard} from './guard.js';
import {StyleManager} from './style.js';
import {Shelf} from './shelf.js';
import {Launcher} from './launcher.js';
import {OverviewTweaks} from './overview.js';
import {NotificationTweaks} from './notifications.js';
import {WindowAnimations} from './windows.js';
import {WindowCorners} from './corners.js';
import {LiveWallpaper} from './livewallpaper.js';
import {ChromeQuickSettings} from './quicksettings.js';
import {Assistant} from './assistant.js';
import {Greeting} from './greeting.js';
import {LockScreen} from './lockscreen.js';
import {setupLocker} from './locker.js';

// Запущены ли мы в сеансе HypeDE (а не включены вручную в обычном GNOME).
function inHypeDESession() {
    return GLib.getenv('HYPEDE_SESSION') === '1' ||
        Main.sessionMode.currentMode.startsWith('hypede');
}

export default class HypeDEShellExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        if (inHypeDESession()) {
            this._guard = new ExtensionGuard(this.uuid, this.getSettings('dev.hypede.session'));
            // Без GDM у GNOME нет экрана блокировки — HypeDE создаёт его сам.
            setupLocker();
        }

        this._style = new StyleManager(this._settings);
        // Помощник — раньше лаунчера: лаунчер спрашивает, включён ли он.
        this._assistant = new Assistant();
        this._launcher = new Launcher(this._settings);
        this._shelf = new Shelf(this._settings, this._launcher);
        this._overview = new OverviewTweaks(this._settings, this._launcher);
        this._notifications = new NotificationTweaks(this._settings);
        this._windows = new WindowAnimations(this._settings);
        this._corners = new WindowCorners(this._settings);
        this._live = new LiveWallpaper(this._settings);
        this._quickSettings = new ChromeQuickSettings();
        this._lock = new LockScreen(this._settings, this._shelf);
        if (inHypeDESession())
            this._greeting = new Greeting(this._settings);
    }

    disable() {
        // Порядок обратный: полка держит кнопку лаунчера, поэтому уходит
        // раньше самого лаунчера.
        for (const part of ['_greeting', '_lock', '_quickSettings', '_live', '_corners', '_windows', '_notifications', '_overview',
            '_shelf', '_launcher', '_assistant', '_style', '_guard']) {
            this[part]?.destroy();
            this[part] = null;
        }
        this._settings = null;
    }
}
