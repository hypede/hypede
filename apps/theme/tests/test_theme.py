"""Тесты hypede-theme на временной схеме GSettings (бэкенд memory)."""

import base64
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

TMP = Path(tempfile.mkdtemp(prefix="hypede-theme-test-"))
schemas = TMP / "schemas"
schemas.mkdir()
shutil.copy(ROOT / "data/schemas/dev.hypede.shell.gschema.xml", schemas)
# Схема интерфейса GNOME нужна не вся — хватит ключей, которые есть в TABLE.
(schemas / "iface.gschema.xml").write_text("""<schemalist>
  <schema id="org.gnome.desktop.interface" path="/org/gnome/desktop/interface/">
    <key name="color-scheme" type="s"><default>'default'</default></key>
    <key name="accent-color" type="s"><default>'blue'</default></key>
  </schema>
  <schema id="org.gnome.desktop.background" path="/org/gnome/desktop/background/">
    <key name="picture-uri" type="s"><default>''</default></key>
    <key name="picture-uri-dark" type="s"><default>''</default></key>
  </schema>
</schemalist>""")
subprocess.run(["glib-compile-schemas", str(schemas)], check=True)
os.environ["GSETTINGS_SCHEMA_DIR"] = str(schemas)
os.environ["GSETTINGS_BACKEND"] = "memory"
os.environ["XDG_DATA_HOME"] = str(TMP / "data")
os.environ["XDG_DATA_DIRS"] = str(TMP / "sys")
(TMP / "sys/hypede").mkdir(parents=True)
shutil.copytree(ROOT / "data/themes", TMP / "sys/hypede/themes")

import hypede_theme as ht  # noqa: E402  (после настройки окружения)


def shell():
    return ht._settings(ht.SHELL)[0]


class ThemeTest(unittest.TestCase):
    def setUp(self):
        for key in ht._settings(ht.SHELL)[1].list_keys():
            shell().reset(key)

    def test_builtin_list(self):
        names = {t["name"] for t in ht.themes()}
        self.assertIn("HypeDE", names)
        self.assertIn("Sakura", names)

    def test_apply_builtin_and_reset(self):
        ht.apply(ht.load(ht.resolve("builtin:sakura")))
        self.assertEqual(shell().get_string("accent-custom"), "#d6337a")
        self.assertEqual(shell().get_string("theme-name"), "Sakura")
        # У HypeDE нет своего акцента — розовый должен уйти.
        ht.apply(ht.load(ht.resolve("builtin:hypede")))
        self.assertEqual(shell().get_string("accent-custom"), "")
        self.assertEqual(shell().get_string("shelf-color"), "")

    def test_rejects_bad_values(self):
        theme = {"hypede-theme": 1, "name": "Bad",
                 "colors": {"accent": "red; color: blue", "shelf": "#12345"},
                 "shelf": {"size": 100000, "opacity": "50", "blur": 1},
                 "lockscreen": {"wallpaper": "https://example.com/x.png"},
                 "evil": {"anything": True}}
        ht.apply(theme)
        self.assertEqual(shell().get_string("accent-custom"), "")
        self.assertEqual(shell().get_string("shelf-color"), "")
        self.assertEqual(shell().get_value("shelf-size"), shell().get_default_value("shelf-size"))
        self.assertFalse(shell().get_user_value("shelf-opacity"))
        self.assertEqual(shell().get_string("lock-wallpaper"), "")

    def test_export_import_with_embedded_wallpaper(self):
        pic = TMP / "my wall.png"
        pic.write_bytes(b"\x89PNG fake")
        shell().set_string("lock-wallpaper", pic.as_uri())
        shell().set_string("accent-custom", "#00ff88")
        out = TMP / "mine.txt"
        ht.export(out, name="Mine", author="me")
        data = json.loads(out.read_text())
        self.assertEqual(data["lockscreen"]["wallpaper"], "embedded:my wall.png")
        self.assertEqual(base64.b64decode(data["files"]["my wall.png"]), b"\x89PNG fake")

        shell().reset("lock-wallpaper")
        shell().reset("accent-custom")
        ref = ht.import_(out)
        ht.apply(ht.load(ht.resolve(ref)))
        self.assertEqual(shell().get_string("accent-custom"), "#00ff88")
        uri = shell().get_string("lock-wallpaper")
        self.assertTrue(uri.startswith("file://"))
        self.assertIn("hypede/themes/mine", uri)

    def test_embedded_names_cannot_escape(self):
        theme = {"hypede-theme": 1, "name": "Escape",
                 "lockscreen": {"wallpaper": "embedded:../../evil.png"},
                 "files": {"../../evil.png": base64.b64encode(b"x").decode(),
                           "script.sh": base64.b64encode(b"rm -rf").decode()}}
        f = TMP / "escape.json"
        f.write_text(json.dumps(theme))
        ref = ht.import_(f)
        folder = ht.USER_DIR / ref[5:]
        self.assertEqual(sorted(p.name for p in folder.iterdir()), ["evil.png"])
        self.assertFalse((ht.USER_DIR.parent / "evil.png").exists())

    def test_not_a_theme(self):
        f = TMP / "x.json"
        f.write_text('{"name": "x"}')
        with self.assertRaises(ht.ThemeError):
            ht.load(f)

    def test_save_and_delete(self):
        shell().set_string("shelf-color", "#101010")
        ref = ht.save("Night Owl")
        self.assertEqual(ref, "user:night-owl")
        self.assertIn("Night Owl", [t["name"] for t in ht.themes()])
        ht.delete(ref)
        self.assertNotIn("Night Owl", [t["name"] for t in ht.themes()])
        with self.assertRaises(ht.ThemeError):
            ht.delete("builtin:hypede")


if __name__ == "__main__":
    unittest.main()
