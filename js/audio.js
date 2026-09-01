'use strict';

/* Procedural WebAudio SFX with camera-relative stereo panning.
   Layered synthesis (mechanism click + report + tail) until real samples land;
   drop decoded AudioBuffers in later and swap at the call sites. */
const Sound = {
  ctx: null,
  master: null,
  muted: false,
  ambient: null,

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._noiseBuf = this._makeNoise(2);
      /* THE ROOM. This is the whole reason the guns sounded thin.
       *
       * The graph was source -> filter -> gain -> master -> speakers. Every
       * sound in the game arrived completely DRY, and gunfire outdoors is
       * mostly not the muzzle — it is the ground, the treeline and the valley
       * wall returning the report over the next second and a half. The file
       * already faked one slice of that with a delayed noise burst it called a
       * treeline echo, which tells you the absence was felt.
       *
       * A ConvolverNode does it properly and costs no assets: the impulse
       * response is synthesised (see _makeIR), so this stays a zero-dependency
       * project with no audio files to ship.
       *
       *   dry ──────────────────────────┐
       *   send ─> convolver ─> wetGain ─┤─> limiter -> master -> speakers
       *
       * The limiter matters as much as the reverb. Twenty men firing at once
       * used to sum straight into the destination and clip, which is heard as
       * a crackle and as everything getting quieter the moment a firefight
       * gets big — the opposite of what should happen. */
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      /* A SOFT CLIPPER, not a compressor.
       *
       * Real recordings are ~5x hotter than the synth they layer over, and
       * measured, twenty simultaneous shots peaked at 3.2 with 437 clipped
       * samples. So a safety net is now justified by data — which it was not
       * before the samples landed, and a DynamicsCompressor was removed then
       * for exactly that reason.
       *
       * It is still not a DynamicsCompressor, because that node applies broad
       * gain reduction whatever its threshold: measured at -3 dB with ratio 20
       * it pulled a SINGLE rifle shot from 0.292 down to 0.063. A WaveShaper is
       * honest — the curve is identity below the knee, so one shot passes
       * through untouched, and only the sum of many rounds ever reaches the
       * part that bends. */
      const shaper = this.ctx.createWaveShaper();
      const N = 4096, curve = new Float32Array(N);
      const KNEE = 0.62;
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1;
        const a = Math.abs(x);
        curve[i] = a <= KNEE ? x
          : Math.sign(x) * (KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE)));
      }
      shaper.curve = curve;
      shaper.oversample = '2x';
      this.master.connect(shaper);
      shaper.connect(this.ctx.destination);
      this._shaper = shaper;

      this.dry = this.ctx.createGain(); this.dry.gain.value = 1;
      this.dry.connect(this.master);
      this.wet = this.ctx.createGain(); this.wet.gain.value = 0.9;
      this.wet.connect(this.master);
      try {
        this.conv = this.ctx.createConvolver();
        this.conv.buffer = this._makeIR(1.5, 2.6);
        this.conv.connect(this.wet);
      } catch (e) { this.conv = null; }
    } catch (e) { this.ctx = null; }
  },

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  },

  /* A synthesised impulse response — decaying noise with discrete early
   * reflections punched into it.
   *
   * The diffuse tail alone reads as a cathedral. What makes it read as OUTDOOR
   * ground is the early reflections: a handful of distinct returns in the first
   * 120 ms from the earth and the nearest trees, before the tail sets in. The
   * tail is also lowpassed as it decays, because air and foliage absorb the
   * highs first, so a distant report comes back darker than it left. */
  _makeIR(seconds, decay) {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay);
        // one-pole lowpass that closes as the tail decays
        const a = 0.30 - 0.22 * t;
        lp += a * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * env * 0.55;
      }
      // early reflections: ground bounce, then the treeline either side
      const taps = [[0.011, 0.55], [0.023, 0.40], [0.041, 0.32],
                    [0.068, 0.26], [0.097, 0.20], [0.131, 0.15]];
      for (const [tm, amp] of taps) {
        const at = Math.floor(sr * tm * (ch ? 1.07 : 0.94));   // decorrelate L/R
        if (at < len) d[at] += amp * (ch ? -1 : 1);
      }
    }
    return buf;
  },

  _makeNoise(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  },

  /* world-x → { pan, att }: position sounds relative to the camera window */
  _spatial(x) {
    if (x == null || typeof Camera === 'undefined') return { pan: 0, att: 1, far: 0 };
    const center = Camera.x + CANVAS_W / 2;
    const dx = x - center;
    const pan = clamp(dx / 850, -1, 1) * 0.75;
    const off = Math.max(0, Math.abs(dx) - CANVAS_W / 2);
    const att = 1 / (1 + off / 700);
    // 0 at your feet, 1 across the map. Distance does not just make a shot
    // quieter — air eats the high frequencies first, so a rifle a long way off
    // is a dull thud, not a small crack. That colouring is most of what makes a
    // battlefield sound wide rather than flat.
    const far = clamp(off / 1100, 0, 1);
    return { pan, att, far };
  },

  /* Sharpness rolls off with distance: full crack up close, muffled thump far. */
  _hi(base, far) { return base * (1 - 0.72 * far) + 220 * far; },

  /* Every voice goes to BOTH the dry path and the reverb send.
   *
   * `wet` is how much of this particular sound is room rather than muzzle, and
   * it is what actually sells distance. A lowpass alone makes a far rifle sound
   * like a near rifle with a blanket over it; what a far rifle really is, is
   * mostly reflection — so the send rises with distance while the dry falls.
   * Callers pass their own `far` through, and anything that does not gets a
   * modest default so nothing is bone dry. */
  _bus(pan, wet) {
    const w = wet == null ? 0.22 : wet;
    let node;
    if (pan && this.ctx.createStereoPanner) {
      node = this.ctx.createStereoPanner();
      node.pan.value = pan;
    } else {
      node = this.ctx.createGain();
    }
    node.connect(this.dry || this.master);
    if (this.conv && w > 0.001) {
      const send = this.ctx.createGain();
      send.gain.value = w;
      node.connect(send);
      send.connect(this.conv);
    }
    return node;
  },

  _noise(dur, filterType, freq, q, gain, when = 0, pan = 0, wet) {
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    src.playbackRate.value = rand(0.92, 1.08); // decorrelate repeats
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q || 1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this._bus(pan, wet));
    src.start(t, rand(0, 1.4)); src.stop(t + dur + 0.05);
    return { f, g, src };
  },

  _tone(type, freq, dur, gain, when = 0, slideTo = null, pan = 0, wet) {
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this._bus(pan, wet));
    o.start(t); o.stop(t + dur + 0.05);
  },

  ok() { return this.ctx && !this.muted; },

  /* layered small-arms: mechanism click + report + decaying tail */
  /* REAL RECORDINGS, loaded lazily and layered over the synthesis.
   *
   * The synth got a room in the previous pass and improved a lot, but a
   * filtered noise burst is still a filtered noise burst: what it cannot
   * produce is the mechanical detail of an actual weapon — the bolt, the
   * cartridge ring, the particular way a 7.62 report tears versus a 5.56.
   *
   * These are CC0 (see assets/audio/SOURCE.txt), 20 KB each, four of them. They
   * do NOT replace the synth: the sample carries the muzzle and the synth still
   * carries distance — the lag, the treble loss, the wet send — because one
   * recording cannot be a rifle at every range. Sample dry and close, synth
   * layers thinned as it takes over. If a buffer has not decoded yet, or the
   * fetch failed, `shot` falls through to pure synthesis exactly as before, so
   * the game never depends on an asset that might not be there. */
  // `bolt` is not reachable through `shot` — snipers go via sniperShot() —
  // but it is listed so _loadSamples fetches it.
  SAMPLES: { m16: 'm16', ak: 'ak', mg: 'mg', bolt: 'bolt' },

  /* EIGHT WEAPON VOICES FROM FOUR RECORDINGS.
   *
   * The game had twelve unit types and three gunshots — one line picked between
   * them by SIDE, so every American weapon was the same crack and every VC
   * weapon was the same crack. In a firefight that is the difference between
   * hearing a battle and hearing a loop.
   *
   * The four CC0 samples are the only real recordings available (the source
   * library is gigabytes and no longer on disk — see assets/audio/SOURCE.txt),
   * so the extra voices are DERIVED rather than downloaded. `_playSample`
   * already takes a playback rate, and rate plus a different synth bed is
   * genuinely how these weapons differ: an M14 is the same family of crack as
   * an M16 an octave down with more body behind it, and an M2 .50 is a much
   * slower, heavier version of the same belt-gun thump.
   *
   *   samp   which recording carries the muzzle
   *   rate   playback rate — the main character difference
   *   bed    which synth layer family fills in distance and body
   *   gain   overall level, so heavier weapons sit louder in the mix
   *   body   scales the low tail; big cartridges keep rolling
   */
  VOICES: {
    m16:   { samp: 'm16',  rate: 1.00, bed: 'rifle', gain: 1.00, body: 1.00 },
    m14:   { samp: 'm16',  rate: 0.84, bed: 'rifle', gain: 1.12, body: 1.35 },
    ak:    { samp: 'ak',   rate: 1.00, bed: 'ak',    gain: 1.00, body: 1.00 },
    sks:   { samp: 'ak',   rate: 1.14, bed: 'ak',    gain: 0.94, body: 0.85 },
    mg:    { samp: 'mg',   rate: 1.00, bed: 'mg',    gain: 1.00, body: 1.00 },
    rpd:   { samp: 'mg',   rate: 1.11, bed: 'mg',    gain: 0.92, body: 0.90 },
    fifty: { samp: 'mg',   rate: 0.60, bed: 'mg',    gain: 1.40, body: 1.75 },
    bolt:  { samp: 'bolt', rate: 1.00, bed: 'rifle', gain: 1.06, body: 1.15 },
  },

  _loadSamples() {
    if (this._sampReq || !this.ctx) return;
    this._sampReq = true;
    this._samp = {};
    const seen = {};
    for (const k in this.SAMPLES) {
      const f = this.SAMPLES[k];
      if (seen[f]) continue;
      seen[f] = 1;
      fetch('assets/audio/' + f + '.wav')
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((b) => this.ctx.decodeAudioData(b))
        .then((buf) => { this._samp[f] = buf; })
        .catch(() => { /* stay on synthesis */ });
    }
  },

  _playSample(name, gain, pan, when, wet, rate) {
    const buf = this._samp && this._samp[name];
    if (!buf) return false;
    const t = this.ctx.currentTime + (when || 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate || 1;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this._bus(pan, wet));
    src.start(t);
    return true;
  },

  shot(kind, x) {
    if (!this.ok()) return;
    this._loadSamples();
    const { pan, att, far } = this._spatial(x);
    const j = rand(0.9, 1.12); // pitch jitter so volleys don't machine-copy
    const H = (f) => this._hi(f, far);
    // sound travels: a shot across the map arrives late
    const lag = far * 0.13;
    // and the report rolls back off the treeline
    /* Wetness rises hard with distance. A rifle at your shoulder is almost all
     * muzzle; the same rifle across the valley is almost all reflection, and
     * that — not a lowpass — is what the ear uses to place it. The transient
     * layers stay driest, because it is the crack that localises a shot. */
    const wT = 0.10 + far * 0.55;          // transient: stays fairly dry
    const wB = 0.34 + far * 1.25;          // body and tail: soak them

    /* If the recording is loaded, it plays the muzzle and the synth is cut back
     * to the parts that carry DISTANCE. Pitch is jittered per shot so a volley
     * is not one sample stamped twenty times — the single thing that makes
     * sample-based gunfire sound cheap. */
    const V = this.VOICES[kind] || this.VOICES.m16;
    const played = this._playSample(
      V.samp, 0.62 * V.gain * att * (1 - far * 0.45), pan, lag, 0.18 + far * 1.1,
      V.rate * j * (1 - far * 0.06));
    const sk = played ? 0.34 : 1;          // synth level once a sample carries it
    const bod = V.body;
    /* One bed per family instead of a chain of `if (kind === ...)`. The three
     * beds were already near-copies of each other differing in four numbers;
     * pulling those out is what lets eight voices share them. */
    if (V.bed === 'rifle') {
      this._noise(0.012, 'highpass', H(6200 * V.rate), 1, sk * 0.10 * att * (1 - far), lag, pan, wT);
      this._noise(0.07, 'bandpass', H(3300 * j * V.rate), 1.3, sk * 0.17 * att, lag + 0.004, pan, wB);
      this._noise(0.05, 'highpass', H(5200 * V.rate), 1, sk * 0.07 * att * (1 - far), lag + 0.004, pan, wT);
      this._noise((0.22 + far * 0.3) * bod, 'lowpass', 900 * j * V.rate, 0.6, 0.06 * att * bod, lag + 0.02, pan, wB);
    } else if (V.bed === 'ak') {
      this._noise(0.012, 'highpass', H(4800 * V.rate), 1, sk * 0.08 * att * (1 - far), lag, pan, wT);
      this._noise(0.09, 'bandpass', H(1650 * j * V.rate), 1.1, sk * 0.21 * att, lag + 0.004, pan, wB);
      this._tone('square', 128 * j * V.rate, 0.05, sk * 0.05 * att, lag + 0.004, null, pan, wT);
      this._noise((0.28 + far * 0.34) * bod, 'lowpass', 700 * j * V.rate, 0.6, 0.07 * att * bod, lag + 0.03, pan, wB);
    } else {
      this._noise(0.01, 'highpass', H(5600 * V.rate), 1, sk * 0.07 * att * (1 - far), lag, pan, wT);
      this._noise(0.06, 'bandpass', H(2050 * j * V.rate), 1, sk * 0.16 * att, lag + 0.003, pan, wB);
      this._tone('square', 96 * j * V.rate, 0.04, sk * 0.045 * att, lag + 0.003, null, pan, wT);
      this._noise((0.16 + far * 0.3) * bod, 'lowpass', 800 * V.rate, 0.6, 0.05 * att * bod, lag + 0.02, pan, wB);
    }
    /* The hand-built treeline slap is GONE. It was one delayed noise burst
     * standing in for a room, and the convolver now returns the whole tail —
     * ground bounce, near trees, valley — from the same impulse for every
     * sound, so they finally share an acoustic space instead of each carrying
     * its own private echo. */
  },

  /* THE BLOOPER, and it is named for this sound.
   *
   * An M79 does not crack — it is a low-pressure 40 mm round leaving a short
   * fat tube, and what you hear is a hollow, almost comic *thoonk*: a soft
   * pitched thump with a puff of gas behind it and no high-frequency snap at
   * all. Synthesised rather than sampled precisely because it is the one
   * weapon in the game whose voice is NOT a rifle report, so none of the four
   * recordings can be bent into it.
   *
   * The falling pitch is the whole character: a short tone sliding down about
   * an octave is what makes the ear hear a tube rather than a barrel. */
  blooper(x) {
    if (!this.ok()) return;
    const { pan, att, far } = this._spatial(x);
    const w = 0.16 + far * 0.9;
    const j = rand(0.94, 1.07);
    // the hollow pitched thump, sliding down
    this._tone('sine', 300 * j, 0.13, 0.30 * att, 0, 150 * j, pan, w);
    this._tone('triangle', 190 * j, 0.10, 0.16 * att, 0.004, 96 * j, pan, w);
    // the gas puff behind it — soft, no snap
    this._noise(0.05, 'bandpass', this._hi(760 * j, far), 1.1, 0.16 * att, 0, pan, w);
    this._noise(0.16, 'lowpass', 420, 0.7, 0.07 * att, 0.02, pan, w + 0.2);
  },

  /* A round that misses and skips off something hard. Randomised so a burst
   * that goes wide sounds like several rounds, not one sample repeated. */
  ricochet(x) {
    if (!this.ok()) return;
    const { pan, att, far } = this._spatial(x);
    if (att < 0.25) return;
    const f0 = rand(1500, 3000), f1 = f0 * rand(0.25, 0.5);
    this._noise(0.05, 'bandpass', this._hi(f0, far), 6, 0.09 * att, 0, pan);
    this._tone('sawtooth', f0, rand(0.16, 0.30), 0.045 * att, 0.004, f1, pan);
  },

  /* Rocket leaving the tube: back-blast, then the motor running out. */
  rocket(x) {
    if (!this.ok()) return;
    const { pan, att, far } = this._spatial(x);
    this._noise(0.10, 'lowpass', this._hi(1400, far), 0.7, 0.30 * att, 0, pan);
    this._noise(0.42, 'bandpass', 900, 0.8, 0.16 * att, 0.02, pan);
    this._tone('sawtooth', 220, 0.34, 0.07 * att, 0.02, 90, pan);
  },

  /* A SNIPER RIFLE, which this was not.
   *
   * Reported as sounding like a BB gun, and the reason was structural: this is
   * a separate entry point from `shot`, so it never went through any of the
   * work done there. It got no sample — the `bolt` recording was mapped in
   * SAMPLES under keys that `shot` is never called with, so it was dead — no
   * distance handling, and no reverb send, which left it the one dry sound in
   * a game that now has a room.
   *
   * A .30 calibre bolt gun is not a quiet rifle, it is a LOUDER one with a
   * longer tail: a hard crack, a deep body, and a roll that goes on well after
   * an M16's has finished. It should be the most impressive report on the map,
   * because a sniper firing is the event the player is meant to notice. */
  sniperShot(x) {
    if (!this.ok()) return;
    this._loadSamples();
    const { pan, att, far } = this._spatial(x);
    const lag = far * 0.13;
    const j = rand(0.94, 1.06);
    const played = this._playSample('bolt', 0.95 * att * (1 - far * 0.4), pan, lag,
                                    0.22 + far * 1.2, j * (1 - far * 0.05));
    const sk = played ? 0.4 : 1.25;      // louder than a rifle even without it
    const H = (f) => this._hi(f, far);
    this._noise(0.014, 'highpass', H(5000), 1, sk * 0.13 * att * (1 - far), lag, pan, 0.12);
    this._noise(0.14, 'bandpass', H(2400), 0.8, sk * 0.34 * att, lag + 0.005, pan,
                0.5 + far * 1.2);
    this._tone('sine', 88 * j, 0.4, sk * 0.14 * att, lag + 0.005, 42, pan, 0.5);
    // the roll away, which is most of what says "big rifle" at any distance
    this._noise(0.95 + far * 0.5, 'lowpass', 650, 0.5, sk * 0.17 * att, lag + 0.03, pan,
                1.5 + far * 1.4);
    this._noise(1.7, 'lowpass', 300, 0.4, sk * 0.07 * att, lag + 0.16, pan, 2.2);
  },

  explosion(size = 1, x) {
    if (!this.ok()) return;
    const { pan, att } = this._spatial(x);
    /* A shell is a CRACK, then a body, then a long roll that is mostly room.
     * The old four layers gave the first two and stopped: a 46 Hz sine with
     * lowpassed noise on it is a thump, and a thump with no tail is a door
     * slamming. Most of the length of a real detonation outdoors is the valley
     * handing it back, which is why the tail layers go out at high send. */
    this._noise(0.006, 'highpass', 5200, 0.8, 0.30 * att, 0, pan, 0.05);     // ignition crack
    this._tone('sine', 64, 0.10, 0.45 * att, 0, 30, pan, 0.1);               // pressure snap
    this._tone('sine', 46, 0.9 * size, 0.5 * att, 0, 24, pan, 0.3);          // sub thump
    this._noise(0.5 * size, 'lowpass', 420, 0.5, 0.55 * att, 0, pan, 0.7);   // body
    this._noise(0.34 * size, 'bandpass', 900, 0.7, 0.22 * att, 0.01, pan, 0.8); // mid tear
    this._noise(1.1 * size, 'lowpass', 150, 0.4, 0.4 * att, 0.05, pan, 1.5); // roll
    this._noise(1.9 * size, 'lowpass', 240, 0.4, 0.16 * att, 0.14, pan, 2.2); // the valley
    this._noise(0.2, 'highpass', 3200, 1, 0.12 * att, 0, pan, 0.4);          // crack
    // debris patter — earth and stone coming back down, spread over a second
    for (let i = 0; i < 9; i++) {
      this._noise(0.04, 'bandpass', rand(900, 3400), 2.4, 0.045 * att,
                  rand(0.18, 1.05) * size, pan + rand(-0.2, 0.2), 0.6);
    }
  },

  shellWhistle(delay = 0) {
    if (!this.ok()) return;
    this._tone('sine', 1900, 1.1, 0.05, delay, 500);
  },

  napalmWhoosh(x) {
    if (!this.ok()) return;
    const { pan, att } = this._spatial(x);
    this._noise(1.6, 'lowpass', 900, 0.4, 0.42 * att, 0, pan);
    this._noise(2.6, 'bandpass', 500, 0.6, 0.22 * att, 0.3, pan);
    this._noise(3.2, 'bandpass', 300, 0.5, 0.1 * att, 0.8, pan);
  },

  jet() {
    if (!this.ok()) return;
    this._noise(2.2, 'bandpass', 800, 2, 0.25);
    this._tone('sawtooth', 140, 2.0, 0.05, 0, 60);
  },

  chopper(dur = 4) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 300;
    const g = this.ctx.createGain();
    const lfo = this.ctx.createOscillator();
    lfo.type = 'square'; lfo.frequency.value = 11;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 0.14;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.8);
    g.gain.setValueAtTime(0.16, t + dur - 1);
    g.gain.linearRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur); lfo.start(t); lfo.stop(t + dur);
  },

  bomberRumble(dur = 5) {
    if (!this.ok()) return;
    this._noise(dur, 'lowpass', 120, 0.5, 0.3);
    this._tone('sawtooth', 55, dur, 0.1);
  },

  radio() {
    if (!this.ok()) return;
    this._tone('square', 1100, 0.06, 0.06);
    this._tone('square', 1400, 0.06, 0.06, 0.09);
    this._noise(0.18, 'bandpass', 1800, 3, 0.04, 0.16);
  },

  click() {
    if (!this.ok()) return;
    this._tone('square', 700, 0.04, 0.06);
  },

  deny() {
    if (!this.ok()) return;
    this._tone('square', 220, 0.12, 0.07);
  },

  trapSpring(x) {
    if (!this.ok()) return;
    const { pan, att } = this._spatial(x);
    this._noise(0.15, 'highpass', 2500, 1, 0.2 * att, 0, pan);
    this._tone('sine', 300, 0.25, 0.15 * att, 0.02, 90, pan);
  },

  shovel(x) {
    if (!this.ok()) return;
    const { pan, att } = this._spatial(x);
    this._noise(0.2, 'lowpass', 600, 1, 0.15 * att, 0, pan);
    this._noise(0.15, 'bandpass', 1200, 2, 0.08 * att, 0.12, pan);
  },

  glintPing() {
    if (!this.ok()) return;
    this._tone('sine', 2400, 0.3, 0.04);
  },

  bell(win) {
    if (!this.ok()) return;
    if (win) {
      [523, 659, 784, 1046].forEach((f, i) => this._tone('sine', f, 0.7, 0.12, i * 0.16));
    } else {
      [392, 330, 262, 196].forEach((f, i) => this._tone('sine', f, 0.8, 0.12, i * 0.2));
    }
  },

  /* Each map gets its own room.
   *
   * A tunnel complex under dense jungle and an open highland valley do not
   * sound remotely alike, and the reverb is where that lives — it is a bigger
   * carrier of place than the ambient bed layered on top of it. Cu Chi is
   * short and dead, because close canopy absorbs; Ia Drang is long, because
   * that is a valley with a massif on one side; Khe Sanh is a bare plateau, so
   * it returns hard and bright. Rebuilt on map start, which costs one buffer.
   */
  ROOMS: {
    iadrang: [2.4, 2.0],    // valley under the Chu Pong massif — long, open
    cuchi:   [1.0, 3.4],    // dense canopy, absorbent, dies fast
    mekong:  [1.6, 2.4],    // flat water and paddy, some slap off nothing
    khesanh: [2.0, 1.7],    // bare red plateau, hard returns
    hill937: [1.3, 2.9],    // wet ridge in monsoon; rain and mud eat the tail
  },

  ambientStart(map) {
    if (!this.ctx) return;
    this.ambientStop();
    if (this.conv) {
      const r = this.ROOMS[map && map.id] || [1.5, 2.6];
      try { this.conv.buffer = this._makeIR(r[0], r[1]); } catch (e) { /* keep the old room */ }
    }
    const nodes = [];
    // low jungle air
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = map.weather && map.weather.rain ? 1600 : 500;
    const g = this.ctx.createGain();
    g.gain.value = map.weather && map.weather.rain ? 0.06 : 0.025;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    nodes.push(src);
    // insect shimmer (dry maps only)
    if (!(map.weather && map.weather.rain)) {
      const src2 = this.ctx.createBufferSource();
      src2.buffer = this._noiseBuf; src2.loop = true;
      const f2 = this.ctx.createBiquadFilter();
      f2.type = 'bandpass'; f2.frequency.value = 5200; f2.Q.value = 8;
      const g2 = this.ctx.createGain();
      g2.gain.value = 0.012;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.4;
      const lg = this.ctx.createGain(); lg.gain.value = 0.008;
      lfo.connect(lg); lg.connect(g2.gain);
      src2.connect(f2); f2.connect(g2); g2.connect(this.master);
      src2.start(); lfo.start();
      nodes.push(src2, lfo);
    }
    this.ambient = nodes;
  },

  ambientStop() {
    if (this.ambient) {
      this.ambient.forEach(n => { try { n.stop(); } catch (e) {} });
      this.ambient = null;
    }
  },
};
