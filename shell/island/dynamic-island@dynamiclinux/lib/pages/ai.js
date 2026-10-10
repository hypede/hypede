// Чат с ИИ (NVIDIA NIM / любой OpenAI-совместимый API).

import Clutter from 'gi://Clutter';

import {BasePage} from './base.js';
import * as W from '../ui/widgets.js';
import {markdownToPango} from '../pure/textTools.js';

const QUICK = [
    ['📋 Объясни буфер', 'Объясни простыми словами:'],
    ['🌍 Переведи', 'Переведи на английский (если текст на английском — на русский):'],
    ['✂️ Сократи', 'Сократи текст, сохранив смысл:'],
    ['🛠 Исправь ошибки', 'Исправь орфографию и пунктуацию:'],
    ['🐧 Команда Linux', 'Напиши команду bash для задачи (только команда и короткое пояснение):'],
];

export class AIPage extends BasePage {
    constructor(ctx) {
        super(ctx, {cls: 'di-ai'});
        const t = this.theme;
        this._bubbles = new Map();

        const top = W.hbox({style_class: 'di-toolbar', x_expand: true});
        this._model = W.label('', {cls: 'di-small', expand: true, style: `color: ${t.dim};`});
        const clear = W.button({icon: 'edit-clear-all-symbolic', label: 'Новый чат', cls: 'di-chip-btn', onClick: () => this.services.ai.clear()});
        const settings = W.iconButton('emblem-system-symbolic', () => ctx.extension.openPreferences('ai'), {cls: 'di-flat'});
        W.add(top, W.label('✦', {style: `color: ${t.accent}; font-size: 16px; padding-right: 6px;`}), this._model, clear, settings);

        this._list = W.vbox({style_class: 'di-chat', x_expand: true});
        this._scroll = W.scroll(this._list);

        const quick = W.hbox({style_class: 'di-chips'});
        for (const [label, instruction] of QUICK) {
            quick.add_child(W.button({label, cls: 'di-chip-btn', onClick: async () => {
                const text = (await this.services.clipboard.currentText()) ?? '';
                if (!text.trim()) {
                    this._entry.set_text(`${instruction} `);
                    this.focus();
                    return;
                }
                this.services.ai.send(`${instruction}\n\n${text}`);
            }}));
        }

        const inputRow = W.hbox({style_class: 'di-chat-input', x_expand: true});
        this._entry = W.entry({hint: 'Спросите что-нибудь… (Enter — отправить)', onActivate: () => this._send()});
        this._sendBtn = W.iconButton('mail-send-symbolic', () => {
            if (this.services.ai.busy)
                this.services.ai.stop();
            else
                this._send();
        }, {accent: true, theme: t, cls: 'di-send-btn'});
        const mic = W.iconButton('audio-input-microphone-symbolic', () => ctx.actions.voice({target: 'ai'}), {cls: 'di-flat'});
        W.add(inputRow, this._entry, mic, this._sendBtn);

        W.add(this.actor, top, this._scroll, W.scroll(quick, {horizontal: true, cls: 'di-chips-scroll'}), inputRow);

        const ai = this.services.ai;
        this.subs.on(ai, 'changed', () => this._render());
        this.subs.on(ai, 'delta', m => this._updateBubble(m));
        this.subs.connect(this.settings, 'changed::ai-model', () => this._updateModel());
        this._updateModel();
        this._render();
    }

    focus() {
        this._entry.grab_key_focus();
    }

    onShow() {
        super.onShow();
        this.timers.timeout(50, () => W.scrollToBottom(this._scroll));
        if (this.ctx.island.pinned)
            this.focus();
    }

    _updateModel() {
        const key = this.settings.get_string('ai-api-key');
        this._model.text = `${this.settings.get_string('ai-model')}${key ? '' : ' · нужен API-ключ'}`;
    }

    _send() {
        const text = this._entry.get_text().trim();
        if (!text || this.services.ai.busy)
            return;
        this._entry.set_text('');
        this.services.ai.send(text);
    }

    /** Подставить текст и отправить (из других вкладок). */
    ask(text) {
        this.services.ai.send(text);
    }

    _render() {
        const t = this.theme;
        const ai = this.services.ai;
        this._list.destroy_all_children();
        this._bubbles.clear();
        this._sendBtn._icon.icon_name = ai.busy ? 'media-playback-stop-symbolic' : 'mail-send-symbolic';

        if (!ai.messages.length) {
            const hello = W.vbox({style_class: 'di-empty', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            const e = W.label('✨', {cls: 'di-empty-emoji'});
            e.x_align = Clutter.ActorAlign.CENTER;
            const l = W.label(ai.configured
                ? 'Задайте вопрос, попросите перевести текст из буфера\nили написать команду для терминала.'
                : 'Чтобы начать, получите бесплатный API-ключ на build.nvidia.com\n(NVIDIA NIM) и вставьте его в настройках острова → ИИ.',
            {cls: 'di-small', wrap: true, style: `color: ${t.dim}; text-align: center;`});
            l.x_align = Clutter.ActorAlign.CENTER;
            W.add(hello, e, l);
            this._list.add_child(hello);
            return;
        }
        for (const m of ai.messages)
            this._list.add_child(this._bubble(m));
        this.timers.timeout(30, () => W.scrollToBottom(this._scroll));
    }

    _bubble(m) {
        const t = this.theme;
        const user = m.role === 'user';
        const err = m.role === 'error';
        const row = W.hbox({x_expand: true, style_class: 'di-msg-row'});
        const bubble = W.vbox({style_class: `di-msg ${user ? 'di-msg-user' : 'di-msg-ai'}`});
        if (user)
            bubble.style = `background-color: ${t.accent}; color: ${t.accentText};`;
        else if (err)
            bubble.style = `background-color: rgba(255,69,58,0.18); color: ${t.fg};`;
        const text = W.label('', {wrap: true, cls: 'di-msg-text'});
        this._setText(text, m);
        text.clutter_text.selectable = true;
        text.clutter_text.reactive = true;
        bubble.add_child(text);
        if (!user && !m.pending && m.content) {
            const acts = W.hbox({style_class: 'di-msg-actions'});
            acts.add_child(W.iconButton('edit-copy-symbolic', () => this.copy(m.content), {cls: 'di-flat di-mini'}));
            // Если в ответе есть блок кода — кнопка «скопировать код»
            const code = m.content.match(/```[\w-]*\n([\s\S]*?)```/);
            if (code)
                acts.add_child(W.button({label: 'код', icon: 'utilities-terminal-symbolic', cls: 'di-flat di-mini', onClick: () => this.copy(code[1].trim(), 'Код скопирован')}));
            acts.add_child(W.iconButton('document-edit-symbolic', () => this.ctx.sendToNotes(m.content), {cls: 'di-flat di-mini'}));
            bubble.add_child(acts);
        }
        if (user) {
            row.add_child(W.spacer());
            row.add_child(bubble);
        } else {
            row.add_child(bubble);
            row.add_child(W.spacer());
        }
        bubble.x_expand = false;
        this._bubbles.set(m.id, text);
        return row;
    }

    /** Ответы ИИ показываем с простым форматированием Markdown. */
    _setText(label, m) {
        const content = m.content || (m.pending ? '…' : '');
        if (m.role === 'assistant') {
            try {
                label.clutter_text.set_markup(markdownToPango(content));
                return;
            } catch {}
        }
        label.text = content;
    }

    _updateBubble(m) {
        const label = this._bubbles.get(m.id);
        if (label) {
            this._setText(label, m);
            W.scrollToBottom(this._scroll);
        }
    }
}
