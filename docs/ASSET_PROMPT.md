# Where new art actually comes from

**Correction to an earlier version of this file.** It contained a prompt asking
an image tool for transparent PNG sprites. That was pointed at the wrong tool
twice over: Claude Design produces **HTML/CSS artboards**, not PNGs, and this
game does not need generated sprites in the first place — it renders its own.

There are two separate pipelines. Use the right one.

---

## A. Scenery, props, foliage → **the Blender pipeline, no image generation**

`tools/render_props.py` renders a 3D model to 2D through the **same locked
orthographic camera and the same lighting rig as the soldiers**. That is why a
hooch and a rifleman agree on where the viewer is standing. A generated PNG
never can — it would be one more thing to keep in sync by hand.

**To add a palm variant, a bamboo clump, a burnt trunk, an ox cart:**

1. Get a **CC0** model. Same sources the project already uses:
   - [poly.pizza](https://poly.pizza) — Quaternius packs, CC0
   - [quaternius.com](https://quaternius.com)
   - [kenney.nl](https://kenney.nl)
2. Drop the `.glb` in `art/props/`. Filenames are the source CDN UUID — that is
   deliberate, it keeps provenance attached to the file.
3. Add `UUID → name` to `GLB_NAME` in `tools/render_props.py`.
4. Run:
   ```
   /Applications/Blender.app/Contents/MacOS/Blender -b \
     --python tools/render_props.py -- --out assets/props --res 512
   ```
5. Record the source URL and licence in `art/models/SOURCE.txt`.

The script writes the PNG **and** the `props.json` entry, including `realH` in
metres — which is what actually places it, since the game knows a soldier is
1.8 m at 84 px.

**For simple geometry there is not even a model to find.** `BUILT` in the same
file constructs props from boxes in code — the watchtower, well and cart are all
made this way. A crate stack, fence run, drying rack or dike marker is a few
lines there, and it comes out in perfect style because it goes through the same
camera.

> Watch the units. `bmesh.ops.create_cube(size=1)` spans −0.5…0.5, so **the
> scale IS the span**. Halving it once made every box half its intended size and
> the conclusion drawn at the time — "procedural props don't work" — was wrong
> for a whole session.

---

## B. UI, HUD, menus, title screens → **Claude Design**

This is where Claude Design genuinely fits, because **the game's HUD is already
DOM and CSS**. An artboard can be translated into `index.html` + `css/style.css`
almost directly, and in places lifted wholesale.

Hard constraints it must respect — these are not stylistic preferences, the
layout breaks without them:

| | |
|---|---|
| **Design size** | Exactly **1280 × 720**. The whole HUD is authored at that size and scaled by `--uiK` at runtime. |
| **Scaling** | `#hud` is `transform: scale(var(--uiK))`, ~0.52 on a phone in landscape. |
| **Touch targets** | Must be ≥44 **physical** px, so authored as `calc(44px / var(--uiK))`. A plain 44px lands at ~23 real px. |
| **Playfield** | **Two** lanes, ground lines at y **400** and **545** of 720. The bottom ~175px is free — that is the HUD's room. |
| **Palette** | `--paper #d8d2b0`, `--brass #c9a86a`, `--olive #3c4531`, `--ink #14170f`, `--us #8aa06b`, `--vc #c25b45` |
| **Type** | Headings Impact/condensed sans, body Courier New. Already in `--font-head` / `--font-mono`. |
| **Portraits** | Use the existing `assets/ui/port_*.png`. Do not redesign them — 3D-rendered replacements were tried and were worse. |

### Prompt for Claude Design

> Design the in-match HUD for **Vietnam '65: Lanes of War**, a side-on
> lane-tactics game with a **documentary tone — worn, military, functional, no
> gloss and nothing triumphant**. Think a field radio and a map case, not a
> sci-fi interface.
>
> Artboard **1280 × 720**. The battlefield fills the frame behind; the HUD is an
> overlay. **Keep the middle clear** — the fight happens between y 300 and y 560.
> The bottom **175px** and the top **80px** are yours.
>
> Build:
> 1. **Top bar** — faction identity each side (US/ARVN left, VC/NVA right), a
>    morale bar per side, objective line centred, small lane-control pips, and a
>    compact minimap slot 240 × 52.
> 2. **Bottom command bar** — a CP counter, then unit cards in labelled groups
>    (BASIC INFANTRY / HEAVY WEAPONS / SPECIALISTS), then a divider, then
>    call-in cards. A card is ~88 × 76 with a portrait, name, cost, hotkey digit,
>    a men count, and two 4-pip stat rows (firepower amber, toughness green).
> 3. **Selected-squad strip** — squad name, and order buttons ADVANCE / HOLD /
>    FALL BACK / GRENADE / SMOKE.
> 4. **Unit detail panel** — appears on card hover: framed portrait, role line,
>    three iconed stat bars, one italic trait line, cost.
>
> Materials: brass rule lines, canvas and olive drab panels, stencilled labels,
> subtle paper grain. Rivets and stamped edges are welcome; gradients, glass,
> neon and drop-shadow glow are not.
>
> Deliver as HTML + CSS using CSS custom properties for every colour, so it can
> be dropped into an existing stylesheet.

---

## What Claude Design cannot do here

Sprites, foliage, terrain textures, characters, weapon art. Those are section A —
they come out of Blender, and that is the only way they stay in style.
