// Окно настроек Dynamic Island (GTK4 + libadwaita).

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {PRESETS} from './lib/pure/presets.js';
import {PETS} from './lib/pure/pets.js';
import {TAB_INFO} from './lib/pure/tabs.js';

const WIDGETS = [
    ['media', 'Музыка (обложка и эквалайзер)'],
    ['pet', 'Питомец'],
    ['clock', 'Часы'],
    ['date', 'Дата'],
    ['weather', 'Погода'],
    ['cpu', 'Загрузка процессора'],
    ['ram', 'Память'],
    ['temp', 'Температура'],
    ['fps', 'FPS'],
    ['net', 'Скорость сети'],
    ['battery', 'Батарея'],
    ['keyboard', 'Раскладка клавиатуры'],
];
const SLOTS = [['hidden', 'Скрыт'], ['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']];

const ANIMATIONS = [
    ['spring', 'Пружина (как в iPhone)'],
    ['smooth', 'Плавно'],
    ['bounce', 'Отскок'],
    ['elastic', 'Резинка'],
    ['linear', 'Линейно'],
    ['none', 'Без анимаций'],
];
const TAB_TRANSITIONS = [['slide', 'Сдвиг'], ['fade', 'Затухание'], ['zoom', 'Масштаб'], ['none', 'Без анимации']];

const ACTIVITY_SOURCES = [
    ['music', 'Смена трека'],
    ['clipboard', 'Копирование и полка'],
    ['downloads', 'Загрузки'],
    ['notifications', 'Уведомления'],
    ['timer', 'Таймер'],
    ['pet', 'Питомец'],
    ['recording', 'Запись экрана'],
    ['voice', 'Голос'],
    ['system', 'Громкость и батарея'],
];

const AI_MODELS = [
    'meta/llama-3.3-70b-instruct',
    'meta/llama-3.1-405b-instruct',
    'meta/llama-3.1-8b-instruct',
    'deepseek-ai/deepseek-r1',
    'qwen/qwen2.5-coder-32b-instruct',
    'mistralai/mixtral-8x22b-instruct-v0.1',
    'nvidia/llama-3.1-nemotron-70b-instruct',
    'google/gemma-2-27b-it',
];

// ---------------------------------------------------------------- помощники

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinRow(settings, key, title, min, max, step = 1, subtitle = '', digits = 0) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        digits,
        adjustment: new Gtk.Adjustment({lower: min, upper: max, step_increment: step, page_increment: step * 10}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function entryRow(settings, key, title) {
    const row = new Adw.EntryRow({title, show_apply_button: true});
    row.text = settings.get_string(key);
    row.connect('apply', () => settings.set_string(key, row.text));
    settings.connect(`changed::${key}`, () => {
        if (row.text !== settings.get_string(key))
            row.text = settings.get_string(key);
    });
    return row;
}

function passwordRow(settings, key, title) {
    const row = new Adw.PasswordEntryRow({title, show_apply_button: true});
    row.text = settings.get_string(key);
    row.connect('apply', () => settings.set_string(key, row.text.trim()));
    return row;
}

function comboRow(settings, key, title, options, subtitle = '') {
    const model = new Gtk.StringList();
    for (const [, label] of options)
        model.append(label);
    const row = new Adw.ComboRow({title, subtitle, model});
    const sync = () => {
        const i = options.findIndex(([id]) => id === settings.get_string(key));
        row.selected = Math.max(0, i);
    };
    sync();
    row.connect('notify::selected', () => {
        const id = options[row.selected]?.[0];
        if (id !== undefined && id !== settings.get_string(key))
            settings.set_string(key, id);
    });
    settings.connect(`changed::${key}`, sync);
    return row;
}

function colorRow(settings, key, title) {
    const row = new Adw.ActionRow({title});
    const btn = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({with_alpha: true, title}),
        valign: Gtk.Align.CENTER,
    });
    const sync = () => {
        const rgba = new Gdk.RGBA();
        if (rgba.parse(settings.get_string(key)))
            btn.rgba = rgba;
    };
    sync();
    btn.connect('notify::rgba', () => {
        const s = btn.rgba.to_string();
        if (s !== settings.get_string(key))
            settings.set_string(key, s);
    });
    settings.connect(`changed::${key}`, sync);
    row.add_suffix(btn);
    row.activatable_widget = btn;
    return row;
}

function shortcutRow(settings, key, title) {
    const row = new Adw.EntryRow({title, show_apply_button: true});
    row.text = settings.get_strv(key)[0] ?? '';
    row.connect('apply', () => {
        const text = row.text.trim();
        if (!text) {
            settings.set_strv(key, []);
            return;
        }
        const [ok] = Gtk.accelerator_parse(text);
        if (ok)
            settings.set_strv(key, [text]);
        else
            row.add_css_class('error');
    });
    row.connect('changed', () => row.remove_css_class('error'));
    return row;
}

function group(title, description = '') {
    return new Adw.PreferencesGroup({title, description});
}

function page(title, icon) {
    return new Adw.PreferencesPage({title, icon_name: icon});
}

function hasProgram(name) {
    return GLib.find_program_in_path(name) !== null;
}

// ---------------------------------------------------------------- окно

export default class DynamicIslandPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        window.set_default_size(760, 820);
        window.search_enabled = true;

        window.add(this._general(s));
        window.add(this._appearance(s));
        window.add(this._modules(s));
        window.add(this._integrations(s));
        window.add(this._pet(s));
        window.add(this._about(s));
    }

    // ================================================================ Общие

    _general(s) {
        const p = page('Общие', 'preferences-system-symbolic');

        const main = group('Остров', 'Остров заменяет верхнюю панель GNOME. Наведите на него курсор — он раскроется.');
        main.add(switchRow(s, 'island-enabled', 'Показывать остров', 'Выключите, чтобы вернуть стандартную панель'));
        main.add(switchRow(s, 'replace-panel', 'Заменять верхнюю панель', 'Стандартная панель скрывается и показывается только в «Обзоре»'));
        main.add(switchRow(s, 'show-panel-in-overview', 'Показывать панель в «Обзоре»'));
        main.add(switchRow(s, 'reserve-space', 'Резервировать место сверху', 'Развёрнутые окна не будут заходить под остров'));
        main.add(switchRow(s, 'hide-in-fullscreen', 'Скрывать в полноэкранных приложениях'));
        p.add(main);

        const hover = group('Раскрытие');
        hover.add(switchRow(s, 'hover-expand', 'Раскрывать при наведении', 'Иначе — по клику'));
        hover.add(spinRow(s, 'hover-delay', 'Задержка раскрытия, мс', 0, 3000, 10));
        hover.add(spinRow(s, 'collapse-delay', 'Задержка сворачивания, мс', 0, 5000, 50));
        hover.add(switchRow(s, 'remember-tab', 'Запоминать последнюю вкладку'));
        hover.add(comboRow(s, 'default-tab', 'Вкладка по умолчанию', Object.entries(TAB_INFO).map(([id, i]) => [id, i.title])));
        p.add(hover);

        const act = group('Живые активности', 'Короткие события: смена трека, копирование, загрузки, уведомления…');
        act.add(switchRow(s, 'live-activities', 'Включить живые активности'));
        act.add(switchRow(s, 'island-notifications', 'Уведомления внутри острова', 'Вместо стандартных баннеров GNOME'));
        act.add(switchRow(s, 'pulse-on-activity', 'Пульсация при событии'));
        act.add(spinRow(s, 'activity-duration', 'Длительность, мс', 1000, 15000, 100));
        const sources = new Adw.ExpanderRow({title: 'Источники событий'});
        for (const [id, title] of ACTIVITY_SOURCES) {
            const row = new Adw.SwitchRow({title, active: s.get_strv('activity-sources').includes(id)});
            row.connect('notify::active', () => {
                const set = new Set(s.get_strv('activity-sources'));
                if (row.active)
                    set.add(id);
                else
                    set.delete(id);
                s.set_strv('activity-sources', [...set]);
            });
            sources.add_row(row);
        }
        act.add(sources);
        p.add(act);

        const keys = group('Горячие клавиши', 'Формат: &lt;Super&gt;&lt;Alt&gt;d. Нажмите ✓ для применения.');
        keys.add(shortcutRow(s, 'toggle-island-shortcut', 'Включить / выключить остров'));
        keys.add(shortcutRow(s, 'expand-shortcut', 'Раскрыть остров с поиском'));
        p.add(keys);

        const tips = group('Подсказки');
        for (const [title, sub] of [
            ['Клик по острову', 'раскрыть и закрепить (появится клавиатурный ввод)'],
            ['Средняя кнопка мыши', 'пауза / воспроизведение музыки'],
            ['Правая кнопка мыши', 'быстрые настройки острова'],
            ['Колесо мыши над островом', 'громкость'],
            ['Alt+1…9, Ctrl+Tab', 'переключение вкладок, Esc — свернуть'],
        ])
            tips.add(new Adw.ActionRow({title, subtitle: sub}));
        p.add(tips);
        return p;
    }

    // ================================================================ Внешний вид

    _appearance(s) {
        const p = page('Вид', 'preferences-desktop-appearance-symbolic');

        const theme = group('Тема');
        const presets = Object.entries(PRESETS).map(([id, pr]) => [id, pr.name]);
        presets.push(['custom', 'Своя']);
        const presetRow = comboRow(s, 'theme-preset', 'Пресет', presets);
        presetRow.connect('notify::selected', () => {
            const id = presets[presetRow.selected]?.[0];
            const pr = PRESETS[id];
            if (!pr)
                return;
            s.set_string('bg-color', pr.bg);
            s.set_string('fg-color', pr.fg);
            s.set_string('accent-color', pr.accent);
            s.set_string('border-color', pr.border);
        });
        theme.add(presetRow);
        theme.add(colorRow(s, 'bg-color', 'Фон'));
        theme.add(colorRow(s, 'fg-color', 'Текст'));
        theme.add(colorRow(s, 'accent-color', 'Акцент'));
        theme.add(colorRow(s, 'border-color', 'Рамка'));
        theme.add(spinRow(s, 'border-width', 'Толщина рамки', 0, 6));
        theme.add(switchRow(s, 'shadow', 'Тень'));
        theme.add(switchRow(s, 'blur', 'Размытие фона', 'Лучше всего с полупрозрачным фоном (пресет «Стекло»)'));
        p.add(theme);

        const size = group('Размеры');
        size.add(spinRow(s, 'compact-width', 'Ширина свёрнутого острова', 120, 1200, 10));
        size.add(spinRow(s, 'compact-height', 'Высота свёрнутого острова', 24, 80));
        size.add(spinRow(s, 'expanded-width', 'Ширина раскрытого острова', 560, 1800, 10));
        size.add(spinRow(s, 'expanded-height', 'Высота раскрытого острова', 360, 1200, 10));
        size.add(spinRow(s, 'compact-radius', 'Скругление (свёрнут)', 0, 60));
        size.add(spinRow(s, 'expanded-radius', 'Скругление (раскрыт)', 0, 80));
        size.add(spinRow(s, 'top-margin', 'Отступ сверху', 0, 60));
        p.add(size);

        const font = group('Шрифт');
        font.add(spinRow(s, 'font-size', 'Размер шрифта', 8, 24));
        const fontRow = new Adw.ActionRow({title: 'Семейство шрифта', subtitle: s.get_string('font-family') || 'Системный'});
        const fontBtn = new Gtk.FontDialogButton({dialog: new Gtk.FontDialog(), valign: Gtk.Align.CENTER, level: Gtk.FontLevel.FAMILY});
        const fam = s.get_string('font-family');
        if (fam) {
            try {
                fontBtn.font_desc = Pango.FontDescription.from_string(fam);
            } catch {}
        }
        fontBtn.connect('notify::font-desc', () => {
            const f = fontBtn.font_desc?.get_family() ?? '';
            s.set_string('font-family', f);
            fontRow.subtitle = f || 'Системный';
        });
        const resetFont = new Gtk.Button({icon_name: 'edit-clear-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat']});
        resetFont.connect('clicked', () => {
            s.set_string('font-family', '');
            fontRow.subtitle = 'Системный';
        });
        fontRow.add_suffix(fontBtn);
        fontRow.add_suffix(resetFont);
        font.add(fontRow);
        p.add(font);

        const anim = group('Анимации');
        anim.add(comboRow(s, 'animation-style', 'Стиль', ANIMATIONS));
        anim.add(spinRow(s, 'animation-duration', 'Длительность, мс', 0, 2000, 10));
        anim.add(comboRow(s, 'tab-transition', 'Переключение вкладок', TAB_TRANSITIONS));
        anim.add(switchRow(s, 'content-fade', 'Плавное появление содержимого'));
        anim.add(switchRow(s, 'music-visualizer', 'Анимированный эквалайзер'));
        p.add(anim);
        return p;
    }

    // ================================================================ Модули

    _modules(s) {
        const p = page('Модули', 'view-grid-symbolic');

        const compact = group('Свёрнутый остров', 'Что показывать слева, по центру и справа');
        let layout = {};
        try {
            layout = JSON.parse(s.get_string('compact-layout'));
        } catch {}
        for (const [id, title] of WIDGETS) {
            const model = new Gtk.StringList();
            for (const [, label] of SLOTS)
                model.append(label);
            const row = new Adw.ComboRow({title, model});
            row.selected = Math.max(0, SLOTS.findIndex(([slot]) => slot === (layout[id] ?? 'hidden')));
            row.connect('notify::selected', () => {
                let cur = {};
                try {
                    cur = JSON.parse(s.get_string('compact-layout'));
                } catch {}
                cur[id] = SLOTS[row.selected][0];
                s.set_string('compact-layout', JSON.stringify(cur));
            });
            compact.add(row);
        }
        compact.add(entryRow(s, 'clock-format', 'Формат часов (%H:%M, %I:%M %p, %H:%M:%S)'));
        compact.add(entryRow(s, 'date-format', 'Формат даты (%a, %e %b)'));
        compact.add(spinRow(s, 'update-interval', 'Обновление системных данных, мс', 500, 10000, 100));
        p.add(compact);

        const tabs = group('Вкладки раскрытого острова');
        for (const [id, info] of Object.entries(TAB_INFO)) {
            const row = new Adw.SwitchRow({title: info.title, active: s.get_strv('enabled-tabs').includes(id)});
            row.add_prefix(new Gtk.Image({icon_name: info.icon}));
            row.connect('notify::active', () => {
                const order = Object.keys(TAB_INFO);
                const set = new Set(s.get_strv('enabled-tabs'));
                if (row.active)
                    set.add(id);
                else
                    set.delete(id);
                s.set_strv('enabled-tabs', order.filter(x => set.has(x)));
            });
            tabs.add(row);
        }
        p.add(tabs);

        const clip = group('Буфер обмена и файлы');
        clip.add(switchRow(s, 'clipboard-enabled', 'История буфера обмена'));
        clip.add(spinRow(s, 'clipboard-history-size', 'Размер истории', 5, 500, 5));
        clip.add(switchRow(s, 'clipboard-images', 'Сохранять изображения'));
        clip.add(switchRow(s, 'clipboard-persist', 'Сохранять историю после перезагрузки', 'Закреплённые записи сохраняются всегда'));
        clip.add(switchRow(s, 'clipboard-private', 'Приватный режим', 'Новые записи не сохраняются'));
        clip.add(switchRow(s, 'shelf-auto-add', 'Скопированные файлы — на полку'));
        clip.add(switchRow(s, 'shelf-copy-files', 'Делать временную копию файлов на полке', 'Тогда оригинал можно удалить или переместить'));
        clip.add(entryRow(s, 'downloads-dir', 'Папка загрузок (пусто — системная)'));
        p.add(clip);

        const launcher = group('Лаунчер');
        launcher.add(comboRow(s, 'terminal', 'Терминал', [
            ['auto', 'Автоматически'], ['ptyxis', 'Ptyxis'], ['kgx', 'GNOME Console'], ['gnome-terminal', 'GNOME Terminal'],
            ['konsole', 'Konsole'], ['alacritty', 'Alacritty'], ['kitty', 'kitty'], ['wezterm', 'WezTerm'], ['foot', 'foot'], ['xterm', 'xterm'],
        ]));
        launcher.add(entryRow(s, 'search-engine', 'Поисковик (%s — запрос)'));
        p.add(launcher);

        const cmds = group('Быстрые команды',
            'По одной на строку: «Название|команда». Префикс «!» — выполнить в терминале, «>» — показать вывод в острове.');
        const buffer = new Gtk.TextBuffer({text: s.get_strv('custom-commands').join('\n')});
        const view = new Gtk.TextView({buffer, monospace: true, wrap_mode: Gtk.WrapMode.WORD_CHAR,
            top_margin: 8, bottom_margin: 8, left_margin: 8, right_margin: 8});
        const frame = new Gtk.Frame({child: view, height_request: 140});
        const save = new Gtk.Button({label: 'Сохранить команды', halign: Gtk.Align.END, margin_top: 8, css_classes: ['suggested-action']});
        save.connect('clicked', () => {
            const lines = buffer.text.split('\n').map(l => l.trim()).filter(Boolean);
            s.set_strv('custom-commands', lines);
        });
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        box.append(frame);
        box.append(save);
        cmds.add(box);
        p.add(cmds);
        return p;
    }

    // ================================================================ Интеграции

    _integrations(s) {
        const p = page('ИИ и сервисы', 'applications-science-symbolic');

        const ai = group('ИИ-чат (NVIDIA NIM)',
            'Бесплатный ключ: build.nvidia.com → войти → любая модель → «Get API Key». Подходит любой OpenAI-совместимый API (OpenRouter, Groq, Ollama…).');
        ai.add(entryRow(s, 'ai-endpoint', 'Адрес API'));
        ai.add(passwordRow(s, 'ai-api-key', 'API-ключ (nvapi-…)'));
        const modelRow = entryRow(s, 'ai-model', 'Модель');
        const menu = new Gio.Menu();
        const actionGroup = new Gio.SimpleActionGroup();
        AI_MODELS.forEach((m, i) => {
            const a = new Gio.SimpleAction({name: `m${i}`});
            a.connect('activate', () => s.set_string('ai-model', m));
            actionGroup.add_action(a);
            menu.append(m, `models.m${i}`);
        });
        modelRow.insert_action_group('models', actionGroup);
        modelRow.add_suffix(new Gtk.MenuButton({menu_model: menu, icon_name: 'view-more-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat']}));
        ai.add(modelRow);
        ai.add(entryRow(s, 'ai-system-prompt', 'Системный промпт'));
        ai.add(spinRow(s, 'ai-temperature', 'Температура', 0, 2, 0.1, '', 1));
        ai.add(spinRow(s, 'ai-max-tokens', 'Максимум токенов в ответе', 64, 32768, 64));
        ai.add(switchRow(s, 'ai-stream', 'Потоковый вывод ответа'));
        ai.add(switchRow(s, 'ai-hide-thinking', 'Скрывать размышления (&lt;think&gt;)', 'Для моделей вроде DeepSeek-R1'));
        p.add(ai);

        const weather = group('Погода', 'Данные Open-Meteo, ключ не нужен');
        weather.add(entryRow(s, 'weather-city', 'Город (пусто — определить по IP)'));
        weather.add(comboRow(s, 'weather-units', 'Единицы', [['celsius', '°C'], ['fahrenheit', '°F']]));
        weather.add(spinRow(s, 'weather-interval', 'Обновлять каждые, мин', 5, 240, 5));
        p.add(weather);

        const voice = group('Голос в текст',
            'Локально: whisper.cpp (whisper-cli) или любая команда, печатающая текст. Либо OpenAI-совместимый API (OpenAI, Groq…).');
        voice.add(comboRow(s, 'voice-backend', 'Способ распознавания', [['command', 'Локальная команда'], ['api', 'API (OpenAI-совместимый)']]));
        voice.add(entryRow(s, 'voice-command', 'Команда ({file} — wav, {lang} — язык)'));
        voice.add(entryRow(s, 'voice-api-endpoint', 'Адрес API транскрибации'));
        voice.add(passwordRow(s, 'voice-api-key', 'API-ключ (пусто — ключ ИИ)'));
        voice.add(entryRow(s, 'voice-api-model', 'Модель (whisper-1, whisper-large-v3…)'));
        voice.add(entryRow(s, 'voice-language', 'Язык (ru, en, auto)'));
        voice.add(switchRow(s, 'voice-auto-copy', 'Копировать результат в буфер'));
        voice.add(switchRow(s, 'voice-auto-paste', 'Вставлять в активное окно', 'Имитирует Ctrl+V после распознавания'));
        p.add(voice);

        const ocr = group('Текст с экрана (OCR)', 'Нужен tesseract: sudo apt install tesseract-ocr tesseract-ocr-rus');
        ocr.add(entryRow(s, 'ocr-languages', 'Языки (rus+eng)'));
        ocr.add(entryRow(s, 'ocr-command', 'Команда ({file}, {lang})'));
        p.add(ocr);

        const rec = group('Запись экрана', 'Используется встроенный в GNOME рекордер (WebM)');
        rec.add(entryRow(s, 'recording-dir', 'Папка (пусто — ~/Видео/Screencasts)'));
        rec.add(switchRow(s, 'recording-cursor', 'Показывать курсор'));
        p.add(rec);
        return p;
    }

    // ================================================================ Питомец

    _pet(s) {
        const p = page('Питомец', 'emoji-nature-symbolic');
        const g = group('Питомец', 'Живёт в острове: гуляет, просит есть, радуется, когда его гладят');
        g.add(switchRow(s, 'pet-enabled', 'Включить питомца'));
        g.add(comboRow(s, 'pet-type', 'Вид', Object.entries(PETS).map(([id, pet]) => [id, `${pet.emoji}  ${pet.name}`])));
        g.add(entryRow(s, 'pet-name', 'Имя'));
        g.add(spinRow(s, 'pet-speed', 'Скорость', 1, 10));
        const reset = new Adw.ActionRow({title: 'Начать заново', subtitle: 'Сбросить уровень и показатели'});
        const btn = new Gtk.Button({label: 'Сбросить', valign: Gtk.Align.CENTER, css_classes: ['destructive-action']});
        btn.connect('clicked', () => s.set_string('pet-state', ''));
        reset.add_suffix(btn);
        g.add(reset);
        p.add(g);
        return p;
    }

    // ================================================================ О программе

    _about(s) {
        const p = page('О программе', 'help-about-symbolic');
        const g = group('Dynamic Island для Linux', `Версия ${this.metadata.version ?? 1} · GNOME Shell ${(this.metadata['shell-version'] ?? []).join(', ')}`);
        g.add(new Adw.ActionRow({title: 'Данные', subtitle: `${GLib.get_user_data_dir()}/dynamic-island`}));
        p.add(g);

        const deps = group('Необязательные программы', 'Без них остров работает, но часть функций будет недоступна');
        const check = [
            ['tesseract', 'Текст с экрана (OCR)', 'sudo apt install tesseract-ocr tesseract-ocr-rus'],
            ['whisper-cli', 'Локальное распознавание речи', 'github.com/ggerganov/whisper.cpp'],
            ['pw-record', 'Запись микрофона (PipeWire)', 'sudo apt install pipewire-bin'],
            ['arecord', 'Запись микрофона (ALSA, запасной вариант)', 'sudo apt install alsa-utils'],
            ['ps', 'Список процессов', 'procps'],
        ];
        for (const [prog, title, hint] of check) {
            const ok = hasProgram(prog);
            const row = new Adw.ActionRow({title, subtitle: ok ? `${prog} — найден` : `${prog} — не найден · ${hint}`});
            row.add_prefix(new Gtk.Image({icon_name: ok ? 'emblem-ok-symbolic' : 'dialog-warning-symbolic'}));
            deps.add(row);
        }
        p.add(deps);

        const danger = group('Сброс');
        const resetRow = new Adw.ActionRow({title: 'Сбросить все настройки', subtitle: 'Заметки, история и питомец не удаляются'});
        const btn = new Gtk.Button({label: 'Сбросить', valign: Gtk.Align.CENTER, css_classes: ['destructive-action']});
        btn.connect('clicked', () => {
            for (const key of s.settings_schema.list_keys()) {
                if (key !== 'pet-state')
                    s.reset(key);
            }
        });
        resetRow.add_suffix(btn);
        danger.add(resetRow);
        p.add(danger);
        return p;
    }
}
