// Недавние файлы для раздела «Продолжить с того же места».
//
// Источник — стандартный список ~/.local/share/recently-used.xbel, который
// ведут GTK- и Qt-приложения (и «Файлы» HypeDE). Читаем его через
// GLib.BookmarkFile, отбрасываем удалённые и нелокальные файлы.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

const RECENT_PATH = GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);

let _cache = null;

function _visited(bookmarks, uri) {
    // В GLib ≥ 2.66 есть варианты с GDateTime; старые методы с time_t
    // объявлены устаревшими.
    try {
        const date = bookmarks.get_visited_date_time(uri) ??
            bookmarks.get_modified_date_time(uri);
        return date ? date.to_unix() : 0;
    } catch {
        return 0;
    }
}

function _read() {
    const file = Gio.File.new_for_path(RECENT_PATH);
    let mtime = 0;
    try {
        const info = file.query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null);
        mtime = info.get_attribute_uint64('time::modified');
    } catch {
        return [];
    }

    if (_cache && _cache.mtime === mtime)
        return _cache.items;

    const items = [];
    try {
        const bookmarks = new GLib.BookmarkFile();
        bookmarks.load_from_file(RECENT_PATH);
        for (const uri of bookmarks.get_uris()) {
            if (!uri.startsWith('file://'))
                continue;
            const path = Gio.File.new_for_uri(uri).get_path();
            if (!path)
                continue;
            let mime = 'application/octet-stream';
            try {
                mime = bookmarks.get_mime_type(uri);
            } catch {}
            items.push({uri, path, mime, when: _visited(bookmarks, uri)});
        }
    } catch (e) {
        console.warn(`HypeDE: cannot read recent files: ${e.message}`);
    }
    items.sort((a, b) => b.when - a.when);
    _cache = {mtime, items};
    return items;
}

export function loadRecentFiles(limit) {
    const result = [];
    for (const item of _read()) {
        if (result.length >= limit)
            break;
        if (!GLib.file_test(item.path, GLib.FileTest.EXISTS))
            continue;
        const contentType = Gio.content_type_from_mime_type(item.mime) ?? item.mime;
        result.push({
            uri: item.uri,
            name: GLib.path_get_basename(item.path),
            parentPath: GLib.path_get_dirname(item.path)
                .replace(GLib.get_home_dir(), '~'),
            icon: Gio.content_type_get_symbolic_icon(contentType),
            when: item.when,
        });
    }
    return result;
}

// «Открыто сегодня», «Открыто вчера», «Открыто 3 дня назад», дата.
export function describeWhen(unixTime) {
    if (!unixTime)
        return '';
    const then = GLib.DateTime.new_from_unix_local(unixTime);
    const now = GLib.DateTime.new_now_local();
    const midnight = date => GLib.DateTime.new_local(
        date.get_year(), date.get_month(), date.get_day_of_month(), 0, 0, 0);
    const days = Math.round(
        midnight(now).difference(midnight(then)) / GLib.TIME_SPAN_DAY);

    if (days <= 0)
        return _('You opened today');
    if (days === 1)
        return _('You opened yesterday');
    if (days < 7) {
        return ngettext('You opened %d day ago', 'You opened %d days ago', days)
            .format(days);
    }
    return _('You opened %s').format(then.format('%e %b').trim());
}
