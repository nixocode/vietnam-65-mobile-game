#!/usr/bin/env python3
"""Rebuild a unit's index.json muzzle table from its tracked atlas.json.

WHY THIS EXISTS. `render_model_sprites.py --only <clip>` used to write
`index['muzzle'] = MUZZLE`, and MUZZLE only holds the clips that run rendered.
So every partial render silently discarded the muzzle points for every other
clip, and the next pack refused with "N frames have no muzzle point". That has
happened three times, each time threatening a full re-render of twelve units.

The renderer now MERGES instead of replacing, so this should not recur. But
index.json is gitignored while atlas.json is tracked, and the atlas carries the
same table in ATLAS-CELL coordinates — already shifted by the packer's CROP_Y.
Un-shifting recovers the render-space values the index is supposed to hold.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPR = os.path.join(ROOT, 'assets', 'sprites3d')
CROP_Y = 14          # keep in step with tools/pack_sprites3d.py


def recover(unit):
    ap = os.path.join(SPR, unit, 'atlas.json')
    ip = os.path.join(SPR, unit, 'index.json')
    if not (os.path.isfile(ap) and os.path.isfile(ip)):
        return unit, 'missing'
    atlas = json.load(open(ap))
    index = json.load(open(ip))
    amz = atlas.get('muzzle') or {}
    if not amz:
        return unit, 'atlas has no muzzle table'
    scale = index.get('res', 256) / float(atlas.get('cellW') or atlas.get('cell') or 128)
    out = dict(index.get('muzzle') or {})
    added = 0
    for clip, pts in amz.items():
        if out.get(clip):
            continue                       # this run rendered it; keep the fresh data
        rec = []
        for p in pts:
            if not p:
                rec.append(None)
                continue
            rec.append([p[0] * scale, (p[1] + CROP_Y) * scale])
        out[clip] = rec
        added += 1
    index['muzzle'] = out
    json.dump(index, open(ip, 'w'), indent=1)
    return unit, 'recovered %d clips' % added


if __name__ == '__main__':
    units = sys.argv[1:] or sorted(
        d for d in os.listdir(SPR) if os.path.isdir(os.path.join(SPR, d)))
    for u in units:
        print('%-12s %s' % recover(u))
