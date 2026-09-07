// Builder2D — the blueprint mode of the Vehicle Assembly Building.
//
// A classic side-view (Spaceflight-Simulator-style) 2D builder: parts are
// dragged on a vertical plane, they CLIP onto attachment nodes with a visible
// ghost and an audible snap, radial boosters mirror around the core, and the
// camera pans/zoomes with drag / pinch / wheel. It writes to the SAME v2
// design format as the 3D scene (placements with z = 0), so a rocket started
// in 2D can be finished in 3D and vice-versa — and it needs no WebGL at all.
//
// The public API intentionally mirrors BuilderScene so RocketBuilder.js can
// swap the two without caring which one is mounted.
import { getPart } from './RocketParts.js';
import {
  resolveDrop, addPart, removePart, findPart, worldNodes,
  designBounds, partHeight, partRadius
} from './RocketDesign.js';
import { drawPartSide } from './PartDraw2D.js';

export class Builder2D {
  /**
   * @param canvas  HTMLCanvasElement (2D context)
   * @param design  the live design object (mutated in place)
   * @param hooks   { onChange(), onSelect(uid), sound(kind) }
   */
  constructor(canvas, design, hooks = {}) {
    this.canvas = canvas;
    this.ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    this.design = design;
    this.hooks = hooks;
    this.selected = null;
    this.held = null;          // { partId }
    this.dragging = null;      // { uid }
    this.symmetry = true;
    this.disposed = false;
    this._lastDrop = null;
    this._wasSnapped = false;
    // camera: world point at screen centre + pixels per world unit
    this.view = { x: 0, y: 5, scale: 26 };
    this._stars = [];
    for (let i = 0; i < 90; i++) {
      this._stars.push({ x: (i * 197) % 1000, y: (i * 131) % 600, r: (i % 3) * 0.5 + 0.4 });
    }

    this.frameCamera();
    this.resize();
    this._bindInput();
  }

  // ---------------------------------------------------------------- camera
  _w() { return this.canvas.clientWidth || this.canvas.getBoundingClientRect?.().width || 640; }
  _h() { return this.canvas.clientHeight || this.canvas.getBoundingClientRect?.().height || 420; }

  frameCamera() {
    const b = designBounds(this.design);
    this.view.y = Math.max(3, (b.minY + b.maxY) / 2 + 0.5);
    const fit = (this._h() * 0.82) / Math.max(9, b.height + 5);
    this.view.scale = Math.max(7, Math.min(60, fit));
  }

  toScreenX(wx) { return this._w() / 2 + (wx - this.view.x) * this.view.scale; }
  toScreenY(wy) { return this._h() / 2 - (wy - this.view.y) * this.view.scale; }
  toWorldX(sx) { return this.view.x + (sx - this._w() / 2) / this.view.scale; }
  toWorldY(sy) { return this.view.y - (sy - this._h() / 2) / this.view.scale; }

  resize() {
    const w = this._w(), h = this._h();
    const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
    if (this.canvas.width !== undefined) { this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); }
    if (this.ctx?.setTransform) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------------------------------------------------------------- input
  _bindInput() {
    const c = this.canvas;
    this._pointers = new Map();
    this._mode = null;       // 'pan' | 'drag' | 'pinch'
    this._panStart = null;
    this._pinchDist = 0;

    const pos = (e) => {
      const r = c.getBoundingClientRect ? c.getBoundingClientRect() : { left: 0, top: 0 };
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onDown = (e) => {
      c.setPointerCapture?.(e.pointerId);
      this._pointers.set(e.pointerId, pos(e));
      if (this._pointers.size === 2) {
        this._mode = 'pinch';
        const [a, b] = [...this._pointers.values()];
        this._pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        return;
      }
      if (this.held) return; // palette part follows the pointer until release

      const p = pos(e);
      const hit = this._pick(this.toWorldX(p.x), this.toWorldY(p.y));
      if (hit) {
        this.select(hit.uid);
        this._mode = 'drag';
        this.dragging = { uid: hit.uid };
      } else {
        this._mode = 'pan';
        this._panStart = { ...p, vx: this.view.x, vy: this.view.y };
        this.select(null);
      }
    };

    const onMove = (e) => {
      const prev = this._pointers.get(e.pointerId);
      const p = pos(e);
      if (prev) {
        if (this._mode === 'pinch' && this._pointers.size === 2) {
          this._pointers.set(e.pointerId, p);
          const [a, b] = [...this._pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          this.view.scale = Math.max(5, Math.min(120, this.view.scale * (d / Math.max(1, this._pinchDist))));
          this._pinchDist = d;
          return;
        }
        this._pointers.set(e.pointerId, p);
        if (this._mode === 'pan' && this._panStart) {
          this.view.x = this._panStart.vx - (p.x - this._panStart.x) / this.view.scale;
          this.view.y = this._panStart.vy + (p.y - this._panStart.y) / this.view.scale;
          return;
        }
        if (this._mode === 'drag' && this.dragging) {
          this._moveTo(this.toWorldX(p.x), this.toWorldY(p.y));
          return;
        }
      }
      if (this.held) this._moveTo(this.toWorldX(p.x), this.toWorldY(p.y));
    };

    const onUp = (e) => {
      this._pointers.delete(e.pointerId);
      if (this.held) this.commitHeld();
      else if (this._mode === 'drag' && this.dragging) {
        const p = findPart(this.design, this.dragging.uid);
        if (p && this._lastDrop) {
          p.pos = [...this._lastDrop.pos];
          p.radial = !!this._lastDrop.radial;
          this.hooks.onChange?.();
          this.hooks.sound?.('click');
        }
        this.dragging = null;
        this._lastDrop = null;
        this._wasSnapped = false;
      }
      if (this._pointers.size === 0) { this._mode = null; this._panStart = null; }
    };

    this._handlers = { onDown, onMove, onUp };
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    c.addEventListener('wheel', (e) => {
      e.preventDefault?.();
      this.view.scale = Math.max(5, Math.min(120, this.view.scale * (1 - Math.sign(e.deltaY) * 0.12)));
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault?.());
  }

  /** Hit-test the topmost part under a world point. Radials sit on top. */
  _pick(wx, wy) {
    let best = null, bestPri = -1;
    for (const p of this.design.parts) {
      const part = getPart(p.id);
      if (!part) continue;
      const r = partRadius(p) * 1.15, hh = partHeight(p) / 2 * 1.15;
      if (Math.abs(wx - p.pos[0]) > r || Math.abs(wy - p.pos[1]) > Math.max(hh, 0.3)) continue;
      const pri = (p.radial ? 1000 : 0) + p.pos[1];
      if (pri > bestPri) { bestPri = pri; best = p; }
    }
    return best;
  }

  /** Move the held/moved part to (wx, wy), snapping to attachment nodes. */
  _moveTo(wx, wy) {
    const partId = this.held ? this.held.partId : findPart(this.design, this.dragging?.uid)?.id;
    if (!partId) return;
    const ignore = this.held ? null : this.dragging.uid;
    const drop = resolveDrop(this.design, partId, wx, wy, 0, 1.6, ignore);
    if (!drop) return;
    // 2D lives on the z = 0 plane — never let a snap push the part in depth.
    drop.pos = [drop.pos[0], drop.pos[1], 0];
    this._lastDrop = drop;
    if (drop.snapped && !this._wasSnapped) this.hooks.sound?.('snap');
    this._wasSnapped = drop.snapped;
  }

  // ---------------------------------------------------------------- API
  beginPlace(partId) {
    const part = getPart(partId);
    if (!part) return;
    this.cancelHeld();
    this.held = { partId };
    const b = designBounds(this.design);
    const drop = resolveDrop(this.design, partId, 0, b.maxY + (part.h || 0.6) / 2, 0, 1.6);
    if (drop) drop.pos = [drop.pos[0], drop.pos[1], 0];
    this._lastDrop = drop || { pos: [0, (part.h || 0.6) / 2, 0], snapped: false, radial: false };
  }

  commitHeld() {
    if (!this.held) return;
    const pos = this._lastDrop?.pos || [0, 2, 0];
    const placement = addPart(this.design, this.held.partId, pos, { radial: !!this._lastDrop?.radial });
    this.held = null;
    this._wasSnapped = false;
    if (placement) {
      this.select(placement.uid);
      this.hooks.sound?.('click');
      if (this.symmetry && placement.radial) this.mirrorSelected(true);
      this.hooks.onChange?.();
    }
  }

  cancelHeld() {
    this.held = null;
    this._lastDrop = null;
    this._wasSnapped = false;
  }

  select(uid) {
    this.selected = uid;
    this.hooks.onSelect?.(uid);
  }

  deleteSelected() {
    if (!this.selected) return false;
    const ok = removePart(this.design, this.selected);
    this.selected = null;
    if (ok) this.hooks.onChange?.();
    return ok;
  }

  mirrorSelected(silent) {
    const src = findPart(this.design, this.selected);
    if (!src) return false;
    const [x, y, z] = src.pos;
    if (Math.abs(x) < 0.05) return false;
    const twin = addPart(this.design, src.id, [-x, y, z || 0], { radial: true });
    if (twin && !silent) { this.hooks.onChange?.(); this.hooks.sound?.('click'); }
    return !!twin;
  }

  nudgeSelected(dx, dy, dz) {
    const p = findPart(this.design, this.selected);
    if (!p) return false;
    p.pos = [p.pos[0] + dx, Math.max(partHeight(p) / 2, p.pos[1] + dy), 0];
    this.hooks.onChange?.();
    return true;
  }

  setDesign(design) {
    this.design = design;
    this.cancelHeld();
    this.select(null);
    this.frameCamera();
  }

  setSymmetry(on) { this.symmetry = on; }

  // ---------------------------------------------------------------- render
  render() {
    if (this.disposed || !this.ctx) return;
    const ctx = this.ctx, w = this._w(), h = this._h(), s = this.view.scale;

    // backdrop
    ctx.clearRect(0, 0, w, h);
    try {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0a1428');
      g.addColorStop(1, '#060d1c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    } catch { ctx.fillStyle = '#060d1c'; ctx.fillRect(0, 0, w, h); }

    // stars (fixed to the screen — cheap and stable)
    ctx.fillStyle = 'rgba(200,220,255,0.55)';
    for (const st of this._stars) {
      const sx = (st.x / 1000) * w, sy = (st.y / 600) * h;
      ctx.fillRect(sx, sy, st.r, st.r);
    }

    // ground + launch pad
    const gy = this.toScreenY(0);
    if (gy < h + 80) {
      ctx.fillStyle = '#131c2c';
      ctx.fillRect(0, gy, w, Math.max(0, h - gy));
      ctx.fillStyle = '#2b3444';
      ctx.fillRect(this.toScreenX(-9), gy, 18 * s, Math.min(14, s * 0.35));
      ctx.fillStyle = 'rgba(110,198,255,0.8)';
      ctx.fillRect(this.toScreenX(-9), gy, 18 * s, 2);
      // launch tower + height ruler
      ctx.fillStyle = '#3d4a5c';
      const tx = this.toScreenX(-6.5);
      ctx.fillRect(tx, this.toScreenY(28), Math.max(2, s * 0.3), gy - this.toScreenY(28));
      ctx.fillStyle = '#8fa0b6';
      if (ctx.font !== undefined) ctx.font = '10px monospace';
      for (let m = 5; m <= 25; m += 5) {
        const yy = this.toScreenY(m);
        ctx.fillRect(tx, yy, s * 0.9, 1);
        ctx.fillText && ctx.fillText(m + ' m', tx + s * 1.1, yy + 3);
      }
    }

    // parts — core stack first, radial attachments on top
    const drawOrder = [...this.design.parts].sort((a, b) =>
      (a.radial ? 1 : 0) - (b.radial ? 1 : 0) || a.pos[1] - b.pos[1]);
    for (const p of drawOrder) {
      const part = getPart(p.id);
      if (!part) continue;
      // The part being dragged renders at the live snap position, not its
      // committed one — same feel as the 3D scene's moving mesh.
      const dragged = this.dragging && p.uid === this.dragging.uid && this._lastDrop;
      const px = dragged ? this._lastDrop.pos[0] : p.pos[0];
      const py = dragged ? this._lastDrop.pos[1] : p.pos[1];
      drawPartSide(ctx, part, this.toScreenX(px), this.toScreenY(py), s, {});
      if (p.uid === this.selected) {
        const r = partRadius(p) * s, hh = partHeight(p) / 2 * s;
        ctx.strokeStyle = '#ffb347';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const bx = this.toScreenX(px) - r - 4, by = this.toScreenY(py) - hh - 4;
        ctx.moveTo(bx, by); ctx.lineTo(bx + r * 2 + 8, by);
        ctx.lineTo(bx + r * 2 + 8, by + hh * 2 + 8); ctx.lineTo(bx, by + hh * 2 + 8);
        ctx.closePath(); ctx.stroke();
      }
    }

    // snap-node indicators while placing/dragging
    if (this.held || this.dragging) {
      for (const p of this.design.parts) {
        if (!this.held && p.uid === this.dragging?.uid) continue;
        for (const n of worldNodes(p)) {
          if (n.kind === 'radial' && Math.abs(n.z) > 0.01) continue; // off the 2D plane
          const active = this._lastDrop?.snapped && this._lastDrop.parentUid === p.uid &&
            Math.hypot(n.wx - this._lastDrop.pos[0], n.wy - this._lastDrop.pos[1]) < 2;
          ctx.fillStyle = active ? '#ffb347' : 'rgba(125,255,168,0.8)';
          ctx.beginPath();
          ctx.arc(this.toScreenX(n.wx), this.toScreenY(n.wy), active ? 5 : 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // ghost preview for the palette part being placed
    if (this.held && this._lastDrop) {
      const part = getPart(this.held.partId);
      if (part) drawPartSide(ctx, part,
        this.toScreenX(this._lastDrop.pos[0]), this.toScreenY(this._lastDrop.pos[1]), s,
        { ghost: true, snapped: !!this._lastDrop.snapped });
    }
  }

  dispose() {
    this.disposed = true;
    const c = this.canvas;
    if (this._handlers) {
      c.removeEventListener('pointerdown', this._handlers.onDown);
      c.removeEventListener('pointermove', this._handlers.onMove);
      c.removeEventListener('pointerup', this._handlers.onUp);
      c.removeEventListener('pointercancel', this._handlers.onUp);
    }
  }
}
