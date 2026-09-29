#!/usr/bin/env python3
"""Собирает po/ru.po из po/hypede.pot и словаря tools/i18n/po_ru.py.

    python3 tools/i18n/make-po.py
Шаблон обновляется командой `make pot` (xgettext по «Файлам» и оболочке).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).parent))
from po_ru import PLURALS, RU  # noqa: E402

pot = (ROOT / "po/hypede.pot").read_text(encoding="utf-8")
entries = pot.split("\n\n")
out = ['''# Russian translation for HypeDE.
msgid ""
msgstr ""
"Project-Id-Version: hypede\\n"
"PO-Revision-Date: 2026-09-29 00:00+0000\\n"
"Last-Translator: HypeDE contributors\\n"
"Language-Team: Russian\\n"
"Language: ru\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Content-Transfer-Encoding: 8bit\\n"
"Plural-Forms: nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);\\n"
''']


def unquote(block: str, key: str) -> str | None:
    match = re.search(rf'^{key} ((?:".*"\n?)+)', block + "\n", re.M)
    if not match:
        return None
    parts = re.findall(r'"(.*)"', match.group(1))
    return "".join(parts).encode().decode("unicode_escape").encode("latin-1").decode("utf-8")


def quote(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


missing = []
for entry in entries[1:]:
    entry = entry.strip()
    if not entry:
        continue
    msgid = unquote(entry, "msgid")
    plural = unquote(entry, "msgid_plural")
    comments = "\n".join(line for line in entry.splitlines() if line.startswith("#"))
    lines = [comments] if comments else []
    lines.append(f"msgid {quote(msgid)}")
    if plural is not None:
        forms = PLURALS.get(msgid)
        if forms is None:
            missing.append(msgid)
            forms = ("", "", "")
        lines.append(f"msgid_plural {quote(plural)}")
        for i, form in enumerate(forms):
            lines.append(f"msgstr[{i}] {quote(form)}")
    else:
        text = RU.get(msgid)
        if text is None:
            missing.append(msgid)
            text = ""
        lines.append(f"msgstr {quote(text)}")
    out.append("\n".join(lines) + "\n")

(ROOT / "po/ru.po").write_text("\n".join(out), encoding="utf-8")
if missing:
    print("нет перевода:\n  " + "\n  ".join(missing))
    sys.exit(1)
print("po/ru.po записан")
