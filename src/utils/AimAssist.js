// Aim assist — the mobile auto-aim players expect from FFM/PUBG-style
// games. Pure math (no DOM/three scene access) so it is unit-testable:
// given the ship's orientation and a target position, return the extra
// yaw/pitch deltas to pull the nose toward the target this frame.
//
// Behavior: only engages when the target is already roughly ahead (inside
// a cone) and within range; pull strength ramps up as the target gets
// centered, capped by maxRate so it feels like an assist, not autopilot.
import { Vector3 } from 'three';

const _fwd = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _to = new Vector3();

export const AIM_ASSIST_DEFAULTS = {
  coneCos: Math.cos(0.62), // ~35° — target must be near the nose
  range: 500,              // units — don't hunt targets across the system
  maxRate: 2.4             // rad/s at perfect alignment
};

/**
 * @param {Quaternion} shipQuat current ship orientation
 * @param {Vector3} shipPos
 * @param {Vector3} targetPos
 * @param {number} dt seconds
 * @param {{coneCos?: number, range?: number, maxRate?: number, enabled?: boolean}} [opts]
 * @returns {{yawDelta: number, pitchDelta: number, engaging: boolean}}
 */
export function computeAimAssist(shipQuat, shipPos, targetPos, dt, opts = {}) {
  const coneCos = opts.coneCos ?? AIM_ASSIST_DEFAULTS.coneCos;
  const range = opts.range ?? AIM_ASSIST_DEFAULTS.range;
  const maxRate = opts.maxRate ?? AIM_ASSIST_DEFAULTS.maxRate;
  const out = { yawDelta: 0, pitchDelta: 0, engaging: false };
  if (opts.enabled === false || dt <= 0) return out;

  _to.copy(targetPos).sub(shipPos);
  const dist = _to.length();
  if (dist < 0.5 || dist > range) return out;
  _to.divideScalar(dist);

  _fwd.set(0, 0, -1).applyQuaternion(shipQuat);
  _right.set(1, 0, 0).applyQuaternion(shipQuat);
  _up.set(0, 1, 0).applyQuaternion(shipQuat);

  const along = _fwd.dot(_to);
  if (along < coneCos) return out; // target outside the cone — no yank

  const yawErr = Math.atan2(_to.dot(_right), along);           // + = target to the right
  const pitchErr = Math.asin(Math.max(-1, Math.min(1, _to.dot(_up)))); // + = above

  // ramp: 0 at the cone edge → 1 when centered
  const ramp = (along - coneCos) / (1 - coneCos);
  const rate = maxRate * ramp;
  const step = rate * dt;
  // positive yawDelta turns left, positive pitchDelta pitches up (physics
  // uses Euler(pitch, yaw, roll, 'YXZ')) — pull toward the target.
  out.yawDelta = -clampMag(yawErr, step);
  out.pitchDelta = clampMag(pitchErr, step);
  out.engaging = Math.abs(yawErr) > 0.002 || Math.abs(pitchErr) > 0.002;
  return out;
}

function clampMag(v, max) {
  return Math.max(-max, Math.min(max, v));
}
