'use strict';

/* ============================== Camera ==============================
   The world is WORLD_W wide; the canvas shows a CANVAS_W window onto it.
   Mouse-edge scroll / arrow keys / minimap clicks move targetX. */
const Camera = {
  x: 0, targetX: 0,
  reset(px) { this.x = this.targetX = clamp(px, 0, WORLD_W - CANVAS_W); },
  pan(dx) { this.targetX = clamp(this.targetX + dx, 0, WORLD_W - CANVAS_W); },
  center(wx) { this.targetX = clamp(wx - CANVAS_W / 2, 0, WORLD_W - CANVAS_W); },
  update(dt) {
    this.x += (this.targetX - this.x) * Math.min(1, dt * 9);
    if (Math.abs(this.targetX - this.x) < 0.4) this.x = this.targetX;
  },
  sees(wx, margin = 90) { return wx > this.x - margin && wx < this.x + CANVAS_W + margin; },
};

/* ============================== Soldiers ============================== */
const SOLDIER_COLORS = {
  rifleman: { coat: '#4d5a3c', pants: '#414c34', hat: '#3d4830', skin: '#c9a37d' },
  arvn:     { coat: '#5d6a49', pants: '#4d583c', hat: '#48533a', skin: '#c19a70' },
  m60:      { coat: '#4d5a3c', pants: '#414c34', hat: '#3d4830', skin: '#b28963' },
  engineer: { coat: '#55604a', pants: '#414c34', hat: '#3d4830', skin: '#c9a37d' },
  recon:    { coat: '#42503a', pants: '#3a4530', hat: '#46523c', skin: '#b28963' },
  sniper:   { coat: '#46523a', pants: '#3d4830', hat: '#4a5538', skin: '#c9a37d' },
  guerrilla:{ coat: '#38362f', pants: '#302e28', hat: '#c2a36a', skin: '#c19a70' },
  nva:      { coat: '#6f6748', pants: '#5f583e', hat: '#655e3e', skin: '#c19a70' },
  /* rpgman was MISSING, and so was m113. On desktop that never showed, because
   * every atlas is resident before a man is drawn and this vector path is
   * unreachable. Lazy loading makes it reachable — the fallback runs for the
   * frames before an atlas lands — and the first RPG team crashed the renderer
   * on `C.pants`. Latent in the desktop build too. */
  rpgman:   { coat: '#6f6748', pants: '#5f583e', hat: '#655e3e', skin: '#b28963' },
  rpd:      { coat: '#6f6748', pants: '#5f583e', hat: '#655e3e', skin: '#b28963' },
  sapper:   { coat: '#38362f', pants: '#302e28', hat: '#8a2f22', skin: '#c19a70' },
  marksman: { coat: '#45423a', pants: '#38362e', hat: '#b5975e', skin: '#c19a70' },
};

const WALK_CYCLE = ['walk1', 'walk2', 'walk3', 'walk2'];

const SPRITE_STAND_H = 56; // on-screen height of a standing soldier at depth 1

/* fixed-anchor run cycles — one shared anchor per anim, zero playback jitter.
   Every family runs as its OWN painted character (per-class sheet). */
const RUN_ANIMS = {
  us_rifle: 'us_run', arvn: 'us_run', us_m60: 'm60_runB',
  us_sniper: 'sniper_run',
  vc_rifle: 'vc_run', vc_gunner: 'nva_runB', vc_black: 'vc_run',
};
const RUN_FPS = 55;      // cycle playback: phase advances ~11/s at full speed
const RUN_SCALE = 1.0;   // benchmark run sheets share the idle sets' proportions — no trim,
                         // so run↔idle transitions keep an identical silhouette size
const POSE_FADE = 0.09;  // seconds to crossfade between pose changes

/* curated cells from the texture sheets (corrupted/header cells never referenced) */
const TEX = {
  mtn: ['t1_57', 't1_58', 't1_59'],
  /* GONE, with their slices dropped from assets/manifest.js too:
   *   tuft / fern / bush / plant / palm / banana -> the prop set, via drawVeg()
   *   treeline / villageSil                      -> _treeBand / _villageBand
   *   paddy                                      -> _paddyStrip
   *
   * The paddy slices are worth a note: they were ISOMETRIC tiles, drawn looking
   * down at the field from an angle, in a game whose every other element is a
   * strict side view. They survived this long only because they were squashed
   * to 55% and drawn at half alpha, which hid the projection without fixing it.
   *
   * `mtn` stays. It is the one piece of the old set that still earns its place:
   * a distant ridge silhouette, now pushed back into the sky colour, where the
   * line work does not read at all.
   */
  dike: ['t1_02', 't1_04', 't1_05'],
  stonewall: ['t1_07', 't1_08', 't1_09'],
  sandbags: ['t2_08'],
  hooch: ['t2_18', 't2_22', 't2_23', 't2_24'],
  house: ['t2_12', 't2_14', 't2_15'],
  stiltH: ['t2_25', 't2_26', 't2_27'],
  well: ['t2_34'],
  cart: ['t2_38'],
  shrine: ['t2_33'],
  stall: ['t2_36'],
  watchtower: ['t2_01'],
  gate: ['t2_07'],
};

/* Ground vegetation, drawn from the 3D prop set instead of the inked sheets.
 *
 * All of this used to come off `TEX`, which is hand-drawn line art: black
 * outlines, cross-hatching, illustrated botanical detail. Standing next to
 * flat-shaded props off the same orthographic camera as the soldiers, that is
 * two drawing systems in one frame, and it is what "some of it looks ass" was
 * pointing at. A hand-inked fern beside a flat-shaded palm cannot be reconciled
 * by tuning; they are drawn by different rules.
 *
 * Props are authored by REAL HEIGHT, not width, so this takes a height and lets
 * the aspect follow — that is the whole point of the prop pipeline, and sizing
 * them by the old art's widths would throw it away.
 *
 * Returns false if the set has not loaded, so callers keep their fallback. That
 * is belt-and-braces: Props.load re-runs buildStatic, which marks every lane
 * dirty, so a lane baked before the props arrive is always baked again after.
 */
const VEG = {
  tuft:   ['tuft_a'],
  fern:   ['fern_a'],
  bush:   ['bush_low'],
  plant:  ['vine_a'],
  grass:  ['grass_a'],
  palm:   ['palm_a', 'palm_b', 'palm_c', 'palm_d'],
  banana: ['banana_a'],
  canopy: ['canopy_a'],
  scrub:  ['scrub_a'],
};

function drawVeg(ctx, kind, i, x, gy, h, opts = {}) {
  const list = VEG[kind];
  if (!list || typeof Props === 'undefined' || !Props.ready) return false;
  const name = list[((i % list.length) + list.length) % list.length];
  if (!Props.has(name) || !(h > 0)) return false;
  return Props.draw(ctx, name, x, gy, 1, Object.assign({}, opts, { fit: h }));
}

/* Natural on-screen height for a vegetation kind, before any variation. */
function vegH(kind, scale) {
  const list = VEG[kind];
  return list && typeof Props !== 'undefined' ? Props.pxHeight(list[0], scale) : 0;
}

function tex(kind, i) {
  if (typeof Assets === 'undefined' || !Assets.done) return null;
  const list = TEX[kind];
  if (!list) return null;
  return Assets.img(list[((i % list.length) + list.length) % list.length]);
}

/* bottom-center anchored texture draw */
/* Pre-scaled copies of a texture, bucketed by drawn width.
 *
 * drawTex sampled the FULL source every call — a 512px plant drawn at 90px
 * still made the driver read 512x512. Props solved this long ago with the same
 * trick; the texture path never got it. It showed up the moment the foreground
 * band got denser: source sampling jumped 10.3 -> 15.7 Mpx against a cap of 13,
 * and almost all of it was re-sampling the same handful of plants.
 *
 * Bucketed to 8px so a hundred slightly different widths do not each mint their
 * own canvas, and capped per texture so the cache cannot become its own leak.
 */
const _TEX_SCALED = new Map();
function texScaled(img, w) {
  const b = Math.max(8, Math.round(w / 8) * 8);
  if (b >= img.width) return img;          // never upscale — that costs more, not less
  let per = _TEX_SCALED.get(img);
  if (!per) { per = new Map(); _TEX_SCALED.set(img, per); }
  let c = per.get(b);
  if (!c) {
    const h = Math.max(1, Math.round(img.height * (b / img.width)));
    c = document.createElement('canvas');
    c.width = b; c.height = h;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, b, h);
    per.set(b, c);
    if (per.size > 12) per.delete(per.keys().next().value);
  }
  return c;
}

function drawTex(ctx, kind, i, x, gy, w, opts = {}) {
  const src = tex(kind, i);
  if (!src) return false;
  const img = texScaled(src, w);
  const h = img.height * (w / img.width);
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
  if (opts.flip) {
    ctx.translate(x, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, gy - h + (opts.sink || 0), w, h);
  } else {
    ctx.drawImage(img, x - w / 2, gy - h + (opts.sink || 0), w, h);
  }
  ctx.restore();
  return true;
}
/* per-sheet body-size trim: some generations run bulkier at equal stand height */
const SHEET_TRIM = { us_sniper: 0.93, vc_sniper: 0.95 };
function spriteScaleFor(key, sheet, scale) {
  const u = UNITS[key];
  const sk = UNIT_SPRITES[key];
  return (SPRITE_STAND_H / sheet.standH) * (scale || 1) *
    (u && u.small ? 0.92 : 1) * (SHEET_TRIM[sk] || 1);
}

const NADE_ANIMS = {
  us_rifle: 'us_nade', arvn: 'us_nade', us_m60: 'us_nade', us_sniper: 'us_nade',
  vc_rifle: 'vc_nade', vc_gunner: 'vc_nade', vc_black: 'vc_nade', vc_sniper: 'vc_nade',
};
/* Anim sets are only shared where the painted CHARACTER matches the sheet —
   a khaki ARVN must never flash into a helmeted US rifleman between poses.
   Families without a matching set keep their own sheet frames. */
const IDLE_ANIMS = { us_rifle: 'us_idle', vc_rifle: 'vc_idle', vc_black: 'vc_idle' };
const FIRE_ANIMS = {
  us_rifle: 'us_fire_m16', us_m60: 'us_fire_m60',
  vc_rifle: 'vc_fire_ak', vc_black: 'vc_fire_ak',
};
const DEATH_ANIMS = {
  us_rifle: 'us_death', us_m60: 'us_death',
  vc_rifle: 'vc_death', vc_black: 'vc_death',
};
const TRANS_ANIMS = {
  us_rifle: 'us_toprone', us_m60: 'us_toprone',
  vc_rifle: 'vc_toprone', vc_black: 'vc_toprone',
};
/* body-mass normalization: crouched fire frames read bulkier at equal height */
const ANIM_TRIM = {
  us_fire_m16: 0.94, vc_fire_ak: 0.94, us_fire_m60: 0.96, us_fire_prone: 1,
  us_idle: 1, vc_idle: 1, us_death: 0.97, vc_death: 0.97,
  us_toprone: 0.96, vc_toprone: 0.96,
};

/* unit-level run overrides (engineer runs with his pack even on the rifle sheet) */
const RUN_ANIMS_UNIT = { engineer: 'eng_run', recon: 'sniper_run' };

/* resolve [poseId, frameName, animName] for a soldier's current state */
function resolvePose(sk, sheet, o, key) {
  if (o.deadT != null) {
    // full painted death sequence when the sheet family has one
    const dAnim = !o.wounded && DEATH_ANIMS[sk];
    const dSeq = dAnim && Assets.anim(dAnim);
    if (dSeq && dSeq.length) {
      const idx = Math.min(dSeq.length - 1, Math.floor(o.deadT / 0.9 * dSeq.length));
      return ['death', dSeq[idx], dAnim];
    }
    if (o.deadT < 0.2) return ['hit', sheet.poses.hit, null];
    if (o.deadT < 0.6 && !o.wounded) return ['fall', sheet.poses.hit, null];
    if (o.wounded && o.deadT < 2.3) return ['prone', sheet.poses.prone, null];
    return ['fallen', sheet.poses.fallen, null];
  }
  if ((o.nadeT || 0) > 0 && NADE_ANIMS[sk]) {
    const seq = Assets.anim(NADE_ANIMS[sk]);
    if (seq && seq.length) {
      const p = clamp(1 - o.nadeT / (o.nadeDur || 0.9), 0, 0.999);
      return ['nade', seq[Math.floor(p * seq.length)], NADE_ANIMS[sk]];
    }
  }
  // stand↔prone transition frames
  if ((o.transT || 0) > 0 && TRANS_ANIMS[sk]) {
    const seq = Assets.anim(TRANS_ANIMS[sk]);
    if (seq && seq.length) {
      const p = clamp(1 - o.transT / STANCE_TRANS, 0, 0.999);
      const idx = Math.floor((o.transDir > 0 ? p : 1 - p) * seq.length);
      return ['trans', seq[clamp(idx, 0, seq.length - 1)], TRANS_ANIMS[sk]];
    }
  }
  if (o.pose === 'prone') return ['prone', sheet.poses.prone, null];
  if (o.hitT > 0) return ['hit', sheet.poses.hit, null];
  if (o.combat) {
    // recoil loop: aim frame between shots, flash→casing→recover during muzzleT
    const fAnim = FIRE_ANIMS[sk];
    const fSeq = fAnim && Assets.anim(fAnim);
    if (fSeq && fSeq.length >= 4) {
      let idx = 0;
      if ((o.muzzleT || 0) > 0) {
        idx = 1 + Math.min(2, Math.floor((1 - o.muzzleT / 0.07) * 3));
      }
      return ['fire', fSeq[idx], fAnim];
    }
    return ['fire', sheet.poses.fire, null];
  }
  if (o.moving) {
    const runName = RUN_ANIMS_UNIT[key] || RUN_ANIMS[sk];
    const run = runName && Assets.anim(runName);
    if (run && run.length) {
      // frames-per-stride is constant regardless of cycle length
      const idx = Math.floor((o.phase || 0) * 1.3 * (run.length / 12)) % run.length;
      return ['run', run[idx], runName];
    }
    return ['walk', sheet.poses[WALK_CYCLE[Math.floor((o.phase || 0) * 0.8) % 4]], null];
  }
  // living idle loop where the family has one; procedural breathing on top
  const iAnim = IDLE_ANIMS[sk];
  const iSeq = iAnim && Assets.anim(iAnim);
  if (iSeq && iSeq.length) {
    const idx = Math.floor((o.time || 0) * 5 + (o.x || 0) * 0.07) % iSeq.length;
    return ['idle', iSeq[idx], iAnim];
  }
  return ['idle', sheet.poses.idle, null];
}

function drawSpriteFrame(ctx, key, sheet, name, poseId, animName, o, alpha) {
  const img = Assets.img(name), m = Assets.meta(name);
  if (!img || !m) return false;
  let s = spriteScaleFor(key, sheet, o.scale);
  if (animName) {
    const am = Assets.animMeta(animName);
    if (am && am.standH) {
      s = (SPRITE_STAND_H / am.standH) * (o.scale || 1) *
          (poseId === 'run' ? RUN_SCALE : 1) * (ANIM_TRIM[animName] || 1);
    }
  }
  ctx.save();
  ctx.translate(o.x, o.y);
  // death fall: pivot the hit pose down at the feet (fallback path only)
  if (poseId === 'fall') {
    const k = Math.min(1, (o.deadT - 0.2) / 0.4);
    const e = 1 - (1 - k) * (1 - k); // ease-out
    ctx.rotate(-(o.dir || 1) * e * 1.35);
  }
  ctx.scale((o.dir || 1) * s, s);
  // procedural breathing rides on top of the idle loop
  if (poseId === 'idle') {
    const b = Math.sin((o.time || 0) * 2.1 + (o.x || 0) * 0.13);
    ctx.rotate(b * 0.012);
    ctx.scale(1, 1 + b * 0.009);
  }
  if (o.flash && poseId !== 'fire') {
    ctx.translate(-2.5 / s, 0); // recoil kick for families without a fire loop
    ctx.rotate(-0.035);
  }
  if (poseId === 'hit' && o.deadT == null && o.hitT > 0) {
    ctx.translate(rand(-0.8, 0.8) / s, 0); // flinch shudder
  }
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, -m.ax, -m.ay);
  ctx.restore();
  return true;
}

/* sprite path; returns false when art is missing so the vector path can run.
   Pose changes crossfade over POSE_FADE seconds via per-unit anim state (o.ref). */
function drawSoldierSprite(ctx, key, o) {
  if (typeof Assets === 'undefined' || !Assets.done) return false;
  const sk = UNIT_SPRITES[key];
  const sheet = sk && Assets.sheet(sk);
  if (!sheet) return false;

  let [poseId, name, animName] = resolvePose(sk, sheet, o, key);
  if (!name) return false;

  let alpha = o.alpha != null ? o.alpha : 1;
  if (o.deadT != null) {
    const fadeAt = o.wounded ? 2.4 : 0.9;
    alpha *= Math.max(0, 1 - Math.max(0, o.deadT - fadeAt) / 0.55);
  }
  if (alpha <= 0) return true;

  const ref = o.ref;
  if (ref) {
    let as = ref._as;
    if (!as) as = ref._as = { pose: poseId, name, anim: animName, prevName: null, prevPose: null, prevAnim: null, t: 1, holdT: 1 };
    as.holdT = (as.holdT || 0) + (Renderer._fdt || 0.016);
    if (as.pose !== poseId) {
      // min-hold: a pose must live ≥140ms before switching (kills state thrash),
      // except death/hit which interrupt instantly
      const urgent = poseId === 'fall' || poseId === 'fallen' || poseId === 'hit' ||
                     poseId === 'death' || o.deadT != null;
      if (as.holdT >= 0.14 || urgent) {
        as.prevPose = as.pose; as.prevName = as.name; as.prevAnim = as.anim;
        as.t = (poseId === 'fall' || as.pose === 'fall' || poseId === 'death') ? 1 : 0;
        as.pose = poseId;
        as.holdT = 0;
      }
    }
    if (as.pose === poseId) {
      as.name = name;         // same state: frames advance freely (cycles/loops)
      as.anim = animName;
    } else {
      poseId = as.pose;       // held: reuse the EXACT stored pose, frame, and scale basis
      name = as.name;
      animName = as.anim;
    }
    as.t = Math.min(1, as.t + (Renderer._fdt || 0.016) / POSE_FADE);
    if (as.t < 1 && as.prevName) {
      // old pose stays at FULL alpha underneath; new pose fades in on top —
      // total coverage never dips, so no mid-fade ghosting/dimming
      drawSpriteFrame(ctx, key, sheet, as.prevName, as.prevPose, as.prevAnim, o, alpha);
      return drawSpriteFrame(ctx, key, sheet, name, poseId, animName, o, alpha * as.t);
    }
  }
  return drawSpriteFrame(ctx, key, sheet, name, poseId, animName, o, alpha);
}

function drawSoldier(ctx, key, o) {
  /* MOBILE: atlases load on demand, so ask for this unit's the first time it is
   * drawn. `ensure` is a no-op once loaded or in flight, and the draw below
   * falls through to the procedural soldier until it lands. */
  if (typeof Sprite3D !== 'undefined' && Sprite3D.ensure) Sprite3D.ensure(key);
  /* Vehicles ride the prop path, not the soldier path — one static profile
   * sprite off the same camera. They are units in every other respect, so this
   * is the only place the difference shows. */
  const ud = typeof UNITS !== 'undefined' ? UNITS[key] : null;
  if (ud && ud.vehicle && typeof Props !== 'undefined' && Props.ready &&
      Props.has(ud.prop)) {
    const sc = o.scale || 1;
    const gy = o.y + S3_TARGET_H * sc * S3_FOOT;
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
    if (o.deadT != null) {
      // a knocked-out track sits and burns rather than fading away
      ctx.globalAlpha = (o.alpha != null ? o.alpha : 1) * 0.9;
      ctx.filter = 'brightness(0.45)';
    }
    Props.draw(ctx, ud.prop, o.x, gy, sc, { flip: (o.dir || 1) < 0 });
    ctx.filter = 'none';
    ctx.restore();
    return;
  }
  // sheets rendered off a rigged 3D model are the primary path — one model, one
  // camera, so a soldier cannot morph or drift between frames
  if (typeof Sprite3D !== 'undefined' && Sprite3D.enabled && Sprite3D.has(key)) {
    if (Sprite3D.draw(ctx, key, o)) return;
  }
  // skeletal puppet is the fallback (consistent, smooth, morph-proof)
  if (typeof Rig !== 'undefined' && Rig.enabled) { Rig.draw(ctx, key, o); return; }
  if (drawSoldierSprite(ctx, key, o)) return;
  drawSoldierVector(ctx, key, o);
}

/* world-space muzzle location for a unit — the weapon-bone barrel tip */
function muzzlePoint(u) {
  const laneS = LANE_DEPTH[u.lane];
  const scale = laneS * (u.sj || 1);
  const cvm = u.squad && u.squad.inCover ? u.squad.cover : null;
  const lift = cvm
    ? (cvm.type === 'towerpos' ? 30 : (cvm.lift || 0)) * laneS
    : 0;
  if (typeof Sprite3D !== 'undefined' && Sprite3D.enabled && Sprite3D.has(u.key)) {
    // the same state the draw used, so the flash sits on the frame being shown
    return Sprite3D.muzzle(u.key, {
      x: u.x, y: u.y + (u.yj || 0) - lift, dir: u.dir, scale,
      moving: u.movingVis != null ? u.movingVis : u.moving, combat: true, pose: u.pose,
      muzzleT: u.muzzleT || 0, deadT: u.deadT, phase: u.phase,
      dist: u.dist || 0, spd: u.spd || 0,
      gaitOff: u.gaitOff || 0, gaitK: u.gaitK || 1,
      /* transDir AND ref, or the flash is placed off a different frame than the
       * one being drawn. `ref` matters because the walk/run hysteresis keeps its
       * state on the unit (`_runV`): without it this path falls back to a bare
       * `spd > S3_WALK_SPD` test and can choose `walk` while the draw path,
       * which does pass ref, is showing `runfire`. Different clip, different
       * frame, muzzle point tens of pixels off the barrel — worst on the night
       * map, where the muzzle glow is most of the light in the scene. */
      hitT: u.hitT || 0, transT: u.transT || 0, transDir: u.transDir || 1,
      ref: u,
      time: Renderer._time || 0,
    });
  }
  if (typeof Rig !== 'undefined' && Rig.enabled) {
    return Rig.muzzle(u.key, {
      x: u.x, y: u.y - lift, dir: u.dir, scale,
      moving: false, combat: true, pose: u.pose,
      muzzleT: u.muzzleT || 0, deadT: u.deadT, phase: u.phase,
    });
  }
  if (u.pose === 'prone') return { x: u.x + u.dir * 33 * scale, y: u.y - lift - 8 * scale };
  return { x: u.x + u.dir * 21 * scale, y: u.y - lift - 27 * scale };
}

/* original canvas-primitive soldier — the guaranteed fallback */
function drawSoldierVector(ctx, key, o) {
  /* Defaults, so an unlisted unit can never crash the renderer. This path is
   * only reached before a unit's atlas has loaded, which on desktop never
   * happened and on mobile happens for a frame or two every match. */
  const C = SOLDIER_COLORS[key] || SOLDIER_COLORS.rifleman;
  const u = UNITS[key] || {};
  const s = (o.scale || 1) * (u.small ? 0.92 : 1);
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.scale((o.dir || 1) * s, s);
  ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
  ctx.lineCap = 'round';
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };

  if (o.deadT != null) {
    const k = Math.min(1, o.deadT / 0.4);
    ctx.rotate(-1.45 * k);
    ctx.globalAlpha *= Math.max(0, 1 - Math.max(0, o.deadT - 0.6) / 0.8);
  }

  const prone = o.pose === 'prone' && o.deadT == null;
  if (prone) {
    ctx.strokeStyle = C.pants; ctx.lineWidth = 3.4;
    line(-14, -2, -5, -3);
    ctx.strokeStyle = C.coat; ctx.lineWidth = 4.6;
    line(-6, -3, 4, -4.5);
    ctx.fillStyle = C.skin;
    ctx.beginPath(); ctx.arc(6.5, -6.5, 3.2, 0, 7); ctx.fill();
    drawHat(ctx, C, u.hat, 6.5, -6.5, true);
    ctx.strokeStyle = '#26251d'; ctx.lineWidth = 2;
    line(4, -5, 21, -4.2);
    if (u.sniper) { ctx.fillStyle = '#1c1b15'; ctx.fillRect(10, -7.4, 5, 2); }
  } else {
    const ph = o.phase || 0;
    const sw = o.moving ? Math.sin(ph) * 5 : 0;
    ctx.strokeStyle = C.pants; ctx.lineWidth = 3;
    line(0, -13, sw, 0);
    line(0, -13, -sw * 0.9, 0);
    ctx.strokeStyle = C.coat; ctx.lineWidth = 5;
    line(0, -12.5, 0.5, -22);
    if (u.pack) { ctx.fillStyle = '#3a4230'; ctx.fillRect(-5.5, -22, 4, 8); }
    ctx.fillStyle = C.skin;
    ctx.beginPath(); ctx.arc(1, -26.5, 3.6, 0, 7); ctx.fill();
    drawHat(ctx, C, u.hat, 1, -26.5, false);
    if (u.antenna) { ctx.strokeStyle = '#222'; ctx.lineWidth = 1; line(-4, -22, -7, -36); }
    if (u.sapper) { ctx.fillStyle = '#5c4a2e'; ctx.fillRect(2, -16, 6, 5); }
    ctx.strokeStyle = '#26251d';
    if (u.mg) {
      ctx.lineWidth = 2.8;
      line(-3, -19, 14, -18.4);
      ctx.lineWidth = 1.4;
      line(9, -18, 8, -14); line(12, -18, 13, -14);
    } else if (u.sniper) {
      ctx.lineWidth = 2;
      line(-3, -19, 15, -18.6);
      ctx.fillStyle = '#1c1b15'; ctx.fillRect(3, -21.4, 5, 1.8);
    } else if (!u.sapper) {
      ctx.lineWidth = 2.2;
      line(-3, -19, 11.5, -18.5);
    }
    ctx.strokeStyle = C.skin; ctx.lineWidth = 2.2;
    line(1, -20, 7, -18.8);
  }
  ctx.restore();
}

function drawHat(ctx, C, hat, hx, hy, prone) {
  ctx.fillStyle = C.hat;
  switch (hat) {
    case 'm1':
      ctx.beginPath(); ctx.ellipse(hx, hy - 2.2, 4.6, 3.1, 0, Math.PI, 0); ctx.fill();
      ctx.fillRect(hx - 4.6, hy - 2.6, 9.2, 1.4);
      break;
    case 'boonie':
      ctx.beginPath(); ctx.ellipse(hx, hy - 2.6, 3.6, 2.4, 0, Math.PI, 0); ctx.fill();
      ctx.fillRect(hx - 5.6, hy - 2.8, 11.2, 1.2);
      break;
    case 'conical':
      ctx.beginPath();
      ctx.moveTo(hx - 6.4, hy - 2);
      ctx.lineTo(hx, hy - 7.6);
      ctx.lineTo(hx + 6.4, hy - 2);
      ctx.closePath(); ctx.fill();
      break;
    case 'pith':
      ctx.beginPath(); ctx.ellipse(hx, hy - 2, 4.2, 3, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.ellipse(hx, hy - 1.8, 5.4, 1.2, 0, 0, 7); ctx.fill();
      break;
    case 'band':
      ctx.fillRect(hx - 3.6, hy - 3.4, 7.2, 1.8);
      break;
  }
}

/* ---------- vehicle silhouettes ---------- */
/* A UH-1, the most recognisable object of this war.
 *
 * This was an ellipse, a four-point tail, one stroked line for the rotor and two
 * for the skids — a flat dark blob, at a time when every soldier and every tree
 * in the frame had been rebuilt as lit geometry. The airframe is now a rendered
 * prop (`huey`, see tools/render_props.py) and only the parts that MOVE are
 * still drawn here.
 *
 * That split is the point: a rotor is a blur, not a shape, so baking it into
 * the prop would freeze it. The prop is the machine; the code is the motion. */
function drawHuey(ctx, x, y, t, opts = {}) {
  ctx.save();
  ctx.translate(x, y);
  const dir = opts.dir != null ? opts.dir : 1;
  const sc = opts.scale != null ? opts.scale : 1;
  const usable = typeof Props !== 'undefined' && Props.ready && Props.has('huey');
  if (usable) {
    // the prop is built nose-RIGHT; dir=+1 means flying right, so no mirror
    ctx.save();
    if (dir < 0) ctx.scale(-1, 1);
    const H = 30 * sc;
    // noShadow — it is FLYING. Props.draw grounds a contact shadow under
    // everything by default, which stuck an ellipse of dirt to an airborne
    // aircraft and followed it across the sky.
    Props.draw(ctx, 'huey', 0, H * 0.52, 1, { fit: H, noShadow: true });
    // rotor disc: swept from the MAST, which sits above and slightly aft of the
    // cabin, not from the centre of the sprite
    const mx = -H * 0.06, my = -H * 0.62;
    const spin = Math.cos(t * 42), rl = 46 * sc;
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = 'rgba(24,28,20,0.9)'; ctx.lineWidth = 2.2 * sc;
    ctx.beginPath();
    ctx.moveTo(mx - rl * spin, my); ctx.lineTo(mx + rl * spin, my); ctx.stroke();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = 'rgba(226,232,220,0.9)'; ctx.lineWidth = 1.0 * sc;
    ctx.beginPath();
    ctx.moveTo(mx - rl * spin, my - 1.4 * sc); ctx.lineTo(mx + rl * spin, my - 1.4 * sc);
    ctx.stroke();
    // tail rotor, faster and edge-on
    const ts = Math.cos(t * 66);
    ctx.globalAlpha = 0.34; ctx.lineWidth = 1.3 * sc;
    ctx.strokeStyle = 'rgba(24,28,20,0.9)';
    const tx = -H * 1.34, ty = -H * 0.34;
    ctx.beginPath();
    ctx.moveTo(tx, ty - 6.5 * sc * ts); ctx.lineTo(tx, ty + 6.5 * sc * ts); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
    if (opts.medevac) {
      // a red cross on the CABIN DOOR — mid-body, not on the nose
      ctx.save();
      if (dir < 0) ctx.scale(-1, 1);
      const cx0 = -H * 0.20, cy0 = -H * 0.34, w = H * 0.26;
      ctx.fillStyle = '#cfcfc4';
      ctx.fillRect(cx0, cy0, w, w);
      ctx.fillStyle = '#a2291d';
      ctx.fillRect(cx0 + w * 0.36, cy0 + w * 0.10, w * 0.28, w * 0.80);
      ctx.fillRect(cx0 + w * 0.12, cy0 + w * 0.36, w * 0.76, w * 0.28);
      ctx.restore();
    }
    ctx.restore();
    return;
  }
  // vector fallback, kept so the game still draws before props load
  if (dir > 0) ctx.scale(-1, 1);
  if (opts.flip) ctx.scale(-1, 1);
  const c = opts.color || '#2c3324';
  ctx.fillStyle = c;
  ctx.beginPath(); ctx.ellipse(0, 0, 20, 7.5, 0, 0, 7); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(14, -2); ctx.lineTo(40, -5); ctx.lineTo(40, -1); ctx.lineTo(16, 3); ctx.closePath(); ctx.fill();
  ctx.fillRect(37, -10, 3, 7);
  ctx.strokeStyle = c; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-10, 9); ctx.lineTo(-12, 13); ctx.moveTo(8, 9); ctx.lineTo(10, 13); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-14, 13); ctx.lineTo(14, 13); ctx.stroke();
  const spin = Math.cos(t * 42);
  ctx.strokeStyle = 'rgba(30,34,26,0.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-34 * spin, -10); ctx.lineTo(34 * spin, -10); ctx.stroke();
  ctx.fillStyle = c; ctx.fillRect(-2, -11, 4, 5);
  ctx.restore();
}

function drawJet(ctx, x, y, dir) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  ctx.fillStyle = '#2a2f26';
  ctx.beginPath();
  ctx.moveTo(26, 0); ctx.lineTo(-4, -4); ctx.lineTo(-20, -2); ctx.lineTo(-24, -8); ctx.lineTo(-27, -8);
  ctx.lineTo(-24, 0); ctx.lineTo(-14, 3); ctx.lineTo(8, 4); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(2, -1); ctx.lineTo(-12, -12); ctx.lineTo(-16, -11); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawB52(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(38,42,36,0.9)';
  ctx.beginPath(); ctx.ellipse(0, 0, 26, 3.4, 0, 0, 7); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(6, -1); ctx.lineTo(-34, -9); ctx.lineTo(-36, -7); ctx.lineTo(-2, 2); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(6, -1); ctx.lineTo(46, -9); ctx.lineTo(44, -6); ctx.lineTo(8, 2); ctx.closePath(); ctx.fill();
  ctx.fillRect(-26, -8, 3, 8);
  ctx.restore();
}

/* ============================== Renderer ============================== */
const Renderer = {
  canvas: null, ctx: null,
  sky: null, farLayer: null, midLayer: null,
  laneLayers: [null, null, null], decalLayers: [null, null, null],
  /* MOBILE: the decal layers are cropped to the ground band, so each one has a
   * y offset. Every bake into them and the blit out of them subtracts it. */
  decalTop: [0, 0, 0],
  dirty: [true, true, true],   // sized on init from LANE_N; see Renderer.init
  corpseCount: [0, 0, 0],
  clouds: [], menuLayer: null,
  minimapCanvas: null,

  FAR_PARA: 0.25, MID_PARA: 0.5,

  init(canvas) {
    // one dirty flag per LIVE lane — a hardcoded three left a stale entry
    this.dirty = LANES.map(() => true);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fitDPR();
    if (window.ResizeObserver) new ResizeObserver(() => this.fitDPR()).observe(canvas);
    window.addEventListener('resize', () => this.fitDPR());
  },

  /* Size the backing store to the real device pixels. Without this the canvas
     is a 1280x720 image stretched over a high-DPI panel — which is exactly
     what reads as "pixelated" on a Mac or a phone. */
  /* Frame-time readout, toggled with F. Frame rate had to be argued about from
   * screenshots because there was no number anywhere; this makes it a fact. */
  showPerf: false,
  _perfSample(time) {
    const dt = time - (this._perfLast || time);
    this._perfLast = time;
    if (dt <= 0) return;
    const h = this._perfHist || (this._perfHist = []);
    h.push(dt * 1000);
    if (h.length > 120) h.shift();
  },

  _drawPerf(ctx, game) {
    const h = this._perfHist;
    if (!h || h.length < 8) return;
    const sorted = h.slice().sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const alive = game ? game.units.filter((u) => u.deadT == null).length : 0;
    const c = this.canvas;
    const lines = [
      Math.round(1000 / med) + ' FPS   ' + med.toFixed(1) + ' ms  (p95 ' + p95.toFixed(1) + ')',
      alive + ' men   ' + c.width + 'x' + c.height +
        '  scale ' + this.renderScale.toFixed(2) + '  dpr' + (window.devicePixelRatio || 1),
    ];
    ctx.save();
    ctx.font = 'bold 11px Courier New';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(6, 6, 236, 30);
    ctx.fillStyle = med > 22 ? '#ff8a6a' : med > 18 ? '#ffd98a' : '#a8d98a';
    ctx.fillText(lines[0], 12, 19);
    ctx.fillStyle = '#c8d0b4';
    ctx.fillText(lines[1], 12, 31);
    ctx.restore();
  },

  /* Draw only the slice of a wide layer that can actually be seen. */
  _blitStrip(ctx, layer, offset) {
    if (!layer) return;
    const sx = clamp(Math.floor(offset), 0, Math.max(0, layer.width - 1));
    const sw = Math.min(CANVAS_W, layer.width - sx);
    if (sw <= 0) return;
    ctx.drawImage(layer, sx, 0, sw, layer.height, 0, 0, sw, layer.height);
  },

  /* Adaptive resolution.
   *
   * A frame is ~9 full-screen layer blits (sky, parallax x2, three lanes, three
   * decal layers) plus the atmosphere fills, so cost is dominated by the size of
   * the backing store, not by draw calls. Rather than guess at any one machine,
   * measure and adjust: if frames are consistently slow, render fewer pixels and
   * let the browser scale up; if there is headroom, give the sharpness back.
   *
   * Deliberately sluggish — it only moves after a second of consistent evidence
   * and in small steps, because a resolution that visibly pumps is worse than one
   * that is simply a little soft.
   */
  renderScale: 0.8,          // MOBILE: start safe, _adaptScale climbs
  _rsHold: 0,

  _adaptScale(dt) {
    const h = this._perfHist;
    if (!h || h.length < 45) return;
    this._rsHold -= dt;
    if (this._rsHold > 0) return;
    const sorted = h.slice(-45).sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    const before = this.renderScale;
    /* MOBILE: adapt UP from a safe start rather than down from the ceiling.
     *
     * Desktop begins at renderScale 1 and discovers the limit by dropping
     * frames — fine on a machine that will probably never hit it, wrong on a
     * phone where the first ten seconds are the ones a player judges. The
     * initial value is 0.8 (see `renderScale` above) and the floor drops to
     * 0.5, because a mid-range Android that cannot hold 0.62 should get a
     * softer picture rather than a stuttering one. */
    if (med > 19 && this.renderScale > 0.5) this.renderScale -= 0.1;
    else if (med < 11.5 && this.renderScale < 1) this.renderScale += 0.05;
    this.renderScale = clamp(this.renderScale, 0.5, 1);
    if (Math.abs(this.renderScale - before) > 0.001) {
      this._rsHold = 1.1;          // settle before judging again
      this.fitDPR();
    }
  },

  fitDPR() {
    const c = this.canvas;
    if (!c) return;
    // Capped at 2. Every full-screen parallax layer is redrawn each frame, so
    // cost scales with the backing store: dpr 3 is 2.25x the pixels of dpr 2 for
    // no visible gain at this art scale, and it is what kills frame rate on
    // phones and Retina panels.
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.renderScale;
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this._k = c.width / CANVAS_W;
  },

  /* The highest (smallest y) the ground line reaches across a lane.
   *
   * groundY = LANE_BASE - elev * ELEV_PX, so the maximum elevation on the lane
   * gives the top of everything that sits ON the ground. Used to size the
   * cropped decal layer. */
  _laneTopY(map, lane) {
    let top = 1e9;
    for (let x = 0; x <= WORLD_W; x += 32) {
      const y = groundY(map, lane, x);
      if (y < top) top = y;
    }
    return top;
  },

  markDirty(lane) { this.dirty[lane] = true; },

  _makeLayer(w, h) {
    const c = document.createElement('canvas');
    c.width = w || CANVAS_W; c.height = h || CANVAS_H;
    return c;
  },

  buildStatic(game) {
    const map = game.map;
    this.sky = this._makeLayer();
    this._drawSkyBase(this.sky.getContext('2d'), map);
    const farW = Math.ceil(CANVAS_W + (WORLD_W - CANVAS_W) * this.FAR_PARA);
    this.farLayer = this._makeLayer(farW, CANVAS_H);
    this._drawFar(this.farLayer.getContext('2d'), map, farW);
    const midW = Math.ceil(CANVAS_W + (WORLD_W - CANVAS_W) * this.MID_PARA);
    this.midLayer = this._makeLayer(midW, CANVAS_H);
    this._drawMid(this.midLayer.getContext('2d'), map, midW);
    for (let l = 0; l < LANE_N; l++) {
      this.dirty[l] = true;
      /* MOBILE: decals only ever land on the ground, so the layer does not
       * need the full 720. Blood, craters and scorch sit between the highest
       * point the lane's ground line reaches and the bottom of the frame; the
       * band above that is transparent on every map. Two layers at 2560x720
       * cost 14.1 MB, and this is most of it back. `decalTop[l]` is the offset
       * the blitter and every bake must subtract. */
      const dTop = Math.max(0, Math.floor(this._laneTopY(map, l) - 24));
      this.decalTop[l] = dTop;
      this.decalLayers[l] = this._makeLayer(WORLD_W, CANVAS_H - dTop);
      this.decalUsed = this.decalUsed || [false, false, false];
      this.decalUsed[l] = false;
      this.corpseCount[l] = 0;
    }
    const rng = seeded(map.seed);
    /* Clouds in THREE DEPTHS, each a bank of lobes rather than two ellipses.
     *
     * The sky is 35-45% of the frame and it was the emptiest part of it: eight
     * clouds, each drawn as two overlapping ellipses at alpha 0.05-0.15, which
     * is a smudge, not a cloud. A cloud reads because it has a lit top and a
     * heavier base — value structure, not an outline — so each one here carries
     * a stack of lobes with the light coming off the map's own sun. */
    this.clouds = [];
    for (let i = 0; i < 16; i++) {
      const band = i % 3;                       // 0 far/high, 2 near/low
      const w = (70 + rng() * 130) * (1 + band * 0.55);
      const lobes = [];
      const n = 3 + ((rng() * 4) | 0);
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1 || 1);
        lobes.push({
          dx: (t - 0.5) * w * 1.5,
          dy: -Math.sin(t * Math.PI) * w * 0.20 + (rng() - 0.5) * w * 0.06,
          r: w * (0.20 + rng() * 0.20) * (0.55 + Math.sin(t * Math.PI) * 0.65),
        });
      }
      this.clouds.push({
        x: rng() * WORLD_W, y: 34 + band * 52 + rng() * 60, w, lobes,
        sp: (2 + rng() * 5) * (0.5 + band * 0.45),
        a: (0.07 + rng() * 0.09) * (1 - band * 0.16),
        para: 0.10 + band * 0.09,
      });
    }
    // foreground occlusion plants along the bottom edge (fast parallax = depth)
    /* Foreground growth, denser and larger than it was.
     *
     * Dropping to two lanes freed the bottom quarter of the frame and left it
     * as flat empty ground. Something in FRONT of the action is also the
     * cheapest depth cue there is — far cheaper than anything behind it — so
     * this band does double duty: it fills the space and it puts the battle
     * behind a screen of growth, which is what the reference art does.
     *
     * Spacing roughly halved and sizes raised; a second, larger and darker
     * layer sits closer still and takes a stronger parallax shift. */
    this.fgPlants = [];
    /* Prop kinds only. `w` here is now a HEIGHT in px — props are authored by
     * real height, so the aspect follows rather than being imposed.
     *
     * The two bands draw from DIFFERENT bags. The near band is big enough that a
     * short wide prop is both wrong and expensive: a prop is framed in a square
     * sized by its real height, so making a 0.68 m bush 280 px tall inflates the
     * blit to 769x769 of which two thirds is empty — 0.59 Mpx an instance, on a
     * band that redraws every frame. It also reads as a six-metre shrub. Near
     * growth is tall growth: grass and hanging vine, which frame tightly and are
     * what you would actually be looking through. */
    /* And the same shattered-ground rule as the lane scatter: Khe Sanh's
     * plateau and Hill 937's ridge were being framed through broad-leaved bush
     * and hanging vine, so the two maps where every tree in the frame has been
     * blown to a splinter were viewed through a healthy jungle. Grass and dead
     * fern spray on those. */
    const blasted = map.trees === 'shattered';
    const kinds = blasted
      ? ['grass', 'fern', 'grass', 'grass', 'fern', 'grass']
      : ['grass', 'fern', 'bush', 'plant', 'grass', 'bush'];
    // No vine in the near band. Its leaves alternate at regular intervals down a
    // near-straight strand, which at 260 px reads as a rope ladder rather than
    // growth; at ground-clutter size the same regularity is invisible. Fern
    // spray and grass are what actually read as undergrowth this close.
    const nearKinds = ['grass', 'fern', 'grass'];
    let px = 60 + rng() * 120;
    while (px < WORLD_W * 1.02) {
      this.fgPlants.push({
        x: px, kind: kinds[Math.floor(rng() * kinds.length)],
        i: Math.floor(rng() * 4), w: 86 + rng() * 74, flip: rng() < 0.5, near: false,
      });
      px += 150 + rng() * 190;   // MOBILE: thinner far band, ~40% fewer plants
    }
    // the near band — bigger, darker, faster-moving, and allowed off the edge
    px = -40 + rng() * 160;
    while (px < WORLD_W * 1.05) {
      this.fgPlants.push({
        x: px, kind: nearKinds[Math.floor(rng() * nearKinds.length)],
        i: Math.floor(rng() * 4), w: 150 + rng() * 110, flip: rng() < 0.5, near: true,
      });
      px += 380 + rng() * 460;   // MOBILE: thinner near band — the biggest overdraw in the frame
    }
  },

  _drawForeground(ctx, camX) {
    // drawn inside the world transform; the extra shift makes it float closer,
    // and the near band shifts harder still so the two read as separate depths
    for (const p of this.fgPlants) {
      const k = p.near ? 1.26 : 1.12;
      const dx = p.x * k - (k - 1) * camX;
      if (dx < camX - 200 || dx > camX + CANVAS_W + 200) continue;
      if (p.near) {
        /* Nearest growth is out of the light: darker, slightly transparent, and
         * hanging below the frame edge so it reads as being between the camera
         * and the field rather than standing in it.
         *
         * The darkening was DEAD CODE until now — globalCompositeOperation was
         * set after the draw and immediately before restore(), so it applied to
         * nothing. The band rendered at full brightness and read as bleached
         * straw across the bottom of every frame. It is also the cheapest half
         * of the value structure the whole frame is short of: something genuinely
         * dark in the foreground is what gives the fight a lit pocket to sit in. */
        drawVeg(ctx, p.kind, p.i, dx, CANVAS_H + 16, p.w,
          { flip: p.flip, alpha: 0.94, shade: 0.90 });
      } else {
        drawVeg(ctx, p.kind, p.i, dx, CANVAS_H - 30, p.w,
          { alpha: 0.96, flip: p.flip, shade: 0.58 });
      }
    }
  },

  /* NO GHOST PASS HERE — deliberately.
   *
   * A soldier redraw for men hidden behind a nearer lane's building was written
   * and then removed, because measurement showed the case cannot occur. After
   * the drop to two lanes, LANE_BASE [400, 545] puts a front-lane structure's
   * top edge BELOW a back-lane man's feet on every map:
   *
   *     iadrang -45px   cuchi -41px   mekong -24px   khesanh -34px   hill937 -40px
   *
   * (margin = building top relative to the back-lane man's feet; negative means
   * it never reaches him.) Men fighting from inside a building are handled by
   * the `window` cover, which cuts an opening and draws the man through it.
   *
   * Restore a ghost pass only if LANE_BASE moves or structures grow taller —
   * and re-measure the margins above before assuming it is needed.
   */

  _drawSkyBase(ctx, map) {
    const p = map.pal;
    /* A two-stop gradient is not a sky. Real ones are darkest overhead, lighten
     * steadily, and then GLOW along the last few degrees above the horizon where
     * you are looking through the most air — that horizon band is what gives a
     * sky depth, and it is what makes the ridge line read as far away rather
     * than as a shape pasted on a wall. */
    const g = ctx.createLinearGradient(0, 0, 0, 470);
    g.addColorStop(0, this._shade(p.skyTop, -14));
    g.addColorStop(0.42, p.skyTop);
    g.addColorStop(0.82, p.skyBot);
    g.addColorStop(1, this._shade(p.skyBot, 16));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, 470);

    const s = p.sun;
    /* Horizon glow, centred under the sun rather than on the frame — the air
     * brightens toward the light, which is also the only cue in the whole
     * background that says where the light IS. */
    const hg = ctx.createRadialGradient(s.x, 430, 10, s.x, 430, CANVAS_W * 0.72);
    hg.addColorStop(0, this._fade(s.color, 0.34));
    hg.addColorStop(0.45, this._fade(s.color, 0.13));
    hg.addColorStop(1, this._fade(s.color, 0));
    ctx.fillStyle = hg;
    ctx.fillRect(0, 250, CANVAS_W, 220);

    // the disc, and a wide soft bloom around it
    const bloom = ctx.createRadialGradient(s.x, s.y, s.r * 0.6, s.x, s.y, s.r * 6.5);
    bloom.addColorStop(0, this._fade(s.color, 0.42));
    bloom.addColorStop(0.30, this._fade(s.color, 0.14));
    bloom.addColorStop(1, this._fade(s.color, 0));
    ctx.fillStyle = bloom;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 6.5, 0, 7); ctx.fill();
    const sg = ctx.createRadialGradient(s.x, s.y, 4, s.x, s.y, s.r * 2.2);
    sg.addColorStop(0, s.color);
    sg.addColorStop(0.42, this._fade(s.color, 0.7));
    sg.addColorStop(1, this._fade(s.color, 0));
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 2.2, 0, 7); ctx.fill();

    // and the air between the sun and the ground
    this._godRays(ctx, map, seeded(map.seed + 991));
  },

  /* CREPUSCULAR RAYS — shafts of light through the canopy.
   *
   * The single most atmospheric thing in the reference art, and the one the game
   * was missing entirely: the sun was a bright disc in a gradient and the air
   * between it and the ground was empty. Real light in a humid valley is
   * VISIBLE — it picks out dust and mist in shafts, and those shafts are what
   * makes the space read as deep and full of air rather than as a flat backdrop.
   *
   * Drawn as long soft wedges radiating from the map's own sun, in `lighter` so
   * they accumulate where they cross rather than stacking into flat bands, and
   * fading out well before the ground so they read as light in the air rather
   * than as painted stripes. Baked into the sky layer — no per-frame cost.
   */
  _godRays(ctx, map, rng) {
    const s = map.pal.sun;
    if (!s) return;
    /* FIVE, NOT NINE, and a tenth of the strength.
     *
     * The first cut fanned nine bright wedges across the whole sky and produced
     * a hard-edged cartoon sunburst — the exact bicycle wheel the comment above
     * claimed to be avoiding. Light shafts work when you are not sure whether
     * you are seeing them. Narrow the fan so they fall AWAY from the sun rather
     * than radiating all round it, and keep the alpha low enough that they read
     * as air rather than as geometry. */
    const n = 5;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.78 + 0.30 * (i / (n - 1))) + (rng() - 0.5) * 0.07;
      const spread = (0.010 + rng() * 0.022);
      const len = 620 + rng() * 460;
      const x1 = s.x + Math.cos(a) * len;
      const y1 = s.y - Math.sin(a) * len;
      const g = ctx.createLinearGradient(s.x, s.y, x1, y1);
      const k = 0.012 + rng() * 0.016;
      g.addColorStop(0, this._fade(s.color, k));
      g.addColorStop(0.45, this._fade(s.color, k * 0.55));
      g.addColorStop(1, this._fade(s.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + Math.cos(a - spread) * len, s.y - Math.sin(a - spread) * len);
      ctx.lineTo(s.x + Math.cos(a + spread) * len, s.y - Math.sin(a + spread) * len);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  },

  _drawFar(ctx, map, w) {
    const rng = seeded(map.seed + 7);
    /* The horizon range, built rather than sliced.
     *
     * This was the last inked line art left in the frame, and it occupied the
     * widest band of it: `drawTex('mtn', ...)` pasted hand-drawn mountain
     * silhouettes across the whole sky on all five maps. Everything in front of
     * them — massif, ridges, treeline, props, soldiers — is now built from
     * value, so the one thing spanning the top third of the screen was speaking
     * a different language than the rest of the picture. That is exactly the
     * "assets look like they are from different worlds" complaint, and it was
     * loudest here because these are the largest shapes on screen.
     *
     * Two tiers, because a RANGE is not a row of triangles: a far tier washed
     * most of the way to the sky and a nearer tier carrying the lit/shadow
     * split, overlapping so the near peaks cut into the far ones. Peaks use the
     * same off-centre shoulder profile as _massif so the built landforms all
     * agree about what a mountain looks like.
     *
     * Maps with `flatHorizon` get none of it — see MEKONG, where a mountain
     * range was simply wrong: the delta is a floodplain. */
    if (!map.flatHorizon) this._farRange(ctx, rng, w, map);
    // a named landform is drawn BEFORE the ridges, so they overlap its foot and
    // it reads as standing behind the country rather than in front of it
    if (map.pal.massif) this._massif(ctx, rng, w, map, map.pal.massif);
    /* The ridges are the other half of the horizon, and on a flat map they were
     * still throwing peaks: amp 70 stepped every 64px is a sawtooth, which is
     * where the sierra behind the rice fields was actually coming from once the
     * painted range was gone. Flattened to a low far shore, which is what you
     * see across a floodplain — land, but no relief. */
    const fh = map.flatHorizon;
    this._ridge(ctx, rng, w, fh ? 322 : 260, fh ? 9 : 70, map.pal.hillFar, 0.85);
    this._ridge(ctx, rng, w, fh ? 336 : 300, fh ? 7 : 55, map.pal.hillNear, 1);
    /* Blend the far band toward the SKY, not toward its own hill colour.
     *
     * This used to wash 42% of flat `hillFar` over the whole layer, which is why
     * the blue-grey massif and the green ridge in front of it came out the same
     * colour. Tinting toward `hillFar` also cannot make anything recede — the
     * ridges were already that colour, so they kept full contrast against the
     * sky and read as cut-outs pasted on it, worst of all at night.
     *
     * What distance actually does is wash everything toward the colour of the
     * air between you and it, which is the sky. Strongest at the top of the band
     * (farthest) and easing off toward the treeline. */
    ctx.globalCompositeOperation = 'source-atop';
    const fg = ctx.createLinearGradient(0, 150, 0, 430);
    fg.addColorStop(0, this._fade(map.pal.skyBot, 0.46));
    fg.addColorStop(0.6, this._fade(map.pal.skyBot, 0.24));
    fg.addColorStop(1, this._fade(map.pal.skyBot, 0.06));
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, w, CANVAS_H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },

  _drawMid(ctx, map, w) {
    // dark canopy wall behind the top lane — reads as depth when it parallaxes
    const rng = seeded(map.seed + 13);
    const col = this._shade(map.pal.tree, -10);
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, 420);
    let y = 330 + rng() * 20;
    ctx.lineTo(0, y);
    for (let x = 0; x <= w; x += 26) {
      const ny = 322 + rng() * 34;
      ctx.quadraticCurveTo(x + 9, y - 14 - rng() * 16, x + 26, ny);
      y = ny;
    }
    ctx.lineTo(w, 420);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    // textured jungle line riding the canopy crest + distant settlements/paddies
    const sunSide = (map.pal.sun && map.pal.sun.x < CANVAS_W / 2) ? -1 : 1;
    this._treeBand(ctx, rng, w, 352, 46, map.pal.brush, sunSide, map.pal.tree);
    if (map.id !== 'khesanh' && map.id !== 'hill937') {
      for (let k = 0; k < 3; k++) {
        this._villageBand(ctx, rng, (0.16 + 0.3 * k + rng() * 0.1) * w, 360,
          130 + rng() * 60, map.pal.tree);
      }
    }
    if (map.id === 'mekong') {
      // far paddies gleaming below the treeline
      for (let k = 0; k < 7; k++) {
        const px = (0.06 + 0.14 * k + rng() * 0.05) * w;
        this._paddyStrip(ctx, rng, px, 396 + (k % 3) * 7, 120 + rng() * 90, map);
      }
    }
    // unify with the palette
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, w, CANVAS_H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },

  /* A distant treeline, drawn rather than sliced.
   *
   * The `treeline` slices are hand-inked canopy — black outlines and dense
   * cross-hatching — which is the last of the drawing system the whole prop
   * pipeline exists to replace. At this distance a canopy is not detail anyway:
   * it is a ragged edge and two values, the mass and the crowns catching light.
   * Built the same way as the clouds and the vector trees so all of them agree
   * about where the sun is. */
  _treeBand(ctx, rng, w, baseY, height, color, sunSide, deep) {
    /* Three values off the map's OWN two greens, not one colour shaded twice.
     *
     * Built from `brush` alone the band came out uniformly mid-green and read as
     * a row of shrubs where the inked slices it replaced read as a wall of
     * jungle — softer AND lighter, which lost the one thing the far treeline is
     * for: a dark mass for the lit field in front of it to sit against. The
     * canopy takes `tree` (the map's darkest green) with `brush` as the lit
     * surface, which is the relationship those two palette entries already
     * describe. Lobes are packed tighter too; gaps read as shrubs. */
    const dark = this._shade(deep || color, -10);
    const mid = deep ? this._shade(deep, 12) : color;
    const lit = this._tint(color, 22, 22, 4);
    const lobes = [];
    for (let x = -40; x < w + 60; x += 9 + rng() * 11) {
      lobes.push({ x, y: baseY - rng() * height * 0.72, r: height * (0.34 + rng() * 0.46) });
    }
    /* One subpath per lobe, plus a rect for the solid base.
     *
     * `ctx.ellipse()` CONTINUES the current subpath — it draws a line from the
     * current point to the start of the arc. Opening with a moveTo to the far
     * corner therefore ran a spike from the bottom-left of the band into the
     * first lobe, which is exactly what appeared at the left edge of the frame.
     * A moveTo before each ellipse starts a fresh subpath, and fill() unions
     * them under the nonzero rule. */
    const pass = (fill, dy, k) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.rect(-60, baseY, w + 120, height);
      for (const l of lobes) {
        const rx = l.r * k * 1.25, ry = l.r * k;
        ctx.moveTo(l.x + rx, l.y + dy);
        ctx.ellipse(l.x, l.y + dy, rx, ry, 0, 0, 7);
      }
      ctx.fill();
    };
    pass(dark, height * 0.16, 1.0);
    pass(mid, 0, 0.97);
    pass(lit, -height * 0.18, 0.44);
    // a few emergent crowns breaking the line — a flat top reads as a hedge
    ctx.fillStyle = dark;
    for (let i = 0; i < w / 190; i++) {
      const ex = rng() * w, eh = height * (0.5 + rng() * 0.7);
      ctx.beginPath();
      ctx.ellipse(ex, baseY - eh, height * 0.20, height * 0.26, 0, 0, 7);
      ctx.fill();
      ctx.fillRect(ex - 1.2, baseY - eh, 2.4, eh * 0.7);
    }
  },

  /* Rooflines on the horizon. The `villageSil` slices were three unrelated
   * things — a second treeline, a black pagoda, and a bare hill — so a village
   * looked different every time one was picked. These are roofs, which is all
   * that reads of a hamlet at this range. */
  _villageBand(ctx, rng, cx, baseY, w, color) {
    const dark = this._shade(color, -18);
    ctx.save();
    ctx.fillStyle = dark;
    let x = cx - w / 2;
    while (x < cx + w / 2) {
      const bw = 16 + rng() * 30, bh = 8 + rng() * 12;
      const eave = bw * 0.16;
      if (rng() < 0.18) {
        // a tiered roof — the one shape that says village rather than shed
        for (let t = 0; t < 3; t++) {
          const tw = bw * (1 - t * 0.22), ty = baseY - bh * 0.5 - t * bh * 0.42;
          ctx.beginPath();
          ctx.moveTo(x + bw / 2 - tw / 2 - eave, ty);
          ctx.lineTo(x + bw / 2, ty - bh * 0.5);
          ctx.lineTo(x + bw / 2 + tw / 2 + eave, ty);
          ctx.closePath(); ctx.fill();
        }
        ctx.fillRect(x + bw / 2 - 1.5, baseY - bh * 0.5, 3, bh * 0.5);
      } else {
        ctx.beginPath();                       // a pitched roof over a low wall
        ctx.moveTo(x - eave, baseY - bh * 0.55);
        ctx.lineTo(x + bw * 0.5, baseY - bh);
        ctx.lineTo(x + bw + eave, baseY - bh * 0.55);
        ctx.closePath(); ctx.fill();
        ctx.fillRect(x + bw * 0.12, baseY - bh * 0.55, bw * 0.76, bh * 0.55);
      }
      x += bw + rng() * 26;
    }
    ctx.restore();
  },

  /* Flooded paddy, seen EDGE ON.
   *
   * The `paddy` slices are isometric 3/4-view tiles — drawn looking down at the
   * field from an angle — in a game whose every other element is a strict side
   * view. That is precisely the collage the prop pipeline was built to end, and
   * it survived this long only because it was squashed to 55% and drawn at 0.5
   * alpha, which hides the projection without fixing it. Edge on, a paddy is a
   * bright horizontal sliver of sky lying between two low bunds. */
  _paddyStrip(ctx, rng, x, y, w, map) {
    const water = map.pal.water || '#8fa9b4';
    const bund = this._tint(map.pal.laneBody[0], 10, 2, -8);
    const h = 3 + rng() * 3;
    ctx.save();
    ctx.fillStyle = bund;
    ctx.fillRect(x - w / 2, y + h * 0.6, w, h * 0.8);       // near bund
    ctx.fillStyle = this._shade(water, -18);
    ctx.fillRect(x - w / 2, y, w, h);                       // the sheet of water
    ctx.globalAlpha = 0.75;                                  // sky on the surface
    ctx.fillStyle = water;
    ctx.fillRect(x - w / 2, y, w, Math.max(1, h * 0.42));
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = bund;
    ctx.fillRect(x - w / 2, y - h * 0.5, w, h * 0.5);        // far bund
    // rice standing in it, as ticks rather than blades at this size
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = this._tint(map.pal.brush, -10, 6, -10);
    for (let i = 0; i < w / 7; i++) {
      ctx.fillRect(x - w / 2 + rng() * w, y - rng() * h * 0.5, 1, 1 + rng() * 2);
    }
    ctx.restore();
  },

  /* Litter where a prop meets the ground.
   *
   * A prop's silhouette ends on a clean curve, and a clean curve against flat
   * turf is the giveaway that it was pasted rather than grown there. Real
   * objects gather things at the base: fallen fronds, scrub, a scuff of bare
   * soil. Three or four marks that STRADDLE the boundary are enough — they give
   * the eye something to read as "this continues into the ground" instead of a
   * cut edge.
   *
   * Drawn AFTER the prop so the litter sits in front of its base, and only into
   * a baked layer, so it costs nothing per frame. */
  /* A TUNNEL MOUTH, as map dressing.
   *
   * Cu Chi's mission is called THE EARTH FIGHTS and the whole place is two
   * hundred kilometres of hand-dug tunnel — but tunnels only exist in this game
   * once a player digs one, so from the opening frame nothing said the ground
   * was honeycombed. These are decoration, not mechanics: no cover, no entrance,
   * nothing to interact with. They are there so the ground looks used.
   *
   * A hole reads as a hole because of the SPOIL beside it. A dark ellipse on
   * grass is a puddle; a dark ellipse with a heap of fresh subsoil thrown out
   * next to it is something that was dug.
   */
/* ---- A COMBAT BASE UNDER SIEGE ----------------------------------------
   *
   * Khe Sanh's briefing is "a besieged Marine combat base" and its mode is
   * literally `siege`, and what the frame actually showed was empty red ground,
   * a brick village longhouse and lush leafy bushes. Nothing in the picture had
   * been fortified, shelled, or defended. The map's identity existed only in
   * its text.
   *
   * Four things carry a firebase in a side-on view, in order of how much they
   * say: the WIRE, the TRENCH, the REVETMENTS, and the AIRSTRIP. All four are
   * baked into the lane layer, so they cost nothing per frame, and all four are
   * built from value the way the rest of the terrain is. */

  /* Concertina. The single most identifying object on a defended perimeter, and
   * the hardest to draw honestly — a coil is a helix, and a helix seen side-on
   * is a run of overlapping ellipses whose overlap is the whole read. Drawn as
   * three bands so the belt has depth rather than being one fence, and picked
   * out in light strokes because at night, under fog 0.5, a dark wire on dark
   * laterite is nothing at all. */
  _wireBelt(ctx, rng, map, lane, x0, x1) {
    const gy = (x) => groundY(map, lane, x);
    const dep = LANE_DEPTH[lane];
    for (let band = 0; band < 3; band++) {
      const lift = band * 3.4 * dep;
      const r = (6.5 - band * 0.9) * dep;
      const yOff = -2 - lift;
      // pickets first, so the coils sit in front of them
      ctx.strokeStyle = 'rgba(30,26,20,0.75)';
      ctx.lineWidth = 1.3 * dep;
      for (let x = x0; x < x1; x += 46 * dep) {
        const y = gy(x) + yOff;
        ctx.beginPath(); ctx.moveTo(x, y + r * 0.7); ctx.lineTo(x + 1.5, y - r * 1.5); ctx.stroke();
      }
      ctx.strokeStyle = band === 0 ? 'rgba(214,206,186,0.5)' : 'rgba(196,188,170,0.34)';
      ctx.lineWidth = Math.max(0.7, 1.05 * dep);
      // step is HALF the loop radius: the loops have to interpenetrate or the
      // belt reads as a row of separate hoops instead of a coil
      for (let x = x0; x < x1; x += r * 0.95) {
        const y = gy(x) + yOff - r * 0.5;
        ctx.beginPath();
        ctx.ellipse(x, y, r * (0.8 + rng() * 0.3), r * (0.62 + rng() * 0.3),
                    (rng() - 0.5) * 0.4, 0, 7);
        ctx.stroke();
        if (rng() < 0.35) {                    // barbs catching what light there is
          ctx.beginPath();
          ctx.moveTo(x - r * 0.4, y - r * 0.4); ctx.lineTo(x - r * 0.7, y - r * 0.8);
          ctx.stroke();
        }
      }
    }
  },

  /* A fighting trench: a dark slot with the spoil thrown up in front of it.
   * The parapet is what makes it read — a black line on the ground is a crack,
   * a black line with a lit lip above it is something men are standing in. */
  _trenchLine(ctx, rng, map, lane, x0, x1) {
    const p = map.pal, dep = LANE_DEPTH[lane];
    const lip = this._tint(p.laneTop[lane], 26, 18, 8);
    const slot = 'rgba(10,8,6,0.88)';
    const cols = [];
    for (let x = x0; x <= x1; x += 10) cols.push(x);
    const top = (x) => groundY(map, lane, x) - 2 * dep;
    // spoil parapet
    ctx.beginPath();
    ctx.moveTo(x0, top(x0));
    for (const x of cols) ctx.lineTo(x, top(x) - (5 + Math.sin(x * 0.07) * 1.6) * dep);
    for (let i = cols.length - 1; i >= 0; i--) ctx.lineTo(cols[i], top(cols[i]) + 1);
    ctx.closePath();
    ctx.fillStyle = lip; ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.moveTo(x0, top(x0));
    for (const x of cols) ctx.lineTo(x, top(x) - 1.6 * dep);
    for (let i = cols.length - 1; i >= 0; i--) ctx.lineTo(cols[i], top(cols[i]) + 1);
    ctx.closePath(); ctx.fill();
    // the slot itself, just under the parapet
    ctx.fillStyle = slot;
    ctx.beginPath();
    ctx.moveTo(x0, top(x0) + 0.5);
    for (const x of cols) ctx.lineTo(x, top(x) + 0.5);
    for (let i = cols.length - 1; i >= 0; i--) ctx.lineTo(cols[i], top(cols[i]) + 4.2 * dep);
    ctx.closePath(); ctx.fill();
    // sandbags along the lip at intervals, and a firing step notch
    for (let x = x0 + 20; x < x1; x += 60 + rng() * 70) {
      if (typeof Props !== 'undefined' && Props.ready && Props.has('sandbags_row')) {
        // fit = PIXEL height. The 5th argument is a SCALE, and passing pixels
        // there renders the prop at 9x, which is how a sandbag row became a
        // building. See Props.draw(ctx, name, x, groundY, scale, opts).
        Props.draw(ctx, 'sandbags_row', x, top(x) - 4 * dep, 1,
                   { flip: rng() < 0.5, fit: 11 * dep });
      }
    }
  },

  /* PIERCED STEEL PLANK. The Khe Sanh airstrip is the reason the place could be
   * held at all, and it is unmistakable: interlocking perforated mat, laid on
   * red mud, patched where shells took it out. A grey metal band across the far
   * lane is also the only cool, man-made horizontal in a map of earth. */
  _airstrip(ctx, rng, map, lane, x0, x1) {
    const dep = LANE_DEPTH[lane];
    const h = 13 * dep;
    const gy = (x) => groundY(map, lane, x) - h + 2;
    const cols = [];
    for (let x = x0; x <= x1; x += 12) cols.push(x);
    const band = (yA, yB, fill) => {
      ctx.beginPath();
      ctx.moveTo(x0, gy(x0) + yA);
      for (const x of cols) ctx.lineTo(x, gy(x) + yA);
      for (let i = cols.length - 1; i >= 0; i--) ctx.lineTo(cols[i], gy(cols[i]) + yB);
      ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    };
    band(0, h, '#6d7069');                      // the mat
    band(0, h * 0.24, '#878a80');               // light caught on the near lip
    band(h * 0.82, h, 'rgba(16,14,11,0.45)');   // shadow under the edge
    // plank seams and the perforation rows
    ctx.strokeStyle = 'rgba(28,28,26,0.5)'; ctx.lineWidth = 1;
    for (let x = x0; x < x1; x += 17 * dep) {
      ctx.beginPath(); ctx.moveTo(x, gy(x) + 1); ctx.lineTo(x, gy(x) + h - 1); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(30,30,28,0.42)';
    for (let x = x0 + 4; x < x1; x += 6 * dep)
      for (let r = 0; r < 2; r++)
        ctx.fillRect(x, gy(x) + h * (0.34 + r * 0.3), 1.4 * dep, 1.4 * dep);
    // shell damage: plates lifted and mud showing through
    for (let i = 0; i < (x1 - x0) / 320; i++) {
      const x = x0 + rng() * (x1 - x0);
      ctx.fillStyle = this._shade(map.pal.laneBody[lane], 12);
      ctx.beginPath();
      ctx.ellipse(x, gy(x) + h * 0.55, 9 * dep, h * 0.4, 0, 0, 7);
      ctx.fill();
      ctx.strokeStyle = '#9a9d93'; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x - 9 * dep, gy(x) + h * 0.5);
      ctx.lineTo(x - 13 * dep, gy(x) + h * 0.1);
      ctx.stroke();
    }
  },

  _tunnelMouth(ctx, rng, x, gy, map, lane) {
    const soil = map.pal.soil || this._tint(map.pal.laneBody[lane], 26, 8, -14);
    const k = LANE_DEPTH[lane];
    const w = (11 + rng() * 7) * k;
    ctx.save();
    // spoil first, so the hole is cut into it
    ctx.globalAlpha = 0.5 + rng() * 0.24;
    ctx.fillStyle = soil;
    for (let i = 0; i < 5; i++) {
      const sx = x + (rng() - 0.5) * w * 2.6;
      ctx.beginPath();
      ctx.ellipse(sx, gy - rng() * 2, (3 + rng() * 6) * k, (1.4 + rng() * 2) * k, 0, 0, 7);
      ctx.fill();
    }
    // the shaft: black, with a lip of turned earth on its upper rim
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(10,8,6,0.92)';
    ctx.beginPath();
    ctx.ellipse(x, gy - 1 * k, w * 0.5, w * 0.24, 0, 0, 7);
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = this._shade(soil, 22);
    ctx.lineWidth = 1.2 * k;
    ctx.beginPath();
    ctx.ellipse(x, gy - 1.6 * k, w * 0.5, w * 0.24, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    // a couple of poles, the way a real one is shored and hidden
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = this._tint(map.pal.brush, -14, -4, -10);
    ctx.lineWidth = 1.1 * k;
    for (let i = 0; i < 2 + ((rng() * 2) | 0); i++) {
      const px = x + (rng() - 0.5) * w * 1.5;
      ctx.beginPath();
      ctx.moveTo(px, gy);
      ctx.lineTo(px + (rng() - 0.5) * 4 * k, gy - (4 + rng() * 7) * k);
      ctx.stroke();
    }
    ctx.restore();
  },

  _baseLitter(ctx, rng, x, gy, width, map, lane) {
    const soil = this._tint(map.pal.laneBody[lane], 16, 8, -6);
    const leaf = this._tint(map.pal.brush, -8, 2, -8);
    const dark = this._tint(map.pal.laneBody[lane], -22, -16, -4);
    const w = Math.max(7, width);
    ctx.save();
    // a scuff of bare earth, wider than it is tall and sat ON the line
    ctx.globalAlpha = 0.30 + rng() * 0.16;
    ctx.fillStyle = soil;
    ctx.beginPath();
    ctx.ellipse(x + (rng() - 0.5) * w * 0.3, gy - 1,
      w * (0.34 + rng() * 0.22), 2.2 + rng() * 1.8, 0, 0, 7);
    ctx.fill();
    // debris straddling the base — the part that actually breaks the edge
    for (let i = 0; i < 3 + ((rng() * 3) | 0); i++) {
      const px = x + (rng() - 0.5) * w * 0.85;
      const py = gy - rng() * 3;
      ctx.globalAlpha = 0.34 + rng() * 0.30;
      ctx.fillStyle = rng() < 0.45 ? dark : leaf;
      const lw = 2 + rng() * 5, lh = 1 + rng() * 2;
      ctx.beginPath();
      ctx.ellipse(px, py, lw, lh, (rng() - 0.5) * 0.8, 0, 7);
      ctx.fill();
    }
    // a couple of blades standing up through it
    ctx.globalAlpha = 0.34 + rng() * 0.22;
    ctx.strokeStyle = leaf;
    ctx.lineWidth = 1;
    for (let i = 0; i < 2 + ((rng() * 3) | 0); i++) {
      const px = x + (rng() - 0.5) * w * 0.7;
      ctx.beginPath();
      ctx.moveTo(px, gy);
      ctx.lineTo(px + (rng() - 0.5) * 3, gy - 2 - rng() * 4);
      ctx.stroke();
    }
    ctx.restore();
  },

  /* A MASSIF — one mountain that owns the horizon.
   *
   * The ridge generator makes a row of interchangeable bumps, which is right for
   * background and wrong when a single landform IS the battlefield. At Ia Drang
   * the Chu Pong massif is the reason there was a battle: two NVA regiments came
   * down off it into a clearing, and `hillFar: #8c93a8` has been sitting in the
   * palette to describe a mountain the map never actually drew. A row of equal
   * triangles says "some hills"; one mass that runs off the top of the band says
   * "that is the mountain".
   *
   * Built as a silhouette with a LIT and a SHADOWED face split down the ridge
   * line, because at this size a flat fill reads as a cut-out no matter how big
   * it is. The split follows the map's own sun.
   */
  /* One peak of the horizon range. Shares _massif's profile deliberately: a
   * long shoulder into an off-centre summit and a shorter fall, with a little
   * jag on the line so it is not a smooth curve. Returns the ridge points so
   * the caller can split the faces at the summit. */
  _peak(rng, cx, halfW, baseY, h) {
    const pts = [];
    const off = -0.2 + rng() * 0.4;
    const N = 18;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const d = Math.abs((t - 0.5) - off * 0.5) * 2;
      const prof = Math.pow(Math.max(0, 1 - d), 1.6);
      pts.push([cx - halfW + halfW * 2 * t, baseY - h * prof + (rng() - 0.5) * h * 0.09]);
    }
    return pts;
  },

  _farRange(ctx, rng, w, map) {
    const sunSide = (map.pal.sun && map.pal.sun.x < CANVAS_W / 2) ? -1 : 1;
    const tier = (baseY, hLo, hHi, wLo, wHi, col, alpha, faces) => {
      let x = -140 - rng() * 120;
      while (x < w + 200) {
        const pw = wLo + rng() * (wHi - wLo);
        const h = hLo + rng() * (hHi - hLo);
        const pts = this._peak(rng, x + pw / 2, pw / 2, baseY, h);
        let pk = 0;
        for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[pk][1]) pk = i;
        const fill = (c, from, to) => {
          ctx.beginPath();
          ctx.moveTo(pts[from][0], baseY + 90);
          for (let i = from; i <= to; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.lineTo(pts[to][0], baseY + 90);
          ctx.closePath();
          ctx.fillStyle = c;
          ctx.fill();
        };
        ctx.save();
        ctx.globalAlpha = alpha;
        fill(col, 0, pts.length - 1);
        if (faces) {
          // only the near tier carries a light: on the far one the haze has
          // already eaten the form, and shading it there just made it noisy
          if (sunSide > 0) { fill(faces[0], pk, pts.length - 1); fill(faces[1], 0, pk); }
          else { fill(faces[0], 0, pk); fill(faces[1], pk, pts.length - 1); }
        }
        ctx.restore();
        x += pw * (0.42 + rng() * 0.26);   // overlap, so peaks stand behind peaks
      }
    };
    const far = map.pal.hillFar;
    // the farthest tier is mostly air: mixed 60% toward the sky before it is
    // drawn, so the aerial-perspective wash on top has something to work with
    const airy = this._mix(far, map.pal.skyBot, 0.6);
    tier(300, 74, 138, 300, 520, airy, 0.75, null);
    tier(316, 52, 104, 240, 420, far, 0.9,
         [this._tint(far, 26, 26, 22), this._shade(far, -26)]);
  },

  _massif(ctx, rng, w, map, spec) {
    const cx = spec.x * w;
    const halfW = spec.w / 2;
    const baseY = spec.baseY != null ? spec.baseY : 330;
    const peakY = baseY - spec.h;
    const sunSide = (map.pal.sun && map.pal.sun.x < CANVAS_W / 2) ? -1 : 1;
    const body = map.pal.hillFar;
    /* The value split has to survive the haze that sits on top of it. A gentle
     * one plus a 0.62 wash of sky came out as a flat pink slab — the form was
     * there in the fill and gone by the time it reached the screen. */
    const lit = this._tint(body, 40, 40, 34);
    const dark = this._shade(body, -40);

    // the ridge line: a long shoulder up to a peak set off-centre, then a
    // shorter fall — symmetrical mountains do not exist
    const ridge = [];
    const peakAt = -0.18 + rng() * 0.14;
    const N = 26;
    for (let i = 0; i <= N; i++) {
      const t = i / N;                       // 0..1 across the base
      const d = Math.abs((t - 0.5) - peakAt * 0.5) * 2;
      // a shoulder profile: steep near the peak, flattening out to the plain
      const prof = Math.pow(Math.max(0, 1 - d), 1.7);
      const jag = (rng() - 0.5) * spec.h * 0.06;
      ridge.push([cx - halfW + spec.w * t, baseY - spec.h * prof + jag]);
    }
    const fill = (col, from, to) => {
      ctx.beginPath();
      ctx.moveTo(ridge[from][0], baseY + 60);
      for (let i = from; i <= to; i++) ctx.lineTo(ridge[i][0], ridge[i][1]);
      ctx.lineTo(ridge[to][0], baseY + 60);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
    };
    // find the peak, and split the faces there
    let pk = 0;
    for (let i = 1; i < ridge.length; i++) if (ridge[i][1] < ridge[pk][1]) pk = i;
    ctx.save();
    ctx.globalAlpha = spec.alpha != null ? spec.alpha : 0.92;
    fill(body, 0, ridge.length - 1);
    if (sunSide > 0) { fill(lit, pk, ridge.length - 1); fill(dark, 0, pk); }
    else { fill(lit, 0, pk); fill(dark, pk, ridge.length - 1); }
    // a haze band across its foot, so it sits BEHIND the ridges rather than on
    // the same plane as them
    const hz = ctx.createLinearGradient(0, peakY, 0, baseY + 20);
    hz.addColorStop(0, this._fade(map.pal.skyBot, 0.05));
    hz.addColorStop(1, this._fade(map.pal.skyBot, 0.38));
    ctx.fillStyle = hz;
    ctx.fillRect(cx - halfW - 20, peakY - 10, spec.w + 40, (baseY + 20) - peakY);
    ctx.restore();
  },

  _ridge(ctx, rng, w, baseY, amp, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_H);
    let y = baseY + (rng() - 0.5) * amp;
    ctx.lineTo(0, y);
    for (let x = 0; x <= w; x += 64) {
      const ny = baseY + (rng() - 0.5) * amp * 2;
      ctx.quadraticCurveTo(x + 20, y, x + 64, ny);
      y = ny;
    }
    ctx.lineTo(w, CANVAS_H);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  },

  /* ---------- lane terrain (static, WORLD_W wide) ---------- */
  _buildLane(game, lane) {
    const map = game.map, p = map.pal;
    let c = this.laneLayers[lane];
    if (!c || c.width !== WORLD_W) c = this._makeLayer(WORLD_W, CANVAS_H);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, WORLD_W, CANVAS_H);
    const rng = seeded(map.seed + lane * 131);

    // slab
    ctx.fillStyle = p.laneBody[lane];
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_H);
    ctx.lineTo(0, groundY(map, lane, 0));
    for (let x = 0; x <= WORLD_W; x += 16) ctx.lineTo(x, groundY(map, lane, x));
    ctx.lineTo(WORLD_W, CANVAS_H);
    ctx.closePath(); ctx.fill();

    /* SHADE UNDER THE VEGETATION LINE.
     *
     * The frame measured 114 points of contrast and looked flat anyway, because
     * all of it was in the sky: the GROUND band came in at 54-59 out of 255 on
     * every daylight map. The playfield is where the player looks, and it was a
     * single mid-tone wash with nothing dark in it.
     *
     * A band of shade immediately below each lane's ground line is the cheapest
     * honest way to put a dark back into that band — it is what the treeline and
     * undergrowth behind the lane would actually cast, it separates one lane
     * from the next, and it gives the soldiers something darker than themselves
     * to stand against. Strongest right under the line and gone within ~74px, so
     * it reads as contact shade rather than a painted stripe.
     */
    /* A VALUE RAMP DOWN THE LANE.
     *
     * The frame measured 114 points of contrast and still looked flat, because
     * all of it lived in the sky: the GROUND band came in at 54-59 out of 255 on
     * every daylight map, and the ground is where the player looks.
     *
     * Dark where the lane meets the vegetation behind it, opening up toward the
     * viewer. Drawn as ONE path with ONE gradient: a first attempt filled a
     * separate gradient per 9px column and, because each column started at its
     * own ground height, the gradients stepped against each other and striped
     * the whole field with vertical seams. One path has no seams and is cheaper.
     */
    {
      const strip = (lane < LANE_N - 1)
        ? Math.max(90, LANE_BASE[lane + 1] - LANE_BASE[lane])
        : CANVAS_H - LANE_BASE[lane] + 40;
      let lo = 1e9, hi = -1e9;
      for (let x = 0; x <= WORLD_W; x += 32) {
        const y = groundY(map, lane, x);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, groundY(map, lane, 0));
      for (let x = 0; x <= WORLD_W; x += 12) ctx.lineTo(x, groundY(map, lane, x));
      for (let x = WORLD_W; x >= 0; x -= 12) ctx.lineTo(x, groundY(map, lane, x) + strip);
      ctx.closePath();
      ctx.clip();
      /* Deepened. Measured, the GROUND band spans 62 luminance points while the
       * sky takes 200 — the picture has a bright empty top half and a flat
       * middle where the game actually happens. Ablating the passes that sit
       * over the terrain found no single culprit worth more than 7 points, so
       * the flatness is the ground's own: it is a fill with quiet texture on
       * it, and quiet texture cannot carry a whole band.
       *
       * This ramp is the cheapest place to put the range back, because it is
       * already the thing giving the lane its front-to-back form. Darker where
       * the lane meets the vegetation behind it, and a stronger catch of light
       * at the near edge. */
      const gs = ctx.createLinearGradient(0, lo, 0, hi + strip);
      gs.addColorStop(0, 'rgba(8,11,6,0.78)');
      gs.addColorStop(0.28, 'rgba(9,12,6,0.40)');
      gs.addColorStop(0.62, 'rgba(10,14,7,0.12)');
      gs.addColorStop(0.88, 'rgba(255,244,208,0.05)');
      gs.addColorStop(1, 'rgba(255,240,200,0.11)');
      ctx.fillStyle = gs;
      ctx.fillRect(0, lo, WORLD_W, (hi + strip) - lo);
      ctx.restore();
    }

    /* GROUND PATCHWORK — the ground needs COLOUR variety, not just value.
     *
     * Everything the terrain passes do works in VALUE: the slope shading gives
     * it form, the cloud shadow gives it large-scale movement, the incident pass
     * gives it detail. All of them modulate light on a single hue, so the field
     * came out beautifully lit and monochrome — one green, evenly dyed, from the
     * treeline to the boots.
     *
     * A real field is a patchwork. Ground dries out where it drains and stays
     * lush where it does not; it is scuffed to bare earth where it is walked on
     * and darkens where it holds water. Those are HUE differences, and they are
     * what makes the eye read acres rather than a painted floor.
     *
     * Drawn early, so the slope shading, cloud shadow and incident all land on
     * top and unify it — otherwise the patches read as stains rather than as the
     * ground being different there. Baked, so it costs nothing per frame.
     */
    {
      const base = p.laneBody[lane];
      const kinds = [
        this._tint(base, 34, 30, -12),   // dry, sun-bleached
        this._tint(base, -14, 10, -16),  // lush, holding water
        this._tint(base, 26, 8, -14),    // scuffed to bare earth
        this._tint(base, -26, -14, 6),   // damp and dark
      ];
      /* A map that NAMES its soil gets it in the patchwork, twice over.
       *
       * Cu Chi's whole identity is that two hundred kilometres of tunnel were
       * dug through red laterite, and the palette has carried `soil: #7a4526`
       * to say so — but the only thing that ever painted it was the scour pass,
       * which needs a slope above 0.14, and Cu Chi is flat. The map's defining
       * colour was declared, documented, and never once drawn. */
      if (p.soil) { kinds.push(p.soil, p.soil); }
      const nP = Math.round((WORLD_W / 1280) * 9);
      ctx.save();
      for (let i = 0; i < nP; i++) {
        const cx = rng() * WORLD_W;
        const gy = groundY(map, lane, cx);
        const band = Math.max(60, (lane + 1 < LANE_N
          ? groundY(map, lane + 1, cx) - gy : CANVAS_H - gy));
        const rx = 140 + rng() * 320;
        const ry = band * (0.42 + rng() * 0.55);
        const cy = gy + band * (0.28 + rng() * 0.5);
        const col = kinds[(rng() * kinds.length) | 0];
        const a = 0.11 + rng() * 0.13;
        const g4 = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
        g4.addColorStop(0, this._fade(col, a));
        g4.addColorStop(0.6, this._fade(col, a * 0.62));
        g4.addColorStop(1, this._fade(col, 0));
        ctx.fillStyle = g4;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, ry / rx);
        ctx.translate(-cx, -cy);
        ctx.beginPath();
        ctx.arc(cx, cy, rx, 0, 7);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }

    /* Soil texture: speckles + faint strata under the surface.
     *
     * This was drawn in pure black and white at alpha 0.12 — value-only noise on
     * a same-hue fill, which is to say very nearly invisible, and the reason the
     * ground read as cardboard despite all the work below. Grit is now warm and
     * the pits between it are cool, at roughly twice the amplitude, so the
     * surface survives both the depth haze and the full-screen grade. */
    ctx.save();
    ctx.globalAlpha = 0.22;
    const grit = this._tint(p.laneBody[lane], 46, 30, 12);   // warm, sunlit
    const pit  = this._tint(p.laneBody[lane], -22, -14, 2);  // cool, in shadow
    for (let i = 0; i < WORLD_W / 5; i++) {
      const x = rng() * WORLD_W;
      const y = groundY(map, lane, x) + 6 + rng() * 60;
      ctx.fillStyle = rng() < 0.5 ? pit : grit;
      ctx.fillRect(x, y, 1.6 + rng() * 2.4, 1 + rng() * 1.3);
    }
    ctx.globalAlpha = 0.13;
    ctx.strokeStyle = this._tint(p.laneBody[lane], -26, -20, -8);
    ctx.lineWidth = 1;
    for (let s = 1; s <= 3; s++) {
      ctx.beginPath();
      for (let x = 0; x <= WORLD_W; x += 32) {
        const y = groundY(map, lane, x) + 14 + s * 16 + Math.sin(x * 0.01 + s) * 3;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    /* Surface treatment driven by the ground's own slope. Now that the terrain
     * actually rolls, a single flat fill reads as cardboard: turf stands up on
     * the level, steep ground is scoured back to earth and stone, and water
     * collects in the hollows. All derived from groundY, so it tracks the
     * elevation profile exactly and costs nothing at runtime. */
    ctx.save();
    for (let x = 0; x < WORLD_W; x += 7) {
      const y0 = groundY(map, lane, x);
      const slope = (groundY(map, lane, x + 12) - y0) / 12;
      if (Math.abs(slope) > (p.soil ? 0.07 : 0.14)) {
        /* Scoured ground shows the subsoil. A map may name that soil outright —
         * Cu Chi's red laterite — and where it does, this is where the colour
         * belongs: exposed on the steep bits, with vegetation everywhere else.
         * Painting it into laneBody instead turns the whole map that colour. */
        ctx.globalAlpha = 0.26 + rng() * 0.18;
        ctx.fillStyle = p.soil || this._tint(p.laneBody[lane], 24, 2, -14);
        ctx.fillRect(x, y0 + 1, 7 + rng() * 6, 3 + rng() * 6);
        if (rng() < 0.16) {
          ctx.globalAlpha = 0.34;
          ctx.fillStyle = '#4a4a42';
          ctx.fillRect(x + rng() * 5, y0 + 2 + rng() * 6, 2 + rng() * 3, 1.5 + rng() * 2);
        }
      } else if (rng() < 0.42) {
        /* Standing turf catches the light, so it lifts — but it must not be
         * DYED. A hardcoded +30 green pushed every map toward grass, which is
         * fine on the jungle maps and wrong on Ia Drang, where the palette says
         * dry-season gold (`laneTop: #a8954f`) and the field still came out
         * green. Lift the value, nudge the hue, and let the map's own colour
         * decide what the grass is. */
        ctx.globalAlpha = 0.34 + rng() * 0.26;
        ctx.strokeStyle = this._tint(p.laneTop[lane], 12, 16, -6);
        ctx.lineWidth = 1;
        const h = 2 + rng() * 4;
        ctx.beginPath();
        ctx.moveTo(x, y0 + 1);
        ctx.lineTo(x + (rng() - 0.5) * 3, y0 + 1 - h);
        ctx.stroke();
      }
      // a hollow: ground lower here than either side, so it holds water
      const yl = groundY(map, lane, x - 26), yr = groundY(map, lane, x + 26);
      if (y0 > yl + 2.5 && y0 > yr + 2.5 && rng() < 0.5) {
        ctx.globalAlpha = 0.26;
        ctx.fillStyle = '#5c7d86';
        ctx.beginPath();
        ctx.ellipse(x, y0 + 2, 16 + rng() * 22, 2.4 + rng() * 1.8, 0, 0, 7);
        ctx.fill();
      }
    }
    ctx.restore();

    // dirt trail with wheel ruts along the lane — a worn path is bare earth, so
    // it takes the map's soil colour where one is named
    ctx.save();
    const trailCol = p.soil || this._shade(p.laneTop[lane], 10);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = trailCol;
    ctx.beginPath();
    ctx.moveTo(0, groundY(map, lane, 0) + 3);
    for (let x = 0; x <= WORLD_W; x += 16) ctx.lineTo(x, groundY(map, lane, x) + 3 + Math.sin(x * 0.008 + lane) * 1.5);
    for (let x = WORLD_W; x >= 0; x -= 16) ctx.lineTo(x, groundY(map, lane, x) + 11 + Math.sin(x * 0.011 + lane) * 1.5);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = this._shade(p.laneBody[lane], -18);
    ctx.lineWidth = 1.3;
    for (const off of [5.5, 8.5]) {
      ctx.beginPath();
      for (let x = 0; x <= WORLD_W; x += 20) {
        const y = groundY(map, lane, x) + off + Math.sin(x * 0.009 + lane) * 1.4;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // surface band
    ctx.strokeStyle = p.laneTop[lane];
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(0, groundY(map, lane, 0) + 2);
    for (let x = 0; x <= WORLD_W; x += 16) ctx.lineTo(x, groundY(map, lane, x) + 2);
    ctx.stroke();

    /* BREAK THE LANE EDGE.
     *
     * A lane is a filled slab, so where it meets the lane behind it the join is
     * a single continuous stroke — a ruled line across the whole battlefield.
     * The eye reads a ruled line as a CUT, which is the other half of "the
     * assets and the terrain do not blend": the props were floating on the
     * ground and the ground itself was made of sheets of paper laid over one
     * another.
     *
     * Growth straddling the line fixes it for the same reason base litter fixes
     * a prop: give the eye things that cross the boundary and it stops reading
     * the boundary. Small, dense, and drawn in the lane's own top colour so it
     * reads as the turf itself rather than as scattered objects. */
    ctx.save();
    const edgeLit = this._tint(p.laneTop[lane], 12, 16, -4);
    const edgeDark = this._tint(p.laneTop[lane], -26, -20, -6);
    for (let x = 0; x < WORLD_W; x += 5 + rng() * 9) {
      const gy = groundY(map, lane, x) + 2;
      const h = 2 + rng() * 5;
      ctx.globalAlpha = 0.30 + rng() * 0.34;
      ctx.strokeStyle = rng() < 0.4 ? edgeDark : edgeLit;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, gy + 2);
      ctx.lineTo(x + (rng() - 0.5) * 3.2, gy - h);
      ctx.stroke();
      // the occasional low clump, so the line is not a uniform fringe
      if (rng() < 0.16) {
        ctx.globalAlpha = 0.24 + rng() * 0.22;
        ctx.fillStyle = edgeDark;
        ctx.beginPath();
        ctx.ellipse(x, gy - 1, 3 + rng() * 6, 1.6 + rng() * 2, 0, 0, 7);
        ctx.fill();
      }
    }
    ctx.restore();

    /* SLOPE SHADING — the ground takes its form from the LIGHT.
     *
     * Every map declares `sun: {x, y, r}` and, until now, nothing in the scene
     * read it: the sun was a decorative blob in a sky that lit nothing. So the
     * ground had no form. It had texture — speckles, strata, turf — but texture
     * is not form, and a field with no lit and shaded faces reads as a flat slab
     * however much grit is scattered on it.
     *
     * Ground that tilts toward the light warms and lifts; ground that tilts away
     * cools and drops. Cooling means shifting BLUE UP as red comes down, not just
     * darkening: that is what real shadow does, and on a frame measured at 0.0%
     * of saturated pixels more than 30 degrees off the dominant hue, the shadows
     * are the largest available source of honest colour variety. Derived from
     * groundY, so it tracks the terrain exactly and bakes into the lane layer.
     */
    ctx.save();
    /* One clipped fill with ONE horizontal gradient — never per-column rects.
     *
     * Drawing a rect per column striped the field with a seam every 6px, and
     * smoothing the slope barely dented it (periodic power at 6px: 5.9 before
     * the pass, 74 with it, 61 after smoothing). The seams were never the alpha
     * jumps — they are ANTIALIASED RECT EDGES. Two abutting rects each lay down
     * partial coverage on their shared boundary, so the boundary darkens, and it
     * does that identically 400 times across the lane. No amount of smoothing
     * the input fixes an artefact of the output.
     *
     * A canvas gradient interpolates continuously and has no internal edges at
     * all, so the lit/shaded pattern goes into the STOPS of a single gradient
     * and the whole lane is filled in one go, clipped to its own silhouette.
     * The same mistake, in the same file, produced the striped value ramp that
     * §1.1 records — worth not making a third time. */
    const sunSide = (map.pal.sun && map.pal.sun.x < CANVAS_W / 2) ? -1 : 1;
    const warmRGB = this._tint(p.laneBody[lane], 40, 26, 0);
    const coolRGB = this._tint(p.laneBody[lane], -24, -12, 16);

    // clip to this lane's ground silhouette
    ctx.beginPath();
    ctx.moveTo(0, groundY(map, lane, 0));
    for (let x = 0; x <= WORLD_W; x += 12) ctx.lineTo(x, groundY(map, lane, x));
    ctx.lineTo(WORLD_W, CANVAS_H);
    ctx.lineTo(0, CANVAS_H);
    ctx.closePath();
    ctx.clip();

    const SP = 40;                                 // one gradient stop per 40px
    const nS = Math.ceil(WORLD_W / SP);
    const facing = new Float32Array(nS + 1);
    for (let i = 0; i <= nS; i++) {
      const x = i * SP;
      const slope = (groundY(map, lane, x + 46) - groundY(map, lane, x - 46)) / 92;
      facing[i] = clamp(-slope * sunSide * 3.0, -1, 1);
    }
    let loY = 1e9;
    for (let x = 0; x <= WORLD_W; x += 32) loY = Math.min(loY, groundY(map, lane, x));
    const depth = Math.max(60, (lane + 1 < LANE_N ? LANE_BASE[lane + 1] - LANE_BASE[lane] : CANVAS_H - loY));
    // three horizontal bands: strongest at the ground line, gone by the far edge
    for (const [t0, t1, k] of [[0, 0.34, 1.0], [0.34, 0.66, 0.5], [0.66, 1.0, 0.18]]) {
      const g2 = ctx.createLinearGradient(0, 0, WORLD_W, 0);
      for (let i = 0; i <= nS; i++) {
        const f = facing[i];
        const col = f > 0 ? warmRGB : coolRGB;
        g2.addColorStop(Math.min(1, i / nS), this._fade(col, Math.abs(f) * 0.30 * k));
      }
      ctx.fillStyle = g2;
      ctx.fillRect(0, loY + depth * t0, WORLD_W, depth * (t1 - t0) + 1);
    }
    ctx.restore();

    /* CLOUD SHADOW — the missing scale.
     *
     * Three passes now work on this ground: grit (1-6px), incident (30-150px)
     * and slope shading (terrain-wide). None of them touches the scale in
     * between, and on the open maps that is precisely where the eye rests: Hill
     * 937 and Ia Drang still measured as large uniform sheets of green after all
     * three. Real fields are not uniformly lit — broken cloud lays soft shade
     * across them in patches hundreds of pixels wide, which is the cheapest and
     * most natural way to put slow value movement into open ground.
     *
     * Soft-edged and low-contrast on purpose: this should read as weather, not
     * as stains. Baked with the lane, so it costs nothing per frame. */
    ctx.save();
    const shadeCol = this._tint(p.laneBody[lane], -26, -18, 6);
    const nSh = Math.round((WORLD_W / 1280) * 6);
    for (let i = 0; i < nSh; i++) {
      const cx = rng() * WORLD_W;
      const gy = groundY(map, lane, cx);
      const band = Math.max(60, (lane + 1 < LANE_N
        ? groundY(map, lane + 1, cx) - gy : CANVAS_H - gy));
      const rx = 220 + rng() * 460;
      const ry = band * (0.55 + rng() * 0.5);
      const cy = gy + band * (0.30 + rng() * 0.45);
      // 0.07-0.14 measured as no change at all against the slope shading below
      // (large-scale ground variation 16.44 -> 16.35). Weather you cannot see is
      // not restraint, it is a wasted pass.
      const a = 0.13 + rng() * 0.11;
      const g3 = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
      g3.addColorStop(0, this._fade(shadeCol, a));
      g3.addColorStop(0.55, this._fade(shadeCol, a * 0.72));
      g3.addColorStop(1, this._fade(shadeCol, 0));
      ctx.fillStyle = g3;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      ctx.translate(-cx, -cy);
      ctx.beginPath();
      ctx.arc(cx, cy, rx, 0, 7);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    /* GROUND INCIDENT — features at FIELD scale, not grit scale.
     *
     * Everything above works at 1-6px and hugs the ground LINE: speckles at
     * alpha 0.22, strata at 0.13, turf blades 2-6px tall drawn at y0+1, scour
     * only where the slope exceeds 0.14. Looked at in a captured frame, the
     * lower two thirds of every lane band — the part the player actually looks
     * at — was bare fill. Detail at grit scale cannot fix a problem at field
     * scale, which is what "the ground is still an empty field" was pointing at.
     *
     * Perspective is faked the only way it can be on a side view: a feature
     * nearer the viewer is drawn wider and flatter than one near the treeline.
     * All of it bakes into the lane layer, so none of it costs a frame.
     */
    ctx.save();
    // an irregular closed blob — an ellipse reads as a painted spot, and once
    // you have a dozen of them the repetition is the first thing you see
    const blob = (cx, cy, rx, ry) => {
      ctx.beginPath();
      const n = 7;
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2;
        const j = 0.62 + rng() * 0.60;
        const px = cx + Math.cos(a) * rx * j;
        const py = cy + Math.sin(a) * ry * j;
        k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    };
    // the delta is half water; the highland maps are not
    const wet = map.trees === 'palm' ? 1.0 : (map.trees === 'jungle' ? 0.5 : 0.22);
    const churn = this._tint(p.laneBody[lane], -20, -16, -6);
    // +38 red put these a long way above the field and they read as tan spots
    // however low the alpha went. Dry ground is a shade lighter, not a highlight.
    const dry = this._tint(p.laneBody[lane], 20, 15, 3);
    const water = p.water || '#5c7d86';
    /* The VISIBLE depth of a lane is not its depth to the bottom of the screen.
     * Each lane layer blits full-screen in order, so lane 1's slab paints over
     * everything lane 0 drew below lane 1's ground line. Measured against
     * CANVAS_H the first cut buried most of lane 0's features under the next
     * lane and moved the ground's local detail by 0.6 of a grey level. */
    const visBand = (x) => (lane + 1 < LANE_N
      ? groundY(map, lane + 1, x) - groundY(map, lane, x)
      : CANVAS_H - groundY(map, lane, x));
    const nF = Math.round((WORLD_W / 1280) * 26);
    for (let i = 0; i < nF; i++) {
      const x = rng() * WORLD_W;
      const gy = groundY(map, lane, x);
      const band = Math.max(46, visBand(x));
      const depth = 0.14 + rng() * 0.80;              // 0 at the treeline, 1 at the viewer
      const y = gy + 6 + depth * (band - 14);
      const w = (30 + rng() * 86) * (0.5 + depth);
      const h = w * (0.15 + rng() * 0.11);            // flattened by the viewing angle
      const roll = rng();
      if (roll < 0.16 + 0.30 * wet) {
        /* Standing water is the ONE thing on the ground that can be brighter
         * than the ground, because it returns the sky. That is most of why a
         * paddy reads as a paddy and not as a green field. */
        /* The BODY of standing water is dark — it mostly transmits, and only
         * the rim turns the sky back at you. Filled at -30 off the map's water
         * colour these came out as pale tan ovals lying on the grass, because
         * Mekong's water is a warm sunset `#d78a5e` and a light blob with a
         * defined edge reads as a stain rather than a puddle. */
        ctx.globalAlpha = 0.30 + rng() * 0.18;
        ctx.fillStyle = this._shade(water, -86);
        ctx.beginPath();
        ctx.ellipse(x, y, w * 0.5, h * 0.46, 0, 0, 7);
        ctx.fill();
        ctx.globalAlpha = 0.30 + rng() * 0.22;
        ctx.strokeStyle = water;
        ctx.lineWidth = 1.2;
        ctx.beginPath();                               // sky catches the far rim
        ctx.ellipse(x, y, w * 0.5, h * 0.46, 0, Math.PI * 1.06, Math.PI * 1.94);
        ctx.stroke();
      } else if (roll < 0.74) {
        ctx.globalAlpha = 0.20 + rng() * 0.20;
        ctx.fillStyle = churn;
        blob(x, y, w * 0.5, h * 0.62);
      } else {
        /* Kept well under the churned patches. A LIGHT blob on a dark field
         * reads as a stain the moment it has a defined edge, where a dark one
         * just reads as ground — so the pale ones get about half the strength
         * and stay soft. */
        ctx.globalAlpha = 0.08 + rng() * 0.09;
        ctx.fillStyle = dry;
        blob(x, y, w * 0.62, h * 0.72);
      }
    }
    // vehicle ruts cutting across the band, not along it — a track that runs
    // parallel to the lane just reads as another stripe
    const nR = Math.round((WORLD_W / 1280) * 3);
    for (let i = 0; i < nR; i++) {
      const x0 = 80 + rng() * (WORLD_W - 400);
      const len = 170 + rng() * 300;
      const band = Math.max(46, visBand(x0));
      const d0 = 0.18 + rng() * 0.38, d1 = d0 + 0.08 + rng() * 0.26;
      ctx.globalAlpha = 0.22 + rng() * 0.12;
      ctx.strokeStyle = churn;
      ctx.lineWidth = 2.4;
      for (const off of [-4, 4]) {
        ctx.beginPath();
        for (let t = 0; t <= 1.0001; t += 0.1) {
          const px = x0 + len * t;
          const py = groundY(map, lane, px) + 6 + (d0 + (d1 - d0) * t) * (band - 14) + off * (0.5 + t);
          t === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
    ctx.restore();

    /* RICE PADDIES, on the ground plane.
     *
     * The previous version flooded wherever the terrain dipped below a fixed
     * waterline. The maths was right and it measured well — 63% and 65% of the
     * two lanes under water at 10 and 15 px — and then I measured what actually
     * REACHED THE SCREEN by rendering the map twice, once with `pal.water`
     * deleted, and diffing: 1909 pixels, 0.13% of the frame, on five rows. The
     * whole delta was a scratch. Trees and ground vegetation bake over the top
     * of this block, and there was nothing left of a 10 px band after that.
     *
     * But the deeper fault was the shape, not the paint order. A waterline
     * against an elevation curve gives long sinuous pools — a creek. The map's
     * own description says "rice paddies, canals and raised dikes", and a delta
     * is a CHECKERBOARD: level fields held by earth banks, stepping away from
     * you, each one a mirror. That is a property of the ground plane, and the
     * ground plane is the whole slab from the lane line down, not a band at it.
     *
     * So the fields are bands across the slab, each following the terrain so
     * the dikes run on the contour the way real bunds do, getting taller toward
     * the viewer for perspective. And the water is the SKY, darkened — not the
     * cool grey-blue this used to use. That colour was picked in isolation; laid
     * at 0.72 over green earth it resolves to rgb(58,69,61), a grey-green with
     * G above B, which is why nothing on screen was even blue-ish. A flooded
     * paddy at sunset is a mirror, so it carries the sunset, which also puts it
     * in a completely different hue family from the green field it sits in —
     * and that separation is the entire read at this scale.
     *
     * The nearest band is left as bank rather than water: the player's own
     * foreground stays legible, and men are never wading at the screen edge. */
    if (p.water) {
      const bottom = (lane < LANE_N - 1)
        ? LANE_BASE[lane + 1] + 26
        : CANVAS_H;
      const gY = (x) => groundY(map, lane, x);
      const STEP = 24;
      const cols = [];
      for (let x = 0; x <= WORLD_W; x += STEP) cols.push(x);

      /* Reflected sky, and it has to stay BRIGHT. First attempt mixed 52% toward
       * mud and landed on rgb(120,76,66) — a maroon, which beside green earth
       * reads as a ploughed field, and the delta came out as terracotta
       * terraces. A flooded paddy is a mirror: near enough as bright as the sky
       * it reflects, and BRIGHTER than the land around it. That value inversion
       * is the tell. Only a quarter of the way to mud, and the water now sits
       * above the field in value instead of below it. */
      const wetFar = this._mix(p.skyBot, '#3b3a30', 0.26);
      const wetNear = this._mix(p.skyTop, '#46402f', 0.22);
      /* The bunds were near-black olive and the fields all mirror, so the frame
       * came out as pink corduroy with no green left in it. An earth bank at
       * sunset is a WARM light catching a dry crest, not a dark rule. */
      const bankTop = this._mix(this._tint(p.laneTop[lane], 26, 16, 0), p.skyTop, 0.2);
      const bankFace = this._tint(p.laneBody[lane], 44, 22, 2);
      // standing rice: the crop is what most of a delta actually is
      const cropFar = this._tint(p.brush, -22, -4, -14);
      const cropNear = this._tint(p.brush, 16, 34, -12);

      // band heights grow toward the viewer; the first is a sliver at the
      // vegetation line and the last is the bank under the player's feet
      const h0 = lane === LANE_N - 1 ? 17 : 11;
      const growth = 1.36;
      const bands = [];
      let off = 4, h = h0;
      while (off < bottom - LANE_BASE[lane] && bands.length < 9) {
        bands.push({ o0: off, o1: off + h });
        off += h; h *= growth;
      }
      if (bands.length) bands.pop();          // nearest strip stays dry bank

      /* FIELDS ARE LEVEL. This is the correction that mattered most.
       *
       * Every dike first ran at a fixed offset below groundY, so all of them
       * carried the same undulation and stacked as parallel contour arcs — the
       * frame came out as terraces on a hillside, which is Luzon or Bali, not
       * the Mekong. A paddy is levelled by hand precisely so that it holds an
       * even sheet of water; its bund is near horizontal and the terrain gets
       * absorbed by the field edges, not repeated by every one of them.
       *
       * So each band blends from the ground line toward its own mean, harder
       * the closer it is to the viewer. The top band still hugs the vegetation
       * line, and by the near bands the fields are flat. */
      let gSum = 0;
      for (const x of cols) gSum += gY(x);
      const gMean = gSum / cols.length;
      const ribAt = [];
      bands.forEach((b, k) => {
        b.flat = bands.length < 2 ? 0.5 : 0.18 + 0.74 * (k / (bands.length - 1));
        // field character. Most are planted; one is a bare mirror, which is what
        // sells the water; the last-but-one is the canal named in the briefing.
        /* MOST FIELDS ARE PLANTED. First cut made every band a sky mirror and
         * the entire ground plane went sunset-pink — the green field the map is
         * fought over simply disappeared, which is a worse frame than the one I
         * started from. In the delta the crop is the ground and the water shows
         * BETWEEN the fields: a few flooded and unplanted, one canal, the rest
         * green. That ordering is also what gives the picture three values
         * instead of one — green crop, bright water, warm bund. */
        const r = rng();
        b.kind = (k === bands.length - 2 && lane === LANE_N - 1) ? 'canal'
               : r < 0.26 ? 'mirror' : r < 0.36 ? 'fallow' : 'rice';
      });

      const lineY = (b, x, o) => gY(x) * (1 - b.flat) + gMean * b.flat + o;
      const bandPath = (b, pad) => {
        ctx.beginPath();
        ctx.moveTo(0, lineY(b, 0, b.o0 - pad));
        for (const x of cols) ctx.lineTo(x, lineY(b, x, b.o0 - pad));
        for (let i = cols.length - 1; i >= 0; i--) ctx.lineTo(cols[i], lineY(b, cols[i], b.o1));
        ctx.closePath();
      };

      for (const b of bands) {
        const yTop = LANE_BASE[lane] + b.o0 - 40, yBot = LANE_BASE[lane] + b.o1 + 40;
        ctx.save();
        bandPath(b, 0);
        ctx.clip();

        if (b.kind === 'fallow') {
          // a drained field between flooded ones. Without this the slab is
          // stripes of water and nothing else, and stripes are not a checkerboard
          ctx.fillStyle = this._tint(p.laneBody[lane], 30, 16, -4);
          ctx.fillRect(0, yTop, WORLD_W, yBot - yTop);
          ctx.globalAlpha = 0.3;
          ctx.strokeStyle = this._shade(p.laneBody[lane], -18);
          ctx.lineWidth = 1;
          for (let x = 0; x < WORLD_W; x += 7) {
            const y = lineY(b, x, b.o0 + (b.o1 - b.o0) * (0.3 + rng() * 0.5));
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 5, y + 0.6); ctx.stroke();
          }
          ctx.globalAlpha = 1;
        } else {
          const deep = b.kind === 'canal', planted = b.kind === 'rice';
          const g = ctx.createLinearGradient(0, yTop, 0, yBot);
          if (planted) {
            g.addColorStop(0, cropFar); g.addColorStop(1, cropNear);
          } else {
            g.addColorStop(0, deep ? this._mix(wetFar, '#161b1e', 0.42) : wetFar);
            g.addColorStop(1, deep ? this._mix(wetNear, '#1b1d1c', 0.34) : wetNear);
          }
          ctx.fillStyle = g;
          ctx.fillRect(0, yTop, WORLD_W, yBot - yTop);
          if (planted) {
            // water showing through the crop along the far edge, where the
            // stand thins out against the bund
            ctx.globalAlpha = 0.5;
            const wg = ctx.createLinearGradient(0, yTop, 0, yTop + (b.o1 - b.o0) * 0.7);
            wg.addColorStop(0, wetFar); wg.addColorStop(1, this._fade(wetFar, 0));
            ctx.fillStyle = wg;
            ctx.fillRect(0, yTop, WORLD_W, (b.o1 - b.o0) * 0.7);
            ctx.globalAlpha = 1;
          }

          /* The sheen along the FAR edge, hard against the dike above it.
           * The jump from a dark bank to a hot surface line is what reads as
           * water at this size — more than the hue does. */
          ctx.globalAlpha = deep ? 0.95 : planted ? 0.4 : 0.85;
          ctx.strokeStyle = p.water;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(0, lineY(b, 0, b.o0 + 1.4));
          for (const x of cols) ctx.lineTo(x, lineY(b, x, b.o0 + 1.4));
          ctx.stroke();

          // and the dike's own shadow lying on the water under it
          ctx.globalAlpha = 0.34;
          ctx.strokeStyle = 'rgb(20,24,26)';
          ctx.lineWidth = Math.max(2, (b.o1 - b.o0) * 0.22);
          ctx.beginPath();
          ctx.moveTo(0, lineY(b, 0, b.o0 + 4));
          for (const x of cols) ctx.lineTo(x, lineY(b, x, b.o0 + 4));
          ctx.stroke();

          // broken highlights: a paddy surface is never one flat sheet
          ctx.globalAlpha = planted ? 0.1 : 0.24;
          ctx.fillStyle = p.water;
          for (let x = 0; x < WORLD_W; x += 26) {
            const fy = lineY(b, x, b.o0 + (b.o1 - b.o0) * (0.3 + rng() * 0.55));
            ctx.fillRect(x + rng() * 14, fy, 5 + rng() * 13, 1);
          }

          if (b.kind === 'rice') {
            // rice rooted in the flood, in rows, leaning together
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = this._shade(cropFar, -22);
            ctx.lineWidth = 1;
            const bh = b.o1 - b.o0;
            for (let x = 0; x < WORLD_W; x += 3.4) {
              const base = lineY(b, x, b.o0 + bh * (0.25 + rng() * 0.7));
              const hh = bh * (0.3 + rng() * 0.4);
              ctx.beginPath();
              ctx.moveTo(x, base);
              ctx.lineTo(x + (rng() - 0.5) * 2.4, base - hh);
              ctx.stroke();
            }
          }
        }
        ctx.globalAlpha = 1;
        ctx.restore();

        /* THE DIKE along the field's far edge — raised earth, a lit top and a
         * shadowed face, which is what turns a band of water into a held field.*/
        const dh = Math.max(2.4, (b.o1 - b.o0) * 0.2);
        ctx.beginPath();
        ctx.moveTo(0, lineY(b, 0, b.o0 - dh));
        for (const x of cols) ctx.lineTo(x, lineY(b, x, b.o0 - dh));
        for (let i = cols.length - 1; i >= 0; i--) ctx.lineTo(cols[i], lineY(b, cols[i], b.o0 + dh * 0.5));
        ctx.closePath();
        ctx.fillStyle = bankFace;
        ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = bankTop;
        ctx.lineWidth = Math.max(1, dh * 0.5);
        ctx.beginPath();
        ctx.moveTo(0, lineY(b, 0, b.o0 - dh));
        for (const x of cols) ctx.lineTo(x, lineY(b, x, b.o0 - dh));
        ctx.stroke();
        ctx.globalAlpha = 1;

        /* Where the cross-bunds run. One per band was invisible; a delta is
         * divided every thirty or forty metres, so this is a spacing, not a
         * coin flip — jittered so the grid is hand-made rather than ruled. */
        const gap = 150 + (b.o1 - b.o0) * 3.4;
        for (let x = 90 + rng() * gap; x < WORLD_W - 90; x += gap * (0.7 + rng() * 0.6))
          ribAt.push({ b, x });
      }

      /* CROSS-BUNDS. Without these the slab is horizontal stripes, and stripes
       * read as a striped hillside. The short walls running AWAY from the viewer
       * are what make it a checkerboard of separate fields, and they are the
       * single most identifying thing about delta country. */
      for (const rib of ribAt) {
        const b = rib.b, x = rib.x;
        const y0 = lineY(b, x, b.o0), y1 = lineY(b, x, b.o1);
        // leaning slightly, because a bund seen off-axis is not a vertical line
        const lean = (x - WORLD_W / 2) * 0.006;
        const wTop = Math.max(2.2, (b.o1 - b.o0) * 0.17);
        const wBot = wTop * 2.1;
        ctx.beginPath();
        ctx.moveTo(x - wTop, y0); ctx.lineTo(x + wTop, y0);
        ctx.lineTo(x + wBot + lean, y1); ctx.lineTo(x - wBot + lean, y1);
        ctx.closePath();
        ctx.fillStyle = bankFace; ctx.fill();
        // a bund throws a shadow down-sun across the field it divides; without
        // it these sat flush in the water and could not be seen at all
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = 'rgb(24,26,22)';
        ctx.fillRect(x + wTop, y0, wTop * 1.5, y1 - y0);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = bankTop;
        ctx.beginPath();
        ctx.moveTo(x - wTop * 0.5, y0); ctx.lineTo(x + wTop * 0.5, y0);
        ctx.lineTo(x + wBot * 0.4 + lean, y1); ctx.lineTo(x - wBot * 0.2 + lean, y1);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    /* GROUND DETAIL — objects, not another wash.
     *
     * The playfield measured 62 luminance points of range against 200 for the
     * sky, and deepening the value ramp bought two. That is the lesson: the
     * ground was not flat because it was badly lit, it was flat because there
     * was NOTHING ON IT. Light modulates whatever is there, and a bare plane
     * modulated is still a bare plane.
     *
     * So this puts things on the earth that catch light and cast shade at their
     * own scale — stones, twigs, dry scuff, and the ruts and footfalls of an
     * army that has been walking over it. All baked into the lane layer, so a
     * few hundred marks cost nothing per frame.
     *
     * Sized and spaced off the lane's own depth so the near lane reads coarser
     * than the far one, which is what actually creates the sense of a receding
     * surface rather than a painted backdrop. */
    {
      const dep = LANE_DEPTH[lane];
      const soil = map.pal.soil || this._tint(p.laneBody[lane], 26, 14, 2);
      const lit = this._tint(p.laneTop[lane], 30, 26, 12);
      const dark = this._shade(p.laneBody[lane], -26);

      // TRACKS: paired ruts along the lane where men and vehicles have passed.
      // Long, low-contrast and roughly parallel to the ground line — they read
      // as use, and they give the eye something running across the frame.
      ctx.globalAlpha = 0.16;
      for (let k = 0; k < 3; k++) {
        const off = (6 + k * 9) * dep;
        ctx.strokeStyle = k % 2 ? dark : soil;
        ctx.lineWidth = (1.6 + rng() * 1.4) * dep;
        let on = rng() < 0.5;
        for (let x = 40; x < WORLD_W - 40; x += 26 + rng() * 40) {
          const run = 40 + rng() * 150;
          if (on) {
            ctx.beginPath();
            ctx.moveTo(x, groundY(map, lane, x) + off);
            for (let q = x; q < x + run; q += 22)
              ctx.lineTo(q, groundY(map, lane, q) + off + Math.sin(q * 0.02 + k) * 1.6 * dep);
            ctx.stroke();
          }
          on = !on || rng() < 0.62;
          x += run;
        }
      }

      // SCUFF: irregular patches of drier, paler earth where the turf is worn
      // through. Given real edges rather than soft blobs, because a soft blob
      // is another wash and washes are what failed.
      for (let i = 0; i < 34 * (WORLD_W / 1280); i++) {
        const x = 30 + rng() * (WORLD_W - 60);
        const gy = groundY(map, lane, x) + (3 + rng() * 26) * dep;
        const w = (7 + rng() * 26) * dep, h = w * (0.22 + rng() * 0.2);
        ctx.globalAlpha = 0.10 + rng() * 0.16;
        ctx.fillStyle = rng() < 0.62 ? soil : lit;
        ctx.beginPath();
        const n = 7;
        for (let q = 0; q <= n; q++) {
          const a = (q / n) * 6.283;
          const rr = 0.62 + rng() * 0.5;
          const px = x + Math.cos(a) * w * rr, py = gy + Math.sin(a) * h * rr;
          q ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.fill();
      }

      // STONES AND DEBRIS: small, hard-edged, each with a shadow. These are the
      // only things in the band with a true dark next to a true light, which is
      // what gives the surface its grain.
      for (let i = 0; i < 46 * (WORLD_W / 1280); i++) {
        const x = 24 + rng() * (WORLD_W - 48);
        const gy = groundY(map, lane, x) + (2 + rng() * 30) * dep;
        const r = (0.9 + rng() * 2.4) * dep;
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = 'rgb(16,18,12)';
        ctx.beginPath();
        ctx.ellipse(x + r * 0.5, gy + r * 0.42, r * 1.15, r * 0.42, 0, 0, 7);
        ctx.fill();
        ctx.globalAlpha = 0.62 + rng() * 0.3;
        ctx.fillStyle = rng() < 0.5 ? lit : soil;
        ctx.beginPath();
        ctx.ellipse(x, gy, r, r * 0.72, rng(), 0, 7);
        ctx.fill();
      }

      // TWIGS: a few dozen thin dark strokes, laid flat. Cheap, and they break
      // the last of the emptiness at the scale a boot occupies.
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = dark;
      for (let i = 0; i < 30 * (WORLD_W / 1280); i++) {
        const x = 24 + rng() * (WORLD_W - 48);
        const gy = groundY(map, lane, x) + (4 + rng() * 28) * dep;
        const L = (3 + rng() * 9) * dep, a = (rng() - 0.5) * 1.1;
        ctx.lineWidth = (0.6 + rng() * 0.7) * dep;
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.lineTo(x + Math.cos(a) * L, gy + Math.sin(a) * L * 0.32);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // grass tufts
    ctx.strokeStyle = p.laneTop[lane];
    ctx.lineWidth = 1.2;
    for (let x = 6; x < WORLD_W; x += 8 + rng() * 9) {
      const y = groundY(map, lane, x) + 1;
      const h = 3 + rng() * 4;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + (rng() - 0.5) * 3, y - h);
      ctx.stroke();
    }

    // concealment brush or burn scars
    const zones = game.conceal[lane];
    for (const z of zones) {
      const x0 = z.x0 * WORLD_W, x1 = z.x1 * WORLD_W;
      if (z.burned) {
        ctx.fillStyle = 'rgba(20,16,10,0.55)';
        for (let x = x0; x < x1; x += 14) {
          const y = groundY(map, lane, x);
          ctx.fillRect(x, y - 1, 12, 6);
        }
        ctx.strokeStyle = '#1a140c'; ctx.lineWidth = 1.6;
        for (let x = x0 + 4; x < x1; x += 16 + rng() * 12) {
          const y = groundY(map, lane, x);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rng() - 0.5) * 4, y - (4 + rng() * 6)); ctx.stroke();
        }
      } else {
        for (let x = x0; x < x1; x += 6 + rng() * 7) {
          const y = groundY(map, lane, x) + 1;
          const h = 10 + rng() * 13;
          ctx.strokeStyle = rng() < 0.6 ? p.brush : this._shade(p.brush, -14);
          ctx.lineWidth = 1.6 + rng();
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(x + (rng() - 0.5) * 8, y - h * 0.6, x + (rng() - 0.5) * 10, y - h);
          ctx.stroke();
          // broadleaf accents
          if (rng() < 0.18) {
            ctx.fillStyle = this._shade(p.brush, -8);
            ctx.beginPath();
            ctx.ellipse(x + (rng() - 0.5) * 6, y - h * 0.7, 4 + rng() * 3, 1.6 + rng(), (rng() - 0.5), 0, 7);
            ctx.fill();
          }
        }
      }
    }

    /* Trees, scaled to the wider world — and THINNED, because each one now
     * carries far more mass than the vector blob it replaced.
     *
     * The old `_tree` was a small ring of ellipses; `canopy_a` is a full crown
     * a hundred to two hundred pixels across. Drawing the same 52 of them per
     * lane on Cu Chi turned the playfield into a wall of foliage with the
     * firefight hidden behind it — a fight the player cannot see is worse than
     * a plain field. Two thirds the count, and the NEAR lane thinner still,
     * since that is the one standing between the camera and the battle. */
    const treeK = (typeof Props !== 'undefined' && Props.ready
      && Props.has('canopy_a')) ? (lane === LANE_N - 1 ? 0.42 : 0.66) : 1;
    const density = map.treeDensity * 26 * (WORLD_W / 1280) * treeK;
    for (let i = 0; i < density; i++) {
      const x = 150 + rng() * (WORLD_W - 300);
      const nearFlag = Math.abs(x - map.flags[lane] * WORLD_W) < 46;
      if (nearFlag) continue;
      /* Profile-rendered palms take priority over the painted kit. They come off
       * the same orthographic camera as the soldiers, so the treeline stops being
       * a different drawing from the men standing in it. Four variants, mirrored
       * at random, sized off each prop's authored real height. */
      /* Every map type, not just the two with palms in them.
       *
       * This was gated to `palm` and `jungle`, so Ia Drang — which is
       * `trees: 'grass'` and is NAMED for the elephant grass that famously hid
       * an NVA regiment at twenty metres — received no props whatsoever and was
       * dressed entirely by the vector fallback. A bare lawn with round shrubs
       * on it, for the one battlefield whose defining feature is that you
       * cannot see through the vegetation. */
      if (typeof Props !== 'undefined' && Props.ready) {
        // sparse: a palm is ~4x a man's height, so even a few fill the frame
        // Raised from 0.26/0.16 when the painted palm and banana slices were
        // deleted below — that share has to go somewhere, and props are the
        // whole point. What is left over falls through to the vector _tree.
        const chance = map.trees === 'palm' ? 0.46
          : map.trees === 'jungle' ? 0.30
          : map.trees === 'grass' ? 0.62      // elephant grass: the point of the place
          : 0.24;                              // shattered: stumps, and not many
        if (rng() < chance) {
          /* EIGHT silhouettes, not four, and they arrive in CLUMPS.
           *
           * Four palms scattered on an even random x read as wallpaper — the eye
           * finds the repeat immediately because every tree is the same distance
           * from its neighbour and the same shape family. Real vegetation grows
           * in stands with gaps between them.
           *
           * Bamboo, banana, dead trunks and grass are built procedurally through
           * the same camera (see tools/render_props.py) rather than downloaded,
           * so they cost nothing in licence risk and cannot drift out of style.
           * Weighted so palms still lead and the new shapes accent. */
          const bag = map.trees === 'jungle'
            ? ['palm_a', 'palm_b', 'bamboo_a', 'bamboo_a', 'banana_a', 'deadtree_a',
               'palm_c', 'grass_a']
            : map.trees === 'grass'
            // Ia Drang is a SEA OF GRASS with scattered scrub in it, so the bag
            // is grass eight times over and everything else is an accent.
            ? ['grass_a', 'grass_a', 'grass_a', 'grass_a', 'grass_a', 'grass_a',
               'grass_a', 'grass_a', 'bush_low', 'deadtree_a', 'bamboo_a']
            : map.trees === 'shattered'
            // a hill worked over by artillery: broken trunks and what grew back
            ? ['deadtree_a', 'deadtree_a', 'deadtree_a', 'grass_a', 'bush_low',
               'bamboo_a']
            : ['palm_a', 'palm_b', 'palm_c', 'palm_d', 'bamboo_a', 'banana_a',
               'grass_a', 'deadtree_a'];
          // a clump of 1-4, tighter and more varied than an even scatter
          const clump = 1 + ((rng() * rng() * 4) | 0);
          let ok = false;
          for (let c = 0; c < clump; c++) {
            const pick = bag[(rng() * bag.length) | 0];
            if (!Props.has(pick)) continue;
            const cx = x + (c === 0 ? 0 : (rng() - 0.5) * 128);
            if (cx < 60 || cx > WORLD_W - 60) continue;
            const gy = groundY(map, lane, cx) + 2;
            // wider height spread — a stand has saplings and old growth in it
            const h = Props.pxHeight(pick, LANE_DEPTH[lane]) * (0.58 + rng() * 0.72);
            Props.draw(ctx, pick, cx, gy, LANE_DEPTH[lane],
              { fit: h, flip: rng() < 0.5, alpha: 0.88 + rng() * 0.10 });
            const meta = Props.items[pick] && Props.items[pick].meta;
            const fw = meta ? (meta.wM / Math.max(0.01, meta.hM)) * h : h * 0.5;
            this._baseLitter(ctx, rng, cx, gy, fw * 0.7, map, lane);
            ok = true;
          }
          if (ok) continue;
        }
      }
      /* The painted palm and banana slices that used to mix in here are gone:
       * they were inked line art dropped among flat-shaded props.
       *
       * `_tree` is the last of that family — a vector canopy built from a ring
       * of ellipse lobes in three value passes. Careful code, and it still
       * reads as a bush on a stick, because a ring of ellipses has no branch
       * structure holding it up and no interior. `canopy_a` and `scrub_a` are
       * real trees with a leaning tapered trunk, branches fanning from one
       * point, and leaf mass in separated clumps — the GAPS are what stop a
       * crown being a blob.
       *
       * Kept as the fallback for maps whose tree kind has no prop yet and for
       * the first frames before the prop set finishes loading. */
      const dep = LANE_DEPTH[lane];
      const kind = map.trees === 'grass' || map.trees === 'shattered' ? 'scrub' : 'canopy';
      /* Sized in PIXELS, not from the prop's authored height.
       *
       * `vegH` maps a prop's real metres onto the 84px-per-1.8m soldier scale,
       * which is right for ground cover and wrong here: canopy_a is authored at
       * a truthful 8.5 m, so vegH asks for ~400 px and one tree fills the frame
       * top to bottom. The first render of this buried the entire map under a
       * forest and the sky disappeared.
       *
       * A lane tree is a mid-ground object standing BEHIND the fight, so it is
       * sized to the band it has to occupy — roughly one and a half to three
       * times a man — rather than to its own botany. */
      const th = (104 + rng() * 84) * dep;
      // the near lane's canopy is scenery BEHIND the fight, so it is pushed
      // back in value rather than competing with the men standing in front
      const tAlpha = lane === LANE_N - 1 ? 0.86 : 0.96;
      if (!drawVeg(ctx, kind, 0, x, groundY(map, lane, x) + 2, th,
                   { flip: rng() < 0.5, alpha: tAlpha })) {
        this._tree(ctx, map, rng, x, groundY(map, lane, x) + 2, dep);
      } else if (rng() < 0.55) {
        this._baseLitter(ctx, rng, x, groundY(map, lane, x) + 2, th * 0.5, map, lane);
      }
    }

    // painted ground vegetation baked into the lane
    const vegN = 10 + map.treeDensity * 14;
    for (let i = 0; i < vegN * (WORLD_W / 1280); i++) {
      const x = 120 + rng() * (WORLD_W - 240);
      if (Math.abs(x - map.flags[lane] * WORLD_W) < 60) continue;
      /* A SHELLED PLATEAU IS NOT LEAFY. Khe Sanh and Hill 937 both declare
       * `trees: 'shattered'` — everything standing has been blown apart — and
       * both were being scattered with the same broad-leaved bush and fern as
       * the jungle maps, so the ground under the splintered trunks looked like
       * a garden. On those maps the scatter drops to grass and tufts, which is
       * what actually comes back first on churned ground. */
      const kind = map.trees === 'shattered'
        ? ['tuft', 'grass', 'tuft', 'grass'][Math.floor(rng() * 4)]
        : ['tuft', 'bush', 'fern', 'tuft'][Math.floor(rng() * 4)];
      // sized off the prop's authored real height, so a tuft is ankle-high and a
      // bush is knee-high against a 1.8 m man rather than whatever width the
      // inked slice happened to be
      const vh = vegH(kind, LANE_DEPTH[lane]) * (0.74 + rng() * 0.52);
      const vgy = groundY(map, lane, x) + 2;
      drawVeg(ctx, kind, 0, x, vgy, vh, { alpha: 0.92, flip: rng() < 0.5 });
      if (rng() < 0.5) this._baseLitter(ctx, rng, x, vgy, vh * 0.8, map, lane);
    }

    /* Ground worked by the people who live on it. Data-driven so a map opts in
     * rather than the renderer knowing map names. */
    if (map.dressing === 'tunnels') {
      const nT = Math.round((WORLD_W / 1280) * 5);
      for (let i = 0; i < nT; i++) {
        const tx = 140 + rng() * (WORLD_W - 280);
        if (Math.abs(tx - map.flags[lane] * WORLD_W) < 70) continue;
        this._tunnelMouth(ctx, rng, tx, groundY(map, lane, tx) + 2, map, lane);
      }
    }

    /* THE FIREBASE. Laid out from the defended end outward, which is how the
     * position was actually built: the strip and the bunker line at the back,
     * the trench along the perimeter, then belt after belt of wire pushed out
     * into the approach. The attacker crosses all of it. */
    if (map.dressing === 'firebase') {
      if (lane === 0) this._airstrip(ctx, rng, map, lane, WORLD_W * 0.05, WORLD_W * 0.34);
      this._trenchLine(ctx, rng, map, lane, WORLD_W * 0.14, WORLD_W * 0.27);
      this._wireBelt(ctx, rng, map, lane, WORLD_W * 0.28, WORLD_W * 0.46);
      // an outpost belt further out, where the listening posts were. The first
      // pass put both belts inside the left 42% and the camera spends most of a
      // match past that, so the perimeter was invisible for most of the fight.
      this._wireBelt(ctx, rng, map, lane, WORLD_W * 0.56, WORLD_W * 0.66);
      // revetted positions behind the trench
      if (typeof Props !== 'undefined' && Props.ready && Props.has('sandbag_wall')) {
        for (let i = 0; i < 5; i++) {
          const x = WORLD_W * (0.07 + 0.048 * i) + rng() * 40;
          Props.draw(ctx, i % 2 ? 'sandbag_wall' : 'sandbags_pile', x,
                     groundY(map, lane, x) + 2, 1,
                     { flip: rng() < 0.5, fit: (17 + rng() * 6) * LANE_DEPTH[lane] });
        }
      }
    }

    /* GROUND FOUGHT OVER UNTIL NOTHING GREW ON IT.
     *
     * The slope is the whole of Hill 937 — the mission is to climb it — so the
     * churn is drawn as things that RUN DOWNHILL: slides where the surface came
     * away, runnels cut by the rain, and water standing in every hole. That
     * last one is the specific detail of this battle: it was fought through the
     * monsoon, so the craters were full, and men went up a hill that was
     * sliding back down under them. */
    if (map.dressing === 'churned') {
      const dep = LANE_DEPTH[lane];
      const soil = map.pal.soil || '#6b4a34';
      const n = Math.round(30 * (WORLD_W / 2560));
      for (let i = 0; i < n; i++) {
        const x = 60 + rng() * (WORLD_W - 120);
        const gy = groundY(map, lane, x);
        // a slide: bare earth pulled downhill, wide at the bottom
        const w = (16 + rng() * 46) * dep, h = (7 + rng() * 15) * dep;
        ctx.globalAlpha = 0.34 + rng() * 0.3;
        ctx.fillStyle = soil;
        ctx.beginPath();
        ctx.moveTo(x - w * 0.3, gy + 1);
        ctx.quadraticCurveTo(x - w * 0.5, gy + h * 0.6, x - w * 0.5, gy + h);
        ctx.lineTo(x + w * 0.5, gy + h);
        ctx.quadraticCurveTo(x + w * 0.4, gy + h * 0.5, x + w * 0.28, gy + 1);
        ctx.closePath(); ctx.fill();
        // and the wet gloss on it — mud in rain is not matte
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = this._mix(map.pal.skyBot, '#ffffff', 0.3);
        ctx.beginPath();
        ctx.ellipse(x, gy + h * 0.55, w * 0.34, h * 0.22, 0, 0, 7); ctx.fill();
      }
      // runnels: thin channels the rain cut, all of them going the same way
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = this._shade(soil, -34);
      ctx.lineWidth = 1.2 * dep;
      for (let i = 0; i < n * 1.6; i++) {
        const x = 40 + rng() * (WORLD_W - 80);
        const gy = groundY(map, lane, x), len = (8 + rng() * 22) * dep;
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.quadraticCurveTo(x + (rng() - 0.5) * 6, gy + len * 0.5, x + (rng() - 0.5) * 10, gy + len);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // base dressing: watchtower over the US end, village gate at the VC end
    if (lane === 1) {
      drawTex(ctx, 'watchtower', 0, 88, groundY(map, lane, 88) + 2, 56 * LANE_DEPTH[lane]);
      drawTex(ctx, 'gate', 0, WORLD_W - 92, groundY(map, lane, WORLD_W - 92) + 2, 48 * LANE_DEPTH[lane]);
    }

    // rock outcrops on high ground
    for (let x = 200; x < WORLD_W - 200; x += 90 + rng() * 160) {
      if (elevAt(map, lane, x) > 0.45 && rng() < 0.5) {
        const y = groundY(map, lane, x) + 2;
        const s = 4 + rng() * 7;
        ctx.fillStyle = this._shade(p.laneBody[lane], 26);
        ctx.beginPath();
        ctx.moveTo(x - s, y);
        ctx.lineTo(x - s * 0.4, y - s * 0.9);
        ctx.lineTo(x + s * 0.5, y - s * 0.7);
        ctx.lineTo(x + s, y);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.moveTo(x + s * 0.5, y - s * 0.7); ctx.lineTo(x + s, y); ctx.lineTo(x - s * 0.1, y);
        ctx.closePath(); ctx.fill();
      }
    }

    /* GROUND THAT HAS BEEN SHELLED.
     *
     * Seven flat dark ellipses per lane, which on a 2560px world is one crater
     * every 366px — and each was a shadow with a thin rim, so even those seven
     * read as puddles. Khe Sanh took artillery every day for seventy-seven days
     * and Hill 937 was prepped by air and gun before each of eleven assaults;
     * on both, churned ground is not decoration, it IS the terrain, and it is
     * also what fills the empty stretches these two maps are made of.
     *
     * A crater reads from three parts, and the old one had one of them: the
     * BOWL in shadow, the LIP of pale subsoil thrown up around it, and the
     * SPRAY of ejecta trailing away downwind. The lip is the part that matters
     * — fresh subsoil is lighter than the surface it came out of, so a crater
     * is a bright ring with a dark centre, not a dark smudge. */
    if (map.trees === 'shattered') {
      const heavy = map.dressing === 'firebase' || map.mode === 'assault';
      const n = Math.round((heavy ? 26 : 11) * (WORLD_W / 2560));
      const soil = this._tint(p.laneTop[lane], 34, 26, 14);
      for (let i = 0; i < n; i++) {
        const x = 140 + rng() * (WORLD_W - 280);
        const y = groundY(map, lane, x);
        const sz = (6 + rng() * 16) * LANE_DEPTH[lane];
        // ejecta first, so the lip is drawn over its inner end
        ctx.fillStyle = this._fade(soil, 0.3);
        for (let k = 0; k < 7; k++) {
          const a = (rng() - 0.5) * 3.4, d = sz * (1.1 + rng() * 1.9);
          ctx.beginPath();
          ctx.ellipse(x + Math.cos(a) * d, y + 1 + Math.sin(a) * d * 0.22,
                      1.4 + rng() * 2.6, 0.9 + rng() * 1.2, 0, 0, 7);
          ctx.fill();
        }
        // the lip: pale subsoil, brightest on the sun side
        ctx.fillStyle = soil;
        ctx.beginPath();
        ctx.ellipse(x, y + 1, sz * 1.22, sz * 0.4, 0, 0, 7); ctx.fill();
        ctx.fillStyle = this._fade('#fff2d2', 0.12);
        ctx.beginPath();
        ctx.ellipse(x, y - 0.6, sz * 1.16, sz * 0.36, 0, Math.PI, 0); ctx.fill();
        // the bowl
        ctx.fillStyle = 'rgba(14,11,7,0.62)';
        ctx.beginPath(); ctx.ellipse(x, y + 1.6, sz * 0.86, sz * 0.3, 0, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(x, y + 0.4, sz * 0.8, sz * 0.24, 0, Math.PI, 0); ctx.fill();
        /* IN THE MONSOON THEY FILL. Hill 937 was fought in the rain for ten
         * days; a shell hole there is not a dry bowl, it is a pool holding a
         * disc of grey sky, and that is the brightest thing on a mud slope. */
        if (map.weather && map.weather.rain && rng() < 0.72) {
          ctx.fillStyle = this._mix(map.pal.skyBot, '#2e3330', 0.42);
          ctx.beginPath();
          ctx.ellipse(x, y + 1.9, sz * 0.62, sz * 0.2, 0, 0, 7); ctx.fill();
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = this._mix(map.pal.skyBot, '#ffffff', 0.25);
          ctx.beginPath();
          ctx.ellipse(x - sz * 0.12, y + 1.6, sz * 0.34, sz * 0.09, 0, 0, 7); ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }

    this._usBaseWorks(ctx, map, lane, rng);
    this._vcBaseWorks(ctx, map, lane, rng);

    // Near-lane depth tint — the FRONT lane, whichever index that now is.
    // Hardcoded as `lane === 2`, this quietly became dead code when LANE_N
    // dropped to 2 and the nearest lane stopped being index 2.
    if (lane === LANE_N - 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.beginPath();
      ctx.moveTo(0, CANVAS_H); ctx.lineTo(0, groundY(map, lane, 0));
      for (let x = 0; x <= WORLD_W; x += 16) ctx.lineTo(x, groundY(map, lane, x));
      ctx.lineTo(WORLD_W, CANVAS_H); ctx.closePath(); ctx.fill();
    }

    this.laneLayers[lane] = c;
    this.dirty[lane] = false;
  },

  _sandbags(ctx, x, y, rows, perRow, rng) {
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < perRow - (r % 2); i++) {
        ctx.fillStyle = r % 2 ? '#94825e' : '#8a7a58';
        ctx.beginPath();
        ctx.ellipse(x + i * 11 + (r % 2) * 5, y - 3 - r * 5.4, 6, 3.2, 0, 0, 7);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
  },

  _usBaseWorks(ctx, map, lane, rng) {
    const gy = groundY(map, lane, 40);
    // sandbag emplacement
    this._sandbags(ctx, 14, gy, 3, 5, rng);
    // tent behind
    const ty = groundY(map, lane, 96);
    ctx.fillStyle = '#5a6148';
    ctx.beginPath();
    ctx.moveTo(78, ty); ctx.lineTo(96, ty - 16); ctx.lineTo(114, ty); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.moveTo(96, ty - 16); ctx.lineTo(114, ty); ctx.lineTo(104, ty); ctx.closePath(); ctx.fill();
    // crates
    ctx.fillStyle = '#6b5a38';
    ctx.fillRect(120, ty - 7, 9, 7);
    ctx.fillRect(131, ty - 5, 7, 5);
    if (lane === 1) {
      // watchtower
      const tx = 62, tyy = groundY(map, lane, tx);
      ctx.strokeStyle = '#4a3f2c'; ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(tx - 8, tyy); ctx.lineTo(tx - 6, tyy - 34);
      ctx.moveTo(tx + 8, tyy); ctx.lineTo(tx + 6, tyy - 34);
      ctx.moveTo(tx - 8, tyy - 12); ctx.lineTo(tx + 8, tyy - 16);
      ctx.stroke();
      ctx.fillStyle = '#55492f';
      ctx.fillRect(tx - 10, tyy - 40, 20, 7);
      ctx.fillStyle = '#3d3524';
      ctx.beginPath();
      ctx.moveTo(tx - 12, tyy - 40); ctx.lineTo(tx, tyy - 48); ctx.lineTo(tx + 12, tyy - 40);
      ctx.closePath(); ctx.fill();
    }
    if (lane === 0) {
      // radio mast
      const mx = 30, my = groundY(map, lane, mx);
      ctx.strokeStyle = '#2c2c28'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx - 3, my - 42); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx - 3, my - 42); ctx.lineTo(mx + 6, my - 30); ctx.stroke();
    }
  },

  _vcBaseWorks(ctx, map, lane, rng) {
    const bx = WORLD_W - 60;
    const gy = groundY(map, lane, bx);
    // hooch on stilts with thatch roof
    ctx.strokeStyle = '#4a3c26'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx - 14, gy); ctx.lineTo(bx - 14, gy - 10);
    ctx.moveTo(bx + 14, gy); ctx.lineTo(bx + 14, gy - 10);
    ctx.stroke();
    ctx.fillStyle = '#5c4a2e';
    ctx.fillRect(bx - 17, gy - 16, 34, 7);
    ctx.fillStyle = '#8a7443';
    ctx.beginPath();
    ctx.moveTo(bx - 21, gy - 15); ctx.lineTo(bx, gy - 30); ctx.lineTo(bx + 21, gy - 15);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(bx - 21 + i * 5, gy - 15 - i * 2.8);
      ctx.lineTo(bx + 21 - i * 5, gy - 15 - i * 2.8);
      ctx.stroke();
    }
    // mound + posts (tunnel head)
    const my = groundY(map, lane, WORLD_W - 26);
    ctx.fillStyle = '#3a3222';
    ctx.beginPath(); ctx.ellipse(WORLD_W - 26, my - 2, 16, 6, 0, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = '#2c2618'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(WORLD_W - 40, my); ctx.lineTo(WORLD_W - 40, my - 12);
    ctx.moveTo(WORLD_W - 12, my); ctx.lineTo(WORLD_W - 12, my - 12);
    ctx.stroke();
    // rice baskets
    ctx.fillStyle = '#7a6538';
    ctx.beginPath(); ctx.ellipse(bx - 30, gy - 3, 4, 3.4, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bx - 38, gy - 2.4, 3.2, 2.8, 0, 0, 7); ctx.fill();
  },

  _shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
    return `rgb(${r},${g},${b})`;
  },

  /* Per-channel version of _shade. _shade moves R, G and B by the same amount,
   * which changes value and nothing else — so every terrain pass built on it
   * landed on the exact hue of the fill underneath and disappeared into it. Real
   * ground does not work that way: exposed subsoil runs warmer than the turf
   * over it, and shaded hollows run cooler. Shifting channels independently is
   * what lets the texture read at all. */
  _tint(hex, dr, dg, db) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${clamp((n >> 16) + dr, 0, 255)},${clamp(((n >> 8) & 255) + dg, 0, 255)},${clamp((n & 255) + db, 0, 255)})`;
  },

  /* Blend two colours. Aerial perspective, reflected sky and wet earth all want
   * "this colour, most of the way toward that one", which neither _shade (value
   * only) nor _tint (fixed offsets) can express. Accepts #hex or rgb()/rgba().*/
  _mix(a, b, k) {
    const rd = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (m) { const q = m[1].split(',').map(parseFloat); return [q[0], q[1], q[2]]; }
      const n = parseInt(c.slice(1), 16);
      return [n >> 16, (n >> 8) & 255, n & 255];
    };
    const A = rd(a), B = rd(b);
    return `rgb(${(A[0] + (B[0] - A[0]) * k) | 0},${(A[1] + (B[1] - A[1]) * k) | 0},${(A[2] + (B[2] - A[2]) * k) | 0})`;
  },

  /* Scale a colour's ALPHA, keeping its hue. Aerial perspective needs the map's
   * haze colour at a dozen strengths down a gradient, and the palettes store it
   * as an `rgba(...)` string. Accepts rgba(), rgb() and #hex. */
  _fade(col, k) {
    const m = /rgba?\(([^)]+)\)/.exec(col);
    if (m) {
      const q = m[1].split(',').map((v) => parseFloat(v));
      const a = q.length > 3 ? q[3] : 1;
      return `rgba(${q[0] | 0},${q[1] | 0},${q[2] | 0},${(a * k).toFixed(3)})`;
    }
    const n = parseInt(col.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${k.toFixed(3)})`;
  },

  /* Vector trees, for the share of the treeline the prop scatter does not take.
   *
   * These were flat single-colour silhouettes: the jungle tree was a stick plus
   * three filled ellipses, which at lane scale is a lollipop, and the grass-map
   * tree was a stick plus one wide ellipse — a mushroom. Standing beside props
   * that carry a full lit-and-shaded canopy they were the weakest art left in
   * the frame, and most obvious on Cu Chi, the best-looking map.
   *
   * A canopy reads because of VALUE, not outline: a shaded underside, a mass,
   * and a crown catching the light — the same three-part treatment the clouds
   * and the props use, so all three finally agree about where the sun is. Baked
   * into the lane layer, so the extra lobes cost nothing per frame.
   */
  _tree(ctx, map, rng, x, y, depth) {
    const t = map.trees, col = map.pal.tree;
    const dark = this._shade(col, -16);
    const lit = this._tint(col, 34, 30, 8);
    const sunSide = (map.pal.sun && map.pal.sun.x < CANVAS_W / 2) ? -1 : 1;
    const s = depth * (0.7 + rng() * 0.55);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.strokeStyle = col; ctx.fillStyle = col;

    // a canopy built from many small lobes, in three value passes
    const canopy = (cx, cy, rx, ry, n) => {
      const lobes = [];
      for (let i = 0; i < n; i++) {
        const a2 = (i / n) * Math.PI * 2 + rng() * 0.5;
        const rr = 0.45 + rng() * 0.55;
        lobes.push({
          x: cx + Math.cos(a2) * rx * rr * 0.9,
          y: cy + Math.sin(a2) * ry * rr,
          r: (rx * 0.34) * (0.6 + rng() * 0.6),
        });
      }
      const pass = (fill, dx, dy, k) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        for (const l of lobes) ctx.ellipse(l.x + dx, l.y + dy, l.r * k, l.r * k * 0.78, 0, 0, 7);
        ctx.fill();
      };
      pass(dark, 0, ry * 0.22, 1.0);                       // shaded underside
      pass(col, 0, 0, 0.98);                               // the mass
      pass(lit, sunSide * rx * 0.13, -ry * 0.20, 0.62);    // crown in the light
    };

    if (t === 'palm') {
      const lean = (rng() - 0.5) * 16;
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = dark;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(lean * 0.4, -30, lean, -52); ctx.stroke();
      ctx.lineWidth = 2.4;
      for (let i = 0; i < 7; i++) {
        const a2 = -Math.PI / 2 + (i - 3) * 0.38;
        ctx.strokeStyle = (i % 2) ? col : dark;
        ctx.beginPath();
        ctx.moveTo(lean, -52);
        ctx.quadraticCurveTo(lean + Math.cos(a2) * 14, -52 + Math.sin(a2) * 14 - 4,
          lean + Math.cos(a2) * 24, -52 + Math.sin(a2) * 24 + 7);
        ctx.stroke();
      }
      // a little crown mass so the head is not just six lines
      ctx.fillStyle = lit;
      ctx.beginPath(); ctx.ellipse(lean + sunSide * 2, -54, 6, 3.4, 0, 0, 7); ctx.fill();
    } else if (t === 'jungle') {
      ctx.lineWidth = 4;
      ctx.strokeStyle = dark;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo((rng() - 0.5) * 6, -34); ctx.stroke();
      canopy(0, -44, 22 + rng() * 10, 14 + rng() * 6, 7);
    } else if (t === 'shattered') {
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = dark;
      const lean = (rng() - 0.5) * 22;
      const h = 20 + rng() * 26;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(lean, -h); ctx.stroke();
      if (rng() < 0.6) {
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(lean * 0.6, -h * 0.6); ctx.lineTo(lean * 0.6 + 10, -h * 0.6 - 6); ctx.stroke();
      }
      // survivors keep a thin ragged crown, which is what a stripped hill looks
      // like — not every trunk is bare
      if (rng() < 0.34) canopy(lean, -h - 5, 11 + rng() * 6, 6 + rng() * 4, 5);
    } else {
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = dark;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(2, -26); ctx.stroke();
      canopy(2, -32, 17 + rng() * 7, 7 + rng() * 4, 6);
    }
    ctx.restore();
  },

  /* ---------- baked decals (persistent battlefield state) ---------- */
  bakeDecal(map, lane, x, type, size) {
    if (this.decalUsed) this.decalUsed[lane] = true;
    const layer = this.decalLayers[lane];
    if (!layer) return;
    const ctx = layer.getContext('2d');
    /* The layer is cropped to the ground band, so shift it and let every draw
     * below keep using absolute world/screen y. setTransform rather than
     * save/translate/restore because these bakes have early returns and a
     * missed restore would corrupt every later decal. */
    ctx.setTransform(1, 0, 0, 1, 0, -(this.decalTop[lane] || 0));
    const y = groundY(map, lane, x);
    if (type === 'crater') {
      ctx.fillStyle = 'rgba(18,14,9,0.6)';
      ctx.beginPath(); ctx.ellipse(x, y + 2, size, size * 0.32, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(60,48,30,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y + 1, size * 1.1, size * 0.36, 0, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = 'rgba(40,32,20,0.5)';
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(x + rand(-size * 1.6, size * 1.6), y + rand(-2, 5), rand(1, 2.5), rand(1, 2));
      }
    } else if (type === 'scorch') {
      ctx.fillStyle = 'rgba(12,10,7,0.5)';
      ctx.beginPath(); ctx.ellipse(x, y + 2, size, size * 0.22, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(8,7,5,0.35)';
      for (let i = 0; i < 8; i++) {
        const px = x + rand(-size, size);
        ctx.beginPath(); ctx.ellipse(px, y + rand(0, 4), rand(3, 9), rand(1, 2.4), 0, 0, 7); ctx.fill();
      }
    } else if (type === 'blood') {
      ctx.fillStyle = 'rgba(90,26,16,0.5)';
      ctx.beginPath(); ctx.ellipse(x + rand(-2, 2), y + 3, size, size * 0.3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(70,18,10,0.55)';
      ctx.beginPath(); ctx.ellipse(x, y + 3, size * 0.5, size * 0.16, 0, 0, 7); ctx.fill();
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(x + rand(-size * 1.8, size * 1.8), y + rand(0, 5), rand(0.8, 2), rand(0.8, 1.6));
      }
    } else if (type === 'casing') {
      ctx.fillStyle = 'rgba(176,141,62,0.85)';
      ctx.fillRect(x, y + rand(1, 4), 1.8, 0.9);
    } else if (type === 'drip') {
      ctx.fillStyle = 'rgba(90,24,14,0.5)';
      ctx.beginPath(); ctx.ellipse(x, y + 2, rand(0.8, 1.6), rand(0.5, 0.9), 0, 0, 7); ctx.fill();
    } else if (type === 'splatter') {
      ctx.fillStyle = 'rgba(80,20,12,0.55)';
      ctx.beginPath(); ctx.ellipse(x, y + 3, size * 1.3, size * 0.4, 0, 0, 7); ctx.fill();
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = `rgba(${70 + rand(0, 30)},20,12,${rand(0.35, 0.6)})`;
        ctx.beginPath();
        ctx.ellipse(x + rand(-size * 2.4, size * 2.4), y + rand(-1, 6), rand(1, 3.4), rand(0.7, 1.6), 0, 0, 7);
        ctx.fill();
      }
      // scattered dark fragments — kept abstract
      ctx.fillStyle = 'rgba(40,34,26,0.7)';
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(x + rand(-size * 2, size * 2), y + rand(-2, 4), rand(1.4, 3), rand(1, 2));
      }
    }
  },

  bakeCorpse(map, u, opts = {}) {
    const layer = this.decalLayers[u.lane];
    if (!layer) return;
    if (this.decalUsed) this.decalUsed[u.lane] = true;
    if (this.corpseCount[u.lane] > 60) return;
    this.corpseCount[u.lane]++;
    const ctx = layer.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, -(this.decalTop[u.lane] || 0));
    const scale = LANE_DEPTH[u.lane] * (u.sj || 1);
    this.bakeDecal(map, u.lane, u.x, 'blood', 7 * scale);
    if (opts.gibbed) {
      this.bakeDecal(map, u.lane, u.x, 'splatter', 6 * scale);
      return;
    }
    // rigged puppet corpse — the fallen pose, baked in place
    if (typeof Sprite3D !== 'undefined' && Sprite3D.enabled && Sprite3D.has(u.key)) {
      Sprite3D.drawCorpse(ctx, u.key,
        { x: u.x, y: u.y + 1, dir: u.dir, scale, wounded: u.wounded,
          gaitOff: u.gaitOff, dieLean: u.dieLean });
    } else if (typeof Rig !== 'undefined' && Rig.enabled) {
      Rig.drawCorpse(ctx, u.key, { x: u.x, y: u.y + 1, dir: u.dir, scale, wounded: u.wounded });
      return;
    }
    const sk = UNIT_SPRITES[u.key];
    const sheet = (typeof Assets !== 'undefined') && Assets.done && sk ? Assets.sheet(sk) : null;
    if (sheet) {
      // the corpse matches the last frame of the death sequence he just played
      const dAnim = !u.wounded && DEATH_ANIMS[sk];
      const dSeq = dAnim && Assets.anim(dAnim);
      let name = sheet.poses.fallen, s = spriteScaleFor(u.key, sheet, scale);
      if (dSeq && dSeq.length) {
        name = dSeq[dSeq.length - 1];
        const am = Assets.animMeta(dAnim);
        if (am && am.standH) s = (SPRITE_STAND_H / am.standH) * scale;
      }
      const img = Assets.img(name), m = Assets.meta(name);
      if (img && m) {
        ctx.save();
        ctx.translate(u.x, u.y + 1);
        ctx.rotate(rand(-0.05, 0.05));
        ctx.scale(u.dir * s, s);
        ctx.globalAlpha = 0.88;
        ctx.drawImage(img, -m.ax, -m.ay);
        ctx.restore();
        return;
      }
    }
    // vector fallback corpse
    ctx.save();
    ctx.translate(u.x, u.y);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = SOLDIER_COLORS[u.key] ? SOLDIER_COLORS[u.key].coat : '#3a4230';
    ctx.beginPath(); ctx.ellipse(0, -2, 11 * scale, 3.2 * scale, 0, 0, 7); ctx.fill();
    ctx.restore();
  },

  /* ---------- per-frame ---------- */
  render(game, ui, time) {
    const ctx = this.ctx, map = game.map, fx = game.fx;
    const camX = Camera.x;
    this._fdt = clamp(time - (this._lastT || time), 0, 0.05);
    this._time = time;   // muzzlePoint needs the same clock the unit draw used
    this._perfSample(time);
    this._adaptScale(this._fdt || 0.016);
    // time of day is a map property; night changes how light is composited
    this._night = map.tod === 'night';
    this._nightK = this._night ? 0.88 : 0;
    this._lights = this._night ? [] : this._lights;
    if (this._night) this._lights.length = 0;
    this._lastT = time;
    this._ui = ui;
    const K = this._k || 1;
    ctx.setTransform(K, 0, 0, K, 0, 0);
    ctx.imageSmoothingEnabled = true;
    // 'high' forces a much slower resample on every scaled blit. Sprites are
    // downscales of already-antialiased renders, so bilinear is indistinguishable
    // here and materially cheaper.
    ctx.imageSmoothingQuality = 'low';
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    /* Sky and parallax. The parallax layers are wider than the screen, and
     * blitting them whole made the driver sample ~2.5 megapixels a frame that
     * were then thrown away off-screen. Source-rect them to the visible window,
     * exactly as the lane layers already do. */
    ctx.drawImage(this.sky, 0, 0);
    this._blitStrip(ctx, this.farLayer, camX * this.FAR_PARA);
    this._drawClouds(ctx, time, camX, map);
    this._blitStrip(ctx, this.midLayer, camX * this.MID_PARA);

    ctx.save();
    let shx = 0, shy = 0;
    if (fx.shake > 0.2) {
      // biased along the blast direction rather than pure noise — a shell that
      // lands to your left should shove the camera left
      const b = fx.shake * 0.62, j = fx.shake * 0.38;
      shx = (fx.shakeX || 0) * b + rand(-j, j);
      shy = (fx.shakeY || 0) * b + rand(-j, j);
    }
    ctx.translate(-camX + shx, shy);

    const sx = Math.max(0, Math.floor(camX) - 8), sw = Math.min(WORLD_W - sx, CANVAS_W + 16);
    for (let lane = 0; lane < LANE_N; lane++) {
      if (this.dirty[lane]) this._buildLane(game, lane);
      ctx.drawImage(this.laneLayers[lane], sx, 0, sw, CANVAS_H, sx, 0, sw, CANVAS_H);
      // an untouched decal layer is transparent — skip the full-screen blit
      if (this.decalUsed && this.decalUsed[lane]) {
        // cropped layer: source y starts at 0, destination y at its offset
        const dTop = this.decalTop[lane] || 0;
        const dh = CANVAS_H - dTop;
        ctx.drawImage(this.decalLayers[lane], sx, 0, sw, dh, sx, dTop, sw, dh);
      }
      if (ui && ui.hoverLane === lane && (ui.armedUnit || ui.armedCallin)) {
        this._laneGlow(ctx, game, lane, time, sx, sw);
      }
      this._drawStructures(ctx, game, lane, time);
      this._drawCovers(ctx, game, lane, time);
      this._drawEmplacements(ctx, game, lane, time);
      this._drawFlag(ctx, game, lane, time);
      this._drawUnits(ctx, game, lane, time);
      this._drawNades(ctx, game, lane);
      this._drawSquadMarkers(ctx, game, lane, time);
      this._drawRank(ctx, game, lane);
      this._drawFires(ctx, game, lane, time);
      this._drawSmoke(ctx, game, lane, time);
      this._laneHaze(ctx, map, lane);
    }

    this._drawStrikes(ctx, game, time);
    this._drawParticles(ctx, fx, camX);
    /* VALLEY LIGHT — the air itself, lit.
     *
     * Reference art of this kind is built on one relationship: a near-black
     * foreground framing a bright, hazy middle distance, so the eye falls
     * through the dark into the light. Measured, the game had 46 grey levels
     * between the two where the look wants 60+, because the mid distance was
     * merely *unshaded* rather than actively LIT.
     *
     * A soft band of the sun's own colour laid over the middle of the frame in
     * `lighter`, brightest under the sun and falling away with distance from
     * it. Not a vignette in reverse — it is keyed to where the light is coming
     * from, so it reads as haze catching the sun rather than as a glow effect.
     */
    if (!this._night && map.pal.sun) {
      const su = map.pal.sun;
      /* Filled over the FULL height, not a band.
       *
       * A 330px-tall rect clipped the radial gradient long before it faded, so
       * the effect arrived with a hard horizontal seam ruled across the whole
       * sky — a glow with a visible box around it. The gradient already reaches
       * zero on its own; it just has to be given the room to. */
      const vg = ctx.createRadialGradient(su.x, 430, 30, su.x, 430, CANVAS_W * 0.72);
      vg.addColorStop(0, this._fade(su.color, 0.13));
      vg.addColorStop(0.45, this._fade(su.color, 0.06));
      vg.addColorStop(1, this._fade(su.color, 0));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = vg;
      ctx.fillRect(camX - 4, 0, CANVAS_W + 8, CANVAS_H);
      ctx.restore();
    }
    this._drawForeground(ctx, camX);
    this._drawNight(ctx, game, map);
    if (ui) this._drawTargeting(ctx, game, ui);
    this._drawFloaters(ctx, fx);
    ctx.restore();

    this._drawWeather(ctx, map, time);
    /* AERIAL PERSPECTIVE, not a flat veil.
     *
     * This used to be `fillRect(0, 0, CANVAS_W, CANVAS_H)` with the map's haze
     * colour at its full 0.13-0.20 alpha — one opaque sheet of a single hue over
     * every pixel in the frame, foreground included. Measured on captured
     * frames, it was the main reason the palettes never reached the screen:
     * Ia Drang and Mekong ended up with 0.0% of their saturated pixels more than
     * 30 degrees off the dominant hue, on palettes deliberately built with 195
     * and 125 degree spreads.
     *
     * Haze is a function of DISTANCE. It belongs on the ridge line and the far
     * treeline, and it does not belong on the grass at the player's feet. Keyed
     * to depth it stops flattening the palette and starts doing the job it was
     * named for — pushing the background back. */
    if (map.pal.haze && !this._night) {
      const hz = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
      hz.addColorStop(0, map.pal.haze);            // sky: fully distant
      hz.addColorStop(0.42, map.pal.haze);         // the ridge line and treeline
      hz.addColorStop(0.62, this._fade(map.pal.haze, 0.45));
      hz.addColorStop(0.80, this._fade(map.pal.haze, 0.12));
      hz.addColorStop(1, this._fade(map.pal.haze, 0));
      ctx.fillStyle = hz;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
    /* Colour grade. Warm lift in the highlights, cool weight in the shadows —
     * the cheapest way to make a frame read as one photograph rather than a set
     * of separately-drawn layers. Two blends, no per-pixel work. */
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = this._night ? 'rgba(150,164,200,0.10)' : 'rgba(214,206,178,0.16)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.globalCompositeOperation = 'lighter';
    const gg = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    if (this._night) {
      gg.addColorStop(0, 'rgba(28,44,92,0.10)');
      gg.addColorStop(1, 'rgba(10,16,34,0.06)');
    } else {
      gg.addColorStop(0, 'rgba(96,74,36,0.13)');
      gg.addColorStop(0.55, 'rgba(40,36,22,0.04)');
      gg.addColorStop(1, 'rgba(18,26,40,0.09)');
    }
    ctx.fillStyle = gg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.restore();
    if (fx.flash > 0) {
      ctx.fillStyle = `rgba(255,220,150,${fx.flash})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
    // vignette
    const v = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H * 0.46, CANVAS_H * 0.5, CANVAS_W / 2, CANVAS_H * 0.5, CANVAS_H * 1.0);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    // lighter at night: the vignette is one more compressive veil on the map
    // that has the least contrast left to give
    v.addColorStop(1, this._night ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.28)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    /* The bottom edge falls into shadow.
     *
     * Reference art of this genre is built on one relationship: near-black
     * foreground framing a bright middle distance, so the eye falls through the
     * dark into the light. Shading the foreground PLANTS got the separation from
     * 46 to 55 grey levels and stalled, because the band is mostly GROUND and
     * the ground was not shaded at all.
     *
     * Only below the near lane's ground line, which is scenery rather than
     * playable space — darkening the lane itself would hide the fight that is
     * the entire point of the frame. */
    const nearY = LANE_BASE[LANE_N - 1] + 34;
    if (nearY < CANVAS_H) {
      const fg = ctx.createLinearGradient(0, nearY, 0, CANVAS_H);
      fg.addColorStop(0, 'rgba(0,0,0,0)');
      fg.addColorStop(1, this._night ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.42)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, nearY, CANVAS_W, CANVAS_H - nearY);
    }

    this.drawMinimap(game);
    if (this.showPerf) this._drawPerf(ctx, game);
  },

  _drawClouds(ctx, time, camX, map) {
    const sun = map && map.pal.sun;
    for (const c of this.clouds) {
      const wx = (c.x + time * c.sp) % (WORLD_W + 400) - 200;
      const x = wx - camX * c.para;
      if (x < -420 || x > CANVAS_W + 420) continue;
      // which way the light comes from, so every cloud is lit consistently
      const lit = sun ? Math.sign(sun.x - (x + CANVAS_W * 0)) || 1 : 1;
      // the shadowed underside first, offset away from the light
      ctx.fillStyle = `rgba(120,118,130,${(c.a * 0.55).toFixed(3)})`;
      ctx.beginPath();
      for (const l of c.lobes) {
        ctx.ellipse(x + l.dx - lit * l.r * 0.10, c.y + l.dy + l.r * 0.30,
          l.r, l.r * 0.62, 0, 0, 7);
      }
      ctx.fill();
      // the mass
      ctx.fillStyle = `rgba(246,244,238,${c.a.toFixed(3)})`;
      ctx.beginPath();
      for (const l of c.lobes) {
        ctx.ellipse(x + l.dx, c.y + l.dy, l.r, l.r * 0.66, 0, 0, 7);
      }
      ctx.fill();
      // the crown catching the sun
      ctx.fillStyle = `rgba(255,252,244,${(c.a * 0.85).toFixed(3)})`;
      ctx.beginPath();
      for (const l of c.lobes) {
        ctx.ellipse(x + l.dx + lit * l.r * 0.14, c.y + l.dy - l.r * 0.24,
          l.r * 0.72, l.r * 0.40, 0, 0, 7);
      }
      ctx.fill();
    }
  },

  /* ---------- cover positions ---------- */
  _drawCovers(ctx, game, lane, time) {
    const map = game.map;
    const depth = LANE_DEPTH[lane];
    for (const c of game.covers[lane]) {
      if (!Camera.sees(c.x, c.w + 50)) continue;
      if (c.type === 'rubble' || c.type === 'towerpos' || c.type === 'nestpos') continue; // structure art carries these
      if (c.type === 'window') {
        /* A firing port cut into the building behind the man. Drawn between the
         * structures pass and the units pass, so the dark opening lands on the
         * wall and the soldier holding it stands out against it — previously a
         * squad in a building was audible but invisible. */
        const st = c.structRef;
        if (st && st.state === 2) continue;
        const y = groundY(map, lane, c.x) - (c.lift || 0) * depth;
        const w = c.w * 0.78 * depth, h = 21 * depth;
        ctx.save();
        ctx.fillStyle = 'rgba(12,10,7,0.80)';
        ctx.fillRect(c.x - w / 2, y - h - 10 * depth, w, h);
        // sill and lintel, so it reads as an opening rather than a smudge
        ctx.fillStyle = 'rgba(38,29,18,0.95)';
        ctx.fillRect(c.x - w / 2 - 1.5 * depth, y - 10 * depth, w + 3 * depth, 2.6 * depth);
        ctx.fillRect(c.x - w / 2 - 1.5 * depth, y - h - 12 * depth, w + 3 * depth, 2.2 * depth);
        if (c.occ) {
          // muzzle-lit interior while the position is manned
          ctx.fillStyle = 'rgba(255,190,110,0.10)';
          ctx.fillRect(c.x - w / 2, y - h - 10 * depth, w, h);
        }
        ctx.restore();
        continue;
      }
      if (c.type === 'hide') {
        // a prepared firing position dug into the brush
        const y = groundY(map, lane, c.x);
        ctx.save();
        ctx.translate(c.x, y);
        ctx.scale(LANE_DEPTH[lane], LANE_DEPTH[lane]);
        ctx.fillStyle = 'rgba(22,30,16,0.55)';
        ctx.beginPath(); ctx.ellipse(0, -1, c.w / 2, 4, 0, 0, 7); ctx.fill();
        if (!drawVeg(ctx, 'bush', 0, -4, 2, c.w * 0.62)) {
          ctx.fillStyle = map.pal.brush;
          for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.ellipse(i * 7, -7 - (i % 2 ? 3 : 0), 8, 6, 0, 0, 7);
            ctx.fill();
          }
        }
        drawVeg(ctx, 'bush', 0, 12, 1, c.w * 0.44, { flip: true, alpha: 0.95 });
        ctx.restore();
        continue;
      }
      const y = groundY(map, lane, c.x);
      ctx.save();
      ctx.translate(c.x, y);
      ctx.scale(depth, depth);
      const rng = seeded((map.seed + c.x * 13) >>> 0);
      if (c.type === 'sandbag') {
        /* Profile-rendered sandbags first. Cover is on screen constantly, so it
         * is one of the loudest places the old 3/4-view kit showed next to
         * profile soldiers. Drawn at scale 1 because this context is already
         * scaled by lane depth. */
        if (typeof Props !== 'undefined' && Props.ready) {
          const pn = (Math.floor(c.x / 37) % 2) ? 'sandbag_wall' : 'sandbags_pile';
          if (Props.has(pn) &&
              Props.draw(ctx, pn, 0, 0, 1, { flip: (Math.floor(c.x / 53) % 2) === 1 })) {
            ctx.restore();
            continue;
          }
        }
        if (!drawTex(ctx, 'sandbags', Math.floor(c.x), 0, 1, c.w * 1.8)) {
          for (let r = 0; r < 2; r++) {
            for (let i = 0; i < 4 - r; i++) {
              ctx.fillStyle = (i + r) % 2 ? '#8a7a58' : '#7d6e4e';
              ctx.beginPath();
              ctx.ellipse(-12 + i * 8 + r * 4, -2.6 - r * 4.4, 4.4, 2.5, 0, 0, 7);
              ctx.fill();
            }
          }
        }
      } else if (c.type === 'log') {
        ctx.fillStyle = 'rgba(40,32,20,0.9)';
        ctx.beginPath(); ctx.ellipse(0, -1, c.w / 2, 3.4, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#4a3a24';
        ctx.fillRect(-c.w / 2, -6.5, c.w, 4.4);
        ctx.fillStyle = '#3a2d1c';
        ctx.beginPath(); ctx.ellipse(-c.w / 2, -4.3, 2.2, 2.2, 0, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.ellipse(c.w / 2, -4.3, 2.2, 2.2, 0, 0, 7); ctx.fill();
      } else if (c.type === 'dike') {
        /* Profile-rendered bund, same as the sandbags above: drawn at scale 1
         * because this context is already scaled by lane depth, and at its
         * authored real height so it sits correctly against a 1.8 m man. */
        if (typeof Props !== 'undefined' && Props.ready && Props.has('dike_a') &&
            Props.draw(ctx, 'dike_a', 0, 0, 1, { flip: (Math.floor(c.x / 47) % 2) === 1 })) {
          ctx.restore();
          continue;
        }
        if (!drawTex(ctx, 'dike', Math.floor(c.x), 0, 1, c.w * 1.7)) {
          ctx.fillStyle = '#6d6034';
          ctx.beginPath();
          ctx.moveTo(-c.w / 2 - 5, 0);
          ctx.quadraticCurveTo(0, -9, c.w / 2 + 5, 0);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(120,130,60,0.8)'; ctx.lineWidth = 1.2;
          for (let i = -2; i <= 2; i++) {
            ctx.beginPath(); ctx.moveTo(i * 7, -5.5); ctx.lineTo(i * 7 + rng() * 2 - 1, -9); ctx.stroke();
          }
        }
      } else if (c.type === 'crater') {
        ctx.fillStyle = 'rgba(18,14,9,0.55)';
        ctx.beginPath(); ctx.ellipse(0, 0, c.w / 2, 4.2, 0, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(72,58,36,0.8)';
        ctx.beginPath(); ctx.ellipse(0, -3.4, c.w / 2 + 3, 2.4, 0, Math.PI, 0); ctx.fill();
      } else if (c.type === 'wall') {
        if (typeof Props !== 'undefined' && Props.ready && Props.has('stonewall_a') &&
            Props.draw(ctx, 'stonewall_a', 0, 0, 1, { flip: (Math.floor(c.x / 59) % 2) === 1 })) {
          ctx.restore();
          continue;
        }
        if (!drawTex(ctx, 'stonewall', Math.floor(c.x), 0, 1, c.w * 1.6)) {
          // low mud-brick village wall, chipped
          ctx.fillStyle = '#8a7a5c';
          ctx.fillRect(-c.w / 2, -8, c.w, 8);
          ctx.fillStyle = '#77684c';
          ctx.fillRect(-c.w / 2, -8, c.w, 2.4);
          ctx.strokeStyle = 'rgba(0,0,0,0.2)';
          ctx.lineWidth = 0.8;
          for (let i = 1; i < 4; i++) {
            ctx.beginPath(); ctx.moveTo(-c.w / 2 + i * (c.w / 4), -8); ctx.lineTo(-c.w / 2 + i * (c.w / 4), 0); ctx.stroke();
          }
          ctx.fillStyle = 'rgba(20,16,10,0.3)';
          ctx.beginPath(); ctx.ellipse(rng() * c.w - c.w / 2, -8, 3, 1.6, 0, Math.PI, 0); ctx.fill();
        }
      } else if (c.type === 'trench') {
        // dug slot with a parapet toward the enemy side
        ctx.fillStyle = 'rgba(14,11,7,0.85)';
        ctx.beginPath(); ctx.ellipse(0, 0, c.w / 2, 5, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#5c4a2e';
        ctx.beginPath(); ctx.ellipse(-c.w / 2 - 4, -2.4, 9, 3.6, 0, Math.PI, 0); ctx.fill();
        ctx.beginPath(); ctx.ellipse(c.w / 2 + 4, -2.4, 9, 3.6, 0, Math.PI, 0); ctx.fill();
        ctx.strokeStyle = '#3a2d1c'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(-c.w / 2, -0.5); ctx.lineTo(c.w / 2, -0.5); ctx.stroke();
      }
      ctx.restore();
    }
  },

  _drawNades(ctx, game, lane) {
    for (const n of game.nades) {
      if (n.lane !== lane || !Camera.sees(n.x, 30)) continue;
      ctx.save();
      ctx.translate(n.x, n.y - 2);
      ctx.rotate(n.spin);
      ctx.fillStyle = '#2e2c22';
      ctx.fillRect(-2.2, -1.4, 4.4, 2.8);
      ctx.fillStyle = 'rgba(255,255,230,0.5)';
      ctx.fillRect(-0.6, -1.4, 1.2, 1);
      ctx.restore();
      if (n.landed) {
        // sputtering fuse
        ctx.fillStyle = `rgba(255,210,120,${0.4 + 0.4 * Math.sin(n.fuse * 30)})`;
        ctx.beginPath(); ctx.arc(n.x + 2, n.y - 4, 1, 0, 7); ctx.fill();
      }
    }
  },

  /* Smoke screens. Drawn over the men in the lane, because the whole point is
   * that you cannot see through it — a screen the player can see past would be
   * lying about what the units can do. Built from a few drifting blobs so it
   * billows rather than sitting there as a disc. */
  _drawSmoke(ctx, game, lane, time) {
    for (const s of game.smokes) {
      if (s.lane !== lane || !Camera.sees(s.x, s.radius + 80)) continue;
      const grow = Math.min(1, s.age / SMOKE.build);
      const fade = Math.min(1, s.life / 2.5);
      const a = 0.80 * grow * fade;
      if (a <= 0.01) continue;
      const gy = groundY(game.map, lane, s.x);
      const r = s.radius * grow;
      ctx.save();
      for (let i = 0; i < 7; i++) {
        const p = i / 7;
        const wob = Math.sin(time * 0.55 + i * 2.1 + s.x * 0.01);
        const bx = s.x + (p - 0.5) * r * 1.7 + wob * 7;
        const by = gy - 12 - p * 26 - Math.abs(wob) * 9 - grow * 14;
        const br = r * (0.42 + 0.20 * Math.sin(i * 1.7 + s.age));
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, `rgba(214,212,203,${a * 0.55})`);
        g.addColorStop(0.6, `rgba(190,188,180,${a * 0.34})`);
        g.addColorStop(1, 'rgba(178,176,168,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, 7);
        ctx.fill();
      }
      ctx.restore();
    }
  },

  /* Night operations.
   *
   * Multiply the world down to almost nothing, then put every light source back
   * on top: muzzle flashes, burning structures, ground fire. The additive muzzle
   * light already existed and barely registered in daylight — after dark it
   * carries the whole scene, and a firefight becomes a series of things briefly
   * lit by their own violence, which is the documentary image of this war.
   */
  _drawNight(ctx, game, map) {
    if (!this._night) return;
    const k = this._nightK;
    ctx.save();
    /* NIGHT DARKENS. It does not paint over.
     *
     * This used to be a source-over wash of rgba(11,16,33) at alpha 0.88, which
     * is a linear lerp: every pixel became 0.12 x itself + 0.88 x one flat
     * navy. That compresses the whole 0-255 range into about 31 points, and
     * measurement bore it out exactly — the Khe Sanh frame spanned luminance
     * 47..68, a p95-p5 contrast of 18 against ~113 on a daylight map. The map
     * was not dark, it was ERASED: soldiers, buildings and hills all sat within
     * a few points of each other and nothing could be made out.
     *
     * Multiply is the correct operator, because it SCALES rather than replaces
     * and so preserves relative contrast — what was brighter stays brighter. An
     * earlier note rejected it for giving "a brown night", but that is only true
     * multiplying by a neutral: a blue-dominant factor suppresses red and green
     * harder than blue, so it cools the frame as it darkens it. A light wash
     * afterwards settles the blacks, since real night is not pure black. */
    /* EVERY WASH COSTS CONTRAST, AND THEY MULTIPLY TOGETHER.
     *
     * Switching to multiply fixed the worst of it (18 -> 34 points of range) but
     * left the map at 38 against 102-170 on the daylight maps, and the arithmetic
     * says why: multiply by rgb(58,102,196) scales luminance by 0.39, the navy
     * source-over on top of it by 0.86, the map's own full-screen haze by 0.80
     * and the grade by 0.90. Four individually reasonable veils compose to 0.24,
     * so a scene with 164 points of range arrives with 39. Measured: 38.
     *
     * The fix is not a gentler multiply — it is fewer veils and a contrast
     * restore. The map haze is skipped entirely at night (see above), the navy
     * source-over is halved, and a `overlay` pass pushes the range back out so
     * night is DARK rather than FLAT. */
    /* THE MULTIPLY IS A GRADIENT, because the sky and the ground need opposite
     * things and a flat factor cannot give both.
     *
     * With one factor, the two requirements fight. Strong enough to cool Khe
     * Sanh's sky — and that palette is a SUNSET, skyTop #d97a52 over skyBot
     * #eeb47a — it crushed the ground band to 34 points of range against 70 in
     * daylight, which is the whole map's readability: the wire, the craters and
     * the mud all live there. Weak enough to keep the ground open, and the sky
     * came out salmon and the map read as dusk rather than night.
     *
     * They are separable, because they are at different heights and the reason
     * is physical: at night the sky loses far more of its daytime luminance
     * than ground does, which is lit by fires, flares and the base itself.
     * Deep cool blue at the top, easing to a pale factor at the boots.
     *
     * Measured on Khe Sanh: ground range 34 -> 45, sky median 67 -> 61 with a
     * blue bias of +47 (R-to-B) where the old flat factor left it warm. */
    ctx.globalCompositeOperation = 'multiply';
    const mg = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    mg.addColorStop(0, 'rgb(30,52,132)');
    mg.addColorStop(0.40, 'rgb(66,104,192)');
    mg.addColorStop(1, 'rgb(122,158,226)');
    ctx.fillStyle = mg;
    ctx.fillRect(Camera.x - 4, 0, CANVAS_W + 8, CANVAS_H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(11,16,33,${k * 0.06})`;
    ctx.fillRect(Camera.x - 4, 0, CANVAS_W + 8, CANVAS_H);
    /* Push the range back out. `overlay` steepens around mid-grey: what was
     * lighter than half goes lighter, what was darker goes darker, which is
     * exactly the compression the washes above just caused, inverted. */
    ctx.globalCompositeOperation = 'overlay';
    /* NEUTRAL, deliberately. A blue source in overlay mode does not just steepen
     * contrast — it saturates whatever sits near mid-grey, and the ridge line is
     * exactly that, so a blue restore turned the grey massif into a row of vivid
     * blue triangles pasted on the sky. The cooling is the multiply's job; this
     * pass only has to put the range back. */
    /* Raised from 0.55. The overlay is the only pass that ADDS range, and with
     * the multiply now easing off toward the ground there is headroom for it to
     * work harder without blowing the sky out. */
    ctx.fillStyle = 'rgba(200,202,208,0.88)';
    ctx.fillRect(Camera.x - 4, 0, CANVAS_W + 8, CANVAS_H);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, 'rgba(26,42,92,0.15)');
    g.addColorStop(1, 'rgba(10,18,40,0.05)');
    ctx.fillStyle = g;
    ctx.fillRect(Camera.x - 4, 0, CANVAS_W + 8, CANVAS_H);

    ctx.globalCompositeOperation = 'lighter';
    for (const L of this._lights) {
      const rg = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
      rg.addColorStop(0, `rgba(255,226,170,${0.30 * L.p})`);
      rg.addColorStop(0.35, `rgba(255,164,74,${0.12 * L.p})`);
      rg.addColorStop(1, 'rgba(255,130,50,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(L.x, L.y, L.r, 0, 7);
      ctx.fill();
    }
    // burning wreckage and ground fire keep their own glow going
    for (const st of game.structures) {
      if (!(st.burnT > 0) || !Camera.sees(st.x, 120)) continue;
      const y = groundY(map, st.lane, st.x);
      const r = 90 * LANE_DEPTH[st.lane];
      const rg = ctx.createRadialGradient(st.x, y - 14, 0, st.x, y - 14, r);
      rg.addColorStop(0, 'rgba(255,170,80,0.18)');
      rg.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(st.x, y - 14, r, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  },

  /* Aerial perspective: air between you and the far lane.
   *
   * One global haze tinted the whole scene equally, so all three lanes sat at the
   * same apparent distance and the depth had to come entirely from sprite scale.
   * Laying a little of the map's own haze colour over each lane AS IT FINISHES —
   * most on the far lane, none on the near one — separates them the way distance
   * actually does. Costs three fills. */
  _laneHaze(ctx, map, lane) {
    /* Depth-derived, not a hardcoded table. `[0.5, 0.22, 0][lane]` was written
     * for three lanes, where index 2 — the lane nearest the viewer — was the one
     * that got NO haze. At LANE_N = 2 that entry is never reached, so the
     * foreground lane has been sitting under a permanent 0.22 veil ever since
     * the drop to two lanes. The nearest lane always gets zero. */
    const a = LANE_N > 1 ? 0.5 * (1 - lane / (LANE_N - 1)) : 0;
    if (!a || !map.pal.haze) return;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = a;
    ctx.fillStyle = map.pal.haze;
    ctx.fillRect(Camera.x - 4, 0, CANVAS_W + 8, CANVAS_H);
    ctx.globalAlpha = prev;
  },

  /* Rank chevrons over a squad. Veterancy is worth nothing to the player if it
   * is invisible — this is how you know which squad to pull back and which to
   * push. Only drawn for squads that have actually earned a rank. */
  _drawRank(ctx, game, lane) {
    for (const s of game.squads) {
      if (s.lane !== lane || !(s.rank > 0)) continue;
      const alive = game.squadAlive(s);
      if (!alive.length) continue;
      const x = game.squadAnchor(s);
      if (!Camera.sees(x, 60)) continue;
      if (s.side !== game.player && !alive.some(m => game.visibleToPlayer(m))) continue;
      const depth = LANE_DEPTH[lane];
      const y = groundY(game.map, lane, x) - 78 * depth;
      ctx.save();
      ctx.strokeStyle = s.side === 'us' ? '#cfe0a8' : '#f0a087';
      ctx.lineWidth = 1.6 * depth;
      ctx.lineCap = 'round';
      for (let i = 0; i < s.rank; i++) {
        const cy = y + i * 4.2 * depth;
        ctx.beginPath();
        ctx.moveTo(x - 4.5 * depth, cy);
        ctx.lineTo(x, cy - 3 * depth);
        ctx.lineTo(x + 4.5 * depth, cy);
        ctx.stroke();
      }
      ctx.restore();
    }
  },

  _drawSquadMarkers(ctx, game, lane, time) {
    const ui = this._ui;
    const sel = ui && ui.selectedSquad;
    // selected squad: rings under the men, free cover spots hinted downfield
    if (sel && sel.lane === lane && game.squadAlive(sel).length) {
      ctx.save();
      for (const m of game.squadAlive(sel)) {
        ctx.strokeStyle = 'rgba(255,217,138,0.85)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(m.x, m.y + 2, 9, 3.2, 0, 0, 7);
        ctx.stroke();
      }
      const pulse = 0.35 + 0.2 * Math.sin(time * 5);
      for (const c of game.covers[lane]) {
        if (c.occ && c.occ !== sel) continue;
        if (!Camera.sees(c.x, 40)) continue;
        const cy = groundY(game.map, lane, c.x);
        ctx.strokeStyle = `rgba(180,220,150,${pulse})`;
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(c.x, cy + 1, c.w / 2 + 4, 4, 0, 0, 7);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (sel.order === 'moveto') {
        const my = groundY(game.map, lane, sel.moveToX);
        ctx.strokeStyle = '#ffd98a';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(sel.moveToX, my); ctx.lineTo(sel.moveToX, my - 18);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,217,138,0.9)';
        ctx.beginPath();
        ctx.moveTo(sel.moveToX, my - 18); ctx.lineTo(sel.moveToX + 9, my - 14.5);
        ctx.lineTo(sel.moveToX, my - 11);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    for (const s of game.squads) {
      if (s.lane !== lane) continue;
      const alive = game.squadAlive(s);
      if (!alive.length) continue;
      const vis = alive.some(m => game.visibleToPlayer(m));
      if (!vis) continue;
      /* Mark the squad the player has called concentrated fire on.
       *
       * An order with no visible consequence is an order nobody uses. Brackets
       * rather than a box: the focused squad is being SHOT AT, and a solid
       * frame around it competes with the health bars and hit sparks already
       * living in that space. */
      for (const o of game.squads) {
        if (o.focus !== s || o.side === s.side) continue;
        const fx = game.squadAnchor(s);
        const fy = groundY(game.map, lane, fx) - 74 * LANE_DEPTH[lane];
        const w = 22 * LANE_DEPTH[lane];
        ctx.save();
        ctx.globalAlpha = 0.62 + 0.22 * Math.sin(time * 5);
        ctx.strokeStyle = '#e0c48c';
        ctx.lineWidth = 1.4;
        for (const sx of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(fx + sx * w, fy - 7);
          ctx.lineTo(fx + sx * (w + 5), fy - 7);
          ctx.lineTo(fx + sx * (w + 5), fy + 7);
          ctx.lineTo(fx + sx * w, fy + 7);
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
      /* AMMUNITION, shown only when it starts to matter.
       *
       * A resource the player cannot see is a resource he cannot plan around,
       * but a bar over every squad all match is clutter for a number that is
       * full 90% of the time. It appears as the load runs down and turns red
       * when the rate of fire is actually suffering. */
      if (s.side === game.player && s.ammo != null && s.ammo < 0.55) {
        const ax = game.squadAnchor(s);
        const ay = groundY(game.map, lane, ax) - 92 * LANE_DEPTH[lane];
        const w = 20 * LANE_DEPTH[lane];
        const low = s.ammo < AMMO_LOW;
        ctx.save();
        ctx.globalAlpha = low ? 0.6 + 0.3 * Math.sin(time * 7) : 0.75;
        ctx.fillStyle = 'rgba(8,10,6,0.72)';
        ctx.fillRect(ax - w / 2 - 1, ay - 1, w + 2, 4);
        ctx.fillStyle = low ? '#d4544a' : '#c9a86a';
        ctx.fillRect(ax - w / 2, ay, w * s.ammo, 2);
        ctx.restore();
      }
      if (s.pinned) {
        const ax = game.squadAnchor(s);
        const ay = groundY(game.map, lane, ax) - 84 * LANE_DEPTH[lane];
        const pulse = 0.55 + 0.3 * Math.sin(time * 9);
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#d4544a';
        ctx.font = 'bold 8px Courier New';
        ctx.fillText('PINNED', ax - 14, ay);
        ctx.beginPath();
        ctx.moveTo(ax - 3, ay + 3);
        ctx.lineTo(ax + 3, ay + 3);
        ctx.lineTo(ax, ay + 7);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  },

  /* ---------- destructible structures ---------- */
  _drawStructures(ctx, game, lane, time) {
    for (const st of game.structures) {
      if (st.lane !== lane || !Camera.sees(st.x, st.w + 60)) continue;
      const y = groundY(game.map, lane, st.x);
      const rng = seeded(st.seed);
      ctx.save();
      ctx.translate(st.x, y);
      const depth = LANE_DEPTH[lane];
      ctx.scale(depth, depth);
      if (st.state === 2) this._drawRubble(ctx, st, rng);
      else this._drawBuilding(ctx, st, rng, st.state === 1, time);
      ctx.restore();
      if (st.burnT > 0 && typeof Assets !== 'undefined' && Assets.anim('groundfire')) {
        const fi = Math.floor(time * 11 + st.x * 0.7) % 7;
        Assets.drawAnimFrame(ctx, 'groundfire', fi, st.x + Math.sin(st.seed) * st.w * 0.2,
          y - (st.state === 2 ? 2 : st.kind === 'stilt' ? 18 : 12) * depth,
          (st.w * 0.9) * depth, { add: true, ground: false, alpha: 0.85 });
      }
    }
  },

  /* Village kinds that have a profile-rendered prop. These come off the same
   * orthographic side camera as the soldiers, which is the whole point: the old
   * painted kit was drawn in 3/4 view and read as a collage next to profile men.
   * Sized from the prop's authored real-world height, so a 3 m hut stands
   * correctly against a 1.8 m soldier instead of being eyeballed. */
  /* Structure kind -> the prop that stands in for it.
   *
   * Four of these used to point at donor models from a generic fantasy pack and
   * had no business in a 1965 Vietnam game: `shrine` was a EUROPEAN HALF-TIMBERED
   * HOUSE FRAME with cross-bracing, `well` was a storybook wishing well with a
   * peaked shingle roof and a bucket on a rope, `stall` was a market stall with
   * CROSSED SWORDS on its sign, and `cart` was a European handcart. They are
   * replaced by built props — a roadside spirit house, a block-ring village
   * well, a bamboo-and-tarp market stall, and a two-wheel ox cart.
   *
   * Architecture is the one place box geometry is honestly right: a roof plane
   * is a plane and a post is a post, which is why these are built rather than
   * sourced. The organic props are the ones that need real meshes.
   */
  PROP_KINDS: {
    hooch: ['hut_a', 'hut_c'],
    longhouse: ['village_row'],
    stilt: ['hut_b'],
    stall: ['stall_v'],
    shrine: ['shrine_a'],
    // an MG position IS a sandbag parapet — the props already model one
    mgnest: ['sandbags_pile', 'sandbag_wall'],
    tower: ['watchtower'],
    well: ['well_v'],
    cart: ['cart_v'],
  },

  _drawBuilding(ctx, st, rng, dmg, time) {
    const w = st.w;
    const alt = this.PROP_KINDS[st.kind];
    if (alt && typeof Props !== 'undefined' && Props.ready) {
      const name = alt[Math.abs(st.seed | 0) % alt.length];
      if (Props.has(name)) {
        // inside this context everything is already scaled by lane depth, so the
        // prop is asked for its height at scale 1 and inherits the depth
        Props.draw(ctx, name, 0, 0, 1, { flip: (st.seed | 0) % 2 === 1 });
        if (dmg) {
          ctx.save();
          ctx.globalAlpha = 0.42;
          ctx.fillStyle = '#150f08';
          const h = Props.pxHeight(name, 1);
          ctx.beginPath();
          ctx.ellipse(0, -h * 0.45, w * 0.62, h * 0.34, 0.15, 0, 7);
          ctx.fill();
          ctx.restore();
        }
        return;
      }
    }
    // painted sprite when the kit has one; procedural stays the fallback
    const kindMap = { hooch: 'hooch', longhouse: 'house', stilt: 'stiltH', well: 'well',
                      banana: 'banana', cart: 'cart', shrine: 'shrine', stall: 'stall' };
    if (st.kind === 'tower') {
      if (drawTex(ctx, 'watchtower', 0, 0, 2, w * 2.1)) {
        if (dmg) {
          ctx.fillStyle = 'rgba(16,13,9,0.5)';
          ctx.beginPath(); ctx.ellipse(0, -w * 1.6, w * 0.5, w * 0.3, 0.2, 0, 7); ctx.fill();
        }
        return;
      }
    }
    if (st.kind === 'mgnest') {
      // log frame + sandbag parapet
      ctx.fillStyle = '#4a3a24';
      ctx.fillRect(-w / 2, -7, w, 4.6);
      drawTex(ctx, 'sandbags', 0, 0, 1, w * 1.3);
      if (dmg) {
        ctx.fillStyle = 'rgba(16,13,9,0.5)';
        ctx.beginPath(); ctx.ellipse(w * 0.1, -5, w * 0.3, 3, 0, 0, 7); ctx.fill();
      }
      return;
    }
    const sk = kindMap[st.kind];
    if (sk && tex(sk, st.seed)) {
      const wm = { hooch: 1.5, house: 1.6, stiltH: 1.5, well: 2.1, banana: 1.35,
                   cart: 1.45, shrine: 1.8, stall: 1.55 }[sk] || 1.5;
      drawTex(ctx, sk, st.seed, 0, 2, w * wm);
      if (dmg) {
        // shell-holed and scorched
        const img = tex(sk, st.seed);
        const dw = w * wm, dh = img.height * (dw / img.width);
        ctx.fillStyle = 'rgba(16,13,9,0.55)';
        ctx.beginPath(); ctx.ellipse(-dw * 0.16, -dh * 0.62, dw * 0.14, dh * 0.1, 0.3, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.ellipse(dw * 0.18, -dh * 0.34, dw * 0.11, dh * 0.09, -0.2, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(20,16,10,0.3)';
        ctx.fillRect(-dw / 2, -dh, dw, dh);
      }
      return;
    }
    const wall = '#6b5a38', wallD = '#54462a', thatch = '#98854e', thatchD = '#6e5f36';
    if (st.kind === 'hooch' || st.kind === 'longhouse') {
      const h = st.kind === 'hooch' ? 16 : 20;
      // short stilts + floor
      ctx.strokeStyle = wallD; ctx.lineWidth = 1.6;
      for (let i = 0; i <= 3; i++) {
        const px = -w / 2 + (i / 3) * w;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, -4); ctx.stroke();
      }
      // wall panel with weave lines
      ctx.fillStyle = wall;
      ctx.fillRect(-w / 2, -4 - h, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.8;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(-w / 2, -4 - (i / 4) * h); ctx.lineTo(w / 2, -4 - (i / 4) * h); ctx.stroke();
      }
      // doorway
      ctx.fillStyle = '#241f14';
      ctx.fillRect(-4, -4 - h * 0.72, 8, h * 0.72);
      // thatch roof with overhang
      const ry = -4 - h;
      ctx.fillStyle = dmg ? thatchD : thatch;
      ctx.beginPath();
      ctx.moveTo(-w / 2 - 6, ry);
      ctx.lineTo(0, ry - (st.kind === 'hooch' ? 13 : 17));
      ctx.lineTo(w / 2 + 6, ry);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const t = i / 4;
        ctx.beginPath();
        ctx.moveTo((-w / 2 - 6) * (1 - t), ry - t * (st.kind === 'hooch' ? 13 : 17));
        ctx.lineTo((w / 2 + 6) * (1 - t), ry - t * (st.kind === 'hooch' ? 13 : 17));
        ctx.stroke();
      }
      if (dmg) {
        // holed roof + scorched wall
        ctx.fillStyle = 'rgba(20,16,10,0.75)';
        ctx.beginPath(); ctx.ellipse(w * 0.14, ry - 6, 7, 4, 0.3, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(16,13,9,0.5)';
        ctx.fillRect(-w / 2 + 3, -4 - h, w * 0.35, h);
      }
    } else if (st.kind === 'stilt') {
      // tall stilts over the paddy, ladder, small house
      ctx.strokeStyle = wallD; ctx.lineWidth = 2;
      for (const px of [-w / 2 + 4, -4, w / 2 - 4]) {
        ctx.beginPath(); ctx.moveTo(px, 2); ctx.lineTo(px, -13); ctx.stroke();
      }
      ctx.fillStyle = '#5c4a2e';
      ctx.fillRect(-w / 2, -16, w, 4);
      ctx.fillStyle = wall;
      ctx.fillRect(-w / 2 + 3, -16 - 11, w - 6, 11);
      ctx.fillStyle = '#241f14';
      ctx.fillRect(-3, -16 - 9, 6, 9);
      ctx.fillStyle = dmg ? thatchD : thatch;
      ctx.beginPath();
      ctx.moveTo(-w / 2 - 4, -27);
      ctx.lineTo(0, -36);
      ctx.lineTo(w / 2 + 4, -27);
      ctx.closePath(); ctx.fill();
      // ladder
      ctx.strokeStyle = wallD; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(w / 2 - 10, 2); ctx.lineTo(w / 2 - 4, -14); ctx.stroke();
      if (dmg) {
        ctx.fillStyle = 'rgba(20,16,10,0.6)';
        ctx.beginPath(); ctx.ellipse(-w * 0.15, -31, 6, 3.4, -0.2, 0, 7); ctx.fill();
      }
    } else if (st.kind === 'bunker') {
      // half-buried log-and-sandbag bunker with a firing slit
      ctx.fillStyle = '#4a4232';
      ctx.beginPath(); ctx.ellipse(0, -1, w / 2, 13, 0, Math.PI, 0); ctx.fill();
      for (let r = 0; r < 3; r++) {
        for (let i = 0; i < 6 - r; i++) {
          ctx.fillStyle = (i + r) % 2 ? '#8a7a58' : '#7d6e4e';
          ctx.beginPath();
          ctx.ellipse(-w / 2 + 7 + i * 8.5 + r * 4, -3 - r * 4.6, 4.6, 2.6, 0, 0, 7);
          ctx.fill();
        }
      }
      ctx.fillStyle = '#3d3524';
      ctx.fillRect(-w / 2 + 4, -8, w - 8, 2.4); // timber lintel
      ctx.fillStyle = '#14120c';
      ctx.fillRect(-9, -7, 18, 3); // firing slit
      if (dmg) {
        ctx.fillStyle = 'rgba(18,14,9,0.55)';
        ctx.beginPath(); ctx.ellipse(w * 0.18, -9, 8, 4, 0, 0, 7); ctx.fill();
      }
    } else if (st.kind === 'well') {
      ctx.fillStyle = '#6e6252';
      ctx.beginPath(); ctx.ellipse(0, -2, 6, 3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#14120c';
      ctx.beginPath(); ctx.ellipse(0, -2.6, 4, 1.8, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#54462a'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-5, -2); ctx.lineTo(-5, -12); ctx.moveTo(5, -2); ctx.lineTo(5, -12); ctx.stroke();
      ctx.fillStyle = '#8a7443';
      ctx.beginPath(); ctx.moveTo(-8, -12); ctx.lineTo(0, -16); ctx.lineTo(8, -12); ctx.closePath(); ctx.fill();
    } else if (st.kind === 'crates') {
      // stacked ammunition boxes under a tarp corner — the thing a firebase has
      // most of, and what the haystack that used to stand here should have been
      const box = (bx, by, bw, bh) => {
        ctx.fillStyle = '#6a6141';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = 'rgba(255,240,200,0.14)';
        ctx.fillRect(bx, by, bw, 1.6);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(bx + bw - 2, by, 2, bh);
        ctx.strokeStyle = 'rgba(24,20,12,0.6)'; ctx.lineWidth = 0.8;
        ctx.strokeRect(bx + 0.4, by + 0.4, bw - 0.8, bh - 0.8);
      };
      box(-w / 2 + 1, -8, 12, 8);
      box(-w / 2 + 12, -7, 10, 7);
      box(-w / 2 + 4, -14, 11, 6);
      ctx.fillStyle = dmg ? 'rgba(30,22,14,0.7)' : '#4b4c3c';
      ctx.beginPath();                                   // tarp thrown over
      ctx.moveTo(-w / 2 + 2, -14);
      ctx.quadraticCurveTo(-w / 2 + 9, -19, -w / 2 + 16, -13);
      ctx.lineTo(-w / 2 + 14, -12); ctx.lineTo(-w / 2 + 3, -12);
      ctx.closePath(); ctx.fill();
    } else if (st.kind === 'hay') {
      ctx.fillStyle = dmg ? '#6e5f36' : '#a58c52';
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.quadraticCurveTo(-7, -13, 0, -15);
      ctx.quadraticCurveTo(7, -13, 8, 0);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(-5, -4); ctx.lineTo(-2, -12); ctx.moveTo(3, -3); ctx.lineTo(5, -10); ctx.stroke();
    }
  },

  _drawRubble(ctx, st, rng) {
    const w = st.w;
    if (st.kind === 'bunker') {
      // burst sandbags and splintered timber
      ctx.fillStyle = '#4a4232';
      ctx.beginPath(); ctx.ellipse(0, -1, w / 2, 8, 0, Math.PI, 0); ctx.fill();
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(138,122,88,0.9)' : 'rgba(110,98,72,0.9)';
        ctx.beginPath();
        ctx.ellipse(-w / 2 + rng() * w, -2 - rng() * 4, 4, 2.2, rng(), 0, 7);
        ctx.fill();
      }
      ctx.strokeStyle = '#2e2618'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(4, -10); ctx.stroke();
    } else {
      // charred frame poles over a debris mound
      ctx.fillStyle = 'rgba(26,21,14,0.85)';
      ctx.beginPath(); ctx.ellipse(0, -1, w / 2, 5, 0, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#1c1710'; ctx.lineWidth = 1.8;
      for (let i = 0; i < 4; i++) {
        const px = -w / 2 + rng() * w;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px + (rng() - 0.5) * 14, -(5 + rng() * 11));
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(60,50,34,0.7)';
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(-w / 2 + rng() * w, -2 + rng() * 2, 3 + rng() * 3, 1.6);
      }
    }
  },

  _drawEmplacements(ctx, game, lane, time) {
    const map = game.map, player = game.player;
    for (const t of game.traps) {
      if (t.lane !== lane || !Camera.sees(t.x)) continue;
      const visible = player === t.side || t.discovered;
      if (!visible) continue;
      const y = groundY(map, lane, t.x);
      ctx.save();
      ctx.globalAlpha = t.discovered && player !== t.side ? 1 : 0.75;
      if (t.type === 'punji') {
        ctx.fillStyle = '#241c10';
        ctx.beginPath(); ctx.ellipse(t.x, y + 1, 10, 3, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = '#a89058'; ctx.lineWidth = 1.2;
        for (let i = -6; i <= 6; i += 3) {
          ctx.beginPath(); ctx.moveTo(t.x + i, y + 1); ctx.lineTo(t.x + i + 1, y - 4); ctx.stroke();
        }
      } else {
        ctx.fillStyle = '#4a4a42';
        ctx.beginPath(); ctx.ellipse(t.x, y - 1, 4.5, 2.4, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(200,200,180,0.4)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(t.x - 14, y - 2); ctx.lineTo(t.x + 14, y - 2); ctx.stroke();
      }
      if (t.discovered && player === 'us') {
        ctx.fillStyle = '#ffd98a';
        ctx.font = 'bold 10px Courier New';
        ctx.fillText('!', t.x - 2, y - 10);
      }
      ctx.restore();
    }
    for (const h of game.holes) {
      if (h.lane !== lane || !Camera.sees(h.x)) continue;
      const visible = player === 'vc' || h.revealT > 0 || h.discovered;
      if (!visible) continue;
      const y = groundY(map, lane, h.x);
      ctx.fillStyle = '#33402a';
      ctx.beginPath(); ctx.ellipse(h.x, y, 13, 5, 0, Math.PI, 0); ctx.fill();
      if (h.revealT > 0) {
        ctx.fillStyle = '#14120c';
        ctx.beginPath(); ctx.ellipse(h.x, y - 3, 7, 3.4, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = '#26251d'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(h.x, y - 4); ctx.lineTo(h.x - 14 * h.dirToTarget * -1, y - 7); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(20,18,12,0.85)';
        ctx.beginPath(); ctx.ellipse(h.x, y - 1, 6, 2.2, 0, 0, 7); ctx.fill();
      }
    }
    for (const tn of game.tunnels) {
      if (tn.lane !== lane || !Camera.sees(tn.x)) continue;
      const visible = player === 'vc' || tn.discovered;
      if (!visible) continue;
      const y = groundY(map, lane, tn.x);
      ctx.fillStyle = '#4a3c26';
      ctx.beginPath(); ctx.ellipse(tn.x, y + 1, 15, 5.5, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#0f0d08';
      ctx.beginPath(); ctx.ellipse(tn.x, y, 9, 7, 0, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#5c4a2e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tn.x - 9, y); ctx.lineTo(tn.x - 9, y - 7); ctx.moveTo(tn.x + 9, y); ctx.lineTo(tn.x + 9, y - 7); ctx.stroke();
    }
  },

  _drawFlag(ctx, game, lane, time) {
    const map = game.map;
    const f = game.flags[lane];
    if (!Camera.sees(f.x)) return;
    const x = f.x, y = groundY(map, lane, x);
    ctx.strokeStyle = '#3a3428'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 34); ctx.stroke();
    const wave = Math.sin(time * 5 + lane) * 2;
    const fw = 18, fh = 11;
    ctx.save();
    ctx.translate(x, y - 34);
    if (f.owner === 'us') {
      ctx.fillStyle = '#d8b83a';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(fw, 1 + wave); ctx.lineTo(fw, fh + wave); ctx.lineTo(0, fh); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#b03226'; ctx.lineWidth = 1.4;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath(); ctx.moveTo(0, i * fh / 4); ctx.lineTo(fw, i * fh / 4 + wave); ctx.stroke();
      }
    } else if (f.owner === 'vc') {
      ctx.fillStyle = '#b03226';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(fw, 1 + wave); ctx.lineTo(fw, fh / 2 + wave); ctx.lineTo(0, fh / 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2a4a7c';
      ctx.beginPath(); ctx.moveTo(0, fh / 2); ctx.lineTo(fw, fh / 2 + wave); ctx.lineTo(fw, fh + wave); ctx.lineTo(0, fh); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8c840';
      ctx.font = '8px sans-serif';
      ctx.fillText('★', fw / 2 - 4, fh / 2 + 3 + wave / 2);
    } else {
      ctx.fillStyle = 'rgba(210,210,200,0.75)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(fw, 1 + wave); ctx.lineTo(fw, fh + wave); ctx.lineTo(0, fh); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (f.capSide && f.cap > 0.02) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - 12, y + 6, 24, 4);
      ctx.fillStyle = f.capSide === 'us' ? '#b5c98f' : '#e08767';
      ctx.fillRect(x - 12, y + 6, 24 * clamp(f.cap, 0, 1), 4);
    }
  },

  /* Soft contact shadow. Nothing sells "standing on the ground" like a shadow —
   * without one a sprite reads as a sticker pasted over the terrain. Cached as a
   * one-off blob because a radial gradient per unit per frame is pure waste. */
  _shadowBlob() {
    if (this._shadow) return this._shadow;
    const R = 64;
    const c = document.createElement('canvas');
    c.width = c.height = R * 2;
    const x = c.getContext('2d');
    /* Deepened from 0.62/0.34. A contact shadow is half of what separates a
     * figure from the ground it stands on, and the measured separation was 12
     * luminance points out of 255 — US bodies at 99.3 against ground at 102.5,
     * which is no separation at all. A darker, tighter core reads as the man
     * touching the earth instead of floating on it. */
    const g = x.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0, 'rgba(18,21,12,0.86)');
    g.addColorStop(0.30, 'rgba(18,21,12,0.58)');
    g.addColorStop(0.62, 'rgba(20,24,14,0.22)');
    g.addColorStop(1, 'rgba(24,28,16,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, R * 2, R * 2);
    this._shadow = c;
    return c;
  },

  _drawShadow(ctx, u, scale, lift) {
    // a man on his belly casts a long thin shadow; a man on his feet a small one
    const prone = u.pose === 'prone' || u.deadT != null;
    const w = (prone ? 30 : 15) * scale;
    const h = (prone ? 4.8 : 4.6) * scale;
    // it stays on the ground even when the soldier is up a tower
    const gy = u.y + (u.yj || 0) + S3_TARGET_H * scale * S3_FOOT;
    const fade = lift > 0 ? 0.45 : 1;           // elevated men cast a softer mark
    const img = this._shadowBlob();
    ctx.save();
    ctx.globalAlpha = fade * (u.deadT != null ? 0.7 : 1);
    ctx.drawImage(img, u.x - w, gy - h, w * 2, h * 2);
    ctx.restore();
  },

  /* A rifle going off throws real light. Painting a warm additive pool at the
   * muzzle is the cheapest lighting in the game and does the most work — in a
   * dusk palette it is the difference between a gunfight and a slideshow. */
  _drawMuzzleLight(ctx, game, lane) {
    let any = false;
    const night = this._night;
    for (const u of game.units) {
      if (u.lane !== lane || u.deadT != null) continue;
      const mt = u.muzzleT || 0;
      if (mt <= 0 || !Camera.sees(u.x)) continue;
      const p = Math.min(1, mt / 0.07);          // brightest at the instant of firing
      const m = muzzlePoint(u);
      const scale = LANE_DEPTH[lane] * (u.sj || 1);
      const r = (46 + 26 * p) * scale;
      if (night) {
        // after dark the flash is the only light there is, so it has to be laid
        // on top of the darkness rather than under it — collected here and
        // replayed once the night pass has gone down
        // additive light COMPOUNDS: five men firing together blew the frame to
        // white. Modest per-flash, so a firefight glows instead of flaring out.
        this._lights.push({ x: m.x, y: m.y, r: r * 1.15, p });
        continue;
      }
      if (!any) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; any = true; }
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, r);
      g.addColorStop(0, `rgba(255,214,140,${0.42 * p})`);
      g.addColorStop(0.35, `rgba(255,150,60,${0.18 * p})`);
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, 7);
      ctx.fill();
    }
    if (any) ctx.restore();
  },

  _drawUnits(ctx, game, lane, time) {
    // shadows first, as their own pass — otherwise one man's shadow paints over
    // the soldier standing behind him
    if (typeof S3_FOOT !== 'undefined') {
      for (const u of game.units) {
        if (u.lane !== lane || !Camera.sees(u.x)) continue;
        if (u.deadT != null && u.deadT > 1.4) continue;
        // match the body's fade, or the shadow snaps off while the man is still
        // dissolving and briefly leaves him floating
        if (u.deadT == null && (u.visA != null ? u.visA : 1) <= 0.01) continue;
        const sc = LANE_DEPTH[lane] * (u.sj || 1);
        const cv2 = u.squad && u.squad.inCover ? u.squad.cover : null;
        const tl = cv2
          ? (cv2.type === 'towerpos' ? 30 : (cv2.lift || 0)) * LANE_DEPTH[lane]
          : 0;
        this._drawShadow(ctx, u, sc, tl);
      }
    }
    for (const u of game.units) {
      if (u.lane !== lane || !Camera.sees(u.x)) continue;
      // Visibility fades rather than pops, and the fade is driven by the sim
      // (u.visA, see CONCEAL_FADE) — this used to assign the target straight to
      // u.visA, which meant the dissolve the comment promised never actually
      // ran and concealed men blinked out in a single frame.
      // The dead are always drawn: a body does not hide.
      const vis = u.deadT != null ? 1 : (u.visA != null ? u.visA : 1);
      // never skip a living man entirely — see CONCEAL_FLOOR. Skipping was what
      // made concealed enemies blink out of existence rather than fade into cover.
      if (vis <= 0.001 && u.deadT == null) continue;
      let scale = LANE_DEPTH[lane] * (u.sj || 1);
      const concealed = u.side === 'vc' && game.isConcealed(u);
      const alpha = (concealed && u.side === game.player ? 0.55 : 1) * Math.min(1, vis);
      // stance is decided by the squad-level state machine, nowhere else
      const pose = u.pose;
      // snipers on a tower platform stand above the ground line
      // a cover position can stand its holders off the ground: a tower platform,
      // or the raised floor of a stilt house seen through its window
      const cv = u.squad && u.squad.inCover ? u.squad.cover : null;
      const towerLift = cv
        ? (cv.type === 'towerpos' ? 30 : (cv.lift || 0)) * LANE_DEPTH[lane]
        : 0;
      /* A man who has gone to ground sits lower in the frame. The prone CLIP is
       * unusable (see Sprite3D._sel), so the aim pose is used and dropped
       * instead — the height difference is what sells "down" at 84px, not the
       * limb arrangement. */
      /* A crossing man's SCALE eases with him. The lanes sit at different depths
       * (LANE_DEPTH 0.92 / 1.08), and `lane` flips at the start of the crossing,
       * so without this he would jump 17% in size on the first frame and then
       * walk across at the wrong depth. */
      if (u.crossK != null && u.crossFrom != null) {
        const a = LANE_DEPTH[u.crossFrom], b = LANE_DEPTH[u.lane];
        scale = (a + (b - a) * u.crossK) * (u.sj || 1);
      }
      /* The prone pose is now `dive` frame 1, which is ALREADY a low posture —
       * a man pitched forward on his way to the ground — where the old one was
       * the standing `aim` pose that had to be shoved 26px down the screen to
       * pretend. Dropping this one that far buries him to the waist. 9px seats
       * him without sinking him. See Sprite3D._sel. */
      const proneDrop = u.pose === 'prone' ? 9 * scale
        : u.pose === 'kneel' ? 3 * scale : 0;
      /* RECOIL — a per-shot kick on the whole man.
       *
       * The vector rig has swapped recoil FRAMES off `muzzleT` since it was
       * written, but the 3D sprite path never got anything: men fired without
       * moving at all, which is most of why a firefight reads stiff even with
       * the muzzle and smoke work done. There is no recoil clip to play and the
       * donor has none to borrow, so this is positional — the man rides back
       * along his own facing and settles, over the 0.11s the shot already lasts.
       *
       * Deliberately small. At 84px a 3px kick is the difference between a man
       * firing and a man holding a rifle; 6px is a man being shoved. */
      const rk = (u.muzzleT || 0) > 0
        ? Math.min(1, (u.muzzleT || 0) / 0.11) * 3.0 * scale : 0;
      drawSoldier(ctx, u.key, {
        x: u.x - u.dir * rk, y: u.y + (u.yj || 0) - towerLift + proneDrop - rk * 0.35,
        dir: u.dir, scale,
        // debounced (see MOVE_HOLD) — the raw flag flickers sub-100ms and that
        // reached the screen as clip thrash
        moving: u.movingVis != null ? u.movingVis : u.moving,
        phase: u.phase, dist: u.dist || 0, spd: u.spd || 0,
        phWalk: u.phWalk, phRun: u.phRun,
        gaitOff: u.gaitOff || 0, gaitK: u.gaitK || 1,
        pose, deadT: u.deadT, alpha,
        dieK: u.dieK, dieLag: u.dieLag, dieLean: u.dieLean,
        flash: u.muzzleT > 0,
        combat: (u.combatT || 0) > 0,
        hitT: u.hitT || 0,
        wounded: u.wounded,
        nadeT: u.nadeT || 0, nadeDur: u.nadeDur || 0.9,
        muzzleT: u.muzzleT || 0,
        reload: (u.fireT || 0) > 0.55,
        transT: u.transT || 0, transDir: u.transDir || 1,
        transA: u.transA, transB: u.transB,
        ref: u, time,
      });
      if (u.deadT == null) {
        if (concealed && u.side === game.player) {
          ctx.fillStyle = 'rgba(140,190,110,0.8)';
          ctx.font = '9px Courier New';
          ctx.fillText('▼', u.x - 3, u.y - 74 * scale);
        }
        if (u.hp < u.maxHp) {
          const w = 18 * scale;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(u.x - w / 2, u.y - 68 * scale, w, 2.5);
          ctx.fillStyle = u.side === 'us' ? '#9fc46a' : '#e08767';
          ctx.fillRect(u.x - w / 2, u.y - 68 * scale, w * (u.hp / u.maxHp), 2.5);
        }
        if (u.aiming && u.aimTarget && !u.aimTarget.deadT) {
          const prog = u.aimT / u.aimTime;
          ctx.save();
          ctx.globalAlpha = 0.12 + prog * 0.2;
          ctx.strokeStyle = '#ffd0a0';
          ctx.setLineDash([3, 6]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(u.x + u.dir * 16, u.y - 8 * scale);
          ctx.lineTo(u.aimTarget.x, u.aimTarget.y - 28 * scale);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
    // last, so the flash falls ON the men and the ground rather than under them
    this._drawMuzzleLight(ctx, game, lane);
  },

  _drawFires(ctx, game, lane, time) {
    for (const f of game.fires) {
      if (f.lane !== lane) continue;
      const y0 = groundY(game.map, lane, (f.x0 + f.x1) / 2);
      const g = ctx.createLinearGradient(0, y0 - 30, 0, y0 + 8);
      g.addColorStop(0, 'rgba(255,140,40,0)');
      g.addColorStop(1, `rgba(255,120,30,${0.25 * Math.min(1, f.t)})`);
      ctx.fillStyle = g;
      ctx.fillRect(f.x0, y0 - 30, f.x1 - f.x0, 40);
      // looping flame sprites along the strip
      if (typeof Assets !== 'undefined' && Assets.anim('groundfire')) {
        const fade = Math.min(1, f.t * 2, Math.max(0, (f.dur - f.t) * 1.4));
        for (let x = f.x0 + 20; x < f.x1 - 8; x += 54) {
          if (!Camera.sees(x)) continue;
          const gy = groundY(game.map, lane, x);
          const fi = Math.floor(time * 11 + x * 0.37) % 7;
          Assets.drawAnimFrame(ctx, 'groundfire', fi, x, gy + 3, 30 + (Math.floor(x * 7.7) % 13), {
            add: true, ground: true, alpha: 0.85 * fade,
          });
        }
      }
    }
  },

  _drawStrikes(ctx, game, time) {
    const map = game.map;
    for (const s of game.strikes) {
      if (s.type === 'arty' || s.type === 'arclight') {
        for (const im of s.impacts) {
          const tt = im.t - s.age;
          if (!im.done && tt < 0.5 && tt > 0) {
            const y = groundY(map, s.lane, im.x) - tt * 700;
            ctx.strokeStyle = 'rgba(255,240,200,0.55)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(im.x + tt * 30, y - 26); ctx.lineTo(im.x, y); ctx.stroke();
          }
        }
        if (s.type === 'arclight') {
          const px = s.x + (s.age - 4.6) * 420;
          drawB52(ctx, px, 52);
          drawB52(ctx, px - 90, 64);
          drawB52(ctx, px - 180, 58);
        }
      } else if (s.type === 'napalm') {
        const px = s.x + (s.age - s.dropT) * 540;
        const py = LANE_BASE[s.lane] - 250;
        drawJet(ctx, px, py, 1);
        if (s.age > s.dropT - 0.5 && s.age < s.dropT + 0.2) {
          const k = (s.age - (s.dropT - 0.5)) / 0.7;
          ctx.fillStyle = '#33382c';
          for (let i = 0; i < 3; i++) {
            const cx = s.x - 60 + i * 60;
            const cy = lerp(py + 10, groundY(map, s.lane, cx), clamp(k + i * 0.06, 0, 1));
            ctx.beginPath(); ctx.ellipse(cx, cy, 5, 2.4, 0.5, 0, 7); ctx.fill();
          }
        }
      } else if (s.type === 'medevac') {
        const px = Camera.x + lerp(-80, CANVAS_W + 120, clamp(s.age / 5, 0, 1));
        drawHuey(ctx, px, 170, time, { medevac: true });
      } else if (s.type === 'patrol') {
        const px = s.x + s.dirX * s.age * 170;
        const py = s.y + Math.sin(time * 1.3) * 3;
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(0.65, 0.65);
        drawHuey(ctx, 0, 0, time, { color: 'rgba(44,51,36,0.85)', dir: s.dirX });
        ctx.restore();
        if (!s.heard && Camera.sees(px, 240)) {
          s.heard = true;
          Sound.chopper(3);
        }
      } else if (s.type === 'aircav') {
        let px, py;
        const hoverY = groundY(map, s.lane, s.x) - 64;
        if (s.age < 2.2) {
          const k = s.age / 2.2;
          px = lerp(s.x - 680, s.x, k);
          py = lerp(130, hoverY, k * k);
        } else if (s.age < 3.6) {
          px = s.x; py = hoverY + Math.sin(time * 3) * 2;
          ctx.strokeStyle = 'rgba(180,170,140,0.8)';
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(s.x - 4, py + 10); ctx.lineTo(s.x - 4, groundY(map, s.lane, s.x)); ctx.stroke();
        } else {
          const k = (s.age - 3.6) / 2.4;
          px = lerp(s.x, s.x + 760, k);
          py = lerp(hoverY, 110, k);
        }
        drawHuey(ctx, px, py, time);
      }
    }
  },

  _drawParticles(ctx, fx, camX) {
    const xmin = camX - 120, xmax = camX + CANVAS_W + 120;
    for (const p of fx.particles) {
      if (p.x < xmin || p.x > xmax) continue;
      const k = p.t / p.life;
      if (p.type === 'anim') {
        let fi = Math.floor(p.t * p.fps);
        if (p.loop) fi %= p.n;
        const fadeIn = Math.min(1, p.t * 18);
        const fadeOut = p.loop ? 1 : clamp((1 - k) * 4, 0, 1);
        Assets.drawAnimFrame(ctx, p.anim, fi, p.x, p.y, p.h, {
          add: p.add, flip: p.flip, ground: p.ground,
          alpha: p.alpha * fadeIn * fadeOut,
        });
      } else if (p.type === 'bullet') {
        /* Flying round: hot core + fading streak behind it.
         *
         * A TRACER streaks about three times as far as an ordinary round and
         * carries a core; the rest are a thin dim line. That contrast is what
         * makes a firefight read as tracer fire rather than as a uniform sheet
         * of light — see Fx.tracer for why only some rounds are bright. */
        const bright = p.bright !== false;
        const sp = Math.hypot(p.vx, p.vy) || 1;
        const tail = bright ? Math.min(78, sp * 0.052) : Math.min(15, sp * 0.010);
        const tx = p.x - p.vx / sp * tail, ty = p.y - p.vy / sp * tail;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const grad = ctx.createLinearGradient(tx, ty, p.x, p.y);
        grad.addColorStop(0, 'rgba(255,180,90,0)');
        grad.addColorStop(1, p.color);
        ctx.strokeStyle = grad;
        ctx.lineWidth = bright ? 2.4 : 1.1;
        ctx.globalAlpha = bright ? 1 : 0.5;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.globalAlpha = 1;
        if (bright) {
          ctx.fillStyle = '#fff8e0';
          ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, 7); ctx.fill();
        }
        ctx.restore();
      } else if (p.type === 'flash') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + k), 0, 7); ctx.fill();
        ctx.restore();
      } else if (p.type === 'shock') {
        ctx.strokeStyle = p.color + (0.5 * (1 - k)) + ')';
        ctx.lineWidth = 2.5 * (1 - k);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * k, 0, 7); ctx.stroke();
      } else if (p.type === 'smoke') {
        /* `dust` is not smoke. Kicked-up earth is WARMER and LIGHTER than the
         * field it comes off, which is what makes it read against grass; drawn
         * in the neutral grey of gunsmoke it disappeared into the ground it was
         * supposed to be rising from. */
        ctx.fillStyle = p.color === 'dark' ? `rgba(30,28,24,${0.4 * (1 - k)})`
          : p.color === 'blood' ? `rgba(110,26,16,${0.3 * (1 - k)})`
          : p.color === 'dust' ? `rgba(196,174,132,${0.6 * (1 - k)})`
          : `rgba(126,120,104,${0.42 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.6 + k), 0, 7); ctx.fill();
      } else if (p.type === 'flame') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, 7); ctx.fill();
        ctx.restore();
      } else if (p.type === 'glint') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.sin(k * Math.PI);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        const r = p.size * 2;
        ctx.beginPath();
        ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x + r, p.y);
        ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y + r);
        ctx.stroke();
        ctx.restore();
      } else if (p.type === 'spark') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.restore();
      } else if (p.type === 'bird') {
        ctx.save();
        ctx.strokeStyle = 'rgba(30,30,26,0.85)';
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = clamp((1 - k) * 4, 0, 1);
        const w = Math.sin(p.t * 16 + p.flap) * p.size * 1.6;
        ctx.beginPath();
        ctx.moveTo(p.x - p.size * 2, p.y - w);
        ctx.quadraticCurveTo(p.x, p.y + p.size * 0.5, p.x + p.size * 2, p.y - w);
        ctx.stroke();
        ctx.restore();
      } else if (p.type === 'gib') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.globalAlpha = clamp((1 - k) * 3, 0, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        ctx.restore();
      } else {
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.globalAlpha = 1;
      }
    }
  },

  _drawWeather(ctx, map, time) {
    const w = map.weather || {};
    if (w.rain) {
      ctx.save();
      ctx.strokeStyle = 'rgba(200,215,220,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 110; i++) {
        const h1 = ((i * 2654435761) >>> 8) % 1000 / 1000;
        const h2 = ((i * 1597334677) >>> 8) % 1000 / 1000;
        const x = (h1 * CANVAS_W + time * 90) % CANVAS_W;
        const y = (h2 * CANVAS_H + time * 620 * (0.7 + h1 * 0.5)) % CANVAS_H;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 3, y + 13);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (w.fog) {
      // uniform ground-mist gradient — no drifting screen-anchored blobs
      ctx.save();
      const g = ctx.createLinearGradient(0, 300, 0, CANVAS_H);
      g.addColorStop(0, 'rgba(215,222,215,0)');
      g.addColorStop(0.45, `rgba(215,222,215,${0.10 * w.fog})`);
      g.addColorStop(1, `rgba(215,222,215,${0.16 * w.fog})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 300, CANVAS_W, CANVAS_H - 300);
      ctx.restore();
    }
  },

  /* soft translucent wash over the hovered lane while deploying/targeting */
  _laneGlow(ctx, game, lane, time, sx, sw) {
    const map = game.map;
    const bot = LANE_BANDS[lane][1];
    const pulse = 0.15 + 0.04 * Math.sin(time * 4);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sx, bot);
    for (let x = sx; x <= sx + sw; x += 32) ctx.lineTo(x, groundY(map, lane, x) - 30);
    ctx.lineTo(sx + sw, bot);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,232,170,${pulse})`;
    ctx.fill();
    // trace the ground line itself a touch brighter
    ctx.beginPath();
    for (let x = sx; x <= sx + sw; x += 24) {
      const y = groundY(map, lane, x) + 1;
      x === sx ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(255,225,150,${pulse * 3.2})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  },

  _drawTargeting(ctx, game, ui) {
    if (ui.armedCallin && ui.hoverLane != null) {
      const key = ui.armedCallin, def = CALLINS[key];
      const lane = ui.hoverLane, x = ui.hoverX;
      const y = groundY(game.map, lane, x);
      const R = { arty: 115, napalm: 165, arclight: 340, aircav: 46, punji: 14, mine: 16, spiderhole: 14, tunnel: 16 }[key] || 40;
      const valid = game.callinValid(game.player, key, lane, x);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = valid ? '#ffd98a' : '#d24a2e';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x - R, y - 26); ctx.lineTo(x - R, y + 8);
      ctx.moveTo(x + R, y - 26); ctx.lineTo(x + R, y + 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, y - 30); ctx.lineTo(x, y + 10);
      ctx.moveTo(x - 14, y - 10); ctx.lineTo(x + 14, y - 10);
      ctx.stroke();
      ctx.font = 'bold 11px Courier New';
      ctx.fillStyle = valid ? '#ffd98a' : '#d24a2e';
      ctx.fillText(valid ? def.name.toUpperCase() : 'INVALID GRID', x - 30, y - 36);
      ctx.restore();
    } else if (ui.armedUnit && ui.hoverLane != null) {
      // clean deploy marker at the spawn point: chevron + one pip per man
      const lane = ui.hoverLane;
      const sd = SQUADS[ui.armedUnit];
      const dir = game.player === 'us' ? 1 : -1;
      const x = game.spawnX(game.player, lane);
      const y = groundY(game.map, lane, x);
      const pulse = 0.65 + 0.25 * Math.sin((ui.game ? ui.game.time : 0) * 6);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ffd98a';
      ctx.beginPath();
      ctx.moveTo(x - 7, y - 46); ctx.lineTo(x + 7, y - 46); ctx.lineTo(x, y - 38);
      ctx.closePath(); ctx.fill();
      const n = sd ? sd.comp.length : 1;
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.arc(x - (n - 1) * 4 + i * 8, y - 54, 2.4, 0, 7);
        ctx.fill();
      }
      ctx.restore();
    }
  },

  _drawFloaters(ctx, fx) {
    for (const f of fx.floaters) {
      const k = f.t / f.life;
      ctx.save();
      ctx.globalAlpha = 1 - k * k;
      ctx.font = f.big ? 'bold 15px Courier New' : 'bold 11px Courier New';
      ctx.fillStyle = '#000';
      ctx.fillText(f.text, f.x - f.text.length * 3 + 1, f.y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x - f.text.length * 3, f.y);
      ctx.restore();
    }
  },

  /* ---------- minimap ---------- */
  drawMinimap(game) {
    const canvas = this.minimapCanvas || document.getElementById('minimap');
    if (!canvas) return;
    this.minimapCanvas = canvas;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const kx = W / WORLD_W;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(18,20,14,0.85)';
    ctx.fillRect(0, 0, W, H);
    // terrain silhouettes per lane
    for (let l = 0; l < LANE_N; l++) {
      const yBase = 12 + l * 14;
      ctx.strokeStyle = game.map.pal.laneTop[l];
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= WORLD_W; x += 64) {
        const y = yBase - elevAt(game.map, l, x) * 8;
        x === 0 ? ctx.moveTo(x * kx, y) : ctx.lineTo(x * kx, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      // flag
      const f = game.flags[l];
      ctx.fillStyle = f.owner === 'us' ? '#b5c98f' : f.owner === 'vc' ? '#e08767' : '#999';
      ctx.fillRect(f.x * kx - 1.5, yBase - 9, 3, 5);
      // units
      for (const u of game.units) {
        if (u.lane !== l || u.deadT != null) continue;
        if (!game.visibleToPlayer(u)) continue;
        ctx.fillStyle = u.side === 'us' ? '#9fc46a' : '#e0714a';
        ctx.fillRect(u.x * kx - 1, yBase - 4, 2, 3);
      }
    }
    // camera window
    ctx.strokeStyle = 'rgba(240,230,200,0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Camera.x * kx + 0.5, 1.5, CANVAS_W * kx - 1, H - 3);

    this._drawFrontline(ctx, game, W, H, kx);
  },

  /* Frontline control bar, one strip per lane.
   *
   * The minimap shows where men ARE; this shows who owns the ground between
   * them. Held territory is filled from each base to that lane's contested
   * point, so a lane being lost reads at a glance without counting dots. */
  _drawFrontline(ctx, game, W, H, kx) {
    const y0 = H - 5;
    for (let l = 0; l < LANE_N; l++) {
      const y = y0 - (2 - l) * 4;
      // the contested point: between the deepest US push and the deepest VC push
      let usF = null, vcF = null;
      for (const u of game.units) {
        if (u.lane !== l || u.deadT != null) continue;
        if (u.side === 'us') usF = usF == null ? u.x : Math.max(usF, u.x);
        else vcF = vcF == null ? u.x : Math.min(vcF, u.x);
      }
      let cut;
      if (usF == null && vcF == null) cut = WORLD_W / 2;
      else if (usF == null) cut = Math.min(vcF, WORLD_W);
      else if (vcF == null) cut = usF;
      else cut = (usF + vcF) / 2;
      cut = clamp(cut, 0, WORLD_W);

      ctx.fillStyle = 'rgba(10,12,8,0.9)';
      ctx.fillRect(0, y, W, 3);
      ctx.fillStyle = 'rgba(159,196,106,0.85)';
      ctx.fillRect(0, y, cut * kx, 3);
      ctx.fillStyle = 'rgba(224,113,74,0.85)';
      ctx.fillRect(cut * kx, y, W - cut * kx, 3);
      // the seam itself, so the eye lands on where it is actually being decided
      ctx.fillStyle = 'rgba(255,240,205,0.95)';
      ctx.fillRect(cut * kx - 0.75, y - 1, 1.5, 5);
    }
  },

  /* ---------- menu backdrop ---------- */
  drawMenu(time) {
    const ctx = this.ctx;
    const K = this._k || 1;
    ctx.setTransform(K, 0, 0, K, 0, 0);
    if (!this.menuLayer) {
      this.menuLayer = this._makeLayer();
      const mctx = this.menuLayer.getContext('2d');
      this._drawSkyBase(mctx, MAPS.iadrang);
      const rng0 = seeded(4243);
      this._ridge(mctx, rng0, CANVAS_W, 260, 70, MAPS.iadrang.pal.hillFar, 0.85);
      this._ridge(mctx, rng0, CANVAS_W, 300, 55, MAPS.iadrang.pal.hillNear, 1);
      const rng = seeded(4242);
      mctx.fillStyle = '#2e3520';
      mctx.beginPath();
      mctx.moveTo(0, CANVAS_H);
      mctx.lineTo(0, 520);
      for (let x = 0; x <= CANVAS_W; x += 40) mctx.lineTo(x, 520 + Math.sin(x * 0.01 + 2) * 20 - rng() * 24);
      mctx.lineTo(CANVAS_W, CANVAS_H);
      mctx.closePath(); mctx.fill();
      for (let i = 0; i < 26; i++) {
        const x = rng() * CANVAS_W;
        this._tree(mctx, MAPS.cuchi, rng, x, 560 + rng() * 120, 1.4);
      }
      mctx.fillStyle = '#1c2314';
      mctx.beginPath();
      mctx.moveTo(0, CANVAS_H);
      mctx.lineTo(0, 640);
      for (let x = 0; x <= CANVAS_W; x += 30) mctx.lineTo(x, 640 + Math.sin(x * 0.02) * 12 - rng() * 18);
      mctx.lineTo(CANVAS_W, CANVAS_H);
      mctx.closePath(); mctx.fill();
    }
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.drawImage(this.menuLayer, 0, 0);
    for (let i = 0; i < 3; i++) {
      const px = ((time * 42 + i * 260) % (CANVAS_W + 700)) - 350;
      const py = 150 + i * 42 + Math.sin(time * 1.4 + i * 2) * 6;
      drawHuey(ctx, px, py, time + i, { color: 'rgba(40,46,32,0.85)' });
    }
  },
};

/* ---------- card icons ---------- */
function drawUnitIcon(canvas, key) {
  canvas.width = 88; canvas.height = 76;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 88, 76);
  const sk = UNIT_SPRITES[key];
  const sheet = (typeof Assets !== 'undefined') && Assets.done && sk ? Assets.sheet(sk) : null;
  if (sheet) {
    const name = sheet.poses.idle;
    const m = Assets.meta(name);
    if (m && Assets.drawAnchored(ctx, name, 44, 73, 64 / sheet.standH)) return;
  }
  drawSoldierVector(ctx, key, { x: 44, y: 68, dir: 1, scale: 2.0, moving: false, phase: 0 });
}

function drawCallinIcon(canvas, icon) {
  canvas.width = 88; canvas.height = 76;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 88, 76);
  ctx.save();
  ctx.translate(44, 40);
  ctx.strokeStyle = '#d8d2b0';
  ctx.fillStyle = '#d8d2b0';
  ctx.lineWidth = 3;
  switch (icon) {
    case 'shell':
      ctx.beginPath();
      ctx.moveTo(0, -22); ctx.quadraticCurveTo(9, -8, 9, 6); ctx.lineTo(9, 20); ctx.lineTo(-9, 20); ctx.lineTo(-9, 6);
      ctx.quadraticCurveTo(-9, -8, 0, -22);
      ctx.fill();
      ctx.fillStyle = '#8a2f22'; ctx.fillRect(-9, 8, 18, 5);
      break;
    case 'flame':
      ctx.beginPath();
      ctx.moveTo(0, 22);
      ctx.bezierCurveTo(-16, 12, -10, -4, -4, -10);
      ctx.bezierCurveTo(-4, -2, 2, -2, 2, -12);
      ctx.bezierCurveTo(10, -6, 14, 6, 8, 14);
      ctx.bezierCurveTo(6, 18, 4, 20, 0, 22);
      ctx.fill();
      ctx.fillStyle = '#8a2f22';
      ctx.beginPath(); ctx.ellipse(0, 12, 5, 8, 0, 0, 7); ctx.fill();
      break;
    case 'cross':
      ctx.fillRect(-6, -20, 12, 40);
      ctx.fillRect(-20, -6, 40, 12);
      break;
    case 'huey':
      drawHuey(ctx, 0, 0, 1.2, { color: '#d8d2b0' });
      break;
    case 'b52':
      ctx.scale(1.4, 1.4);
      drawB52(ctx, 0, 0);
      ctx.fillStyle = '#d8d2b0';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(-8 + i * 8, 14, 2, 4, 0, 0, 7); ctx.fill(); }
      break;
    case 'spikes':
      ctx.lineWidth = 3.4;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.moveTo(i * 9, 18); ctx.lineTo(i * 9 + 3, -12 + Math.abs(i) * 5); ctx.stroke();
      }
      break;
    case 'mine':
      ctx.beginPath(); ctx.arc(0, 4, 13, 0, 7); ctx.fill();
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI + i * Math.PI / 4;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * 13, 4 + Math.sin(a) * 13);
        ctx.lineTo(Math.cos(a) * 19, 4 + Math.sin(a) * 19); ctx.stroke();
      }
      break;
    case 'hole':
      ctx.beginPath(); ctx.ellipse(0, 10, 20, 8, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#14170f';
      ctx.beginPath(); ctx.ellipse(0, 8, 11, 4.5, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#d8d2b0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-2, 6); ctx.lineTo(14, -4); ctx.stroke();
      break;
    case 'tunnel':
      ctx.beginPath(); ctx.ellipse(0, 14, 17, 6, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#14170f';
      ctx.beginPath(); ctx.arc(0, 14, 11, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#d8d2b0'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(-11, 14); ctx.lineTo(-11, 2); ctx.moveTo(11, 14); ctx.lineTo(11, 2); ctx.stroke();
      break;
  }
  ctx.restore();
}

function drawMapThumb(canvas, map) {
  canvas.width = 150; canvas.height = 44;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 44);
  g.addColorStop(0, map.pal.skyTop);
  g.addColorStop(1, map.pal.skyBot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 150, 44);
  for (let l = 0; l < LANE_N; l++) {
    ctx.fillStyle = map.pal.laneBody[l];
    ctx.beginPath();
    ctx.moveTo(0, 44);
    for (let x = 0; x <= 150; x += 6) {
      const e = elevAt(map, l, (x / 150) * WORLD_W);
      ctx.lineTo(x, 20 + l * 8 - e * 16);
    }
    ctx.lineTo(150, 44);
    ctx.closePath(); ctx.fill();
  }
}
