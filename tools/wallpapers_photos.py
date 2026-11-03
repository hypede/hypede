"""Фотообои с природой и живопись: откуда взяты и под какой лицензией.

Фотографии — из каталога WordPress Photo Directory (wordpress.org/photos),
все под CC0. Картины — из открытой коллекции Метрополитен-музея (Open
Access, CC0): сами работы давно в общественном достоянии.

Файлы лежат в assets/wallpapers/ как <name>.jpg. Скачать их заново:
python3 tools/fetch-wallpapers.py; список для GNOME собирает
tools/gen-wallpapers.py, список авторов — assets/wallpapers/CREDITS.md.

Поле trim у картин — сколько ещё отрезать с каждого края после
автоматической обрезки рамки (доля стороны); None — не обрезать (фото).
"""

from __future__ import annotations

# (имя файла, название, автор, страница источника, файл, лицензия, trim, цвет для GNOME)
PHOTOS = [
    ("nature-alpine-lake", "Alpine lake", "Francois Thibaud",
     "https://wordpress.org/photos/photo/258666032f/",
     "https://pd.w.org/2024/06/258666032f0b18c16.67857170.jpeg", "CC0", None, "#4a7aa8"),
    ("nature-still-lake", "Still lake", "Laxman Bhattarai",
     "https://wordpress.org/photos/photo/2356a22d60/",
     "https://pd.w.org/2026/06/2356a22d6008e9901.32110882.jpg", "CC0", None, "#3d6b8f"),
    ("nature-aurora", "Northern lights", "Sadie-Michaela Harris",
     "https://wordpress.org/photos/photo/862663f1a2/",
     "https://pd.w.org/2024/05/862663f1a2b7097b2.50975238.jpg", "CC0", None, "#3a2a5a"),
    ("nature-autumn-forest", "Autumn forest", "Roy Tanck",
     "https://wordpress.org/photos/photo/787634ecd7/",
     "https://pd.w.org/2022/10/787634ecd7e187364.29655991.jpg", "CC0", None, "#8a5a2a"),
    ("nature-sea-of-fog", "Sea of fog", "Martin Sauter",
     "https://wordpress.org/photos/photo/37061e085d/",
     "https://pd.w.org/2022/01/37061e085d5b150e9.77368093.jpg", "CC0", None, "#9fb3c8"),
    ("nature-snow-peaks", "Snow peaks", "Uttkrista Chhetri",
     "https://wordpress.org/photos/photo/6816a4a85a/",
     "https://pd.w.org/2026/07/6816a4a85ac9de893.44563504.jpg", "CC0", None, "#1f4f8a"),
    ("nature-fall-hills", "Fall hills", "Michelle Frechette",
     "https://wordpress.org/photos/photo/99464303c7/",
     "https://pd.w.org/2023/04/99464303c7bdfa608.38416406.jpg", "CC0", None, "#b0603a"),
    ("nature-golden-field", "Golden field", "Rafel Jesús",
     "https://wordpress.org/photos/photo/243621a989/",
     "https://pd.w.org/2022/02/243621a989e9c5125.22876203.jpg", "CC0", None, "#b8954a"),
    ("nature-waterfall", "Waterfall", "Michael Tiña",
     "https://wordpress.org/photos/photo/642642d435/",
     "https://pd.w.org/2023/04/642642d435d0f0073.01605357.jpg", "CC0", None, "#4f6b3a"),

    ("art-great-wave", "The Great Wave off Kanagawa", "Katsushika Hokusai, ca. 1830–32",
     "https://www.metmuseum.org/art/collection/search/45434",
     "https://images.metmuseum.org/CRDImages/as/original/DP130155.jpg", "Public domain (Met Open Access, CC0)", 0.012, "#e8dcc0"),
    ("art-wheat-field", "Wheat Field with Cypresses", "Vincent van Gogh, 1889",
     "https://www.metmuseum.org/art/collection/search/436535",
     "https://images.metmuseum.org/CRDImages/ep/original/DP-42549-001.jpg", "Public domain (Met Open Access, CC0)", 0.012, "#c9a64a"),
    ("art-oxbow", "The Oxbow", "Thomas Cole, 1836",
     "https://www.metmuseum.org/art/collection/search/10497",
     "https://images.metmuseum.org/CRDImages/ad/original/DP-12550-001.jpg", "Public domain (Met Open Access, CC0)", 0.012, "#5a6a4a"),
    ("art-heart-of-the-andes", "Heart of the Andes", "Frederic Edwin Church, 1859",
     "https://www.metmuseum.org/art/collection/search/10481",
     "https://images.metmuseum.org/CRDImages/ad/original/DT78.jpg", "Public domain (Met Open Access, CC0)", 0.012, "#6a6a3a"),
    ("art-lake-louise", "Canadian Rockies (Lake Louise)", "Albert Bierstadt, ca. 1889",
     "https://www.metmuseum.org/art/collection/search/10149",
     "https://images.metmuseum.org/CRDImages/ad/original/DT7282.jpg", "Public domain (Met Open Access, CC0)", 0.012, "#4a5a5a"),
    ("art-marly", "View of Marly-le-Roi from Coeur-Volant", "Alfred Sisley, 1876",
     "https://www.metmuseum.org/art/collection/search/437682",
     "https://images.metmuseum.org/CRDImages/ep/original/DP130325.jpg", "Public domain (Met Open Access, CC0)", 0.012, "#8aa8c8"),
    ("art-evening-snow", "Evening Snow at Kanbara", "Utagawa Hiroshige, ca. 1833–34",
     "https://www.metmuseum.org/art/collection/search/56915",
     "https://images.metmuseum.org/CRDImages/as/original/DP109333.jpg", "Public domain (Met Open Access, CC0)", 0.05, "#d8d4c8"),
]


def credits_markdown() -> str:
    lines = [
        "# Фотообои и живопись",
        "",
        "Файлы `nature-*.jpg` и `art-*.jpg`. Список создан tools/fetch-wallpapers.py",
        "из tools/wallpapers_photos.py.",
        "",
        "| Файл | Название | Автор | Лицензия | Источник |",
        "|---|---|---|---|---|",
    ]
    for name, title, author, page, _url, license_, _trim, _color in PHOTOS:
        lines.append(f"| {name}.jpg | {title} | {author} | {license_} | {page} |")
    return "\n".join(lines) + "\n"
