// Размытые обои под быстрыми настройками и календарём — как под лаунчером.
//
// Настоящее размытие того, что лежит под меню, пересчитывалось бы каждый
// кадр. Подложка из backdrop.js — заранее уменьшенные обои, растянутые
// видеокартой: размытие выглядит так же, а стоит одну маленькую текстуру.
// Под подложкой меню становится чуть прозрачнее (см. style.js).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Backdrop} from './backdrop.js';

class MenuBackdrop {
    constructor(menu) {
        this._menu = menu;
        this._bin = menu._boxPointer.bin;
        this._box = this._bin.get_child();
        this._bin.set_child(null);
        this._stack = new St.Widget({layout_manager: new Clutter.BinLayout()});
        this._backdrop = new Backdrop();
        this._stack.add_child(this._backdrop);
        this._stack.add_child(this._box);
        for (const coordinate of [Clutter.BindCoordinate.POSITION, Clutter.BindCoordinate.SIZE])
            this._backdrop.add_constraint(new Clutter.BindConstraint({source: this._box, coordinate}));
        this._bin.set_child(this._stack);
        menu._boxPointer.connectObject('notify::allocation', () => this._syncLater(), this);
        menu.connectObject('open-state-changed', (_m, open) => open && this._syncLater(), this);
    }

    _syncLater() {
        if (this._later)
            return;
        this._later = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._later = 0;
            let radius = 0;
            try {
                radius = this._box.get_theme_node().get_border_radius(St.Corner.TOPLEFT);
            } catch {}
            this._backdrop.setCornerRadius(radius);
            this._backdrop.sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        if (this._later)
            global.compositor.get_laters().remove(this._later);
        this._menu._boxPointer.disconnectObject(this);
        this._menu.disconnectObject(this);
        this._bin.set_child(null);
        this._stack.remove_child(this._box);
        this._stack.destroy();
        this._bin.set_child(this._box);
    }
}

export class MenuBlur {
    constructor(settings) {
        this._settings = settings;
        this._backdrops = [];
        settings.connectObject('changed::menu-blur', () => this._sync(),
            'changed::lite-mode', () => this._sync(), this);
        this._sync();
    }

    _sync() {
        this._clear();
        if (!this._settings.get_boolean('menu-blur') || this._settings.get_boolean('lite-mode'))
            return;
        const {quickSettings, dateMenu} = Main.panel.statusArea;
        for (const menu of [quickSettings?.menu, dateMenu?.menu]) {
            if (menu?._boxPointer?.bin?.get_child())
                this._backdrops.push(new MenuBackdrop(menu));
        }
    }

    _clear() {
        for (const b of this._backdrops)
            b.destroy();
        this._backdrops = [];
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._clear();
    }
}
