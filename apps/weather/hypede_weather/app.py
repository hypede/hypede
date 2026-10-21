"""«Погода» HypeDE: сейчас, по часам на сутки и на неделю.

Прогноз и поиск городов — Open-Meteo (без ключей и регистрации). Города и
единицы хранятся в dev.hypede.weather — оттуда же их берёт виджет погоды
на рабочем столе.

    hypede-weather
"""

from __future__ import annotations

import gettext
import json
import locale
import os
import sys
import urllib.parse

import gi

if "HypeDE" in os.environ.get("XDG_CURRENT_DESKTOP", "").split(":"):
    os.environ["DCONF_PROFILE"] = "hypede"

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
gi.require_version("Gdk", "4.0")
gi.require_version("Soup", "3.0")

from gi.repository import Adw, Gdk, Gio, GLib, Gtk, Soup  # noqa: E402

from . import __version__  # noqa: E402

APP_ID = "dev.hypede.Weather"
SCHEMA = "dev.hypede.weather"
_ = gettext.gettext


def N_(text: str) -> str:
    """Пометить строку для перевода; переводится при показе."""
    return text


_DATA_DIR = os.path.dirname(os.path.abspath(__file__))
FORECAST = "https://api.open-meteo.com/v1/forecast"
GEOCODING = "https://geocoding-api.open-meteo.com/v1/search"
REFRESH_SECONDS = 30 * 60

# Коды погоды WMO → (описание, значок днём, значок ночью).
CODES = {
    0: (N_("Clear sky"), "weather-clear", "weather-clear-night"),
    1: (N_("Mostly clear"), "weather-few-clouds", "weather-few-clouds-night"),
    2: (N_("Partly cloudy"), "weather-few-clouds", "weather-few-clouds-night"),
    3: (N_("Overcast"), "weather-overcast", "weather-overcast"),
    45: (N_("Fog"), "weather-fog", "weather-fog"),
    48: (N_("Freezing fog"), "weather-fog", "weather-fog"),
    51: (N_("Light drizzle"), "weather-showers-scattered", "weather-showers-scattered"),
    53: (N_("Drizzle"), "weather-showers-scattered", "weather-showers-scattered"),
    55: (N_("Heavy drizzle"), "weather-showers", "weather-showers"),
    56: (N_("Freezing drizzle"), "weather-freezing-rain", "weather-freezing-rain"),
    57: (N_("Freezing drizzle"), "weather-freezing-rain", "weather-freezing-rain"),
    61: (N_("Light rain"), "weather-showers-scattered", "weather-showers-scattered"),
    63: (N_("Rain"), "weather-showers", "weather-showers"),
    65: (N_("Heavy rain"), "weather-showers", "weather-showers"),
    66: (N_("Freezing rain"), "weather-freezing-rain", "weather-freezing-rain"),
    67: (N_("Freezing rain"), "weather-freezing-rain", "weather-freezing-rain"),
    71: (N_("Light snow"), "weather-snow", "weather-snow"),
    73: (N_("Snow"), "weather-snow", "weather-snow"),
    75: (N_("Heavy snow"), "weather-snow", "weather-snow"),
    77: (N_("Snow grains"), "weather-snow", "weather-snow"),
    80: (N_("Rain showers"), "weather-showers-scattered", "weather-showers-scattered"),
    81: (N_("Rain showers"), "weather-showers", "weather-showers"),
    82: (N_("Violent rain showers"), "weather-showers", "weather-showers"),
    85: (N_("Snow showers"), "weather-snow", "weather-snow"),
    86: (N_("Snow showers"), "weather-snow", "weather-snow"),
    95: (N_("Thunderstorm"), "weather-storm", "weather-storm"),
    96: (N_("Thunderstorm with hail"), "weather-storm", "weather-storm"),
    99: (N_("Thunderstorm with hail"), "weather-storm", "weather-storm"),
}


def _setup_i18n() -> None:
    marker = os.sep + os.path.join("share", "hypede", "weather")
    prefix = _DATA_DIR.split(marker)[0] if marker in _DATA_DIR else "/usr"
    try:
        locale.setlocale(locale.LC_ALL, "")
    except locale.Error:
        pass
    gettext.bindtextdomain("hypede", os.environ.get("HYPEDE_LOCALEDIR", os.path.join(prefix, "share", "locale")))
    gettext.textdomain("hypede")


def condition(code: int, day: bool = True) -> tuple[str, str]:
    """(описание, значок) по коду WMO."""
    text, icon_day, icon_night = CODES.get(code, (N_("Unknown"), "weather-severe-alert", "weather-severe-alert"))
    return _(text), (icon_day if day else icon_night) + "-symbolic"


def language() -> str:
    lang = (locale.getlocale(locale.LC_MESSAGES)[0] or os.environ.get("LANG", "en")).split("_")[0]
    return lang if lang and lang != "C" else "en"


class Weather:
    """Запросы к Open-Meteo: ответы приходят в callback(dict | None)."""

    def __init__(self):
        self.session = Soup.Session(timeout=20, user_agent="HypeDE-Weather/" + __version__)

    def get(self, url: str, params: dict, callback):
        message = Soup.Message.new("GET", url + "?" + urllib.parse.urlencode(params))

        def done(session, result):
            try:
                body = session.send_and_read_finish(result).get_data()
                data = json.loads(body) if message.get_status() == 200 else None
            except (GLib.Error, ValueError):
                data = None
            callback(data)

        self.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, None, done)

    def search(self, name: str, callback):
        self.get(GEOCODING, {"name": name, "count": 8, "language": language(), "format": "json"},
                 lambda data: callback((data or {}).get("results") or []))

    def forecast(self, place: dict, unit: str, callback):
        self.get(FORECAST, {
            "latitude": place["lat"], "longitude": place["lon"], "timezone": "auto", "forecast_days": 7,
            "temperature_unit": "fahrenheit" if unit == "f" else "celsius",
            "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,"
                       "wind_speed_10m,is_day,precipitation",
            "hourly": "temperature_2m,weather_code,precipitation_probability,is_day",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,"
                     "precipitation_probability_max",
        }, callback)


class PlacesDialog(Adw.Dialog):
    """Поиск города и список сохранённых городов."""

    def __init__(self, window: "Window"):
        super().__init__(title=_("Places"), content_width=420, content_height=520)
        self.window = window
        view = Adw.ToolbarView()
        view.add_top_bar(Adw.HeaderBar())
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12, margin_top=6, margin_bottom=12,
                      margin_start=12, margin_end=12)
        self.entry = Gtk.SearchEntry(placeholder_text=_("Search for a city"))
        self.entry.connect("search-changed", self._search)
        box.append(self.entry)
        self.results = Gtk.ListBox(css_classes=["boxed-list"], selection_mode=Gtk.SelectionMode.NONE)
        self.saved = Gtk.ListBox(css_classes=["boxed-list"], selection_mode=Gtk.SelectionMode.NONE)
        box.append(self.results)
        box.append(self.saved)
        view.set_content(Gtk.ScrolledWindow(child=box, vexpand=True))
        self.set_child(view)
        self.results.set_visible(False)
        self._serial = 0
        self.fill_saved()

    def fill_saved(self):
        while (row := self.saved.get_first_child()) is not None:
            self.saved.remove(row)
        places = self.window.places()
        current = self.window.settings.get_int("current")
        for index, place in enumerate(places):
            row = Adw.ActionRow(title=GLib.markup_escape_text(place["name"]),
                                subtitle=GLib.markup_escape_text(", ".join(
                                    x for x in (place.get("region"), place.get("country")) if x)),
                                activatable=True)
            if index == current:
                row.add_prefix(Gtk.Image(icon_name="object-select-symbolic"))
            remove = Gtk.Button(icon_name="user-trash-symbolic", valign=Gtk.Align.CENTER, css_classes=["flat"],
                                tooltip_text=_("Remove"))
            remove.connect("clicked", lambda _b, i=index: self._remove(i))
            row.add_suffix(remove)
            row.connect("activated", lambda _r, i=index: self._choose(i))
            self.saved.append(row)
        self.saved.set_visible(bool(places))

    def _search(self, entry):
        text = entry.get_text().strip()
        self._serial += 1
        serial = self._serial
        if len(text) < 2:
            self.results.set_visible(False)
            return

        def found(results):
            if serial != self._serial:
                return
            while (row := self.results.get_first_child()) is not None:
                self.results.remove(row)
            for result in results:
                place = {"name": result.get("name", ""), "region": result.get("admin1", ""),
                         "country": result.get("country", ""), "lat": result["latitude"],
                         "lon": result["longitude"]}
                row = Adw.ActionRow(title=GLib.markup_escape_text(place["name"]),
                                    subtitle=GLib.markup_escape_text(", ".join(
                                        x for x in (place["region"], place["country"]) if x)),
                                    activatable=True)
                row.add_suffix(Gtk.Image(icon_name="list-add-symbolic"))
                row.connect("activated", lambda _r, p=place: self._add(p))
                self.results.append(row)
            if not results:
                self.results.append(Adw.ActionRow(title=_("Nothing found")))
            self.results.set_visible(True)

        self.window.weather.search(text, found)

    def _add(self, place):
        places = self.window.places()
        places.append(place)
        self.window.save_places(places, len(places) - 1)
        self.close()

    def _choose(self, index):
        self.window.settings.set_int("current", index)
        self.close()

    def _remove(self, index):
        places = self.window.places()
        del places[index]
        current = min(self.window.settings.get_int("current"), max(len(places) - 1, 0))
        self.window.save_places(places, current)
        self.fill_saved()


class Window(Adw.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app, title=_("Weather"), default_width=860, default_height=640)
        self.settings = Gio.Settings(schema_id=SCHEMA)
        self.weather = Weather()

        view = Adw.ToolbarView()
        header = Adw.HeaderBar()
        places = Gtk.Button(icon_name="find-location-symbolic", tooltip_text=_("Places"))
        places.connect("clicked", lambda *_: PlacesDialog(self).present(self))
        header.pack_start(places)
        refresh = Gtk.Button(icon_name="view-refresh-symbolic", tooltip_text=_("Refresh"))
        refresh.connect("clicked", lambda *_: self.load())
        header.pack_start(refresh)
        self.unit_button = Gtk.Button(css_classes=["flat"], tooltip_text=_("Units"))
        self.unit_button.connect("clicked", self._toggle_unit)
        header.pack_end(self.unit_button)
        view.add_top_bar(header)

        self.stack = Gtk.Stack(transition_type=Gtk.StackTransitionType.CROSSFADE)
        add = Gtk.Button(label=_("Choose a city"), halign=Gtk.Align.CENTER, css_classes=["pill", "suggested-action"])
        add.connect("clicked", lambda *_: PlacesDialog(self).present(self))
        self.stack.add_named(Adw.StatusPage(icon_name="find-location-symbolic", title=_("Where are you?"),
                                            description=_("Choose a city to see its weather here "
                                                          "and in the desktop widget."), child=add), "empty")
        self.stack.add_named(Adw.Spinner(), "loading")
        retry = Gtk.Button(label=_("Try again"), halign=Gtk.Align.CENTER, css_classes=["pill"])
        retry.connect("clicked", lambda *_: self.load())
        self.stack.add_named(Adw.StatusPage(icon_name="network-offline-symbolic", title=_("No connection"),
                                            description=_("The forecast could not be loaded."), child=retry),
                             "error")
        self.page = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18, margin_top=12, margin_bottom=24,
                            margin_start=18, margin_end=18)
        self.stack.add_named(Gtk.ScrolledWindow(child=Adw.Clamp(child=self.page, maximum_size=760), vexpand=True),
                             "forecast")
        view.set_content(self.stack)
        self.set_content(view)

        self.settings.connect("changed", lambda *_: self.load())
        GLib.timeout_add_seconds(REFRESH_SECONDS, lambda: self.load() or GLib.SOURCE_CONTINUE)
        self.load()

    # --- города -----------------------------------------------------------

    def places(self) -> list[dict]:
        result = []
        for text in self.settings.get_strv("places"):
            try:
                result.append(json.loads(text))
            except ValueError:
                pass
        return result

    def save_places(self, places: list[dict], current: int):
        self.settings.delay()
        self.settings.set_strv("places", [json.dumps(p, ensure_ascii=False) for p in places])
        self.settings.set_int("current", current)
        self.settings.apply()

    def _toggle_unit(self, *_args):
        self.settings.set_string("unit", "f" if self.settings.get_string("unit") == "c" else "c")

    # --- прогноз ----------------------------------------------------------

    def load(self):
        unit = self.settings.get_string("unit")
        self.unit_button.set_label("°F" if unit == "f" else "°C")
        places = self.places()
        if not places:
            self.stack.set_visible_child_name("empty")
            return
        place = places[min(max(self.settings.get_int("current"), 0), len(places) - 1)]
        self.set_title(place["name"])
        if self.stack.get_visible_child_name() != "forecast":
            self.stack.set_visible_child_name("loading")
        self.weather.forecast(place, unit, lambda data: self.show(place, data))

    def show(self, place: dict, data: dict | None):
        if not data or "current" not in data:
            self.stack.set_visible_child_name("error")
            return
        while (child := self.page.get_first_child()) is not None:
            self.page.remove(child)
        now = data["current"]
        text, icon = condition(now["weather_code"], bool(now.get("is_day", 1)))

        # Сейчас: большая температура и значок.
        hero = Gtk.Box(spacing=24, halign=Gtk.Align.CENTER, margin_top=12)
        hero.append(Gtk.Image(icon_name=icon, pixel_size=96, css_classes=["dim-label"]))
        texts = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, valign=Gtk.Align.CENTER)
        texts.append(Gtk.Label(label=f"{round(now['temperature_2m'])}°", xalign=0,
                               css_classes=["hypede-weather-temp"]))
        texts.append(Gtk.Label(label=text, xalign=0, css_classes=["title-3"]))
        where = ", ".join(x for x in (place["name"], place.get("country")) if x)
        texts.append(Gtk.Label(label=where, xalign=0, css_classes=["dim-label"]))
        hero.append(texts)
        self.page.append(hero)

        daily = data["daily"]
        facts = [
            (_("Feels like"), f"{round(now['apparent_temperature'])}°"),
            (_("Humidity"), f"{round(now['relative_humidity_2m'])}%"),
            (_("Wind"), _("%d km/h") % round(now["wind_speed_10m"])),
            (_("Sunrise"), daily["sunrise"][0][-5:]),
            (_("Sunset"), daily["sunset"][0][-5:]),
        ]
        grid = Gtk.FlowBox(selection_mode=Gtk.SelectionMode.NONE, max_children_per_line=5, min_children_per_line=2,
                           homogeneous=True, column_spacing=8, row_spacing=8)
        for title, value in facts:
            card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2, css_classes=["card", "hypede-weather-fact"])
            card.append(Gtk.Label(label=title, css_classes=["caption", "dim-label"]))
            card.append(Gtk.Label(label=value, css_classes=["title-4"]))
            grid.append(card)
        self.page.append(grid)

        # По часам: ближайшие сутки с текущего часа.
        self.page.append(Gtk.Label(label=_("Next 24 hours"), xalign=0, css_classes=["heading"]))
        hourly = data["hourly"]
        start = next((i for i, t in enumerate(hourly["time"]) if t >= now["time"][:13]), 0)
        hours = Gtk.Box(spacing=6)
        for i in range(start, min(start + 24, len(hourly["time"]))):
            cell = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6, css_classes=["card", "hypede-weather-hour"])
            cell.append(Gtk.Label(label=_("Now") if i == start else hourly["time"][i][-5:],
                                  css_classes=["caption", "dim-label"]))
            cell.append(Gtk.Image(icon_name=condition(hourly["weather_code"][i], bool(hourly["is_day"][i]))[1],
                                  pixel_size=24))
            cell.append(Gtk.Label(label=f"{round(hourly['temperature_2m'][i])}°", css_classes=["heading"]))
            rain = hourly["precipitation_probability"][i] or 0
            cell.append(Gtk.Label(label=f"{rain}%" if rain >= 10 else " ", css_classes=["caption", "accent"]))
            hours.append(cell)
        self.page.append(Gtk.ScrolledWindow(child=hours, vscrollbar_policy=Gtk.PolicyType.NEVER,
                                            css_classes=["undershoot-left"]))

        # Неделя.
        self.page.append(Gtk.Label(label=_("7 days"), xalign=0, css_classes=["heading"]))
        days = Gtk.ListBox(css_classes=["boxed-list"], selection_mode=Gtk.SelectionMode.NONE)
        low_all, high_all = min(daily["temperature_2m_min"]), max(daily["temperature_2m_max"])
        for i, date in enumerate(daily["time"]):
            day = GLib.DateTime.new_local(int(date[:4]), int(date[5:7]), int(date[8:10]), 12, 0, 0)
            name = _("Today") if i == 0 else day.format("%A")
            sky, icon = condition(daily["weather_code"][i])
            row = Adw.ActionRow(title=name.capitalize(), subtitle=sky)
            row.add_prefix(Gtk.Image(icon_name=icon, pixel_size=24))
            low, high = daily["temperature_2m_min"][i], daily["temperature_2m_max"][i]
            bar = Gtk.LevelBar(min_value=low_all, max_value=high_all, value=high, valign=Gtk.Align.CENTER,
                               width_request=120)
            bar.set_tooltip_text(f"{round(low)}° … {round(high)}°")
            row.add_suffix(Gtk.Label(label=f"{round(low)}°", css_classes=["dim-label"], width_chars=4))
            row.add_suffix(bar)
            row.add_suffix(Gtk.Label(label=f"{round(high)}°", css_classes=["heading"], width_chars=4))
            days.append(row)
        self.page.append(days)
        self.page.append(Gtk.Label(label=_("Forecast: Open-Meteo.com"), css_classes=["caption", "dim-label"]))
        self.stack.set_visible_child_name("forecast")


CSS = """
.hypede-weather-temp { font-size: 64px; font-weight: 300; }
.hypede-weather-fact { padding: 12px; }
.hypede-weather-hour { padding: 10px 12px; min-width: 52px; }
"""


class Application(Adw.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID)

    def do_startup(self):
        Adw.Application.do_startup(self)
        provider = Gtk.CssProvider()
        provider.load_from_string(CSS)
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider,
                                                  Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

    def do_activate(self):
        window = self.get_active_window() or Window(self)
        window.present()


def main() -> int:
    _setup_i18n()
    return Application().run(sys.argv)
