// Simplified gravity: a = μ / d²  (μ = g·r², gameplay-clamped).
// Planets use radius-based pseudo-mass so gas giants don't dominate the map.
import * as THREE from 'three';

const MAX_ACCEL = 3.4;      // hard clamp keeps flight stable & fun
const MIN_INFLUENCE = 0.02; // below this we ignore the body entirely

const _tmp = new THREE.Vector3();

/**
 * @param {THREE.Vector3} position  ship world position
 * @param {Body[]} bodies           planets + moons
 * @param {THREE.Vector3} out       accumulator (added into)
 * @returns strongest influencing body (or null)
 */
export function applyGravity(position, bodies, out) {
  let strongest = null, strongestA = 0;
  for (const body of bodies) {
    _tmp.subVectors(body.group.position, position);
    const d2 = Math.max(_tmp.lengthSq(), body.radius * body.radius * 0.25);
    const d = Math.sqrt(d2);
    const a = body.mu / d2;
    if (a < MIN_INFLUENCE) continue;
    const clamped = Math.min(a, MAX_ACCEL);
    _tmp.multiplyScalar(clamped / d);
    out.add(_tmp);
    if (a > strongestA) { strongestA = a; strongest = body; }
  }
  return strongest;
}
