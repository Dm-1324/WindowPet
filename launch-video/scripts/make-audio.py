"""
Composes the launch video's soundtrack and sound effects from scratch (no samples,
nothing downloaded), so everything here is original and free to use anywhere.

    python scripts/make-audio.py        (needs numpy + scipy)

Writes public/audio/music.wav (45 s) and short effects (pop, boing, whoosh, ...).
"""
import os
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "audio")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)  # fixed seed: same audio every run

BPM = 112
BEAT = 60 / BPM
LENGTH = 45.0


def note_hz(n):
    """MIDI note number -> Hz"""
    return 440.0 * 2 ** ((n - 69) / 12)


def t_of(seconds):
    return np.arange(int(seconds * SR)) / SR


def env(n, attack=0.005, decay=0.3):
    t = np.arange(n) / SR
    a = np.clip(t / attack, 0, 1)
    return a * np.exp(-t / decay)


def pluck(freq, dur=1.2, bright=1.0):
    """ukulele-ish pluck: harmonics that die away faster the higher they are"""
    t = t_of(dur)
    out = np.zeros_like(t)
    for h in range(1, 9):
        amp = (0.9 ** h) / h * (bright if h > 2 else 1)
        out += amp * np.sin(2 * np.pi * freq * h * t) * np.exp(-t * (2.5 + h * 1.8))
    return out * np.clip(t / 0.003, 0, 1)


def marimba(freq, dur=0.9):
    t = t_of(dur)
    body = np.sin(2 * np.pi * freq * t) * np.exp(-t * 4.5)
    tine = 0.35 * np.sin(2 * np.pi * freq * 4 * t) * np.exp(-t * 18)
    return (body + tine) * np.clip(t / 0.002, 0, 1)


def bass(freq, dur):
    t = t_of(dur)
    x = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * freq * 2 * t)
    return np.tanh(1.5 * x) * env(len(t), 0.01, dur * 0.8)


def kick():
    t = t_of(0.3)
    f = 120 * np.exp(-t * 18) + 45
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11)


def band(x, lo, hi):
    sos = butter(2, [lo, hi], btype="band", fs=SR, output="sos")
    return sosfilt(sos, x)


def highpass(x, f):
    return sosfilt(butter(2, f, btype="high", fs=SR, output="sos"), x)


def snare():
    t = t_of(0.2)
    return band(rng.standard_normal(len(t)), 900, 6000) * np.exp(-t * 22) * 0.6 + \
        0.3 * np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)


def hat():
    t = t_of(0.06)
    return highpass(rng.standard_normal(len(t)), 7000) * np.exp(-t * 70) * 0.35


def place(track, sound, at, gain=1.0):
    i = int(at * SR)
    if i >= len(track):
        return
    n = min(len(sound), len(track) - i)
    track[i:i + n] += sound[:n] * gain


def normalize(x, peak=0.9):
    m = np.max(np.abs(x)) or 1
    return x / m * peak


def save(name, x):
    x = np.clip(x, -1, 1)
    wavfile.write(os.path.join(OUT, name), SR, (x * 32767).astype(np.int16))


# ------------------------------------------------------------------ music
# C - G - Am - F, one chord per bar; a sunny, cute loop
CHORDS = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]
ROOTS = [36, 43, 45, 41]
# 2-bar melody phrases in C major pentatonic (note, beat offset, length in beats)
PHRASES = [
    [(76, 0, 1), (79, 1, 0.5), (76, 1.5, 0.5), (74, 2, 1), (72, 3, 1), (74, 4, 1.5), (76, 5.5, 0.5), (79, 6, 2)],
    [(81, 0, 1), (79, 1, 1), (76, 2, 0.5), (74, 2.5, 0.5), (72, 3, 1), (74, 4, 1), (72, 5, 1), (67, 6, 2)],
    [(72, 0, 0.5), (74, 0.5, 0.5), (76, 1, 1), (79, 2, 1), (81, 3, 1), (79, 4, 1), (76, 5, 1), (74, 6, 2)],
    [(76, 0, 1), (74, 1, 1), (72, 2, 1), (69, 3, 1), (72, 4, 2), (67, 6, 0.5), (72, 6.5, 1.5)],
]

n = int(LENGTH * SR)
chords = np.zeros(n)
lows = np.zeros(n)
lead = np.zeros(n)
drums = np.zeros(n)

bars = int(LENGTH / (4 * BEAT)) + 1
for bar in range(bars):
    t0 = bar * 4 * BEAT
    chord = CHORDS[bar % 4]
    intro = bar < 2
    outro = t0 > LENGTH - 6
    # strummed chords: on 1 and 3, plus a light off-beat strum
    for beat, gain in [(0, 1.0), (1.5, 0.45), (2, 0.8), (3.5, 0.45)]:
        for k, note in enumerate(chord + [chord[0] + 12]):
            place(chords, pluck(note_hz(note), 1.4, 0.8), t0 + beat * BEAT + k * 0.012, gain * 0.32)
    if intro:
        continue
    # bass on 1 and 3
    root = note_hz(ROOTS[bar % 4])
    place(lows, bass(root, BEAT * 1.8), t0, 0.55)
    place(lows, bass(root, BEAT * 1.6), t0 + 2 * BEAT, 0.45)
    # melody: phrases cycle every 2 bars, leaving the last bars calm
    if bar % 2 == 0 and not outro:
        for note, off, ln in PHRASES[(bar // 2) % len(PHRASES)]:
            place(lead, marimba(note_hz(note), max(0.5, ln * BEAT * 1.6)), t0 + off * BEAT, 0.42)
    # drums: kick 1 & 3, snare 2 & 4, hats on eighths (thinner in the outro)
    for b in range(4):
        tb = t0 + b * BEAT
        if b in (0, 2):
            place(drums, kick(), tb, 0.8)
        else:
            place(drums, snare(), tb, 0.35)
        if not outro:
            place(drums, hat(), tb, 1)
            place(drums, hat(), tb + BEAT / 2, 0.6)

# simple stereo-free mix + gentle room reverb (a few soft echoes)
mix = 0.9 * chords + 0.8 * lows + 1.0 * lead + 0.7 * drums
echo = np.zeros_like(mix)
for delay, g in [(0.083, 0.18), (0.131, 0.12), (0.197, 0.08)]:
    d = int(delay * SR)
    echo[d:] += mix[:-d] * g
mix = mix + highpass(echo, 300)
# fades: in over 0.3 s, out over the last 3 s
t = np.arange(n) / SR
mix *= np.clip(t / 0.3, 0, 1) * np.clip((LENGTH - t) / 3.0, 0, 1)
save("music.wav", normalize(mix, 0.8))

# ------------------------------------------------------------------ sound effects
def sweep(f0, f1, dur, wobble=0.0):
    t = t_of(dur)
    f = f0 * (f1 / f0) ** (t / dur) * (1 + wobble * np.sin(2 * np.pi * 14 * t))
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


# bubble pop: quick rising blip
t = t_of(0.09)
save("pop.wav", normalize(sweep(700, 1500, 0.09) * np.exp(-t * 30), 0.7))

# landing: springy boing
t = t_of(0.45)
save("boing.wav", normalize(sweep(520, 160, 0.45, 0.08) * np.exp(-t * 6) * np.clip(t / 0.005, 0, 1), 0.75))

# whoosh: filtered noise swelling up and away
t = t_of(0.5)
w = band(rng.standard_normal(len(t)), 400, 3500) * np.sin(np.pi * t / 0.5) ** 2
save("whoosh.wav", normalize(w, 0.5))

# sparkle: little ascending bells
sp = np.zeros(int(0.7 * SR))
for k, note in enumerate([84, 88, 91, 96]):
    place(sp, marimba(note_hz(note), 0.5), k * 0.06, 0.6)
save("sparkle.wav", normalize(sp, 0.55))

# munch: three crunchy bites
mu = np.zeros(int(0.75 * SR))
for k in range(3):
    b = t_of(0.09)
    place(mu, band(rng.standard_normal(len(b)), 300, 2500) * np.exp(-b * 35), k * 0.22, 1)
save("munch.wav", normalize(mu, 0.6))

# ding: soft notification bell
dg = marimba(note_hz(88), 1.0) + 0.6 * marimba(note_hz(95), 1.0)
save("ding.wav", normalize(dg, 0.6))

print("wrote", sorted(os.listdir(OUT)))
