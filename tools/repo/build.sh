#!/bin/bash
# Собирает пакет HypeDE и pacman-репозиторий «hypede» из него.
#
#   tools/repo/build.sh [каталог-репозитория]
#
# Запускается от root внутри Arch Linux или Arch Linux ARM (так делает
# .github/workflows/repo.yml) из корня исходников. Архитектура — та, на
# которой идёт сборка: x86_64 или aarch64. Если в REPO_GPG_KEY лежит
# закрытый ключ (armored), пакет и база репозитория подписываются им.
set -euo pipefail

out=$(realpath -m "${1:-repo}")
src=$(pwd)

# В контейнере Docker песочница pacman (Landlock) недоступна.
[[ -f /.dockerenv ]] && ! grep -q '^DisableSandbox' /etc/pacman.conf &&
    sed -i '/^\[options\]/a DisableSandbox' /etc/pacman.conf
pacman-key --init >/dev/null
pacman-key --populate >/dev/null
pacman -Syu --noconfirm --needed base-devel git sudo

id builder >/dev/null 2>&1 || useradd -m builder
echo 'builder ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/builder
chown -R builder "$src"
mkdir -p "$out"
chown builder "$out"
as_builder() { sudo -u builder -H "$@"; }
as_builder git config --global --add safe.directory '*'

sign=()
if [[ -n ${REPO_GPG_KEY:-} ]]; then
    as_builder gpg --batch --import <<<"$REPO_GPG_KEY"
    key=$(as_builder gpg --batch --list-secret-keys --with-colons | awk -F: '/^fpr/ { print $10; exit }')
    sign=(--sign --key "$key")
fi

cd "$src/packaging"
as_builder env PKGDEST="$out" makepkg --syncdeps --noconfirm --cleanbuild "${sign[@]}"

cd "$out"
as_builder repo-add "${sign[@]}" --remove hypede.db.tar.gz ./*.pkg.tar.zst
# В релиз GitHub симлинки не загрузить: pacman спрашивает hypede.db и
# hypede.files, поэтому кладём под этими именами сами архивы.
for name in hypede.db hypede.files; do
    for ext in "" .sig; do
        [[ -L $name$ext ]] && cp --remove-destination "$(readlink -f "$name$ext")" "$name$ext"
    done
done
rm -f ./*.tar.gz ./*.tar.gz.sig ./*.old ./*.old.sig
ls -l
