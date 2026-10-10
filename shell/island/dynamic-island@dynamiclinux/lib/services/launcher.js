// Лаунчер: поиск приложений, выполнение команд, быстрые команды.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {Emitter, openUri, runInTerminal, runShell, spawn} from '../utils.js';

function normalize(s) {
    return (s ?? '').toLowerCase().replace(/ё/g, 'е');
}

/** Нечёткое совпадение: все символы запроса встречаются по порядку. */
function fuzzyScore(query, text) {
    const q = normalize(query), t = normalize(text);
    if (!q)
        return 0;
    if (t === q)
        return 1000;
    if (t.startsWith(q))
        return 800 - t.length;
    const wordStart = t.split(/[\s\-_.]+/).some(w => w.startsWith(q));
    if (wordStart)
        return 600 - t.length;
    const idx = t.indexOf(q);
    if (idx !== -1)
        return 400 - idx;
    let ti = 0, score = 0;
    for (const c of q) {
        const found = t.indexOf(c, ti);
        if (found === -1)
            return -1;
        score += found === ti ? 3 : 1;
        ti = found + 1;
    }
    return 100 + score - t.length / 10;
}

export class LauncherService extends Emitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._appSystem = Shell.AppSystem.get_default();
        this.history = [];
        this.lastOutput = null;
        this.running = false;
    }

    /**
     * Поиск приложений.
     *
     * @param {string} query
     * @param {number} limit
     * @returns {Shell.App[]}
     */
    searchApps(query, limit = 8) {
        const q = query.trim();
        if (!q)
            return [];
        const results = [];
        for (const info of this._appSystem.get_installed()) {
            if (!info.should_show())
                continue;
            const name = info.get_display_name() ?? info.get_name() ?? '';
            let score = fuzzyScore(q, name);
            const generic = info.get_generic_name?.() ?? '';
            if (generic)
                score = Math.max(score, fuzzyScore(q, generic) - 50);
            const kw = (info.get_keywords?.() ?? []).join(' ');
            if (kw && normalize(kw).includes(normalize(q)))
                score = Math.max(score, 300);
            const exec = info.get_executable?.() ?? '';
            if (exec && normalize(exec).startsWith(normalize(q)))
                score = Math.max(score, 500);
            if (score > 0) {
                const app = this._appSystem.lookup_app(info.get_id());
                if (app)
                    results.push({app, score});
            }
        }
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit).map(r => r.app);
    }

    /** Часто используемые приложения (избранное GNOME + запущенные). */
    favoriteApps(limit = 8) {
        const ids = new Gio.Settings({schema_id: 'org.gnome.shell'}).get_strv('favorite-apps');
        const apps = ids.map(id => this._appSystem.lookup_app(id)).filter(Boolean);
        for (const a of this._appSystem.get_running()) {
            if (!apps.includes(a))
                apps.push(a);
        }
        return apps.slice(0, limit);
    }

    launchApp(app) {
        app.activate();
    }

    /** Быстрые команды из настроек: [{name, command}] */
    get customCommands() {
        return this._settings.get_strv('custom-commands').map(line => {
            const i = line.indexOf('|');
            if (i === -1)
                return {name: line, command: line};
            return {name: line.slice(0, i).trim(), command: line.slice(i + 1).trim()};
        }).filter(c => c.command);
    }

    _remember(cmd) {
        this.history = [cmd, ...this.history.filter(h => h !== cmd)].slice(0, 20);
    }

    /**
     * Выполняет команду.
     * Префиксы: «!» — в терминале, «>» — показать вывод, без префикса — в фоне.
     *
     * @param {string} raw
     * @returns {Promise<{output?: string, ok?: boolean}|null>}
     */
    async runCommand(raw) {
        let cmd = raw.trim();
        if (!cmd)
            return null;
        this._remember(cmd);
        if (cmd.startsWith('!')) {
            runInTerminal(cmd.slice(1).trim(), this._settings.get_string('terminal'));
            return null;
        }
        if (cmd.startsWith('>')) {
            cmd = cmd.slice(1).trim();
            this.running = true;
            this.emit('changed');
            try {
                const res = await runShell(cmd, {cwd: GLib.get_home_dir()});
                const output = `${res.stdout}${res.stderr ? `\n${res.stderr}` : ''}`.trim();
                this.lastOutput = {command: cmd, output: output || '(нет вывода)', ok: res.ok, status: res.status};
                return this.lastOutput;
            } finally {
                this.running = false;
                this.emit('changed');
            }
        }
        spawn(['bash', '-c', cmd]);
        return null;
    }

    /** Поиск в интернете. */
    webSearch(query) {
        const tpl = this._settings.get_string('search-engine') || 'https://duckduckgo.com/?q=%s';
        openUri(tpl.replace('%s', encodeURIComponent(query)));
    }

    /** Похоже ли на адрес сайта. */
    static looksLikeUrl(s) {
        const t = s.trim();
        return /^https?:\/\//i.test(t) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t) && !/\s/.test(t) && /\.[a-z]{2,}(\/|$)/i.test(t);
    }

    openUrl(s) {
        const t = s.trim();
        openUri(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    }

    destroy() {
        this.disconnectAll();
    }
}
