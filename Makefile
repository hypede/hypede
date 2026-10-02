# HypeDE — сборка и установка.
#
#   make                 собрать «Настройки» (C++/Qt), hypede-auth и переводы
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

SYSCONFDIR ?= /etc
CC      ?= cc
CFLAGS  ?= -O2

DATADIR   := $(PREFIX)/share
BINDIR    := $(PREFIX)/bin
LIBDIR    := $(PREFIX)/lib
LIBEXECDIR := $(LIBDIR)/hypede
UUID      := hypede-shell@hypede.dev
# Оболочка HypeDE лежит в собственном каталоге данных: hypede-session
# добавляет его в XDG_DATA_DIRS только для сеанса HypeDE, поэтому обычный
# GNOME не видит ни режима hypede, ни компонентов оболочки.
SHELLDATADIR := $(DATADIR)/hypede/shell
EXTDIR    := $(SHELLDATADIR)/gnome-shell/extensions/$(UUID)
MODESDIR  := $(SHELLDATADIR)/gnome-shell/modes
FILESDIR  := $(DATADIR)/hypede/files
ASSISTANTDIR := $(DATADIR)/hypede/assistant
THEMEDIR  := $(DATADIR)/hypede/theme
DESKTOPDIR := $(DATADIR)/hypede/desktop
SYSTEMDUSERDIR := $(LIBDIR)/systemd/user

# Подстановка путей в файлы сеанса
SUBST = sed -e 's|@LIBEXECDIR@|$(LIBEXECDIR)|g' -e 's|@SHELLDATADIR@|$(SHELLDATADIR)|g'

INSTALL      ?= install
INSTALL_DATA := $(INSTALL) -m644

EXT_FILES := $(wildcard shell/extension/$(UUID)/*.js) \
             $(wildcard shell/extension/$(UUID)/*.css) \
             shell/extension/$(UUID)/metadata.json
FILES_PY  := $(wildcard apps/files/hypede_files/*.py) apps/files/hypede_files/style.css
ASSISTANT_PY := $(wildcard apps/assistant/hypede_assistant/*.py)
DESKTOP_PY := $(wildcard apps/desktop/hypede_desktop/*.py)
WALLPAPERS := $(wildcard assets/wallpapers/*.svg) $(wildcard assets/wallpapers/*.png)

.PHONY: all settings auth mo css pot check install install-shell install-session install-data \
        install-files install-assistant install-theme install-desktop install-settings install-user uninstall-user clean

all: settings auth mo

# ---------- сборка ----------

settings:
	cmake -S apps/settings -B '$(BUILD)/settings' -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX='$(PREFIX)'
	@echo "Сборка «Настроек», одновременных заданий: $(JOBS)"
	cmake --build '$(BUILD)/settings' --parallel $(JOBS)

# Проверка пароля для экрана блокировки без GDM (см. session/hypede-auth.c).
auth: $(BUILD)/hypede-auth

$(BUILD)/hypede-auth: session/hypede-auth.c
	mkdir -p '$(BUILD)'
	$(CC) $(CFLAGS) $(CPPFLAGS) $(LDFLAGS) -Wall -o '$@' session/hypede-auth.c -lpam

mo:
	mkdir -p '$(BUILD)/locale/ru/LC_MESSAGES'
	msgfmt --check -o '$(BUILD)/locale/ru/LC_MESSAGES/hypede.mo' po/ru.po

# Стили оболочки генерируются из шаблона (результат лежит в репозитории,
# чтобы расширение можно было поставить и без сборки).
css:
	python3 tools/gen-shell-css.py

pot:
	xgettext --from-code=UTF-8 -L Python -k_ -kngettext:1,2 -o '$(BUILD)/files.pot' apps/files/hypede_files/*.py apps/assistant/hypede_assistant/*.py apps/desktop/hypede_desktop/*.py
	xgettext --from-code=UTF-8 -L JavaScript -k_ -kngettext:1,2 -o '$(BUILD)/shell.pot' shell/extension/$(UUID)/*.js
	msgcat '$(BUILD)/files.pot' '$(BUILD)/shell.pot' -o po/hypede.pot
	python3 tools/i18n/make-po.py

check:
	for f in shell/extension/$(UUID)/*.js; do node --check --input-type=module < $$f || exit 1; done
	python3 -m py_compile apps/files/hypede_files/*.py apps/assistant/hypede_assistant/*.py apps/theme/hypede_theme.py apps/desktop/hypede_desktop/*.py
	python3 -m unittest discover -s apps/theme/tests -t apps/theme
	python3 -m unittest discover -s apps/files/tests -t apps/files
	node shell/tests/calculator.test.mjs
	glib-compile-schemas --strict --dry-run data/schemas
	sh -n session/hypede-session.in && sh -n session/hypede-session-cleanup.in && sh -n session/hypede-autostart-filter && sh -n session/hypede-admin
	msgfmt --check -o /dev/null po/ru.po

# ---------- установка ----------

install: install-shell install-session install-data install-files install-assistant install-theme install-desktop install-settings

install-shell:
	$(INSTALL) -d '$(DESTDIR)$(EXTDIR)'
	$(INSTALL_DATA) $(EXT_FILES) '$(DESTDIR)$(EXTDIR)'/
	$(INSTALL) -Dm644 shell/modes/hypede.json '$(DESTDIR)$(MODESDIR)'/hypede.json

install-session: auth
	mkdir -p '$(BUILD)/session'
	$(SUBST) session/hypede.desktop > '$(BUILD)/session/hypede.desktop'
	$(SUBST) session/hypede-session.in > '$(BUILD)/session/hypede-session'
	$(SUBST) session/hypede-session-cleanup.in > '$(BUILD)/session/hypede-session-cleanup'
	$(SUBST) session/systemd/hypede-session.service > '$(BUILD)/session/hypede-session.service'
	$(SUBST) session/systemd/autostart-filter.conf > '$(BUILD)/session/autostart-filter.conf'
	$(INSTALL) -Dm644 '$(BUILD)/session/hypede.desktop' '$(DESTDIR)$(DATADIR)'/wayland-sessions/hypede.desktop
	$(INSTALL) -Dm644 session/hypede.session '$(DESTDIR)$(DATADIR)'/gnome-session/sessions/hypede.session
	$(INSTALL) -Dm755 '$(BUILD)/session/hypede-session' '$(DESTDIR)$(LIBEXECDIR)'/hypede-session
	$(INSTALL) -Dm755 '$(BUILD)/session/hypede-session-cleanup' '$(DESTDIR)$(LIBEXECDIR)'/hypede-session-cleanup
	$(INSTALL) -Dm755 session/hypede-autostart-filter '$(DESTDIR)$(LIBEXECDIR)'/hypede-autostart-filter
	$(INSTALL) -Dm755 '$(BUILD)/hypede-auth' '$(DESTDIR)$(LIBEXECDIR)'/hypede-auth
	$(INSTALL) -Dm755 session/hypede-admin '$(DESTDIR)$(LIBEXECDIR)'/hypede-admin
	$(INSTALL) -Dm644 session/dev.hypede.admin.policy '$(DESTDIR)$(DATADIR)'/polkit-1/actions/dev.hypede.admin.policy
	$(INSTALL) -Dm644 session/pam-hypede '$(DESTDIR)$(SYSCONFDIR)'/pam.d/hypede
	$(INSTALL) -Dm644 session/dconf-profile '$(DESTDIR)$(DATADIR)'/dconf/profile/hypede
	$(INSTALL) -Dm644 session/systemd/hypede.session.conf \
		'$(DESTDIR)$(SYSTEMDUSERDIR)'/gnome-session@hypede.target.d/hypede.session.conf
	$(INSTALL) -Dm644 '$(BUILD)/session/hypede-session.service' '$(DESTDIR)$(SYSTEMDUSERDIR)'/hypede-session.service
	$(INSTALL) -Dm644 '$(BUILD)/session/autostart-filter.conf' \
		'$(DESTDIR)$(SYSTEMDUSERDIR)'/app-.service.d/hypede-autostart-filter.conf

install-data: mo
	$(INSTALL) -Dm644 data/schemas/dev.hypede.shell.gschema.xml \
		'$(DESTDIR)$(DATADIR)'/glib-2.0/schemas/dev.hypede.shell.gschema.xml
	$(INSTALL) -Dm644 data/schemas/90_hypede.gschema.override \
		'$(DESTDIR)$(DATADIR)'/glib-2.0/schemas/90_hypede.gschema.override
	$(INSTALL) -d '$(DESTDIR)$(DATADIR)'/hypede/wallpapers
	$(INSTALL_DATA) $(WALLPAPERS) '$(DESTDIR)$(DATADIR)'/hypede/wallpapers/
	$(INSTALL) -d '$(DESTDIR)$(DATADIR)'/hypede/live
	$(INSTALL_DATA) data/live/*.jpg '$(DESTDIR)$(DATADIR)'/hypede/live/
	$(INSTALL) -d '$(DESTDIR)$(DATADIR)'/plymouth/themes/hypede
	$(INSTALL_DATA) data/plymouth/hypede/* '$(DESTDIR)$(DATADIR)'/plymouth/themes/hypede/
	$(INSTALL) -Dm644 data/backgrounds/hypede.xml '$(DESTDIR)$(DATADIR)'/gnome-background-properties/hypede.xml
	$(INSTALL) -Dm644 data/applications/dev.hypede.Files.desktop '$(DESTDIR)$(DATADIR)'/applications/dev.hypede.Files.desktop
	$(INSTALL) -Dm644 data/applications/dev.hypede.Settings.desktop '$(DESTDIR)$(DATADIR)'/applications/dev.hypede.Settings.desktop
	cd assets/icons && find hicolor -type f \( -name '*.svg' -o -name '*.png' \) ! -name 'dev.hypede.Launcher*' -exec \
		$(INSTALL) -Dm644 '{}' '$(DESTDIR)$(DATADIR)/icons/{}' ';'
	$(INSTALL) -d '$(DESTDIR)$(DATADIR)'/icons/HypeDE/symbolic
	$(INSTALL_DATA) data/icons/HypeDE/index.theme data/icons/HypeDE/LICENSE '$(DESTDIR)$(DATADIR)'/icons/HypeDE/
	$(INSTALL_DATA) data/icons/HypeDE/symbolic/*.svg '$(DESTDIR)$(DATADIR)'/icons/HypeDE/symbolic/
	$(INSTALL) -d '$(DESTDIR)$(DATADIR)'/sounds/hypede/stereo
	$(INSTALL_DATA) data/sounds/hypede/index.theme '$(DESTDIR)$(DATADIR)'/sounds/hypede/
	$(INSTALL_DATA) data/sounds/hypede/stereo/*.oga '$(DESTDIR)$(DATADIR)'/sounds/hypede/stereo/
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

# ИИ-помощник: встроенный браузер (WebKitGTK) с чатом провайдера.
install-assistant:
	$(INSTALL) -d '$(DESTDIR)$(ASSISTANTDIR)'/hypede_assistant
	$(INSTALL_DATA) $(ASSISTANT_PY) '$(DESTDIR)$(ASSISTANTDIR)'/hypede_assistant/
	mkdir -p '$(BUILD)'
	printf '%s\n' '#!/usr/bin/env python3' \
		'# ИИ-помощник HypeDE' \
		'import sys' \
		'sys.path.insert(0, "$(ASSISTANTDIR)")' \
		'from hypede_assistant.app import main' \
		'sys.exit(main())' > '$(BUILD)/hypede-assistant'
	$(INSTALL) -Dm755 '$(BUILD)/hypede-assistant' '$(DESTDIR)$(BINDIR)'/hypede-assistant
	$(INSTALL) -Dm644 data/applications/dev.hypede.Assistant.desktop '$(DESTDIR)$(DATADIR)'/applications/dev.hypede.Assistant.desktop

# Темы: hypede-theme (применить, сохранить, импорт и экспорт) и встроенные темы.
install-theme:
	$(INSTALL) -Dm644 apps/theme/hypede_theme.py '$(DESTDIR)$(THEMEDIR)'/hypede_theme.py
	$(INSTALL) -d '$(DESTDIR)$(DATADIR)'/hypede/themes
	$(INSTALL_DATA) data/themes/*.json '$(DESTDIR)$(DATADIR)'/hypede/themes/
	mkdir -p '$(BUILD)'
	printf '%s\n' '#!/usr/bin/env python3' \
		'# Темы HypeDE' \
		'import sys' \
		'sys.path.insert(0, "$(THEMEDIR)")' \
		'from hypede_theme import main' \
		'sys.exit(main())' > '$(BUILD)/hypede-theme'
	$(INSTALL) -Dm755 '$(BUILD)/hypede-theme' '$(DESTDIR)$(BINDIR)'/hypede-theme

# Рабочий стол: значки и живые обои из файла. Пользуется модулями «Файлов».
install-desktop:
	$(INSTALL) -d '$(DESTDIR)$(DESKTOPDIR)'/hypede_desktop
	$(INSTALL_DATA) $(DESKTOP_PY) '$(DESTDIR)$(DESKTOPDIR)'/hypede_desktop/
	mkdir -p '$(BUILD)'
	printf '%s\n' '#!/usr/bin/env python3' \
		'# Рабочий стол HypeDE' \
		'import sys' \
		'sys.path[:0] = ["$(DESKTOPDIR)", "$(FILESDIR)"]' \
		'from hypede_desktop.app import main' \
		'sys.exit(main())' > '$(BUILD)/hypede-desktop'
	$(INSTALL) -Dm755 '$(BUILD)/hypede-desktop' '$(DESTDIR)$(BINDIR)'/hypede-desktop

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
