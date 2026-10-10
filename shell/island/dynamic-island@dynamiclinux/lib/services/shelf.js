// «Полка» — временное хранилище файлов (как AirDrop-полка в Dynamic Island).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Emitter, cacheDir, dataDir, readJson, run, uid, writeJson} from '../utils.js';

/**
 * @typedef {object} ShelfItem
 * @property {string} id
 * @property {string} path
 * @property {string} name
 * @property {boolean} isDir
 * @property {number} size
 * @property {string} contentType
 * @property {boolean} stashed  копия лежит в кэше острова
 * @property {number} time
 */

export class ShelfService extends Emitter {
    constructor(settings, clipboard) {
        super();
        this._settings = settings;
        this._clipboard = clipboard;
        this._file = GLib.build_filenamev([dataDir(), 'shelf.json']);
        /** @type {ShelfItem[]} */
        this.items = [];
        this._load();
        this._filesId = clipboard.on('files-copied', uris => {
            if (this._settings.get_boolean('shelf-auto-add'))
                this.addUris(uris, true);
        });
    }

    async _load() {
        const data = await readJson(this._file, []);
        if (Array.isArray(data)) {
            const loaded = data.filter(i => i?.path && GLib.file_test(i.path, GLib.FileTest.EXISTS));
            const paths = new Set(this.items.map(i => i.path));
            this.items = [...this.items, ...loaded.filter(i => !paths.has(i.path))];
            this.emit('changed');
        }
    }

    _save() {
        writeJson(this._file, this.items).catch(() => {});
    }

    get stashDir() {
        return cacheDir('shelf');
    }

    /**
     * Добавляет файлы по URI.
     *
     * @param {string[]} uris
     * @param {boolean} [auto] добавлено автоматически при копировании
     */
    async addUris(uris, auto = false) {
        const added = [];
        for (const uri of uris) {
            let file;
            try {
                file = Gio.File.new_for_uri(uri);
            } catch {
                continue;
            }
            const path = file.get_path();
            if (!path || this.items.some(i => i.path === path || i.origin === path))
                continue;
            let info;
            try {
                info = file.query_info('standard::*', Gio.FileQueryInfoFlags.NONE, null);
            } catch {
                continue;
            }
            const item = {
                id: uid(),
                path,
                origin: path,
                name: info.get_display_name(),
                isDir: info.get_file_type() === Gio.FileType.DIRECTORY,
                size: info.get_size(),
                contentType: info.get_content_type() ?? '',
                stashed: false,
                time: Date.now(),
            };
            this.items.unshift(item);
            added.push(item);
            if (this._settings.get_boolean('shelf-copy-files'))
                this.stash(item).catch(e => console.error(`[dynamic-island] shelf stash: ${e.message}`));
        }
        if (added.length) {
            this._save();
            this.emit('changed');
            this.emit('added', added, auto);
        }
        return added;
    }

    addPaths(paths) {
        return this.addUris(paths.map(p => Gio.File.new_for_path(p).get_uri()));
    }

    /** Делает временную копию файла внутри кэша острова (оригинал можно удалить). */
    async stash(item) {
        if (item.stashed)
            return;
        const dir = GLib.build_filenamev([this.stashDir, item.id]);
        GLib.mkdir_with_parents(dir, 0o700);
        const res = await run(['cp', '-a', '--', item.path, dir]);
        if (!res.ok)
            throw new Error(res.stderr.trim() || 'Не удалось скопировать');
        item.path = GLib.build_filenamev([dir, GLib.path_get_basename(item.path)]);
        item.stashed = true;
        this._save();
        this.emit('changed');
    }

    /** Копирует элементы в буфер обмена как файлы. */
    copyToClipboard(items = this.items) {
        this._clipboard.setFiles(items.map(i => Gio.File.new_for_path(i.path).get_uri()));
    }

    /**
     * Копирует или перемещает элемент в папку.
     *
     * @param {ShelfItem} item
     * @param {string} destDir
     * @param {boolean} move
     */
    async sendTo(item, destDir, move = false) {
        const res = await run([move ? 'mv' : 'cp', move ? '-n' : '-an', '--', item.path, destDir]);
        if (!res.ok)
            throw new Error(res.stderr.trim() || 'Ошибка копирования');
        if (move)
            this.remove(item, false);
        return GLib.build_filenamev([destDir, GLib.path_get_basename(item.path)]);
    }

    remove(item, deleteStash = true) {
        this.items = this.items.filter(i => i !== item);
        if (deleteStash && item.stashed) {
            const dir = GLib.path_get_dirname(item.path);
            if (dir.startsWith(this.stashDir))
                run(['rm', '-rf', '--', dir]).catch(() => {});
        }
        this._save();
        this.emit('changed');
    }

    clear() {
        for (const i of [...this.items])
            this.remove(i);
    }

    destroy() {
        this._clipboard.off(this._filesId);
        this.disconnectAll();
    }
}
