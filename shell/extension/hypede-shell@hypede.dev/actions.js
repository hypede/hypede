import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {getModes, modeIcon, modeName} from './modes.js';
import {getSession} from './session.js';

const settings = {};
const schema = id => (settings[id] ??= new Gio.Settings({schema_id: id}));

function spawn(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
    } catch {}
}

function output(argv) {
    try {
        const [, out] = GLib.spawn_sync(null, argv, null, GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.STDERR_TO_DEV_NULL, null);
        return new TextDecoder().decode(out);
    } catch {
        return '';
    }
}

const has = program => !!GLib.find_program_in_path(program);
const osd = (icon, text) => Main.osdWindowManager.show(-1, Gio.ThemedIcon.new(icon), text);

function toggle(id, key, invert = false) {
    const s = schema(id);
    s.set_boolean(key, !s.get_boolean(key));
    return invert ? !s.get_boolean(key) : s.get_boolean(key);
}

let inhibitCookie = 0;
let inhibitTimer = 0;
function keepAwake(minutes) {
    const call = (method, args, type) => Gio.DBus.session.call_sync('org.gnome.SessionManager', '/org/gnome/SessionManager',
        'org.gnome.SessionManager', method, args, type ? new GLib.VariantType(type) : null, Gio.DBusCallFlags.NONE, 1000, null);
    try {
        if (inhibitCookie)
            call('Uninhibit', new GLib.Variant('(u)', [inhibitCookie]));
        if (inhibitTimer)
            GLib.source_remove(inhibitTimer);
        [inhibitCookie] = call('Inhibit', new GLib.Variant('(susu)', ['hypede', 0, _('Keep awake'), 8 | 4]), '(u)').deepUnpack();
        inhibitTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, minutes * 60, () => {
            call('Uninhibit', new GLib.Variant('(u)', [inhibitCookie]));
            inhibitCookie = inhibitTimer = 0;
            return GLib.SOURCE_REMOVE;
        });
    } catch {}
}

function timer(seconds, label) {
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
        Main.notify(_('Timer'), _('%s is up').format(label));
        global.display.get_sound_player().play_from_theme('complete', _('Timer'), null);
        return GLib.SOURCE_REMOVE;
    });
}

const WORDS = {
    dark: ['dark', 'light', 'theme', 'темн', 'светл', 'тема'],
    dnd: ['do not disturb', 'dnd', 'notifications', 'не беспок', 'уведомл'],
    night: ['night light', 'night', 'ночн'],
    wifi: ['wifi', 'wi-fi', 'вайфай', 'вай-фай'],
    bluetooth: ['bluetooth', 'блютуз', 'блютус'],
    lock: ['lock', 'заблок', 'блокир'],
    screenshot: ['screenshot', 'скриншот', 'снимок экрана'],
    logout: ['log out', 'logout', 'sign out', 'выйти', 'выход'],
    restart: ['restart', 'reboot', 'перезагр'],
    poweroff: ['shut down', 'shutdown', 'power off', 'выключ'],
    suspend: ['suspend', 'sleep', 'спящ', 'сон'],
    trash: ['empty trash', 'trash', 'очист', 'корзин'],
    restore: ['restore session', 'restore windows', 'восстанов'],
    save: ['save session', 'сохранить сеанс', 'сеанс'],
    mode: ['mode', 'focus', 'режим', 'фокус'],
};

function matches(query, key) {
    return WORDS[key].some(w => w.startsWith(query) || query.startsWith(w));
}

// Действия, подходящие к запросу: [{iconName, title, subtitle, activate}].
export function findActions(text) {
    const q = text.trim().toLowerCase().replaceAll('ё', 'е');
    if (q.length < 2)
        return [];
    const out = [];
    const add = (iconName, title, subtitle, activate) => out.push({iconName, title, subtitle, activate});
    let m;

    if ((m = /^(volume|громкость|звук)\s*(\d{1,3})\s*%?$/.exec(q))) {
        const v = Math.min(150, Number(m[2]));
        add('audio-volume-high-symbolic', _('Volume %d%%').format(v), _('Set sound volume'), () => {
            if (has('wpctl'))
                spawn(['wpctl', 'set-volume', '@DEFAULT_AUDIO_SINK@', `${v}%`]);
            else
                spawn(['pactl', 'set-sink-volume', '@DEFAULT_SINK@', `${v}%`]);
            osd('audio-volume-high-symbolic', _('Volume %d%%').format(v));
        });
    }
    if ((m = /^(brightness|яркость)\s*(\d{1,3})\s*%?$/.exec(q))) {
        const v = Math.max(1, Math.min(100, Number(m[2])));
        add('display-brightness-symbolic', _('Brightness %d%%').format(v), _('Set screen brightness'), () => {
            Gio.DBus.session.call('org.gnome.SettingsDaemon.Power', '/org/gnome/SettingsDaemon/Power',
                'org.freedesktop.DBus.Properties', 'Set',
                new GLib.Variant('(ssv)', ['org.gnome.SettingsDaemon.Power.Screen', 'Brightness', new GLib.Variant('i', v)]),
                null, Gio.DBusCallFlags.NONE, -1, null, null);
        });
    }
    if ((m = /^(timer|таймер)\s*(\d+)\s*(s|sec|с|сек|h|ч|час)?\w*$/.exec(q))) {
        const n = Number(m[2]);
        const unit = m[3] ?? 'm';
        const seconds = /^(s|с)/.test(unit) ? n : /^(h|ч)/.test(unit) ? n * 3600 : n * 60;
        const label = /^(s|с)/.test(unit) ? _('%d s').format(n) : /^(h|ч)/.test(unit) ? _('%d h').format(n) : _('%d min').format(n);
        add('alarm-symbolic', _('Timer for %s').format(label), _('A notification will remind you'), () => {
            timer(seconds, label);
            osd('alarm-symbolic', _('Timer for %s').format(label));
        });
    }
    if ((m = /^(coffee|awake|кофе|не спать)\s*(\d+)?/.exec(q))) {
        const minutes = Number(m[2] ?? 60);
        add('weather-clear-symbolic', _('Keep awake for %d min').format(minutes), _('The screen will not dim or lock'), () => {
            keepAwake(minutes);
            osd('weather-clear-symbolic', _('Keep awake for %d min').format(minutes));
        });
    }

    const iface = schema('org.gnome.desktop.interface');
    if (matches(q, 'dark')) {
        const dark = iface.get_string('color-scheme') === 'prefer-dark';
        add(dark ? 'weather-clear-symbolic' : 'weather-clear-night-symbolic', dark ? _('Light style') : _('Dark style'), _('Switch the color scheme'),
            () => iface.set_string('color-scheme', dark ? 'default' : 'prefer-dark'));
    }
    if (matches(q, 'dnd')) {
        const on = !schema('org.gnome.desktop.notifications').get_boolean('show-banners');
        add('notifications-disabled-symbolic', on ? _('Turn off Do Not Disturb') : _('Turn on Do Not Disturb'), _('Notifications'),
            () => toggle('org.gnome.desktop.notifications', 'show-banners'));
    }
    if (matches(q, 'night')) {
        const on = schema('org.gnome.settings-daemon.plugins.color').get_boolean('night-light-enabled');
        add('night-light-symbolic', on ? _('Turn off Night Light') : _('Turn on Night Light'), _('Warmer colors at night'),
            () => toggle('org.gnome.settings-daemon.plugins.color', 'night-light-enabled'));
    }
    if (matches(q, 'wifi') && has('nmcli')) {
        const on = output(['nmcli', 'radio', 'wifi']).trim() === 'enabled';
        add('network-wireless-symbolic', on ? _('Turn off Wi‑Fi') : _('Turn on Wi‑Fi'), _('Wireless network'),
            () => spawn(['nmcli', 'radio', 'wifi', on ? 'off' : 'on']));
    }
    if (matches(q, 'bluetooth') && has('bluetoothctl')) {
        const on = /Powered: yes/.test(output(['bluetoothctl', 'show']));
        add('bluetooth-active-symbolic', on ? _('Turn off Bluetooth') : _('Turn on Bluetooth'), 'Bluetooth',
            () => spawn(['bluetoothctl', 'power', on ? 'off' : 'on']));
    }
    const sys = SystemActions.getDefault();
    if (matches(q, 'lock'))
        add('system-lock-screen-symbolic', _('Lock screen'), _('Super+L'), () => sys.activateLockScreen());
    if (matches(q, 'screenshot'))
        add('applets-screenshooter-symbolic', _('Take a screenshot'), _('Print Screen'), () => Main.screenshotUI.open());
    if (matches(q, 'suspend'))
        add('weather-clear-night-symbolic', _('Suspend'), _('Power'), () => sys.activateSuspend());
    if (matches(q, 'logout'))
        add('system-log-out-symbolic', _('Log out'), _('Power'), () => sys.activateLogout());
    if (matches(q, 'restart'))
        add('system-reboot-symbolic', _('Restart'), _('Power'), () => sys.activateRestart());
    if (matches(q, 'poweroff'))
        add('system-shutdown-symbolic', _('Shut down'), _('Power'), () => sys.activatePowerOff());
    if (matches(q, 'trash'))
        add('user-trash-symbolic', _('Empty trash'), _('Files'), () => spawn(['gio', 'trash', '--empty']));
    const session = getSession();
    if (session && matches(q, 'restore'))
        add('view-restore-symbolic', _('Restore last session'), _('Reopen windows from your last session'), () => session.restore());
    if (session && matches(q, 'save'))
        add('document-save-symbolic', _('Save session'), _('Remember open windows'), () => {
            session.save();
            osd('document-save-symbolic', _('Session saved'));
        });
    const modes = getModes();
    if (modes && (matches(q, 'mode') || modes.list.some(md => modeName(md).toLowerCase().startsWith(q)))) {
        const words = q.replace(/^(mode|focus|режим|фокус)\s*/, '');
        for (const md of modes.list) {
            if (words && !modeName(md).toLowerCase().startsWith(words) && !matches(q, 'mode'))
                continue;
            const active = modes.active === md.id;
            add(modeIcon(md), active ? _('Turn off %s mode').format(modeName(md)) : _('%s mode').format(modeName(md)),
                _('Focus mode'), () => modes.set(active ? '' : md.id));
        }
    }
    return out.slice(0, 6);
}
