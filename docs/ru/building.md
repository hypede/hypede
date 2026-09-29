# Сборка и запуск

## Пакетом (CachyOS, Arch)

```bash
cd packaging
makepkg -si
```

Затем выйти из системы и выбрать сеанс **HypeDE**.

## Вручную

Зависимости сборки: `cmake`, `extra-cmake-modules`, `qt6-base`,
`qt6-declarative`, `qt6-tools`, `kcmutils`, `kcolorscheme`, `kconfig`,
`kcoreaddons`, `gettext`. Для работы: `gnome-shell` 48–50, `gnome-session`,
`python-gobject`, `gtk4`, `libadwaita` ≥ 1.7, `gvfs`, `kirigami`,
`qqc2-desktop-style`, `ttf-roboto`.

```bash
make                     # «Настройки» и переводы
sudo make install        # всё в /usr
sudo glib-compile-schemas /usr/share/glib-2.0/schemas
```

## Из исходников, без установки

```bash
./apps/files/hypede-files                       # «Файлы»
make settings && ./build/settings/hypede-settings --page personalization
make install-user                               # только полка — в обычный GNOME
```

«Настройки» понимают `--page network|bluetooth|devices|personalization|
privacy|apps|accessibility|system|about` и `--kcm <модуль>`. Повторный
запуск не открывает второе окно, а переключает первое (D-Bus
`dev.hypede.Settings`).

## Проверки

```bash
make check      # синтаксис JS, тесты «Файлов» и калькулятора, схема, перевод
```

## Отладка без экрана

`tools/dev/shell-headless.sh` запускает GNOME Shell с виртуальным монитором
(удобно в контейнере или по SSH), `tools/dev/screenshots.sh` снимает все
скриншоты документации в светлой и тёмной теме:

```bash
tools/dev/shell-headless.sh start 1600x900
tools/dev/shell-headless.sh eval 'Main.panel.toggleQuickSettings()'
tools/dev/shell-headless.sh shot /tmp/shot.png
tools/dev/screenshots.sh docs/images
```

Для этого нужен режим `hypede-dev` (`tools/dev/hypede-dev.json`) и
расширение `tools/dev/hypede-devkit@hypede.dev` — они включают небезопасный
режим оболочки и в пакет не входят.

## Перевод

```bash
make pot                                 # шаблон «Файлов» и оболочки + po/ru.po
python3 tools/i18n/fill-ts.py apps/settings/translations/hypede-settings_ru.ts
```

Строки переводятся в `tools/i18n/po_ru.py` и `tools/i18n/settings_ru.py`.
