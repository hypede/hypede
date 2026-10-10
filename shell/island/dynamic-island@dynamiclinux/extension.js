// Dynamic Island для GNOME Shell — точка входа расширения.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Island, State} from './lib/island.js';
import {Emitter, Timers, disposeHttp, showInFolder, trackChrome} from './lib/utils.js';
import {preview, plural, formatBytes} from './lib/pure/format.js';

import {SysMonitor} from './lib/services/sysmon.js';
import {MediaService} from './lib/services/media.js';
import {ClipboardService} from './lib/services/clipboard.js';
import {ShelfService} from './lib/services/shelf.js';
import {DownloadsService} from './lib/services/downloads.js';
import {WeatherService} from './lib/services/weather.js';
import {AIService} from './lib/services/ai.js';
import {VoiceService} from './lib/services/voice.js';
import {RecorderService} from './lib/services/recorder.js';
import {CaptureService} from './lib/services/capture.js';
import {NotificationService} from './lib/services/notifications.js';
import {PetService} from './lib/services/pet.js';
import {TimerService} from './lib/services/timer.js';
import {NotesService} from './lib/services/notes.js';
import {LauncherService} from './lib/services/launcher.js';
import {ControlsService} from './lib/services/controls.js';

// Настройки, изменение которых требует пересоздать остров
const REBUILD_KEYS = [
    'bg-color', 'fg-color', 'accent-color', 'border-color', 'border-width',
    'compact-radius', 'expanded-radius', 'compact-width', 'compact-height',
    'expanded-width', 'expanded-height', 'top-margin', 'font-size', 'font-family',
    'shadow', 'blur', 'animation-style', 'animation-duration', 'content-fade',
    'tab-transition', 'enabled-tabs', 'reserve-space', 'hide-in-fullscreen',
    'music-visualizer',
];

export default class DynamicIslandExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._timers = new Timers();
        this._running = false;

        this._settings.connectObject('changed::island-enabled', () => this._syncEnabled(), this);
        Main.wm.addKeybinding('toggle-island-shortcut', this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._settings.set_boolean('island-enabled', !this._settings.get_boolean('island-enabled')));
        this._syncEnabled();
    }

    disable() {
        Main.wm.removeKeybinding('toggle-island-shortcut');
        this._stop();
        this._settings?.disconnectObject(this);
        this._timers?.destroy();
        this._timers = null;
        this._settings = null;
    }

    _syncEnabled() {
        if (this._settings.get_boolean('island-enabled'))
            this._start();
        else
            this._stop();
    }

    // ================================================================ запуск / остановка

    _start() {
        if (this._running)
            return;
        this._running = true;
        try {
            this._startInner();
        } catch (e) {
            // Лучше остаться без острова, но со стандартной панелью, чем с недостроенным
            logError(e, '[dynamic-island] не удалось запустить остров');
            this._stop();
        }
    }

    _startInner() {
        const settings = this._settings;

        // Секундный «тик» для часов и индикаторов
        this._tick = new Emitter();
        this._tickId = this._timers.interval(1000, () => {
            this._tick.emit('second');
            return true;
        });

        this._services = {};
        const make = (name, fn) => {
            try {
                this._services[name] = fn();
            } catch (e) {
                logError(e, `[dynamic-island] сервис ${name}`);
            }
        };
        make('sysmon', () => new SysMonitor(settings));
        make('media', () => new MediaService());
        make('clipboard', () => new ClipboardService(settings));
        make('shelf', () => new ShelfService(settings, this._services.clipboard));
        make('downloads', () => new DownloadsService(settings));
        make('weather', () => new WeatherService(settings));
        make('ai', () => new AIService(settings));
        make('voice', () => new VoiceService(settings));
        make('recorder', () => new RecorderService(settings));
        make('capture', () => new CaptureService(settings));
        make('notifications', () => new NotificationService(settings));
        make('pet', () => new PetService(settings));
        make('timer', () => new TimerService());
        make('notes', () => new NotesService());
        make('launcher', () => new LauncherService(settings));
        make('controls', () => new ControlsService());

        this._ctx = {
            extension: this,
            settings,
            services: this._services,
            tick: this._tick,
            actions: this._makeActions(),
            expandedTab: id => this._island?.expand({tab: id}),
            sendToTextTools: text => this._openPageWith('text', p => p.setText(text)),
            sendToNotes: text => this._openPageWith('notes', p => p.addText(text)),
        };

        this._createIsland();
        this._wireActivities();
        this._applyPanel();

        settings.connectObject(
            'changed', (s, key) => {
                if (REBUILD_KEYS.includes(key))
                    this._queueRebuild();
                if (key === 'replace-panel' || key === 'show-panel-in-overview')
                    this._applyPanel();
            },
            this._ctx);

        Main.wm.addKeybinding('expand-shortcut', settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => {
                if (Main.overview.visible)
                    Main.overview.hide();
                if (this._island.state === State.EXPANDED && this._island.pinned) {
                    this._island.collapse();
                    return;
                }
                this._island.expand({tab: this._island.expanded.hasTab('launcher') ? 'launcher' : undefined, pin: true, focus: true});
            });
    }

    _stop() {
        if (!this._running)
            return;
        this._running = false;
        const step = (what, fn) => {
            try {
                fn();
            } catch (e) {
                logError(e, `[dynamic-island] остановка: ${what}`);
            }
        };
        step('горячая клавиша', () => Main.wm.removeKeybinding('expand-shortcut'));
        step('настройки', () => this._ctx && this._settings.disconnectObject(this._ctx));
        step('активности', () => this._activitySubs?.forEach(fn => fn()));
        this._activitySubs = null;
        step('панель', () => this._restorePanel());
        step('остров', () => this._destroyIsland());
        for (const [name, svc] of Object.entries(this._services ?? {}))
            step(`сервис ${name}`, () => svc.destroy());
        this._services = null;
        if (this._tickId)
            this._tickId = this._timers.clear(this._tickId);
        step('тик', () => this._tick?.disconnectAll());
        this._tick = null;
        this._vkbd = null;
        this._ctx = null;
        disposeHttp();
    }

    _createIsland() {
        this._island = new Island(this._ctx);
    }

    _destroyIsland() {
        if (this._island) {
            this._island.destroy();
            this._island = null;
        }
    }

    _queueRebuild() {
        if (this._rebuildId)
            this._timers.clear(this._rebuildId);
        this._rebuildId = this._timers.timeout(250, () => {
            this._rebuildId = 0;
            if (!this._running)
                return;
            const wasExpanded = this._island?.state === State.EXPANDED;
            const tab = this._island?.expanded?._current;
            this._destroyIsland();
            this._createIsland();
            if (wasExpanded)
                this._island.expand({tab, pin: true});
        });
    }

    _openPageWith(id, fn) {
        const island = this._island;
        if (!island?.expanded.hasTab(id))
            return;
        island.expand({tab: id, pin: true});
        const page = island.expanded.getPage(id);
        if (page)
            fn(page);
    }

    // ================================================================ панель GNOME

    get panelVisibleInOverview() {
        return this._panelHidden && this._settings.get_boolean('show-panel-in-overview');
    }

    _applyPanel() {
        if (this._settings.get_boolean('replace-panel'))
            this._hidePanel();
        else
            this._restorePanel();
    }

    _hidePanel() {
        if (this._panelHidden)
            return;
        const lm = Main.layoutManager;
        const box = lm.panelBox;
        try {
            // Перестаём резервировать под панель место на экране
            lm.untrackChrome(box);
            trackChrome(lm, box, {affectsStruts: false, affectsInputRegion: true, trackFullscreen: false});
        } catch (e) {
            logError(e, '[dynamic-island] panel struts');
        }
        this._panelHidden = true;
        box.hide();

        this._inOverview = Main.overview.visible;
        Main.overview.connectObject(
            'showing', () => {
                this._inOverview = true;
                this._syncPanelVisibility();
            },
            'hidden', () => {
                this._inOverview = false;
                this._syncPanelVisibility();
            },
            this);
        // Если меню панели открыли с клавиатуры (Super+V и т. п.) — показываем панель на время
        for (const name of ['quickSettings', 'dateMenu']) {
            const ind = Main.panel.statusArea[name];
            ind?.menu?.connectObject('open-state-changed', () => this._syncPanelVisibility(true), this);
        }
        this._syncPanelVisibility();
    }

    _menuOpen() {
        return ['quickSettings', 'dateMenu'].some(n => Main.panel.statusArea[n]?.menu?.isOpen);
    }

    _syncPanelVisibility(fromMenu = false) {
        if (!this._panelHidden)
            return;
        const menuOpen = this._menuOpen();
        const show = (this._inOverview && this._settings.get_boolean('show-panel-in-overview')) || menuOpen;
        Main.layoutManager.panelBox.visible = show;
        // Пока открыто меню панели вне «Обзора», прячем остров, чтобы они не перекрывались
        if (fromMenu && this._island && !this._inOverview) {
            this._island.actor.remove_transition('opacity');
            this._island.actor.ease({opacity: menuOpen ? 0 : 255, duration: 150});
        }
    }

    _restorePanel() {
        if (!this._panelHidden)
            return;
        const lm = Main.layoutManager;
        const box = lm.panelBox;
        Main.overview.disconnectObject(this);
        for (const name of ['quickSettings', 'dateMenu'])
            Main.panel.statusArea[name]?.menu?.disconnectObject(this);
        try {
            lm.untrackChrome(box);
            trackChrome(lm, box, {affectsStruts: true, affectsInputRegion: true, trackFullscreen: true});
        } catch (e) {
            logError(e, '[dynamic-island] panel restore');
        }
        box.show();
        this._panelHidden = false;
    }

    /** Открыть быстрые настройки GNOME (Wi-Fi, звук, питание). */
    openQuickSettings() {
        this._island?.collapse();
        this._timers.timeout(80, () => Main.panel.toggleQuickSettings());
    }

    /** Открыть календарь и уведомления. */
    openCalendar() {
        this._island?.collapse();
        this._timers.timeout(80, () => Main.panel.toggleCalendar());
    }

    toggleOverview() {
        this._island?.collapse();
        Main.overview.toggle();
    }

    openPreferences() {
        this._island?.collapse();
        try {
            super.openPreferences();
        } catch (e) {
            logError(e, '[dynamic-island] prefs');
        }
    }

    // ================================================================ действия

    _makeActions() {
        const notify = (title, opts = {}) => this._island?.showActivity({source: null, title, ...opts});
        const fail = e => notify('Ошибка', {icon: 'dialog-warning-symbolic', subtitle: e.message, duration: 5000});
        const s = () => this._services;

        const ocrDone = text => {
            if (!text) {
                notify('Текст не найден', {icon: 'insert-text-symbolic', duration: 2000});
                return;
            }
            s().clipboard.setText(text);
            notify('Текст распознан и скопирован', {icon: 'insert-text-symbolic', subtitle: preview(text, 80), tab: 'tools'});
        };

        return {
            ocr: async () => {
                this._island?.collapse();
                try {
                    ocrDone(await s().capture.ocrArea());
                } catch (e) {
                    fail(e);
                }
            },
            ocrFile: async path => {
                notify('Распознаю текст…', {icon: 'insert-text-symbolic', duration: 1500});
                try {
                    const text = await s().capture.ocrFile(path);
                    s().capture.lastOcr = text;
                    s().capture.emit('ocr', text);
                    ocrDone(text);
                } catch (e) {
                    fail(e);
                }
            },
            ocrClipboard: async () => {
                const path = await s().clipboard.currentImage();
                if (!path) {
                    notify('В буфере нет картинки', {icon: 'insert-image-symbolic', duration: 2000});
                    return;
                }
                await this._ctx.actions.ocrFile(path);
            },
            voice: async (opts = {}) => {
                const v = s().voice;
                if (v.state === 'idle')
                    this._voiceTarget = opts.target ?? null;
                if (v.state === 'idle' && this._settings.get_boolean('voice-auto-paste'))
                    this._island?.collapse();
                await v.toggle();
            },
            pickColor: async () => {
                this._island?.collapse();
                try {
                    const c = await s().capture.pickColor();
                    if (!c)
                        return;
                    s().clipboard.setText(c.hex);
                    notify(`Цвет ${c.hex} скопирован`, {emoji: '🎨', subtitle: c.css, accent: c.hex, tab: 'tools'});
                } catch (e) {
                    fail(e);
                }
            },
            paste: () => this._pasteToFocused(),
        };
    }

    /** Вставить буфер в активное окно (имитация Ctrl+V). */
    _pasteToFocused() {
        this._island?.collapse();
        this._timers.timeout(180, () => {
            try {
                if (!this._vkbd) {
                    // В GNOME 50 глобального «бэкенда по умолчанию» нет — берём из контекста сцены
                    const backend = global.stage.context?.get_backend?.() ?? Clutter.get_default_backend();
                    const seat = backend.get_default_seat();
                    this._vkbd = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
                }
                const now = () => GLib.get_monotonic_time();
                const k = this._vkbd;
                k.notify_keyval(now(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
                k.notify_keyval(now(), Clutter.KEY_v, Clutter.KeyState.PRESSED);
                k.notify_keyval(now(), Clutter.KEY_v, Clutter.KeyState.RELEASED);
                k.notify_keyval(now(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
            } catch (e) {
                logError(e, '[dynamic-island] paste');
            }
        });
    }

    // ================================================================ живые активности

    _wireActivities() {
        const s = this._services;
        const subs = [];
        const on = (svc, name, fn) => {
            if (!svc)
                return;
            const id = svc.on(name, fn);
            subs.push(() => svc.off(id));
        };
        const show = a => this._island?.showActivity(a);

        // Музыка
        on(s.media, 'track-changed', async p => {
            const image = await p.artPath();
            show({
                source: 'music',
                key: 'music',
                image: image ?? undefined,
                icon: image ? undefined : 'folder-music-symbolic',
                title: p.title,
                subtitle: p.artist || p.identity,
                tab: 'home',
                actions: [
                    {icon: 'media-skip-backward-symbolic', onClick: () => p.previous()},
                    {icon: 'media-playback-pause-symbolic', onClick: () => p.playPause()},
                    {icon: 'media-skip-forward-symbolic', onClick: () => p.next()},
                ],
            });
        });

        // Буфер обмена
        on(s.clipboard, 'added', item => {
            if (item.type === 'files')
                return;
            show({
                source: 'clipboard',
                key: 'clipboard',
                icon: item.type === 'image' ? 'insert-image-symbolic' : 'edit-copy-symbolic',
                image: item.type === 'image' ? item.path : undefined,
                title: item.type === 'image' ? 'Изображение скопировано' : 'Скопировано',
                subtitle: item.type === 'text' ? preview(item.text, 70) : undefined,
                duration: 1600,
                tab: 'clipboard',
            });
        });
        on(s.shelf, 'added', (items, auto) => {
            const n = items.length;
            show({
                source: 'clipboard',
                key: 'shelf',
                emoji: '🗂️',
                title: auto ? `На полке: ${n} ${plural(n, ['файл', 'файла', 'файлов'])}` : 'Добавлено на полку',
                subtitle: items.map(i => i.name).join(', '),
                tab: 'shelf',
                duration: 2200,
            });
        });

        // Загрузки
        on(s.downloads, 'started', d => show({
            source: 'downloads', key: `dl-${d.name}`, icon: 'folder-download-symbolic',
            title: 'Загрузка началась', subtitle: d.name, tab: 'shelf', duration: 2200,
        }));
        on(s.downloads, 'finished', d => show({
            source: 'downloads', key: `dl-${d.name}`, icon: 'emblem-ok-symbolic', accent: '#30d158',
            title: 'Загрузка завершена', subtitle: `${d.name} · ${formatBytes(d.size)}`, tab: 'shelf', duration: 4000,
        }));

        // Уведомления
        on(s.notifications, 'notification', n => show({
            source: 'notifications',
            icon: n.gicon ?? 'preferences-system-notifications-symbolic',
            title: n.title || n.app,
            subtitle: n.body,
            duration: n.critical ? 10000 : Math.max(4000, this._settings.get_int('activity-duration') + 1500),
            onClick: () => n.activate(),
        }));

        // Таймер
        on(s.timer, 'finished', label => {
            show({source: 'timer', emoji: '⏰', title: 'Время вышло!', subtitle: label, duration: 8000, tab: 'timer'});
            try {
                global.display.get_sound_player().play_from_theme('complete', 'Таймер', null);
            } catch {}
        });

        // Питомец
        on(s.pet, 'needs', (text, emoji) => show({source: 'pet', emoji, title: text, tab: 'pet', duration: 5000}));
        on(s.pet, 'level-up', lvl => show({source: 'pet', emoji: '⭐', title: `${s.pet.name}: уровень ${lvl}!`, tab: 'pet'}));

        // Запись экрана
        on(s.recorder, 'started', () => show({
            source: 'recording', key: 'rec', icon: 'media-record-symbolic', accent: '#ff453a',
            title: 'Идёт запись экрана', subtitle: 'Нажмите на остров, чтобы остановить', duration: 2500,
            onClick: () => s.recorder.stop(),
        }));
        on(s.recorder, 'stopped', path => show({
            source: 'recording', key: 'rec', icon: 'folder-videos-symbolic',
            title: 'Запись сохранена', subtitle: path ? GLib.path_get_basename(path) : '', duration: 4000,
            onClick: () => path && showInFolder(path),
        }));

        // Голос
        on(s.voice, 'changed', () => {
            const v = s.voice;
            if (v.state === 'recording') {
                show({source: 'voice', key: 'voice', icon: 'audio-input-microphone-symbolic', accent: '#ff453a',
                    title: 'Слушаю…', subtitle: 'Нажмите на остров, чтобы закончить', duration: 0,
                    onClick: () => v.stop()});
            } else if (v.state === 'transcribing') {
                show({source: 'voice', key: 'voice', icon: 'audio-input-microphone-symbolic', title: 'Распознаю речь…', duration: 0});
            }
        });
        on(s.voice, 'result', text => {
            if (this._settings.get_boolean('voice-auto-copy') || this._settings.get_boolean('voice-auto-paste'))
                s.clipboard.setText(text);
            if (this._voiceTarget === 'ai') {
                s.ai.send(text);
                this._island?.expand({tab: 'ai'});
            } else if (this._settings.get_boolean('voice-auto-paste')) {
                this._pasteToFocused();
            }
            this._voiceTarget = null;
            show({source: 'voice', key: 'voice', icon: 'audio-input-microphone-symbolic', title: 'Распознано',
                subtitle: preview(text, 90), tab: 'tools', duration: 4000});
        });
        on(s.voice, 'error', msg => show({source: 'voice', key: 'voice', icon: 'dialog-warning-symbolic',
            title: 'Голос: ошибка', subtitle: msg, tab: 'tools', duration: 6000}));

        // ИИ ответил, пока остров свёрнут
        on(s.ai, 'done', m => {
            if (this._island?.state !== State.EXPANDED) {
                show({source: null, emoji: '✨', title: m.role === 'error' ? 'ИИ: ошибка' : 'ИИ ответил',
                    subtitle: preview(m.content, 90), tab: 'ai', duration: 5000});
            }
        });

        // Батарея
        let lowWarned = false;
        on(s.sysmon, 'updated', () => {
            const b = s.sysmon.battery;
            if (!b)
                return;
            if (b.percent <= 15 && !b.charging && !lowWarned) {
                lowWarned = true;
                show({source: 'system', icon: 'battery-caution-symbolic', accent: '#ff453a',
                    title: 'Низкий заряд батареи', subtitle: `${b.percent}% — подключите зарядку`, duration: 6000});
            } else if (b.charging || b.percent > 20) {
                lowWarned = false;
            }
        });

        this._activitySubs = subs;
    }
}
