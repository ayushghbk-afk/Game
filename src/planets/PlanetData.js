// Planet/moon fact registry + display helpers (real facts come from config).
import { PLANETS, MOONS, ANOMALIES, SUN_CONFIG, SCALE } from '../config.js';

export const ALL_BODIES = [
  { kind: 'star', cfg: SUN_CONFIG },
  ...PLANETS.map(p => ({ kind: 'planet', cfg: p })),
  ...MOONS.map(m => ({ kind: 'moon', cfg: m }))
];

export function findBody(id) {
  if (id === SUN_CONFIG.id) return { kind: 'star', cfg: SUN_CONFIG };
  return ALL_BODIES.find(b => b.cfg.id === id) || null;
}

export function factsLines(cfg) {
  const f = cfg.facts || {};
  return [
    ['Type', f.type], ['Radius', f.radius], ['Gravity', f.gravity],
    ['Moons', f.moons], ['Atmosphere', f.atmosphere], ['Temperature', f.temperature]
  ].filter(([, v]) => v !== undefined);
}

/** HUD-facing pretty distance string. Game units → thousands of km. */
export function formatDistance(units) {
  const km = units * SCALE.KM_PER_UNIT;
  if (km > 1e6) return (km / 1e6).toFixed(2) + 'M KM';
  if (km > 1e3) return formatKm(km);
  return Math.round(km) + ' KM';
}
function formatKm(km) {
  return Math.round(km).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' KM';
}
export function formatSpeed(unitsPerSec) {
  return Math.round(unitsPerSec * SCALE.KM_PER_UNIT).toLocaleString('en-US') + ' KM/S';
}
