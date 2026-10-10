// Инструменты: голос в текст, запись экрана, текст с экрана (OCR), пипетка, скриншот.

import Clutter from 'gi://Clutter';

import {BasePage} from './base.js';
import * as W from '../ui/widgets.js';
import {formatDuration, rgbToHsl} from '../pure/format.js';
import {hasProgram, showInFolder} from '../utils.js';

export class ToolsPage extends BasePage {
    constructor(ctx) {
        super(ctx, {cls: 'di-tools'});
        const t = this.theme;
        this._colors = [];

        const row1 = W.hbox({x_expand: true, y_expand: true, style_class: 'di-tools-row'});
        const row2 = W.hbox({x_expand: true, y_expand: true, style_class: 'di-tools-row'});

        // ---------- Голос
        const voice = W.card(true, {cls: 'di-tool-card', expandY: true});
        const vHead = W.hbox({x_expand: true});
        W.add(vHead, W.label('🎙  Голос в текст', {cls: 'di-heading', expand: true}));
        this._voiceBtn = W.button({icon: 'audio-input-microphone-symbolic', label: 'Говорить', cls: 'di-big-btn', onClick: () => ctx.actions.voice()});
        this._voiceState = W.label('', {cls: 'di-small', style: `color: ${t.dim};`});
        this._voiceText = W.label('', {wrap: true, cls: 'di-tool-result'});
        this._voiceText.clutter_text.selectable = true;
        const vActs = W.hbox({style_class: 'di-row-actions'});
        vActs.add_child(W.iconButton('edit-copy-symbolic', () => this.copy(this.services.voice.lastText), {cls: 'di-flat di-mini'}));
        vActs.add_child(W.button({icon: 'mail-send-symbolic', label: 'в ИИ', cls: 'di-flat di-mini', onClick: () => {
            if (this.services.voice.lastText) {
                this.services.ai.send(this.services.voice.lastText);
                ctx.expandedTab('ai');
            }
        }}));
        vActs.add_child(W.iconButton('document-edit-symbolic', () => ctx.sendToNotes(this.services.voice.lastText), {cls: 'di-flat di-mini'}));
        this._voiceActs = vActs;
        W.add(voice, vHead, this._voiceBtn, this._voiceState, W.scroll(this._voiceText), vActs);

        // ---------- Запись экрана
        const rec = W.card(true, {cls: 'di-tool-card', expandY: true});
        W.add(rec, W.label('⏺  Запись экрана', {cls: 'di-heading'}));
        this._recBtn = W.button({icon: 'media-record-symbolic', label: 'Записать весь экран', cls: 'di-big-btn', onClick: () => this._toggleRecording()});
        const recArea = W.button({icon: 'zoom-fit-best-symbolic', label: 'Область или окно…', cls: 'di-chip-btn', onClick: () => this._run(async () => {
            ctx.island.collapse();
            await this.services.recorder.openRecorderUI();
        })});
        const shot = W.button({icon: 'camera-photo-symbolic', label: 'Скриншот…', cls: 'di-chip-btn', onClick: () => this._run(async () => {
            ctx.island.collapse();
            await this.services.recorder.openScreenshotUI();
        })});
        const recRow = W.hbox({style_class: 'di-chips'});
        W.add(recRow, recArea, shot);
        this._recInfo = W.label('', {cls: 'di-small', wrap: true, style: `color: ${t.dim};`});
        this._recOpen = W.button({icon: 'folder-videos-symbolic', label: 'Показать запись', cls: 'di-flat di-mini', onClick: () => {
            if (this.services.recorder.lastPath)
                showInFolder(this.services.recorder.lastPath);
        }});
        W.add(rec, this._recBtn, recRow, this._recInfo, this._recOpen);

        // ---------- OCR
        const ocr = W.card(true, {cls: 'di-tool-card', expandY: true, expandX: true});
        const oHead = W.hbox({x_expand: true});
        W.add(oHead, W.label('🔤  Текст с экрана', {cls: 'di-heading', expand: true}));
        const ocrBtns = W.hbox({style_class: 'di-chips'});
        W.add(ocrBtns,
            W.button({icon: 'zoom-fit-best-symbolic', label: 'Выделить область', cls: 'di-chip-btn', onClick: () => ctx.actions.ocr()}),
            W.button({icon: 'insert-image-symbolic', label: 'Картинка из буфера', cls: 'di-chip-btn', onClick: () => ctx.actions.ocrClipboard()}));
        this._ocrText = W.label('', {wrap: true, cls: 'di-tool-result'});
        this._ocrText.clutter_text.selectable = true;
        const oActs = W.hbox({style_class: 'di-row-actions'});
        oActs.add_child(W.iconButton('edit-copy-symbolic', () => this.copy(this.services.capture.lastOcr), {cls: 'di-flat di-mini'}));
        oActs.add_child(W.iconButton('format-text-rich-symbolic', () => ctx.sendToTextTools(this.services.capture.lastOcr), {cls: 'di-flat di-mini'}));
        oActs.add_child(W.button({icon: 'mail-send-symbolic', label: 'в ИИ', cls: 'di-flat di-mini', onClick: () => {
            const txt = this.services.capture.lastOcr;
            if (txt) {
                this.services.ai.send(`Вот текст, распознанный с экрана. Помоги с ним:\n\n${txt}`);
                ctx.expandedTab('ai');
            }
        }}));
        this._ocrActs = oActs;
        this._ocrHint = W.label(hasProgram('tesseract') ? '' : 'Нужен tesseract: sudo apt install tesseract-ocr tesseract-ocr-rus',
            {cls: 'di-small', wrap: true, style: `color: ${t.warning};`});
        W.add(ocr, oHead, ocrBtns, this._ocrHint, W.scroll(this._ocrText), oActs);

        // ---------- Пипетка
        const picker = W.card(true, {cls: 'di-tool-card', expandY: true});
        W.add(picker, W.label('🎨  Пипетка', {cls: 'di-heading'}));
        W.add(picker, W.button({icon: 'color-select-symbolic', label: 'Взять цвет с экрана', cls: 'di-big-btn', onClick: () => ctx.actions.pickColor()}));
        this._colorList = W.vbox({style_class: 'di-color-list'});
        W.add(picker, W.scroll(this._colorList));

        W.add(row1, voice, rec);
        W.add(row2, ocr, picker);
        voice.x_expand = true;
        rec.width = 260;
        picker.width = 260;
        W.add(this.actor, row1, row2);

        const s = this.services;
        this.subs.on(s.voice, 'changed', () => this._updateVoice());
        this.subs.on(s.voice, 'result', () => this._updateVoice());
        this.subs.on(s.recorder, 'changed', () => this._updateRec());
        this.subs.on(s.capture, 'ocr', () => this._updateOcr());
        this.subs.on(s.capture, 'changed', () => this._updateOcr());
        this.subs.on(s.capture, 'color', c => this._addColor(c));
        this.subs.on(ctx.tick, 'second', () => {
            if (this.visible && (s.recorder.recording || s.voice.recording)) {
                this._updateRec();
                this._updateVoice();
            }
        });
        this._updateVoice();
        this._updateRec();
        this._updateOcr();
    }

    async _run(fn) {
        try {
            await fn();
        } catch (e) {
            this.toast('Ошибка', {icon: 'dialog-warning-symbolic', subtitle: e.message});
        }
    }

    _toggleRecording() {
        const r = this.services.recorder;
        const starting = !r.recording;
        if (starting)
            this.ctx.island.collapse();
        this._run(() => r.toggle());
    }

    _updateVoice() {
        const v = this.services.voice;
        const t = this.theme;
        const states = {
            idle: v.error ? `⚠ ${v.error}` : 'Нажмите и говорите, затем нажмите ещё раз',
            recording: `● Запись… ${formatDuration((Date.now() - v.started) / 1000)}`,
            transcribing: 'Распознаю речь…',
        };
        this._voiceState.text = states[v.state];
        this._voiceState.style = `color: ${v.state === 'recording' ? t.danger : v.error ? t.warning : t.dim};`;
        this._voiceBtn._label.text = v.state === 'recording' ? 'Остановить' : v.state === 'transcribing' ? 'Подождите…' : 'Говорить';
        this._voiceBtn.style = v.state === 'recording' ? `background-color: ${t.danger}; color: #fff;` : '';
        this._voiceText.text = v.lastText || '';
        this._voiceActs.visible = !!v.lastText;
    }

    _updateRec() {
        const r = this.services.recorder;
        const t = this.theme;
        this._recBtn._label.text = r.recording ? `Остановить · ${formatDuration(r.elapsed)}` : 'Записать весь экран';
        this._recBtn.style = r.recording ? `background-color: ${t.danger}; color: #fff;` : '';
        this._recBtn._icon.icon_name = r.recording ? 'media-playback-stop-symbolic' : 'media-record-symbolic';
        this._recInfo.text = r.recording
            ? 'Идёт запись. Остановить можно здесь или кликом по острову.'
            : 'Записи сохраняются в «Видео/Screencasts» (папку можно сменить в настройках).';
        this._recOpen.visible = !!r.lastPath && !r.recording;
    }

    _updateOcr() {
        const c = this.services.capture;
        this._ocrText.text = c.busy ? 'Распознаю…' : (c.lastOcr || '');
        this._ocrActs.visible = !!c.lastOcr && !c.busy;
    }

    _addColor(c) {
        this._colors.unshift(c);
        this._colors = this._colors.slice(0, 8);
        this._colorList.destroy_all_children();
        for (const col of this._colors) {
            const hsl = rgbToHsl(col.r, col.g, col.b);
            const row = W.hbox({style_class: 'di-color-row', x_expand: true});
            const sw = new W.Ring({size: 26, thickness: 13, color: col.hex, track: col.hex});
            sw.value = 1;
            const formats = [col.hex, col.css, `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`];
            const box = W.vbox({x_expand: true});
            for (const f of formats) {
                box.add_child(W.button({label: f, cls: 'di-flat di-mini di-mono', xAlign: Clutter.ActorAlign.START, onClick: () => this.copy(f)}));
            }
            W.add(row, sw, box);
            this._colorList.add_child(row);
        }
    }

    onShow() {
        super.onShow();
        this._updateVoice();
        this._updateRec();
    }
}
