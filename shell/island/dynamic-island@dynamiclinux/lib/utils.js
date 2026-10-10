// Общие вспомогательные функции: процессы, HTTP, файлы, таймеры.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');
Gio._promisify(Gio.Subprocess.prototype, 'wait_async');
Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'query_info_async');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.File.prototype, 'copy_async');
Gio._promisify(Gio.File.prototype, 'delete_async');
Gio._promisify(Gio.File.prototype, 'trash_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async');
Gio._promisify(Gio.InputStream.prototype, 'close_async');
Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Soup.Session.prototype, 'send_async');

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const APP_ID = 'dynamic-island';

/** ~/.local/share/dynamic-island */
export function dataDir() {
    const dir = GLib.build_filenamev([GLib.get_user_data_dir(), APP_ID]);
    GLib.mkdir_with_parents(dir, 0o700);
    return dir;
}

/** ~/.cache/dynamic-island[/sub] */
export function cacheDir(sub = '') {
    const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), APP_ID, sub]);
    GLib.mkdir_with_parents(dir, 0o700);
    return dir;
}

/**
 * Синхронно читает небольшой текстовый файл (подходит для /proc и /sys).
 *
 * @param {string} path
 * @returns {string|null}
 */
export function readFileSync(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? decoder.decode(bytes) : null;
    } catch {
        return null;
    }
}

/**
 * @param {string} path
 * @returns {Promise<string|null>}
 */
export async function readFile(path) {
    try {
        const [bytes] = await Gio.File.new_for_path(path).load_contents_async(null);
        return decoder.decode(bytes);
    } catch {
        return null;
    }
}

/**
 * Атомарно записывает файл.
 *
 * @param {string} path
 * @param {string|Uint8Array} contents
 */
export async function writeFile(path, contents) {
    const file = Gio.File.new_for_path(path);
    const parent = file.get_parent();
    if (parent)
        GLib.mkdir_with_parents(parent.get_path(), 0o700);
    const data = typeof contents === 'string' ? encoder.encode(contents) : contents;
    await file.replace_contents_bytes_async(new GLib.Bytes(data), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

/**
 * @param {string} path
 * @param {*} fallback
 * @returns {Promise<*>}
 */
export async function readJson(path, fallback) {
    const text = await readFile(path);
    if (!text)
        return fallback;
    try {
        return JSON.parse(text);
    } catch {
        return fallback;
    }
}

/**
 * @param {string} path
 * @param {*} value
 */
export function writeJson(path, value) {
    return writeFile(path, JSON.stringify(value, null, 1));
}

/** Проверяет наличие программы в PATH. */
export function hasProgram(name) {
    return GLib.find_program_in_path(name) !== null;
}

/** Раскрывает ~ в начале пути. */
export function expandHome(path) {
    if (!path)
        return path;
    if (path === '~')
        return GLib.get_home_dir();
    if (path.startsWith('~/'))
        return GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]);
    return path;
}

/**
 * Подставляет значения в шаблон команды: {file} → 'путь' (в кавычках).
 *
 * @param {string} template
 * @param {object} vars
 * @returns {string}
 */
export function fillTemplate(template, vars) {
    return template.replace(/\{(\w+)\}/g, (m, k) =>
        (k in vars ? GLib.shell_quote(String(vars[k])) : m));
}

/**
 * Запускает процесс и ждёт результат.
 *
 * @param {string[]} argv
 * @param {{input?: string, cancellable?: Gio.Cancellable, cwd?: string}} [opts]
 * @returns {Promise<{ok: boolean, status: number, stdout: string, stderr: string}>}
 */
export async function run(argv, opts = {}) {
    let flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;
    if (opts.input !== undefined)
        flags |= Gio.SubprocessFlags.STDIN_PIPE;
    const launcher = new Gio.SubprocessLauncher({flags});
    if (opts.cwd)
        launcher.set_cwd(opts.cwd);
    const proc = launcher.spawnv(argv);
    let cancelId = 0;
    if (opts.cancellable)
        cancelId = opts.cancellable.connect(() => proc.force_exit());
    try {
        const [stdout, stderr] = await proc.communicate_utf8_async(opts.input ?? null, null);
        return {
            ok: proc.get_successful(),
            status: proc.get_if_exited() ? proc.get_exit_status() : -1,
            stdout: stdout ?? '',
            stderr: stderr ?? '',
        };
    } finally {
        if (cancelId)
            opts.cancellable.disconnect(cancelId);
    }
}

/**
 * Выполняет строку через bash.
 *
 * @param {string} command
 * @param {object} [opts]
 */
export function runShell(command, opts = {}) {
    return run(['bash', '-c', command], opts);
}

/**
 * Запускает процесс, не дожидаясь завершения.
 *
 * @param {string[]} argv
 */
export function spawn(argv) {
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.unsetenv('DESKTOP_STARTUP_ID');
    return launcher.spawnv(argv);
}

/** Открывает URI в приложении по умолчанию. */
export function openUri(uri) {
    try {
        Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
    } catch (e) {
        console.error(`[dynamic-island] openUri ${uri}: ${e.message}`);
        spawn(['xdg-open', uri]);
    }
}

/** Показывает файл в файловом менеджере (с выделением). */
export function showInFolder(path) {
    const uri = Gio.File.new_for_path(path).get_uri();
    Gio.DBus.session.call(
        'org.freedesktop.FileManager1', '/org/freedesktop/FileManager1',
        'org.freedesktop.FileManager1', 'ShowItems',
        new GLib.Variant('(ass)', [[uri], '']), null,
        Gio.DBusCallFlags.NONE, -1, null,
        (conn, res) => {
            try {
                conn.call_finish(res);
            } catch {
                const parent = Gio.File.new_for_path(path).get_parent();
                if (parent)
                    openUri(parent.get_uri());
            }
        });
}

// ---------------------------------------------------------------- терминал

const TERMINALS = [
    ['ptyxis', cmd => ['ptyxis', '--new-window', '--', 'bash', '-c', cmd]],
    ['kgx', cmd => ['kgx', '--', 'bash', '-c', cmd]],
    ['gnome-terminal', cmd => ['gnome-terminal', '--', 'bash', '-c', cmd]],
    ['konsole', cmd => ['konsole', '-e', 'bash', '-c', cmd]],
    ['xfce4-terminal', cmd => ['xfce4-terminal', '-x', 'bash', '-c', cmd]],
    ['tilix', cmd => ['tilix', '-e', `bash -c ${GLib.shell_quote(cmd)}`]],
    ['alacritty', cmd => ['alacritty', '-e', 'bash', '-c', cmd]],
    ['kitty', cmd => ['kitty', 'bash', '-c', cmd]],
    ['wezterm', cmd => ['wezterm', 'start', '--', 'bash', '-c', cmd]],
    ['foot', cmd => ['foot', 'bash', '-c', cmd]],
    ['xterm', cmd => ['xterm', '-e', 'bash', '-c', cmd]],
];

/**
 * Запускает команду в терминале, оставляя оболочку открытой.
 *
 * @param {string} command
 * @param {string} preferred 'auto' или имя терминала
 */
export function runInTerminal(command, preferred = 'auto') {
    const cmd = `${command}; echo; read -n1 -r -p "Нажмите любую клавишу…"`;
    let entry = TERMINALS.find(([name]) => name === preferred && hasProgram(name));
    if (!entry && preferred && preferred !== 'auto' && hasProgram(preferred))
        return spawn([preferred, '-e', 'bash', '-c', cmd]);
    if (!entry)
        entry = TERMINALS.find(([name]) => hasProgram(name));
    if (!entry)
        throw new Error('Не найден эмулятор терминала');
    return spawn(entry[1](cmd));
}

// ---------------------------------------------------------------- HTTP

let _session = null;

/** Общая HTTP-сессия. */
export function httpSession() {
    if (!_session) {
        _session = new Soup.Session({timeout: 60, user_agent: 'DynamicIsland/1.0 (GNOME Shell extension)'});
    }
    return _session;
}

/** Закрывает HTTP-сессию (при выключении расширения). */
export function disposeHttp() {
    if (_session) {
        _session.abort();
        _session = null;
    }
}

/**
 * Создаёт Soup.Message.
 *
 * @param {string} method
 * @param {string} url
 * @param {{headers?: object, json?: *, body?: Uint8Array, contentType?: string}} opts
 * @returns {Soup.Message}
 */
export function makeMessage(method, url, opts = {}) {
    const msg = Soup.Message.new(method, url);
    if (!msg)
        throw new Error(`Некорректный адрес: ${url}`);
    for (const [k, v] of Object.entries(opts.headers ?? {}))
        msg.request_headers.append(k, v);
    if (opts.json !== undefined) {
        msg.set_request_body_from_bytes('application/json',
            new GLib.Bytes(encoder.encode(JSON.stringify(opts.json))));
    } else if (opts.body) {
        msg.set_request_body_from_bytes(opts.contentType ?? 'application/octet-stream',
            new GLib.Bytes(opts.body));
    }
    return msg;
}

/**
 * HTTP-запрос с чтением ответа целиком.
 *
 * @param {string} method
 * @param {string} url
 * @param {object} [opts]
 * @returns {Promise<{status: number, text: string, bytes: Uint8Array, json: Function}>}
 */
export async function http(method, url, opts = {}) {
    const msg = opts.message ?? makeMessage(method, url, opts);
    const gbytes = await httpSession().send_and_read_async(msg, GLib.PRIORITY_DEFAULT, opts.cancellable ?? null);
    const bytes = gbytes.get_data() ?? new Uint8Array();
    const text = decoder.decode(bytes);
    return {
        status: msg.status_code,
        text,
        bytes,
        json: () => JSON.parse(text),
    };
}

/**
 * GET + JSON с проверкой статуса.
 *
 * @param {string} url
 * @param {object} [opts]
 */
export async function getJson(url, opts = {}) {
    const res = await http('GET', url, opts);
    if (res.status < 200 || res.status >= 300)
        throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/**
 * Скачивает файл.
 *
 * @param {string} url
 * @param {string} path
 */
export async function download(url, path) {
    const res = await http('GET', url);
    if (res.status < 200 || res.status >= 300)
        throw new Error(`HTTP ${res.status}`);
    await writeFile(path, res.bytes);
    return path;
}

/**
 * Читает поток построчно (для SSE).
 *
 * @param {Gio.InputStream} stream
 * @param {(line: string) => boolean|void} onLine  вернуть false, чтобы остановиться
 * @param {Gio.Cancellable} [cancellable]
 */
export async function readLines(stream, onLine, cancellable = null) {
    const data = new Gio.DataInputStream({base_stream: stream, close_base_stream: true});
    try {
        for (;;) {
            const [line] = await data.read_line_async(GLib.PRIORITY_DEFAULT, cancellable);
            if (line === null)
                break;
            const text = decoder.decode(line).replace(/\r$/, '');
            if (onLine(text) === false)
                break;
        }
    } finally {
        try {
            data.close(null);
        } catch {}
    }
}

export {encoder, decoder};

// ---------------------------------------------------------------- таймеры и сигналы

/**
 * Набор таймеров, которые гарантированно удаляются при destroy().
 */
export class Timers {
    constructor() {
        this._ids = new Set();
        this._destroyed = false;
    }

    timeout(ms, fn) {
        // После destroy() новые таймеры не создаются (например, из onComplete анимаций)
        if (this._destroyed)
            return 0;
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._ids.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._ids.add(id);
        return id;
    }

    interval(ms, fn) {
        if (this._destroyed)
            return 0;
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            const keep = fn();
            if (keep === false) {
                this._ids.delete(id);
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._ids.add(id);
        return id;
    }

    idle(fn) {
        if (this._destroyed)
            return 0;
        const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._ids.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._ids.add(id);
        return id;
    }

    clear(id) {
        if (id && this._ids.has(id)) {
            GLib.source_remove(id);
            this._ids.delete(id);
        }
        return 0;
    }

    sleep(ms) {
        return new Promise(resolve => {
            if (!this.timeout(ms, resolve))
                resolve();
        });
    }

    destroy() {
        this._destroyed = true;
        for (const id of this._ids)
            GLib.source_remove(id);
        this._ids.clear();
    }
}

/**
 * Мини-эмиттер событий для сервисов.
 */
export class Emitter {
    constructor() {
        this._handlers = new Map();
        this._nextId = 1;
    }

    on(name, fn) {
        const id = this._nextId++;
        if (!this._handlers.has(name))
            this._handlers.set(name, new Map());
        this._handlers.get(name).set(id, fn);
        return id;
    }

    off(id) {
        for (const map of this._handlers.values())
            map.delete(id);
    }

    emit(name, ...args) {
        const map = this._handlers.get(name);
        if (!map)
            return;
        for (const fn of [...map.values()]) {
            try {
                fn(...args);
            } catch (e) {
                logError(e, `[dynamic-island] обработчик события ${name}`);
            }
        }
    }

    disconnectAll() {
        this._handlers.clear();
    }
}

/**
 * Подписки на события нескольких источников, которые снимаются разом.
 */
export class Subscriptions {
    constructor() {
        this._list = [];
    }

    /** GObject-сигнал. */
    connect(obj, signal, fn) {
        const id = obj.connect(signal, fn);
        this._list.push(() => {
            try {
                obj.disconnect(id);
            } catch {}
        });
        return id;
    }

    /** Событие Emitter. */
    on(emitter, name, fn) {
        const id = emitter.on(name, fn);
        this._list.push(() => emitter.off(id));
        return id;
    }

    /** Произвольная функция очистки. */
    add(fn) {
        this._list.push(fn);
    }

    clear() {
        for (const fn of this._list.reverse()) {
            try {
                fn();
            } catch {}
        }
        this._list = [];
    }
}

/** Безопасный вызов с логированием ошибок. */
export function safe(fn, what = '') {
    try {
        return fn();
    } catch (e) {
        console.error(`[dynamic-island] ${what}: ${e.message}`);
        return undefined;
    }
}

/** Генерирует короткий уникальный идентификатор. */
export function uid() {
    return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ---------------------------------------------------------------- слои оболочки (chrome)

// GNOME 50 убрал параметр affectsInputRegion (он нужен был только X11) и теперь
// отвергает его ошибкой «Unrecognized parameter». Узнаём это по первой попытке.
let _inputRegionParam = true;

function withoutInputRegion(params) {
    const rest = {...params};
    delete rest.affectsInputRegion;
    return rest;
}

function isParamError(e) {
    return /Unrecognized parameter/.test(e?.message ?? '');
}

/**
 * addChrome / addTopChrome, совместимые с GNOME 45–50.
 *
 * @param {object} layoutManager Main.layoutManager
 * @param {Clutter.Actor} actor
 * @param {object} params
 * @param {boolean} [top] добавить поверх всех окон
 */
export function addChrome(layoutManager, actor, params, top = false) {
    const add = p => (top ? layoutManager.addTopChrome(actor, p) : layoutManager.addChrome(actor, p));
    if (!_inputRegionParam) {
        add(withoutInputRegion(params));
        return;
    }
    try {
        add(params);
    } catch (e) {
        if (!isParamError(e))
            throw e;
        _inputRegionParam = false;
        // addChrome успел добавить актёра в uiGroup до ошибки — убираем и повторяем
        actor.get_parent()?.remove_child(actor);
        add(withoutInputRegion(params));
    }
}

/**
 * trackChrome, совместимый с GNOME 45–50.
 *
 * @param {object} layoutManager Main.layoutManager
 * @param {Clutter.Actor} actor
 * @param {object} params
 */
export function trackChrome(layoutManager, actor, params) {
    if (!_inputRegionParam) {
        layoutManager.trackChrome(actor, withoutInputRegion(params));
        return;
    }
    try {
        layoutManager.trackChrome(actor, params);
    } catch (e) {
        if (!isParamError(e))
            throw e;
        _inputRegionParam = false;
        layoutManager.trackChrome(actor, withoutInputRegion(params));
    }
}
