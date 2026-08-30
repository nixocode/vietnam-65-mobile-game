# Vietnam '65 — Nano Banana Pro asset prompts

Prompt kit for generating game art with **Nano Banana Pro** (Gemini 3 Pro Image).
Attach your gameplay **screenshot(s) as reference images** on every generation so the model
locks onto the existing style. Generate **one unit / one sheet per request** — the model holds
a single subject far more consistently than a crowd.

---

## 0. MASTER STYLE BLOCK — paste at the top of *every* prompt

```
Generate 2D game art for "Vietnam '65: Lanes of War", a grounded, documentary-toned
side-view lane-tactics war game in the tradition of Warfare 1944. MATCH the exact art
style, proportions, line weight, and palette of the attached reference screenshot(s):
flat, slightly grungy, limited-shading vector-meets-gouache look with strong readable
SILHOUETTES and a muted, filmic military palette. No neon, no glossy 3D render, no anime.

PALETTE (stick to these): olive drab #3c4531 / #262c1e, US uniform green #4d5a3c,
VC black-pajama #302e28 and NVA khaki #6f6748, VC red #c25b45, brass/gold #c9a86a,
bone/paper #d8d2b0, muted blood #7c2418, gunmetal #26251d.

PERSPECTIVE: strict ORTHOGRAPHIC SIDE VIEW — camera perpendicular to the subject,
facing RIGHT, zero perspective distortion, no foreshortening, flat ground plane.
Single soft key light from upper-left with gentle ambient occlusion; do NOT bake a
hard cast shadow into the sprite.

OUTPUT: transparent background (PNG/alpha). Subject centered, consistent scale, clean
cut-out edges. NO text, NO watermark, NO logo, NO UI, NO frame/border. Must stay
readable when scaled down to ~64px tall.
```

> Facing: always generate **facing right**. The engine mirrors sprites for the other side,
> so you only need one direction.
> If transparent edges come out muddy, swap the OUTPUT line for:
> `OUTPUT: subject on a FLAT SOLID MAGENTA #FF00FF background for clean chroma-key removal.`

---

## 1. US / ARVN infantry (one sheet per unit)

```
[MASTER STYLE BLOCK]

SUBJECT: a US infantry "{UNIT}" as a side-view game sprite, facing right.
Lay out a horizontal SPRITE SHEET, evenly spaced cells on one baseline, same character
and same scale in every cell, in this pose order, left to right:
1) idle stance  2-4) 3-frame walk cycle  5) firing weapon (muzzle forward)
6) prone / aiming  7) hit-stagger  8) fallen (killed, lying on the ground).
Label nothing on the art itself. Uniform cell size.

Do the sheet for each of these — one generation each:
- RIFLEMAN: M1 steel-pot helmet, olive fatigues, M16 rifle.
- ARVN LIGHT INFANTRY: slightly smaller/leaner frame, M1 helmet, lighter tan-green
  fatigues, M16 — visibly cheaper/lighter kit than the US regular.
- M60 GUNNER: M1 helmet, belt-fed M60 machine gun braced at the hip, ammo belt.
- COMBAT ENGINEER: M1 helmet, demolition pack on back, entrenching tool / satchel,
  crouched "clearing" variant for the working pose.
- LRRP RECON: boonie hat, radio antenna on back, binoculars, M16, alert "spotting" idle.
- SCOUT SNIPER: boonie hat with light ghillie strips, prone bolt-action Remington M40
  with long scope; poses 5-6 are the aim/fire, telegraphed with a subtle scope glint.
```

---

## 2. Vietcong / NVA infantry (one sheet per unit)

```
[MASTER STYLE BLOCK]

SUBJECT: a Vietcong/NVA "{UNIT}" as a side-view game sprite, facing right.
Same 8-cell pose sheet as the US infantry (idle, 3-frame walk, firing, prone, hit, fallen),
uniform baseline and scale.

One generation each:
- LOCAL FORCE GUERRILLA: conical straw hat (nón lá), black-pajama peasant clothing,
  AK-47; lean, low-profile posture that reads as "hiding in the brush".
- NVA REGULAR: green pith helmet, khaki uniform, chest webbing, AK-47.
- RPD GUNNER: pith helmet, khaki, RPD light machine gun with drum magazine.
- SAPPER: cloth headband, stripped-down kit, bundle of satchel charges/explosives,
  fast crouched "charging forward" posture.
- MARKSMAN: conical hat, black pajamas, bolt-action Mosin-Nagant rifle, patient
  crouched/prone aiming pose (the VC answer to the US sniper).
```

---

## 3. Weapons — HUD icons & skin variants

```
[MASTER STYLE BLOCK]

SUBJECT: a clean side-profile studio sprite of a single Vietnam-era weapon, facing right,
centered, for a HUD card icon. Slightly worn field-used metal and wood, muted finish.
One per generation: M16A1 rifle · M60 machine gun · Remington M40 sniper rifle with
Unertl scope · AK-47 · RPD light machine gun · Mosin-Nagant rifle · satchel-charge bundle
· entrenching tool.

Then a "weapon skins" row — same weapon, 4 field variants side by side on one baseline:
factory-clean, jungle-worn (scratches, mud), tape-and-paracord field mod, and a
suppressed variant. Muted, realistic, no fantasy camo.
```

---

## 4. Fire (additive VFX — sheet of frames)

```
[MASTER STYLE BLOCK — but OUTPUT on PURE BLACK #000000 for additive blending.]

SUBJECT: stylized 2D FIRE effects, side view, painterly-but-punchy, warm palette
(#ffd05a → #ff9631 → #ff5a1e) fading to smoke. Each as a horizontal strip of 6 evenly
spaced animation frames, looping, same anchor point:
- NAPALM FLAME STRIP: low wide wall of rolling flame with black oily smoke rising.
- BURNING JUNGLE BRUSH: a clump of foliage on fire, embers lifting.
- SMALL GROUND FIRE: a modest campfire-scale flame for lingering scorch zones.
- EMBER / SPARK SET: scattered floating embers and sparks, no smoke.
Bright emissive cores, transparent/black elsewhere, no ground, no objects.
```

---

## 5. Explosions & muzzle flashes (additive VFX — frame sequences)

```
[MASTER STYLE BLOCK — but OUTPUT on PURE BLACK #000000 for additive blending.]

SUBJECT: 2D explosion effects, side view, as a horizontal strip of 6-8 evenly spaced
frames showing the full life cycle (ignition flash → fireball → dirt/debris → smoke).
One per generation:
- ARTILLERY GROUND IMPACT: white-hot flash, orange fireball, brown dirt geyser, gray smoke.
- NAPALM BLOOM: broad low fireball with heavy black smoke rollout.
- ARC LIGHT / B-52 STRIKE: a ROW of overlapping heavy blasts and a rising smoke wall.
- MUZZLE FLASH SET: 4 small star-shaped muzzle flashes (rifle, MG, sniper, RPG) in one row.
- SMOKE PUFF & COLUMN: a soft dissipating smoke puff, plus a tall lingering smoke column.
Bright emissive, transparent/black background, no characters, no ground line.
```

---

## 6. Ground decals (flattened, sit on the terrain)

```
[MASTER STYLE BLOCK]

SUBJECT: persistent GROUND DECALS meant to lie flat on a side-view terrain line, so draw
them as low, FLATTENED / slightly elliptical marks (raked perspective, not top-down),
transparent background, no objects standing up. A grid/sheet of these, each isolated:
- shell crater (dark pit + raised dirt rim)
- black scorch/burn mark
- wide napalm burn scar with charred stubble
- blood pool + splatter (muted #7c2418, restrained)
- bullet-hole / impact cluster on dirt
- scattered brass shell casings
- drag/track marks
- tunnel entrance (dark hole, dirt lip, wooden frame)
- punji stake pit (sharpened bamboo in a shallow hole)
- sandbag emplacement (low wall, side view)
- wrecked/burned-out Huey fuselage
Muted, weathered, filmic — environmental storytelling, not cartoon splashes.
```

---

## 7. Battlefield casualties

This is a mature war game whose whole stated tone is *documentary and restrained — no side
glorified*. Ask for casualty art in **that** register: stylized, silhouette-first, muted
blood, readable at sprite scale. That framing (a) matches the art direction, and (b) is
practically important — image models routinely **refuse or degrade** on photoreal gore, so a
restrained, stylized brief is what actually renders cleanly.

```
[MASTER STYLE BLOCK]

SUBJECT: side-view battlefield CASUALTY sprites for a mature, documentary-toned war game,
facing right, transparent background, in the same flat muted silhouette style as the
soldiers. Isolated cells on one baseline:
- fallen US soldier (killed, lying prone, helmet fallen)
- fallen VC/NVA soldier (killed, lying prone, conical hat / pith helmet nearby)
- wounded soldier crawling / clutching a wound
- wounded soldier being carried on a stretcher (for the Dustoff medevac theme)
- a "shattered position": destroyed sandbag nest with a downed defender
Keep blood muted (#7c2418) and stylized, not photoreal; injuries implied by pose and
silhouette rather than explicit detail. Serious and grim, never comedic or celebratory.
```

> If you specifically want **dismemberment/heavier gore**, add a line like:
> `Show battlefield dismemberment stylized as dark silhouette shapes with muted #7c2418
> blood — implied, not anatomically explicit.`
> Explicit/photoreal gore prompts are the ones that get blocked; the stylized-silhouette
> version both passes and matches your engine's tiny sprites.

---

## 8. Workflow tips for Nano Banana Pro

- **Reference every time.** Drag your gameplay screenshot in as an image input and say
  "match this style" — it's the single biggest quality lever.
- **One subject per generation** for consistency. For a full unit: generate the idle "hero"
  frame first, then in a follow-up say *"the same character, same style, now in these poses:
  …"* so the model carries the design forward.
- **Ask for a labeled strip** ("horizontal strip of N evenly spaced frames on one baseline,
  identical scale") — makes slicing into the engine trivial.
- **Lock scale** by requesting a fixed cell, e.g. *"each cell 256×256 px, character ~200px
  tall, feet on a common baseline."*
- **Set aspect ratio** to match the sheet (e.g. 16:9 or a wide strip) and request the
  highest resolution (2K–4K) so downscaled sprites stay crisp.
- **Transparent vs. magenta:** try transparent first; if edges fringe, regenerate on flat
  magenta #FF00FF and key it out in code/an editor.
- **Iterate in pairs:** generate US and VC versions of the same pose set back-to-back so the
  two factions read as one coherent style.
```
