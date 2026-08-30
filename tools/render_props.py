"""Render scenery props to 2D through the SAME camera the soldiers use.

The world was drawn in a different visual language from the troops: buildings in
3/4 view standing next to strictly-profile men, which reads as a collage no amount
of character work fixes. These props come off a locked orthographic side camera
with the same lighting rig, so a hooch and a rifleman finally agree on where the
viewer is standing.

Each prop records its real height in metres. The game already knows a soldier is
1.8 m drawn at 84 px, so every prop can be placed at the correct relative size
rather than eyeballed.

Run:
  Blender -b --python tools/render_props.py -- --out assets/props --res 512
"""
import json
import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# CDN uuid -> the name the game knows it by. Without this a re-render drops a
# fresh set of uuid-named PNGs beside the renamed ones and silently doubles the
# manifest, which is exactly what happened the first time.
# Removed: frame_a / frame_b / frame_c (European half-timbered house frames),
# stall (a market stall with crossed swords on it), well_a (a storybook wishing
# well) and cart_a (a European handcart). All four came from a generic fantasy
# pack and are replaced by built Vietnamese fittings in BUILT below. The .glb
# files stay in art/props with their provenance; they are simply not rendered.
GLB_NAME = {
    '00e71997-0e9f-4083-9507-3935639996c7': 'sandbags_pile',
    '07d9ceb2-8b8d-4eba-8823-a7d39c8aeb20': 'hut_a',
    '1ac1bf37-184f-4e45-98a8-9da30bf37ffa': 'palm_a',
    '21d44b5b-efef-4abd-96ad-fc59e4ad373b': 'palm_b',
    '4c17decd-3087-4afe-9611-cfd92cca47cd': 'palm_c',
    '5a6e6186-ab59-4c81-a5e1-9beb5e1bb8e9': 'sandbags_row',

    '66cd7d94-abba-471e-8d8b-c8ad30aa5c70': 'palm_d',
    '8d6e4780-251c-49f6-9a49-b28ea28a03f8': 'hut_b',
    '96654c1e-dbc8-4bbc-a1c0-0dfacd8e9d93': 'sandbag_wall',
    '99bbd0c0-b60d-4923-bfbf-a7849e26766f': 'hut_c',
    'd4bcb445-6ef3-4aef-b39c-3bacd95f1b29': 'village_row',

    # 88fb0209 is a 26 m row of seedlings — a whole scene, not a prop
    #
    # `rock` and `sandbag_one` were dropped after a sweep for props referenced
    # nowhere in js/ found both: each was rendered, toned, committed, and
    # decoded at 512x512x4 = 1 MB on every load, and neither was ever drawn.
    # Two megabytes of a budget with 11.7 free. Re-add the id here if a use
    # appears — the GLBs are still in art/props.
}
SRC = arg('--src', os.path.join(ROOT, 'art', 'props'))
OUT = arg('--out', os.path.join(ROOT, 'assets', 'props'))
RES = int(arg('--res', '512'))
ONLY = arg('--only')
os.makedirs(OUT, exist_ok=True)


# ---------------------------------------------------------------- built props
# Some scenery has no CC0 model worth downloading — a Vietnam firebase watchtower
# is legs, a platform and a thatch roof, which is box geometry. Building it here
# keeps it on the same camera and the same palette as everything else.

def _box(mat, x0, y0, z0, x1, y1, z1):
    import bmesh
    me = bpy.data.meshes.new('b')
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('b', me)
    bpy.context.collection.objects.link(ob)
    # create_cube(size=1) spans -0.5..0.5, so the scale IS the span. Halving it
    # here made every box half its intended size and nothing touched anything —
    # which is why the first built props came out as a pile of loose sticks.
    ob.scale = (x1 - x0, y1 - y0, z1 - z0)
    ob.location = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    ob.data.materials.append(mat)
    return ob


def _pmat(name, rgb, rough=0.9):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    if b:
        b.inputs['Base Color'].default_value = (*rgb, 1)
        b.inputs['Roughness'].default_value = rough
        if 'Metallic' in b.inputs:
            b.inputs['Metallic'].default_value = 0.0
    return m


def _beam(mat, x0, z0, x1, z1, t=0.11, y=0.0, yt=0.11):
    """A timber running between two points in the XZ plane, drawn as a rotated box.

    A side-on sprite lives or dies on its diagonals: axis-aligned boxes alone read
    as a pile of loose slats, which is exactly how the first tower came out.
    """
    import math as _m
    dx, dz = x1 - x0, z1 - z0
    L = _m.hypot(dx, dz)
    ob = _box(mat, -L / 2, -yt, -t, L / 2, yt, t)
    ob.rotation_euler = (0, -_m.atan2(dz, dx), 0)
    ob.location = ((x0 + x1) / 2, y, (z0 + z1) / 2)
    return ob


def _curve(x0, z0, x1, z1, bow, segs):
    """Points along a quadratic bezier bowed perpendicular to the chord.

    Everything organic in here failed the same way first: built from straight
    beams it reads as a pile of sticks, because a straight line is the one shape
    plants never make. Every leaf, frond and strand goes through this.
    """
    import math as _m
    dx, dz = x1 - x0, z1 - z0
    L = _m.hypot(dx, dz) or 1e-6
    cx = (x0 + x1) / 2 - dz / L * bow
    cz = (z0 + z1) / 2 + dx / L * bow
    pts = []
    for k in range(segs + 1):
        t = k / float(segs)
        u = 1 - t
        pts.append((u * u * x0 + 2 * u * t * cx + t * t * x1,
                    u * u * z0 + 2 * u * t * cz + t * t * z1))
    return pts


def _poly(mat, pts, y=0.0, yt=0.012):
    """One flat polygon in the XZ plane, given thickness in Y.

    Chains of rotated boxes cannot draw a leaf. Every box has square ends, so at
    each bend the corners stand proud and the outline comes out scalloped — the
    banana plant read as an armadillo shell for exactly this reason. A leaf is
    one surface with one silhouette, so it is built as one polygon.
    """
    import bmesh
    me = bpy.data.meshes.new('p')
    bm = bmesh.new()
    top = [bm.verts.new((x, y + yt, z)) for x, z in pts]
    bot = [bm.verts.new((x, y - yt, z)) for x, z in pts]
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((top[i], top[j], bot[j], bot[i]))
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('p', me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def _leafpoly(mat, x0, z0, x1, z1, bow=0.0, wmax=0.09, segs=10, y=0.0, yt=0.012):
    """A leaf as ONE polygon: the midline bowed, the width swelling and tapering
    to a point at the tip. Same arguments as _blade, clean silhouette."""
    import math as _m
    mid = _curve(x0, z0, x1, z1, bow, segs)
    left, right = [], []
    for k, (px, pz) in enumerate(mid):
        t = k / float(segs)
        w = wmax * _m.sin(_m.pi * min(1.0, t ** 0.85)) ** 0.6
        if k == 0:
            dx, dz = mid[1][0] - px, mid[1][1] - pz
        elif k == segs:
            dx, dz = px - mid[k - 1][0], pz - mid[k - 1][1]
        else:
            dx, dz = mid[k + 1][0] - mid[k - 1][0], mid[k + 1][1] - mid[k - 1][1]
        d = _m.hypot(dx, dz) or 1e-6
        nx, nz = -dz / d, dx / d
        left.append((px + nx * w, pz + nz * w))
        right.append((px - nx * w, pz - nz * w))
    return _poly(mat, left + list(reversed(right)), y=y, yt=yt)


def _grassblade(mat, x0, z0, x1, z1, bow=0.0, w=0.026, segs=7, y=0.0, yt=0.016):
    """A blade of grass: widest at the base, tapering to a point, bent by its own
    weight.

    `_beam` chains have SQUARE ENDS, and a field of square-ended sticks is what
    made the built vegetation read as a different material from the donor palms
    standing next to it — the palms are real meshes with organic silhouettes and
    the grass was a bundle of rectangles. Blades taper. That single property is
    most of the difference between "grass" and "sticks", and it costs nothing
    because _leafpoly already builds a tapering polygon.
    """
    import math as _m
    mid = _curve(x0, z0, x1, z1, bow, segs)
    left, right = [], []
    for k, (px, pz) in enumerate(mid):
        t = k / float(segs)
        ww = w * (1.0 - t) ** 0.75          # widest at the root, a point at the tip
        if k == 0:
            dx, dz = mid[1][0] - px, mid[1][1] - pz
        elif k == segs:
            dx, dz = px - mid[k - 1][0], pz - mid[k - 1][1]
        else:
            dx, dz = mid[k + 1][0] - mid[k - 1][0], mid[k + 1][1] - mid[k - 1][1]
        d = _m.hypot(dx, dz) or 1e-6
        nx, nz = -dz / d, dx / d
        left.append((px + nx * ww, pz + nz * ww))
        right.append((px - nx * ww, pz - nz * ww))
    return _poly(mat, left + list(reversed(right)), y=y, yt=yt)


def _blade(mat, x0, z0, x1, z1, bow=0.0, wmax=0.09, segs=6, y=0.0, yt=0.02):
    """A leaf with actual blade area: half-width swells toward the middle and
    comes to a point at the tip.

    ONE POLYGON, not a chain of boxes. This used to lay down `_beam` segments,
    and a beam is a rotated box with SQUARE ENDS — so every leaf in the game
    finished on a little flat edge and every bend in one showed a corner. That is
    the whole reason the built vegetation read as a different material from the
    donor palms beside it: the palms are meshes with organic silhouettes and the
    undergrowth was made of rectangles.
    
    Fixed here rather than in each plant, because `bush_low`, `fern_a`, `vine_a`
    and bamboo's leaf sprays all come through this one function. `_leafpoly`
    already builds exactly the tapering shape this was approximating.
    """
    return _leafpoly(mat, x0, z0, x1, z1, bow=bow, wmax=wmax,
                     segs=max(6, segs + 2), y=y, yt=yt)


def _frond(rachis, leaf, x0, z0, x1, z1, bow=0.0, pairs=9, leafL=0.20,
           y=0.0, yt=0.016):
    """A pinnate frond: one stem plus leaflets down both sides.

    This is the whole difference between a fern and a bent stick — the leaflets
    are the read, and there have to be enough of them to make a comb.
    """
    import math as _m
    pts = _curve(x0, z0, x1, z1, bow, pairs + 1)
    for k in range(pairs + 1):
        if k:
            _beam(rachis, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1],
                  t=0.016, y=y, yt=yt)
        if k == pairs:
            break
        t = k / float(pairs)
        # longest a third of the way out, tapering to nothing at the tip
        L = leafL * _m.sin(_m.pi * (0.25 + 0.75 * t)) * (1.0 - 0.45 * t)
        if L < 0.02:
            continue
        ax, az = pts[k]
        dx, dz = pts[k + 1][0] - ax, pts[k + 1][1] - az
        d = _m.hypot(dx, dz) or 1e-6
        dx, dz = dx / d, dz / d
        for sgn in (-1, 1):
            # swept back toward the tip, the way a frond actually sits
            ang = sgn * 1.02
            lx = ax + (dx * _m.cos(ang) - dz * _m.sin(ang)) * L
            lz = az + (dx * _m.sin(ang) + dz * _m.cos(ang)) * L
            # LONGER, not fatter. The outline pass strokes a fixed 4px rim at
            # render resolution, so on a thin element the rim IS the element,
            # which is what still separated the built plants from the donor
            # meshes after their silhouettes were fixed. The first correction
            # widened the leaves instead and took them to about 1.1:1, which is
            # a circle — bush_low came out as a pile of grapes and the fern as a
            # pinecone. A leaf wants roughly 3:1, so the area has to come from
            # length.
            _blade(leaf, ax, az, lx, lz, bow=sgn * L * 0.22, wmax=L * 0.22,
                   segs=3, y=y + sgn * 0.006, yt=yt * 0.7)


def build_watchtower():
    """Legs, X-bracing, a railed platform and a thatch roof.

    Heavier timber than looks right in plan: at 84px-per-1.8m a 10cm member is
    under two pixels and vanishes, so everything is sized to read at game scale
    rather than to be structurally plausible.
    """
    wood = _pmat('tw_wood', (0.115, 0.070, 0.032))
    dark = _pmat('tw_dark', (0.062, 0.041, 0.021))
    thatch = _pmat('tw_thatch', (0.190, 0.150, 0.070))
    H, P = 5.2, 3.5
    BW, TW = 1.15, 0.72                       # half-width at base and platform
    for sy in (-0.62, 0.62):                  # near and far leg pairs
        for sx in (-1, 1):
            _beam(wood, sx * BW, 0, sx * TW, P, t=0.15, y=sy, yt=0.13)
    for i, (z0, z1) in enumerate(((0.15, 1.75), (1.75, 3.35))):
        w0 = BW + (TW - BW) * (z0 / P)
        w1 = BW + (TW - BW) * (z1 / P)
        _beam(dark, -w0, z0, w1, z1, t=0.075, y=-0.66, yt=0.07)   # X bracing
        _beam(dark, w0, z0, -w1, z1, t=0.075, y=-0.66, yt=0.07)
        _box(wood, -w1 - 0.06, -0.7, z1 - 0.07, w1 + 0.06, 0.7, z1 + 0.07)
    _box(wood, -0.98, -0.76, P, 0.98, 0.76, P + 0.20)             # deck
    _box(dark, -0.98, -0.80, P + 0.20, 0.98, -0.62, P + 0.74)     # parapet
    _box(dark, -0.98, 0.62, P + 0.20, 0.98, 0.80, P + 0.74)
    for sx in (-1, 1):
        _box(wood, sx * 0.84 - 0.07, -0.72, P + 0.70, sx * 0.84 + 0.07, 0.72, H - 0.55)
    _box(thatch, -1.28, -0.95, H - 0.55, 1.28, 0.95, H - 0.24)    # eaves
    _box(thatch, -0.80, -0.62, H - 0.24, 0.80, 0.62, H)           # ridge
    for i in range(7):                                            # ladder
        z = 0.35 + i * 0.45
        _box(dark, -0.30, 0.60, z, 0.30, 0.70, z + 0.09)
    _beam(dark, -0.34, 0.1, -0.34, P, t=0.06, y=0.65, yt=0.05)
    _beam(dark, 0.30, 0.1, 0.30, P, t=0.06, y=0.65, yt=0.05)


def build_m113():
    """An M113 APC, side on.

    Box geometry failed badly on the watchtower, but that was an OPEN LATTICE —
    a frame of thin members with air between them. A hull is the opposite case:
    solid closed volumes, which is exactly what boxes are good at. Sloped glacis,
    slab sides, track run with road wheels, and the commander's .50 cupola.
    """
    hull = _pmat('v_hull', (0.088, 0.104, 0.056))
    dark = _pmat('v_dark', (0.038, 0.044, 0.026))
    steel = _pmat('v_steel', (0.030, 0.032, 0.034))
    L, W = 2.45, 1.30                       # half-length, half-width
    _box(hull, -L, -W, 0.62, L * 0.72, W, 1.70)          # main body
    # sloped glacis, stepped so it reads as a slope in profile
    for i in range(5):
        t0, t1 = i / 5, (i + 1) / 5
        _box(hull, L * 0.72 + (L * 0.28) * t0, -W, 0.62 + 0.90 * t0,
             L * 0.72 + (L * 0.28) * t1, W, 0.62 + 0.90 * t1 + 0.22)
    _box(dark, -L, -W - 0.06, 0.30, L * 0.92, -W + 0.10, 1.02)   # track guards
    _box(dark, -L, W - 0.10, 0.30, L * 0.92, W + 0.06, 1.02)
    for sy in (-W - 0.02, W - 0.10):                              # track runs
        _box(steel, -L * 0.96, sy, 0.10, L * 0.90, sy + 0.12, 0.66)
        for i in range(5):                                        # road wheels
            x = -L * 0.80 + i * (L * 1.62 / 4)
            _box(dark, x - 0.20, sy - 0.03, 0.06, x + 0.20, sy + 0.15, 0.56)
    _box(hull, -0.55, -0.48, 1.70, 0.35, 0.48, 2.06)              # cupola
    _box(steel, -0.10, -0.09, 2.06, 0.86, 0.09, 2.20)             # .50 cal
    _box(dark, -0.34, -0.30, 2.04, 0.02, 0.30, 2.24)              # shield
    _box(dark, L * 0.55, -0.50, 1.70, L * 0.72, 0.50, 1.84)       # driver hatch


def build_huey():
    """A UH-1 Iroquois, side on — the single most recognisable object of this war,
    and until now the weakest thing in the game.

    It was `drawHuey`: a filled ellipse, a stick tail, one line for the rotor and
    two for the skids. A flat dark blob, with none of the shapes that make a Huey
    a Huey, while everything around it had been rebuilt as lit geometry.

    The ROTOR IS NOT HERE. It has to spin, so it stays procedural in render.js;
    this is the airframe under it. What the silhouette needs, in order of how
    much each one says: the tall slab cabin with its greenhouse glazing, the
    long thin tail boom, the swept fin, and the skids standing the body off the
    ground. Boxes suit it for the same reason they suited the M113 — a fuselage
    is a closed volume, not a lattice.

    Built nose-right (+X) to match the way the props are drawn and flipped.
    """
    olive = _pmat('h_olive', (0.052, 0.062, 0.040))
    dark = _pmat('h_dark', (0.022, 0.026, 0.018))
    # The glazing has to be DARK. First pass gave it a value close to the hull
    # and the greenhouse vanished — the whole airframe read as one olive slab.
    # Cockpit glass seen from outside is nearly black with a cold sky sheen, and
    # that dark hole under the rotor is a large part of the silhouette.
    glass = _pmat('h_glass', (0.012, 0.017, 0.022), rough=0.18)
    lit = _pmat('h_lit', (0.075, 0.088, 0.058))
    steel = _pmat('h_steel', (0.034, 0.036, 0.038))

    W = 0.62                                  # half-width, side-on so it is shallow
    # ---- cabin: the tall slab that carries the whole read
    _box(olive, -1.30, -W, 1.02, 1.05, W, 2.36)
    # Nose. First pass stepped it down over 0.62 m and it read as a flat front;
    # a Huey's nose is long, low and rounded, and that profile is half of what
    # distinguishes it from a generic helicopter. Twice the length, ten steps.
    for i in range(10):
        t0, t1 = i / 10.0, (i + 1) / 10.0
        _box(olive, 1.05 + 1.24 * t0, -W + 0.10 * t0, 1.02 + 0.34 * t0 ** 1.6,
             1.05 + 1.24 * t1, W - 0.10 * t0, 2.24 - 0.86 * t1 ** 1.35)
    _box(dark, 1.72, -W + 0.14, 0.98, 2.16, W - 0.14, 1.26)      # chin bubble
    # ---- greenhouse. The glazing is most of what says "helicopter" in profile
    _box(glass, 1.06, -W - 0.03, 1.46, 1.94, W + 0.03, 2.16)     # windscreen, raked
    _box(glass, 0.28, -W - 0.03, 1.66, 1.00, W + 0.03, 2.22)     # pilot door window
    _box(dark, 1.00, -W - 0.04, 1.44, 1.08, W + 0.04, 2.24)      # door pillar
    _box(dark, 1.02, -W - 0.04, 2.14, 1.98, W + 0.04, 2.22)      # cabin roof lip
    # ---- cabin door, slid open, with the dark interior behind it
    _box(dark, -1.10, -W - 0.03, 1.16, 0.14, W + 0.03, 2.14)     # opening
    _box(olive, -1.16, -W - 0.05, 1.12, -1.02, W + 0.05, 2.20)   # door frame aft
    _box(steel, -1.06, -W - 0.06, 2.16, 0.18, W + 0.06, 2.26)    # door rail
    # ---- engine deck and mast: the hump that separates cabin from boom
    _box(olive, -1.34, -W + 0.08, 2.36, 0.44, W - 0.08, 2.72)
    _box(lit, -1.34, -W + 0.08, 2.66, 0.44, W - 0.08, 2.72)      # lit deck edge
    _box(dark, -1.40, -W + 0.10, 2.50, -0.90, W - 0.10, 2.86)    # exhaust stack
    _box(steel, -0.42, -0.16, 2.72, 0.02, 0.16, 3.14)            # rotor mast
    _box(steel, -0.56, -0.26, 3.14, 0.16, 0.26, 3.30)            # hub
    # ---- tail boom, tapering back
    for i in range(6):
        t0, t1 = i / 6.0, (i + 1) / 6.0
        z = 1.94 - 0.10 * t0
        _box(olive, -1.30 - 2.55 * t1, -W * (0.42 - 0.20 * t0), z - 0.30 + 0.10 * t0,
             -1.30 - 2.55 * t0, W * (0.42 - 0.20 * t0), z + 0.16 - 0.06 * t0)
    # ---- fin, swept forward at the base like the real one, plus the stabiliser
    _box(olive, -4.42, -0.11, 1.70, -3.78, 0.11, 2.60)           # fin
    _box(olive, -4.30, -0.11, 2.60, -3.88, 0.11, 3.02)           # fin cap
    _box(olive, -3.70, -0.46, 1.80, -3.02, 0.46, 1.96)           # stabiliser
    _box(steel, -4.46, -0.22, 2.06, -4.30, 0.22, 2.26)           # tail rotor hub
    _box(dark, -4.52, -0.06, 1.52, -4.26, 0.06, 1.78)            # tail skid
    # ---- skids: two struts a side and the tube they carry
    for sy in (-W + 0.10, W - 0.22):
        _box(steel, 0.30, sy, 0.16, 0.44, sy + 0.12, 1.06)       # forward strut
        _box(steel, -0.86, sy, 0.16, -0.72, sy + 0.12, 1.06)     # aft strut
        _box(steel, -1.15, sy - 0.05, 0.00, 1.05, sy + 0.17, 0.18)
        _box(steel, 1.05, sy - 0.05, 0.04, 1.34, sy + 0.17, 0.26)  # toe, curved up


# ---------------------------------------------------------------- foliage
# The maps had four palm silhouettes and nothing else, tiled across every lane,
# which reads as wallpaper the moment you look at the treeline. These are built
# rather than downloaded: an unidentified model off a search page has no name,
# no licence and no preview, and none of that belongs in a public repo.
#
# Box geometry suits these better than it suited the watchtower, which failed as
# a lattice of loose sticks. Bamboo IS a bundle of tapered culms; a burnt trunk
# IS a tapered pole with broken stubs; grass IS a fan of blades. The shapes are
# already boxy, so nothing has to pretend.
#
# Every one is asymmetric on purpose — an even, mirrored plant reads as a
# repeated stamp, and a repeated stamp is the problem being solved.

def build_bamboo():
    """A clump of culms. Vietnam's most characteristic screen of cover.

    First version read as electricity pylons: six dead-straight culms at even
    spacing with square nodes bridging them, which is a lattice, not a plant.
    Real bamboo leans out from a common base, every cane at its own angle, and
    the nodes are thin rings rather than blocks. The leaf mass matters as much —
    a bare cane is a pole, and it is the spray at the top that says bamboo.
    """
    cane = _pmat('bm_cane', (0.150, 0.170, 0.062))
    dark = _pmat('bm_dark', (0.086, 0.104, 0.040))
    leaf = _pmat('bm_leaf', (0.110, 0.155, 0.055))
    pale = _pmat('bm_pale', (0.168, 0.182, 0.076))
    import math as _m
    import random as _r
    _r.seed(19)
    # (base x, height, lean at the tip) — fanning out from a tight clump, which
    # is how it grows, rather than standing in a row
    culms = [(-0.22, 3.6, -0.95), (-0.10, 4.5, -0.52), (-0.02, 3.9, -0.18),
             (0.06, 4.8, 0.34), (0.16, 3.2, 0.86), (0.02, 2.6, 0.14),
             (-0.16, 4.1, -0.72), (0.12, 3.4, 0.60)]
    for i, (x, h, lean) in enumerate(culms):
        m = cane if i % 3 else dark
        y = (i % 4 - 1.5) * 0.09
        # the cane itself curves — it is not a ruled line
        pts = _curve(x, 0.0, x + lean, h, bow=-lean * 0.16, segs=4)
        for k in range(4):
            _beam(m, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1],
                  t=0.052 - 0.006 * k, y=y, yt=0.046 - 0.005 * k)
        # nodes: thin rings on the cane, not blocks bridging between canes
        for k in range(1, 5):
            t = k / 5.0
            nx = x + lean * t * t
            nz = h * t
            _box(dark, nx - 0.058, y - 0.050, nz, nx + 0.058, y + 0.050, nz + 0.022)
        # leaf sprays over the top half — the actual read of the plant
        for k in range(5):
            t = 0.52 + 0.11 * k
            lx = x + lean * t * t
            lz = h * t
            sx = 1 if (i + k) % 2 else -1
            for j in range(3):
                L = 0.30 + _r.random() * 0.26
                ang = sx * (0.35 + 0.42 * j) + (_r.random() - 0.5) * 0.3
                _blade(leaf if (i + j) % 3 else pale, lx, lz,
                       lx + _m.sin(ang) * L, lz + _m.cos(ang) * L * 0.72,
                       bow=sx * 0.05, wmax=0.030, segs=2,
                       y=y + (j - 1) * 0.05, yt=0.013)


def build_junglecanopy():
    """A broadleaf jungle tree — the mid-ground mass every map is made of.

    Until now that band was `Renderer._tree`, a vector function that builds a
    canopy from a ring of ellipse lobes in three value passes. It is careful
    code and it still reads as a bush on a stick, because a ring of ellipses is
    a ring of ellipses: the crown has no interior, no branch structure holding
    it up, and the same round outline every time.

    A real canopy reads from three things this gets right instead: a trunk that
    LEANS and tapers, branches that fan from one point high on it and carry the
    foliage out to their ends, and leaf mass in separated clumps with sky
    between them. The gaps are what stop it being a blob.
    """
    import math as _m
    import random as _r
    _r.seed(41)
    bark = _pmat('jc_bark', (0.052, 0.042, 0.030))
    dark = _pmat('jc_dark', (0.026, 0.038, 0.020))
    leaf = _pmat('jc_leaf', (0.048, 0.070, 0.030))
    lit = _pmat('jc_lit', (0.078, 0.104, 0.044))

    H = 6.4
    lean = 0.42
    segs = 9
    pts = _curve(0.0, 0.0, lean, H * 0.62, bow=-0.16, segs=segs)
    for i in range(segs):
        t = i / float(segs)
        _beam(bark, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
              t=0.22 - 0.15 * t, y=0.0, yt=0.19 - 0.13 * t)
    # buttress roots — a lowland tree flares where it meets the ground
    for a in (-1, 1, -0.4):
        _poly(bark, [(0.0, 0.0), (a * 0.58, 0.0), (a * 0.16, 0.72)],
              y=a * 0.10, yt=0.10)

    # branches fan from the top of the trunk, each carrying a clump at its end
    top = pts[-1]
    clumps = []
    for i in range(7):
        a = -1.28 + i * 0.42 + (_r.random() - 0.5) * 0.22
        L = 1.5 + _r.random() * 1.5
        bx = top[0] + _m.sin(a) * L
        bz = top[1] + _m.cos(a) * L * 0.82
        bp = _curve(top[0], top[1], bx, bz, bow=0.12 * (1 if i % 2 else -1), segs=3)
        for k in range(3):
            _beam(bark, bp[k][0], bp[k][1], bp[k + 1][0], bp[k + 1][1],
                  t=0.11 - 0.026 * k, y=(i - 3) * 0.10, yt=0.10 - 0.022 * k)
        clumps.append((bx, bz, (i - 3) * 0.10))
    clumps.append((top[0], top[1] + 1.15, 0.0))

    # leaf mass: separated clumps of real leaves, three depths so the crown has
    # an inside. The lit material only on the upper leaves, so the sun has a side
    for ci, (cx, cz, cy) in enumerate(clumps):
        # MANY SMALL leaves, not a few big ones. The first pass used 16 leaves
        # at 0.34-0.64 m and read as a storybook tree: at that size each leaf is
        # a recognisable paddle and the crown is a collage of them. Canopy is a
        # TEXTURE — the eye should read mass and gaps, not individual leaves.
        for j in range(34):
            a = _r.random() * 6.283
            rr = _r.random() ** 0.6
            lx = cx + _m.cos(a) * 0.92 * rr
            lz = cz + _m.sin(a) * 0.66 * rr
            up = lz > cz
            m = lit if (up and j % 3 == 0) else (leaf if j % 4 else dark)
            L = 0.20 + _r.random() * 0.22
            ang = a * 0.35 + (_r.random() - 0.5) * 1.3
            _leafpoly(m, lx, lz, lx + _m.sin(ang) * L, lz + _m.cos(ang) * L * 0.6,
                      bow=(_r.random() - 0.5) * 0.10, wmax=L * 0.34, segs=4,
                      y=cy + (j % 7 - 3) * 0.10, yt=0.012)


def build_scrubtree():
    """A smaller, wind-shaped tree for the open maps, where a full jungle canopy
    would be wrong. Same construction, half the height, crown pushed downwind so
    a scatter of them does not read as one shape repeated."""
    import math as _m
    import random as _r
    _r.seed(57)
    bark = _pmat('st_bark', (0.056, 0.046, 0.032))
    dark = _pmat('st_dark', (0.030, 0.040, 0.022))
    leaf = _pmat('st_leaf', (0.056, 0.074, 0.032))
    lit = _pmat('st_lit', (0.086, 0.106, 0.048))
    H = 3.4
    pts = _curve(0.0, 0.0, 0.55, H * 0.54, bow=-0.22, segs=6)
    for i in range(6):
        t = i / 6.0
        _beam(bark, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
              t=0.19 - 0.11 * t, y=0.0, yt=0.17 - 0.10 * t)
    top = pts[-1]
    clumps = []
    for i in range(5):
        a = -0.95 + i * 0.50 + (_r.random() - 0.5) * 0.2
        L = 0.9 + _r.random() * 0.95
        bx = top[0] + _m.sin(a) * L + 0.18
        bz = top[1] + _m.cos(a) * L * 0.7
        bp = _curve(top[0], top[1], bx, bz, bow=0.10, segs=2)
        for k in range(2):
            _beam(bark, bp[k][0], bp[k][1], bp[k + 1][0], bp[k + 1][1],
                  t=0.075 - 0.02 * k, y=(i - 2) * 0.09, yt=0.07 - 0.018 * k)
        clumps.append((bx, bz, (i - 2) * 0.09))
    for cx, cz, cy in clumps:
        for j in range(24):
            a = _r.random() * 6.283
            rr = _r.random() ** 0.65
            lx = cx + _m.cos(a) * 0.62 * rr
            lz = cz + _m.sin(a) * 0.44 * rr
            m = lit if (lz > cz and j % 3 == 0) else (leaf if j % 4 else dark)
            L = 0.15 + _r.random() * 0.15
            ang = a * 0.3 + (_r.random() - 0.5) * 1.2
            _leafpoly(m, lx, lz, lx + _m.sin(ang) * L, lz + _m.cos(ang) * L * 0.6,
                      bow=(_r.random() - 0.5) * 0.08, wmax=L * 0.34, segs=4,
                      y=cy + (j % 6 - 2.5) * 0.08, yt=0.010)


def build_deadtree():
    """A shell-stripped trunk. Reads instantly as a fought-over place.

    The stacked-box version read as a totem pole: four rectangles of decreasing
    width with three stubs poking out at tidy angles. A shattered trunk is not
    tidy — it leans, it narrows continuously, and the top is a splintered crown
    of spikes rather than a flat cap. The stubs vary in length, angle and droop.
    """
    char = _pmat('dt_char', (0.040, 0.034, 0.028))
    import math as _m
    import random as _r
    _r.seed(13)
    segs = 14
    pts = _curve(0.0, 0.0, 0.46, 4.2, bow=-0.20, segs=segs)
    for i in range(segs):
        t = i / float(segs)
        r = 0.34 - 0.24 * t
        m = _pmat('dt_s%d' % i, (0.088 - 0.046 * t, 0.070 - 0.037 * t, 0.048 - 0.021 * t))
        _beam(m, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
              t=r, y=0.0, yt=r * 0.72)
    limbs = [(0.16, 1.85, 1.05, 0.42, 0.085), (0.02, 2.60, -0.88, 0.20, 0.070),
             (0.26, 3.15, 0.66, -0.18, 0.056), (0.10, 2.20, -0.52, -0.26, 0.048),
             (0.34, 3.62, 0.44, 0.16, 0.042)]
    for i, (bx, bz, reach, rise, th) in enumerate(limbs):
        _beam(char, bx, bz, bx + reach, bz + rise, t=th,
              y=(i - 2) * 0.06, yt=th * 0.8)
        _beam(char, bx + reach, bz + rise, bx + reach * 1.22, bz + rise * 1.5 + 0.10,
              t=th * 0.55, y=(i - 2) * 0.06, yt=th * 0.45)
    tx, tz = pts[-1]
    for k in range(6):
        L = 0.16 + _r.random() * 0.40
        ang = (k - 2.5) * 0.20 + (_r.random() - 0.5) * 0.18
        _beam(char, tx, tz - 0.12, tx + _m.sin(ang) * L * 0.5, tz - 0.12 + L,
              t=0.030 + _r.random() * 0.020, y=(k - 2.5) * 0.045, yt=0.028)


def build_banana():
    """Broad drooping paddles — the shape nothing else on the map has.

    Two earlier failures worth not repeating. Straight paired beams gave a flat
    zigzag lying on its side, 5.3 m wide on a plant that is taller than it is
    wide. Curving them fixed the posture but left six narrow ribbons tracing an
    outline with nothing inside, which at 60 px read as a croquet hoop. Banana
    leaves are big flat surfaces, so they are built as blades with real width,
    and split lengthwise the way wind actually leaves them.
    """
    stem = _pmat('bn_stem', (0.120, 0.140, 0.058))
    leaf = _pmat('bn_leaf', (0.135, 0.190, 0.062))
    dark = _pmat('bn_dark', (0.088, 0.125, 0.045))
    rib = _pmat('bn_rib', (0.070, 0.100, 0.034))
    import math as _m
    # pseudostem: tapered and sheathed. A plain rectangle read as a fence post.
    for k in range(6):
        t0, t1 = k / 6.0, (k + 1) / 6.0
        r0, r1 = 0.21 - 0.07 * t0, 0.21 - 0.07 * t1
        m = stem if k % 2 else dark
        _box(m, -r0, -r0 * 0.85, t0 * 1.70, r1, r1 * 0.85, t1 * 1.70)
    # (side, reach, base z, tip z, bow, half-width)
    #
    # Eight leaves all sweeping to the same two sides at similar angles stacked
    # into two solid lobes and the plant read as a moth. What says banana is
    # SEPARATE leaves with daylight between them, spread from young ones still
    # standing upright at the crown to old ones drooping to the ground.
    fronds = [(-1, 0.28, 1.66, 2.54, 0.09, 0.095),
              (1,  0.24, 1.70, 2.62, 0.07, 0.085),
              (-1, 0.92, 1.60, 1.74, 0.40, 0.150),
              (1,  1.02, 1.54, 1.48, 0.44, 0.155),
              (-1, 1.26, 1.36, 0.58, 0.50, 0.165),
              (1,  1.16, 1.30, 0.46, 0.46, 0.150)]
    for i, (sx, reach, z0, z1, bow, wm) in enumerate(fronds):
        m = leaf if i % 2 else dark
        y = (i - 2.5) * 0.06
        # ONE polygon per leaf. Built as a chain of boxes it scalloped at every
        # bend and read as an armadillo shell; before that, three narrow strips
        # merged into a solid dark arch.
        _leafpoly(m, 0.0, z0, sx * reach, z1, bow=sx * bow, wmax=wm, segs=12,
                  y=y, yt=0.013)
        # midrib over the blade — the split that says banana, not palm
        _leafpoly(rib, 0.0, z0, sx * reach, z1, bow=sx * bow, wmax=wm * 0.13,
                  segs=12, y=y + 0.016, yt=0.009)
        # one wind tear per leaf, angled back off the rib
        tx, tz = _curve(0.0, z0, sx * reach, z1, sx * bow, 8)[5]
        _leafpoly(rib, tx, tz, tx + sx * 0.15, tz - 0.12 * (1 if z1 < z0 else -1),
                  bow=0.0, wmax=0.012, segs=3, y=y + 0.016, yt=0.009)


def build_grass():
    """Elephant grass. Chest high and the reason nobody sees anybody."""
    pale = _pmat('gr_pale', (0.175, 0.180, 0.078))
    deep = _pmat('gr_deep', (0.108, 0.130, 0.050))
    import random as _r
    _r.seed(4)
    for i in range(44):
        x = -1.05 + 2.1 * (i / 43.0)
        h = 1.15 + _r.random() * 0.85
        lean = (_r.random() - 0.5) * 0.85
        # bowed AND tapered: elephant grass falls away under its own weight, and
        # a stand of straight square-ended stems reads as a bundle of canes
        _grassblade(deep if i % 3 else pale, x, 0.0, x + lean, h,
                    bow=lean * 0.55, w=0.032,
                    y=(_r.random() - 0.5) * 0.34, yt=0.020)


# ---- small ground cover -------------------------------------------------
# These exist to RETIRE the inked line-art vegetation (TEX tuft/fern/bush/plant
# in render.js). That art is hand-drawn with black outlines and cross-hatching,
# and the game's props are flat-shaded off one orthographic camera — two drawing
# languages that cannot be reconciled by tuning. A hand-inked fern standing next
# to a flat-shaded palm is what "some of it looks ass" was pointing at.
#
# Deliberately SMALL. grass_a is 1.8 m, which is right for a stand of elephant
# grass and far too big for the ankle-height clutter that fills ground between
# the trees. These run 0.3-1.2 m.

def build_tuft():
    """Ankle-height grass. The most-used prop on any map, so it stays cheap."""
    pale = _pmat('tf_pale', (0.165, 0.175, 0.072))
    deep = _pmat('tf_deep', (0.100, 0.122, 0.046))
    import random as _r
    _r.seed(11)
    # 14 blades vanished at the ~26 px this draws at. Ground clutter has to be a
    # clump to read at all; a handful of separate strokes just disappears.
    for i in range(30):
        x = (_r.random() - 0.5) * 0.66
        h = 0.20 + _r.random() * 0.36
        lean = (_r.random() - 0.5) * 0.34
        _grassblade(deep if i % 3 else pale, x, 0.0, x + lean, h,
                    bow=lean * 0.5, w=0.024,
                    y=(_r.random() - 0.5) * 0.24, yt=0.015)


def build_bushlow():
    """A low leafy mass. Replaces the inked `bush`.

    Built first as a heap of boxes, which is precisely what it looked like. A
    bush has no large faces at all — it is a few hundred small leaves catching
    light at different angles, so that is what it is made of.
    """
    mid = _pmat('bl_mid', (0.118, 0.150, 0.052))
    pale = _pmat('bl_pale', (0.156, 0.178, 0.070))
    deep = _pmat('bl_deep', (0.074, 0.100, 0.036))
    import math as _m
    import random as _r
    _r.seed(23)
    for i in range(4):                                    # a hint of stem
        x = -0.18 + i * 0.12
        _beam(deep, x, 0.0, x + (_r.random() - 0.5) * 0.2, 0.30 + _r.random() * 0.18,
              t=0.018, y=(i - 1.5) * 0.07, yt=0.016)
    for i in range(96):
        # sample a squashed dome, denser toward the middle
        ang = _r.random() * _m.pi
        rad = 0.72 * (0.35 + 0.65 * _r.random() ** 0.6)
        bx = _m.cos(ang) * rad
        bz = 0.10 + _m.sin(ang) * rad * 0.62
        out = 0.17 + _r.random() * 0.14
        oa = ang + (_r.random() - 0.5) * 1.5
        # pale on top where light lands, deep underneath — the only way a mass
        # of one colour ever reads as round
        m = pale if bz > 0.34 and _r.random() < 0.6 else (deep if bz < 0.22 else mid)
        _blade(m, bx, bz, bx + _m.cos(oa) * out, bz + _m.sin(oa) * out * 0.8,
               bow=(_r.random() - 0.5) * 0.06, wmax=0.034 + _r.random() * 0.014,
               segs=3, y=(_r.random() - 0.5) * 0.30, yt=0.012)


def build_fern():
    """Ground fern. Replaces the inked `fern`.

    The first one was two bare arcs meeting at a point and read as a croquet
    hoop. A fern is leaflets; without them the stem is just a bent stick.
    """
    frond = _pmat('fn_stem', (0.090, 0.118, 0.040))
    leaf = _pmat('fn_leaf', (0.128, 0.162, 0.056))
    pale = _pmat('fn_pale', (0.160, 0.182, 0.072))
    import random as _r
    _r.seed(7)
    spread = [(-1, 0.70, 0.30), (1, 0.62, 0.40), (-1, 0.48, 0.52),
              (1, 0.42, 0.58), (-1, 0.26, 0.66), (1, 0.20, 0.70), (0, 0.05, 0.74)]
    for i, (sx, reach, top) in enumerate(spread):
        _frond(frond, pale if i % 3 == 0 else leaf,
               0.0, 0.06, sx * reach, top,
               bow=sx * 0.16 if sx else 0.04, pairs=9,
               leafL=0.23 + 0.05 * _r.random(), y=(i - 3) * 0.055)


def build_vine():
    """Hanging growth. The inked `plant` slice the owner singled out was a vine;
    this is the same idea drawn in the game's own language.

    Bare strands read as parallel dashes — it is the leaves hanging off them that
    make it a vine rather than a set of dropped wires.
    """
    stem = _pmat('vn_stem', (0.078, 0.098, 0.036))
    leaf = _pmat('vn_leaf', (0.112, 0.148, 0.050))
    deep = _pmat('vn_deep', (0.066, 0.092, 0.032))
    import math as _m
    import random as _r
    _r.seed(31)
    for i in range(6):
        x0 = -0.58 + i * 0.232
        drop = 0.72 + (i % 3) * 0.24
        segs = 6
        px, pz = x0, 1.24
        for k in range(1, segs + 1):
            t = k / float(segs)
            x = x0 + 0.17 * _m.sin(t * 2.4)
            z = 1.24 - drop * t
            _beam(stem, px, pz, x, z, t=0.020, y=(i - 2.5) * 0.055, yt=0.017)
            # leaves down both sides of the strand, alternating the way they grow
            for sgn in (-1, 1):
                if _r.random() < 0.32:
                    continue
                L = 0.17 + _r.random() * 0.10
                ang = sgn * (0.7 + _r.random() * 0.5) - _m.pi / 2
                _blade(leaf if (k + i) % 2 else deep, x, z,
                       x + _m.cos(ang) * L, z + _m.sin(ang) * L * 0.7,
                       bow=sgn * 0.03, wmax=0.030 + _r.random() * 0.010, segs=3,
                       y=(i - 2.5) * 0.055 + sgn * 0.02, yt=0.011)
            px, pz = x, z



def build_dike():
    """A paddy bund. The Mekong's own cover, and among the last inked kit left."""
    earth = _pmat('dk_earth', (0.108, 0.086, 0.052))
    dry = _pmat('dk_dry', (0.140, 0.112, 0.066))
    grass = _pmat('dk_grass', (0.120, 0.140, 0.056))
    pale = _pmat('dk_pale', (0.160, 0.172, 0.070))
    import random as _r
    _r.seed(41)
    segs = 12
    pts = _curve(-1.55, 0.0, 1.55, 0.0, bow=0.46, segs=segs)
    for i in range(segs):
        m = dry if i % 3 == 0 else earth
        _beam(m, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
              t=0.13, y=0.0, yt=0.30)
    # grass along the crown — a bare bund reads as a speed bump
    for i in range(26):
        t = _r.random()
        cx = -1.5 + 3.0 * t
        cz = 0.10 + 0.40 * _r.random() + 0.30 * (1 - abs(t - 0.5) * 2)
        h = 0.10 + _r.random() * 0.18
        _beam(grass if i % 3 else pale, cx, cz, cx + (_r.random() - 0.5) * 0.16,
              cz + h, t=0.020, y=(_r.random() - 0.5) * 0.30, yt=0.016)


def build_stonewall():
    """A low village wall of laterite block, slumped and gapped.

    This is the generic `wall` cover on every map, so it is on screen constantly.
    It was randomising block WIDTHS and staggering courses already — and still
    read as fired brick, because every block was the same HEIGHT sitting on a
    perfectly level course with an even gap, and those horizontal lines are what
    the eye actually reads. Neat coursing means a kiln and a bricklayer.

    Laterite is cut wet, dries uneven and is laid by hand: courses sag, blocks
    vary in depth as well as width, and the faces sit at slightly different
    heights. So the jitter has to be in Z and Y too, not just X, and the course
    line itself has to wander.
    """
    brick = _pmat('sw_brick', (0.150, 0.126, 0.086))
    dark = _pmat('sw_dark', (0.104, 0.086, 0.058))
    warm = _pmat('sw_warm', (0.168, 0.118, 0.072))
    cap = _pmat('sw_cap', (0.170, 0.146, 0.100))
    import random as _r
    import math as _m
    _r.seed(53)
    W, rows = 1.55, 5
    for r in range(rows):
        base = r * 0.17
        off = 0.10 if r % 2 else 0.0
        x = -W
        while x < W:
            bw = 0.14 + _r.random() * 0.26          # much wider spread than 0.20-0.30
            if r == rows - 1 and _r.random() < 0.40:
                x += bw + 0.02                      # the top course is broken
                continue
            # the course SAGS across the wall and each block sits a little proud
            # or low of its neighbours — this is the part that stops it coursing
            sag = _m.sin((x / W) * 2.1 + r) * 0.016
            jz = (_r.random() - 0.5) * 0.020
            z0 = base + sag + jz
            z1 = z0 + 0.135 + _r.random() * 0.045   # and blocks differ in height
            d = 0.13 + _r.random() * 0.055          # ...and in depth, so the face
            rr = _r.random()                        #    is not one flat plane
            m = dark if rr < 0.26 else (warm if rr < 0.46 else brick)
            _box(m, x + off, -d, z0, min(W, x + off + bw), d, z1)
            x += bw + 0.012 + _r.random() * 0.022
    # a broken cap, not a straight coping
    xc = -W
    while xc < W * 0.62:
        cw = 0.22 + _r.random() * 0.20
        if _r.random() > 0.24:
            _box(cap, xc, -0.185, rows * 0.17 + (_r.random() - 0.5) * 0.02,
                 min(W * 0.62, xc + cw), 0.185, rows * 0.17 + 0.05)
        xc += cw + 0.03



# ---- Vietnamese village fittings ----------------------------------------
# These replace donor props that came from a generic fantasy/medieval pack and
# had no business in a 1965 Vietnam game: a half-timbered European house frame
# standing in for a roadside shrine, a storybook wishing well with a peaked roof
# and a bucket on a rope, and a market stall with CROSSED SWORDS on its sign.
# Architecture is the one place box geometry is honestly right — a roof plane is
# a plane, a post is a post — so these are built rather than sourced.

def build_shrine():
    """A roadside spirit house. Small, raised, tiled roof, offerings below.

    You see these on every roadside and in every yard in Vietnam. The thing it
    replaces was a European timber A-frame with cross-bracing.
    """
    stone = _pmat('sh_stone', (0.126, 0.118, 0.100))
    wall = _pmat('sh_wall', (0.190, 0.120, 0.078))     # ochre render
    tile = _pmat('sh_tile', (0.145, 0.052, 0.036))     # red pantile
    dark = _pmat('sh_dark', (0.070, 0.058, 0.046))
    _box(stone, -0.38, -0.30, 0.0, 0.38, 0.30, 0.34)          # plinth
    _box(stone, -0.30, -0.24, 0.34, 0.30, 0.24, 0.44)
    _box(wall, -0.26, -0.21, 0.44, 0.26, 0.21, 0.96)          # the house itself
    _box(dark, -0.15, -0.22, 0.52, 0.15, -0.19, 0.84)         # the shrine niche
    # tiled roof: two pitches with the eaves kicked up, which is the line that
    # says East Asia rather than Europe
    for side in (-1, 1):
        _beam(tile, 0.0, 1.16, side * 0.40, 0.99, t=0.045, y=0.0, yt=0.26)
        _beam(tile, side * 0.40, 0.99, side * 0.52, 1.03, t=0.038, y=0.0, yt=0.24)
    _box(tile, -0.05, -0.26, 1.14, 0.05, 0.26, 1.20)          # ridge
    # incense pot and a couple of offerings on the plinth
    _box(dark, -0.06, -0.10, 0.44, 0.06, 0.02, 0.53)
    _box(wall, 0.14, -0.08, 0.44, 0.22, 0.02, 0.49)


def build_wellviet():
    """A village well: a blockwork drum, a rope frame, a pail on the rim.

    The predecessor was a storybook wishing well and this replaced it with a low
    ring of blocks — 0.84 m across and 0.40 m tall, which from the side camera
    every prop is rendered with is a WIDE FLAT BAND, and in a contact sheet of
    all 29 props it was the one thing that read as nothing at all.

    Two things were wrong. The proportions: a well is about as tall as it is
    wide, not half. And more importantly, a side-on orthographic camera cannot
    see into the mouth, so the shape that says "well" in plan — a dark circle —
    is unavailable here. What reads from the side is the FRAME: two forked posts,
    a cross-pole and a pail on a rope. That silhouette is unmistakable, and it
    is also what village wells in the delta actually carry.
    """
    ring = _pmat('wv_ring', (0.150, 0.140, 0.120))
    cap = _pmat('wv_cap', (0.175, 0.163, 0.140))
    dark = _pmat('wv_dark', (0.052, 0.050, 0.044))
    wood = _pmat('wv_wood', (0.120, 0.088, 0.052))
    tin = _pmat('wv_tin', (0.130, 0.134, 0.130))
    import math as _m
    # the drum: taller than it is wide across the front, so it reads as a shaft
    for i in range(16):
        ang = (i / 16.0) * _m.pi * 2
        x, y = _m.cos(ang) * 0.34, _m.sin(ang) * 0.34
        _box(ring, x - 0.075, y - 0.062, 0.0, x + 0.075, y + 0.062, 0.62)
    # a cap course, overhanging a little — the line that makes it a rim and not
    # the top of a wall
    for i in range(16):
        ang = ((i + 0.5) / 16.0) * _m.pi * 2
        x, y = _m.cos(ang) * 0.38, _m.sin(ang) * 0.38
        _box(cap, x - 0.082, y - 0.068, 0.62, x + 0.082, y + 0.068, 0.70)
    _box(dark, -0.26, -0.20, 0.66, 0.26, 0.20, 0.70)          # the shaft, in shadow
    # THE FRAME. Two forked posts and a cross-pole, which is what actually
    # reads as a well from a side view.
    for sx in (-0.46, 0.46):
        _beam(wood, sx, 0.0, sx + 0.02, 1.34, t=0.044, y=0.0, yt=0.042)
        _beam(wood, sx, 1.18, sx + 0.13, 1.36, t=0.028, y=0.0, yt=0.026)   # fork
    _beam(wood, -0.52, 1.34, 0.52, 1.34, t=0.036, y=0.0, yt=0.034)         # cross-pole
    _beam(dark, 0.06, 1.32, 0.06, 0.84, t=0.012, y=0.0, yt=0.012)          # rope
    _box(tin, -0.06, -0.10, 0.62, 0.18, 0.10, 0.84)                        # pail
    _box(wood, 0.40, -0.12, 0.0, 0.60, 0.12, 0.10)                         # spill trough


def build_stallviet():
    """A market stall: bamboo uprights, a tarp awning, produce on a low table."""
    bam = _pmat('sv_bam', (0.150, 0.130, 0.062))
    tarp = _pmat('sv_tarp', (0.140, 0.120, 0.086))
    wood = _pmat('sv_wood', (0.112, 0.082, 0.050))
    green = _pmat('sv_green', (0.090, 0.130, 0.048))
    red = _pmat('sv_red', (0.170, 0.070, 0.045))
    for x in (-0.62, -0.20, 0.22, 0.64):                      # four uprights
        _beam(bam, x, 0.0, x + 0.03, 1.32, t=0.026, y=0.0, yt=0.024)
    # awning: a shallow sag between the posts, the way a tarp actually hangs
    pts = _curve(-0.74, 1.34, 0.76, 1.30, bow=-0.13, segs=8)
    for i in range(len(pts) - 1):
        _beam(tarp, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
              t=0.022, y=0.0, yt=0.34)
    _box(wood, -0.66, -0.26, 0.52, 0.68, 0.26, 0.60)          # the table
    for x in (-0.52, 0.56):
        _box(wood, x - 0.03, -0.22, 0.0, x + 0.03, 0.22, 0.52)
    # produce, in baskets
    import random as _r
    _r.seed(61)
    for i in range(9):
        bx = -0.56 + 0.14 * i
        _box(green if i % 3 else red, bx - 0.05, -0.16, 0.60,
             bx + 0.05, 0.16, 0.60 + 0.06 + _r.random() * 0.05)


def build_cartviet():
    """A Vietnamese ox cart: two heavy wheels, a slatted bed, shafts for the ox.

    The previous version was a covered wagon — a twelve-segment rim on six thin
    spokes, which at any size reads as a European carriage wheel, under a canvas
    tilt arched on hoops, which reads as a Conestoga. Both were caught in a
    Mekong frame, where that wheel was the largest circle in the picture and the
    only thing in it that curved.

    A delta cart is plainer: a heavy wooden wheel with four thick spokes and a
    broad hub, an open slatted bed with a low rail, and two long shafts, because
    an ox stands between them rather than pulling on a yoke behind.

    NOTE the signature — _box(mat, x0, y0, z0, x1, y1, z1) is corner to corner,
    NOT three (min, max) pairs. Reading it as pairs collapsed the bed and hung a
    slat below the axle, and the cart rendered as a wheel with a stick in it.
    """
    wood = _pmat('cv_wood', (0.118, 0.086, 0.050))
    dark = _pmat('cv_dark', (0.062, 0.048, 0.032))
    import math as _m
    _box(wood, -0.54, -0.30, 0.46, 0.54, 0.30, 0.56)           # bed floor
    for k in range(6):                                         # cross slats
        x = -0.50 + k * 0.185
        _box(dark, x, -0.30, 0.56, x + 0.05, 0.30, 0.585)
    _box(wood, -0.54, -0.32, 0.56, 0.54, -0.26, 0.66)          # low side rails
    _box(wood, -0.54, 0.26, 0.56, 0.54, 0.32, 0.66)
    for sx in (-0.50, -0.10, 0.30):                            # rail stanchions
        for side in (-1, 1):
            _box(wood, sx, side * 0.29 - 0.022, 0.56,
                 sx + 0.044, side * 0.29 + 0.022, 0.70)

    for side in (-1, 1):
        cx, cz, R = -0.08, 0.38, 0.32
        for k in range(14):                                    # heavy rim
            a0 = (k / 14.0) * _m.pi * 2
            a1 = ((k + 1) / 14.0) * _m.pi * 2
            _beam(dark, cx + _m.cos(a0) * R, cz + _m.sin(a0) * R,
                  cx + _m.cos(a1) * R, cz + _m.sin(a1) * R,
                  t=0.055, y=side * 0.33, yt=0.050)
        for k in range(4):                                     # four thick spokes
            a = (k / 4.0) * _m.pi
            _beam(wood, cx - _m.cos(a) * R * 0.88, cz - _m.sin(a) * R * 0.88,
                  cx + _m.cos(a) * R * 0.88, cz + _m.sin(a) * R * 0.88,
                  t=0.044, y=side * 0.33, yt=0.042)
        _box(dark, cx - 0.08, side * 0.33 - 0.055, cz - 0.08,
             cx + 0.08, side * 0.33 + 0.055, cz + 0.08)        # broad hub
    # shafts, long and near level — an ox stands between them
    for side in (-1, 1):
        _beam(wood, -0.52, 0.50, -1.30, 0.44, t=0.032, y=side * 0.17, yt=0.030)
    _box(wood, -1.30, -0.20, 0.42, -1.24, 0.20, 0.47)          # yoke bar


BUILT = {
    'm113':       (build_m113, 2.6),
    'huey':       (build_huey, 4.4),   # UH-1 rotor diameter aside, 4.4 m to the hub
    'watchtower': (build_watchtower, 5.2),
    # foliage — real heights, so they scale against a 1.8 m soldier
    'bamboo_a':   (build_bamboo, 4.8),
    'canopy_a':   (build_junglecanopy, 8.5),   # the mid-ground mass, was a vector blob
    'scrub_a':    (build_scrubtree, 4.2),
    'deadtree_a': (build_deadtree, 4.5),
    'banana_a':   (build_banana, 2.7),
    'grass_a':    (build_grass, 1.8),
    # small ground cover, sized to retire the inked TEX vegetation
    'tuft_a':     (build_tuft, 0.55),
    'bush_low':   (build_bushlow, 0.85),
    'fern_a':     (build_fern, 0.75),
    'vine_a':     (build_vine, 1.30),
    # cover — the last of the inked kit to be replaced
    'dike_a':      (build_dike, 0.62),
    'stonewall_a': (build_stonewall, 1.05),
    # village fittings, replacing donor props from a fantasy pack
    'shrine_a':    (build_shrine, 1.5),
    'well_v':      (build_wellviet, 1.5),   # the rope frame is most of the height now
    'stall_v':     (build_stallviet, 2.1),
    'cart_v':      (build_cartviet, 1.4),
}


def scene_setup():
    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    try:
        sc.eevee.taa_render_samples = int(arg('--samples', '24'))
    except Exception:
        pass
    sc.render.film_transparent = True
    sc.render.resolution_x = RES
    sc.render.resolution_y = RES
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    return sc


def light_rig():
    """The soldiers' lighting, so props sit in the same sun."""
    key = bpy.data.lights.new('key', 'SUN'); key.energy = 3.6
    ko = bpy.data.objects.new('key', key); bpy.context.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(52), 0, math.radians(38))
    fill = bpy.data.lights.new('fill', 'SUN'); fill.energy = 0.7
    fo = bpy.data.objects.new('fill', fill); bpy.context.collection.objects.link(fo)
    fo.rotation_euler = (math.radians(78), 0, math.radians(-126))
    rim = bpy.data.lights.new('rim', 'SUN'); rim.energy = 2.6
    rim.color = (1.0, 0.96, 0.84)
    ro = bpy.data.objects.new('rim', rim); bpy.context.collection.objects.link(ro)
    ro.rotation_euler = (math.radians(112), 0, math.radians(-24))
    w = bpy.data.worlds.new('w'); w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.30, 0.34, 0.30, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.30
    bpy.context.scene.world = w


def bounds():
    from mathutils import Vector
    lo = [1e9] * 3
    hi = [-1e9] * 3
    got = False
    for o in bpy.data.objects:
        if o.type != 'MESH' or o.name.lower().startswith(('icosphere', 'sphere')):
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
            got = True
    return (lo, hi) if got else None


def render_one(path, sc):
    stem = os.path.splitext(os.path.basename(path))[0]
    name = GLB_NAME.get(stem)
    if not name:
        return None            # not part of the shipped set
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = scene_setup()
    try:
        bpy.ops.import_scene.gltf(filepath=path)
    except Exception as e:
        print('SKIP', name, e)
        return None
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.name.lower().startswith(('icosphere', 'sphere')):
            bpy.data.objects.remove(o, do_unlink=True)
    b = bounds()
    if not b:
        print('SKIP', name, 'no geometry')
        return None
    lo, hi = b
    w = hi[0] - lo[0]
    h = hi[2] - lo[2]
    cx = (lo[0] + hi[0]) / 2
    cz = (lo[2] + hi[2]) / 2
    span = max(w, h) * 1.14

    light_rig()
    cam_d = bpy.data.cameras.new('cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = span
    cam = bpy.data.objects.new('cam', cam_d)
    bpy.context.collection.objects.link(cam)
    cam.location = (cx, lo[1] - max(8.0, span * 3), cz)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam

    sc.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)

    # ground row inside the frame, and the prop's true size in metres
    return {
        'name': name,
        'hM': round(h, 3),
        'wM': round(w, 3),
        'groundY': round(RES / 2 + ((cz - lo[2]) / span) * RES, 1),
        'ppm': round(RES / span, 2),
        'res': RES,
    }


def render_built(name, fn, sc):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = scene_setup()
    fn()
    # object matrices are lazy: without this the bounds come back as the unit
    # cube and every built prop measures 1x1 m
    bpy.context.view_layer.update()
    b = bounds()
    if not b:
        return None
    lo, hi = b
    w, h = hi[0] - lo[0], hi[2] - lo[2]
    cx, cz = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2
    span = max(w, h) * 1.14
    light_rig()
    cam_d = bpy.data.cameras.new('cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = span
    cam = bpy.data.objects.new('cam', cam_d)
    bpy.context.collection.objects.link(cam)
    cam.location = (cx, lo[1] - max(8.0, span * 3), cz)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    sc.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)
    return {'name': name, 'hM': round(h, 3), 'wM': round(w, 3),
            'groundY': round(RES / 2 + ((cz - lo[2]) / span) * RES, 1),
            'ppm': round(RES / span, 2), 'res': RES}


def main():
    sc = scene_setup()
    out = []
    for name, (fn, realh) in BUILT.items():
        if ONLY and ONLY not in name:
            continue
        m = render_built(name, fn, sc)
        if m:
            m['realH'] = realh
            m['aspect'] = round(m['wM'] / max(1e-4, m['hM']), 4)
            out.append(m)
            print('BUILT %-14s %.2f x %.2f m' % (name, m['wM'], m['hM']))
    files = sorted(f for f in os.listdir(SRC) if f.endswith('.glb'))
    if ONLY:
        files = [f for f in files if ONLY in f]
    for f in files:
        m = render_one(os.path.join(SRC, f), sc)
        if m:
            out.append(m)
            print('PROP %-40s %.2f x %.2f m' % (m['name'], m['wM'], m['hM']))
    # props.json already carries hand-authored real-world heights; a re-render
    # must not throw those away
    prev = {}
    pj = os.path.join(OUT, 'props.json')
    if os.path.isfile(pj):
        try:
            prev = {q['name']: q for q in json.load(open(pj)).get('props', [])}
        except Exception:
            prev = {}
    merged = dict(prev)
    for m in out:
        old = prev.get(m['name'], {})
        if 'realH' not in m and 'realH' in old:
            m['realH'] = old['realH']
        m['aspect'] = round(m['wM'] / max(1e-4, m['hM']), 4)
        merged[m['name']] = m
    # Drop entries whose PNG is gone.
    #
    # The merge above deliberately preserves hand-authored heights across a
    # re-render, but it also preserved props that no longer exist: deleting
    # `scrub_a` and its image left the entry in props.json, and the game then
    # asked for a file that was never committed. A fresh clone would 404 on it.
    # Only keep what is actually on disk.
    merged = {k: v for k, v in merged.items()
              if os.path.isfile(os.path.join(OUT, k + '.png'))}
    with open(pj, 'w') as fh:
        json.dump({'props': sorted(merged.values(), key=lambda q: q['name'])}, fh, indent=1)
    print('DONE', len(out), 'props')


main()
