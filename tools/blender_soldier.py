"""Build a soldier in Blender and render 2D sprite sheets for Vietnam '65.

Why: AI-generated frames are drawn independently, so the character morphs between
them. A 3D model rendered from a locked camera is the SAME character in every
frame by construction — that is the whole reason for this pipeline.

The soldier is a jointed puppet. Rather than fight Blender's bone-parent inverse
matrices we do the forward kinematics ourselves: every part is a rigid segment
that belongs to a joint frame, and per pose we place it with the accumulated
rotation of its chain. Deterministic, and the pose maths mirrors js/rig.js.

Camera looks down +Y, so screen-right is +X and screen-up is +Z: limbs swing
about the **Y axis**.

Run:
  /Applications/Blender.app/Contents/MacOS/Blender -b \
      --python tools/blender_soldier.py -- --unit rifleman
"""
import bpy, bmesh, math, os, sys, json
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


UNIT = arg('--unit', 'rifleman')
OUT = arg('--out', 'assets/sprites3d')
RES = int(arg('--res', '320'))
ONLY = arg('--only')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(ROOT, OUT, UNIT)
os.makedirs(OUTDIR, exist_ok=True)

# ----------------------------------------------------------------- kit
KIT = {
    'rifleman':  dict(uniform=(0.30, 0.34, 0.21), gear=(0.38, 0.35, 0.22),
                      skin=(0.80, 0.64, 0.49), boot=(0.10, 0.10, 0.08),
                      hatcol=(0.25, 0.29, 0.18), wood=(0.31, 0.18, 0.09),
                      metal=(0.14, 0.14, 0.12), hat='helmet'),
    'arvn':      dict(uniform=(0.36, 0.40, 0.27), gear=(0.38, 0.35, 0.22),
                      skin=(0.76, 0.60, 0.44), boot=(0.10, 0.10, 0.08),
                      hatcol=(0.28, 0.32, 0.21), wood=(0.31, 0.18, 0.09),
                      metal=(0.14, 0.14, 0.12), hat='helmet'),
    'guerrilla': dict(uniform=(0.14, 0.13, 0.11), gear=(0.34, 0.32, 0.21),
                      skin=(0.76, 0.60, 0.44), boot=(0.30, 0.22, 0.13),
                      hatcol=(0.78, 0.66, 0.42), wood=(0.33, 0.19, 0.10),
                      metal=(0.13, 0.13, 0.11), hat='conical'),
    'nva':       dict(uniform=(0.37, 0.35, 0.23), gear=(0.31, 0.30, 0.20),
                      skin=(0.76, 0.60, 0.44), boot=(0.21, 0.18, 0.12),
                      hatcol=(0.35, 0.33, 0.21), wood=(0.33, 0.19, 0.10),
                      metal=(0.13, 0.13, 0.11), hat='pith'),
}
C = KIT.get(UNIT, KIT['rifleman'])

# ----------------------------------------------------------------- skeleton
# rest positions, metres, figure stands 1.80 tall. Near side = -Y (toward camera)
REST = {
    'pelvis':  Vector((0, 0, 0.98)),
    'chest':   Vector((0, 0, 1.14)),
    'neck':    Vector((0, 0, 1.49)),
    'headtop': Vector((0, 0, 1.76)),
    'shoulder.N': Vector((0, -0.13, 1.43)), 'elbow.N': Vector((0, -0.13, 1.19)),
    'hand.N':     Vector((0, -0.13, 0.97)),
    'shoulder.F': Vector((0, 0.13, 1.43)),  'elbow.F': Vector((0, 0.13, 1.19)),
    'hand.F':     Vector((0, 0.13, 0.97)),
    'hip.N':   Vector((0, -0.085, 0.95)), 'knee.N': Vector((0, -0.085, 0.54)),
    'ankle.N': Vector((0, -0.085, 0.10)),
    'hip.F':   Vector((0, 0.085, 0.95)),  'knee.F': Vector((0, 0.085, 0.54)),
    'ankle.F': Vector((0, 0.085, 0.10)),
}
PARENT = {
    'pelvis': None, 'chest': 'pelvis', 'neck': 'chest', 'headtop': 'neck',
    'shoulder.N': 'chest', 'elbow.N': 'shoulder.N', 'hand.N': 'elbow.N',
    'shoulder.F': 'chest', 'elbow.F': 'shoulder.F', 'hand.F': 'elbow.F',
    'hip.N': 'pelvis', 'knee.N': 'hip.N', 'ankle.N': 'knee.N',
    'hip.F': 'pelvis', 'knee.F': 'hip.F', 'ankle.F': 'knee.F',
}
# a pose rotates these frames (degrees, about Y = the side-view swing plane)
FRAMES = ['pelvis', 'chest', 'neck', 'shoulder.N', 'elbow.N',
          'shoulder.F', 'elbow.F', 'hip.N', 'knee.N', 'hip.F', 'knee.F']


def solve(pose):
    """Forward kinematics: joint -> (world position, accumulated rotation)."""
    world = {}
    rot = {}

    def go(j):
        p = PARENT[j]
        if p is None:
            R = Quaternion((1, 0, 0), 0)
            if 'pelvis' in pose:
                R = Quaternion((0, 1, 0), math.radians(pose['pelvis']))
            world[j] = REST[j].copy()
            rot[j] = R
            return
        if p not in world:
            go(p)
        local = REST[j] - REST[p]
        R = rot[p].copy()
        if j in pose and j in FRAMES:
            R = R @ Quaternion((0, 1, 0), math.radians(pose[j]))
        world[j] = world[p] + (rot[p] @ local)
        rot[j] = R

    for j in REST:
        go(j)
    return world, rot


# ----------------------------------------------------------------- materials
def mat(name, rgb, outline=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    if outline:
        sh = nt.nodes.new('ShaderNodeEmission')
        sh.inputs['Color'].default_value = (0.05, 0.06, 0.04, 1)
        # inverted hull: cull the inward-facing shell so only the rim survives
        m.use_backface_culling = True
    else:
        sh = nt.nodes.new('ShaderNodeBsdfDiffuse')
        sh.inputs['Color'].default_value = (*rgb, 1)
        sh.inputs['Roughness'].default_value = 1.0
    # EEVEE will happily composite these as semi-transparent against a
    # transparent film unless we pin them opaque
    for attr, val in (('surface_render_method', 'DITHERED'),
                      ('blend_method', 'OPAQUE'),
                      ('shadow_method', 'OPAQUE')):
        try:
            setattr(m, attr, val)
        except Exception:
            pass
    nt.links.new(sh.outputs[0], out.inputs['Surface'])
    return m


OUTLINE = None


def seg_mesh(name, length, thick, material):
    """A rounded box of `length` running along +Z from the object origin."""
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= thick[0]
        v.co.y *= thick[1]
        v.co.z = v.co.z * length + length / 2
    bmesh.ops.bevel(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                    offset=min(thick) * 0.3, segments=2, affect='VERTICES')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    me.materials.append(OUTLINE)
    for p in me.polygons:
        p.use_smooth = False
    ob.rotation_mode = 'QUATERNION'
    return ob


# parts: (name, frame, restA, restB, thickness, material key)
def part_list():
    return [
        ('torso',  'chest',  'pelvis', 'neck',     (0.27, 0.36), 'uniform'),
        ('webbing', 'chest', 'chest',  'neck',     (0.30, 0.38), 'gear'),
        ('hips',   'pelvis', 'pelvis', 'chest',    (0.28, 0.34), 'gear'),
        ('neck',   'neck',   'neck',   'headtop',  (0.12, 0.13), 'skin'),
        ('head',   'neck',   'neck',   'headtop',  (0.21, 0.22), 'skin'),
        ('uarm.F', 'shoulder.F', 'shoulder.F', 'elbow.F', (0.125, 0.125), 'uniformF'),
        ('farm.F', 'elbow.F',    'elbow.F',    'hand.F',  (0.11, 0.11),  'uniformF'),
        ('thigh.F', 'hip.F',  'hip.F',  'knee.F',  (0.165, 0.165), 'uniformF'),
        ('shin.F', 'knee.F',  'knee.F', 'ankle.F', (0.14, 0.14),  'uniformF'),
        ('boot.F', 'knee.F',  'ankle.F', 'ankle.F', (0.115, 0.135), 'bootF'),
        ('thigh.N', 'hip.N',  'hip.N',  'knee.N',  (0.17, 0.17),  'uniform'),
        ('shin.N', 'knee.N',  'knee.N', 'ankle.N', (0.145, 0.145), 'uniform'),
        ('boot.N', 'knee.N',  'ankle.N', 'ankle.N', (0.12, 0.14), 'boot'),
        ('uarm.N', 'shoulder.N', 'shoulder.N', 'elbow.N', (0.13, 0.13), 'uniform'),
        ('farm.N', 'elbow.N',    'elbow.N',    'hand.N',  (0.115, 0.115), 'uniform'),
    ]


def main():
    global OUTLINE
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    try:
        sc.eevee.taa_render_samples = 48
    except Exception:
        pass
    sc.render.film_transparent = True
    sc.render.resolution_x = RES
    sc.render.resolution_y = RES
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'

    OUTLINE = mat('outline', (0, 0, 0), outline=True)
    M = {
        'uniform': mat('uniform', C['uniform']),
        'uniformF': mat('uniformF', [c * 0.72 for c in C['uniform']]),
        'gear': mat('gear', C['gear']),
        'skin': mat('skin', C['skin']),
        'boot': mat('boot', C['boot']),
        'bootF': mat('bootF', [c * 0.72 for c in C['boot']]),
        'hat': mat('hat', C['hatcol']),
        'wood': mat('wood', C['wood']),
        'metal': mat('metal', C['metal']),
    }

    # build every part once at rest, then re-place per pose
    objs = []
    for name, frame, a, b, thick, mk in part_list():
        L = (REST[b] - REST[a]).length
        if name.startswith('boot'):
            L = 0.20                      # boot is a stub, not a joint span
        if name == 'head':
            L = 0.24
        ob = seg_mesh(name, max(L, 0.02), thick, M[mk])
        objs.append((ob, frame, a, b, name))

    # headgear
    hat = seg_mesh('hat', 0.13,
                   (0.46, 0.46) if C['hat'] == 'conical' else (0.26, 0.27), M['hat'])
    objs.append((hat, 'neck', 'neck', 'headtop', 'hat'))
    # weapon, carried in the near hand
    rifle = seg_mesh('rifle', 0.78, (0.055, 0.05), M['metal'])
    objs.append((rifle, 'elbow.N', None, None, 'rifle'))
    stock = seg_mesh('stock', 0.30, (0.08, 0.07), M['wood'])
    objs.append((stock, 'elbow.N', None, None, 'stock'))

    # camera + lights
    cam_d = bpy.data.cameras.new('cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = 2.1
    cam = bpy.data.objects.new('cam', cam_d)
    bpy.context.collection.objects.link(cam)
    cam.location = (0.0, -6.0, 0.92)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam

    key = bpy.data.lights.new('key', 'SUN')
    key.energy = 3.0
    ko = bpy.data.objects.new('key', key)
    bpy.context.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(58), 0, math.radians(35))
    fill = bpy.data.lights.new('fill', 'SUN')
    fill.energy = 1.2
    fo = bpy.data.objects.new('fill', fill)
    bpy.context.collection.objects.link(fo)
    fo.rotation_euler = (math.radians(75), 0, math.radians(-130))
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.32, 0.35, 0.30, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    sc.world = w

    def place(pose):
        world, rot = solve(pose)
        for ob, frame, a, b, name in objs:
            R = rot[frame]
            if name == 'rifle' or name == 'stock':
                # lie the weapon along the forearm's frame, pointing forward
                origin = world['hand.N']
                off = Vector((-0.24, 0, 0)) if name == 'rifle' else Vector((-0.34, 0, 0))
                ob.location = origin + (R @ off)
                ob.rotation_quaternion = R @ Vector((1, 0, 0)).to_track_quat('Z', 'Y')
                continue
            if name == 'hat':
                ob.location = world['neck'] + (R @ Vector((0, 0, 0.20)))
                ob.rotation_quaternion = R
                continue
            if name.startswith('boot'):
                # sit the boot on the ground, toes forward, independent of shin swing
                ob.location = world[b] + Vector((-0.05, 0, -0.02))
                ob.rotation_quaternion = Quaternion((0, 1, 0), math.radians(90))
                continue
            if name == 'head':
                ob.location = world['neck'] + (R @ Vector((0, 0, 0.04)))
                ob.rotation_quaternion = R
                continue
            pa, pb = world[a], world[b]
            ob.location = pa
            d = pb - pa
            ob.rotation_quaternion = d.to_track_quat('Z', 'Y') if d.length > 1e-5 else R
        bpy.context.view_layer.update()

    # ---------------- poses ----------------
    POSES = {
        'idle': {'chest': 2, 'neck': -2, 'shoulder.N': 26, 'elbow.N': 40,
                 'shoulder.F': -14, 'elbow.F': 30, 'hip.N': 2, 'knee.N': -3,
                 'hip.F': -4, 'knee.F': -2},
        'aim': {'chest': -10, 'neck': 6, 'shoulder.N': 78, 'elbow.N': -62,
                'shoulder.F': 70, 'elbow.F': -54, 'hip.N': -18, 'knee.N': 14,
                'hip.F': 20, 'knee.F': -24},
        'prone': {'pelvis': -76, 'chest': -8, 'neck': 62, 'shoulder.N': 44,
                  'elbow.N': -64, 'shoulder.F': 38, 'elbow.F': -58,
                  'hip.N': 8, 'knee.N': -10, 'hip.F': -6, 'knee.F': -14},
    }

    def run_pose(t):
        a = t * 2 * math.pi
        s = math.sin(a)
        return {
            'chest': -14, 'neck': 8,
            'hip.N': 40 * s, 'knee.N': -38 * max(0, math.sin(a - 1.1)) - 8,
            'hip.F': -40 * s, 'knee.F': -38 * max(0, math.sin(a + math.pi - 1.1)) - 8,
            'shoulder.N': 20 - 24 * s, 'elbow.N': 34,
            'shoulder.F': 20 + 24 * s, 'elbow.F': 40,
        }

    jobs = []
    if ONLY:
        jobs.append((ONLY, POSES.get(ONLY, POSES['idle'])))
    else:
        for n, p in POSES.items():
            jobs.append((n, p))
        for i in range(8):
            jobs.append(('run_%02d' % i, run_pose(i / 8.0)))

    made = []
    for name, pose in jobs:
        place(pose)
        sc.render.filepath = os.path.join(OUTDIR, name + '.png')
        bpy.ops.render.render(write_still=True)
        made.append(name)
        print('RENDERED', name)

    with open(os.path.join(OUTDIR, 'index.json'), 'w') as f:
        json.dump({'unit': UNIT, 'res': RES, 'frames': made}, f, indent=1)
    print('DONE', UNIT, len(made))


main()
