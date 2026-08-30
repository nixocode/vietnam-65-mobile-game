/* Perks — the persistent half of the original Warfare 1944 brief.
 *
 * Squad veterancy is progression WITHIN a match; this is progression ACROSS
 * matches. You earn commendation points by fighting well and spend them on
 * standing advantages that apply to every unit you field from then on.
 *
 * Kept small and legible on purpose. Six perks, one rank each, each a single
 * clearly-stated effect — a deep tree would be a lot of UI for a game whose
 * decisions live on the field, and an unreadable tree is worse than none.
 * Effects are deliberately modest: they should make a difference over a match,
 * not let a stacked account walk through one.
 */
const PERKS = {
  cadre: {
    name: 'VETERAN CADRE', cost: 3,
    desc: 'Every squad you field starts one rank up — SEASONED from the outset.',
  },
  ammo: {
    name: 'AMPLE AMMUNITION', cost: 2,
    desc: 'Shorter pause between bursts. Your squads keep more rounds on target.',
  },
  entrench: {
    name: 'ENTRENCHING TOOLS', cost: 2,
    desc: 'Your men dig deeper — cover protects noticeably better.',
  },
  medics: {
    name: 'FIELD SURGEONS', cost: 3,
    desc: 'Losses cost less morale. A bad hour hurts the command less.',
  },
  arty: {
    name: 'FIRE DIRECTION', cost: 3,
    desc: 'Support call-ins cost a quarter less CP.',
  },
  scouts: {
    name: 'PATHFINDERS', cost: 2,
    desc: 'Squads move faster in the open and spot concealed enemies sooner.',
  },
};

const Perks = {
  KEY: 'v65_perks',

  _load() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.KEY) || '{}');
      return { points: raw.points || 0, owned: raw.owned || {} };
    } catch (e) {
      return { points: 0, owned: {} };
    }
  },

  _save(st) {
    try { localStorage.setItem(this.KEY, JSON.stringify(st)); } catch (e) { /* private mode */ }
  },

  state() { return this._load(); },
  points() { return this._load().points; },
  has(id) { return !!this._load().owned[id]; },

  buy(id) {
    const d = PERKS[id];
    const st = this._load();
    if (!d || st.owned[id] || st.points < d.cost) return false;
    st.points -= d.cost;
    st.owned[id] = true;
    this._save(st);
    return true;
  },

  /* Points from a finished match. Weighted toward fighting well rather than
   * simply surviving: kills earn, losses do not, and a win is worth a bonus. */
  award(game) {
    const my = game.stats[game.player];
    const won = game.result && game.result.winner === game.player;
    const pts = Math.floor(my.kills / 6) + (won ? 3 : 0) +
      (my.losses === 0 ? 1 : 0);
    if (pts <= 0) return 0;
    const st = this._load();
    st.points += pts;
    this._save(st);
    return pts;
  },

  reset() { this._save({ points: 0, owned: {} }); },

  /* ---- effects, read by the sim. `side` is the owner of the unit asking. */
  on(game, side, id) {
    return side === game.player && this.has(id);
  },
};
