// Голос в текст: запись микрофона (PipeWire/PulseAudio/ALSA) + распознавание
// локально (whisper.cpp, vosk, любой CLI) или через OpenAI-совместимый API.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {Emitter, cacheDir, decoder, fillTemplate, hasProgram, httpSession, runShell} from '../utils.js';

function recorderArgv(path) {
    if (hasProgram('pw-record'))
        return ['pw-record', '--rate', '16000', '--channels', '1', '--format', 's16', path];
    if (hasProgram('parecord'))
        return ['parecord', '--rate=16000', '--channels=1', '--format=s16le', '--file-format=wav', path];
    if (hasProgram('arecord'))
        return ['arecord', '-q', '-f', 'S16_LE', '-r', '16000', '-c', '1', '-t', 'wav', path];
    if (hasProgram('ffmpeg'))
        return ['ffmpeg', '-loglevel', 'error', '-y', '-f', 'pulse', '-i', 'default', '-ac', '1', '-ar', '16000', path];
    return null;
}

export class VoiceService extends Emitter {
    constructor(settings) {
        super();
        this._settings = settings;
        /** 'idle' | 'recording' | 'transcribing' */
        this.state = 'idle';
        this.lastText = '';
        this.error = null;
        this.started = 0;
        this._proc = null;
    }

    get recording() {
        return this.state === 'recording';
    }

    async toggle() {
        if (this.state === 'recording')
            return this.stop();
        if (this.state === 'idle')
            return this.start();
        return null;
    }

    start() {
        if (this.state !== 'idle')
            return;
        this.error = null;
        this._path = GLib.build_filenamev([cacheDir('voice'), `rec-${Date.now()}.wav`]);
        const argv = recorderArgv(this._path);
        if (!argv) {
            this.error = 'Не найдена программа записи звука (pw-record, parecord, arecord или ffmpeg)';
            this.emit('error', this.error);
            this.emit('changed');
            return;
        }
        try {
            this._proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            this.error = e.message;
            this.emit('error', this.error);
            this.emit('changed');
            return;
        }
        this.state = 'recording';
        this.started = Date.now();
        this.emit('changed');
    }

    async stop() {
        if (this.state !== 'recording' || !this._proc)
            return null;
        const proc = this._proc;
        this._proc = null;
        this.state = 'transcribing';
        this.emit('changed');
        try {
            proc.send_signal(2); // SIGINT — корректно закрывает wav
            await proc.wait_async(null);
        } catch {}
        try {
            if ((Date.now() - this.started) < 400)
                throw new Error('Слишком короткая запись');
            const text = (await this._transcribe(this._path)).trim();
            this.lastText = text;
            if (!text)
                throw new Error('Речь не распознана');
            this.emit('result', text);
            return text;
        } catch (e) {
            this.error = e.message;
            this.emit('error', e.message);
            return null;
        } finally {
            try {
                Gio.File.new_for_path(this._path).delete(null);
            } catch {}
            this.state = 'idle';
            this.emit('changed');
        }
    }

    cancel() {
        if (this._proc) {
            this._proc.force_exit();
            this._proc = null;
        }
        this.state = 'idle';
        this.emit('changed');
    }

    async _transcribe(path) {
        const lang = this._settings.get_string('voice-language') || 'auto';
        if (this._settings.get_string('voice-backend') === 'api')
            return this._transcribeApi(path, lang);
        const template = this._settings.get_string('voice-command');
        const cmd = fillTemplate(template, {file: path, lang});
        const res = await runShell(cmd);
        if (!res.ok)
            throw new Error(`Команда распознавания завершилась с ошибкой:\n${(res.stderr || res.stdout).trim().slice(-400)}`);
        // whisper-cli печатает таймкоды, если не указан -nt: убираем их
        return res.stdout
            .split('\n')
            .map(l => l.replace(/^\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/, '').trim())
            .filter(l => l && !l.startsWith('whisper_') && !l.startsWith('main:'))
            .join(' ');
    }

    async _transcribeApi(path, lang) {
        const endpoint = this._settings.get_string('voice-api-endpoint');
        const key = this._settings.get_string('voice-api-key') || this._settings.get_string('ai-api-key');
        const [, data] = GLib.file_get_contents(path);
        const mp = new Soup.Multipart('multipart/form-data');
        mp.append_form_string('model', this._settings.get_string('voice-api-model'));
        if (lang && lang !== 'auto')
            mp.append_form_string('language', lang);
        mp.append_form_string('response_format', 'json');
        mp.append_form_file('file', 'audio.wav', 'audio/wav', new GLib.Bytes(data));
        const msg = Soup.Message.new_from_multipart(endpoint, mp);
        if (key)
            msg.request_headers.append('Authorization', `Bearer ${key}`);
        const bytes = await httpSession().send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
        const text = decoder.decode(bytes.get_data() ?? new Uint8Array());
        const status = msg.status_code;
        if (status < 200 || status >= 300)
            throw new Error(`Ошибка API ${status}: ${text.slice(0, 300)}`);
        try {
            return JSON.parse(text).text ?? '';
        } catch {
            return text;
        }
    }

    destroy() {
        this.cancel();
        this.disconnectAll();
    }
}
