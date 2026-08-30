#!/usr/bin/env python3
"""Slice the labeled asset sheets in assets/assets:vietnam into game-ready
frames under assets/sprites|vfx|decals plus a generated assets/manifest.js.

Vanilla-friendly: no scipy. Connected components run on a 4x-downsampled mask.
Run:  python3 tools/slice_assets.py [--contact]
"""
import json, math, os, sys
from collections import deque
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'assets:vietnam')
OUT_SPRITES = os.path.join(ROOT, 'assets', 'sprites')
OUT_VFX = os.path.join(ROOT, 'assets', 'vfx')
OUT_DECALS = os.path.join(ROOT, 'assets', 'decals')
OUT_DEBUG = os.path.join(ROOT, 'assets', 'debug')
for d in (OUT_SPRITES, OUT_VFX, OUT_DECALS, OUT_DEBUG):
    os.makedirs(d, exist_ok=True)

DOWN = 4  # downsample factor for labeling

def load(name):
    return np.array(Image.open(os.path.join(SRC, name)).convert('RGBA'))

def erode(mask, it=1):
    m = mask
    for _ in range(it):
        m = (m & np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1))
    return m

def dilate(mask, it=1):
    m = mask
    for _ in range(it):
        m = (m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1))
    return m

def key_checker(img):
    """The sheets fake transparency with a painted checkerboard + white haze.
    Classify near-gray pixels in/above the checker luminance range as background,
    write a real alpha channel (eroded 1px against halos, feathered)."""
    rgb = img[:, :, :3].astype(np.int32)
    lum = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    # sample checker luminances from the corners
    patches = [lum[:160, :160], lum[:160, -160:], lum[-160:, :160], lum[-160:, -160:]]
    grays = np.concatenate([p.ravel() for p in patches])
    lo, hi = np.percentile(grays, 5), np.percentile(grays, 95)
    bg = (sat < 22) & (lum > lo - 22)  # checker + white haze smudges
    fg = erode(~bg, 1)
    out = img.copy()
    a = Image.fromarray((fg * 255).astype(np.uint8))
    from PIL import ImageFilter
    a = a.filter(ImageFilter.GaussianBlur(0.8))
    out[:, :, 3] = np.array(a)
    return out

def solid_mask(img, alpha_thresh=150):
    return img[:, :, 3] > alpha_thresh

def erase_baseline(img):
    """Zero the alpha of the drawn ground line: rows with a contiguous soft-alpha
    run spanning >35% of the SHEET width (rifles span far less)."""
    a = img[:, :, 3]
    H, W = a.shape
    m = a > 25
    padded = np.zeros((H, W + 2), dtype=bool)
    padded[:, 1:-1] = m
    d = np.diff(padded.astype(np.int8), axis=1)
    rows = []
    for r in range(H):
        starts = np.where(d[r] == 1)[0]
        ends = np.where(d[r] == -1)[0]
        if len(starts) and (ends - starts).max() > 0.35 * W:
            rows.append(r)
    for r in rows:
        img[max(0, r - 3):r + 4, :, 3] = 0
    return img, rows

def lum_mask(img, thresh=46):
    rgb = img[:, :, :3].astype(np.int32)
    return rgb.max(axis=2) > thresh

def remove_ground_lines(mask):
    """Clear rows containing a contiguous run spanning most of the sheet width
    (the drawn baseline), plus neighbors to kill anti-aliased remnants.
    Returns (mask, line_rows)."""
    H, W = mask.shape
    padded = np.zeros((H, W + 2), dtype=bool)
    padded[:, 1:-1] = mask
    d = np.diff(padded.astype(np.int8), axis=1)
    bad = []
    for r in range(H):
        starts = np.where(d[r] == 1)[0]
        ends = np.where(d[r] == -1)[0]
        if len(starts) and (ends - starts).max() > 0.45 * W:
            bad.append(r)
    for r in bad:
        mask[max(0, r - 4):r + 5, :] = False
    return mask, bad

def components(mask, min_area=1500, merge_dx=60, merge_dy=60):
    """8-connected components on a DOWNxDOWN downsampled grid; returns bboxes in
    original coords [x0,y0,x1,y1], iteratively merging nearby boxes."""
    H, W = mask.shape
    gh, gw = H // DOWN, W // DOWN
    g = mask[:gh * DOWN, :gw * DOWN].reshape(gh, DOWN, gw, DOWN).any(axis=(1, 3))
    seen = np.zeros_like(g, dtype=bool)
    boxes = []
    for y in range(gh):
        for x in range(gw):
            if not g[y, x] or seen[y, x]:
                continue
            q = deque([(y, x)])
            seen[y, x] = True
            x0, y0, x1, y1, area = x, y, x, y, 0
            while q:
                cy, cx = q.popleft()
                area += 1
                x0, x1 = min(x0, cx), max(x1, cx)
                y0, y1 = min(y0, cy), max(y1, cy)
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < gh and 0 <= nx < gw and g[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            q.append((ny, nx))
            boxes.append([x0 * DOWN, y0 * DOWN, (x1 + 1) * DOWN, (y1 + 1) * DOWN, area * DOWN * DOWN])
    if merge_dx or merge_dy:
        merged = True
        while merged:
            merged = False
            for i in range(len(boxes)):
                for j in range(i + 1, len(boxes)):
                    dx, dy = box_gap(boxes[i], boxes[j])
                    if dx < merge_dx and dy < merge_dy:
                        a, b = boxes[i], boxes[j]
                        boxes[i] = [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]), a[4] + b[4]]
                        del boxes[j]
                        merged = True
                        break
                if merged:
                    break
    return [b for b in boxes if b[4] >= min_area]

def box_gap(a, b):
    dx = max(0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0, max(a[1], b[1]) - min(a[3], b[3]))
    return dx, dy

def assemble_figures(boxes, line_rows, min_h=140, min_area=15000,
                     attach_dx=90, attach_dy=40):
    """Split components into figures (big) and attachments (muzzle flash, flying
    hats). Attach smalls to the nearest figure if horizontally adjacent; drop
    label glyphs sitting just below a baseline."""
    big, small = [], []
    for b in boxes:
        h, w, area = b[3] - b[1], b[2] - b[0], b[4]
        if (h > min_h and w > 60) or area > min_area:
            big.append(list(b))
        else:
            small.append(b)
    for s in small:
        # label glyphs live below a baseline
        if any(0 <= s[1] - r < 140 for r in line_rows):
            continue
        best, bd = None, 1e9
        for g in big:
            dx, dy = box_gap(s, g)
            if dx < attach_dx and dy < attach_dy and dx + dy < bd:
                bd, best = dx + dy, g
        if best is not None:
            best[0] = min(best[0], s[0]); best[1] = min(best[1], s[1])
            best[2] = max(best[2], s[2]); best[3] = max(best[3], s[3])
    big.sort(key=lambda b: (b[0] + b[2]) / 2)
    return big

def fullres_components(mask, labels=None):
    """4-connected components at full resolution (BFS over a boolean crop).
    If `labels` (int32 array, -1 init) is passed, per-pixel comp ids are written."""
    H, W = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    for y in range(H):
        row = mask[y]
        for x in np.where(row & ~seen[y])[0]:
            cid = len(out)
            q = deque([(y, x)])
            seen[y, x] = True
            x0, y0, x1, y1, area = x, y, x, y, 0
            while q:
                cy, cx = q.popleft()
                area += 1
                if labels is not None:
                    labels[cy, cx] = cid
                if cx < x0: x0 = cx
                if cx > x1: x1 = cx
                if cy < y0: y0 = cy
                if cy > y1: y1 = cy
                for ny, nx in ((cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)):
                    if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            out.append([x0, y0, x1 + 1, y1 + 1, area])
    return out

def seed_foot_x(mask_sub, seed):
    """Mean x of a seed's ground-contact pixels (bottom 12% of its box)."""
    y1 = seed[3]
    y0 = max(seed[1], y1 - max(6, int((seed[3] - seed[1]) * 0.12)))
    region = mask_sub[y0:y1, seed[0]:seed[2]]
    ys, xs = np.where(region)
    return seed[0] + (xs.mean() if len(xs) else (seed[2] - seed[0]) / 2)

def split_merged(boxes, mask, want):
    """If fewer boxes than expected, declump the widest ones: at full resolution
    the figures separate (the bridge was a downsampling artifact). Seeds = comps
    ≥25% of the largest. Ground-level smalls (helmets, blood) attach to the seed
    with the nearest FOOT position; airborne smalls (muzzle flash, flying hat)
    attach by centroid distance."""
    boxes = [list(b) for b in boxes]
    guard = 0
    while len(boxes) < want and guard < 6:
        guard += 1
        boxes.sort(key=lambda b: b[2] - b[0], reverse=True)
        b = boxes[0]
        sub = mask[b[1]:b[3], b[0]:b[2]]
        comps = fullres_components(sub)
        if not comps:
            break
        biggest = max(c[4] for c in comps)
        seeds = [c for c in comps if c[4] >= biggest * 0.25]
        rest = [c for c in comps if c[4] < biggest * 0.25]
        if len(seeds) < 2:
            break
        ground_y = max(s[3] for s in seeds)
        feet = [seed_foot_x(sub, g) for g in seeds]
        for s in rest:
            scx, scy = (s[0] + s[2]) / 2, (s[1] + s[3]) / 2
            best, bd = None, 1e9
            grounded = s[3] > ground_y - 50
            for g, fx in zip(seeds, feet):
                if grounded:
                    d = abs(scx - fx)
                else:
                    gcx, gcy = (g[0] + g[2]) / 2, (g[1] + g[3]) / 2
                    d = math.hypot(scx - gcx, scy - gcy)
                if d < bd:
                    bd, best = d, g
            gdx, gdy = box_gap(s, best)
            if best is not None and gdx + gdy < 160:
                best[0] = min(best[0], s[0]); best[1] = min(best[1], s[1])
                best[2] = max(best[2], s[2]); best[3] = max(best[3], s[3])
        news = [[b[0] + s[0], b[1] + s[1], b[0] + s[2], b[1] + s[3], s[4]] for s in seeds]
        boxes = boxes[1:] + news
    boxes.sort(key=lambda b: (b[0] + b[2]) / 2)
    return boxes

def tight_bbox(img, box, mask):
    x0, y0, x1, y1 = box[:4]
    sub = mask[y0:y1, x0:x1]
    ys, xs = np.where(sub)
    if len(xs) == 0:
        return None
    return [x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1]

def clean_alpha(img, lo=70):
    """Kill semi-transparent haze below `lo`, ramp the rest so edges stay soft."""
    out = img.copy()
    a = out[:, :, 3].astype(np.int32)
    a = np.clip((a - lo) * 255 // (255 - lo), 0, 255)
    out[:, :, 3] = a.astype(np.uint8)
    return out

def crop_frame(img, bb, pad=2):
    x0, y0, x1, y1 = bb
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(img.shape[1], x1 + pad), min(img.shape[0], y1 + pad)
    return img[y0:y1, x0:x1]

def crop_figure(img, box, pad=2, others=(), line_rows=(), keep_gap=None, strip_flash=False):
    """Crop a figure box, zeroing alpha of intruding neighbor fragments: drop
    components clipped by the crop border or centered inside another figure's box.
    Ground-line rows are erased so they can't bridge figures inside the crop."""
    x0, y0 = max(0, box[0] - pad), max(0, box[1] - pad)
    x1 = min(img.shape[1], box[2] + pad)
    y1 = min(img.shape[0], box[3] + pad)
    sub = img[y0:y1, x0:x1].copy()
    for r in line_rows:
        rr = r - y0
        if -4 <= rr < sub.shape[0] + 4:
            sub[max(0, rr - 4):rr + 5, :, 3] = 0
    m = sub[:, :, 3] > 40
    labels = np.full(m.shape, -1, dtype=np.int32)
    comps = fullres_components(m, labels)
    flash_c = None
    if comps:
        H, W = m.shape
        main = max(comps, key=lambda c: c[4])
        kept_ids = []
        for i, c in enumerate(comps):
            # crop rect = tight bbox of owned parts + pad: border-touchers are
            # clipped fragments of neighbors
            touches = c[0] <= 0 or c[1] <= 0 or c[2] >= W or c[3] >= H
            cx, cy = x0 + (c[0] + c[2]) / 2, y0 + (c[1] + c[3]) / 2
            foreign = any(o[0] <= cx <= o[2] and o[1] <= cy <= o[3] for o in others)
            far = keep_gap is not None and sum(box_gap(c, main)) > keep_gap
            flash = False
            if (strip_flash and c is not main and c[4] < main[4] * 0.25
                    and (c[0] + c[2]) / 2 > 0.55 * W):
                reg = sub[c[1]:c[3], c[0]:c[2]]
                lab = labels[c[1]:c[3], c[0]:c[2]]
                mine = lab == i
                bright = (reg[:, :, 0] > 195) & (reg[:, :, 1] > 155) & mine
                if bright.sum() > 20:
                    flash = True
                    if flash_c is None or c[4] > flash_c[4]:
                        flash_c = c
            if c is main or not (touches or foreign or far or flash):
                kept_ids.append(i)
        keep = np.isin(labels, kept_ids)
        # soft edge pixels (alpha 1..40) survive only next to kept pixels
        keep = dilate(keep, 2)
        sub[:, :, 3] = np.where(keep, sub[:, :, 3], 0)
        if strip_flash:
            # flashes drawn touching the rifle tip: remove warm-bright pixels in
            # the right region (hands/face sit left of 62% width)
            r_, g_, b_ = sub[:, :, 0].astype(np.int32), sub[:, :, 1].astype(np.int32), sub[:, :, 2]
            warm = (r_ > 180) & (g_ > 110) & (r_ + g_ > 330) & (sub[:, :, 3] > 0)
            xs = np.arange(W)[None, :]
            warm &= xs > 0.62 * W
            if warm.sum() > 15:
                ys2, xs2 = np.where(warm)
                flash_c = [[xs2.min(), ys2.min(), xs2.max() + 1, ys2.max() + 1, int(warm.sum())]]
                flash_c = flash_c[0]
                sub[:, :, 3] = np.where(dilate(warm, 2), 0, sub[:, :, 3])
        bb = tight_bbox(sub, [0, 0, W, H], sub[:, :, 3] > 60)
        if bb:
            sub = sub[bb[1]:bb[3], bb[0]:bb[2]]
            if flash_c is not None:
                flash_c = [(flash_c[0] + flash_c[2]) / 2 - bb[0],
                           (flash_c[1] + flash_c[3]) / 2 - bb[1]]
    if strip_flash:
        return sub, flash_c
    return sub

def anchors(frame):
    """footX = mean solid x in the bottom 14% band; baseline = last solid row."""
    m = frame[:, :, 3] > 60
    ys, xs = np.where(m)
    if len(ys) == 0:
        return frame.shape[1] // 2, frame.shape[0]
    y_bot = ys.max()
    band = ys > (y_bot - max(4, int((y_bot - ys.min()) * 0.14)))
    fx = int(xs[band].mean()) if band.any() else int(xs.mean())
    return fx, int(y_bot)

def save_frame(arr, path, scale):
    im = Image.fromarray(arr)
    if scale < 1:
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    im.save(path, optimize=True)
    return im.size

manifest = {'images': {}, 'sheets': {}, 'anims': {}}

def emit(name, folder, arr, scale, kind=None):
    fx, fy = anchors(arr)
    rel = os.path.relpath(folder, os.path.join(ROOT, 'assets'))
    path = os.path.join(folder, name + '.png')
    w, h = save_frame(arr, path, scale)
    manifest['images'][name] = {
        'src': f'assets/{rel}/{name}.png', 'w': w, 'h': h,
        'ax': round(fx * scale), 'ay': round(fy * scale),
    }
    return w, h

def contact(name, img, boxes):
    im = Image.fromarray(img).convert('RGBA')
    bg = Image.new('RGBA', im.size, (60, 60, 60, 255))
    bg.alpha_composite(im)
    dr = ImageDraw.Draw(bg)
    for i, b in enumerate(boxes):
        dr.rectangle(b[:4], outline=(255, 60, 60, 255), width=4)
        dr.text((b[0] + 6, b[1] + 6), str(i), fill=(255, 255, 0, 255))
    bg.convert('RGB').save(os.path.join(OUT_DEBUG, f'{name}_boxes.jpg'), quality=70)

POSES = ['idle', 'walk1', 'walk2', 'walk3', 'fire', 'prone', 'hit', 'fallen']

SOLDIER_SHEETS = {
    'us_rifle':  'US RIFLEMAN.png',
    'arvn':      'ARVN-US side.png',
    'us_m60':    'US M60 gunner.png',
    'us_sniper': 'US SNIPER .png',
    'vc_rifle':  'VIET RIFLEMAN.png',
    'vc_gunner': 'VIETCONG GUNNER.png',
    'vc_black':  'VIET ARVN.png',
}

TARGET_IDLE_H = 170  # px height of standing figure after downscale

def slice_soldier(key, fname, do_contact):
    img, erased = erase_baseline(key_checker(load(fname)))
    mask, line_rows = remove_ground_lines(solid_mask(img))
    line_rows = sorted(set(line_rows) | set(erased))
    comps = components(mask, min_area=700, merge_dx=0, merge_dy=0)
    boxes = assemble_figures(comps, line_rows, min_h=140, min_area=25000)
    if len(boxes) < 8:
        boxes = split_merged(boxes, mask, 8)
    if do_contact:
        contact(key, img, boxes)
    if len(boxes) != 8:
        print(f'!! {key}: found {len(boxes)} figure boxes (want 8) — check debug/{key}_boxes.jpg')
        return False
    tights = [tight_bbox(img, b, solid_mask(img, 60)) for b in boxes]
    frames, muzzle = [], None
    for pose, tb in zip(POSES, tights):
        others = [t for t in tights if t is not tb]
        if pose == 'fire':
            fr, fl = crop_figure(img, tb, others=others, line_rows=line_rows, strip_flash=True)
            if fl is not None:
                muzzle = fl
        else:
            fr = crop_figure(img, tb, others=others, line_rows=line_rows)
        frames.append(fr)
    scale = min(1.0, TARGET_IDLE_H / frames[0].shape[0])
    sheet = {'poses': {}}
    for pose, fr in zip(POSES, frames):
        n = f'{key}_{pose}'
        emit(n, OUT_SPRITES, fr, scale)
        sheet['poses'][pose] = n
    if muzzle is not None:
        fm = manifest['images'][f'{key}_fire']
        sheet['muzzle'] = [round(muzzle[0] * scale - fm['ax']), round(muzzle[1] * scale - fm['ay'])]
    idle_h = manifest['images'][f'{key}_idle']['h']
    sheet['standH'] = idle_h
    manifest['sheets'][key] = sheet
    print(f'ok {key}: 8 poses, idle {idle_h}px, muzzle {sheet.get("muzzle")}')
    return True

def slice_vc_sniper(do_contact):
    """Pixel-art multi-row sheet: 3 baseline rows with labels."""
    key = 'vc_sniper'
    img, _ = erase_baseline(key_checker(load('VIET SNIPER.png')))
    mask, line_rows = remove_ground_lines(solid_mask(img))
    comps = components(mask, min_area=700, merge_dx=0, merge_dy=0)
    boxes = assemble_figures(comps, line_rows, min_h=120, min_area=20000, attach_dx=60, attach_dy=60)
    # cluster rows by bottom y
    boxes.sort(key=lambda b: b[3])
    rows = []
    for b in boxes:
        if rows and abs(b[3] - rows[-1][-1][3]) < 120:
            rows[-1].append(b)
        else:
            rows.append([b])
    for r in rows:
        r.sort(key=lambda b: (b[0] + b[2]) / 2)
    if do_contact:
        contact(key, img, [b for r in rows for b in r])
    print(f'{key}: rows of {[len(r) for r in rows]}')
    if len(rows) < 3:
        print(f'!! {key}: expected 3 rows')
        return False
    r1, r2, r3 = rows[0], rows[1], rows[2]
    try:
        picks = {
            'idle': r1[0], 'walk1': r1[2], 'walk2': r1[3], 'walk3': r1[4],
            'fire': r2[1] if len(r2) > 1 else r1[-1],
            'prone': r2[-1],
            'hit': r3[0], 'fallen': r3[-1],
        }
    except IndexError:
        print(f'!! {key}: row layout unexpected')
        return False
    frames, muzzle = {}, None
    for p, b in picks.items():
        tb = tight_bbox(img, b, solid_mask(img, 60))
        if p in ('fire', 'prone'):
            fr, fl = crop_figure(img, tb, keep_gap=25, strip_flash=True)
            if p == 'fire' and fl is not None:
                muzzle = fl
        else:
            fr = crop_figure(img, tb, keep_gap=25)
        frames[p] = fr
    scale = min(1.0, TARGET_IDLE_H / frames['idle'].shape[0])
    sheet = {'poses': {}}
    for pose, fr in frames.items():
        n = f'{key}_{pose}'
        emit(n, OUT_SPRITES, fr, scale)
        sheet['poses'][pose] = n
    if muzzle is not None:
        fm = manifest['images'][f'{key}_fire']
        sheet['muzzle'] = [round(muzzle[0] * scale - fm['ax']), round(muzzle[1] * scale - fm['ay'])]
    sheet['standH'] = manifest['images'][f'{key}_idle']['h']
    manifest['sheets'][key] = sheet
    print(f'ok {key}')
    return True

DECAL_NAMES = []  # named generically; game-role mapping happens in JS after visual QA

def slice_decals(do_contact):
    img, _ = erase_baseline(key_checker(load('Decals injury:death.png')))
    mask, line_rows = remove_ground_lines(solid_mask(img))
    comps = components(mask, min_area=700, merge_dx=0, merge_dy=0)
    boxes = assemble_figures(comps, line_rows, min_h=110, min_area=22000, attach_dx=130, attach_dy=60)
    boxes = [b for b in boxes if (b[2] - b[0]) > 100 and (b[3] - b[1]) > 60]
    # two rows: cluster by center y
    boxes.sort(key=lambda b: ((b[1] + b[3]) // 900, (b[0] + b[2]) / 2))
    if do_contact:
        contact('decals', img, boxes)
    print(f'decals: {len(boxes)} boxes')
    for i, b in enumerate(boxes):
        name = DECAL_NAMES[i] if i < len(DECAL_NAMES) else f'decal_extra{i}'
        fr = crop_figure(img, tight_bbox(img, b, solid_mask(img, 60)))
        scale = min(1.0, 150 / fr.shape[0])
        emit(name, OUT_DECALS, fr, scale)
    return True

VFX_ROWS = [  # (name, approx display row order)
    ('muzzle', 0), ('groundfire', 1), ('expl', 2), ('napalm', 3), ('blast', 4),
]

VFX_BANDS = [  # (name, bottom-y range in the 2754x1536 sheet)
    ('muzzle', 0, 500), ('groundfire', 500, 750), ('expl', 750, 1050),
    ('napalm', 1050, 1350), ('blast', 1350, 1600),
]

def slice_vfx(do_contact):
    img = load('fire decals.png').copy()
    H, W = img.shape[:2]
    # PASS 1 — text erase on a HIGH-threshold mask: the dim glow halo that welds
    # label glyphs onto flames disappears at lum>75, so glyphs become their own
    # short components and can be wiped from the image
    hi = lum_mask(img, 75)
    for b in components(hi, min_area=60, merge_dx=14, merge_dy=8):
        h = b[3] - b[1]
        watermark = b[0] > W - 300 and b[3] > H - 300
        if h <= 72 or watermark:
            img[max(0, b[1] - 2):b[3] + 2, max(0, b[0] - 2):b[2] + 2, :3] = 0
    img[:200, :, :3] = 0  # sheet title band
    # PASS 2 — frame detection on the cleaned image
    mask = lum_mask(img, 40)
    boxes = [b for b in components(mask, min_area=1200, merge_dx=0, merge_dy=0)
             if (b[3] - b[1]) > 70]
    rows = []
    for name, y0, y1 in VFX_BANDS:
        band = [b for b in boxes if y0 <= b[3] < y1]
        band.sort(key=lambda b: b[0])
        # group fragments (flame + detached smoke) into frames by x proximity
        frames = []
        for b in band:
            if frames and b[0] - frames[-1][2] < 40:
                f = frames[-1]
                frames[-1] = [min(f[0], b[0]), min(f[1], b[1]), max(f[2], b[2]), max(f[3], b[3]), f[4] + b[4]]
            else:
                frames.append(list(b))
        if name == 'napalm' and frames:
            # the napalm wall frames touch — carve the strip into 14 equal columns
            x0 = min(f[0] for f in frames); x1 = max(f[2] for f in frames)
            ytop = min(f[1] for f in frames); ybot = max(f[3] for f in frames)
            n = 14
            step = (x1 - x0) / n
            frames = []
            for i in range(n):
                cx0, cx1 = int(x0 + i * step), int(x0 + (i + 1) * step)
                sub = mask[ytop:ybot, cx0:cx1]
                ys, xs = np.where(sub)
                if len(ys) < 400:
                    continue
                frames.append([cx0 + xs.min(), ytop + ys.min(), cx0 + xs.max() + 1, ytop + ys.max() + 1, len(ys)])
        elif name == 'expl':
            # split any group holding two blooms at its thinnest column
            frames.sort(key=lambda b: b[0])
            widths = sorted(f[2] - f[0] for f in frames)
            med = widths[len(widths) // 2]
            out = []
            for f in frames:
                if f[2] - f[0] > 1.6 * med:
                    sub = mask[f[1]:f[3], f[0]:f[2]]
                    col = sub.sum(axis=0)
                    w = len(col)
                    cut = int(w * 0.25) + int(np.argmin(col[int(w * 0.25):int(w * 0.75)]))
                    out.append([f[0], f[1], f[0] + cut, f[3], 0])
                    out.append([f[0] + cut, f[1], f[2], f[3], 0])
                else:
                    out.append(f)
            frames = sorted(out, key=lambda b: b[0])
        rows.append({'name': name, 'boxes': frames})
    if do_contact:
        contact('vfx', img, [b for r in rows for b in r['boxes']])
    print(f"vfx rows: {[(r['name'], len(r['boxes'])) for r in rows]}")
    if any(len(r['boxes']) < 5 for r in rows):
        print('!! vfx: a band came up short — check debug/vfx_boxes.jpg')
        return False
    # convert black-backed emissive to straight alpha (alpha = max channel)
    rgb = img[:, :, :3].astype(np.float32)
    a = rgb.max(axis=2)
    safe = np.maximum(a, 1)[..., None]
    straight = np.clip(rgb / safe * 255, 0, 255).astype(np.uint8)
    conv = np.dstack([straight, a.astype(np.uint8)])
    for row in rows:
        name = row['name']
        frames = []
        for i, b in enumerate(row['boxes']):
            bb = tight_bbox(conv, b, conv[:, :, 3] > 24)
            fr = crop_frame(conv, bb, pad=3)
            scale = min(1.0, 230 / fr.shape[0])
            n = f'{name}_{i}'
            emit(n, OUT_VFX, fr, scale)
            frames.append(n)
        manifest['anims'][name] = frames
    return True

OUT_UI = os.path.join(ROOT, 'assets', 'ui')
os.makedirs(OUT_UI, exist_ok=True)

# card-portrait crops from the selector mockups: 6 card centers along the bottom
# row (same template in both sheets), sliced as opaque squares for the HUD cards
PORTRAIT_SHEETS = [
    ('US SELECTOR .png', ['rifleman', 'arvn', 'm60', 'engineer', 'recon', 'sniper']),
    ('REDONE SOLDIER SELECTOR.png', ['guerrilla', 'nva', 'rpg', 'rpd', 'sapper', 'marksman']),
]

def slice_portraits():
    centers_x = [434, 700, 968, 1235, 1504, 1772]
    cy, half = 1330, 62
    for fname, keys in PORTRAIT_SHEETS:
        img = load(fname)
        H, W = img.shape[:2]
        for cx, key in zip(centers_x, keys):
            x0, x1 = max(0, cx - half), min(W, cx + half)
            y0, y1 = max(0, cy - half), min(H, cy + half)
            crop = img[y0:y1, x0:x1].copy()
            crop[:, :, 3] = 255
            name = f'port_{key}'
            path = os.path.join(OUT_UI, name + '.png')
            im = Image.fromarray(crop).resize((110, 110), Image.LANCZOS)
            im.save(path, optimize=True)
            manifest['images'][name] = {'src': f'assets/ui/{name}.png', 'w': 110, 'h': 110, 'ax': 55, 'ay': 55}
    print('ok portraits')
    return True

NEW_SRC = os.path.join(SRC, 'new:unsorted')

def key_solid(img, tol=34):
    """Key out a solid painted background: find the modal color and alpha-zero
    everything within `tol` euclidean distance, feathered."""
    rgb = img[:, :, :3].astype(np.int32)
    q = (rgb // 12).reshape(-1, 3)
    keys, counts = np.unique(q, axis=0, return_counts=True)
    bg = keys[counts.argmax()] * 12 + 6
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    fg = erode(dist > tol, 1)
    out = img.copy()
    from PIL import ImageFilter
    a = Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
    out[:, :, 3] = np.array(a)
    return out

def slice_grid(fname, prefix, cols, rows, out_dir, target_h=None, skip=(),
               num_box=(0.28, 0.26), inset=5, min_area=400, uniform_scale=None):
    """Slice a numbered grid sheet with solid bg. Returns list of emitted names.
    skip: set of (row, col) to ignore (header cells). num_box: fraction of cell
    (w,h) to erase at top-left (frame numbers). uniform_scale: scale all frames
    identically (for animations) — computed from median figure height if None
    and target_h given."""
    img = key_solid(load(os.path.join('new:unsorted', fname) if not os.path.isabs(fname) else fname))
    H, W = img.shape[:2]
    cw, ch = W / cols, H / rows
    crops = []
    for r in range(rows):
        for c in range(cols):
            if (r, c) in skip:
                crops.append(None)
                continue
            x0, y0 = int(c * cw), int(r * ch)
            x1, y1 = int((c + 1) * cw), int((r + 1) * ch)
            cell = img[y0 + inset:y1 - inset, x0 + inset:x1 - inset].copy()
            # erase the painted frame number
            cell[:int(cell.shape[0] * num_box[1]), :int(cell.shape[1] * num_box[0]), 3] = 0
            m = cell[:, :, 3] > 60
            if m.sum() < min_area:
                crops.append(None)
                continue
            ys, xs = np.where(m)
            crops.append(cell[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
    scale = uniform_scale
    if scale is None and target_h:
        hs = sorted(cr.shape[0] for cr in crops if cr is not None)
        med = hs[len(hs) // 2] if hs else 1
        scale = min(1.0, target_h / med)
    names = []
    for i, cr in enumerate(crops):
        if cr is None:
            names.append(None)
            continue
        n = f'{prefix}_{i:02d}'
        emit(n, out_dir, cr, scale if scale else 1.0)
        names.append(n)
    return names

def slice_anim_fixed(fname, prefix, cols, rows, target_h, drop=(), keep_rows=None,
                     checker=False, plant=False):
    """Animation-grade grid slicing: ONE uniform crop box + shared baseline.

    For run/walk cycles the artist draws the figure PROGRESSING forward across
    each cell, so a cell-center anchor makes the whole body lurch back and forth
    on screen. `plant=True` gives each frame its own horizontal anchor at the
    hip/torso centroid, so the body stays put and only the limbs cycle
    ("running in place"). Vertical baseline anchor stays shared for a clean
    ground plant."""
    raw = load(os.path.join('new:unsorted', fname))
    img = key_checker(raw) if checker else key_solid(raw)
    H, W = img.shape[:2]
    cw, ch = W / cols, H / rows
    cells = []
    for r in range(rows):
        if keep_rows is not None and r not in keep_rows:
            continue
        for c in range(cols):
            x0, y0 = int(c * cw) + 4, int(r * ch) + 4
            cell = img[y0:int((r + 1) * ch) - 4, x0:int((c + 1) * cw) - 4].copy()
            # erase painted frame numbers (top-left corner of each cell)
            cell[:int(cell.shape[0] * 0.28), :int(cell.shape[1] * 0.32), 3] = 0
            cells.append(cell)
    # per-cell: find a wide dark ground line in the bottom 40%, erase it
    baselines = []
    for cell in cells:
        h, w = cell.shape[:2]
        rgb = cell[:, :, :3].astype(np.int32)
        dark = (rgb.sum(axis=2) < 300) & (cell[:, :, 3] > 60)
        base = None
        for y in range(h - 1, int(h * 0.55), -1):
            runs = np.where(dark[y])[0]
            if len(runs) > 0.3 * w:
                base = y
                break
        if base is not None:
            cell[max(0, base - 3):min(h, base + 6), :, 3] = 0
            baselines.append(base)
        else:
            m = np.where(cell[:, :, 3] > 60)[0]
            if len(m):
                baselines.append(m.max())
    baseY = int(np.median(baselines)) if baselines else cells[0].shape[0] - 4
    # union content box across all frames → single crop box, single anchor
    xs0, xs1, ys0 = [], [], []
    heights = []
    for cell in cells:
        m = cell[:, :, 3] > 60
        ys, xs = np.where(m)
        if not len(xs):
            continue
        xs0.append(xs.min()); xs1.append(xs.max()); ys0.append(ys.min())
        heights.append(baseY - ys.min())
    bx0 = max(0, min(xs0) - 4); bx1 = min(cells[0].shape[1], max(xs1) + 5)
    by0 = max(0, min(ys0) - 4); by1 = min(cells[0].shape[0], baseY + 4)
    medH = sorted(heights)[len(heights) // 2]
    scale = min(1.0, target_h / max(1, medH))
    ax = round(((bx0 + bx1) / 2 - bx0) * scale)
    ay = round((baseY - by0) * scale)
    manifest.setdefault('animMeta', {})[prefix] = {'standH': round(medH * scale)}

    def hip_anchor(cell):
        """Horizontal centroid of the hip band (40–68% of figure height) — the
        most stable body landmark across a stride, ignoring swinging limbs and
        the extended weapon up top."""
        m = cell[:, :, 3] > 60
        ys, xs = np.where(m)
        if not len(xs):
            return (bx0 + bx1) / 2
        top = ys.min()
        band_top = int(top + 0.40 * (baseY - top))
        band_bot = int(top + 0.68 * (baseY - top))
        band = m[band_top:band_bot + 1, :]
        bys, bxs = np.where(band)
        if len(bxs) < 20:
            return xs.mean()
        return bxs.mean()

    names = []
    for i, cell in enumerate(cells):
        if i in drop:
            continue
        crop = cell[by0:by1, bx0:bx1]
        if (crop[:, :, 3] > 60).sum() < 300:
            continue
        # per-frame plant anchor for cycles; shared cell-center otherwise
        fax = round((hip_anchor(cell) - bx0) * scale) if plant else ax
        n = f'{prefix}_{i:02d}'
        path = os.path.join(OUT_SPRITES, n + '.png')
        im = Image.fromarray(crop)
        if scale < 1:
            im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
        im.save(path, optimize=True)
        manifest['images'][n] = {'src': f'assets/sprites/{n}.png', 'w': im.width, 'h': im.height, 'ax': fax, 'ay': ay}
        names.append(n)
    return names

def slice_new_assets():
    ok = True
    # run cycles with FIXED shared anchors (uniform crop box = zero jitter).
    # The "new and improved" 12-frame cycles are the visual benchmark.
    manifest['anims']['us_run'] = slice_anim_fixed(
        'new:improved us soldier runnign.png', 'usrun12', 6, 2, TARGET_IDLE_H, checker=True, plant=True)
    manifest['anims']['vc_run'] = slice_anim_fixed(
        'new:improced VC-Run.png', 'vcrun12', 6, 2, TARGET_IDLE_H, checker=True, plant=True)
    manifest['anims']['nva_run'] = slice_anim_fixed(
        'claudeassetvietcongrun.png', 'nvarunf', 10, 5, TARGET_IDLE_H, plant=True)
    manifest['anims']['m60_run'] = slice_anim_fixed(
        'claudeassetm60RUN.png', 'm60runf', 10, 6, TARGET_IDLE_H, plant=True)
    # grenade throw sequences (row 0 of each sheet) — wired in the orders build
    manifest['anims']['us_nade'] = slice_anim_fixed(
        'claudeassetgranadeUS.png', 'usnade', 9, 2, TARGET_IDLE_H, keep_rows={0})
    manifest['anims']['vc_nade'] = slice_anim_fixed(
        'claudeassetvietcongranade.png', 'vcnade', 9, 2, TARGET_IDLE_H, keep_rows={0})
    # per-class run cycles (6×5 grid: m60 / engineer / boonie sniper / NVA / flamethrower)
    for anim, pref, row in [('m60_runB', 'm60rB', 0), ('eng_run', 'engrn', 1),
                            ('sniper_run', 'snrun', 2), ('nva_runB', 'nvarB', 3),
                            ('flame_run', 'flrun', 4)]:
        manifest['anims'][anim] = slice_anim_fixed(
            'n:i- per class runs us and vc.png', pref, 6, 5, TARGET_IDLE_H, keep_rows={row}, plant=True)

    # phase-2 animation sets: idles, fire recoil loops, prone transitions, deaths
    manifest['anims']['us_idle'] = slice_anim_fixed(
        'n:i- Us.png idle macro loop.png', 'usidle', 6, 1, TARGET_IDLE_H)
    manifest['anims']['vc_idle'] = slice_anim_fixed(
        'n:i- VC idle loop.png', 'vcidle', 6, 1, TARGET_IDLE_H)
    manifest['anims']['us_death'] = slice_anim_fixed(
        'n:i- Us death fall.png', 'usdeath', 8, 1, TARGET_IDLE_H)
    manifest['anims']['vc_death'] = slice_anim_fixed(
        'n:i- VC death loop.png', 'vcdeath', 8, 1, TARGET_IDLE_H)
    for anim, pref, row in [('us_fire_m16', 'usfm16', 0), ('vc_fire_ak', 'vcfak', 1),
                            ('us_fire_m60', 'usfm60', 2), ('us_fire_prone', 'usfpr', 3)]:
        manifest['anims'][anim] = slice_anim_fixed(
            'n:i- Fire recoil loops.png', pref, 4, 4, TARGET_IDLE_H, keep_rows={row})
    manifest['anims']['us_toprone'] = slice_anim_fixed(
        'N:I-Prone transitions.png', 'usprone', 6, 2, TARGET_IDLE_H, keep_rows={0})
    manifest['anims']['vc_toprone'] = slice_anim_fixed(
        'N:I-Prone transitions.png', 'vcprone', 6, 2, TARGET_IDLE_H, keep_rows={1})

    # remap meta keys from slice prefixes to anim names
    mm = manifest.get('animMeta', {})
    for anim, pref in [('us_run', 'usrun12'), ('vc_run', 'vcrun12'), ('nva_run', 'nvarunf'),
                       ('m60_run', 'm60runf'), ('us_nade', 'usnade'), ('vc_nade', 'vcnade'),
                       ('us_idle', 'usidle'), ('vc_idle', 'vcidle'),
                       ('us_death', 'usdeath'), ('vc_death', 'vcdeath'),
                       ('us_fire_m16', 'usfm16'), ('vc_fire_ak', 'vcfak'),
                       ('us_fire_m60', 'usfm60'), ('us_fire_prone', 'usfpr'),
                       ('us_toprone', 'usprone'), ('vc_toprone', 'vcprone'),
                       ('m60_runB', 'm60rB'), ('eng_run', 'engrn'), ('sniper_run', 'snrun'),
                       ('nva_runB', 'nvarB'), ('flame_run', 'flrun')]:
        if pref in mm:
            mm[anim] = mm.pop(pref)
    for k in ['us_run', 'vc_run', 'nva_run', 'm60_run', 'us_nade', 'vc_nade']:
        print(f'{k}: {len(manifest["anims"][k])} frames standH={mm.get(k, {}).get("standH")}')

    # terrain + village kits (col 0 of each row holds the section header)
    skip_col0 = {(r, 0) for r in range(6)}
    OUT_TERRAIN = os.path.join(ROOT, 'assets', 'terrain')
    os.makedirs(OUT_TERRAIN, exist_ok=True)
    t1 = slice_grid('textures_plants1.png', 't1', 10, 6, OUT_TERRAIN, skip=skip_col0,
                    num_box=(0.24, 0.24), min_area=260)
    t2 = slice_grid('textures 2.png', 't2', 10, 6, OUT_TERRAIN, skip=skip_col0,
                    num_box=(0.24, 0.24), min_area=260)
    print(f'terrain cells: t1 {sum(1 for n in t1 if n)}, t2 {sum(1 for n in t2 if n)}')
    return ok

def montage():
    """Contact sheet of every emitted frame for visual QA."""
    names = sorted(manifest['images'].keys())
    if not names:
        return
    cell = 130
    cols = 10
    rows = math.ceil(len(names) / cols)
    sheet = Image.new('RGB', (cols * cell, rows * (cell + 14)), (88, 96, 88))
    dr = ImageDraw.Draw(sheet)
    for i, n in enumerate(names):
        im = Image.open(os.path.join(ROOT, manifest['images'][n]['src'])).convert('RGBA')
        s = min((cell - 8) / im.width, (cell - 8) / im.height, 1.0)
        im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))))
        cx, cy = (i % cols) * cell, (i // cols) * (cell + 14)
        sheet.paste(im, (cx + (cell - im.width) // 2, cy + (cell - im.height) // 2), im)
        dr.text((cx + 3, cy + cell - 2), n[:22], fill=(255, 255, 160))
    sheet.save(os.path.join(OUT_DEBUG, 'frames_all.jpg'), quality=80)

def main():
    do_contact = '--contact' in sys.argv
    ok = True
    for key, fname in SOLDIER_SHEETS.items():
        ok &= slice_soldier(key, fname, do_contact)
    ok &= slice_vc_sniper(do_contact)
    ok &= slice_decals(do_contact)
    ok &= slice_vfx(do_contact)
    ok &= slice_portraits()
    ok &= slice_new_assets()
    js = 'const ASSET_MANIFEST = ' + json.dumps(manifest) + ';\n'
    with open(os.path.join(ROOT, 'assets', 'manifest.js'), 'w') as f:
        f.write(js)
    montage()
    total = sum(os.path.getsize(os.path.join(dp, f)) for d in (OUT_SPRITES, OUT_VFX, OUT_DECALS)
                for dp, _, fs in os.walk(d) for f in fs)
    print(f'manifest: {len(manifest["images"])} images, total {total/1e6:.2f} MB — {"ALL OK" if ok else "HAS PROBLEMS"}')

if __name__ == '__main__':
    main()
