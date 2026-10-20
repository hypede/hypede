"""«Пароли» HypeDE — связки ключей и сохранённые пароли.

Работает со стандартом freedesktop Secret Service через libsecret, поэтому
показывает те же связки, что GNOME Keyring (и Seahorse), KeePassXC с
включённой интеграцией Secret Service или KWallet: программа ничего не хранит
сама. Пароль от связки спрашивает сама служба (в HypeDE — окно оболочки).

    hypede-passwords
"""

from __future__ import annotations

import gettext
import locale
import os
import sys

import gi

if "HypeDE" in os.environ.get("XDG_CURRENT_DESKTOP", "").split(":"):
    os.environ["DCONF_PROFILE"] = "hypede"

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
gi.require_version("Gdk", "4.0")
gi.require_version("Secret", "1")

from gi.repository import Adw, Gdk, Gio, GLib, Gtk, Secret  # noqa: E402

from . import __version__  # noqa: E402

APP_ID = "dev.hypede.Passwords"
_ = gettext.gettext


def N_(text: str) -> str:
    """Пометить строку для перевода; переводится при показе."""
    return text


_DATA_DIR = os.path.dirname(os.path.abspath(__file__))
# Скопированный пароль стирается из буфера обмена через столько секунд.
CLIPBOARD_SECONDS = 45

# Понятные названия частых схем: по ним видно, чей это пароль.
SCHEMAS = {
    "org.gnome.keyring.NetworkPassword": N_("Network password"),
    "org.freedesktop.NetworkManager.connection": N_("Wi‑Fi or VPN"),
    "org.gnome.Epiphany.FormPassword": N_("Website"),
    "org.gnome.OnlineAccounts": N_("Online account"),
    "org.gnome.keyring.Note": N_("Note"),
    "org.freedesktop.Secret.Generic": N_("Password"),
    "chrome_libsecret_os_crypt_password_v2": N_("Browser encryption key"),
    "chrome_libsecret_os_crypt_password_v1": N_("Browser encryption key"),
    "org.gnome.RemoteDesktop.RdpCredentials": N_("Remote desktop"),
}


def _setup_i18n() -> None:
    marker = os.sep + os.path.join("share", "hypede", "passwords")
    prefix = _DATA_DIR.split(marker)[0] if marker in _DATA_DIR else "/usr"
    try:
        locale.setlocale(locale.LC_ALL, "")
    except locale.Error:
        pass
    gettext.bindtextdomain("hypede", os.environ.get("HYPEDE_LOCALEDIR", os.path.join(prefix, "share", "locale")))
    gettext.textdomain("hypede")


def describe(item: Secret.Item) -> str:
    """Подпись записи: кто и где (пользователь, сервер, сайт), иначе — тип."""
    attrs = item.get_attributes() or {}
    user = attrs.get("username") or attrs.get("user") or attrs.get("username_value") or attrs.get("account") or ""
    place = (attrs.get("server") or attrs.get("url") or attrs.get("origin_url") or attrs.get("uri")
             or attrs.get("domain") or attrs.get("service") or attrs.get("id") or "")
    if user and place:
        return f"{user} · {place}"
    if user or place:
        return user or place
    schema = attrs.get("xdg:schema", "")
    return _(SCHEMAS[schema]) if schema in SCHEMAS else schema


class ItemDialog(Adw.Dialog):
    """Запись: название, пароль (показать, скопировать, изменить), атрибуты."""

    def __init__(self, window: "Window", item: Secret.Item | None, collection: Secret.Collection):
        super().__init__(title=_("Password") if item else _("New password"), content_width=460)
        self.window = window
        self.item = item
        self.collection = collection

        view = Adw.ToolbarView()
        header = Adw.HeaderBar(show_end_title_buttons=False, show_start_title_buttons=False)
        cancel = Gtk.Button(label=_("Cancel"))
        cancel.connect("clicked", lambda *_: self.close())
        header.pack_start(cancel)
        save = Gtk.Button(label=_("Save"), css_classes=["suggested-action"])
        save.connect("clicked", self._save)
        header.pack_end(save)
        view.add_top_bar(header)

        page = Adw.PreferencesPage()
        group = Adw.PreferencesGroup()
        self.label = Adw.EntryRow(title=_("Name"), text=item.get_label() if item else "")
        group.add(self.label)
        if not item:
            self.user = Adw.EntryRow(title=_("User name"))
            self.place = Adw.EntryRow(title=_("Website or server"))
            group.add(self.user)
            group.add(self.place)
        self.secret = Adw.PasswordEntryRow(title=_("Password"))
        if item:
            value = item.get_secret()
            if value is not None:
                self.secret.set_text(value.get_text() or "")
        copy = Gtk.Button(icon_name="edit-copy-symbolic", valign=Gtk.Align.CENTER, tooltip_text=_("Copy"),
                          css_classes=["flat"])
        copy.connect("clicked", lambda *_: window.copy_secret(self.secret.get_text()))
        self.secret.add_suffix(copy)
        group.add(self.secret)
        page.add(group)

        if item:
            attrs = item.get_attributes() or {}
            details = Adw.PreferencesGroup(title=_("Details"))
            for key in sorted(attrs):
                row = Adw.ActionRow(title=key, subtitle=attrs[key], subtitle_selectable=True)
                row.add_css_class("property")
                details.add(row)
            created = GLib.DateTime.new_from_unix_local(item.get_created()).format("%x %X")
            details.add(Adw.ActionRow(title=_("Created"), subtitle=created, css_classes=["property"]))
            page.add(details)

            danger = Adw.PreferencesGroup()
            delete = Adw.ButtonRow(title=_("Delete password"), css_classes=["destructive-action"])
            delete.connect("activated", self._delete)
            danger.add(delete)
            page.add(danger)

        view.set_content(page)
        self.set_child(view)

    def _save(self, *_args):
        text = self.secret.get_text()
        label = self.label.get_text().strip() or _("Password")
        value = Secret.Value.new(text, -1, "text/plain")
        try:
            if self.item:
                if label != self.item.get_label():
                    self.item.set_label_sync(label, None)
                old = self.item.get_secret()
                if old is None or old.get_text() != text:
                    self.item.set_secret_sync(value, None)
            else:
                attrs = {"xdg:schema": "org.freedesktop.Secret.Generic"}
                if self.user.get_text().strip():
                    attrs["username"] = self.user.get_text().strip()
                if self.place.get_text().strip():
                    attrs["url"] = self.place.get_text().strip()
                Secret.Item.create_sync(self.collection, None, attrs, label, value,
                                        Secret.ItemCreateFlags.NONE, None)
        except GLib.Error as error:
            self.window.toast(error.message)
            return
        self.close()
        self.window.reload_items()

    def _delete(self, *_args):
        dialog = Adw.AlertDialog(heading=_("Delete “%s”?") % self.item.get_label(),
                                 body=_("Apps that use this password will ask for it again."))
        dialog.add_response("cancel", _("Cancel"))
        dialog.add_response("delete", _("Delete"))
        dialog.set_response_appearance("delete", Adw.ResponseAppearance.DESTRUCTIVE)

        def answered(_dialog, response):
            if response != "delete":
                return
            try:
                self.item.delete_sync(None)
            except GLib.Error as error:
                self.window.toast(error.message)
                return
            self.close()
            self.window.reload_items()

        dialog.connect("response", answered)
        dialog.present(self)


class Window(Adw.ApplicationWindow):
    def __init__(self, app: Adw.Application):
        super().__init__(application=app, title=_("Passwords"), default_width=920, default_height=640)
        self.service: Secret.Service | None = None
        self.collection: Secret.Collection | None = None
        self.items: list[Secret.Item] = []
        self._clipboard_id = 0

        self.toasts = Adw.ToastOverlay()
        self.split = Adw.NavigationSplitView(min_sidebar_width=240, max_sidebar_width=300)
        self.toasts.set_child(self.split)
        self.set_content(self.toasts)

        # Слева — связки ключей.
        sidebar = Adw.ToolbarView()
        side_header = Adw.HeaderBar()
        add_keyring = Gtk.Button(icon_name="list-add-symbolic", tooltip_text=_("New keyring"))
        add_keyring.connect("clicked", self._new_keyring)
        side_header.pack_start(add_keyring)
        sidebar.add_top_bar(side_header)
        self.keyrings = Gtk.ListBox(css_classes=["navigation-sidebar"])
        self.keyrings.connect("row-selected", self._keyring_selected)
        sidebar.set_content(Gtk.ScrolledWindow(child=self.keyrings, vexpand=True))
        self.split.set_sidebar(Adw.NavigationPage(title=_("Keyrings"), child=sidebar))

        # Справа — пароли выбранной связки.
        content = Adw.ToolbarView()
        header = Adw.HeaderBar()
        self.add_button = Gtk.Button(icon_name="list-add-symbolic", tooltip_text=_("Add password"))
        self.add_button.connect("clicked", lambda *_: ItemDialog(self, None, self.collection).present(self))
        header.pack_start(self.add_button)
        self.lock_button = Gtk.Button(icon_name="changes-prevent-symbolic", tooltip_text=_("Lock"))
        self.lock_button.connect("clicked", self._toggle_lock)
        header.pack_end(self.lock_button)
        menu = Gio.Menu()
        menu.append(_("Use for new passwords"), "win.make-default")
        menu.append(_("Delete keyring…"), "win.delete-keyring")
        menu.append(_("About Passwords"), "win.about")
        header.pack_end(Gtk.MenuButton(icon_name="open-menu-symbolic", menu_model=menu))
        self.search = Gtk.SearchEntry(placeholder_text=_("Search passwords"), hexpand=True, max_width_chars=40)
        self.search.connect("search-changed", lambda *_: self.list.invalidate_filter())
        header.set_title_widget(self.search)
        content.add_top_bar(header)

        self.stack = Gtk.Stack(transition_type=Gtk.StackTransitionType.CROSSFADE)
        self.list = Gtk.ListBox(css_classes=["boxed-list"], selection_mode=Gtk.SelectionMode.NONE,
                                valign=Gtk.Align.START)
        self.list.set_filter_func(self._filter)
        clamp = Adw.Clamp(child=self.list, maximum_size=760, margin_top=18, margin_bottom=18,
                          margin_start=12, margin_end=12)
        self.stack.add_named(Gtk.ScrolledWindow(child=clamp, vexpand=True), "items")

        unlock = Gtk.Button(label=_("Unlock"), halign=Gtk.Align.CENTER, css_classes=["pill", "suggested-action"])
        unlock.connect("clicked", self._toggle_lock)
        self.stack.add_named(Adw.StatusPage(icon_name="changes-prevent-symbolic", title=_("Keyring is locked"),
                                            description=_("Unlock it to see the passwords inside."),
                                            child=unlock), "locked")
        self.stack.add_named(Adw.StatusPage(icon_name="dialog-password-symbolic", title=_("No passwords"),
                                            description=_("Passwords that apps save appear here.")), "empty")
        self.stack.add_named(Adw.StatusPage(icon_name="dialog-warning-symbolic", title=_("No keyring service"),
                                            description=_("Install GNOME Keyring, or turn on Secret Service "
                                                          "in KeePassXC or KWallet.")), "unavailable")
        content.set_content(self.stack)
        self.content_page = Adw.NavigationPage(title=_("Passwords"), child=content)
        self.split.set_content(self.content_page)

        for name, callback in (("make-default", self._make_default), ("delete-keyring", self._delete_keyring),
                               ("about", self._about)):
            action = Gio.SimpleAction.new(name, None)
            action.connect("activate", callback)
            self.add_action(action)

        self.connect_service()

    # --- служба и связки -------------------------------------------------

    def connect_service(self):
        flags = Secret.ServiceFlags.OPEN_SESSION | Secret.ServiceFlags.LOAD_COLLECTIONS
        try:
            self.service = Secret.Service.get_sync(flags, None)
        except GLib.Error:
            self.service = None
        if not self.service:
            self.stack.set_visible_child_name("unavailable")
            return
        # Связки добавились, удалились, заблокировались — перерисовать.
        self.service.connect("notify::collections", lambda *_: self.reload_keyrings())
        self.reload_keyrings()

    def _default_path(self) -> str | None:
        try:
            default = Secret.Collection.for_alias_sync(self.service, "default", Secret.CollectionFlags.NONE, None)
        except GLib.Error:
            return None
        return default.get_object_path() if default else None

    def reload_keyrings(self):
        selected = self.collection.get_object_path() if self.collection else None
        default = self._default_path()
        while (row := self.keyrings.get_first_child()) is not None:
            self.keyrings.remove(row)
        collections = self.service.get_collections() or []
        # Сеансовая связка живёт только до выхода — в конец.
        collections.sort(key=lambda c: (c.get_object_path().endswith("/session"), c.get_label().lower()))
        select_row = None
        for collection in collections:
            row = Gtk.ListBoxRow()
            row.collection = collection
            box = Gtk.Box(spacing=12, margin_top=8, margin_bottom=8, margin_start=6, margin_end=6)
            box.append(Gtk.Image(icon_name="changes-prevent-symbolic" if collection.get_locked()
                                 else "changes-allow-symbolic"))
            texts = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
            name = collection.get_label() or _("Unnamed")
            if collection.get_object_path().endswith("/session"):
                name = _("This session")
            texts.append(Gtk.Label(label=name, xalign=0, ellipsize=3))
            if collection.get_object_path() == default:
                texts.append(Gtk.Label(label=_("Default"), xalign=0, css_classes=["caption", "dim-label"]))
            box.append(texts)
            row.set_child(box)
            self.keyrings.append(row)
            # Выбирается прежняя связка, иначе основная, иначе первая.
            if select_row is None or collection.get_object_path() == (selected or default):
                select_row = row
        if select_row is not None:
            self.keyrings.select_row(select_row)
        else:
            self.stack.set_visible_child_name("empty")

    def _keyring_selected(self, _box, row):
        if row is None:
            return
        self.collection = row.collection
        self.content_page.set_title(row.collection.get_label() or _("Passwords"))
        self.split.set_show_content(True)
        self.reload_items()

    def reload_items(self):
        collection = self.collection
        if collection is None:
            return
        locked = collection.get_locked()
        self.lock_button.set_icon_name("changes-allow-symbolic" if locked else "changes-prevent-symbolic")
        self.lock_button.set_tooltip_text(_("Unlock") if locked else _("Lock"))
        self.add_button.set_sensitive(not locked)
        if locked:
            self.stack.set_visible_child_name("locked")
            return
        try:
            collection.load_items_sync(None)
        except GLib.Error as error:
            self.toast(error.message)
        self.items = sorted(collection.get_items() or [], key=lambda i: (i.get_label() or "").lower())
        while (row := self.list.get_first_child()) is not None:
            self.list.remove(row)
        for item in self.items:
            row = Adw.ActionRow(title=GLib.markup_escape_text(item.get_label() or _("Unnamed")),
                                subtitle=GLib.markup_escape_text(describe(item)), activatable=True)
            row.item = item
            row.add_prefix(Gtk.Image(icon_name="dialog-password-symbolic"))
            copy = Gtk.Button(icon_name="edit-copy-symbolic", valign=Gtk.Align.CENTER,
                              tooltip_text=_("Copy password"), css_classes=["flat"])
            copy.connect("clicked", lambda _b, it=item: self._copy_item(it))
            row.add_suffix(copy)
            row.connect("activated", lambda _r, it=item: self._open_item(it))
            self.list.append(row)
        self.stack.set_visible_child_name("items" if self.items else "empty")

    def _filter(self, row) -> bool:
        query = self.search.get_text().strip().lower()
        if not query:
            return True
        item = row.item
        haystack = " ".join([item.get_label() or "", describe(item), *(item.get_attributes() or {}).values()])
        return query in haystack.lower()

    def _load_secret(self, item: Secret.Item) -> bool:
        try:
            item.load_secret_sync(None)
            return True
        except GLib.Error as error:
            self.toast(error.message)
            return False

    def _open_item(self, item):
        if self._load_secret(item):
            ItemDialog(self, item, self.collection).present(self)

    def _copy_item(self, item):
        if self._load_secret(item) and item.get_secret() is not None:
            self.copy_secret(item.get_secret().get_text() or "")

    def copy_secret(self, text: str):
        clipboard = Gdk.Display.get_default().get_clipboard()
        clipboard.set(text)
        self.toast(_("Password copied. It is cleared from the clipboard in %d seconds.") % CLIPBOARD_SECONDS)
        if self._clipboard_id:
            GLib.source_remove(self._clipboard_id)

        def clear():
            self._clipboard_id = 0
            clipboard.set("")
            return GLib.SOURCE_REMOVE

        self._clipboard_id = GLib.timeout_add_seconds(CLIPBOARD_SECONDS, clear)

    def toast(self, text: str):
        self.toasts.add_toast(Adw.Toast(title=text, timeout=4))

    # --- действия со связкой ---------------------------------------------

    def _toggle_lock(self, *_args):
        collection = self.collection
        if collection is None:
            return

        def done(service, result, locking):
            try:
                if locking:
                    service.lock_finish(result)
                else:
                    service.unlock_finish(result)
            except GLib.Error as error:
                if not error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED):
                    self.toast(error.message)
            self.reload_keyrings()

        # Пароль от связки спрашивает сама служба.
        if collection.get_locked():
            self.service.unlock([collection], None, done, False)
        else:
            self.service.lock([collection], None, done, True)

    def _new_keyring(self, *_args):
        dialog = Adw.AlertDialog(heading=_("New keyring"),
                                 body=_("The keyring service asks for a password to protect it."))
        entry = Adw.EntryRow(title=_("Name"))
        box = Gtk.ListBox(css_classes=["boxed-list"])
        box.append(entry)
        dialog.set_extra_child(box)
        dialog.add_response("cancel", _("Cancel"))
        dialog.add_response("create", _("Create"))
        dialog.set_response_appearance("create", Adw.ResponseAppearance.SUGGESTED)

        def answered(_dialog, response):
            name = entry.get_text().strip()
            if response != "create" or not name:
                return

            def created(_source, result):
                try:
                    Secret.Collection.create_finish(result)
                except GLib.Error as error:
                    if not error.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED):
                        self.toast(error.message)
                self.reload_keyrings()

            Secret.Collection.create(self.service, name, None, Secret.CollectionCreateFlags.NONE, None, created)

        dialog.connect("response", answered)
        dialog.present(self)

    def _make_default(self, *_args):
        if self.collection is None:
            return
        try:
            self.service.set_alias_sync("default", self.collection, None)
        except GLib.Error as error:
            self.toast(error.message)
        self.reload_keyrings()

    def _delete_keyring(self, *_args):
        collection = self.collection
        if collection is None:
            return
        dialog = Adw.AlertDialog(heading=_("Delete keyring “%s”?") % collection.get_label(),
                                 body=_("All passwords in it are deleted. Apps will ask for them again."))
        dialog.add_response("cancel", _("Cancel"))
        dialog.add_response("delete", _("Delete"))
        dialog.set_response_appearance("delete", Adw.ResponseAppearance.DESTRUCTIVE)

        def answered(_dialog, response):
            if response != "delete":
                return
            try:
                collection.delete_sync(None)
            except GLib.Error as error:
                self.toast(error.message)
            self.collection = None
            self.reload_keyrings()

        dialog.connect("response", answered)
        dialog.present(self)

    def _about(self, *_args):
        Adw.AboutDialog(application_name=_("Passwords"), application_icon="dialog-password",
                        version=__version__, developer_name="HypeDE",
                        comments=_("Keyrings and saved passwords. Works with GNOME Keyring, "
                                   "KeePassXC and KWallet through Secret Service."),
                        license_type=Gtk.License.GPL_3_0).present(self)


class Application(Adw.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID)

    def do_activate(self):
        window = self.get_active_window() or Window(self)
        window.present()


def main() -> int:
    _setup_i18n()
    return Application().run(sys.argv)
