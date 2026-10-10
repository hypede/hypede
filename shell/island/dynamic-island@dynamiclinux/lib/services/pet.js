// Виртуальный питомец: сытость, настроение, энергия, уровень.

import {Emitter, Timers} from '../utils.js';
import {PETS} from '../pure/pets.js';

export {PETS};

const HOUR = 3600 * 1000;

function clamp(v) {
    return Math.max(0, Math.min(100, v));
}

export class PetService extends Emitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._timers = new Timers();
        this._loadState();
        this._lastWarn = 0;
        this._settings.connectObject(
            'changed::pet-type', () => {
                this._syncName();
                this.emit('changed');
            },
            'changed::pet-name', () => this.emit('changed'),
            'changed::pet-enabled', () => this.emit('changed'),
            this);
        // Раз в минуту пересчитываем показатели
        this._timers.interval(60 * 1000, () => {
            this._tick();
            return true;
        });
    }

    /** Clawd приходит со своим именем; при смене на другого питомца возвращаем стандартное. */
    _syncName() {
        const id = this._settings.get_string('pet-type');
        const name = this._settings.get_string('pet-name').trim();
        if (id === 'clawd' && (!name || name === 'Мурзик'))
            this._settings.set_string('pet-name', 'Clawd');
        else if (id !== 'clawd' && name === 'Clawd')
            this._settings.set_string('pet-name', 'Мурзик');
    }

    _loadState() {
        let s = {};
        try {
            s = JSON.parse(this._settings.get_string('pet-state') || '{}');
        } catch {}
        const now = Date.now();
        this.state = {
            fed: s.fed ?? now,
            played: s.played ?? now,
            slept: s.slept ?? now,
            sleeping: s.sleeping ?? false,
            sleepStart: s.sleepStart ?? 0,
            xp: s.xp ?? 0,
            born: s.born ?? now,
            pets: s.pets ?? 0,
        };
    }

    _saveState() {
        this._settings.set_string('pet-state', JSON.stringify(this.state));
    }

    get enabled() {
        return this._settings.get_boolean('pet-enabled');
    }

    get kind() {
        return PETS[this._settings.get_string('pet-type')] ?? PETS.cat;
    }

    get name() {
        return this._settings.get_string('pet-name') || this.kind.name;
    }

    /** Сытость 0..100 (падает на ~12 в час). */
    get satiety() {
        return clamp(100 - (Date.now() - this.state.fed) / HOUR * 12);
    }

    /** Настроение 0..100 (падает на ~10 в час). */
    get happiness() {
        return clamp(100 - (Date.now() - this.state.played) / HOUR * 10 - (100 - this.satiety) * 0.3);
    }

    /** Энергия 0..100 (во сне восстанавливается). */
    get energy() {
        if (this.state.sleeping)
            return clamp(30 + (Date.now() - this.state.sleepStart) / HOUR * 60);
        return clamp(100 - (Date.now() - this.state.slept) / HOUR * 7);
    }

    get level() {
        return 1 + Math.floor(Math.sqrt(this.state.xp / 10));
    }

    get levelProgress() {
        const l = this.level - 1;
        const cur = l * l * 10, next = (l + 1) * (l + 1) * 10;
        return (this.state.xp - cur) / (next - cur);
    }

    get ageDays() {
        return Math.floor((Date.now() - this.state.born) / (24 * HOUR));
    }

    /** Текущее настроение для отображения. */
    get mood() {
        if (this.state.sleeping)
            return {emoji: '💤', text: 'спит'};
        if (this.satiety < 25)
            return {emoji: this.kind.food, text: 'голоден'};
        if (this.energy < 20)
            return {emoji: '🥱', text: 'устал'};
        if (this.happiness < 30)
            return {emoji: '🥺', text: 'скучает'};
        if (this.happiness > 80)
            return {emoji: '💖', text: 'счастлив'};
        return {emoji: '🙂', text: 'в порядке'};
    }

    _xp(n) {
        const before = this.level;
        this.state.xp += n;
        if (this.level > before)
            this.emit('level-up', this.level);
    }

    _wake() {
        if (this.state.sleeping) {
            this.state.sleeping = false;
            this.state.slept = Date.now() - (100 - this.energy) / 7 * HOUR;
        }
    }

    feed() {
        this._wake();
        this.state.fed = Date.now();
        this._xp(3);
        this._saveState();
        this.emit('action', 'feed', this.kind.food);
        this.emit('changed');
    }

    play() {
        this._wake();
        this.state.played = Date.now();
        // Игра немного утомляет
        this.state.slept -= 0.3 * HOUR;
        this._xp(4);
        this._saveState();
        this.emit('action', 'play', this.kind.toy);
        this.emit('changed');
    }

    pet() {
        this.state.pets++;
        this.state.played = Math.min(Date.now(), this.state.played + 0.25 * HOUR);
        this._xp(1);
        this._saveState();
        this.emit('action', 'pet', '❤️');
        this.emit('changed');
    }

    toggleSleep() {
        if (this.state.sleeping) {
            this._wake();
        } else {
            this.state.sleeping = true;
            this.state.sleepStart = Date.now() - Math.max(0, (this.energy - 30) / 60) * HOUR;
            this._xp(1);
        }
        this._saveState();
        this.emit('action', this.state.sleeping ? 'sleep' : 'wake', this.state.sleeping ? '💤' : '☀️');
        this.emit('changed');
    }

    _tick() {
        if (!this.enabled)
            return;
        // Сам просыпается, когда выспался
        if (this.state.sleeping && this.energy >= 100) {
            this._wake();
            this._saveState();
        }
        const now = Date.now();
        if (now - this._lastWarn > 2 * HOUR) {
            if (this.satiety < 20) {
                this._lastWarn = now;
                this.emit('needs', `${this.name} проголодался`, this.kind.food);
            } else if (this.happiness < 20) {
                this._lastWarn = now;
                this.emit('needs', `${this.name} скучает — поиграйте с ним`, this.kind.toy);
            }
        }
        this.emit('changed');
    }

    reset() {
        this._settings.set_string('pet-state', '');
        this._loadState();
        this._saveState();
        this.emit('changed');
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._timers.destroy();
        this.disconnectAll();
    }
}
