#!/usr/bin/env python3
"""Cut the V3 source figures into SKELETAL RIG pieces.

Each source is one clean side-profile soldier, facing right, neutral stand, on a
painted checkerboard (light OR dark). We key the checker by flood-filling from the
image border (robust to either shade, and never eats the black rifle since it is
an island), then cut the figure into 5 rig pieces:

    head   — helmet/hat + head + neck      pivot: base of neck
    torso  — body, webbing, far arm        pivot: hip
    arm    — near arm + hands + WEAPON     pivot: shoulder   (rigid assembly)
    thigh  — hip -> knee                   pivot: hip
    shin   — knee -> foot                  pivot: knee

Keeping the near arm and the weapon as ONE rigid assembly is deliberate: a rifleman
grips the weapon with both hands, so the whole assembly swings about the shoulder
for carry / aim / prone. It reads correctly and avoids hand-weapon detachment.

Run:  python3 tools/cut_figures.py [--grid] [--only NAME]
      --grid  writes a normalized measurement overlay for tuning the config
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'v3_sources')
OUT = os.path.join(ROOT, 'assets', 'rig')
DEBUG = os.path.join(ROOT, 'assets', 'debug')
os.makedirs(OUT, exist_ok=True)
os.makedirs(DEBUG, exist_ok=True)

WORK_H = 560   # figure height we cut at (plenty for a ~60px on-screen soldier)

# ---------------------------------------------------------------- config
# All coordinates are FRACTIONS of the figure's own bounding box:
#   yj  : joint heights, 0 = top of head, 1 = ground
#   arm : polygon (xFrac, yFrac) enclosing near arm + hands + weapon
DEFAULT = {
    'neck': 0.175, 'shoulder': 0.225, 'hip': 0.530, 'knee': 0.720,
    # the hands+weapon assembly always sits in this height band
    'handTop': 0.40, 'handBot': 0.88,
    'wpnDist': 52,        # colour distance from uniform that counts as weapon
}

UNIT_CFG = {
    # black pajamas sit close to the AK's dark metal — loosen the threshold
    'guerrilla': {'wpnDist': 34, 'handTop': 0.38},
    'sapper':    {'wpnDist': 34, 'handTop': 0.40},
    'marksman':  {'wpnDist': 26, 'handTop': 0.38},
    'nva':       {'wpnDist': 42},
    'rpd':       {'wpnDist': 42, 'handTop': 0.38},
    'm60':       {'handTop': 0.42, 'handBot': 0.80},
    'sniper':    {'handTop': 0.40, 'handBot': 0.72},
    'flamer':    {'handTop': 0.42, 'handBot': 0.78},
    'mortar':    {'handTop': 0.34, 'handBot': 0.80},
    'engineer':  {'handTop': 0.44},
    'recon':     {'handTop': 0.42},
}

UNITS = {
    'rifleman':  {'file': 'US Still source figures/US Rifleman .png'},
    'arvn':      {'file': 'US Still source figures/ARVN Soldier.png'},
    'm60':       {'file': 'US Still source figures/M60 Gunner.png'},
    'engineer':  {'file': 'US Still source figures/Engineer US.png'},
    'recon':     {'file': 'US Still source figures/LRRP Recon .png'},
    'sniper':    {'file': 'US Still source figures/Scout Sniper.png'},
    'guerrilla': {'file': 'VC:NVA still source figures/Viet Cong Guerilla.png'},
    'nva':       {'file': 'VC:NVA still source figures/NVA regular.png'},
    'rpd':       {'file': 'VC:NVA still source figures/RPD Gunner.png'},
    'sapper':    {'file': 'VC:NVA still source figures/VC sapper.png'},
    'marksman':  {'file': 'VC:NVA still source figures/VC marksman.png'},
    'flamer':    {'file': 'New units/US flamethrower.png'},
    'mortar':    {'file': 'New units/NVA:VS Mortar crewman.png'},
}


def cfg(name):
    c = dict(DEFAULT)
    c.update(UNIT_CFG.get(name, {}))
    c.update(UNITS[name].get('cfg', {}))
    return c


# ---------------------------------------------------------------- keying
def key_background(img):
    """Flood-fill the painted checkerboard from the image border.

    Works for light or dark checkers: background candidates are LOW-SATURATION
    pixels, and only those connected to the border are removed — so the black
    rifle and boots (saturation-poor but interior) survive.
    """
    a = np.array(img.convert('RGBA')).astype(np.int32)
    rgb = a[:, :, :3]
    sat = rgb.max(2) - rgb.min(2)
    lum = rgb.mean(2)

    # The checker is TWO alternating grey shades. Find both from the border ring
    # and accept only pixels near one of them (±14). A broad luminance range
    # would swallow black VC pajamas on the dark-checker sheets.
    ring = np.zeros(lum.shape, bool)
    ring[:8, :] = ring[-8:, :] = ring[:, :8] = ring[:, -8:] = True
    blum = lum[ring & (sat < 30)]
    hist, edges = np.histogram(blum, bins=64, range=(0, 255))
    order = np.argsort(hist)[::-1]
    modes, TOL = [], 14
    top = hist[order[0]] if len(order) else 0
    for idx in order:
        # a second shade only counts if it is genuinely a checker square, not
        # the figure's dark outline sneaking into the border ring
        if len(modes) and hist[idx] < 0.20 * top:
            break
        v = (edges[idx] + edges[idx + 1]) / 2
        if all(abs(v - m) > 22 for m in modes):
            modes.append(v)
        if len(modes) == 2:
            break
    near = np.zeros(lum.shape, bool)
    for m in modes:
        near |= np.abs(lum - m) <= TOL
    # checker greys are truly neutral; olive drab and black pajamas are not
    cand = (sat < 12) & near
    lab, n = ndimage.label(cand)
    bg = np.zeros(lum.shape, bool)
    if n:
        border_ids = set(np.unique(np.concatenate([
            lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]])))
        border_ids.discard(0)
        bg = np.isin(lab, list(border_ids))
        # ALSO drop enclosed checker: gaps between arm and body, between the
        # legs, inside the trigger guard. A real checker gap contains BOTH grey
        # shades; smooth cloth of a similar tone contains only one, so uniforms
        # enclosed by the figure's dark outline are never mistaken for holes.
        sizes = ndimage.sum(cand, lab, range(1, n + 1))
        enclosed = []
        for i in range(1, n + 1):
            if i in border_ids or sizes[i - 1] < 60:
                continue
            sel = lab == i
            # checker squares are PURE grey (sat≈0); cloth that happens to sit
            # at a similar luminance always carries a little hue
            if sat[sel].mean() < 4.0:
                enclosed.append(i)
        if enclosed:
            bg |= np.isin(lab, enclosed)

    fg = ~bg
    # shave the 1px checker halo without reopening the gaps
    fg = ndimage.binary_erosion(fg, iterations=1)
    fg = ndimage.binary_dilation(fg, iterations=1)
    fg = ndimage.binary_erosion(fg, iterations=1)

    out = a.astype(np.uint8)
    alpha = Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
    out[:, :, 3] = np.array(alpha)
    return out


def main_figure_only(rgba):
    """Drop everything that is not the soldier: the corner watermark sparkle,
    and props resting on the ground (the mortar crewman's tube). Keeps the
    largest blob plus anything overlapping its column — a held weapon stays."""
    m = rgba[:, :, 3] > 60
    lab, n = ndimage.label(ndimage.binary_dilation(m, np.ones((9, 9))))
    if n <= 1:
        return rgba
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    main = int(np.argmax(sizes)) + 1
    keep = lab == main
    ys, xs = np.where(keep)
    y0, y1 = ys.min(), ys.max()
    for i in range(1, n + 1):
        if i == main or sizes[i - 1] < 400:
            continue
        cy, cx = np.where(lab == i)
        mx0, mx1 = xs.min(), xs.max()
        gapL = mx0 - cx.max()
        gapR = cx.min() - mx1
        far = max(gapL, gapR) > 0.10 * (mx1 - mx0)
        # a held weapon overlaps the body's vertical span and sits against it;
        # ground props sit below, watermarks sit off to one side
        if cy.min() < y1 - 0.10 * (y1 - y0) and not far:
            keep |= lab == i
    out = rgba.copy()
    out[:, :, 3] = np.where(keep & m, rgba[:, :, 3], 0)
    return out


def figure_crop(rgba):
    """Tight-crop to the figure and scale to WORK_H."""
    rgba = main_figure_only(rgba)
    m = rgba[:, :, 3] > 60
    ys, xs = np.where(m)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    crop = rgba[y0:y1, x0:x1]
    im = Image.fromarray(crop)
    s = WORK_H / im.height
    im = im.resize((max(1, round(im.width * s)), WORK_H), Image.LANCZOS)
    return im


# ---------------------------------------------------------------- cutting
def poly_mask(size, poly):
    """Rasterize a fractional polygon to a mask of `size` (w,h)."""
    w, h = size
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).polygon([(x * w, y * h) for x, y in poly], fill=255)
    return np.array(m) > 127


def band_mask(size, y0f, y1f):
    w, h = size
    m = np.zeros((h, w), bool)
    m[int(y0f * h):int(y1f * h), :] = True
    return m


def apply(im, mask, feather=0.0):
    """Return an RGBA image of `im` limited to `mask`, tight-cropped, plus the
    (x,y) offset of that crop inside `im` so pivots stay accurate."""
    a = np.array(im).copy()
    al = a[:, :, 3].astype(np.float32)
    al *= mask.astype(np.float32)
    a[:, :, 3] = al.astype(np.uint8)
    keep = a[:, :, 3] > 40
    if not keep.any():
        return None, (0, 0)
    ys, xs = np.where(keep)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    return Image.fromarray(a[y0:y1, x0:x1]), (int(x0), int(y0))


def patch_hole(im, mask):
    """Fill a removed region with nearby body colour so the torso has no hole.
    Cheap and effective: pull from the pixel just LEFT (rearward) of the hole."""
    a = np.array(im).copy()
    h, w = mask.shape
    for y in range(h):
        xs = np.where(mask[y])[0]
        if not len(xs):
            continue
        src = xs.min() - 1
        while src > 0 and a[y, src, 3] < 40:
            src -= 1
        if src <= 0:
            continue
        a[y, xs, :] = a[y, src, :]
    return Image.fromarray(a)


def body_column(im, c, top0=0, H=None):
    """The x-range the soldier's TORSO occupies. Legs and head never stray far
    from it; anything in a limb band outside it is weapon or artwork litter."""
    a = np.array(im)
    fg = a[:, :, 3] > 40
    Hpx, W = fg.shape
    if H is None:
        H = Hpx
    L, R = [], []
    for r in range(int(top0 + 0.26 * H), int(top0 + 0.46 * H)):
        if r < 0 or r >= Hpx:
            continue
        xs = np.where(fg[r])[0]
        if len(xs):
            L.append(xs.min()); R.append(xs.max())
    if not L:
        return 0, W - 1
    return int(np.median(L)), int(np.median(R))


def detect_arm(im, c, top0=0, H=None):
    """Find the near arm + weapon assembly.

    Two weapon carries appear in the source art:
      • held at the side, inside the silhouette (rifleman, guerrilla, NVA…)
      • held across the body, protruding well past it (sniper, M60, flamer…)
    We measure the torso's own x-range, treat anything protruding past it below
    the shoulder as weapon, and inside that weapon's height band keep only
    pixels whose colour differs from the uniform (so the rifle is taken but the
    trousers are not). The sleeve strip from shoulder to grip is always added.
    """
    a = np.array(im)
    fg = a[:, :, 3] > 40
    Hpx, W = fg.shape
    if H is None:
        H = Hpx
    rgb = a[:, :, :3].astype(np.int32)

    def Yf(f):
        return top0 + f * H

    rows = range(int(Yf(0.26)), int(Yf(0.46)))
    L, R = [], []
    for r in rows:
        xs = np.where(fg[r])[0]
        if len(xs):
            L.append(xs.min()); R.append(xs.max())
    bodyL = int(np.median(L)) if L else 0
    bodyR = int(np.median(R)) if R else W - 1

    X = np.arange(W)[None, :].repeat(Hpx, 0)
    Y = np.arange(Hpx)[:, None].repeat(W, 1)
    pad = 0.02 * W
    protrude = fg & (Y > Yf(0.28)) & ((X < bodyL - pad) | (X > bodyR + pad))
    protrude &= (Y < Yf(0.93))          # never the boots

    # Weapon band: hands and weapon always live between the elbow and the knee.
    band = fg & (Y > Yf(c['handTop'])) & (Y < Yf(c['handBot']))
    # uniform colour, sampled from the middle of the torso (never the weapon)
    core = fg & (Y > Yf(0.28)) & (Y < Yf(0.42)) & \
        (X > bodyL + 0.3 * (bodyR - bodyL)) & (X < bodyR - 0.3 * (bodyR - bodyL))
    arm = protrude & band
    # Sample the CLOTH palette from several places, not just the chest: trousers
    # are a different shade from the coat, and boots are darker still. Judging
    # "weapon" against the chest alone made the whole leg look like a rifle.
    swatches = []
    bw = max(4, int(0.18 * (bodyR - bodyL)))
    for y0, y1 in [(0.28, 0.42), (0.56, 0.68), (0.76, 0.86), (0.90, 0.97)]:
        reg = fg & (Y > Yf(y0)) & (Y < Yf(y1)) & \
            (X > bodyL + 0.06 * (bodyR - bodyL)) & (X < bodyL + 0.06 * (bodyR - bodyL) + bw)
        if reg.sum() > 40:
            swatches.append(np.median(rgb[reg], 0))
    if core.sum() > 50:
        swatches.append(np.median(rgb[core], 0))
    if swatches:
        dist = None
        for sw in swatches:
            d = np.sqrt(((rgb - sw) ** 2).sum(2))
            dist = d if dist is None else np.minimum(dist, d)
        # weapon = far from EVERY cloth shade the soldier is wearing
        arm |= band & (dist > c['wpnDist'])
    # bridge the weapon across the body, then drop specks
    arm = ndimage.binary_closing(arm, np.ones((9, 9))) & fg
    lab, n = ndimage.label(arm)
    if n:
        sizes = ndimage.sum(arm, lab, range(1, n + 1))
        big = max(sizes) if len(sizes) else 0
        keep = [i + 1 for i, s in enumerate(sizes) if s > max(220, big * 0.06)]
        arm = np.isin(lab, keep)
    return arm


def cut_unit(name, grid=False):
    spec = UNITS[name]
    path = os.path.join(SRC, spec['file'])
    if not os.path.exists(path):
        print('  !! missing', spec['file']); return None
    c = cfg(name)
    keyed = key_background(Image.open(path))
    im = figure_crop(keyed)
    W, Hpx = im.size
    size = (W, Hpx)

    # Joint fractions are measured from the TOP OF THE HEAD, not the bounding
    # box: radio antennas and pack frames poke above the helmet and would
    # otherwise shove every joint down the body.
    _a = np.array(im)[:, :, 3] > 40
    widths = _a.sum(1)
    top0 = 0
    if widths.max() > 0:
        thick = np.where(widths >= 0.12 * widths.max())[0]
        if len(thick):
            top0 = int(thick[0])
    H = Hpx - top0

    def yAt(f):
        return top0 + f * H

    def yband(f0, f1):
        m = np.zeros((Hpx, W), bool)
        m[int(max(0, yAt(f0))):int(min(Hpx, yAt(f1))), :] = True
        return m

    if grid:
        g = im.convert('RGBA').copy()
        d = ImageDraw.Draw(g)
        for f, lab in [(c['neck'], 'neck'), (c['shoulder'], 'shldr'),
                       (c['hip'], 'hip'), (c['knee'], 'knee')]:
            d.line([(0, f * H), (W, f * H)], fill=(255, 60, 60, 255), width=2)
            d.text((3, f * H + 2), '%s %.3f' % (lab, f), fill=(255, 255, 0, 255))
        for f in [i / 10 for i in range(11)]:
            d.line([(f * W, 0), (f * W, H)], fill=(0, 160, 255, 90), width=1)
            d.text((f * W + 2, H - 14), '%.1f' % f, fill=(0, 200, 255, 255))
        for f in (c['handTop'], c['handBot']):
            d.line([(0, f * H), (W, f * H)], fill=(255, 0, 255, 255))
        bg = Image.new('RGBA', g.size, (70, 78, 66, 255))
        bg.alpha_composite(g)
        bg = bg.resize((bg.width * 3, bg.height * 3), Image.NEAREST)
        d3 = ImageDraw.Draw(bg)
        for f in [i / 20 for i in range(21)]:
            d3.line([(f * bg.width, 0), (f * bg.width, bg.height)], fill=(0, 160, 255, 70))
            d3.text((f * bg.width + 2, 4), '%.2f' % f, fill=(0, 220, 255, 255))
        bg.convert('RGB').save(os.path.join(DEBUG, 'grid_%s.png' % name))

    armM = detect_arm(im, c, top0, H)
    bodyL, bodyR = body_column(im, c, top0, H)
    bw = max(8, bodyR - bodyL)
    Xg = np.arange(W)[None, :].repeat(Hpx, 0)

    def col(pad):
        return (Xg > bodyL - pad * bw) & (Xg < bodyR + pad * bw)

    # packs and antennas stick out at the top; legs never do
    headM = yband(-0.4, c['neck']) & ~armM & col(0.55)
    torsoM = yband(c['neck'], c['hip']) & ~armM & col(0.55)
    thighM = yband(c['hip'], c['knee']) & ~armM & col(0.30)
    shinM = yband(c['knee'], 1.02) & ~armM & col(0.30)

    pieces, meta = {}, {}
    # torso gets its arm-hole patched before cropping
    torso_src = patch_hole(im, armM & yband(c['neck'], c['hip']))

    # arm pivots at the elbow: top-centre of the hands+weapon assembly
    ays, axs = np.where(armM)
    if len(ays):
        top = ays.min()
        near = axs[ays < top + max(3, int(0.02 * H))]
        armPivotPx = (float(near.mean()), float(top))
    else:
        armPivotPx = (0.55 * W, yAt(0.45))

    for pname, mask, src, pivotF in [
        ('head', headM, im, (None, c['neck'])),
        ('torso', torsoM, torso_src, (None, c['hip'])),
        ('arm', armM, im, ('px', armPivotPx)),
        ('thigh', thighM, im, (None, c['hip'])),
        ('shin', shinM, im, (None, c['knee'])),
    ]:
        piece, (ox, oy) = apply(src, mask)
        if piece is None:
            continue
        # pivot in piece-local pixels
        if pivotF[0] == 'px':
            px, py = pivotF[1][0] - ox, pivotF[1][1] - oy
        elif pivotF[0] is None:
            # centre of the piece's own top (or bottom for shin/thigh: the joint row)
            row = yAt(pivotF[1])
            pw = np.array(piece)[:, :, 3] > 40
            rr = int(np.clip(row - oy, 0, piece.height - 1))
            xs = np.where(pw[rr])[0]
            px = float(xs.mean()) if len(xs) else piece.width / 2
            py = row - oy
        else:
            px, py = pivotF[0] * W - ox, yAt(pivotF[1]) - oy
        fn = '%s_%s.png' % (name, pname)
        piece.save(os.path.join(OUT, fn), optimize=True)
        pieces[pname] = fn
        meta[pname] = {'src': 'assets/rig/%s' % fn, 'w': piece.width, 'h': piece.height,
                       'px': round(px, 1), 'py': round(py, 1),
                       'ox': ox, 'oy': oy}
    # joint positions in figure pixels (top-left of the figure bbox = 0,0)
    a = np.array(im)[:, :, 3] > 40

    def rowx(yf):
        # Joint x must be the BODY's centre at that height. Measuring the whole
        # row let a slung rifle drag the hip/knee marker sideways, which offset
        # every child piece — that is what detached the VC legs from their torsos.
        rr = int(np.clip(yAt(yf), 0, Hpx - 1))
        xs = np.where(a[rr])[0]
        xs = xs[(xs > bodyL - 0.3 * bw) & (xs < bodyR + 0.3 * bw)]
        return float(xs.mean()) if len(xs) else (bodyL + bodyR) / 2
    meta['_joints'] = {
        'neck':     [round(rowx(c['neck']), 1), round(yAt(c['neck']), 1)],
        'shoulder': [round(armPivotPx[0], 1), round(armPivotPx[1], 1)],
        'hip':      [round(rowx(c['hip']), 1), round(yAt(c['hip']), 1)],
        'knee':     [round(rowx(c['knee']), 1), round(yAt(c['knee']), 1)],
    }
    # Weapon geometry: where the barrel points in the PAINTED pose, and how far
    # the muzzle sits from the elbow pivot. The rig rotates the arm assembly by
    # (desired - wpnAngle) so every unit levels its weapon correctly, whether the
    # art shows it slung low or already held across the body.
    if 'arm' in meta and len(ays):
        ax0, ay0 = armPivotPx
        dx = axs - ax0
        dy = ays - ay0
        dist = np.hypot(dx, dy)
        k = int(np.argmax(dist))
        meta['_wpn'] = {
            'angle': round(float(np.arctan2(dy[k], dx[k])), 4),
            'len': round(float(dist[k]), 1),
        }
    meta['_H'] = Hpx
    meta['_W'] = W
    meta['_bodyH'] = H
    meta['_top'] = top0
    return meta


def _place(canvas, piece_img, pivot, at, angle=0.0):
    """Paste `piece_img` so its pivot lands on `at`, rotated by `angle` rad."""
    px, py = pivot
    if abs(angle) > 1e-4:
        deg = -angle * 180 / np.pi
        big = Image.new('RGBA', (piece_img.width * 3, piece_img.height * 3), (0, 0, 0, 0))
        big.paste(piece_img, (piece_img.width, piece_img.height), piece_img)
        cx, cy = piece_img.width + px, piece_img.height + py
        big = big.rotate(deg, center=(cx, cy), resample=Image.BICUBIC)
        canvas.alpha_composite(big, (int(at[0] - cx), int(at[1] - cy)))
    else:
        canvas.alpha_composite(piece_img, (int(at[0] - px), int(at[1] - py)))


def contact(all_meta):
    """Two proofs per unit: exact reassembly, and a posed (running) skeleton."""
    names = sorted(all_meta)
    cw, ch = 230, 660
    sheet = Image.new('RGBA', (cw * len(names), ch), (74, 82, 68, 255))
    d = ImageDraw.Draw(sheet)
    for i, name in enumerate(names):
        meta = all_meta[name]
        J = meta['_joints']
        H = meta['_H']
        s = 560 / H * 0.52
        base = i * cw

        def img(p):
            return Image.open(os.path.join(ROOT, meta[p]['src'])).convert('RGBA')

        def piv(p):
            return (meta[p]['px'], meta[p]['py'])

        # ---- left: exact reassembly from stored offsets (cut integrity) ----
        recon = Image.new('RGBA', (meta['_W'], H), (0, 0, 0, 0))
        for p in ['thigh', 'shin', 'torso', 'head', 'arm']:
            if p in meta:
                m = meta[p]
                recon.alpha_composite(img(p), (m['ox'], m['oy']))
        recon = recon.resize((max(1, int(recon.width * s)), int(H * s)), Image.LANCZOS)
        sheet.alpha_composite(recon, (base + 18, 40))

        # ---- right: posed — legs split, arm raised to a carry angle ----
        posed = Image.new('RGBA', (200, int(H * s) + 40), (0, 0, 0, 0))
        ss = s
        hip = (J['hip'][0] * ss + 60, J['hip'][1] * ss)
        knee = (J['knee'][0] * ss + 60, J['knee'][1] * ss)
        neck = (J['neck'][0] * ss + 60, J['neck'][1] * ss)
        sh = (J['shoulder'][0] * ss + 60, J['shoulder'][1] * ss)

        def sc(p):
            im0 = img(p)
            return im0.resize((max(1, int(im0.width * ss)), max(1, int(im0.height * ss))), Image.LANCZOS)

        def spiv(p):
            return (meta[p]['px'] * ss, meta[p]['py'] * ss)
        # far leg back, near leg forward
        _place(posed, sc('thigh'), spiv('thigh'), hip, -0.5)
        _place(posed, sc('shin'), spiv('shin'), (knee[0] + 26, knee[1] - 6), -0.25)
        _place(posed, sc('torso'), spiv('torso'), hip, 0.16)
        _place(posed, sc('thigh'), spiv('thigh'), hip, 0.55)
        _place(posed, sc('shin'), spiv('shin'), (knee[0] - 24, knee[1] - 8), 0.9)
        _place(posed, sc('head'), spiv('head'), neck, 0.02)
        if 'arm' in meta:
            _place(posed, sc('arm'), spiv('arm'), sh, -0.75)
        sheet.alpha_composite(posed, (base + 110, 40))
        d.text((base + 8, 10), name, fill=(255, 255, 160, 255))
        d.text((base + 8, 24), 'recon | posed', fill=(180, 200, 160, 255))
    sheet.convert('RGB').save(os.path.join(DEBUG, 'rig_pieces.jpg'), quality=88)


def main():
    grid = '--grid' in sys.argv
    only = None
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1]
    out = {}
    for name in UNITS:
        if only and name != only:
            continue
        print('cutting', name)
        m = cut_unit(name, grid=grid)
        if m:
            out[name] = m
    with open(os.path.join(ROOT, 'assets', 'rig_manifest.js'), 'w') as f:
        f.write('const RIG_MANIFEST = ' + json.dumps(out, indent=1) + ';\n')
    print('wrote assets/rig_manifest.js —', len(out), 'units')
    if out:
        contact(out)
        print('wrote assets/debug/rig_pieces.jpg')


if __name__ == '__main__':
    main()
