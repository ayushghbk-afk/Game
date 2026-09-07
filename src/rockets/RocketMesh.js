// RocketMesh — turns a design (part stack) into a 3D model.
// Shared by the VAB preview and the live launch, so what you assemble is
// literally what flies.
import * as THREE from 'three';
import { expandParts, getPart, isPlacementDesign } from './RocketParts.js';
import { partTexture } from './PartTextures.js';

export function matFor(part) {
  // Procedural canvas textures carry the detail (rivets, stripes, ablative
  // tiles…); most are near-white so `part.color` still tints the part.
  const { map, tint } = partTexture(part);
  const color = map && !tint ? 0xffffff : (part.color ?? 0xcccccc);
  return new THREE.MeshStandardMaterial({
    color,
    map: map || null,
    roughness: part.cat === 'engine' ? 0.45 : 0.7,
    metalness: part.cat === 'engine' ? 0.8 : 0.35
  });
}

export function geoFor(part) {
  const r = part.r || 0.5, h = part.h || 0.6;
  switch (part.shape) {
    case 'cone': return new THREE.ConeGeometry(r, h, 16);
    case 'nozzle': return new THREE.CylinderGeometry(r * 0.55, r, h, 16, 1, true);
    case 'taper': return new THREE.CylinderGeometry(r * 0.6, r, h, 16);
    case 'ring': return new THREE.CylinderGeometry(r, r, h, 16);
    case 'sphere': return new THREE.SphereGeometry(r, 20, 14);
    case 'dish': return new THREE.CylinderGeometry(r, r * 0.18, h, 18, 1, true);
    case 'panel': return new THREE.BoxGeometry(r * 2.1, Math.max(h, 0.12), r * 0.3);
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
  // A 3D (v2) design already knows where every part sits, including strap-on
  // boosters, so we honour that layout exactly — the vehicle that lifts off
  // is the one you assembled on the pad.
  if (isPlacementDesign(design)) return buildPlacedMesh(design, scale);

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

/**
 * Build a 3D (v2) design from its placements. Stages come from the same
 * geometric rule the VAB and the flight model use, so `dropStage(n)` sheds
 * exactly the hardware the player watched separate.
 */
function buildPlacedMesh(design, scale) {
  const group = new THREE.Group();
  const stages = design.__stages || placementStages(design);
  const stageGroups = [];

  // Everything is modelled around the pad, so shift the stack down to y=0.
  let minY = Infinity;
  for (const p of design.parts) minY = Math.min(minY, p.pos[1] - (getPart(p.id)?.h || 0.6) / 2);
  if (!Number.isFinite(minY)) minY = 0;

  let maxY = 0;
  for (const stage of stages) {
    const g = new THREE.Group();
    stageGroups.push(g);
    group.add(g);
    for (const placement of stage) {
      const part = getPart(placement.id);
      if (!part) continue;
      const h = part.h || 0.6;
      const mesh = new THREE.Mesh(geoFor(part), matFor(part));
      mesh.position.set(placement.pos[0], placement.pos[1] - minY, placement.pos[2]);
      if (part.shape === 'nozzle') mesh.rotation.x = Math.PI;
      g.add(mesh);
      maxY = Math.max(maxY, placement.pos[1] - minY + h / 2);

      if (part.cat === 'engine' || part.cat === 'booster') {
        const glow = new THREE.Mesh(
          new THREE.CircleGeometry((part.r || 0.5) * 0.8, 14),
          new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0 })
        );
        glow.rotation.x = Math.PI / 2;
        glow.position.set(placement.pos[0], placement.pos[1] - minY - h / 2 + 0.02, placement.pos[2]);
        glow.userData.isFlame = true;
        g.add(glow);
      }
    }
  }

  group.scale.setScalar(scale);
  group.userData.height = maxY;
  group.userData.stageGroups = stageGroups;
  group.dropStage = (n) => {
    for (let i = 0; i < n && i < stageGroups.length; i++) stageGroups[i].visible = false;
  };
  group.setFlame = (stageIndex, intensity) => {
    const g = stageGroups[stageIndex];
    if (!g) return;
    g.traverse(o => { if (o.userData?.isFlame && o.material) o.material.opacity = intensity * 0.9; });
  };
  group.disposeMesh = () => group.traverse(o => {
    if (o.isMesh) { o.geometry?.dispose(); o.material?.dispose(); }
  });
  return group;
}

/**
 * Local copy of the staging rule (bottom→top, decouplers split, radials join
 * their neighbour) so this module does not import RocketDesign.js and create
 * an import cycle.
 */
function placementStages(design) {
  const core = design.parts.filter(p => !p.radial).sort((a, b) => a.pos[1] - b.pos[1]);
  const radial = design.parts.filter(p => p.radial);
  const stages = [];
  let current = [];
  for (const p of core) {
    if (getPart(p.id)?.stage) { stages.push(current); current = []; }
    else current.push(p);
  }
  stages.push(current);
  const nonEmpty = stages.filter(s => s.length);
  if (!nonEmpty.length) return radial.length ? [radial] : [];
  for (const rp of radial) {
    let best = 0, bestD = Infinity;
    nonEmpty.forEach((stage, i) => {
      for (const sp of stage) {
        const d = Math.abs(sp.pos[1] - rp.pos[1]);
        if (d < bestD) { bestD = d; best = i; }
      }
    });
    nonEmpty[best].push(rp);
  }
  return nonEmpty;
}
