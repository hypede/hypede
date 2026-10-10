// Захват экрана: выбор области (для OCR), пипетка цвета, распознавание текста (tesseract).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Emitter, Timers, cacheDir, fillTemplate, hasProgram, runShell} from '../utils.js';
import {rgbToHex} from '../pure/format.js';

// GNOME 50 убрал Meta.Cursor и global.display.set_cursor(): курсор задаётся
// через Clutter.Actor.set_cursor_type(). В GNOME 45–49 остаётся старый способ.
function setCursor(name) {
    try {
        if (typeof global.stage.set_cursor_type === 'function') {
            global.stage.set_cursor_type(Clutter.CursorType[name] ?? Clutter.CursorType.DEFAULT);
        } else {
            global.display.set_cursor(Meta.Cursor[name] ?? Meta.Cursor.DEFAULT);
        }
    } catch (e) {
        console.error(`[dynamic-island] setCursor: ${e.message}`);
    }
}

/**
 * Полноэкранный слой для выбора области или точки.
 * mode: 'area' | 'point'
 */
class SelectionOverlay {
    constructor(mode, {onMotion} = {}) {
        this._mode = mode;
        this._onMotion = onMotion;
        this.actor = new St.Widget({
            reactive: true,
            can_focus: true,
            x: 0,
            y: 0,
            width: global.stage.width,
            height: global.stage.height,
            style: mode === 'area' ? 'background-color: rgba(0,0,0,0.28);' : 'background-color: rgba(0,0,0,0);',
            layout_manager: new Clutter.FixedLayout(),
        });
        this._rect = new St.Widget({
            style: 'border: 2px solid rgba(255,255,255,0.95); background-color: rgba(255,255,255,0.12); border-radius: 4px;',
            visible: false,
        });
        this.actor.add_child(this._rect);
        this._hint = new St.Label({
            style: 'background-color: rgba(0,0,0,0.8); color: white; padding: 8px 14px; border-radius: 12px; font-size: 13px;',
            text: mode === 'area'
                ? 'Выделите область с текстом · Esc — отмена'
                : 'Нажмите, чтобы взять цвет · Esc — отмена',
        });
        this.actor.add_child(this._hint);
        Main.uiGroup.add_child(this.actor);
        const mon = Main.layoutManager.primaryMonitor;
        this._hint.set_position(
            mon.x + Math.round((mon.width - 360) / 2),
            mon.y + Math.round(mon.height * 0.12));

        this._grab = Main.pushModal(this.actor, {actionMode: Shell.ActionMode.POPUP});
        setCursor('CROSSHAIR');
        this._promise = new Promise(resolve => {
            this._resolve = resolve;
        });
        this.actor.connect('event', (a, e) => this._onEvent(e));
    }

    get result() {
        return this._promise;
    }

    _onEvent(event) {
        const type = event.type();
        // События входа/выхода указателя обязаны идти дальше: иначе Clutter 50
        // пишет в лог «runtime check failed (retval == CLUTTER_EVENT_PROPAGATE)»
        if (type === Clutter.EventType.ENTER || type === Clutter.EventType.LEAVE)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        if (type === Clutter.EventType.KEY_PRESS) {
            if (event.get_key_symbol() === Clutter.KEY_Escape)
                this._finish(null);
            return Clutter.EVENT_STOP;
        }
        if (this._mode === 'point') {
            if (type === Clutter.EventType.MOTION)
                this._onMotion?.(x, y);
            if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
                if (event.get_button?.() === 3)
                    this._finish(null);
                else
                    this._finish({x: Math.round(x), y: Math.round(y)});
            }
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
            if (event.get_button?.() === 3) {
                this._finish(null);
                return Clutter.EVENT_STOP;
            }
            this._start = [x, y];
            this._rect.visible = true;
            this._hint.visible = false;
            this._update(x, y);
        } else if ((type === Clutter.EventType.MOTION || type === Clutter.EventType.TOUCH_UPDATE) && this._start) {
            this._update(x, y);
        } else if ((type === Clutter.EventType.BUTTON_RELEASE || type === Clutter.EventType.TOUCH_END) && this._start) {
            const g = this._geometry(x, y);
            this._finish(g.width > 4 && g.height > 4 ? g : null);
        }
        return Clutter.EVENT_STOP;
    }

    _geometry(x, y) {
        const [sx, sy] = this._start;
        return {
            x: Math.round(Math.min(sx, x)),
            y: Math.round(Math.min(sy, y)),
            width: Math.round(Math.abs(x - sx)),
            height: Math.round(Math.abs(y - sy)),
        };
    }

    _update(x, y) {
        const g = this._geometry(x, y);
        this._rect.set_position(g.x, g.y);
        this._rect.set_size(g.width, g.height);
    }

    _finish(result) {
        if (this._done)
            return;
        this._done = true;
        setCursor('DEFAULT');
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this.actor.destroy();
        this._resolve(result);
    }

    cancel() {
        this._finish(null);
    }
}

export class CaptureService extends Emitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._timers = new Timers();
        this.lastOcr = '';
        this.lastColor = null;
        this.busy = false;
        this._overlay = null;
    }

    get ocrAvailable() {
        return hasProgram('tesseract') || !this._settings.get_string('ocr-command').startsWith('tesseract');
    }

    /** Выбор области на экране. */
    async selectArea() {
        this._overlay?.cancel();
        this._overlay = new SelectionOverlay('area');
        const g = await this._overlay.result;
        this._overlay = null;
        return g;
    }

    /** Снимок области в PNG. */
    async captureArea(g) {
        // Ждём, пока исчезнет затемнение
        await this._timers.sleep(120);
        const path = GLib.build_filenamev([cacheDir('tmp'), `area-${Date.now()}.png`]);
        const file = Gio.File.new_for_path(path);
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        const shooter = new Shell.Screenshot();
        await new Promise((resolve, reject) => {
            shooter.screenshot_area(g.x, g.y, g.width, g.height, stream, (obj, res) => {
                try {
                    obj.screenshot_area_finish(res);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
        stream.close(null);
        return path;
    }

    /** Распознаёт текст на изображении. */
    async ocrFile(path) {
        const template = this._settings.get_string('ocr-command');
        if (template.startsWith('tesseract') && !hasProgram('tesseract'))
            throw new Error('Не установлен tesseract. Установите: sudo apt install tesseract-ocr tesseract-ocr-rus');
        const cmd = fillTemplate(template, {file: path, lang: this._settings.get_string('ocr-languages')});
        const res = await runShell(cmd);
        if (!res.ok)
            throw new Error((res.stderr || 'Ошибка OCR').trim().split('\n').slice(-3).join('\n'));
        return res.stdout.replace(/\f/g, '').replace(/\n{3,}/g, '\n\n').trim();
    }

    /** Выделить область → распознать текст. */
    async ocrArea() {
        if (this.busy)
            return null;
        const g = await this.selectArea();
        if (!g)
            return null;
        this.busy = true;
        this.emit('changed');
        let path;
        try {
            path = await this.captureArea(g);
            this.lastCapture = path;
            const text = await this.ocrFile(path);
            this.lastOcr = text;
            this.emit('ocr', text);
            return text;
        } finally {
            this.busy = false;
            if (path) {
                try {
                    Gio.File.new_for_path(path).delete(null);
                } catch {}
            }
            this.emit('changed');
        }
    }

    /** Пипетка: возвращает {hex, r, g, b}. */
    async pickColor(onPreview) {
        const shooter = new Shell.Screenshot();
        const pick = (x, y) => new Promise((resolve, reject) => {
            shooter.pick_color(x, y, (obj, res) => {
                try {
                    const r = obj.pick_color_finish(res);
                    resolve(Array.isArray(r) ? r[r.length - 1] : r);
                } catch (e) {
                    reject(e);
                }
            });
        });
        let pending = false;
        this._overlay?.cancel();
        this._overlay = new SelectionOverlay('point', {
            onMotion: (x, y) => {
                if (pending || !onPreview)
                    return;
                pending = true;
                pick(Math.round(x), Math.round(y))
                    .then(c => onPreview(this._toColor(c), x, y))
                    .catch(() => {})
                    .finally(() => {
                        pending = false;
                    });
            },
        });
        const p = await this._overlay.result;
        this._overlay = null;
        if (!p)
            return null;
        await this._timers.sleep(60);
        const c = this._toColor(await pick(p.x, p.y));
        this.lastColor = c;
        this.emit('color', c);
        return c;
    }

    _toColor(c) {
        const r = c.red, g = c.green, b = c.blue;
        return {r, g, b, hex: rgbToHex(r, g, b), css: `rgb(${r}, ${g}, ${b})`};
    }

    destroy() {
        this._overlay?.cancel();
        this._timers.destroy();
        this.disconnectAll();
    }
}
