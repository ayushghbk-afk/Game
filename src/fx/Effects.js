// Effects — pooled particle FX (engine sparks, mining sparks, explosions),
// mining beam, warp/arrival flashes. Everything pooled & quality-scaled.
import * as THREE from 'three';
import { QUALITY } from '../config.js';
import { getGlowTexture } from '../planets/ProceduralTextures.js';

class ParticlePool {
  constructor(scene, count, color, size = 0.5, additive = true) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({
      color, size, transparent: true, opacity: 0.9, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      map: getGlowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.4)', 64),
      sizeAttenuation: true
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.geo = geo;
    this.cursor = 0;
    scene.add(this.points);
  }
  spawn(p, v, life) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = life; this.maxLife[i] = life;
  }
  update(dt) {
    let alive = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      alive = true;
      this.life[i] -= dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = 1e9; } // hide dead
    }
    if (alive) this.geo.attributes.position.needsUpdate = true;
  }
  dispose() { this.geo.dispose(); this.points.material.dispose(); this.points.removeFromParent(); }
}

export class Effects {
  constructor(scene, quality) {
    this.scene = scene;
    const pf = QUALITY[quality].particles;
    this.enginePool = new ParticlePool(scene, Math.floor(90 * pf), 0x7fb8ff, 0.34);
    this.minePool = new ParticlePool(scene, Math.floor(70 * pf), 0xffc36e, 0.3);
    this.explosionPool = new ParticlePool(scene, Math.floor(140 * pf), 0xffa050, 0.55);

    // mining beam (hidden by default)
    const beamGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 6, 1, true);
    beamGeo.translate(0, 0.5, 0);
    beamGeo.rotateX(Math.PI / 2); // beam points along -Z of its object
    this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
      color: 0xffb040, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.beam.visible = false;
    scene.add(this.beam);

    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
  }

  enginePuff(shipPos, backDir, spread, boosting) {
    this._tmpV.copy(shipPos);
    const v = this._tmpV2.copy(backDir).multiplyScalar(6 + Math.random() * 4);
    v.x += (Math.random() - 0.5) * spread; v.y += (Math.random() - 0.5) * spread; v.z += (Math.random() - 0.5) * spread;
    this.enginePool.spawn(this._tmpV, v, boosting ? 0.75 : 0.5);
  }

  mineSparks(at) {
    this._tmpV.set(at.x, at.y, at.z);
    this._tmpV2.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
    this.minePool.spawn(this._tmpV, this._tmpV2, 0.5);
  }

  explosion(at, scale = 1) {
    for (let i = 0; i < 60; i++) {
      this._tmpV.set(at.x, at.y, at.z);
      this._tmpV2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar((4 + Math.random() * 14) * scale);
      this.explosionPool.spawn(this._tmpV, this._tmpV2, 0.7 + Math.random() * 0.7);
    }
  }

  setBeam(from, to, active) {
    this.beam.visible = active;
    if (!active) return;
    const dir = this._tmpV.subVectors(to, from);
    const len = dir.length();
    this.beam.position.copy(from);
    this.beam.lookAt(to);
    this.beam.scale.set(1, 1, len);
    this.beam.material.opacity = 0.45 + Math.random() * 0.4;
  }

  update(dt) {
    this.enginePool.update(dt);
    this.minePool.update(dt);
    this.explosionPool.update(dt);
  }

  dispose() {
    this.enginePool.dispose(); this.minePool.dispose(); this.explosionPool.dispose();
    this.beam.geometry.dispose(); this.beam.material.removeFromParent?.(); this.beam.removeFromParent();
  }
}
