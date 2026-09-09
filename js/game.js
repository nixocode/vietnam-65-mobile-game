'use strict';

const CP_CAP = 250;

/* Squad veterancy. Men who survive contact get better at it, which is the whole
 * reason to pull a hurt squad back instead of feeding it. Kept deliberately small
 * — this should reward keeping a squad alive, not make a rank-3 squad unkillable.
 * Thresholds are kills by that squad. */
const RANKS = [
  { at: 0,  name: 'GREEN',     acc: 1.00, steady: 1.00 },
  { at: 3,  name: 'SEASONED',  acc: 1.08, steady: 0.88 },
  { at: 8,  name: 'VETERAN',   acc: 1.16, steady: 0.76 },
  { at: 16, name: 'HARDENED',  acc: 1.24, steady: 0.64 },
];

function rankOf(xp) {
  let r = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if ((xp || 0) >= RANKS[i].at) { r = i; break; }
  }
  return r;
}
const INCOME = { us: 3.1, vc: 3.5 }; // squads cost more than v1 units — keep waves breathing
const FLAG_INCOME = 0.5;
const FLAG_DRAIN = 0.22;
const MORALE_LOSS = { us: 0.24, vc: 0.15 }; // per CP of unit lost — US is casualty-sensitive
const MAX_TRAPS = 10;

/* ---------- cover: capacity, crowding, and time ----------
 *
 * Cover used to be a binary slot: one squad, one hole, a constant protection
 * number for as long as you sat in it. That makes cover a place, not a
 * decision — you either got there first or you did not, and nothing about
 * WHEN you moved ever mattered.
 *
 * Three knobs turn it into a timing problem:
 *
 *   capacity   a trench holds two or three squads, a rock holds one. Massing
 *              is possible, which means it can also be punished.
 *   crowding   every squad past the first costs the whole position some
 *              small-arms protection (men fight from the lip) AND multiplies
 *              what one shell does to everyone in it. Massing wins the
 *              firefight and loses to indirect fire. That trade is the system.
 *   time       holding still improves the position (DIG) and simultaneously
 *              lets the enemy range it in (RANGE). Being dug in and being
 *              about to be shelled are the same clock.
 *
 * Every one of these resets the moment the squad moves, so the player is
 * choosing when to break a good position rather than whether to have one. */
const COVER = {
  CROWD_LOSS:  0.17,   // small-arms protection each extra squad costs everyone
  CROWD_BLAST: 0.55,   // extra blast damage per extra squad in the same hole
  DIG_TIME:    13,     // seconds of holding still to fully improve a position
  DIG_MAX:     0.15,   // protection a fully improved position adds
  PROT_CAP:    0.82,
  DUG_CAP:     0.93,   // a dug position out-protects anything else on the map
  DUG_BLAST:   1.6,    // ...and is the worst place on the map to be shelled
  /* Timed against DIG_TIME, not picked in isolation.
   *
   * At 17s the ranging round landed four seconds after the position finished
   * improving — measured on a held squad: protection reached its 0.77 ceiling
   * at 13s and the warning came at 17.0, so the reward for digging in was worth
   * about four seconds and the only correct play was to keep moving. That is
   * not a timing decision, it is a metronome.
   *
   * 26s leaves a real window at full protection to be worth holding for, and
   * still ends. A squad that ignores the warning is down to an eighth of its
   * strength inside half a minute. */
  RANGE_TIME:  26,     // seconds in one spot before the enemy has it ranged
  RANGE_WARN:  3.6,    // ranging round lands, then this long before fire-for-effect
  RANGE_RATE:  5.6,    // seconds between rounds once they are on target
};

/* Squads a side may have in the field at once.
 *
 * The AI has always capped itself here (`_aiPickUnit` bailed above 7 squads).
 * The PLAYER never had a cap, and that one-sided limit decided every match:
 * measured on veteran, the AI's CP climbed to the 250 ceiling while its unit
 * count sat flat at 19 and the player fielded 105 men. Whoever spams wins, and
 * only one side could spam.
 *
 * A symmetric limit fixes three things at once — the AI stops hoarding and
 * stays competitive, matches turn on position rather than volume, and the unit
 * count stops climbing into a frame-rate problem. It is also the more honest
 * model: a commander gets a company, not an unlimited draft. */
const MAX_SQUADS = 8;

/* Concealment is a posture, not a map coordinate. Brush hides a man who has
 * settled into it; it does not hide one crossing at a dead run. Gating on
 * position alone made VC blink out mid-stride whenever they entered a conceal
 * span — and those spans run to nearly half a lane on some maps, so a squad
 * advancing down one popped in and out repeatedly. That reads as a rendering
 * fault, not as stealth, which is the worst of both: it looks broken AND it
 * gives away nothing about where the ambush actually is.
 *
 * stillT builds while a man holds position and zeroes the instant he moves, so
 * breaking cover reveals immediately while a settled ambusher stays hidden. */
const CONCEAL_SETTLE = 0.45;   // seconds of stillness before brush closes over him
const CONCEAL_FADE = 0.40;     // seconds to dissolve out of sight once concealed

/* How visible a concealed man stays. NOT zero.
 *
 * Concealment used to fade a man to nothing, and measured in a live battle 5%
 * of all man-frames rendered at partial alpha with 580 of 659 of those FULLY
 * INVISIBLE — one NVA spent 100% of his life unseeable. That is not an ambush,
 * it is a unit the player can never see, and it reads as the renderer dropping
 * frames rather than as an enemy hiding.
 *
 * The comment in the draw path has claimed for a long time that concealed men
 * "settle to a dim shape in the brush" — this is that, finally made true. The
 * tactical value is intact: at 0.22 you can tell something is there and not
 * what it is or exactly where, which is what concealment should buy. What it
 * should never buy is a man who is not drawn at all. */
const CONCEAL_FLOOR = 0.22;

/* structure archetypes: [w, hp] */
const STRUCT_DEFS = {
  hooch:     { w: 42, hp: 60 },
  longhouse: { w: 74, hp: 110 },
  stilt:     { w: 48, hp: 55 },
  bunker:    { w: 52, hp: 220 },
  well:      { w: 12, hp: 70 },
  hay:       { w: 16, hp: 25 },
  tower:     { w: 30, hp: 120 },   // sniper emplacement — commanding view
  mgnest:    { w: 40, hp: 170 },   // log-and-sandbag MG position
  banana:    { w: 24, hp: 20 },
  cart:      { w: 28, hp: 24 },
  shrine:    { w: 18, hp: 30 },
  stall:     { w: 32, hp: 30 },
  crates:    { w: 22, hp: 40 },   // stacked ammunition, at a firebase
};

function buildSettlement(map, s, structures) {
  const rng = seeded((map.seed + s.lane * 7 + Math.floor(s.x * 997)) >>> 0);
  const cx = s.x * WORLD_W;
  const put = (kind, off) => {
    const d = STRUCT_DEFS[kind];
    structures.push({
      lane: s.lane, x: cx + off, w: d.w, kind,
      hp: s.pre ? d.hp * 0.4 : d.hp, maxHp: d.hp,
      state: s.pre ? 1 : 0, burnT: 0, fireHurt: 0,
      seed: Math.floor(rng() * 1e9),
    });
  };
  if (s.kind === 'hamlet') {
    put('hooch', -66); put('hooch', 6); put('hooch', 72);
    put('well', -18); put('hay', 40);
    put('banana', -96); put('cart', 98);
  } else if (s.kind === 'village') {
    put('hooch', -110); put('longhouse', -30); put('hooch', 52);
    put('hooch', 112); put('well', 84); put('hay', -66);
    put('banana', -146); put('shrine', -138); put('stall', 148); put('banana', 170);
  } else if (s.kind === 'stilt') {
    put('stilt', -54); put('stilt', 8); put('stilt', 66); put('hay', -14);
    put('banana', 100); put('cart', -88);
  } else if (s.kind === 'bunkers') {
    /* There was a HAYSTACK here. `bunkers` is used by exactly two maps — the
     * Marine perimeter at Khe Sanh and the NVA crest positions on Hill 937 —
     * and both were getting a piece of farm dressing dropped between the
     * fighting positions, because this branch was copied from the hamlet one.
     * A position gets more position: sandbags and a stack of ammunition. */
    put('bunker', -34); put('bunker', 38);
    put('mgnest', 2); put('crates', -74);
  }
}

class Game {
  constructor(cfg) {
    this.map = normaliseMap(MAPS[cfg.mapId]);
    /* MOBILE: warm the atlases this match can actually field. They are no
     * longer loaded at boot (see Sprite3D.load), so without this the first man
     * of each type would draw as the procedural fallback for a frame. */
    if (typeof Sprite3D !== 'undefined' && Sprite3D.prefetch) Sprite3D.prefetch(this.map);
    this.player = cfg.playerSide;
    this.enemy = other(this.player);
    this.aiSide = this.enemy;
    this.diff = DIFFS[cfg.difficulty || 'veteran'];
    this.mode = this.map.mode;

    this.fx = new FXManager(this.map);
    this.units = [];
    this.traps = [];
    this.holes = [];
    this.tunnels = [];
    this.strikes = [];
    this.fires = [];
    this.events = [];
    this.banner = null;

    this.cp = { us: 30, vc: 30 };
    if (this.map.startCP) for (const s in this.map.startCP) this.cp[s] += this.map.startCP[s];
    this.morale = { us: 100, vc: 100 };
    this.cool = { us: {}, vc: {} };
    this.stats = {
      us: { kills: 0, losses: 0, callins: 0, cpSpent: 0 },
      vc: { kills: 0, losses: 0, callins: 0, cpSpent: 0 },
    };
    this.hiddenLoss = [0, 0, 0];

    this.conceal = this.map.lanes.map(l =>
      (l.conceal || []).map(z => ({ x0: z[0], x1: z[1], burned: false }))
    );
    this.flags = this.map.flags.map((fx_, i) => ({
      lane: i, x: fx_ * WORLD_W, owner: this.map.preOwner || null, cap: 0, capSide: null,
    }));

    this.time = 0;
    this.timeLimit = this.mode === 'siege' ? this.map.siegeTime : this.mode === 'assault' ? this.map.assaultTime : 0;
    this.over = false;
    this.result = null;
    this.aiT = 2;
    this.duelAnnounced = 0;

    // settlements → destructible structures
    this.structures = [];
    for (const s of (this.map.settlements || [])) buildSettlement(this.map, s, this.structures);

    // squads + cover network
    this.squads = [];
    this.nades = [];
    this.smokes = [];
    this.genCovers();
    this._addWindows();

    // ambient life
    this.birdT = rand(4, 10);
    this.patrolT = rand(30, 60);
    const arng = seeded(this.map.seed + 99);
    this.smokeSrc = [];
    for (let i = 0; i < 2; i++) {
      this.smokeSrc.push({ x: (0.2 + arng() * 0.6) * WORLD_W, t: arng() * 0.6 });
    }

    if (this.map.prePlaced) {
      for (const p of this.map.prePlaced) {
        const x = p.x * WORLD_W;
        if (p.kind === 'unit') {
          this._makeSquad(p.side, p.key, p.lane, x, { hold: true });
        } else if (p.kind === 'hole') {
          this.holes.push(this._makeHole(p.lane, x));
        } else if (p.kind === 'trap') {
          this.traps.push({ side: p.side, lane: p.lane, x, type: p.type, discovered: false, defuse: 0 });
        }
      }
    }
  }

  emit(text, cls) {
    this.events.push({ text, cls: cls || 'sys' });
    if (this.events.length > 30) this.events.shift();
  }

  setBanner(text, danger) { this.banner = { text, danger: !!danger, fresh: true }; }

  /* ---------- helpers ---------- */
  inConceal(lane, x) {
    return this.conceal[lane].some(z => !z.burned && x >= z.x0 * WORLD_W && x <= z.x1 * WORLD_W);
  }

  isConcealed(u) {
    if (u.side !== 'vc' || !UNITS[u.key].conceal) return false;
    if (u.revealT > 0 || u.spotT > 0) return false;
    // Movement disqualifies concealment outright — including inside a prepared
    // hide. A squad is flagged inCover from the moment it is bound to the
    // position, not from when it settles, so exempting hides here left men
    // running at full speed while invisible. Both checks read u.moving as well
    // as stillT because stillT is accumulated from the previous frame's flag;
    // without it a man stays hidden for the first frame of his sprint.
    if (u.moving || (u.stillT || 0) < CONCEAL_SETTLE) return false;
    const inHide = u.squad && u.squad.inCover && u.squad.cover && u.squad.cover.conceals;
    return inHide || this.inConceal(u.lane, u.x);
  }

  visibleToPlayer(u) {
    if (u.side === this.player) return true;
    return !this.isConcealed(u);
  }

  /* How much smoke sits on a point, 0..1. Screening builds as the cloud develops
   * and thins as it dies, so popping smoke is not instant cover. */
  smokeAt(lane, x) {
    let k = 0;
    for (const s of this.smokes) {
      if (s.lane !== lane) continue;
      const d = Math.abs(s.x - x);
      if (d > s.radius) continue;
      const grow = Math.min(1, s.age / SMOKE.build);
      const fade = Math.min(1, s.life / 2.5);
      k = Math.max(k, (1 - d / s.radius) * grow * fade);
    }
    return k;
  }

  canSee(side, t) {
    if (t.isHole) return t.revealT > 0 || t.discovered || side === 'vc';
    if (t.side === side) return true;
    // a target well inside smoke cannot be picked out
    if (this.smokeAt(t.lane, t.x) > 0.55) return false;
    return !this.isConcealed(t);
  }

  spawnX(side, lane) {
    if (side === 'vc') {
      const tn = this.tunnels.find(t => t.lane === lane);
      if (tn) return tn.x;
    }
    return BASE_X[side];
  }

  _makeUnit(side, key, lane, x) {
    const d = UNITS[key];
    return {
      side, key, lane, x,
      y: groundY(this.map, lane, x),
      dir: side === 'us' ? 1 : -1,
      hp: d.hp, maxHp: d.hp,
      sj: rand(0.94, 1.06), // slight build variation
      // gait identity: without these a squad walks in perfect lockstep, which is
      // the thing that reads as "robots" rather than men
      gaitOff: Math.random(), gaitK: rand(0.93, 1.07),
      /* Death identity, for the same reason and at no memory cost.
       *
       * There is ONE death clip per unit and no room for a second — the atlas
       * sits at 89 MB of a 130 MB budget with props — so a squad caught by one
       * burst went down as one animation played five times in perfect sync,
       * which reads worse than lockstep walking because it happens all at once
       * and the eye is already on it.
       *
       * Three cheap axes instead: how fast a man goes down, how long it takes
       * him to start, and which way he settles. Fixed at spawn so a man dies
       * the way he was always going to, not differently on every redraw. */
      /* Ranges are WIDE on purpose. A squad is three to five men, and three
       * draws from a narrow range cluster often enough to matter — measured a
       * squad whose dieK came out 1.06/1.03/1.04, which spread the fall by one
       * frame in twelve and was invisible. The spread has to survive a bad
       * draw, not just look right in expectation. */
      dieK: rand(0.6, 1.55),         // collapse rate
      dieLag: rand(0, 0.2),          // he does not drop the instant he is hit
      dieLean: rand(-0.22, 0.22),    // and does not land square
      // a hair of depth inside the lane, so men who share an x do not become one
      // flat stack of identical silhouettes
      yj: rand(-2.5, 2.5),
      burstN: 0, wounded: false,
      phase: Math.random() * 6, moving: false, pose: null,
      deadT: null, muzzleT: 0, fireT: rand(0, 0.5),
      hitT: 0, combatT: 0, shots: 0, gibbed: false, baked: false,
      suppressT: 0, slowT: 0, revealT: 0, spotT: 0, emergeT: 0,
      aiming: false, aimT: 0, aimTime: d.aim || 0, aimTarget: null,
      glintT: 0, hold: false, holdX: 0,
      sniperUnit: !!d.sniper,
      squad: null, slot: 0, cpShare: d.cost,
    };
  }

  /* ---------- squads ---------- */
  _makeSquad(side, skey, lane, x, opts = {}) {
    const sd = SQUADS[skey];
    const squad = {
      side, key: skey, lane, x,
      dir: side === 'us' ? 1 : -1,
      order: opts.hold ? 'hold' : 'advance',
      hold: !!opts.hold, holdX: opts.hold ? x : 0,
      pin: 0, pinned: false, underFireT: 0, quietT: 0,
      xp: 0, rank: 0,   // VETERAN CADRE starts the player's squads one rank up
      ...(typeof Perks !== 'undefined' && Perks.on(this, side, 'cadre')
        ? { xp: RANKS[1].at, rank: 1 } : {}),
      cover: null, coverTarget: null, inCover: false,
      emergeT: 0, men: [],
    };
    sd.comp.forEach((ukey, i) => {
      const m = this._makeUnit(side, ukey, lane, x - squad.dir * i * 13);
      m.squad = squad;
      m.slot = i;
      m.cpShare = sd.cost / sd.comp.length;
      m.hold = squad.hold; m.holdX = squad.holdX;
      squad.men.push(m);
      this.units.push(m);
    });
    this.squads.push(squad);
    return squad;
  }

  squadAlive(s) { return s.men.filter(m => m.deadT == null); }

  squadAnchor(s) {
    const alive = this.squadAlive(s);
    if (!alive.length) return s.x;
    return alive.reduce((a, m) => a + m.x, 0) / alive.length;
  }

  /* ---------- cover ---------- */
  /* Firing ports on village buildings.
   *
   * Troops could already hold a building, but with nothing marking where they
   * were they simply vanished into the wall — you could hear them shooting and
   * not see them. A window gives the squad a defined spot to stand, the renderer
   * something to cut into the wall behind them, and the position dies with the
   * structure it belongs to.
   */
  _addWindows() {
    const WINDOWED = { hooch: 1, longhouse: 1, stilt: 1, stall: 1 };
    for (const st of this.structures) {
      if (!WINDOWED[st.kind] || st.state === 2) continue;
      const spot = this.addCover(st.lane, st.x, 'window', true, 44);
      if (spot) {
        spot.structRef = st;
        // a stilt house is fought from its raised floor
        spot.lift = st.kind === 'stilt' ? 16 : 0;
      }
    }
  }

  genCovers() {
    this.covers = LANES.map(() => []);   // one per live lane, not a hardcoded three
    const map = this.map;
    const rng = seeded(map.seed + 777);
    const biomeType = { grass: 'log', jungle: 'log', palm: 'dike', shattered: 'crater' }[map.trees] || 'log';

    // EMPLACEMENTS: class-locked strongpoints, destructible via their structure.
    // Every lane gets a sniper tower on its best ground and an MG nest, so each
    // lane has a strongpoint worth taking and holding.
    const erng = seeded(map.seed + 4242);
    const emplace = (lane, x, kind) => {
      const st = {
        lane, x, w: STRUCT_DEFS[kind].w, kind,
        hp: STRUCT_DEFS[kind].hp, maxHp: STRUCT_DEFS[kind].hp,
        state: 0, burnT: 0, fireHurt: 0, seed: Math.floor(erng() * 1e9),
      };
      this.structures.push(st);
      const spot = this.addCover(lane, x, kind === 'tower' ? 'towerpos' : 'nestpos', true);
      if (spot) spot.structRef = st;
    };
    for (let lane = 0; lane < LANE_N; lane++) {
      // tower on the highest ground in the lane's forward half
      let bestX = WORLD_W * 0.5, bestE = -1;
      for (let x = WORLD_W * 0.24; x < WORLD_W * 0.78; x += 40) {
        const el = elevAt(map, lane, x) + erng() * 0.05;
        if (el > bestE) { bestE = el; bestX = x; }
      }
      emplace(lane, bestX, 'tower');
      // MG nest set back from the tower, covering the approach
      const nx = clamp(bestX - (0.10 + erng() * 0.08) * WORLD_W, WORLD_W * 0.12, WORLD_W * 0.88);
      if (Math.abs(nx - bestX) > 90) emplace(lane, nx, 'mgnest');
    }

    /* Trenches are placed in ONE pass, by _genTrenches. There used to be a
     * separate block here dropping two of them at flagX +/- 96 before the
     * scored pass ran, which meant the objective got a pair 192px apart on
     * whatever ground happened to be there, and they then blocked the scored
     * pass from putting a long trench anywhere near the flag. */

    // VC JUNGLE HIDES: firing positions inside the brush. VC only, and they keep
    // their concealment while occupied, so the ambush doctrine has real estate.
    for (let lane = 0; lane < LANE_N; lane++) {
      for (const z of this.conceal[lane]) {
        const x0 = z.x0 * WORLD_W, x1 = z.x1 * WORLD_W;
        const n = Math.max(1, Math.round((x1 - x0) / 260));
        for (let i = 0; i < n; i++) {
          const hx = x0 + (x1 - x0) * ((i + 0.5) / n) + (erng() - 0.5) * 60;
          this.addCover(lane, hx, 'hide', true);
        }
      }
    }

    // priority spots first — the scatter pass dedupes around them
    // dug positions on the garrison lines, matching the pre-placed defenders
    if (map.id === 'khesanh') {
      for (const p of map.prePlaced || []) {
        if (p.kind === 'unit') this.addCover(p.lane, p.x * WORLD_W, 'trench', true);
      }
    }
    if (map.id === 'hill937') {
      for (const p of map.prePlaced || []) {
        if (p.kind === 'unit') this.addCover(p.lane, p.x * WORLD_W, 'trench', true);
      }
    }
    /* Every map gets a dug line, not just the two firebases.
     *
     * Trenches were previously Khe Sanh and Hill 937 decoration attached to
     * pre-placed defenders, so on three of five maps the crowd-vs-shell
     * decision could never come up — there was nothing with capacity above one
     * to crowd. Four per lane, spread across the contested middle, is enough
     * that both sides always have a dug position to fight from and a choice
     * about which one.
     *
     * The two nearest the centre are the LONG trenches (three squads): the
     * middle of the map is where massing is tempting and where the shell that
     * punishes it is most likely to arrive. */
    this._genTrenches();

    // villages are fighting positions: low walls flank every settlement
    for (const s of (map.settlements || [])) {
      const cx = s.x * WORLD_W;
      this.addCover(s.lane, cx - 118, 'wall', true);
      this.addCover(s.lane, cx + 118, 'wall', true);
    }

    for (let lane = 0; lane < LANE_N; lane++) {
      let x = WORLD_W * 0.16 + rng() * 120;
      while (x < WORLD_W * 0.86) {
        // don't bury cover in flags or settlements
        const nearFlag = Math.abs(x - this.flags[lane].x) < 70;
        const nearStruct = this.structures.some(st => st.lane === lane && Math.abs(st.x - x) < st.w);
        if (!nearFlag && !nearStruct) {
          // rock is common on the highlands and the plateau, rare in the delta
          const rockW = (map.id === 'hill937' || map.id === 'khesanh') ? 0.34
                      : map.id === 'mekong' ? 0.08 : 0.18;
          const r = rng();
          const t = r < 0.22 ? 'sandbag' : r < 0.22 + rockW ? 'rock' : biomeType;
          this.addCover(lane, x, t, true);
        }
        x += 150 + rng() * 105;
      }
    }

    this._genRocks();
  }

  /* WHERE A TRENCH GOES — and whether the map wants one at all.
   *
   * Budgets are PER MAP, not per lane, and they are a ceiling rather than a
   * quota: a position is only cut where the ground actually suits it. Jamming
   * one onto a slope to hit a number looks exactly as bad as it sounds, so the
   * flatness gate is allowed to return fewer than the budget — including none.
   *
   *   khesanh  5   a dug firebase. Being entrenched IS the place.
   *   hill937  3   the NVA held that slope from prepared positions.
   *   iadrang  2   hasty positions scraped around the landing zone.
   *   mekong   1   one bunded position on a dike at most — you do not cut a
   *               trench into a paddy, the water table is six inches down.
   *   cuchi    0   they went DOWN, not across. Tunnels and spider holes are
   *               that map's identity and it already has both.
   *
   * Candidates are scored across BOTH lanes and the best are taken globally, so
   * the distribution is uneven on purpose — a map can put two on one lane and
   * none on the other if that is where the ground is.
   */
  _genTrenches() {
    const BUDGET = { khesanh: 5, hill937: 3, iadrang: 2, mekong: 1, cuchi: 0 };
    const budget = BUDGET[this.map.id] != null ? BUDGET[this.map.id] : 2;
    if (budget <= 0) return;
    const SPACING = 420;          // they are landmarks, so keep them apart
    const MAX_FALL = 13;          // px of drop across a long trench. The gate.

    const cand = [];
    for (let lane = 0; lane < LANE_N; lane++) {
      const flagX = this.flags[lane].x;
      for (let x = WORLD_W * 0.16; x <= WORLD_W * 0.86; x += 20) {
        if (this.structures.some(st => st.lane === lane &&
            Math.abs(st.x - x) < st.w * 0.5 + 80)) continue;
        const fall = Math.abs(groundY(this.map, lane, x - 55) -
                              groundY(this.map, lane, x + 55));
        if (fall > MAX_FALL) continue;            // not ground you dig across
        const flat = 1 - fall / MAX_FALL;
        const high = elevAt(this.map, lane, x);
        const nearFlag = Math.max(0, 1 - Math.abs(x - flagX) / 520);
        const middle = 1 - Math.abs(x - WORLD_W / 2) / (WORLD_W / 2);
        cand.push({ lane, x, score: flat * 1.8 + high * 0.9 + nearFlag * 1.4 + middle * 0.5 });
      }
    }
    cand.sort((a, b) => b.score - a.score);

    /* Positions already on the board count against the budget.
     *
     * Khe Sanh and Hill 937 cut a trench for each pre-placed defender before
     * this runs — which is right, a garrison is dug in — but those were not
     * counted, so Khe Sanh came out with seven when its budget said five. They
     * also seed the spacing, so the scored pass does not drop one on top of the
     * garrison line. */
    const taken = [], used = new Set();
    let made = 0, longs = 0;
    for (let lane = 0; lane < LANE_N; lane++) {
      for (const c of this.covers[lane]) {
        if (c.type !== 'trench' && c.type !== 'trenchlong') continue;
        taken.push({ lane, x: c.x });
        made++; if (c.type === 'trenchlong') longs++;
      }
    }
    if (made >= budget) return;
    const key = q => q.lane + ':' + q.x;
    const place = (type, gap, spacing, pool) => {
      const pick = pool.find(q => !used.has(key(q)) &&
        !taken.some(t => t.lane === q.lane && Math.abs(t.x - q.x) < spacing));
      if (!pick) return false;
      used.add(key(pick));
      if (!this.addCover(pick.lane, pick.x, type, true, gap)) return false;
      taken.push(pick);
      made++; if (type === 'trenchlong') longs++;
      return true;
    };

    // the first one is the LONG one and it wants the objective: the flag is
    // where crowding is most tempting and most punished
    const atFlag = cand.filter(q => Math.abs(q.x - this.flags[q.lane].x) < 320);
    for (let i = 0; i < 8 && longs < 1; i++) if (place('trenchlong', 110, 0, atFlag)) break;
    for (let i = 0; i < 8 && longs < 1; i++) if (place('trenchlong', 110, 0, cand)) break;

    // a second long one only on a map dug in enough to earn it
    if (budget >= 4) for (let i = 0; i < 8 && longs < 2; i++) {
      if (place('trenchlong', 110, SPACING, cand)) break;
    }
    let guard = 0;
    while (made < budget && guard++ < 80) {
      const relax = SPACING * (1 - Math.min(0.5, guard * 0.012));
      place('trench', 100, relax, cand);
    }
  }

  /* Rocks, placed rather than left to the scatter.
   *
   * Cover types come out of one weighted roll in the scatter pass, and the
   * wider spacing the long trench needs eats several of those rolls — the
   * first build put exactly ONE rock on the whole of Ia Drang. Rock is the
   * cover the player was promised, so it gets its own pass with a floor. */
  _genRocks() {
    const id = this.map.id;
    const n = (id === 'hill937' || id === 'khesanh') ? 6 : id === 'mekong' ? 2 : 4;
    const rng = seeded(this.map.seed + 8123);
    for (let lane = 0; lane < LANE_N; lane++) {
      let made = 0, guard = 0;
      while (made < n && guard++ < 90) {
        const x = WORLD_W * (0.14 + rng() * 0.74);
        if (Math.abs(x - this.flags[lane].x) < 70) continue;
        if (this.structures.some(st => st.lane === lane && Math.abs(st.x - x) < st.w)) continue;
        if (this.addCover(lane, x, 'rock', true)) made++;
      }
    }
  }

  addCover(lane, x, type, static_ = false, minGap) {
    const defs = {
      log:     { w: 34, prot: 0.4 },
      // a boulder stops rounds outright but only shelters the men behind it
      rock:    { w: 32, prot: 0.46 },
      sandbag: { w: 34, prot: 0.5 },
      dike:    { w: 38, prot: 0.45 },
      crater:  { w: 36, prot: 0.38 },
      /* The two positions worth crowding — and the only cover that is properly
       * lethal to be caught in front of. A log or a rock is somewhere to lie
       * down; a trench is a position, and a squad in one fighting a squad in
       * the open should not be a fair fight. */
      trench:  { w: 62,  prot: 0.78, cap: 2, dug: true },
      trenchlong: { w: 108, prot: 0.80, cap: 3, dug: true },
      rubble:  { w: 40, prot: 0.5 },
      wall:    { w: 36, prot: 0.5 },
      towerpos:{ w: 30, prot: 0.45, classReq: 'sniper' },
      nestpos: { w: 40, prot: 0.6,  classReq: 'mg' },
      hide:    { w: 34, prot: 0.35, sideReq: 'vc', conceals: true },
      // a firing port cut in a village building — see genCovers
      window:  { w: 30, prot: 0.55 },
    };
    const d = defs[type];
    if (!d) return null;
    const lc = this.covers[lane];
    // Windows belong to a specific building, and village huts stand closer
    // together than the general 70px spacing rule allows — at that radius almost
    // every firing port was rejected and buildings had none.
    const gap = minGap != null ? minGap : 70;
    // ...and never let two positions physically overlap, whatever the rule says.
    // The long trench is 108px wide; the flat 70px spacing would have let a rock
    // sit inside one.
    if (lc.some(c => Math.abs(c.x - x) < Math.max(gap, (c.w + d.w) / 2 + 12))) return null;
    if (!static_ && lc.filter(c => c.dyn).length >= 8) return null;
    const spot = {
      lane, x, w: type === 'rubble' ? Math.max(40, d.w) : d.w, type, prot: d.prot,
      occ: [], cap: d.cap || 1, dyn: !static_, lift: 0,
      /* THE LEVER, on dug positions only.
       *
       * Lifted from Warfare 1917, which the owner asked for by name: a trench
       * holds its garrison until you decide otherwise, and can be set to send
       * them over the top. Without it "take cover" is a one-way trip — troops
       * drift out on their own timer and the player never actually commands the
       * position. `hold` keeps them in; `over` puts them over the parapet and
       * stops fresh squads settling there. */
      lever: (type === 'trench' || type === 'trenchlong') ? 'hold' : null,
      classReq: d.classReq || null, sideReq: d.sideReq || null, conceals: !!d.conceals,
      dug: !!d.dug,
    };
    lc.push(spot);
    return spot;
  }

  /* Occupancy is a LIST, not a slot.
   *
   * Everything that used to read `c.occ === s` or `!c.occ` goes through these
   * four, so capacity is enforced in exactly one place and a squad can never
   * end up counted in two positions at once. */
  coverHas(c, s) { return !!c && c.occ.indexOf(s) >= 0; }

  coverRoom(c, s) {
    if (!c) return false;
    // a thrown lever means "keep moving" — see toggleLever
    if (c.lever === 'over' && s && s.side === this.player &&
        c.occ.indexOf(s) < 0) return false;
    return c.occ.length < c.cap || c.occ.indexOf(s) >= 0;
  }

  coverJoin(c, s) {
    if (!c) return false;
    if (this.coverHas(c, s)) { s.cover = c; s.inCover = true; return true; }
    if (c.occ.length >= c.cap) return false;
    if (s.cover) this.coverLeave(s);
    c.occ.push(s);
    s.cover = c; s.inCover = true;
    if (s.side === this.player) {
      if (typeof Tutor !== 'undefined') Tutor.teach('trench');
      if (c.occ.length > 1) if (typeof Tutor !== 'undefined') Tutor.teach('crowd');
    }
    // a new hole is an unimproved hole, and nobody has ranged it yet
    s.entrenchT = 0; s.rangedT = 0; s.rangedIn = false; s.rangedShots = 0;
    return true;
  }

  coverLeave(s) {
    const c = s.cover;
    if (c) {
      const i = c.occ.indexOf(s);
      if (i >= 0) c.occ.splice(i, 1);
    }
    s.cover = null; s.inCover = false;
    s.entrenchT = 0; s.rangedT = 0; s.rangedIn = false; s.rangedShots = 0;
  }

  /* What a position is actually worth to THIS squad right now.
   *
   * Base type value, minus what the crowd costs, plus what the digging has
   * bought. One function so the firefight, the blast maths and the HUD all
   * quote the same number — a protection figure the player can see but that
   * the bullets do not use would be worse than showing nothing. */
  coverProt(c, s) {
    if (!c) return 0;
    let p = c.prot;
    const n = c.occ.length;
    if (n > 1) p *= 1 - COVER.CROWD_LOSS * (n - 1);
    if (s && s.entrenchT > 0) {
      p += COVER.DIG_MAX * Math.min(1, s.entrenchT / COVER.DIG_TIME);
    }
    return clamp(p, 0, c.dug ? COVER.DUG_CAP : COVER.PROT_CAP);
  }

  /* Throw the lever. Returns the new state, or null if this position has none. */
  toggleLever(c) {
    if (!c || !c.lever) return null;
    c.leverPrev = c.lever === 'hold' ? 1 : -1;   // the outgoing arm position
    c.lever = c.lever === 'hold' ? 'over' : 'hold';
    c.leverT = 0.35;                       // the arm swings rather than snapping
    Sound.click();
    if (c.lever === 'over') {
      const n = c.occ.filter(s => s.side === this.player).length;
      if (n) this.emit(`OVER THE TOP — LANE ${c.lane + 1}`, this.player);
      if (typeof Tutor !== 'undefined') Tutor.teach('lever');
    }
    return c.lever;
  }

  /* Does the lever hold this squad in place? Player squads only.
   *
   * The lever is an ORDER to your own men, not a gate in the ground — an AI
   * squad has its own reasons for being in a hole and its own reasons to leave
   * (see the ranged-in reaction), and letting the player's lever govern them
   * would either freeze the enemy in place or hand the player a switch that
   * empties their positions. */
  leverHolds(s) {
    return !!(s && s.side === this.player && s.cover && s.cover.lever === 'hold');
  }

  squadFitsCover(s, c) {
    if (c.sideReq && s.side !== c.sideReq) return false;
    if (!c.classReq) return true;
    return this.squadAlive(s).some(m =>
      c.classReq === 'sniper' ? m.sniperUnit : !!UNITS[m.key][c.classReq]);
  }

  freeCoverAhead(squad, maxDist) {
    // Troops under fire take the nearest cover FORWARD or right where they are.
    // They never stroll rearward to find a better hole — men who break contact
    // backwards across open ground get killed, and it read as cowardly wandering.
    let best = null, bd = 1e9;
    for (const c of this.covers[squad.lane]) {
      if (!this.coverRoom(c, squad)) continue;
      if (!this.squadFitsCover(squad, c)) continue;
      const dx = (c.x - squad.x) * squad.dir;
      if (dx < -28 || dx > maxDist) continue;
      const score = dx >= 0 ? dx : -dx * 3;
      if (score < bd) { bd = score; best = c; }
    }
    return best;
  }

  _updateSquads(dt) {
    for (let i = this.squads.length - 1; i >= 0; i--) {
      const s = this.squads[i];
      const alive = this.squadAlive(s);
      if (!alive.length) {
        this.coverLeave(s);
        this.squads.splice(i, 1);
        continue;
      }
      s.underFireT = Math.max(0, s.underFireT - dt);
      s.emergeT = Math.max(0, s.emergeT - dt);
      s.nadeCd = Math.max(0, (s.nadeCd || 0) - dt);
      s.bloopCd = Math.max(0, (s.bloopCd || 0) - dt);
      s.suppCd = Math.max(0, (s.suppCd || 0) - dt);
      if ((s.crossT || 0) > 0) s.crossT = Math.max(0, s.crossT - dt);
      /* Resupply, but only out of contact. A squad that has fired in the last
       * 1.2s is still in the fight and gets nothing — otherwise ammo would top
       * up between bursts and the limit would never bind. */
      s.firedT = Math.max(0, (s.firedT || 0) - dt);
      if (s.ammo == null) s.ammo = 1;
      if (s.firedT <= 0) s.ammo = Math.min(1, s.ammo + AMMO_REGEN * dt);
      // a focus order must never outlive its target, or the squad keeps its
      // concentration bonus pointed at a squad that no longer exists
      if (s.focus && !this.squadAlive(s.focus).length) s.focus = null;
      s.smokeCd = Math.max(0, (s.smokeCd || 0) - dt);
      s.suppFireT = Math.max(0, (s.suppFireT || 0) - dt);
      // pin: builds from incoming fire (added in _fire/_areaDamage), decays in lulls
      // veterans keep their heads when green troops would be pinned
      if (s.underFireT <= 0) s.pin = Math.max(0, s.pin - dt * 0.24 * (2 - RANKS[s.rank || 0].steady));
      s.pin = Math.min(1.4, s.pin);
      s.pinned = s.pinned ? s.pin > 0.28 : s.pin > 0.6;
      if (s.pinned) {
        // whole squad hugs the ground — reuses the prone/speed/accuracy penalties
        for (const m of alive) m.suppressT = Math.max(m.suppressT, 0.45);
        /* Keep the dust up between incoming rounds.
         *
         * Impact dust alone makes suppression flicker: a pinned squad reads as
         * suppressed on the frames something lands near it and as idle on the
         * frames nothing does, when the STATE is continuous — they are held down
         * the whole time. A low trickle in front of the squad, aimed back down
         * the line of fire, keeps the read on without adding a second mechanic.
         * Rate-limited rather than per-frame; the particle cap is shared with
         * every muzzle flash on the field. */
        s.dustCd = (s.dustCd || 0) - dt;
        // No count gate here: FXManager.add drops `prio: 0` decoration once the
        // field is busy, which is the same job done in one place and by the
        // right rule. A hard 150 here just meant the dust switched OFF in
        // exactly the heavy firefights it exists to describe.
        if (s.dustCd <= 0) {
          s.dustCd = rand(0.10, 0.22);
          const ax = this.squadAnchor(s);
          this.fx.suppressDust(ax + s.dir * rand(10, 44), groundY(this.map, s.lane, ax),
            -s.dir, LANE_DEPTH[s.lane]);
        }
      }

      if (s.emergeT > 0) continue;

      /* A squad halts when it reaches the range its WEAPONS want, not the
       * instant anything is technically in range. See ENGAGE_AT: halting on
       * first contact left both sides trading fire at the edge of their reach,
       * with the closest approach ever measured at 216px and zero man-frames
       * inside 160px. The squad closes until its nearest visible enemy is
       * inside the tightest preferred range among its living men — so a rifle
       * team pushes in while the machine gun with it stops earlier and shoots
       * them forward. */
      let nearestFoe = 1e9;
      for (const f of this.units) {
        if (f.side === s.side || f.deadT != null || f.lane !== s.lane) continue;
        if (!this.canSee(s.side, f)) continue;
        nearestFoe = Math.min(nearestFoe, Math.abs(f.x - s.x));
      }
      /* TIGHTEST preferred range in the squad, not the loosest. Taking the max
       * halts the squad at its longest-reaching weapon, which is the opposite of
       * closing — it pushed the closest approach from 216px out to 255px. The
       * min makes the riflemen's wish govern, so the squad advances until they
       * are where they want to be. */
      let wantDist = Infinity;
      for (const m of alive) {
        const md = UNITS[m.key];
        wantDist = Math.min(wantDist, md.range * engageFrac(md));
      }
      if (!isFinite(wantDist)) wantDist = 0;
      const atRange = nearestFoe <= wantDist;
      const engaged = atRange && alive.some(m => (m.combatT || 0) > 0 || m.aiming);
      const sp = Math.min(...alive.map(m => UNITS[m.key].speed)) *
        (alive.some(m => m.slowT > 0) ? 0.45 : 1);
      const xBefore = s.x;

      /* Cover-seeking is the AI's, not the player's.
       *
       * The player asked for the cover system to be a decision they make, and a
       * decision made for you is not one. Player squads under fire now stand in
       * the open until they are TOLD to move — which is what makes the timing
       * the skill. The AI keeps seeking, because an enemy that stands in the
       * open while the player digs in is not a harder game, it is a broken one.
       *
       * Note the one thing player squads still do below: a squad on HOLD settles
       * into a position it is ALREADY standing on. That is occupying ground the
       * player chose, not walking off to find better. */
      const autoSeek = s.side !== this.player;

      /* AN AI SQUAD THAT HAS BEEN RANGED IN GETS OUT.
       *
       * The dig-in / ranged-in clock runs for both sides, but only the player
       * had any way to answer it — the AI had no notion of the mechanic and
       * simply sat in the hole until the rounds walked onto it. That is a
       * system the player lives under and the enemy does not, which makes the
       * player's own timing decision worth less: holding a position stops being
       * a risk you both take and becomes a tax only you pay.
       *
       * The delay is deliberate. Reacting on the same frame as the ranging
       * round would be inhuman and would make the warning unusable against the
       * AI; a beat and a bit is a squad leader hearing it land and shouting. */
      if (autoSeek && s.rangedIn) {
        s.rangedReact = (s.rangedReact || 0) + dt;
        if (s.rangedReact > 1.3) {
          s.rangedReact = 0;
          this.coverLeave(s);
          s.coverCd = 4;          // do not dive back in and restart the clock
          if (!s.hold) s.order = 'advance';
          else { s.order = 'hold'; s.holdX = s.x + s.dir * 80; }
        }
      } else if (s.rangedReact) s.rangedReact = 0;

      // Under effective fire: get into the nearest position forward. Never back.
      if (autoSeek && s.order === 'advance' && s.underFireT > 0 && !s.inCover && !s.coverTarget) {
        const c = this.freeCoverAhead(s, 150);
        if (c) { s.coverTarget = c; s.order = 'tocover'; }
      }
      /* Bounding: troops moving up occupy the strongpoints they pass through
       * (trench, nest, tower, hide) instead of walking by them in the open.
       *
       * PLAYER SQUADS GARRISON A TRENCH THEY REACH, and only a trench.
       *
       * Removing auto-seek for the player was right for ordinary cover — a log
       * is a decision — but measured over four-minute matches it left the
       * player side occupying a dug position 0% of the time on three of five
       * maps while the AI sat in them for a quarter of the match. Combined with
       * a trench now being decisive, that is the player assaulting a held
       * position from open ground, which is the fight I measured at 0 wins in 8.
       *
       * Warfare 1917 answers this with the lever rather than with micromanagement:
       * troops stop at a trench unless it is set to send them through. That is
       * exactly the control already built, so the lever governs it — HOLD and
       * your men garrison the position they walk into, throw it and they pass
       * straight by (see coverRoom, which refuses a thrown position). Ordinary
       * cover stays fully manual. */
      s.coverCd = Math.max(0, (s.coverCd || 0) - dt);
      if (s.order === 'advance' && !s.inCover && !s.coverTarget && !s.playerHeld &&
          s.coverCd <= 0) {
        const strong = { trench: 1, nestpos: 1, towerpos: 1, hide: 1, wall: 1,
                         rubble: 1, window: 1 };
        let pick = null, bd = 1e9;
        for (const c of this.covers[s.lane]) {
          if (!autoSeek && !c.dug) continue;      // the player garrisons trenches only
          if (!strong[c.type] || !this.coverRoom(c, s)) continue;
          if (!this.squadFitsCover(s, c)) continue;
          const dx = (c.x - s.x) * s.dir;
          // Strictly AHEAD. A window starting behind the squad included the hole it
          // was standing in, so a squad that timed out of cover re-claimed the same
          // cover on the next tick, reset its timer, and never advanced again —
          // both sides parked outside weapon range and no shot was ever fired.
          if (dx < 60 || dx > 210) continue;
          if (dx < bd) { bd = dx; pick = c; }
        }
        if (pick) { s.coverTarget = pick; s.order = 'tocover'; }
      }

      if (s.order === 'tocover' && s.coverTarget) {
        if (!this.coverRoom(s.coverTarget, s)) {
          // it filled up while we were crossing to it
          s.coverTarget = null;
          s.order = s.playerHeld ? 'hold' : 'advance';
          if (s.playerHeld) { s.hold = true; s.holdX = s.x; }
        } else {
          const dx = s.coverTarget.x - s.x;
          if (Math.abs(dx) < 6) {
            const c = s.coverTarget; s.coverTarget = null;
            if (this.coverJoin(c, s)) {
              s.order = 'holdcover'; s.quietT = 0; s.ceding = false;
            } else {
              s.order = s.playerHeld ? 'hold' : 'advance';
              if (s.playerHeld) { s.hold = true; s.holdX = s.x; }
            }
          } else {
            // rush the hole — crawl if pinned, sprint otherwise
            s.x += Math.sign(dx) * Math.min(Math.abs(dx), sp * (s.pinned ? 0.35 : 1.15) * dt);
          }
        }
      } else if (s.order === 'holdcover') {
        // a squad on ADVANCE orders pushes on once the shooting stops; only an
        // explicit player HOLD keeps it in the hole
        if (s.underFireT <= 0 && !engaged && !s.playerHeld && !this.leverHolds(s)) {
          s.quietT += dt;
          if (s.quietT > 2.6) {
            this.coverLeave(s);
            s.order = s.hold ? 'hold' : 'advance';
            // do not let it dive straight back into the hole it just left
            s.coverCd = 3.5;
          }
        } else s.quietT = 0;
      } else if (s.order === 'moveto') {
        const dx = s.moveToX - s.x;
        if (Math.abs(dx) < 6) {
          s.order = 'hold'; s.hold = true; s.holdX = s.x; s.ceding = false;
        } else if (!s.pinned) {
          s.x += Math.sign(dx) * Math.min(Math.abs(dx), sp * 1.05 * dt);
        }
      } else if (s.order === 'hold') {
        if ((s.x - s.holdX) * s.dir < 0 && !s.pinned && !engaged) {
          s.x += s.dir * sp * dt;
        } else if (!s.inCover) {
          // settle into a dug position on our hold point if one exists
          const c = this.covers[s.lane].find(c2 =>
            this.coverRoom(c2, s) && this.squadFitsCover(s, c2) &&
            Math.abs(c2.x - s.holdX) < 50);
          if (c) this.coverJoin(c, s);
        }
      } else if (s.order === 'advance') {
        // Bounding: nobody walks upright into a lane that is being swept. A
        // squad only crosses open ground while a friendly is putting rounds
        // down, or while the enemy is still out of effective range.
        let hostileFire = 0;
        for (const o of this.squads) {
          if (o.side === s.side || o.lane !== s.lane) continue;
          if (!this.squadAlive(o).length) continue;
          const d = Math.abs(this.squadAnchor(o) - s.x);
          if (d < 340 && o.men.some(m => (m.combatT || 0) > 0)) hostileFire++;
        }
        const covering = this.squads.some(o =>
          o !== s && o.side === s.side && o.lane === s.lane &&
          this.squadAlive(o).length && o.men.some(m => (m.combatT || 0) > 0));
        // screened by our own smoke, a squad can cross ground it otherwise would not
        const screened = this.smokeAt(s.lane, s.x) > 0.35 ||
          this.smokeAt(s.lane, s.x + s.dir * 70) > 0.35;
        const mayMove = hostileFire === 0 || covering || s.inCover || screened;

        if (!s.pinned && !engaged && this._squadPathClear(s) && mayMove) {
          /* THE PACING QUESTION, ANSWERED AND THEN LEFT ALONE.
           *
           * Measured over ten map/side runs and 1.58 million man-frames: men
           * are moving 77.1% of the time, firing while stopped 6.8% — and
           * 97.9% of that movement happens with no enemy within weapon range.
           * Only 1% of moving frames involve firing. The game is not badly
           * animated during its fights; it is mostly not in a fight, because
           * the world is 2560 wide and squads spend their lives walking to
           * contact.
           *
           * A march speed-up for squads with nothing in range was written,
           * measured, and REVERTED. It moved the figure 77.1 -> 77.2 and time
           * to first contact 39.5s -> 38.7s across three maps, which is inside
           * the noise and went the other way on one of them. The 77% is
           * structural: a lane game with continuous reinforcement always has
           * most of its men in transit, and no movement tweak changes that
           * ratio — only map size or spawn distance would.
           *
           * Recorded here so the fourth person to notice the number does not
           * spend the afternoon on the same idea. */
          s.x += s.dir * sp * dt;
        }
      }
      // hard-sync anchor if men drifted (breakthrough removal etc.)
      if (Math.abs(this.squadAnchor(s) - s.x) > 90) s.x = this.squadAnchor(s);
      /* NOBODY LEAVES THE MAP. A backstop, not the fix — the formation bug that
       * used to send squads to x=12091 is fixed at its source in `_advance` —
       * but a squad outside the world can never be in range of anything, so if
       * one ever gets there again it should be a visible pile-up at the edge
       * rather than an army quietly walking into nothing. */
      s.x = clamp(s.x, -20, WORLD_W + 20);

      // GROUND IS NEVER GIVEN UP by accident. Losing the point man used to drag
      // the squad's anchor rearward, which read as troops wandering backwards
      // under fire. Only an explicit FALL BACK or MOVE order may cede ground.
      const ceding = !!s.ceding;
      if (s.front === undefined) s.front = s.x;
      if (ceding) {
        s.front = s.x;
      } else {
        if ((s.x - s.front) * s.dir > 0) s.front = s.x;
        else if ((s.front - s.x) * s.dir > 16) s.x = s.front - s.dir * 16;
      }
      /* ADVANCING MEANS MAKING GROUND, not "moved during this tick".
       *
       * This was `Math.abs(s.x - xBefore) > 0.01`, measured inside the tick and
       * therefore BEFORE `_separate` runs. A squad shoving at the back of the
       * one in front advances a pixel and is pushed the pixel back a moment
       * later, so it stood still while reporting `_advancing` on every single
       * tick, forever (see SEP_CLEAR in data.js for the measurement).
       *
       * That flag is what lets a prone man get up early — the rising bypass
       * below trusts it to mean the squad is going somewhere. Permanently true
       * meant permanently bypassed, so men dropped and popped back up every
       * 0.35s while the squad went nowhere. It is the churn the stance locks
       * exist to prevent, arriving through the one door left open for it.
       *
       * Sampling over 0.3s asks the question the consumers actually mean: has
       * this squad got anywhere lately? A treadmilling squad has not. */
      s._advSampleT = (s._advSampleT || 0) + dt;
      if (s._advSampleX === undefined) { s._advSampleX = s.x; s._advancing = false; }
      if (s._advSampleT >= 0.3) {
        const was = s._advancing;
        s._advancing = (s.x - s._advSampleX) * s.dir > 1;
        if (s._advancing && !was) s._advSince = 0;      // the moment it stepped off
        s._advSampleX = s.x;
        s._advSampleT = 0;
      }
      s._advSince = s._advancing ? (s._advSince || 0) + dt : 1e9;
      this._updateCoverClock(s, dt, Math.abs(s.x - xBefore) > 0.6);

      /* OVER THE TOP. The lever is thrown, so the garrison climbs out and goes
       * on — the one order that empties a position on purpose. */
      if (s.side === this.player && s.inCover && s.cover && s.cover.lever === 'over') {
        this.coverLeave(s);
        s.coverCd = 2.2;                  // not straight back into the same hole
        s.hold = false; s.playerHeld = false; s.order = 'advance';
      }

      // stance state machine — ONE owner, with commitment so nobody yo-yos.
      // A man stays prone ≥2.4s and standing ≥1.1s before he may switch.
      let nearFoe = 1e9;
      for (const f of this.units) {
        if (f.side === s.side || f.lane !== s.lane || f.deadT != null) continue;
        nearFoe = Math.min(nearFoe, Math.abs(f.x - s.x));
      }
      for (let mi = 0; mi < alive.length; mi++) {
        const m = alive[mi];
        if (m.sniperUnit || (m.nadeT || 0) > 0) continue;
        if (UNITS[m.key].vehicle) { m.stance = 'stand'; m.pose = null; continue; }
        m.stanceT = (m.stanceT || 0) + dt;
        if (!m.stance) m.stance = 'stand';
        let want = m.stance;
        /* Being CLOSE to the enemy is not a reason to stand up.
         *
         * This used to read `nearFoe < 150 -> stand`, which meant every man rose
         * to his feet in exactly the situation where he should be lowest: a
         * close-range firefight. It was the single most visible wrongness in the
         * game. Only ASSAULTING justifies standing at that range — closing the
         * distance is worth the exposure, trading shots at 100px is not. */
        /* THREE stances now, not two. Standing and prone alone made every
         * firefight either a parade or a line of men flat on their faces —
         * measured, 80% of man-frames were moving and only 8.9% prone, so
         * nearly every man in contact was upright in the open.
         *
         * Kneeling is the middle: what a man does behind a paddy dike or a log
         * when he is fighting but not pinned. It goes to the men who are in
         * contact but not under effective fire, which is most of a firefight. */
        /* Ordered from most-pinned to least. KNEELING IS THE DEFAULT FIGHTING
         * POSTURE and prone is reserved for men who are actually being shot at,
         * which is the opposite of how this read before: standing and prone
         * were the only options, so a firefight was either a parade or a line
         * of men flat on their faces.
         *
         * The front-rank prone rule used to sit above the kneel and swallowed
         * it — squads are three to five men, so `mi < 2` is most of them, and
         * kneeling never fired at all. It now applies only under fire. */
        const hot = s.underFireT > 0 || s.pinned;
        /* THE DEBOUNCED FLAG, not the raw one.
         *
         * `m.moving` flickers sub-100ms as men settle into their slots — that
         * is why `movingVis` exists at all, and why the renderer has used it
         * for years. The stance machine was still reading the raw flag, so
         * every flicker was a vote for 'stand' and the commitment locks were
         * being asked to absorb noise the debounce already removes. It holds
         * last frame's value here (movingVis is computed further down), which
         * is exactly what a debounce is for.
         *
         * Measured as NEUTRAL, and kept anyway: mean stance churn 9.13 -> 8.71
         * per man-minute, worst-man 23.9 -> 25.2, both inside the run-to-run
         * spread of a metric that is a max over thousands of men. This is here
         * for consistency with the renderer, not on the strength of a number. */
        if (m.movingVis || s._advancing) want = 'stand';
        else if (s.pinned) want = 'prone';
        else if (s.inCover && (engaged || hot)) want = 'prone';   // gun on the parapet
        else if (hot && nearFoe < 150) want = 'prone';
        else if (hot && mi < 2) want = 'prone';                   // front rank eats it first
        else if (hot || engaged || (m.combatT || 0) > 0) want = 'kneel';
        else if ((m.combatT || 0) <= 0 && m.stanceT > STAND_DOWN) want = 'stand';
        /* The commitment lock exists so nobody yo-yos.
         *
         * `|| m.moving` bypassed it for ANY change, in either direction. Because
         * `moving` flickers on and off as men settle into squad slots, dropping
         * prone could retrigger every few frames — a man pumping up and down on
         * the spot. But the bypass was not pointless: a prone man told to move
         * has to be able to get up NOW, or he pops back down the moment he
         * stops. So it survives in exactly that one direction. Getting up to
         * move plays no transition frames because the run cycle already covers
         * it; everything else serves its commitment. */
        const lock = m.stance === 'prone' ? 2.4 : m.stance === 'kneel' ? 1.6 : 1.1;
        const rising = m.stance === 'prone' && want === 'stand';
        /* The rising bypass keys off the SQUAD advancing, not off the man's
         * per-frame `moving` flag.
         *
         * `moving` flickers as men settle into slots, and every flicker was a
         * licence to stand straight back up — so a man dropped prone, bounced
         * up, dropped again, about once a second. Measured, that left a tail
         * flipping 34 times a MINUTE while the median man never changed stance
         * at all, so the average looked perfectly healthy and hid it. Putting a
         * time floor on the bypass only slowed the bounce (34 -> 27/min, still
         * a flip every 2.2s, still faster than the 2.4s + 1.1s locks allow),
         * because it treated the symptom rather than the flickering input.
         *
         * `_advancing` is squad-level and stable across frames, and it is the
         * thing the exemption was always FOR: a prone squad ordered forward has
         * to get on its feet at once. A lone man's slot-shuffle is not that. */
        /* THE BYPASS IS FOR STEPPING OFF, NOT FOR BEING IN MOTION.
         *
         * It read `rising && s._advancing`, which is true for as long as the
         * squad keeps moving — so a man could stand 0.35s after going prone,
         * over and over. That is the churn: prone -> stand costs 0.35s and
         * stand -> prone costs the 1.1s stand lock, a 1.45s cycle, and the
         * worst man measured 43.9 flips a minute against a 1.45s cycle of
         * exactly 41. The dominant transition pair in the whole game was
         * stand<->prone, 1406 of 2598.
         *
         * Limiting it to the first 0.9s of an advance keeps what the exemption
         * is FOR — a prone squad ordered forward gets on its feet at once —
         * and hands the rest back to the commitment locks. */
        /* BOTH conditions, and the first attempt had only the second.
         *
         * `_advSince < 0.9` stays true for 0.9s AFTER an advance ends, so a
         * squad that shuffled forward and stopped left the bypass armed while
         * its men were standing still — and a stationary man could then rise
         * from prone after 0.35s, drop again, and repeat on a ~1.5s cycle.
         * Measured 33.9 stance changes a minute for the worst man WHILE
         * STATIONARY, which is precisely the on-the-spot pumping this whole
         * lock exists to stop. */
        const steppingOff = s._advancing && (s._advSince || 1e9) < 0.9;
        if (want !== m.stance &&
            (m.stanceT >= lock || (rising && steppingOff && m.stanceT >= 0.35))) {
          const prev = m.stance;
          m.stance = want;
          m.stanceT = 0;
          if (!m.moving) {
            /* The transition runs between the two stances it actually joins.
             *
             * `transDir = want === 'prone' ? 1 : -1` was written when there were
             * only two stances, and adding the kneel broke it: standing up into
             * a KNEEL is not 'prone', so it took the -1 branch and played the
             * dive clip backwards from frame 1 — which IS the prone pose. A man
             * rising from his feet to one knee flashed through lying down.
             *
             * Stored as the FROM and TO frames instead, so any pair works.
             * `dive` frame 0 is the crouch/kneel and frame 1 is prone, so both
             * standing and kneeling start at 0; a stand<->kneel change holds
             * frame 0 throughout and the cross-fade out of the standing clip
             * does the work, which is what it should have been doing anyway. */
            m.transA = (prev === 'prone') ? 1 : 0;
            m.transB = (want === 'prone') ? 1 : 0;
            m.transDir = m.transB >= m.transA ? 1 : -1;   // kept for the vector rig
            m.transT = STANCE_TRANS;
          }
        }
        // pose is NOT set here — see _updatePose, which runs after the men have
        // actually moved. Deriving it in this pass read last frame's movement.
      }
    }
  }

  /* Keep converging squads out of each other's silhouette.
   *
   * Spacing WITHIN a squad comes from slot offsets, but nothing held two
   * separate squads apart, so wherever they converged — a flag, a cover
   * position, a choke — their men stood inside one another. Measured on mekong:
   * 7.8% of same-side, same-lane man-pairs from different squads sat within
   * 16px, and the worst were exactly co-located. At 84px tall that is one
   * soldier wearing another.
   *
   * This separates the squad ANCHOR, not the men. A first attempt nudged each
   * man's x after movement and made the figure slightly WORSE (7.8% -> 8.5%),
   * because `_advance` drives every man toward `s.x` plus his slot offset each
   * frame: correcting the output of that while leaving its input alone is a tug
   * of war the correction loses. Moving the anchor moves what the slots are
   * measured from, so the whole formation steps aside and the men keep their
   * spacing relative to each other.
   *
   * Soft on purpose — a fraction of the shortfall per frame, so orders and
   * cover still decide where a squad is going; they merely stop arriving on the
   * same spot.
   */
  _separate(dt) {
    // Raised with the slot spacing: two squads 26px apart still interleaved
    // their outer men once each formation got wider.
    const GAP = SEP_GAP;         // clear ground between two formations
    const RATE = 2.4;
    const byLane = new Map();
    for (const s of this.squads) {
      const alive = this.squadAlive(s);
      if (!alive.length || s.inCover) continue;   // a squad holding cover stays put
      const k = s.side + ':' + s.lane;
      let a = byLane.get(k);
      if (!a) { a = []; byLane.set(k, a); }
      a.push({ s, n: alive.length });
    }
    for (const arr of byLane.values()) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => a.s.x - b.s.x);
      for (let i = 1; i < arr.length; i++) {
        const A = arr[i - 1], B = arr[i];
        // half of each formation's own width, plus clear ground between them
        const need = (A.n + B.n) * 0.5 * 34 + GAP;
        const d = B.s.x - A.s.x;
        if (d >= need) continue;
        const push = (need - d) * 0.5 * Math.min(1, RATE * dt);
        A.s.x = clamp(A.s.x - push, 20, WORLD_W - 20);
        B.s.x = clamp(B.s.x + push, 20, WORLD_W - 20);
      }
    }
  }

  /* Presentation state, derived ONCE per frame after everything has moved.
   *
   * This used to be computed inside the squad pass, which runs BEFORE units
   * move — so `pose` was decided from last frame's movement and then disagreed
   * with this frame's. The disagreement manufactured phantom intermediate
   * states: a man went `prone > walk > idle2 > prone` where nothing but a
   * one-frame mismatch had happened, and every one of those is a clip change
   * the 0.18s cross-fade cannot resolve. Measured, the worst men were changing
   * animation 60-80 times a minute, which is what reads as jank.
   *
   * Snipers and grenade-throwers own their own pose and are left alone here,
   * exactly as the squad pass leaves them alone.
   */
  _updatePose(dt) {
    for (const u of this.units) {
      if (u.deadT != null) continue;

      // debounced movement for animation only — the raw flag flickers sub-100ms
      if (u.moving) u.moveHoldT = MOVE_HOLD;
      else u.moveHoldT = Math.max(0, (u.moveHoldT || 0) - dt);
      u.movingVis = !!u.moving || u.moveHoldT > 0;

      if (u.sniperUnit || (u.nadeT || 0) > 0) continue;
      if (UNITS[u.key].vehicle) { u.pose = null; continue; }
      /* See POSE_SETTLE. Standing up is immediate; dropping back down has to
       * wait, so a flickering movement flag cannot pump a man up and down. */
      const wantPose = u.movingVis ? null
        : (u.stance === 'prone' ? 'prone' : u.stance === 'kneel' ? 'kneel' : null);
      u.poseT = (u.poseT || 0) + dt;
      if (wantPose !== u.pose && (wantPose === null || u.poseT >= POSE_SETTLE)) {
        u.pose = wantPose;
        u.poseT = 0;
      }
    }
  }

  /* ---------- dug in, and then ranged in ----------
   *
   * One clock, two opposite consequences. While a squad holds a position it
   * improves it — sandbags go up, the hole gets deeper, protection climbs
   * toward DIG_MAX. At the same time, anyone watching them is walking rounds
   * onto the spot. Past RANGE_TIME a ranging round lands short as a warning,
   * and a few seconds later the position starts taking accurate fire.
   *
   * Both counters die the instant the squad moves, so the choice is never
   * "should I use cover" (obviously yes) but "how long dare I stay" — which is
   * the decision the whole system exists to create.
   *
   * The fire needs an observer. A squad dug in somewhere the enemy cannot see
   * is not being ranged by anybody, and shelling it anyway would punish good
   * positioning instead of rewarding it. */
  _updateLevers(dt) {
    for (const lane of this.covers) {
      for (const c of lane) if (c.leverT > 0) c.leverT = Math.max(0, c.leverT - dt);
    }
  }

  _updateCoverClock(s, dt, moved) {
    if (!s.inCover || moved) {
      if (s.rangedIn && s.cover) this.emit(`FIRE BROKEN — LANE ${s.lane + 1}`, s.side);
      s.entrenchT = 0; s.rangedT = 0; s.rangedIn = false;
      s.rangedShots = 0; s.rangedFuse = 0;
      return;
    }
    if (s.entrenchT < COVER.DIG_TIME) {
      const was = s.entrenchT;
      s.entrenchT = Math.min(COVER.DIG_TIME, s.entrenchT + dt);
      /* The spade is the sound of FINISHING the position, not of entering it.
       *
       * It used to fire on taking cover, for either side. Counted over a
       * three-minute match that was 64 shovel hits — one every three seconds,
       * because AI squads bounce in and out of cover constantly. Tied to the
       * dig completing, for the player's own men, it happens once per position
       * and means something. */
      if (was < COVER.DIG_TIME && s.entrenchT >= COVER.DIG_TIME &&
          s.side === this.player) {
        this.fx.floater(s.x, groundY(this.map, s.lane, s.x) - 34, 'DUG IN', '#b5c98f');
        if (typeof Tutor !== 'undefined') Tutor.teach('dugin');
        if (Camera.sees(s.x, 60)) Sound.shovel(s.x);
      }
    }
    if (!this._coverObserved(s)) return;
    s.rangedT += dt;

    if (!s.rangedIn && s.rangedT >= COVER.RANGE_TIME) {
      s.rangedIn = true;
      s.rangedShots = 0;
      s.rangedFuse = COVER.RANGE_WARN;
      // the ranging round: lands short, hurts little, and is the player's cue
      const c = s.cover;
      const x = c.x - s.dir * (52 + rand(0, 26));
      const y = groundY(this.map, s.lane, x);
      Sound.shellWhistle(0);
      this.fx.explosion(x, y, 34, { shake: 1.1 });
      this.fx.addDecal(s.lane, x, 'crater', 10);
      this.fx.floater(c.x, groundY(this.map, s.lane, c.x) - 40, 'RANGING ROUNDS', '#e08767');
      this.emit(`POSITION RANGED — LANE ${s.lane + 1}`, s.side);
      if (s.side === this.player) if (typeof Tutor !== 'undefined') Tutor.teach('ranged');
      this._areaDamage(s.lane, x, 40, 8,
        { side: this.foeOf(s.side) }, this.foeOf(s.side));
      return;
    }
    if (!s.rangedIn) return;

    s.rangedFuse -= dt;
    if (s.rangedFuse > 0) return;
    s.rangedFuse = COVER.RANGE_RATE + rand(-0.5, 0.9);
    s.rangedShots = (s.rangedShots || 0) + 1;
    const c = s.cover;
    // rounds walk in: the first is loose, the rest are on the position
    const spread = Math.max(6, 30 - 9 * s.rangedShots);
    const x = c.x + rand(-spread, spread);
    const y = groundY(this.map, s.lane, x);
    const foe = this.foeOf(s.side);
    Sound.shellWhistle(0);
    Sound.explosion(0.7, x);
    this.fx.explosion(x, y, 52, { shake: 1.8 });
    this.fx.addDecal(s.lane, x, 'crater', 14);
    /* 18, not 24. Measured against a 55 HP rifleman: one round on a lone dug-in
     * squad takes 27% of each man, so ignoring the warning costs you people over
     * four rounds rather than deleting the squad in three. Crowding still ends
     * badly fast — three squads in one trench take 33 per man from the same
     * round, which is the point. */
    this._areaDamage(s.lane, x, 62, 18, { side: foe }, foe);
  }

  foeOf(side) { return side === 'us' ? 'vc' : 'us'; }

  /* Is anyone in a position to call fire onto this squad? */
  _coverObserved(s) {
    const foe = this.foeOf(s.side);
    for (const o of this.squads) {
      if (o.side !== foe || o.lane !== s.lane) continue;
      if (!this.squadAlive(o).length) continue;
      if (Math.abs(this.squadAnchor(o) - s.x) < 900) return true;
    }
    return false;
  }

  /* ---------- player/AI squad orders ---------- */
  orderSquad(s, order, arg) {
    if (!s || !this.squadAlive(s).length) return false;
    const release = () => { this.coverLeave(s); s.coverTarget = null; };
    if (order === 'advance') {
      release();
      s.ceding = false;
      s.hold = false; s.playerHeld = false; s.order = 'advance';
    } else if (order === 'hold') {
      release();
      s.ceding = false;
      s.hold = true; s.holdX = s.x; s.playerHeld = true; s.order = 'hold';
    } else if (order === 'fallback') {
      release();
      s.ceding = true;   // the one order allowed to give ground
      // scramble back to the previous cover, or just give ground
      let best = null, bd = 1e9;
      for (const c of this.covers[s.lane]) {
        if (!this.coverRoom(c, s)) continue;
        const dx = (s.x - c.x) * s.dir; // behind us
        if (dx < 20 || dx > 420) continue;
        if (dx < bd) { bd = dx; best = c; }
      }
      s.playerHeld = true;
      if (best) { s.coverTarget = best; s.order = 'tocover'; }
      else { s.moveToX = s.x - s.dir * 130; s.order = 'moveto'; }
    } else if (order === 'moveto') {
      release();
      s.ceding = true;   // the player picked the spot, forward or back
      s.playerHeld = true;
      // snap to a free cover spot if the click is on one (and the class fits)
      const c = this.covers[s.lane].find(c2 => this.coverRoom(c2, s) &&
        this.squadFitsCover(s, c2) &&
        // a fingertip is wider than a rock: never demand better than 40px
        Math.abs(c2.x - arg) < Math.max(c2.w, 40));
      if (c) { s.coverTarget = c; s.order = 'tocover'; }
      else { s.moveToX = clamp(arg, 30, WORLD_W - 30); s.order = 'moveto'; }
    } else if (order === 'takecover') {
      /* TAKE COVER: the nearest position this squad can actually use.
       *
       * `freeCoverAhead` only looks forward, which is right for an advance
       * under fire but wrong for an order — the player pointing at cover means
       * "get in something now", and the best hole is often the one just behind.
       * So this searches both ways, forward-weighted. */
      let best = null, bd = 1e9;
      for (const c of this.covers[s.lane]) {
        if (!this.coverRoom(c, s) || !this.squadFitsCover(s, c)) continue;
        const dx = (c.x - s.x) * s.dir;
        const d = dx >= 0 ? dx : -dx * 1.8;   // forward is cheaper, not free
        if (Math.abs(dx) > 420 || d >= bd) continue;
        bd = d; best = c;
      }
      if (!best) return false;
      s.ceding = false; s.playerHeld = true;
      if (this.coverHas(best, s)) { s.order = 'holdcover'; return true; }
      release();
      s.coverTarget = best; s.order = 'tocover'; s.coverCd = 0;
      return true;
    } else if (order === 'leavecover') {
      if (!s.inCover && !s.coverTarget) return false;
      release();
      s.order = s.hold ? 'hold' : 'advance';
      s.holdX = s.x;
      // do not let it slide straight back into the hole it was just pulled from
      s.coverCd = 2.5;
      return true;
    } else if (order === 'grenade') {
      return this._squadGrenade(s);
    } else if (order === 'blooper') {
      return this._squadBlooper(s);
    } else if (order === 'focus') {
      return this._squadFocus(s);
    } else if (order === 'crosslane') {
      return this._squadCrossLane(s);
    }
    if (order === 'smoke') {
      return this._squadSmoke(s);
    } else if (order === 'suppress') {
      return this._squadSuppress(s);
    }
    return true;
  }

  /* CROSS TO THE OTHER LANE.
   *
   * Lane was fixed at spawn, so "where you fight" was never a decision — you
   * chose a lane when you bought a squad and lived with it. Everything else in
   * the game is about position, and the largest positional choice on the board
   * was unavailable.
   *
   * The cost is what makes it a decision rather than a free teleport: a squad
   * crossing is in the open, out of cover, and holding its fire for the whole
   * traverse. Sending your MG to the collapsing lane means it does not shoot for
   * two seconds and cannot be recalled mid-crossing.
   *
   * The lane flips IMMEDIATELY — targeting, cover lookups and the render pass
   * all key off `lane`, and leaving it on the old value for the duration would
   * have men shooting across a lane they are no longer in. What interpolates is
   * only the DRAWN y (see _updateUnits), so the move reads as a walk rather than
   * a teleport.
   */
  _squadCrossLane(s) {
    if (LANE_N < 2) return false;
    const men = this.squadAlive(s);
    if (!men.length || (s.crossT || 0) > 0) return false;
    const to = s.lane === 0 ? 1 : 0;
    // release cover: it belongs to the lane being left
    this.coverLeave(s); s.coverTarget = null;
    s.crossFrom = s.lane;
    s.crossT = CROSS_TIME;
    s.lane = to;
    s.order = 'hold';
    s.hold = true; s.holdX = s.x; s.playerHeld = true;
    for (const m of men) {
      m.crossFrom = m.lane;
      m.crossT = CROSS_TIME;
      m.lane = to;
    }
    return true;
  }

  /* FOCUS FIRE — the squad concentrates on one enemy squad instead of each man
   * choosing for himself.
   *
   * Riflemen deliberately spread fire (`_acquire` adds rand(0,150) so bursts
   * walk a bunched line rather than queueing on the point man), which is right
   * by default and wrong when one enemy squad is the problem. Concentrating
   * kills a squad outright instead of wounding three, and a dead squad stops
   * shooting back — that is the whole trade the player now gets to make, and it
   * is the decision the middle of a firefight was missing.
   *
   * Picks the nearest enemy squad this one can actually see and engage. Cleared
   * automatically when that squad is gone, so focus can never strand a squad
   * shooting at nothing.
   */
  _squadFocus(s) {
    const alive = this.squadAlive(s);
    if (!alive.length) return false;
    const ax = this.squadAnchor(s);
    let best = null, bd = 1e9;
    for (const o of this.squads) {
      if (o.side === s.side || o.lane !== s.lane) continue;
      const men = this.squadAlive(o);
      if (!men.length) continue;
      if (!men.some(m => this.canSee(s.side, m))) continue;
      const d = Math.abs(this.squadAnchor(o) - ax);
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) return false;
    // picking the same squad twice releases it, so one key toggles
    s.focus = (s.focus === best) ? null : best;
    return true;
  }

  /* Pop smoke between the squad and whatever is shooting at it. Thrown short of
   * the enemy, not onto them — the point is a screen to move behind. */
  _squadSmoke(s) {
    if ((s.smokeCd || 0) > 0) return false;
    const alive = this.squadAlive(s);
    if (!alive.length) return false;
    const anchor = this.squadAnchor(s);
    s.smokeCd = SMOKE.cd;
    const m = alive[0];
    m.nadeT = 0.75;
    m.nadeDur = m.nadeT;
    m.nadeThrown = false;
    m.nadeSmoke = true;
    m.nadeTarget = anchor + s.dir * SMOKE.range * 0.62;
    if (s.side === this.player) this.emit(`SMOKE OUT — LANE ${s.lane + 1}`, s.side);
    return true;
  }

  /* Fire the M79. One round, arcing, landing on the target squad.
   *
   * Routed through `strikes` rather than through `nades` because the flight is
   * long and flat-arced rather than a lobbed fuse, and because _updateStrikes
   * already owns delayed impacts — explosion, crater, area damage, sound. The
   * round therefore gets the dug-position blast multiplier for free, which is
   * the entire reason the weapon exists. */
  _squadBlooper(s) {
    const sd = SQUADS[s.key];
    if (!sd.blooper || (s.bloopCd || 0) > 0) return false;
    const alive = this.squadAlive(s);
    if (!alive.length) return false;
    let target = null, bd = 1e9;
    for (const o of this.squads) {
      if (o.side === s.side || o.lane !== s.lane) continue;
      if (!this.squadAlive(o).length) continue;
      const oa = this.squadAnchor(o);
      const d = Math.abs(oa - s.x);
      if (d < M79.range && d < bd) { bd = d; target = oa; }
    }
    if (target == null) return false;
    s.bloopCd = M79.cd;
    /* Out of the tube that is DRAWN, not out of whoever happens to be first in
     * the squad. Without this the Weapons Team's machine gunner fired the M79
     * while the man holding one stood next to him — which was true before the
     * grenadier existed and became visibly wrong the moment he did. */
    const m = alive.find(q => q.key === 'grenadier') || alive[0];
    m.nadeT = 0.55;                       // he shoulders it briefly
    Sound.blooper(m.x);
    this.strikes.push({
      type: 'm79', side: s.side, lane: s.lane, x: target, age: 0,
      dur: M79.flight + 0.8,
      impacts: [{ t: M79.flight, x: target + rand(-12, 12),
                  r: M79.blast, dmg: M79.dmg, done: false }],
    });
    return true;
  }

  _squadGrenade(s) {
    const sd = SQUADS[s.key];
    if (!sd.grenades || (s.nadeCd || 0) > 0) return false;
    const alive = this.squadAlive(s);
    // nearest enemy squad anchor in throw range
    let target = null, bd = 1e9;
    for (const o of this.squads) {
      if (o.side === s.side || o.lane !== s.lane) continue;
      const oa = this.squadAnchor(o);
      if (!this.squadAlive(o).length) continue;
      const d = Math.abs(oa - s.x);
      if (d < GRENADE.range && d < bd) { bd = d; target = oa; }
    }
    if (target == null) return false;
    s.nadeCd = GRENADE.cd;
    let n = 0;
    for (const m of alive) {
      if (n >= 3 || m.sniperUnit) continue;
      n++;
      m.nadeT = 0.9 + n * 0.25; // staggered wind-ups
      m.nadeDur = m.nadeT;
      m.nadeThrown = false;
      m.nadeTarget = target + rand(-18, 18);
    }
    if (s.side === this.player) this.emit(`GRENADES OUT — LANE ${s.lane + 1}`, s.side);
    return n > 0;
  }

  _squadSuppress(s) {
    const sd = SQUADS[s.key];
    if (!sd.suppressive || (s.suppCd || 0) > 0) return false;
    // covering fire is the most expensive thing a squad can do; it cannot be
    // ordered on an empty load
    if ((s.ammo != null ? s.ammo : 1) < AMMO_LOW) {
      if (s.side === this.player) this.emit('OUT OF AMMUNITION', s.side);
      return false;
    }
    s.suppCd = 20;
    s.suppFireT = 5;
    if (s.side === this.player) this.emit(`SUPPRESSIVE FIRE — LANE ${s.lane + 1}`, s.side);
    return true;
  }

  _updateSmokes(dt) {
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.age += dt;
      s.life -= dt;
      // a cloud drifts and spreads as it dies
      s.radius += dt * 2.2;
      if (s.life <= 0) this.smokes.splice(i, 1);
    }
  }

  _updateNades(dt) {
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      if (!n.landed) {
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        n.vy += 620 * dt;
        n.spin += dt * 14;
        const gy = groundY(this.map, n.lane, n.x);
        if (n.y >= gy) {
          n.y = gy; n.landed = true;
          n.vx = 0;
        }
      } else {
        n.fuse -= dt;
        if (n.fuse <= 0) {
          this.nades.splice(i, 1);
          this.fx.explosion(n.x, n.y - 2, 40, { shake: 3 });
          Sound.explosion(0.6, n.x);
          this.fx.addDecal(n.lane, n.x, 'crater', 7);
          if (n.smoke) {
            this.smokes.push({ lane: n.lane, x: n.x, radius: SMOKE.radius,
              life: SMOKE.life, age: 0, side: n.side });
            this.fx.smokePuff(n.x, n.y);
          } else {
            this._areaDamage(n.lane, n.x, GRENADE.blast, GRENADE.dmg, { side: n.side }, n.side);
          }
        }
      }
    }
  }

  _squadPathClear(s) {
    for (const o of this.squads) {
      if (o === s || o.side !== s.side || o.lane !== s.lane) continue;
      if (!this.squadAlive(o).length) continue;
      const gap = (o.x - s.x) * s.dir;
      // SEP_GAP + SEP_CLEAR, never a number of its own: the separator holds
      // squads SEP_GAP apart, so a threshold below that is a treadmill.
      if (gap > 0 && gap < SEP_GAP + SEP_CLEAR) return false;
    }
    return true;
  }

  _makeHole(lane, x) {
    return {
      isHole: true, side: 'vc', lane, x,
      y: groundY(this.map, lane, x) - 5,
      hp: 60, maxHp: 60, cd: rand(1, 2.5), revealT: 0, discovered: false,
      dirToTarget: -1, deadT: null, defuse: 0,
    };
  }

  /* ---------- spawning & call-ins ---------- */
  trySpawn(side, key, lane, opts = {}) {
    const d = SQUADS[key];
    if (!d || d.side !== side || this.over) return false;
    /* Validate the lane before anything is spent.
     *
     * Same class as the trap leak in callinValid: an out-of-range lane sailed
     * through and blew up deep inside the terrain lookup on `pts`, AFTER CP had
     * been deducted and the cooldown set. A caller with a stale lane index
     * therefore got charged for a squad that never existed. Rejecting up front
     * keeps the failure cheap and total. */
    if (!(lane >= 0 && lane < LANE_N)) return false;
    // the field limit applies to the player too — see MAX_SQUADS
    if (!opts.free &&
        this.squads.filter(q => q.side === side && this.squadAlive(q).length).length >= MAX_SQUADS) {
      return false;
    }
    if (!opts.free) {
      if ((this.cool[side][key] || 0) > 0) return false;
      if (this.cp[side] < d.cost) return false;
      this.cp[side] -= d.cost;
      this.stats[side].cpSpent += d.cost;
      this.cool[side][key] = d.cd;
    }
    const x = opts.x != null ? opts.x : this.spawnX(side, lane);
    const squad = this._makeSquad(side, key, lane, x, { hold: !!opts.hold });
    if (side === 'vc' && opts.x == null && this.tunnels.some(t => t.lane === lane)) {
      squad.emergeT = 0.9;
      squad.men.forEach((m, i) => { m.emergeT = 0.5 + i * 0.22; });
      this.fx.smokePuff(x, squad.men[0].y);
    }
    return true;
  }

  callinValid(side, key, lane, x) {
    /* Validate the LANE, not just the position.
     *
     * This checked x-bounds and the trap cap but never the lane index, so a
     * caller passing a lane that does not exist got a silent success: CP was
     * spent, the trap was pushed, and it then sat in a lane nothing iterates —
     * never triggered, never drawn, never cleaned up, yet still counted against
     * MAX_TRAPS. Ten of those and every subsequent punji and mine placement
     * fails, which quietly disables VC ground doctrine mid-match.
     *
     * The proximate cause was one stale `randi(0, 2)`, now fixed. This check is
     * here so the next stale lane literal fails loudly instead of leaking. */
    if (!(lane >= 0 && lane < LANE_N)) return false;
    const lo = WORLD_W * 0.06, hi = WORLD_W * 0.94;
    if (x < lo || x > hi) return false;
    if (key === 'tunnel') {
      if (x < WORLD_W * 0.4) return false;
      if (this.tunnels.some(t => t.lane === lane)) return false;
    }
    if ((key === 'punji' || key === 'mine') && this.traps.filter(t => t.side === side).length >= MAX_TRAPS) return false;
    return true;
  }

  tryCallin(side, key, lane, x) {
    const d = CALLINS[key];
    if (!d || d.side !== side || this.over) return false;
    const artyK = (typeof Perks !== 'undefined' && Perks.on(this, side, 'arty')) ? 0.75 : 1;
    const cost = d.cost * artyK;
    if ((this.cool[side][key] || 0) > 0 || this.cp[side] < cost) return false;
    if (d.target === 'point' && !this.callinValid(side, key, lane, x)) return false;

    this.cp[side] -= cost;
    this.stats[side].cpSpent += cost;
    this.stats[side].callins++;
    this.cool[side][key] = d.cd;
    const isPlayer = side === this.player;

    switch (key) {
      case 'arty': {
        const impacts = [];
        for (let i = 0; i < 6; i++) {
          impacts.push({ t: 2.6 + i * 0.38 + rand(0, 0.2), x: clamp(x + rand(-115, 115), 20, WORLD_W - 20), dmg: 42, r: 78, done: false });
        }
        this.strikes.push({ type: 'arty', side, lane, x, age: 0, dur: 6, impacts });
        Sound.radio(); Sound.shellWhistle(1.8);
        this.emit(`FIRE MISSION LANE ${lane + 1} — SHOT, OVER`, side);
        break;
      }
      case 'napalm':
        this.strikes.push({ type: 'napalm', side, lane, x, age: 0, dur: 5, dropT: 2.2, dropped: false });
        Sound.radio();
        setTimeout(() => Sound.jet(), 0);
        this.emit(`AIR STRIKE INBOUND — LANE ${lane + 1}`, side);
        break;
      case 'medevac':
        this.strikes.push({ type: 'medevac', side, age: 0, dur: 5, healed: false });
        Sound.radio(); Sound.chopper(4.5);
        this.emit('DUSTOFF INBOUND — GOLDEN HOUR', side);
        break;
      case 'aircav': {
        this.strikes.push({ type: 'aircav', side, lane, x, age: 0, dur: 6.2, dropped: false });
        Sound.radio(); Sound.chopper(5.5);
        this.emit(`AIR CAV INSERTION — LANE ${lane + 1}`, side);
        break;
      }
      case 'arclight': {
        const impacts = [];
        for (let i = 0; i < 12; i++) {
          impacts.push({ t: 3.5 + i * 0.22, x: clamp(x - 330 + i * 60 + rand(-20, 20), 20, WORLD_W - 20), dmg: 60, r: 96, done: false });
        }
        this.strikes.push({ type: 'arclight', side, lane, x, age: 0, dur: 8, impacts });
        Sound.radio(); Sound.bomberRumble(5);
        this.setBanner('ARC LIGHT INBOUND', true);
        this.emit('B-52 STRIKE CONFIRMED — DANGER CLOSE', side);
        break;
      }
      case 'punji':
        this.traps.push({ side, lane, x, type: 'punji', discovered: false, defuse: 0 });
        Sound.shovel(x);
        if (isPlayer) this.emit(`PUNJI STAKES SET — LANE ${lane + 1}`, side);
        break;
      case 'mine':
        this.traps.push({ side, lane, x, type: 'mine', discovered: false, defuse: 0 });
        Sound.shovel(x);
        if (isPlayer) this.emit(`TRIPWIRE SET — LANE ${lane + 1}`, side);
        break;
      case 'spiderhole':
        this.holes.push(this._makeHole(lane, x));
        Sound.shovel(x);
        if (isPlayer) this.emit(`MARKSMAN BURIED — LANE ${lane + 1}`, side);
        break;
      case 'tunnel':
        this.tunnels.push({ side, lane, x, discovered: false, defuse: 0, hp: 90 });
        Sound.shovel(x);
        if (isPlayer) this.emit(`TUNNEL EXIT DUG — LANE ${lane + 1}`, side);
        this.fx.smokePuff(x, groundY(this.map, lane, x));
        break;
    }
    return true;
  }

  /* ---------- main update ---------- */
  update(dt) {
    if (this.over) { this.fx.update(dt); return; }
    this.time += dt;

    for (const side of ['us', 'vc']) {
      let inc = INCOME[side];
      inc += this.flags.filter(f => f.owner === side).length * FLAG_INCOME;
      if (this.map.incomeMult && this.map.incomeMult[side]) inc *= this.map.incomeMult[side];
      inc *= side === this.player ? this.diff.playerIncome : this.diff.aiIncome;
      this.cp[side] = Math.min(CP_CAP, this.cp[side] + inc * dt);
      const cools = this.cool[side];
      for (const k in cools) cools[k] = Math.max(0, cools[k] - dt);
    }

    this._spottingPass(dt);
    this._updateLevers(dt);
    this._updateSquads(dt);
    this._updateUnits(dt);
    this._separate(dt);        // keep converging squads from standing inside each other
    this._updatePose(dt);      // presentation, derived once the men have moved
    this._updateNades(dt);
    this._updateSmokes(dt);
    this._updateHoles(dt);
    this._updateStrikes(dt);
    this._updateFires(dt);
    this._updateStructures(dt);
    this._ambient(dt);
    this._musicTension(dt);
    /* Two lessons that are about a SITUATION rather than an event, so they are
     * checked rather than hooked. Both are cheap and both stop the moment they
     * have been taught once. */
    if (typeof Tutor !== 'undefined' && Tutor.load) {
      const seen = Tutor.load();
      if (!seen.m79 && this.squads.some(q => q.side === this.player &&
          SQUADS[q.key] && SQUADS[q.key].blooper && this.squadAlive(q).length)) {
        Tutor.teach('m79');
      }
      if (!seen.enemydug && this.squads.some(q => q.side !== this.player &&
          q.cover && q.cover.dug && this.squadAlive(q).length &&
          Camera.sees(this.squadAnchor(q), 60))) {
        Tutor.teach('enemydug');
      }
    }
    this._updateFlags(dt);
    this._aiUpdate(dt);
    this.fx.update(dt);

    // flag pressure on morale
    const net = this.flags.filter(f => f.owner === 'us').length - this.flags.filter(f => f.owner === 'vc').length;
    if (net > 0) this.morale.vc -= net * FLAG_DRAIN * dt;
    else if (net < 0) this.morale.us -= -net * FLAG_DRAIN * dt;

    this._checkEnd();
  }

  _checkEnd() {
    this.morale.us = clamp(this.morale.us, 0, 100);
    this.morale.vc = clamp(this.morale.vc, 0, 100);
    let winner = null, reason = '';
    if (this.morale.us <= 0) { winner = 'vc'; reason = 'US morale broken — the operation is called off.'; }
    else if (this.morale.vc <= 0) { winner = 'us'; reason = 'VC/NVA morale broken — they melt back into the jungle.'; }
    else if (this.mode === 'assault' && this.flags.every(f => f.owner === 'us')) {
      winner = 'us'; reason = 'All objectives taken. The crest is yours — at a price.';
    } else if (this.timeLimit && this.time >= this.timeLimit) {
      if (this.mode === 'siege') { winner = 'us'; reason = 'The weather lifted and the relief column arrived. The siege is broken.'; }
      else { winner = 'vc'; reason = 'The assault is called off. The hill remains in enemy hands.'; }
    }
    if (winner) {
      this.over = true;
      this.result = { winner, reason };
      Sound.bell(winner === this.player);
    }
  }

  /* ---------- spotting / discovery ---------- */
  _spottingPass(dt) {
    const penalty = this.map.detectPenalty || 1;
    for (const u of this.units) {
      if (u.side !== 'us' || u.deadT != null) continue;
      let base = (UNITS[u.key].detect || 70) * penalty;
      if (typeof Perks !== 'undefined' && Perks.on(this, u.side, 'scouts')) base *= 1.25;
      const eng = UNITS[u.key].engineer;
      const isRecon = !!UNITS[u.key].detect;
      for (const v of this.units) {
        if (v.side !== 'vc' || v.deadT != null || v.lane !== u.lane) continue;
        if (!this.isConcealed(v)) continue;
        const elevAdv = elevAt(this.map, u.lane, u.x) - elevAt(this.map, v.lane, v.x);
        const r = base * (1 + 0.4 * Math.max(0, elevAdv));
        if (Math.abs(v.x - u.x) < r) {
          if (v.spotT <= 0) {
            this.fx.floater(v.x, v.y - 44, 'SPOTTED', '#ffd98a');
            if (this.player === 'us') this.emit(`CONTACT — LANE ${v.lane + 1}`, 'us');
          }
          v.spotT = 5;
        }
      }
      const dr = isRecon ? 150 : eng ? 100 : 0;
      if (dr) {
        for (const t of this.traps) {
          if (t.lane === u.lane && !t.discovered && Math.abs(t.x - u.x) < dr) {
            t.discovered = true;
            this.fx.floater(t.x, groundY(this.map, t.lane, t.x) - 20, 'TRAP MARKED', '#ffd98a');
          }
        }
        for (const h of this.holes) {
          if (h.lane === u.lane && !h.discovered && Math.abs(h.x - u.x) < dr) {
            h.discovered = true;
            this.fx.floater(h.x, h.y - 20, 'SPIDER HOLE', '#ffd98a');
          }
        }
        for (const tn of this.tunnels) {
          if (tn.lane === u.lane && !tn.discovered && Math.abs(tn.x - u.x) < dr) {
            tn.discovered = true;
            this.fx.floater(tn.x, groundY(this.map, tn.lane, tn.x) - 20, 'TUNNEL FOUND', '#ffd98a');
          }
        }
      }
    }
  }

  /* ---------- units ---------- */
  _targetsFor(side, lane) {
    const foes = [];
    for (const u of this.units) {
      if (u.side !== side && u.deadT == null && u.lane === lane && u.emergeT <= 0) foes.push(u);
    }
    if (side === 'us') {
      for (const h of this.holes) {
        if (h.lane === lane && (h.revealT > 0 || h.discovered)) foes.push(h);
      }
    }
    return foes;
  }

  _acquire(u) {
    const d = UNITS[u.key];
    const foes = this._targetsFor(u.side, u.lane);
    const eu = elevAt(this.map, u.lane, u.x);
    let best = null, bestScore = -1e9;
    for (const f of foes) {
      if (!this.canSee(u.side, f)) continue;
      const dx = (f.x - u.x) * u.dir;
      if (dx < -40) continue;
      const ef = elevAt(this.map, f.lane, f.x);
      let range = d.range * (1 + 0.3 * clamp(eu - ef, -0.9, 0.9));
      // a sniper in a tower sees forever
      if (u.sniperUnit && u.squad && u.squad.inCover && u.squad.cover &&
          u.squad.cover.type === 'towerpos') range *= 1.3;
      const dist = Math.abs(f.x - u.x);
      if (dist > range) continue;
      let score = -dist;
      // riflemen distribute fire across a bunched group instead of queueing
      // on the point man — every acquire re-rolls, so bursts walk the line
      if (!d.sniper) score += rand(0, 150);
      /* ...unless the player has called for concentrated fire. Big enough to
       * beat the spread roll and any distance term inside a unit's range, but
       * NOT absolute: a man still will not shoot through a wall or past his
       * reach, because the range and line-of-sight tests above already ran. */
      if (u.squad && u.squad.focus && f.squad === u.squad.focus) score += 900;
      if (d.sniper) {
        if (f.sniperUnit) score += 600;
        else if (!f.isHole && UNITS[f.key] && UNITS[f.key].mg) score += 300;
        if (f.isHole) score += 200;
      }
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return best;
  }

  _fire(u, t) {
    const d = UNITS[u.key];
    // every round comes out of the squad's load — see AMMO_PER_SHOT
    if (u.squad) {
      const supp = (u.squad.suppFireT || 0) > 0;
      u.squad.ammo = Math.max(0, (u.squad.ammo == null ? 1 : u.squad.ammo) -
        AMMO_PER_SHOT * (supp ? AMMO_SUPP_MULT : 1));
      u.squad.firedT = 1.2;      // "recently shooting", so resupply cannot overlap a firefight
    }
    const distT = Math.abs(t.x - u.x);
    const closeQuarters = distT < d.range * 0.45;
    // burst cadence: quick rounds inside a burst, a long breath between bursts —
    // shorter breaths when the enemy is right on top of you
    const suppressive = d.mg && u.squad && (u.squad.suppFireT || 0) > 0;
    // running dry stretches the breath between bursts: degraded, still dangerous
    const dry = u.squad && (u.squad.ammo != null) && u.squad.ammo < AMMO_LOW
      ? 1 + 1.6 * (1 - u.squad.ammo / AMMO_LOW) : 1;
    if (suppressive) {
      u.fireT = 1 / d.rof; // the gun talks without pause
    } else if (d.burst) {
      if (!u.burstN || u.burstN <= 0) u.burstN = randi(d.burst[0], d.burst[1]);
      u.burstN--;
      const ammo = (typeof Perks !== 'undefined' && Perks.on(this, u.side, 'ammo')) ? 0.78 : 1;
      const ending = u.burstN <= 0;
      u.fireT = ending
        ? rand(d.pause[0], d.pause[1]) * (closeQuarters ? 0.7 : 1) * ammo * dry
        : 1 / d.rof;
      /* The breath between bursts is where the weapon gets worked. It was
       * silent, so a firefight was a stream of shots with nobody reloading in
       * it. A belt gun shifts its feed; everyone else changes a magazine. */
      if (ending && Camera.sees(u.x, 80)) {
        if (d.mg) { if (Math.random() < 0.5) Sound.belt(u.x); }
        else if (Math.random() < 0.35) Sound.reload(u.x);
      }
    } else {
      u.fireT = (1 / d.rof) * dry;
    }
    // 0.07 was ~4 frames — snappy, and gone before the eye caught it. 0.11 still
    // reads as a flash rather than a lamp, and roughly doubles the chance that
    // any given frame shows one.
    u.muzzleT = 0.11;
    u.combatT = 0.9;
    u.shots++;
    const scale = LANE_DEPTH[u.lane];
    const mp = muzzlePoint(u);
    const mx = mp.x, my = mp.y;
    this.fx.muzzle(mx, my, u.dir, scale, !!d.mg);
    this.fx.casing(u.x + u.dir * 2 * scale, my + 3, u.dir, scale);
    if (u.shots % 4 === 0) this.fx.addDecal(u.lane, u.x - u.dir * 3 + rand(-4, 4), 'casing', 1);
    if (d.at) {
      Sound.rocket(mx);
      /* BACKBLAST. A B-40 is a recoilless launcher: everything the rocket does
       * not push forward goes out of the back of the tube in a cone of dust and
       * smoke. It is the most recognisable thing about firing one and the game
       * did not draw it at all — the shot read as a rifle with a loud sound.
       *
       * It is also the tell that gives the gunner's position away, which is the
       * honest reason to draw it: the player should be able to see where the
       * rocket came from. */
      const bx = u.x - u.dir * 18 * scale;
      this.fx.smokePuff(bx, my + 3 * scale);
      this.fx.smokePuffSmall(bx - u.dir * 12 * scale, my + 6 * scale);
      this.fx.suppressDust(bx, groundY(this.map, u.lane, bx), -u.dir, scale);
      this.fx.sparks(mx + u.dir * 6 * scale, my);
    }
    /* The weapon decides, not the side. This used to be `us ? m16 : ak`, so
     * twelve unit types shared three gunshots and a firefight was one loop. */
    else Sound.shot(d.snd || (d.mg ? 'mg' : u.side === 'us' ? 'm16' : 'ak'), mx);
    if (Math.random() < 0.08) this.tryBirds(u.x);

    const wasHidden = this.isConcealed(u);
    if (u.side === 'vc' && UNITS[u.key].conceal) u.revealT = 6.0;

    const suppressed = u.suppressT > 0;
    // point-blank volleys land far more often — close fights resolve fast
    const closeK = clamp(1 - distT / (d.range || 1), 0, 1);
    /* Cover shields you from fire ACROSS GROUND, not from a man in your face.
     *
     * Measured: 87% of all shots are taken at a target in cover, average
     * protection 0.56 — so a flat multiplier was not a situational advantage, it
     * was a permanent halving of everyone's damage, and firefights took ~35
     * rounds per casualty. Scaling it by range keeps a dug-in squad genuinely
     * hard to shift at distance while letting a close assault break the position,
     * which is how the fight is supposed to resolve. */
    let rawProt = (!t.isHole && t.squad && t.squad.inCover && t.squad.cover)
      ? this.coverProt(t.squad.cover, t.squad) : 0;
    if (rawProt && typeof Perks !== 'undefined' && Perks.on(this, t.side, 'entrench')) {
      /* Cap against the RIGHT ceiling.
       *
       * This hardcoded 0.82 was the old universal cap. Dug positions now reach
       * DUG_CAP, so in a fully-dug trench the entrenching perk was clamping
       * 0.93 back down to 0.82 — the upgrade actively weakened the one kind of
       * cover its name refers to, and at range that is a 2.2x swing in how
       * often the position gets hit. */
      const cap = t.squad.cover.dug ? COVER.DUG_CAP : COVER.PROT_CAP;
      rawProt = Math.min(cap, rawProt * 1.28);
    }
    /* A DUG POSITION GETS ITS OWN CURVE.
     *
     * The shared one tops out at 0.34 + 0.46 = 0.80 of the protection value, so
     * a trench reading 0.77 delivered — measured, both squads immortal and
     * pinned at 150px for 25s — a 28% damage reduction. That is not a position,
     * it is a slightly better patch of grass, and it is why a dug-in squad was
     * losing to one in the open.
     *
     * Dug positions run 0.42 -> 0.94 instead. At range that is near-total: a
     * squad in the open attacking a trench frontally should be destroyed, which
     * is the whole reason trenches were dug. Up close it falls away hard, so
     * the counters still work — close the distance, or use the things that
     * ignore cover entirely: grenades, rockets, and shells. */
    const dugIn = t.squad && t.squad.cover && t.squad.cover.dug;
    // only the near end of the curve differs; the span is shared, so say so
    const near = dugIn ? 0.52 : 0.34;
    const coverMult = 1 - rawProt * (near + 0.46 * (1 - closeK));
    const vet = u.squad ? RANKS[u.squad.rank || 0].acc : 1;
    const hit = Math.random() <
      d.acc * vet * (1 + 0.7 * closeK) * (suppressed ? 0.7 : 1) * coverMult;

    if (Math.random() < 0.3) this.fx.smokePuffSmall(mx, my);
    if (hit) {
      const ty = t.y - (t.isHole ? 0 : 14 * LANE_DEPTH[t.lane]);
      // roughly one round in four is a tracer, as a belt is actually loaded
      this.fx.tracer(mx, my, t.x + rand(-4, 4), ty + rand(-4, 4),
        u.side === 'us' ? '#ffd98a' : '#ffb08a', 'spark', ((u.shots || 0) % 4) === 0);
      const eu = elevAt(this.map, u.lane, u.x), ef = elevAt(this.map, t.lane, t.x);
      let dmg = d.dmg * (1 + 0.35 * clamp(eu - ef, -0.9, 0.9));
      if (wasHidden && d.ambush && d.ambush > 1) {
        dmg *= d.ambush;
        this.fx.floater(u.x, u.y - 46, 'AMBUSH!', '#e08767', true);
      }
      if (d.suppress && !t.isHole) t.suppressT = 0.8;
      if (!t.isHole && t.squad) {
        const nest = u.squad && u.squad.inCover && u.squad.cover && u.squad.cover.type === 'nestpos';
        t.squad.pin += (d.suppress ? 0.13 : 0.06) * (suppressive ? 2 : 1) * (nest ? 1.5 : 1) *
          RANKS[t.squad.rank || 0].steady;
        t.squad.underFireT = 1.4;
      }
      if (d.at) {
        /* A rocket does not "hit a man" — it detonates. Area damage, flagged
         * heavy so armour is no defence, which is the whole reason the weapon
         * exists. */
        // the rocket's own smoke trail, so the shot has a visible flight path
        // rather than being a hit that simply happens at the far end
        const n = 6;
        for (let i = 1; i <= n; i++) {
          const k = i / (n + 1);
          this.fx.smokePuffSmall(mx + (t.x - mx) * k, my + (t.y - 12 - my) * k);
        }
        this.fx.explosion(t.x, t.y - 10, 46, { shake: 6 });
        this._areaDamage(u.lane, t.x, d.blast || 44, dmg, { side: u.side }, u.side);
        this.fx.punch(0.06, u.dir, -0.2);
      } else {
        this._damage(t, dmg, u);
        // a hull does not bleed — _damage draws the ricochet instead
        const armoured = !t.isHole && UNITS[t.key] && UNITS[t.key].armour;
        if (!t.isHole && !armoured) this.fx.blood(t.x, t.y, LANE_DEPTH[t.lane]);
      }
    } else {
      // rounds go long or drop short — visibly
      const dist = (t.x - u.x) * u.dir;
      const missAt = Math.max(30, dist + rand(-60, 150));
      const ex = u.x + u.dir * missAt;
      const short = missAt < dist - 6;
      const gy = groundY(this.map, u.lane, ex);
      const ey = short ? gy : gy - rand(2, 26 * scale);
      this.fx.tracer(mx, my, ex + rand(-4, 4), ey,
        u.side === 'us' ? '#ffd98a' : '#ffb08a',
        (short || Math.random() < 0.45) ? 'dirt' : null,
        ((u.shots || 0) % 4) === 0);
      // impact debris by what is actually there: timber splinters off a building,
      // sparks off an emplacement, water out of a paddy, dirt everywhere else
      if (short || Math.random() < 0.5) {
        const hitSt = this.structures.find(st2 => st2.lane === u.lane &&
          st2.state !== 2 && Math.abs(st2.x - ex) < st2.w * 0.7);
        if (hitSt) {
          if (hitSt.kind === 'tower' || hitSt.kind === 'mgnest') {
            this.fx.sparks(ex, ey);
            if (Math.random() < 0.5) Sound.ricochet(ex);
            else if (Math.random() < 0.5) Sound.impact('metal', ex);
          } else {
            this.fx.splinters(ex, ey, scale);
            if (Math.random() < 0.2) Sound.ricochet(ex);
            else if (Math.random() < 0.45) Sound.impact('wood', ex);
          }
        } else if (this.map.trees === 'palm' && Math.random() < 0.35) {
          this.fx.waterPlume(ex, gy);
          if (Math.random() < 0.5) Sound.impact('water', ex);
        } else {
          // a belt-fed gun throws visibly more earth than a rifle — an M60 burst
          // and a single rifle shot used to land identically
          this.fx.dirtKick(ex, gy, scale, !!d.mg || !!suppressive);
          /* Dirt is by far the most common impact, so it is the one most able
           * to turn the mix to mud — a quarter of them, not all. */
          if (Math.random() < 0.25) Sound.impact('dirt', ex);
        }
      }
      // cracking rounds keep heads down even when they miss
      if (!t.isHole && Math.abs(ex - t.x) < 46 && Math.random() < 0.6) {
        /* Draw the suppression the sim is already applying. Everything below
         * this line has always happened — accuracy halved, advances stopped,
         * stance driven to prone — and the only thing on screen saying so was
         * the word PINNED in 8px type. The dust walks in from the firing side. */
        this.fx.suppressDust(ex, groundY(this.map, t.lane, ex),
          Math.sign(u.x - t.x) || 1, LANE_DEPTH[t.lane]);
        t.suppressT = Math.max(t.suppressT || 0, rand(0.4, 0.9));
        if (t.squad) {
          t.squad.pin += (d.suppress ? 0.1 : 0.045) * (suppressive ? 2 : 1) *
            RANKS[t.squad.rank || 0].steady;
          t.squad.underFireT = 1.2;
        }
      }
    }
  }

  _damage(t, dmg, killer, opts = {}) {
    // armour turns rifle fire aside; a satchel, mine or shell goes straight through
    const arm = !t.isHole && UNITS[t.key] && UNITS[t.key].armour;
    if (arm) {
      /* SMALL ARMS DO NOT KILL ARMOUR. Not "less", none.
       *
       * Rifle fire used to do 0.28x, which is not a wall — it is a grind. A
       * 260 HP hull falls to about a thousand rounds, so the honest answer to
       * an APC was to keep shooting it, and the RPG gunner and the sapper were
       * a shortcut rather than the answer. Zero makes the APC a PROBLEM: you
       * need a shaped charge, a satchel, a grenade or a shell, and if you have
       * none of those you have to manoeuvre around it.
       *
       * The deflection has to be loud, or this reads as a bug rather than as
       * armour — see _armourDeflect. */
      if (!opts.heavy) { this._armourDeflect(t, killer); return; }
      dmg *= 2.4;
      this._armourImpact(t, killer);
    }
    /* A sniper is very hard to answer at distance.
     *
     * `farArmour` is not armour in the vehicle sense — it stands for a man who
     * is prone, concealed and a long way off, where rifle fire arriving at the
     * edge of its own range is mostly noise. It falls away entirely as the
     * range closes, which keeps the counterplay honest: rush him, flank him, or
     * shell him — just do not expect to trade shots with him at 800px. Heavy
     * ordnance ignores it, because a shell does not care how prone he is. */
    const fa = !t.isHole && UNITS[t.key] && UNITS[t.key].farArmour;
    if (fa && !opts.heavy && killer && killer.x != null) {
      const r = UNITS[t.key].range || 700;
      const far = clamp((Math.abs(killer.x - t.x) - r * 0.30) / (r * 0.55), 0, 1);
      dmg *= 1 - fa * far;
    }
    t.hp -= dmg;
    if (t.hp <= 0 && t.deadT == null) this._kill(t, killer, opts);
    else if (t.deadT == null && !t.isHole) {
      /* One flinch per burst, not one per round.
       *
       * A man under sustained fire was taking a fresh 0.16s flinch on every
       * bullet, so the animation ran idle>hit>idle>hit… — measured at 37 clip
       * changes a minute on the worst man, the single largest remaining source
       * of visible chatter. The flinch is deliberately exempt from the clip
       * dwell (being shot has to register on the frame it happens), so the
       * limit has to live here instead: react, then absorb the rest of the
       * burst. */
      if ((t.hitCd || 0) <= 0) {
        t.hitT = Math.max(t.hitT || 0, 0.16);
        t.hitCd = 0.62;
      }
    }
  }

  /* Rounds coming off a hull. The player must SEE that the bullets are doing
   * nothing, or zero damage reads as a broken hit test. Rate-limited hard: a
   * .50 and two rifles on one track would otherwise be a continuous shower of
   * sparks and a solid tone of ricochets. */
  _armourDeflect(t, killer) {
    if ((t.clangCd || 0) > 0) return;
    t.clangCd = 0.16;
    const sc = LANE_DEPTH[t.lane];
    const dir = killer && killer.x != null ? Math.sign(killer.x - t.x) || 1 : 1;
    const hx = t.x + dir * 14 * sc, hy = t.y - rand(14, 30) * sc;
    this.fx.sparks(hx, hy);
    /* The SOUND is thinner than the sparks, on its own clock.
     *
     * Measured under two NVA squads' fire: one shared cooldown gave 2.5 sparks
     * and 2.4 ricochets a second — the sparks read as armour, the ricochets
     * read as a stuck tone. The eye tolerates a rate the ear does not. */
    if ((t.clangSndCd || 0) <= 0 && Camera.sees(t.x, 60)) {
      t.clangSndCd = 0.42;
      Sound.ricochet(hx);
    }
    // and once in a while, say it in words
    if ((t.clangSayCd || 0) <= 0 && Camera.sees(t.x, 60)) {
      t.clangSayCd = 4.5;
      if (killer && killer.side === this.player) if (typeof Tutor !== 'undefined') Tutor.teach('armour');
      this.fx.floater(t.x, t.y - 44 * sc, 'ARMOUR', '#c9cbb4');
    }
  }

  /* A warhead getting through. The blast draws its own explosion at the point
   * of detonation; this is the hull's reaction to it — a hot spall flash, smoke
   * off the plate, and the track physically rocking away from the hit. */
  _armourImpact(t, killer) {
    const sc = LANE_DEPTH[t.lane];
    const dir = killer && killer.x != null ? Math.sign(t.x - killer.x) || 1 : 1;
    t.jolt = Math.min(7, (t.jolt || 0) + 5) * dir;
    this.fx.sparks(t.x - dir * 10 * sc, t.y - 20 * sc);
    this.fx.sparks(t.x - dir * 4 * sc, t.y - 30 * sc);
    this.fx.smokePuff(t.x, t.y - 26 * sc);
    this.fx.dirtKick(t.x, t.y, sc, true);
    if (Camera.sees(t.x, 80)) {
      this.fx.shake = Math.min(14, this.fx.shake + 3);
      this.fx.floater(t.x, t.y - 52 * sc, 'HULL HIT', '#ffb08a');
    }
  }

  _kill(t, killer, opts = {}) {
    if (t.isHole) {
      t.deadT = 0;
      this.fx.explosion(t.x, t.y, 26, { shake: 2 });
      this.holes.splice(this.holes.indexOf(t), 1);
      if (killer) this.stats[killer.side || killer].kills++;
      this.emit('SPIDER HOLE DESTROYED', 'us');
      return;
    }
    t.deadT = 0;
    t.aiming = false;
    // a man leaving the fight is worth hearing — see Sound.manDown
    if (!t.isHole && !(UNITS[t.key] && UNITS[t.key].vehicle)) Sound.manDown(t.x);
    this._lossT = Math.min(1.6, (this._lossT || 0) + 0.22);   // feeds the music
    if (UNITS[t.key] && UNITS[t.key].vehicle) {
      // a knocked-out track brews up; no corpse, no blood
      t.baked = true;
      this.fx.explosion(t.x, t.y - 14, 62, { shake: 9 });
      this.fx.punch(0.1, killer && killer.x != null ? Math.sign(t.x - killer.x) : 0, -0.2);
      this.emit(`APC KNOCKED OUT — LANE ${t.lane + 1}`, t.side === this.player ? 'vc' : 'us');
    }
    /* A moment of near-freeze so a kill lands. Only when the player can actually
     * see it — stopping the clock for something off-screen is just a stutter. */
    if (Camera.sees(t.x, 80)) {
      const dx = killer && killer.x != null ? Math.sign(t.x - killer.x) : 0;
      this.fx.punch(opts.gib ? 0.085 : 0.05, dx, -0.25);
      this.fx.shake = Math.min(14, this.fx.shake + (opts.gib ? 5 : 2));
    }
    if (opts.gib) {
      t.gibbed = true;
      t.baked = true;
      const scale = LANE_DEPTH[t.lane];
      this.fx.gibs(t.x, t.y, scale, t.y + 2);
      this.fx.bakeCorpse(t, { gibbed: true });
    } else if (Math.random() < 0.3) {
      t.wounded = true; // drags himself a few meters before he stops
    }
    const medK = (typeof Perks !== 'undefined' && Perks.on(this, t.side, 'medics')) ? 0.72 : 1;
    this.morale[t.side] -= (t.cpShare || UNITS[t.key].cost) * MORALE_LOSS[t.side] * medK;
    this.stats[t.side].losses++;
    const ks = killer ? (killer.side || killer) : other(t.side);
    if (ks !== t.side) this.stats[ks].kills++;
    // the squad that did it gets the credit
    if (killer && killer.squad && ks !== t.side) {
      const sq = killer.squad;
      sq.xp = (sq.xp || 0) + 1;
      const nr = rankOf(sq.xp);
      if (nr > (sq.rank || 0)) {
        sq.rank = nr;
        this.fx.floater(this.squadAnchor(sq), groundY(this.map, sq.lane, sq.x) - 62,
          RANKS[nr].name, sq.side === 'us' ? '#b5c98f' : '#e08767', true);
        if (sq.side === this.player) this.emit(`SQUAD PROMOTED — ${RANKS[nr].name}`, 'us');
      }
    }
    if (killer && killer.key && (this.isConcealed(killer) || killer.isHole)) {
      this.hiddenLoss[t.lane]++;
    }
    if (killer && killer.isHole) this.hiddenLoss[t.lane]++;
  }

  _updateUnits(dt) {
    const map = this.map;
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.deadT != null) {
        u.deadT += dt;
        if (u.wounded && u.deadT > 0.25 && u.deadT < 2.3) {
          u.x -= u.dir * 7 * dt; // crawls back the way he came
          u.y = groundY(map, u.lane, u.x);
          if (Math.random() < dt * 2.4) this.fx.addDecal(u.lane, u.x + rand(-2, 2), 'drip', 1);
        }
        const bakeAt = u.wounded ? 2.4 : 0.9;
        if (u.deadT > bakeAt && !u.baked) {
          u.baked = true;
          this.fx.bakeCorpse(u, { gibbed: u.gibbed });
        }
        if (u.deadT > (u.gibbed ? 0.05 : u.wounded ? 3.0 : 1.5)) this.units.splice(i, 1);
        continue;
      }
      /* Mid-crossing a man is drawn between the two lane baselines. `lane` is
       * already the DESTINATION, so this walks him in from where he came. */
      if ((u.crossT || 0) > 0) {
        u.crossT = Math.max(0, u.crossT - dt);
        const k = 1 - u.crossT / CROSS_TIME;          // 0 at the start, 1 done
        const e = k * k * (3 - 2 * k);                 // ease, so he does not jerk off
        const from = groundY(map, u.crossFrom, u.x);
        const to = groundY(map, u.lane, u.x);
        u.y = from + (to - from) * e;
        u.crossK = e;
        u.moving = true;
      } else {
        u.crossK = null;
        u.y = groundY(map, u.lane, u.x);
      }
      u.muzzleT = Math.max(0, u.muzzleT - dt);
      u.suppressT = Math.max(0, u.suppressT - dt);
      u.slowT = Math.max(0, u.slowT - dt);
      u.revealT = Math.max(0, u.revealT - dt);
      u.spotT = Math.max(0, u.spotT - dt);
      u.hitT = Math.max(0, (u.hitT || 0) - dt);
      u.hitCd = Math.max(0, (u.hitCd || 0) - dt);
      u.clangCd = Math.max(0, (u.clangCd || 0) - dt);
      u.clangSayCd = Math.max(0, (u.clangSayCd || 0) - dt);
      u.clangSndCd = Math.max(0, (u.clangSndCd || 0) - dt);
      // the hull rocks back from a warhead and settles
      if (u.jolt) {
        u.jolt *= Math.max(0, 1 - dt * 7);
        if (Math.abs(u.jolt) < 0.05) u.jolt = 0;
      }
      u.combatT = Math.max(0, (u.combatT || 0) - dt);
      u.transT = Math.max(0, (u.transT || 0) - dt);

      // Stillness feeds concealment (see CONCEAL_SETTLE). Read from last frame's
      // moving flag, which is set further down this same loop — a frame of lag
      // is well under the settle time and invisible at any playback rate.
      u.stillT = u.moving ? 0 : Math.min(2, (u.stillT || 0) + dt);

      // Visibility is eased here rather than in the renderer so it advances once
      // per sim step instead of once per draw. Appearing is instant — a man who
      // breaks cover or opens fire is seen NOW — while slipping out of sight
      // dissolves, so the brush reads as swallowing him rather than deleting him.
      const seen = this.visibleToPlayer(u) || u.combatT > 0 || u.muzzleT > 0;
      if (u.visA == null) u.visA = seen ? 1 : 0;
      u.visA = seen ? 1 : Math.max(CONCEAL_FLOOR, u.visA - dt / CONCEAL_FADE);

      if (u.emergeT > 0) { u.emergeT -= dt; u.moving = false; continue; }

      const d = UNITS[u.key];

      // engineer: defuse enemy works ahead
      if (d.engineer) {
        const target = this._engineerTarget(u);
        if (target) {
          u.moving = false;
          target.obj.defuse += dt;
          if (Math.random() < dt * 6) this.fx.dirtKick(target.obj.x, groundY(map, u.lane, target.obj.x));
          if (target.obj.defuse >= target.need) {
            this._removeWork(target.obj);
            this.fx.floater(target.obj.x, u.y - 30, 'CLEARED', '#b5c98f');
            Sound.shovel(target.obj.x);
            this.emit(`ENGINEERS CLEARED ${target.kind.toUpperCase()} — LANE ${u.lane + 1}`, 'us');
          }
          continue;
        }
      }

      // sapper: charge and detonate
      if (d.sapper) {
        const foes = this._targetsFor(u.side, u.lane);
        let nearest = null, nd = 1e9;
        for (const f of foes) {
          const dist = Math.abs(f.x - u.x);
          if (dist < nd) { nd = dist; nearest = f; }
        }
        if (nearest && nd < 38) {
          this.fx.explosion(u.x, u.y - 6, 55, { shake: 5 });
          Sound.explosion(0.9, u.x);
          this._areaDamage(u.lane, u.x, 100, 65, u, 'vc');
          this.fx.addDecal(u.lane, u.x, 'crater', 16);
          this._kill(u, null, { gib: true });
          this.stats.vc.losses--; // died by own hand, don't double count against morale twice
          this.morale.vc += (u.cpShare || UNITS[u.key].cost) * MORALE_LOSS.vc * 0.5; // sacrifice expected, partial refund
          this.stats.vc.losses++;
          continue;
        }
      }

      // grenade wind-up and release
      if ((u.nadeT || 0) > 0) {
        u.nadeT -= dt;
        u.moving = false;
        if (!u.nadeThrown && u.nadeT <= 0.45) {
          u.nadeThrown = true;
          const tx = u.nadeTarget != null ? u.nadeTarget : u.x + u.dir * 90;
          const dist = tx - u.x;
          const T = 0.85;
          this.nades.push({
            x: u.x + u.dir * 8, y: u.y - 30 * LANE_DEPTH[u.lane],
            vx: dist / T, vy: -0.5 * 620 * T * 0.62, spin: 0,
            lane: u.lane, side: u.side, landed: false,
            smoke: !!u.nadeSmoke,
            // a smoke canister starts pouring the moment it stops rolling
            fuse: u.nadeSmoke ? 0.25 : GRENADE.fuse,
          });
          Sound.shovel(u.x);
        }
        if (u.nadeT <= 0) { u.nadeThrown = false; u.nadeTarget = null; u.nadeSmoke = false; }
        continue;
      }

      // snipers
      if (u.sniperUnit) {
        this._updateSniper(u, dt);
      } else {
        u.fireT -= dt;
        // squads breaking for cover or repositioning hold their fire and run
        const rushing = (u.crossT || 0) > 0 ||
          (u.squad && (u.squad.order === 'tocover' || u.squad.order === 'moveto'));
        const t = !rushing && d.rof > 0 ? this._acquire(u) : null;
        if (t) {
          u.moving = false;
          u.combatT = Math.max(u.combatT, 0.4);
          if (u.fireT <= 0) this._fire(u, t);
        } else {
          this._advance(u, d, dt);
        }
      }

      // trap trigger
      if (u.side === 'us' && u.deadT == null) {
        for (const t of this.traps) {
          if (t.lane !== u.lane || Math.abs(t.x - u.x) > 14) continue;
          this.traps.splice(this.traps.indexOf(t), 1);
          if (t.type === 'punji') {
            Sound.trapSpring(u.x);
            this.fx.floater(u.x, u.y - 40, 'PUNJI PIT', '#e08767', true);
            this.fx.blood(u.x, u.y, 1);
            this.fx.addDecal(u.lane, u.x, 'blood', 5);
            u.slowT = 3;
            this._damage(u, 26, { side: 'vc' });
            this.hiddenLoss[u.lane]++;
          } else {
            Sound.explosion(0.7, t.x);
            this.fx.explosion(t.x, u.y, 46, { shake: 4 });
            this.fx.addDecal(u.lane, t.x, 'crater', 12);
            this._areaDamage(u.lane, t.x, 75, 46, { side: 'vc' }, 'vc');
            this.hiddenLoss[u.lane]++;
          }
          if (this.player === 'us') this.emit(`TROOPS IN CONTACT — BOOBY TRAP LANE ${u.lane + 1}`, 'vc');
          break;
        }
      }

      // breakthrough
      if (u.deadT == null) {
        const goal = u.side === 'us' ? WORLD_W - 42 : 42;
        if ((u.side === 'us' && u.x >= goal) || (u.side === 'vc' && u.x <= goal)) {
          const dmg = (u.cpShare || UNITS[u.key].cost) * (UNITS[u.key].sapper ? 0.9 : 0.45);
          this.morale[other(u.side)] -= dmg;
          this.fx.floater(u.x, u.y - 40, 'BREAKTHROUGH', u.side === 'us' ? '#b5c98f' : '#e08767', true);
          this.fx.explosion(u.x, u.y - 8, 40, { shake: 4 });
          Sound.explosion(0.6, u.x);
          this.emit(`LINE OVERRUN — LANE ${u.lane + 1}`, u.side);
          u.deadT = 99; u.baked = true; // gone through the line, not a casualty
          this.units.splice(i, 1);
        }
      }
    }
  }

  _advance(u, d, dt) {
    // men hold formation slots on their squad anchor (compressed inside cover)
    const s = u.squad;
    let tx;
    if (!s) {
      tx = u.hold ? u.holdX : u.x + u.dir * 1000;
    } else if (s.inCover && s.cover) {
      const alive = this.squadAlive(s);
      const idx = alive.indexOf(u);
      // Spacing is set by how wide a man actually draws, and the 3D sprites are
      // far wider than the cut-outs they replaced — a levelled rifle is ~40px on
      // its own, and a prone man is ~55px long. At the old 12px a fire team in
      // cover collapsed into a single unreadable blob.
      const prone = u.pose === 'prone';
      const want = prone ? 52 : 38;
      const floor = prone ? 40 : 28;   // a prone man is ~55px long, not ~26
      /* Each squad gets its own stretch of the position.
       *
       * Cover holds up to three squads now, and every one of them centred on
       * `cover.x` — so two squads sharing a trench drew as one squad with
       * double-thick men. Crowding you cannot see is not a decision you can
       * time. They still overlap at three, because three squads in one trench
       * ARE overlapping; what matters is that you can tell there are three. */
      const oc = s.cover.occ.length || 1;
      const oi = Math.max(0, s.cover.occ.indexOf(s));
      const share = s.cover.w / oc;
      /* 0.6 of a full share, not a full one. At full spacing three squads in a
       * long trench spanned 190px against a 152px bank and the outside men
       * stood clear of it with their legs showing — crowded troops that do not
       * fit in the hole they are crowding. */
      const centre = s.cover.x + (oi - (oc - 1) / 2) * share * 0.6;
      const spread = Math.max(floor, Math.min(want, share / Math.max(2, alive.length)));
      tx = centre - s.dir * (idx - (alive.length - 1) / 2) * spread;
      /* Nobody stands outside the hole they are in.
       *
       * Spacing has a floor — men need room to draw — so two or three squads
       * sharing a position want more width than the position has, and the ones
       * on the outside ended up in the parapet's taper with their legs showing
       * below the bank. Clamping to the cover's own width makes them bunch up
       * at the ends instead, which is what crowding looks like anyway. */
      const half = s.cover.w / 2 - 6;
      tx = clamp(tx, s.cover.x - half, s.cover.x + half);
    } else {
      /* 34 was not enough room. A man is 84px tall and his levelled rifle is
       * about 40px wide on its own, so at 34px spacing every soldier overlapped
       * the next one's weapon — measured 10th-percentile gap between adjacent
       * men in a lane was 14px, and a zoomed contact showed a ten-man squad as
       * a single stack of bodies rather than a firing line. A firefight cannot
       * read if you cannot count the men in it. */
      /* CENTRED ON THE ANCHOR, AND INDEXED ON THE LIVING.
       *
       * This was `s.x - u.dir * u.slot * 50`, and `u.slot` is handed out once
       * at spawn (`m.slot = i`) and never revised as men die. Two things follow,
       * and the second one broke matches.
       *
       * The anchor is the MEAN of the living men. Slots laid out behind the
       * anchor have a mean that is not the anchor — half the squad's width
       * behind it — so `squadAnchor(s)` and `s.x` disagreed permanently, and
       * once the gap passed 90 the hard-sync below yanked the squad backwards
       * onto its own men, every tick, for every full-strength squad.
       *
       * Worse, when a squad is down to ONE man the anchor IS that man. The last
       * survivor of a five-man squad still held slot 4, so he wanted to stand
       * 200px off the anchor, walked there, dragged the anchor with him because
       * he was the anchor, and did it again — a positive feedback loop that
       * marched lone survivors clean off the map. Traced one to x=12091 in a
       * 2560-wide world, at which point it is out of everyone's range forever
       * and simply stops fighting. Squads accumulated in that state as matches
       * ran on, which is why the field went quiet towards the end.
       *
       * Centring on the live index makes mean(slots) exactly s.x, which is the
       * invariant the hard-sync assumes, and puts a lone man on the anchor
       * rather than 200px off it. It is what the in-cover branch above has
       * always done. */
      const alive = this.squadAlive(s);
      const idx = Math.max(0, alive.indexOf(u));
      tx = s.x - s.dir * (idx - (alive.length - 1) / 2) * 50;
    }
    const dx = tx - u.x;
    const marching = s && s._advancing; // the squad itself is on the move
    /* THE SETTLE DEAD-BAND. 2.5 px was written when slots were 34 px apart and
     * is far too tight now they are 50: a man had to land within 5% of his
     * spacing to be considered arrived, and the anchor shifts under him every
     * frame as the squad separates, so he chased it forever. Measured, 90% of
     * all man-frames were flagged MOVING, which forces the stance machine to
     * 'stand' — so the game's three postures almost never showed and every
     * firefight read as men marching on the spot.
     *
     * 9 px is under a fifth of a man's width, so nobody drifts visibly out of
     * formation, and it lets him actually arrive. */
    /* THE SETTLE DEAD-BAND IS BACK AT 2.5, and the story is worth keeping.
     *
     * It was raised to 9 on the theory that men were chasing a slot they could
     * never reach and so stayed permanently flagged `moving`, which forces the
     * stance machine to 'stand'. A single before/after run showed moving
     * dropping 90.3% -> 70.7% and it was committed on that basis.
     *
     * It is not true. A/B on twelve matched runs — six seeds across two maps —
     * says the dead-band does nothing at all:
     *
     *     base 2.5   moving 80.7%   fighting posture 9.3%
     *     base 9     moving 80.4%   fighting posture 8.1%
     *     base 16    moving 79.5%   fighting posture 8.6%
     *
     * All inside the noise, and a wider band that also suppressed adjustment
     * while in contact added nothing on top. So the change is reverted rather
     * than left in place looking load-bearing.
     *
     * Kneeling appearing at all was real, and it came from the stance PRIORITY
     * reorder — the front-rank prone rule used to sit above the kneel and
     * swallow it — not from this number.
     *
     * Men are moving ~80% of the time because squads genuinely cross a lot of
     * ground before they meet. That is a pacing question about how far a squad
     * advances before it halts, and it will not be solved by a threshold here.
     */
    if (Math.abs(dx) < 2.5 && !marching) {
      u.moving = false;
      u.spd = 0;
      return;
    }
    u.moving = true;
    let sp = d.speed;
    if (typeof Perks !== 'undefined' && Perks.on(this, u.side, 'scouts')) sp *= 1.18;
    if (u.suppressT > 0) sp *= 0.5;
    if (u.slowT > 0) sp *= 0.45;
    // weight: heavy gunners lumber up to speed, light troops spring
    const accel = d.mg ? 130 : d.small ? 330 : 230;
    // arrival ease-in: bleed speed off approaching the slot instead of stopping dead
    if (!marching) sp = Math.min(sp, Math.abs(dx) * 5 + 10);
    u.spd = u.spd < sp ? Math.min(sp, (u.spd || 0) + accel * dt) : sp;
    const step = Math.sign(dx) * Math.min(Math.abs(dx), u.spd * dt);
    u.x += step;
    // stride follows the feet — heavier men take shorter, heavier steps
    const stride = d.mg ? 0.30 : d.small ? 0.245 : 0.262;
    u.phase += Math.abs(step) * stride;
    // raw ground covered, so the renderer can size a gait cycle to the distance
    // actually travelled instead of to a constant baked in here
    u.dist = (u.dist || 0) + Math.abs(step);

    /* GAIT PHASE — the fix for animation cadence that varied 4.5x.
     *
     * The renderer used to derive the frame index as `dist / cycle`, where the
     * cycle was scaled by the unit's BASE speed. Distance accumulates at the
     * man's ACTUAL speed, so the two disagreed whenever he was not moving at
     * his base speed — which is always, when walking. Measured: walk played at
     * 7.3 fps for the sapper (base 56) and 12.7 for the sniper (base 30), a
     * 1.74x spread between units, against 31 fps running. A man breaking from
     * a walk into a run jumped 4.5x in cadence. That is the "mismatched fps".
     *
     * Sizing the cycle off CURRENT speed fixes both at once: every unit at a
     * given speed now shares one cadence, and the walk/run step drops to 1.8x,
     * which is what the difference between walking and running actually is.
     *
     * The exponent is the stride/cadence trade-off. At 1.0 the cycle is exactly
     * proportional to speed, cadence is dead constant and the feet slide when a
     * man accelerates. At 0 it is the old distance-locked behaviour with all of
     * the spread. 0.85 keeps cadence nearly flat while leaving enough distance
     * coupling that boots still read as gripping the ground.
     *
     * Accumulated INCREMENTALLY, and separately per gait, because that is what
     * lets the cycle length change without popping: `dist / cycle` jumps the
     * instant the divisor moves, but a phase that is only ever added to cannot.
     * Both are advanced every frame so switching clip never lands mid-stride on
     * a stale phase.
     *
     * Note there is no lane-depth scaling here, deliberately. The renderer used
     * `S3_TARGET_H * scale`, which made men in the far lane (depth 0.92) walk
     * 17% faster in cadence than men in the near lane. Cadence is a property of
     * the man, not of how far away he is. */
    const gp = Math.pow(Math.max(u.spd || 0, 6) / S3_REF_SPD, 0.85) * (u.gaitK || 1);
    const cycW = S3_TARGET_H * S3_WALK_CYCLE * gp;
    const cycR = S3_TARGET_H * S3_RUN_CYCLE * gp;
    u.phWalk = ((u.phWalk || 0) + Math.abs(step) / cycW) % 1;
    u.phRun = ((u.phRun || 0) + Math.abs(step) / cycR) % 1;

    /* Dust off the boots, emitted per STEP rather than per second, so it stays
     * locked to the stride at any speed. Half a gait cycle is one footfall. */
    const sc = LANE_DEPTH[u.lane] * (u.sj || 1);
    const stepLen = 84 * sc * 0.29 * (u.gaitK || 1);
    u.stepAcc = (u.stepAcc || 0) + Math.abs(step);
    if (u.stepAcc >= stepLen) {
      u.stepAcc -= stepLen;
      if (u.pose !== 'prone' && Camera.sees(u.x, 60)) {
        this.fx.footDust(u.x - u.dir * 4 * sc, u.y + 1, sc, u.dir);
      }
    }
  }

  _updateSniper(u, dt) {
    const d = UNITS[u.key];
    u.glintT -= dt;
    if (u.aiming) {
      const t = u.aimTarget;
      const valid = t && t.deadT == null && t.lane === u.lane && this.canSee(u.side, t) &&
        Math.abs(t.x - u.x) < d.range * 1.1 &&
        (!t.isHole || this.holes.includes(t)) &&
        (t.isHole || this.units.includes(t));
      if (!valid) {
        u.aiming = false; u.aimTarget = null; u.pose = null;
        return;
      }
      u.moving = false;
      u.pose = 'prone';
      u.combatT = Math.max(u.combatT, 0.4);
      // mutual aim = duel
      if (t.sniperUnit && t.aimTarget === u && !u.duelFlag) {
        u.duelFlag = t.duelFlag = true;
        this.setBanner('SNIPER DUEL', false);
        Sound.glintPing();
      }
      const elevAdv = elevAt(this.map, u.lane, u.x) - elevAt(this.map, t.lane, t.x);
      u.aimT += dt * (1 + 0.35 * clamp(elevAdv, -0.9, 0.9));
      if (u.glintT <= 0) {
        const scale = LANE_DEPTH[u.lane];
        this.fx.glint(u.x + u.dir * 12 * scale, u.y - 7 * scale);
        u.glintT = 0.45;
      }
      if (u.aimT >= u.aimTime) {
        const scale = LANE_DEPTH[u.lane];
        const mx = u.x + u.dir * 24 * scale, my = u.y - 6 * scale;
        Sound.sniperShot(mx);
        this.fx.muzzle(mx, my, u.dir, scale * 1.4);
        this.fx.tracer(mx, my, t.x, t.y - (t.isHole ? 2 : 14), '#fff0c8');
        if (t.isHole) this._damage(t, 80, u);
        else {
          this._damage(t, 999, u, { gib: Math.random() < 0.35 });
          this.fx.blood(t.x, t.y, 1.4);
          this.fx.addDecal(t.lane, t.x, 'blood', 5);
          if (t.sniperUnit && t.duelFlag) {
            this.setBanner('DUEL WON', false);
            this.fx.floater(u.x, u.y - 44, 'DUEL WON', '#ffd98a', true);
          }
        }
        u.aiming = false; u.aimTarget = null; u.pose = null;
        u.duelFlag = false;
        u.fireT = 3.5;
        if (u.side === 'vc' && UNITS[u.key].conceal) u.revealT = 6.5;
      }
      return;
    }
    u.pose = null;
    u.fireT -= dt;
    const t = this._acquire(u);
    if (t && u.fireT <= 0) {
      u.aiming = true;
      u.aimT = 0;
      u.aimTarget = t;
      u.moving = false;
    } else {
      this._advance(u, d, dt);
    }
  }

  _engineerTarget(u) {
    const works = [];
    for (const t of this.traps) if (t.side !== u.side && t.lane === u.lane) works.push({ obj: t, need: 1.6, kind: 'trap' });
    for (const tn of this.tunnels) if (tn.lane === u.lane) works.push({ obj: tn, need: 3, kind: 'tunnel' });
    for (const h of this.holes) if (h.lane === u.lane && (h.discovered || h.revealT > 0)) works.push({ obj: h, need: 2.2, kind: 'spider hole' });
    for (const w of works) {
      const dx = (w.obj.x - u.x) * u.dir;
      if (dx > -14 && dx < 62) return w;
    }
    return null;
  }

  _removeWork(obj) {
    let idx = this.traps.indexOf(obj);
    if (idx >= 0) { this.traps.splice(idx, 1); return; }
    idx = this.tunnels.indexOf(obj);
    if (idx >= 0) { this.tunnels.splice(idx, 1); return; }
    idx = this.holes.indexOf(obj);
    if (idx >= 0) this.holes.splice(idx, 1);
  }

  /* ---------- spider holes ---------- */
  _updateHoles(dt) {
    for (let i = this.holes.length - 1; i >= 0; i--) {
      const h = this.holes[i];
      h.cd -= dt;
      h.revealT = Math.max(0, h.revealT - dt);
      h.y = groundY(this.map, h.lane, h.x) - 5;
      if (h.cd > 0) continue;
      let best = null, nd = 1e9;
      for (const u of this.units) {
        if (u.side !== 'us' || u.deadT != null || u.lane !== h.lane) continue;
        const dist = Math.abs(u.x - h.x);
        if (dist < 300 && dist < nd) { nd = dist; best = u; }
      }
      if (best) {
        h.dirToTarget = Math.sign(best.x - h.x) || -1;
        Sound.sniperShot(h.x);
        this.fx.muzzle(h.x + h.dirToTarget * 10, h.y - 2, h.dirToTarget, 1);
        this.fx.tracer(h.x, h.y - 2, best.x, best.y - 14, '#fff0c8');
        this.fx.blood(best.x, best.y, 1);
        this._damage(best, 55, h);
        this.fx.floater(h.x, h.y - 26, 'AMBUSH!', '#e08767');
        h.revealT = 2.6;
        h.cd = 4.5;
        if (this.player === 'us') this.emit(`SNIPER FIRE — LANE ${h.lane + 1}`, 'vc');
      }
    }
  }

  /* ---------- strikes ---------- */
  _updateStrikes(dt) {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.age += dt;
      if (s.impacts) {
        for (const im of s.impacts) {
          if (!im.done && s.age >= im.t) {
            im.done = true;
            const y = groundY(this.map, s.lane, im.x);
            this.fx.explosion(im.x, y, im.r, {});
            this.fx.addDecal(s.lane, im.x, 'crater', im.r * 0.28);
            if (im.r >= 60) this.addCover(s.lane, im.x, 'crater'); // shellholes become cover
            Sound.explosion(s.type === 'arclight' ? 1.3 : 1, im.x);
            this.tryBirds(im.x);
            if (s.type === 'arclight') this.fx.flash = Math.max(this.fx.flash, 0.18);
            this._areaDamage(s.lane, im.x, im.r, im.dmg, { side: s.side }, s.side);
          }
        }
      }
      if (s.type === 'napalm' && !s.dropped && s.age >= s.dropT) {
        s.dropped = true;
        const y = groundY(this.map, s.lane, s.x);
        Sound.napalmWhoosh(s.x);
        this.fx.napalmBurst(s.x, y, 320);
        this.fx.addDecal(s.lane, s.x, 'scorch', 110);
        this.fires.push({ lane: s.lane, x0: s.x - 170, x1: s.x + 170, t: 0, dur: 7, dps: 24 });
        this._burnStrip(s.lane, s.x - 170, s.x + 170);
        this._areaDamage(s.lane, s.x, 175, 40, { side: s.side }, s.side);
      }
      if (s.type === 'medevac' && !s.healed && s.age >= 2.4) {
        s.healed = true;
        this.morale[s.side] = clamp(this.morale[s.side] + 14, 0, 100);
        this.fx.floater(Camera.x + CANVAS_W / 2, 200, 'WOUNDED EVACUATED  +14 MORALE', '#b5c98f', true);
      }
      if (s.type === 'aircav' && !s.dropped && s.age >= 3.0) {
        s.dropped = true;
        this.trySpawn(s.side, 'rifles', s.lane, { free: true, x: s.x - 12 });
        this.trySpawn(s.side, 'weapons', s.lane, { free: true, x: s.x + 18 });
        this.fx.smokePuff(s.x, groundY(this.map, s.lane, s.x) - 10);
      }
      if (s.age >= s.dur) this.strikes.splice(i, 1);
    }
  }

  _areaDamage(lane, x, r, dmg, killer, killerSide) {
    for (const u of this.units) {
      if (u.lane !== lane || u.deadT != null) continue;
      const dist = Math.abs(u.x - x);
      if (dist > r) continue;
      let k = 1 - 0.6 * (dist / r);
      if (u.squad && u.squad.inCover && u.squad.cover) {
        const c = u.squad.cover;
        if (c.dug) {
          /* A TRENCH DOES NOT SHELTER YOU FROM A SHELL. IT CONTAINS IT.
           *
           * Rifle fire cannot touch a dug-in squad — measured, 60-73% of the
           * damage removed, and a squad that loses 0/8 in the open wins 8/8
           * from the trench. Something has to answer that, or the position is
           * simply the winner of the lane, and the answer is the one every army
           * that met a trench line arrived at: you do not shoot men out of a
           * hole, you drop explosive into it.
           *
           * So blast is AMPLIFIED against a dug position rather than reduced.
           * The walls that stop bullets are the same walls that stop the blast
           * wave escaping, which is why a grenade in a trench is so much worse
           * than a grenade in a field. Grenades, artillery, napalm, satchels
           * and rockets all arrive through here, so all of them become the
           * antidote at once. */
          k *= COVER.DUG_BLAST;
        } else {
          // ordinary cover does shield you a little, even from blast
          k *= 1 - this.coverProt(c, u.squad) * 0.3;
        }
        /* And this is the other half of the crowding bargain. Two squads packed
         * into one trench are hard to shift with rifles and catastrophic to
         * catch with a single shell — which is exactly the choice the player is
         * being asked to time. */
        if (c.occ.length > 1) k *= 1 + COVER.CROWD_BLAST * (c.occ.length - 1);
      }
      // blast is `heavy`: armour is no defence against a satchel, mine or shell
      this._damage(u, dmg * k, { side: killerSide }, { gib: dmg * k >= 30, heavy: true });
      if (u.deadT == null) u.suppressT = Math.max(u.suppressT, 1);
      if (u.squad) {
        u.squad.pin += 0.5;
        u.squad.underFireT = Math.max(u.squad.underFireT, 2);
      }
    }
    for (let j = this.holes.length - 1; j >= 0; j--) {
      const h = this.holes[j];
      if (h.lane === lane && Math.abs(h.x - x) < r * 0.85) {
        h.hp -= dmg;
        if (h.hp <= 0) this._kill(h, killerSide);
      }
    }
    for (const st of this.structures) {
      if (st.lane === lane && Math.abs(st.x - x) < r * 0.9 + st.w / 2) {
        this._hurtStructure(st, dmg * 0.8, dmg >= 38);
      }
    }
    for (let j = this.traps.length - 1; j >= 0; j--) {
      const t = this.traps[j];
      if (t.lane === lane && Math.abs(t.x - x) < r * 0.7) this.traps.splice(j, 1);
    }
    for (let j = this.tunnels.length - 1; j >= 0; j--) {
      const tn = this.tunnels[j];
      if (tn.lane === lane && Math.abs(tn.x - x) < r * 0.7) {
        tn.hp -= dmg;
        if (tn.hp <= 0) {
          this.tunnels.splice(j, 1);
          this.fx.floater(tn.x, groundY(this.map, lane, tn.x) - 20, 'TUNNEL COLLAPSED', '#ffd98a');
        }
      }
    }
  }

  _burnStrip(lane, x0, x1) {
    let changed = false;
    for (const z of this.conceal[lane]) {
      if (z.burned) continue;
      const zx0 = z.x0 * WORLD_W, zx1 = z.x1 * WORLD_W;
      if (zx0 < x1 && zx1 > x0) { z.burned = true; changed = true; }
    }
    if (changed) {
      Renderer.markDirty(lane);
      this.emit(`COVER BURNED OFF — LANE ${lane + 1}`, 'us');
    }
  }

  _updateFires(dt) {
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      if (f.t > f.dur) { this.fires.splice(i, 1); continue; }
      if (Math.random() < dt * 26) this.fx.fireTick(f.x0, f.x1, f.lane, this.map);
      for (const u of this.units) {
        if (u.lane === f.lane && u.deadT == null && u.x > f.x0 && u.x < f.x1) {
          this._damage(u, f.dps * dt, { side: 'us' });
        }
      }
    }
  }

  /* ---------- structures ---------- */
  _hurtStructure(st, dmg, burn) {
    if (st.state >= 2) return;
    st.hp -= dmg;
    if (burn && st.kind !== 'bunker' && st.kind !== 'well') st.burnT = Math.max(st.burnT, 8);
    if (st.hp <= st.maxHp * 0.5 && st.state === 0) {
      st.state = 1;
      this.fx.smokePuff(st.x, groundY(this.map, st.lane, st.x) - 12);
    }
    if (st.hp <= 0) {
      st.state = 2;
      st.burnT = Math.min(st.burnT, 2.5);
      const y = groundY(this.map, st.lane, st.x);
      this.fx.explosion(st.x, y - 6, 30, { shake: 2 });
      this.fx.addDecal(st.lane, st.x, 'scorch', st.w * 0.5);
      Sound.explosion(0.45, st.x);
      if (st.kind === 'bunker') this.emit(`BUNKER DESTROYED — LANE ${st.lane + 1}`, 'sys');
      // a levelled building is a fighting position — towns become cover
      const deco = ['well', 'hay', 'banana', 'cart', 'shrine', 'stall'];
      if (!deco.includes(st.kind)) this.addCover(st.lane, st.x, 'rubble');
      // a destroyed emplacement takes its strongpoint with it
      for (const laneCovers of this.covers) {
        const ci = laneCovers.findIndex(c => c.structRef === st);
        if (ci >= 0) {
          const c = laneCovers[ci];
          for (const s of c.occ.slice()) {
            this.coverLeave(s);
            s.order = 'advance';
            s.pin += 0.5; s.underFireT = 2;
          }
          laneCovers.splice(ci, 1);
          this.emit(`STRONGPOINT DESTROYED — LANE ${st.lane + 1}`, 'sys');
        }
      }
    }
  }

  _updateStructures(dt) {
    for (const st of this.structures) {
      if (st.burnT > 0) {
        st.burnT -= dt;
        st.fireHurt += dt;
        if (st.fireHurt > 0.5) {
          st.fireHurt = 0;
          this._hurtStructure(st, 6, false);
        }
        if (Math.random() < dt * 5) {
          const y = groundY(this.map, st.lane, st.x);
          this.fx.fireTick(st.x - st.w / 2, st.x + st.w / 2, st.lane, this.map);
          if (Math.random() < 0.5) this.fx.smokePuff(st.x + rand(-st.w / 3, st.w / 3), y - rand(14, 26));
        }
      }
      // standing fires ignite what they touch
      if (st.state < 2 && st.burnT <= 0) {
        for (const f of this.fires) {
          if (f.lane === st.lane && st.x > f.x0 - 12 && st.x < f.x1 + 12) st.burnT = 8;
        }
      }
    }
  }

  /* ---------- ambient life ---------- */
  /* HOW BAD IS IT RIGHT NOW.
   *
   * Drives the music bed (Sound.musicTension). Built from the three things a
   * player would actually name if asked how the battle is going, rather than
   * from a single counter:
   *
   *   contact   how many men are firing, which is the immediate texture
   *   pressure  how close the nearest enemy is to a flag we hold
   *   losses    recent casualties, so a bad minute keeps its weight for a while
   *
   * Smoothed hard on the way up and harder on the way down: music that tracks
   * a frame-by-frame count pumps, and the whole point of the layer is that it
   * arrives and recedes rather than switching.
   */
  _musicTension(dt) {
    if (typeof Sound === 'undefined' || !Sound.musicTension) return;
    let firing = 0, live = 0;
    for (const u of this.units) {
      if (u.deadT != null) continue;
      live++;
      if ((u.combatT || 0) > 0) firing++;
    }
    const contact = live ? clamp(firing / Math.max(6, live * 0.5), 0, 1) : 0;
    let near = 1;
    for (const f of this.flags) {
      for (const s2 of this.squads) {
        if (!this.squadAlive(s2).length) continue;
        if (f.owner && s2.side === f.owner) continue;
        near = Math.min(near, clamp(Math.abs(this.squadAnchor(s2) - f.x) / 700, 0, 1));
      }
    }
    const pressure = 1 - near;
    this._lossT = Math.max(0, (this._lossT || 0) - dt * 0.12);
    const target = clamp(contact * 0.55 + pressure * 0.3 + Math.min(1, this._lossT) * 0.3, 0, 1);
    const cur = this._musT || 0;
    // up in about a second, down over roughly eight
    const k = target > cur ? Math.min(1, dt * 1.1) : Math.min(1, dt * 0.13);
    this._musT = cur + (target - cur) * k;
    Sound.musicTension(this._musT);
  }

  _ambient(dt) {
    // birds scatter from the treeline when fighting is close
    this.birdT -= dt;
    // background smoke columns beyond the ridge
    for (const s of this.smokeSrc) {
      s.t -= dt;
      if (s.t <= 0) {
        s.t = rand(0.5, 1.1);
        this.fx.add({
          x: s.x + rand(-6, 6), y: 342, vx: rand(-4, 4), vy: rand(-14, -8), g: -2,
          t: 0, life: rand(3.5, 6), size: rand(9, 16), color: 'dark', type: 'smoke', drag: 0.3,
        });
      }
    }
    // an occasional patrol flight crossing the AO
    this.patrolT -= dt;
    if (this.patrolT <= 0) {
      this.patrolT = rand(55, 95);
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.strikes.push({
        type: 'patrol', age: 0, dur: (WORLD_W + 400) / 170,
        x: dir > 0 ? -180 : WORLD_W + 180, dirX: dir, y: rand(80, 140), heard: false,
      });
    }
  }

  tryBirds(x) {
    if (this.birdT > 0 || this.map.treeDensity < 0.3) return;
    this.birdT = rand(9, 18);
    this.fx.birds(x + rand(-60, 60), LANE_BASE[0] - rand(60, 110));
  }

  /* ---------- flags ---------- */
  _updateFlags(dt) {
    for (const f of this.flags) {
      let usN = 0, vcN = 0;
      for (const u of this.units) {
        if (u.lane !== f.lane || u.deadT != null) continue;
        if (Math.abs(u.x - f.x) < 100) u.side === 'us' ? usN++ : vcN++;
      }
      const side = usN > 0 && vcN === 0 ? 'us' : vcN > 0 && usN === 0 ? 'vc' : null;
      if (side && f.owner !== side) {
        if (f.capSide !== side) { f.capSide = side; f.cap = 0; }
        f.cap += dt * 0.3;
        if (f.cap >= 1) {
          f.owner = side;
          f.cap = 0; f.capSide = null;
          Sound.radio();
          this.fx.floater(f.x, groundY(this.map, f.lane, f.x) - 50, 'FLAG SECURED', side === 'us' ? '#b5c98f' : '#e08767', true);
          this.emit(`OBJECTIVE ${side === 'us' ? 'SECURED BY US' : 'TAKEN BY VC'} — LANE ${f.lane + 1}`, side);
        }
      } else if (!side) {
        f.cap = Math.max(0, f.cap - dt * 0.25);
        if (f.cap === 0) f.capSide = null;
      }
    }
  }

  /* ---------- AI ---------- */
  _lanePower(side, lane) {
    let p = 0;
    for (const u of this.units) {
      if (u.side === side && u.lane === lane && u.deadT == null) p += u.cpShare || UNITS[u.key].cost;
    }
    if (side === 'vc') for (const h of this.holes) if (h.lane === lane) p += 20;
    return p;
  }

  _aiUpdate(dt) {
    this.aiT -= dt;
    if (this.aiT > 0 || this.over) return;
    this.aiT = this.diff.aiInterval * rand(0.7, 1.3);
    if (Math.random() < this.diff.mistake) return;

    const side = this.aiSide, foe = other(side);
    const cp = this.cp[side];
    const powers = LANES.map(l => ({
      lane: l,
      mine: this._lanePower(side, l),
      theirs: this._lanePower(foe, l),
    }));
    powers.sort((a, b) => (b.theirs - b.mine) - (a.theirs - a.mine));
    const hot = powers[0];
    const weak = powers[powers.length - 1];

    if (side === 'us') this._aiUS(cp, hot, weak);
    else this._aiVC(cp, hot, weak);

    // spawn decision
    const laneToSpawn = hot.theirs > hot.mine * 1.1 ? hot.lane
      : this.flags.find(f => f.owner !== side) ? this.flags.find(f => f.owner !== side).lane
      : weak.lane;
    const key = this._aiPickUnit(side, laneToSpawn);
    if (key) this.trySpawn(side, key, laneToSpawn);

    // squad abilities: grenade dug-in enemies, suppress massed ones
    for (const s of this.squads) {
      if (s.side !== side || !this.squadAlive(s).length) continue;
      const sd = SQUADS[s.key];
      if (sd.grenades && (s.nadeCd || 0) <= 0) {
        for (const o of this.squads) {
          if (o.side === side || o.lane !== s.lane || !o.inCover) continue;
          if (!this.squadAlive(o).length) continue;
          if (Math.abs(this.squadAnchor(o) - s.x) < GRENADE.range && Math.random() < 0.55) {
            this._squadGrenade(s);
            break;
          }
        }
      }
      /* The AI opens with HE on anything dug in. A trench is immune to its
       * rifles, so a weapons team that has a blooper and does not use it on one
       * is just standing there losing. */
      if (sd.blooper && (s.bloopCd || 0) <= 0) {
        const dugFoe = this.squads.some(o => o.side !== side && o.lane === s.lane &&
          this.squadAlive(o).length && o.cover && o.cover.dug &&
          Math.abs(this.squadAnchor(o) - s.x) < M79.range);
        const massed = this.squads.filter(o => o.side !== side && o.lane === s.lane &&
          this.squadAlive(o).length &&
          Math.abs(this.squadAnchor(o) - s.x) < M79.range).length >= 2;
        if (dugFoe || massed) this._squadBlooper(s);
      }
      if (sd.suppressive && (s.suppCd || 0) <= 0) {
        const close = this.squads.filter(o => o.side !== side && o.lane === s.lane &&
          this.squadAlive(o).length && Math.abs(this.squadAnchor(o) - s.x) < 270);
        if (close.length >= 2) this._squadSuppress(s);
      }

      /* CONCENTRATE ON WHAT IS ALREADY HURT.
       *
       * The AI had every tactical tool the player has and used two of them. It
       * fired the way an untrained squad does — every man for himself — so its
       * damage spread across a line and wounded three squads instead of
       * removing one. Finishing a squad is worth far more than hurting several,
       * because a dead squad stops shooting back. */
      if (!s.focus || !this.squadAlive(s.focus).length) {
        let pick = null, bestScore = -1e9;
        for (const o of this.squads) {
          if (o.side === side || o.lane !== s.lane) continue;
          const men = this.squadAlive(o);
          if (!men.length) continue;
          const dist = Math.abs(this.squadAnchor(o) - s.x);
          if (dist > 340) continue;
          if (!men.some(m => this.canSee(side, m))) continue;
          const full = (SQUADS[o.key] && SQUADS[o.key].comp.length) || men.length;
          const hurt = 1 - men.length / full;
          const score = hurt * 420 - dist;
          if (score > bestScore) { bestScore = score; pick = o; }
        }
        if (pick) s.focus = pick;
      }

      /* A MAULED SQUAD PULLS BACK instead of feeding itself in.
       *
       * Squads advanced until they were dead, which reads as stupid rather than
       * aggressive and hands the player free kills. Below a third strength and
       * under fire, they go to ground behind the nearest cover.
       *
       * `playerHeld` is cleared afterwards: orderSquad sets it to mean "a human
       * chose this", and leaving it set on an AI squad would freeze it out of
       * its own advance logic for the rest of the match. */
      const full = (sd.comp && sd.comp.length) || 1;
      const left = this.squadAlive(s).length;
      if (left && left / full <= 0.34 && !s.ceding &&
          (s.underFireT || 0) > 0 && Math.random() < 0.4) {
        this.orderSquad(s, 'fallback');
        s.playerHeld = false;
      }

      /* FLANK: a squad standing in a lane it has already won is worth more in
       * the lane that is losing.
       *
       * Without this the AI can win one lane decisively, lose the other, and
       * lose the match — because it has no way to move the surplus. It only
       * crosses when the sums are clear both ways (comfortably ahead here,
       * clearly behind there), and never out of cover it is holding, so it does
       * not wander out of a good position for a marginal gain. */
      if (LANE_N > 1 && (s.crossT || 0) <= 0 && !s.inCover && left) {
        const oLane = s.lane === 0 ? 1 : 0;
        const here = this._lanePower(side, s.lane), hereFoe = this._lanePower(foe, s.lane);
        const there = this._lanePower(side, oLane), thereFoe = this._lanePower(foe, oLane);
        if (here > hereFoe * 1.6 && thereFoe > there * 1.25 && Math.random() < 0.22) {
          this.orderSquad(s, 'crosslane');
          s.playerHeld = false;
        }
      }
    }
  }

  _visibleFoesIn(lane, forSide) {
    const out = [];
    for (const u of this.units) {
      if (u.side !== forSide && u.deadT == null && u.lane === lane && this.canSee(forSide, u)) out.push(u);
    }
    return out;
  }

  _aiUS(cp, hot, weak) {
    const side = 'us';
    // artillery / arclight on clusters
    for (const l of LANES) {
      const foes = this._visibleFoesIn(l, side);
      if (foes.length >= 3 && cp >= CALLINS.arty.cost && (this.cool[side].arty || 0) <= 0) {
        const cx = foes.reduce((s, u) => s + u.x, 0) / foes.length;
        const cluster = foes.filter(u => Math.abs(u.x - cx) < 150);
        if (cluster.length >= 3) { this.tryCallin(side, 'arty', l, cx); return; }
      }
      if (foes.length >= 6 && cp >= CALLINS.arclight.cost && (this.cool[side].arclight || 0) <= 0) {
        const cx = foes.reduce((s, u) => s + u.x, 0) / foes.length;
        this.tryCallin(side, 'arclight', l, cx);
        return;
      }
    }
    // napalm where hidden threats hurt us
    let worst = 0, worstLane = -1;
    for (const l of LANES) if (this.hiddenLoss[l] > worst) { worst = this.hiddenLoss[l]; worstLane = l; }
    if (worst >= 2 && cp >= CALLINS.napalm.cost && (this.cool[side].napalm || 0) <= 0) {
      const zone = this.conceal[worstLane].find(z => !z.burned);
      if (zone) {
        this.hiddenLoss[worstLane] = 0;
        this.tryCallin(side, 'napalm', worstLane, ((zone.x0 + zone.x1) / 2) * WORLD_W);
        return;
      }
    }
    if (this.morale.us < 58 && cp >= CALLINS.medevac.cost && (this.cool[side].medevac || 0) <= 0) {
      this.tryCallin(side, 'medevac', null, null);
      return;
    }
    const contested = this.flags.find(f => f.owner !== 'us');
    if (contested && cp >= CALLINS.aircav.cost + 40 && (this.cool[side].aircav || 0) <= 0 && this.time > 90) {
      this.tryCallin(side, 'aircav', contested.lane, clamp(contested.x - 80, WORLD_W * 0.1, WORLD_W * 0.9));
    }
  }

  _aiVC(cp, hot, weak) {
    const side = 'vc';
    // trap seeding ahead of the US advance
    if (cp >= 30 && (this.cool[side].punji || 0) <= 0 && Math.random() < 0.65) {
      // randi is INCLUSIVE at both ends, so the old randi(0, 2) kept returning
      // lane 2 after the drop to LANE_N = 2
      const lane = randi(0, LANE_N - 1);
      const front = this._usFront(lane);
      const x = clamp(front + rand(140, 420), WORLD_W * 0.1, WORLD_W * 0.9);
      this.tryCallin(side, 'punji', lane, x);
      return;
    }
    if (cp >= 45 && (this.cool[side].mine || 0) <= 0 && Math.random() < 0.4) {
      const lane = hot.lane;
      const front = this._usFront(lane);
      this.tryCallin(side, 'mine', lane, clamp(front + rand(160, 380), WORLD_W * 0.1, WORLD_W * 0.9));
      return;
    }
    if (cp >= CALLINS.spiderhole.cost + 20 && (this.cool[side].spiderhole || 0) <= 0 && this.holes.length < 4) {
      const lane = hot.lane;
      const front = this._usFront(lane);
      // bury on the highest ground ahead of their advance
      let bestX = 0, bestE = -1;
      for (let x = front + 180; x < WORLD_W * 0.9; x += 60) {
        const e = elevAt(this.map, lane, x);
        if (e > bestE) { bestE = e; bestX = x; }
      }
      if (bestX > 0) { this.tryCallin(side, 'spiderhole', lane, bestX); return; }
    }
    if (cp >= CALLINS.tunnel.cost + 30 && (this.cool[side].tunnel || 0) <= 0 && this.time > 100) {
      const lane = weak.lane;
      if (!this.tunnels.some(t => t.lane === lane)) {
        this.tryCallin(side, 'tunnel', lane, WORLD_W * rand(0.5, 0.62));
      }
    }
  }

  _usFront(lane) {
    let front = BASE_X.us;
    for (const u of this.units) {
      if (u.side === 'us' && u.deadT == null && u.lane === lane) front = Math.max(front, u.x);
    }
    return front;
  }

  _aiPickUnit(side, lane) {
    const cp = this.cp[side];
    const foes = this._visibleFoesIn(lane, side);
    const mySquads = this.squads.filter(s => s.side === side && this.squadAlive(s).length).length;
    if (mySquads >= MAX_SQUADS) return null;   // shared with the player, see MAX_SQUADS
    const foeSniper = foes.some(u => u.sniperUnit);
    const foeMg = foes.some(u => UNITS[u.key] && UNITS[u.key].mg);
    const cool = k => (this.cool[side][k] || 0) <= 0;
    const afford = k => cp >= SQUADS[k].cost;

    if (side === 'us') {
      if (this.hiddenLoss[lane] >= 1 && cool('engineers') && afford('engineers') && Math.random() < 0.5) return 'engineers';
      if (foeSniper && cool('snipers') && afford('snipers')) return 'snipers';
      if (foes.length >= 3 && cool('weapons') && afford('weapons')) return 'weapons';
      if (this.map.id !== 'iadrang' && cool('lrrp') && afford('lrrp') && Math.random() < 0.3) return 'lrrp';
      if (cool('rifles') && afford('rifles')) return 'rifles';
      if (cool('arvnsq') && afford('arvnsq')) return 'arvnsq';
    } else {
      const foeArmour = foes.some(u => UNITS[u.key] && UNITS[u.key].armour);
      if (foeArmour && cool('rpgteam') && afford('rpgteam')) return 'rpgteam';
      if (foeSniper && cool('marksmanu') && afford('marksmanu')) return 'marksmanu';
      if (foeMg && cool('sapperu') && afford('sapperu') && Math.random() < 0.6) return 'sapperu';
      if (foes.length >= 3 && cool('rpdteam') && afford('rpdteam')) return 'rpdteam';
      if (cool('nvasq') && afford('nvasq') && Math.random() < 0.5) return 'nvasq';
      if (cool('cell') && afford('cell')) return 'cell';
      if (cool('nvasq') && afford('nvasq')) return 'nvasq';
    }
    return null;
  }

  objectiveText() {
    if (this.mode === 'siege') {
      const left = Math.max(0, this.timeLimit - this.time);
      const m = Math.floor(left / 60), s = Math.floor(left % 60);
      return `SIEGE — RELIEF IN ${m}:${s.toString().padStart(2, '0')}`;
    }
    if (this.mode === 'assault') {
      const left = Math.max(0, this.timeLimit - this.time);
      const m = Math.floor(left / 60), s = Math.floor(left % 60);
      return `ASSAULT — TAKE ALL FLAGS · ${m}:${s.toString().padStart(2, '0')}`;
    }
    return 'BREAK ENEMY MORALE';
  }
}
