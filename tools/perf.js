/* Vietnam '65 frame-cost bench — an actual millisecond number, not work-per-frame.
 *
 * This project has said "frame rate cannot be measured here" for its whole life,
 * and the reason turned out to be specific rather than fundamental: the
 * automation pane runs HIDDEN, so Chrome throttles requestAnimationFrame and the
 * callback never fires. Every FPS attempt died there, and the fallback was to
 * count work — source megapixels, particle counts — which tracks cost but is not
 * cost, and cannot answer "does it hold 60".
 *
 * RAF is not the only clock. A canvas draw call returns as soon as the command
 * is QUEUED, so timing render() alone measures command submission and nothing
 * else. Reading a pixel back forces every queued command to complete first, so:
 *
 *     t0 -> render() -> getImageData(1x1) -> t1
 *
 * bounds the real end-to-end cost of the frame. The readback has its own price,
 * so it is measured on its own and subtracted.
 *
 * Usage:
 *     fetch('tools/perf.js').then(r=>r.text()).then(eval)
 *       .then(() => Perf.bench({ map: 'mekong' }))
 *     Perf.curve()            // cost against unit count
 *     Perf.all()              // every map
 *
 * HONEST LIMITS, so nobody quotes these as gospel:
 *   - Measured in a hidden tab. Compositing to a real display is not included,
 *     and a hidden tab can take a different GPU path from a visible one.
 *   - Repeated getImageData can push Chrome to de-accelerate a canvas, which
 *     would make these numbers pessimistic. `jsMs` is reported alongside so the
 *     two can be compared: if flushed >> js, the GPU is doing real work; if they
 *     track, the cost is CPU-side and the readback is not distorting much.
 *   - It is a LOWER BOUND on frame time and an upper bound on achievable FPS.
 * Treat it as a comparable number between two builds, which is what it is for.
 */
window.Perf = {
  DEFAULTS: { map: 'mekong', side: 'us', secs: 70, camX: 980, seed: 20250812,
              iters: 60, w: 1600, h: 900 },

  _need() {
    if (typeof Capture === 'undefined') {
      throw new Error('load tools/capture.js first — Perf reuses its staging');
    }
  },

  /* One pixel is enough: the flush is what costs, not the byte. */
  _flush(ctx) { return ctx.getImageData(0, 0, 1, 1).data[3]; },

  _stats(v) {
    const s = v.slice().sort((a, b) => a - b);
    return {
      med: +s[s.length >> 1].toFixed(2),
      p95: +s[Math.min(s.length - 1, Math.floor(s.length * 0.95))].toFixed(2),
      min: +s[0].toFixed(2),
    };
  },

  bench(opts = {}) {
    this._need();
    const o = Object.assign({}, this.DEFAULTS, opts);
    Capture.forceSize(o.w, o.h);
    const g = Capture.stage({ map: o.map, side: o.side, secs: o.secs,
                              camX: o.camX, seed: o.seed });
    const ctx = Renderer.canvas.getContext('2d');

    /* Warm-up. The first render after staging bakes every lane layer — a
     * map-load cost, not a frame cost — and the several after it are still
     * paying for cold caches and JIT.
     *
     * SAMPLE COUNT MATTERS MORE THAN IT LOOKS. At `iters: 18` this reported a
     * median of 6.1ms and a p95 of 18.5 on the same scene that gives 3.1 and 3.7
     * at 70 — a p95 over 18 samples is really just "second worst frame", and the
     * worst frames are warm-up and GC. It read as a tail regression that was not
     * there, and was very nearly written into PLAN.md as one. Keep iters >= 50
     * for any p95 you intend to quote. */
    for (let i = 0; i < 10; i++) Renderer.render(g, UI, i * 0.016);

    /* PER-FRAME FLUSH, with a canary — and at most a few benches per page load.
     *
     * Two wrong turns are baked into this comment so they are not retaken.
     *
     * 1. Flushing after every frame is correct in principle and POISONS THE
     *    INSTRUMENT in practice: Chrome de-accelerates a canvas that is read
     *    back repeatedly, and once that trips everything falls to software.
     *    Caught by running the same 20-second scene five times in one page —
     *    3.1ms on a fresh page, 41.7ms later, with cost tracking total readbacks
     *    and nothing in the scene. It looked exactly like a load cliff at 60s of
     *    match time; it was the instrument.
     * 2. So the flush was moved to once per BATCH — and that is unsound for a
     *    different reason. Each render fully overwrites the canvas, so the
     *    intermediate frames are never observable and the driver is free not to
     *    produce them. It reported 0.06ms/frame, i.e. 16,000 FPS.
     *
     * What actually works: flush per frame, keep `iters` modest, and take only a
     * few benches per page load. `jsMs` is the canary — on an accelerated canvas
     * submission is ~0.3ms because rasterisation happens elsewhere; once the
     * canvas falls back to software the raster happens INSIDE the draw call and
     * jsMs jumps by two orders of magnitude. If `degraded` is true, reload the
     * page and measure again; do not quote the number.
     */
    const base = [];
    for (let i = 0; i < 8; i++) {
      const t = performance.now();
      this._flush(ctx);
      base.push(performance.now() - t);
    }
    const readbackMs = this._stats(base).med;

    // render only — command submission, no completion guarantee
    const js = [];
    for (let i = 0; i < o.iters; i++) {
      const t = performance.now();
      Renderer.render(g, UI, 1 + i * 0.016);
      js.push(performance.now() - t);
    }

    // render + forced completion
    const full = [];
    for (let i = 0; i < o.iters; i++) {
      const t = performance.now();
      Renderer.render(g, UI, 2 + i * 0.016);
      this._flush(ctx);
      full.push(performance.now() - t);
    }

    const J = this._stats(js), F = this._stats(full);
    const frameMs = +(F.med - readbackMs).toFixed(2);
    const degraded = J.med > 4;          // software fallback; see the note above
    const alive = g.units.filter((u) => u.deadT == null).length;
    return {
      map: o.map,
      men: alive,
      canvas: `${o.w}x${o.h}`,
      jsMs: J.med,
      frameMs,
      p95Ms: +(F.p95 - readbackMs).toFixed(2),
      readbackMs: +readbackMs.toFixed(2),
      degraded,
      fpsCeiling: degraded ? null : (frameMs > 0 ? Math.round(1000 / frameMs) : null),
      holds60: degraded ? null : (frameMs > 0 ? frameMs < 16.7 : null),
      particles: (g.fx && g.fx.particles) ? g.fx.particles.length : null,
    };
  },

  /* Cost against how much is happening — the shape that matters when adding
   * particle work, because a mean over a quiet frame hides the spike. */
  curve(opts = {}) {
    const out = [];
    for (const secs of [20, 45, 70, 95]) {
      out.push(Object.assign({ secs }, this.bench(Object.assign({}, opts, { secs }))));
    }
    return out;
  },

  all(opts = {}) {
    return Object.keys(MAPS).map((m) => this.bench(Object.assign({}, opts, { map: m })));
  },
};
'Perf ready'
