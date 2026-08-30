/* Vietnam '65 frame capture — the SAME frame, before and after.
 *
 * Comparing art changes by playing two matches and screenshotting both compares
 * two different battles. Different men, different positions, different smoke.
 * You cannot see a 6% palette shift through that much noise, and worse, you can
 * convince yourself you can.
 *
 * So this pins everything that varies:
 *   - Math.random is replaced by a seeded PRNG for the whole run and restored
 *     after, which makes spawns, spread, miss rolls and particle jitter repeat
 *     exactly. This is the part that actually matters; the terrain was already
 *     deterministic off map.seed.
 *   - the sim is stepped by hand at a fixed dt, never off the RAF clock
 *   - the camera is parked at a fixed world x rather than wherever it drifted
 *   - one render is issued explicitly, with the app paused so the loop cannot
 *     overwrite the frame before it is read back
 *
 * Usage, from the console or an automation eval:
 *     fetch('tools/capture.js').then(r=>r.text()).then(eval)
 *       .then(()=>Capture.shot({ map:'mekong', name:'mekong_before' }))
 *
 *     Capture.budget()            // src Mpx, atlas MB, particles, props
 *     Capture.all('before')       // every map, one frame each
 *
 * Shots land in assets/debug/ via the dev server's POST /__shot. That directory
 * is gitignored: these are working images, not assets.
 */
window.Capture = {
  DEFAULTS: { map: 'mekong', side: 'us', secs: 70, camX: 980, seed: 20250812 },

  /* Give the canvas a real backing store.
   *
   * Renderer.fitDPR sizes off canvas.clientWidth. In an automation pane that is
   * hidden, clientWidth is 0, so the canvas becomes 1x1 and `_k` collapses to
   * 1/1280 — every destination rect shrinks to nothing and any cost measured
   * off that frame is fiction. (Source rects survive, because the lane and
   * parallax layers are built from WORLD_W/CANVAS_H constants rather than from
   * the display canvas, which is why source Mpx stays meaningful even in a
   * degenerate pane.) Forcing the size makes destination figures honest too.
   *
   * This still measures WORK, not wall-clock. Nothing here rasterises to a
   * screen, so frame rate must come off the in-game overlay on real hardware. */
  forceSize(w, h) {
    const c = Renderer.canvas;
    c.width = w || 1600;
    c.height = h || 900;
    Renderer._k = c.width / CANVAS_W;
    return { canvas: `${c.width}x${c.height}`, k: +Renderer._k.toFixed(3) };
  },

  /* xorshift32 — small, fast, and repeatable across browsers, which Math.random
   * is explicitly not. */
  _prng(seed) {
    let s = seed | 0 || 1;
    return () => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return ((s >>> 0) % 1e7) / 1e7;
    };
  },

  /* Play a fixed script with randomness pinned, then hand back the game. The
   * caller renders — that keeps the "arrange" and the "capture" separable. */
  stage(opts = {}) {
    const o = Object.assign({}, this.DEFAULTS, opts);
    const realRandom = Math.random;
    Math.random = this._prng(o.seed);
    try {
      App.startGame({ mapId: o.map, playerSide: o.side, difficulty: 'veteran' });
      const g = App.game;
      App.state = 'paused';                       // the RAF loop must not advance it
      const us = Object.keys(SQUADS).filter(k => SQUADS[k].side === 'us');
      const vc = Object.keys(SQUADS).filter(k => SQUADS[k].side === 'vc');
      for (let i = 0; i < o.secs * 60; i++) {
        g.update(1 / 60);
        if (i % 150 === 0) {
          for (const l of LANES) {
            g.trySpawn('us', us[((i / 150) + l) % us.length | 0], l);
            g.trySpawn('vc', vc[((i / 150) + l) % vc.length | 0], l);
          }
        }
      }
      Camera.x = Math.max(0, Math.min(WORLD_W - CANVAS_W, o.camX));
      return g;
    } finally {
      Math.random = realRandom;                   // never leave the game seeded
    }
  },

  /* Stage, render one frame, POST it to the dev server. */
  shot(opts = {}) {
    const o = Object.assign({}, this.DEFAULTS, opts);
    const g = this.stage(o);
    Renderer.render(g, UI, Renderer._time || 0);
    const cv = document.querySelector('canvas');
    return fetch('/__shot', {
      method: 'POST',
      headers: { 'X-Shot-Name': o.name || ('cap_' + o.map) },
      body: cv.toDataURL('image/jpeg', 0.9),
    }).then(r => r.text());
  },

  all(tag) {
    const maps = Object.keys(MAPS);
    return maps.reduce((p, m) => p.then(acc =>
      this.shot({ map: m, name: `${tag}_${m}` }).then(path => acc.concat(path))
    ), Promise.resolve([]));
  },

  /* What the frame COSTS. Destination megapixels are what the compositor pushes;
   * source megapixels are what the driver samples, and on this renderer — nine
   * full-screen layer blits plus atmosphere — source is the number that tracks
   * real cost. Kept as one call so every step of the revamp reports the same
   * figures rather than each inventing its own. */
  budget(opts = {}) {
    const g = this.stage(opts);

    /* Measure sampling by counting it, rather than trusting a figure written
     * down in an earlier session. drawImage is wrapped for exactly one frame
     * and restored immediately — the instrumentation lives here in the dev tool
     * and never ships, so the game pays nothing for it.
     *
     * Source pixels are what the driver READS (a 512px prop scaled down to 60px
     * still samples 512x512 unless it was pre-scaled); destination pixels are
     * what it writes. On a renderer that is essentially nine full-screen layer
     * blits, source is the figure that tracks real cost. */
    const proto = CanvasRenderingContext2D.prototype;
    const real = proto.drawImage;
    let src = 0, dst = 0, calls = 0;
    proto.drawImage = function (img, ...a) {
      calls++;
      const iw = img.naturalWidth || img.width || 0;
      const ih = img.naturalHeight || img.height || 0;
      if (a.length >= 8) { src += a[2] * a[3]; dst += a[6] * a[7]; }
      else if (a.length >= 4) { src += iw * ih; dst += a[2] * a[3]; }
      else { src += iw * ih; dst += iw * ih; }
      return real.call(this, img, ...a);
    };
    /* Render TWICE and measure the second.
     *
     * The first render after a fresh stage bakes the lane layers — terrain,
     * scenery, every prop — into their offscreen canvases. That is a one-time
     * cost the player pays on map load, not per frame, and counting it made the
     * budget read 16-17 Mpx where the steady state is 7.6-8.3. Several figures
     * quoted earlier in this project were inflated for exactly this reason.
     * The warm-up is drawn before instrumentation starts. */
    Renderer.render(g, UI, Renderer._time || 0);
    src = 0; dst = 0; calls = 0;
    try {
      Renderer.render(g, UI, Renderer._time || 0);
    } finally {
      proto.drawImage = real;
    }

    /* Atlas cost has two very different numbers and conflating them is how a
     * budget goes wrong. The PNGs are ~10 MB on disk; DECODED to RGBA in memory
     * they are far larger, and memory is what a machine actually has to hold.
     * Report the real one. */
    let atlasMB = 0, frames = 0;
    for (const k in Sprite3D.units) {
      const m = Sprite3D.units[k].meta, img = Sprite3D.units[k].img;
      atlasMB += (img.width * img.height * 4) / 1048576;
      for (const c in m.clips) frames += m.clips[c].length;
    }
    let propMB = 0;
    for (const n in (Props.items || {})) {
      const im = Props.items[n].img;
      propMB += (im.width * im.height * 4) / 1048576;
    }
    const fx = g.fx || {};
    return {
      map: opts.map || this.DEFAULTS.map,
      srcMpx: +(src / 1e6).toFixed(2),
      dstMpx: +(dst / 1e6).toFixed(2),
      drawCalls: calls,
      renderScale: Renderer.renderScale,
      atlasDecodedMB: +atlasMB.toFixed(1),
      propDecodedMB: +propMB.toFixed(1),
      spriteFrames: frames,
      particles: (fx.particles || []).length,
      floaters: (fx.floaters || []).length,
      liveUnits: g.units.filter(u => u.hp > 0).length,
      /* Caps. srcMpx and particles are per-frame budgets. The memory cap is
       * stated as DECODED, which is the number that was measured — an "18 MB"
       * cap taken from the on-disk PNG size would have been met while the game
       * held five times that in RAM. */
      caps: { srcMpx: 13, decodedMB: 130, particles: 220 },
    };
  },
};
