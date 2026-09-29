"""Тесты помощников «Файлов», которым не нужен дисплей."""

import unittest

from hypede_files.util import format_size, split_extension, unique_name, validate_filename


class FormatSizeTest(unittest.TestCase):
    def test_bytes(self):
        self.assertEqual(format_size(0), "0 bytes")
        self.assertEqual(format_size(1), "1 byte")
        self.assertEqual(format_size(999), "999 bytes")

    def test_decimal_units(self):
        self.assertEqual(format_size(1000), "1 kB")
        self.assertEqual(format_size(1500), "1.5 kB")
        self.assertEqual(format_size(2_500_000), "2.5 MB")
        self.assertEqual(format_size(3 * 10**12), "3 TB")


class SplitExtensionTest(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(split_extension("отчёт.pdf"), ("отчёт", ".pdf"))

    def test_double_extension(self):
        self.assertEqual(split_extension("backup.tar.gz"), ("backup", ".tar.gz"))

    def test_hidden_file_has_no_extension(self):
        self.assertEqual(split_extension(".bashrc"), (".bashrc", ""))

    def test_no_extension(self):
        self.assertEqual(split_extension("Makefile"), ("Makefile", ""))


class UniqueNameTest(unittest.TestCase):
    def make_exists(self, *names):
        taken = set(names)
        return lambda path: path.split("/")[-1] in taken

    def test_free_name_is_kept(self):
        self.assertEqual(unique_name("/d", "a.txt", exists=self.make_exists()), "a.txt")

    def test_first_copy(self):
        self.assertEqual(unique_name("/d", "a.txt", exists=self.make_exists("a.txt")), "a (2).txt")

    def test_counts_up(self):
        exists = self.make_exists("a.txt", "a (2).txt", "a (3).txt")
        self.assertEqual(unique_name("/d", "a.txt", exists=exists), "a (4).txt")

    def test_copy_of_copy(self):
        exists = self.make_exists("a (2).txt")
        self.assertEqual(unique_name("/d", "a (2).txt", exists=exists), "a (3).txt")

    def test_folder(self):
        exists = self.make_exists("Новая папка")
        self.assertEqual(unique_name("/d", "Новая папка", exists=exists), "Новая папка (2)")

    def test_archive(self):
        exists = self.make_exists("x.tar.gz")
        self.assertEqual(unique_name("/d", "x.tar.gz", exists=exists), "x (2).tar.gz")


class ValidateFilenameTest(unittest.TestCase):
    def test_valid(self):
        self.assertIsNone(validate_filename("документ.odt"))

    def test_invalid(self):
        self.assertIsNotNone(validate_filename(""))
        self.assertIsNotNone(validate_filename("   "))
        self.assertIsNotNone(validate_filename("a/b"))
        self.assertIsNotNone(validate_filename(".."))
        self.assertIsNotNone(validate_filename("я" * 200))


if __name__ == "__main__":
    unittest.main()
