// ============================================================
// SOLAR SYSTEM CONFIG — single source of truth for the world.
// Distances/radii are GAME UNITS (1 unit ≈ 1000 km for HUD display),
// compressed from real AU values into a playable play-space.
//   gameOrbit = 40 + 120 * AU^0.72      (distance compression)
//   gameRadius = 2.2 * (R/R_earth)^0.55 (size compression, sun manual)
// Real-world facts shown in the UI come from the `facts` blocks.
// ============================================================

export const SCALE = {
  KM_PER_UNIT: 1000,          // HUD display factor
  SUN_RADIUS: 26,             // visual sun radius (compressed)
  START_RADIUS: 4000          // star field / world shell radius
};

/** Kepler-ish angular speed: Earth completes an orbit in ~12 sim-hours. */
export const EARTH_OMEGA = (Math.PI * 2) / (60 * 60 * 12); // rad per game-second

function omegaFor(au) { return EARTH_OMEGA / Math.pow(au, 1.5); }

// ---- Orbital radii (precomputed from the compression formula) ----
export const ORBIT = {
  MERCURY: 100.6, VENUS: 135.1, EARTH: 160.0, MARS: 202.5,
  BELT_INNER: 252, BELT_OUTER: 300,
  JUPITER: 433.2, SATURN: 648.4, URANUS: 1047, NEPTUNE: 1432
};

export const SUN_CONFIG = {
  id: 'sun', name: 'SOL',
  radius: SCALE.SUN_RADIUS,
  facts: {
    type: 'G-type Main Sequence Star', radius: '696,340 km', gravity: '274 m/s²',
    temperature: '5,505°C (surface)', atmosphere: 'Hydrogen / Helium', moons: '8 planets'
  },
  codex: 'The heart of the Solar System, holding 99.86% of its total mass. Every world in this system dances to its gravity.'
};

export const PLANETS = [
  {
    id: 'mercury', name: 'MERCURY', au: 0.387, orbitRadius: ORBIT.MERCURY,
    radius: 1.30, phase: 2.1, tilt: 0.03, rotationSpeed: 0.35, color: 0x9c8e84,
    texture: { kind: 'rocky', palette: ['#6e6259', '#8a7d72', '#a89a8e', '#c4b8ac'], craters: 90, roughness: 1.0 },
    atmosphere: null, rings: null, landable: false, // NOTE: every body is landable once SCANNED — surface theme below
    gravity: 0.38, massScale: 0.055,
    surface: { theme: 'mercury' },
    facts: { type: 'Terrestrial Planet', radius: '2,439 km', gravity: '3.7 m/s²', moons: 0, atmosphere: 'Trace exosphere', temperature: '167°C' },
    codex: 'The smallest planet and closest to the Sun. Its cratered face swings between scorched days and freezing nights.'
  },
  {
    id: 'venus', name: 'VENUS', au: 0.723, orbitRadius: ORBIT.VENUS,
    radius: 2.14, phase: 4.4, tilt: 3.09, rotationSpeed: -0.08, color: 0xd9b47c,
    texture: { kind: 'venus', palette: ['#b98a4e', '#d4a768', '#e8c68d', '#f4e0b0'] },
    atmosphere: { color: 0xe8c98a, density: 1.3 }, rings: null, landable: false,
    gravity: 0.90, massScale: 0.815,
    surface: { theme: 'venus' },
    facts: { type: 'Terrestrial Planet', radius: '6,051 km', gravity: '8.87 m/s²', moons: 0, atmosphere: 'CO₂, thick', temperature: '464°C' },
    codex: 'Earth’s toxic twin. A runaway greenhouse world crushed under acid clouds hotter than a furnace.'
  },
  {
    id: 'earth', name: 'EARTH', au: 1.0, orbitRadius: ORBIT.EARTH,
    radius: 2.2, phase: 0.0, tilt: 23.4, rotationSpeed: 1.0, color: 0x2f7fd4,
    texture: { kind: 'earth' },
    atmosphere: { color: 0x6eb6ff, density: 1.0 }, rings: null, landable: true,
    gravity: 1.0, massScale: 1.0,
    surface: { theme: 'earth' },
    clouds: true, nightLights: true,
    facts: { type: 'Terrestrial Planet', radius: '6,371 km', gravity: '9.81 m/s²', moons: 1, atmosphere: 'Nitrogen / Oxygen', temperature: '15°C' },
    codex: 'Homeworld. The only known harbor of life — blue oceans, white clouds and the glow of a billion cities at night.'
  },
  {
    id: 'mars', name: 'MARS', au: 1.524, orbitRadius: ORBIT.MARS,
    radius: 1.57, phase: 3.6, tilt: 25.2, rotationSpeed: 0.97, color: 0xc1553b,
    texture: { kind: 'mars', palette: ['#7a3220', '#a34a2a', '#c46a3f', '#d98a5a'] },
    atmosphere: { color: 0xd98b66, density: 0.45 }, rings: null, landable: true,
    gravity: 0.38, massScale: 0.107,
    surface: { theme: 'mars' },
    facts: { type: 'Terrestrial Planet', radius: '3,389 km', gravity: '3.71 m/s²', moons: 2, atmosphere: 'CO₂, thin', temperature: '−63°C' },
    codex: 'The red frontier. Rust deserts, towering volcanoes and the most habitable ground beyond Earth.'
  },
  {
    id: 'jupiter', name: 'JUPITER', au: 5.203, orbitRadius: ORBIT.JUPITER,
    radius: 8.4, phase: 0.8, tilt: 3.1, rotationSpeed: 2.4, color: 0xc9a274,
    texture: { kind: 'gas', palette: ['#a67c52', '#c9a274', '#e3cba8', '#8a5a3a', '#f0e2c8'], bands: 14, storm: true },
    atmosphere: { color: 0xd8b98a, density: 1.2 }, rings: null, landable: false,
    gravity: 2.53, massScale: 317.8,
    surface: { theme: 'jupiter' }, // gas giant — cloud-deck surface
    facts: { type: 'Gas Giant', radius: '69,911 km', gravity: '24.79 m/s²', moons: 95, atmosphere: 'Hydrogen / Helium', temperature: '−108°C' },
    codex: 'King of the planets. Storms bigger than Earth rage in its banded clouds; its gravity shields the inner system.'
  },
  {
    id: 'saturn', name: 'SATURN', au: 9.537, orbitRadius: ORBIT.SATURN,
    radius: 7.7, phase: 2.4, tilt: 26.7, rotationSpeed: 2.2, color: 0xd8c48f,
    texture: { kind: 'gas', palette: ['#b09a68', '#d8c48f', '#efe1b8', '#96824f', '#f7eed2'], bands: 10, storm: false },
    atmosphere: { color: 0xe0cf9a, density: 1.1 },
    rings: { inner: 1.35, outer: 2.3, color: 0xcdbb90, opacity: 0.9 }, landable: false,
    gravity: 1.06, massScale: 95.2,
    surface: { theme: 'saturn' }, // gas giant — cloud-deck surface
    facts: { type: 'Gas Giant', radius: '58,232 km', gravity: '10.44 m/s²', moons: 146, atmosphere: 'Hydrogen / Helium', temperature: '−139°C' },
    codex: 'The jewel of the system. Its rings — ice and rock — span a quarter million kilometres yet are thinner than a building.'
  },
  {
    id: 'uranus', name: 'URANUS', au: 19.19, orbitRadius: ORBIT.URANUS,
    radius: 4.75, phase: 5.5, tilt: 97.8, rotationSpeed: -1.4, color: 0x9fd8d8,
    texture: { kind: 'ice', palette: ['#8ecfcf', '#a5dddd', '#c2ecec'] },
    atmosphere: { color: 0x9fd8d8, density: 0.9 },
    rings: { inner: 1.6, outer: 2.0, color: 0x77999b, opacity: 0.35 }, landable: false,
    gravity: 0.89, massScale: 14.5,
    surface: { theme: 'uranus' }, // ice giant — cloud-deck surface
    facts: { type: 'Ice Giant', radius: '25,362 km', gravity: '8.69 m/s²', moons: 28, atmosphere: 'H, He, Methane', temperature: '−197°C' },
    codex: 'The sideways planet, rolled onto its back by an ancient impact. Methane haze paints it a pale cyan.'
  },
  {
    id: 'neptune', name: 'NEPTUNE', au: 30.07, orbitRadius: ORBIT.NEPTUNE,
    radius: 4.69, phase: 1.2, tilt: 28.3, rotationSpeed: 1.5, color: 0x3f66d4,
    texture: { kind: 'ice', palette: ['#2e4fb8', '#3f66d4', '#6a8ae4'] },
    atmosphere: { color: 0x5f83e8, density: 1.0 }, rings: null, landable: false,
    gravity: 1.14, massScale: 17.1,
    surface: { theme: 'neptune' }, // ice giant — cloud-deck surface
    facts: { type: 'Ice Giant', radius: '24,622 km', gravity: '11.15 m/s²', moons: 16, atmosphere: 'H, He, Methane', temperature: '−201°C' },
    codex: 'The windiest world — supersonic storms tear through its deep blue clouds at 2,000 km/h.'
  }
];

export const MOONS = [
  { parent: 'earth', id: 'moon', name: 'THE MOON', orbitRadius: 8.5, radius: 0.95, phase: 1.0, period: 150,
    texture: { kind: 'rocky', palette: ['#7a7a78', '#93938f', '#ababa5', '#c5c5be'], craters: 120, roughness: 0.9 },
    landable: true, gravity: 0.17, massScale: 0.0123,
    surface: { theme: 'moon' },
    facts: { type: 'Natural Satellite', radius: '1,737 km', gravity: '1.62 m/s²', atmosphere: 'None', temperature: '−20°C' },
    codex: 'Earth’s constant companion. Silent gray plains of dust, waiting to be walked again.' },
  { parent: 'mars', id: 'phobos', name: 'PHOBOS', orbitRadius: 3.6, radius: 0.35, phase: 2.2, period: 32,
    texture: { kind: 'rocky', palette: ['#5c5148', '#6e6257', '#857767'], craters: 40, roughness: 1.4 },
    landable: false, gravity: 0.006, massScale: 0.00000017,
    surface: { theme: 'phobos' },
    facts: { type: 'Natural Satellite', radius: '11 km', gravity: '0.006 m/s²', atmosphere: 'None', temperature: '−40°C' },
    codex: 'A captured rock spiraling slowly toward Mars — one day it will shatter into a ring.' },
  { parent: 'mars', id: 'deimos', name: 'DEIMOS', orbitRadius: 5.4, radius: 0.28, phase: 4.9, period: 58,
    texture: { kind: 'rocky', palette: ['#665a4f', '#7a6c5e', '#8f8070'], craters: 30, roughness: 1.3 },
    landable: false, gravity: 0.003, massScale: 0.00000002,
    surface: { theme: 'deimos' },
    facts: { type: 'Natural Satellite', radius: '6 km', gravity: '0.003 m/s²', atmosphere: 'None', temperature: '−40°C' },
    codex: 'Mars’ tiny outer moon, a smooth dust-covered pebble adrift in the dark.' },
  { parent: 'jupiter', id: 'io', name: 'IO', orbitRadius: 12.5, radius: 1.05, phase: 0.4, period: 48,
    texture: { kind: 'rocky', palette: ['#d9c25a', '#e8d97a', '#c9982f', '#8a5a1f'], craters: 20, roughness: 0.7 },
    landable: false, gravity: 0.18, massScale: 0.015,
    surface: { theme: 'io' },
    facts: { type: 'Volcanic Moon', radius: '1,822 km', gravity: '1.80 m/s²', atmosphere: 'SO₂ trace', temperature: '−130°C' },
    codex: 'The most volcanic body in the system — sulfur plains constantly repainted by eruptions.' },
  { parent: 'jupiter', id: 'europa', name: 'EUROPA', orbitRadius: 16.5, radius: 0.9, phase: 2.8, period: 72,
    texture: { kind: 'rocky', palette: ['#c8c4b4', '#ddd9c8', '#b09a80', '#e8e4d4'], craters: 8, roughness: 0.35 },
    landable: false, gravity: 0.13, massScale: 0.008,
    surface: { theme: 'europa' },
    facts: { type: 'Ice Moon', radius: '1,561 km', gravity: '1.31 m/s²', atmosphere: 'O₂ trace', temperature: '−160°C' },
    codex: 'A cracked shell of ice hiding a global ocean — a prime candidate for life beyond Earth.' },
  { parent: 'jupiter', id: 'ganymede', name: 'GANYMEDE', orbitRadius: 21.5, radius: 1.35, phase: 4.1, period: 110,
    texture: { kind: 'rocky', palette: ['#8a8378', '#a29a8c', '#6e675e', '#bcb3a4'], craters: 60, roughness: 0.8 },
    landable: false, gravity: 0.15, massScale: 0.025,
    surface: { theme: 'ganymede' },
    facts: { type: 'Ice Moon', radius: '2,634 km', gravity: '1.43 m/s²', atmosphere: 'O₂ trace', temperature: '−163°C' },
    codex: 'The largest moon in the Solar System — bigger than Mercury, with a magnetic field of its own.' },
  { parent: 'jupiter', id: 'callisto', name: 'CALLISTO', orbitRadius: 27.5, radius: 1.25, phase: 5.6, period: 160,
    texture: { kind: 'rocky', palette: ['#655a4e', '#7a6e60', '#55493d', '#8a7e6e'], craters: 110, roughness: 1.0 },
    landable: false, gravity: 0.13, massScale: 0.018,
    surface: { theme: 'callisto' },
    facts: { type: 'Ice Moon', radius: '2,410 km', gravity: '1.24 m/s²', atmosphere: 'None', temperature: '−139°C' },
    codex: 'The most cratered world known — a fossil record of the early Solar System.' },
  { parent: 'saturn', id: 'titan', name: 'TITAN', orbitRadius: 21.5, radius: 1.3, phase: 1.6, period: 140,
    texture: { kind: 'venus', palette: ['#c08a3e', '#d8a552', '#e8bc70', '#8a5f28'] },
    atmosphere: { color: 0xd8a850, density: 1.4 },
    landable: false, gravity: 0.14, massScale: 0.0225,
    surface: { theme: 'titan' },
    facts: { type: 'Moon', radius: '2,574 km', gravity: '1.35 m/s²', atmosphere: 'Nitrogen, thick', temperature: '−179°C' },
    codex: 'A moon with weather — orange smog, methane rain and rivers of liquid natural gas.' },
  { parent: 'saturn', id: 'enceladus', name: 'ENCELADUS', orbitRadius: 12.5, radius: 0.55, phase: 3.3, period: 60,
    texture: { kind: 'rocky', palette: ['#d8dde2', '#eef2f5', '#c2ccd4'], craters: 15, roughness: 0.3 },
    landable: false, gravity: 0.011, massScale: 0.00018,
    surface: { theme: 'enceladus' },
    facts: { type: 'Ice Moon', radius: '252 km', gravity: '0.11 m/s²', atmosphere: 'Plumes', temperature: '−198°C' },
    codex: 'Geysers of ocean water blast from its south pole, feeding Saturn’s E ring.' },
  { parent: 'neptune', id: 'triton', name: 'TRITON', orbitRadius: 12.0, radius: 1.05, phase: 0.9, period: 120,
    texture: { kind: 'rocky', palette: ['#c4c0c8', '#d8d4dc', '#a89aa0', '#e8e4ea'], craters: 25, roughness: 0.5 },
    landable: false, gravity: 0.08, massScale: 0.0036,
    surface: { theme: 'triton' },
    facts: { type: 'Ice Moon', radius: '1,353 km', gravity: '0.78 m/s²', atmosphere: 'N₂ trace', temperature: '−235°C' },
    codex: 'Neptune’s great captive moon, orbiting backwards — a stolen Kuiper Belt world.' }
];

// ---- Special anomalies (discovery content) ----
export const ANOMALIES = [
  { id: 'derelict', name: 'DERELICT FREIGHTER', beltRadius: 276, phase: 2.0, color: 0x88ffcc,
    reward: { rare: 6 }, codex: 'A pre-collapse ore hauler, torn open along its spine. Its manifest was full when it died.' },
  { id: 'monolith', name: 'UNKNOWN MONOLITH', beltRadius: 288, phase: 4.4, color: 0xff66ff,
    reward: { rare: 10 }, codex: 'A perfectly smooth black slab, 1:4:9. It emits a slow pulse — like something counting.' },
  { id: 'comet', name: 'CRYO COMET CORE', beltRadius: 262, phase: 5.6, color: 0x66ddff,
    reward: { water: 30, ice: 20 }, codex: 'A comet nucleus captured by Jupiter long ago. Pristine ice from the system’s birth.' }
];

// ---- Space stations (trade / refuel / upgrades / missions) ----
export const STATIONS = [
  { id: 'earth-station', name: 'EARTH STATION', parent: 'earth', orbitRadius: 14, phase: 0.8, color: 0x6ec6ff },
  { id: 'mars-station', name: 'MARS STATION', parent: 'mars', orbitRadius: 11, phase: 2.4, color: 0xffa26b },
  { id: 'jupiter-station', name: 'JUPITER STATION', parent: 'jupiter', orbitRadius: 20, phase: 1.1, color: 0xffd97a },
  { id: 'saturn-station', name: 'SATURN STATION', parent: 'saturn', orbitRadius: 26, phase: 3.7, color: 0x9fe8c0 }
];

// ---- Asteroid belt ----
export const BELT = {
  inner: ORBIT.BELT_INNER, outer: ORBIT.BELT_OUTER, thickness: 5,
  counts: { low: 220, medium: 420, high: 700, ultra: 900 }
};

// ---- Economy ----
export const ECONOMY = {
  resources: {
    iron:   { name: 'Iron',         price: 10,  color: '#c8956c' },
    nickel: { name: 'Nickel',       price: 14,  color: '#a8b0b8' },
    ice:    { name: 'Ice',          price: 18,  color: '#9fd8ff' },
    water:  { name: 'Water',        price: 25,  color: '#5aa8ff' },
    food:   { name: 'Food',         price: 30,  color: '#7dffa8' },
    parts:  { name: 'Spare Parts',  price: 60,  color: '#ffd97a' },
    rare:   { name: 'Rare Minerals', price: 250, color: '#e86aff' }
  },
  startCredits: 250,
  // Surface outpost / survival tuning (the planetary base the astronaut lives in).
  surface: {
    repairCredits: 900,        // CR per broken rover repaired
    repairXP: 220,             // XP per broken rover repaired
    repairParts: 1,            // spare parts consumed per repair
    maintainCredits: 650,      // CR per station maintenance job
    maintainXP: 160,           // XP per station maintenance job
    maintainParts: 1,          // spare parts consumed per maintenance
    maintainCooldown: 45,      // game-seconds between maintenance jobs
    hungerDrainPerSec: 0.14,   // full->0 satiety in ~12 real minutes
    hungerWarnAt: 25,          // below this satiety, warn + slow energy regen
    satietyPerMeal: 45,        // food units restored per meal
    supplyLine: {
      // Order goods from EARTH to the planetary outpost you are on.
      // Cost & transit time scale with how far the outpost is from Earth.
      baseEtaGameSec: 900,     // ~15 real seconds at 1× (shorter with time warp)
      etaPerDist: 700,         // extra game-seconds per unit of distance factor
      costPerDist: 0.75,       // price multiplier per unit of distance factor
      items: [
        { id: 'parts', qty: 1,  name: 'SPARE PARTS' },
        { id: 'food',  qty: 5,  name: 'FOOD RATIONS' },
        { id: 'water', qty: 10, name: 'WATER' },
        { id: 'ice',   qty: 10, name: 'ICE' },
        { id: 'rare',  qty: 1,  name: 'RARE MINERALS' }
      ]
    }
  }
};

// ---- Ship upgrades ----
export const UPGRADES = {
  engine: {
    name: 'Engine', icon: '🚀',
    tiers: [
      { name: 'MK1', price: 0,    maxSpeed: 55,  thrust: 1.0,  efficiency: 1.0 },
      { name: 'MK2', price: 1500, maxSpeed: 80,  thrust: 1.25, efficiency: 1.15 },
      { name: 'MK3', price: 6000, maxSpeed: 115, thrust: 1.6,  efficiency: 1.35 }
    ]
  },
  tank: {
    name: 'Fuel Tank', icon: '⛽',
    tiers: [
      { name: 'MK1', price: 0,    capacity: 100 },
      { name: 'MK2', price: 800,  capacity: 170 },
      { name: 'MK3', price: 2500, capacity: 260 }
    ]
  },
  shield: {
    name: 'Shield', icon: '🛡️',
    tiers: [
      { name: 'MK1', price: 0,    max: 100, regen: 8 },
      { name: 'MK2', price: 1000, max: 160, regen: 12 },
      { name: 'MK3', price: 3500, max: 240, regen: 18 }
    ]
  },
  scanner: {
    name: 'Scanner', icon: '📡',
    tiers: [
      { name: 'MK1', price: 0,    range: 45,  speed: 1.0 },
      { name: 'MK2', price: 2000, range: 110, speed: 1.6 }
    ]
  },
  cargo: {
    name: 'Cargo Hold', icon: '📦',
    tiers: [
      { name: 'MK1', price: 0,    capacity: 200 },
      { name: 'MK2', price: 600,  capacity: 420 },
      { name: 'MK3', price: 2000, capacity: 800 }
    ]
  }
};

// ---- XP levels ----
export const LEVELS = [0, 300, 900, 2000, 4000, 7500, 12000, 20000, 32000, 50000];

// ---- Graphics quality presets ----
export const QUALITY = {
  low:    { pixelRatio: 1,    stars: 3500,  bloom: false, atmospheres: false, segments: 20, beltScale: 0.55, particles: 0.4, clouds: false },
  medium: { pixelRatio: 1.25, stars: 7000,  bloom: false, atmospheres: true,  segments: 32, beltScale: 0.8,  particles: 0.7, clouds: true },
  high:   { pixelRatio: 1.5,  stars: 11000, bloom: true,  atmospheres: true,  segments: 48, beltScale: 1.0,  particles: 1.0, clouds: true },
  ultra:  { pixelRatio: 2,    stars: 16000, bloom: true,  atmospheres: true,  segments: 64, beltScale: 1.25, particles: 1.4, clouds: true }
};

export const DEFAULT_SETTINGS = {
  quality: 'auto', // resolved to low/medium/high/ultra at boot
  resolvedQuality: 'medium',
  bloom: true,
  music: 0.5,
  sfx: 0.7,
  invertY: false,
  showFps: false,
  orbitLines: true,
  fpsCap: 60,
  mobileControls: 'auto', // 'auto' | 'on' | 'off'
  aimAssist: true, // FFM/PUBG-style auto-aim: gently pulls the nose toward the target
  uiClicks: true,      // click/tap sound on every interactive element
  haptics: true,       // short vibration on touch controls (Android)
  backPauses: true,    // Android back button / browser Back = ESC
  streaming: 'medium', // planet-surface object streaming budget
  cloudSync: false,    // mirror saves + settings to the connected account
  region: 'auto',      // preferred server region
  builderView: '3d'    // rocket workshop: '3d' assembly pad or '2d' blueprint
};

export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || coarse;
}

export function detectQuality() {
  const mobile = isTouchDevice() || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const mem = navigator.deviceMemory || (navigator.hardwareConcurrency <= 4 ? 2 : 8);
  if (mobile) return 'low';
  return mem <= 4 ? 'medium' : 'high';
}
