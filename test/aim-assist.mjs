// Aim assist unit tests — pure math, no DOM. Verifies the FFM/PUBG-style
// auto-aim direction, cone, range and rate behavior of
// src/utils/AimAssist.js (the sign convention must match mouse look:
// negative yawDelta = turn right, positive pitchDelta = nose up).
import { Quaternion, Vector3, Euler } from 'three';
import { computeAimAssist, AIM_ASSIST_DEFAULTS } from '../src/utils/AimAssist.js';

let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.error('  ✗', name, '—', e.message); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
const near = (a, b, eps, msg) => assert(Math.abs(a - b) < eps, msg || `expected ≈${b}, got ${a}`);

const SHIP = new Vector3(0, 0, 300);
const SUN = new Vector3(0, 0, 0);
const IDENTITY = new Quaternion(); // facing -Z, which points at the sun from SHIP

check('defaults are sane', () => {
  assert(AIM_ASSIST_DEFAULTS.range > 0);
  assert(AIM_ASSIST_DEFAULTS.maxRate > 0);
  assert(AIM_ASSIST_DEFAULTS.coneCos > 0 && AIM_ASSIST_DEFAULTS.coneCos < 1);
});

check('dead-center target: no pull, not engaging', () => {
  const r = computeAimAssist(IDENTITY, SHIP, SUN, 0.016);
  near(r.yawDelta, 0, 1e-6); near(r.pitchDelta, 0, 1e-6);
  assert(r.engaging === false);
});

check('target 30° to the right: pulls right (negative yawDelta)', () => {
  // ship's right vector is +X; put the target 30° right of dead ahead
  const t = new Vector3(Math.sin(0.52) * 300, 0, -Math.cos(0.52) * 300).add(SHIP);
  const r = computeAimAssist(IDENTITY, SHIP, t, 0.016);
  assert(r.yawDelta < 0, `yawDelta should be negative (turn right), got ${r.yawDelta}`);
  near(r.pitchDelta, 0, 1e-6);
  assert(r.engaging === true);
});

check('target 30° to the left: pulls left (positive yawDelta)', () => {
  const t = new Vector3(-Math.sin(0.52) * 300, 0, -Math.cos(0.52) * 300).add(SHIP);
  const r = computeAimAssist(IDENTITY, SHIP, t, 0.016);
  assert(r.yawDelta > 0, `yawDelta should be positive (turn left), got ${r.yawDelta}`);
  assert(r.engaging === true);
});

check('target above: pitches up (positive pitchDelta)', () => {
  const t = new Vector3(0, Math.sin(0.4) * 300, -Math.cos(0.4) * 300).add(SHIP);
  const r = computeAimAssist(IDENTITY, SHIP, t, 0.016);
  assert(r.pitchDelta > 0, `pitchDelta should be positive (nose up), got ${r.pitchDelta}`);
  assert(r.engaging === true);
});

check('target behind the cone edge: no assist (no yank)', () => {
  // 60° off-axis — outside the ~35° cone
  const t = new Vector3(Math.sin(1.05) * 300, 0, -Math.cos(1.05) * 300).add(SHIP);
  const r = computeAimAssist(IDENTITY, SHIP, t, 0.016);
  near(r.yawDelta, 0, 1e-9);
  assert(r.engaging === false);
});

check('target behind the ship: no assist', () => {
  const t = new Vector3(0, 0, 300).add(SHIP); // straight back
  const r = computeAimAssist(IDENTITY, SHIP, t, 0.016);
  near(r.yawDelta, 0, 1e-9);
  assert(r.engaging === false);
});

check('target out of range: no assist', () => {
  const t = new Vector3(0, 0, -600).add(SHIP); // 600 > range 500
  const r = computeAimAssist(IDENTITY, SHIP, t, 0.016);
  near(r.yawDelta, 0, 1e-9);
  assert(r.engaging === false);
});

check('disabled: always idle', () => {
  const t = new Vector3(Math.sin(0.3) * 300, 0, -Math.cos(0.3) * 300).add(SHIP);
  const r = computeAimAssist(IDENTITY, SHIP, t, 0.016, { enabled: false });
  near(r.yawDelta, 0, 1e-9);
  assert(r.engaging === false);
});

check('rate is capped: one frame can only turn by maxRate*dt', () => {
  const t = new Vector3(Math.sin(0.5) * 300, 0, -Math.cos(0.5) * 300).add(SHIP);
  const dt = 0.016;
  const r = computeAimAssist(IDENTITY, SHIP, t, dt);
  assert(Math.abs(r.yawDelta) <= AIM_ASSIST_DEFAULTS.maxRate * dt + 1e-9,
    `yawDelta ${r.yawDelta} exceeds cap ${AIM_ASSIST_DEFAULTS.maxRate * dt}`);
});

check('iterating converges onto the target', () => {
  const t = new Vector3(Math.sin(0.5) * 300, 0, -Math.cos(0.5) * 300).add(SHIP);
  const q = new Quaternion();
  const dt = 0.016;
  let last = 0;
  for (let i = 0; i < 600; i++) {
    const r = computeAimAssist(q, SHIP, t, dt);
    if (!r.engaging) break;
    q.premultiply(new Quaternion().setFromEuler(new Euler(r.pitchDelta, r.yawDelta, 0, 'YXZ')));
    last = i;
  }
  const fwd = new Vector3(0, 0, -1).applyQuaternion(q);
  const dir = t.clone().sub(SHIP).normalize();
  assert(fwd.angleTo(dir) < 0.01, `did not converge (off by ${fwd.angleTo(dir)} rad, stopped at frame ${last})`);
});

console.log(`\naim-assist: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
