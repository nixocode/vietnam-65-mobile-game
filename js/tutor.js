/* ---------------------------------------------------------------- tutor ----
 *
 * The game teaches nothing. v2 added cover capacity, crowding, the dig-in and
 * ranging clocks, the lever, armour immunity and the M79, and the only way to
 * learn any of it was to read the field manual or lose to it. A strategy game
 * whose rules are invisible is not hard, it is opaque.
 *
 * This is deliberately NOT a tutorial mission. It is a line of text the first
 * time each system actually happens to you, on the frame it happens, and never
 * again — because the moment a rule matters is the only moment anyone reads it.
 *
 * Rules it follows:
 *   - once, ever. Persisted beside the campaign progress and perks.
 *   - never two at once. A queue, not a pile.
 *   - never during the first seconds of a match, when the player is deploying
 *     and not reading anything.
 *   - it teaches what to DO, not what the system is called.
 */
const Tutor = {
  KEY: 'v65_taught',
  _seen: null,
  _q: [],
  _showT: 0,
  _holdT: 0,

  LINES: {
    squad:    'Selected. Tap a position to send them, or use the orders below.',
    trench:   'In the trench. They hold here until you throw the lever beside it.',
    lever:    'Lever thrown — they go over the top and will not stop here again.',
    dugin:    'Dug in. Rifles will barely touch them now.',
    ranged:   'You have been ranged in. MOVE, or the next rounds land on you.',
    crowd:    'Two squads in one position. Safer from rifles, far worse under a shell.',
    armour:   'Rifles cannot hurt armour. Use a rocket, a grenade or artillery.',
    m79:      'The Weapons Team has an M79 (F). High explosive, and it breaks a trench.',
    enemydug: 'That position is dug in. Do not walk into it — shell it.',
  },

  load() {
    if (this._seen) return this._seen;
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || '{}'); } catch (e) { raw = {}; }
    this._seen = raw && typeof raw === 'object' ? raw : {};
    return this._seen;
  },

  /* Queue a lesson if it has never been given. Safe to call every frame. */
  teach(key) {
    const seen = this.load();
    if (seen[key] || !this.LINES[key]) return;
    if (this._q.indexOf(key) >= 0) return;
    this._q.push(key);
  },

  /* Wipe the record, so the next game teaches everything again. */
  reset() {
    this._seen = {};
    this._q.length = 0;
    try { localStorage.removeItem(this.KEY); } catch (e) { /* private mode */ }
  },

  update(dt, matchT) {
    const el = document.getElementById('tutor');
    if (!el) return;
    if (this._holdT > 0) {
      this._holdT -= dt;
      if (this._holdT <= 0) el.classList.remove('show');
      return;
    }
    // nothing in the opening seconds: the player is deploying, not reading
    if (matchT < 6 || !this._q.length) return;
    const key = this._q.shift();
    const seen = this.load();
    seen[key] = 1;
    try { localStorage.setItem(this.KEY, JSON.stringify(seen)); } catch (e) { /* private mode */ }
    el.textContent = this.LINES[key];
    el.classList.add('show');
    this._holdT = 5.2;
    if (typeof Sound !== 'undefined' && Sound.radio) Sound.radio();
  },
};
