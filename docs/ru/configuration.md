# Настройка

Почти всё меняется в приложении «Настройки». Ниже — что за этим стоит,
если хочется из терминала.

## Свой конфиг HypeDE

Сеанс HypeDE запускается скриптом `/usr/lib/hypede/hypede-session`. Он
выставляет `DCONF_PROFILE=hypede`, и все настройки GSettings сеанса
(`org.gnome.*`, `dev.hypede.*`) хранятся в своей базе
`~/.config/dconf/hypede`, отдельно от обычного GNOME (`~/.config/dconf/user`).
Сменили обои или тему в HypeDE — в GNOME они прежние, и наоборот.

При первом входе из GNOME переносятся раскладки, мышь и тачпад, специальные
возможности, сочетания клавиш, питание, ночной режим, регион и
местоположение. Повторить перенос, сохранить конфиг в файл, восстановить и
сбросить — «Настройки → Система → Конфигурация HypeDE».

Из терминала вне сеанса HypeDE:

```bash
DCONF_PROFILE=hypede gsettings set dev.hypede.shell shelf-position left
DCONF_PROFILE=hypede dconf dump / > hypede-backup.ini      # сохранить
DCONF_PROFILE=hypede dconf load / < hypede-backup.ini      # восстановить
```

Внутри сеанса HypeDE `DCONF_PROFILE` уже выставлен — хватит обычного
`gsettings`.

## Оболочка (`dev.hypede.shell`)

| Ключ | По умолчанию | Что делает |
|---|---|---|
| `shelf-position` | `'bottom'` | край экрана: `bottom`, `left`, `right`, `top` |
| `shelf-style` | `'full'` | `full` — во всю ширину, `floating` — «островок» |
| `shelf-alignment` | `'center'` | значки: `center` или `start` (сразу после лаунчера) |
| `shelf-size` | `52` | толщина полки, пкс |
| `shelf-icon-size` | `36` | размер значков на полке |
| `shelf-opacity` | `80` | непрозрачность фона полки, % |
| `shelf-blur` | `true` | размытие под полкой |
| `shelf-autohide` | `false` | прятать полку, когда окно её касается |
| `shelf-running-indicator` | `'dot'` | отметка запущенных: `dot`, `line`, `none` |
| `shelf-show-pinned` | `true` | показывать закреплённые приложения |
| `shelf-hover-zoom` | `false` | увеличивать значок под указателем |
| `shelf-tooltips` | `true` | подсказки с названиями |
| `show-date` | `true` | дата в трее (на вертикальной полке не показывается) |
| `minimize-to-shelf` | `true` | окно сворачивается в свой значок |
| `launcher-style` | `'bubble'` | `bubble` или `fullscreen` |
| `launcher-columns` | `5` | приложений в ряду (3–10) |
| `launcher-icon-size` | `48` | размер значков в лаунчере |
| `launcher-show-labels` | `true` | подписи под значками |
| `launcher-sort` | `'alphabetical'` | `alphabetical` или `usage` (частые первыми) |
| `show-recent-files` | `true` | «Продолжить с того же места» |
| `launcher-search-providers` | все | что искать: `calculator`, `apps`, `settings`, `files`, `web` |
| `launcher-hidden-apps` | «Настройки» GNOME и KDE, менеджеры расширений | что не показывать в лаунчере |
| `launcher-opacity` | `96` | непрозрачность лаунчера и меню, % |
| `launcher-blur` | `true` | размытие под лаунчером |
| `web-search-url` | Google | адрес веб-поиска, `%s` — запрос |
| `super-key-action` | `'launcher'` | Super открывает `launcher` или `overview` |
| `window-animations` | `'hypede'` | анимации окон: `hypede` (мягкие) или `gnome` |
| `animation-speed` | `1.0` | множитель скорости анимаций (0.25–3) |
| `corner-radius` | `20` | скругление лаунчера, меню и уведомлений |
| `notification-position` | `'bottom-right'` | `bottom-right`, `top-right`, `top-center` |
| `lock-style` | `'hypede'` | экран блокировки `hypede` или `gnome` |
| `lock-clock-style` | `'digital'` | часы: `digital`, `stacked`, `analog` |
| `lock-intro-animation` | `true` | цветные волны при блокировке |
| `lock-show-cards` | `true` | карточки заряда и системы |
| `lock-blur` | `60` | размытие обоев на экране блокировки, % |

Закреплённые на полке приложения — это избранное GNOME
(`org.gnome.shell favorite-apps`); закрепить и открепить можно правым
щелчком по значку, порядок меняется перетаскиванием, а приложение из
лаунчера можно перетащить прямо на полку.

## Сеанс (`dev.hypede.session`)

| Ключ | По умолчанию | Что делает |
|---|---|---|
| `optional-services` | `['print-notifications', 'disk-health']` | необязательные службы GNOME: `file-indexer`, `software-updates`, `calendar-alarms`, `remote-desktop`, `smartcard`, `usb-protection`, `mobile-broadband`, `disk-health`, `print-notifications` |
| `disabled-autostart` | Baloo, напоминания Evolution, LocalSearch… | программы автозапуска, которые не запускаются в HypeDE |
| `allow-gnome-extensions` | `false` | загружать расширения, включённые для обычного GNOME |

Службы подключаются при входе: `hypede-session` пишет их в
`$XDG_RUNTIME_DIR/systemd/user/gnome-session@hypede.target.d/`. Автозапуск
фильтрует `hypede-autostart-filter` — он подключён к юнитам
`app-*@autostart.service` и в других сеансах ничего не меняет.

## Значения по умолчанию сеанса

`/usr/share/glib-2.0/schemas/90_hypede.gschema.override`: шрифт Roboto,
кнопки «свернуть/развернуть/закрыть» у окон, окна по центру, выключенный
горячий угол, обои Horizon (светлые и тёмные). Действуют только в сеансе
HypeDE.

## «Файлы»

`~/.config/hypede/files.json`: вид (`grid`/`list`), масштаб, скрытые
файлы, сортировка, панель сведений, размер окна. Закладки — общие с GTK
(`~/.config/gtk-3.0/bookmarks`).

## Модули KDE

Каждый модуль сохраняет настройки там же, где в Plasma: сеть — в
NetworkManager, приложения по умолчанию — в `~/.config/mimeapps.list`,
автозапуск — в `~/.config/autostart`, пользователи — в AccountsService.
