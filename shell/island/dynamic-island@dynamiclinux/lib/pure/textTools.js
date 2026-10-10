// Инструменты форматирования текста (чистые функции без зависимостей от GNOME).

const EN = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./~QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>?@#$^&";
const RU = 'ёйцукенгшщзхъфывапролджэячсмитьбю.ЁЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,"№;:?';

const EN_TO_RU = new Map();
const RU_TO_EN = new Map();
for (let i = 0; i < EN.length; i++) {
    EN_TO_RU.set(EN[i], RU[i]);
    RU_TO_EN.set(RU[i], EN[i]);
}

/**
 * Исправляет текст, набранный не в той раскладке (ghbdtn → привет и наоборот).
 *
 * @param {string} text
 * @returns {string}
 */
export function fixLayout(text) {
    const ru = /[а-яё]/i.test(text);
    const en = /[a-z]/i.test(text);
    const convert = (s, map) => [...s].map(c => map.get(c) ?? c).join('');
    // Текст целиком в одной раскладке — переводим весь
    if (!(ru && en))
        return convert(text, ru ? RU_TO_EN : EN_TO_RU);
    // Смешанный текст: чаще всего забыли переключиться с английской —
    // переводим только «латинские» слова, кириллицу не трогаем
    return text.replace(/\S+/g, w => (/[а-яё]/i.test(w) || !/[a-z]/i.test(w) ? w : convert(w, EN_TO_RU)));
}

const TRANSLIT = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '',
    э: 'e', ю: 'yu', я: 'ya',
};

/**
 * Транслитерация кириллицы в латиницу.
 *
 * @param {string} text
 * @returns {string}
 */
export function transliterate(text) {
    return [...text].map(c => {
        const lower = c.toLowerCase();
        if (!(lower in TRANSLIT))
            return c;
        const t = TRANSLIT[lower];
        if (c === lower || !t)
            return t;
        return t[0].toUpperCase() + t.slice(1);
    }).join('');
}

function titleCase(text) {
    return text.toLowerCase().replace(/(^|[\s\-–—"«(])(\p{L})/gu, (m, p, l) => p + l.toUpperCase());
}

function sentenceCase(text) {
    return text.toLowerCase().replace(/(^\s*|[.!?…]\s+|\n\s*)(\p{L})/gu, (m, p, l) => p + l.toUpperCase());
}

function words(text) {
    return text
        .replace(/([a-zа-яё0-9])([A-ZА-ЯЁ])/g, '$1 $2')
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean);
}

function camelCase(text) {
    return words(text).map((w, i) => {
        const l = w.toLowerCase();
        return i === 0 ? l : l[0].toUpperCase() + l.slice(1);
    }).join('');
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Собственная реализация base64 (в GJS нет btoa/atob).
function toBase64(text) {
    const b = new TextEncoder().encode(text);
    let out = '';
    for (let i = 0; i < b.length; i += 3) {
        const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
        out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
        out += i + 1 < b.length ? B64[(n >> 6) & 63] : '=';
        out += i + 2 < b.length ? B64[n & 63] : '=';
    }
    return out;
}

function fromBase64(text) {
    const clean = text.replace(/[\s=]/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (/[^A-Za-z0-9+/]/.test(clean))
        throw new Error('Некорректная строка base64');
    const bytes = [];
    let buf = 0, bits = 0;
    for (const c of clean) {
        buf = (buf << 6) | B64.indexOf(c);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buf >> bits) & 0xff);
        }
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
}

function reverseString(text) {
    return [...text].reverse().join('');
}

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function unescapeHtml(text) {
    return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

/** Типографика: кавычки-ёлочки, тире, неразрывные пробелы после коротких слов. */
function typograph(text) {
    return text
        .replace(/(^|[\s(\[{])"(\S)/g, '$1«$2')
        .replace(/(\S)"(?=$|[\s.,;:!?)\]}])/g, '$1»')
        .replace(/ - /g, ' — ')
        .replace(/(\d)-(\d)/g, '$1–$2')
        .replace(/\.\.\./g, '…')
        .replace(/(^|\s)(в|и|к|с|у|о|а|на|по|за|от|до|не|из|без|для)\s/giu, '$1$2 ')
        .replace(/ {2,}/g, ' ');
}

/** Список доступных преобразований: [id, подпись, функция]. */
export const TRANSFORMS = [
    ['upper', 'ВЕРХНИЙ', t => t.toUpperCase()],
    ['lower', 'нижний', t => t.toLowerCase()],
    ['title', 'Каждое Слово', titleCase],
    ['sentence', 'Как в предложении', sentenceCase],
    ['swap', 'иНВЕРСИЯ', t => [...t].map(c => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('')],
    ['layout', 'Раскладка ⇄', fixLayout],
    ['translit', 'Транслит', transliterate],
    ['typograph', 'Типограф', typograph],
    ['trim', 'Убрать пробелы', t => t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).join('\n').trim()],
    ['oneline', 'В одну строку', t => t.replace(/\s*\n\s*/g, ' ').trim()],
    ['noempty', 'Без пустых строк', t => t.split('\n').filter(l => l.trim()).join('\n')],
    ['sort', 'Сортировать строки', t => t.split('\n').sort((a, b) => a.localeCompare(b)).join('\n')],
    ['unique', 'Уникальные строки', t => [...new Set(t.split('\n'))].join('\n')],
    ['reverse-lines', 'Строки наоборот', t => t.split('\n').reverse().join('\n')],
    ['reverse', 'Текст наоборот', reverseString],
    ['number', 'Нумеровать', t => t.split('\n').map((l, i) => `${i + 1}. ${l}`).join('\n')],
    ['bullets', 'Маркеры •', t => t.split('\n').map(l => (l.trim() ? `• ${l}` : l)).join('\n')],
    ['camel', 'camelCase', camelCase],
    ['snake', 'snake_case', t => words(t).map(w => w.toLowerCase()).join('_')],
    ['kebab', 'kebab-case', t => words(t).map(w => w.toLowerCase()).join('-')],
    ['b64e', 'Base64 →', toBase64],
    ['b64d', '← Base64', fromBase64],
    ['urle', 'URL encode', t => encodeURIComponent(t)],
    ['urld', 'URL decode', t => decodeURIComponent(t)],
    ['htmle', 'HTML escape', escapeHtml],
    ['htmld', 'HTML unescape', unescapeHtml],
    ['json', 'JSON красиво', t => JSON.stringify(JSON.parse(t), null, 2)],
    ['jsonmin', 'JSON сжать', t => JSON.stringify(JSON.parse(t))],
    ['md-strip', 'Убрать Markdown', t => t.replace(/[*_`~#>]+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')],
];

/**
 * Применяет преобразование по id.
 *
 * @param {string} id
 * @param {string} text
 * @returns {string}
 */
export function applyTransform(id, text) {
    const t = TRANSFORMS.find(x => x[0] === id);
    if (!t)
        throw new Error(`Неизвестное преобразование ${id}`);
    return t[2](text);
}

/**
 * Статистика текста.
 *
 * @param {string} text
 * @returns {{chars: number, noSpaces: number, words: number, lines: number, readMin: number}}
 */
export function textStats(text) {
    const chars = [...text].length;
    const noSpaces = [...text.replace(/\s/g, '')].length;
    const w = (text.match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) || []).length;
    const lines = text ? text.split('\n').length : 0;
    return {chars, noSpaces, words: w, lines, readMin: Math.max(1, Math.round(w / 180))};
}

function escapeMarkup(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Упрощённый Markdown → Pango-разметка для ответов ИИ:
 * блоки кода, `код`, **жирный**, *курсив*, заголовки, списки.
 *
 * @param {string} md
 * @returns {string}
 */
export function markdownToPango(md) {
    const parts = [];
    let rest = String(md ?? '');
    // Блоки кода ```lang\n...```
    const re = /```[\w+-]*\n?([\s\S]*?)```/g;
    let last = 0;
    let m;
    while ((m = re.exec(rest)) !== null) {
        parts.push(inlineMd(rest.slice(last, m.index)));
        parts.push(`<span font_family="monospace" bgalpha="12%" background="#888888">${escapeMarkup(m[1].replace(/\n$/, ''))}</span>`);
        last = re.lastIndex;
    }
    parts.push(inlineMd(rest.slice(last)));
    return parts.join('');
}

function inlineMd(text) {
    return escapeMarkup(text)
        .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
        .replace(/^(\s*)[-*]\s+/gm, '$1• ')
        .replace(/`([^`\n]+)`/g, '<span font_family="monospace" bgalpha="12%" background="#888888">$1</span>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
        .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>');
}
