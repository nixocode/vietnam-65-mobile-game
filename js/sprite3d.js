/* Sprite3D — soldiers drawn from sheets rendered off a rigged 3D model.
 *
 * Every frame of every clip came off one model under one locked orthographic
 * camera, so a soldier physically cannot morph between frames and every frame
 * shares the same anchor. That is the whole reason this path exists: the cutout
 * rig could only ever fake limbs, and per-frame AI sheets could never hold a
 * character still. See tools/render_model_sprites.py.
 *
 * It exposes the same three entry points as Rig (draw / muzzle / drawCorpse) and
 * takes priority over it when its atlases are loaded; Rig stays as the fallback.
 */
const S3_TARGET_H = 84;        // on-screen height of a soldier at scale 1, matches Rig
/* How far below a unit's origin the ground plane sits, in S3_TARGET_H units.
 * Measured off the rig it replaces: at scale 1 that rig drew an 84px soldier with
 * his boots 39px below the origin, so sprites must plant their ground line there
 * or every soldier would float or sink relative to cover and decals. */
const S3_FOOT = 39 / 84;

/* Gait tuning. A cycle length is given as a multiple of the soldier's drawn
 * height, which is what keeps the feet planted: a real walk covers about one
 * body height per cycle and a run nearly two. These sit slightly under those
 * figures, trading a trace of skate for a cadence that does not look like slow
 * motion at the pace units actually cross a lane. */
/* Troops advancing under fire should read as MOVING, not strolling. Units cross
 * a lane slowly by design, and sizing the cycle honestly to that distance gave a
 * parade-ground walk. So the run clip is used for any real movement and its cycle
 * is deliberately compressed — a shorter, quicker stride. That trades a little
 * foot-skate for urgency, which at 84px is the better deal. Walk survives only
 * for genuinely slow movement (suppressed, or easing into a slot). */
/* The run cycle is 1.5x quicker than it was (0.58 -> 0.387). Because the gait is
 * driven by DISTANCE, not time, a shorter cycle is exactly a faster cadence at
 * an unchanged movement speed: the same crossing now costs 1.5x the strides.
 * The cost is foot-skate — a 0.387 cycle is about a 32px stride at 84px tall,
 * shorter than a man that size really covers — but a visibly urgent run beats a
 * geometrically honest one at this scale, which is the trade the block above
 * already describes. Walk is untouched; it only ever runs at genuinely slow
 * speeds where the honest stride still reads correctly. */
// The speed the stride length is normalised against — the rifleman, the unit
// every other one is balanced around. See the stride note in _sel.
const S3_REF_SPD = 42;
const S3_WALK_CYCLE = 0.72;
const S3_RUN_CYCLE = 0.387;
const S3_WALK_SPD = 22;        // world px/s below which a soldier is picking his way

/* Seconds to cross-fade between two clips. Without this a man snaps from running
 * to aiming in a single frame with no settle, which is the single loudest "arcade"
 * tell in the game — the sim underneath is fine, the presentation just popped. */
const S3_BLEND = 0.18;

/* Minimum time a clip is held before another may replace it. Slightly longer
 * than the cross-fade, so a blend always has time to finish before the next one
 * starts — the previous behaviour let a new change begin while the last was
 * still resolving, which is what stacked up into visible chatter. */
/* A blend needs time to LAND, and this is the single knob that decides whether
 * a man ever settles into a pose.
 *
 * At 0.24 against S3_BLEND 0.18, a man switching at the gate limit was two
 * thirds of the way through one cross-fade when the next began, so he read as
 * vibrating between poses rather than holding either. Measured over a match,
 * 57.7% of ALL clip changes came after a dwell shorter than 0.3s — most men,
 * most of the time, were mid-blend. That is the jank.
 *
 * 0.5 takes that to 12.2% and p90 switch rate from 40.7 to 31.8 a minute, on
 * identical sim runs across four seeds. It is still far below the ~4s dwell of
 * states men genuinely hold, and events that must be seen on the frame they
 * happen bypass it entirely — see URGENT.
 *
 * Two things tested alongside and rejected because the numbers did not support
 * them: raising MOVE_HOLD to 0.45 (worth 0.05 switches a minute on top of this,
 * and it makes a halted man run on the spot), and widening the run/walk
 * hysteresis to 0.72/1.38 (32.8 -> 32.1 p90, inside the seed-to-seed spread). */
const S3_CLIP_HOLD = 0.5;

/* Seconds to pivot when a soldier reverses. Flipping the sprite in one frame is
 * a teleport; easing the horizontal scale through zero reads as a man turning on
 * the spot, which is most of the difference between a token and a soldier. */
const S3_TURN = 0.15;
const S3_TURN_MIN = 0.17;      // never squash to nothing — that reads as a dropped frame

const Sprite3D = {
  enabled: false,
  units: {},                   // unit key -> { img, meta }
  _pending: 0,

  load(onDone) {
    const done = () => { if (--this._pending <= 0 && onDone) onDone(); };
    /* MOBILE: the manifest is fetched, the ATLASES are not.
     *
     * Desktop loads all twelve units at boot — 89 MB decoded on the old budget,
     * 55 MB on this one, and every byte of it before the player sees a menu. A
     * phone cannot spend that up front, and it does not need to: a unit's atlas
     * is only needed once one of its men exists.
     *
     * So this records what CAN be loaded and loads nothing. `ensure()` pulls a
     * unit on first use, and `prefetch()` warms both rosters when a match
     * starts. Until an atlas lands, `has()` is false and the caller falls back
     * to the procedural soldier for a frame or two — the same graceful path the
     * deferred image loader uses. */
    fetch('assets/sprites3d/manifest.json')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((m) => {
        this.available = m.units || [];
        if (onDone) onDone();
      })
      .catch(() => { if (onDone) onDone(); });
  },

  /* Load one unit's atlas if it is not already loading or loaded. */
  ensure(u) {
    if (!u || this.units[u]) return;
    if (!this._req) this._req = {};
    if (this._req[u]) return;
    if (this.available && this.available.indexOf(u) < 0) return;
    this._req[u] = 1;
    this._loadUnit(u, () => {});
  },

  /* Warm every unit both sides can field, at match start.
   *
   * Called from Game's constructor. A squad's `comp` names its men, so the two
   * ROSTERS plus anything pre-placed on the map is the exact set a match can
   * produce — no guessing, and no atlas arrives late enough to be seen. */
  prefetch(map, sides) {
    if (typeof SQUADS === 'undefined') return;
    const want = new Set();
    for (const side of (sides || ['us', 'vc'])) {
      for (const key of (typeof ROSTERS !== 'undefined' && ROSTERS[side]) || []) {
        const d = SQUADS[key];
        if (d) for (const m of d.comp) want.add(m);
      }
    }
    for (const p of (map && map.prePlaced) || []) {
      const d = p.key && SQUADS[p.key];
      if (d) for (const m of d.comp) want.add(m);
    }
    for (const u of want) this.ensure(u);
  },

  _loadUnit(u, done) {
    const base = 'assets/sprites3d/' + u + '/';
    fetch(base + 'atlas.json')
      .then((r) => r.json())
      .then((meta) => new Promise((res) => {
        const img = new Image();
        img.onload = () => { this.units[u] = { img, meta }; this.enabled = true; res(); };
        img.onerror = () => res();
        img.src = base + 'atlas.png';
      }))
      .catch(() => {})
      .then(done);
  },

  has(key) { return !!this.units[key]; },

  /* ---------------- clip + frame selection ---------------- */

  /* Which clip a unit is in, and how far through it — the only place game state
   * is translated into animation, so every draw of a given unit agrees. */
  _sel(key, o) {
    const U = this.units[key];
    const C = U.meta.clips;
    const pick = (...names) => names.find((n) => C[n] && C[n].length);

    if (o.deadT != null) {
      const c = pick('death');
      const f = C[c];
      /* Play once then hold the last frame — matches Rig's death blend.
       *
       * The 0.75s is now per-man (`dieK`) and starts after a short per-man lag
       * (`dieLag`), because with one death clip and no budget for a second, a
       * squad killed by a single burst played the same animation five times in
       * exact sync. Rate and stagger are the two axes that cost nothing and
       * break the unison; `dieLean` handles the third, in the draw. */
      const dur = 0.75 * (o.dieK || 1);
      const p = Math.min(1, Math.max(0, (o.deadT || 0) - (o.dieLag || 0)) / dur);
      return [c, Math.min(f.length - 1, Math.floor(p * (f.length - 1) + 0.0001))];
    }
    /* KNEELING — and it is `dive` frame 0, not a posed clip.
     *
     * A kneel WAS synthesised in Blender, and it was bad: the rear shin came
     * out pointing back and UP with the foot in the air, the forward leg folded
     * rather than planted, and widening the leg angles only splayed the man
     * into the splits. Reported, accurately, as not looking coordinated.
     *
     * The pose already existed. `dive` is the donor's Roll, and its frame 0 is
     * the crouch that precedes the roll: rear knee down with the shin flat
     * along the ground, forward foot planted under a vertical shin, torso
     * upright, head up. That is a firing kneel, and it is real mocap, so the
     * weapon is gripped because it was RENDERED gripped.
     *
     * This is the second time looking through existing clips has beaten posing
     * one — prone is `dive` frame 1 for the same reason. And the two together
     * are coherent: frame 0 kneeling, frame 1 prone, so the stance transition
     * that runs 0 -> 1 IS the man going from one to the other.
     *
     * The synthesised `kneel` clip is gone from the atlas entirely, which also
     * hands back 6 frames x 12 units of memory. */
    if (o.pose === 'kneel' && (o.transT || 0) <= 0) {
      const c = pick('dive', 'aim', 'idle');
      if (c === 'dive' && C[c].length) return [c, 0];
      if (c) {
        const n = C[c].length;
        const t = (o.time || 0) * 0.55 + (o.gaitOff || 0);
        const q = ((t % 1) + 1) % 1 * n;
        return [c, Math.floor(q) % n, q - Math.floor(q)];
      }
    }
    if (o.pose === 'prone' && (o.transT || 0) <= 0) {
      /* DOWN BEHIND THE WEAPON — and it is a frame of `dive`, not a pose built
       * for the job.
       *
       * The rendered `prone` clip has never worked. It is synthesised by
       * pitching the standing figure about the pelvis, and after seven attempts
       * the failures are understood but not fixed:
       *
       *   - The pitch was about the WRONG AXIS. `pose_bone.matrix` is in
       *     ARMATURE space, where this rig is Y-up, so the X rotation the code
       *     used swung the body through the camera's depth axis. That is why
       *     the head vanished — it was not hidden, it was rotated to where an
       *     orthographic side camera projects it onto the pelvis — and why the
       *     barrel pointed at the dirt. Rotating about Z instead lays the man
       *     out in the view plane and the rifle comes out LEVEL.
       *   - Counter-rotating `Chest` to lift the torso detaches the rifle,
       *     every time. Chest is an ancestor of Wrist.R, and the weapon's
       *     Child-Of inverse was captured at the standing pose. Bones that are
       *     NOT ancestors of the wrist — Head, UpperLeg, LowerLeg — are safe.
       *   - With the axis fixed and the chest left alone the grip survives and
       *     the weapon is level, but the body still reads as a man sitting up
       *     rather than lying down, and no combination of leg and head angles
       *     tried has fixed that.
       *
       * So: use `dive` frame 1, which is real mocap of a man going to ground —
       * pitched forward and low, legs trailing, rifle held level and forward,
       * head up. The weapon is gripped because it was RENDERED gripped rather
       * than posed into place afterwards, and it costs nothing: the clip is
       * already in the atlas for the stance transition.
       *
       * This replaces an earlier workaround that used the `aim` pose dropped
       * toward the ground — a STANDING man moved down the screen. This one is
       * actually a low posture. `prone` itself stays out of the atlas entirely
       * (see SKIP in tools/pack_sprites3d.py). */
      /* FRAME 0, NOT FRAME 1 — and the note above is wrong about frame 1.
       *
       * It claims frame 1 is "a man going to ground, pitched forward and low,
       * rifle level, head up". Rendered and looked at, it is not: the man is
       * doubled over head-DOWN with his legs in the air, already into the
       * donor's barrel roll. That is the somersault the owner has been
       * reporting in firefights, and it was never a transition bug — it is the
       * held pose itself.
       *
       * Every candidate in the atlas was checked before settling: dive 2-8 are
       * the rest of the roll, death 5-11 put the man on his BACK with the
       * weapon across him, and the donor's twenty-four mocap clips contain no
       * crouch, kneel or prone at all — the three hand-posed attempts on disk
       * (prone, kneel, crouch) all break the legs, because this rig has no IK
       * and posing the legs by bone rotation splays them.
       *
       * So prone holds frame 0, the crouch, and earns its lower silhouette from
       * `proneDrop` in the draw instead. It is not a true prone. It is a man
       * hunkered lower than a kneel, which is a smaller lie than a cartwheel,
       * and it costs nothing to ship today. A real prone needs a clip this
       * donor does not have. */
      const c = pick('dive', 'aim', 'idle');
      if (c === 'dive' && C[c].length) return [c, 0];
      if (c) {
        // fallback: the old aim-based hold, still with slow breathing so a
        // frozen frame does not read as a bug
        const n = C[c].length;
        const t = (o.time || 0) * 0.5 + (o.gaitOff || 0);
        return [c, Math.floor(((t % 1) + 1) % 1 * n) % n];
      }
    }
    if ((o.nadeT || 0) > 0) {
      // an overhand arc, played once across the wind-up and release
      const c = pick('throw');
      if (c) {
        const p = 1 - Math.min(1, (o.nadeT || 0) / (o.nadeDur || 0.9));
        return [c, Math.min(C[c].length - 1, Math.floor(p * C[c].length))];
      }
    }
    if ((o.transT || 0) > 0 && C.dive && C.dive.length) {
      /* Going to ground is a dive rather than a pop between standing and prone.
       *
       * Getting up is that same dive PLAYED BACKWARDS. This used to run the clip
       * forward in both directions, so a man standing up threw himself at the
       * floor to do it — which, cross-faded against the standing pose he was
       * heading for, is what read as soldiers spinning in firefights. The vector
       * fallback in render.js had the direction term all along; the sprite path
       * never got it. transDir: +1 dropping, -1 rising. */
      /* ONLY THE FIRST TWO FRAMES. `dive` is the donor's Roll clip, and beyond
       * frame 1 it is exactly that — a full barrel roll, legs over head. This
       * played the whole nine frames across 0.28 s, so every man going down or
       * getting up threw a fast somersault. Reported as "a weird roll from
       * prone that's really fast and bad", and correct.
       *
       * Frame 0 is the crouch and frame 1 is the man low behind his weapon,
       * which is the prone pose itself (see the prone branch above). So the
       * transition is 0 -> 1 and back, and the roll is never reached. */
      const p = 1 - Math.min(1, (o.transT || 0) / STANCE_TRANS);
      const last = Math.min(1, C.dive.length - 1);
      // FROM -> TO, so any pair of stances works. See the note in game.js where
      // transA/transB are set; the old single `transDir` could only express
      // stand<->prone and played a kneel as a rise out of lying down.
      const a = o.transA != null ? o.transA : ((o.transDir || 1) > 0 ? 0 : last);
      const b = o.transB != null ? o.transB : ((o.transDir || 1) > 0 ? last : 0);
      const f = a + (b - a) * p;
      return ['dive', Math.max(0, Math.min(last, Math.round(f)))];
    }
    if ((o.hitT || 0) > 0) {
      // two flinches, chosen per soldier, so a squad taking fire is not one loop
      const c = ((o.gaitOff || 0) < 0.5 ? pick('hit', 'hit2') : pick('hit2', 'hit'));
      if (c) {
        // game.js sets hitT to 0.16 on a hit; matching that plays the whole
        // flinch instead of starting a quarter of the way in
        const p = 1 - Math.min(1, (o.hitT || 0) / 0.16);
        return [c, Math.min(C[c].length - 1, Math.floor(p * C[c].length))];
      }
    }
    /* GOING BACKWARDS LOOKS LIKE GOING BACKWARDS.
     *
     * A squad on FALL BACK used to play the forward run with the sprite
     * flipped, so men withdrawing appeared to charge the way they came. The
     * donor had `Run_Back` all along — the figure moving rearward while still
     * facing the threat — and nothing had ever used it. That facing is the
     * whole read: it is the difference between a retreat and a rout. */
    if (o.moving && o.ceding && C.fallback && C.fallback.length) {
      const n = C.fallback.length;
      const t = (o.dist || 0) / (S3_TARGET_H * (o.scale || 1) * 0.72) + (o.gaitOff || 0);
      const q = ((t % 1) + 1) % 1 * n;
      return ['fallback', Math.floor(q) % n, q - Math.floor(q)];
    }
    /* AT EASE. A squad with nothing to shoot at should not be aiming at
     * nothing. `rest` is the donor's plain Idle with the weapon brought down to
     * a carry, and it is what makes a quiet lane look like men waiting rather
     * than men frozen mid-engagement. */
    if (!o.moving && !o.combat && !o.pose && C.rest && C.rest.length) {
      const n = C.rest.length;
      const t = (o.time || 0) * 0.42 + (o.gaitOff || 0);
      const q = ((t % 1) + 1) % 1 * n;
      return ['rest', Math.floor(q) % n, q - Math.floor(q)];
    }
    if (o.moving) {
      // Foot-skate is the main thing that reads as "janky", so the gait cycle is
      // sized to the ground actually covered rather than to a fixed rate. Units
      // cross the lane slowly relative to their own height, so a walk is the
      // honest cycle for a normal advance; only genuinely quick movement runs.
      /* Hysteresis on the gait threshold. A bare `spd > S3_WALK_SPD` chattered
       * for anyone advancing at close to that speed — which is most of a squad
       * most of the time — giving `walk>run run>walk` over and over. Break into
       * a run a little above the line and drop back to a walk a little below
       * it, so a man hovering on the boundary keeps whichever gait he is in. */
      const sp = o.spd || 0;
      const r = o.ref;
      const wasRun = r ? !!r._runV : sp > S3_WALK_SPD;
      const running = wasRun ? sp > S3_WALK_SPD * 0.86 : sp > S3_WALK_SPD * 1.14;
      if (r) r._runV = running;
      const c = running ? pick(o.combat ? 'runfire' : 'run', 'run', 'walk')
        : pick('walk', 'run');
      const n = C[c].length;
      const h = S3_TARGET_H * (o.scale || 1);
      // each man carries his own stride length and where in the cycle he starts,
      // so a squad moving together never lands its feet on the same beat
      /* STRIDE SCALES WITH THE UNIT'S SPEED, so cadence stays even.
       *
       * The frame index comes off distance travelled, so with a FIXED cycle
       * length animation fps is directly proportional to how fast a unit moves:
       * a sapper at 56 px/s played 25.9 walk fps and a sniper at 30 played 13.9.
       * The sniper animated 1.87x choppier than the sapper, and the slowest
       * units — the ones you watch creeping into position — were the worst.
       *
       * That is also backwards from how walking works. People change speed
       * mostly by changing STRIDE LENGTH; cadence stays in a narrow band. A slow
       * man takes short steps, he does not take the same long stride in slow
       * motion. Scaling the cycle with speed is therefore both the fix and the
       * more honest gait: fps = spd*n / (h*C*spd/REF) cancels to n*REF/(h*C),
       * the same for every unit.
       *
       * Off the unit's BASE speed from UNITS, never the instantaneous `spd` —
       * `dist/cycle` would jump the moment the cycle changed, popping the frame
       * index every time a man accelerated out of cover.
       *
       * Result: 19.3-20.7 fps across all twelve, against 13.9-25.9 before. */
      /* The phase is accumulated in the SIM, off the man's CURRENT speed — see
       * the gait-phase block in game.js _moveUnit. It used to be computed here
       * as `dist / cycle` with the cycle scaled by BASE speed, which disagreed
       * with the speed `dist` was actually accruing at and gave walk cadences
       * from 7.3 to 12.7 fps depending on the unit, against 31 running.
       *
       * Falls back to the old calculation for anything drawn without a unit
       * behind it — the menu figures and the contact sheets. */
      const ph = running ? o.phRun : o.phWalk;
      let f;
      if (ph != null) {
        f = (ph + (o.gaitOff || 0)) % 1;
      } else {
        const cycle = h * (running ? S3_RUN_CYCLE : S3_WALK_CYCLE) * (o.gaitK || 1);
        f = ((o.dist || 0) / cycle + (o.gaitOff || 0)) % 1;
      }
      return [c, Math.floor((f < 0 ? f + 1 : f) * n) % n];
    }
    if (o.combat) {
      // the shot itself is a short one-shot; between shots the soldier holds aim
      const rec = o.muzzleT || 0;
      const cf = pick('fire');
      if (rec > 0 && cf) {
        const p = 1 - Math.min(1, rec / 0.12);
        return [cf, Math.min(C[cf].length - 1, Math.floor(p * C[cf].length))];
      }
      // Between bursts the man works his weapon rather than holding a rigid aim.
      // game.js already flags this; the art never used it. Blending carries the
      // rifle down and back up, which is the beat a firefight was missing.
      const c = (o.reload ? pick('idle', 'aim') : pick('aim', 'idle'));
      const n = C[c].length;
      const t = (o.time || 0) * 1.4 + (o.gaitOff || 0);
      const q = ((t % 1) + 1) % 1 * n;
      return [c, Math.floor(q) % n, q - Math.floor(q)];
    }
    /* Two at-rest poses, and men DRIFT between them rather than being assigned
     * one for life.
     *
     * The split was a fixed `gaitOff < 0.45`, so a given man played the same
     * idle from spawn to death: a squad holding a position showed two poses,
     * frozen in whatever proportion the spawn rolls happened to give. Men
     * standing about shift their weight, and a line of troops is exactly where
     * identical animation is most obvious.
     *
     * The oscillator is slow (a ~19s period, prime-ish against the clip lengths)
     * and offset per man, so switches are rare, unsynchronised, and land inside
     * the existing `holdT` guard rather than thrashing the clip machine. */
    const drift = Math.sin((o.time || 0) * 0.33 + (o.gaitOff || 0) * 6.283) * 0.5 + 0.5;
    const c = (((o.gaitOff || 0) * 0.65 + drift * 0.35) < 0.45
      ? pick('idle', 'idle2') : pick('idle2', 'idle'));
    const n = C[c].length;
    // a per-soldier offset so a squad never breathes in lockstep
    const t = (o.time || 0) * 0.9 + (o.gaitOff || 0);
    const q = ((t % 1) + 1) % 1 * n;
    return [c, Math.floor(q) % n, q - Math.floor(q)];
  },

  /* Clips smooth enough to blend BETWEEN their own frames.
   *
   * The rule elsewhere in this file is that stepping frame to frame inside a
   * cycle is the animation working, and cross-fading those reads as
   * double-exposure rather than motion. That is true of a run, where a limb
   * travels a long way between frames. It is not true here.
   *
   * These three are six-frame breathing loops and they are SLOW: `aim` advances
   * at 8.4 animation fps and the two idles at 5.4, which is visibly stepped —
   * and together they are 18.4% of every man-frame on screen, all of it on men
   * standing still, where there is no movement to hide it. Between adjacent
   * frames a chest moves two or three pixels, so blending them reads as
   * breathing rather than as a second exposure.
   *
   * Deliberately NOT run, runfire, walk, death, dive or throw. */
  SMOOTH: { idle: 1, idle2: 1, aim: 1 },

  /* ---------------- drawing ---------------- */

  /* Per-soldier animation state, kept on the unit itself. Only clip CHANGES
   * blend — stepping frame to frame inside a cycle is the animation working, and
   * cross-fading those would read as double-exposure rather than motion. */
  _anim(o, clip, fi) {
    const u = o.ref;
    if (!u) return { clip, fi, prev: null, t: 1 };
    let st = u._s3;
    if (!st) {
      st = u._s3 = { clip, fi, prev: null, prevFi: 0, t: 1, dirV: o.dir || 1 };
      return st;
    }
    // pivot rather than teleport when he reverses
    const want = o.dir || 1;
    if (st.dirV !== want) {
      const step = ((Renderer._fdt || 0.016) / S3_TURN) * 2;
      st.dirV += Math.sign(want - st.dirV) * step;
      if (Math.abs(st.dirV - want) < step) st.dirV = want;
    }
    /* MINIMUM DWELL. Every input that picks a clip is a hard threshold with no
     * hysteresis — `moving` on/off, `spd > S3_WALK_SPD` for run-vs-walk, combat
     * for runfire, pose for prone — and in a firefight all of them sit right on
     * their boundary and chatter. Measured, that produced sequences like
     * `run>walk walk>idle2 idle2>walk walk>run` and clip changes 60-80 times a
     * minute on the worst men. A cross-fade of 0.18s cannot resolve a change
     * every 0.7s, so the blend never lands and the man looks like he is
     * vibrating between poses. That is the "jank".
     *
     * Debouncing each input separately was whack-a-mole — fixing `moving` just
     * moved the chatter onto the speed threshold. One dwell here covers all of
     * them at once, because this is the single point they all funnel through.
     *
     * Clips that MUST interrupt still do: getting shot, hitting the dirt,
     * throwing, and dying are all events the player must see on the frame they
     * happen. Everything else waits its turn. */
    const URGENT = st._urgent || (st._urgent = {
      death: 1, hit: 1, hit2: 1, dive: 1, throw: 1, melee: 1,
    });
    st.holdT = Math.max(0, (st.holdT || 0) - (Renderer._fdt || 0.016));
    const maySwitch = st.holdT <= 0 || URGENT[clip] || URGENT[st.clip];
    if (clip !== st.clip && maySwitch) {
      st.prev = st.clip;
      st.prevFi = st.fi;
      st.t = 0;
      st.clip = clip;
      st.holdT = S3_CLIP_HOLD;
    }
    // while holding, keep advancing the clip we are actually showing rather than
    // freezing on a stale frame index from the clip we declined to switch to
    if (clip !== st.clip) return st;
    st.fi = fi;
    if (st.t < 1) st.t = Math.min(1, st.t + (Renderer._fdt || 0.016) / S3_BLEND);
    return st;
  },

  _blit(ctx, U, clip, fi, o, alpha, dirV, swayY) {
    const M = U.meta;
    const frames = M.clips[clip];
    if (!frames || !frames.length) return;
    const idx = frames[Math.min(frames.length - 1, Math.max(0, fi))];
    /* Cells are no longer square. The figure occupied about three quarters of a
     * 128x128 cell — a quarter of every one was empty air above the head and
     * below the boots, and the browser held all of it across twelve atlases.
     * The packer now trims a fixed band (see tools/pack_sprites3d.py) and the
     * same band came off `groundY` and the muzzle points, so nothing here needs
     * to know the offset; it only needs to stop assuming width == height.
     * `cell` is still written as the WIDTH, so an atlas packed before this
     * change degrades to a stretched sprite rather than throwing. */
    const cw = M.cellW || M.cell;
    const ch = M.cellH || M.cell;
    const sx = (idx % M.cols) * cw;
    const sy = ((idx / M.cols) | 0) * ch;
    // scale so the model's reference height lands on S3_TARGET_H
    const s = ((o.scale || 1) * S3_TARGET_H) / M.figH;
    ctx.save();
    ctx.globalAlpha = alpha;
    /* PER-MAN COLOUR. Five men in a squad were five identical blits.
     *
     * `gaitK` already varies each man's animation SPEED and `gaitOff` his clip
     * PHASE, so a squad has never marched in lockstep — but every man was the
     * same pixels in the same colours, and at squad size that reads as one
     * soldier stamped five times. Uniforms fade differently, men tan
     * differently, and kit is issued at different times.
     *
     * Keyed off `gaitOff`, which is a per-man `Math.random()` fixed at spawn, so
     * a man's colour never changes frame to frame. Kept narrow deliberately:
     * this has to break up a rank without breaking the side's identity, and the
     * player reads US from VC by colour before anything else. */
    /* Per-man colour, and a CONTRAST lift that is not per-man.
     *
     * Measured against the terrain they stand on, soldiers separated by 12
     * luminance points out of 255 — US bodies 99.3 against ground 102.5, VC
     * 72.9 against 62.3. Both sides were the same value as their dirt, which is
     * why a frame full of infantry read as an empty field.
     *
     * `contrast` is the right operator rather than `brightness`, because the
     * two sides fail in opposite directions: on Cu Chi the US sit 3 points below
     * their ground and the VC 25 points ABOVE theirs, so darkening everyone
     * would fix one side and bury the other. Contrast pushes each man away from
     * mid-grey in whichever direction he already leans, and deepens the figure's
     * own internal shading as a bonus.
     *
     * Calibrated by drawing one atlas frame over a flat patch at the measured
     * ground luminance of 103 and reading back the median body value — the only
     * way to get a controlled number, since two live matches never contain the
     * same men in the same places:
     *
     *     none                            sep 16   internal range 40
     *     contrast(1.28) brightness(.96)  sep 26                  44
     *     contrast(1.45) brightness(.90)  sep 32                  51   <- here
     *     contrast(1.70) brightness(.82)  sep 41                  58
     *
     * Stopped at 1.45 rather than 1.70 because the harder settings start
     * crushing the VC, who are already lighter than the jungle floor they fight
     * on and do not need to be pushed down toward it. */
    const v = o.gaitOff;
    if (v != null) {
      ctx.filter = 'contrast(1.45) brightness(' + (0.84 + v * 0.12).toFixed(3) + ') ' +
        'hue-rotate(' + ((v - 0.5) * 10).toFixed(1) + 'deg)';
    } else {
      ctx.filter = 'contrast(1.45) brightness(0.90)';
    }
    // o.y is the hip line the rig drew from; the ground sits S3_FOOT below it
    ctx.translate(o.x, o.y + (swayY || 0) + S3_TARGET_H * (o.scale || 1) * S3_FOOT);
    const dv = dirV == null ? (o.dir || 1) : dirV;
    ctx.scale(Math.abs(dv) < S3_TURN_MIN ? (dv < 0 ? -S3_TURN_MIN : S3_TURN_MIN) : dv, 1);
    /* The third death axis: nobody lands square. Rotated about the FEET, which
     * is where the translate already put the origin, so the body pivots on the
     * ground instead of sliding off it. Eased in over the fall so a man who has
     * just been hit is still upright, and it is tiny — 9 degrees at the limit,
     * enough that five bodies read as five, not as five copies. */
    if (o.deadT != null && o.dieLean) {
      const k = Math.min(1, Math.max(0, (o.deadT - (o.dieLag || 0))) / (0.75 * (o.dieK || 1)));
      ctx.rotate(o.dieLean * k * k);
    }
    // the cell's x centre is the model's centreline; groundY is its ground plane
    ctx.drawImage(U.img, sx, sy, cw, ch,
      -cw * s / 2, -M.groundY * s, cw * s, ch * s);
    ctx.restore();
  },

  draw(ctx, key, o) {
    const U = this.units[key];
    if (!U) return false;
    let alpha = o.alpha != null ? o.alpha : 1;
    if (o.deadT != null) {
      alpha *= Math.max(0, 1 - Math.max(0, o.deadT - (o.wounded ? 2.4 : 1.5)) / 0.5);
    }
    if (alpha <= 0) return true;

    const [clip, fi, frac] = this._sel(key, o);
    const st = this._anim(o, clip, fi);
    const dirV = st.dirV != null ? st.dirV : (o.dir || 1);
    // a man holding a sight picture is never perfectly still
    /* BREATHING, keyed off the POSE rather than the clip name.
     *
     * This tested `clip === 'aim' || clip === 'prone'`, which stopped being
     * true the moment kneeling and prone became frames of `dive`. Measured, a
     * kneeling or prone man then held ONE frame for 180 consecutive ticks with
     * zero sway: a statue, in the two postures a man spends longest holding
     * and where there is no locomotion to disguise it.
     *
     * Those two also get a slower, deeper breath than a standing man. A rifle
     * on a bipod or braced on a knee visibly rises and falls; a man on his feet
     * absorbs it. */
    const held = o.pose === 'prone' || o.pose === 'kneel';
    const sway = held
      ? Math.sin((o.time || 0) * 1.35 + (o.gaitOff || 0) * 6.3) * 1.35 * (o.scale || 1)
      : (clip === 'aim' || clip === 'prone')
        ? Math.sin((o.time || 0) * 2.1 + (o.gaitOff || 0) * 6.3) * 0.9 * (o.scale || 1)
        : 0;
    if (st.t < 1 && st.prev && U.meta.clips[st.prev]) {
      // outgoing pose stays at FULL alpha underneath and the incoming one fades
      // in over it, so total coverage never dips and the man cannot go see-through
      // halfway through a transition
      this._blit(ctx, U, st.prev, st.prevFi, o, alpha, dirV, sway);
      this._blit(ctx, U, clip, fi, o, alpha * st.t, dirV, sway);
    } else {
      this._blit(ctx, U, clip, fi, o, alpha, dirV, sway);
      // sub-frame blend, only for the slow low-motion loops — see SMOOTH
      if (frac > 0.02 && this.SMOOTH[clip]) {
        const n = U.meta.clips[clip].length;
        this._blit(ctx, U, clip, (fi + 1) % n, o, alpha * frac, dirV, sway);
      }
    }
    return true;
  },

  drawCorpse(ctx, key, o) {
    /* deadT 0.8 used to land on the last frame because the fall was always
     * 0.75s. It is per-man now, so a slow faller (dieK up to 1.34) would bake
     * his corpse 80% of the way down — a body frozen mid-collapse. Forcing
     * dieK/dieLag to the reference values puts p past 1 for every man, and the
     * clamp in _sel does the rest. `dieLean` is passed THROUGH, so the corpse
     * keeps the angle the man was settling into and the bake does not pop. */
    return this.draw(ctx, key, Object.assign({}, o, {
      deadT: 0.8, dieK: 1, dieLag: 0, alpha: 0.92, moving: false, combat: false,
    }));
  },

  /* World-space barrel tip. Blender tracked an empty on the muzzle through every
   * frame, so this is the actual gun rather than a guess from the body. It must
   * use the same clip and frame the draw picked, or flashes lag the animation. */
  muzzle(key, o) {
    const U = this.units[key];
    const sc = o.scale || 1;
    if (!U) return { x: o.x + (o.dir || 1) * 20 * sc, y: o.y - 26 * sc };
    const M = U.meta;
    const [clip, fi] = this._sel(key, o);
    const p = M.muzzle && M.muzzle[clip] && M.muzzle[clip][fi];
    if (!p) return { x: o.x + (o.dir || 1) * 24 * sc, y: o.y - 27 * sc };
    const s = (sc * S3_TARGET_H) / M.figH;
    return {
      x: o.x + (o.dir || 1) * (p[0] - (M.cellW || M.cell) / 2) * s,
      y: o.y + S3_TARGET_H * sc * S3_FOOT + (p[1] - M.groundY) * s,
    };
  },
};
