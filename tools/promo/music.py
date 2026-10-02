import numpy as np, wave
SR = 44100; DUR = 30.0; BPM = 120; B = 60 / BPM
N = int(SR * DUR); t = np.arange(N) / SR
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(7)

def add(sig, start, pan=0.0, gain=1.0):
    i = int(start * SR); j = min(N, i + len(sig))
    if i >= N: return
    s = sig[:j - i] * gain
    L[i:j] += s * (1 - max(0, pan)); R[i:j] += s * (1 + min(0, pan))

def env(n, a, d, s=0.0, r=None):
    e = np.ones(n); A = int(a * SR); D = int(d * SR)
    e[:A] = np.linspace(0, 1, A) if A else 1
    if D: e[A:A + D] = np.linspace(1, s, len(e[A:A + D]))
    e[A + D:] = s if s else 0
    if r: R_ = int(r * SR); e[-R_:] *= np.linspace(1, 0, R_)
    return e

def tone(freq, dur, harm=8, decay=1.0, detune=0.0):
    n = int(dur * SR); x = np.arange(n) / SR; out = np.zeros(n)
    for d in ([0] if not detune else [-detune, 0, detune]):
        f = freq * 2 ** (d / 1200)
        for h in range(1, harm + 1):
            if f * h > 16000: break
            out += np.sin(2 * np.pi * f * h * x + h) / h * np.exp(-x * decay * (h ** 0.5))
    return out / (3 if detune else 1)

def hp(sig, cut):
    F = np.fft.rfft(sig); f = np.fft.rfftfreq(len(sig), 1 / SR); F[f < cut] = 0; return np.fft.irfft(F, len(sig))

def lp(sig, cut):
    F = np.fft.rfft(sig); f = np.fft.rfftfreq(len(sig), 1 / SR); F *= 1 / (1 + (f / cut) ** 4); return np.fft.irfft(F, len(sig))

note = lambda n: 440 * 2 ** ((n - 69) / 12)
prog = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
DROP = 3.0; END = 26.5

kick_n = int(0.45 * SR); kx = np.arange(kick_n) / SR
kick = np.sin(2 * np.pi * np.cumsum(45 + 110 * np.exp(-kx * 28)) / SR) * np.exp(-kx * 7)
kick += 0.3 * np.sin(2 * np.pi * 3000 * kx) * np.exp(-kx * 300)
clap = hp(rng.standard_normal(int(0.25 * SR)), 900) * env(int(0.25 * SR), 0.002, 0.2) * 0.5
hat = hp(rng.standard_normal(int(0.06 * SR)), 7000) * env(int(0.06 * SR), 0.001, 0.055) * 0.35
duck = np.ones(N)
for k in np.arange(DROP, END, B):
    add(kick, k, gain=0.9)
    i = int(k * SR); m = min(N, i + int(0.3 * SR)); duck[i:m] = np.minimum(duck[i:m], 1 - 0.7 * np.exp(-np.arange(m - i) / SR * 9))
    add(hat, k + B / 2, pan=0.3, gain=0.8)
    add(hat * 0.5, k + B / 4, pan=-0.3); add(hat * 0.5, k + 3 * B / 4, pan=-0.3)
for k in np.arange(DROP + B, END, 2 * B):
    add(clap, k, gain=0.8)

pad = np.zeros(N); bass = np.zeros(N)
for bar in range(15):
    s = bar * 2.0; ch = prog[bar % 4]
    for n_ in ch:
        x = tone(note(n_), 2.05, harm=10, decay=0.25, detune=9) * env(int(2.05 * SR), 0.25, 0.3, 0.75, 0.3)
        i = int(s * SR); j = min(N, i + len(x)); pad[i:j] += x[:j - i] * 0.16
    if s >= DROP - 0.01 and s < END:
        for b8 in range(8):
            x = tone(note(ch[0] - 24), 0.24, harm=7, decay=6) * env(int(0.24 * SR), 0.004, 0.2)
            i = int((s + b8 * B / 2) * SR); j = min(N, i + len(x)); bass[i:j] += x[:j - i] * 0.55
pad = lp(pad, 2400); L += pad * duck; R += pad * duck
L += bass * duck; R += bass * duck

arp_pattern = [0, 1, 2, 1, 2, 0, 2, 1]
for k_i, k in enumerate(np.arange(5.5, END, B / 2)):
    ch = prog[int(k // 2) % 4]; n_ = ch[arp_pattern[k_i % 8]] + 12 + (12 if k_i % 16 >= 12 else 0)
    x = tone(note(n_), 0.35, harm=6, decay=9)
    add(x, k, pan=0.35 * np.sin(k_i), gain=0.13)

rise_n = int(2.6 * SR); rx = np.arange(rise_n) / SR
noise = rng.standard_normal(rise_n)
riser = np.zeros(rise_n)
for blk in range(26):
    a = blk * rise_n // 26; b = (blk + 1) * rise_n // 26
    riser[a:b] = hp(noise[a:b], 300 + blk * 380)
riser *= (rx / rx[-1]) ** 2 * 0.35
add(riser, DROP - 2.6, gain=1)
impact = lp(rng.standard_normal(int(2.0 * SR)), 900) * env(int(2.0 * SR), 0.002, 1.9) * 0.5
impact += np.sin(2 * np.pi * 40 * np.arange(int(2.0 * SR)) / SR) * env(int(2.0 * SR), 0.002, 1.2)
add(impact, DROP, gain=0.8)
for cut in [5.5, 9.0, 12.0, 15.0, 18.0, 21.0, 24.0, 26.5]:
    w = hp(rng.standard_normal(int(0.5 * SR)), 2500) * np.hanning(int(0.5 * SR)) * 0.18
    add(w, cut - 0.25, pan=0.5 if int(cut) % 2 else -0.5)
add(impact, END, gain=0.9)
for n_ in [57, 64, 69, 72, 76]:
    add(tone(note(n_), 3.4, harm=8, decay=0.9, detune=6) * env(int(3.4 * SR), 0.01, 3.3) * 0.18, END)

ir_n = int(1.6 * SR); ir = rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / SR * 3.2); ir[0] = 0
def reverb(x):
    n = len(x) + ir_n
    return np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(ir, n), n)[:len(x)] * 0.012
L, R = L + reverb(L), R + reverb(R)
fade = np.ones(N); fi = int(29.0 * SR); fade[fi:] = np.linspace(1, 0, N - fi)
st = np.stack([L, R], 1) * fade[:, None]
st = np.tanh(st / np.abs(st).max() * 1.6) * 0.89
with wave.open("/tmp/vs/music.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype("<i2").tobytes())
print("ok")
