// Лаунчер в стиле Spotlight: приложения, команды, калькулятор, ИИ, ссылки, веб-поиск.

import Clutter from 'gi://Clutter';

import {BasePage} from './base.js';
import * as W from '../ui/widgets.js';
import {evaluate, formatResult, looksLikeMath} from '../pure/calc.js';
import {LauncherService} from '../services/launcher.js';

const HINT = 'Приложение, >команда, !в терминале, ?вопрос ИИ, =2+2, сайт…';

export class LauncherPage extends BasePage {
    constructor(ctx) {
        super(ctx, {cls: 'di-launcher'});
        this._results = [];
        this._selected = 0;

        const searchRow = W.hbox({style_class: 'di-search-row', x_expand: true});
        this._entry = W.entry({
            hint: HINT,
            cls: 'di-search-entry',
            primaryIcon: 'system-search-symbolic',
            onChange: () => this._update(),
            onActivate: () => this._activate(this._selected),
        });
        this._entry.clutter_text.connect('key-press-event', (a, e) => this._onKey(e));
        searchRow.add_child(this._entry);

        this._list = W.vbox({style_class: 'di-results', x_expand: true});
        this._scroll = W.scroll(this._list);

        this.actor.add_child(searchRow);
        this.actor.add_child(this._scroll);
        this._update();
    }

    focus() {
        this._entry.grab_key_focus();
        this._entry.clutter_text.set_selection(0, -1);
    }

    onShow() {
        super.onShow();
        if (!this._entry.get_text())
            this._update();
        if (this.ctx.island.pinned)
            this.focus();
    }

    /** Начать с заданного текста (например, при открытии по горячей клавише). */
    setQuery(text) {
        this._entry.set_text(text);
        this.focus();
        this._entry.clutter_text.set_selection(-1, -1);
    }

    _onKey(event) {
        const sym = event.get_key_symbol();
        if (sym === Clutter.KEY_Down) {
            this._select(this._selected + 1);
            return Clutter.EVENT_STOP;
        }
        if (sym === Clutter.KEY_Up) {
            this._select(this._selected - 1);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _select(i) {
        if (!this._results.length)
            return;
        this._selected = (i + this._results.length) % this._results.length;
        this._results.forEach((r, k) => {
            if (k === this._selected)
                r.actor.add_style_pseudo_class('selected');
            else
                r.actor.remove_style_pseudo_class('selected');
        });
        const sel = this._results[this._selected].actor;
        const adj = this._scroll.vadjustment ?? this._scroll.get_vscroll_bar?.()?.get_adjustment();
        if (adj) {
            const [, y] = sel.get_position();
            if (y < adj.value)
                adj.value = y;
            else if (y + sel.height > adj.value + adj.page_size)
                adj.value = y + sel.height - adj.page_size;
        }
    }

    _activate(i) {
        const r = this._results[i];
        if (r)
            r.run();
    }

    _row({icon, gicon, emoji, title, subtitle, run, accent}) {
        const btn = W.button({cls: 'di-result', expand: true});
        const box = W.hbox({x_expand: true});
        let ic;
        if (gicon)
            ic = W.icon(gicon, 28);
        else if (emoji)
            ic = W.label(emoji, {cls: 'di-result-emoji'});
        else
            ic = W.icon(icon ?? 'system-run-symbolic', 22, accent ? `color: ${this.theme.accent};` : '');
        const texts = W.vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        texts.add_child(W.label(title, {cls: 'di-result-title'}));
        if (subtitle)
            texts.add_child(W.label(subtitle, {cls: 'di-small', style: `color: ${this.theme.dim};`}));
        W.add(box, ic, texts);
        btn.set_child(box);
        const result = {actor: btn, run};
        btn.connect('clicked', () => run());
        btn.connect('notify::hover', () => {
            if (btn.hover)
                this._select(this._results.indexOf(result));
        });
        this._results.push(result);
        this._list.add_child(btn);
        return result;
    }

    _section(title) {
        this._list.add_child(W.label(title, {cls: 'di-section-title'}));
    }

    _update() {
        const q = this._entry.get_text();
        const s = this.services;
        const launcher = s.launcher;
        this._list.destroy_all_children();
        this._results = [];
        this._selected = 0;
        const query = q.trim();

        if (!query) {
            this._renderHome();
            return;
        }

        const close = () => this.ctx.island.collapse();

        // Калькулятор
        const mathSrc = query.startsWith('=') ? query.slice(1) : query;
        if (query.startsWith('=') || looksLikeMath(query)) {
            try {
                const v = formatResult(evaluate(mathSrc));
                this._row({emoji: '🧮', title: `= ${v}`, subtitle: 'Enter — скопировать результат', run: () => this.copy(v)});
            } catch (e) {
                if (query.startsWith('='))
                    this._row({emoji: '🧮', title: e.message, subtitle: mathSrc, run: () => {}});
            }
        }

        // ИИ
        if (query.startsWith('?')) {
            const prompt = query.slice(1).trim();
            this._row({emoji: '✨', title: `Спросить ИИ: ${prompt || '…'}`, subtitle: 'Ответ появится на вкладке «ИИ»', run: () => {
                if (prompt) {
                    s.ai.send(prompt);
                    this._entry.set_text('');
                    this.ctx.expandedTab('ai');
                }
            }});
        }

        // Команды
        if (query.startsWith('>') || query.startsWith('!')) {
            const inTerm = query.startsWith('!');
            this._row({
                icon: 'utilities-terminal-symbolic',
                accent: true,
                title: query.slice(1).trim() || '…',
                subtitle: inTerm ? 'Выполнить в терминале' : 'Выполнить и показать вывод',
                run: () => this._runCommand(query),
            });
        }

        // Ссылка
        if (LauncherService.looksLikeUrl(query)) {
            this._row({icon: 'web-browser-symbolic', title: `Открыть ${query}`, subtitle: 'Сайт', run: () => {
                launcher.openUrl(query);
                close();
            }});
        }

        // Приложения
        if (!/^[>!?=]/.test(query)) {
            const apps = launcher.searchApps(query, 7);
            if (apps.length)
                this._section('Приложения');
            for (const app of apps) {
                this._row({
                    gicon: app.get_icon(),
                    title: app.get_name(),
                    subtitle: app.get_description() ?? '',
                    run: () => {
                        launcher.launchApp(app);
                        this._entry.set_text('');
                        close();
                    },
                });
            }
            // Быстрые команды
            const nq = query.toLowerCase();
            const cmds = launcher.customCommands.filter(c => c.name.toLowerCase().includes(nq));
            if (cmds.length)
                this._section('Быстрые команды');
            for (const c of cmds)
                this._row({icon: 'system-run-symbolic', title: c.name, subtitle: c.command, run: () => this._runCommand(c.command)});

            this._section('Ещё');
            this._row({icon: 'system-run-symbolic', title: `Выполнить «${query}»`, subtitle: 'Запустить как команду в фоне', run: () => this._runCommand(query)});
            this._row({icon: 'utilities-terminal-symbolic', title: 'Выполнить в терминале', subtitle: query, run: () => this._runCommand(`!${query}`)});
            this._row({emoji: '✨', title: 'Спросить ИИ', subtitle: query, run: () => {
                s.ai.send(query);
                this._entry.set_text('');
                this.ctx.expandedTab('ai');
            }});
            this._row({icon: 'edit-find-symbolic', title: `Искать «${query}» в интернете`, run: () => {
                launcher.webSearch(query);
                close();
            }});
        }
        this._select(0);
    }

    _renderHome() {
        const launcher = this.services.launcher;
        // Избранные приложения сеткой
        const apps = launcher.favoriteApps(12);
        if (apps.length) {
            this._list.add_child(W.label('Избранное', {cls: 'di-section-title'}));
            const btns = apps.map(app => {
                const b = W.button({cls: 'di-app-tile', vertical: true});
                const box = W.vbox({x_align: Clutter.ActorAlign.CENTER});
                const ic = W.icon(app.get_icon(), 36);
                ic.x_align = Clutter.ActorAlign.CENTER;
                const l = W.label(app.get_name(), {cls: 'di-small', center: true});
                l.x_align = Clutter.ActorAlign.CENTER;
                W.add(box, ic, l);
                b.set_child(box);
                b.connect('clicked', () => {
                    launcher.launchApp(app);
                    this.ctx.island.collapse();
                });
                return b;
            });
            this._list.add_child(W.grid(btns, 6, {fill: true}));
        }

        // Быстрые команды
        const cmds = launcher.customCommands;
        if (cmds.length) {
            this._list.add_child(W.label('Быстрые команды', {cls: 'di-section-title'}));
            const row = W.hbox({style_class: 'di-chips'});
            for (const c of cmds) {
                const b = W.button({label: c.name, cls: 'di-chip-btn', onClick: () => this._runCommand(c.command)});
                row.add_child(b);
            }
            this._list.add_child(W.scroll(row, {horizontal: true, cls: 'di-chips-scroll'}));
        }

        // Последний вывод команды
        const out = launcher.lastOutput;
        if (out)
            this._renderOutput(out);
        else
            this._list.add_child(W.label(`Подсказка: ${HINT}`, {cls: 'di-small', style: `color: ${this.theme.faint};`, wrap: true}));
    }

    _renderOutput(out) {
        const card = W.card(true, {cls: 'di-output'});
        const head = W.hbox({x_expand: true});
        head.add_child(W.label(`$ ${out.command}`, {cls: 'di-mono di-small', expand: true}));
        head.add_child(W.chip(out.ok ? 'OK' : `код ${out.status}`, {color: out.ok ? this.theme.success : this.theme.danger}));
        head.add_child(W.iconButton('edit-copy-symbolic', () => this.copy(out.output), {cls: 'di-flat'}));
        const body = W.label(out.output.slice(0, 6000), {cls: 'di-mono di-output-text', wrap: true});
        body.clutter_text.selectable = true;
        W.add(card, head, body);
        this._list.add_child(card);
    }

    async _runCommand(cmd) {
        try {
            const res = await this.services.launcher.runCommand(cmd);
            if (res) {
                this._entry.set_text('');
                this._update();
            } else {
                this.toast('Команда запущена', {icon: 'system-run-symbolic', subtitle: cmd, duration: 1500});
            }
        } catch (e) {
            this.toast('Ошибка запуска', {icon: 'dialog-warning-symbolic', subtitle: e.message});
        }
    }
}
