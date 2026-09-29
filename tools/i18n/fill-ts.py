#!/usr/bin/env python3
"""Вписывает русский перевод в .ts-файл «Настроек» (после lupdate).

    python3 tools/i18n/fill-ts.py apps/settings/translations/hypede-settings_ru.ts
"""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from settings_ru import CONTEXT_RU, RU  # noqa: E402

path = sys.argv[1]
tree = ET.parse(path)
missing = []
for context in tree.getroot().findall("context"):
    name = context.find("name").text
    for message in context.findall("message"):
        source = message.find("source").text
        translation = message.find("translation")
        text = CONTEXT_RU.get((name, source), RU.get(source))
        if text is None:
            missing.append(f"{name}: {source}")
            continue
        translation.text = text
        translation.attrib.pop("type", None)
tree.write(path, encoding="utf-8", xml_declaration=True)
with open(path, "r+", encoding="utf-8") as fh:
    content = fh.read().replace("<?xml version='1.0' encoding='utf-8'?>", '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE TS>', 1)
    fh.seek(0)
    fh.write(content)
    fh.truncate()
if missing:
    print("нет перевода:\n  " + "\n  ".join(missing))
    sys.exit(1)
print("перевод заполнен")
