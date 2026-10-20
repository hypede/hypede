# HypeDE — assistant knowledge base

## What HypeDE is
HypeDE is a Chrome OS-style desktop for Linux (Arch Linux and Arch Linux ARM). Inside is GNOME Shell with the HypeDE extension and its own apps: Files, Settings, Terminal, Passwords, Weather and the AI assistant. Editions: the regular one (ISO for PCs and VirtualBox) and HypeDE Touch for Apple M1+ Macs and iPads (UTM).

## Shelf (taskbar)
The shelf at the bottom: pinned apps, open windows, clock, quick settings. Pin an app: right-click its icon → Pin. Drag icons to reorder. Position, size, opacity, autohide: Settings → Shelf and launcher.

## Launcher (app menu)
Opens with the Super (Windows) key or the circle button on the left of the shelf. Search apps, files and settings, a calculator (type 12*7), web search and "Continue where you left off". Style, icon size, columns: Settings → Shelf and launcher → Launcher.

## Quick settings
Click the clock on the shelf: Wi‑Fi, Bluetooth, volume, brightness, dark style, Night Light, Do not disturb, tablet mode, screenshot. Super+S opens quick settings.

## Dynamic Island
A capsule at the top center: music, downloads, timers, screen recording. Click it for clipboard, file shelf, tools and notes. Position (top or at the shelf): Settings → Personalization → Dynamic Island.

## Windows
Drag a window to a screen edge to fill half the screen, to the top to maximize. Super+Z keeps a window floating on top. Super+Shift+T reopens a window you closed by mistake. Title bar buttons, focus, moving with the Super key: Settings → Personalization → Windows. Genie and jelly animations are there too.

## Overview and desks
Super+W shows all windows and desks. Gestures: four fingers up — launcher, down — desktop; three fingers up — overview, sideways — switch desks. Super+Page Up/Page Down — next desk. Number of desks: Settings → Shelf and launcher → Desktop.

## Clipboard
Super+V opens clipboard history: recent texts, links and colors.

## Screenshots and recording
Print takes a screenshot (area, window or screen, or a video). Screenshots go to Pictures/Screenshots.

## Desktop widgets
Right-click the desktop → Widgets: clock, dot clock, calendar, weather, system, music, note and your own. Drag widgets with the mouse.

## Themes and wallpaper
Settings → Personalization: theme (light/dark, accent color), theme store, wallpaper (light/dark pairs), live wallpaper (waves, bokeh, mesh, aurora). The dark style applies to all apps, including old GTK3 and Qt/KDE ones.

## Tablet mode
Turns on when the keyboard is detached, or manually in quick settings. Windows maximize, the shelf grows, the on-screen keyboard appears.

## Network and Wi‑Fi
Settings → Network. With several Wi‑Fi adapters, pick one in "Adapter": each has its own networks and switch. Click a network and type the password to connect. "Hidden network…" for hidden ones. Ethernet and VPN (WireGuard too) are below. IP addresses and enterprise Wi‑Fi: "Advanced connection settings".

## Bluetooth
Settings → Bluetooth: power, device name, visibility. Put a new device into pairing mode; it appears under "Available devices" — press Pair. With several adapters, choose one at the top. Headphone battery shows next to the name.

## Displays
Settings → Device → Displays. Several displays: a layout you can drag, Join and Mirror modes, turning a display off, the Apply button. For each display: resolution, refresh rate, size, rotation, "Make main". Fractional scaling (125%, 150%) is a switch below.

## Sound
Settings → Device → Sound: output and input device, volume and mute, the volume of each app that plays. Volume above 100% and the sound theme are there too.

## Keyboard and languages
Settings → Device → Keyboard: layouts and input methods, key repeat, keyboard shortcuts (change them or add your own). System language and formats: Settings → System preferences.

## Power
Settings → Device → Power: power mode, battery percentage, dimming and sleep when idle, power button.

## Files
Files: tabs, a details pane, quick search (just start typing), Ctrl+L to type a path. AppImages and programs run on double-click (asked once). "Open in Terminal" is in the folder menu.

## Terminal
HypeDE Terminal: Ctrl+Shift+T new tab, Ctrl+Shift+E split side by side, Ctrl+Shift+O split top and bottom, Alt+arrows between panes, Ctrl+Shift+F find, Ctrl+click opens a link, Ctrl+= and Ctrl+- text size. Colors, font, transparency: menu → Preferences.

## Passwords
Passwords shows keyrings and saved passwords (GNOME Keyring, KeePassXC, KWallet). View, copy, edit and delete passwords, lock a keyring. A copied password is cleared from the clipboard after 45 seconds.

## Weather
Weather: choose a city with the location button to see now, hourly and 7-day forecasts. The desktop weather widget shows the same city. °C/°F is the button at the top right.

## AI assistant
Settings → AI assistant: online providers (Claude, Gemini, Mistral, ChatGPT, Grok, DeepSeek) or "On this computer" — a local Gemma model through llama.cpp that works offline. Super+A asks about the selected text. "Ask…" buttons are in the launcher, Files and Settings.

## Lock screen
Super+L locks. Look (clock, waves, cards, wallpaper blur): Settings → Lock screen.

## Privacy
Settings → Security and privacy: recent files history, emptying the trash, location, camera, microphone, firewall, blocking USB while locked.

## Apps and startup
Settings → Apps: default apps (browser, email, terminal), file types, startup apps, Flatpak permissions. "Tweaks" in the launcher opens Personalization: fonts, icons, cursor, windows, shelf.

## System updates
Update the system in a terminal with "sudo pacman -Syu". Settings → System preferences → Software updates is the graphical module.

## Lite mode for slower computers
Settings → Personalization → Animations and effects → Lite mode: no blur, rounded-corner effect or lock screen waves — faster on old hardware.
