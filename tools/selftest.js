/* Vietnam '65 self-test — run in the page, drive the REAL frame loop.
 *
 * Written because ad-hoc checks kept missing real bugs. Stepping a paused sim by
 * hand hid a squad deadlock that stopped every shot in the game, and a harness
 * that restarted timestamps between runs fed the sim negative deltas and produced
 * failures that were mine, not the game's. So this suite:
 *
 *   - drives App._frame() with a MONOTONIC clock, never game.update() directly
 *   - plays both sides on every map, buying units like a player would
 *   - asserts on OUTCOMES (shots landed, casualties, morale moving) as well as on
 *     invariants (no NaN, no negative CP, nobody underground, no console errors)
 *
 * Usage, from the browser console or an automation eval:
 *     fetch('tools/selftest.js').then(r=>r.text()).then(eval)
 *       .then(()=>SelfTest.ready()).then(()=>SelfTest.run(55))
 *
 * Always go through ready(). Atlases and props load asynchronously, and running
 * straight after a reload reported every asset missing while the gameplay checks
 * passed on the fallback renderer — a false failure that could just as easily
 * have been a false pass.
 */
window.SelfTest = {
  _clock: 0,

  /* Resolve once every atlas and prop is in memory, or reject after `ms`.
   *
   * MOBILE: atlases load on demand, so nothing is resident until something asks
   * — and this poll ran BEFORE any match existed, so it waited forever on a
   * fetch it had not triggered. It now asks for every available unit up front.
   * The test harness is the one caller that legitimately wants all twelve
   * resident, because it is about to play all of them. */
  ready(ms) {
    const limit = (ms || 15000) + Date.now();
    if (typeof Sprite3D !== 'undefined' && Sprite3D.ensure) {
      for (const u of (Sprite3D.available || [])) Sprite3D.ensure(u);
    }
    return new Promise((res, rej) => {
      const poll = () => {
        const want = (typeof Sprite3D !== 'undefined' && (Sprite3D.available || []).length) || 12;
        const s3 = typeof Sprite3D !== 'undefined' && Sprite3D.enabled &&
          Object.keys(Sprite3D.units).length >= want;
        const pr = typeof Props !== 'undefined' && Props.ready;
        if (s3 && pr) return res(true);
        if (Date.now() > limit) {
          return rej(new Error('assets not ready: sprites=' +
            (typeof Sprite3D === 'undefined' ? 0 : Object.keys(Sprite3D.units).length) +
            ' props=' + (typeof Props === 'undefined' ? 0 : Object.keys(Props.items).length)));
        }
        setTimeout(poll, 120);
      };
      poll();
    });
  },

  _fresh(mapId, side, diff) {
    App.startGame({ mapId, playerSide: side, difficulty: diff || 'veteran' });
    return App.game;
  },

  /* Play one match through the real frame path. Returns collected facts. */
  play(mapId, side, secs, opts = {}) {
    const g = this._fresh(mapId, side, opts.diff);
    const errs = [];
    const prevOnError = window.onerror;
    window.onerror = (m, s, l) => { errs.push(m + ' @' + l); return false; };

    let kills = 0;
    const dmg = g._damage.bind(g);
    g._damage = (t, a, src) => {
      const was = t.deadT != null;
      const r = dmg(t, a, src);
      if (!was && t.deadT != null) kills++;
      return r;
    };

    const buy = side === 'us'
      ? ['rifles', 'weapons', 'arvnsq', 'lrrp', 'snipers']
      : ['nvasq', 'cell', 'rpdteam', 'sapperu', 'marksmanu'];

    let minCP = Infinity, badY = 0, nan = 0, maxMuzzle = 0;
    /* Stance churn. Men used to pump up and down on the spot because the
     * commitment lock could be bypassed by a `moving` flag that flickers as
     * squads settle into their slots. Sampled every frame, because the whole
     * failure mode is sub-second and a 0.5s sampler would not see it.
     * standUnderFire counts the other half of the bug: rising to your feet
     * while being shot at, which is what `nearFoe < 150 -> stand` used to do. */
    let flips = 0, manFrames = 0, standUnderFire = 0;
    const lastStance = new Map();
    // per-man, so the pathological tail can be separated from the aggregate
    const manFlips = new Map(), manLife = new Map();
    if (!this._clock) this._clock = performance.now();

    for (let i = 0; i < secs * 60; i++) {
      this._clock += 16.7;
      if (i % 300 === 0) {
        // lane count is data now (LANE_N) — hardcoding 3 here spawned into a
        // lane the map no longer defines and every map threw on `pts`
        try { g.trySpawn(side, buy[(i / 300) % buy.length | 0], (i / 300) % LANE_N | 0); }
        catch (e) { errs.push('SPAWN ' + e.message); }
      }
      try { App._frame(this._clock); }
      catch (e) { errs.push('FRAME ' + e.message); break; }

      for (const u of g.units) {
        if (u.deadT != null || !u.stance || UNITS[u.key].vehicle) continue;
        manFrames++;
        manLife.set(u, (manLife.get(u) || 0) + 1);
        const prev = lastStance.get(u);
        if (prev && prev !== u.stance) {
          flips++;
          manFlips.set(u, (manFlips.get(u) || 0) + 1);
        }
        lastStance.set(u, u.stance);
        const sq = u.squad;
        if (u.stance === 'stand' && !u.moving && sq && !sq._advancing &&
            (sq.underFireT > 0 || (u.combatT || 0) > 0)) standUnderFire++;
      }
      if (i % 30 === 0) {
        minCP = Math.min(minCP, g.cp.us, g.cp.vc);
        for (const u of g.units) {
          if (!isFinite(u.x) || !isFinite(u.y) || !isFinite(u.hp)) nan++;
          /* A man should stand on his lane, not under it — EXCEPT while he is
           * crossing between lanes. `lane` flips to the destination the instant
           * the order is given (targeting, cover lookups and the render pass all
           * key off it), while `y` eases across over CROSS_TIME, so a man moving
           * from the near lane to the far one is legitimately "below his lane"
           * for about two seconds. Verified he arrives exactly on the far lane's
           * ground line; this is a transient, not a man falling through the
           * floor, which is what the check is actually for. */
          const gy = groundY(g.map, u.lane, u.x);
          if (u.deadT == null && (u.crossT || 0) <= 0 && u.y > gy + 40) badY++;
        }
      }
    }

    // muzzle points must sit on the soldier, not out in the field somewhere
    for (const u of g.units.slice(0, 40)) {
      if (u.deadT != null) continue;
      const m = muzzlePoint(u);
      if (!isFinite(m.x) || !isFinite(m.y)) { nan++; continue; }
      maxMuzzle = Math.max(maxMuzzle, Math.abs(m.x - u.x), Math.abs(m.y - u.y));
    }

    // veterancy must actually accrue, or the whole mechanic is decorative
    let maxXp = 0, ranked = 0;
    for (const sq of g.squads) {
      maxXp = Math.max(maxXp, sq.xp || 0);
      if ((sq.rank || 0) > 0) ranked++;
    }

    window.onerror = prevOnError;
    return {
      map: mapId, side, secs, errs, kills, maxXp, ranked,
      // per man-minute, so the numbers compare across runs of different length
      flipRate: manFrames ? (flips * 3600) / manFrames : 0,
      standUnderFireRate: manFrames ? (standUnderFire * 100) / manFrames : 0,
      /* The WORST man, not the average one. Measured distribution: the median
       * soldier never changes stance at all and two thirds never do, so an
       * aggregate rate is set almost entirely by a handful of men in sustained
       * contact — where changing stance every several seconds is behaviour, not
       * a defect. The bug this suite exists to catch looked like median 0 with a
       * worst man at 34 flips/min, one every 1.8s. That signal lives in the
       * tail, and averaging hides it. */
      worstManFlipRate: (() => {
        let worst = 0;
        for (const [u, frames] of manLife) {
          if (frames < 540) continue;             // ignore men who barely lived
          /* Normalise by AT LEAST 30s of life, not by the man's actual lifetime.
           *
           * A per-minute rate divided by a short lifetime manufactures huge
           * numbers out of ordinary behaviour: the floor above admits a man who
           * lived 9s, and five perfectly reasonable stance changes in those 9s
           * scored (5*3600)/540 = 33.3/min — over a limit of 28, from a man who
           * did nothing wrong. That is how this assertion produced a lone
           * `iadrang/us 32.1` in one run out of five while four consecutive runs
           * came back clean, and it is why the limit had already been walked up
           * from 22 to 28 once before.
           *
           * Capping the denominator kills the small-sample amplification without
           * blunting the detector: a long-lived man's rate is untouched, and the
           * pathology this exists to catch — a man flipping every 1.8s, sustained
           * — still scores ~34 and still trips. */
          const denom = Math.max(frames, 1800);
          worst = Math.max(worst, ((manFlips.get(u) || 0) * 3600) / denom);
        }
        return worst;
      })(),
      shots: g.units.reduce((a, u) => a + (u.shots || 0), 0),
      units: g.units.length,
      us: g.units.filter((u) => u.side === 'us').length,
      vc: g.units.filter((u) => u.side === 'vc').length,
      minCP, badY, nan, maxMuzzle,
      morale: { us: +g.morale.us.toFixed(1), vc: +g.morale.vc.toFixed(1) },
      over: !!g.over,
    };
  },

  run(secs) {
    /* Floor of 60s, because the casualty assertion is only meaningful after a
     * map's first contact can physically have happened.
     *
     * Hill 937 is an assault with a 780s limit and a long uphill approach —
     * measured, its first shot lands at 51.5s and its first kill at 53.1s, i.e.
     * 6.8% into the match. Running the suite at 50s therefore failed
     * `hill937/vc no casualties` while the game was behaving exactly as
     * designed. The bar was wrong, not the map.
     *
     * (Dropping to two lanes did shift that contact a few seconds later, which
     * is what made a previously-passing 50s run start failing. The shift is
     * real but small; the assertion was already asking too early.) */
    secs = Math.max(60, secs || 60);
    const out = [], fails = [];
    const ok = (cond, label) => { if (!cond) fails.push(label); return cond; };

    // ---- asset integrity, before any play
    const wantUnits = ['rifleman', 'arvn', 'm60', 'engineer', 'recon', 'sniper',
      'guerrilla', 'nva', 'rpd', 'sapper', 'marksman', 'rpgman'];
    ok(typeof Sprite3D !== 'undefined' && Sprite3D.enabled, 'Sprite3D not enabled');
    for (const k of wantUnits) ok(Sprite3D.has(k), 'missing sprite atlas: ' + k);

    /* Clips the game actually SELECTS. `prone` and `melee` are deliberately not
     * here: both were rendered for every unit and never drawn — `melee` appears
     * only as a key in the URGENT table in js/sprite3d.js, and prone men are
     * routed to the `aim` pose because the source prone clip is broken. They
     * were dropped from the atlas in tools/pack_sprites3d.py to buy the frames
     * that fixed the walk-cycle jank, so asserting their presence now asserts a
     * requirement the game does not have.
     *
     * Add a clip here only once something selects it. */
    const wantClips = ['idle', 'idle2', 'walk', 'run', 'runfire', 'aim', 'fire',
      'hit', 'hit2', 'death', 'throw', 'dive'];
    for (const k of wantUnits) {
      if (!Sprite3D.has(k)) continue;
      const C = Sprite3D.units[k].meta.clips;
      for (const c of wantClips) ok(C[c] && C[c].length, `${k} missing clip ${c}`);
      const M = Sprite3D.units[k].meta;
      ok(M.figH > 0 && M.groundY > 0, k + ' bad atlas metrics');
      // every frame of every clip must have a muzzle point
      let holes = 0;
      for (const c in C) for (let i = 0; i < C[c].length; i++) {
        if (!M.muzzle || !M.muzzle[c] || !M.muzzle[c][i]) holes++;
      }
      ok(holes === 0, `${k} has ${holes} frames without a muzzle point`);
    }
    ok(typeof Props !== 'undefined' && Props.ready, 'Props not loaded');
    if (typeof Props !== 'undefined') {
      for (const n in Props.items) {
        const m = Props.items[n].meta;
        ok(m.realH > 0 && m.ppm > 0 && m.hM > 0, 'bad prop metrics: ' + n);
      }
    }

    // ---- play every map, both sides
    for (const m of Object.keys(MAPS)) {
      for (const side of ['us', 'vc']) {
        const r = this.play(m, side, secs);
        out.push(r);
        const tag = `${m}/${side}`;
        ok(r.errs.length === 0, `${tag} errors: ${r.errs.slice(0, 2).join(' | ')}`);
        ok(r.shots > 0, `${tag} fired NOTHING in ${secs}s`);
        ok(r.kills > 0, `${tag} no casualties in ${secs}s`);
        ok(r.minCP >= -0.5, `${tag} CP went negative (${r.minCP.toFixed(1)})`);
        ok(r.nan === 0, `${tag} ${r.nan} NaN values`);
        ok(r.badY === 0, `${tag} ${r.badY} units below their lane`);
        ok(r.maxMuzzle < 200, `${tag} muzzle point ${r.maxMuzzle.toFixed(0)}px off the man`);
        ok(r.us > 0 && r.vc > 0, `${tag} one side never fielded anyone`);
        ok(r.maxXp > 0, `${tag} no squad earned any XP — veterancy is not wired`);
        /* Two stance limits, because they catch different things.
         *
         * The tail is the real detector. When the rising bypass could collapse
         * the drop/rise cycle, the median man still never changed stance while
         * the worst flipped 34 times a minute — an average would have shrugged
         * at that. Post-fix the worst observed is ~15 (one change per 4s, which
         * respects the 2.4s/1.1s locks); 22 leaves headroom without letting the
         * old pathology back through.
         *
         * RECALIBRATED after 22 flaked. It had been set from a worst-observed of
         * ~15, which under-sampled: drawing six runs of khesanh/us gives
         * 6.7 / 7.5 / 10 / 14.4 / 19 / 21, so the natural spread reaches the low
         * twenties on that map and a 22.8 was ordinary variance rather than a
         * regression. 28 sits above the observed spread and still well below the
         * 34/min that the original bug produced, which is the thing this
         * assertion exists to catch.
         *
         * The aggregate stays as a coarse net, calibrated from measurement
         * rather than taste: it rises with match length as men crowd together
         * (~1.4/man-min at 40s, ~2.0 at 55s, up to ~5.6 at 70s), so 6 flagged
         * ordinary late-game fighting. 12 is roughly twice the busiest measured
         * run. */
        ok(r.worstManFlipRate < 28,
          `${tag} worst man flips stance ${r.worstManFlipRate.toFixed(1)}/min (limit 28)`);
        ok(r.flipRate < 12, `${tag} stance churn ${r.flipRate.toFixed(1)}/man-min (limit 12)`);
        // standing still, on your feet, while being shot at
        ok(r.standUnderFireRate < 12,
          `${tag} ${r.standUnderFireRate.toFixed(0)}% of man-frames stood up under fire (limit 12)`);
      }
    }

    return {
      pass: fails.length === 0,
      failures: fails,
      summary: out.map((r) =>
        `${r.map}/${r.side} shots=${r.shots} kills=${r.kills} us=${r.us} vc=${r.vc}` +
        ` xp=${r.maxXp} ranked=${r.ranked}` +
        ` cpMin=${r.minCP.toFixed(0)} morale=${r.morale.us}/${r.morale.vc}`),
    };
  },
};
