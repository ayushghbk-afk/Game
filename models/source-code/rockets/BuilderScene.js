// BuilderScene — the 3D Vehicle Assembly Building.
//
// Spaceflight Simulator lets you drag parts around a 2D side view. This is the
// same idea in full 3D: an orbitable pad, parts you drag with the mouse or a
// finger, live snapping to attachment nodes, and strap-on boosters you can
// mirror around the core.
//
// Interaction model (identical for mouse and touch):
//   · tap a part in the palette      → it spawns held under the cursor
//   · drag                           → the part follows a ground/height plane
//                                      and snaps to nearby attachment nodes,
//                                      showing a translucent ghost
//   · release                        → the part is placed
//   · tap an existing part           → select it (highlight + toolbar)
//   · drag an existing part          → move it (re-snaps)
//   · drag on empty space            → orbit the camera
//   · pinch / wheel                  → zoom
//
// The scene owns geometry only; RocketDesign.js owns the data model and
// RocketBuilder.js owns the surrounding DOM.
import * as THREE from 'three';
import { getPart } from './RocketParts.js';
import { partTexture } from './PartTextures.js';
import {
  resolveDrop, addPart, removePart, findPart, worldNodes,
  designBounds, partHeight, partRadius
} from './RocketDesign.js';

const GROUND = 0;

function matFor(part, opts = {}) {
  const { map, tint } = partTexture(part);
  const color = map && !tint ? 0xffffff : (part.color ?? 0xcccccc);
  return new THREE.MeshStandardMaterial({
    color,
    map: map || null,
    roughness: part.cat === 'engine' ? 0.45 : 0.7,
    metalness: part.cat === 'engine' ? 0.8 : 0.35,
    transparent: !!opts.ghost,
    opacity: opts.ghost ? 0.45 : 1,
    depthWrite: !opts.ghost
  });
}

export function geoFor(part) {
  const r = part.r || 0.5, h = part.h || 0.6;
  switch (part.shape) {
    case 'cone': return new THREE.ConeGeometry(r, h, 20);
    case 'nozzle': return new THREE.CylinderGeometry(r * 0.55, r, h, 20, 1, true);
    case 'taper': return new THREE.CylinderGeometry(r * 0.6, r, h, 20);
    case 'ring': return new THREE.CylinderGeometry(r, r, h, 20);
    case 'sphere': return new THREE.SphereGeometry(r, 22, 16);
    case 'dish': return new THREE.CylinderGeometry(r, r * 0.18, h, 20, 1, true);
    case 'panel': return new THREE.BoxGeometry(r * 2.1, Math.max(h, 0.12), r * 0.3);
    case 'box': return new THREE.BoxGeometry(r * 1.6, h, r * 1.6);
    case 'cylinder':
    default: return new THREE.CylinderGeometry(r, r, h, 20);
  }
}

export class BuilderScene {
  /**
   * @param canvas  HTMLCanvasElement to render into
   * @param design  the live design object (mutated in place)
   * @param hooks   { onChange(), onSelect(uid), sound(kind) }
   */
  constructor(canvas, design, hooks = {}) {
    this.canvas = canvas;
    this.design = design;
    this.hooks = hooks;
    this.meshes = new Map();       // uid -> THREE.Mesh
    this.selected = null;
    this.held = null;              // { partId, uid|null, ghost, drop }
    this.dragging = null;          // { uid, offsetY }
    this.symmetry = true;
    this.disposed = false;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x060d1c, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x060d1c, 40, 150);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);

    // orbit state
    this.orbit = { yaw: 0.7, pitch: 0.22, dist: 24, target: new THREE.Vector3(0, 4, 0) };

    this._buildEnvironment();
    this._bindInput();
    this.rebuild();
    this.resize();
  }

  // ---------------------------------------------------------------- scene
  _buildEnvironment() {
    const hemi = new THREE.HemisphereLight(0xa8d0ff, 0x202838, 1.1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff2dc, 1.5);
    key.position.set(12, 20, 9);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6ec6ff, 0.6);
    rim.position.set(-10, 6, -12);
    this.scene.add(rim);

    // launch pad
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(9, 9.6, 0.35, 40),
      new THREE.MeshStandardMaterial({ color: 0x2b3444, roughness: 0.9, metalness: 0.2 })
    );
    pad.position.y = -0.18;
    this.scene.add(pad);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(9.1, 0.09, 8, 60),
      new THREE.MeshStandardMaterial({ color: 0x6ec6ff, emissive: 0x2a6a9a, emissiveIntensity: 0.8, roughness: 0.4 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.01;
    this.scene.add(ring);

    const grid = new THREE.GridHelper(60, 30, 0x2f5a86, 0x16283f);
    grid.position.y = -0.34;
    this.scene.add(grid);

    // height reference tower so you can judge scale
    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 26, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x3d4a5c, roughness: 0.9 })
    );
    tower.position.set(-7.5, 13, 0);
    this.scene.add(tower);
    for (let y = 4; y < 26; y += 4) {
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.14, 0.14),
        new THREE.MeshStandardMaterial({ color: 0x4a5768, roughness: 0.9 })
      );
      arm.position.set(-6.4, y, 0);
      this.scene.add(arm);
    }

    // snap-node indicators (shown while dragging)
    this.nodeGroup = new THREE.Group();
    this.scene.add(this.nodeGroup);
    this.nodeGeo = new THREE.SphereGeometry(0.16, 10, 8);
    this.nodeMat = new THREE.MeshBasicMaterial({ color: 0x7dffa8, transparent: true, opacity: 0.85 });
    this.nodeMatActive = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 1 });

    // selection outline
    this.selBox = new THREE.Box3Helper(new THREE.Box3(), 0xffb347);
    this.selBox.visible = false;
    this.scene.add(this.selBox);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
  }

  /** Rebuild every mesh from the design (after load/import/clear). */
  rebuild() {
    for (const [, mesh] of this.meshes) this._disposeMesh(mesh);
    this.meshes.clear();
    for (const p of this.design.parts) this._addMesh(p);
    this.frameCamera();
    this._refreshSelection();
  }

  _addMesh(placement) {
    const part = getPart(placement.id);
    if (!part) return;
    const mesh = new THREE.Mesh(geoFor(part), matFor(part));
    mesh.position.set(...placement.pos);
    if (part.shape === 'nozzle') mesh.rotation.x = Math.PI;
    mesh.userData.uid = placement.uid;
    this.scene.add(mesh);
    this.meshes.set(placement.uid, mesh);
    return mesh;
  }

  _disposeMesh(mesh) {
    mesh.removeFromParent();
    mesh.geometry?.dispose();
    mesh.material?.dispose();
  }

  syncMesh(uid) {
    const p = findPart(this.design, uid);
    const mesh = this.meshes.get(uid);
    if (p && mesh) mesh.position.set(...p.pos);
  }

  // ---------------------------------------------------------------- camera
  frameCamera() {
    const b = designBounds(this.design);
    this.orbit.target.set(0, Math.max(2, (b.minY + b.maxY) / 2), 0);
    this.orbit.dist = Math.max(14, b.height * 1.8 + b.radius * 3);
  }

  _updateCamera() {
    const o = this.orbit;
    o.pitch = Math.max(-0.4, Math.min(1.3, o.pitch));
    o.dist = Math.max(5, Math.min(160, o.dist));
    this.camera.position.set(
      o.target.x + Math.cos(o.pitch) * Math.sin(o.yaw) * o.dist,
      o.target.y + Math.sin(o.pitch) * o.dist,
      o.target.z + Math.cos(o.pitch) * Math.cos(o.yaw) * o.dist
    );
    this.camera.lookAt(o.target);
  }

  // ---------------------------------------------------------------- input
  _bindInput() {
    const c = this.canvas;
    this._pointers = new Map();
    this._mode = null;   // 'orbit' | 'drag' | 'pinch'
    this._pinchDist = 0;
    this._moved = false;

    const onDown = (e) => {
      c.setPointerCapture?.(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._moved = false;

      if (this._pointers.size === 2) {
        this._mode = 'pinch';
        const [a, b] = [...this._pointers.values()];
        this._pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        return;
      }

      if (this.held) return;   // placing a palette part: handled on move/up

      const hit = this._pick(e);
      if (hit) {
        this.select(hit.userData.uid);
        // Start dragging the picked part immediately.
        this._mode = 'drag';
        this.dragging = { uid: hit.userData.uid };
        this._dragPlaneY = hit.position.y;
      } else {
        this._mode = 'orbit';
        this.select(null);
      }
    };

    const onMove = (e) => {
      const prev = this._pointers.get(e.pointerId);
      if (prev) {
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) this._moved = true;
        this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (this._mode === 'pinch' && this._pointers.size === 2) {
          const [a, b] = [...this._pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          this.orbit.dist *= this._pinchDist / Math.max(1, d);
          this._pinchDist = d;
          return;
        }
        if (this._mode === 'orbit') {
          this.orbit.yaw -= dx * 0.008;
          this.orbit.pitch += dy * 0.006;
          return;
        }
        if (this._mode === 'drag' && this.dragging) {
          this._moveHeldTo(e);
          return;
        }
      }
      if (this.held) this._moveHeldTo(e);   // palette part following the cursor
    };

    const onUp = (e) => {
      this._pointers.delete(e.pointerId);
      if (this.held) { this.commitHeld(); }
      else if (this._mode === 'drag' && this.dragging) {
        // Snap the moved part into its final resting place.
        const p = findPart(this.design, this.dragging.uid);
        if (p && this._lastDrop) {
          p.pos = [...this._lastDrop.pos];
          p.radial = !!this._lastDrop.radial;
          this.syncMesh(p.uid);
          this.hooks.onChange?.();
          this.hooks.sound?.('click');
        }
        this.dragging = null;
        this._lastDrop = null;
        this._wasSnapped = false;
        this._clearNodes();
      }
      if (this._pointers.size === 0) this._mode = null;
      this._refreshSelection();
    };

    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    c.addEventListener('pointerleave', (e) => { if (this._mode !== 'orbit') onUp(e); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbit.dist *= 1 + Math.sign(e.deltaY) * 0.12;
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Ray from the pointer into the scene. */
  _ray(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster;
  }

  _pick(e) {
    const ray = this._ray(e);
    const hits = ray.intersectObjects([...this.meshes.values()], false);
    return hits.length ? hits[0].object : null;
  }

  /**
   * Project the pointer onto a work plane. We use a vertical plane facing the
   * camera through the orbit target, which is what makes "drag it higher"
   * feel natural in 3D — plus the ground plane for placing on the pad.
   */
  _pointerWorld(e) {
    const ray = this._ray(e);
    // Vertical plane through the target, facing the camera.
    const normal = new THREE.Vector3(
      this.camera.position.x - this.orbit.target.x, 0,
      this.camera.position.z - this.orbit.target.z
    ).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.orbit.target);
    const hit = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, hit)) return hit;
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    return ray.ray.intersectPlane(ground, hit) ? hit : new THREE.Vector3();
  }

  _moveHeldTo(e) {
    const world = this._pointerWorld(e);
    const partId = this.held ? this.held.partId : findPart(this.design, this.dragging?.uid)?.id;
    if (!partId) return;
    const ignore = this.held ? null : this.dragging.uid;
    const drop = resolveDrop(this.design, partId, world.x, world.y, world.z, 1.6, ignore);
    if (!drop) return;
    this._lastDrop = drop;

    if (this.held) {
      this.held.ghost.position.set(...drop.pos);
      this.held.ghost.material.color.setHex(drop.snapped ? 0x7dffa8 : 0xff9d5c);
    } else {
      const mesh = this.meshes.get(this.dragging.uid);
      if (mesh) mesh.position.set(...drop.pos);
    }
    // Snap "click": the moment the ghost clips onto an attachment node the
    // player hears/sees it lock in — mouse or touch, same feedback.
    if (drop.snapped && !this._wasSnapped) this.hooks.sound?.('snap');
    this._wasSnapped = drop.snapped;
    this._showNodes(drop);
  }

  _showNodes(activeDrop) {
    this._clearNodes();
    for (const p of this.design.parts) {
      if (p.uid === this.dragging?.uid) continue;
      for (const n of worldNodes(p)) {
        const isActive = activeDrop?.snapped && activeDrop.parentUid === p.uid &&
          Math.hypot(n.wx - activeDrop.pos[0], n.wy - activeDrop.pos[1], n.wz - activeDrop.pos[2]) < 2;
        const dot = new THREE.Mesh(this.nodeGeo, isActive ? this.nodeMatActive : this.nodeMat);
        dot.position.set(n.wx, n.wy, n.wz);
        if (isActive) dot.scale.setScalar(1.6);
        this.nodeGroup.add(dot);
      }
    }
  }

  _clearNodes() {
    while (this.nodeGroup.children.length) this.nodeGroup.remove(this.nodeGroup.children[0]);
  }

  // ---------------------------------------------------------------- API
  /** Begin placing a palette part; it follows the pointer until released. */
  beginPlace(partId) {
    const part = getPart(partId);
    if (!part) return;
    this.cancelHeld();
    const ghost = new THREE.Mesh(geoFor(part), matFor(part, { ghost: true }));
    if (part.shape === 'nozzle') ghost.rotation.x = Math.PI;
    // Spawn above the current stack so it is visible before the first drag.
    const b = designBounds(this.design);
    const drop = resolveDrop(this.design, partId, 0, b.maxY + (part.h || 0.6) / 2, 0, 1.6);
    ghost.position.set(...(drop?.pos || [0, 2, 0]));
    this._lastDrop = drop;
    this.scene.add(ghost);
    this.held = { partId, ghost };
    this._showNodes(drop);
  }

  /** Place the held part for real. */
  commitHeld() {
    if (!this.held) return;
    const drop = this._lastDrop;
    const pos = drop?.pos || [this.held.ghost.position.x, this.held.ghost.position.y, this.held.ghost.position.z];
    const placement = addPart(this.design, this.held.partId, pos, { radial: !!drop?.radial });
    this.cancelHeld();
    if (placement) {
      this._addMesh(placement);
      this.select(placement.uid);
      this.hooks.sound?.('click');
      // Symmetry: a radially attached part gets an automatic twin opposite.
      if (this.symmetry && placement.radial) this.mirrorSelected(true);
      this.hooks.onChange?.();
    }
  }

  cancelHeld() {
    if (!this.held) return;
    this._disposeMesh(this.held.ghost);
    this.held = null;
    this._wasSnapped = false;
    this._clearNodes();
  }

  select(uid) {
    this.selected = uid;
    this._refreshSelection();
    this.hooks.onSelect?.(uid);
  }

  _refreshSelection() {
    const mesh = this.selected ? this.meshes.get(this.selected) : null;
    if (!mesh) { this.selBox.visible = false; return; }
    this.selBox.box.setFromObject(mesh);
    this.selBox.visible = true;
  }

  deleteSelected() {
    if (!this.selected) return false;
    const mesh = this.meshes.get(this.selected);
    if (mesh) this._disposeMesh(mesh);
    this.meshes.delete(this.selected);
    removePart(this.design, this.selected);
    this.select(null);
    this.hooks.onChange?.();
    return true;
  }

  /** Mirror the selected radial part to the opposite side of the core. */
  mirrorSelected(silent) {
    const src = findPart(this.design, this.selected);
    if (!src) return false;
    const [x, y, z] = src.pos;
    if (Math.hypot(x, z) < 0.05) return false;
    const twin = addPart(this.design, src.id, [-x, y, -z], { radial: true });
    if (twin) {
      this._addMesh(twin);
      if (!silent) { this.hooks.onChange?.(); this.hooks.sound?.('click'); }
    }
    return !!twin;
  }

  /** Nudge the selection along an axis (keyboard / on-screen arrows). */
  nudgeSelected(dx, dy, dz) {
    const p = findPart(this.design, this.selected);
    if (!p) return false;
    p.pos = [p.pos[0] + dx, Math.max(partHeight(p) / 2, p.pos[1] + dy), p.pos[2] + dz];
    this.syncMesh(p.uid);
    this._refreshSelection();
    this.hooks.onChange?.();
    return true;
  }

  setDesign(design) {
    this.design = design;
    this.cancelHeld();
    this.select(null);
    this.rebuild();
  }

  setSymmetry(on) { this.symmetry = on; }

  resize() {
    const w = this.canvas.clientWidth || 640;
    const h = this.canvas.clientHeight || 420;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    if (this.disposed) return;
    this._updateCamera();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.cancelHeld();
    for (const [, m] of this.meshes) this._disposeMesh(m);
    this.meshes.clear();
    this.nodeGeo.dispose();
    this.nodeMat.dispose();
    this.nodeMatActive.dispose();
    this.renderer.dispose();
  }
}
