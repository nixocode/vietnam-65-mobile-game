/* Run the SIMULATION in Node, with no browser at all.
 *
 * Every balance measurement used to mean a Chrome tab rendering the game at
 * 60fps. Measured with `ps` during a session: Chrome's GPU helper at 29% and
 * WindowServer at 37% — about two thirds of a core, continuously, none of which
 * is doing anything a balance question needs. It flattened a laptop battery.
 *
 * The sim turns out to be almost pure: data.js and fx.js touch no browser
 * globals at all, game.js touches `window` once, and perks.js only
 * localStorage. So it runs here on stubs, with no canvas, no compositor and no
 * GPU — the same numbers for a tiny fraction of the power, and far faster
 * because it is not pinned to a frame clock.
 *
 * The files declare their top-level values with `const`, which in a vm Script
 * stays in that script's own lexical scope rather than reaching the context.
 * They are therefore concatenated and run as ONE script so they can see each
 * other, exactly as the browser sees them via separate <script> tags.
 *
 *   node tools/simnode.js                    # a match on every map
 *   node tools/simnode.js --map iadrang      # one map
 *   node tools/simnode.js --secs 240
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.dirname(__dirname);
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : d;
};

function build() {
  const sandbox = {
    console,
    Math,
    Date,
    window: {},
    localStorage: {
      _d: {},
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; },
    },
    /* Sound is stubbed but COUNTED, so audio dispatch stays measurable — that
     * is how the eight weapon voices were verified, and it costs nothing. */
    Sound: new Proxy({ heard: {} }, {
      get(t, k) {
        if (k === 'heard') return t.heard;
        return (...a) => {
          const tag = k === 'shot' ? 'shot:' + a[0] : String(k);
          t.heard[tag] = (t.heard[tag] || 0) + 1;
        };
      },
    }),
    Camera: { x: 0, targetX: 0, sees: () => true, center() {}, pan() {}, reset() {} },
    Renderer: { markDirty() {} },
    /* sprite3d.js is included for its gait constants (S3_REF_SPD and friends,
     * which the sim reads), not for its loader. These two exist only so the
     * file parses; nothing here ever calls load(). */
    /* `muzzlePoint` lives in render.js and the sim calls it purely to place a
     * muzzle flash. Stubbed to the man's own position: no balance question
     * depends on where the sparks are, and pulling in the renderer would drag
     * the whole canvas layer back in — which is the thing this harness exists
     * to avoid. */
    muzzlePoint: (u) => ({ x: u.x, y: u.y }),
    Image: function Image() {},
    fetch: () => Promise.reject(new Error('no network in the sim harness')),
  };
  sandbox.globalThis = sandbox;
  const src = ['js/data.js', 'js/sprite3d.js', 'js/fx.js', 'js/perks.js', 'js/game.js']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  const ctx = vm.createContext(sandbox);
  // one script, so the files share a lexical scope the way <script> tags do
  vm.runInContext(src + '\n;globalThis.__api = { Game, UNITS, SQUADS, MAPS, COVER, GRENADE, M79 };',
                  ctx, { filename: 'vietnam-sim.js' });
  return { api: sandbox.__api, sound: sandbox.Sound };
}

function match(api, mapId, side, secs, buy) {
  const g = new api.Game({ mapId, playerSide: side, difficulty: 'veteran' });
  const foe = side === 'us' ? 'vc' : 'us';
  let kills = 0, shots = 0;
  const k0 = g._kill.bind(g); g._kill = function (...a) { kills++; return k0(...a); };
  const f0 = g._fire.bind(g); g._fire = function (...a) { shots++; return f0(...a); };
  let t = 0, i = 0, dugFrames = 0, frames = 0;
  const dug = g.covers.flat().filter(c => c.dug);
  while (t < secs && !g.over) {
    g.update(1 / 30); t += 1 / 30; i++; frames++;
    if (i % 90 === 0) g.trySpawn(side, buy[(i / 90) % buy.length | 0], (i / 90) % g.covers.length | 0);
    for (const c of dug) if (c.occ.length) dugFrames++;
  }
  return {
    map: mapId, side, secs: +t.toFixed(0), over: !!g.over,
    kills, shots, roundsPerCasualty: kills ? +(shots / kills).toFixed(1) : null,
    trenches: dug.length,
    trenchOccupancy: dug.length ? +(dugFrames / (frames * dug.length)).toFixed(3) : null,
    morale: { us: Math.round(g.morale.us), vc: Math.round(g.morale.vc) },
  };
}

if (require.main === module) {
  const { api, sound } = build();
  const secs = +arg('--secs', 200);
  const only = arg('--map', null);
  const maps = only ? [only] : Object.keys(api.MAPS);
  const BUY = { us: ['rifles', 'weapons', 'rifles', 'engineers'],
                vc: ['nvasq', 'cell', 'rpdteam', 'sapperu'] };
  const t0 = Date.now();
  const rows = [];
  for (const m of maps) for (const s of ['us', 'vc']) rows.push(match(api, m, s, secs, BUY[s]));
  console.log(JSON.stringify({
    runs: rows,
    weaponVoicesHeard: Object.keys(sound.heard).filter(k => k.startsWith('shot:')).sort(),
    wallClockSeconds: +((Date.now() - t0) / 1000).toFixed(1),
  }, null, 1));
}

module.exports = { build, match };
