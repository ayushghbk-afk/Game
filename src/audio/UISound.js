// UISound — global click/tap feedback for every interactive element.
//
// Rather than remembering to call audio.click() at ~80 call sites (and
// forgetting at half of them), this installs ONE capture-phase listener on the
// root and plays a sound whenever a pointer goes down on something that looks
// interactive: buttons, links, inputs, selects, [role=button], .btn, .menu-btn,
// .mc-btn, tabs, cards… Elements can opt out with `data-noclick`.
//
// Capture phase + `pointerdown` means the click is heard the instant the finger
// lands, which is what makes touch UIs feel responsive.
const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], ' +
  '.btn, .btn-icon, .btn-small, .menu-btn, .mc-btn, .mc-interact, .clickable, ' +
  '.mission-card, .slot-card, .server-row, .friend-row, .part-row, .rocket-card, .tab';

export class UISound {
  /**
   * @param root  element to listen on (the game's #app)
   * @param audio AudioManager
   * @param opts  { enabled: () => boolean }
   */
  constructor(root, audio, opts = {}) {
    this.root = root;
    this.audio = audio;
    this.enabled = opts.enabled || (() => true);
    this._onDown = this._onDown.bind(this);
    this._onKey = this._onKey.bind(this);
    root.addEventListener('pointerdown', this._onDown, true);
    // Keyboard activation (Enter/Space on a focused control) should click too.
    root.addEventListener('keydown', this._onKey, true);
  }

  _target(e) {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return null;
    const hit = t.closest(INTERACTIVE);
    if (!hit) return null;
    if (hit.hasAttribute?.('data-noclick')) return null;
    if (hit.disabled) return null;
    if (hit.classList?.contains('disabled')) return null;
    return hit;
  }

  _play(hit) {
    if (!this.enabled()) return;
    const a = this.audio;
    if (!a) return;
    // Sliders and text fields get a softer tick; destructive buttons a lower one.
    if (hit.tagName === 'INPUT' && (hit.type === 'range' || hit.type === 'text' || hit.type === 'password' || hit.type === 'email')) {
      a.tick?.() ?? a.click?.();
    } else if (hit.classList?.contains('btn-danger')) {
      a.thud?.() ?? a.click?.();
    } else {
      a.click?.();
    }
  }

  _onDown(e) {
    if (e.button !== undefined && e.button > 0) return; // right/middle click: silent
    const hit = this._target(e);
    if (hit) this._play(hit);
  }

  _onKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const hit = this._target(e);
    if (hit) this._play(hit);
  }

  dispose() {
    this.root.removeEventListener('pointerdown', this._onDown, true);
    this.root.removeEventListener('keydown', this._onKey, true);
  }
}
