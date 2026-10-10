// Полка файлов (временное хранилище) + загрузки.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {BasePage} from './base.js';
import * as W from '../ui/widgets.js';
import {formatBytes, formatSpeed, plural, timeAgo} from '../pure/format.js';
import {openUri, showInFolder} from '../utils.js';

function fileIcon(item) {
    if (item.isDir)
        return Gio.ThemedIcon.new('folder-symbolic');
    return Gio.content_type_get_symbolic_icon(item.contentType || 'application/octet-stream');
}

function isImage(item) {
    return (item.contentType ?? '').startsWith('image/');
}

export class ShelfPage extends BasePage {
    constructor(ctx) {
        super(ctx, {vertical: false, cls: 'di-shelf'});
        const t = this.theme;

        // ---------- Полка
        const left = W.vbox({style_class: 'di-col', x_expand: true});
        const top = W.hbox({style_class: 'di-toolbar', x_expand: true});
        const title = W.label('Полка', {cls: 'di-heading', expand: true});
        const addBtn = W.button({icon: 'edit-paste-symbolic', label: 'Из буфера', cls: 'di-chip-btn', onClick: () => this._addFromClipboard()});
        const copyAll = W.button({icon: 'edit-copy-symbolic', label: 'Копировать всё', cls: 'di-chip-btn', onClick: () => {
            if (!this.services.shelf.items.length)
                return;
            this.services.shelf.copyToClipboard();
            this.toast('Файлы в буфере — вставьте их в нужную папку (Ctrl+V)', {icon: 'edit-copy-symbolic', duration: 2500});
        }});
        const clear = W.iconButton('edit-clear-all-symbolic', () => this.services.shelf.clear(), {cls: 'di-flat'});
        W.add(top, title, addBtn, copyAll, clear);

        this._list = W.vbox({style_class: 'di-shelf-list', x_expand: true});
        W.add(left, top, W.scroll(this._list));

        // ---------- Загрузки
        const right = W.vbox({style_class: 'di-col', width: 280});
        const dlTop = W.hbox({style_class: 'di-toolbar', x_expand: true});
        W.add(dlTop, W.label('Загрузки', {cls: 'di-heading', expand: true}),
            W.iconButton('folder-download-symbolic', () => openUri(Gio.File.new_for_path(this.services.downloads.dir).get_uri()), {cls: 'di-flat'}));
        this._dlList = W.vbox({style_class: 'di-dl-list', x_expand: true});
        W.add(right, dlTop, W.scroll(this._dlList));

        W.add(this.actor, left, right);

        this.subs.on(this.services.shelf, 'changed', () => this._render());
        this.subs.on(this.services.downloads, 'changed', () => this._renderDownloads());
        this._render();
        this._renderDownloads();
        this._t = t;
    }

    async _addFromClipboard() {
        const uris = await this.services.clipboard.currentFiles();
        if (!uris.length) {
            this.toast('В буфере нет файлов', {icon: 'dialog-information-symbolic', subtitle: 'Скопируйте файлы в файловом менеджере (Ctrl+C)', duration: 2500});
            return;
        }
        const added = await this.services.shelf.addUris(uris);
        if (!added.length)
            this.toast('Эти файлы уже на полке', {icon: 'dialog-information-symbolic', duration: 1500});
    }

    _render() {
        const t = this.theme;
        const shelf = this.services.shelf;
        this._list.destroy_all_children();
        if (!shelf.items.length) {
            const empty = W.vbox({x_expand: true, y_expand: true, style_class: 'di-empty', y_align: Clutter.ActorAlign.CENTER});
            const e = W.label('🗂️', {cls: 'di-empty-emoji'});
            e.x_align = Clutter.ActorAlign.CENTER;
            const l = W.label('Скопируйте файлы (Ctrl+C) в файловом менеджере —\nони окажутся на полке. Отсюда их можно\nвставить куда угодно, даже после удаления оригинала.',
                {cls: 'di-small', wrap: true, style: `color: ${t.dim}; text-align: center;`});
            l.x_align = Clutter.ActorAlign.CENTER;
            W.add(empty, e, l);
            this._list.add_child(empty);
            return;
        }
        for (const item of shelf.items)
            this._list.add_child(this._row(item));
    }

    _row(item) {
        const t = this.theme;
        const shelf = this.services.shelf;
        const row = W.hbox({style_class: 'di-shelf-row', x_expand: true, reactive: true, track_hover: true});
        const lead = isImage(item) ? W.image(item.path, 44, 44, 8) : W.icon(fileIcon(item), 28, `color: ${t.accent};`);
        const texts = W.vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const sub = [item.isDir ? 'папка' : formatBytes(item.size), item.stashed ? 'копия сохранена' : null, timeAgo(item.time)]
            .filter(Boolean).join(' · ');
        W.add(texts, W.label(item.name, {cls: 'di-clip-title'}), W.label(sub, {cls: 'di-small', style: `color: ${t.faint};`}));

        const acts = W.hbox({style_class: 'di-row-actions', y_align: Clutter.ActorAlign.CENTER});
        const btn = (icon, tip, fn) => {
            const b = W.iconButton(icon, async () => {
                try {
                    await fn();
                } catch (e) {
                    this.toast('Ошибка', {icon: 'dialog-warning-symbolic', subtitle: e.message});
                }
            }, {cls: 'di-flat di-mini'});
            b.accessible_name = tip;
            acts.add_child(b);
        };
        btn('document-open-symbolic', 'Открыть', () => {
            openUri(Gio.File.new_for_path(item.path).get_uri());
            this.ctx.island.collapse();
        });
        btn('edit-copy-symbolic', 'Скопировать файл', () => {
            shelf.copyToClipboard([item]);
            this.toast('Файл в буфере', {icon: 'edit-copy-symbolic', subtitle: 'Вставьте его в нужную папку (Ctrl+V)', duration: 2000});
        });
        btn('folder-download-symbolic', 'Копировать в «Загрузки»', async () => {
            await shelf.sendTo(item, this.services.downloads.dir);
            this.toast('Скопировано в «Загрузки»', {icon: 'folder-download-symbolic', duration: 1500});
        });
        btn('user-desktop-symbolic', 'Копировать на рабочий стол', async () => {
            const desk = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) ?? GLib.get_home_dir();
            await shelf.sendTo(item, desk);
            this.toast('Скопировано на рабочий стол', {icon: 'user-desktop-symbolic', duration: 1500});
        });
        if (!item.stashed) {
            btn('document-save-symbolic', 'Сохранить временную копию', async () => {
                await shelf.stash(item);
                this.toast('Копия сохранена на полке', {icon: 'document-save-symbolic', duration: 1500});
            });
        }
        if (isImage(item))
            btn('insert-text-symbolic', 'Распознать текст', () => this.ctx.actions.ocrFile(item.path));
        btn('view-reveal-symbolic', 'Показать в папке', () => showInFolder(item.path));
        btn('window-close-symbolic', 'Убрать с полки', () => shelf.remove(item));

        W.add(row, lead, texts, acts);
        return row;
    }

    _renderDownloads() {
        const t = this.theme;
        const dl = this.services.downloads;
        this._dlList.destroy_all_children();
        for (const d of dl.active.values()) {
            const card = W.card(true, {cls: 'di-dl-card'});
            card.add_child(W.label(d.name, {cls: 'di-clip-title'}));
            const bar = new W.ProgressBar({height: 4, color: t.accent});
            // Размер файла неизвестен — показываем «бегущий» индикатор
            bar.value = 0.15 + ((Date.now() / 1500) % 1) * 0.7;
            card.add_child(bar);
            card.add_child(W.label(`${formatBytes(d.size)} · ${formatSpeed(d.speed)}`, {cls: 'di-small di-mono', style: `color: ${t.dim};`}));
            this._dlList.add_child(card);
        }
        for (const d of dl.recent) {
            const row = W.button({cls: 'di-dl-row', expand: true, onClick: () => {
                if (d.path)
                    openUri(Gio.File.new_for_path(d.path).get_uri());
                this.ctx.island.collapse();
            }});
            const box = W.hbox({x_expand: true});
            const texts = W.vbox({x_expand: true});
            W.add(texts, W.label(d.name, {cls: 'di-clip-title'}),
                W.label(`${formatBytes(d.size)} · ${timeAgo(d.finished)}`, {cls: 'di-small', style: `color: ${t.faint};`}));
            W.add(box, W.icon('emblem-ok-symbolic', 18, `color: ${t.success};`), texts);
            row.set_child(box);
            this._dlList.add_child(row);
        }
        if (!dl.active.size && !dl.recent.length) {
            this._dlList.add_child(W.label(`Активных загрузок нет.\nОстров следит за папкой:\n${dl.dir}`,
                {cls: 'di-small', wrap: true, style: `color: ${t.faint};`}));
        }
        const n = dl.active.size;
        if (n)
            this._dlList.insert_child_at_index(W.label(`${n} ${plural(n, ['загрузка', 'загрузки', 'загрузок'])}`, {cls: 'di-small', style: `color: ${t.dim};`}), 0);
    }
}
