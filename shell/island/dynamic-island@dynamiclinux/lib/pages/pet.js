// Питомец: комната, где он гуляет, показатели и уход.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {BasePage} from './base.js';
import * as W from '../ui/widgets.js';
import {PETS} from '../services/pet.js';
import {PetSprite} from '../ui/petSprite.js';

const DECOR = ['🌵', '🪴', '🌼', '🍄', '🪨', '🌷'];

export class PetPage extends BasePage {
    constructor(ctx) {
        super(ctx, {vertical: false, cls: 'di-pet'});
        const t = this.theme;
        const pet = this.services.pet;

        // ---------- комната
        const left = W.vbox({x_expand: true, style_class: 'di-col'});
        this._room = new St.Widget({
            style_class: 'di-pet-room',
            layout_manager: new Clutter.FixedLayout(),
            x_expand: true,
            y_expand: true,
            reactive: true,
            clip_to_allocation: true,
        });
        // Пол
        this._floor = new St.Widget({style_class: 'di-pet-floor'});
        this._room.add_child(this._floor);
        this._decor = [];
        for (let i = 0; i < 3; i++) {
            const d = new St.Label({text: DECOR[(i * 2 + pet.state.xp) % DECOR.length], style: 'font-size: 22px;', opacity: 200});
            this._room.add_child(d);
            this._decor.push(d);
        }
        this._sprite = new PetSprite({size: 54, reactive: true, emojiSleep: false, style_class: 'di-pet-sprite'});
        this._sprite.set_pivot_point(0.5, 1);
        this._room.add_child(this._sprite);
        this._sprite.connect('button-press-event', () => {
            pet.pet();
            return Clutter.EVENT_STOP;
        });
        this._room.connect('notify::width', () => this._layoutRoom());
        this._room.connect('notify::height', () => this._layoutRoom());

        const acts = W.hbox({style_class: 'di-chips', x_align: Clutter.ActorAlign.CENTER});
        this._feedBtn = W.button({label: `${pet.kind.food} Покормить`, cls: 'di-chip-btn', onClick: () => pet.feed()});
        this._playBtn = W.button({label: `${pet.kind.toy} Поиграть`, cls: 'di-chip-btn', onClick: () => pet.play()});
        this._sleepBtn = W.button({label: '💤 Уложить спать', cls: 'di-chip-btn', onClick: () => pet.toggleSleep()});
        this._petBtn = W.button({label: '🤚 Погладить', cls: 'di-chip-btn', onClick: () => pet.pet()});
        W.add(acts, this._feedBtn, this._playBtn, this._petBtn, this._sleepBtn);
        W.add(left, this._room, acts);

        // ---------- показатели
        const right = W.card(true, {cls: 'di-pet-stats'});
        right.width = 250;
        this._name = W.label('', {cls: 'di-heading'});
        this._mood = W.label('', {cls: 'di-small', style: `color: ${t.dim};`});
        this._bars = {};
        const bar = (id, title, color) => {
            const row = W.vbox({x_expand: true, style_class: 'di-pet-bar'});
            const head = W.hbox({x_expand: true});
            const v = W.label('', {cls: 'di-small di-mono', style: `color: ${t.dim};`});
            W.add(head, W.label(title, {cls: 'di-small', expand: true}), v);
            const b = new W.ProgressBar({height: 6, color});
            W.add(row, head, b);
            right.add_child(row);
            this._bars[id] = {b, v};
        };
        W.add(right, this._name, this._mood);
        bar('satiety', '🍽 Сытость', '#ff9f0a');
        bar('happiness', '💖 Настроение', '#ff375f');
        bar('energy', '⚡ Энергия', '#30d158');
        bar('level', '⭐ Опыт', t.accent);

        const nameRow = W.hbox({x_expand: true, style_class: 'di-toolbar'});
        this._nameEntry = W.entry({hint: 'Имя питомца', text: this.settings.get_string('pet-name'),
            onActivate: text => this.settings.set_string('pet-name', text.trim())});
        nameRow.add_child(this._nameEntry);
        right.add_child(nameRow);

        // Выбор питомца
        const kinds = Object.entries(PETS).map(([id, p]) => {
            const b = p.sprite
                ? W.button({cls: 'di-pet-kind', onClick: () => this._chooseKind(id)})
                : W.button({label: p.emoji, cls: 'di-pet-kind', onClick: () => this._chooseKind(id)});
            if (p.sprite) {
                const icon = new PetSprite({size: 20});
                icon.setKind(p);
                icon.x_align = Clutter.ActorAlign.CENTER;
                b.set_child(icon);
            } else {
                b._label.clutter_text.ellipsize = 0;
            }
            b.accessible_name = p.name;
            b._kind = id;
            return b;
        });
        this._kindBtns = kinds;
        right.add_child(W.scroll(W.grid(kinds, 5, {fill: true}), {cls: 'di-pet-kinds'}));

        W.add(this.actor, left, right);

        this.subs.on(pet, 'changed', () => this._sync());
        this.subs.on(pet, 'action', (kind, emoji) => this._react(kind, emoji));
        this.subs.on(pet, 'level-up', lvl => this._burst(['⭐', '🎉', '✨'], `Уровень ${lvl}!`));
        this._x = 80;
        this._sync();
    }

    _chooseKind(id) {
        this.settings.set_string('pet-type', id);
    }

    _layoutRoom() {
        if (!this._room.get_stage())
            return;
        const w = this._room.width, h = this._room.height;
        if (!w || !h)
            return;
        this._floorY = Math.round(h * 0.78);
        this._floor.set_position(0, this._floorY);
        this._floor.set_size(w, h - this._floorY);
        this._decor.forEach((d, i) => {
            d.set_position(Math.round(w * (0.12 + i * 0.36)), this._floorY - 26);
        });
        this._sprite.y = this._floorY - this._sprite.height + 6;
    }

    _sync() {
        const pet = this.services.pet;
        const t = this.theme;
        this._sprite.setKind(pet.kind);
        this._sprite.sleeping = pet.state.sleeping;
        this._sprite.opacity = pet.state.sleeping ? 170 : 255;
        this._name.text = `${pet.kind.sprite ? '' : `${pet.kind.emoji} `}${pet.name} · ур. ${pet.level}`;
        // Обновляем поле имени, только если имя поменялось в настройках (не сбиваем ввод)
        const savedName = this.settings.get_string('pet-name');
        if (savedName !== this._lastName) {
            this._lastName = savedName;
            this._nameEntry.set_text(savedName);
        }
        this._layoutRoom();
        this._mood.text = `${pet.mood.emoji} ${pet.mood.text} · ${pet.ageDays} дн. вместе · погладили ${pet.state.pets} раз`;
        const set = (id, v, text) => {
            this._bars[id].b.value = v;
            this._bars[id].v.text = text;
        };
        set('satiety', pet.satiety / 100, `${Math.round(pet.satiety)}%`);
        set('happiness', pet.happiness / 100, `${Math.round(pet.happiness)}%`);
        set('energy', pet.energy / 100, `${Math.round(pet.energy)}%`);
        set('level', pet.levelProgress, `${pet.state.xp} XP`);
        this._feedBtn._label.text = `${pet.kind.food} Покормить`;
        this._playBtn._label.text = `${pet.kind.toy} Поиграть`;
        this._sleepBtn._label.text = pet.state.sleeping ? '☀️ Разбудить' : '💤 Уложить спать';
        const type = this.settings.get_string('pet-type');
        for (const b of this._kindBtns)
            W.setAccent(b, t, b._kind === type);
    }

    onShow() {
        super.onShow();
        this._sync();
        this._layoutRoom();
        if (!this._walking) {
            this._walking = true;
            this._walk();
        }
    }

    onHide() {
        super.onHide();
        this._walking = false;
        this._sprite.remove_all_transitions();
    }

    _walk() {
        if (!this._walking || this._destroyed)
            return;
        const pet = this.services.pet;
        const w = this._room.width;
        if (!w || pet.state.sleeping || !St.Settings.get().enable_animations) {
            if (pet.state.sleeping)
                this._zzz();
            this.timers.timeout(1800, () => this._walk());
            return;
        }
        const maxX = Math.max(0, w - this._sprite.width - 10);
        const target = 10 + Math.round(Math.random() * maxX);
        const dir = target >= this._sprite.x ? 1 : -1;
        this._sprite.scale_x = (dir > 0) === pet.kind.facesLeft ? -1 : 1;
        const speed = this.settings.get_int('pet-speed');
        const dist = Math.abs(target - this._sprite.x);
        const duration = Math.max(400, dist * (140 - speed * 10));
        this._sprite.walking = true;
        this._sprite.ease({
            x: target,
            duration,
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            onStopped: () => {
                this._sprite.walking = false;
            },
            onComplete: () => {
                // Иногда прыгает на месте
                if (Math.random() < 0.35)
                    this._jump();
                this.timers.timeout(500 + Math.random() * 2500, () => this._walk());
            },
        });
    }

    _jump() {
        const baseY = this._floorY - this._sprite.height + 6;
        this._sprite.ease({
            y: baseY - 26,
            scale_y: 1.1,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._sprite.ease({
                y: baseY,
                scale_y: 1,
                duration: 380,
                mode: Clutter.AnimationMode.EASE_OUT_BOUNCE,
            }),
        });
    }

    _zzz() {
        this._particle('💤', this._sprite.x + this._sprite.width * 0.6, this._sprite.y);
    }

    _particle(emoji, x, y, dx = 0) {
        const p = new St.Label({text: emoji, style: 'font-size: 20px;', opacity: 0});
        this._room.add_child(p);
        p.set_position(x, y);
        p.ease({
            opacity: 255,
            translation_y: -30,
            translation_x: dx,
            duration: 400,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => p.ease({
                opacity: 0,
                translation_y: -60,
                duration: 700,
                onComplete: () => p.destroy(),
            }),
        });
    }

    _react(kind, emoji) {
        if (!this.visible)
            return;
        const x = this._sprite.x + this._sprite.width / 2 - 10;
        const y = this._sprite.y - 10;
        for (let i = 0; i < 3; i++)
            this.timers.timeout(i * 120, () => this._particle(emoji, x + (i - 1) * 14, y, (i - 1) * 12));
        if (kind !== 'sleep')
            this._jump();
    }

    _burst(emojis, text) {
        const w = this._room.width;
        emojis.forEach((e, i) => this.timers.timeout(i * 100, () => this._particle(e, w / 2 - 40 + i * 30, this._floorY - 80)));
        this.toast(text, {emoji: '🎉', duration: 2500});
    }

    destroy() {
        this._destroyed = true;
        this._walking = false;
        super.destroy();
    }
}
