#!/bin/bash
# Собирает живой ISO HypeDE для x86_64 (VirtualBox, VMware, QEMU и
# обычные компьютеры): полный HypeDE со всеми разделами «Настроек»,
# автовход в живой сеанс и установщик на диск (значок «Install HypeDE»).
#
#   tools/iso/build.sh КАТАЛОГ-РЕПОЗИТОРИЯ ВЫХОДНОЙ-КАТАЛОГ
#
# Запускается от root внутри Arch Linux в привилегированном контейнере.
# КАТАЛОГ-РЕПОЗИТОРИЯ — то, что сделал tools/repo/build.sh. Основа —
# профиль baseline из archiso; сверху ложатся пакеты отсюда и файлы из
# tools/iso/airootfs.
set -euo pipefail

repo=$(realpath "$1")
out=$(realpath -m "$2")
here=$(dirname "$(realpath "$0")")
work=${WORK:-/var/tmp/hypede-iso}
profile=$work/profile

PACKAGES=(
    # живой образ и установщик
    linux mkinitcpio mkinitcpio-archiso syslinux grub efibootmgr
    arch-install-scripts rsync dosfstools sudo nano less man-db
    # рабочий стол
    gdm gnome-shell gnome-session gnome-keyring gnome-control-center
    xdg-user-dirs-gtk xdg-desktop-portal-gnome ptyxis
    gnome-text-editor gnome-calculator gnome-weather loupe papers firefox
    noto-fonts noto-fonts-emoji
    pipewire pipewire-pulse pipewire-alsa wireplumber gst-plugins-good gst-libav
    # разделы «Настроек» и ИИ-помощник (необязательные зависимости HypeDE)
    plasma-nm plasma-pa bluedevil bluez kde-cli-tools kinfocenter plasma-desktop
    power-profiles-daemon webkitgtk-6.0
    # VirtualBox: общий буфер обмена, подстройка экрана
    virtualbox-guest-utils
    # сеть и разработка
    networkmanager openssh git base-devel
    hypede-git
)

# В контейнере Docker песочница pacman (Landlock) недоступна.
[[ -f /.dockerenv ]] && ! grep -q '^DisableSandbox' /etc/pacman.conf &&
    sed -i '/^\[options\]/a DisableSandbox' /etc/pacman.conf
pacman-key --init >/dev/null
pacman-key --populate >/dev/null
pacman -Sy --noconfirm --needed archiso grub

rm -rf "$work"
mkdir -p "$work" "$out"
cp -r /usr/share/archiso/configs/baseline "$profile"

# Пакеты: baseline (base, гостевые агенты) плюс наши.
printf '%s\n' "${PACKAGES[@]}" >> "$profile/packages.x86_64"
# Консольный вариант гостевых утилит VirtualBox заменяем полным.
sed -i '/^virtualbox-guest-utils-nox$/d; /^cloud-init$/d' "$profile/packages.x86_64"

# Сборка берёт HypeDE из локального репозитория, а в систему кладём адрес
# опубликованного — так HypeDE обновляется вместе с системой.
sed -i '/^\[core\]/i [hypede]\nSigLevel = Optional TrustAll\nServer = file://'"$repo"'\n' "$profile/pacman.conf"
mkdir -p "$profile/airootfs/etc"
sed '/^\[core\]/i [hypede]\nSigLevel = Optional TrustAll\nServer = https://github.com/hypede/hypede/releases/download/repo-$arch\n' \
    /etc/pacman.conf | sed '/^DisableSandbox/d' > "$profile/airootfs/etc/pacman.conf"

# Сеть в baseline — systemd-networkd, у рабочего стола — NetworkManager.
# cloud-init не нужен, SSH живому образу тоже: у root там пустой пароль.
a=$profile/airootfs
rm -rf "$a/etc/systemd/system/cloud-init.target.wants" "$a/etc/systemd/network" \
    "$a/etc/systemd/networkd.conf.d" "$a/etc/systemd/resolved.conf.d" \
    "$a/etc/systemd/system/network-online.target.wants" "$a/etc/systemd/system/sockets.target.wants" \
    "$a/etc/systemd/system/systemd-networkd-wait-online.service.d" "$a/etc/ssh/sshd_config.d/10-archiso.conf"
rm -f "$a"/etc/systemd/system/multi-user.target.wants/{systemd-networkd,systemd-resolved,sshd}.service
# Его включает и сам пакет systemd — маскируем, чтобы не спорил с NetworkManager.
ln -s /dev/null "$a/etc/systemd/system/systemd-networkd.service"
ln -s /dev/null "$a/etc/systemd/system/systemd-networkd.socket"
cp -r "$here/airootfs/." "$a/"
ln -s /usr/lib/systemd/system/graphical.target "$a/etc/systemd/system/default.target"
ln -s /usr/lib/systemd/system/gdm.service "$a/etc/systemd/system/display-manager.service"
for unit in /usr/lib/systemd/system/NetworkManager.service /etc/systemd/system/hypede-live.service; do
    ln -s "$unit" "$a/etc/systemd/system/multi-user.target.wants/"
done

# Имя образа и пункты меню загрузки.
sed -i 's/^iso_name=.*/iso_name="hypede"/;
        s/^iso_label=.*/iso_label="HYPEDE_$(date --date="@${SOURCE_DATE_EPOCH:-$(date +%s)}" +%Y%m)"/;
        s|^iso_publisher=.*|iso_publisher="HypeDE <https://hypede.xyz>"|;
        s/^iso_application=.*/iso_application="HypeDE Live"/' "$profile/profiledef.sh"
sed -i '/^file_permissions=(/a\  ["/usr/local/bin/hypede-install"]="0:0:755"\n  ["/usr/local/bin/hypede-live-setup"]="0:0:755"' "$profile/profiledef.sh"
sed -i 's/Arch Linux (/HypeDE (/; s/^timeout=.*/timeout=3/' "$profile/grub/grub.cfg"
sed -i 's/Arch Linux (/HypeDE (/' "$profile/syslinux/syslinux-linux.cfg" "$profile/efiboot/loader/entries/01-archiso-linux.conf"
sed -i 's/^TIMEOUT .*/TIMEOUT 30/' "$profile/syslinux/syslinux.cfg"
sed -i 's/^timeout .*/timeout 3/' "$profile/efiboot/loader/loader.conf"

mkarchiso -v -w "$work/work" -o "$out" "$profile"
rm -rf "$work"
ls -lh "$out"
