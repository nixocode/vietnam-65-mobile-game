# 3D → 2D SPRITE PIPELINE — state and how to run it

> **The running plan is [PLAN.md](PLAN.md).** This document is a reference.


Status: **built, rendered for all 11 units, wired in, and play-tested in a live
match.** Weapons, muzzle tracking, gait, faction colour, lighting and spacing are
all verified. Not deployed.

---

## 1. Why this exists

Two earlier character approaches failed and are closed:

- **AI-generated per-frame sheets** — every frame is drawn independently, so the
  character morphs between frames. Unfixable. Do not revisit.
- **Auto-cut cutout rig** (`js/rig.js`) — a single flat figure sliced into 5 pieces.
  Can never produce clean elbows/knees, so it always reads stiff.

This pipeline renders every frame from **one rigged 3D model under one locked
orthographic camera**. Frame-to-frame consistency is therefore guaranteed by
construction, and every frame shares the same anchor because nothing is cropped.

## 2. The donor model

**Seven bodies plus a weapon pack**, all Quaternius, all CC0. Provenance and
download URLs in `art/models/SOURCE.txt`.

Every body shares ONE 62-bone skeleton and the SAME 24 mocap clips, so they are
drop-in interchangeable — but they are visibly different people, which is what
stops a squad being one man cloned. `MODEL_FOR` assigns them across roles as well
as between armies:

| body | used by |
|---|---|
| `soldier` | US rifleman, scout sniper |
| `casual` | ARVN |
| `adventurer` | M60 gunner, LRRP recon (own backpack, taller) |
| `swat` | engineer (masked and kitted — reads as a specialist) |
| `farmer` | VC guerrilla, marksman (peasant clothing) |
| `hoodie` | VC sapper |
| `worker` | NVA, RPD gunner |

**Weapons are real meshes**, not boxes — `weapons.glb` carries an AK, SMG, two
scoped rifles, a shotgun, an RPG, pistols and a shovel. Only the geometry is used;
that pack's own rig is incompatible and is discarded.

None of the bodies ship period kit, so headgear, pack, bedroll, belt and pouches
are still built procedurally and constrained to the `Wrist.R`, `Head`, `Chest` and
`Hips` bones. Only the weapons come from a real mesh.

Rig gotchas discovered the hard way:
- Legs parent to **`Body`**, not `Hips`; feet parent to **`Root`** (IK-style).
  Laying the man prone means rotating `Body`, `Foot.L/R` and `PT.L/R` about one
  pelvis pivot — rotating `Hips` alone only pitches the spine.
- The plain `Run` action is empty-handed, so the rifle ends up backwards.
  Use **`Run_Shoot`** for the run cycle.
- **The donor points its gun ONE-HANDED.** The left wrist stays parked at the hip in
  every firing action. Aligning the weapon wrist-to-wrist therefore builds it
  *backwards* — muzzle at the left hand, stock out front. The axis that works is the
  **right forearm** (`LowerArm.R` head → `Wrist.R`), which points dead ahead whenever
  the character aims.
- On the **swat** body alone, `Skin` and `Visor` are never visible in profile — the
  head is fully masked and the hands gloved. That is exactly why every soldier used
  to read as the same anonymous mannequin, and why the other six bodies (which have
  real head meshes with Skin/Eye/Eyebrow/Hair) replaced it everywhere but the
  engineer. Civilian hair and ponytails are deleted under headgear (`strip_hair`).
- Bone-by-bone pose corrections proved unreliable here. **IK constraints did work**,
  and are what holds the rifle now (see below).

## 3. Commands

Render one unit (all clips):

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/render_model_sprites.py -- --model auto --unit rifleman --builtin --res 256
```

Re-render only some clips (keeps the rest from the existing index.json):

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/render_model_sprites.py -- --model auto --unit rifleman --builtin --res 256 --only prone,run
```

Then outline and pack:

```bash
python3 tools/outline_sprites.py assets/sprites3d/rifleman && python3 tools/pack_sprites3d.py
```

`--model auto` resolves the donor from `MODEL_FOR`, so the batch stays a plain loop.

```bash
bash tools/render_all_sprites.sh            # everything, ~3 min
bash tools/render_all_sprites.sh rifleman   # one unit, ~18 s
```

The batch is deliberately gentle — one unit at a time at `nice -n 10`, 16 EEVEE
samples, with a pause between. 64 samples was farm settings for a flat-shaded
256px sprite that gets a hard outline stroked over it anyway, and a full rebuild
at that setting cooked the owner's laptop.

## 4. Files

| File | Role |
|---|---|
| `tools/render_model_sprites.py` | Blender: import, recolour, build gear, pose, render frames |
| `tools/outline_sprites.py` | Post-pass dark outline. **Idempotent** via `.outlined.json` ledger |
| `tools/pack_sprites3d.py` | Packs frames into `atlas.png` + `atlas.json` per unit |
| `js/sprite3d.js` | Game-side loader, clip selection and draw |
| `assets/sprites3d/<unit>/` | atlas.png, atlas.json, individual frames, index.json |

Units rendered: rifleman, arvn, m60, engineer, recon, sniper, guerrilla, nva, rpd,
sapper, marksman. Clips per unit: idle 6, idle2 6, walk 14, run 18, runfire 18,
aim 6, fire 7, hit 4, hit2 4, death 12, prone 4, throw 9, dive 9, melee 8 =
**125 frames** across 14 clips, in a 1024x2048 atlas at cell 128 (~0.9 MB each).

### Getting a foreign weapon mesh into the hand

Three traps, each of which produced a distinct failure:

1. The pack's guns are **skinned props on its own armature**. Copying the objects
   and deleting that rig left them evaluating to nothing — the rifles vanished.
   Fixed by baking each into a standalone mesh via `new_from_object` on the
   evaluated object, with the source transform applied.
2. **Bounding-box axes are not the gun's axes.** These props are modelled already
   angled, so assuming the longest box side was the bore came out with every rifle
   tilted at its own angle. `_orient_weapon` runs **PCA** over the vertices to find
   the true long axis whatever pose it was authored in.
3. PCA fixes the bore but not which way is up, so magazines pointed skyward. A gun
   carries its mass below the bore, so if the vertex bulk sits high, roll it over.

Muzzle end is identified by girth — a barrel is thinner than a stock and magazine.
Weapon materials are repainted after import, because `recolour()` has already run
by then and they would otherwise stay showroom chrome next to an olive soldier.

### How the weapon is held

Three constraints do the work, so no clip needs hand-posing:

1. The rifle is a Child-Of `Wrist.R`, laid along the **right forearm** axis.
2. An empty on the handguard (`foregrip`) is the target of a 2-bone **IK on
   `LowerArm.L`** — that turns the donor's one-handed point into a two-handed hold in
   every clip.
3. `Idle_Gun` and `Walk` are gunless, which left the rifle hidden behind a leg. For
   those clips only (`CLIP_CARRY`), a second **IK on `LowerArm.R`** pulls the firing
   hand to a `carry` empty in front of the chest, giving a low-ready. Influence is 0
   elsewhere so aiming and firing keep their mocap.

An empty rides the barrel tip and is projected to cell pixels every frame, landing in
`atlas.json` as `muzzle`. `Sprite3D.muzzle()` reads it, so flashes and tracers leave
the actual gun — and it must select the same clip/frame the draw did, or flashes lag.

## 5. Anchoring and gait

- **`S3_FOOT = 39/84`** in `js/sprite3d.js`. The game sets `u.y` and the old rig drew
  an 84px soldier with boots 39px below that origin. Sprites plant their ground line
  there so they don't float or sink relative to cover and decals. Measured, not guessed.
- **Camera params are no longer duplicated.** The render writes `cam` into
  `index.json` and `pack_sprites3d.py` reads it; the constants in the packer are only
  a fallback. Changing the camera can no longer silently shift every sprite.
- **Gait is driven by ground covered, not by a fixed rate.** `game.js` accumulates
  `u.dist`; `sprite3d.js` sizes a cycle as a multiple of the soldier's *drawn height*
  (`S3_WALK_CYCLE`, `S3_RUN_CYCLE`) and picks walk vs run by `u.spd` (`S3_WALK_SPD`).
  The run cycle is deliberately **compressed** rather than honest to the distance:
  units cross a lane slowly by design, and an honest cycle produced a parade-ground
  walk. A little skate buys troops that read as moving under fire.
  This is what removed foot-skating: the old `u.phase` advanced one full gait cycle
  per **24px** travelled while the man is drawn **84px tall**, so the legs churned
  about six times too fast for the distance. `u.phase` is kept for the Rig fallback.

## 6. Traps already hit — do not repeat

- **Serve with `tools/devserver.py`, not `python3 -m http.server`.** Chrome cached
  `js/game.js` and an edit looked like it did nothing. The dev server now sends
  `Cache-Control: no-store`. If a change seems inert, check the *loaded* source first.
- **`outline_sprites.py` was not idempotent.** Running it twice stroked the stroke and
  doubled the outline width. Every unit had to be re-rendered once because of this.
  It now keeps an mtime ledger; leave that in place.
- Recolouring only worked after **unlinking the image texture** from Base Color —
  a plugged-in texture silently overrides the colour value.
- The donor faces the camera; `--turn 90` puts it in right-facing profile.
- Palette values look far darker in the file than on screen; the render lighting
  lifts them a lot. The current values are tuned — change them in small steps.

## 7. What the game does with the sprites

Beyond drawing them, three things in `js/render.js` and `js/game.js` exist because
of this pipeline and should move together with it:

- **Contact shadows** (`_drawShadow`) — a cached soft blob under every man, long and
  thin for prone and dead, faint for men up a tower. Drawn as its own pass before
  the units so one man's shadow never paints over the man behind him. Without a
  shadow a sprite reads as a sticker laid over the terrain.
- **Muzzle light** (`_drawMuzzleLight`) — an additive warm pool at the tracked barrel
  tip, drawn *after* the units so the flash falls on the shooter as well as the
  ground. Cheapest lighting in the game and the largest single gain in a dusk
  palette. Measured at 0.5 ms/frame with 28 units, against a 16.7 ms budget.
- **Per-man variation** — `gaitOff`, `gaitK`, `sj` and `yj` on each unit give every
  soldier his own stride length, phase, build and a hair of depth within the lane.
  Without these a squad moves as one body, which is what "feels dead" looks like.

**Squad spacing is tied to sprite width.** These sprites are much wider than the
cut-outs they replaced — a levelled rifle is ~40px, a prone man ~55px long. Slot
spacing in `_advance` went 24 → 34px, and in-cover spread from a 12px cap to a
20px floor (32px prone). If sprite proportions change again, revisit those numbers
or fire teams collapse into one unreadable blob.

## 8. Verified in a live match

- 10-frame walk cycle completes in ~70px of ground for an ~80px figure — a realistic
  stride, no skating.
- Firefight: both sides on the new sprites, muzzle flashes on the barrel tip, tracers
  leaving the gun, blood decals landing, deaths resolving.
- All 11 atlases bind (`Sprite3D.has(k)` true for every unit key).
- Four factions separate at a glance: US olive, ARVN pale khaki, NVA warm tan, VC
  near-black — plus per-faction hat tints and distinct headgear silhouettes.
- Death arc plays out and the corpse settles exactly on the ground line.
- A four-man squad walks on frames 4/5/6/4 — no lockstep.
- 8 full matches across 4 maps, both sides, complete with zero errors.

## 9. What is NOT done

1. **No crouch** between standing and prone. The sim has no crouch state either, so
   adding one means sim work as well as a clip.
2. **Faces are a flat patch**, not modelled features. Fine at 84px, thin under zoom.
3. **Separate squads still overlap where they converge** in a close firefight. Spacing
   is enforced within a squad, not between them.
4. `js/rig.js` and the cutout art are still present as the fallback path. Once this is
   trusted in play they can be deleted along with `tools/cut_figures.py`.
5. Remaining from `V1_PLAN.md`: the world is still drawn in a different art language
   from the soldiers (Phase 2) — buildings are 3/4 view next to profile soldiers, and
   that collage is now the most obvious thing left. Phase 3 lighting is part done
   (shadows + muzzle light); time of day, haze by depth and a colour grade are not.

## 10. Standing constraint

**Never deploy without explicit approval.**

---

## 11. Scenery on the same camera (`tools/render_props.py`)

The largest remaining art problem was never the characters: buildings were painted
in **3/4 view** and stood beside strictly-profile soldiers. That collage is what
made the world read as assembled from two different games, and no amount of
character work fixes it.

Props now come off the **same locked orthographic side camera and the same three-
light rig** as the soldiers. `assets/props/props.json` records each prop's real
height in metres; since a soldier is 1.8 m drawn at 84 px, `js/props.js` places a
3 m hut at its true size against the men rather than by eye.

```bash
Blender -b --python tools/render_props.py -- --res 512   # render
python3 tools/tone_props.py assets/props                 # palette + outline
```

`tone_props.py` matters as much as the render: straight out of Blender the scenery
is far more saturated than the troops — vivid green palms beside muted olive men.
It pulls saturation back, sits the value in the game's darker range, adds the
field's dusty cast, and strokes the **same dark outline** the soldiers carry so the
line weight matches. It is idempotent via a ledger, like `outline_sprites.py`.

Model units are arbitrary, so **`realH` is authored per prop**, not measured — the
"1.5 m" hut the exporter reports is not a real-world figure.

`Renderer.PROP_KINDS` maps structure kinds onto props; anything unmapped keeps the
old painted or procedural path, so this could go in incrementally. Currently
hooch / longhouse / stilt / stall / shrine are converted; towers, MG nests, wells,
carts and hay are not.
