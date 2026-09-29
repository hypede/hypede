<p align="center">
  <img src="docs/images/logo.png" alt="HypeDE" width="420">
</p>

<p align="center">
  <b>GNOME в облике Chrome OS.</b><br>
  Полка внизу, лаунчер-«пузырь», трей с быстрыми настройками — на чистом GNOME Shell 50.<br>
  «Настройки» — модули KDE в интерфейсе Chrome OS. «Файлы» — смесь GNOME Files и COSMIC Files.
</p>

<p align="center">
  <img src="docs/images/launcher-light.png" alt="Лаунчер HypeDE" width="760">
</p>

---

## Что это

HypeDE 1.0 — отдельный сеанс поверх **нетронутого** GNOME: пакеты GNOME
не патчатся и не заменяются. На экране входа появляется пункт «HypeDE»,
а обычный сеанс GNOME на той же машине остаётся как был.

| Часть | Из чего сделана | Что умеет |
|---|---|---|
| **Оболочка** | GNOME Shell 48–50 + свой режим сеанса и расширение `hypede-shell` | полка внизу, кольцо лаунчера, закреплённые и запущенные приложения с точкой-индикатором, трей «дата + статус + время», быстрые настройки и календарь открываются вверх, уведомления справа внизу, автоскрытие полки, клавиша Super открывает лаунчер |
| **Лаунчер** | часть расширения | поиск по приложениям, разделам настроек и недавним файлам, калькулятор (`12*(3+4)` → 84), поиск в интернете, «Продолжить с того же места», сетка всех приложений |
| **Настройки** | Qt 6 / QML + **модули KDE (KCM)** через KCMUtils | интерфейс «Настроек» Chrome OS; сеть, Bluetooth, звук, принтеры, пользователи, приложения по умолчанию, автозапуск, Flatpak — настоящие модули KDE прямо в карточке; мышь, клавиатура, ночной режим, питание, обои, тема, акцент, полка — через GSettings |
| **Файлы** | Python + GTK 4 + libadwaita | раскладка GNOME Files (боковая панель, «крошки» пути, поиск, двойной клик, плашка выделения) + вкладки и панель сведений из COSMIC Files; сетка с эскизами и список, рамка выделения, перетаскивание, копирование с прогрессом и отменой, корзина с восстановлением |

Все обои, значки и тексты — **свои**: ассеты и шрифты Google проприетарны,
в проекте их нет. Облик повторяет раскладку и поведение Chrome OS, но
нарисован заново.

## Как это выглядит

<p align="center">
  <img src="docs/images/files-light.png" alt="Файлы" width="760">
  <img src="docs/images/settings-light.png" alt="Настройки: персонализация" width="760">
  <img src="docs/images/settings-kcm-dark.png" alt="Модуль KDE внутри Настроек, тёмная тема" width="760">
  <img src="docs/images/launcher-calc-light.png" alt="Калькулятор в лаунчере" width="760">
  <img src="docs/images/quick-settings-dark.png" alt="Быстрые настройки, тёмная тема" width="760">
</p>

Скриншоты сняты в настоящем GNOME Shell 50.5 с KDE Frameworks 6.30 (Arch
Linux) скриптом `tools/dev/screenshots.sh`.

## Установка на CachyOS и Arch

```bash
git clone https://github.com/hypede/hypede
cd hypede/packaging
makepkg -si
```

Выйдите из системы и выберите на экране входа сеанс **HypeDE**.

Модули KDE ставятся по желанию — без них соответствующая строка в
«Настройках» просто подскажет, какой пакет нужен:

```bash
sudo pacman -S plasma-nm bluedevil plasma-pa print-manager plasma-workspace \
               plasma-desktop kde-cli-tools flatpak-kcm kinfocenter power-profiles-daemon
```

Подробности, сборка без пакета и запуск из исходников — в
[docs/ru/building.md](docs/ru/building.md).

### Попробовать только полку в обычном GNOME

```bash
make install-user
# перезайти в сеанс, затем:
gnome-extensions enable hypede-shell@hypede.dev
```

## Горячие клавиши

| Сочетание | Действие |
|---|---|
| `Super` | лаунчер (можно переназначить на обзор в «Настройках») |
| `Super+S` | обзор окон и рабочих столов |
| `Super+1…9` | закреплённое на полке приложение по номеру |
| `Super+Space` | следующая раскладка |
| В «Файлах» | `Ctrl+T` вкладка, `Ctrl+L` адрес, `Ctrl+F` поиск, `Ctrl+I` сведения, `F2` переименовать, `Ctrl+1/2` сетка/список, `F1` справка по клавишам |

## Как устроено

```
shell/modes/hypede.json        режим GNOME Shell: панель → полка, свой набор расширений
shell/extension/…              расширение: полка, лаунчер, обзор, уведомления
shell/theme/stylesheet.css.in  тема оболочки (светлая и тёмная из одного шаблона)
session/                       сеанс для экрана входа и gnome-session (systemd)
data/                          схема настроек, значения по умолчанию, .desktop-файлы
apps/settings/                 «Настройки»: C++/QML, KCMUtils, GSettings, D-Bus
apps/files/                    «Файлы»: Python, GTK 4, libadwaita
po/, tools/i18n/               русский перевод
```

Подробно — в [docs/ru/architecture.md](docs/ru/architecture.md), все настройки — в
[docs/ru/configuration.md](docs/ru/configuration.md), планы — в
[docs/ru/roadmap.md](docs/ru/roadmap.md).

## Честно о границах

* **Модули KDE работают те, что говорят со стандартными службами**
  (NetworkManager, BlueZ, PipeWire, CUPS, AccountsService, mimeapps.list,
  XDG-автозапуск, Flatpak). Модули, которые настраивают KWin, KScreen или
  PowerDevil (экраны, мышь, питание, раскладки KDE), под GNOME ничего бы не
  меняли — эти разделы сделаны на GSettings, которыми управляет GNOME.
* **Расположение мониторов** пока открывается в «Настройках» GNOME
  (`gnome-control-center display`): у Mutter свой протокол, который модуль KDE
  не понимает.
* Сопряжение Bluetooth-устройств с PIN-кодом использует агента bluedevil;
  если его нет, пригодится `bluetoothctl`.
* Поддерживаются GNOME 48–50; проверено на 50.5.

## Лицензия

HypeDE — свободная программа под лицензией
[GNU GPL версии 3 или новее](LICENSE). Цветовые схемы KDE в
`apps/settings/colors/` сделаны на основе Breeze.
