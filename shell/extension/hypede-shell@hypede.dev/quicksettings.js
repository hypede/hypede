// Быстрые настройки в духе Chrome OS.
//
// У GNOME переключатели — широкие «пилюли» в две колонки. В Chrome OS это
// круглые кнопки со значком и подписью под ними, по три в ряд. Здесь
// перестраиваются родные переключатели GNOME (сеть, Bluetooth, ночной
// режим…), поэтому всё, что они умеют, и переключатели сторонних
// приложений продолжают работать. Ползунки и верхний ряд кнопок занимают
// всю ширину, как и раньше.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const COLUMNS = 3;

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
        // Всё, что занимало всю ширину, занимает её и в трёх колонках.
        const meta = this._layout.get_child_meta(this._grid, child);
        if (meta && meta.columnSpan >= this._oldColumns) {
            record.span = meta.columnSpan;
            meta.columnSpan = COLUMNS;
        }
        if (child._box && child._title !== undefined)
            this._makeTile(child, child, record);
        else if (child._box && child._menuButton)
            this._makeMenuTile(child, record);
        this._changed.set(child, record);
        child.connectObject('destroy', () => this._changed.delete(child), this);
    }

    // Переключатель: значок в круге, подпись под ним.
    _makeTile(tile, toggle, record) {
        tile.add_style_class_name('hypede-tile');
        const box = toggle._box;
        box.orientation = Clutter.Orientation.VERTICAL;
        box.x_align = Clutter.ActorAlign.CENTER;
        toggle._icon.x_align = Clutter.ActorAlign.CENTER;
        const titleBox = toggle._title.get_parent();
        titleBox.x_align = Clutter.ActorAlign.CENTER;
        for (const label of [toggle._title, toggle._subtitle]) {
            label.x_align = Clutter.ActorAlign.CENTER;
            label.clutter_text.line_alignment = 1; // PANGO_ALIGN_CENTER
        }
        record.tile = {tile, toggle};
    }

    // Переключатель с меню: круг включает и выключает, стрелка у подписи
    // открывает подробное меню (список сетей, устройств…).
    _makeMenuTile(tile, record) {
        const contents = tile._box.get_first_child();
        if (!contents?._title)
            return;
        this._makeTile(tile, contents, record);
        const button = tile._menuButton;
        const separator = button.get_previous_sibling();
        const titleBox = contents._title.get_parent();
        const row = new St.BoxLayout({
            style_class: 'hypede-tile-title-row',
            x_align: Clutter.ActorAlign.CENTER,
        });
        titleBox.remove_child(contents._title);
        row.add_child(contents._title);
        tile._box.remove_child(button);
        row.add_child(button);
        titleBox.insert_child_at_index(row, 0);
        button.add_style_class_name('hypede-tile-menu-button');
        button.y_expand = false;
        button.y_align = Clutter.ActorAlign.CENTER;
        const icon = button.get_child();
        record.menu = {tile, contents, button, separator, row, titleBox, iconName: icon.icon_name};
        icon.icon_name = 'pan-down-symbolic';
        separator.hide();
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
            if (record.menu) {
                const {tile, contents, button, separator, row, titleBox, iconName} = record.menu;
                row.remove_child(contents._title);
                row.remove_child(button);
                titleBox.insert_child_at_index(contents._title, 0);
                row.destroy();
                tile._box.add_child(button);
                button.remove_style_class_name('hypede-tile-menu-button');
                button.y_expand = true;
                button.y_align = Clutter.ActorAlign.FILL;
                button.get_child().icon_name = iconName;
                separator.visible = button.visible;
            }
            if (record.tile) {
                const {tile, toggle} = record.tile;
                tile.remove_style_class_name('hypede-tile');
                toggle._box.orientation = Clutter.Orientation.HORIZONTAL;
                toggle._box.x_align = Clutter.ActorAlign.FILL;
                toggle._icon.x_align = Clutter.ActorAlign.FILL;
                toggle._title.get_parent().x_align = Clutter.ActorAlign.START;
                for (const label of [toggle._title, toggle._subtitle]) {
                    label.x_align = Clutter.ActorAlign.START;
                    label.clutter_text.line_alignment = 0;
                }
            }
        }
        this._changed.clear();
        this._layout.nColumns = this._oldColumns;
        this._menu.box.remove_style_class_name('hypede-chrome');
    }
}
