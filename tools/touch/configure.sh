#!/bin/bash
# Настройка HypeDE Touch внутри chroot (вызывает build-image.sh).
#
# Пользователь hypede с паролем hypede входит сам (сменить: passwd).
# Режим планшета включён, общая папка UTM (VirtFS, метка share) видна в
# /mnt/share.
set -euo pipefail

echo hypede-touch > /etc/hostname
ln -sf /usr/share/zoneinfo/UTC /etc/localtime
sed -i 's/^#\(en_US.UTF-8\|ru_RU.UTF-8\)/\1/' /etc/locale.gen
locale-gen >/dev/null
echo LANG=en_US.UTF-8 > /etc/locale.conf

cat > /etc/fstab <<'FSTAB'
LABEL=hypede-root  /           ext4  rw,relatime                                    0 1
LABEL=HYPEDE-ESP   /boot       vfat  rw,relatime,fmask=0077,dmask=0077              0 2
# Общая папка UTM («Общий доступ → VirtFS»)
share              /mnt/share  9p    trans=virtio,version=9p2000.L,rw,nofail,x-systemd.automount  0 0
FSTAB
mkdir -p /mnt/share

# initramfs без autodetect: он подобрал бы модули под машину сборки,
# а не под виртуальную.
sed -i 's/^MODULES=.*/MODULES=(virtio_pci virtio_blk virtio_net virtio_gpu virtio_input 9p 9pnet_virtio)/;
        s/ autodetect / /' /etc/mkinitcpio.conf
mkinitcpio -P

useradd -m -G wheel -c 'HypeDE' -s /bin/bash hypede
echo hypede:hypede | chpasswd
passwd -l root >/dev/null
echo '%wheel ALL=(ALL:ALL) ALL' > /etc/sudoers.d/wheel
chmod 440 /etc/sudoers.d/wheel

# Вход без пароля прямо в сеанс HypeDE.
cat > /etc/gdm/custom.conf <<'GDM'
[daemon]
AutomaticLoginEnable=True
AutomaticLogin=hypede
GDM
mkdir -p /var/lib/AccountsService/users
printf '[User]\nSession=hypede\nSystemAccount=false\n' > /var/lib/AccountsService/users/hypede

# HypeDE Touch — сразу в режиме планшета (выключается в быстрых настройках).
cat > /usr/share/glib-2.0/schemas/95_hypede-touch.gschema.override <<'OVERRIDE'
[dev.hypede.shell]
tablet-mode='on'
OVERRIDE
glib-compile-schemas /usr/share/glib-2.0/schemas

systemctl enable gdm NetworkManager sshd systemd-timesyncd
