/* Props — scenery rendered off the SAME orthographic side camera as the soldiers.
 *
 * The world used to be drawn in a different visual language from the troops:
 * buildings in 3/4 view standing beside strictly-profile men. That collage was the
 * most obvious thing left wrong with the art, and no amount of character work
 * fixes it — the fix is to put the scenery on the same camera, which is what
 * tools/render_props.py does.
 *
 * Every prop carries its real height in metres. A soldier is 1.8 m drawn at
 * S3_TARGET_H px, so a hut is placed at its true size relative to the men rather
 * than eyeballed.
 */
const PROP_MAN_M = 1.8;                 // a soldier's height, the scale reference

const Props = {
  ready: false,
  items: {},                            // name -> { img, meta }

  load(onDone) {
    fetch('assets/props/props.json')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const list = d.props || [];
        let left = list.length;
        if (!left) { if (onDone) onDone(); return; }
        for (const p of list) {
          const img = new Image();
          img.onload = () => {
            this.items[p.name] = { img, meta: p };
            this.ready = true;
            if (--left <= 0 && onDone) onDone();
          };
          img.onerror = () => { if (--left <= 0 && onDone) onDone(); };
          img.src = 'assets/props/' + p.name + '.png';
        }
      })
      .catch(() => { if (onDone) onDone(); });
  },

  has(name) { return !!this.items[name]; },

  /* Height in on-screen pixels this prop should occupy at a given lane scale. */
  pxHeight(name, scale) {
    const it = this.items[name];
    if (!it) return 0;
    return (it.meta.realH / PROP_MAN_M) * S3_TARGET_H * (scale || 1);
  },

  /* Props render at 512px but draw at 60-200px. Sampling the full source every
   * frame cost several megapixels for nothing, so each size is pre-scaled once
   * into a small canvas and reused. Bucketed to 8px so a hundred slightly
   * different palm heights do not each mint their own texture. */
  _scaled(it, dw, shade) {
    const sh = shade > 0 ? Math.round(shade * 10) : 0;
    const b = Math.max(8, Math.round(dw / 8) * 8);
    const key = sh ? b + 's' + sh : b;
    const cache = it.cache || (it.cache = {});
    let c = cache[key];
    if (!c) {
      c = document.createElement('canvas');
      c.width = b;
      c.height = b;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      x.drawImage(it.img, 0, 0, b, b);
      if (sh) {
        /* Shade baked in ONCE per size rather than per draw. Darkening at draw
         * time needs either a canvas filter or a scratch buffer every frame;
         * this pays for it on first use and the cache serves it thereafter.
         * source-atop confines the wash to the prop's own pixels, which is the
         * whole trick — a plain fillRect would flood the frame. */
        x.globalCompositeOperation = 'source-atop';
        x.fillStyle = 'rgba(14,20,12,' + (sh / 10) + ')';
        x.fillRect(0, 0, b, b);
        x.globalCompositeOperation = 'source-over';
      }
      cache[key] = c;
      // a runaway cache would be its own leak; props only ever need a few sizes
      const keys = Object.keys(cache);
      if (keys.length > 20) delete cache[keys[0]];
    }
    return c;
  },

  /* A soft contact shadow, built once and reused.
   *
   * Soldiers have had one since the sprite rig landed; props never did, so every
   * hut, palm and sandbag wall met the ground on a hard cut edge and read as a
   * sticker laid on grass. That is most of what "the assets and the terrain do
   * not blend" is describing — the men are planted in the scene and the scenery
   * is sitting on top of it.
   *
   * A gradient rather than a flat ellipse: the hard rim of a solid one is its
   * own cut edge, which trades one problem for another. */
  _shadowBlob() {
    if (this._blob) return this._blob;
    const R = 64;
    const c = document.createElement('canvas');
    c.width = c.height = R * 2;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0, 'rgba(10,14,8,0.52)');
    g.addColorStop(0.45, 'rgba(10,14,8,0.30)');
    g.addColorStop(1, 'rgba(10,14,8,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, R * 2, R * 2);
    this._blob = c;
    return c;
  },

  /* Draw with its base planted on (x, groundY). `fit` overrides the authored
   * height when a map wants a specific size — the aspect ratio is kept either
   * way, so nothing ever stretches. `shade` (0-1) darkens the prop, for growth
   * that sits between the camera and the light. `noShadow` opts out for props
   * that are not standing on the ground the camera can see. */
  draw(ctx, name, x, groundY, scale, opts = {}) {
    const it = this.items[name];
    if (!it) return false;
    const m = it.meta;
    const h = opts.fit ? opts.fit : this.pxHeight(name, scale);
    // the rendered frame is square with the prop's base at meta.groundY
    const k = h / (m.hM * m.ppm);
    const dw = m.res * k;
    if (dw < 1) return true;
    const src = this._scaled(it, dw, opts.shade);
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    /* Grounded BEFORE the prop and outside the flip, so a mirrored prop does not
     * mirror its own shadow. Width follows the prop's real footprint, not the
     * square cell, or a tall narrow palm would cast a shadow as wide as it is
     * high. */
    if (!opts.noShadow) {
      const fw = (m.wM / Math.max(0.01, m.hM)) * h;      // drawn footprint width
      const sw = Math.max(6, fw * 0.62);
      const sh = Math.max(2.2, sw * 0.19);
      const prev = ctx.globalAlpha;
      ctx.globalAlpha = prev * 0.9;
      ctx.drawImage(this._shadowBlob(), x - sw, groundY - sh * 0.85, sw * 2, sh * 2);
      ctx.globalAlpha = prev;
    }
    ctx.translate(x, groundY);
    if (opts.flip) ctx.scale(-1, 1);
    ctx.drawImage(src, -dw / 2, -m.groundY * k, dw, dw);
    ctx.restore();
    return true;
  },
};
