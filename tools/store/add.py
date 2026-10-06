#!/usr/bin/env python3
"""Добавить или обновить тему в каталоге по issue «Theme: …» (запускает GitHub Actions).

Тема закрепляется за текущим коммитом репозитория и проходит те же проверки,
что и при установке: формат, все встроенные картинки и видео, антивирус.
Новая заявка на ту же тему — обновление до свежего коммита; пометка
«Проверено» при этом снимается до новой ручной проверки.
"""

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps/theme"))
from hypede_theme import ThemeError, fetch_theme, parse_repo, validate  # noqa: E402

INDEX = ROOT / "store/themes.json"


def output(**values):
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
        for k, v in values.items():
            f.write(f"{k}<<EOF\n{v}\nEOF\n")


def head_commit(repo):
    req = urllib.request.Request(f"https://api.github.com/repos/{repo}/commits/HEAD",
                                 headers={"Accept": "application/vnd.github.sha", "User-Agent": "hypede-store"})
    if os.environ.get("GH_TOKEN"):
        req.add_header("Authorization", f"Bearer {os.environ['GH_TOKEN']}")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            sha = r.read(64).decode().strip()
    except OSError as e:
        raise ThemeError(f"не удалось узнать последний коммит ({e})")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ThemeError("не удалось узнать последний коммит")
    return sha


def main():
    text = os.environ.get("BODY", "") + "\n" + os.environ.get("TITLE", "")
    m = re.search(r"(?:https?://)?(?:www\.)?github\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+", text) or \
        re.search(r"Theme:\s*([A-Za-z0-9-]+/[A-Za-z0-9._-]+)", text)
    try:
        if not m:
            raise ThemeError("no repository link found")
        repo = parse_repo(m.group(1) if m.lastindex else m.group(0))
        commit = head_commit(repo)
        theme = fetch_theme(repo, "theme.json", commit)
        validate(theme)
    except ThemeError as e:
        output(added="false", message=f"Could not add the theme: {e}.\n\nFix it and open a new issue.")
        return
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    entry = next((e for e in index["themes"] if e.get("repo", "").lower() == repo.lower()
                  and e.get("path", "theme.json") == "theme.json"), None)
    if entry and entry.get("commit") == commit:
        output(added="false", message=f"**{theme['name']}** from `{repo}` is already in the store at this commit.")
        return
    if entry:
        entry["commit"] = commit
        entry["verified"] = False
        note = "updated to"
    else:
        index["themes"].append({"repo": repo, "commit": commit, "verified": False})
        note = "added at"
    INDEX.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    output(added="true", repo=repo,
           message=f"**{theme['name']}** is in the store now, {note} commit `{commit[:7]}` 🎉 "
                   "It appears in Settings → Personalization → Theme store, marked as not reviewed "
                   "until a maintainer checks it. To publish changes later, push them and open a new issue.")


if __name__ == "__main__":
    main()
