// Безопасный калькулятор выражений (без eval).
// Поддерживает: + - * / % ^ (степень), !, скобки, унарный минус,
// функции (sin, cos, sqrt, log ...), константы (pi, e), переменную ans,
// числа вида 1.5, .5, 1e3, 0x1F, 0b101, а также 1 000 000 и запятую как десятичный разделитель.

const FUNCTIONS = {
    sin: x => Math.sin(x), cos: x => Math.cos(x), tan: x => Math.tan(x),
    asin: x => Math.asin(x), acos: x => Math.acos(x), atan: x => Math.atan(x),
    sinh: x => Math.sinh(x), cosh: x => Math.cosh(x), tanh: x => Math.tanh(x),
    sqrt: x => Math.sqrt(x), cbrt: x => Math.cbrt(x), abs: x => Math.abs(x),
    ln: x => Math.log(x), log: x => Math.log10(x), lg: x => Math.log10(x), log2: x => Math.log2(x),
    exp: x => Math.exp(x), round: x => Math.round(x), floor: x => Math.floor(x),
    ceil: x => Math.ceil(x), sign: x => Math.sign(x),
    deg: x => x * 180 / Math.PI, rad: x => x * Math.PI / 180,
};

const TRIG = new Set(['sin', 'cos', 'tan']);
const ATRIG = new Set(['asin', 'acos', 'atan']);

const CONSTANTS = {
    pi: Math.PI, 'π': Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2,
};

export class CalcError extends Error {}

function tokenize(src) {
    // Запятая — десятичный разделитель, только если в выражении нет функций (там она разделяет аргументы)
    const commaDecimal = !/[a-zA-Zа-яА-Я]/.test(src);
    const s = src
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/−/g, '-')
        .replace(/\*\*/g, '^')
        .replace(/√/g, 'sqrt');
    const tokens = [];
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        if (/[0-9.]/.test(c)) {
            const sep = commaDecimal ? '[.,]' : '[.]';
            const re = new RegExp(`^0[xX][0-9a-fA-F]+|^0[bB][01]+|^(\\d[\\d ]*\\d|\\d)?(${sep}\\d+)?([eE][+-]?\\d+)?`);
            const m = s.slice(i).match(re);
            const raw = m && m[0];
            if (!raw)
                throw new CalcError(`Неожиданный символ «${c}»`);
            let value;
            if (/^0[xX]/.test(raw))
                value = parseInt(raw.slice(2), 16);
            else if (/^0[bB]/.test(raw))
                value = parseInt(raw.slice(2), 2);
            else
                value = parseFloat(raw.replace(/ /g, '').replace(',', '.'));
            tokens.push({type: 'num', value});
            i += raw.length;
            continue;
        }
        if (/[a-zA-Zπа-яА-Я_]/.test(c)) {
            const m = s.slice(i).match(/^[a-zA-Zπа-яА-Я_][a-zA-Z0-9_а-яА-Я]*/);
            tokens.push({type: 'id', value: m[0].toLowerCase()});
            i += m[0].length;
            continue;
        }
        if ('+-*/%^()!,'.includes(c)) {
            tokens.push({type: 'op', value: c});
            i++;
            continue;
        }
        throw new CalcError(`Неожиданный символ «${c}»`);
    }
    return tokens;
}

class Parser {
    constructor(tokens, opts) {
        this.t = tokens;
        this.i = 0;
        this.opts = opts;
    }

    peek() {
        return this.t[this.i];
    }

    next() {
        return this.t[this.i++];
    }

    isOp(v) {
        const p = this.peek();
        return p && p.type === 'op' && p.value === v;
    }

    expect(v) {
        if (!this.isOp(v))
            throw new CalcError(`Ожидалось «${v}»`);
        this.i++;
    }

    parse() {
        if (this.t.length === 0)
            throw new CalcError('Пустое выражение');
        const v = this.expr();
        if (this.i < this.t.length)
            throw new CalcError('Лишние символы в выражении');
        return v;
    }

    // expr := term (('+'|'-') term)*
    expr() {
        let v = this.term();
        while (this.isOp('+') || this.isOp('-')) {
            const op = this.next().value;
            const r = this.term();
            v = op === '+' ? v + r : v - r;
        }
        return v;
    }

    // term := unary (('*'|'/'|'%'|implicit) unary)*
    term() {
        let v = this.unary();
        for (;;) {
            if (this.isOp('*')) {
                this.next();
                v *= this.unary();
            } else if (this.isOp('/')) {
                this.next();
                const r = this.unary();
                if (r === 0)
                    throw new CalcError('Деление на ноль');
                v /= r;
            } else if (this.isOp('%')) {
                // «%» как остаток от деления, если дальше идёт число/скобка
                const after = this.t[this.i + 1];
                if (after && (after.type === 'num' || after.type === 'id' || (after.type === 'op' && after.value === '('))) {
                    this.next();
                    v %= this.unary();
                } else {
                    break;
                }
            } else if (this.peek() && (this.peek().type === 'id' || this.isOp('(') ||
                       this.peek().type === 'num')) {
                // Неявное умножение: 2pi, 3(4+5)
                v *= this.unary();
            } else {
                break;
            }
        }
        return v;
    }

    unary() {
        if (this.isOp('-')) {
            this.next();
            return -this.unary();
        }
        if (this.isOp('+')) {
            this.next();
            return this.unary();
        }
        return this.power();
    }

    // power := postfix ('^' unary)?   (правоассоциативно)
    power() {
        const base = this.postfix();
        if (this.isOp('^')) {
            this.next();
            return Math.pow(base, this.unary());
        }
        return base;
    }

    postfix() {
        let v = this.primary();
        for (;;) {
            if (this.isOp('!')) {
                this.next();
                v = factorial(v);
            } else if (this.isOp('%')) {
                const after = this.t[this.i + 1];
                if (after && (after.type === 'num' || after.type === 'id' || (after.type === 'op' && after.value === '(')))
                    break;
                this.next();
                v /= 100;
            } else {
                break;
            }
        }
        return v;
    }

    primary() {
        const tok = this.next();
        if (!tok)
            throw new CalcError('Неожиданный конец выражения');
        if (tok.type === 'num')
            return tok.value;
        if (tok.type === 'op' && tok.value === '(') {
            const v = this.expr();
            if (this.isOp(')'))
                this.next();
            return v;
        }
        if (tok.type === 'id') {
            const name = tok.value;
            if (name in FUNCTIONS || name === 'max' || name === 'min' || name === 'pow' || name === 'root') {
                const args = [];
                if (this.isOp('(')) {
                    this.next();
                    if (!this.isOp(')')) {
                        args.push(this.expr());
                        while (this.isOp(',')) {
                            this.next();
                            args.push(this.expr());
                        }
                    }
                    this.expect(')');
                } else {
                    args.push(this.unary());
                }
                return this.call(name, args);
            }
            if (name in CONSTANTS)
                return CONSTANTS[name];
            if (name === 'ans')
                return this.opts.ans ?? 0;
            throw new CalcError(`Неизвестное имя «${name}»`);
        }
        throw new CalcError(`Неожиданный символ «${tok.value}»`);
    }

    call(name, args) {
        if (name === 'max')
            return Math.max(...args);
        if (name === 'min')
            return Math.min(...args);
        if (name === 'pow') {
            if (args.length !== 2)
                throw new CalcError('pow(x, y) принимает 2 аргумента');
            return Math.pow(args[0], args[1]);
        }
        if (name === 'root') {
            if (args.length !== 2)
                throw new CalcError('root(x, n) принимает 2 аргумента');
            return Math.pow(args[0], 1 / args[1]);
        }
        if (args.length !== 1)
            throw new CalcError(`${name}() принимает 1 аргумент`);
        let x = args[0];
        if (this.opts.degrees && TRIG.has(name))
            x = x * Math.PI / 180;
        let r = FUNCTIONS[name](x);
        if (this.opts.degrees && ATRIG.has(name))
            r = r * 180 / Math.PI;
        return r;
    }
}

function factorial(n) {
    if (n < 0 || !Number.isInteger(n))
        throw new CalcError('Факториал определён для целых n ≥ 0');
    if (n > 170)
        return Infinity;
    let r = 1;
    for (let i = 2; i <= n; i++)
        r *= i;
    return r;
}

/**
 * Вычисляет выражение.
 *
 * @param {string} expression
 * @param {{degrees?: boolean, ans?: number}} [opts]
 * @returns {number}
 */
export function evaluate(expression, opts = {}) {
    const src = String(expression).trim().replace(/=+\s*$/, '');
    const value = new Parser(tokenize(src), opts).parse();
    if (Number.isNaN(value))
        throw new CalcError('Результат не определён');
    return value;
}

/**
 * Форматирует число для вывода.
 *
 * @param {number} v
 * @returns {string}
 */
export function formatResult(v) {
    if (!Number.isFinite(v))
        return v > 0 ? '∞' : '-∞';
    if (Number.isInteger(v) && Math.abs(v) < 1e21)
        return v.toString();
    const abs = Math.abs(v);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-9))
        return v.toExponential(8).replace(/\.?0+e/, 'e');
    return parseFloat(v.toPrecision(14)).toString();
}

/**
 * Проверяет, похожа ли строка на математическое выражение.
 *
 * @param {string} s
 * @returns {boolean}
 */
export function looksLikeMath(s) {
    const t = s.trim();
    if (!t || t.length > 200)
        return false;
    if (!/\d|pi|π/i.test(t))
        return false;
    if (!/[+\-*/^%!()×÷√]|\b(sin|cos|tan|sqrt|log|ln|abs|exp)\b/i.test(t))
        return false;
    try {
        const v = evaluate(t);
        return Number.isFinite(v) || v === Infinity;
    } catch {
        return false;
    }
}

/**
 * Конвертация между системами счисления.
 *
 * @param {number} v
 * @returns {{hex: string, bin: string, oct: string} | null}
 */
export function bases(v) {
    if (!Number.isInteger(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER)
        return null;
    const sign = v < 0 ? '-' : '';
    const a = Math.abs(v);
    return {
        hex: `${sign}0x${a.toString(16).toUpperCase()}`,
        bin: `${sign}0b${a.toString(2)}`,
        oct: `${sign}0o${a.toString(8)}`,
    };
}
