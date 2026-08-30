#!/usr/bin/env python3
"""Cut game-ready weapon samples from the Free Firearm Sound Library.

SOURCE AND LICENCE. "The Free Firearm Sound Library" by Ben Jaszczak, Brian
Nelson, Kevin Heras and Matthew Nanney, released CC0 (no rights reserved, no
attribution required) and distributed via OpenGameArt. Kickstarter-funded in
2013 specifically so that game projects could use real firearm recordings
without licensing. See assets/audio/SOURCE.txt.

The originals are 96 kHz 24-bit stereo and several megabytes each — a single
AK-47 take is 12 seconds of range ambience with one shot somewhere in it. This
finds the shot, trims a short window around it, folds to mono, decimates 4:1 to
24 kHz and writes 16-bit PCM. About 20 KB a weapon, which is what makes shipping
real recordings viable at all for a browser game with no build step.

24 kHz rather than 22.05 because 96000 divides by it exactly, so the decimation
is a clean box-filtered 4:1 with no resampling artefacts in the crack.
"""
import os
import struct
import sys
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'audio')
DECIM = 4
TAIL = 0.42          # seconds kept after the onset
PRE = 0.004          # a few ms before it, so the transient is not clipped


def read24(path):
    w = wave.open(path)
    n, ch, sw, sr = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
    raw = w.readframes(n)
    w.close()
    out = []
    step = sw * ch
    for i in range(0, len(raw) - step + 1, step):
        acc = 0
        for c in range(ch):                      # fold to mono
            b = raw[i + c * sw: i + c * sw + sw]
            if sw == 3:
                v = b[0] | (b[1] << 8) | (b[2] << 16)
                if v & 0x800000:
                    v -= 1 << 24
                acc += v / float(1 << 23)
            elif sw == 2:
                v = struct.unpack('<h', b)[0]
                acc += v / 32768.0
        out.append(acc / ch)
    return out, sr


def onset(sig, sr):
    """First sample that crosses most of the way to the file's peak.

    A range recording is near-silence with one very loud event in it, so a
    simple threshold on the global peak finds the shot reliably — no need for
    anything cleverer.
    """
    pk = max(abs(v) for v in sig)
    thr = pk * 0.30
    for i, v in enumerate(sig):
        if abs(v) > thr:
            return max(0, i - int(PRE * sr))
    return 0


def cut(src, name):
    sig, sr = read24(src)
    a = onset(sig, sr)
    b = min(len(sig), a + int(TAIL * sr))
    seg = sig[a:b]
    # box-filter then decimate
    out = []
    for i in range(0, len(seg) - DECIM + 1, DECIM):
        out.append(sum(seg[i:i + DECIM]) / DECIM)
    pk = max(abs(v) for v in out) or 1.0
    out = [v / pk * 0.92 for v in out]           # normalise, leave headroom
    # short fade so the tail does not click when it ends
    fade = int(len(out) * 0.18)
    for i in range(fade):
        out[len(out) - fade + i] *= 1 - (i / float(fade))
    os.makedirs(OUT, exist_ok=True)
    dst = os.path.join(OUT, name + '.wav')
    w = wave.open(dst, 'w')
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(sr // DECIM)
    w.writeframes(b''.join(struct.pack('<h', max(-32768, min(32767, int(v * 32767))))
                           for v in out))
    w.close()
    return dst, len(out) / float(sr // DECIM), os.path.getsize(dst)


if __name__ == '__main__':
    base = sys.argv[1]
    jobs = [
        ('AR-15/D_32P.wav', 'm16'),          # .223 carbine — the M16's family
        ('AK-47/C_28P.wav', 'ak'),
        ('PPSh/P_30P.wav', 'mg'),            # 7.62 sub-gun, closest to a belt gun here
        ('Mosin Nagant/M_21P.wav', 'bolt'),  # sniper and marksman
    ]
    for rel, name in jobs:
        p = os.path.join(base, rel)
        if not os.path.isfile(p):
            print('MISSING %s' % rel)
            continue
        dst, dur, sz = cut(p, name)
        print('%-6s %.2fs %6d bytes  <- %s' % (name, dur, sz, rel))
