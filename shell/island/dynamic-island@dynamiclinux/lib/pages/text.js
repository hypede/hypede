// Форматирование текста: регистр, раскладка, транслит, base64, JSON и ИИ-обработка.

import {BasePage} from './base.js';
import * as W from '../ui/widgets.js';
import {TRANSFORMS, applyTransform, textStats} from '../pure/textTools.js';

const AI_ACTIONS = [
    ['✨ Лучше', 'Улучши стиль текста, сделай его понятнее и грамотнее, сохранив язык и смысл:'],
    ['🛠 Ошибки', 'Исправь орфографические, грамматические и пунктуационные ошибки:'],
    ['🌍 RU⇄EN', 'Переведи: если текст на русском — на английский, иначе — на русский:'],
    ['👔 Строже', 'Перепиши в официально-деловом стиле:'],
    ['😊 Проще', 'Перепиши в дружелюбном неформальном стиле:'],
    ['✂️ Короче', 'Сократи текст примерно вдвое, сохранив главное:'],
    ['📝 Суть', 'Сделай краткий пересказ в виде списка основных пунктов:'],
];

export class TextPage extends BasePage {
    constructor(ctx) {
        super(ctx, {vertical: false, cls: 'di-text'});
        const t = this.theme;
        this._undo = [];

        // ---------- редактор
        const left = W.vbox({style_class: 'di-col', x_expand: true});
        const bar = W.hbox({style_class: 'di-toolbar', x_expand: true});
        W.add(bar,
            W.button({icon: 'edit-paste-symbolic', label: 'Из буфера', cls: 'di-chip-btn', onClick: () => this._paste()}),
            W.button({icon: 'edit-copy-symbolic', label: 'Копировать', cls: 'di-chip-btn', onClick: () => this.copy(this._entry.get_text())}),
            W.iconButton('edit-undo-symbolic', () => this._undoLast(), {cls: 'di-flat'}),
            W.iconButton('edit-clear-symbolic', () => this._set(''), {cls: 'di-flat'}),
            W.spacer());
        this._stats = W.label('', {cls: 'di-small di-mono', style: `color: ${t.faint};`});
        bar.add_child(this._stats);

        const [editorScroll, entry] = W.editor({hint: 'Вставьте или напишите текст…', cls: 'di-text-editor',
            onChange: () => this._updateStats()});
        this._entry = entry;
        W.add(left, bar, editorScroll);

        // ---------- инструменты
        const right = W.vbox({style_class: 'di-col', width: 300});
        right.add_child(W.label('Преобразования', {cls: 'di-section-title'}));
        const btns = TRANSFORMS.map(([id, label]) => W.button({label, cls: 'di-chip-btn di-tf-btn', onClick: () => this._apply(id)}));
        right.add_child(W.scroll(W.grid(btns, 2, {fill: true})));
        right.add_child(W.label('ИИ', {cls: 'di-section-title'}));
        const aiBtns = AI_ACTIONS.map(([label, instr]) => W.button({label, cls: 'di-chip-btn', onClick: () => this._ai(instr)}));
        right.add_child(W.grid(aiBtns, 3, {fill: true}));

        W.add(this.actor, left, right);
        this._updateStats();
    }

    focus() {
        this._entry.grab_key_focus();
    }

    /** Подставить текст извне. */
    setText(text) {
        this._set(text ?? '');
    }

    _set(text) {
        const cur = this._entry.get_text();
        if (cur !== text) {
            this._undo.push(cur);
            if (this._undo.length > 30)
                this._undo.shift();
        }
        this._entry.set_text(text);
        this._updateStats();
    }

    _undoLast() {
        const prev = this._undo.pop();
        if (prev !== undefined) {
            this._entry.set_text(prev);
            this._updateStats();
        }
    }

    async _paste() {
        const text = await this.services.clipboard.currentText();
        if (text)
            this._set(text);
    }

    _apply(id) {
        const text = this._entry.get_text();
        if (!text)
            return;
        try {
            this._set(applyTransform(id, text));
        } catch (e) {
            this.toast('Не получилось', {icon: 'dialog-warning-symbolic', subtitle: e.message});
        }
    }

    async _ai(instruction) {
        const text = this._entry.get_text();
        if (!text.trim() || this._busy)
            return;
        this._busy = true;
        this._undo.push(text);
        this._stats.text = '✦ ИИ обрабатывает…';
        try {
            const res = await this.services.ai.ask(instruction, text, partial => {
                this._entry.set_text(partial);
            });
            this._entry.set_text(res.trim() || text);
        } catch (e) {
            this._entry.set_text(text);
            this.toast('Ошибка ИИ', {icon: 'dialog-warning-symbolic', subtitle: e.message, duration: 5000});
        } finally {
            this._busy = false;
            this._updateStats();
        }
    }

    _updateStats() {
        const s = textStats(this._entry.get_text());
        this._stats.text = `${s.chars} симв. · ${s.words} сл. · ${s.lines} стр.`;
    }
}
