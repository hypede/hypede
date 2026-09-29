// Обзор и клавиша Super в духе Chrome OS.
//
// * Super открывает лаунчер, а не обзор (можно переключить в настройках).
// * В обзоре нет дока и строки поиска — только окна и рабочие столы сверху,
//   как «Обзор» и «Рабочие столы» в Chrome OS. Набор текста в обзоре
//   открывает лаунчер с этим текстом.
// * Сеанс начинается на рабочем столе, а не в обзоре.

import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class OverviewTweaks {
    constructor(settings, launcher) {
        this._settings = settings;
        this._launcher = launcher;

        const controls = Main.overview._overview?._controls;
        this._controls = controls;

        // Док и строка поиска прячутся, а место под ними обнуляется, чтобы
        // раскладка обзора отдала его окнам.
        this._hidden = [Main.overview.dash, controls?._searchEntryBin].filter(Boolean);
        for (const actor of this._hidden) {
            actor._hypedeHeight = actor.height;
            actor.hide();
            actor.set_height(0);
        }

        // Набор текста в обзоре → лаунчер.
        const searchController = controls?._searchController;
        if (searchController) {
            this._searchController = searchController;
            searchController.startSearch = event => {
                const unicode = event.get_key_unicode();
                const text = unicode && unicode.charCodeAt(0) >= 0x20 ? unicode : '';
                Main.overview.hide();
                this._launcher.open(text);
            };
        }

        // Клавиша Super: заглушаем обработчик обзора и ставим свой.
        this._overlayHandler = GObject.signal_handler_find(global.display,
            {signalId: 'overlay-key'});
        if (this._overlayHandler)
            GObject.signal_handler_block(global.display, this._overlayHandler);
        global.display.connectObject('overlay-key', () => this._onOverlayKey(), this);

        // Начало сеанса — сразу на рабочий стол. Расширения грузятся
        // асинхронно и могут опоздать к началу анимации входа, поэтому
        // обзор ещё и закрывается по её окончании.
        if (Main.layoutManager._startingUp) {
            this._hadOverview = Main.sessionMode.hasOverview;
            Main.sessionMode.hasOverview = false;
            Main.layoutManager.connectObject('startup-complete', () => {
                Main.sessionMode.hasOverview = this._hadOverview;
                delete this._hadOverview;
                Main.layoutManager.disconnectObject(this);
                if (Main.overview.visible)
                    Main.overview.hide();
            }, this);
        }
    }

    _onOverlayKey() {
        if (this._settings.get_string('super-key-action') === 'overview') {
            this._launcher.close();
            Main.overview.toggle();
            return;
        }
        if (Main.overview.visible)
            Main.overview.hide();
        this._launcher.toggle();
    }

    destroy() {
        global.display.disconnectObject(this);
        if (this._overlayHandler)
            GObject.signal_handler_unblock(global.display, this._overlayHandler);

        if (this._hadOverview !== undefined)
            Main.sessionMode.hasOverview = this._hadOverview;
        Main.layoutManager.disconnectObject(this);

        if (this._searchController)
            delete this._searchController.startSearch;

        for (const actor of this._hidden) {
            actor.set_height(-1);
            actor.show();
        }
        this._hidden = [];
    }
}
