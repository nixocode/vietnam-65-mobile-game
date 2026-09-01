'use strict';

const CANVAS_W = 1280, CANVAS_H = 720; // viewport
const WORLD_W = 2560;                  // battlefield width — scroll to see it all
// Vertical scale of the lane elevation profiles. At 96 a whole map moved a
// soldier about 30px — the ground read as flat. This gives real hills and
// terraces without touching any map's authored shape.
/* Seconds to drop to the ground or get back up.
 *
 * This lived as a bare 0.45 in three separate files — the sim that sets the
 * timer (game.js), the sprite path that reads it (sprite3d.js) and the vector
 * fallback (render.js). Three copies of one number is three chances to change
 * two of them. Shortened to 0.28 because the old value read as a man lowering
 * himself thoughtfully under fire; going to ground is faster than that.
 */
const STANCE_TRANS = 0.28;

/* How long the ANIMATION keeps believing a man is moving after the sim says he
 * stopped.
 *
 * `u.moving` is a per-frame intent flag and it flickers hard: measured, a third
 * of its state runs last under 6 frames (100 ms) and the worst man toggles it
 * 114 times a minute. Because `pose` is derived from it, and clip selection
 * from `pose`, that flicker was reaching the screen as a clip change every 0.7s
 * on the worst men — faster than the 0.18s cross-fade can resolve, which is
 * exactly what reads as jank. Sequences like `prone>idle2 idle2>prone` over and
 * over came straight from it.
 *
 * The sim keeps its twitchy flag; the renderer gets a debounced one. 0.16s is
 * long enough to swallow the sub-100ms runs and short enough that a man who
 * genuinely halts still settles promptly. */
/* How long a man keeps his LOCOMOTION look after his feet stop.
 *
 * Tried at 0.45 to damp clip chatter and REVERTED: measured on identical sim
 * runs across four seeds, raising this alongside S3_CLIP_HOLD was worth nothing
 * that the clip hold did not already deliver (p90 31.73 vs 31.78 switches a
 * minute, short dwells 11.99% vs 12.15%). It is not free either — a man who has
 * genuinely halted keeps running on the spot for that long. Left at 0.16. */
const MOVE_HOLD = 0.16;


// Seconds a squad spends crossing between lanes. Long enough that the move is a
// commitment — out of cover, holding fire, unrecallable — and short enough that
// it stays a tactic rather than a punishment.
const CROSS_TIME = 1.9;

/* AMMUNITION, as a sustained-fire resource rather than a bullet count.
 *
 * The game already abstracts individual rounds into burst-and-pause cadence, so
 * counting magazines would be a second, contradictory abstraction. What was
 * actually missing is a LIMIT ON SUSTAINED FIRE: a squad could sit in cover and
 * shoot forever, which is why parking one was so often the right answer and why
 * covering fire had no opportunity cost.
 *
 * A squad carries what it carries. Firing draws it down, suppressive fire draws
 * it down fast (that is what a belt-fed gun burning a box actually does), and it
 * comes back only while the squad is NOT shooting — resupply from the rear. Low
 * ammo slows the rate of fire rather than stopping it, so a dry squad is
 * degraded and still dangerous instead of a spectator.
 *
 * ~220 shots of normal fire before a squad is dry, and ~26s of quiet to refill.
 * Tuned so a firefight is decided long before ammo is, and ammo only bites on
 * the squad that has been shooting all match.
 */
const AMMO_PER_SHOT = 1 / 220;
const AMMO_SUPP_MULT = 3.2;      // suppressive fire eats a box
const AMMO_REGEN = 1 / 26;       // per second, only while not firing
const AMMO_LOW = 0.25;           // below this the rate of fire suffers

const ELEV_PX = 230;
// a little more air between the tiers, so raised ground reads as levels
/* HOW MANY LANES ARE IN PLAY.
 *
 * Dropped from three to two on the owner's call: the front lane's ground line
 * sat at y 664 of 720 — 92% of the way down the frame, with only 56px beneath
 * it — so the card bar covered it completely and you could not see the men
 * fighting there. The lane spacing told the same story: 132px between lanes 0
 * and 1, 144px between 1 and 2, then 56px of nothing. The front lane was never
 * given room.
 *
 * Everything lane-indexed derives from LANE_N, and map data still declares
 * three lanes — anything pinned to a lane at or beyond LANE_N is filtered out
 * on load (see Game._laneOK). So this is one number to put back to 3, not a
 * one-way removal, and the maps keep their third lane on disk in the meantime.
 */
const LANE_N = 2;
const LANES = Array.from({ length: LANE_N }, (_, i) => i);

/* Re-spaced for two lanes, and pulled UP so both clear the HUD. A standing man
 * is 84px, so his head is ~92px above the ground line at these depths: the
 * front lane now tops out around y 445 and his feet at 545, well clear of the
 * bottom ~18% of the frame that the card bar occupies. */
const LANE_BASE = [400, 545];
const LANE_DEPTH = [0.92, 1.08];
// click bands, split around the new lane positions and reaching the frame edges
const LANE_BANDS = [[280, 476], [476, 700]];
const BASE_X = { us: 52, vc: WORLD_W - 52 };

/* unit key → sliced sprite sheet (assets/manifest.js). Missing sheet = procedural. */
const UNIT_SPRITES = {
  rifleman: 'us_rifle', arvn: 'arvn', m60: 'us_m60', engineer: 'us_rifle',
  recon: 'us_sniper', sniper: 'us_sniper',
  guerrilla: 'vc_rifle', nva: 'vc_gunner', rpd: 'vc_gunner',
  sapper: 'vc_black', marksman: 'vc_sniper',
};

/* battlefield-dressing art sliced from the casualty sheet */
const DECAL_ART = {
  corpse_us: 'decal_extra0', corpse_vc: 'decal_extra1', hat: 'decal_extra2',
  wounded_a: 'decal_extra3', wounded_b: 'decal_extra4',
  stretcher: 'decal_extra5', sandbag_dead: 'decal_extra6',
};

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function rand(a, b) { return a + Math.random() * (b - a); }
function randi(a, b) { return Math.floor(rand(a, b + 1)); }
function other(side) { return side === 'us' ? 'vc' : 'us'; }
// deterministic per-map scenery placement
function seeded(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const FACTIONS = {
  us: { name: 'US / ARVN', doctrine: 'FIREPOWER DOCTRINE', color: '#8aa06b', bright: '#b5c98f' },
  vc: { name: 'VC / NVA', doctrine: 'GROUND DOCTRINE', color: '#c25b45', bright: '#e08767' },
};

const DIFFS = {
  recruit: { label: 'Recruit', aiIncome: 0.85, aiInterval: 2.4, playerIncome: 1.1, mistake: 0.3 },
  veteran: { label: 'Veteran', aiIncome: 1.05, aiInterval: 1.7, playerIncome: 1.0, mistake: 0.12 },
  elite:   { label: 'Elite',   aiIncome: 1.3,  aiInterval: 1.2, playerIncome: 1.0, mistake: 0.02 },
};

/* ---------------- Units ----------------
   hat: m1 | boonie | conical | pith | band | cap
   speed px/s, rof shots/s, range px, acc hit chance */
/* rof = rounds/sec INSIDE a burst; burst = [min,max] rounds; pause = [min,max] s
   between bursts. Accuracy is per round — most rounds miss, as they did. */
/* How close a unit WANTS to be before it stops advancing, as a fraction of its
 * weapon range.
 *
 * A squad used to halt the instant anything was `engaged`, which is true the
 * moment an enemy crosses the edge of maximum range. Both sides therefore
 * stopped at arm's length of their longest weapon and traded fire across the
 * gap. Measured on mekong: the closest two men ever came was 216px, the 0-80
 * and 80-160px bands contained ZERO man-frames, and at 320px+ — where most of
 * the match was spent — only 13% of men were firing at all. The close fight
 * never happened, and most of the time nobody was shooting.
 *
 * Now each class closes to a distance that suits its weapon. A rifle squad
 * pushes in; a machine gun sets up and stays back to shoot the riflemen in;
 * a sniper never closes at all; a sapper has to reach what he intends to blow
 * up. This is doctrine expressed as one number.
 */
const ENGAGE_AT = {
  rifle:  0.55,   // line infantry close to where their rifles actually bite
  mg:     0.85,   // support weapon: set up long, cover the advance
  sniper: 0.95,   // never closes — the whole point is reach
  at:     0.62,   // rocket needs a clear shot, not a duel
  sapper: 0.30,   // has to get to the target
  scout:  0.70,
};

function engageFrac(u) {
  if (u.sniper) return ENGAGE_AT.sniper;
  if (u.sapper) return ENGAGE_AT.sapper;
  if (u.at) return ENGAGE_AT.at;
  if (u.mg) return ENGAGE_AT.mg;
  if (u.detect) return ENGAGE_AT.scout;
  return ENGAGE_AT.rifle;
}

const UNITS = {
  rifleman: { snd: 'm16', side: 'us', name: 'Rifleman', sub: 'M16', cost: 10, cd: 4, hp: 55, dmg: 9, rof: 5, burst: [2, 4], pause: [0.9, 1.7], range: 320, speed: 42, acc: 0.4, hat: 'm1' },
  arvn:     { snd: 'm14', side: 'us', name: 'ARVN', sub: 'Light Inf.', cost: 7, cd: 2.5, hp: 40, dmg: 7, rof: 4.5, burst: [2, 3], pause: [1.0, 1.8], range: 280, speed: 46, acc: 0.33, hat: 'm1', small: true },
  m60:      { snd: 'mg', side: 'us', name: 'M60 Gunner', sub: 'MG', cost: 24, cd: 9, hp: 70, dmg: 6, rof: 9, burst: [6, 11], pause: [1.3, 2.2], range: 380, speed: 32, acc: 0.32, hat: 'm1', mg: true, suppress: true },
  engineer: { snd: 'm16', side: 'us', name: 'Engineer', sub: 'Demo', cost: 18, cd: 8, hp: 60, dmg: 8, rof: 4, burst: [1, 3], pause: [1.1, 1.9], range: 230, speed: 37, acc: 0.4, hat: 'm1', engineer: true, pack: true },
  recon:    { snd: 'm16', side: 'us', name: 'LRRP Recon', sub: 'Spotter', cost: 16, cd: 10, hp: 45, dmg: 8, rof: 4.5, burst: [2, 3], pause: [0.9, 1.6], range: 340, speed: 48, acc: 0.45, hat: 'boonie', detect: 325, antenna: true },
  /* The sniper is meant to be a threat you solve, not a rifleman with a scope.
   * One shot kills outright (dmg 999 is the sentinel), he reaches half the map,
   * and `farArmour` makes him very hard to answer at distance — see _damage.
   * The counterweight is unchanged: he is slow, fragile up close, expensive,
   * and takes 2.6s to lay each shot. */
  sniper:   { side: 'us', name: 'Scout Sniper', sub: 'M40', cost: 42, cd: 16, hp: 40, dmg: 999, rof: 0.3, range: 860, speed: 30, acc: 0.99, hat: 'boonie', sniper: true, aim: 2.6, farArmour: 0.82 },

  /* Vehicles.
     A vehicle is a unit like any other so it inherits targeting, cover, morale
     and damage for free — it just carries `vehicle: true`, which the renderer
     uses to draw a prop instead of a soldier, and which the sim uses to keep it
     off the ground (it never goes prone, dives, or takes a stance). Heavy armour
     against small arms, but a sapper's satchel or a mine kills it outright. */
  m113:     { snd: 'fifty', side: 'us', name: 'M113 APC', sub: '.50 cal', cost: 0, cd: 0, hp: 260, dmg: 8,
              rof: 7.5, burst: [6, 11], pause: [1.3, 2.1], range: 340, speed: 30, acc: 0.34,
              hat: null, mg: true, suppress: true, vehicle: true, prop: 'm113',
              armour: 0.34 },

  guerrilla:{ snd: 'sks', side: 'vc', name: 'Guerrilla', sub: 'Local Force', cost: 8, cd: 3, hp: 45, dmg: 8, rof: 5, burst: [2, 4], pause: [1.0, 1.9], range: 280, speed: 44, acc: 0.35, hat: 'conical', conceal: true, ambush: 1.6 },
  nva:      { snd: 'ak', side: 'vc', name: 'NVA Regular', sub: 'AK-47', cost: 14, cd: 4.5, hp: 60, dmg: 10, rof: 5.5, burst: [2, 5], pause: [0.9, 1.7], range: 310, speed: 40, acc: 0.4, hat: 'pith', conceal: true, ambush: 1.35 },
  rpd:      { snd: 'rpd', side: 'vc', name: 'RPD Gunner', sub: 'MG', cost: 22, cd: 9, hp: 65, dmg: 6, rof: 8.5, burst: [5, 9], pause: [1.4, 2.3], range: 360, speed: 33, acc: 0.3, hat: 'pith', mg: true, suppress: true },
  /* The VC answer to armour. Slow, short-legged and useless in a firefight, but
     its warhead ignores armour — without it the APC could only be killed by a
     sapper closing to satchel range, which is not a counter, it is a hope. */
  rpgman:   { side: 'vc', name: 'RPG Gunner', sub: 'B-40', cost: 0, cd: 0, hp: 48, dmg: 46,
              rof: 0.42, range: 260, speed: 36, acc: 0.55, hat: 'pith',
              conceal: true, ambush: 1, at: true, blast: 46 },

  sapper:   { snd: 'ak', side: 'vc', name: 'Sapper', sub: 'Satchel', cost: 20, cd: 10, hp: 55, dmg: 0, rof: 0, range: 38, speed: 56, acc: 1, hat: 'band', sapper: true, conceal: true, ambush: 1 },
  marksman: { side: 'vc', name: 'Marksman', sub: 'Mosin', cost: 36, cd: 15, hp: 38, dmg: 999, rof: 0.3, range: 780, speed: 31, acc: 0.98, hat: 'conical', sniper: true, aim: 2.9, conceal: true, ambush: 1, farArmour: 0.82 },
};

/* ---------------- Squads ----------------
   The deployable is a SQUAD (Warfare 1944 style); comp lists the men, each drawing
   his stats from UNITS. cost/cd are squad-level. */
const SQUADS = {
  rifles:    { side: 'us', role: 'line', name: 'Rifle Squad', sub: '4 men · M16', cost: 26, cd: 8,
               comp: ['rifleman', 'rifleman', 'rifleman', 'rifleman'], portrait: 'port_rifleman',
               grenades: true, ability: 'Frag Grenades — flush dug-in enemies' },
  arvnsq:    { side: 'us', role: 'line', name: 'ARVN Squad', sub: '3 men · Light', cost: 15, cd: 5.5,
               comp: ['arvn', 'arvn', 'arvn'], portrait: 'port_arvn',
               grenades: true, ability: 'Frag Grenades' },
  weapons:   { side: 'us', role: 'support', name: 'Weapons Team', sub: 'M60 + rifle', cost: 30, cd: 12,
               comp: ['m60', 'rifleman'], portrait: 'port_m60',
               suppressive: true, blooper: true, ability: 'M79 Blooper — HE at range · Suppressive Fire — pins a target squad' },
  engineers: { side: 'us', role: 'special', name: 'Engineer Team', sub: 'Demo ×2', cost: 24, cd: 10,
               comp: ['engineer', 'engineer'], portrait: 'port_engineer',
               ability: 'Clears traps, tunnels, spider holes' },
  lrrp:      { side: 'us', role: 'special', name: 'LRRP Team', sub: 'Recon ×2', cost: 22, cd: 11,
               comp: ['recon', 'rifleman'], portrait: 'port_recon',
               ability: 'Spots concealed enemies at range' },
  snipers:   { side: 'us', role: 'special', name: 'Sniper Team', sub: 'M40 + spotter', cost: 48, cd: 18,
               comp: ['sniper', 'recon'], portrait: 'port_sniper',
               ability: 'One shot, one kill · spotter marks' },

  apc:       { side: 'us', role: 'support', name: 'APC Section', sub: 'M113 · .50 cal', cost: 40, cd: 20,
               comp: ['m113'], portrait: 'port_rifleman',
               ability: 'Armour — shrugs off small arms, but sappers and mines kill it' },

  rpgteam:   { side: 'vc', role: 'support', name: 'RPG Team', sub: 'B-40 + rifle', cost: 26, cd: 12,
               comp: ['rpgman', 'nva'], portrait: 'port_nva',
               ability: 'Rocket — ignores armour, wrecks cover' },

  cell:      { side: 'vc', role: 'line', name: 'Guerrilla Cell', sub: '3 fighters', cost: 16, cd: 5.5,
               comp: ['guerrilla', 'guerrilla', 'guerrilla'], portrait: 'port_guerrilla',
               grenades: true, ability: 'Stick Grenades · ambush from brush' },
  nvasq:     { side: 'vc', role: 'line', name: 'NVA Squad', sub: '4 men · AK', cost: 30, cd: 9,
               comp: ['nva', 'nva', 'nva', 'nva'], portrait: 'port_nva',
               grenades: true, ability: 'Stick Grenades' },
  rpdteam:   { side: 'vc', role: 'support', name: 'RPD Team', sub: 'RPD + AK', cost: 28, cd: 12,
               comp: ['rpd', 'nva'], portrait: 'port_rpd',
               suppressive: true, ability: 'Suppressive Fire — pins a target squad' },
  sapperu:   { side: 'vc', role: 'special', name: 'Sapper', sub: 'Satchel', cost: 20, cd: 10,
               comp: ['sapper'], portrait: 'port_sapper',
               ability: 'Satchel charge — devastates positions' },
  marksmanu: { side: 'vc', role: 'special', name: 'Marksman', sub: 'Mosin', cost: 40, cd: 16,
               comp: ['marksman'], portrait: 'port_marksman',
               ability: 'One shot, one kill from concealment' },
};

const GRENADE = { range: 115, blast: 44, dmg: 34, fuse: 0.7, flight: 0.85, cd: 14 };

/* THE M79 — "the blooper".
 *
 * A break-action 40 mm grenade launcher, and the answer to a problem the cover
 * pass created: a dug-in squad now shrugs off rifle fire almost entirely and is
 * only broken by explosive, but the explosives available were a grenade you can
 * only throw 115px and artillery you have to pay CP for and wait on. There was
 * nothing in between — no infantry weapon that answers a trench.
 *
 * So its range is what matters: 260 lets a weapons team drop HE on a position
 * from outside the range at which the position would tear them apart, which is
 * exactly what the real thing was for. Bigger blast than a grenade, shorter
 * cooldown than artillery, no CP. */
const M79 = { range: 260, blast: 52, dmg: 28, flight: 1.05, cd: 13 };
/* dmg 28, not 40. Measured at 40 it took 222 of a 240 HP dug-in squad in a
 * single round — a squad wipe every eleven seconds from outside their reach,
 * which is not an answer to a position, it is a delete button, and it applied
 * just as well to troops in the open who were never the problem. At 28 it
 * still breaks a trench (the dug multiplier is doing that work) without
 * removing a squad in one shot anywhere else. */

/* Smoke. The bounding-advance rules already say a squad will not cross open
 * ground while a lane is being swept — smoke is the tool that changes that
 * answer. Popping it is the difference between being stuck and taking the
 * ground, which makes it a real decision rather than another damage button. */
const SMOKE = {
  range: 140, radius: 88, life: 13, build: 1.1, cd: 22, flight: 0.8,
};

/* Order matters: the HUD groups cards by `role` and lays the groups out in the
 * order they first appear here, so a roster must keep its roles contiguous.
 * `line` holds ground, `support` is the heavy weapons and the track, `special`
 * is recon, demolition and precision. */
const ROSTERS = {
  us: ['rifles', 'arvnsq', 'weapons', 'apc', 'engineers', 'lrrp', 'snipers'],
  vc: ['cell', 'nvasq', 'rpdteam', 'rpgteam', 'sapperu', 'marksmanu'],
};

const ROLE_LABEL = { line: 'LINE', support: 'SUPPORT', special: 'SPECIAL' };

/* ---------------- Call-ins / abilities ----------------
   target: 'point' needs lane+x click; 'none' fires immediately */
const CALLINS = {
  arty:     { side: 'us', name: 'Fire Mission', cost: 45, cd: 26, key: 'Q', target: 'point', icon: 'shell',
              hint: 'MARK TARGET FOR 105MM BATTERY' },
  napalm:   { side: 'us', name: 'Napalm', cost: 65, cd: 40, key: 'W', target: 'point', icon: 'flame',
              hint: 'MARK STRIP FOR AIR STRIKE — BURNS COVER' },
  medevac:  { side: 'us', name: 'Dustoff', cost: 30, cd: 36, key: 'E', target: 'none', icon: 'cross',
              hint: '' },
  aircav:   { side: 'us', name: 'Air Cav', cost: 55, cd: 48, key: 'R', target: 'point', icon: 'huey',
              hint: 'MARK LZ FOR HELICOPTER INSERTION' },
  arclight: { side: 'us', name: 'Arc Light', cost: 130, cd: 120, key: 'T', target: 'point', icon: 'b52',
              hint: 'MARK GRID FOR B-52 STRIKE' },

  punji:    { side: 'vc', name: 'Punji Pit', cost: 12, cd: 9, key: 'Q', target: 'point', icon: 'spikes',
              hint: 'PLACE HIDDEN PUNJI STAKES' },
  mine:     { side: 'vc', name: 'Tripwire', cost: 18, cd: 13, key: 'W', target: 'point', icon: 'mine',
              hint: 'PLACE TRIPWIRE CHARGE' },
  spiderhole:{ side: 'vc', name: 'Spider Hole', cost: 34, cd: 28, key: 'E', target: 'point', icon: 'hole',
              hint: 'BURY A MARKSMAN IN AMBUSH' },
  tunnel:   { side: 'vc', name: 'Tunnel', cost: 45, cd: 55, key: 'R', target: 'point', icon: 'tunnel',
              hint: 'DIG FORWARD EXIT — TROOPS EMERGE HERE' },
};

const CALLIN_ROSTERS = {
  us: ['arty', 'napalm', 'medevac', 'aircav', 'arclight'],
  vc: ['punji', 'mine', 'spiderhole', 'tunnel'],
};

/* ---------------- Maps ----------------
   lane pts: [normalized x, elevation 0..1]; conceal zones normalized [x0,x1]
   trees: grass | jungle | palm | shattered
   mode: standard | siege (vc attacks, timer favors us) | assault (us must take flags) */
const MAPS = {
  iadrang: {
    id: 'iadrang', name: 'IA DRANG VALLEY', year: 'NOVEMBER 1965', mode: 'standard',
    desc: 'Open rolling grassland in the Central Highlands. First major clash of US air cavalry and NVA regulars.',
    trees: 'grass', treeDensity: 0.35, seed: 11965,
    weather: {},
    pal: {
      skyTop: '#f6d7a0', skyBot: '#e8a35e', sun: { x: 1020, y: 130, r: 46, color: '#fff3d0' },
      /* Golden elephant grass needs something cool to sit against or the whole
       * valley is one amber wash (it was: 43 degree spread). The Chu Pong massif
       * goes blue-grey with distance, which is both what haze actually does to a
       * far ridge and the contrast the foreground was missing. Spread 195. */
      hillFar: '#8c93a8', hillNear: '#8f6a42',
     /* THE CHU PONG MASSIF. Not scenery — the reason there was a battle here:
      * two NVA regiments came down off it into a clearing, and LZ X-Ray sits at
      * its foot. Wide, tall enough to run past the top of the ridge band, and
      * set left of centre so the sun (x 1020) lights its near shoulder and
      * throws the far one into shadow. */
     massif: { x: 0.34, w: 1750, h: 340, baseY: 348, alpha: 0.95 },
      laneTop: ['#a8954f', '#9c8a46', '#8f7c3e'], laneBody: ['#7d6c38', '#726231', '#67582b'],
      brush: '#5f7a38', tree: '#44502c', haze: 'rgba(240,195,130,0.13)',
    },
    lanes: [
      { pts: [[0, .18], [.2, .32], [.45, .16], [.7, .34], [1, .22]], conceal: [[.52, .68]] },
      { pts: [[0, .12], [.3, .24], [.55, .1], [.8, .28], [1, .18]], conceal: [[.58, .76]] },
      { pts: [[0, .08], [.25, .2], [.5, .07], [.75, .22], [1, .12]], conceal: [[.46, .6]] },
    ],
    flags: [.5, .5, .5],
    settlements: [
      { lane: 1, x: .36, kind: 'hamlet' },
      { lane: 2, x: .66, kind: 'hamlet' },
    ],
  },

  cuchi: {
    id: 'cuchi', name: 'CU CHI DISTRICT', year: 'JANUARY 1966', mode: 'standard',
    desc: 'Dense jungle over a vast tunnel network northwest of Saigon. The ground itself is hostile.',
    trees: 'jungle', treeDensity: 1.0,
    // the ground here is dug through — see _tunnelMouth. Decoration, not
    // mechanics: the playable tunnels are the ones a VC player digs.
    dressing: 'tunnels', seed: 21966,
    weather: { fog: 0.35 },
    detectPenalty: 0.85,
    pal: {
      /* Cu Chi was a single hue — sky, hills, ground, brush and trees all green
       * across a 30 degree spread, which is why the map read as flat no matter
       * how much texture went into the terrain. The answer is the map's own
       * history: those tunnels were dug through RED LATERITE.
       *
       * But laterite belongs in `soil`, NOT in laneBody. laneBody is the entire
       * visible ground plane, so putting the clay there painted the whole map
       * red — one monochrome traded for another, reading like a quarry rather
       * than jungle floor. Real ground here is vegetated with the red earth
       * showing THROUGH it on paths, scours and bare patches, which is exactly
       * what the texture passes draw. Spread 125 either way, so the variety is
       * kept and the map stops looking like Mars. */
      skyTop: '#d6e4d0', skyBot: '#a8c49a', sun: { x: 640, y: 100, r: 60, color: 'rgba(255,255,240,0.7)' },
      hillFar: '#6e8478', hillNear: '#42603c',
      laneTop: ['#5a6b34', '#4f5f2d', '#455428'], laneBody: ['#54502a', '#4a4624', '#413d1f'],
      brush: '#3f652c', tree: '#243820', haze: 'rgba(200,225,195,0.12)',
      soil: '#7a4526',
    },
    lanes: [
      { pts: [[0, .1], [.3, .2], [.6, .1], [1, .16]], conceal: [[.22, .42], [.58, .84]] },
      { pts: [[0, .08], [.35, .16], [.7, .08], [1, .14]], conceal: [[.3, .5], [.64, .88]] },
      { pts: [[0, .06], [.4, .14], [.75, .06], [1, .1]], conceal: [[.2, .38], [.55, .78]] },
    ],
    flags: [.48, .52, .5],
    startCP: { vc: 25 },
    settlements: [
      { lane: 0, x: .3, kind: 'village' },
      { lane: 2, x: .58, kind: 'hamlet' },
      { lane: 1, x: .74, kind: 'hamlet' },
    ],
  },

  mekong: {
    id: 'mekong', name: 'MEKONG DELTA', year: 'JUNE 1967', mode: 'standard',
    desc: 'Rice paddies, canals and raised dikes at sunset. Close terrain where farmland and battlefield blur.',
    trees: 'palm', treeDensity: 0.55, seed: 31967,
    /* No mountains. The Mekong Delta is a floodplain — the highest thing in it
     * is a dike — and the horizon range drawn on every other map put a sierra
     * behind the rice fields. Ia Drang and Khe Sanh and Hill 937 are all
     * genuinely mountain country; this one is not, and the flat horizon is a
     * large part of what makes the delta look like the delta. */
    flatHorizon: true,
    weather: {},
    pal: {
      skyTop: '#f2a65e', skyBot: '#e4695a', sun: { x: 340, y: 170, r: 58, color: '#ffd9a8' },
      hillFar: '#a05c48', hillNear: '#7c4638',
      laneTop: ['#6d7a3a', '#637036', '#596631'], laneBody: ['#4d5626', '#454e22', '#3d451e'],
      brush: '#5c7030', tree: '#3a3524', haze: 'rgba(255,160,110,0.16)', water: '#d78a5e',
    },
    lanes: [
      { pts: [[0, .07], [.18, .17], [.34, .05], [.5, .16], [.66, .05], [.82, .17], [1, .08]], conceal: [[.28, .46], [.62, .8]] },
      { pts: [[0, .06], [.22, .16], [.4, .05], [.58, .15], [.74, .05], [.9, .16], [1, .07]], conceal: [[.34, .52], [.68, .84]] },
      { pts: [[0, .05], [.2, .14], [.38, .04], [.55, .14], [.72, .04], [.88, .14], [1, .06]], conceal: [[.24, .4], [.6, .76]] },
    ],
    flags: [.42, .58, .5],
    settlements: [
      { lane: 0, x: .34, kind: 'stilt' },
      { lane: 1, x: .57, kind: 'stilt' },
      { lane: 2, x: .27, kind: 'village' },
    ],
  },

  khesanh: {
    id: 'khesanh', name: 'KHE SANH', year: 'JANUARY 1968', mode: 'siege', siegeTime: 640,
    desc: 'A besieged Marine combat base on a red-earth plateau. The NVA press; the garrison holds and calls the sky.',
    trees: 'shattered', treeDensity: 0.5, seed: 41968, tod: 'night',
    /* The wire, the trench, the revetments and the airstrip. `mode: 'siege'`
     * described a besieged combat base and nothing in the frame had ever been
     * fortified — see _wireBelt / _trenchLine / _airstrip. */
    dressing: 'firebase',
    weather: { fog: 0.5 },
    detectPenalty: 0.8,
    pal: {
      /* Red mud plateau — correct, and it was the ONLY note being played (36
       * degrees). Highland jungle brings the green back, a grey ridge line
       * breaks the warm run, and the trees go to deep shadow so the map has a
       * true dark to anchor against. This one is fought at night, so the dark
       * end matters more here than anywhere else. Spread 80, luminance 55. */
      skyTop: '#d97a52', skyBot: '#eeb47a', sun: { x: 200, y: 150, r: 50, color: '#ffe0b0' },
      hillFar: '#6b6a70', hillNear: '#6b4234',
      laneTop: ['#8a5a3e', '#7d5138', '#704832'], laneBody: ['#5c3a28', '#533424', '#4a2e20'],
      brush: '#5c6b34', tree: '#26301f', haze: 'rgba(230,160,110,0.2)',
    },
    lanes: [
      { pts: [[0, .72], [.22, .58], [.45, .32], [.7, .2], [1, .16]], conceal: [[.55, .8]] },
      { pts: [[0, .68], [.25, .52], [.5, .28], [.75, .17], [1, .13]], conceal: [[.6, .85]] },
      { pts: [[0, .64], [.28, .48], [.52, .25], [.78, .15], [1, .11]], conceal: [[.5, .74]] },
    ],
    flags: [.3, .34, .32],
    preOwner: 'us',
    incomeMult: { vc: 1.25 },
    settlements: [
      { lane: 0, x: .09, kind: 'bunkers' },
      { lane: 1, x: .11, kind: 'bunkers' },
      { lane: 2, x: .1, kind: 'bunkers' },
      { lane: 1, x: .52, kind: 'hamlet', pre: 1 },
    ],
    prePlaced: [
      { kind: 'unit', key: 'weapons', side: 'us', lane: 0, x: 0.22, hold: true },
      { kind: 'unit', key: 'weapons', side: 'us', lane: 2, x: 0.24, hold: true },
      { kind: 'unit', key: 'rifles', side: 'us', lane: 1, x: 0.2, hold: true },
      { kind: 'unit', key: 'snipers', side: 'us', lane: 1, x: 0.12, hold: true },
    ],
  },

  hill937: {
    id: 'hill937', name: 'HILL 937', year: 'MAY 1969', mode: 'assault', assaultTime: 780,
    desc: '"Hamburger Hill." A steep, fortified ridge in the A Shau Valley under monsoon rain. The only way is up.',
    trees: 'shattered', treeDensity: 0.7, seed: 51969,
    weather: { rain: true, fog: 0.25 },
    detectPenalty: 0.85,
    pal: {
      /* Hue was never this map's problem (123 degrees) — VALUE was. Everything
       * sat mid-dark, a 45 point luminance range with no true light or true
       * dark, so an overcast hill read as mud-coloured soup. The cloud deck
       * lifts and the canopy drops to near-black. Range 45 -> 58. */
      skyTop: '#6a7a82', skyBot: '#b3c0bf', sun: { x: 900, y: 120, r: 70, color: 'rgba(230,235,235,0.35)' },
      hillFar: '#4a5a52', hillNear: '#3a4a40',
      /* The ground goes to MUD, and this is the one map where that belongs in
       * laneBody rather than in `soil`.
       *
       * Cu Chi's note is the opposite case and both are right: there, laterite
       * in laneBody painted the whole map red and traded one monochrome for
       * another, because jungle floor is vegetated with the clay showing
       * THROUGH. Hill 937 in May 1969 was not vegetated. Eleven assaults, ten
       * days of artillery and air, and monsoon rain on top had taken the ridge
       * down to bare churned earth and stumps — the frame was rendering deep
       * healthy grass over it. Here the mud IS the surface and the green is
       * what survived, which is why `brush` stays where it was: it is now the
       * only green in the frame, and it reads as leftovers. */
      laneTop: ['#6a5c3e', '#61543a', '#584c34'], laneBody: ['#4a3d28', '#433725', '#3c3121'],
      brush: '#495830', tree: '#232a24', haze: 'rgba(190,205,205,0.22)',
      /* THE HILL IS MUD. Ten days, eleven assaults, artillery and air between
       * each one, in the monsoon — by the time this map is set the ridge had
       * been stripped to bare churned earth and splintered stumps, which is
       * where the name came from. The frame was rendering deep healthy grass.
       * `soil` puts the churn into the patchwork pass, and `dressing: 'churned'`
       * lays the slides, the runnels and the water standing in the craters. */
      soil: '#7d5638',
    },
    dressing: 'churned',
    lanes: [
      { pts: [[0, .06], [.3, .18], [.55, .42], [.78, .68], [1, .88]], conceal: [[.4, .62]] },
      { pts: [[0, .05], [.32, .16], [.58, .4], [.8, .66], [1, .86]], conceal: [[.46, .68]] },
      { pts: [[0, .04], [.28, .14], [.55, .38], [.78, .62], [1, .82]], conceal: [[.36, .58]] },
    ],
    flags: [.68, .72, .7],
    preOwner: 'vc',
    settlements: [
      { lane: 0, x: .84, kind: 'bunkers', pre: 1 },
      { lane: 1, x: .87, kind: 'bunkers' },
      { lane: 2, x: .82, kind: 'bunkers' },
    ],
    prePlaced: [
      { kind: 'unit', key: 'nvasq', side: 'vc', lane: 0, x: 0.74, hold: true },
      { kind: 'unit', key: 'nvasq', side: 'vc', lane: 2, x: 0.76, hold: true },
      { kind: 'unit', key: 'rpdteam', side: 'vc', lane: 1, x: 0.78, hold: true },
      { kind: 'hole', side: 'vc', lane: 0, x: 0.82 },
      { kind: 'hole', side: 'vc', lane: 2, x: 0.84 },
      { kind: 'trap', type: 'punji', side: 'vc', lane: 1, x: 0.55 },
      { kind: 'trap', type: 'punji', side: 'vc', lane: 0, x: 0.5 },
      { kind: 'trap', type: 'mine', side: 'vc', lane: 2, x: 0.52 },
    ],
  },
};

const MAP_ORDER = ['iadrang', 'cuchi', 'mekong', 'khesanh', 'hill937'];

/* ---------------- Campaign ---------------- */
const CAMPAIGN = [
  {
    map: 'iadrang', side: 'us', diff: 'recruit', title: 'LZ X-RAY',
    meta: 'IA DRANG VALLEY · 14 NOVEMBER 1965 · PLAYING: US 1st CAVALRY',
    brief: 'The 1st Cavalry Division (Airmobile) has put four hundred men into a clearing at the foot of the Chu Pong massif — directly beneath two NVA regiments. This is the first battle where American troops arrive entirely by helicopter, and the first test of a simple question: can firepower and mobility beat numbers and terrain?\n\nHold the line. Use artillery early and often — it is the only reason a battalion survives against a division.',
    objectives: ['◆ Break enemy morale', '◆ Hold the lane flags to bleed their will to fight', '◆ Try each call-in: Fire Mission [Q], Napalm [W], Dustoff [E]'],
  },
  {
    map: 'cuchi', side: 'vc', diff: 'veteran', title: 'THE EARTH FIGHTS',
    meta: 'CU CHI DISTRICT · JANUARY 1966 · PLAYING: LOCAL FORCE VC',
    brief: 'Beneath this stretch of jungle northwest of Saigon run two hundred kilometers of hand-dug tunnels — hospitals, workshops, barracks, all underground. The Americans sweeping above have more of everything except one thing: they do not know where you are.\n\nYou have no artillery and no aircraft. You have the ground. Seed the lanes with punji pits before their point men arrive, keep your fighters in the brush, and make every meter cost them.',
    objectives: ['◆ Break enemy morale', '◆ Place traps ahead of their advance [Q]/[W]', '◆ Dig a tunnel [R] to reinforce forward without walking'],
  },
  {
    map: 'mekong', side: 'us', diff: 'veteran', title: 'BROWN WATER',
    meta: 'MEKONG DELTA · JUNE 1967 · PLAYING: US 9th INFANTRY',
    brief: 'The delta is a checkerboard of paddies and dikes where a rifle platoon can vanish twenty meters from the trail. Every treeline is a potential ambush; every dike is high ground worth exactly one squad of casualties.\n\nRecon is not optional here. Spot the ambush before you walk into it, then burn it out.',
    objectives: ['◆ Break enemy morale', '◆ Use LRRP recon to spot concealed enemies', '◆ Napalm burns away the brush they hide in'],
  },
  {
    map: 'khesanh', side: 'vc', diff: 'veteran', title: 'THE RING TIGHTENS',
    meta: 'KHE SANH COMBAT BASE · JANUARY 1968 · PLAYING: NVA 325C DIVISION',
    brief: 'Six thousand Marines sit on the plateau ahead, and the world is watching to see whether this becomes another Dien Bien Phu. It will not be easy: they are dug in on the high ground, and everything the American war machine can fly or fire is on call above them.\n\nYou have nine minutes of darkness and fog. Break the garrison\'s will before the weather lifts and their relief arrives.',
    objectives: ['◆ Break US morale before the timer expires', '◆ Their base sits uphill — mass your attacks, use tunnels', '◆ If time runs out, the siege fails'],
  },
  {
    map: 'hill937', side: 'us', diff: 'veteran', title: 'HAMBURGER HILL',
    meta: 'HILL 937, A SHAU VALLEY · MAY 1969 · PLAYING: US 101st AIRBORNE',
    brief: 'Ten days, eleven assaults, monsoon rain, and a ridge the men have started calling Hamburger Hill. The 29th NVA Regiment is dug into bunkers on the crest, and orders are to take it — a hill that everyone suspects will be abandoned a month after it falls.\n\nThis is the war at its most grinding. The enemy owns the high ground and every approach is registered. Climb.',
    objectives: ['◆ Capture ALL THREE lane flags — or break enemy morale', '◆ Enemy fires downhill: expect losses', '◆ If the timer expires, the assault is called off'],
  },
];

/* Rolling micro-relief laid over the authored profile.
 *
 * The control points give a map its big shape — a ridge, a valley, a climb — but
 * between them the ground was a dead straight ramp. These two out-of-phase waves
 * add dips and rises at a human scale, and being pure functions of x they cost
 * nothing, stay identical every frame, and keep terrain, units, cover and decals
 * agreeing on where the ground is. Offset per lane so the tiers do not ripple in
 * unison. */
function _roll(lane, nx) {
  return Math.sin(nx * 21.7 + lane * 1.7) * 0.042 +
         Math.sin(nx * 47.3 + lane * 3.1) * 0.018 +
         Math.sin(nx * 9.1 + lane * 0.6) * 0.030;
}

/* Trim a map definition down to the lanes actually in play.
 *
 * The map tables still declare three lanes, and settlements, pre-placed units,
 * tunnel mouths and traps are all pinned to a lane index. Rather than teach
 * every consumer to check, the map is normalised once here: lane-indexed arrays
 * are truncated to LANE_N and anything pinned to a lane beyond it is dropped.
 * That keeps the third lane on disk — put LANE_N back to 3 and the maps return
 * intact, with no data to re-author.
 *
 * Cached per map id, because this runs on every match start and the result is
 * immutable.
 */
const _MAP_CACHE = {};
function normaliseMap(map) {
  if (!map) return map;
  if (LANE_N >= (map.lanes ? map.lanes.length : 0)) return map;
  if (_MAP_CACHE[map.id]) return _MAP_CACHE[map.id];

  /* Anything pinned to a lane that no longer exists is DROPPED, including
   * pre-placed squads.
   *
   * Re-homing them into a surviving lane was tried and is wrong. Hill 937
   * pre-places one defending squad per lane — nvasq / rpdteam / nvasq — and
   * wrapping the third into lane 0 gives that lane two squads and two tunnel
   * mouths while lane 1 keeps one. Denser than authored, and lopsided: the
   * light lane becomes the obvious way in. Dropping keeps the density PER LANE
   * that the author set, which is the property that actually matters — fewer
   * lanes should mean proportionately fewer defenders, not the same defenders
   * squeezed together.
   *
   * (It also did not do what it was tried for. First casualties on hill937/vc
   * stayed at 0 by the 50s mark either way; the real story there was that the
   * map's first contact lands at ~53s and the test was asking too early.) */
  const drop = (arr) => (arr || []).filter(e => (e.lane == null) || e.lane < LANE_N);

  const m = Object.assign({}, map, {
    lanes: map.lanes.slice(0, LANE_N),
    flags: (map.flags || []).slice(0, LANE_N),
    settlements: drop(map.settlements),
    prePlaced: drop(map.prePlaced),
    pal: Object.assign({}, map.pal, {
      laneTop: (map.pal.laneTop || []).slice(0, LANE_N),
      laneBody: (map.pal.laneBody || []).slice(0, LANE_N),
    }),
  });
  _MAP_CACHE[map.id] = m;
  return m;
}

function elevAt(map, lane, x) {
  const pts = map.lanes[lane].pts;
  const nx = clamp(x / WORLD_W, 0, 1);
  let base = pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const x0 = pts[i][0], e0 = pts[i][1], x1 = pts[i + 1][0], e1 = pts[i + 1][1];
    if (nx <= x1 || i === pts.length - 2) {
      const t = clamp((nx - x0) / (x1 - x0), 0, 1);
      const k = (1 - Math.cos(t * Math.PI)) / 2;
      base = e0 + (e1 - e0) * k;
      break;
    }
  }
  return base + _roll(lane, nx);
}

function groundY(map, lane, x) {
  return LANE_BASE[lane] - elevAt(map, lane, x) * ELEV_PX;
}
