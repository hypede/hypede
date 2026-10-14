# HypeDE Touch

Готовая виртуальная машина для [UTM](https://mac.getutm.app) на Mac с
Apple M1 и новее: Arch Linux ARM, GNOME и HypeDE в режиме планшета. Ничего
собирать не нужно — пакеты приходят готовыми из репозитория `hypede`.

## Установка

1. Скачайте `HypeDE-Touch-aarch64.utm.zip` со страницы релиза
   [touch-latest](https://github.com/hypede/hypede/releases/tag/touch-latest)
   и распакуйте.
2. Откройте `HypeDE Touch.utm` двойным щелчком — машина появится в UTM.
3. Запустите её. Вход автоматический, пользователь **hypede**, пароль
   **hypede**. Смените его первым делом: `passwd` в терминале.

Машине выдано 4 ядра и 4 ГБ памяти, диск растёт по мере заполнения до
32 ГБ. Всё это меняется в настройках машины в UTM.

## Что внутри

- HypeDE на GNOME Shell, режим планшета включён (выключить — плитка
  «Планшет» в быстрых настройках).
- OpenSSH, Git, `base-devel`, NetworkManager, PipeWire.
- SPICE и QEMU guest agent: окно машины меняет разрешение вместе с
  окном UTM.
- Общая папка: в UTM «Общий доступ → Общая папка» (режим VirtFS) — она
  появится в `/mnt/share`.

## SSH

Сервер SSH запущен. Адрес машины покажет `ip -4 addr` (в сети UTM
«Общая» он вида `192.168.64.x`), с Mac: `ssh hypede@192.168.64.x`.

## Обновление

```bash
sudo pacman -Syu
```

HypeDE обновляется вместе с системой: каждый коммит в `main` собирается
для aarch64 и попадает в репозиторий `hypede` (см. `building.md`).

## Сборка образа самому

Образ собирает `.github/workflows/touch.yml` на ARM-машине GitHub:
`tools/repo/build.sh` делает пакет, `tools/touch/build-image.sh` — диск,
`tools/touch/make-utm.py` — папку `.utm`. Локально на Linux aarch64:

```bash
docker run --rm -v "$PWD:/src" -w /src menci/archlinuxarm tools/repo/build.sh /src/repo
docker run --rm --privileged -v "$PWD:/src" -w /src menci/archlinuxarm \
    tools/touch/build-image.sh /src/repo /src/image
python3 tools/touch/make-utm.py image/disk.qcow2 "HypeDE Touch.utm"
```
