// Размытые обои под полупрозрачной полкой и лаунчером.
//
// Shell.BlurEffect размывает заново при каждой отрисовке — на слабой графике
// это половина времени кадра. Под полку и лаунчер окна почти не заходят,
// поэтому хватает размытых обоев. Обои один раз уменьшаются до крошечной
// картинки, а видеокарта растягивает её с плавной фильтрацией: выходит мягкое
// размытие ценой одной маленькой текстуры. Картинка общая для всех подложек и
// пересчитывается, только когда меняются обои или схема.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {CornersEffect} from './corners.js';

const SMALL = 48;

class Wallpaper {
    constructor() {
        this.content = null;
        this.color = Cogl.Color.from_string("#808080")[1];
        this._backdrops = new Set();
        this._bg = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._bg.connectObject('changed', () => this._load(), this);
        this._iface.connectObject('changed::color-scheme', () => this._load(), this);
        Main.layoutManager.connectObject('monitors-changed', () => this._load(), this);
        this._load();
    }

    add(backdrop) {
        this._backdrops.add(backdrop);
    }

    remove(backdrop) {
        this._backdrops.delete(backdrop);
        if (!this._backdrops.size)
            this.destroy();
    }

    _notify() {
        for (const b of this._backdrops)
            b.update();
    }

    _load() {
        this._cancel?.cancel();
        const cancel = this._cancel = new Gio.Cancellable();
        const [ok, color] = Cogl.Color.from_string(this._bg.get_string('primary-color'));
        if (ok)
            this.color = color;
        const dark = this._iface.get_string('color-scheme') === 'prefer-dark';
        const uri = this._bg.get_string(dark ? 'picture-uri-dark' : 'picture-uri') || this._bg.get_string('picture-uri');
        const monitor = Main.layoutManager.primaryMonitor;
        if (!uri || !monitor) {
            this.content = null;
            this._notify();
            return;
        }
        Gio.File.new_for_uri(uri).read_async(GLib.PRIORITY_LOW, cancel, (f, res) => {
            let stream;
            try {
                stream = f.read_finish(res);
            } catch {
                this.content = null;
                this._notify();
                return;
            }
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, 480, -1, true, cancel, (s, r) => {
                let pixbuf = null;
                try {
                    pixbuf = GdkPixbuf.Pixbuf.new_from_stream_finish(r);
                } catch {}
                stream.close_async(GLib.PRIORITY_LOW, null, null);
                if (cancel.is_cancelled())
                    return;
                this.content = pixbuf ? this._small(pixbuf, monitor.width / monitor.height) : null;
                this._notify();
            });
        });
    }

    // Обои «по размеру экрана» (как zoom): обрезка под пропорции монитора,
    // потом уменьшение до SMALL точек по ширине.
    _small(pixbuf, aspect) {
        let w = pixbuf.width, h = pixbuf.height;
        if (w / h > aspect)
            w = Math.round(h * aspect);
        else
            h = Math.round(w / aspect);
        const cropped = pixbuf.new_subpixbuf(Math.floor((pixbuf.width - w) / 2), Math.floor((pixbuf.height - h) / 2), w, h);
        const small = cropped.scale_simple(SMALL, Math.max(1, Math.round(SMALL / aspect)), GdkPixbuf.InterpType.HYPER)
            .add_alpha(false, 0, 0, 0);
        const content = St.ImageContent.new_with_preferred_size(small.width, small.height);
        content.set_bytes(global.stage.context.get_backend().get_cogl_context(), small.read_pixel_bytes(),
            Cogl.PixelFormat.RGBA_8888, small.width, small.height, small.rowstride);
        return content;
    }

    destroy() {
        this._cancel?.cancel();
        this._bg.disconnectObject(this);
        this._iface.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        if (shared === this)
            shared = null;
    }
}

let shared = null;

export const Backdrop = GObject.registerClass(
class Backdrop extends St.Widget {
    _init() {
        super._init({clip_to_allocation: true});
        this._pic = new Clutter.Actor({name: 'hypede-backdrop-picture'});
        this._pic.set_content_scaling_filters(Clutter.ScalingFilter.LINEAR, Clutter.ScalingFilter.LINEAR);
        this.add_child(this._pic);
        this._corners = null;
        shared ??= new Wallpaper();
        this._wallpaper = shared;
        this._wallpaper.add(this);
        this.connect('destroy', () => this._wallpaper.remove(this));
        this.connect('notify::allocation', () => this.sync());
        this.connect('notify::mapped', () => this.sync());
        this.update();
    }

    // Подложка подстраивается под соседей и сама размер не задаёт.
    vfunc_get_preferred_width() {
        return [0, 0];
    }

    vfunc_get_preferred_height() {
        return [0, 0];
    }

    update() {
        this._pic.content = this._wallpaper.content;
        this.background_color = this._wallpaper.color;
        this.sync();
    }

    // Картинка лежит так, чтобы под подложкой были ровно те обои, что за ней на экране.
    sync() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !this.mapped)
            return;
        const [x, y] = this.get_transformed_position();
        const [sw] = this.get_transformed_size();
        // Во время анимации масштаб бывает почти нулевым — тогда ждём следующего раза.
        const k = this.width / sw;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(k) || k <= 0 || k > 100)
            return;
        this._pic.set_position(Math.round((monitor.x - x) * k), Math.round((monitor.y - y) * k));
        this._pic.set_size(Math.round(monitor.width * k), Math.round(monitor.height * k));
    }

    setCornerRadius(radius) {
        if (radius > 0 && !this._corners) {
            this._corners = new CornersEffect(radius);
            this.add_effect(this._corners);
        } else if (radius > 0) {
            this._corners.radius = radius;
        } else if (this._corners) {
            this.remove_effect(this._corners);
            this._corners = null;
        }
    }
});
