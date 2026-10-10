// Карточка «Сейчас играет» с обложкой, прогрессом и управлением.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {Subscriptions, Timers} from '../utils.js';
import {formatDuration} from '../pure/format.js';
import * as W from './widgets.js';

export class MediaCard {
    constructor(ctx, opts = {}) {
        this.ctx = ctx;
        this._subs = new Subscriptions();
        this._timers = new Timers();
        const t = ctx.theme;
        const artSize = opts.artSize ?? 96;

        this.actor = W.card(true, {cls: 'di-media-card', expandY: opts.expandY ?? false});

        // Верх: обложка + тексты
        const top = W.hbox({style_class: 'di-media-top', x_expand: true});
        this._artWrap = new St.Widget({layout_manager: new Clutter.BinLayout(), width: artSize, height: artSize});
        this._art = W.image(null, artSize, artSize, 14);
        this._artFallback = W.icon('folder-music-symbolic', Math.round(artSize * 0.42), `color: ${t.faint};`);
        this._artFallback.x_align = Clutter.ActorAlign.CENTER;
        W.add(this._artWrap, this._art, this._artFallback);

        const texts = W.vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'di-media-texts'});
        this._app = W.hbox({style_class: 'di-media-app'});
        this._appIcon = W.icon('audio-x-generic-symbolic', 14);
        this._appName = W.label('', {cls: 'di-small di-dim'});
        W.add(this._app, this._appIcon, this._appName);
        this._title = W.label('Ничего не играет', {cls: 'di-media-title'});
        this._artist = W.label('Включите музыку в любом плеере', {cls: 'di-media-artist', style: `color: ${t.dim};`});
        this._viz = new W.Visualizer({bars: 5, height: 18, color: t.accent, animate: ctx.settings.get_boolean('music-visualizer')});
        this._viz.x_align = Clutter.ActorAlign.START;
        W.add(texts, this._app, this._title, this._artist, this._viz);
        W.add(top, this._artWrap, texts);

        // Прогресс
        const progressRow = W.hbox({style_class: 'di-media-progress', x_expand: true});
        this._pos = W.label('0:00', {cls: 'di-small di-mono di-dim'});
        this._len = W.label('0:00', {cls: 'di-small di-mono di-dim'});
        this._slider = new Slider(0);
        this._slider.x_expand = true;
        this._slider.connect('drag-begin', () => {
            this._dragging = true;
        });
        this._slider.connect('drag-end', () => {
            this._dragging = false;
            this._seek();
        });
        this._slider.connect('scroll-event', () => Clutter.EVENT_STOP);
        W.add(progressRow, this._pos, this._slider, this._len);

        // Кнопки
        const controls = W.hbox({style_class: 'di-media-controls', x_align: Clutter.ActorAlign.CENTER});
        this._shuffle = W.iconButton('media-playlist-shuffle-symbolic', () => this._player?.toggleShuffle(), {cls: 'di-media-btn-small'});
        this._prev = W.iconButton('media-skip-backward-symbolic', () => this._player?.previous(), {cls: 'di-media-btn', size: 20});
        this._play = W.iconButton('media-playback-start-symbolic', () => this._player?.playPause(), {cls: 'di-media-play', size: 24});
        this._next = W.iconButton('media-skip-forward-symbolic', () => this._player?.next(), {cls: 'di-media-btn', size: 20});
        this._loop = W.iconButton('media-playlist-repeat-symbolic', () => this._player?.cycleLoop(), {cls: 'di-media-btn-small'});
        W.add(controls, this._shuffle, this._prev, this._play, this._next, this._loop);

        // Переключатель плееров
        this._switch = W.iconButton('view-more-horizontal-symbolic', () => this._cyclePlayer(), {cls: 'di-media-btn-small'});
        this._raise = W.iconButton('view-reveal-symbolic', () => {
            this._raiseApp();
        }, {cls: 'di-media-btn-small'});
        const bottom = W.hbox({x_expand: true});
        W.add(bottom, this._switch, W.spacer(), controls, W.spacer(), this._raise);

        W.add(this.actor, top, progressRow, bottom);

        this._subs.on(ctx.services.media, 'changed', () => this.update());
        this._subs.on(ctx.services.media, 'seeked', () => this._pollPosition());
        this.update();
    }

    _cyclePlayer() {
        const media = this.ctx.services.media;
        const list = media.players;
        if (list.length < 2)
            return;
        const i = list.indexOf(media.current);
        media.pin(list[(i + 1) % list.length]);
    }

    _raiseApp() {
        const p = this._player;
        if (!p)
            return;
        const app = p.desktopEntry ? Shell.AppSystem.get_default().lookup_app(`${p.desktopEntry}.desktop`) : null;
        if (app)
            app.activate();
        else
            p.raise();
        this.ctx.island.collapse();
    }

    async update() {
        const p = this.ctx.services.media.current;
        this._player = p;
        const t = this.ctx.theme;
        const has = !!p;
        for (const w of [this._prev, this._play, this._next, this._shuffle, this._loop, this._slider, this._raise])
            w.reactive = has;
        this._switch.visible = this.ctx.services.media.players.length > 1;
        if (!p) {
            this._title.text = 'Ничего не играет';
            this._artist.text = 'Включите музыку в любом плеере';
            this._app.visible = false;
            this._viz.playing = false;
            W.setImage(this._art, null);
            this._art.visible = false;
            this._artFallback.visible = true;
            this._slider.value = 0;
            this._pos.text = this._len.text = '0:00';
            return;
        }
        this._title.text = p.title || p.identity;
        this._artist.text = [p.artist, p.album].filter(Boolean).join(' — ') || ' ';
        this._app.visible = true;
        this._appName.text = p.identity;
        const app = p.desktopEntry ? Shell.AppSystem.get_default().lookup_app(`${p.desktopEntry}.desktop`) : null;
        if (app)
            this._appIcon.gicon = app.get_icon();
        else
            this._appIcon.gicon = Gio.ThemedIcon.new('audio-x-generic-symbolic');
        this._play._icon.icon_name = p.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._viz.playing = p.playing;
        W.setAccent(this._shuffle, t, p.shuffle);
        W.setAccent(this._loop, t, p.loop !== 'None');
        this._loop._icon.icon_name = p.loop === 'Track' ? 'media-playlist-repeat-song-symbolic' : 'media-playlist-repeat-symbolic';
        this._len.text = formatDuration(p.length);
        this._slider.reactive = p.canSeek && p.length > 0;
        const path = await p.artPath();
        if (this._destroyed || this._player !== p)
            return;
        if (path !== this._artPath) {
            this._artPath = path;
            W.setImage(this._art, path, 14);
            if (path) {
                this._art.opacity = 0;
                this._art.ease({opacity: 255, duration: 300});
            }
        }
        this._art.visible = !!path;
        this._artFallback.visible = !path;
        this._pollPosition();
    }

    async _pollPosition() {
        const p = this._player;
        if (!p || this._dragging)
            return;
        const pos = await p.position();
        if (this._destroyed || pos === null)
            return;
        this._position = pos;
        this._pos.text = formatDuration(pos);
        if (p.length > 0 && !this._dragging)
            this._slider.value = Math.min(1, pos / p.length);
    }

    _seek() {
        const p = this._player;
        if (p && p.length > 0)
            p.seekTo(this._slider.value * p.length);
    }

    /** Включает периодическое обновление позиции, пока карточка видна. */
    setActive(active) {
        if (active && !this._loopId) {
            this._pollPosition();
            this._loopId = this._timers.interval(1000, () => {
                if (this._player?.playing)
                    this._pollPosition();
                return true;
            });
        } else if (!active && this._loopId) {
            this._loopId = this._timers.clear(this._loopId);
        }
    }

    destroy() {
        this._destroyed = true;
        this._subs.clear();
        this._timers.destroy();
        this.actor.destroy();
    }
}
