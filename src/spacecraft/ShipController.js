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
    this.listeners = {};
    this.enabled = true;
    // per-frame consumed deltas (rotations for THIS frame only)
    this.frame = { yawDelta: 0, pitchDelta: 0, rollDelta: 0 };

    // touch overlay state (written by MobileControls)
    this.touch = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, active: false };

    this._bindKeyboard();
    this._bindMouse();
  }

  on(action, fn) { (this.listeners[action] ||= []).push(fn); }
  emit(action, arg) { (this.listeners[action] || []).forEach(f => f(arg)); }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (['Space'].includes(e.code)) e.preventDefault(); return; }
      this.keys.add(e.code);
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
        case 'Escape': this.emit('pause'); break;
        case 'Space': e.preventDefault(); break;
      }
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _bindMouse() {
    this.canvas.addEventListener('click', () => {
      if (this.enabled && !this.pointerLocked && this.requestLock) {
        this.canvas.requestPointerLock?.();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked && this.enabled) this.emit('pointerlocklost');
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || !this.enabled) return;
      const s = 0.0021;
      this.frame.yawDelta -= e.movementX * s;
      this.frame.pitchDelta -= e.movementY * s * (this.settings.invertY ? -1 : 1);
      this.state.lookActive = true;
    });
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
      if (Math.abs(this.touch.look.x) > 0.06) f.yawDelta -= this.touch.look.x * 2.6 * dt;
      if (Math.abs(this.touch.look.y) > 0.06) f.pitchDelta -= this.touch.look.y * 2.0 * dt * (this.settings.invertY ? -1 : 1);
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
