/* Measure BALANCE, repeatably.
 *
 * Until the sim was seeded, this could not be done. LZ X-Ray read 1/4, 2/4 and
 * 4/4 player wins across three measurements of the SAME code, and two "A/B"
 * conclusions in one session turned out to be noise. The plan's own rule was
 * "do not balance missions off four runs" — which left every balance question
 * unanswerable rather than answered.
 *
 * Now every match takes a seed, so this harness fixes the seed SET and plays
 * the same battles before and after a change. That makes the comparison PAIRED:
 * `--baseline` reports which individual seeds flipped and runs an exact
 * McNemar test on them, which sees a real effect at a fraction of the sample
 * an unpaired win-rate comparison would need.
 *
 *   node tools/balance.js                          # campaign, 24 seeds, both profiles
 *   node tools/balance.js --seeds 60 --profile brain
 *   node tools/balance.js --map hill937 --seeds 40
 *   node tools/balance.js --json > before.json
 *   ...change something...
 *   node tools/balance.js --json --baseline before.json
 *
 * The two profiles bracket the real player, who is somewhere between:
 *   naive  — buys a rotation on a timer and does nothing else. The old harness
 *            player, and the floor: no call-ins, no orders, no judgement.
 *   brain  — THE GAME'S OWN AI, commanding the player's side as well as its
 *            own. It buys where the line is losing and it uses the side's real
 *            toolkit: fire support as the US, traps and infiltration as the VC.
 *
 * `brain` replaced a hand-written "competent" profile that only knew the US
 * call-ins — so on both VC missions it made not one call-in and was, measurably,
 * the naive profile wearing a different name (cuchi 3/12 naive vs 2/12
 * "competent", khesanh 0/12 both, zero call-ins in either). The two sides do not
 * share a toolkit: the US has arty, napalm, medevac, aircav and arclight; the VC
 * has punji, mines, spiderholes and tunnels. Borrowing the AI gets both right by
 * construction and invents no second policy to go stale.
 *
 * It is played at the MISSION'S difficulty, the same one the opponent gets, so
 * on `recruit` the player brain makes recruit-grade mistakes too. That is a
 * confound, and it is deliberate: the alternative is a hand-tuned player that
 * measures my guesses rather than the game.
 *
 * A mission `brain` cannot win is too hard; one `naive` wins every time is too
 * easy.
 */
'use strict';
const fs = require('fs');
const { build } = require('./simnode.js');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);

const BUY = {
  us: ['rifles', 'weapons', 'rifles', 'engineers', 'snipers'],
  vc: ['nvasq', 'cell', 'rpdteam', 'sapperu', 'marksmanu'],
};

/* Wilson score interval — the right one for a proportion at these sample
 * sizes; the textbook normal interval is badly wrong near 0 and 1, which is
 * exactly where a broken mission sits. */
function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

/* Exact binomial (McNemar) two-sided p for paired flips. */
function mcnemar(a, b) {
  const n = a + b;
  if (!n) return 1;
  const lo = Math.min(a, b);
  let logC = 0, sum = 0;
  for (let i = 0; i <= lo; i++) {
    if (i > 0) logC += Math.log((n - i + 1) / i);
    sum += Math.exp(logC - n * Math.LN2);
  }
  return Math.min(1, 2 * sum);
}

function playOne(api, mission, seed, profile) {
  const { map, side, diff } = mission;
  const g = new api.Game({ mapId: map, playerSide: side, difficulty: diff, seed });
  const foe = side === 'us' ? 'vc' : 'us';
  const buy = BUY[side];
  const HZ = 30, dt = 1 / HZ;
  let t = 0, i = 0, bought = 0;
  const CAP = 900; // safety only; every mission resolves long before this

  while (t < CAP && !g.over) {
    g.update(dt); t += dt; i++;

    // The naive player's only act. `brain` does its own buying, where it
    // judges the line needs it, so giving it this as well would be two players.
    if (profile === 'naive' && i % (HZ * 3) === 0) {
      const key = buy[bought % buy.length];
      if (g.trySpawn(side, key, bought % g.covers.length | 0)) bought++;
    }

    if (profile === 'brain') brain(g, side, dt);
  }
  return {
    seed,
    win: !!(g.result && g.result.winner === side),
    reason: g.result ? g.result.reason : 'unresolved',
    secs: +t.toFixed(1),
    kills: g.stats[side].kills, losses: g.stats[side].losses,
    callins: g.stats[side].callins,
    morale: { own: Math.round(g.morale[side]), foe: Math.round(g.morale[foe]) },
  };
}

/* Run the game's own commander for the PLAYER's side.
 *
 * `_aiUpdate` reads `this.aiSide` and runs off `this.aiT`, both of which belong
 * to the opponent. Swapping them in and out around the call gives the player
 * side its own independent brain on its own independent clock, without the two
 * commanders stealing each other's turn — and leaves the game file untouched,
 * which matters, because a harness that needs the sim modified to measure it is
 * measuring the modification. */
function brain(g, side, dt) {
  const side0 = g.aiSide, t0 = g.aiT;
  g.aiSide = side;
  g.aiT = g._playerAiT == null ? 0 : g._playerAiT;
  g._aiUpdate(dt);
  g._playerAiT = g.aiT;
  g.aiSide = side0; g.aiT = t0;
}

function run(api, missions, seeds, profiles) {
  const out = [];
  for (const m of missions) {
    for (const profile of profiles) {
      const runs = seeds.map(s => playOne(api, m, s, profile));
      const wins = runs.filter(r => r.win).length;
      const [lo, hi] = wilson(wins, runs.length);
      const secs = runs.map(r => r.secs).sort((a, b) => a - b);
      out.push({
        map: m.map, side: m.side, diff: m.diff, title: m.title || m.map, profile,
        n: runs.length, wins, winRate: +(wins / runs.length).toFixed(3),
        ci95: [+lo.toFixed(3), +hi.toFixed(3)],
        medianSecs: secs[secs.length >> 1],
        meanKills: +(runs.reduce((a, r) => a + r.kills, 0) / runs.length).toFixed(1),
        meanLosses: +(runs.reduce((a, r) => a + r.losses, 0) / runs.length).toFixed(1),
        meanCallins: +(runs.reduce((a, r) => a + r.callins, 0) / runs.length).toFixed(1),
        unresolved: runs.filter(r => r.reason === 'unresolved').length,
        perSeed: runs.map(r => [r.seed, r.win ? 1 : 0]),
      });
    }
  }
  return out;
}

function compare(now, base) {
  const key = r => `${r.map}/${r.side}/${r.profile}`;
  const bi = new Map(base.map(r => [key(r), r]));
  const rows = [];
  for (const r of now) {
    const b = bi.get(key(r));
    if (!b) continue;
    const bm = new Map(b.perSeed);
    let gained = 0, lost = 0, shared = 0;
    for (const [s, w] of r.perSeed) {
      if (!bm.has(s)) continue;
      shared++;
      const was = bm.get(s);
      if (w && !was) gained++; else if (!w && was) lost++;
    }
    rows.push({
      row: key(r), pairedSeeds: shared,
      was: b.winRate, now: r.winRate, delta: +(r.winRate - b.winRate).toFixed(3),
      seedsFlippedToWin: gained, seedsFlippedToLoss: lost,
      p: +mcnemar(gained, lost).toFixed(4),
      verdict: shared < 8 ? 'too few paired seeds'
        : mcnemar(gained, lost) < 0.05 ? (gained > lost ? 'EASIER (significant)' : 'HARDER (significant)')
        : 'no measurable change',
    });
  }
  return rows;
}

if (require.main === module) {
  const { api } = build();
  const CAMPAIGN = api.CAMPAIGN || null;
  const only = arg('--map', null);
  let missions = CAMPAIGN
    ? CAMPAIGN.map(c => ({ map: c.map, side: c.side, diff: c.diff, title: c.title }))
    : Object.keys(api.MAPS).map(m => ({ map: m, side: 'us', diff: 'veteran', title: m }));
  if (only) missions = missions.filter(m => m.map === only);

  /* SEEDS ARE CONSECUTIVE, AND THAT IS ONLY SAFE BECAUSE OF seededSim.
   *
   * Under the old LCG the first draw of adjacent seeds correlated at 0.998, so
   * a block of twelve consecutive seeds behaved like one or two samples: this
   * harness read Khe Sanh at 8/12 on 1000-1011 and 0/12 on 2000-2011 with the
   * same code, and still disagreed 44% vs 15% at N=48. data.js's seededSim
   * fixed that at the source. Twenty-four is a floor for a yes/no question; use
   * 48 or more before moving a constant. */
  const N = +arg('--seeds', 24);
  const seed0 = +arg('--seed0', 1000) >>> 0;
  const seeds = Array.from({ length: N }, (_, i) => (seed0 + i) >>> 0);
  const profiles = arg('--profile', null) ? [arg('--profile', null)] : ['naive', 'brain'];

  const t0 = Date.now();
  const rows = run(api, missions, seeds, profiles);
  const wall = +((Date.now() - t0) / 1000).toFixed(1);

  const baseFile = arg('--baseline', null);
  const cmp = baseFile ? compare(rows, JSON.parse(fs.readFileSync(baseFile, 'utf8')).rows) : null;

  if (has('--json')) {
    console.log(JSON.stringify({ seeds: [seeds[0], seeds[seeds.length - 1]], wall, rows, compare: cmp }, null, 1));
  } else {
    console.log(`seeds ${seeds[0]}..${seeds[seeds.length - 1]}  (${N} per row)   ${wall}s\n`);
    console.log('mission          side prof        win   95% CI         med s  kills  lost  callins');
    for (const r of rows) {
      console.log(
        `${(r.title || r.map).slice(0, 16).padEnd(16)} ${r.side.padEnd(4)} ${r.profile.padEnd(10)} ` +
        `${String(r.wins).padStart(2)}/${r.n}  ` +
        `${(r.ci95[0] * 100).toFixed(0).padStart(3)}-${(r.ci95[1] * 100).toFixed(0).padEnd(3)}%  ` +
        `${String(r.medianSecs).padStart(6)} ${String(r.meanKills).padStart(6)} ${String(r.meanLosses).padStart(5)} ${String(r.meanCallins).padStart(8)}` +
        (r.unresolved ? `   ${r.unresolved} UNRESOLVED` : ''));
    }
    if (cmp) {
      console.log('\nagainst baseline (paired by seed):');
      for (const c of cmp) {
        console.log(`  ${c.row.padEnd(22)} ${(c.was * 100).toFixed(0)}% -> ${(c.now * 100).toFixed(0)}%  ` +
          `+${c.seedsFlippedToWin}/-${c.seedsFlippedToLoss} of ${c.pairedSeeds}  p=${c.p}  ${c.verdict}`);
      }
    }
  }
}

module.exports = { playOne, run, compare, wilson, mcnemar };
