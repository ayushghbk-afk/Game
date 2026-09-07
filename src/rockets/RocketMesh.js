// RocketMesh — turns a design (part stack) into a 3D model.
// Shared by the VAB preview and the live launch, so what you assemble is
// literally what flies.
import * as THREE from 'three';
import { expandParts } from './RocketParts.js';

function matFor(part) {
  return new THREE.MeshStandardMaterial({
    color: part.color ?? 0xcccccc,
    roughness: part.cat === 'engine' ? 0.45 : 0.7,
    metalness: part.cat === 'engine' ? 0.8 : 0.35
  });
}

function geoFor(part) {
  const r = part.r || 0.5, h = part.h || 0.6;
  switch (part.shape) {
    case 'cone': return new THREE.ConeGeometry(r, h, 16);
    case 'nozzle': return new THREE.CylinderGeometry(r * 0.55, r, h, 16, 1, true);
    case 'taper': return new THREE.CylinderGeometry(r * 0.6, r, h, 16);
    case 'ring': return new THREE.CylinderGeometry(r, r, h, 16);
    case 'box': return new THREE.BoxGeometry(r * 1.6, h, r * 1.6);
    case 'cylinder':
    default: return new THREE.CylinderGeometry(r, r, h, 16);
  }
}

/**
 * Build the rocket. Parts stack bottom→top in design order. Returns a Group
 * with `dropStage(n)` so the launch can visibly shed spent stages.
 */
export function buildRocketMesh(design, opts = {}) {
  const scale = opts.scale ?? 0.06;   // world units per metre-ish
  const group = new THREE.Group();
  const parts = expandParts(design);
  const stageGroups = [];
  let current = new THREE.Group();
  stageGroups.push(current);
  group.add(current);

  let y = 0;
  for (const part of parts) {
    const h = part.h || 0.6;
    if (part.stage) {
      // decoupler: draw a thin band, then start a new stage group
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry((part.r || 0.6) * 1.02, (part.r || 0.6) * 1.02, h, 16),
        matFor(part)
      );
      band.position.y = y + h / 2;
      current.add(band);
      y += h;
      current = new THREE.Group();
      stageGroups.push(current);
      group.add(current);
      continue;
    }
    const mesh = new THREE.Mesh(geoFor(part), matFor(part));
    mesh.position.y = y + h / 2;
    if (part.shape === 'nozzle') mesh.rotation.x = Math.PI; // bell points down
    current.add(mesh);

    // engine glow plate — lights up during a burn
    if (part.cat === 'engine' || part.cat === 'booster') {
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry((part.r || 0.5) * 0.8, 14),
        new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.0 })
      );
      glow.rotation.x = Math.PI / 2;
      glow.position.y = y + 0.02;
      glow.userData.isFlame = true;
      current.add(glow);
    }
    y += h;
  }

  group.scale.setScalar(scale);
  group.userData.height = y;
  group.userData.stageGroups = stageGroups;

  /** Hide every stage below `n` — visible staging during the ascent. */
  group.dropStage = (n) => {
    for (let i = 0; i < n && i < stageGroups.length; i++) stageGroups[i].visible = false;
  };
  /** Flame intensity 0..1 on the currently burning stage. */
  group.setFlame = (stageIndex, intensity) => {
    const g = stageGroups[stageIndex];
    if (!g) return;
    g.traverse(o => { if (o.userData?.isFlame && o.material) o.material.opacity = intensity * 0.9; });
  };

  return group;
}
