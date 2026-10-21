// Обзор и клавиша Super в духе Chrome OS.
//
// * Super открывает лаунчер, а не обзор (можно переключить в настройках).
// * В обзоре нет дока и строки поиска — только окна и рабочие столы сверху,
//   как «Обзор» и «Рабочие столы» в Chrome OS. Набор текста в обзоре
//   открывает лаунчер с этим текстом.
// * Сеанс начинается на рабочем столе, а не в обзоре.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Backdrop} from './backdrop.js';

const OVERVIEW_FADE = 250;

// Кнопка обзора в трее полки — как «Обзор» в Chrome OS.
const OverviewButton = GObject.registerClass(
class OverviewButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, _('Overview'), true);
        this.add_style_class_name('hypede-overview-button');
        this.add_child(new St.Icon({icon_name: 'view-grid-symbolic', style_class: 'system-status-icon'}));
        this.connect('button-press-event', () => {
            Main.overview.toggle();
            return Clutter.EVENT_STOP;
        });
        this.connect('touch-event', (_a, event) => {
            if (event.type() === Clutter.EventType.TOUCH_BEGIN)
                Main.overview.toggle();
            return Clutter.EVENT_STOP;
        });
    }
});

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

        // Фон обзора — размытые обои (дёшево: см. backdrop.js) с затемнением,
        // проявляются вместе с обзором.
        this._backdrops = [];
        Main.overview.connectObject(
            'showing', () => this._fadeBackdrops(true),
            'hiding', () => this._fadeBackdrops(false),
            'hidden', () => this._dropBackdrops(),
            this);

        // Super+W и кнопка в трее.
        Main.wm.addKeybinding('overview-key', settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => {
                this._launcher.close();
                Main.overview.toggle();
            });
        settings.connectObject('changed::shelf-overview-button', () => this._syncButton(), this);
        this._syncButton();

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

    _syncButton() {
        const want = this._settings.get_boolean('shelf-overview-button');
        if (want && !this._button) {
            this._button = new OverviewButton();
            Main.panel.addToStatusArea('hypede-overview', this._button, 0, 'right');
        } else if (!want && this._button) {
            this._button.destroy();
            this._button = null;
        }
    }

    _fadeBackdrops(show) {
        if (this._settings.get_boolean('lite-mode'))
            return;
        if (show && this._backdrops.length === 0) {
            const group = Main.layoutManager.overviewGroup;
            for (const monitor of Main.layoutManager.monitors) {
                const backdrop = new Backdrop();
                backdrop.set_position(monitor.x, monitor.y);
                backdrop.set_size(monitor.width, monitor.height);
                const shade = new St.Widget({style_class: 'hypede-overview-shade', x_expand: true, y_expand: true});
                shade.add_constraint(new Clutter.BindConstraint({source: backdrop, coordinate: Clutter.BindCoordinate.SIZE}));
                backdrop.add_child(shade);
                backdrop.opacity = 0;
                group.insert_child_at_index(backdrop, 0);
                backdrop.sync();
                this._backdrops.push(backdrop);
            }
        }
        for (const backdrop of this._backdrops) {
            backdrop.ease({
                opacity: show ? 255 : 0,
                duration: OVERVIEW_FADE,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    _dropBackdrops() {
        for (const backdrop of this._backdrops)
            backdrop.destroy();
        this._backdrops = [];
    }

    _onOverlayKey() {
        if (Main.sessionMode.isLocked)
            return;
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
        Main.overview.disconnectObject(this);
        this._settings.disconnectObject(this);
        Main.wm.removeKeybinding('overview-key');
        this._button?.destroy();
        this._button = null;
        this._dropBackdrops();
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
