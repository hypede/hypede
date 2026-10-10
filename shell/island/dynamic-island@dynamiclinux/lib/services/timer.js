// Таймер, секундомер и помодоро.

import {Emitter, Timers} from '../utils.js';

export class TimerService extends Emitter {
    constructor() {
        super();
        this._timers = new Timers();
        // Таймер обратного отсчёта
        this.timer = {running: false, end: 0, total: 0, remaining: 0, label: ''};
        // Секундомер
        this.stopwatch = {running: false, start: 0, acc: 0, laps: []};
        // Помодоро
        this.pomodoro = {active: false, phase: 'work', round: 1, work: 25, rest: 5, longRest: 15};
        this._tickId = 0;
    }

    get active() {
        return this.timer.running || this.stopwatch.running || this.pomodoro.active;
    }

    _ensureTick() {
        if (this._tickId)
            return;
        this._tickId = this._timers.interval(250, () => {
            this._tick();
            if (!this.active) {
                this._tickId = 0;
                return false;
            }
            return true;
        });
    }

    _tick() {
        if (this.timer.running) {
            this.timer.remaining = Math.max(0, (this.timer.end - Date.now()) / 1000);
            if (this.timer.remaining <= 0) {
                this.timer.running = false;
                if (this.pomodoro.active)
                    this._nextPomodoroPhase();
                else
                    this.emit('finished', this.timer.label || 'Таймер');
            }
        }
        this.emit('tick');
    }

    /**
     * @param {number} seconds
     * @param {string} [label]
     */
    startTimer(seconds, label = '') {
        this.timer = {running: true, end: Date.now() + seconds * 1000, total: seconds, remaining: seconds, label};
        this._ensureTick();
        this.emit('changed');
    }

    pauseTimer() {
        if (this.timer.running) {
            this.timer.remaining = Math.max(0, (this.timer.end - Date.now()) / 1000);
            this.timer.running = false;
            this.timer.paused = true;
        } else if (this.timer.paused && this.timer.remaining > 0) {
            this.timer.end = Date.now() + this.timer.remaining * 1000;
            this.timer.running = true;
            this.timer.paused = false;
            this._ensureTick();
        }
        this.emit('changed');
    }

    addTime(seconds) {
        if (this.timer.running) {
            this.timer.end += seconds * 1000;
            this.timer.total += seconds;
        } else {
            this.startTimer(Math.max(1, this.timer.remaining) + seconds);
            return;
        }
        this.emit('changed');
    }

    stopTimer() {
        this.timer = {running: false, end: 0, total: 0, remaining: 0, label: ''};
        this.pomodoro.active = false;
        this.emit('changed');
    }

    // ---------------------------------------------------------------- секундомер

    get stopwatchTime() {
        const s = this.stopwatch;
        return (s.acc + (s.running ? Date.now() - s.start : 0)) / 1000;
    }

    toggleStopwatch() {
        const s = this.stopwatch;
        if (s.running) {
            s.acc += Date.now() - s.start;
            s.running = false;
        } else {
            s.start = Date.now();
            s.running = true;
            this._ensureTick();
        }
        this.emit('changed');
    }

    lap() {
        if (this.stopwatch.running)
            this.stopwatch.laps.unshift(this.stopwatchTime);
        this.emit('changed');
    }

    resetStopwatch() {
        this.stopwatch = {running: false, start: 0, acc: 0, laps: []};
        this.emit('changed');
    }

    // ---------------------------------------------------------------- помодоро

    startPomodoro() {
        this.pomodoro.active = true;
        this.pomodoro.phase = 'work';
        this.pomodoro.round = 1;
        this.startTimer(this.pomodoro.work * 60, '🍅 Работа');
    }

    _nextPomodoroPhase() {
        const p = this.pomodoro;
        if (p.phase === 'work') {
            const long = p.round % 4 === 0;
            p.phase = 'rest';
            this.emit('finished', long ? '🍅 Большой перерыв!' : '🍅 Перерыв');
            this.startTimer((long ? p.longRest : p.rest) * 60, long ? '☕ Большой перерыв' : '☕ Перерыв');
        } else {
            p.phase = 'work';
            p.round++;
            this.emit('finished', '🍅 Снова за работу');
            this.startTimer(p.work * 60, `🍅 Работа · раунд ${p.round}`);
        }
    }

    destroy() {
        this._timers.destroy();
        this.disconnectAll();
    }
}
