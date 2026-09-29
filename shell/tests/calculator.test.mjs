// Тесты калькулятора лаунчера: node shell/tests/calculator.test.mjs
import assert from 'node:assert/strict';
import {evaluate, looksLikeMath} from '../extension/hypede-shell@hypede.dev/calculator.js';

const cases = [
    ['2+2', 4],
    ['2 + 2 * 2', 6],
    ['(2 + 2) * 2', 8],
    ['10 / 4', 2.5],
    ['0,1 + 0,2', 0.3],
    ['2^10', 1024],
    ['2^3^2', 512],
    ['-3 + 5', 2],
    ['50%', 0.5],
    ['200 * 15%', 30],
    ['7 × 6', 42],
    ['9 ÷ 3', 3],
    ['1/0', null],
    ['2 +', null],
    ['(1', null],
    ['1.2.3 + 1', null],
];
for (const [input, expected] of cases)
    assert.equal(evaluate(input), expected, `evaluate(${JSON.stringify(input)})`);

assert.equal(looksLikeMath('2+2'), true);
assert.equal(looksLikeMath('12 * 3'), true);
assert.equal(looksLikeMath('(1)'), true);
assert.equal(looksLikeMath('2026'), false, 'год — не выражение');
assert.equal(looksLikeMath('1.2.3'), false, 'номер версии — не выражение');
assert.equal(looksLikeMath('firefox'), false);
assert.equal(looksLikeMath('x264'), false);

console.log(`калькулятор: ${cases.length + 7} проверок пройдено`);
