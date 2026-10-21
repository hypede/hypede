# ISO HypeDE (x86_64)

Живой образ с полным HypeDE для VirtualBox, VMware, QEMU и обычных
компьютеров: все разделы «Настроек», ИИ-помощник, Firefox. Загружается
сразу в HypeDE, а значок **Install HypeDE** в лаунчере ставит систему на
диск.

## VirtualBox

1. Скачайте `HypeDE-x86_64.iso` со страницы релиза
   [iso-latest](https://github.com/hypede/hypede/releases/tag/iso-latest).
2. Создайте машину: тип **Linux**, версия **Arch Linux (64-bit)**, 4 ГБ
   памяти и больше, 2 процессора и больше, диск от 25 ГБ.
3. «Дисплей»: видеопамять 128 МБ, контроллер **VMSVGA**, 3D-ускорение
   можно включить.
4. Подключите ISO как оптический диск и запустите машину. Через минуту
   откроется HypeDE — это живой сеанс, на диск ещё ничего не записано.

## Установка

Откройте лаунчер и запустите **Install HypeDE**. Установщик спросит диск
(он будет стёрт целиком), имя пользователя, пароль и имя компьютера, а
затем скопирует систему с образа — сеть не нужна. Установленная система
грузится и в режиме BIOS, и в UEFI.

После установки выключите машину, извлеките ISO в настройках «Носители»
и включите её снова.

## Что внутри

- HypeDE на GNOME Shell со всеми необязательными модулями: сеть, звук,
  Bluetooth, пользователи, сведения о системе, ИИ-помощник.
- Firefox, Text Editor, Calculator, Weather, Image Viewer, Papers.
- Гостевые дополнения VirtualBox, VMware и QEMU.
- NetworkManager, PipeWire, OpenSSH, Git, `base-devel`.

В живом сеансе пользователь **hypede**, пароль **hypede**.

## Сборка самому

Образ собирает `.github/workflows/iso.yml`. Локально, на Linux x86_64 с
Docker:

```bash
docker run --rm -v "$PWD:/src" -w /src archlinux tools/repo/build.sh /src/repo
docker run --rm --privileged -v "$PWD:/src" -w /src archlinux \
    tools/iso/build.sh /src/repo /src/out
```
