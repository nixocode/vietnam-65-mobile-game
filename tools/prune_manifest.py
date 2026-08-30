#!/usr/bin/env python3
"""Trim ASSET_MANIFEST to what the game can actually reach.

`Assets.init` loads EVERY entry in the manifest at boot, so a dead entry is a
download the player waits for and never sees. After the 3D sprite and prop
pipelines replaced most of the inked kit, the manifest still listed 461 images
totalling 17.2 MB — the great majority of it art nothing draws any more.

The keep-set is deliberately the UNION of two independent methods, so a name has
to be dead by BOTH to be dropped:

  runtime   every name requested through Assets.img/sheet/anim/meta or drawTex
            across ten full matches — all five maps, both sides, 95 s each —
            with anim frames, sheet poses and TEX families expanded.
  static    every name appearing as a literal in js/, plus every frame of any
            anim named in js/. Catches anything the ten matches happened not to
            trigger: a rare call-in, a menu screen, a VFX that needs a specific
            death.

Whole directories that exist for the UI rather than the battlefield (ui,
decals, rig, vfx, portraits) are kept regardless — they are small, and menus are
poorly covered by a match trace.

FILES ARE NOT DELETED. Only the manifest shrinks, so this is reversible by
re-running with an empty keep-set, and nothing that some future pass wants to
reuse has been thrown away.
"""
import glob
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAN = os.path.join(ROOT, 'assets', 'manifest.js')
KEEP_DIRS = ('assets/ui/', 'assets/decals/', 'assets/rig/', 'assets/vfx/')
KEEP_PREFIX = ('port_',)


def load():
    s = io.open(MAN, encoding='utf-8').read()
    m = re.search(r'const ASSET_MANIFEST\s*=\s*(\{.*?\});?\s*$', s, re.S)
    return json.loads(m.group(1))


def static_names(d):
    code = ''
    for f in sorted(glob.glob(os.path.join(ROOT, 'js', '*.js'))):
        code += io.open(f, encoding='utf-8').read()
    keep = set()
    for n in d['images']:
        if ("'%s'" % n) in code or ('"%s"' % n) in code:
            keep.add(n)
    for a, frames in (d.get('anims') or {}).items():
        if ("'%s'" % a) in code or ('"%s"' % a) in code:
            keep.update(frames)
    return keep


def main(runtime_json):
    d = load()
    runtime = set(json.load(open(runtime_json))) if runtime_json else set()
    keep = set(runtime) | static_names(d)
    for n, m in d['images'].items():
        src = m['src'].replace('\\', '/')
        if src.startswith(KEEP_DIRS) or n.startswith(KEEP_PREFIX):
            keep.add(n)
    # an anim is all-or-nothing: keep every frame of any anim we keep any of
    for a, frames in (d.get('anims') or {}).items():
        if keep & set(frames):
            keep.update(frames)

    before = len(d['images'])
    bbytes = sum(os.path.getsize(os.path.join(ROOT, m['src']))
                 for m in d['images'].values()
                 if os.path.isfile(os.path.join(ROOT, m['src'])))
    d['images'] = {n: m for n, m in d['images'].items() if n in keep}
    d['anims'] = {a: f for a, f in (d.get('anims') or {}).items()
                  if set(f) <= set(d['images'])}
    abytes = sum(os.path.getsize(os.path.join(ROOT, m['src']))
                 for m in d['images'].values()
                 if os.path.isfile(os.path.join(ROOT, m['src'])))
    io.open(MAN, 'w', encoding='utf-8').write(
        'const ASSET_MANIFEST = ' + json.dumps(d, separators=(',', ':')) + ';\n')
    print('images %d -> %d   boot download %.1f MB -> %.1f MB  (saved %.1f MB)'
          % (before, len(d['images']), bbytes / 1048576, abytes / 1048576,
             (bbytes - abytes) / 1048576))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)
