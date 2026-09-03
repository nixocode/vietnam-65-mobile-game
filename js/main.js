'use strict';

const App = {
  state: 'menu',
  game: null,
  mission: null, // campaign index or null for skirmish
  speed: 1,
  lastT: 0,
  time: 0,
  resultShown: false,
  resultDelay: 0,
  skirmish: { side: 'us', map: 'iadrang', diff: 'veteran' },

  /* Scale the 1280x720 UI design to the real stage size.
   *
   * Guarded, because a bad reading here is invisible and permanent. Called at
   * boot before layout has settled, `stage.clientWidth` reports the unstyled
   * width and this computed k = 1 — leaving the HUD at its full 1280x720 on a
   * 667x375 stage, with the card bar at y 628 and the squad panel at y 578,
   * both far below a 375px viewport. Nothing corrected it afterwards, because
   * the ResizeObserver only fires when the stage CHANGES size and a phone
   * loading straight into landscape never changes it.
   *
   * So: ignore implausible widths rather than committing them, and re-run once
   * layout is real (see boot).
   */
  /* SIZE FROM THE VIEWPORT THE BROWSER ACTUALLY LEAVES.
   *
   * The stage used to be sized in CSS with `min(100vw, calc(100vh * 16/9))`,
   * and on iOS `vh` is the LARGE viewport — the height with the browser chrome
   * hidden. Safari was not hiding its chrome, so the stage was sized against a
   * screen taller than the one that existed: the height overflowed, the 16:9
   * rule shrank the width to compensate, and the remainder became black bars
   * down both sides. That is the letterboxing in the owner's screenshot, under
   * a URL bar and a tab strip taking a quarter of the display.
   *
   * `100dvh` fixes it on paper and is already on `body`, but it is not on every
   * iOS the game will meet and it says nothing about width. `visualViewport` is
   * the only thing that reports what is genuinely on screen right now, through
   * chrome appearing, chrome collapsing, and the keyboard — so the layout is
   * driven from it and the CSS units are left as the fallback.
   */
  _fitViewport() {
    const app = document.getElementById('app');
    const stage = document.getElementById('stage');
    if (!app || !stage) return;
    const vv = window.visualViewport;
    const vw = Math.round(vv ? vv.width : window.innerWidth);
    const vh = Math.round(vv ? vv.height : window.innerHeight);
    if (!(vw > 0 && vh > 0)) return;          // pre-layout; committing 0 blanks it
    app.style.width = vw + 'px';
    app.style.height = vh + 'px';
    /* A touch build fills what it is given; a desktop one keeps its 16:9 box.
     * Both are computed here rather than in CSS so neither depends on which
     * viewport unit this browser believes in. */
    if (document.body.classList.contains('touch')) {
      stage.style.width = '';
      stage.style.height = '';
    } else {
      const w = Math.min(vw, vh * CANVAS_W / CANVAS_H);
      stage.style.width = Math.round(w) + 'px';
      stage.style.height = Math.round(w * CANVAS_H / CANVAS_W) + 'px';
    }
    this._fitUI();
  },

  _fitUI() {
    const stage = document.getElementById('stage');
    if (!stage) return;
    const w = stage.clientWidth;
    if (!(w > 0)) return;                 // pre-layout; a 0 here would blank the UI
    const k = w / CANVAS_W;
    stage.style.setProperty('--uiK', k);
    /* The HUD box takes the STAGE's shape, not the design one.
     *
     * `#hud` is 1280x720 scaled by --uiK, which lands exactly on a 16:9 stage.
     * On a phone filling a 2.16:1 screen the scaled box is ~85px taller than
     * the screen, so everything anchored to its bottom — the card bar, the CP
     * readout — falls off the end of the display. Expressed in design pixels,
     * the box the HUD should occupy is the stage height divided back out of
     * the scale. */
    const h = stage.clientHeight;
    if (h > 0) stage.style.setProperty('--uiH', (h / k) + 'px');
  },

  boot() {
    const canvas = document.getElementById('game-canvas');
    this._fitViewport();
    /* Re-run once layout is real. The call above can land before the stylesheet
     * has sized the stage, and the observer below only fires on a CHANGE — so a
     * device that loads straight into its final size would keep the bad value
     * forever. rAF covers the normal case, `load` covers a late stylesheet. */
    requestAnimationFrame(() => this._fitViewport());
    window.addEventListener('load', () => this._fitViewport());
    if (window.ResizeObserver) {
      new ResizeObserver(() => this._fitUI()).observe(document.getElementById('stage'));
    }
    window.addEventListener('resize', () => this._fitViewport());
    window.addEventListener('orientationchange', () => setTimeout(() => this._fitViewport(), 120));
    /* The events that actually fire when mobile chrome moves.
     *
     * `window.resize` is not reliably dispatched when Safari collapses its tab
     * strip or Chrome hides its address bar — the layout viewport is unchanged,
     * only the VISUAL one moved. These two are the signal, and without them the
     * game keeps drawing into space the browser has just taken back. */
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this._fitViewport());
      window.visualViewport.addEventListener('scroll', () => this._fitViewport());
    }
    Renderer.init(canvas);
    UI.init(canvas);
    // after UI, so the drag-suppression click listener is registered against a
    // canvas that already has UI's own handler on it
    Mobile.init();
    /* Re-fit the moment `body.touch` exists.
     *
     * `_fitViewport` branches on that class, and it runs at the top of boot —
     * before Mobile.init has added it. So the first fit took the DESKTOP branch
     * and wrote an explicit 16:9 box onto the stage in inline pixels; the touch
     * branch only clears those on a later call. A stray rAF happened to cover
     * it one frame afterwards, which is a letterbox flash on every load and a
     * permanent letterbox the moment that rAF is reordered. */
    this._fitViewport();
    this._wireMenus();
    const status = document.getElementById('load-status');
    Sprite3D.load();                  // soldiers rendered off the 3D rig
    Props.load(() => { if (this.game) Renderer.buildStatic(this.game); });
    Assets.init(p => {
      if (!status) return;
      if (p >= 1) {
        status.textContent = '';
        status.classList.add('hidden');
        if (UI.game && UI.active) UI._buildCards(); // upgrade icons to sprites
      } else {
        status.textContent = `LOADING FIELD ASSETS — ${Math.round(p * 100)}%`;
      }
    });
    document.addEventListener('pointerdown', () => Sound.init(), { once: false });
    document.addEventListener('keydown', e => this._onKey(e));
    requestAnimationFrame(t => this._frame(t));
  },

  /* ---------- screens ---------- */
  show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    if (id) document.getElementById(id).classList.remove('hidden');
  },

  _wireMenus() {
    const el = id => document.getElementById(id);

    el('btn-skirmish').onclick = () => { Sound.click(); this._buildSkirmish(); this.show('screen-skirmish'); };
    el('btn-campaign').onclick = () => { Sound.click(); this._buildCampaign(); this.show('screen-campaign'); };
    el('btn-help').onclick = () => { Sound.click(); this.show('screen-help'); };
    el('btn-help-back').onclick = () => { Sound.click(); this.show(this.state === 'menu' ? 'screen-menu' : null); };
    el('btn-skirmish-back').onclick = () => { Sound.click(); this.show('screen-menu'); };
    el('btn-campaign-back').onclick = () => { Sound.click(); this.show('screen-menu'); };
    el('btn-skirmish-start').onclick = () => {
      Sound.click();
      this.mission = null;
      this.startGame({ mapId: this.skirmish.map, playerSide: this.skirmish.side, difficulty: this.skirmish.diff });
    };

    el('btn-brief-back').onclick = () => { Sound.click(); this._buildCampaign(); this.show('screen-campaign'); };
    el('btn-brief-start').onclick = () => {
      Sound.click();
      const m = CAMPAIGN[this.mission];
      this.startGame({ mapId: m.map, playerSide: m.side, difficulty: m.diff });
    };

    el('btn-pause').onclick = () => this.togglePause();
    el('btn-speed').onclick = () => this.toggleSpeed();
    el('btn-mute').onclick = () => this.toggleMute();
    el('btn-resume').onclick = () => this.togglePause();
    el('btn-restart').onclick = () => {
      Sound.click();
      const g = this.game;
      this.startGame({ mapId: g.map.id, playerSide: g.player, difficulty: this._diffId(g) });
    };
    el('btn-abort').onclick = () => { Sound.click(); this.quitToMenu(); };

    el('btn-result-replay').onclick = () => {
      Sound.click();
      const g = this.game;
      this.startGame({ mapId: g.map.id, playerSide: g.player, difficulty: this._diffId(g) });
    };
    el('btn-result-menu').onclick = () => { Sound.click(); this.quitToMenu(); };
    el('btn-next-mission').onclick = () => {
      Sound.click();
      this.mission++;
      this._showBriefing(this.mission);
    };

    // skirmish pickers
    document.querySelectorAll('.faction-card').forEach(fc => {
      fc.onclick = () => {
        Sound.click();
        document.querySelectorAll('.faction-card').forEach(x => x.classList.remove('selected'));
        fc.classList.add('selected');
        this.skirmish.side = fc.dataset.side;
      };
    });
    document.querySelectorAll('.diff-btn').forEach(db => {
      db.onclick = () => {
        Sound.click();
        document.querySelectorAll('.diff-btn').forEach(x => x.classList.remove('selected'));
        db.classList.add('selected');
        this.skirmish.diff = db.dataset.diff;
      };
    });
  },

  _diffId(g) {
    for (const k in DIFFS) if (DIFFS[k] === g.diff) return k;
    return 'veteran';
  },

  _buildPerks() {
    const wrap = document.getElementById('perk-pick');
    if (!wrap) return;
    const st = Perks.state();
    document.getElementById('perk-points').textContent = st.points + ' CMD';
    wrap.innerHTML = '';
    for (const id in PERKS) {
      const d = PERKS[id];
      const owned = !!st.owned[id];
      const afford = st.points >= d.cost;
      const b = document.createElement('button');
      b.className = 'perk-card' + (owned ? ' owned' : (afford ? '' : ' locked'));
      b.innerHTML = `<div class="pk-name">${d.name}<span class="pk-cost">${d.cost}</span></div>` +
        `<div class="pk-desc">${d.desc}</div>`;
      if (!owned && afford) {
        b.onclick = () => { Sound.click(); if (Perks.buy(id)) this._buildPerks(); };
      }
      wrap.appendChild(b);
    }
  },

  _buildSkirmish() {
    this._buildPerks();
    const pick = document.getElementById('map-pick');
    if (pick.childElementCount) return;
    for (const id of MAP_ORDER) {
      const m = MAPS[id];
      const card = document.createElement('button');
      card.className = 'map-card' + (id === this.skirmish.map ? ' selected' : '');
      const thumb = document.createElement('canvas');
      drawMapThumb(thumb, m);
      card.appendChild(thumb);
      card.insertAdjacentHTML('beforeend',
        `<div class="mc-name">${m.name}</div>
         <div class="mc-year">${m.year}${m.mode !== 'standard' ? ' · ' + m.mode.toUpperCase() : ''}</div>
         <div class="mc-desc">${m.desc}</div>`);
      card.onclick = () => {
        Sound.click();
        document.querySelectorAll('.map-card').forEach(x => x.classList.remove('selected'));
        card.classList.add('selected');
        this.skirmish.map = id;
      };
      pick.appendChild(card);
    }
  },

  _progress() {
    return parseInt(localStorage.getItem('v65_campaign') || '0', 10);
  },

  _buildCampaign() {
    const list = document.getElementById('mission-list');
    list.innerHTML = '';
    const done = this._progress();
    CAMPAIGN.forEach((m, i) => {
      const map = MAPS[m.map];
      const locked = i > done;
      const row = document.createElement('button');
      row.className = 'mission-row' + (locked ? ' locked' : '');
      row.innerHTML =
        `<div class="m-check">${i < done ? '✔' : ''}</div>
         <div class="m-num">${i + 1}</div>
         <div>
           <div class="m-name">${m.title}</div>
           <div class="m-meta">${map.name} · ${map.year}</div>
         </div>
         <div class="m-side ${m.side}">${locked ? 'LOCKED' : 'PLAY AS ' + FACTIONS[m.side].name}</div>`;
      if (!locked) {
        row.onclick = () => { Sound.click(); this.mission = i; this._showBriefing(i); };
      }
      list.appendChild(row);
    });
  },

  _showBriefing(i) {
    const m = CAMPAIGN[i];
    document.getElementById('brief-title').textContent = `OPERATION ${i + 1}: ${m.title}`;
    document.getElementById('brief-meta').textContent = m.meta;
    document.getElementById('brief-objectives').innerHTML =
      m.objectives.map(o => `<div class="${m.side === 'vc' ? 'obj-vc' : ''}">${o}</div>`).join('');
    this.show('screen-briefing');
    // typewriter reveal
    const body = document.getElementById('brief-body');
    body.textContent = '';
    const text = m.brief;
    let pos = 0;
    clearInterval(this._typeTimer);
    this._typeTimer = setInterval(() => {
      pos += 3;
      body.textContent = text.slice(0, pos);
      if (pos >= text.length) clearInterval(this._typeTimer);
    }, 12);
  },

  /* ---------- game lifecycle ---------- */
  startGame(cfg) {
    clearInterval(this._typeTimer);
    this.lastT = 0;                    // a new match starts its own clock
    this.game = new Game(cfg);
    Renderer.buildStatic(this.game);
    Camera.reset(cfg.playerSide === 'us' ? 0 : WORLD_W);
    UI.bind(this.game);
    UI.active = true;
    this.state = 'playing';
    this.speed = 1;
    document.getElementById('btn-speed').textContent = '1×';
    this.resultShown = false;
    this.resultDelay = 0;
    this.show(null);
    document.getElementById('hud').classList.remove('hidden');
    Sound.init();
    Sound.ambientStart(this.game.map);
    this.game.setBanner(this.game.map.name, false);
    this.game.emit(`${this.game.map.name} — ${this.game.map.year}`, 'sys');
    this.game.emit(this.game.objectiveText(), 'sys');
  },

  quitToMenu() {
    this.state = 'menu';
    this.game = null;
    UI.active = false;
    Sound.ambientStop();
    document.getElementById('hud').classList.add('hidden');
    this.show('screen-menu');
  },

  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      UI.active = false;
      this.show('screen-pause');
    } else if (this.state === 'paused') {
      this.state = 'playing';
      UI.active = true;
      this.show(null);
    }
    Sound.click();
  },

  toggleSpeed() {
    this.speed = this.speed === 1 ? 2 : 1;
    document.getElementById('btn-speed').textContent = `${this.speed}×`;
    Sound.click();
  },

  toggleMute() {
    Sound.init();
    Sound.setMuted(!Sound.muted);
    document.getElementById('btn-mute').classList.toggle('off', Sound.muted);
  },

  _onKey(e) {
    // frame-time readout: F is already speed, so this lives on ` / F3
    if (e.key === '`' || e.key === 'F3') {
      Renderer.showPerf = !Renderer.showPerf;
      e.preventDefault();
      return;
    }
    if (this.state === 'playing' || this.state === 'paused') {
      const squadKeys = UI.selectedSquad != null; // A/S/etc become order keys
      if (e.key === 'ArrowLeft' || (!squadKeys && (e.key === 'a' || e.key === 'A'))) { Camera.pan(-260); return; }
      if (e.key === 'ArrowRight' || (!squadKeys && (e.key === 'd' || e.key === 'D'))) { Camera.pan(260); return; }
    }
    if (e.repeat) return;
    if (this.state === 'playing') {
      if (UI.handleKey(e.key)) { e.preventDefault(); return; }
      if (e.key === 'p' || e.key === 'P') this.togglePause();
      else if (e.key === 'f' || e.key === 'F') this.toggleSpeed();
      else if (e.key === 'm' || e.key === 'M') this.toggleMute();
    } else if (this.state === 'paused' && (e.key === 'p' || e.key === 'P' || e.key === 'Escape')) {
      this.togglePause();
    }
  },

  _showResult() {
    const g = this.game;
    const won = g.result.winner === g.player;
    const title = document.getElementById('result-title');
    title.textContent = won ? 'VICTORY' : 'DEFEAT';
    title.className = won ? 'win' : 'lose';
    document.getElementById('result-sub').textContent = g.result.reason;
    const my = g.stats[g.player], their = g.stats[g.enemy];
    const mins = Math.floor(g.time / 60), secs = Math.floor(g.time % 60);
    document.getElementById('result-stats').innerHTML = `
      <div class="rs-label">Duration</div><div class="rs-value">${mins}:${secs.toString().padStart(2, '0')}</div>
      <div class="rs-label">Enemy casualties</div><div class="rs-value">${my.kills}</div>
      <div class="rs-label">Own casualties</div><div class="rs-value">${my.losses}</div>
      <div class="rs-label">CP expended</div><div class="rs-value">${Math.floor(my.cpSpent)}</div>
      <div class="rs-label">Support / works used</div><div class="rs-value">${my.callins}</div>
      <div class="rs-label">Enemy morale remaining</div><div class="rs-value">${Math.ceil(g.morale[g.enemy])}%</div>`;
    const nextBtn = document.getElementById('btn-next-mission');
    const isCampaign = this.mission != null;
    if (isCampaign && won) {
      const done = this._progress();
      if (this.mission + 1 > done) localStorage.setItem('v65_campaign', String(this.mission + 1));
    }
    // commendation points, earned by how the fight actually went
    const earned = Perks.award(g);
    if (earned > 0) {
      document.getElementById('result-stats').insertAdjacentHTML('beforeend',
        `<div class="rs-label">Commendation</div><div class="rs-value">+${earned} CMD</div>`);
    }
    nextBtn.classList.toggle('hidden', !(isCampaign && won && this.mission + 1 < CAMPAIGN.length));
    UI.active = false;
    this.show('screen-result');
  },

  /* ---------- loop ---------- */
  _frame(t) {
    // Clamped at BOTH ends. There was no lower bound, so any backwards timestamp
    // produced a negative dt, and every `x += rate * dt` in the sim ran in
    // reverse — CP drained below zero and neither side could buy anything.
    const raw = (t - this.lastT) / 1000;
    const dt = raw > 0 ? Math.min(0.05, raw) : 0.016;
    this.lastT = t;
    this.time += dt;

    if (this.state === 'playing' || this.state === 'paused' || this.state === 'result') {
      // mouse-edge scroll, Warfare 1944 style
      if ((this.state === 'playing' || this.state === 'paused') && UI.mouseX != null) {
        const EDGE = 34, SPEED = 1150;
        if (UI.mouseX < EDGE) Camera.pan(-SPEED * dt * (1 - UI.mouseX / EDGE));
        else if (UI.mouseX > CANVAS_W - EDGE) Camera.pan(SPEED * dt * (1 - (CANVAS_W - UI.mouseX) / EDGE));
      }
      Camera.update(dt);
      if (this.state === 'playing' && this.game) {
        /* Hit-stop: a few frames of near-freeze on a kill or heavy blast. Drained
         * against REAL time, not the slowed sim clock, or it would stretch its own
         * recovery and read as a stutter instead of a punch. */
        const fx = this.game.fx;
        let simDt = dt;
        if (fx && fx.hitStop > 0) {
          fx.hitStop = Math.max(0, fx.hitStop - dt);
          simDt = dt * 0.16;
        }
        for (let i = 0; i < this.speed; i++) this.game.update(simDt);
        UI.update(dt);
        if (this.game.over && !this.resultShown) {
          this.resultDelay += dt;
          if (this.resultDelay > 2.2) {
            this.resultShown = true;
            this.state = 'result';
            this._showResult();
          }
        }
      }
      if (this.game) Renderer.render(this.game, this.state === 'playing' ? UI : null, this.time);
    } else {
      Renderer.drawMenu(this.time);
    }
    requestAnimationFrame(tt => this._frame(tt));
  },
};

window.addEventListener('DOMContentLoaded', () => App.boot());
