// Заметки: хранятся в ~/.local/share/dynamic-island/notes.json.

import GLib from 'gi://GLib';

import {Emitter, Timers, dataDir, readJson, uid, writeJson} from '../utils.js';

export const NOTE_COLORS = ['#ffd60a', '#30d158', '#64d2ff', '#bf5af2', '#ff9f0a', '#ff375f'];

export class NotesService extends Emitter {
    constructor() {
        super();
        this._timers = new Timers();
        this._file = GLib.build_filenamev([dataDir(), 'notes.json']);
        this.notes = [];
        readJson(this._file, null).then(data => {
            if (Array.isArray(data) && data.length) {
                this.notes = data;
            } else {
                this.notes = [{
                    id: uid(),
                    text: 'Добро пожаловать в заметки острова ✨\n\nЗаметки сохраняются автоматически.\nНаведите на остров — и они всегда под рукой.',
                    color: NOTE_COLORS[0],
                    pinned: true,
                    updated: Date.now(),
                }];
            }
            this.emit('changed');
        });
    }

    get sorted() {
        return [...this.notes].sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
    }

    title(note) {
        const first = (note.text || '').split('\n').find(l => l.trim()) ?? '';
        return first.trim() || 'Новая заметка';
    }

    _save() {
        if (this._saveId)
            this._timers.clear(this._saveId);
        this._saveId = this._timers.timeout(600, () => {
            this._saveId = 0;
            this.flush();
        });
    }

    flush() {
        return writeJson(this._file, this.notes).catch(e => console.error(`[dynamic-island] notes: ${e.message}`));
    }

    create(text = '') {
        const note = {
            id: uid(),
            text,
            color: NOTE_COLORS[this.notes.length % NOTE_COLORS.length],
            pinned: false,
            updated: Date.now(),
        };
        this.notes.unshift(note);
        this._save();
        this.emit('changed');
        return note;
    }

    update(note, text) {
        if (note.text === text)
            return;
        note.text = text;
        note.updated = Date.now();
        this._save();
        this.emit('updated', note);
    }

    togglePin(note) {
        note.pinned = !note.pinned;
        this._save();
        this.emit('changed');
    }

    cycleColor(note) {
        const i = NOTE_COLORS.indexOf(note.color);
        note.color = NOTE_COLORS[(i + 1) % NOTE_COLORS.length];
        this._save();
        this.emit('changed');
    }

    remove(note) {
        this.notes = this.notes.filter(n => n !== note);
        this._save();
        this.emit('changed');
    }

    destroy() {
        if (this._saveId)
            this.flush();
        this._timers.destroy();
        this.disconnectAll();
    }
}
