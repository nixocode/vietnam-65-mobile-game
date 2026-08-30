# VIETNAM '65 — PLAN

One document. When something is done it is deleted from here, not annotated —
the history lives in git. If a claim in here is not backed by a measurement,
it is a guess and is marked as one.

**Companion docs:** `SPRITE_PIPELINE.md` (how character art is made — read
before touching it), `docs/ASSET_PROMPT.md` (brief for generating new props).

---

## 0. Rules that have earned their place

1. **Never deploy without explicit approval.** Pushing `main` auto-publishes to
   GitHub Pages, so a push *is* a deploy.
2. **Look at a frame — then MEASURE what you think you saw.** Every art mistake
   this project has made passed its metrics and was caught by eye, and four
   confident diagnoses read off a screenshot have now been wrong. The latest:
   "some palms have gone vivid green again" — the frame contains ZERO pixels
   where green exceeds red by more than 18, and olive simply reads as green
   against a saturated orange sky. Look to find the problem; measure to confirm
   it exists. Past examples caught by eye: 300px palms that swamped the screen, weapons
   that were 40–60% black outline, a night map washed to an unreadable 18 points
   of contrast, Cu Chi turned into a red quarry. Use
   `Capture.shot({map:'mekong'})` and open the image.
3. **An x-overlap test is not an occlusion test.** Nearly shipped two false
   findings this way. Always include vertical extent.
4. **Measure the tail, not the mean.** The stance bug read as median 0 with a
   worst man at 34 flips/min. An average would have shrugged at it.
5. **No change is done until `SelfTest.run(60)` passes** both sides on all five
   maps. The suite does NOT seed `Math.random`, so it is a fresh match every
   run — one failure is a sample, not a verdict. Re-run before believing it, and
   before touching a threshold, work out whether the METRIC is sound: the
   worst-man stance-churn limit had already been walked 22 -> 28 for "flake"
   when the real fault was a per-minute rate divided by a 9-second lifetime, so
   five ordinary stance changes scored 33/min. Raising a bar to silence a bad
   statistic blunts the detector and leaves the statistic bad.
6. **Measure each map on a FRESH PAGE LOAD.** Staging five maps in one page
   inflates the figure badly — this pass first read mekong at 12.32 and cuchi at
   12.55 against a cap of 13, and panicked at an apparent +4.9 regression. Both
   are 8.5-8.9 measured one per load; the truth was +0.8. Decal layers and
   accumulated state from earlier stagings add full-screen blits. This is the
   second time a `Capture` figure has misled this project, after the bake-frame
   problem below.
7. **Frame rate CAN be measured here** — `tools/perf.js`. This said the opposite
   for the project's whole life, and the reason was specific rather than
   fundamental: the automation pane runs hidden, so Chrome throttles
   requestAnimationFrame and the callback never fires. RAF is not the only clock.
   A canvas draw returns once the command is QUEUED, but a pixel readback cannot
   return until every queued command has COMPLETED, so `render() ->
   getImageData(1x1)` bounds real frame cost. Validated against ground truth:
   holding the scene fixed and changing only canvas size gives 1.8 / 3.0 / 5.9 ms
   at 0.36 / 1.44 / 3.24 Mpx — flat submission cost, rasterisation scaling with
   area, which is the signature of the real thing.

   Two traps, both hit and both now guarded in the tool: flushing every frame
   makes Chrome DE-ACCELERATE the canvas (3.1ms on a fresh page, 41.7ms after a
   few dozen benches — it looked exactly like a load cliff at 60s of match time
   and was purely the instrument), and flushing once per batch is unsound because
   intermediate frames are never observable and the driver need not produce them
   (it reported 0.06ms/frame, 16,000 FPS). Answer: flush per frame, keep `iters`
   modest, few benches per page load, and watch `degraded` — `jsMs` jumps two
   orders of magnitude when the canvas falls back to software.

   Still worth an owner reading off `` ` ``/F3 for the real composited number;
   this is a hidden tab on one machine. But it is a repeatable millisecond figure
   for comparing two builds, which is what it is for.
8. Do not revisit AI-generated frame sheets or auto-cut cutout rigs. Both are
   proven dead ends (`SPRITE_PIPELINE.md` §1).

---

## 1. THE PROBLEM: it still looks mid

Owner's verdict, and it is correct. Diagnosed from a captured firefight rather
than from taste. **Ranked by how much each one is costing the look:**

### 1.1 Atmosphere and light *(rebuilt — the maps now share one system)*
The five maps did not read as one game, and none of them read as lit. Measured
on captured frames rather than guessed:

| map | L range | sky detail | hue >30° off dominant |
|---|---|---|---|
| iadrang | 164 → **180** | 7.3 → 8.2 | **0.0% → 4.6%** |
| cuchi | 170 → **185** | 12.5 → 13.0 | 11.1% → 14.4% |
| khesanh | **38 → 51** | 1.0 → 1.7 | night, see below |
| hill937 | 102 → **129** | 7.2 → 7.3 | 12.9% → 9.2% |

**What was actually wrong, in order of damage:**

1. **Six stacked full-screen veils were eating the palettes.** `_drawFar` washed
   flat `hillFar` over the whole far layer at 0.42; `_laneHaze` veiled each lane;
   `pal.haze` filled the ENTIRE frame at its full 0.13-0.20; then a grade
   multiply, a grade gradient and a 0.28 vignette. Ia Drang and Mekong arrived
   with **0.0%** of their saturated pixels more than 30 degrees off the dominant
   hue — on palettes deliberately built with 195 and 125 degree spreads. All that
   care in `data.js` never reached the screen. Haze is now keyed to DEPTH and is
   zero in the foreground.
2. **`_laneHaze` still indexed a three-lane world.** `[0.5, 0.22, 0][lane]` — the
   entry that zeroed haze on the nearest lane was index 2, unreachable since the
   drop to `LANE_N = 2`. The foreground lane had been sitting under a permanent
   0.22 veil ever since.
3. **The far band was tinted toward its own hill colour**, which cannot make
   anything recede. Distance washes things toward the colour of the air, so it
   now blends toward `skyBot` — which is what stopped the ridges reading as
   cut-outs pasted on the sky, worst of all at night.
4. **Nothing in the scene read the sun.** Every map declares `sun: {x, y, r}` and
   it lit nothing; the ground had texture but no FORM. Ground now takes warm lit
   faces and cool shaded ones from its own slope — and cooling shifts BLUE UP
   rather than just darkening, which is where a frame with no hue variety can
   honestly get some.
5. **The sky was eight pairs of ellipses** over 35-45% of the frame. Now three
   parallax depths of multi-lobe banks with a shaded base and a lit crown, plus a
   horizon glow centred under the sun and a real bloom.
6. **Night was a chain of compressive washes**: multiply ×0.39, navy ×0.86, map
   haze ×0.80, grade ×0.90 — four reasonable veils composing to 0.24, so 164
   points of range arrived as 39. Measured 38. Fixed by removing veils rather
   than softening them: no map haze at night, half the navy, a neutral `overlay`
   to push the range back, and a lighter vignette.

**Two mistakes worth not repeating:**
- The slope shading was first drawn as one rect per column, which striped the
  field with a seam every 6px — periodic power at that pitch went 5.9 → 74. The
  seams were never the alpha steps, they were ANTIALIASED RECT EDGES, and
  smoothing the input barely moved it (74 → 61). It is now one clipped fill with
  one horizontal gradient: 7.6, back to baseline. **This is the third time this
  file has been striped by per-column fills** — the value ramp did it too.
- A BLUE `overlay` for the night contrast restore turned the grey massif into
  vivid blue triangles: overlay saturates whatever sits near mid-grey. The
  restore is neutral now; cooling is the multiply's job.

7. **Cloud shadow** — broken overcast laid across the field, the one scale
   nothing worked at (grit is 1-6px, incident 30-150px, slope shading is
   terrain-wide). Worth knowing: the metric said it did nothing (16.44 → 16.13)
   and the eye says otherwise, because the measurement averages over exactly the
   scale the pass operates at. Looked at, it reads as weather.
8. **Vector trees rebuilt.** `_tree()` drew the jungle canopy as a stick plus
   three filled ellipses — a lollipop — and the grass-map tree as a stick plus
   one wide ellipse, a mushroom. Both were flat single-colour silhouettes
   standing next to props with fully lit-and-shaded canopies. They now use the
   same three-value treatment as the clouds and the props, so all three finally
   agree where the sun is.
9. **Puddles were reading as tan stains** on Mekong, because the map's `water` is
   a warm sunset `#d78a5e` and the body was filled at only -30 off it. Standing
   water is DARK — it transmits, and only the rim returns the sky. Body now -86,
   flatter, with the lit rim kept.

**Still open here**
- Buildings measure Lmean 108-120 against 57-91 for everything else. Sunlit
  thatch SHOULD be the light accent, but `hut_a` at saturation 0.49 is louder
  than the palette wants.
- The far parallax band is **done**. `treeline`, `villageSil` and `paddy` are now
  drawn procedurally — `_treeBand`, `_villageBand`, `_paddyStrip` — and their
  slices are gone from `assets/manifest.js` (108 terrain slices -> 99).

  The paddies were the real find: **isometric 3/4-view tiles**, drawn looking
  DOWN at the field from an angle, in a game whose every other element is a
  strict side view. That is precisely the collage the prop pipeline was built to
  end, and it survived only because it was squashed to 55% and drawn at half
  alpha — which hides a wrong projection without fixing it. Edge on, a paddy is
  a bright sliver of reflected sky between two low bunds.

  `mtn` STAYS. It is the one piece of the old set that earns its place: a
  distant ridge silhouette, now pushed back into the sky colour, at a size where
  the line work does not read.

  Two things worth keeping: built from `brush` alone the new treeline came out
  uniformly mid-green and read as a row of shrubs where the inked slices read as
  a wall of jungle — it needs `tree` for the mass and `brush` for the lit
  surface, which is the relationship those palette entries already describe. And
  `ctx.ellipse()` CONTINUES the current subpath, so opening the band with a
  `moveTo` to the far corner ran a visible spike from the bottom-left of the
  frame into the first lobe. One `moveTo` per lobe.

### 1.2 One art language *(done — the inked art is gone)*
All small vegetation now draws from the 3D prop set through `drawVeg()` in
`js/render.js`. The `TEX` entries for `tuft` `fern` `bush` `plant` `palm`
`banana` are deleted, and so are the painted palm/banana groves that used to mix
into the treeline — the prop scatter's share went up from 0.26/0.16 to 0.46/0.30
to cover it. What still draws from `TEX` is the far parallax band (`mtn`,
`treeline`, `villageSil`, `paddy`), the buildings, and `dike`/`stonewall` cover.

**What the measurements actually showed, none of which was the original theory:**

1. **Eight props had never been toned.** `tools/tone_props.py` had only ever run
   on the 21 downloaded props; every procedurally-built one — grass, bamboo,
   banana, dead tree and the four new ones — was raw Blender output at Lmean
   115-126 and Lstd 11 against `palm_a`'s 63/23. Flat and pale, which is the
   cardboard-cutout read. There were two art languages *inside the prop set*.
2. **The tone ledger keyed on mtime**, which git does not preserve, so after a
   clone every prop looked untoned and the next run would have double-graded all
   21 — 0.80 twice is 0.64, and a second 4 px rim on top of the first is an 8 px
   black border. Now keyed on a content hash.
3. **`palm_b/c/d` were never properly graded**: saturation 0.66-0.68 against
   0.25-0.37 for every other prop, green running 14-17 points over red. They were
   the loudest thing in the frame. Re-rendered with their own FIXUP; now 0.33.
4. **The sandbags were the brightest props in the set** at Lmean 120 — brighter
   than sky-lit palm fronds — and read as heaps of eggs. Now 61.
5. **The foreground band's darkening was dead code.** `globalCompositeOperation`
   was set *after* the draw and immediately before `restore()`, so the band that
   the comment describes as "out of the light" rendered at full brightness and
   read as bleached straw across the bottom of every frame. Props now take a
   `shade` option, baked once per size into the existing scale cache.

**Shape lessons, learned by looking rather than measuring:** props built from
MANY thin elements read (grass at 44 blades, bamboo culms); props built from a
FEW big ones do not. The first bush was a heap of boxes and looked like a heap of
boxes; the first fern was two bare arcs and read as a croquet hoop; the banana
was six narrow ribbons tracing an outline with nothing inside. All three are now
built on `_curve`/`_blade`/`_frond` — a leaf has blade area and a curve, a frond
has leaflets. Bamboo was rebuilt too: dead-straight parallel culms with square
nodes bridging them read as electricity pylons.

6. **The tone ledger was gitignored**, so the hash fix alone would not have
   helped a fresh clone: the prop PNGs are committed ALREADY GRADED, and with no
   ledger the next `tone_props.py` run would have graded them again. The ledger
   is now tracked, with the reasoning written into `.gitignore` beside it.
   Verified: `touch assets/props/*.png && python3 tools/tone_props.py` re-grades
   nothing and every checksum is unchanged.

**Also done in this pass**
- `deadtree_a` rebuilt — was a totem pole of stacked blocks; now a continuously
  tapered leaning trunk with unequal limbs and a splintered crown.
- `bamboo_a` rebuilt — dead-straight parallel culms with square nodes bridging
  them read as electricity pylons; now leaning curved canes with ring nodes and
  real leaf mass.
- `banana_a` rebuilt twice more. Three narrow strips per leaf merged into a dark
  arch; one wide `_blade` scalloped at every bend (a chain of square-ended boxes
  cannot draw a leaf) and read as an armadillo shell. It now uses `_leafpoly`,
  which builds each leaf as ONE polygon, with the leaves spread from upright at
  the crown to drooping at the base so there is daylight between them.
- `dike_a` and `stonewall_a` built and wired — the last inked *gameplay* art.
- `grass_a` pulled down from Lmean 83 to 68; it was the palest thing on the
  ground and scattered bright straw across the field at random.

**Buildings brought into the palette.** They measured Lmean 108-120 and
saturation up to 0.49 against 57-91 / 0.20-0.37 for everything else — sunlit
thatch and timber SHOULD be the light accent in a frame of olive foliage, and
that part is kept, but at those values they had stopped being an accent and
become the brightest, most saturated thing on screen. The stone in `hut_c` and
`village_row` read as poured concrete. Re-rendered from source with their own
FIXUP entries: now Lmean 53-80, sat 0.28-0.39, still lighter than the foliage
they stand against. **The prop set now has zero palette outliers.**

**Still open here**
- `sandbags_row` (0.27 x 0.11 m) and `sandbag_one` (0.15 x 0.06 m) have authored
  real heights that cannot be right for sandbags.
- The far parallax band is still inked (`mtn`, `treeline`, `villageSil`,
  `paddy`), and so are the buildings. At 0.5-0.9 alpha and far back the clash may
  not read; judge it in a frame before touching it.
- Props are framed in a SQUARE sized by real height, so a short wide prop wastes
  most of its blit — `bush_low` at 280 px tall is a 769x769 draw, two thirds
  empty. Fine at current sizes; it would need non-square frames (`resW`/`resH`
  plus a content offset in `Props.draw`) before ground cover gets much bigger.

### 1.2b Ground incident *(partly done)*
The lane had plenty of detail and none of it was visible, because all of it
worked at 1-6 px and hugged the ground LINE: speckles at alpha 0.22, strata at
0.13, turf blades drawn at `y0+1`, scour only where the slope exceeds 0.14. The
lower two thirds of each band — the part the player looks at — was bare fill.
Detail at grit scale cannot fix a problem at field scale.

There is now a pass at field scale: puddles that take the sky (the one thing on
the ground allowed to be brighter than the ground), churned earth, dry patches,
and vehicle ruts cutting ACROSS the band rather than along it. Baked into the
lane layer, so it costs nothing per frame — src Mpx is unchanged at 8.88.

**Two things the first cut got wrong, both worth remembering:**
- Feature depth was measured against `CANVAS_H`. Lane layers blit full-screen in
  order, so lane 1's slab paints over everything lane 0 drew below lane 1's
  ground line — most of lane 0's features were buried. Depth is now measured to
  the NEXT lane's ground line.
- The alphas (0.08-0.26) sat under the map's 0.16 haze and vanished. Raised to
  0.16-0.56. Ground local detail moved 8.79 -> 9.60; the first cut moved it 0.6
  of a grey level in the WRONG direction, which is to say it did nothing.

Still open: shell scars and churn that ACCUMULATE where fighting actually
happened, rather than being scattered at bake time. Large open stretches of the
band are still flat.

### 1.3 Foliage variety *(done — keep an eye on it)*
Was four palm silhouettes tiled evenly across every lane, which reads as
wallpaper because every tree is the same shape family the same distance from
its neighbour. Now eight silhouettes arriving in **clumps of 1-4** with a much
wider height spread (0.58-1.30x rather than 0.72-1.12x).

The four new ones — bamboo, banana, dead trunk, elephant grass — are **built
procedurally** in `tools/render_props.py`, not downloaded. poly.pizza's search
page is client-rendered and its API needs a key, so the only way to get models
was to pull unidentified UUIDs with no name, no licence and no preview, which
does not belong in a public repo. Box geometry suits these anyway: bamboo IS a
bundle of tapered culms, a burnt trunk IS a pole with broken stubs.

Still worth doing: the banana renders paler than everything around it, and a
palm from a real model still reads better than anything built from boxes — if
a properly licensed nature pack turns up, the pipeline takes it unchanged.

### 1.4 Gunfights *(impact + suppression done; heavy weapons partly)*
Measured before the first fix: 31 men produced **0.56 muzzle flashes per frame**
and **51% of frames showed nothing firing**. Gunsmoke now spawns on every shot,
so 100% of frames show combat.

**Suppression is now drawn.** It was the mechanic the whole sim turns on —
accuracy halved, advances stopped, the stance machine driven to prone — and the
only thing on screen saying so was the word PINNED in 8px type. Two sources now:
a round cracking within 46px of a man throws dust off the ground on the side the
fire came from, and a pinned squad keeps a low trickle going between rounds
(impact dust alone made it flicker — suppressed on frames something landed, idle
on frames nothing did, when the STATE is continuous).

**Impact had emitters and no weight.** `dirtKick` was four dots of 1.5-3px and
`splinters` five of 1-2.4px, which at lane scale is invisible: the calls were
all wired and a round striking earth still read as nothing happening. Both now
lead with a DUST PUFF — the part the eye actually catches — and throw clods
after it, scaled by lane depth, with belt-fed weapons throwing visibly more than
a rifle.

**Dust is not smoke.** Drawn in gunsmoke's neutral grey it vanished into the
ground it was rising from; kicked earth is warmer and lighter than the field,
which is what makes it read against grass. `color: 'dust'` in the particle draw.

**Particles now cull by PRIORITY, not by age.** `add()` was unbounded with one
backstop at 900 that spliced away the OLDEST — exactly the wrong end, since the
oldest are the smoke and dust giving a fight its body and the newest are the
flashes and tracers telling the player who is shooting at whom. Ground dust and
debris carry `prio: 0` and stop being added above 260; flashes, tracers, blood
and explosions always get through.

Cost of all of it, measured with `tools/perf.js`: **+0.2 to +0.8 ms/frame**,
worst map 5.0 → 5.8ms. Everything still holds 60 with 3-5x headroom.

**Heavy weapons now read as heavy.** `muzzle()`'s `heavy` flag changed exactly
one number — flash height, 26px against 19 — so an M60 burst and a single rifle
shot were the same event at the muzzle, on weapons costing 5 CP and 3 CP that
are supposed to feel different. Belt-fed now gets a longer, wider flash, seven
sparks instead of three, brass in a stream rather than one shell at a time, and
half again as much smoke: a gun position firing bursts fogs itself in, and that
fog is most of how you find one on real footage.

**Shell and rocket impact got the cue that says weight.** Everything the
explosion did threw material UP — flash, column, ejecta, smoke — which is what a
firework does. What separates a shell from a firework is the low sheet of dust
running OUTWARD along the ground, because the blast has nowhere else to go once
it meets earth. Measured spreading 250px+ from the burst.

**Recoil.** The vector rig has swapped recoil frames off `muzzleT` since it was
written; the 3D sprite path never got anything, so men fired without moving at
all — most of why a firefight read stiff even with the muzzle and smoke work
done. There is no recoil clip and the donor has none to borrow, so it is
positional: the man rides back along his own facing and settles over the 0.11s
the shot already lasts. 3px at 84px tall; 6px reads as a man being shoved.

Still missing:
- **Weapon report** still does not distinguish an M60 from a rifle by ear.
- A first cut gated the pinned-squad trickle on `particles.length < 150`, which
  switched the dust OFF in exactly the heavy firefights it exists to describe.
  Saturation belongs in `add()` and nowhere else.

### 1.5 Animation and soldier variety

**Per-man appearance.** `gaitK` has varied each man's animation SPEED and
`gaitOff` his clip PHASE for a long time, so a squad never marched in lockstep —
but every man was the same pixels in the same colours, and at squad size that
reads as one soldier stamped five times. Each man now carries a small brightness
and hue shift keyed off `gaitOff` (a `Math.random()` fixed at spawn, so a man's
colour never changes frame to frame). Kept narrow on purpose: it has to break up
a rank without breaking the side's identity, which the player reads by colour
before anything else.

**Cost matters here and was measured, not assumed.** `ctx.filter` with THREE
functions chained (brightness + hue-rotate + saturate) roughly DOUBLED frame
cost — iadrang 3.2 -> 7.2ms, cuchi 3.3 -> 8.6ms. One function costs +1.0ms and
two cost about the same as one, so `saturate` was carrying nearly all of it.
Shipping brightness + hue-rotate: +1.0 to +1.9 ms, every map still holds 60.

**Idle drift.** The two at-rest poses were split on a fixed `gaitOff < 0.45`, so
a man played the same idle from spawn to death and a squad holding a position
showed two poses frozen in whatever proportion the spawn rolls gave. A slow
per-man oscillator now drifts men between them. Measured over 30s: both variants
in use (41 / 66 samples) with 8 switches — movement, not thrash.

**Recoil** is done (see §1.4).

**The prone CLIP is broken at source and is not used.** It was synthesised by
pitching the body 84 degrees about the pelvis, but the arms hang off the chest
and the rifle rides the right wrist, so the tip-over drove the weapon into the
ground behind the man and folded his legs back through his torso. Three Blender
attempts each made it worse and are worth not repeating: counter-rotating the
shoulders slid the rifle off the hands entirely (the weapon is bound to the
wrist by a Child-Of whose inverse was captured at the original pose); a shallower
58-degree pitch gave a diagonal version of the same tangle; and the donor has no
prone or crouch action to borrow — all 24 of its clips are upright. The game
draws prone men with the **aim** pose dropped 26px instead, and the height
difference is what reads as "down" at 84px anyway.

### 1.5b Atlas memory *(reclaimed — the wall is down)*

Adding soldier art used to be impossible: atlases 96 MB + props 31 = **127 of a
130 MB cap**, and one more body costs about eight. That gate is now open, and
the first half needed **no Blender at all** — every per-frame PNG was still on
disk under `assets/sprites3d/*/`, so it was a repack, minutes not an hour.

| step | atlas MB |
|---|---|
| was | 96 |
| cells 128x112 instead of 128x128 | 84 |
| drop `melee` + `prone` | 79 |
| spend it: walk 14->28, run 18->24, runfire 18->20 | **89** |

**Total now 120.3 of 130, 9.7 MB spare** — and the jank is fixed with it.

**Two clips were rendered for every unit and never drawn.** `melee` appeared
only as a key in the `URGENT` table in `js/sprite3d.js`; nothing selected it.
`prone` was rendered and then explicitly routed around because its source clip
is broken. 12 frames per unit of 125.

**A quarter of every cell was empty air.** Measured across ALL TWELVE units with
those two excluded, content spans y 18-122 of 128. The crop is a FIXED band
applied identically to every frame of every unit, so the shared anchor survives —
per-frame tight-bboxing is what makes sprites flicker and stays banned. Measure
across the whole set before touching `CROP_Y`: rifleman is the tightest unit at
92 rows and using it alone would have decapitated `rpgman` and `marksman`, which
need 105.

**Three traps hit on the way, all now guarded in the tools:**

1. **The repack silently destroyed the muzzle data.** `index.json` is gitignored
   and a partial re-render had left it holding muzzle points for `prone` alone,
   while the COMPLETE set survived only inside the tracked `atlas.json`. Packing
   from that stale index emitted empty muzzle lists — every flash would have
   detached from its barrel. Recovered from the atlases, and
   `tools/pack_sprites3d.py` now REFUSES to write when any frame lacks a muzzle
   point rather than overwriting good art with bad.
2. **The frame-count raise blew the budget before a single frame rendered.**
   `runfire` is a SEPARATE clip from `run` and scales with it; forgetting that
   turned a planned +20 frames/unit into +30 and 130.7 MB. Recompute with
   `MB = 0.0581 * frames_per_unit * 12` before changing `CLIP_FRAMES`.
3. **`tools/render_all_sprites.sh` was missing `rpgman`**, so "rebuild
   everything" silently left one unit on stale frame counts.

### 1.5c The jank, measured and fixed

"Very janky, animations aren't smooth" was exactly reproducible from the
constants. Frame index comes off DISTANCE TRAVELLED — `frame = (dist/cycle)*n` —
so animation fps is set by speed, stride and frame count, never by the game's
frame rate.

| | before | after |
|---|---|---|
| rifleman walk | 9.7 fps | **19.4** |
| sniper walk | 7.2 fps | **14.4** |
| rifleman run | 23.3 fps | **31** |

The stride was never the bug: 60 world-px per cycle for an 84px man is a real
1.4m stride, and shortening it to win frames would make men mince and skate.
There were simply not enough frames in it.

### 1.5d Soldier variety

- **Per-man colour.** `gaitK` varied each man's animation speed and `gaitOff`
  his phase, but every man was the same pixels in the same colours. Each now
  carries a brightness and hue shift keyed off `gaitOff`. Measured: three chained
  `ctx.filter` functions DOUBLED frame cost (3.2 -> 7.2ms); one costs +1.0ms and
  two cost about the same as one, so `saturate` carried nearly all of it.
  Shipping brightness + hue-rotate.
- **Idle drift.** Men drift between the two at-rest poses instead of being
  assigned one for life. Measured over 30s: both in use, 8 switches, no thrash.
- **Still open — donors are doubled up.** `soldier` serves rifleman AND sniper,
  `adventurer` m60 AND recon, `farmer` guerrilla AND marksman. `worker.glb` is
  already downloaded (Quaternius CC0, same pack) and unused, so breaking one tie
  costs ZERO memory — the same 135 frames off a different body. Cheapest
  remaining variety win.


## 1.8 Asset and animation verification — all clear

Audited after the overhaul rather than assumed. 30 props, 12 units: no prop
referenced but missing, no bad prop metadata, no unit missing a clip the
renderer can ask for, and no muzzle-point holes in any firing clip.

Per-clip cadence, measured as the renderer actually plays it:

    run    31.0 fps   holds 1-2      walk   17.5 fps   holds 1-4
    death  14.7 fps   holds 4-5      aim     8.4 fps   holds 6-8 (sub-frame blended)

**One real gap found and fixed: kneeling and prone men were statues.** The
breathing sway tested `clip === 'aim' || clip === 'prone'`, which stopped being
true the moment both poses became frames of `dive`. Measured, a held man showed
ONE frame for 180 consecutive ticks with zero movement — in the two postures a
man holds longest, where no locomotion disguises it. Keyed off the POSE now, and
with a slower deeper breath than a standing man, because a rifle braced on a
knee or a bipod visibly rises and falls. 726 and 923 pixels of movement over
half a breath, against 0.

**Performance is not a problem, and the instrument said it was.** A fresh-load
bench reported p95 242.9 ms, and a hand-rolled loop reported 32.5% of frames
over 16.7 ms with p90 at 331 ms. Both were the readback: per-frame
`getImageData` de-accelerates the canvas, which rule 7 already records and which
has now misled this project three times. Timed without the flush, the honest
figures are:

    render JS   p50 0.5-0.6 ms   p95 0.8-0.9 ms
    sim JS      p50 0.2 ms       p95 0.4 ms

1.2-1.3 ms combined against a 16.7 ms budget. `_buildLane` costs 5-15 ms for all
lanes and runs 0.1 times a second in play, so the ground detail did not make
baking a per-frame cost.

**Rule 6 confirmed again:** srcMpx read 13.63 on every map when the five were
staged in one page load, and 9.96 on a fresh load. Staging inflates it by ~37%.

## 1.9 THE VISUAL OVERHAUL — the only priority

Owner, and the words matter: *"make the game look good. It's shit right now"*,
*"everything needs an upscale"*, *"maybe even adding and removing old assets"*.

Measured first, because three of the four things that look wrong are not what
they appear to be.

### What the frame actually measures

| | cuchi | iadrang | mekong |
|---|---|---|---|
| whole-frame luminance range | 200 | 195 | 176 |
| GROUND-BAND range | **74** | **70** | **92** |
| mean saturation | 0.22 | 0.39 | 0.48 |

**Soldier-to-ground contrast: 12 points out of 255.** US bodies average 99.3
against ground at 102.5; VC 72.9 against 62.3. In a game about infantry you
cannot see the infantry — they are the same value as the dirt they stand on.

The whole-frame range looks healthy at ~200 and is a lie: it is the SKY doing
all of it. The sky reaches 230 while the playfield lives in a 70-point band. The
picture has a bright empty top half and a flat middle where the game is.

### The order, by measured impact

**1. FIGURE SEPARATION.** 12 points is the headline number. Three levers, all
cheap: darken the uniform tints so men sit below the ground plane in value,
strengthen the contact shadow so each man is anchored, and add a light rim on
the sun side. Target 35+ points body-to-ground.

**2. GROUND-BAND RANGE.** 70-92 points where the sky gets 200. The terrain
passes exist and are being flattened by the haze wash that sits over them.
Target 110+ without touching the sky.

**3. RESOLUTION, honestly.** The atlas is `figH` 85.3 px drawn to `S3_TARGET_H`
84 — a 1:1 source. The canvas backing store is 1534 px wide against a logical
1280, so every soldier is upscaled ~1.18x on this display and more on a larger
one. Props render at 512 and are drawn near 100, so they are fine; the SPRITES
are the bottleneck. Raising the figure to 120 px costs 2x atlas memory
(89 -> 178 MB) against a 130 cap, so it has to be paid for by cutting frames:
`walk` 28 -> 16 and `runfire` 20 -> 12 buys the room. Do this AFTER 1 and 2,
because contrast is worth more than pixels and costs nothing.

**4. REMOVE THE WEAK OLD ASSETS.** Now that the prop outline is off, what is
left of the inked kit is obvious. `_tree` vector lollipops still draw the
mid-ground canopy; `drawJet` and `drawB52` are flat polygons; the round bush
blobs in the tree band are three ellipses. These are the last things in the
frame that are not lit geometry.

**5. ADD.** A Huey exists now. The gaps that would carry the most: a proper
canopy/treeline prop to replace the vector blobs, and ground detail so the
playfield is not a bare plane.

### Already done this pass

**The prop outline was the single biggest fault and it is fixed.** Every prop
was stroked with FOUR pixels of near-black at full alpha, while the sprite
pipeline had already moved to a 1px soft edge — two art languages in one frame.
Measured share of visible pixels that were dark outline:

    bamboo_a  44.8% -> 1.9%      grass_a  45.1% -> 5.8%
    dike_a    38.0% -> 0.0%      deadtree 28.2% -> 1.0%

Nearly half of some props WAS the outline. **Rule: when an asset looks like a
sticker, measure how much of it is the rim before touching the art.**

And the foliage tone was re-tuned as a consequence: those fixups were calibrated
while the rim covered ~45% of every frond, which held measured saturation down
to 0.33 and made the palms look corrected. With the rim gone they measured
0.66-0.68 against a 0.34 median — the most saturated things in the game by 2x,
reading as bright plastic. Now inside the set at a 0.27 median.

## 2. Open, ranked

**The asset audit, and the rule it produced.** Laying all 31 props side by side
tagged by origin found two separate faults, and the second was worse than the
first.

*Wrong world:* four props came from a generic fantasy pack — a European
half-timbered house frame standing in for a Vietnamese shrine, a storybook
wishing well, a market stall with CROSSED SWORDS on it, and a European handcart.
Two more (`frame_a`, `frame_b`) were referenced by nothing at all. Replaced with
built Vietnamese fittings; prop set 35 -> 29.

*Two visual languages:* donor models are smooth meshes, everything built here
was assembled from boxes with SQUARE ENDS. Fixed at the root — `_blade` now
delegates to `_leafpoly`, which covers `bush_low`, `fern_a`, `vine_a` and
bamboo's sprays in one place. Architecture is exempt: a roof plane really is a
plane, which is why the built shrine and stall sit fine beside the donor huts.

The correction worth keeping: widening a thin leaf to survive the 4px outline
took them to 1.1:1, which is a circle — the bush became grapes and the fern a
pinecone. A leaf wants about 3:1, so the area has to come from LENGTH.

*And the horizon was still inked.* `drawTex('mtn', ...)` pasted hand-drawn
mountains across the sky on all five maps — the last of the old kit, and the
widest band in the frame. Replaced with `_farRange`, two tiers of peaks sharing
`_massif`'s shoulder profile. That closes the inked-art thread for the
background; `dike`, `stonewall` and `gate` slices remain as fallbacks behind
prop paths that are present, so they no longer draw.

*And one prop simply disagreed with the palette:* `palm_a`, the commonest prop on
the palm maps, had a PINK trunk — hue 15 degrees against 32.3 for palm_b/c/d,
and 80/58/50 against their 57/49/37. Now 26.1 and 56/46/36.

**Rule: before adding art to a map, audit what is already there — origin,
palette, and whether it belongs in 1965 Vietnam.**

**The declared-but-never-drawn fault.** Five map faults in a row have now had
the same shape: the DATA already said the thing was there and the renderer never
put it on screen. Cu Chi named `soil` it never showed; Ia Drang named a massif
that was not drawn; Mekong computed 63% and 65% of its two lanes under water and
delivered 0.13% of the frame; Khe Sanh declared `mode: 'siege'` with no
fortification anywhere in it; Hill 937 declared eleven assaults through a
monsoon and rendered deep healthy grass.

**Rule: when a map looks wrong, diff it against itself before redesigning it.**
Render twice, once with the suspect feature disabled, and count changed pixels.
The Mekong water measured perfectly by its own arithmetic and reached the screen
as five rows; nothing short of a diff would have caught that, and I would have
"fixed" a system that was already correct.

**OWNER PRIORITIES, raised from play. These come first.**

| # | Item | Why it is here |
|---|---|---|
| A | Animations | DONE. Clip churn, the two slow loops, and the cadence mismatch are all fixed and measured — walk now plays at 17.3 fps flat across every unit (was 7.3-12.7 with a 1.74x spread) and the walk-to-run jump is 1.87x (was 4.5x). Held poses breathe. The entry above previously said walk was still 7.4-12.8 fps; that was stale. |
| B | The guns | DONE for now. Five of six are built (M16, M60, AK, M40, RPG); the SVD stays a donor because it already carries a scope and reads. Checked at TRUE game size, not just zoomed. If the owner still wants more, the remaining lever is the M60's bipod and the AK magazine, which are 1-2 px at 84 px and only read at 2x+. |
| C | ~~The VC play with the US HUD~~ | DONE. `body.side-vc` carried exactly one rule, so the whole field-manual treatment stayed US. Now 120 of 204 HUD elements differ by side. |

| # | Item | Why it is here |
|---|---|---|
| 1 | ~~A real prone clip~~ | SOLVED, by not building one — prone is now `dive` frame 1, real mocap of a man going to ground. The synthesised clip stays broken and stays out of the atlas. Two diagnoses came out of the last attempts and are recorded in `Sprite3D._sel`: the pitch axis was wrong, and `Chest` cannot be rotated. |
| 2 | A SECOND death clip | The per-man rate/lag/lean variation is cheap and works, but it is one pose played at different speeds. BLOCKED the same way the prone clip is: the donor pack has 24 actions and exactly one `Death` (verified by dumping them), so a second is authoring, not mapping — which is precisely what failed three times for prone. Do not start it expecting a mapping job. |

**The prone clip: two more failures, and what they rule out.** Attempts four and
five were both aimed at the recorded cause — that pitching `Body` by 84 degrees
tips the rifle 84 degrees with it, into the dirt.

*Four — pitch `Abdomen` instead of `Body`.* The rig looks like it should allow
this: arms and legs are SIBLINGS below Body, so pitching the spine at Abdomen
carries chest, arms, head and weapon as one rigid unit while the legs are swung
back separately. It jack-knifed. Bending at the waist while the legs are still
vertical gives a man folded double, and swinging the legs afterwards curls them
up rather than laying them out.

*Five — keep the `Body` pitch, counter-rotate at `Chest`.* `Chest` is the common
parent of both arms, so the reasoning was that it moves them rigidly and the
weapon's Child-Of stays valid where rotating the shoulders individually had not.
It does not. At -66 the rifle detached completely and floated below the hands.

**So the constraint is sharper than "counter-rotating the shoulders fails": ANY
change to the wrist's world transform beyond the pose the Child-Of inverse was
captured at breaks the grip, including one applied through a common ancestor.**
A sixth attempt has to re-bind the weapon after posing, or hand-pose the arms —
it cannot be done by rotating bones above the wrist. The shipped workaround (the
`aim` pose dropped toward the ground, see js/sprite3d.js) stays.

**The last two guns, and the size you have to judge them at.** Drawing every
weapon at TRUE game size — an 84 px man, so a rifle is about 30 px — rather than
in a zoomed sheet showed which details survive and which do not. Two weapons
failed at any size, because their DEFINING feature was missing entirely rather
than merely small:

- the M40 had no visible scope, and a sniper rifle without one is just a thin
  rifle;
- the RPG had neither a tube nor a warhead, and read as a bulky rifle.

Both are built now. At 84 px the RPG is identifiable by the bulb at its muzzle
and the sniper rifles by the raised scope line, which is the most that can be
asked at 30 px of weapon. The SVD stays a donor mesh: it already carries a
visible scope and reads correctly, so rebuilding it would be work for nothing.

**The prone clip: solved by looking for the pose instead of building it.**
Seven attempts to synthesise it failed. Two of them produced findings worth
keeping, both now in the comment at `Sprite3D._sel`:

- **The pitch was about the wrong axis.** `pose_bone.matrix` is in ARMATURE
  space, and this rig is Y-up there, so the X rotation the code used swung the
  body through the camera's depth axis. The head did not disappear — it was
  rotated to where an orthographic side camera projects it onto the pelvis. Same
  cause as the barrel pointing at the dirt. About Z, the man lays out in the
  view plane and the rifle comes out level.
- **`Chest` can never be rotated; `Head` and the legs can.** The weapon's
  Child-Of inverse is captured at the standing pose, and Chest is an ancestor of
  `Wrist.R`. Bones that are not ancestors of the wrist are free.

With both fixed the grip survives and the weapon is level, and the body STILL
read as a man sitting up. The answer was that the pose already existed: `dive`
is the donor's Roll, and its frame 1 is a man pitched forward and low with the
rifle held level — gripped because it was RENDERED gripped rather than posed
afterwards. Free, too: the clip is already in the atlas for stance transitions.

**Rule: before synthesising a pose, look through the clips you already have for
one frame of it.** The old workaround was the standing `aim` pose shoved 26px
down the screen; this is an actual low posture, and the drop is now 9px.

**The animation jank was never the frame rate.** The previous pass raised `walk`
from 14 to 28 frames on the theory that low animation fps was the problem, and
the owner still reported jank. Measuring what is actually ON SCREEN explains
why: `run` is **76.7%** of every man-frame, `aim` 12.1%, the two idles 6.3% —
and `walk`, the clip that was doubled, is **1.5%**. The fix had been applied to
something nobody sees.

What was actually wrong was CHURN. Over a match, **57.7% of all clip changes
came after a dwell shorter than 0.3s**, against an `S3_BLEND` of 0.18 — so most
men, most of the time, were part-way through a cross-fade and never settled into
any pose. `S3_CLIP_HOLD` 0.24 -> 0.5 takes that to 12.2% and the p90 switch rate
from 40.7 to 31.8 a minute.

Two changes were tried alongside and REVERTED because the numbers did not
support them, which is the part worth keeping:

- `MOVE_HOLD` 0.16 -> 0.45 looked like an obvious companion fix. On identical
  sim runs across four seeds it was worth 0.05 switches a minute on top of the
  clip hold, and it makes a man who has genuinely halted keep running on the
  spot. Reverted.
- Widening the run/walk hysteresis to 0.72/1.38 moved p90 from 32.8 to 32.1 —
  inside the seed-to-seed spread. A single unseeded run had shown it as a large
  win and then as a large regression. Reverted.

**Rule: this sim does not seed `Math.random`, so a single before/after run
measures the seed, not the change.** Both of the above looked convincing once.

The other half was the slow loops. `aim` runs at 8.4 animation fps and the idles
at 5.4, on men standing still where nothing hides the stepping. Those three now
blend BETWEEN their own frames (`Sprite3D.SMOOTH`) — which the file elsewhere
rightly forbids, because cross-fading a run reads as double exposure. It does
not read that way here: between adjacent frames of a six-frame breathing loop a
chest moves two or three pixels. Costs +0.7 ms a frame at equal unit count.

**The prop contact sheet is now part of the audit.** Drawing all of them at one
world scale beside a 1.8 m bar found three faults that no frame had surfaced,
and the rule that produced them is worth keeping: *a prop is wrong if you cannot
name it from its silhouette alone.*

- `cart_v` was a Conestoga — a twelve-segment rim on six thin spokes under a
  hooped canvas tilt. Now an ox cart.
- `well_v` read as nothing at all. A side-on orthographic camera cannot show a
  well's mouth, so the shape has to come from the FRAME — posts, cross-pole,
  pail — not from the ring.
- `stonewall_a` read as fired brick, because level courses of equal-height
  blocks are what the eye reads, not the block widths that were already being
  randomised.

Still weak, not yet wrong enough to spend on: `stall_v` reads as a mostly empty
frame, and `vine_a`'s regular leaf spacing reads as a rope ladder at foreground
size (already noted in `_drawForeground`, which keeps it out of the near band).

**Weapons are built now, not borrowed.** `WEAPON_MESH` entries reading
`BUILT:` are assembled in `_build_weapon` from boxes rather than lifted from the
Quaternius pack. The pack has no M16 and no belt-fed GPMG, and the two nearest
stand-ins were the worst-reading weapons in the game — at 3x zoom the SMG was a
featureless slab and ShortCannon a blank box deeper than the gunner's chest.

A rifle is the one subject where box geometry is honestly right: it IS flat
planes and straight tubes. Same argument that keeps the built architecture props
beside the donor meshes; organic shapes are what need real scans.

The AK followed for a reason worth remembering: it was a perfectly good donor
mesh and looked fine until the M16 and M60 beside it grew a carry handle, a
magazine and a bipod — then it was the flattest thing in the frame. **Improving
part of a set makes the rest look wrong.** Budget the whole set or none of it.

**Death variety is done without spending memory.** There is one death clip per
unit and the atlas is at 89 MB of a 130 MB budget with props, so a second clip
was not the first move. Three axes fixed at spawn instead — collapse rate,
start lag, and settle angle — which cost nothing and break the unison.

The ranges had to be WIDE. A squad is three to five men, and the first attempt
(dieK 0.72-1.34) drew 1.06/1.03/1.04 for one squad: a one-frame spread out of
twelve, invisible. At 0.6-1.55 the measured spread across six sampled four-man
groups is 2-4 frames mid-fall, median 3. The spread has to survive a bad draw,
not just look right in expectation.

`drawCorpse` needed the matching fix: it forced `deadT: 0.8`, which landed on
the last frame only while every fall was exactly 0.75s. It now pins dieK/dieLag
to reference values so every corpse bakes fully fallen, and passes `dieLean`
through so the bake does not pop the body upright.


**Checked and NOT a gap: audio.** It was about to go on this list as "an M60 and
an M16 are indistinguishable by ear, no distance falloff, no crack-thump" — all
three false. `js/audio.js` already gives m16/ak/mg their own spectra, pans off
camera-relative world x, attenuates with distance, rolls sharpness into a
muffled thump as `far` rises, DELAYS the report so a shot across the map arrives
late, and slaps an echo back off the treeline past 0.25 far. Verify before
ranking.

## 3. Blocked on the owner

- **An FPS reading** off `` ` ``/F3 — now a nice-to-have rather than a blocker.
  `tools/perf.js` gives a real millisecond cost (see rule 7); the owner's number
  would confirm it against a composited display.
- **Does it feel right?** Mechanics are verified; feel is not something I can
  measure.
- **The HUD design** (`design/hud/`, published as a canvas). Item 3 above does
  not start until the owner has looked at it — wiring the wrong plates into
  `ui.js` and `style.css` is a day spent on something they may not want.
- **Nothing, for art.** Corrected: §1.3 needs CC0 models run through the
  existing Blender pipeline, not generated images. `docs/ASSET_PROMPT.md` §A has
  the steps. Claude Design is the right tool only for the HUD (§B there), which
  is DOM and CSS and so translates almost directly.

## 4. Current numbers

Measured at 1600x900 after the map-identity, weapon and prop work, against caps
of 13 src Mpx / 220 particles / 130 MB decoded.

**MEMORY**

| | MB |
|---|---|
| sprite atlases (12 units x 135 frames) | 89.3 |
| props (27) | 27.0 |
| **total** | **116.3** of 130 |

Down from 118.3 after `rock` and `sandbag_one` — rendered, committed and decoded
every load, drawn never — were removed. 13.7 MB spare.

**SOURCE PIXELS**, on a FRESH PAGE LOAD, which is the only honest way to read it
(see rule 6): 9.7 on iadrang, 11.6 on cuchi, against a cap of 13. Staging all
five maps in one page reports 13.4 and means nothing.

**FRAME COST**, `tools/perf.js`, 60 samples, `degraded: false` on all five:

| map | men | frameMs | p95 | ceiling |
|---|---|---|---|---|
| iadrang | 25 | 4.4 | 5.1 | 227 fps |
| cuchi | 44 | 5.9 | 6.6 | 169 fps |
| mekong | 38 | 6.0 | 7.3 | 167 fps |
| khesanh | 35 | 5.0 | 5.5 | 200 fps |
| hill937 | 37 | 5.7 | 6.1 | 175 fps |

Every map holds 60 fps with 2.3-3.3x headroom, and the TAIL is inside budget
too. Costs are up roughly 1-2 ms against the previous table, on maps that gained
paddy fields, a firebase, churned mud and denser cratering — all of which bake
into the lane layer once, so the rise tracks unit and particle counts rather
than the new terrain. `_buildLane` bakes in 4-24 ms per map.

**Quote no p95 taken from fewer than 50 samples.** At `iters: 18` the same
scenes reported medians of 6.1 and p95s of 17.7-18.5, which read as the FX work
pushing the tail over the 60fps line. It had not: a p95 over 18 samples is
"second worst frame", and the worst frames are warm-up and GC. At 70 samples the
same scene gives 3.1 and 3.7. This was one edit away from being recorded here as
a regression that did not exist. The tool now warms up ten frames and defaults
to 60.

**These are STEADY-STATE figures.** `Capture.budget()` used to measure the
first render after staging, which bakes every lane layer — a one-time map-load
cost, not a per-frame one. That made it report 16-17 Mpx where the truth is
7.5-8.3, and several numbers quoted earlier in this project were inflated for
that reason. It now renders a warm-up frame before instrumenting.
