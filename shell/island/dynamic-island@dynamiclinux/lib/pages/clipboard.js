// История буфера обмена.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {BasePage} from './base.js';
import * as W from '../ui/widgets.js';
import {formatBytes, plural, preview, timeAgo} from '../pure/format.js';

const FILTERS = [
    ['all', 'Все'],
    ['text', 'Текст'],
    ['image', 'Картинки'],
    ['files', 'Файлы'],
    ['pinned', '📌'],
];

export class ClipboardPage extends BasePage {
    constructor(ctx) {
        super(ctx, {cls: 'di-clipboard'});
        this._filter = 'all';
        this._query = '';

        const top = W.hbox({style_class: 'di-toolbar', x_expand: true});
        this._entry = W.entry({hint: 'Поиск в истории…', primaryIcon: 'edit-find-symbolic', onChange: t => {
            this._query = t.toLowerCase();
            this._render();
        }});
        this._entry.x_expand = true;
        this._filterBtns = FILTERS.map(([id, label]) => {
            const b = W.button({label, cls: 'di-chip-btn', onClick: () => {
                this._filter = id;
                this._render();
            }});
            b._fid = id;
            return b;
        });
        this._privateBtn = W.iconButton('view-conceal-symbolic', () => {
            this.settings.set_boolean('clipboard-private', !this.settings.get_boolean('clipboard-private'));
        }, {cls: 'di-flat'});
        this._privateBtn.accessible_name = 'Приватный режим';
        const clearBtn = W.iconButton('edit-clear-all-symbolic', () => {
            this.services.clipboard.clear(true);
            this.toast('История очищена', {icon: 'edit-clear-all-symbolic', duration: 1200});
        }, {cls: 'di-flat'});
        W.add(top, this._entry, ...this._filterBtns, this._privateBtn, clearBtn);

        this._status = W.label('', {cls: 'di-small', style: `color: ${this.theme.faint};`});
        this._list = W.vbox({style_class: 'di-clip-list', x_expand: true});
        this._scroll = W.scroll(this._list);
        W.add(this.actor, top, this._scroll, this._status);

        this.subs.on(this.services.clipboard, 'changed', () => {
            if (this.visible)
                this._render();
            else
                this._dirty = true;
        });
        this.subs.connect(this.settings, 'changed::clipboard-private', () => this._render());
        this._render();
    }

    focus() {
        this._entry.grab_key_focus();
    }

    onShow() {
        super.onShow();
        if (this._dirty) {
            this._dirty = false;
            this._render();
        }
    }

    _matches(item) {
        if (this._filter === 'pinned' && !item.pinned)
            return false;
        if (!['all', 'pinned'].includes(this._filter) && item.type !== this._filter)
            return false;
        if (!this._query)
            return true;
        const hay = item.type === 'text' ? item.text : item.type === 'files' ? (item.uris ?? []).join(' ') : item.path;
        return (hay ?? '').toLowerCase().includes(this._query);
    }

    _render() {
        const t = this.theme;
        for (const b of this._filterBtns)
            W.setAccent(b, t, b._fid === this._filter);
        const priv = this.settings.get_boolean('clipboard-private');
        W.setAccent(this._privateBtn, t, priv);

        this._list.destroy_all_children();
        const items = this.services.clipboard.items.filter(i => this._matches(i));
        if (!items.length) {
            const empty = W.vbox({x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'di-empty'});
            const e = W.label('📋', {cls: 'di-empty-emoji', center: true});
            e.x_align = Clutter.ActorAlign.CENTER;
            const l = W.label(this.services.clipboard.items.length ? 'Ничего не найдено' : 'Скопируйте что-нибудь — оно появится здесь',
                {cls: 'di-dim', center: true, style: `color: ${t.dim};`});
            l.x_align = Clutter.ActorAlign.CENTER;
            W.add(empty, e, l);
            this._list.add_child(empty);
        }
        for (const item of items.slice(0, 120))
            this._list.add_child(this._row(item));
        const n = this.services.clipboard.items.length;
        this._status.text = `${n} ${plural(n, ['запись', 'записи', 'записей'])}${priv ? ' · приватный режим: новые записи не сохраняются' : ''} · клик — скопировать`;
    }

    _row(item) {
        const t = this.theme;
        const cb = this.services.clipboard;
        const row = W.button({cls: 'di-clip-row', expand: true});
        const box = W.hbox({x_expand: true});

        let lead;
        let title = '';
        let sub = timeAgo(item.time);
        if (item.type === 'image') {
            lead = W.image(item.path, 56, 40, 8);
            title = 'Изображение';
            if (item.size)
                sub += ` · ${formatBytes(item.size)}`;
        } else if (item.type === 'files') {
            const n = item.uris?.length ?? 0;
            lead = W.icon('folder-documents-symbolic', 22, `color: ${t.accent};`);
            const names = (item.uris ?? []).map(u => {
                try {
                    return GLib.path_get_basename(Gio.File.new_for_uri(u).get_path() ?? u);
                } catch {
                    return u;
                }
            });
            title = names.slice(0, 3).join(', ') + (n > 3 ? ` и ещё ${n - 3}` : '');
            sub += ` · ${n} ${plural(n, ['файл', 'файла', 'файлов'])}`;
        } else {
            const text = item.text ?? '';
            const isUrl = /^https?:\/\/\S+$/.test(text.trim());
            const isColor = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text.trim());
            if (isColor) {
                lead = new W.Ring({size: 22, thickness: 11, color: text.trim(), track: text.trim()});
                lead.value = 1;
            } else {
                lead = W.icon(isUrl ? 'web-browser-symbolic' : 'text-x-generic-symbolic', 20, `color: ${t.dim};`);
            }
            title = preview(text, 140);
            const lines = text.split('\n').length;
            sub += ` · ${[...text].length} симв.${lines > 1 ? ` · ${lines} стр.` : ''}`;
        }
        const texts = W.vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        W.add(texts, W.label(title, {cls: 'di-clip-title'}), W.label(sub, {cls: 'di-small', style: `color: ${t.faint};`}));

        const actions = W.hbox({style_class: 'di-row-actions', y_align: Clutter.ActorAlign.CENTER});
        const pin = W.iconButton(item.pinned ? 'starred-symbolic' : 'non-starred-symbolic', () => cb.togglePin(item), {cls: 'di-flat di-mini'});
        if (item.pinned)
            pin._icon.style = `color: ${t.warning};`;
        actions.add_child(pin);
        if (item.type === 'text') {
            actions.add_child(W.iconButton('format-text-rich-symbolic', () => {
                this.ctx.sendToTextTools(item.text);
            }, {cls: 'di-flat di-mini'}));
            actions.add_child(W.iconButton('document-edit-symbolic', () => {
                this.ctx.sendToNotes(item.text);
            }, {cls: 'di-flat di-mini'}));
        }
        if (item.type === 'image') {
            actions.add_child(W.iconButton('insert-text-symbolic', () => this.ctx.actions.ocrFile(item.path), {cls: 'di-flat di-mini'}));
        }
        if (item.type === 'files') {
            actions.add_child(W.iconButton('folder-open-symbolic', () => {
                this.services.shelf.addUris(item.uris);
                this.toast('Добавлено на полку', {icon: 'folder-open-symbolic', duration: 1200});
            }, {cls: 'di-flat di-mini'}));
        }
        actions.add_child(W.iconButton('user-trash-symbolic', () => cb.remove(item), {cls: 'di-flat di-mini'}));

        W.add(box, lead, texts, actions);
        row.set_child(box);
        row.connect('clicked', () => {
            try {
                cb.copy(item);
                this.toast('Скопировано', {icon: 'edit-copy-symbolic', subtitle: title.slice(0, 60), duration: 1200});
            } catch (e) {
                this.toast('Не удалось скопировать', {icon: 'dialog-warning-symbolic', subtitle: e.message});
            }
        });
        return row;
    }
}
