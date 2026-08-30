/* Touch and fullscreen support.
 *
 * Three things were broken on a phone, and only one of them was input:
 *
 *  1. NO WAY TO SCROLL. The camera moved on `wheel`, which touch never fires,
 *     and there was no touch handling anywhere. The map simply could not be
 *     panned.
 *  2. NOT FULLSCREEN. `#stage` is locked to 16:9 by
 *     `width: min(100vw, 100vh*16/9)`. On a 390x844 phone held upright that
 *     resolves to 390x219 — the game was a letterboxed strip about a quarter of
 *     the screen tall. Fullscreen alone does not fix that; the aspect does.
 *  3. THE PAGE ITSELF MOVED. Without `touch-action`, a drag scrolls the
 *     document and a double-tap zooms it, so even a working pan would have been
 *     fighting the browser.
 *
 * Taps are deliberately left to the browser. Only `touchmove` is prevented, so
 * the synthetic click still fires and every existing click handler — cards,
 * squad selection, the minimap — keeps working untouched. The one thing that
 * needs suppressing is the click at the END of a drag, which is handled with a
 * capture-phase listener rather than by rewriting the input layer.
 */
const Mobile = {
  enabled: false,
  _drag: null,
  _suppressClick: false,

  // a pan under this many CSS pixels is a tap, not a drag
  TAP_SLOP: 11,

  init() {
    /* MOBILE BUILD: always on. The desktop fork detected touch because it had
     * to serve both; here every player is on a phone, so the touch layout and
     * the larger hit targets are unconditional. Detection only ever created a
     * path where the game shipped its desktop layout to a phone that answered
     * the media query wrongly. */
    this.enabled = true;
    document.body.classList.add('touch');
    // bind regardless: a laptop with a touchscreen should still pan by finger,
    // and the fullscreen button is useful on any machine
    this._bindPan();
    this._bindFullscreen();
    this._bindOrientation();
  },

  /* ---------------------------------------------------------------- panning */
  _bindPan() {
    const cv = document.getElementById('game-canvas');
    if (!cv) return;

    cv.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { this._drag = null; return; }
      const t = e.touches[0];
      this._drag = { x: t.clientX, y: t.clientY, x0: t.clientX, moved: false };
    }, { passive: true });

    cv.addEventListener('touchmove', (e) => {
      const d = this._drag;
      if (!d || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - d.x;
      if (!d.moved && Math.abs(t.clientX - d.x0) > this.TAP_SLOP) d.moved = true;
      if (d.moved) {
        /* Content follows the finger, so dragging right moves the camera LEFT.
         * The canvas is letterboxed and scaled, so a CSS pixel is not a world
         * pixel — convert through the element's rendered width or the map
         * crawls on a small screen and races on a large one. */
        const k = CANVAS_W / (cv.clientWidth || CANVAS_W);
        Camera.pan(-dx * k);
        // land it immediately: easing a direct drag feels like lag
        Camera.x = Camera.targetX;
        e.preventDefault();
      }
      d.x = t.clientX;
    }, { passive: false });

    const end = () => {
      if (this._drag && this._drag.moved) {
        // the browser still fires a click after a drag; swallow exactly one
        this._suppressClick = true;
        setTimeout(() => { this._suppressClick = false; }, 350);
      }
      this._drag = null;
    };
    cv.addEventListener('touchend', end, { passive: true });
    cv.addEventListener('touchcancel', end, { passive: true });

    // capture phase, so it runs before UI's own click handler whatever the
    // registration order
    cv.addEventListener('click', (e) => {
      if (!this._suppressClick) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);
  },

  /* ------------------------------------------------------------- fullscreen */
  isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  },

  async toggleFullscreen() {
    const el = document.documentElement;
    try {
      if (this.isFullscreen()) {
        await (document.exitFullscreen ? document.exitFullscreen()
          : document.webkitExitFullscreen && document.webkitExitFullscreen());
      } else {
        await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' })
          : el.webkitRequestFullscreen && el.webkitRequestFullscreen());
        /* Landscape lock is best-effort and rejects on plenty of browsers
         * (notably iOS, which has no element fullscreen outside video at all).
         * A rejection is not an error worth surfacing — the rotate prompt
         * already tells the player what to do. */
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock('landscape').catch(() => {});
        }
      }
    } catch (err) {
      /* Denied, or unsupported. The game is perfectly playable windowed, so
       * this stays silent rather than throwing a dialog at the player. */
    }
    this._syncFsButton();
  },

  _bindFullscreen() {
    const btn = document.getElementById('btn-fullscreen');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFullscreen();
    });
    document.addEventListener('fullscreenchange', () => this._syncFsButton());
    document.addEventListener('webkitfullscreenchange', () => this._syncFsButton());
    this._syncFsButton();
  },

  _syncFsButton() {
    const btn = document.getElementById('btn-fullscreen');
    if (!btn) return;
    const on = this.isFullscreen();
    btn.textContent = on ? '⤡' : '⤢';
    btn.title = on ? 'Leave fullscreen' : 'Fullscreen';
  },

  /* ------------------------------------------------------------ orientation */
  _bindOrientation() {
    const check = () => {
      // portrait on a touch device gives a ~16:9 game a quarter of the screen,
      // so ask for a rotation rather than shipping an unplayable letterbox
      const portrait = window.innerHeight > window.innerWidth;
      /* MOBILE: the gate returns if the phone goes back to portrait.
       * Desktop latched `_dismissedRotate` forever, which is right for a
       * laptop that guessed wrong once. On a phone the orientation is a real
       * signal, so a player who rotates back should see the gate again rather
       * than a quarter-height letterbox — the dismissal only covers the case
       * where the CHECK is wrong, not where the player has actually turned. */
      /* Orientation alone decides the gate — no touch sniffing.
       *
       * Desktop had to guess whether it was on a phone before blocking the
       * screen, because blocking a laptop would be absurd. This build only
       * exists for phones, so the guess is not just unnecessary, it is a bug
       * source: `matchMedia('(pointer: coarse)')` is false in several device
       * emulators and on laptops with touchscreens, and the gate silently
       * never appeared. Portrait is portrait. */
      document.body.classList.toggle('portrait', portrait);
      if (typeof Renderer !== 'undefined' && Renderer.fitDPR) Renderer.fitDPR();
    };

    /* Listen on several signals on purpose. The rotate prompt covers the whole
     * screen, so a single missed event locks the player out of their own game —
     * and `resize` genuinely does not fire in every environment (a viewport
     * changed through devtools or automation can change dimensions without
     * dispatching one). matchMedia is the reliable orientation signal;
     * the rest are belt and braces. */
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', () => setTimeout(check, 120));
    document.addEventListener('visibilitychange', check);
    const mq = window.matchMedia('(orientation: portrait)');
    if (mq.addEventListener) mq.addEventListener('change', check);
    else if (mq.addListener) mq.addListener(check);          // older WebKit

    /* The tap does three things, and two of them can only happen here.
     *
     * iOS grants fullscreen and `screen.orientation.lock` only from inside a
     * user gesture, so this listener is the single moment in the app where
     * either is possible. Asking at boot silently fails; asking from a timer
     * silently fails. Asking from the tap that dismisses the gate works.
     *
     * The escape hatch survives — a blocking overlay that is WRONG about the
     * orientation is worse than no overlay, so the tap always lets the player
     * through even if the lock is refused. */
    const prompt = document.getElementById('rotate-prompt');
    if (prompt) {
      prompt.addEventListener('click', () => {
        this._dismissedRotate = true;
        if (!this.isFullscreen()) this.toggleFullscreen();
        check();
      });
    }
    check();
  },
};
