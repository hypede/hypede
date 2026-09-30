// Экран блокировки без GDM.
//
// GNOME Shell создаёт экран блокировки, только если экран входа — GDM:
// пароль при разблокировке проверяет сам GDM. С SDDM, greetd или LightDM
// блокировки в GNOME нет вовсе, а Super+L ничего не делает.
//
// Здесь HypeDE создаёт тот же экран блокировки GNOME сам, а проверку пароля
// перенаправляет в hypede-auth — маленькую программу, которая ведёт обычный
// PAM-диалог (как swaylock или экран блокировки KDE). Всё остальное —
// Super+L, блокировка по бездействию и перед сном, `loginctl lock-session`,
// кнопка «Заблокировать» — работает как в обычном GNOME.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ScreenShield from 'resource:///org/gnome/shell/ui/screenShield.js';
import * as GdmUtil from 'resource:///org/gnome/shell/gdm/util.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import {InjectionManager, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const AUTH_HELPER = '/usr/lib/hypede/hypede-auth';

// Экран блокировки создаётся один раз за сеанс: у GNOME нет способа его
// разобрать, и он держит имя org.gnome.ScreenSaver на шине.
let fallbackShield = null;

// То, что GNOME ждёт от Gdm.UserVerifierProxy, но через hypede-auth.
class PamVerifier extends Signals.EventEmitter {
    constructor() {
        super();
        this._connection = new Signals.EventEmitter();
        this._process = null;
    }

    get_connection() {
        return this._connection;
    }

    async call_begin_verification_for_user(serviceName, _userName, cancellable) {
        // Отпечаток и смарт-карта идут через тот же PAM-стек, если они в нём
        // настроены, — отдельные службы GDM здесь не нужны.
        if (serviceName !== GdmUtil.PASSWORD_SERVICE_NAME) {
            this.emit('service-unavailable', serviceName, null);
            return;
        }
        this._stop();
        const process = Gio.Subprocess.new([AUTH_HELPER],
            Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
        this._process = process;
        this._service = serviceName;
        this._stdin = process.get_stdin_pipe();
        this._stdout = new Gio.DataInputStream({base_stream: process.get_stdout_pipe()});
        cancellable?.connect(() => this._stop());
        this.emit('conversation-started', serviceName);
        this._readLoop(process).catch(e => {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e, 'HypeDE: ошибка проверки пароля');
        });
    }

    async _readLoop(process) {
        const service = this._service;
        let finished = false;
        while (this._process === process) {
            // eslint-disable-next-line no-await-in-loop
            const [line] = await this._stdout.read_line_async(GLib.PRIORITY_DEFAULT, null);
            if (this._process !== process)
                return;
            if (line === null)
                break;
            const text = new TextDecoder().decode(line);
            const space = text.indexOf(' ');
            const kind = space < 0 ? text : text.slice(0, space);
            const message = space < 0 ? '' : text.slice(space + 1);
            switch (kind) {
            case 'SECRET':
                this.emit('secret-info-query', service, message || _('Password'));
                break;
            case 'QUERY':
                this.emit('info-query', service, message);
                break;
            case 'INFO':
                this.emit('info', service, message);
                break;
            case 'ERROR':
                this.emit('problem', service, message);
                break;
            case 'OK':
                finished = true;
                this._process = null;
                this.emit('verification-complete', service);
                // С GDM сеанс разблокирует сам GDM (через logind), здесь —
                // экран блокировки.
                fallbackShield?.deactivate(true);
                return;
            case 'FAIL':
                finished = true;
                break;
            }
            if (finished)
                break;
        }
        if (this._process !== process)
            return;
        this._process = null;
        // Неверный пароль: GNOME сам покажет ошибку, посчитает попытку и
        // начнёт проверку заново.
        this.emit('problem', service, _('Sorry, that didn’t work. Please try again.'));
        this.emit('conversation-stopped', service);
    }

    call_answer_query(serviceName, answer, _cancellable, _callback) {
        if (!this._process || serviceName !== this._service)
            return;
        const bytes = new TextEncoder().encode(`${answer}\n`);
        this._stdin.write_all_async(bytes, GLib.PRIORITY_DEFAULT, null, (stream, res) => {
            try {
                stream.write_all_finish(res);
            } catch (e) {
                logError(e, 'HypeDE: не удалось передать пароль');
            }
        });
    }

    call_cancel_sync() {
        this._stop();
    }

    _stop() {
        const process = this._process;
        this._process = null;
        process?.force_exit();
    }
}

// Ставится один раз за сеанс и не снимается: если бы проверка пароля
// вернулась к GDM, пока экран заблокирован, разблокировать его было бы нельзя.
const injections = new InjectionManager();

export function setupLocker() {
    if (fallbackShield || Main.screenShield ||
        !GLib.file_test(AUTH_HELPER, GLib.FileTest.IS_EXECUTABLE))
        return;

    // Проверка пароля — через hypede-auth вместо GDM.
    for (const method of ['_openReauthenticationChannel', '_getUserVerifier']) {
        injections.overrideMethod(GdmUtil.ShellUserVerifier.prototype, method,
            () => function () {
                this._clearUserVerifier();
                this._userVerifier = new PamVerifier();
                this._userVerifierChoiceList = null;
                this.reauthenticating = true;
                this._connectSignals();
                this._beginVerification();
                this._hold.release();
            });
    }

    try {
        fallbackShield = new ScreenShield.ScreenShield();
    } catch (e) {
        logError(e, 'HypeDE: не удалось создать экран блокировки');
        return;
    }

    // Уведомление «Блокировка экрана требует GDM» больше не нужно.
    try {
        GLib.file_set_contents(`${global.userdatadir}/lock-warning-shown`, '');
    } catch {
        // не страшно: уведомление показывается один раз
    }

    // Кнопка «Заблокировать» в меню и действие lock-screen.
    const actions = SystemActions.getDefault();
    const shield = fallbackShield;
    injections.overrideMethod(actions, '_updateLockScreen', () => function () {
        const showLock = !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter;
        const allowed = !this._lockdownSettings.get_boolean('disable-lock-screen');
        this._actions.get('lock-screen').available = showLock && allowed;
        this.notify('can-lock-screen');
    });
    injections.overrideMethod(actions, 'activateLockScreen', () => function () {
        if (this._actions.get('lock-screen').available)
            shield.lock(true);
    });
    actions._updateLockScreen();
}

// Экран блокировки GNOME или созданный HypeDE.
export function getShield() {
    return Main.screenShield ?? fallbackShield;
}
