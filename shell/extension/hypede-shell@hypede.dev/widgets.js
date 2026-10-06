// Виджеты на рабочем столе: часы, календарь, погода, система, музыка, заметка.
//
// Живут в своём слое под окнами. Их перетаскивают мышью, правой кнопкой —
// меню «Добавить / Убрать». Список и места хранятся в ключе desktop-widgets.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import GObject from 'gi://GObject';
import GWeather from 'gi://GWeather';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import {MprisSource} from 'resource:///org/gnome/shell/ui/mpris.js';
import {WeatherClient} from 'resource:///org/gnome/shell/misc/weather.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const GRID = 8;
const MARGIN = 24;

export const TYPES = ['clock', 'calendar', 'weather', 'system', 'media', 'note'];
const title = t => ({
    clock: _('Clock'), calendar: _('Calendar'), weather: _('Weather'),
    system: _('System'), media: _('Music'), note: _('Note'),
})[t];

const label = (style_class, text = '') => new St.Label({style_class, text, x_align: Clutter.ActorAlign.START});

function readFile(path) {
    try {
        return new TextDecoder().decode(GLib.file_get_contents(path)[1]);
    } catch {
        return '';
    }
}

function bar() {
    const track = new St.Widget({style_class: 'hypede-widget-bar', x_expand: true});
    const fill = new St.Widget({style_class: 'hypede-widget-bar-fill'});
    track.add_child(fill);
    track.set = v => {
        fill.width = Math.round(track.width * Math.min(1, Math.max(0, v)));
        fill.height = track.height;
    };
    return track;
}

function row(name) {
    const box = new St.BoxLayout({vertical: true, style_class: 'hypede-widget-row'});
    const head = new St.BoxLayout();
    const text = label('hypede-widget-caption', name);
    const value = label('hypede-widget-value');
    text.x_expand = true;
    head.add_child(text);
    head.add_child(value);
    const b = bar();
    box.add_child(head);
    box.add_child(b);
    box.set = (v, s) => {
        value.text = s;
        b.set(v);
    };
    return box;
}

const builders = {
    clock(w) {
        const time = label('hypede-widget-time');
        const date = label('hypede-widget-date');
        w.add_child(time);
        w.add_child(date);
        const clock = new GnomeDesktop.WallClock({time_only: true});
        const sync = () => {
            time.text = clock.clock.trim();
            date.text = GLib.DateTime.new_now_local().format('%A, %e %B').replace(/\s+/g, ' ');
        };
        clock.connectObject('notify::clock', sync, w);
        sync();
        w.connect('destroy', () => clock.run_dispose());
    },

    calendar(w) {
        const cal = new Calendar.Calendar();
        cal.setEventSource(new Calendar.EmptyEventSource());
        w.add_child(cal);
    },

    weather(w) {
        const client = new WeatherClient();
        const top = new St.BoxLayout({style_class: 'hypede-widget-weather'});
        const icon = new St.Icon({style_class: 'hypede-widget-weather-icon', icon_name: 'weather-clear-symbolic'});
        const temp = label('hypede-widget-time');
        top.add_child(icon);
        top.add_child(temp);
        const place = label('hypede-widget-date');
        const sky = label('hypede-widget-caption');
        w.add_child(top);
        w.add_child(place);
        w.add_child(sky);
        const sync = () => {
            const info = client.info;
            if (!client.available || !client.hasLocation) {
                icon.icon_name = 'find-location-symbolic';
                temp.text = '';
                place.text = client.available ? _('Choose a city in Weather') : _('Install GNOME Weather');
                sky.text = _('Click to open');
                return;
            }
            place.text = info.location?.get_city_name?.() || info.location?.get_name() || '';
            if (!info.is_valid()) {
                temp.text = '';
                sky.text = client.loading ? _('Loading…') : _('Weather unavailable');
                return;
            }
            const [, t] = info.get_value_temp(GWeather.TemperatureUnit.DEFAULT);
            temp.text = `${Math.round(t)}°`;
            icon.icon_name = info.get_symbolic_icon_name();
            sky.text = info.get_weather_summary().split(/[,:]/).pop().trim() || info.get_sky();
        };
        client.connectObject('changed', sync, w);
        client.update();
        sync();
        const id = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 1800, () => {
            client.update();
            return GLib.SOURCE_CONTINUE;
        });
        w.connect('destroy', () => GLib.source_remove(id));
        w.onClick = () => Shell.AppSystem.get_default().lookup_app('org.gnome.Weather.desktop')?.activate();
    },

    system(w) {
        const cpu = row(_('Processor'));
        const mem = row(_('Memory'));
        const bat = row(_('Battery'));
        w.add_child(label('hypede-widget-title', _('System')));
        w.add_child(cpu);
        w.add_child(mem);
        w.add_child(bat);
        let last = null;
        const battery = ['BAT0', 'BAT1', 'battery'].map(b => `/sys/class/power_supply/${b}/capacity`)
            .find(p => GLib.file_test(p, GLib.FileTest.EXISTS));
        bat.visible = !!battery;
        const sync = () => {
            const n = readFile('/proc/stat').split('\n')[0].split(/\s+/).slice(1).map(Number);
            const idle = n[3] + (n[4] || 0);
            const total = n.reduce((a, b) => a + b, 0);
            if (last && total > last[1]) {
                const used = 1 - (idle - last[0]) / (total - last[1]);
                cpu.set(used, `${Math.round(used * 100)}%`);
            }
            last = [idle, total];
            const m = Object.fromEntries(readFile('/proc/meminfo').split('\n')
                .map(l => l.split(/:\s+/)).filter(p => p.length === 2).map(([k, v]) => [k, parseInt(v)]));
            if (m.MemTotal) {
                const used = (m.MemTotal - m.MemAvailable) / m.MemTotal;
                mem.set(used, `${((m.MemTotal - m.MemAvailable) / 1048576).toFixed(1)} / ${(m.MemTotal / 1048576).toFixed(1)} ${_('GB')}`);
            }
            if (battery) {
                const v = parseInt(readFile(battery));
                bat.set(v / 100, `${v}%`);
            }
            return GLib.SOURCE_CONTINUE;
        };
        sync();
        const id = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 2, sync);
        w.connect('destroy', () => GLib.source_remove(id));
    },

    media(w) {
        const source = new MprisSource();
        const art = new St.Icon({style_class: 'hypede-widget-cover', icon_name: 'audio-x-generic-symbolic'});
        const text = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const song = label('hypede-widget-song');
        const artist = label('hypede-widget-caption');
        song.clutter_text.ellipsize = artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(song);
        text.add_child(artist);
        const top = new St.BoxLayout({style_class: 'hypede-widget-media'});
        top.add_child(art);
        top.add_child(text);
        const controls = new St.BoxLayout({style_class: 'hypede-widget-controls', x_align: Clutter.ActorAlign.CENTER});
        const button = (icon, fn) => {
            const b = new St.Button({style_class: 'hypede-widget-button', child: new St.Icon({icon_name: icon})});
            b.connect('clicked', () => fn(source.players[0]));
            controls.add_child(b);
            return b;
        };
        button('media-skip-backward-symbolic', p => p?.previous());
        const play = button('media-playback-start-symbolic', p => p?.playPause());
        button('media-skip-forward-symbolic', p => p?.next());
        w.add_child(top);
        w.add_child(controls);
        const sync = () => {
            const p = source.players[0];
            w.visible = !!p;
            if (!p)
                return;
            song.text = p.trackTitle || p.app?.get_name() || '';
            artist.text = p.trackArtists?.join(', ') ?? '';
            if (p.trackCoverUrl)
                art.gicon = new Gio.FileIcon({file: Gio.File.new_for_uri(p.trackCoverUrl)});
            else
                art.icon_name = 'audio-x-generic-symbolic';
            play.child.icon_name = p.status === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        };
        const watch = p => p.connectObject('changed', sync, w);
        source.connectObject(
            'player-added', (_s, p) => {
                watch(p);
                sync();
            },
            'player-removed', sync, w);
        source.players.forEach(watch);
        sync();
        w.onClick = () => source.players[0]?.raise();
    },

    note(w, settings) {
        const entry = new St.Entry({style_class: 'hypede-widget-note-entry', hint_text: _('Write something…'), can_focus: true});
        const text = entry.clutter_text;
        text.single_line_mode = false;
        text.line_wrap = true;
        text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        text.activatable = false;
        entry.text = settings.get_string('widget-note');
        let id = 0;
        text.connect('text-changed', () => {
            if (id)
                GLib.source_remove(id);
            id = GLib.timeout_add(GLib.PRIORITY_LOW, 600, () => {
                id = 0;
                settings.set_string('widget-note', entry.text);
                return GLib.SOURCE_REMOVE;
            });
        });
        w.connect('destroy', () => id && GLib.source_remove(id));
        entry.connect('button-press-event', () => {
            text.grab_key_focus();
            return Clutter.EVENT_PROPAGATE;
        });
        w.onClick = () => text.grab_key_focus();
        w.add_child(entry);
    },
};

const Widget = GObject.registerClass(
class Widget extends St.BoxLayout {
    _init(type, settings) {
        super._init({
            style_class: `hypede-widget hypede-widget-${type}`,
            vertical: true,
            reactive: true,
            track_hover: true,
        });
        this.type = type;
        builders[type](this, settings);
    }
});

export class Widgets {
    constructor(settings) {
        this._settings = settings;
        this._widgets = [];
        this._layer = new Meta.BackgroundGroup({name: 'hypede-widgets'});
        global.window_group.add_child(this._layer);
        const below = global.window_group.get_children().find(c => c.name === 'hypede-desktop-layer') ??
            Main.layoutManager._backgroundGroup;
        global.window_group.set_child_above_sibling(this._layer, below);
        this._menuManager = new PopupMenu.PopupMenuManager(this._layer);

        settings.connectObject('changed::desktop-widgets', () => !this._saving && this._load(), this);
        global.display.connectObject('workareas-changed', () => this._placeAll(), this);
        this._load();
    }

    get _area() {
        return Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
    }

    _read() {
        try {
            const list = JSON.parse(this._settings.get_string('desktop-widgets'));
            return Array.isArray(list) ? list.filter(e => builders[e?.type]) : [];
        } catch {
            return [];
        }
    }

    _load() {
        this._widgets.forEach(w => w.destroy());
        this._widgets = [];
        for (const e of this._read())
            this._add(e);
        this._placeAll();
    }

    _add(e) {
        const w = new Widget(e.type, this._settings);
        w.pos = Number.isFinite(e.x) && Number.isFinite(e.y) ? [e.x, e.y] : null;
        w.connect('button-press-event', (a, ev) => this._press(w, ev));
        w.connect('touch-event', (a, ev) => {
            if (ev.type() === Clutter.EventType.TOUCH_BEGIN)
                return this._press(w, ev);
            return Clutter.EVENT_PROPAGATE;
        });
        w.connect('notify::visible', () => this._placeAll());
        this._layer.add_child(w);
        this._widgets.push(w);
        w.opacity = 0;
        w.ease({opacity: 255, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        return w;
    }

    // Без сохранённого места виджеты встают столбиком у правого края.
    _placeAll() {
        const area = this._area;
        let y = area.y + MARGIN;
        for (const w of this._widgets) {
            const [, width] = w.get_preferred_width(-1);
            const [, height] = w.get_preferred_height(width);
            if (w.pos) {
                w.set_position(
                    Math.round(Math.min(Math.max(area.x + w.pos[0], area.x), area.x + area.width - width)),
                    Math.round(Math.min(Math.max(area.y + w.pos[1], area.y), area.y + area.height - height)));
            } else {
                w.set_position(area.x + area.width - width - MARGIN, y);
                if (w.visible)
                    y += height + 16;
            }
        }
    }

    _save() {
        const area = this._area;
        this._saving = true;
        this._settings.set_string('desktop-widgets', JSON.stringify(this._widgets.map(w => w.pos
            ? {type: w.type, x: w.x - area.x, y: w.y - area.y} : {type: w.type})));
        this._saving = false;
    }

    _press(w, event) {
        const button = event.type() === Clutter.EventType.BUTTON_PRESS ? event.get_button() : 1;
        if (button === 3) {
            this._menu(w);
            return Clutter.EVENT_STOP;
        }
        const source = global.stage.get_event_actor(event);
        if (button !== 1 || (source && source !== w && source.reactive && !(source instanceof St.Label)))
            return Clutter.EVENT_PROPAGATE;
        const [sx, sy] = event.get_coords();
        const [ox, oy] = [w.x, w.y];
        const grab = global.stage.grab(w);
        let moved = false;
        w.add_style_pseudo_class('drag');
        const motion = w.connect('captured-event', (a, ev) => {
            const t = ev.type();
            if (t === Clutter.EventType.MOTION || t === Clutter.EventType.TOUCH_UPDATE) {
                const [x, y] = ev.get_coords();
                if (!moved && Math.hypot(x - sx, y - sy) < 6)
                    return Clutter.EVENT_STOP;
                moved = true;
                const area = this._area;
                w.set_position(
                    Math.min(Math.max(area.x, Math.round((ox + x - sx) / GRID) * GRID), area.x + area.width - w.width),
                    Math.min(Math.max(area.y, Math.round((oy + y - sy) / GRID) * GRID), area.y + area.height - w.height));
                return Clutter.EVENT_STOP;
            }
            if (t === Clutter.EventType.BUTTON_RELEASE || t === Clutter.EventType.TOUCH_END || t === Clutter.EventType.TOUCH_CANCEL) {
                w.disconnect(motion);
                grab.dismiss();
                w.remove_style_pseudo_class('drag');
                if (moved) {
                    const area = this._area;
                    w.pos = [w.x - area.x, w.y - area.y];
                    this._save();
                } else {
                    w.onClick?.();
                }
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        return Clutter.EVENT_STOP;
    }

    _menu(w) {
        this._popup?.destroy();
        const menu = new PopupMenu.PopupMenu(w, 0.5, St.Side.TOP);
        this._popup = menu;
        Main.uiGroup.add_child(menu.actor);
        this._menuManager.addMenu(menu);
        const present = new Set(this._widgets.map(x => x.type));
        const add = new PopupMenu.PopupSubMenuMenuItem(_('Add widget'));
        for (const t of TYPES.filter(t => !present.has(t))) {
            add.menu.addAction(title(t), () => {
                this._add({type: t});
                this._placeAll();
                this._save();
            });
        }
        if (add.menu.isEmpty())
            add.destroy();
        else
            menu.addMenuItem(add);
        if (w.pos) {
            menu.addAction(_('Return to the column'), () => {
                w.pos = null;
                this._placeAll();
                this._save();
            });
        }
        menu.addAction(_('Remove widget'), () => {
            this._widgets = this._widgets.filter(x => x !== w);
            w.destroy();
            this._placeAll();
            this._save();
        });
        menu.connect('open-state-changed', (m, open) => {
            if (!open)
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    if (this._popup === menu) {
                        menu.destroy();
                        this._popup = null;
                    }
                    return GLib.SOURCE_REMOVE;
                });
        });
        menu.open();
    }

    destroy() {
        this._popup?.destroy();
        this._settings.disconnectObject(this);
        global.display.disconnectObject(this);
        this._layer.destroy();
        this._widgets = [];
    }
}
