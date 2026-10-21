// Свои виджеты рабочего стола.
//
// Каждый виджет — папка в ~/.local/share/hypede/widgets/ с файлом
// widget.json:
//
//   {
//     "name": "Курс биткоина",          — название (в меню и заголовке)
//     "icon": "starred-symbolic",       — значок: имя или файл рядом
//     "command": ["sh", "-c", "…"],     — что показать: вывод команды,
//     "file": "todo.txt",               —   или содержимое файла,
//     "text": "Привет!",                —   или просто текст
//     "interval": 60,                   — как часто обновлять, секунд (≥ 5)
//     "style": "big",                   — big: первая строка крупно,
//                                          list: строки списком, text: как есть
//     "click": ["xdg-open", "https://…"] — что открыть по щелчку
//   }
//
// Команда запускается от имени пользователя без оболочки (массив
// аргументов), её вывод читается в фоне и обрезается до 12 строк. Пока
// виджет скрыт, он не обновляется. Папка отслеживается: правка файла
// сразу видна на рабочем столе.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');
Gio._promisify(Gio.File.prototype, 'load_contents_async');

export const WIDGETS_DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'hypede', 'widgets']);
const MAX_LINES = 12;
const TIMEOUT = 10; // секунд на команду

const EXAMPLE = {
    name: 'Uptime',
    icon: 'utilities-system-monitor-symbolic',
    command: ['sh', '-c', 'uptime -p | sed "s/^up //"; date "+%A, %e %B"'],
    interval: 60,
    style: 'big',
};

function readJson(path) {
    try {
        return JSON.parse(new TextDecoder().decode(GLib.file_get_contents(path)[1]));
    } catch {
        return null;
    }
}

// Все описания виджетов: id (имя папки) → описание.
export function listCustomWidgets() {
    const out = new Map();
    let dir;
    try {
        dir = Gio.File.new_for_path(WIDGETS_DIR).enumerate_children('standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE, null);
    } catch {
        return out;
    }
    for (let info; (info = dir.next_file(null));) {
        if (info.get_file_type() !== Gio.FileType.DIRECTORY)
            continue;
        const id = info.get_name();
        const def = readJson(GLib.build_filenamev([WIDGETS_DIR, id, 'widget.json']));
        if (def && typeof def === 'object')
            out.set(id, def);
    }
    dir.close(null);
    return out;
}

// Создать пример (если папка пуста) и открыть папку.
export function openWidgetsFolder() {
    GLib.mkdir_with_parents(WIDGETS_DIR, 0o755);
    const example = GLib.build_filenamev([WIDGETS_DIR, 'example']);
    if (listCustomWidgets().size === 0) {
        GLib.mkdir_with_parents(example, 0o755);
        GLib.file_set_contents(GLib.build_filenamev([example, 'widget.json']), `${JSON.stringify(EXAMPLE, null, 2)}\n`);
    }
    try {
        Gio.AppInfo.launch_default_for_uri(GLib.filename_to_uri(WIDGETS_DIR, null), null);
    } catch (e) {
        logError(e, 'HypeDE: не удалось открыть папку виджетов');
    }
}

function spawn(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
    } catch (e) {
        logError(e, 'HypeDE: виджет не смог запустить команду');
    }
}

async function runCommand(argv, cwd) {
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE});
    launcher.set_cwd(cwd);
    const proc = launcher.spawnv(argv);
    const timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, TIMEOUT, () => {
        proc.force_exit();
        return GLib.SOURCE_REMOVE;
    });
    try {
        const [stdout] = await proc.communicate_utf8_async(null, null);
        return stdout ?? '';
    } finally {
        GLib.source_remove(timer);
    }
}

// Строитель для widgets.js: заполняет виджет w по описанию def.
export function buildCustomWidget(w, id, def) {
    const dir = GLib.build_filenamev([WIDGETS_DIR, id]);
    const style = ['big', 'list', 'text'].includes(def.style) ? def.style : 'text';
    const head = new St.BoxLayout({style_class: 'hypede-widget-custom-head'});
    if (def.icon) {
        const file = GLib.build_filenamev([dir, String(def.icon)]);
        const gicon = GLib.file_test(file, GLib.FileTest.EXISTS)
            ? Gio.FileIcon.new(Gio.File.new_for_path(file)) : Gio.ThemedIcon.new(String(def.icon));
        head.add_child(new St.Icon({gicon, style_class: 'hypede-widget-custom-icon'}));
    }
    head.add_child(new St.Label({text: String(def.name ?? id), style_class: 'hypede-widget-title', y_align: Clutter.ActorAlign.CENTER}));
    w.add_child(head);
    const body = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: `hypede-widget-custom-body ${style}`});
    w.add_child(body);

    const show = text => {
        body.destroy_all_children();
        const lines = String(text).replace(/\s+$/, '').split('\n').slice(0, MAX_LINES);
        lines.forEach((line, i) => {
            const cls = style === 'big' && i === 0 ? 'hypede-widget-time'
                : style === 'list' ? 'hypede-widget-value' : 'hypede-widget-caption';
            const label = new St.Label({text: style === 'list' ? `•  ${line}` : line, style_class: cls});
            label.clutter_text.line_wrap = style === 'text';
            body.add_child(label);
        });
    };

    let busy = false;
    const update = async () => {
        if (busy || !w.mapped && w.get_stage())
            return;
        busy = true;
        try {
            if (Array.isArray(def.command) && def.command.length)
                show(await runCommand(def.command.map(String), dir));
            else if (def.file) {
                const [bytes] = await Gio.File.new_for_path(GLib.build_filenamev([dir, String(def.file)])).load_contents_async(null);
                show(new TextDecoder().decode(bytes));
            } else {
                show(def.text ?? '');
            }
        } catch (e) {
            show(e.message);
        } finally {
            busy = false;
        }
    };
    update();
    const interval = Math.max(5, Number(def.interval) || 0);
    if (def.command || def.file) {
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, interval, () => {
            if (w.get_stage())
                update();
            return GLib.SOURCE_CONTINUE;
        });
        w.connect('destroy', () => GLib.source_remove(timer));
    }
    w.onClick = Array.isArray(def.click) && def.click.length ? () => spawn(def.click.map(String)) : () => update();
}
