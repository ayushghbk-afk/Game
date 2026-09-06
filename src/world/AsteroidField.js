// AsteroidField — instanced procedural asteroids in the main belt.
// Each rock has composition, ore remaining, spin; depleted rocks are
// recycled (object pooling) once the player is far away.
import * as THREE from 'three';
import { BELT, QUALITY } from '../config.js';
import { mulberry32 } from '../utils/Noise.js';

const TYPES = [
  { id: 'IRON', label: 'IRON ASTEROID', color: 0x9c7a5c,
    comp: { iron: 0.72, nickel: 0.18, water: 0.08, rare: 0.02 } },
  { id: 'NICKEL', label: 'NICKEL ASTEROID', color: 0xa8b0b8,
    comp: { nickel: 0.68, iron: 0.22, rare: 0.04, water: 0.06 } },
  { id: 'ICE', label: 'ICE ASTEROID', color: 0xbfe0ee,
    comp: { ice: 0.7, water: 0.25, rare: 0.05 } },
  { id: 'RARE', label: 'RARE-MINERAL ASTEROID', color: 0xb98ae8,
    comp: { rare: 0.32, nickel: 0.3, iron: 0.38 } }
];

const TYPE_WEIGHTS = [0.45, 0.3, 0.18, 0.07];

function pickType(rand) {
  let r = rand(), acc = 0;
  for (let i = 0; i < TYPES.length; i++) { acc += TYPE_WEIGHTS[i]; if (r <= acc) return TYPES[i]; }
  return TYPES[0];
}

export class AsteroidField {
  constructor(scene, quality) {
    this.scene = scene;
    const count = Math.floor(BELT.counts[quality] * QUALITY[quality].beltScale);
    this.count = count;
    this.group = new THREE.Group();
    scene.add(this.group);

    // one deformed icosahedron geometry shared by every instance
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const pos = geo.attributes.position;
    const rand = mulberry32(777);
    for (let i = 0; i < pos.count; i++) {
      const s = 0.72 + rand() * 0.55;
      pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.86, pos.getZ(i) * s);
    }
    geo.computeVertexNormals();
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.08, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, this.material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    this.data = [];
    const r2 = mulberry32(1234);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const type = pickType(r2);
      const a = r2() * Math.PI * 2;
      const rad = BELT.inner + Math.pow(r2(), 0.8) * (BELT.outer - BELT.inner);
      const size = 0.35 + Math.pow(r2(), 1.6) * 1.35;
      const ast = {
        i, type, size,
        x: Math.cos(a) * rad, y: (r2() - 0.5) * BELT.thickness * 2, z: -Math.sin(a) * rad,
        rotAxis: new THREE.Vector3(r2() - 0.5, r2() - 0.5, r2() - 0.5).normalize(),
        rotAngle: r2() * Math.PI * 2,
        rotSpeed: 0.1 + r2() * 0.5,
        ore: Math.round(size * 46 + 8), maxOre: 0, depleted: false
      };
      ast.maxOre = ast.ore;
      this.data.push(ast);
      dummy.position.set(ast.x, ast.y, ast.z);
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      this.mesh.setColorAt(i, color.setHex(type.color).multiplyScalar(0.8 + r2() * 0.3));
    }
    this.mesh.instanceColor.needsUpdate = true;
    this._dummy = dummy;
    this._mat = new THREE.Matrix4();
  }

  /** Rotates near-field rocks; far rocks keep static matrices (cheap). */
  update(dt, shipPos) {
    const d = this._dummy;
    for (const ast of this.data) {
      const dx = ast.x - shipPos.x, dz = ast.z - shipPos.z;
      if (dx * dx + dz * dz > 260 * 260) continue;
      ast.rotAngle += ast.rotSpeed * dt;
      d.position.set(ast.x, ast.y, ast.z);
      d.quaternion.setFromAxisAngle(ast.rotAxis, ast.rotAngle);
      d.scale.setScalar(ast.depleted ? 0.001 : ast.size);
      d.updateMatrix();
      this.mesh.setMatrixAt(ast.i, d.matrix);
      ast._dirty = true;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Nearest minable asteroid in front of the ship within `range`. */
  findMineTarget(shipPos, forward, range = 10) {
    let best = null, bestD = range;
    const v = new THREE.Vector3();
    for (const ast of this.data) {
      if (ast.depleted) continue;
      v.set(ast.x - shipPos.x, ast.y - shipPos.y, ast.z - shipPos.z);
      const dist = v.length();
      if (dist > Math.max(range, ast.size + 6)) continue;
      if (dist > 4 && v.normalize().dot(forward) < 0.55) continue;
      if (dist < bestD + ast.size) { best = ast; bestD = dist - ast.size; }
    }
    return best;
  }

  /** Extract `rate` ore units. Returns {type, amount} or null. */
  mine(ast, rate) {
    if (!ast || ast.depleted) return null;
    const got = Math.min(rate, ast.ore);
    ast.ore -= got;
    if (ast.ore <= 0) ast.depleted = true;
    const out = {};
    for (const k in ast.type.comp) out[k] = got * ast.type.comp[k];
    return { amount: got, resources: out, type: ast.type, progress: 1 - ast.ore / ast.maxOre };
  }

  /** Pool recycle: respawn depleted rocks far from the player. */
  recycle(shipPos) {
    const far = (ast) => {
      const dx = ast.x - shipPos.x, dz = ast.z - shipPos.z;
      return dx * dx + dz * dz > 220 * 220;
    };
    let changed = false;
    const rand = Math.random;
    for (const ast of this.data) {
      if (!ast.depleted || !far(ast)) continue;
      ast.depleted = false;
      ast.ore = ast.maxOre;
      const a = rand() * Math.PI * 2;
      const rad = BELT.inner + rand() * (BELT.outer - BELT.inner);
      ast.x = Math.cos(a) * rad; ast.y = (rand() - 0.5) * BELT.thickness * 2; ast.z = -Math.sin(a) * rad;
      const d = this._dummy;
      d.position.set(ast.x, ast.y, ast.z);
      d.quaternion.setFromAxisAngle(ast.rotAxis, ast.rotAngle);
      d.scale.setScalar(ast.size);
      d.updateMatrix();
      this.mesh.setMatrixAt(ast.i, d.matrix);
      changed = true;
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Collision check vs ship. Returns damage amount or 0. */
  collideShip(shipPos, radius, velocity) {
    let dmg = 0;
    for (const ast of this.data) {
      const dx = ast.x - shipPos.x, dy = ast.y - shipPos.y, dz = ast.z - shipPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const min = ast.size * 0.8 + radius;
      if (d2 < min * min && !ast.depleted) {
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) / d;
        shipPos.x -= dx * push; shipPos.y -= dy * push; shipPos.z -= dz * push;
        const speed = velocity.length();
        velocity.multiplyScalar(0.4);
        dmg = Math.max(dmg, speed * 2.4);
      }
    }
    return dmg;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
