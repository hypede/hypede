# HypeDE — сборка и установка.
#
#   make                 собрать «Настройки» (C++/Qt) и переводы
#   sudo make install    установить всё в /usr
#   make install-user    поставить только оболочку в ~/.local (для пробы
#                        в обычном сеансе GNOME, без sudo)
#   make pot             обновить шаблон переводов po/hypede.pot
#   make check           проверки: синтаксис JS/Python, тесты «Файлов»
#
# Переменные: PREFIX (по умолчанию /usr), DESTDIR (для пакетов), BUILD.
# Все пути в командах взяты в кавычки: каталог может называться как угодно,
# например «devHypeDE(1)» или «Мои проекты».

PREFIX  ?= /usr
DESTDIR ?=
BUILD   ?= build

# Сколько файлов компилировать одновременно. Каждый компилятор с заголовками
# Qt и KDE занимает ~400 МБ, поэтому считаем от свободной памяти (по 700 МБ
# на задание с запасом), но не больше числа ядер. Переопределить: make JOBS=2
JOBS ?= $(shell awk -v cpus="$$(nproc 2>/dev/null || echo 1)" \
	'/^MemAvailable:/ { j = int($$2 / 700000); if (j > cpus) j = cpus; if (j < 1) j = 1; print j }' \
	/proc/meminfo 2>/dev/null || echo 1)

DATADIR   := $(PREFIX)/share
BINDIR    := $(PREFIX)/bin
LIBDIR    := $(PREFIX)/lib
UUID      := hypede-shell@hypede.dev
EXTDIR    := $(DATADIR)/gnome-shell/extensions/$(UUID)
FILESDIR  := $(DATADIR)/hypede/files

INSTALL      ?= install
INSTALL_DATA := $(INSTALL) -m644

EXT_FILES := $(wildcard shell/extension/$(UUID)/*.js) \
             $(wildcard shell/extension/$(UUID)/*.css) \
             shell/extension/$(UUID)/metadata.json
FILES_PY  := $(wildcard apps/files/hypede_files/*.py) apps/files/hypede_files/style.css
WALLPAPERS := $(wildcard assets/wallpapers/*.svg) $(wildcard assets/wallpapers/*.png)

.PHONY: all settings mo css pot check install install-shell install-session install-data \
        install-files install-settings install-user uninstall-user clean

all: settings mo

# ---------- сборка ----------

settings:
	cmake -S apps/settings -B '$(BUILD)/settings' -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX='$(PREFIX)'
	@echo "Сборка «Настроек», одновременных заданий: $(JOBS)"
	cmake --build '$(BUILD)/settings' --parallel $(JOBS)

mo:
	mkdir -p '$(BUILD)/locale/ru/LC_MESSAGES'
	msgfmt --check -o '$(BUILD)/locale/ru/LC_MESSAGES/hypede.mo' po/ru.po

# Стили оболочки генерируются из шаблона (результат лежит в репозитории,
# чтобы расширение можно было поставить и без сборки).
css:
	python3 tools/gen-shell-css.py

pot:
	xgettext --from-code=UTF-8 -L Python -k_ -kngettext:1,2 -o '$(BUILD)/files.pot' apps/files/hypede_files/*.py
	xgettext --from-code=UTF-8 -L JavaScript -k_ -kngettext:1,2 -o '$(BUILD)/shell.pot' shell/extension/$(UUID)/*.js
	msgcat '$(BUILD)/files.pot' '$(BUILD)/shell.pot' -o po/hypede.pot
	python3 tools/i18n/make-po.py

check:
	for f in shell/extension/$(UUID)/*.js; do node --check --input-type=module < $$f || exit 1; done
	python3 -m py_compile apps/files/hypede_files/*.py
	python3 -m unittest discover -s apps/files/tests -t apps/files
	node shell/tests/calculator.test.mjs
	glib-compile-schemas --strict --dry-run data/schemas
	msgfmt --check -o /dev/null po/ru.po

# ---------- установка ----------

install: install-shell install-session install-data install-files install-settings

install-shell:
	$(INSTALL) -d '$(DESTDIR)$(EXTDIR)'
	$(INSTALL_DATA) $(EXT_FILES) '$(DESTDIR)$(EXTDIR)'/
	$(INSTALL) -Dm644 shell/modes/hypede.json '$(DESTDIR)$(DATADIR)'/gnome-shell/modes/hypede.json

install-session:
	$(INSTALL) -Dm644 session/hypede.desktop '$(DESTDIR)$(DATADIR)'/wayland-sessions/hypede.desktop
	$(INSTALL) -Dm644 session/hypede.session '$(DESTDIR)$(DATADIR)'/gnome-session/sessions/hypede.session
	$(INSTALL) -Dm644 session/gnome-session@hypede.target.d/hypede.session.conf \
		'$(DESTDIR)$(LIBDIR)'/systemd/user/gnome-session@hypede.target.d/hypede.session.conf

install-data: mo
	$(INSTALL) -Dm644 data/schemas/dev.hypede.shell.gschema.xml \
		'$(DESTDIR)$(DATADIR)'/glib-2.0/schemas/dev.hypede.shell.gschema.xml
	$(INSTALL) -Dm644 data/schemas/90_hypede.gschema.override \
		'$(DESTDIR)$(DATADIR)'/glib-2.0/schemas/90_hypede.gschema.override
	$(INSTALL) -d '$(DESTDIR)$(DATADIR)'/hypede/wallpapers
	$(INSTALL_DATA) $(WALLPAPERS) '$(DESTDIR)$(DATADIR)'/hypede/wallpapers/
	$(INSTALL) -Dm644 data/backgrounds/hypede.xml '$(DESTDIR)$(DATADIR)'/gnome-background-properties/hypede.xml
	$(INSTALL) -Dm644 data/applications/dev.hypede.Files.desktop '$(DESTDIR)$(DATADIR)'/applications/dev.hypede.Files.desktop
	$(INSTALL) -Dm644 data/applications/dev.hypede.Settings.desktop '$(DESTDIR)$(DATADIR)'/applications/dev.hypede.Settings.desktop
	cd assets/icons && find hicolor -type f \( -name '*.svg' -o -name '*.png' \) ! -name 'dev.hypede.Launcher*' -exec \
		$(INSTALL) -Dm644 '{}' '$(DESTDIR)$(DATADIR)/icons/{}' ';'
	$(INSTALL) -Dm644 branding/hypede-logo.svg '$(DESTDIR)$(DATADIR)'/icons/hicolor/scalable/apps/hypede.svg
	$(INSTALL) -Dm644 branding/hypede-symbolic.svg '$(DESTDIR)$(DATADIR)'/icons/hicolor/symbolic/apps/hypede-symbolic.svg
	$(INSTALL) -Dm644 '$(BUILD)/locale/ru/LC_MESSAGES/hypede.mo' '$(DESTDIR)$(DATADIR)'/locale/ru/LC_MESSAGES/hypede.mo

install-files:
	$(INSTALL) -d '$(DESTDIR)$(FILESDIR)'/hypede_files
	$(INSTALL_DATA) $(FILES_PY) '$(DESTDIR)$(FILESDIR)'/hypede_files/
	mkdir -p '$(BUILD)'
	printf '%s\n' '#!/usr/bin/env python3' \
		'# «Файлы» HypeDE' \
		'import sys' \
		'sys.path.insert(0, "$(FILESDIR)")' \
		'from hypede_files.application import main' \
		'sys.exit(main())' > '$(BUILD)/hypede-files'
	$(INSTALL) -Dm755 '$(BUILD)/hypede-files' '$(DESTDIR)$(BINDIR)'/hypede-files

install-settings:
	DESTDIR='$(DESTDIR)' cmake --install '$(BUILD)/settings'

# Только оболочка — в домашний каталог. Сеанс HypeDE так не появится
# (для него нужны системные файлы), но расширение можно включить в
# обычном GNOME: gnome-extensions enable hypede-shell@hypede.dev
install-user:
	$(INSTALL) -d '$(HOME)/.local/share/gnome-shell/extensions/$(UUID)'/schemas
	$(INSTALL_DATA) $(EXT_FILES) '$(HOME)/.local/share/gnome-shell/extensions/$(UUID)'/
	$(INSTALL_DATA) data/schemas/dev.hypede.shell.gschema.xml '$(HOME)/.local/share/gnome-shell/extensions/$(UUID)'/schemas/
	glib-compile-schemas '$(HOME)/.local/share/gnome-shell/extensions/$(UUID)'/schemas/
	@echo "Готово. Перезайдите в сеанс и выполните: gnome-extensions enable $(UUID)"

uninstall-user:
	rm -rf '$(HOME)/.local/share/gnome-shell/extensions/$(UUID)'

clean:
	rm -rf '$(BUILD)'
