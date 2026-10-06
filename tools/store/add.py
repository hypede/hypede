#!/usr/bin/env python3
"""Добавить тему в каталог магазина по issue «Theme: …» (запускает GitHub Actions)."""

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps/theme"))
from hypede_theme import ThemeError, fetch_theme, parse_repo  # noqa: E402

INDEX = ROOT / "store/themes.json"


def output(**values):
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
        for k, v in values.items():
            f.write(f"{k}<<EOF\n{v}\nEOF\n")


def main():
    text = os.environ.get("BODY", "") + "\n" + os.environ.get("TITLE", "")
    m = re.search(r"(?:https?://)?(?:www\.)?github\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+", text) or \
        re.search(r"Theme:\s*([A-Za-z0-9-]+/[A-Za-z0-9._-]+)", text)
    try:
        if not m:
            raise ThemeError("no repository link found")
        repo = parse_repo(m.group(1) if m.lastindex else m.group(0))
        theme = fetch_theme(repo)
    except ThemeError as e:
        output(added="false", message=f"Could not add the theme: {e}.\n\nFix it and open a new issue.")
        return
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    if any(e.get("repo", "").lower() == repo.lower() and e.get("path", "theme.json") == "theme.json"
           for e in index["themes"]):
        output(added="false", message=f"**{theme['name']}** from `{repo}` is already in the store. "
                                      "Updates to the repository show up there by themselves.")
        return
    index["themes"].append({"repo": repo})
    INDEX.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    output(added="true", repo=repo,
           message=f"**{theme['name']}** is in the store now 🎉 It appears in Settings → Personalization → Theme store.")


if __name__ == "__main__":
    main()
