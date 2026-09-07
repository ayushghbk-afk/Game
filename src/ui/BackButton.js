// BackButton — makes the ANDROID / browser BACK gesture behave like ESC.
//
// On a phone there is no ESC key, so an opened panel could only be dismissed
// by finding its ✕ — and pressing the system Back button left the game (or
// navigated away from the page entirely), which players read as "the game
// closed itself".
//
// The trick is a history "trap": we push one dummy history entry while the
// game is running. When the user presses Back, `popstate` fires, we consume it
// (close the top modal / open the pause menu) and immediately push the trap
// entry again so there is always something to pop next time. Only when nothing
// is open AND the player confirms do we let Back actually leave the page.
const TRAP = { solarOdyssey: 'ui-trap' };

export class BackButton {
  /**
   * @param handler () => boolean — handle one Back press. Return true if the
   *        press was consumed (something was closed / pause opened), false to
   *        allow the browser to navigate away.
   */
  constructor(handler) {
    this.handler = handler;
    this.armed = false;
    this._onPop = this._onPop.bind(this);
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('popstate', this._onPop);
    }
  }

  /** Start intercepting Back (call when gameplay/menus become interactive). */
  arm() {
    if (this.armed) return;
    this.armed = true;
    this._push();
  }

  disarm() { this.armed = false; }

  _push() {
    try { history.pushState(TRAP, '', location.href); } catch { /* file:// etc. */ }
  }

  _onPop() {
    if (!this.armed) return;
    let consumed = false;
    try { consumed = !!this.handler?.(); } catch (e) { console.warn(e); consumed = true; }
    // Re-arm the trap either way: while the game is running, Back should keep
    // acting as "close / pause" rather than unloading the page by surprise.
    if (consumed || this.armed) this._push();
  }

  dispose() {
    this.armed = false;
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('popstate', this._onPop);
    }
  }
}
