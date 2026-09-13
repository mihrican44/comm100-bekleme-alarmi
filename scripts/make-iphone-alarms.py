#!/usr/bin/env python3
"""Generate two original iPhone-style looping alarm WAVs (not Apple assets)."""
import math
import struct
import wave
from pathlib import Path

RATE = 44100
AMP = 22000


def write_wav(path, samples):
    path = Path(path)
    with wave.open(str(path), "w") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        frames = b"".join(struct.pack("<h", max(-32767, min(32767, int(s)))) for s in samples)
        wav.writeframes(frames)


def env_exp(t, dur, tau=0.045):
    if t < 0 or t > dur:
        return 0.0
    attack = min(1.0, t / 0.004)
    return attack * math.exp(-t / tau)


def chirp(t, start, end, dur):
    if t < 0 or t > dur:
        return 0.0
    freq = start + (end - start) * (t / dur)
    phase = 2 * math.pi * (start * t + (end - start) * t * t / (2 * dur))
    return math.sin(phase) * env_exp(t, dur, 0.055)


def mallet(t, freq, dur=0.38):
    if t < 0 or t > dur:
        return 0.0
    a = math.sin(2 * math.pi * freq * t)
    b = 0.35 * math.sin(2 * math.pi * freq * 2 * t)
    c = 0.12 * math.sin(2 * math.pi * freq * 3 * t)
    return (a + b + c) * env_exp(t, dur, 0.11)


def mix_at(buf, start_sample, fn, *args):
    n = len(buf)
    i = start_sample
    while i < n:
        t = (i - start_sample) / RATE
        v = fn(t, *args)
        if v == 0 and t > 0.01:
            break
        buf[i] += v
        i += 1


def iphone1_radar(seconds=2.4):
    """Repeating dual chirp, similar character to iPhone Radar (original)."""
    n = int(RATE * seconds)
    buf = [0.0] * n
    cycle = 0.80
    t = 0.0
    while t < seconds:
        s = int(t * RATE)
        mix_at(buf, s, chirp, 980, 1880, 0.09)
        mix_at(buf, s + int(0.11 * RATE), chirp, 980, 1880, 0.09)
        t += cycle
    peak = max(abs(x) for x in buf) or 1.0
    return [x / peak * AMP for x in buf]


def iphone2_marimba(seconds=2.56):
    """Repeating marimba-like motif in the style of classic phone clock alarms (original notes)."""
    n = int(RATE * seconds)
    buf = [0.0] * n
    # C5 E5 G5 E5  |  C5 E5 G5 C6
    notes = [523.25, 659.25, 783.99, 659.25, 523.25, 659.25, 783.99, 1046.50]
    step = 0.32
    t = 0.0
    i = 0
    while t < seconds:
        freq = notes[i % len(notes)]
        mix_at(buf, int(t * RATE), mallet, freq, 0.42)
        t += step
        i += 1
    peak = max(abs(x) for x in buf) or 1.0
    return [x / peak * AMP for x in buf]


def main():
    out = Path("/workspace/sounds")
    write_wav(out / "iphone1.wav", iphone1_radar())
    write_wav(out / "iphone2.wav", iphone2_marimba())
    print("wrote", out / "iphone1.wav", out / "iphone2.wav")


if __name__ == "__main__":
    main()
