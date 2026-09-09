"""Pack rendered 3D sprite frames into one atlas per unit.

Every frame comes off the same locked orthographic camera, so all frames share
one anchor by construction, and the atlas keeps that property by never cropping
PER FRAME. The fixed band trimmed below is a different thing: the same rows are
removed from every frame of every unit, so the shared anchor survives intact —
it is only the constant `CROP_Y` offset applied to `groundY` and the muzzle
points. Per-frame tight-bboxing is what makes sprites flicker, and it stays
banned (see SPRITE_PIPELINE.md).

The game needs two numbers to place a sprite: where the ground plane sits in a
cell, and how many pixels tall the figure's reference height is. Both fall out
of the camera setup rather than being measured off pixels, so they stay exact
even when a frame's silhouette does not touch the ground (a mid-air run frame).

Run:  python3 tools/pack_sprites3d.py
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'sprites3d')
# Atlas cell size. Soldiers draw at ~84-110px, so 128 is still oversampled, and
# dropping from 160 pays for the extra animation frames without growing the
# texture a browser has to hold — the new sheets are SMALLER than the old ones.
CELL = 128

# The figure never fills a square cell. Measured across ALL TWELVE units with
# `melee` and `prone` excluded, content spans y 18-122 of 128 — a quarter of
# every cell is empty air above the head and below the boots, and the browser
# holds all of it. Cropping to a 112-row band takes the atlas set from 96 MB to
# 84, which is what pays for the extra walk frames that fix the animation jank.
#
# Measure before changing this: rifleman is the TIGHTEST unit at 92 rows and
# using it alone would have clipped `rpgman` and `marksman`, which need 105.
# Horizontally there is nothing to win — `death` reaches x=0 and `dive` x=127.
CELL_H = 112
CROP_Y = 14                    # covers rows 14-125: 4 spare above, 3 below

# Rendered for every unit and never drawn.
#   melee — appears only as a key in the URGENT table in js/sprite3d.js; no code
#           path ever selects it.
# `prone` and `kneel` USED to be here, and are not any more.
#
# They were skipped because the only versions that existed were hand-posed and
# broken, so the game borrowed frames of `dive` for both. That borrowing was the
# whole posture system: `kneel` and `prone` resolved to the SAME frame — dive 0
# — and differed only by the renderer drawing one of them lower. One of the two
# was, for a long time, dive frame 1, which is a man mid-somersault, and that is
# what the owner kept reporting as barrel-rolling in firefights.
#
# Both are now REAL rendered clips, retargeted from the `Duck` action in
# weapons.glb. They are 9 frames a unit between them and they stay on mobile:
# this is posture, not variety, and it is the thing the game most visibly
# lacked. See FOREIGN in render_model_sprites.py.
SKIP = {'melee',
        # MOBILE. Two more clips that cost memory and earn almost nothing.
        # Measured screen-share over a full match: idle2 3.7%, hit2 0.1%.
        # `idle2` is a SECOND at-rest pose that men drift between so a line of
        # troops is not one loop; `hit2` is a second flinch. Both are variety on
        # top of a pose that already exists, and variety is the first thing to
        # go when the budget is a phone's texture memory.
        'idle2', 'hit2'}

# MOBILE FRAME BUDGET — subsample, do not re-render.
#
# The desktop atlas is 135 frames a unit and 7.4 MB decoded; twelve of them is
# 89 MB, which is half the reason a phone kills the tab. These caps are set from
# the measured share of screen time each clip actually occupies:
#
#     run 76.7%   aim 12.1%   idle 2.6%   walk 1.5%   dive 1.3%   runfire 0.9%
#
# so `run` and `aim` are untouched and the cuts land where nobody is looking.
#
# Frames are SUBSAMPLED evenly from what was rendered rather than re-rendered at
# a lower count: a walk cycle sampled 12-of-28 keeps its full range of motion
# and loses only temporal resolution, where a 12-frame re-render would have to
# be authored and could drift from the desktop art.
#
# `dive` is capped at 2 because only frames 0 and 1 are reachable — frame 0 is
# the kneel, frame 1 is prone, and the stance transition runs between them.
# Frames 2-8 are the donor's barrel roll and no code path can select them, so
# they are 7 dead frames a unit in the desktop build as well.
MOBILE_FRAMES = {'walk': 12, 'runfire': 10, 'death': 8, 'throw': 6, 'dive': 2,
                 'fallback': 8, 'rest': 4}

# Clips that must keep their FIRST n frames rather than an even spread.
#
# `dive` is the whole reason this exists. An even 2-of-9 sample returns frames
# 0 and 8 — and frame 8 is deep in the donor's barrel roll, so prone soldiers
# would have shipped mid-somersault. The two frames the game actually selects
# are 0 (kneel) and 1 (prone); everything after them is unreachable.
HEAD_ONLY = {'dive'}


def _subsample(frames, want, clip=None):
    """Evenly spaced pick that always keeps the first frame.

    A looping clip must keep frame 0 as its phase origin, and an even stride
    keeps the motion's extremes rather than clustering on one part of the cycle.
    """
    n = len(frames)
    if want is None or want >= n:
        return frames
    if clip in HEAD_ONLY:
        return frames[:want]
    if want <= 1:
        return [frames[0]]
    step = (n - 1) / float(want - 1)
    return [frames[int(round(i * step))] for i in range(want)]

# Fallback only. The render writes its actual camera into index.json, and that
# is what gets used — the two must never be able to drift apart.
FIG_H, ORTHO, CAM_Z = 1.8, 1.8 * 1.5, 1.8 * 0.52

# clip playback order is fixed so a frame index means the same thing everywhere
CLIP_ORDER = ['idle', 'idle2', 'walk', 'run', 'runfire', 'aim', 'fire',
              'hit', 'hit2', 'death', 'prone', 'kneel', 'throw', 'dive',
              'melee', 'fallback', 'rest']


def pack(unit):
    d = os.path.join(SRC, unit)
    ij = os.path.join(d, 'index.json')
    if not os.path.isfile(ij):
        return None
    idx = json.load(open(ij))
    res = idx.get('res', 256)

    names = []
    clips = {}
    for c in CLIP_ORDER + [k for k in idx['clips'] if k not in CLIP_ORDER]:
        if c in SKIP:
            continue
        frames = idx['clips'].get(c)
        if not frames:
            continue
        frames = _subsample(frames, MOBILE_FRAMES.get(c), c)
        clips[c] = list(range(len(names), len(names) + len(frames)))
        names += frames

    n = len(names)
    cols = 8
    rows = (n + cols - 1) // cols
    atlas = Image.new('RGBA', (cols * CELL, rows * CELL_H), (0, 0, 0, 0))
    clipped = 0
    for i, nm in enumerate(names):
        f = os.path.join(d, nm + '.png')
        if not os.path.isfile(f):
            raise SystemExit('missing frame: ' + f)
        im = Image.open(f).convert('RGBA')
        if im.size != (CELL, CELL):
            im = im.resize((CELL, CELL), Image.LANCZOS)
        # guard the band rather than trusting it: a frame whose silhouette runs
        # outside the crop would be silently decapitated, and a sprite missing a
        # head is exactly the kind of fault that reads as "fine" in a thumbnail
        bb = im.getbbox()
        if bb and (bb[1] < CROP_Y or bb[3] > CROP_Y + CELL_H):
            clipped += 1
        im = im.crop((0, CROP_Y, CELL, CROP_Y + CELL_H))
        atlas.paste(im, ((i % cols) * CELL, (i // cols) * CELL_H))
    if clipped:
        raise SystemExit('%s: %d frames fall outside the %d-row crop band at y=%d'
                         % (unit, clipped, CELL_H, CROP_Y))

    cam = idx.get('cam') or {}
    fig_h = cam.get('figH', FIG_H)
    ortho = cam.get('ortho', ORTHO)
    cam_z = cam.get('camz', CAM_Z)
    k = CELL / res
    meta = {
        'unit': unit,
        # cells are no longer square; `cell` stays as the WIDTH so an older
        # reader degrades to a stretched sprite rather than a crash
        'cell': CELL,
        'cellW': CELL,
        'cellH': CELL_H,
        'cols': cols,
        'rows': rows,
        'count': n,
        # y within a cell where world z=0 (the ground) lands
        'groundY': round((res / 2 + (cam_z / ortho) * res) * k - CROP_Y, 2),
        # pixels spanned by the figure's reference height
        'figH': round((fig_h / ortho) * res * k, 2),
        'clips': clips,
        # barrel tip per frame, in cell pixels — muzzle flashes start at the gun
        # barrel tip per frame, in cell pixels. The y MUST take the same CROP_Y
        # shift as groundY or every muzzle flash detaches from its barrel.
        'muzzle': {c: [[round(p[0] * k, 1), round(p[1] * k - CROP_Y, 1)] if p else None
                       for p in (idx.get('muzzle', {}).get(c) or [])]
                   for c in clips},
    }
    # A REPACK MUST NOT SILENTLY DROP THE MUZZLE DATA.
    #
    # `index.json` is gitignored and a partial re-render (`--only prone`) can
    # leave it holding muzzle points for that clip alone, while the COMPLETE set
    # survives only inside the tracked atlas.json. Repacking from that stale
    # index then emitted empty muzzle lists and every flash would have detached
    # from its barrel — caught by SelfTest, but only after the atlases had been
    # overwritten. Fail before writing anything.
    holes = sum(1 for c in clips for i in range(len(clips[c]))
                if not (meta['muzzle'].get(c) or [None] * (i + 1))[i:i + 1][0])
    if holes:
        raise SystemExit(
            '%s: %d frames have no muzzle point. index.json is probably stale — '
            'it is gitignored, so a partial render can wipe it while the good '
            'data survives in atlas.json. Recover it before packing.' % (unit, holes))
    atlas.save(os.path.join(d, 'atlas.png'), optimize=True)
    json.dump(meta, open(os.path.join(d, 'atlas.json'), 'w'), indent=1)
    kb = os.path.getsize(os.path.join(d, 'atlas.png')) / 1024
    print('%-10s %3d frames  %dx%d  %.0f KB  ground=%.1f figH=%.1f'
          % (unit, n, atlas.width, atlas.height, kb, meta['groundY'], meta['figH']))
    return meta


def main():
    units = sys.argv[1:] or sorted(
        u for u in os.listdir(SRC) if os.path.isdir(os.path.join(SRC, u)))
    made = [u for u in units if pack(u)]
    # The manifest lists EVERY unit with a packed atlas, not just the ones packed
    # in this run — writing only `made` meant `pack_sprites3d.py rpgman` silently
    # reduced the game's roster to one man.
    have = sorted(u for u in os.listdir(SRC)
                  if os.path.isdir(os.path.join(SRC, u)) and
                  os.path.isfile(os.path.join(SRC, u, 'atlas.json')))
    json.dump({'units': have}, open(os.path.join(SRC, 'manifest.json'), 'w'), indent=1)
    print('packed %d units; manifest lists %d' % (len(made), len(have)))


main()
