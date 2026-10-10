// История буфера обмена: текст, изображения, файлы.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {Emitter, Timers, cacheDir, dataDir, decoder, encoder, readJson, uid, writeFile, writeJson} from '../utils.js';

const FILE_MIMES = ['x-special/gnome-copied-files', 'text/uri-list'];
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/bmp', 'image/gif', 'image/webp'];
// Менеджеры паролей помечают секреты этим типом — такие записи не сохраняем.
const SECRET_MIMES = ['x-kde-passwordManagerHint', 'application/x-password'];

/**
 * @typedef {object} ClipItem
 * @property {string} id
 * @property {'text'|'image'|'files'} type
 * @property {string} [text]
 * @property {string} [path]
 * @property {string[]} [uris]
 * @property {number} time
 * @property {boolean} [pinned]
 */

export class ClipboardService extends Emitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._timers = new Timers();
        this._clipboard = St.Clipboard.get_default();
        this._file = GLib.build_filenamev([dataDir(), 'clipboard.json']);
        this._ignoreNext = false;
        /** @type {ClipItem[]} */
        this.items = [];
        this._load();

        this._selection = global.display.get_selection();
        this._ownerId = this._selection.connect('owner-changed', (sel, type) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD)
                this._onOwnerChanged();
        });
    }

    get enabled() {
        return this._settings.get_boolean('clipboard-enabled');
    }

    get private() {
        return this._settings.get_boolean('clipboard-private');
    }

    async _load() {
        const data = await readJson(this._file, []);
        if (Array.isArray(data)) {
            const loaded = data.filter(i => i && i.type && (i.type !== 'image' || GLib.file_test(i.path ?? '', GLib.FileTest.EXISTS)));
            // Записи, скопированные до окончания загрузки, остаются сверху
            const keys = new Set(this.items.map(i => this._key(i)));
            this.items = [...this.items, ...loaded.filter(i => !keys.has(this._key(i)))];
            this.emit('changed');
        }
    }

    _save() {
        if (this._saveId)
            this._timers.clear(this._saveId);
        this._saveId = this._timers.timeout(800, () => {
            this._saveId = 0;
            const persist = this._settings.get_boolean('clipboard-persist');
            const list = persist ? this.items : this.items.filter(i => i.pinned);
            writeJson(this._file, list).catch(e => console.error(`[dynamic-island] clipboard save: ${e.message}`));
        });
    }

    _onOwnerChanged() {
        if (this._ignoreNext) {
            this._ignoreNext = false;
            return;
        }
        // Небольшая задержка: даём приложению выставить все типы данных
        if (this._readId)
            this._timers.clear(this._readId);
        this._readId = this._timers.timeout(80, () => {
            this._readId = 0;
            this._read();
        });
    }

    _getContent(mime) {
        return new Promise(resolve => {
            this._clipboard.get_content(St.ClipboardType.CLIPBOARD, mime, (cb, bytes) => {
                resolve(bytes ? bytes.get_data() : null);
            });
        });
    }

    _getText() {
        return new Promise(resolve => {
            this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (cb, text) => resolve(text));
        });
    }

    async _read() {
        let mimes = [];
        try {
            mimes = this._clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD) ?? [];
        } catch {}
        if (mimes.some(m => SECRET_MIMES.includes(m)))
            return;

        // Файлы
        const fileMime = FILE_MIMES.find(m => mimes.includes(m));
        if (fileMime) {
            const data = await this._getContent(fileMime);
            if (data) {
                const uris = decoder.decode(data).split(/\r?\n/)
                    .map(l => l.trim())
                    .filter(l => l && !l.startsWith('#') && l.includes('://'));
                if (uris.length) {
                    this.emit('files-copied', uris);
                    if (this.enabled && !this.private)
                        this._add({type: 'files', uris});
                    return;
                }
            }
        }

        if (!this.enabled || this.private)
            return;

        // Изображения
        const imageMime = IMAGE_MIMES.find(m => mimes.includes(m));
        const hasText = mimes.some(m => m.startsWith('text/') || m === 'UTF8_STRING' || m === 'STRING');
        if (imageMime && !hasText && this._settings.get_boolean('clipboard-images')) {
            const data = await this._getContent(imageMime);
            if (data && data.length) {
                const hash = GLib.compute_checksum_for_bytes(GLib.ChecksumType.MD5, new GLib.Bytes(data));
                const ext = imageMime.split('/')[1];
                const path = GLib.build_filenamev([cacheDir('clipboard'), `${hash}.${ext}`]);
                if (!GLib.file_test(path, GLib.FileTest.EXISTS))
                    await writeFile(path, data);
                this._add({type: 'image', path, mime: imageMime, size: data.length});
                return;
            }
        }

        // Текст
        const text = await this._getText();
        if (text && text.trim())
            this._add({type: 'text', text});
    }

    _add(partial) {
        const key = this._key(partial);
        const existing = this.items.find(i => this._key(i) === key);
        if (existing) {
            this.items = [existing, ...this.items.filter(i => i !== existing)];
            existing.time = Date.now();
        } else {
            const item = {id: uid(), time: Date.now(), pinned: false, ...partial};
            this.items.unshift(item);
            this.emit('added', item);
        }
        this._trim();
        this._save();
        this.emit('changed');
    }

    _key(i) {
        if (i.type === 'text')
            return `t:${i.text}`;
        if (i.type === 'image')
            return `i:${i.path}`;
        return `f:${(i.uris ?? []).join('\n')}`;
    }

    _trim() {
        const max = this._settings.get_int('clipboard-history-size');
        const unpinned = this.items.filter(i => !i.pinned);
        if (unpinned.length <= max)
            return;
        const drop = new Set(unpinned.slice(max));
        for (const i of drop) {
            if (i.type === 'image' && !this.items.some(o => o !== i && o.path === i.path))
                this._deleteFile(i.path);
        }
        this.items = this.items.filter(i => !drop.has(i));
    }

    _deleteFile(path) {
        try {
            Gio.File.new_for_path(path).delete(null);
        } catch {}
    }

    /** Копирует запись обратно в буфер. */
    copy(item) {
        this._ignoreNext = true;
        if (item.type === 'text') {
            this._clipboard.set_text(St.ClipboardType.CLIPBOARD, item.text);
        } else if (item.type === 'image') {
            try {
                const [, data] = GLib.file_get_contents(item.path);
                this._clipboard.set_content(St.ClipboardType.CLIPBOARD, item.mime ?? 'image/png', new GLib.Bytes(data));
            } catch (e) {
                this._ignoreNext = false;
                throw e;
            }
        } else if (item.type === 'files') {
            this.setFiles(item.uris);
        }
        // Поднимаем запись наверх
        this.items = [item, ...this.items.filter(i => i !== item)];
        this.emit('changed');
        this._save();
    }

    /** Помещает текст в буфер (и в историю). */
    setText(text) {
        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
    }

    /** Помещает файлы в буфер так, чтобы их можно было вставить в файловом менеджере. */
    setFiles(uris) {
        const payload = `copy\n${uris.join('\n')}`;
        this._clipboard.set_content(St.ClipboardType.CLIPBOARD, 'x-special/gnome-copied-files',
            new GLib.Bytes(encoder.encode(payload)));
    }

    /** Текущий текст буфера. */
    currentText() {
        return this._getText();
    }

    /** Файлы, которые сейчас лежат в буфере (URI). */
    async currentFiles() {
        let mimes = [];
        try {
            mimes = this._clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD) ?? [];
        } catch {}
        const fileMime = FILE_MIMES.find(m => mimes.includes(m));
        if (!fileMime)
            return [];
        const data = await this._getContent(fileMime);
        if (!data)
            return [];
        return decoder.decode(data).split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#') && l.includes('://'));
    }

    /** Текущее изображение из буфера (путь к временному файлу) или null. */
    async currentImage() {
        let mimes = [];
        try {
            mimes = this._clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD) ?? [];
        } catch {}
        const imageMime = IMAGE_MIMES.find(m => mimes.includes(m));
        if (!imageMime)
            return null;
        const data = await this._getContent(imageMime);
        if (!data || !data.length)
            return null;
        const path = GLib.build_filenamev([cacheDir('tmp'), `clip-${Date.now()}.${imageMime.split('/')[1]}`]);
        await writeFile(path, data);
        return path;
    }

    togglePin(item) {
        item.pinned = !item.pinned;
        this._save();
        this.emit('changed');
    }

    remove(item) {
        this.items = this.items.filter(i => i !== item);
        if (item.type === 'image' && !this.items.some(o => o.path === item.path))
            this._deleteFile(item.path);
        this._save();
        this.emit('changed');
    }

    clear(keepPinned = true) {
        const removed = this.items.filter(i => !(keepPinned && i.pinned));
        this.items = keepPinned ? this.items.filter(i => i.pinned) : [];
        for (const i of removed) {
            if (i.type === 'image')
                this._deleteFile(i.path);
        }
        this._save();
        this.emit('changed');
    }

    destroy() {
        if (this._ownerId)
            this._selection.disconnect(this._ownerId);
        if (this._saveId) {
            // Сохраняем немедленно при выключении
            const persist = this._settings.get_boolean('clipboard-persist');
            writeJson(this._file, persist ? this.items : this.items.filter(i => i.pinned)).catch(() => {});
        }
        this._timers.destroy();
        this.disconnectAll();
    }
}
