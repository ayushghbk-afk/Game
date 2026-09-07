// MobileControls — FPS-style touch layout (Free Fire / PUBG model):
//   · LEFT thumb  — virtual MOVE joystick (throttle + strafe)
//   · RIGHT side  — full-area DRAG TO LOOK zone (finger follows the view),
//                   like the aim area in FFM/PUBG
//   · big E button — INTERACT (tap: dock/orbit/collect, hold: mine) — the
//                   "fire" button of this game
//   · left cluster — BOOST / BRAKE / ▲ / ▼
//   · top cluster  — SCAN / TGT / MAP / LOG / CODEX / LAND / PAUSE
// Feeds the shared touch state consumed by ShipController.
import { el } from '../utils/UI.js';

class Joystick {
  constructor(zone, onMove) {
    this.onMove = onMove;
    this.x = 0; this.y = 0;
    this.nub = zone.querySelector('.joy-nub');
    this.zone = zone;
    this.active = false;
    this._id = null;
    zone.addEventListener('pointerdown', (e) => this._start(e));
    zone.addEventListener('pointermove', (e) => this._move(e));
    zone.addEventListener('pointerup', (e) => this._end(e));
    zone.addEventListener('pointercancel', (e) => this._end(e));
  }
  _start(e) {
    this._id = e.pointerId;
    this.active = true;
    try { this.zone.setPointerCapture?.(e.pointerId); } catch { /* jsdom/old browsers */ }
    this._update(e);
  }
  _move(e) { if (this.active && e.pointerId === this._id) this._update(e); }
  _end(e) {
    if (e.pointerId !== this._id) return;
    this.active = false; this._id = null;
    this.x = 0; this.y = 0;
    this.nub.style.transform = 'translate(-50%, -50%)';
    this.onMove(0, 0);
  }
  _update(e) {
    const r = this.zone.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2);
    let dy = (e.clientY - cy) / (r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    this.x = dx; this.y = -dy; // screen up = forward
    this.nub.style.transform = `translate(calc(-50% + ${dx * r.width * 0.32}px), calc(-50% + ${dy * r.height * 0.32}px))`;
    this.onMove(this.x, this.y);
  }
}

/** Full-area drag-to-look (PUBG/FFM): any touch that lands here drives the
 *  camera; deltas are forwarded to touchState.lookDelta. Multi-touch safe —
 *  only one finger at a time drives the view. */
class LookZone {
  constructor(zone, onDelta, onFirst) {
    this.onDelta = onDelta;
    this.zone = zone;
    this.ring = zone.querySelector('.mc-look-ring');
    this._id = null;
    this._last = null;
    zone.addEventListener('pointerdown', (e) => {
      if (this._id !== null) return;
      this._id = e.pointerId;
      this._last = { x: e.clientX, y: e.clientY };
      try { zone.setPointerCapture?.(e.pointerId); } catch { /* jsdom */ }
      if (this.ring) { this.ring.style.opacity = 1; this._place(e); }
      onFirst?.();
    });
    zone.addEventListener('pointermove', (e) => {
      if (this._id !== e.pointerId || !this._last) return;
      const dx = e.clientX - this._last.x;
      const dy = e.clientY - this._last.y;
      this._last = { x: e.clientX, y: e.clientY };
      if (dx || dy) {
        this.onDelta(dx, dy);
        if (this.ring) this._place(e);
      }
    });
    const end = (e) => {
      if (this._id !== e.pointerId) return;
      this._id = null;
      this._last = null;
      if (this.ring) this.ring.style.opacity = 0;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }
  _place(e) {
    const r = this.zone.getBoundingClientRect();
    this.ring.style.left = (e.clientX - r.left) + 'px';
    this.ring.style.top = (e.clientY - r.top) + 'px';
  }
}

export class MobileControls {
  constructor(root, touchState, actions) {
    this.state = touchState;
    this.actions = actions;
    this.wrap = el('div', 'mobile-controls hidden');
    this.wrap.innerHTML = `
      <!-- drag-to-look area: right ~55% of the screen, behind every button -->
      <div class="mc-look-zone">
        <div class="mc-look-ring"></div>
        <div class="mc-look-hint">DRAG TO LOOK</div>
      </div>
      <div class="mc-left joy-zone"><div class="joy-base"></div><div class="joy-nub"></div><div class="joy-label">MOVE</div></div>
      <div class="mc-actions">
        <button class="mc-btn mc-boost" data-hold="boost">BOOST</button>
        <button class="mc-btn" data-hold="brake">BRAKE</button>
        <button class="mc-btn" data-hold="vertUp">▲</button>
        <button class="mc-btn" data-hold="vertDown">▼</button>
      </div>
      <button class="mc-btn mc-interact" data-holdTap="interact">E</button>
      <div class="mc-top-actions">
        <button class="mc-btn mc-small" data-tap="scan">SCAN</button>
        <button class="mc-btn mc-small" data-tap="target">TGT</button>
        <button class="mc-btn mc-small" data-tap="map">MAP</button>
        <button class="mc-btn mc-small" data-tap="missions">LOG</button>
        <button class="mc-btn mc-small" data-tap="codex">CODEX</button>
        <button class="mc-btn mc-small" data-tap="land">LAND</button>
        <button class="mc-btn mc-small" data-tap="pause">PAUSE</button>
      </div>`;
    root.appendChild(this.wrap);

    new Joystick(this.wrap.querySelector('.mc-left'), (x, y) => {
      touchState.move.x = x; touchState.move.y = y;
    });
    // right-side drag look → raw px deltas (converted in ShipController)
    new LookZone(this.wrap.querySelector('.mc-look-zone'), (dx, dy) => {
      touchState.lookDelta.x += dx;
      touchState.lookDelta.y += dy;
    }, () => {
      const hint = this.wrap.querySelector('.mc-look-hint');
      if (hint) hint.style.display = 'none';
    });

    for (const btn of this.wrap.querySelectorAll('[data-hold]')) {
      const key = btn.dataset.hold;
      const on = (e) => { e.preventDefault(); touchState[key] = true; btn.classList.add('held'); };
      const off = () => { touchState[key] = false; btn.classList.remove('held'); };
      btn.addEventListener('pointerdown', on);
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
      btn.addEventListener('pointerleave', off);
    }
    for (const btn of this.wrap.querySelectorAll('[data-tap]')) {
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); actions[btn.dataset.tap]?.(); });
    }
    // E button: hold-to-mine, tap-to-interact (the "fire" button)
    const eBtn = this.wrap.querySelector('[data-holdTap="interact"]');
    let downT = 0;
    eBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); downT = performance.now(); touchState.interactHeld = true; eBtn.classList.add('held'); });
    const eUp = () => {
      touchState.interactHeld = false;
      eBtn.classList.remove('held');
      if (performance.now() - downT < 250) actions.interact?.();
    };
    eBtn.addEventListener('pointerup', eUp);
    eBtn.addEventListener('pointercancel', eUp);

    // block browser gestures
    this.wrap.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    this.wrap.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  show() { this.wrap.classList.remove('hidden'); this.state.active = true; }
  hide() {
    this.wrap.classList.add('hidden');
    this.state.active = false;
    this.state.move.x = 0; this.state.move.y = 0;
    this.state.look.x = 0; this.state.look.y = 0;
    if (this.state.lookDelta) { this.state.lookDelta.x = 0; this.state.lookDelta.y = 0; }
    this.state.boost = false; this.state.brake = false;
    this.state.vertUp = false; this.state.vertDown = false;
    this.state.interactHeld = false;
  }
}
