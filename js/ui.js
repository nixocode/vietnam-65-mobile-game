'use strict';

const UI = {
  game: null,
  active: false,
  armedUnit: null,
  armedCallin: null,
  hoverLane: null,
  hoverX: null,
  tickerItems: [],
  bannerT: 0,
  unitKeys: [],
  callinKeys: [],

  els: {},

  mouseX: null, // screen-space, for edge scrolling
  mouseY: null,

  init(canvas) {
    this.canvas = canvas;
    const el = id => document.getElementById(id);
    this.els = {
      hud: el('hud'),
      cpValue: el('cp-value'),
      moraleUs: el('morale-fill-us'),
      moraleVc: el('morale-fill-vc'),
      flagPips: el('flag-pips'),
      objective: el('objective-line'),
      unitCards: el('unit-cards'),
      callinCards: el('callin-cards'),
      ticker: el('ticker'),
      banner: el('banner'),
      targetHint: el('target-hint'),
      minimap: el('minimap'),
    };

    canvas.addEventListener('mousemove', e => this._onMove(e));
    canvas.addEventListener('click', e => this._onClick(e));
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); this.disarm(); });
    canvas.addEventListener('mouseleave', () => { this.hoverLane = null; this.hoverX = null; this.mouseX = null; });
    canvas.addEventListener('wheel', e => {
      if (!this.active) return;
      e.preventDefault();
      Camera.pan((e.deltaX + e.deltaY) * 1.4);
    }, { passive: false });
    if (this.els.minimap) {
      this.els.minimap.addEventListener('click', e => {
        if (!this.active) return;
        const r = this.els.minimap.getBoundingClientRect();
        const wx = ((e.clientX - r.left) / r.width) * WORLD_W;
        Camera.center(wx);
      });
    }
  },

  bind(game) {
    this.game = game;
    this.armedUnit = null;
    this.armedCallin = null;
    this.selectedSquad = null;
    this._refreshSquadPanel();
    this.tickerItems = [];
    this.els.ticker.innerHTML = '';
    this.els.banner.className = '';
    this.bannerT = 0;
    document.body.classList.toggle('side-vc', game.player === 'vc');
    this._buildCards();
    this._buildPips();
  },

  /* Turn a squad's real unit data into 0-4 pips.
   *
   * Read from UNITS rather than authored per card, so a stat tweak in data.js
   * cannot silently disagree with what the card advertises. Firepower is
   * damage x rate, because either alone is misleading — a sniper's 999 damage
   * at 0.3 rounds/sec is not four pips of sustained fire, and an MG's 6 damage
   * at 9 rounds/sec is.
   */
  _pips(key) {
    const d = SQUADS[key];
    const u = UNITS[d.comp[0]];
    if (!u) return { fire: 0, tough: 0, reach: 0 };
    const men = d.comp.length;
    // sniper damage is a one-shot-kill sentinel; score it as high-but-finite
    const dmg = u.dmg > 100 ? 26 : u.dmg;
    const dps = dmg * (u.rof || 1) * men;
    const q = (v, steps) => {
      let n = 0;
      for (const t of steps) if (v >= t) n++;
      return Math.max(1, Math.min(4, n));
    };
    return {
      fire:  q(dps,        [0, 60, 150, 300]),
      tough: q(u.hp * men, [0, 90, 160, 240]),
      reach: q(u.range,    [0, 290, 340, 600]),
    };
  },

  _pipRow(key) {
    const p = this._pips(key);
    const row = (n, cls) => {
      let h = `<span class="pip-row ${cls}">`;
      for (let i = 0; i < 4; i++) h += `<i class="${i < n ? 'on' : ''}"></i>`;
      return h + '</span>';
    };
    return row(p.fire, 'fire') + row(p.tough, 'tough');
  },

  /* Hover detail, in the spirit of the reference art: who they are, what they
   * do, and what it costs — without making the player memorise a wiki. Built
   * from UNITS and SQUADS so it cannot drift from the sim. */
  _showInfo(key) {
    const el = document.getElementById('unit-info');
    if (!el) return;
    const d = SQUADS[key];
    const u = UNITS[d.comp[0]] || {};
    const p = this._pips(key);
    const g = this.game;
    const bar = (n) => {
      let h = '';
      for (let i = 0; i < 4; i++) h += `<i class="${i < n ? 'on' : ''}"></i>`;
      return h;
    };
    /* Order matters: the APC carries `mg` AND `vehicle`, so testing mg first
     * labelled an armoured personnel carrier "Support / Suppression". Most
     * specific class wins. */
    const role = u.vehicle ? 'Armour' : u.sniper ? 'Marksman'
      : u.at ? 'Anti-Armour' : u.sapper ? 'Demolition'
      : u.engineer ? 'Engineer' : u.mg ? 'Support / Suppression'
      : 'Line Infantry';
    /* MOST DISTINCTIVE FIRST — the panel shows one line, and every VC unit
     * carries `conceal`, so listing it early buried what actually makes each
     * one different: the RPG team advertised "conceals in brush" instead of
     * "rocket ignores armour". Shared traits go last. */
    const traits = [];
    if (u.at) traits.push('Rocket ignores armour');
    if (u.sapper) traits.push('Satchel charge kills armour outright');
    if (u.sniper) traits.push('One shot, one kill — but slow to lay the sight');
    if (u.engineer) traits.push('Clears mines and punji stakes ahead of the advance');
    if (u.armour) traits.push('Armoured — small arms barely scratch it');
    if (u.detect) traits.push('Spots concealed enemies at range');
    if (u.suppress) traits.push('Suppresses — slows and spoils their aim');
    if (u.ambush > 1.4) traits.push('Hits hard from an ambush');
    if (u.small) traits.push('Cheap and quick, but fragile');
    if (u.conceal) traits.push('Conceals in brush until he fires');
    if (!traits.length) traits.push('The backbone — no tricks, just rifles');
    const affordable = g && g.cp[g.player] >= d.cost;
    el.innerHTML = `
      <div class="ui-head">
        <div class="ui-name">${d.name.toUpperCase()}</div>
        <div class="ui-role">${role} · ${d.comp.length === 1 ? '1 man' : d.comp.length + ' men'}</div>
      </div>
      <div class="ui-stats">
        <div><span>FIREPOWER</span><em>${bar(p.fire)}</em></div>
        <div><span>TOUGHNESS</span><em>${bar(p.tough)}</em></div>
        <div><span>REACH</span><em>${bar(p.reach)}</em></div>
      </div>
      ${traits.length ? `<div class="ui-trait">${traits[0]}</div>` : ''}
      <div class="ui-cost ${affordable ? '' : 'short'}">${d.cost} CP</div>`;
    el.classList.remove('hidden');
  },

  _hideInfo() {
    const el = document.getElementById('unit-info');
    if (el) el.classList.add('hidden');
  },

  _buildCards() {
    const g = this.game;
    this.els.unitCards.innerHTML = '';
    this.els.callinCards.innerHTML = '';
    this.unitKeys = ROSTERS[g.player];
    this.callinKeys = CALLIN_ROSTERS[g.player];
    this.cardEls = {};

    /* GROUP RAILS. Seven cards in one undivided row is a list, and a list is
     * read left to right until the wanted thing turns up. Grouped under LINE /
     * SUPPORT / SPECIAL it becomes three short lists chosen by what the player
     * already knows they want — hold ground, put down fire, or do a job — which
     * is how a field manual organises the same information.
     *
     * Groups are emitted in the order the roles first appear in the roster, so
     * ROSTERS controls the layout and this does not need its own ordering. */
    let rail = null, railRole = null;
    this.unitKeys.forEach((key, i) => {
      const d = SQUADS[key];
      if (d.role !== railRole) {
        railRole = d.role;
        const grp = document.createElement('div');
        grp.className = 'card-group';
        grp.insertAdjacentHTML('beforeend',
          `<div class="group-label">${ROLE_LABEL[d.role] || ''}</div>`);
        rail = document.createElement('div');
        rail.className = 'group-rail';
        grp.appendChild(rail);
        this.els.unitCards.appendChild(grp);
      }
      const card = document.createElement('div');
      card.className = 'card';
      card.title = `${d.name} (${d.sub}) — ${d.cost} CP`;
      const ic = document.createElement('canvas');
      const port = typeof Assets !== 'undefined' ? Assets.img(d.portrait) : null;
      if (port) {
        ic.width = 88; ic.height = 76;
        const ictx = ic.getContext('2d');
        const s = Math.max(88 / port.width, 76 / port.height);
        ictx.drawImage(port, 44 - port.width * s / 2, 38 - port.height * s / 2,
          port.width * s, port.height * s);
      } else {
        drawUnitIcon(ic, d.comp[0]);
      }
      card.appendChild(ic);
      card.insertAdjacentHTML('beforeend',
        `<div class="card-name">${d.name.toUpperCase()}</div>
         <div class="card-cost">${d.cost}</div>
         <div class="card-key">${i + 1}</div>
         <div class="card-men">×${d.comp.length}</div>
         <div class="card-pips">${this._pipRow(key)}</div>
         <div class="card-cd"></div>`);
      card.addEventListener('click', () => this.armUnit(key));
      card.addEventListener('mouseenter', () => this._showInfo(key));
      card.addEventListener('mouseleave', () => this._hideInfo());
      rail.appendChild(card);
      this.cardEls[key] = card;
    });

    this.callinKeys.forEach(key => {
      const d = CALLINS[key];
      const card = document.createElement('div');
      card.className = 'card callin';
      card.title = `${d.name} — ${d.cost} CP`;
      const ic = document.createElement('canvas');
      drawCallinIcon(ic, d.icon);
      card.appendChild(ic);
      card.insertAdjacentHTML('beforeend',
        `<div class="card-name">${d.name.toUpperCase()}</div>
         <div class="card-cost">${d.cost}</div>
         <div class="card-key">${d.key}</div>
         <div class="card-cd"></div>`);
      card.addEventListener('click', () => this.armCallin(key));
      this.els.callinCards.appendChild(card);
      this.cardEls[key] = card;
    });
  },

  _buildPips() {
    this.els.flagPips.innerHTML = '';
    this.pipEls = [];
    for (let i = 0; i < LANE_N; i++) {
      const p = document.createElement('div');
      p.className = 'flag-pip';
      this.els.flagPips.appendChild(p);
      this.pipEls.push(p);
    }
  },

  armUnit(key) {
    if (!this.active) return;
    const g = this.game, d = SQUADS[key];
    if ((g.cool[g.player][key] || 0) > 0 || g.cp[g.player] < d.cost) { Sound.deny(); return; }
    Sound.click();
    this.armedCallin = null;
    this.armedUnit = this.armedUnit === key ? null : key;
    this._hint(this.armedUnit ? 'SELECT LANE TO DEPLOY' : null);
    this._refreshArmed();
  },

  armCallin(key) {
    if (!this.active) return;
    const g = this.game, d = CALLINS[key];
    if ((g.cool[g.player][key] || 0) > 0 || g.cp[g.player] < d.cost) { Sound.deny(); return; }
    Sound.click();
    this.armedUnit = null;
    if (d.target === 'none') {
      this.armedCallin = null;
      g.tryCallin(g.player, key, null, null);
      this._refreshArmed();
      return;
    }
    this.armedCallin = this.armedCallin === key ? null : key;
    this._hint(this.armedCallin ? d.hint : null);
    this._refreshArmed();
  },

  disarm() {
    this.armedUnit = null;
    this.armedCallin = null;
    this._hint(null);
    this._refreshArmed();
  },

  _hint(text) {
    if (text) {
      this.els.targetHint.textContent = text;
      this.els.targetHint.classList.remove('hidden');
    } else {
      this.els.targetHint.classList.add('hidden');
    }
  },

  _refreshArmed() {
    for (const k in this.cardEls) {
      this.cardEls[k].classList.toggle('armed', k === this.armedUnit || k === this.armedCallin);
    }
  },

  /* Screen point -> design point, for a canvas drawn with `object-fit: cover`.
   *
   * This used to map the element box linearly onto 1280x720, which is only
   * right while the element IS 16:9. On a phone the stage now fills a screen
   * wider than that and the bitmap is cropped top and bottom, so a linear map
   * put every click about sixty design pixels low — enough to pick the wrong
   * lane near a band edge. Solving for the cover transform costs two lines and
   * is exact in both cases: on an exactly-16:9 box the offsets fall out to
   * zero and this reduces to what it replaced. */
  _canvasPos(e) {
    const r = this.canvas.getBoundingClientRect();
    const s = Math.max(r.width / CANVAS_W, r.height / CANVAS_H);
    const ox = (r.width - CANVAS_W * s) / 2;    // negative where it is cropped
    const oy = (r.height - CANVAS_H * s) / 2;
    return {
      x: (e.clientX - r.left - ox) / s,
      y: (e.clientY - r.top - oy) / s,
    };
  },

  _laneAt(y) {
    for (let i = 0; i < LANE_N; i++) {
      if (y >= LANE_BANDS[i][0] && y < LANE_BANDS[i][1]) return i;
    }
    // below the last band still counts as the front lane, so a click near the
    // bottom edge is not dead space
    return y >= LANE_BANDS[LANE_N - 1][1] ? LANE_N - 1 : null;
  },

  _onMove(e) {
    const p = this._canvasPos(e);
    this.mouseX = p.x;
    this.mouseY = p.y;
    if (!this.active) return;
    this.hoverLane = this._laneAt(p.y);
    this.hoverX = clamp(p.x + Camera.x, 10, WORLD_W - 10);
  },

  _onClick(e) {
    if (!this.active) return;
    const p = this._canvasPos(e);
    const lane = this._laneAt(p.y);
    if (lane == null) { this.disarm(); this.selectSquad(null); return; }
    const g = this.game;
    const wx = clamp(p.x + Camera.x, 10, WORLD_W - 10);
    /* The lever is checked FIRST and swallows the click.
     *
     * It sits on the parapet, which is also a perfectly good place to order a
     * squad to — so without this, throwing the lever would also issue a move
     * order to whatever was selected. */
    if (!this.armedUnit && !this.armedCallin) {
      /* The hit box is at least a finger wide, whatever the display scale.
       *
       * `leverPoint` returns DESIGN pixels, which get shrunk by the display
       * scale — on a phone that put the target at ~32 device px against the
       * 44px floor every other touch control in this game reaches. Converting
       * the floor back into design space here means the drawn lever keeps its
       * size and only what you can hit grows. */
      const rect = this.canvas.getBoundingClientRect();
      const cssPerDesign = Math.max(rect.width / CANVAS_W, rect.height / CANVAS_H) || 1;
      const minR = 22 / cssPerDesign;
      for (const c of g.covers[lane]) {
        if (!c.lever) continue;
        const P = Renderer.leverPoint(g.map, lane, c);
        const r = Math.max(P.r, minR);
        if (Math.abs(P.x - wx) > r || Math.abs(P.y - p.y) > r) continue;
        g.toggleLever(c);
        return;
      }
    }
    if (this.armedUnit) {
      if (g.trySpawn(g.player, this.armedUnit, lane)) {
        Sound.click();
        const d = SQUADS[this.armedUnit];
        if ((g.cool[g.player][this.armedUnit] || 0) > 0 || g.cp[g.player] < d.cost) this.disarm();
      } else {
        Sound.deny();
      }
    } else if (this.armedCallin) {
      if (g.tryCallin(g.player, this.armedCallin, lane, wx)) {
        this.disarm();
      } else {
        Sound.deny();
      }
    } else {
      // squad selection & move orders
      let best = null, bd = 1e9;
      for (const s of g.squads) {
        if (s.side !== g.player || s.lane !== lane) continue;
        if (!g.squadAlive(s).length) continue;
        const d = Math.abs(g.squadAnchor(s) - wx);
        if (d < 46 && d < bd) { bd = d; best = s; }
      }
      if (best) {
        this.selectSquad(best);
        Sound.click();
      } else if (this.selectedSquad && this.selectedSquad.lane === lane &&
                 g.squadAlive(this.selectedSquad).length) {
        g.orderSquad(this.selectedSquad, 'moveto', wx);
        Sound.click();
      } else {
        this.selectSquad(null);
      }
    }
  },

  selectSquad(s) {
    this.selectedSquad = s;
    this._refreshSquadPanel();
  },

  orderSel(order) {
    const g = this.game, s = this.selectedSquad;
    if (!s || !g) return;
    // one key, both directions — the button reads out which one it will do
    if (order === 'cover') order = (s.inCover || s.coverTarget) ? 'leavecover' : 'takecover';
    if (g.orderSquad(s, order)) Sound.click();
    else Sound.deny();
    this._refreshSquadPanel();
  },

  _refreshSquadPanel() {
    const el = document.getElementById('squad-panel');
    if (!el) return;
    const g = this.game, s = this.selectedSquad;
    if (!s || !g || !g.squadAlive(s).length) {
      el.classList.add('hidden');
      this._panelSquad = null;
      return;
    }
    const sd = SQUADS[s.key];
    el.classList.remove('hidden');
    // rebuild the DOM only when the selection changes — otherwise clicks land on
    // buttons that were just destroyed by an innerHTML refresh
    if (this._panelSquad !== s) {
      this._panelSquad = s;
      let html = `<span class="sp-name"></span>`;
      html += `<button data-o="advance">ADVANCE <i>A</i></button>`;
      html += `<button data-o="hold">HOLD <i>H</i></button>`;
      html += `<button data-o="fallback">FALL BACK <i>B</i></button>`;
      /* COVER, as an order.
       *
       * The whole cover system is a timing decision and player squads no longer
       * seek cover on their own, so there has to be a one-press way to say "get
       * in" and "get out". The button doubles as the state readout — it flips
       * to LEAVE COVER, and carries the position's occupancy — because the
       * player needs to know whether the hole they are about to send a second
       * squad into has room. */
      html += `<button data-o="cover" title="Take the nearest position, or break out of the one you are in (E)"><span class="sp-cov">COVER</span> <i>E</i></button>`;
      if (sd.grenades) html += `<button data-o="grenade"><span class="sp-cd"></span> <i>G</i></button>`;
      html += `<button data-o="smoke" title="Pop smoke (S)"><i>S</i></button>`;
      html += `<button data-o="focus" title="Concentrate fire on the nearest enemy squad (X)">FOCUS <i>X</i></button>`;
      if (LANE_N > 1) html += `<button data-o="crosslane" title="Cross to the other lane — out of cover and holding fire while they move (V)">CROSS <i>V</i></button>`;
      if (sd.suppressive) html += `<button data-o="suppress" title="Covering fire (C)"><span class="sp-cd"></span> <i>C</i></button>`;
      el.innerHTML = html;
      el.querySelectorAll('button').forEach(b => {
        b.addEventListener('pointerdown', ev => ev.stopPropagation());
        b.addEventListener('click', ev => { ev.stopPropagation(); this.orderSel(b.dataset.o); });
      });
    }
    // cheap in-place updates every tick
    el.querySelector('.sp-name').textContent = `${sd.name.toUpperCase()} ×${g.squadAlive(s).length}`;
    const nb = el.querySelector('button[data-o="grenade"]');
    if (nb) {
      const cd = Math.ceil(s.nadeCd || 0);
      nb.disabled = cd > 0;
      nb.querySelector('.sp-cd').textContent = cd ? `GRENADES ${cd}` : 'GRENADES';
    }
    const cb = el.querySelector('button[data-o="cover"]');
    if (cb) {
      const c = s.cover;
      const inC = !!(s.inCover && c);
      cb.classList.toggle('sp-danger', !!s.rangedIn);
      let label;
      if (s.rangedIn) label = 'RANGED — MOVE';
      else if (inC) label = c.cap > 1 ? `LEAVE ${c.occ.length}/${c.cap}` : 'LEAVE COVER';
      else if (s.order === 'tocover') label = 'MOVING…';
      else label = 'TAKE COVER';
      cb.querySelector('.sp-cov').textContent = label;
    }
    const sb = el.querySelector('button[data-o="suppress"]');
    if (sb) {
      const cd = Math.ceil(s.suppCd || 0);
      sb.disabled = cd > 0;
      sb.querySelector('.sp-cd').textContent = cd ? `SUPPRESS ${cd}` : 'SUPPRESS';
    }
  },

  handleKey(key) {
    if (!this.active) return false;
    const g = this.game;
    if (key === 'Tab') {
      // cycle own squads
      const own = g.squads.filter(s => s.side === g.player && g.squadAlive(s).length);
      if (!own.length) return true;
      const i = own.indexOf(this.selectedSquad);
      const next = own[(i + 1) % own.length];
      this.selectSquad(next);
      Camera.center(g.squadAnchor(next));
      return true;
    }
    if (this.selectedSquad && g.squadAlive(this.selectedSquad).length) {
      const up = key.toUpperCase();
      if (up === 'A') { this.orderSel('advance'); return true; }
      if (up === 'H') { this.orderSel('hold'); return true; }
      if (up === 'B') { this.orderSel('fallback'); return true; }
      if (up === 'E') { this.orderSel('cover'); return true; }
      if (up === 'G') { this.orderSel('grenade'); return true; }
      if (up === 'S') { this.orderSel('smoke'); return true; }
      /* SUPPRESS WAS UNREACHABLE FROM THE KEYBOARD.
       *
       * Both smoke and suppress were bound to `S`, so the second line could
       * never run — and the suppress button advertised `S` in its own label, so
       * anyone playing on hotkeys had a dead key on the most tactical order in
       * the game. It halves the target's accuracy, doubles pin accumulation
       * (js/game.js:1246) and is the only way to pin a dug-in squad, and it
       * could only ever be reached by clicking.
       *
       * `C` for covering fire. Free: Q/W/E/R/T are call-ins, A/B/G/H/S the other
       * orders, P/F/M and `/F3 global, 1-9 the cards. */
      if (up === 'C') { this.orderSel('suppress'); return true; }
      if (up === 'X') { this.orderSel('focus'); return true; }
      if (up === 'V') { this.orderSel('crosslane'); return true; }
    }
    const n = parseInt(key, 10);
    if (n >= 1 && n <= this.unitKeys.length) { this.armUnit(this.unitKeys[n - 1]); return true; }
    const up = key.toUpperCase();
    const ck = this.callinKeys.find(k => CALLINS[k].key === up);
    if (ck) { this.armCallin(ck); return true; }
    if (key === 'Escape') {
      if (this.selectedSquad) { this.selectSquad(null); return true; }
      this.disarm(); return true;
    }
    return false;
  },

  update(dt) {
    const g = this.game;
    if (!g) return;

    // keep world-space hover in sync while the camera pans under a still mouse
    if (this.active && this.mouseX != null) {
      this.hoverLane = this._laneAt(this.mouseY);
      this.hoverX = clamp(this.mouseX + Camera.x, 10, WORLD_W - 10);
    }

    this.els.cpValue.textContent = Math.floor(g.cp[g.player]);
    this.els.moraleUs.style.width = `${clamp(g.morale.us, 0, 100)}%`;
    this.els.moraleVc.style.width = `${clamp(g.morale.vc, 0, 100)}%`;
    this.els.objective.textContent = g.objectiveText();

    g.flags.forEach((f, i) => {
      this.pipEls[i].className = 'flag-pip' + (f.owner ? ' ' + f.owner : '');
    });

    // card states
    for (const k of this.unitKeys) {
      const d = SQUADS[k], card = this.cardEls[k];
      const cd = g.cool[g.player][k] || 0;
      card.querySelector('.card-cd').style.height = cd > 0 ? `${(cd / d.cd) * 100}%` : '0%';
      card.classList.toggle('unaffordable', g.cp[g.player] < d.cost);
    }
    for (const k of this.callinKeys) {
      const d = CALLINS[k], card = this.cardEls[k];
      const cd = g.cool[g.player][k] || 0;
      card.querySelector('.card-cd').style.height = cd > 0 ? `${(cd / d.cd) * 100}%` : '0%';
      card.classList.toggle('unaffordable', g.cp[g.player] < d.cost);
    }

    // ticker
    while (g.events.length) {
      const ev = g.events.shift();
      const div = document.createElement('div');
      div.className = `tk-${ev.cls}`;
      div.textContent = `▸ ${ev.text}`;
      this.els.ticker.appendChild(div);
      this.tickerItems.push({ el: div, t: 0 });
      Sound.radio && ev.cls === 'sys';
    }
    for (let i = this.tickerItems.length - 1; i >= 0; i--) {
      const it = this.tickerItems[i];
      it.t += dt;
      if (it.t > 6 || this.tickerItems.length - i > 4) {
        it.el.remove();
        this.tickerItems.splice(i, 1);
      } else if (it.t > 4.5) {
        it.el.style.opacity = String(1 - (it.t - 4.5) / 1.5);
      }
    }

    // squad panel upkeep: cooldown counters, deselect the dead
    this._panelT = (this._panelT || 0) + dt;
    if (this.selectedSquad && !g.squadAlive(this.selectedSquad).length) {
      this.selectSquad(null);
    } else if (this._panelT > 0.4 && this.selectedSquad) {
      this._panelT = 0;
      this._refreshSquadPanel();
    }

    // banner
    if (g.banner && g.banner.fresh) {
      g.banner.fresh = false;
      this.els.banner.textContent = g.banner.text;
      this.els.banner.className = 'show' + (g.banner.danger ? ' danger' : '');
      this.bannerT = 2.0;
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.els.banner.className = '';
    }
  },
};
