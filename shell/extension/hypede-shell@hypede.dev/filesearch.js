// Поиск файлов для лаунчера.
//
// Индексатор GNOME (localsearch) в HypeDE по умолчанию выключен — он
// заметно грузит диск. Вместо него лаунчер держит в памяти список имён
// файлов домашней папки: он собирается в фоне при первом открытии
// лаунчера и обновляется, если устарел. Скрытые папки и тяжёлые каталоги
// сборки (node_modules, .git, target…) пропускаются.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async');

const MAX_ENTRIES = 80000;
const MAX_DEPTH = 10;
const BATCH = 200;
const REFRESH_AFTER = 5 * 60 * 1000 * 1000; // мкс
const SKIP_DIRS = new Set([
    'node_modules', '__pycache__', 'target', 'build', 'dist', 'venv', 'env',
    'site-packages', 'CMakeFiles', 'snap', 'Steam', 'steamapps',
]);

export function normalize(text) {
    return text.toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

class FileIndex {
    constructor() {
        this._entries = []; // [нормализованное имя, путь, это папка]
        this._builtAt = 0;
        this._building = null;
        this._cancellable = null;
    }

    // Обновить индекс, если он пустой или устарел. Поиск работает и по
    // неполному индексу — результаты добавляются по мере обхода.
    refresh() {
        if (this._building)
            return;
        if (this._builtAt && GLib.get_monotonic_time() - this._builtAt < REFRESH_AFTER)
            return;
        this._building = this._build().catch(e => {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e, 'HypeDE: не удалось составить список файлов');
        }).finally(() => {
            this._building = null;
        });
    }

    async _build() {
        this._cancellable = new Gio.Cancellable();
        const cancellable = this._cancellable;
        const home = GLib.get_home_dir();
        const entries = [];
        // Обход в ширину: сначала то, что лежит близко к домашней папке.
        let level = [Gio.File.new_for_path(home)];
        for (let depth = 0; depth < MAX_DEPTH && level.length > 0; depth++) {
            const next = [];
            for (const dir of level) {
                if (entries.length >= MAX_ENTRIES)
                    break;
                // eslint-disable-next-line no-await-in-loop
                await this._scan(dir, entries, next, cancellable);
            }
            level = next;
            // Промежуточный результат — чтобы поиск работал уже во время обхода.
            this._entries = entries.slice();
        }
        this._entries = entries;
        this._builtAt = GLib.get_monotonic_time();
    }

    async _scan(dir, entries, subdirs, cancellable) {
        let enumerator;
        try {
            enumerator = await dir.enumerate_children_async(
                'standard::name,standard::type,standard::is-hidden,standard::is-symlink',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_LOW, cancellable);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            return; // нет доступа — пропускаем
        }
        const dirPath = dir.get_path();
        try {
            while (entries.length < MAX_ENTRIES) {
                // eslint-disable-next-line no-await-in-loop
                const infos = await enumerator.next_files_async(BATCH, GLib.PRIORITY_LOW, cancellable);
                if (infos.length === 0)
                    break;
                for (const info of infos) {
                    const name = info.get_name();
                    if (info.get_is_hidden() || name.startsWith('.'))
                        continue;
                    const isDir = info.get_file_type() === Gio.FileType.DIRECTORY;
                    const path = `${dirPath}/${name}`;
                    entries.push([normalize(name), path, isDir]);
                    if (isDir && !info.get_is_symlink() && !SKIP_DIRS.has(name))
                        subdirs.push(dir.get_child(name));
                }
            }
        } finally {
            enumerator.close_async(GLib.PRIORITY_LOW, null).catch(() => {});
        }
    }

    // Лучшие совпадения: имя начинается с запроса, потом слово в имени
    // начинается с запроса, потом просто содержит его. При равенстве —
    // то, что лежит ближе к домашней папке (оно раньше в списке).
    search(query, limit) {
        if (!query)
            return [];
        const scored = [];
        const wordStart = new RegExp(`(^|[\\s._\\-(\\[])${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
        for (let i = 0; i < this._entries.length; i++) {
            const [name] = this._entries[i];
            const at = name.indexOf(query);
            if (at < 0)
                continue;
            const score = at === 0 ? 0 : wordStart.test(name) ? 1 : 2;
            scored.push([score, i]);
            // Лучше уже не будет — дальше можно не искать.
            if (scored.length > limit * 50 && score === 0)
                break;
        }
        scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        return scored.slice(0, limit).map(([, i]) => {
            const [, path, isDir] = this._entries[i];
            return {path, isDir};
        });
    }

    destroy() {
        this._cancellable?.cancel();
        this._entries = [];
    }
}

let index = null;

export function getFileIndex() {
    index ??= new FileIndex();
    return index;
}

export function destroyFileIndex() {
    index?.destroy();
    index = null;
}
