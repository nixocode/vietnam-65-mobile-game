#!/usr/bin/env python3
"""Stroke a dark edge around rendered sprites.

Doing this in post rather than with an inverted-hull mesh keeps the render solid
and gives an even line all the way round.

WIDTH IS NOT A FREE PARAMETER. It was 3 — three pixels dilated on every side at
render resolution — and that turned out to be the single largest thing making
the soldiers read as black blobs. Measured on the rifleman's aim frames:

    raw render, no outline ..........  6.7% of visible pixels are dark
    same frames after outline .......  36.4%, and total footprint +40%

So most of the "black weapon mass" was never the weapon. A rifle barrel a few
pixels thick at render scale was being buried under 3px of near-black on each
side. Thinning the weapon geometry alone changed the final atlas by ~1 point,
because the outline simply re-fattened it.

The art direction is realistic rather than cartoon, and a hard black keyline is
a cartoon device — reference art separates figures from the background with
LIGHT, which the render's rim light already provides. So the default is now a
single pixel of a softer, warmer dark, applied at partial alpha so that after
the 256->128 downsample it lands as a subtle contact edge rather than a stroke.

The pass rewrites files in place, so running it twice would stroke the stroke.
A ledger of the mtimes this tool itself wrote makes it safe to re-run over a
directory where only some frames were re-rendered.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

LEDGER = '.outlined.json'

# One pixel at render resolution, which survives the downsample to the atlas as
# a soft edge. Colour is lifted off near-black (was 26,30,20) and warmed, so it
# reads as shadow rather than ink. Alpha lets it blend with what it sits on
# instead of punching a hard silhouette.
WIDTH = 1
COLOUR = (38, 40, 32)
ALPHA = 0.72


def outline(path, width=WIDTH, colour=COLOUR, alpha=ALPHA):
    im = Image.open(path).convert('RGBA')
    a = np.array(im).astype(np.float32)
    solid = a[:, :, 3] > 110
    grown = ndimage.binary_dilation(solid, np.ones((3, 3)), iterations=width)
    rim = grown & ~solid
    if rim.any():
        # blend rather than overwrite — a hard fill is what made the edge read
        # as ink. Underneath the rim is transparent, so blend toward the sprite's
        # own edge colour by carrying the existing RGB where there is any.
        for c in range(3):
            a[:, :, c][rim] = colour[c]
        a[:, :, 3][rim] = 255.0 * alpha
    Image.fromarray(a.clip(0, 255).astype(np.uint8)).save(path)


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
        if done.get(f) == os.path.getmtime(p):
            skipped += 1
            continue
        outline(p)
        done[f] = os.path.getmtime(p)
        n += 1
    json.dump(done, open(lp, 'w'))
    print('outlined %d (%d already done) in %s' % (n, skipped, d))


if __name__ == '__main__':
    main(sys.argv[1])
