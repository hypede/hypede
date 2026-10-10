// Калькулятор с историей, функциями и системами счисления.

import Clutter from 'gi://Clutter';

import {BasePage} from './base.js';
import * as W from '../ui/widgets.js';
import {bases, evaluate, formatResult} from '../pure/calc.js';

const KEYS = [
    ['sin', 'cos', 'tan', '√', '^', '!'],
    ['(', ')', '%', 'π', 'e', 'ans'],
    ['7', '8', '9', '÷', 'C', '⌫'],
    ['4', '5', '6', '×', 'ln', 'log'],
    ['1', '2', '3', '−', 'x²', '1/x'],
    ['0', '.', '±', '+', '=', '='],
];

export class CalcPage extends BasePage {
    constructor(ctx) {
        super(ctx, {vertical: false, cls: 'di-calc'});
        const t = this.theme;
        this._history = [];
        this._ans = 0;
        this._degrees = false;

        // ---------- дисплей + клавиатура
        const left = W.vbox({style_class: 'di-col', x_expand: true});
        const display = W.card(true, {cls: 'di-calc-display'});
        this._entry = W.entry({hint: 'Выражение, например 2^10 + sqrt(16)', cls: 'di-calc-entry',
            onChange: () => this._preview(), onActivate: () => this._equals()});
        this._result = W.label('0', {cls: 'di-calc-result'});
        this._result.x_align = Clutter.ActorAlign.END;
        this._extra = W.label('', {cls: 'di-small di-mono', style: `color: ${t.faint};`});
        this._extra.x_align = Clutter.ActorAlign.END;
        W.add(display, this._entry, this._result, this._extra);

        const keypad = W.vbox({style_class: 'di-keypad', x_expand: true, y_expand: true});
        for (const row of KEYS) {
            const r = W.hbox({style_class: 'di-keypad-row', x_expand: true, y_expand: true});
            r.layout_manager.homogeneous = true;
            let last = null;
            for (const k of row) {
                if (k === last && k === '=')
                    continue;
                last = k;
                const isOp = ['÷', '×', '−', '+', '^'].includes(k);
                const isEq = k === '=';
                const b = W.button({label: k, cls: `di-key ${isOp ? 'di-key-op' : ''} ${isEq ? 'di-key-eq' : ''}`, expand: true, onClick: () => this._press(k)});
                b.y_expand = true;
                b.y_align = Clutter.ActorAlign.FILL;
                if (isEq)
                    W.setAccent(b, t, true);
                r.add_child(b);
            }
            keypad.add_child(r);
        }
        W.add(left, display, keypad);

        // ---------- история
        const right = W.vbox({style_class: 'di-col', width: 230});
        const top = W.hbox({x_expand: true, style_class: 'di-toolbar'});
        this._degBtn = W.button({label: 'RAD', cls: 'di-chip-btn', onClick: () => {
            this._degrees = !this._degrees;
            this._degBtn._label.text = this._degrees ? 'DEG' : 'RAD';
            this._preview();
        }});
        W.add(top, W.label('История', {cls: 'di-heading', expand: true}), this._degBtn,
            W.iconButton('edit-clear-all-symbolic', () => {
                this._history = [];
                this._renderHistory();
            }, {cls: 'di-flat'}));
        this._histList = W.vbox({style_class: 'di-calc-history', x_expand: true});
        W.add(right, top, W.scroll(this._histList));

        W.add(this.actor, left, right);
        this._renderHistory();
    }

    focus() {
        this._entry.grab_key_focus();
    }

    _press(k) {
        const e = this._entry;
        const text = e.get_text();
        const insert = s => {
            const ct = e.clutter_text;
            let pos = ct.get_cursor_position();
            if (pos < 0)
                pos = text.length;
            e.set_text(text.slice(0, pos) + s + text.slice(pos));
            ct.set_cursor_position(pos + s.length);
        };
        switch (k) {
        case 'C':
            e.set_text('');
            break;
        case '⌫':
            e.set_text(text.slice(0, -1));
            break;
        case '=':
            this._equals();
            break;
        case '±':
            e.set_text(text.startsWith('-(') && text.endsWith(')') ? text.slice(2, -1) : `-(${text || '0'})`);
            break;
        case 'x²':
            e.set_text(`(${text || 'ans'})^2`);
            break;
        case '1/x':
            e.set_text(`1/(${text || 'ans'})`);
            break;
        case '√':
            insert('sqrt(');
            break;
        case 'sin': case 'cos': case 'tan': case 'ln': case 'log':
            insert(`${k}(`);
            break;
        case '÷':
            insert('/');
            break;
        case '×':
            insert('*');
            break;
        case '−':
            insert('-');
            break;
        default:
            insert(k);
        }
        this._preview();
    }

    _preview() {
        const text = this._entry.get_text().trim();
        if (!text) {
            this._result.text = '0';
            this._extra.text = '';
            return;
        }
        try {
            const v = evaluate(text, {degrees: this._degrees, ans: this._ans});
            this._result.text = formatResult(v);
            this._result.opacity = 160;
            const b = bases(v);
            this._extra.text = b ? `${b.hex}   ${b.bin.length < 40 ? b.bin : ''}` : '';
        } catch {
            this._result.opacity = 90;
        }
    }

    _equals() {
        const text = this._entry.get_text().trim();
        if (!text)
            return;
        try {
            const v = evaluate(text, {degrees: this._degrees, ans: this._ans});
            const res = formatResult(v);
            this._ans = v;
            this._history.unshift({expr: text, res});
            this._history = this._history.slice(0, 50);
            this._result.text = res;
            this._result.opacity = 255;
            W.pulse(this._result, 1.06, 120);
            this._entry.set_text(res === '∞' ? '' : res);
            this._entry.clutter_text.set_cursor_position(-1);
            this._renderHistory();
        } catch (e) {
            this._result.text = e.message;
            this._result.opacity = 200;
        }
    }

    _renderHistory() {
        const t = this.theme;
        this._histList.destroy_all_children();
        if (!this._history.length) {
            this._histList.add_child(W.label('Здесь появятся вычисления.\nКлик по результату — копировать.', {cls: 'di-small', wrap: true, style: `color: ${t.faint};`}));
            return;
        }
        for (const h of this._history) {
            const b = W.button({cls: 'di-hist-row', expand: true, onClick: () => this.copy(h.res)});
            const box = W.vbox({x_expand: true});
            const e = W.label(h.expr, {cls: 'di-small di-mono', style: `color: ${t.dim};`});
            const r = W.label(`= ${h.res}`, {cls: 'di-mono di-hist-res'});
            e.x_align = r.x_align = Clutter.ActorAlign.END;
            W.add(box, e, r);
            b.set_child(box);
            this._histList.add_child(b);
        }
    }
}
