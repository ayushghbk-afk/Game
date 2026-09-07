// LandingSequence — cinematic descent from orbit into the surface scene.
//
// Plays over the surface scene the moment it is created: the shuttle starts
// high above the outpost with atmospheric entry glow, fires retros, kicks up
// dust, and settles on the pad. The player regains control at touchdown.
import * as THREE from 'three';
import { getGlowTexture } from '../planets/ProceduralTextures.js';
import { clamp, lerp } from '../utils/Noise.js';

const PHASES = [
  { id: 'entry',    dur: 2.4 },   // atmospheric / approach streak
  { id: 'retro',    dur: 2.8 },   // flip + burn, slow the fall
  { id: 'suicide',  dur: 2.2 },   // final descent over the pad
  { id: 'touchdown', dur: 1.1 },  // settle + dust plume
  { id: 'done',     dur: 0 }
];

export class LandingSequence {
  /**
   * @param surface  SurfaceScene that was just constructed
   * @param camera   shared THREE.PerspectiveCamera
   * @param opts     { onDone, cloudDeck }
   */
  constructor(surface, camera, opts = {}) {
    this.surface = surface;
    this.camera = camera;
    this.onDone = opts.onDone || null;
    this.cloudDeck = !!opts.cloudDeck;
    this.t = 0;
    this.phaseIdx = 0;
    this.phaseT = 0;
    this.done = false;
    this.skipRequested = false;

    // Freeze vehicle control while the cinematic runs.
    surface.vehicleMode = 'shuttle';
    surface.landed = false;

    const pad = surface.basePos?.clone?.() || new THREE.Vector3(0, surface.heightAt(0, 0), 0);
    this.pad = pad;
    // Start high above and slightly offset so the approach has a sweep.
    this.startPos = new THREE.Vector3(pad.x + 55, pad.y + 220, pad.z + 90);
    this.midPos = new THREE.Vector3(pad.x + 18, pad.y + 70, pad.z + 30);
    this.endPos = new THREE.Vector3(pad.x + 10, pad.y + 1.5, pad.z + 14);

    const st = surface.shipState;
    st.position.copy(this.startPos);
    st.velocity.set(0, -18, 0);
    st.quaternion.identity();
    surface.yaw = Math.atan2(-(this.endPos.x - this.startPos.x), -(this.endPos.z - this.startPos.z));
    surface.pitch = -0.55;
    surface.ship.group.position.copy(st.position);
    surface.ship.group.visible = true;

    this._buildFX();
    this._placeCamera(0);
  }

  _buildFX() {
    const s = this.surface.scene;
    // Heat shield glow (entry)
    this.heat = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture('rgba(255,200,120,1)', 'rgba(255,80,20,0.35)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0
    }));
    this.heat.scale.setScalar(18);
    s.add(this.heat);

    // Engine plume
    this.plume = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture('rgba(160,210,255,1)', 'rgba(60,120,255,0.4)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0
    }));
    this.plume.scale.setScalar(6);
    s.add(this.plume);

    // Dust ring at touchdown
    const dustGeo = new THREE.RingGeometry(2, 18, 32);
    dustGeo.rotateX(-Math.PI / 2);
    this.dust = new THREE.Mesh(dustGeo, new THREE.MeshBasicMaterial({
      color: 0xc8b090, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
    }));
    this.dust.position.copy(this.pad);
    this.dust.position.y += 0.4;
    s.add(this.dust);

    // Entry streak particles
    const n = 60;
    const pos = new Float32Array(n * 3);
    this._streakVel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 40;
      pos[i * 3 + 1] = Math.random() * 80;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
      this._streakVel[i * 3] = (Math.random() - 0.5) * 4;
      this._streakVel[i * 3 + 1] = -30 - Math.random() * 40;
      this._streakVel[i * 3 + 2] = (Math.random() - 0.5) * 4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.streaks = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffc070, size: 1.4, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    }));
    this.streaks.frustumCulled = false;
    s.add(this.streaks);
    this._streakPos = pos;
    this._streakGeo = geo;
  }

  get phase() { return PHASES[this.phaseIdx]?.id || 'done'; }

  /** Progress 0..1 through the whole cinematic. */
  get progress() {
    let total = 0, done = 0;
    for (let i = 0; i < PHASES.length - 1; i++) total += PHASES[i].dur;
    for (let i = 0; i < this.phaseIdx; i++) done += PHASES[i].dur;
    done += this.phaseT;
    return total > 0 ? clamp(done / total, 0, 1) : 1;
  }

  skip() { this.skipRequested = true; }

  /**
   * Advance the cinematic. Returns true while still running.
   * Does NOT read player input — Game should not sample controls during this.
   */
  update(dt) {
    if (this.done) return false;
    if (this.skipRequested) {
      this._finish();
      return false;
    }

    this.t += dt;
    this.phaseT += dt;
    const phase = PHASES[this.phaseIdx];
    if (phase && phase.dur > 0 && this.phaseT >= phase.dur) {
      this.phaseT = 0;
      this.phaseIdx++;
      if (PHASES[this.phaseIdx]?.id === 'done') {
        this._finish();
        return false;
      }
    }

    const p = this.progress;
    const st = this.surface.shipState;

    // Trajectory: start → mid (entry/retro) → end (suicide burn).
    let pos;
    if (p < 0.45) {
      const u = p / 0.45;
      const e = u * u * (3 - 2 * u);
      pos = this.startPos.clone().lerp(this.midPos, e);
      // Arc downward
      pos.y = lerp(this.startPos.y, this.midPos.y, e) - Math.sin(e * Math.PI) * 12;
    } else if (p < 0.82) {
      const u = (p - 0.45) / 0.37;
      const e = u * u * (3 - 2 * u);
      pos = this.midPos.clone().lerp(this.endPos, e);
    } else {
      const u = (p - 0.82) / 0.18;
      const e = 1 - Math.pow(1 - u, 3);
      pos = this.endPos.clone();
      pos.y = lerp(this.endPos.y + 4, this.endPos.y, e);
    }
    // Snap to terrain so we never clip the ground at the end.
    const ground = this.surface.heightAt(pos.x, pos.z);
    pos.y = Math.max(pos.y, ground + 1.4);
    st.position.copy(pos);
    st.speed = 12 * (1 - p);
    st.velocity.set(0, p < 0.7 ? -8 : -1.5, 0);

    // Orient nose: entry points down-range, then upright for landing.
    const yaw = this.surface.yaw;
    let pitch;
    if (p < 0.35) pitch = -1.05;
    else if (p < 0.6) pitch = lerp(-1.05, 0.15, (p - 0.35) / 0.25); // flip
    else pitch = lerp(0.15, -0.2, clamp((p - 0.6) / 0.4, 0, 1));
    this.surface.pitch = pitch;
    st.quaternion.setFromEuler(new THREE.Euler(pitch * 0.4, yaw, 0, 'YXZ'));
    this.surface.ship.group.position.copy(pos);
    this.surface.ship.group.quaternion.copy(st.quaternion);

    // Engine flame
    const burning = p > 0.3 && p < 0.95;
    if (this.surface.ship.flame) {
      const thrust = burning ? (0.6 + Math.sin(this.t * 30) * 0.15) : 0.02;
      this.surface.ship.flame.scale.setScalar(thrust * 4.5);
      this.surface.ship.flame.material.opacity = thrust;
    }
    if (this.surface.ship.engineLight) {
      this.surface.ship.engineLight.intensity = burning ? 4.5 : 0;
    }

    // FX
    this.heat.position.copy(pos);
    this.heat.material.opacity = p < 0.4 ? (this.cloudDeck ? 0.3 : 0.85 * (1 - p / 0.4)) : 0;
    this.heat.scale.setScalar(12 + (1 - p) * 18);

    this.plume.position.set(pos.x, pos.y - 2.2, pos.z);
    this.plume.material.opacity = burning ? 0.7 : 0;
    this.plume.scale.setScalar(4 + Math.sin(this.t * 20) * 1.2);

    // Dust expands on final approach
    if (p > 0.75) {
      const d = (p - 0.75) / 0.25;
      this.dust.scale.setScalar(0.4 + d * 2.4);
      this.dust.material.opacity = Math.sin(d * Math.PI) * 0.55;
      this.dust.position.y = ground + 0.35;
    }

    // Streak particles during entry
    if (p < 0.5) {
      const arr = this._streakPos;
      for (let i = 0; i < arr.length / 3; i++) {
        arr[i * 3] += this._streakVel[i * 3] * dt;
        arr[i * 3 + 1] += this._streakVel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += this._streakVel[i * 3 + 2] * dt;
        if (arr[i * 3 + 1] < -20) {
          arr[i * 3] = pos.x + (Math.random() - 0.5) * 30;
          arr[i * 3 + 1] = pos.y + 40 + Math.random() * 40;
          arr[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 30;
        }
      }
      this._streakGeo.attributes.position.needsUpdate = true;
      this.streaks.material.opacity = 0.9 * (1 - p / 0.5);
      this.streaks.visible = true;
    } else {
      this.streaks.visible = false;
    }

    this._placeCamera(p);

    // Keep streaming props under the camera so the world isn't empty.
    this.surface.streamer?.update(pos.x, pos.z);
    return true;
  }

  _placeCamera(p) {
    const st = this.surface.shipState.position;
    // Sweep: wide chase during entry → side angle on flip → low pad view at touchdown.
    let back, up, side;
    if (p < 0.4) {
      back = 40 + (1 - p / 0.4) * 50;
      up = 18 + (1 - p / 0.4) * 30;
      side = 12;
    } else if (p < 0.75) {
      const u = (p - 0.4) / 0.35;
      back = lerp(40, 22, u);
      up = lerp(18, 10, u);
      side = lerp(12, 16, u);
    } else {
      const u = (p - 0.75) / 0.25;
      back = lerp(22, 14, u);
      up = lerp(10, 6, u);
      side = lerp(16, 8, u);
    }
    const yaw = this.surface.yaw;
    const cam = this.camera;
    cam.position.set(
      st.x + Math.sin(yaw) * back + Math.cos(yaw) * side,
      st.y + up,
      st.z + Math.cos(yaw) * back - Math.sin(yaw) * side
    );
    cam.lookAt(st.x, st.y + 1.5, st.z);
    cam.fov = lerp(62, 70, p);
    cam.updateProjectionMatrix();
  }

  _finish() {
    if (this.done) return;
    this.done = true;
    const st = this.surface.shipState;
    const ground = this.surface.heightAt(this.endPos.x, this.endPos.z);
    st.position.set(this.endPos.x, ground + 1.4, this.endPos.z);
    st.velocity.set(0, 0, 0);
    st.speed = 0;
    this.surface.pitch = -0.25;
    st.quaternion.setFromEuler(new THREE.Euler(0, this.surface.yaw, 0));
    this.surface.ship.group.position.copy(st.position);
    this.surface.ship.group.quaternion.copy(st.quaternion);
    this.surface.landed = true;
    if (this.surface.ship.flame) {
      this.surface.ship.flame.scale.setScalar(0.01);
      this.surface.ship.flame.material.opacity = 0;
    }
    if (this.surface.ship.engineLight) this.surface.ship.engineLight.intensity = 0;

    // Final camera settle
    this._placeCamera(1);

    this.onDone?.();
  }

  /** Caption for the landing HUD. */
  caption() {
    switch (this.phase) {
      case 'entry': return this.cloudDeck ? 'ENTERING CLOUD LAYER' : 'ATMOSPHERIC ENTRY';
      case 'retro': return 'RETRO BURN — FLIPPING FOR LANDING';
      case 'suicide': return 'FINAL DESCENT — PAD IN SIGHT';
      case 'touchdown': return 'TOUCHDOWN';
      default: return 'LANDING COMPLETE';
    }
  }

  dispose() {
    for (const o of [this.heat, this.plume, this.dust, this.streaks]) {
      if (!o) continue;
      o.removeFromParent();
      o.geometry?.dispose?.();
      if (o.material) {
        o.material.map?.dispose?.();
        o.material.dispose?.();
      }
    }
  }
}
