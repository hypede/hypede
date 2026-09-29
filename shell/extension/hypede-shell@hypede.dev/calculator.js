// Калькулятор для строки поиска лаунчера.
//
// Разбор выражения — рекурсивным спуском, без eval: в строку поиска можно
// вставить что угодно, и выполняться это не должно. Понимает + − × ÷ ^ %,
// скобки, унарный минус и десятичную запятую.

const OPERATOR_ALIASES = {
    '×': '*', 'x': '*', '·': '*',
    '÷': '/', ':': '/',
    '−': '-', '–': '-',
};

export function looksLikeMath(text) {
    const s = text.trim();
    // Нужна хотя бы одна цифра и хотя бы один оператор между операндами,
    // иначе номер версии или год превращались бы в «результат».
    return /\d/.test(s) &&
        /^[\d\s.,+\-−–*/×÷·x:^%()]+$/.test(s) &&
        /\d\s*[+\-−–*/×÷·x:^%]\s*[\d(]|\)\s*[+\-−–*/×÷·x:^%]|^\s*\(/.test(s);
}

function tokenize(text) {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
        let c = text[i];
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        if (/[\d.,]/.test(c)) {
            let j = i;
            while (j < text.length && /[\d.,]/.test(text[j]))
                j++;
            const raw = text.slice(i, j).replace(',', '.');
            if ((raw.match(/\./g) ?? []).length > 1)
                return null;
            const value = Number(raw);
            if (Number.isNaN(value))
                return null;
            tokens.push({type: 'num', value});
            i = j;
            continue;
        }
        c = OPERATOR_ALIASES[c] ?? c;
        if ('+-*/^%()'.includes(c)) {
            tokens.push({type: 'op', value: c});
            i++;
            continue;
        }
        return null;
    }
    return tokens;
}

class Parser {
    constructor(tokens) {
        this._tokens = tokens;
        this._pos = 0;
    }

    _peek() {
        return this._tokens[this._pos];
    }

    _take(value) {
        const token = this._peek();
        if (token && token.type === 'op' && token.value === value) {
            this._pos++;
            return true;
        }
        return false;
    }

    parse() {
        const value = this._expression();
        if (this._pos !== this._tokens.length)
            throw new Error('trailing input');
        return value;
    }

    // expression := term (('+' | '-') term)*
    _expression() {
        let value = this._term();
        for (;;) {
            if (this._take('+'))
                value += this._term();
            else if (this._take('-'))
                value -= this._term();
            else
                return value;
        }
    }

    // term := power (('*' | '/') power)*
    _term() {
        let value = this._power();
        for (;;) {
            if (this._take('*')) {
                value *= this._power();
            } else if (this._take('/')) {
                const divisor = this._power();
                if (divisor === 0)
                    throw new Error('division by zero');
                value /= divisor;
            } else {
                return value;
            }
        }
    }

    // power := unary ('^' power)?   — правоассоциативно
    _power() {
        const base = this._unary();
        if (this._take('^'))
            return base ** this._power();
        return base;
    }

    // unary := ('-' | '+') unary | postfix
    _unary() {
        if (this._take('-'))
            return -this._unary();
        if (this._take('+'))
            return this._unary();
        return this._postfix();
    }

    // postfix := primary '%'*
    _postfix() {
        let value = this._primary();
        while (this._take('%'))
            value /= 100;
        return value;
    }

    _primary() {
        if (this._take('(')) {
            const value = this._expression();
            if (!this._take(')'))
                throw new Error('missing )');
            return value;
        }
        const token = this._peek();
        if (token?.type === 'num') {
            this._pos++;
            return token.value;
        }
        throw new Error('unexpected token');
    }
}

export function evaluate(text) {
    const tokens = tokenize(text);
    if (!tokens || tokens.length === 0)
        return null;
    try {
        const value = new Parser(tokens).parse();
        if (!Number.isFinite(value))
            return null;
        // 12 значащих цифр убирают хвосты вида 0.30000000000000004.
        return Number(value.toPrecision(12));
    } catch {
        return null;
    }
}
