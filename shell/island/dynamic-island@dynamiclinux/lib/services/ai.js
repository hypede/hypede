// Чат с ИИ через OpenAI-совместимый API (по умолчанию NVIDIA NIM: integrate.api.nvidia.com).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Emitter, dataDir, decoder, httpSession, makeMessage, readJson, readLines, uid, writeJson} from '../utils.js';

/**
 * @typedef {object} ChatMessage
 * @property {string} id
 * @property {'user'|'assistant'|'system'|'error'} role
 * @property {string} content
 * @property {number} time
 */

/** Убирает блоки размышлений моделей (<think>…</think>). */
export function stripThinking(text) {
    let t = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
    // Незакрытый блок размышлений во время стриминга
    const open = t.indexOf('<think>');
    if (open !== -1)
        t = t.slice(0, open);
    return t;
}

export class AIService extends Emitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._file = GLib.build_filenamev([dataDir(), 'chat.json']);
        /** @type {ChatMessage[]} */
        this.messages = [];
        this.busy = false;
        this._cancellable = null;
        readJson(this._file, []).then(m => {
            if (Array.isArray(m) && m.length) {
                // Сообщения, отправленные до окончания загрузки, не теряем
                this.messages = [...m.slice(-100), ...this.messages];
                this.emit('changed');
            }
        });
    }

    get configured() {
        return !!this._settings.get_string('ai-api-key').trim() ||
            !this._settings.get_string('ai-endpoint').includes('nvidia.com');
    }

    _save() {
        writeJson(this._file, this.messages.filter(m => m.role !== 'error').slice(-100)).catch(() => {});
    }

    _headers() {
        const key = this._settings.get_string('ai-api-key').trim();
        const h = {Accept: 'application/json'};
        if (key)
            h.Authorization = `Bearer ${key}`;
        return h;
    }

    _body(messages, stream) {
        return {
            model: this._settings.get_string('ai-model'),
            messages,
            temperature: this._settings.get_double('ai-temperature'),
            max_tokens: this._settings.get_int('ai-max-tokens'),
            stream,
        };
    }

    _clean(text) {
        return this._settings.get_boolean('ai-hide-thinking') ? stripThinking(text) : text;
    }

    /**
     * Отправляет запрос; onDelta вызывается с накопленным текстом.
     *
     * @param {Array<{role: string, content: string}>} messages
     * @param {(text: string) => void} onDelta
     * @param {Gio.Cancellable} cancellable
     * @returns {Promise<string>}
     */
    async complete(messages, onDelta = () => {}, cancellable = null) {
        const endpoint = this._settings.get_string('ai-endpoint').trim();
        if (!endpoint)
            throw new Error('Не указан адрес API (Настройки → ИИ)');
        if (!this.configured)
            throw new Error('Не указан API-ключ NVIDIA NIM. Получите ключ на build.nvidia.com и вставьте его в настройках острова.');
        const stream = this._settings.get_boolean('ai-stream');
        const msg = makeMessage('POST', endpoint, {
            headers: {...this._headers(), Accept: stream ? 'text/event-stream' : 'application/json'},
            json: this._body(messages, stream),
        });
        const session = httpSession();

        if (!stream) {
            const bytes = await session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable);
            const text = decoder.decode(bytes.get_data() ?? new Uint8Array());
            const status = msg.status_code;
            if (status < 200 || status >= 300)
                throw new Error(this._errorText(status, text));
            const j = JSON.parse(text);
            const out = this._clean(j.choices?.[0]?.message?.content ?? '');
            onDelta(out);
            return out;
        }

        const input = await session.send_async(msg, GLib.PRIORITY_DEFAULT, cancellable);
        const status = msg.status_code;
        if (status < 200 || status >= 300) {
            let body = '';
            await readLines(input, l => {
                body += `${l}\n`;
            }, cancellable).catch(() => {});
            throw new Error(this._errorText(status, body));
        }
        let raw = '';
        let reasoning = false;
        await readLines(input, line => {
            if (!line.startsWith('data:'))
                return true;
            const data = line.slice(5).trim();
            if (data === '[DONE]')
                return false;
            try {
                const j = JSON.parse(data);
                const delta = j.choices?.[0]?.delta ?? {};
                // Модели с отдельным полем размышлений (deepseek-r1 и др.)
                if (delta.reasoning_content && !this._settings.get_boolean('ai-hide-thinking')) {
                    if (!reasoning) {
                        raw += '<think>';
                        reasoning = true;
                    }
                    raw += delta.reasoning_content;
                }
                if (delta.content) {
                    if (reasoning) {
                        raw += '</think>\n';
                        reasoning = false;
                    }
                    raw += delta.content;
                }
                onDelta(this._clean(raw));
            } catch {}
            return true;
        }, cancellable);
        return this._clean(raw);
    }

    _errorText(status, body) {
        let detail = body.trim();
        try {
            const j = JSON.parse(detail);
            detail = j.error?.message ?? j.detail ?? j.message ?? detail;
        } catch {}
        if (status === 401 || status === 403)
            return `Ошибка авторизации (${status}). Проверьте API-ключ. ${detail}`.trim();
        if (status === 404)
            return `Модель или адрес не найдены (404). ${detail}`.trim();
        if (status === 429)
            return 'Слишком много запросов (429). Подождите немного.';
        return `Ошибка API ${status}: ${String(detail).slice(0, 300)}`;
    }

    /**
     * Отправляет сообщение в общий чат.
     *
     * @param {string} text
     */
    async send(text) {
        if (this.busy || !text.trim())
            return;
        const user = {id: uid(), role: 'user', content: text.trim(), time: Date.now()};
        const answer = {id: uid(), role: 'assistant', content: '', time: Date.now(), pending: true};
        this.messages.push(user, answer);
        this.busy = true;
        this.emit('changed');

        const system = this._settings.get_string('ai-system-prompt');
        const history = this.messages
            .filter(m => (m.role === 'user' || m.role === 'assistant') && m !== answer && m.content)
            .slice(-20)
            .map(m => ({role: m.role, content: m.content}));
        const payload = system ? [{role: 'system', content: system}, ...history] : history;

        this._cancellable = new Gio.Cancellable();
        try {
            await this.complete(payload, t => {
                answer.content = t;
                this.emit('delta', answer);
            }, this._cancellable);
            if (!answer.content)
                answer.content = '(пустой ответ)';
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                answer.content = `${answer.content}\n⏹ Остановлено`.trim();
            } else {
                answer.role = 'error';
                answer.content = e.message;
            }
        } finally {
            delete answer.pending;
            this.busy = false;
            this._cancellable = null;
            this._save();
            this.emit('changed');
            this.emit('done', answer);
        }
    }

    /**
     * Разовый запрос (для обработки текста), не попадает в историю.
     *
     * @param {string} instruction
     * @param {string} text
     * @param {(t: string) => void} [onDelta]
     */
    ask(instruction, text, onDelta) {
        return this.complete([
            {role: 'system', content: 'Ты обрабатываешь текст по инструкции. Верни только результат, без пояснений и кавычек.'},
            {role: 'user', content: `${instruction}\n\n${text}`},
        ], onDelta);
    }

    stop() {
        this._cancellable?.cancel();
    }

    clear() {
        this.stop();
        this.messages = [];
        this._save();
        this.emit('changed');
    }

    destroy() {
        this.stop();
        this.disconnectAll();
    }
}
