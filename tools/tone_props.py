#!/usr/bin/env python3
"""Bring rendered props into the game's palette and line treatment.

Straight out of Blender the scenery is far more saturated than the troops —
vivid green palms and orange timber beside muted olive soldiers. Same camera,
wrong palette, and it still reads as two art sets. This desaturates, darkens and
warms them onto the game's dusty range, then strokes the same dark outline the
soldiers carry so the line weight matches too.

Idempotent via a ledger, exactly like tools/outline_sprites.py — running it twice
would double-tone and double-stroke.

The ledger keys on a CONTENT HASH, not mtime. It used to key on mtime, which git
does not preserve: after a fresh clone every prop looked untoned, so the next run
would have re-graded and re-stroked all of them — 0.80 applied twice is 0.64, and
a second 4px rim on top of the first is an 8px black border. The guard existed
and did not hold.
"""
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

LEDGER = '.toned.json'
# THE PROPS WERE STILL INKED. The sprite pipeline moved off a hard keyline a
# while back — see the long note at the top of tools/outline_sprites.py, which
# measured a 3px black rim turning 6.7% dark pixels into 36.4% — but this file
# was left stroking every prop with FOUR pixels of near-black at full alpha.
#
# So the soldiers were being lit and separated by their rim light while the
# scenery around them carried a cartoon outline: two art languages in one frame,
# and the reason the new Huey read as a sticker rather than an aircraft.
#
# Same treatment as the sprites now: one pixel, lifted off black and warmed so
# it reads as contact shadow, at partial alpha so it blends instead of punching
# a silhouette. Props render at 512 and draw far smaller, so one pixel here is
# a fraction of a pixel on screen — which is the point.
OUTLINE = (38, 40, 32)
OUTLINE_ALPHA = 0.72

# Per-prop correction, applied after the global grade. The donor sandbags are a
# pale grey that reads as a heap of pebbles rather than filled hessian; they need
# to come down and go warm. (mul, warm-shift)
# (mul, warm-shift) or (mul, warm-shift, sat_keep) to override the global
# saturation pull for one prop.
FIXUP = {
    # Measured at Lmean 119-121, the BRIGHTEST things in the whole prop set —
    # brighter than sky-lit palm fronds — and in frame they read as heaps of
    # eggs rather than filled hessian. 0.74 was not nearly enough.
    'sandbags_pile': (0.56, (0.048, 0.028, -0.010)),
    'sandbag_wall':  (0.56, (0.048, 0.028, -0.010)),
    'sandbags_row':  (0.59, (0.044, 0.026, -0.008)),
    'sandbag_one':   (0.59, (0.044, 0.026, -0.008)),
    # The donor palms are near-fully-saturated tropical green. Measured after the
    # global grade at 0.66-0.68 saturation against 0.25-0.37 for every other prop,
    # with green running 14-17 points above red — the only vivid thing in a dusty
    # frame, and the first thing the eye went to. palm_a took the global grade
    # well; b/c/d start much greener and need their own pull.
    # palm_a is the ONE palm with a pink trunk. Measured against its siblings it
    # sits at hue 15 degrees where palm_b/c/d are all at 32.3, and comes out
    # 80/58/50 against their 57/49/37 — lighter and redder, in the prop that
    # appears most often on the palm maps. Everything else in the frame agreed
    # about the palette and this one did not.
    # Tuning note: a first attempt at (0.74, +0.026 green, sat 0.30) overshot to
    # hue 60 and 42/43/32 — yellow and too dark. `sat_keep` runs BEFORE the
    # multiply, so pulling saturation to 0.30 collapsed the red channel first
    # and then everything got darkened on top of it.
    # RE-TUNED after the outline came off. These numbers were set while a 4px
    # black rim covered ~45% of every frond, which dragged the measured
    # saturation of palm_b/c/d down to 0.33 and made them look corrected. With
    # the rim gone they measure 0.66-0.68 against a 0.34 median across the prop
    # set — the most saturated things in the game by a factor of two — and in
    # frame they read as bright plastic leaves pasted over a muted field.
    'palm_a':        (0.88, (0.018, 0.004, -0.004), 0.42),
    'palm_b':        (0.50, (0.026, 0.016, 0.006), 0.22),
    'palm_c':        (0.50, (0.026, 0.016, 0.006), 0.22),
    'palm_d':        (0.50, (0.026, 0.016, 0.006), 0.22),
    # the broadleaf ground cover came up the same way once the rim went
    'bush_low':      (0.74, (0.020, 0.014, 0.004), 0.30),
    'vine_a':        (0.74, (0.020, 0.014, 0.004), 0.30),
    'banana_a':      (0.72, (0.022, 0.014, 0.004), 0.30),
    'fern_a':        (0.78, (0.018, 0.012, 0.004), 0.32),
    # At Lmean 83 this was the palest thing on the ground and scattered bright
    # straw across the field at random — noise where the frame needs structure.
    'grass_a':       (0.78, (0.014, 0.010, 0.002)),
    # Measured at Lmean 108-120 and saturation up to 0.49, against 57-91 / 0.20-0.37
    # for every other prop. Sunlit thatch and timber SHOULD be the light accent in
    # a frame of olive foliage — that part is right and is kept — but at these
    # values they stopped being an accent and became the brightest, most
    # saturated thing on screen, reading as pale blocks pasted into the shot. The
    # stone in `hut_c` and `village_row` went further and read as poured concrete.
    # Pulled down and desaturated toward the field without losing the contrast
    # that makes a building legible against the treeline.
    'hut_a':         (0.80, (0.026, 0.016, 0.002), 0.42),
    'hut_b':         (0.80, (0.026, 0.016, 0.002), 0.42),
    'hut_c':         (0.76, (0.022, 0.014, 0.002), 0.40),
    'village_row':   (0.76, (0.022, 0.014, 0.002), 0.44),
    'frame_a':       (0.82, (0.024, 0.015, 0.002), 0.46),
    'frame_b':       (0.82, (0.024, 0.015, 0.002), 0.46),
    'frame_c':       (0.82, (0.024, 0.015, 0.002), 0.46),
    'stall':         (0.84, (0.024, 0.015, 0.002), 0.48),
    'rock':          (0.86, (0.020, 0.014, 0.004)),
    # the APC came out a pale grey slab next to olive infantry; armour should sit
    # DARKER than the men it carries, not lighter
    'm113':          (0.66, (-0.010, 0.004, -0.014)),
    'watchtower':    (0.88, (0.020, 0.012, 0.000)),
}


def tone(a, fix=None):
    rgb = a[:, :, :3].astype(np.float32) / 255.0
    mx = rgb.max(axis=2); mn = rgb.min(axis=2)
    lum = (0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2])
    # Pull saturation back, but not to grey. The first pass at 0.46 took the warmth
    # out of the timber and the earth out of the sandbags — huts read as concrete
    # and sandbag walls as pale boulders. Keep more of the colour and lean the
    # residue warm.
    sat_keep = fix[2] if (fix and len(fix) > 2) else 0.66
    for c in range(3):
        rgb[:, :, c] = lum + (rgb[:, :, c] - lum) * sat_keep
    rgb *= 0.80
    # dust and dry earth, so scenery shares the field's cast
    rgb[:, :, 0] += 0.045; rgb[:, :, 1] += 0.032; rgb[:, :, 2] += 0.008
    if fix:
        mul, warm = fix[0], fix[1]
        rgb *= mul
        for c in range(3):
            rgb[:, :, c] += warm[c]
    np.clip(rgb, 0, 1, out=rgb)
    a[:, :, :3] = (rgb * 255).astype(np.uint8)
    return a


def process(path, width=1):
    im = Image.open(path).convert('RGBA')
    a = np.array(im).astype(np.float32)
    a = tone(a.astype(np.uint8), FIXUP.get(os.path.splitext(os.path.basename(path))[0]))
    a = a.astype(np.float32)
    solid = a[:, :, 3] > 110
    grown = ndimage.binary_dilation(solid, np.ones((3, 3)), iterations=width)
    rim = grown & ~solid
    if rim.any():
        for c in range(3):
            a[:, :, c][rim] = OUTLINE[c]
        a[:, :, 3][rim] = 255.0 * OUTLINE_ALPHA
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(path)


def digest(p):
    h = hashlib.sha1()
    with open(p, 'rb') as f:
        for blk in iter(lambda: f.read(1 << 16), b''):
            h.update(blk)
    return h.hexdigest()


def main(d):
    lp = os.path.join(d, LEDGER)
    done = {}
    if os.path.isfile(lp):
        try:
            done = json.load(open(lp))
        except Exception:
            done = {}
    n = skipped = 0
    for f in sorted(os.listdir(d)):
        if not f.endswith('.png'):
            continue
        p = os.path.join(d, f)
        if done.get(f) == digest(p):
            skipped += 1
            continue
        process(p)
        done[f] = digest(p)
        n += 1
    json.dump(done, open(lp, 'w'))
    print('toned %d (%d already done) in %s' % (n, skipped, d))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'assets/props')
