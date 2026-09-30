#!/usr/bin/env python3
"""Синтезирует звуковую тему HypeDE (data/sounds/hypede).

Все звуки собраны здесь из синусоид и шума — без чужих записей, поэтому их
можно свободно распространять вместе с HypeDE. Тембр — мягкая «маримба»
и стекло, как у системных звуков Chrome OS: короткие, негромкие,
без резких атак.

    python3 tools/gen-sounds.py            # WAV в data/sounds/hypede/stereo
    python3 tools/gen-sounds.py --oga      # то же, но сжать в Ogg Vorbis (нужен ffmpeg)

Имена файлов — по спецификации freedesktop (desktop-login, message-new-instant…),
поэтому звуки подхватывают GNOME Shell, gsd-media-keys и приложения.
"""

from pathlib import Path
import subprocess
import sys
import wave

import numpy as np

RATE = 44100
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/sounds/hypede"
RNG = np.random.default_rng(7)


def note(name: str) -> float:
    names = {"C": -9, "C#": -8, "D": -7, "D#": -6, "E": -5, "F": -4, "F#": -3,
             "G": -2, "G#": -1, "A": 0, "A#": 1, "B": 2}
    octave = int(name[-1])
    return 440.0 * 2 ** ((names[name[:-1]] + (octave - 4) * 12) / 12)


def t(duration: float) -> np.ndarray:
    return np.arange(int(RATE * duration)) / RATE


def envelope(n: int, attack: float, decay: float) -> np.ndarray:
    x = np.arange(n) / RATE
    env = np.exp(-x / decay)
    a = max(1, int(RATE * attack))
    env[:a] *= np.linspace(0, 1, a) ** 0.5
    return env


def marimba(freq: float, duration: float = 0.9, decay: float = 0.28) -> np.ndarray:
    """Деревянный молоточек: основной тон и быстро гаснущие обертоны."""
    x = t(duration)
    out = np.zeros_like(x)
    for ratio, amp, dk in ((1.0, 1.0, decay), (3.93, 0.28, decay / 4), (9.2, 0.08, decay / 9)):
        out += amp * np.sin(2 * np.pi * freq * ratio * x) * np.exp(-x / dk)
    a = int(RATE * 0.004)
    out[:a] *= np.linspace(0, 1, a)
    return out


def glass(freq: float, duration: float = 1.0, decay: float = 0.45) -> np.ndarray:
    """Стеклянный колокольчик: чистый тон с лёгким биением."""
    x = t(duration)
    out = (np.sin(2 * np.pi * freq * x) + 0.35 * np.sin(2 * np.pi * freq * 2.0 * x + 0.3)
           + 0.12 * np.sin(2 * np.pi * freq * 3.01 * x))
    out *= 1 + 0.06 * np.sin(2 * np.pi * 5 * x)
    return out * envelope(len(x), 0.006, decay)


def noise(duration: float) -> np.ndarray:
    return RNG.uniform(-1, 1, int(RATE * duration))


def lowpass(signal: np.ndarray, cutoff) -> np.ndarray:
    """Однополюсный фильтр; cutoff — число или массив (частота во времени)."""
    cut = np.broadcast_to(np.asarray(cutoff, dtype=float), signal.shape)
    alpha = 1 - np.exp(-2 * np.pi * cut / RATE)
    out = np.empty_like(signal)
    acc = 0.0
    for i, (s, a) in enumerate(zip(signal, alpha)):
        acc += a * (s - acc)
        out[i] = acc
    return out


def sequence(parts, total: float) -> np.ndarray:
    """parts: [(время начала, сигнал, громкость)]."""
    out = np.zeros(int(RATE * total))
    for start, sig, gain in parts:
        i = int(RATE * start)
        j = min(len(out), i + len(sig))
        out[i:j] += gain * sig[: j - i]
    return out


def room(signal: np.ndarray, mix: float = 0.18) -> np.ndarray:
    """Лёгкое эхо небольшой комнаты."""
    out = signal.copy()
    for delay, gain in ((0.031, 0.5), (0.047, 0.35), (0.083, 0.22), (0.121, 0.12)):
        d = int(RATE * delay)
        out[d:] += mix * gain * signal[:-d]
    return out


def stereo(signal: np.ndarray, width: float = 0.004) -> np.ndarray:
    d = int(RATE * width)
    left = signal
    right = np.concatenate([np.zeros(d), signal[:-d]]) if d else signal
    return np.stack([left, right], axis=1)


def finish(signal: np.ndarray, peak: float = 0.5) -> np.ndarray:
    signal = signal / (np.max(np.abs(signal)) or 1) * peak
    fade = int(RATE * 0.02)
    signal[-fade:] *= np.linspace(1, 0, fade)
    return signal


SOUNDS = {}


def sound(name):
    def register(func):
        SOUNDS[name] = func
        return func
    return register


@sound("desktop-login")
def _login():
    notes = ["C5", "E5", "G5", "C6", "E6"]
    parts = [(i * 0.085, marimba(note(n), 1.4, 0.4), 1 - i * 0.08) for i, n in enumerate(notes)]
    parts.append((0.38, glass(note("G6"), 1.4, 0.6), 0.25))
    return finish(room(sequence(parts, 1.9), 0.25), 0.55)


@sound("desktop-logout")
def _logout():
    parts = [(i * 0.1, marimba(note(n), 1.0, 0.35), 1.0) for i, n in enumerate(["G5", "E5", "C5"])]
    return finish(room(sequence(parts, 1.3)), 0.45)


@sound("message-new-instant")
def _message():
    parts = [(0, glass(note("E6"), 0.6, 0.22), 1.0), (0.09, glass(note("B5"), 0.7, 0.28), 0.8)]
    return finish(room(sequence(parts, 0.8)), 0.4)


SOUNDS["message"] = SOUNDS["message-new-instant"]


@sound("bell")
def _bell():
    return finish(room(glass(note("C6"), 0.5, 0.16)), 0.35)


@sound("dialog-information")
def _info():
    return finish(room(sequence([(0, marimba(note("A5"), 0.6, 0.2), 1)], 0.6)), 0.35)


@sound("dialog-warning")
def _warning():
    parts = [(0, marimba(note("A4"), 0.5, 0.18), 1), (0.14, marimba(note("A4"), 0.6, 0.2), 0.9)]
    return finish(room(sequence(parts, 0.8)), 0.45)


@sound("dialog-error")
def _error():
    parts = [(0, marimba(note("F4"), 0.6, 0.2), 1), (0.13, marimba(note("D4"), 0.8, 0.26), 1)]
    return finish(room(sequence(parts, 1.0)), 0.5)


@sound("device-added")
def _added():
    parts = [(0, marimba(note("G5"), 0.6, 0.2), 1), (0.08, marimba(note("D6"), 0.7, 0.24), 0.9)]
    return finish(room(sequence(parts, 0.8)), 0.4)


@sound("device-removed")
def _removed():
    parts = [(0, marimba(note("D6"), 0.6, 0.2), 0.9), (0.08, marimba(note("G5"), 0.7, 0.24), 1)]
    return finish(room(sequence(parts, 0.8)), 0.4)


@sound("power-plug")
def _plug():
    parts = [(0, glass(note("C6"), 0.5, 0.15), 1), (0.07, glass(note("G6"), 0.6, 0.2), 0.8)]
    return finish(room(sequence(parts, 0.7)), 0.35)


@sound("power-unplug")
def _unplug():
    parts = [(0, glass(note("G6"), 0.5, 0.15), 0.8), (0.07, glass(note("C6"), 0.6, 0.2), 1)]
    return finish(room(sequence(parts, 0.7)), 0.35)


@sound("battery-low")
def _battery():
    parts = [(i * 0.16, marimba(note("E4"), 0.4, 0.12), 1) for i in range(3)]
    return finish(room(sequence(parts, 0.9)), 0.45)


@sound("complete")
def _complete():
    parts = [(0, marimba(note("C6"), 0.7, 0.25), 1), (0.1, marimba(note("G6"), 0.9, 0.3), 0.8)]
    return finish(room(sequence(parts, 1.0)), 0.4)


@sound("audio-volume-change")
def _volume():
    return finish(marimba(note("A5"), 0.12, 0.035), 0.3)


@sound("screen-capture")
def _capture():
    x = t(0.22)
    click = noise(0.22) * np.exp(-x / 0.012)
    click = lowpass(click, 6000)
    second = np.zeros_like(click)
    d = int(RATE * 0.07)
    second[d:] = click[:-d] * 0.7
    return finish(room(click + second, 0.1), 0.45)


SOUNDS["camera-shutter"] = SOUNDS["screen-capture"]


@sound("trash-empty")
def _trash():
    x = t(0.55)
    sig = noise(0.55) * np.exp(-x / 0.18) * (1 - np.exp(-x / 0.02))
    sig = lowpass(sig, 1800 + 2500 * np.exp(-x / 0.15))
    return finish(room(sig, 0.1), 0.4)


# ----- свои звуки HypeDE: блокировка и приветствие -----

@sound("hypede-lock")
def _lock():
    x = t(0.6)
    thock = np.sin(2 * np.pi * 140 * x) * np.exp(-x / 0.06)
    parts = [(0, thock, 0.8), (0.02, marimba(note("G5"), 0.5, 0.15), 0.5), (0.1, marimba(note("C5"), 0.6, 0.2), 0.6)]
    return finish(room(sequence(parts, 0.7)), 0.4)


@sound("hypede-unlock")
def _unlock():
    parts = [(0, marimba(note("C5"), 0.5, 0.15), 0.6), (0.07, marimba(note("G5"), 0.6, 0.2), 0.7),
             (0.14, glass(note("C7"), 0.7, 0.2), 0.2)]
    return finish(room(sequence(parts, 0.9)), 0.4)


@sound("hypede-type")
def _type():
    x = t(0.06)
    tick = lowpass(noise(0.06), 3500) * np.exp(-x / 0.008)
    tone = np.sin(2 * np.pi * 1900 * x) * np.exp(-x / 0.01) * 0.3
    return finish(tick + tone, 0.16)


@sound("hypede-swoosh")
def _swoosh():
    x = t(1.3)
    shape = np.sin(np.pi * np.clip(x / 1.2, 0, 1)) ** 2
    sig = noise(1.3) * shape
    sig = lowpass(sig, 400 + 3200 * shape)
    return finish(room(sig, 0.25), 0.3)


def write_wav(path: Path, samples: np.ndarray) -> None:
    data = (np.clip(stereo(samples), -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(data.tobytes())


INDEX = """[Sound Theme]
Name=HypeDE
Comment=Soft system sounds for HypeDE
Inherits=freedesktop
Directories=stereo

[stereo]
OutputProfile=stereo
"""


def main() -> int:
    compress = "--oga" in sys.argv
    folder = OUT / "stereo"
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.iterdir():
        old.unlink()
    for name, func in SOUNDS.items():
        wav = folder / f"{name}.wav"
        write_wav(wav, func())
        if compress:
            oga = folder / f"{name}.oga"
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav),
                            "-c:a", "libvorbis", "-q:a", "4", str(oga)], check=True)
            wav.unlink()
    (OUT / "index.theme").write_text(INDEX)
    print(f"звуков: {len(SOUNDS)} → {folder.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
