"""Провайдеры ИИ-помощника: где у них чат и где вход.

Помощник открывает обычный сайт провайдера во встроенном браузере, поэтому
входить нужно в собственную учётную запись — ключи API не нужны. Такой же
список (id и названия) есть в «Настройках» (Catalog.qml) и в оболочке
(assistant.js).
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote


@dataclass(frozen=True)
class Provider:
    id: str
    name: str
    chat_url: str
    login_url: str
    # Сайты самого провайдера: ссылки на другие сайты открываются в браузере.
    domains: tuple[str, ...]
    # Адрес чата с уже вписанным вопросом, если сайт это умеет.
    prompt_url: str | None = None

    def url_for_prompt(self, prompt: str) -> str | None:
        if not self.prompt_url or not prompt:
            return None
        return self.prompt_url.replace("%s", quote(prompt))

    def owns(self, host: str) -> bool:
        return any(host == d or host.endswith("." + d) for d in self.domains)


# Вход через Google, Apple и Microsoft — общий для нескольких провайдеров.
_SSO = ("accounts.google.com", "google.com", "gstatic.com", "googleusercontent.com",
        "appleid.apple.com", "apple.com", "login.microsoftonline.com", "live.com",
        "microsoft.com")

PROVIDERS: dict[str, Provider] = {p.id: p for p in (
    Provider("claude", "Claude", "https://claude.ai/new", "https://claude.ai/login",
             ("claude.ai", "anthropic.com") + _SSO, "https://claude.ai/new?q=%s"),
    Provider("gemini", "Gemini", "https://gemini.google.com/app",
             "https://accounts.google.com/ServiceLogin?continue=https://gemini.google.com/app",
             ("gemini.google.com",) + _SSO),
    Provider("mistral", "Mistral", "https://chat.mistral.ai/chat", "https://chat.mistral.ai/login",
             ("mistral.ai",) + _SSO, "https://chat.mistral.ai/chat?q=%s"),
    Provider("chatgpt", "ChatGPT", "https://chatgpt.com/", "https://chatgpt.com/auth/login",
             ("chatgpt.com", "openai.com", "oaistatic.com", "oaiusercontent.com") + _SSO,
             "https://chatgpt.com/?q=%s"),
    Provider("grok", "Grok", "https://grok.com/", "https://accounts.x.ai/sign-in",
             ("grok.com", "x.ai", "x.com", "twitter.com") + _SSO, "https://grok.com/?q=%s"),
    Provider("deepseek", "DeepSeek", "https://chat.deepseek.com/", "https://chat.deepseek.com/sign_in",
             ("deepseek.com",) + _SSO),
)}

DEFAULT = "claude"


def get(provider_id: str) -> Provider:
    return PROVIDERS.get(provider_id) or PROVIDERS[DEFAULT]
