# Настройка

Почти всё меняется в приложении «Настройки». Ниже — что за этим стоит,
если хочется из терминала.

## Оболочка (`dev.hypede.shell`)

| Ключ | По умолчанию | Что делает |
|---|---|---|
| `shelf-alignment` | `'center'` | значки на полке: `center` или `left` |
| `shelf-autohide` | `false` | прятать полку, когда окно её касается |
| `show-date` | `true` | дата в трее |
| `super-key-action` | `'launcher'` | Super открывает `launcher` или `overview` |
| `show-recent-files` | `true` | «Продолжить с того же места» в лаунчере |
| `launcher-columns` | `5` | приложений в ряду (4–8) |
| `launcher-hidden-apps` | «Настройки» GNOME и KDE | что не показывать в лаунчере |
| `web-search-url` | Google | адрес веб-поиска, `%s` — запрос |

```bash
gsettings set dev.hypede.shell shelf-alignment left
gsettings set dev.hypede.shell web-search-url 'https://duckduckgo.com/?q=%s'
```

Закреплённые на полке приложения — это избранное GNOME
(`org.gnome.shell favorite-apps`); закрепить и открепить можно правым
кликом по значку на полке или в лаунчере.

## Значения по умолчанию сеанса

`/usr/share/glib-2.0/schemas/90_hypede.gschema.override`: шрифт Roboto,
кнопки «свернуть/развернуть/закрыть» у окон, окна по центру, выключенный
горячий угол, обои Horizon (светлые и тёмные). Всё — только для сеанса
HypeDE, обычный GNOME не затрагивается.

## «Файлы»

`~/.config/hypede/files.json`: вид (`grid`/`list`), масштаб, скрытые
файлы, сортировка, панель сведений, размер окна. Закладки — общие с GTK
(`~/.config/gtk-3.0/bookmarks`).

## Модули KDE

Каждый модуль сохраняет настройки там же, где в Plasma: сеть — в
NetworkManager, приложения по умолчанию — в `~/.config/mimeapps.list`,
автозапуск — в `~/.config/autostart`, пользователи — в AccountsService.
