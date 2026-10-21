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

// Индекс хранится компактно: все имена — одна строка через «\n», пути —
// другая, начала записей — в типизированных массивах. Десятки тысяч мелких
// массивов и строк сборщик мусора GJS обходил бы при каждой полной сборке,
// а это заметные паузы всей оболочки.
class Packed {
    constructor(names = [], paths = [], dirs = []) {
        this.count = names.length;
        this.names = `\n${names.join('\n')}\n`;
        this.paths = paths.join('\n');
        this.nameStarts = new Int32Array(this.count + 1);
        this.pathStarts = new Int32Array(this.count + 1);
        this.dirs = Uint8Array.from(dirs);
        let n = 1, q = 0;
        for (let i = 0; i < this.count; i++) {
            this.nameStarts[i] = n;
            this.pathStarts[i] = q;
            n += names[i].length + 1;
            q += paths[i].length + 1;
        }
        this.nameStarts[this.count] = n;
        this.pathStarts[this.count] = q;
    }

    // Номер записи, в имени которой лежит позиция pos.
    entryAt(pos) {
        let lo = 0, hi = this.count - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (this.nameStarts[mid] <= pos)
                lo = mid;
            else
                hi = mid - 1;
        }
        return lo;
    }

    path(i) {
        return this.paths.slice(this.pathStarts[i], this.pathStarts[i + 1] - 1);
    }
}

const WORD_BREAK = new Set([' ', '\t', '.', '_', '-', '(', '[']);

class FileIndex {
    constructor() {
        this._packed = new Packed();
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
        const acc = {names: [], paths: [], dirs: []};
        // Обход в ширину: сначала то, что лежит близко к домашней папке.
        let level = [Gio.File.new_for_path(home)];
        for (let depth = 0; depth < MAX_DEPTH && level.length > 0; depth++) {
            const next = [];
            for (const dir of level) {
                if (acc.names.length >= MAX_ENTRIES)
                    break;
                // eslint-disable-next-line no-await-in-loop
                await this._scan(dir, acc, next, cancellable);
            }
            level = next;
            // Промежуточный результат — чтобы поиск работал уже во время обхода.
            if (depth < 3)
                this._packed = new Packed(acc.names, acc.paths, acc.dirs);
        }
        this._packed = new Packed(acc.names, acc.paths, acc.dirs);
        this._builtAt = GLib.get_monotonic_time();
    }

    async _scan(dir, acc, subdirs, cancellable) {
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
            while (acc.names.length < MAX_ENTRIES) {
                // eslint-disable-next-line no-await-in-loop
                const infos = await enumerator.next_files_async(BATCH, GLib.PRIORITY_LOW, cancellable);
                if (infos.length === 0)
                    break;
                for (const info of infos) {
                    const name = info.get_name();
                    if (info.get_is_hidden() || name.startsWith('.') || name.includes('\n'))
                        continue;
                    const isDir = info.get_file_type() === Gio.FileType.DIRECTORY;
                    acc.names.push(normalize(name));
                    acc.paths.push(`${dirPath}/${name}`);
                    acc.dirs.push(isDir ? 1 : 0);
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
        if (!query || query.includes('\n'))
            return [];
        const packed = this._packed;
        const best = new Map(); // запись → лучшая оценка
        let first = 0;
        for (let pos = packed.names.indexOf(query, 1); pos >= 0; pos = packed.names.indexOf(query, pos + 1)) {
            const i = packed.entryAt(pos);
            if (pos + query.length >= packed.nameStarts[i + 1])
                continue; // совпадение захватило перевод строки
            const at = pos - packed.nameStarts[i];
            const score = at === 0 ? 0 : WORD_BREAK.has(packed.names[pos - 1]) ? 1 : 2;
            if (!best.has(i) || score < best.get(i))
                best.set(i, score);
            // Лучше уже не будет — дальше можно не искать.
            if (score === 0 && ++first > limit * 50)
                break;
        }
        return [...best].sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, limit)
            .map(([i]) => ({path: packed.path(i), isDir: packed.dirs[i] === 1}));
    }

    destroy() {
        this._cancellable?.cancel();
        this._packed = new Packed();
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
