"""ИИ-помощник HypeDE — боковая панель с чатом выбранного провайдера.

Это встроенный браузер, в котором открыт сайт провайдера (Claude, Gemini,
Mistral, ChatGPT, Grok или DeepSeek). Входите в свою учётную запись прямо на
сайте; вход запоминается. Помощник ничего не может сделать в системе: у него
нет доступа ни к командам, ни к файлам — только те файлы и тот текст,
которые вы сами передали кнопкой «Спросить…».

    hypede-assistant                      открыть чат
    hypede-assistant --prompt "вопрос"    вписать вопрос в поле ввода
    hypede-assistant --file ~/a.pdf …     приложить файлы
    hypede-assistant --login              открыть страницу входа
"""

from __future__ import annotations

import base64
import gettext
import json
import locale
import mimetypes
import os
import sys

import gi

if "HypeDE" in os.environ.get("XDG_CURRENT_DESKTOP", "").split(":"):
    os.environ["DCONF_PROFILE"] = "hypede"

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
gi.require_version("Gdk", "4.0")
gi.require_version("WebKit", "6.0")

from gi.repository import Adw, Gdk, Gio, GLib, Gtk, WebKit  # noqa: E402

from . import providers  # noqa: E402

APP_ID = "dev.hypede.Assistant"
SCHEMA = "dev.hypede.assistant"
MAX_ATTACHMENT = 15 * 1024 * 1024
_ = gettext.gettext

# Вписать вопрос и приложить файлы. Поле ввода у всех сайтов разное, поэтому
# ищется самое широкое видимое поле (textarea или contenteditable); сайт
# грузится не сразу, поэтому поиск повторяется несколько секунд. Вопрос не
# отправляется — отправляете вы сами.
_INJECT = r"""
(async (text, files) => {
    const visible = e => e.offsetParent !== null && !e.disabled && !e.readOnly;
    const find = () => [...document.querySelectorAll('textarea, [contenteditable="true"], div[role="textbox"]')]
        .filter(visible)
        .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    let el = null;
    for (let i = 0; i < 80 && !(el = find()); i++)
        await new Promise(r => setTimeout(r, 250));
    if (!el)
        return 'no-composer';
    el.focus();
    if (files.length) {
        const dt = new DataTransfer();
        for (const f of files) {
            const bytes = Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
            dt.items.add(new File([bytes], f.name, {type: f.type}));
        }
        const paste = new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true});
        el.dispatchEvent(paste);
        if (!paste.defaultPrevented) {
            for (const type of ['dragenter', 'dragover', 'drop'])
                el.dispatchEvent(new DragEvent(type, {dataTransfer: dt, bubbles: true, cancelable: true}));
        }
    }
    if (text) {
        if (el.tagName === 'TEXTAREA') {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            setter.call(el, text);
            el.dispatchEvent(new Event('input', {bubbles: true}));
        } else {
            document.execCommand('insertText', false, text);
        }
    }
    return 'ok';
})(%s, %s)
"""


def _settings() -> Gio.Settings | None:
    source = Gio.SettingsSchemaSource.get_default()
    if source and source.lookup(SCHEMA, True):
        return Gio.Settings(schema_id=SCHEMA)
    return None


class AssistantWindow(Adw.ApplicationWindow):
    def __init__(self, app: "Application"):
        super().__init__(application=app, default_width=440, default_height=760)
        self.app = app
        self.settings = _settings()
        self.provider = providers.get(self.settings.get_string("provider") if self.settings else "")
        self.pending: tuple[str, list[str]] | None = None
        self.attachments: list[str] = []

        self.toasts = Adw.ToastOverlay()
        view = Adw.ToolbarView()
        self.toasts.set_child(view)
        self.set_content(self.toasts)

        header = Adw.HeaderBar()
        self.title = Adw.WindowTitle()
        header.set_title_widget(self.title)

        new_chat = Gtk.Button(icon_name="list-add-symbolic", tooltip_text=_("New chat"))
        new_chat.connect("clicked", lambda *_: self.load(self.provider.chat_url))
        header.pack_start(new_chat)

        menu = Gio.Menu()
        menu.append(_("Open in browser"), "win.browser")
        menu.append(_("Sign in again"), "win.login")
        menu.append(_("Sign out"), "win.logout")
        menu.append(_("Assistant settings"), "win.settings")
        header.pack_end(Gtk.MenuButton(icon_name="view-more-symbolic", menu_model=menu))
        view.add_top_bar(header)

        # Приложенные файлы — на случай, если сайт не принял их сам: их можно
        # перетащить в окно чата.
        self.files_bar = Gtk.FlowBox(selection_mode=Gtk.SelectionMode.NONE, max_children_per_line=3,
                                     margin_start=8, margin_end=8, margin_bottom=4, visible=False)
        view.add_top_bar(self.files_bar)

        for name, callback in (("browser", self._open_in_browser), ("login", self._login),
                               ("logout", self._logout), ("settings", self._open_settings)):
            action = Gio.SimpleAction.new(name, None)
            action.connect("activate", lambda *_a, cb=callback: cb())
            self.add_action(action)

        self.stack = Gtk.Stack(transition_type=Gtk.StackTransitionType.CROSSFADE)
        view.set_content(self.stack)
        self.disabled_page = Adw.StatusPage(
            icon_name="hypede-assistant-symbolic",
            title=_("The AI assistant is off"),
            description=_("Turn it on and choose a provider in Settings."))
        button = Gtk.Button(label=_("Open Settings"), halign=Gtk.Align.CENTER,
                            css_classes=["pill", "suggested-action"])
        button.connect("clicked", lambda *_: self._open_settings())
        self.disabled_page.set_child(button)
        self.stack.add_named(self.disabled_page, "off")

        self.web = None
        if self.settings:
            self.settings.connect("changed::provider", lambda *_: self._switch_provider())
            self.settings.connect("changed::enabled", lambda *_: self._sync_enabled())
        self._switch_provider()

    # ----- браузер -----

    def _make_webview(self) -> WebKit.WebView:
        base = os.path.join(GLib.get_user_data_dir(), "hypede", "assistant", self.provider.id)
        cache = os.path.join(GLib.get_user_cache_dir(), "hypede", "assistant", self.provider.id)
        os.makedirs(base, exist_ok=True)
        session = WebKit.NetworkSession.new(base, cache)
        session.get_cookie_manager().set_persistent_storage(
            os.path.join(base, "cookies.sqlite"), WebKit.CookiePersistentStorage.SQLITE)
        web = WebKit.WebView(network_session=session, vexpand=True, hexpand=True)
        settings = web.get_settings()
        settings.set_enable_developer_extras(False)
        settings.set_javascript_can_open_windows_automatically(False)
        web.connect("decide-policy", self._on_decide_policy)
        web.connect("permission-request", self._on_permission_request)
        web.connect("load-changed", self._on_load_changed)
        web.connect("notify::title", lambda *_: self._sync_title())
        return web

    def _switch_provider(self) -> None:
        self.provider = providers.get(self.settings.get_string("provider") if self.settings else "")
        if self.web is not None:
            self.stack.remove(self.web)
        self.web = self._make_webview()
        self.stack.add_named(self.web, "web")
        self._sync_title()
        self._sync_enabled()

    def _sync_enabled(self) -> None:
        enabled = self.settings is None or self.settings.get_boolean("enabled")
        self.stack.set_visible_child_name("web" if enabled else "off")
        if enabled and not self.web.get_uri():
            self.load(self.provider.chat_url)

    def _sync_title(self) -> None:
        self.set_title(self.provider.name)
        self.title.set_title(self.provider.name)
        self.title.set_subtitle(_("AI assistant"))

    def load(self, uri: str) -> None:
        self.web.load_uri(uri)

    def _on_decide_policy(self, _web, decision, kind):
        if kind not in (WebKit.PolicyDecisionType.NAVIGATION_ACTION, WebKit.PolicyDecisionType.NEW_WINDOW_ACTION):
            return False
        action = decision.get_navigation_action()
        uri = action.get_request().get_uri()
        try:
            host = GLib.Uri.parse(uri, GLib.UriFlags.NONE).get_host() or ""
        except GLib.Error:
            host = ""
        clicked = action.get_navigation_type() == WebKit.NavigationType.LINK_CLICKED
        new_window = kind == WebKit.PolicyDecisionType.NEW_WINDOW_ACTION
        if host and not self.provider.owns(host) and (clicked or new_window):
            # Чужие ссылки — в обычном браузере, а не в панели помощника.
            decision.ignore()
            Gio.AppInfo.launch_default_for_uri_async(uri, None, None, None, None)
            return True
        if new_window:
            decision.ignore()
            self.load(uri)
            return True
        return False

    def _on_permission_request(self, _web, request):
        # Камера, микрофон, местоположение, уведомления — помощнику не нужны.
        request.deny()
        return True

    def _on_load_changed(self, _web, event):
        if event == WebKit.LoadEvent.FINISHED and self.pending:
            prompt, files = self.pending
            self.pending = None
            self._inject(prompt, files)

    # ----- вопрос и файлы -----

    def ask(self, prompt: str, files: list[str]) -> None:
        self._show_attachments(files)
        if self.settings and not self.settings.get_boolean("enabled"):
            return
        # Если сайт умеет принимать вопрос в адресе и файлов нет — так надёжнее.
        direct = self.provider.url_for_prompt(prompt) if not files else None
        if direct:
            self.load(direct)
            return
        if self.web.is_loading() or not self.web.get_uri():
            self.pending = (prompt, files)
            if not self.web.get_uri():
                self.load(self.provider.chat_url)
        else:
            self._inject(prompt, files)

    def _inject(self, prompt: str, files: list[str]) -> None:
        payload = []
        for path in files:
            try:
                if os.path.getsize(path) > MAX_ATTACHMENT:
                    continue
                with open(path, "rb") as fh:
                    data = base64.b64encode(fh.read()).decode("ascii")
            except OSError:
                continue
            payload.append({"name": os.path.basename(path), "data": data,
                            "type": mimetypes.guess_type(path)[0] or "application/octet-stream"})
        script = _INJECT % (json.dumps(prompt), json.dumps(payload))
        self.web.evaluate_javascript(script, -1, None, None, None, self._on_injected, files)

    def _on_injected(self, web, result, files):
        try:
            value = web.evaluate_javascript_finish(result)
            status = value.to_string() if value is not None else ""
        except GLib.Error:
            status = "error"
        if status != "ok":
            self.toasts.add_toast(Adw.Toast(title=_("Could not reach the chat box — sign in first")))
        elif files:
            self.toasts.add_toast(Adw.Toast(
                title=_("If the files did not attach, drag them from the bar above into the chat")))

    def _show_attachments(self, files: list[str]) -> None:
        self.attachments = files
        child = self.files_bar.get_first_child()
        while child:
            self.files_bar.remove(child)
            child = self.files_bar.get_first_child()
        for path in files:
            chip = Gtk.Button(css_classes=["pill", "small"], tooltip_text=_("Drag into the chat"))
            box = Gtk.Box(spacing=6)
            box.append(Gtk.Image(icon_name="document-open-symbolic"))
            box.append(Gtk.Label(label=os.path.basename(path), ellipsize=3, max_width_chars=18))
            chip.set_child(box)
            source = Gtk.DragSource(actions=Gdk.DragAction.COPY)
            gfile = Gio.File.new_for_path(path)
            source.connect("prepare", lambda *_a, f=gfile: Gdk.ContentProvider.new_for_value(
                Gdk.FileList.new_from_list([f])))
            chip.add_controller(source)
            self.files_bar.append(chip)
        self.files_bar.set_visible(bool(files))

    # ----- меню -----

    def _open_in_browser(self) -> None:
        uri = self.web.get_uri() or self.provider.chat_url
        Gio.AppInfo.launch_default_for_uri_async(uri, None, None, None, None)

    def _login(self) -> None:
        self.load(self.provider.login_url)

    def _logout(self) -> None:
        manager = self.web.get_network_session().get_website_data_manager()
        manager.clear(WebKit.WebsiteDataTypes.ALL, 0, None,
                      lambda *_: self.load(self.provider.login_url))

    def _open_settings(self) -> None:
        try:
            Gio.Subprocess.new(["hypede-settings", "--page", "assistant"], Gio.SubprocessFlags.NONE)
        except GLib.Error:
            pass


class Application(Adw.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
        self.add_main_option("prompt", ord("p"), GLib.OptionFlags.NONE, GLib.OptionArg.STRING,
                             "Question to put into the chat box", "TEXT")
        self.add_main_option("file", ord("f"), GLib.OptionFlags.NONE, GLib.OptionArg.FILENAME_ARRAY,
                             "File to attach (can be repeated)", "FILE")
        self.add_main_option("login", 0, GLib.OptionFlags.NONE, GLib.OptionArg.NONE,
                             "Open the provider's sign-in page", None)

    def do_command_line(self, command_line):
        options = command_line.get_options_dict().end().unpack()
        window = self.get_active_window() or AssistantWindow(self)
        window.present()
        files = [f.decode() if isinstance(f, bytes) else f for f in options.get("file", [])]
        files = [os.path.join(command_line.get_cwd() or "", f) for f in files]
        if options.get("login"):
            window._login()
        elif options.get("prompt") or files:
            window.ask(options.get("prompt", ""), files)
        return 0


def main() -> int:
    localedir = os.environ.get("HYPEDE_LOCALEDIR", "/usr/share/locale")
    try:
        locale.setlocale(locale.LC_ALL, "")
    except locale.Error:
        pass
    gettext.bindtextdomain("hypede", localedir)
    gettext.textdomain("hypede")
    return Application().run(sys.argv)
