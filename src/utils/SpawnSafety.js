// SpawnSafety — "why did I wake up inside the Sun?"
//
// The bug: ship positions were saved as ABSOLUTE world coordinates, but every
// planet and station is on a moving orbit driven by the sim clock. Reload the
// game hours later (or after a time-warp) and the coordinates that used to be
// "parked at Earth station" now point at empty space — and because the solar
// system is centred on the Sun at the origin, any position that fails to
// resolve, any NaN, and every "just spawn at 0,0,0" fallback drops the player
// straight into the star.
//
// The fix is two-layered:
//   1. Saves store an ANCHOR (a body id) plus an offset relative to it, so a
//      restored ship reappears next to the thing it was parked at, wherever
//      that thing has orbited to. Legacy absolute saves still load.
//   2. Every spawn goes through `safeSpawn()`, which refuses any position that
//      is non-finite or inside the Sun's danger radius and relocates the ship
//      to a known-good station/planet offset instead.

/** No spawn is ever allowed closer to the Sun than this (world units). */
export const SUN_SAFE_RADIUS = 90;

export function isFinitePosition(v) {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** True when this point would put the player in or dangerously near the star. */
export function insideSun(pos, sunPos, safeRadius = SUN_SAFE_RADIUS) {
  if (!isFinitePosition(pos)) return true;
  const dx = pos.x - (sunPos?.x || 0);
  const dy = pos.y - (sunPos?.y || 0);
  const dz = pos.z - (sunPos?.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz) < safeRadius;
}

/**
 * Resolve a spawn point.
 *   candidate  — desired position (may be garbage)
 *   fallbacks  — ordered list of { position } anchors (station, planet, …)
 *   sunPos     — the Sun's position
 *   offset     — applied to whichever fallback is used
 * Returns { position, relocated, reason }.
 */
export function safeSpawn(candidate, fallbacks, sunPos, offset = { x: 4, y: 2.5, z: 9 }) {
  const bad = !isFinitePosition(candidate)
    ? 'invalid coordinates'
    : insideSun(candidate, sunPos) ? 'inside the Sun' : null;

  if (!bad) return { position: { x: candidate.x, y: candidate.y, z: candidate.z }, relocated: false, reason: null };

  for (const anchor of fallbacks || []) {
    const p = anchor?.position || anchor;
    if (!isFinitePosition(p)) continue;
    const spot = { x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z };
    if (!insideSun(spot, sunPos)) return { position: spot, relocated: true, reason: bad };
  }

  // Absolute last resort: a safe ring well clear of the star.
  return {
    position: { x: (sunPos?.x || 0) + SUN_SAFE_RADIUS * 2, y: 0, z: (sunPos?.z || 0) + SUN_SAFE_RADIUS * 2 },
    relocated: true,
    reason: bad
  };
}

/**
 * Build a save-safe snapshot position: an anchor body id + the offset from it.
 * `bodies` is a list of { id, position }; the nearest one within `maxDist`
 * wins. Falls back to absolute coordinates when nothing is close.
 */
export function anchoredPosition(pos, bodies, maxDist = 400) {
  let best = null, bestD = Infinity;
  for (const b of bodies || []) {
    const p = b?.position;
    if (!isFinitePosition(p)) continue;
    const d = Math.hypot(pos.x - p.x, pos.y - p.y, pos.z - p.z);
    if (d < bestD) { bestD = d; best = b; }
  }
  if (best && bestD <= maxDist) {
    return {
      anchor: best.id,
      offset: [pos.x - best.position.x, pos.y - best.position.y, pos.z - best.position.z]
    };
  }
  return { anchor: null, offset: [pos.x, pos.y, pos.z] };
}

/** Inverse of anchoredPosition. `lookup(id)` returns { position } or null. */
export function resolveAnchored(snap, lookup) {
  if (!snap) return null;
  const off = snap.offset || snap.position;
  if (!Array.isArray(off) || off.length < 3) return null;
  if (snap.anchor) {
    const body = lookup?.(snap.anchor);
    const p = body?.position || body?.group?.position;
    if (isFinitePosition(p)) return { x: p.x + off[0], y: p.y + off[1], z: p.z + off[2] };
  }
  return { x: off[0], y: off[1], z: off[2] };
}
