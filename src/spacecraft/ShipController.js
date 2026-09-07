// ShipController — unifies keyboard, mouse (pointer lock) and touch input
// into a single per-frame input state + discrete action events.
export class ShipController {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings; // {invertY}
    this.state = {
      throttleF: 0, strafe: 0, vert: 0,
      boost: false, brake: false,
      yawDelta: 0, pitchDelta: 0, rollDelta: 0,
      lookActive: false
    };
    this.keys = new Set();
    this.pointerLocked = false;
    this.dragLookEnabled = false;   // fallback when pointer lock is unavailable
    this._dragLook = null;          // {x, y} last client pos while dragging
    this._dragLookToasted = false;  // one-time "hold left button" hint
    this.onDragLook = null;         // game hook: fired on first fallback use
    this.listeners = {};
    this.enabled = true;
    // per-frame consumed deltas (rotations for THIS frame only)
    this.frame = { yawDelta: 0, pitchDelta: 0, rollDelta: 0 };

    // touch overlay state (written by MobileControls)
    this.touch = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, lookDelta: { x: 0, y: 0 }, active: false };
    // px-per-radian for drag look (touch is shorter-travel than a mouse)
    this.lookSensitivity = 0.015;

    this._bindKeyboard();
    this._bindMouse();
  }

  on(action, fn) { (this.listeners[action] ||= []).push(fn); }
  emit(action, arg) { (this.listeners[action] || []).forEach(f => f(arg)); }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (['Space'].includes(e.code)) e.preventDefault(); return; }
      this.keys.add(e.code);
      // ESC is the master key — it must ALWAYS reach the pause/modal
      // handler, even while `enabled` is false (paused or a modal open).
      // Gating it like the other keys made the game impossible to
      // unpause/close-panels from the keyboard: the user pressed ESC and
      // nothing happened, which reads as "the controls are dead".
      if (e.code === 'Escape') { this.emit('pause'); return; }
      if (!this.enabled) return;
      switch (e.code) {
        case 'KeyE': this.emit('interact'); break;
        case 'KeyR': this.emit('scan'); break;
        case 'KeyT': this.emit('target'); break;
        case 'KeyM': this.emit('map'); break;
        case 'KeyI': this.emit('info'); break;
        case 'KeyL': this.emit('land'); break;
        case 'KeyV': this.emit('camera'); break;
        case 'KeyH': this.emit('help'); break;
        case 'KeyJ': this.emit('missions'); break;
        case 'Space': e.preventDefault(); break;
      }
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Ask the browser for pointer lock with full failure coverage.
   *  Chrome rejects the returned promise when it refuses the lock (denied
   *  permission, ESC cooldown, iframe without allow="pointer-lock", no user
   *  gesture, …); some contexts silently ignore the request entirely.
   *  Without these handlers the mouse is simply dead in those
   *  environments — so any of: rejection, pointerlockerror, or "lock never
   *  engaged ~400ms after asking" all switch on drag-to-look. */
  tryRequestPointerLock() {
    this.requestLock = true;
    if (this.pointerLocked) return;
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => this._enableDragLook());
    } catch {
      this._enableDragLook();
    }
    clearTimeout(this._lockCheckTimer);
    this._lockCheckTimer = setTimeout(() => {
      if (!this.pointerLocked) this._enableDragLook();
    }, 400);
  }

  _bindMouse() {
    this.canvas.addEventListener('click', () => {
      // Game sets `requestLock` when pointer lock is appropriate for the
      // current mode (space, not on mobile controls).
      if (this.enabled && this.requestLock) this.tryRequestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked) { this._dragLook = null; clearTimeout(this._lockCheckTimer); }
      const wasLocked = this.pointerLocked;
      this.pointerLocked = locked;
      if (!locked && wasLocked && this.enabled) this.emit('pointerlocklost');
    });
    document.addEventListener('pointerlockerror', () => this._enableDragLook());
    // Fallback drag-to-look start: press on the canvas (only relevant when
    // the pointer is NOT locked — while locked the mouse is captured).
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && !this.pointerLocked) {
        this._dragLook = { x: e.clientX, y: e.clientY };
      }
    });
    const endDrag = (e) => {
      if (e && e.button !== undefined && e.button !== 0) return;
      this._dragLook = null;
    };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('blur', () => { this._dragLook = null; });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked && !this.enabled) return;
      let dx, dy;
      if (this.pointerLocked) {
        dx = e.movementX; dy = e.movementY;
      } else if (this.dragLookEnabled && this._dragLook && (e.buttons & 1)) {
        // fallback: hold-left-button + move (works wherever pointer lock
        // cannot engage). Prefer movementX/Y, fall back to client deltas.
        dx = e.movementX || (e.clientX - this._dragLook.x);
        dy = e.movementY || (e.clientY - this._dragLook.y);
        this._dragLook = { x: e.clientX, y: e.clientY };
        // tell the player once, on first real use of the fallback
        if (!this._dragLookToasted) { this._dragLookToasted = true; this.onDragLook?.(); }
      } else {
        return;
      }
      if (!dx && !dy) return;
      const s = 0.0021;
      this.frame.yawDelta -= dx * s;
      this.frame.pitchDelta -= dy * s * (this.settings.invertY ? -1 : 1);
      this.state.lookActive = true;
    });
  }

  _enableDragLook() {
    if (this.dragLookEnabled) return;
    this.dragLookEnabled = true;
  }

  setTouchState(touch) { this.touch = touch; }

  /**
   * Called once per frame BEFORE physics. Returns the input for this frame
   * and consumes accumulated mouse deltas (prevents runaway rotation).
   */
  sample(dt) {
    const s = this.state;
    const f = this.frame;
    if (!this.enabled) {
      f.yawDelta = 0; f.pitchDelta = 0; f.rollDelta = 0;
      return {
        throttleF: 0, strafe: 0, vert: 0, boost: false, brake: false,
        yawDelta: 0, pitchDelta: 0, rollDelta: 0
      };
    }
    const k = this.keys;
    let throttle = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    let strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    let vert = (k.has('Space') ? 1 : 0) - ((k.has('ControlLeft') || k.has('ControlRight')) ? 1 : 0);
    const boost = k.has('ShiftLeft') || k.has('ShiftRight');
    const brake = k.has('KeyB');
    const roll = (k.has('KeyQ') ? 1 : 0) - (k.has('KeyX') ? 1 : 0);

    // merge touch sticks (they dominate when active)
    if (this.touch.active) {
      if (Math.abs(this.touch.move.y) > 0.08) throttle = this.touch.move.y;
      if (Math.abs(this.touch.move.x) > 0.08) strafe = this.touch.move.x;
      // positional look stick (legacy)
      if (Math.abs(this.touch.look.x) > 0.06) f.yawDelta -= this.touch.look.x * 2.6 * dt;
      if (Math.abs(this.touch.look.y) > 0.06) f.pitchDelta -= this.touch.look.y * 2.0 * dt * (this.settings.invertY ? -1 : 1);
      // FPS-style drag look: raw px deltas from the right-side drag zone
      // (PUBG/FFM — finger follows the view). Consumed, then zeroed.
      const ld = this.touch.lookDelta;
      if (ld && (ld.x || ld.y)) {
        f.yawDelta -= ld.x * this.lookSensitivity;
        f.pitchDelta -= ld.y * this.lookSensitivity * (this.settings.invertY ? -1 : 1);
        ld.x = 0; ld.y = 0;
      }
    }
    if (this.touch.vertUp) vert = Math.max(vert, 1);
    if (this.touch.vertDown) vert = Math.min(vert, -1);

    const input = {
      throttleF: throttle, strafe, vert,
      boost: boost || !!this.touch.boost,
      brake: brake || !!this.touch.brake,
      yawDelta: f.yawDelta,
      pitchDelta: f.pitchDelta,
      rollDelta: roll * 1.7 * dt
    };
    f.rollDelta = input.rollDelta;
    // consume accumulated look deltas for this frame
    f.yawDelta = 0;
    f.pitchDelta = 0;
    return input;
  }

  requestPointerLock() { this.requestLock = true; }
}
