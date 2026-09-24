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

THE LEDGER IS NOT ENOUGH, and that cost a full rebuild. It lives in the sprite
directory and is gitignored, so a tree whose frames are present but whose ledger
is not — a fresh clone that then renders one clip, or any directory the ledger
was cleaned out of — reads as "nothing has been stroked" and strokes all of it a
second time. Measured on the mobile tree when it happened: +14% footprint and
the dark fraction 0.38 -> 0.45 on every clip, which is precisely the black-blob
read the thin outline exists to avoid.

So the file now carries its own mark, in a PNG text chunk that travels with the
image. The ledger stays as the fast path (no decode needed); the mark is the one
that cannot be lost.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, PngImagePlugin
from scipy import ndimage

LEDGER = '.outlined.json'
# Written into every stroked PNG. Survives a lost ledger, a copy and a move.
MARK = 'v65_outlined'

# One pixel at render resolution, which survives the downsample to the atlas as
# a soft edge. Colour is lifted off near-black (was 26,30,20) and warmed, so it
# reads as shadow rather than ink. Alpha lets it blend with what it sits on
# instead of punching a hard silhouette.
WIDTH = 1
COLOUR = (38, 40, 32)
ALPHA = 0.72


def outline(path, width=WIDTH, colour=COLOUR, alpha=ALPHA):
    """Stroke one frame. Returns False if it was already stroked."""
    src = Image.open(path)
    if src.info.get(MARK):
        return False
    im = src.convert('RGBA')
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
    info = PngImagePlugin.PngInfo()
    info.add_text(MARK, str(width))
    Image.fromarray(a.clip(0, 255).astype(np.uint8)).save(path, pnginfo=info)
    return True


def ensure_mark(path):
    """Stamp a file the LEDGER says is stroked but which carries no mark.

    Migration for frames stroked before the mark existed: without this they
    would be marked only on their next re-render, and until then a lost ledger
    could still double-stroke them — which is the whole failure this is for.
    Pixels are untouched; only the text chunk is added.
    """
    im = Image.open(path)
    if im.info.get(MARK):
        return False
    im = im.convert('RGBA')
    info = PngImagePlugin.PngInfo()
    info.add_text(MARK, str(WIDTH))
    im.save(path, pnginfo=info)
    return True


def main(d):
    lp = os.path.join(d, LEDGER)
    done = {}
    if os.path.isfile(lp):
        try:
            done = json.load(open(lp))
        except Exception:
            done = {}
    n = skipped = marked = stamped = 0
    for f in sorted(os.listdir(d)):
        if not f.endswith('.png'):
            continue
        # atlas.png is this pipeline's OUTPUT, not one of its frames. The normal
        # order (render, outline, pack) hides that — pack overwrites whatever
        # this did to it — but run once after a pack and it strokes every cell
        # of the finished sheet a second time. Skip it by name.
        if f == 'atlas.png':
            continue
        p = os.path.join(d, f)
        if done.get(f) == os.path.getmtime(p):
            if ensure_mark(p):
                stamped += 1
                done[f] = os.path.getmtime(p)
            skipped += 1
            continue
        if outline(p):
            n += 1
        else:
            marked += 1          # the ledger had lost it; the file had not
        done[f] = os.path.getmtime(p)
    json.dump(done, open(lp, 'w'))
    print('outlined %d (%d already done, %d already marked, %d stamped) in %s'
          % (n, skipped, marked, stamped, d))


if __name__ == '__main__':
    main(sys.argv[1])
