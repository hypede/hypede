#!/bin/bash
# Собирает диск HypeDE Touch — Arch Linux ARM с GNOME и HypeDE для
# виртуальной машины (UTM на Mac с Apple M1 и новее).
#
#   [VARIANT=lite] tools/touch/build-image.sh КАТАЛОГ-РЕПОЗИТОРИЯ ВЫХОДНОЙ-КАТАЛОГ
#
# VARIANT=full (по умолчанию) — для Mac; VARIANT=lite — для UTM на iPhone
# и iPad, где машина эмулируется программно: без браузера и компиляторов,
# в лёгком режиме HypeDE (настройки — в configure.sh).
#
# Запускается от root внутри Arch Linux ARM (aarch64) в привилегированном
# контейнере: нужен chroot с /proc и /sys. КАТАЛОГ-РЕПОЗИТОРИЯ — то, что
# сделал tools/repo/build.sh (пакет hypede-git и база hypede.db). На выходе
# disk.qcow2: GPT, раздел EFI с systemd-boot и ext4 с системой. Петлевые
# устройства не нужны: файловые системы собираются из каталогов.
set -euo pipefail

repo=$(realpath "$1")
out=$(realpath -m "$2")
here=$(dirname "$(realpath "$0")")
work=${WORK:-/var/tmp/hypede-touch}
root=$work/root
ESP_MB=512
DISK_GB=${DISK_GB:-32}
VARIANT=${VARIANT:-full}

PACKAGES=(
    base linux-aarch64 mkinitcpio sudo nano less
    # рабочий стол
    gdm gnome-shell gnome-session gnome-keyring
    xdg-user-dirs-gtk xdg-desktop-portal-gnome ptyxis gnome-text-editor
    noto-fonts noto-fonts-emoji
    pipewire pipewire-pulse wireplumber
    # виртуальная машина: графика, буфер обмена, общие папки
    mesa spice-vdagent qemu-guest-agent
    # сеть и разработка
    networkmanager openssh git
    hypede-git
)
case $VARIANT in
full)
    # «Типы файлов» в «Настройках». plasma-nm и plasma-pa не ставим: они
    # тянут весь plasma-workspace с KWin, а сеть в машине и так готова.
    PACKAGES+=(gnome-control-center kde-cli-tools firefox gnome-weather gst-plugins-good base-devel man-db) ;;
lite)
    # Сжатый своп в памяти: машине на телефоне дают 1,5 ГБ.
    PACKAGES+=(zram-generator) ;;
*)
    echo "VARIANT: full или lite, а не $VARIANT" >&2
    exit 1 ;;
esac

# В контейнере Docker песочница pacman (Landlock) недоступна.
[[ -f /.dockerenv ]] && ! grep -q '^DisableSandbox' /etc/pacman.conf &&
    sed -i '/^\[options\]/a DisableSandbox' /etc/pacman.conf
pacman-key --init >/dev/null
pacman-key --populate >/dev/null
pacman -Sy --noconfirm --needed arch-install-scripts dosfstools mtools e2fsprogs qemu-img

rm -rf "$work"
mkdir -p "$root" "$out"
mount --bind "$root" "$root"
trap 'umount -R "$root" 2>/dev/null || true' EXIT

# Пакеты ставим из локального репозитория, а в образ кладём адрес
# опубликованного — так HypeDE обновляется вместе с системой.
sed '/^\[core\]/i [hypede]\nSigLevel = Optional TrustAll\nServer = file://'"$repo"'\n' /etc/pacman.conf > "$work/pacman.conf"
pacstrap -C "$work/pacman.conf" -K "$root" "${PACKAGES[@]}"
sed '/^\[core\]/i [hypede]\nSigLevel = Optional TrustAll\nServer = https://github.com/hypede/hypede/releases/download/repo-$arch\n' \
    /etc/pacman.conf | sed '/^DisableSandbox/d' > "$root/etc/pacman.conf"

cp "$here/configure.sh" "$root/configure.sh"
arch-chroot "$root" env VARIANT="$VARIANT" bash /configure.sh
rm "$root/configure.sh"
# Скачанные пакеты в образе не нужны: это больше гигабайта.
find "$root/var/cache/pacman/pkg" -mindepth 1 -delete
# pacman-key оставляет gpg-agent, который держит каталог.
gpgconf --homedir "$root/etc/pacman.d/gnupg" --kill all 2>/dev/null || true
umount -R "$root" || umount -R -l "$root"
trap - EXIT

# Раздел EFI: ядро, initramfs и systemd-boot по запасному пути, чтобы
# прошивке не нужны были переменные NVRAM.
esp=$work/esp.img
truncate -s ${ESP_MB}M "$esp"
mkfs.fat -F 32 -n HYPEDE-ESP "$esp" >/dev/null
mkdir -p "$work/espdir/EFI/BOOT" "$work/espdir/loader/entries"
cp -r "$root"/boot/. "$work/espdir/"
cp "$root/usr/lib/systemd/boot/efi/systemd-bootaa64.efi" "$work/espdir/EFI/BOOT/BOOTAA64.EFI"
printf 'default hypede.conf\ntimeout 0\neditor no\n' > "$work/espdir/loader/loader.conf"
cat > "$work/espdir/loader/entries/hypede.conf" <<ENTRY
title   HypeDE Touch
linux   /Image
initrd  /initramfs-linux.img
options root=LABEL=hypede-root rw console=tty0
ENTRY
mcopy -s -i "$esp" "$work/espdir"/* ::/
find "$root/boot" -mindepth 1 -delete

# Корень: ext4 прямо из каталога.
rootimg=$work/root.img
truncate -s $((DISK_GB * 1024 - ESP_MB - 2))M "$rootimg"
mkfs.ext4 -q -L hypede-root -d "$root" "$rootimg"

# Диск: GPT из двух разделов.
disk=$work/disk.raw
truncate -s ${DISK_GB}G "$disk"
sfdisk -q "$disk" <<TABLE
label: gpt
start=1MiB, size=${ESP_MB}MiB, type=uefi, name=ESP
type=linux, name=root
TABLE
dd if="$esp" of="$disk" bs=1M seek=1 conv=notrunc,sparse status=none
dd if="$rootimg" of="$disk" bs=1M seek=$((1 + ESP_MB)) conv=notrunc,sparse status=none
rm "$esp" "$rootimg"

qemu-img convert -c -O qcow2 -o compression_type=zstd "$disk" "$out/disk.qcow2"
rm "$disk"
ls -lh "$out"
