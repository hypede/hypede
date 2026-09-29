<p align="center">
  <img src="docs/images/logo.png" alt="HypeDE" width="420">
</p>

<p align="center">
  <b>GNOME, reshaped into a Chrome OS–style desktop.</b><br>
  A shelf at the bottom, a bubble launcher and a status tray — on an unmodified GNOME Shell.<br>
  Settings built from KDE modules in a Chrome OS interface. A file manager mixing GNOME Files and COSMIC Files.
</p>

<p align="center">
  <a href="https://hypede.github.io">Website</a> ·
  <a href="#install-on-arch-linux-and-cachyos">Install</a> ·
  <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <img src="docs/images/launcher-light.png" alt="HypeDE launcher" width="760">
</p>

---

## What it is

HypeDE is a separate session on top of a **stock** GNOME: no GNOME package is
patched or replaced. Your login screen gets a new “HypeDE” entry, and the
regular GNOME session on the same machine stays exactly as it was.

| Part | Built with | What it does |
|---|---|---|
| **Shell** | GNOME Shell 48–50 + a custom session mode and the `hypede-shell` extension | bottom shelf, launcher ring, pinned and running apps with a running dot, “date + status + clock” tray, quick settings and calendar opening upwards, notifications in the bottom-right corner, shelf autohide, Super opens the launcher |
| **Launcher** | part of the extension | search across apps, settings pages and recent files, a calculator (`12*(3+4)` → 84), web search, “Continue where you left off”, a grid of all apps |
| **Settings** | Qt 6 / QML + **KDE settings modules (KCM)** via KCMUtils | the Chrome OS Settings layout; network, Bluetooth, sound, printers, users, default apps, autostart and Flatpak permissions are real KDE modules embedded in the page; mouse, keyboard, night light, power, wallpaper, theme, accent and shelf are backed by GSettings |
| **Files** | Python + GTK 4 + libadwaita | the GNOME Files layout (sidebar, path bar, search, selection bar) plus tabs and a details pane inspired by COSMIC Files; grid with thumbnails and list view, rubber-band selection, drag and drop, background copy/move with progress and undo, trash with restore |

All wallpapers, icons and texts are **original**. The look follows the layout
and behaviour of Chrome OS, but nothing is taken from Google: its assets and
fonts are proprietary. HypeDE is not affiliated with Google.

## Screenshots

<p align="center">
  <img src="docs/images/files-light.png" alt="Files" width="760">
  <img src="docs/images/settings-light.png" alt="Settings: personalization" width="760">
  <img src="docs/images/settings-kcm-dark.png" alt="A KDE module inside Settings, dark theme" width="760">
  <img src="docs/images/launcher-calc-light.png" alt="Calculator in the launcher" width="760">
  <img src="docs/images/quick-settings-dark.png" alt="Quick settings, dark theme" width="760">
</p>

The screenshots were taken in a real GNOME Shell 50.5 session with KDE
Frameworks 6.30 on Arch Linux using `tools/dev/screenshots.sh` (the interface
language in them is Russian; English is the default).

## Install on Arch Linux and CachyOS

```bash
git clone https://github.com/hypede/hypede
cd hypede/packaging
makepkg -si
```

Log out and pick the **HypeDE** session on the login screen.

The KDE modules are optional. Without one, its row in Settings tells you which
package to install:

```bash
sudo pacman -S plasma-nm bluedevil plasma-pa print-manager plasma-workspace \
               plasma-desktop kde-cli-tools flatpak-kcm kinfocenter power-profiles-daemon
```

The build limits parallel compile jobs to your free memory, so it works on
machines with little RAM; force a value with `JOBS=2 makepkg -si`.

### Other distributions

Build dependencies: `cmake`, `extra-cmake-modules`, Qt 6 (base, declarative,
tools), KDE Frameworks 6 (`kcmutils`, `kcolorscheme`, `kconfig`, `kcoreaddons`)
and `gettext`. Runtime: GNOME Shell 48–50, `gnome-session`, PyGObject,
GTK 4, libadwaita ≥ 1.7, GVfs, Kirigami, `qqc2-desktop-style`, Roboto.

```bash
make
sudo make install
sudo glib-compile-schemas /usr/share/glib-2.0/schemas
```

### Just the shelf, inside regular GNOME

```bash
make install-user
# log out and back in, then:
gnome-extensions enable hypede-shell@hypede.dev
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Super` | launcher (can be switched to the overview in Settings) |
| `Super+S` | window and workspace overview |
| `Super+1…9` | pinned app by position |
| `Super+Space` | next keyboard layout |
| In Files | `Ctrl+T` new tab, `Ctrl+L` location, `Ctrl+F` search, `Ctrl+I` details, `F2` rename, `Ctrl+1/2` grid/list, `F1` shortcuts |

## How it works

```
shell/modes/hypede.json        GNOME Shell mode: top bar → shelf, enabled extensions
shell/extension/…              the extension: shelf, launcher, overview, notifications
shell/theme/stylesheet.css.in  shell theme (light and dark generated from one template)
session/                       login-screen session and gnome-session (systemd) units
data/                          settings schema, session defaults, .desktop files
apps/settings/                 Settings: C++/QML, KCMUtils, GSettings, D-Bus
apps/files/                    Files: Python, GTK 4, libadwaita
po/, tools/i18n/               translations
```

* **The shelf is GNOME's own top bar**, moved to the bottom edge and given new
  content. Struts, fullscreen hiding, keyboard navigation and every system
  indicator (network, sound, Bluetooth, power, screen recording) keep working,
  and third-party indicator extensions need no changes.
* **Session-only defaults.** The session runs with
  `XDG_CURRENT_DESKTOP=HypeDE:GNOME`, and `90_hypede.gschema.override` uses
  `:HypeDE` sections, so fonts, window buttons and wallpaper change only inside
  HypeDE.
* **KDE modules are loaded with `KCModuleLoader`** — the same function
  `kcmshell6` uses — so both QML modules and older widget-based ones (like
  plasma-nm's Connections) are embedded. A KDE colour scheme matching the
  Chrome OS palette follows GNOME's light/dark setting.
* **Files** is built from GTK list models: `Gtk.DirectoryList` → hidden-file
  filter → “folders first” sorter → `Gtk.MultiSelection`, shared by a
  `Gtk.GridView` and a `Gtk.ColumnView`. File operations run in background
  threads through Gio, so `trash://`, `sftp://` and `smb://` work too.

More detail (in Russian) is in [docs/ru](docs/ru).

## Known limitations

* Only KDE modules that talk to standard services are used (NetworkManager,
  BlueZ, PipeWire, CUPS, AccountsService, `mimeapps.list`, XDG autostart,
  Flatpak). Modules that configure KWin, KScreen or PowerDevil would do nothing
  under GNOME, so those pages are implemented on GSettings instead.
* Monitor arrangement still opens GNOME Settings (`gnome-control-center
  display`): Mutter uses its own protocol that the KDE module doesn't speak.
* Pairing Bluetooth devices that need a PIN relies on the bluedevil agent.
* Supports GNOME 48–50; tested on 50.5.

## Development

```bash
make check                        # JS syntax, Files and calculator tests, schema, translations
tools/dev/shell-headless.sh start # GNOME Shell on a virtual monitor (containers, SSH)
tools/dev/screenshots.sh out/     # regenerate all documentation screenshots
```

See [docs/ru/building.md](docs/ru/building.md) for the headless workflow and
translation tooling.

## License

HypeDE is free software, released under the
[GNU General Public License v3.0 or later](LICENSE). The KDE colour schemes in
`apps/settings/colors/` are derived from Breeze.
