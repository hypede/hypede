<p align="center">
  <img src="docs/images/logo.png" alt="HypeDE" width="420">
</p>

<p align="center">
  Рабочий стол в стиле Chrome OS на основе GNOME Shell.<br>
  <a href="README.md">English</a> · <a href="https://hypede.github.io">Сайт</a> · <a href="https://hypede.github.io/wiki/ru/">Вики</a>
</p>

<p align="center">
  <img src="docs/images/launcher-light.png" alt="Лаунчер HypeDE" width="760">
</p>

HypeDE — отдельный сеанс, который ставится рядом с обычным GNOME. Пакеты
GNOME не меняются: после установки на экране входа появляется пункт
«HypeDE», а обычный GNOME работает как раньше.

## Что внутри

- **Полка** снизу, сбоку или сверху: закреплённые и открытые приложения,
  лаунчер, дата, время и область состояния. Её можно сделать плавающей,
  прятать под окнами, менять размер и прозрачность.
- **Лаунчер** — компактный у края полки или на весь экран. Ищет приложения,
  разделы настроек, файлы в домашней папке и в интернете, считает примеры.
- **Быстрые настройки** — круглые кнопки в три колонки, как в Chrome OS.
- **Экран блокировки** с большими часами, карточками заряда и нагрузки и
  анимацией волн. Работает и без GDM: с SDDM, greetd и LightDM.
- **«Настройки»** на Qt/QML. Сеть, Bluetooth, звук, принтеры и
  пользователи — это модули KDE внутри окна; остальное (мониторы, мышь,
  клавиатура, внешний вид, полка, экран блокировки, службы) сделано в самом
  HypeDE.
- **«Файлы»** на GTK 4: боковая панель и строка пути как в GNOME Files,
  вкладки и панель сведений как в COSMIC Files.
- **ИИ-помощник** (по желанию) — панель с чатом Claude, Gemini, Mistral,
  ChatGPT, Grok или DeepSeek. Вход в свою учётную запись на сайте
  провайдера, ключи API не нужны. Кнопки «Спросить» есть в лаунчере,
  «Файлах» и «Настройках». Команды помощник не выполняет.
- Своя тема значков (Material Symbols), звуки, обои и приветствие при входе.

## Скриншоты

<p align="center">
  <img src="docs/images/settings-light.png" alt="Настройки" width="760">
  <img src="docs/images/settings-assistant-dark.png" alt="ИИ-помощник в Настройках" width="760">
  <img src="docs/images/quick-settings-dark.png" alt="Быстрые настройки" width="760">
  <img src="docs/images/files-light.png" alt="Файлы" width="760">
  <img src="docs/images/lock-prompt-dark.png" alt="Экран блокировки" width="760">
  <img src="docs/images/shelf-left-dark.png" alt="Полка слева" width="760">
</p>

## Установка (Arch, CachyOS)

```bash
git clone https://github.com/hypede/hypede
cd hypede/packaging
makepkg -si
```

Выйдите из системы и выберите сеанс HypeDE на экране входа.

Модули KDE для «Настроек» ставятся отдельно, по желанию. Если модуля нет,
в строке «Настроек» будет написано, какой пакет нужен:

```bash
sudo pacman -S plasma-nm bluedevil plasma-pa print-manager plasma-workspace \
               plasma-desktop kde-cli-tools flatpak-kcm kinfocenter power-profiles-daemon
```

Для ИИ-помощника нужен `webkitgtk-6.0`, для заголовков окон приложений Qt в
стиле GTK — `qadwaitadecorations-qt6` (AUR).

Сборка без пакета и запуск из исходников — в
[docs/ru/building.md](docs/ru/building.md).

## Клавиши

| Сочетание | Действие |
|---|---|
| Super | лаунчер |
| Super+S | обзор окон и рабочих столов |
| Super+L | заблокировать экран |
| Super+1…9 | приложение с полки по номеру |
| Super+Пробел | следующая раскладка |

## Как это устроено

У HypeDE своя база настроек (`~/.config/dconf/hypede`), поэтому обои,
тема и полка не смешиваются с обычным GNOME. При первом входе туда
переносятся раскладки, мышь, тачпад, специальные возможности и сочетания
клавиш.

Расширения обычного GNOME в HypeDE не загружаются, пока их не разрешить в
«Настройках». Сеанс запускает только нужные службы GNOME; индексатор файлов,
GNOME Software и другие включаются в «Настройки → Системные настройки».

Если экран входа не GDM, HypeDE сам создаёт экран блокировки GNOME и
проверяет пароль через PAM (`/usr/lib/hypede/hypede-auth`, служба
`/etc/pam.d/hypede`).

```
shell/extension/   оболочка: полка, лаунчер, быстрые настройки, блокировка
session/           запуск сеанса, службы systemd, проверка пароля
apps/settings/     «Настройки» (C++, QML, KCMUtils)
apps/files/        «Файлы» (Python, GTK 4)
apps/assistant/    ИИ-помощник (Python, WebKitGTK)
data/              схемы настроек, значки, звуки, обои
tools/             генераторы тем, значков, звуков и скриншотов
```

Подробнее: [архитектура](docs/ru/architecture.md),
[все настройки](docs/ru/configuration.md).

## Ограничения

- Модули KDE, которые настраивают KWin, KScreen или PowerDevil, под GNOME
  не работают. Поэтому мониторы, мышь, клавиатура и питание настраиваются
  разделами HypeDE.
- Взаимное расположение нескольких мониторов пока настраивается в
  `gnome-control-center display`.
- Проверено на GNOME Shell 50.5 и KDE Frameworks 6.30.

## Поддержать

[Ko-fi](https://ko-fi.com/pycodder)

## Лицензия

[GPL-3.0 или новее](LICENSE). Значки Material Symbols — Apache 2.0
(`data/icons/HypeDE/LICENSE`). Цветовые схемы KDE в `apps/settings/colors/`
основаны на Breeze.
