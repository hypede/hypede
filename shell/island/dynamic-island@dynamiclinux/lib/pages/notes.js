// Заметки с автосохранением.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {BasePage} from './base.js';
import * as W from '../ui/widgets.js';
import {preview, timeAgo} from '../pure/format.js';

export class NotesPage extends BasePage {
    constructor(ctx) {
        super(ctx, {vertical: false, cls: 'di-notes'});
        const t = this.theme;
        this._note = null;

        // ---------- список
        const left = W.vbox({style_class: 'di-col', width: 240});
        const lTop = W.hbox({style_class: 'di-toolbar', x_expand: true});
        this._search = W.entry({hint: 'Поиск…', primaryIcon: 'edit-find-symbolic', onChange: () => this._renderList()});
        W.add(lTop, this._search, W.iconButton('list-add-symbolic', () => this._new(), {accent: true, theme: t, cls: 'di-add-btn'}));
        this._list = W.vbox({style_class: 'di-note-list', x_expand: true});
        W.add(left, lTop, W.scroll(this._list));

        // ---------- редактор
        const right = W.vbox({style_class: 'di-col di-note-editor-col', x_expand: true});
        const rTop = W.hbox({style_class: 'di-toolbar', x_expand: true});
        this._meta = W.label('', {cls: 'di-small', expand: true, style: `color: ${t.faint};`});
        this._colorBtn = new St.Button({style_class: 'di-color-dot', width: 18, height: 18, y_align: Clutter.ActorAlign.CENTER});
        this._colorBtn.connect('clicked', () => {
            if (this._note) {
                this.services.notes.cycleColor(this._note);
                this._sync();
            }
        });
        this._pinBtn = W.iconButton('view-pin-symbolic', () => this._note && this.services.notes.togglePin(this._note), {cls: 'di-flat'});
        const copyBtn = W.iconButton('edit-copy-symbolic', () => this._note && this.copy(this._note.text), {cls: 'di-flat'});
        const fmtBtn = W.iconButton('format-text-rich-symbolic', () => this._note && ctx.sendToTextTools(this._note.text), {cls: 'di-flat'});
        const aiBtn = W.iconButton('mail-send-symbolic', () => {
            if (this._note?.text) {
                this.services.ai.send(`Вот моя заметка:\n\n${this._note.text}\n\nПомоги её структурировать и дополнить.`);
                ctx.expandedTab('ai');
            }
        }, {cls: 'di-flat'});
        const delBtn = W.iconButton('user-trash-symbolic', () => this._delete(), {cls: 'di-flat'});
        W.add(rTop, this._colorBtn, this._meta, this._pinBtn, copyBtn, fmtBtn, aiBtn, delBtn);

        const [editorScroll, editor] = W.editor({hint: 'Начните писать…', cls: 'di-note-editor', onChange: text => {
            if (this._note && !this._loading) {
                this.services.notes.update(this._note, text);
                this._meta.text = 'Сохранено';
                this._queueListUpdate();
            }
        }});
        this._editor = editor;
        W.add(right, rTop, editorScroll);

        W.add(this.actor, left, right);

        this.subs.on(this.services.notes, 'changed', () => {
            if (!this._note || !this.services.notes.notes.includes(this._note))
                this._note = this.services.notes.sorted[0] ?? null;
            this._renderList();
            this._sync();
        });
        this._note = this.services.notes.sorted[0] ?? null;
        this._renderList();
        this._sync();
    }

    focus() {
        this._editor.grab_key_focus();
    }

    /** Создать заметку с текстом (из других вкладок). */
    addText(text) {
        this._note = this.services.notes.create(text);
        this._renderList();
        this._sync();
    }

    _new() {
        this._note = this.services.notes.create('');
        this._renderList();
        this._sync();
        this.focus();
    }

    _delete() {
        if (!this._note)
            return;
        const n = this._note;
        this._note = null;
        this.services.notes.remove(n);
        this.toast('Заметка удалена', {icon: 'user-trash-symbolic', duration: 1200});
    }

    _queueListUpdate() {
        if (this._listId)
            return;
        this._listId = this.timers.timeout(700, () => {
            this._listId = 0;
            this._renderList();
        });
    }

    _renderList() {
        const t = this.theme;
        const notes = this.services.notes;
        const q = this._search.get_text().toLowerCase();
        this._list.destroy_all_children();
        for (const n of notes.sorted) {
            if (q && !n.text.toLowerCase().includes(q))
                continue;
            const row = W.button({cls: 'di-note-row', expand: true, onClick: () => {
                this._note = n;
                this._renderList();
                this._sync();
            }});
            const box = W.hbox({x_expand: true});
            const dot = new St.Widget({style_class: 'di-note-dot', width: 4, style: `background-color: ${n.color};`});
            dot.y_expand = true;
            const texts = W.vbox({x_expand: true});
            W.add(texts,
                W.label(`${n.pinned ? '📌 ' : ''}${preview(notes.title(n), 40)}`, {cls: 'di-clip-title'}),
                W.label(timeAgo(n.updated), {cls: 'di-small', style: `color: ${t.faint};`}));
            W.add(box, dot, texts);
            row.set_child(box);
            if (n === this._note)
                row.add_style_pseudo_class('checked');
            this._list.add_child(row);
        }
    }

    _sync() {
        const n = this._note;
        this._loading = true;
        this._editor.set_text(n?.text ?? '');
        this._editor.reactive = !!n;
        this._loading = false;
        this._colorBtn.style = `background-color: ${n?.color ?? '#888'};`;
        W.setAccent(this._pinBtn, this.theme, !!n?.pinned);
        this._meta.text = n ? `Изменено ${timeAgo(n.updated)}` : 'Нет заметок — нажмите «+»';
    }
}
