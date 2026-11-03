// Быстрые настройки в духе Chrome OS 2024+ («Jelly», Material 3).
//
// В новых Chrome OS переключатели — плитки-«пилюли» в две колонки:
// значок в круге слева, название и состояние справа, у плиток с
// подробностями (сеть, Bluetooth) — стрелка «>» внутри той же пилюли.
// Здесь перекрашиваются и чуть перестраиваются родные переключатели GNOME
// (сеть, Bluetooth, ночной режим…), поэтому всё, что они умеют, и
// переключатели сторонних приложений продолжают работать. Ползунки
// громкости и яркости становятся толстыми полосами (см. стили
// .hypede-chrome).

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const COLUMNS = 2;

export class ChromeQuickSettings {
    constructor() {
        this._menu = Main.panel.statusArea.quickSettings?.menu;
        if (!this._menu?._grid)
            return;
        this._grid = this._menu._grid;
        this._layout = this._grid.layout_manager;
        this._oldColumns = this._layout.nColumns;
        this._changed = new Map();

        this._menu.box.add_style_class_name('hypede-chrome');
        this._layout.nColumns = COLUMNS;
        for (const child of this._grid)
            this._adapt(child);
        // Ширину нового элемента GNOME задаёт сразу после добавления.
        this._grid.connectObject('child-added', (_grid, child) => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (this._grid && child.get_parent() === this._grid)
                    this._adapt(child);
                return GLib.SOURCE_REMOVE;
            });
        }, this);
    }

    _adapt(child) {
        if (this._changed.has(child) || child === this._layout._overlay)
            return;
        const record = {};
        // Всё, что занимало всю ширину, занимает её и в новой сетке.
        const meta = this._layout.get_child_meta(this._grid, child);
        if (meta && meta.columnSpan >= this._oldColumns && meta.columnSpan !== COLUMNS) {
            record.span = meta.columnSpan;
            meta.columnSpan = COLUMNS;
        }
        if (child._box && child._title !== undefined) {
            child.add_style_class_name('hypede-tile');
            record.tile = child;
        } else if (child._box && child._menuButton) {
            this._makeMenuTile(child, record);
        }
        this._changed.set(child, record);
        child.connectObject('destroy', () => this._changed.delete(child), this);
    }

    // Переключатель с меню: левая часть включает и выключает, стрелка
    // справа открывает подробное меню (список сетей, устройств…).
    _makeMenuTile(tile, record) {
        const button = tile._menuButton;
        const separator = button.get_previous_sibling();
        const icon = button.get_child();
        tile.add_style_class_name('hypede-tile');
        button.add_style_class_name('hypede-tile-menu-button');
        record.menu = {tile, button, separator, iconName: icon?.icon_name};
        if (icon)
            icon.icon_name = 'pan-end-symbolic';
        separator?.hide();
    }

    destroy() {
        if (!this._grid)
            return;
        this._grid.disconnectObject(this);
        const grid = this._grid;
        this._grid = null;
        for (const [child, record] of this._changed) {
            child.disconnectObject(this);
            if (record.span !== undefined) {
                const meta = this._layout.get_child_meta(grid, child);
                if (meta)
                    meta.columnSpan = record.span;
            }
            record.tile?.remove_style_class_name('hypede-tile');
            if (record.menu) {
                const {tile, button, separator, iconName} = record.menu;
                tile.remove_style_class_name('hypede-tile');
                button.remove_style_class_name('hypede-tile-menu-button');
                if (iconName)
                    button.get_child().icon_name = iconName;
                if (separator)
                    separator.visible = button.visible;
            }
        }
        this._changed.clear();
        this._layout.nColumns = this._oldColumns;
        this._menu.box.remove_style_class_name('hypede-chrome');
    }
}
