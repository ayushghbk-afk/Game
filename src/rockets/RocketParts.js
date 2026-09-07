// RocketParts — the parts catalogue for the Vehicle Assembly Building.
//
// A DESIGN is a stack of parts, bottom (index 0) to top:
//     { version: 1, name, parts: [{ id, qty }] }
// Everything else (mass, thrust, delta-v, whether it can reach orbit) is
// DERIVED from the catalogue, so a design shared by another player is just a
// small JSON blob that any client can validate and re-simulate identically.
//
// Units are deliberately semi-real so the numbers teach something:
//   mass in tonnes, thrust in kN, isp in seconds, fuel in tonnes.

export const PART_CATEGORIES = [
  { id: 'command', name: 'COMMAND', desc: 'Capsules & cockpits — every rocket needs exactly one.' },
  { id: 'fuel', name: 'FUEL TANKS', desc: 'Propellant. More fuel = more delta-v, but more mass.' },
  { id: 'engine', name: 'ENGINES', desc: 'Thrust and efficiency (Isp).' },
  { id: 'booster', name: 'BOOSTERS', desc: 'Strap-on solid boosters — huge lift-off thrust, short burn.' },
  { id: 'structure', name: 'STRUCTURE', desc: 'Decouplers, fairings, adapters.' },
  { id: 'payload', name: 'PAYLOAD', desc: 'Satellites, landers, habitats, science.' },
  { id: 'utility', name: 'UTILITY', desc: 'Chutes, legs, RCS, solar, batteries.' }
];

/**
 * mass    — dry mass (t)
 * fuel    — propellant carried (t)
 * thrust  — vacuum thrust (kN), engines/boosters only
 * isp     — specific impulse (s)
 * burn    — forced burn time (s) for solids
 * cost    — credits
 * drag    — aero drag coefficient contribution
 */
export const ROCKET_PARTS = [
  // ------------------------------------------------------------- COMMAND
  { id: 'cmd-mk1', name: 'Mk1 Command Pod', cat: 'command', mass: 0.84, cost: 600, crew: 1, drag: 0.2,
    color: 0xd8dee8, shape: 'cone', h: 1.2, r: 0.65,
    desc: 'Single-seat capsule. Light, cramped, gets you home.' },
  { id: 'cmd-mk2', name: 'Mk2 Crew Capsule', cat: 'command', mass: 2.6, cost: 2400, crew: 3, drag: 0.22,
    color: 0xc3ccd8, shape: 'cone', h: 1.7, r: 0.85,
    desc: 'Three-seat capsule with reaction wheels and a heat shield.' },
  { id: 'cmd-probe', name: 'Probodyne Core', cat: 'command', mass: 0.12, cost: 300, crew: 0, drag: 0.1,
    color: 0x8d97a6, shape: 'cylinder', h: 0.35, r: 0.5,
    desc: 'Unmanned guidance core. Cheapest way to fly.' },
  { id: 'cmd-shuttle', name: 'Orbiter Flight Deck', cat: 'command', mass: 4.2, cost: 6800, crew: 6, drag: 0.3,
    color: 0xe8eef6, shape: 'cone', h: 2.1, r: 1.0,
    desc: 'Winged orbiter cockpit — heavy, but carries a full crew.' },

  // ------------------------------------------------------------- FUEL
  { id: 'tank-s', name: 'FL-T200 Tank', cat: 'fuel', mass: 0.15, fuel: 1.0, cost: 320, drag: 0.15,
    color: 0xe6e9ee, shape: 'cylinder', h: 1.1, r: 0.65, desc: 'Small tank for upper stages.' },
  { id: 'tank-m', name: 'FL-T800 Tank', cat: 'fuel', mass: 0.5, fuel: 4.0, cost: 1100, drag: 0.18,
    color: 0xdfe3ea, shape: 'cylinder', h: 2.4, r: 0.65, desc: 'The workhorse tank.' },
  { id: 'tank-l', name: 'Jumbo-64 Tank', cat: 'fuel', mass: 4.0, fuel: 32.0, cost: 5400, drag: 0.25,
    color: 0xd6dbe4, shape: 'cylinder', h: 4.2, r: 1.25, desc: 'Large-diameter core tank.' },
  { id: 'tank-xl', name: 'Kerbodyne S3-14400', cat: 'fuel', mass: 9.0, fuel: 72.0, cost: 13000, drag: 0.32,
    color: 0xf0d6b6, shape: 'cylinder', h: 6.0, r: 1.9, desc: 'Super-heavy core. Needs serious engines.' },
  { id: 'tank-cryo', name: 'Cryogenic Upper Tank', cat: 'fuel', mass: 0.9, fuel: 8.0, cost: 3200, drag: 0.16,
    color: 0xbfe4ff, shape: 'cylinder', h: 2.8, r: 0.9, desc: 'Insulated hydrolox tank — best with vacuum engines.' },

  // ------------------------------------------------------------- ENGINES
  { id: 'eng-ant', name: 'LV-1 "Ant"', cat: 'engine', mass: 0.08, thrust: 2, isp: 315, cost: 220, drag: 0.1,
    color: 0x9c7a4a, shape: 'nozzle', h: 0.35, r: 0.28, desc: 'Tiny vacuum engine for probes.' },
  { id: 'eng-swivel', name: 'LV-T45 "Swivel"', cat: 'engine', mass: 1.5, thrust: 215, isp: 320, cost: 1200, drag: 0.2,
    color: 0xb0785a, shape: 'nozzle', h: 1.0, r: 0.6, desc: 'Gimballed workhorse. Good all-rounder.' },
  { id: 'eng-skipper', name: 'RE-I5 "Skipper"', cat: 'engine', mass: 3.0, thrust: 650, isp: 320, cost: 3400, drag: 0.24,
    color: 0xa06a4a, shape: 'nozzle', h: 1.5, r: 0.95, desc: 'Mid-size lifter engine.' },
  { id: 'eng-mainsail', name: 'RE-M3 "Mainsail"', cat: 'engine', mass: 6.0, thrust: 1500, isp: 310, cost: 8600, drag: 0.3,
    color: 0x8f5f42, shape: 'nozzle', h: 2.0, r: 1.25, desc: 'Heavy lifter. Drinks fuel, moves mountains.' },
  { id: 'eng-raptor', name: 'RS-X "Raptor"', cat: 'engine', mass: 4.4, thrust: 2100, isp: 350, cost: 15000, drag: 0.3,
    color: 0x6f7a88, shape: 'nozzle', h: 1.8, r: 1.15, desc: 'Full-flow staged combustion. Best thrust-to-weight in the catalogue.' },
  { id: 'eng-nerv', name: 'LV-N "Nerv" Atomic', cat: 'engine', mass: 3.0, thrust: 60, isp: 800, cost: 14000, drag: 0.2,
    color: 0x8d9aa8, shape: 'nozzle', h: 1.9, r: 0.6, desc: 'Nuclear thermal — feeble thrust, incredible efficiency. Interplanetary only.' },
  { id: 'eng-ion', name: 'IX-6315 Ion Drive', cat: 'engine', mass: 0.25, thrust: 2, isp: 4200, cost: 9000, drag: 0.1,
    color: 0x5fa8d8, shape: 'nozzle', h: 0.5, r: 0.35, desc: 'Absurd efficiency, glacial acceleration. Deep space only.' },

  // ------------------------------------------------------------- BOOSTERS
  { id: 'srb-small', name: 'RT-5 "Flea" SRB', cat: 'booster', mass: 0.45, fuel: 1.5, thrust: 192, isp: 165, burn: 12, cost: 200, drag: 0.2,
    color: 0xe0e4ea, shape: 'cylinder', h: 1.4, r: 0.5, desc: 'Cheap kick off the pad.' },
  { id: 'srb-med', name: 'RT-10 "Hammer" SRB', cat: 'booster', mass: 0.75, fuel: 3.2, thrust: 227, isp: 170, burn: 22, cost: 400, drag: 0.22,
    color: 0xd8dce4, shape: 'cylinder', h: 2.2, r: 0.5, desc: 'Longer burn, solid workhorse.' },
  { id: 'srb-large', name: 'S1 SRB-KD25k', cat: 'booster', mass: 3.0, fuel: 18.0, thrust: 810, isp: 195, burn: 48, cost: 2800, drag: 0.28,
    color: 0xe8ebf0, shape: 'cylinder', h: 5.0, r: 0.8, desc: 'Shuttle-class solid. Enormous lift-off punch.' },

  // ------------------------------------------------------------- STRUCTURE
  { id: 'dec-stack', name: 'TD-12 Decoupler', cat: 'structure', mass: 0.05, cost: 120, drag: 0.05,
    color: 0xf0c674, shape: 'ring', h: 0.22, r: 0.66, stage: true,
    desc: 'Separates stages. Everything BELOW a decoupler is dropped when its fuel runs dry.' },
  { id: 'adapter', name: 'Rockomax Adapter', cat: 'structure', mass: 0.1, cost: 250, drag: 0.08,
    color: 0xc8ced8, shape: 'taper', h: 0.7, r: 1.0, desc: 'Joins wide tanks to narrow ones.' },
  { id: 'fairing', name: 'AE-FF1 Fairing', cat: 'structure', mass: 0.3, cost: 480, drag: -0.25,
    color: 0xeef2f8, shape: 'cone', h: 1.6, r: 1.0, desc: 'Protects the payload and cuts drag substantially.' },
  { id: 'girder', name: 'Modular Girder', cat: 'structure', mass: 0.06, cost: 90, drag: 0.06,
    color: 0x7b8494, shape: 'cylinder', h: 0.9, r: 0.28, desc: 'Structural spacer.' },

  // ------------------------------------------------------------- PAYLOAD
  { id: 'pay-sat', name: 'Comms Satellite', cat: 'payload', mass: 0.6, cost: 2200, drag: 0.12, science: 12,
    color: 0xffd479, shape: 'box', h: 0.8, r: 0.5, desc: 'Deploy in orbit for a contract payout.' },
  { id: 'pay-lander', name: 'Surface Lander', cat: 'payload', mass: 2.2, cost: 5200, drag: 0.2, science: 30,
    color: 0xc9a227, shape: 'box', h: 1.4, r: 0.9, desc: 'Legs, drills and a sample bay — lands on any scanned world.' },
  { id: 'pay-hab', name: 'Habitat Module', cat: 'payload', mass: 5.5, cost: 9800, drag: 0.24, science: 45, crew: 4,
    color: 0xe4e9f0, shape: 'cylinder', h: 3.0, r: 1.1, desc: 'Orbital or surface habitat for long stays.' },
  { id: 'pay-rover', name: 'Rover Bay', cat: 'payload', mass: 3.1, cost: 6400, drag: 0.22, science: 25,
    color: 0xb5bcc8, shape: 'box', h: 1.6, r: 1.0, desc: 'Carries a surface rover down to a planet.' },
  { id: 'pay-science', name: 'Science Bay', cat: 'payload', mass: 0.9, cost: 1800, drag: 0.14, science: 20,
    color: 0x8ee6c8, shape: 'cylinder', h: 0.7, r: 0.6, desc: 'Instrument suite. Generates research on arrival.' },

  // ------------------------------------------------------------- UTILITY
  { id: 'util-chute', name: 'Mk16 Parachute', cat: 'utility', mass: 0.1, cost: 220, drag: 0.05,
    color: 0xf0f3f8, shape: 'cylinder', h: 0.3, r: 0.4, desc: 'Required for a survivable landing back on Earth.' },
  { id: 'util-legs', name: 'LT-1 Landing Legs', cat: 'utility', mass: 0.2, cost: 340, drag: 0.08,
    color: 0x9aa4b2, shape: 'ring', h: 0.3, r: 0.8, desc: 'Touch down without tipping over.' },
  { id: 'util-rcs', name: 'RCS Thruster Block', cat: 'utility', mass: 0.15, cost: 500, drag: 0.06, rcs: 1,
    color: 0xb8c0cc, shape: 'ring', h: 0.25, r: 0.7, desc: 'Fine attitude control for docking.' },
  { id: 'util-solar', name: 'Gigantor Solar Array', cat: 'utility', mass: 0.3, cost: 1600, drag: 0.1, power: 18,
    color: 0x2f5f9e, shape: 'box', h: 0.3, r: 1.3, desc: 'Keeps the electrics alive far from the Sun.' },
  { id: 'util-battery', name: 'Z-4K Battery Bank', cat: 'utility', mass: 0.2, cost: 900, drag: 0.06, power: 8,
    color: 0x4a5262, shape: 'cylinder', h: 0.5, r: 0.6, desc: 'Stored charge for night-side operations.' },
  { id: 'util-heatshield', name: 'Ablative Heat Shield', cat: 'utility', mass: 0.8, cost: 1100, drag: -0.1,
    color: 0x5a4032, shape: 'taper', h: 0.4, r: 1.0, desc: 'Survive re-entry. Skip it and you arrive as confetti.' }
];

export const PART_BY_ID = new Map(ROCKET_PARTS.map(p => [p.id, p]));

export function getPart(id) { return PART_BY_ID.get(id) || null; }

export const G0 = 9.80665;         // m/s² — for the rocket equation
export const EARTH_ORBIT_DV = 9400; // m/s to low Earth orbit (incl. losses)
export const TWR_MIN = 1.15;        // must beat gravity with margin

/**
 * Hook installed by RocketDesign.js so analyzeDesign() understands v2
 * (3D placement) designs without this module importing that one — the two
 * would otherwise be circular. Given a v2 design it returns an array of
 * stages, each an array of part definitions.
 */
let stageResolver = null;
export function setStageResolver(fn) { stageResolver = fn; }
export function isPlacementDesign(design) {
  return design?.version === 2 && Array.isArray(design.parts) &&
    design.parts.length > 0 && Array.isArray(design.parts[0]?.pos);
}

/** Expand a design's { id, qty } list into a flat part list, bottom → top. */
export function expandParts(design) {
  const out = [];
  for (const entry of design?.parts || []) {
    const part = getPart(entry.id);
    if (!part) continue;
    const qty = Math.max(1, Math.min(50, entry.qty || 1));
    for (let i = 0; i < qty; i++) out.push(part);
  }
  return out;
}

/**
 * Split the stack into stages. A stage ends at each decoupler (part.stage);
 * the topmost group is the final stage. Boosters burn with stage 0.
 */
export function stagesOf(parts) {
  const stages = [];
  let current = [];
  for (const p of parts) {
    if (p.stage) { stages.push(current); current = []; }
    else current.push(p);
  }
  stages.push(current);
  return stages.filter(s => s.length);
}

function sum(list, key) { return list.reduce((a, p) => a + (p[key] || 0), 0); }

/**
 * Full performance analysis of a design. Pure function — the UI, the launch
 * simulation and the validator all read from this one place, so what the VAB
 * promises is exactly what the flight delivers.
 */
export function analyzeDesign(design) {
  // v2 designs place parts in 3D, so their staging comes from geometry.
  const placementStages = (isPlacementDesign(design) && stageResolver)
    ? stageResolver(design) : null;
  const parts = placementStages ? placementStages.flat() : expandParts(design);
  const errors = [];
  const warnings = [];

  const commands = parts.filter(p => p.cat === 'command');
  const engines = parts.filter(p => p.cat === 'engine');
  const boosters = parts.filter(p => p.cat === 'booster');

  if (!parts.length) errors.push('Empty design — add at least a command pod, a tank and an engine.');
  if (commands.length === 0) errors.push('No command pod — the rocket has nothing to fly it.');
  if (commands.length > 1) errors.push('More than one command pod — keep exactly one.');
  if (engines.length === 0 && boosters.length === 0) errors.push('No engines or boosters — this is a very expensive sculpture.');

  const dryMass = sum(parts, 'mass');
  const fuelMass = sum(parts, 'fuel');
  const wetMass = dryMass + fuelMass;
  const cost = sum(parts, 'cost');
  const crew = sum(parts, 'crew');
  const science = sum(parts, 'science');
  const power = sum(parts, 'power');
  const drag = Math.max(0.05, sum(parts, 'drag'));

  const thrust = sum(engines, 'thrust') + sum(boosters, 'thrust');
  // Mass-flow-weighted Isp — the honest way to combine dissimilar engines.
  const allMotors = engines.concat(boosters);
  const flow = allMotors.reduce((a, e) => a + (e.thrust || 0) / ((e.isp || 1) * G0), 0);
  const isp = flow > 0 ? thrust / (flow * G0) : 0;

  // Thrust-to-weight at lift-off (Earth).
  const twr = wetMass > 0 ? thrust / (wetMass * G0) : 0;

  // Delta-v, staged. Each stage burns only the fuel it carries while
  // hauling everything above it.
  const stages = placementStages || stagesOf(parts);
  let deltaV = 0;
  const stageInfo = [];
  let massAbove = 0;
  for (let i = stages.length - 1; i >= 0; i--) {
    const s = stages[i];
    const sDry = sum(s, 'mass');
    const sFuel = sum(s, 'fuel');
    const sMotors = s.filter(p => p.cat === 'engine' || p.cat === 'booster');
    const sThrust = sum(sMotors, 'thrust');
    const sFlow = sMotors.reduce((a, e) => a + (e.thrust || 0) / ((e.isp || 1) * G0), 0);
    const sIsp = sFlow > 0 ? sThrust / (sFlow * G0) : 0;
    const m0 = massAbove + sDry + sFuel;
    const m1 = massAbove + sDry;
    const dv = (sIsp > 0 && sFuel > 0 && m1 > 0) ? sIsp * G0 * Math.log(m0 / m1) : 0;
    deltaV += dv;
    stageInfo.unshift({
      index: i, parts: s.length, dryMass: sDry, fuelMass: sFuel,
      thrust: sThrust, isp: sIsp, deltaV: dv,
      twr: m0 > 0 ? sThrust / (m0 * G0) : 0,
      burnTime: sFlow > 0 ? sFuel * 1000 / (sFlow * 1000) : 0
    });
    massAbove = m1;
  }

  if (fuelMass > 0 && engines.length === 0 && boosters.length === 0) warnings.push('Fuel with no engine to burn it.');
  if (thrust > 0 && twr < TWR_MIN) errors.push(`Thrust-to-weight ${twr.toFixed(2)} — below ${TWR_MIN}. It will not leave the pad.`);
  if (deltaV < EARTH_ORBIT_DV) warnings.push(`Delta-v ${Math.round(deltaV)} m/s — needs ${EARTH_ORBIT_DV} m/s to reach orbit from Earth.`);
  if (!parts.some(p => p.id === 'util-chute') && crew > 0) warnings.push('No parachute — the crew cannot land safely back on Earth.');
  if (!parts.some(p => p.id === 'util-heatshield') && crew > 0) warnings.push('No heat shield — re-entry will be fatal.');
  if (power === 0 && commands.some(c => c.crew === 0)) warnings.push('Unmanned craft with no power source will go dark.');
  if (stages.length > 1 && stageInfo[0].twr < TWR_MIN) warnings.push('First stage TWR is marginal.');

  const orbitCapable = errors.length === 0 && deltaV >= EARTH_ORBIT_DV && twr >= TWR_MIN;
  // What can this thing actually reach? (Rough budgets past LEO.)
  let reach = 'Suborbital hop';
  if (orbitCapable) reach = 'Low Earth orbit';
  if (orbitCapable && deltaV >= 12600) reach = 'Lunar transfer';
  if (orbitCapable && deltaV >= 13600) reach = 'Mars transfer';
  if (orbitCapable && deltaV >= 16000) reach = 'Outer planets';
  if (orbitCapable && deltaV >= 20000) reach = 'Anywhere in the system';

  const height = parts.reduce((a, p) => a + (p.h || 0), 0);
  const maxRadius = parts.reduce((a, p) => Math.max(a, p.r || 0), 0.3);

  return {
    parts, stages: stageInfo, errors, warnings,
    dryMass, fuelMass, wetMass, cost, crew, science, power, drag,
    thrust, isp, twr, deltaV, orbitCapable, reach, height, maxRadius,
    valid: errors.length === 0
  };
}

/** A newcomer-friendly starting rocket that actually reaches orbit. */
export function starterDesign() {
  return {
    version: 1,
    name: 'Odyssey I',
    parts: [
      { id: 'eng-mainsail', qty: 1 },
      { id: 'tank-xl', qty: 1 },
      { id: 'dec-stack', qty: 1 },
      { id: 'eng-skipper', qty: 1 },
      { id: 'tank-l', qty: 1 },
      { id: 'dec-stack', qty: 1 },
      { id: 'eng-swivel', qty: 1 },
      { id: 'tank-cryo', qty: 1 },
      { id: 'util-heatshield', qty: 1 },
      { id: 'cmd-mk1', qty: 1 },
      { id: 'util-chute', qty: 1 }
    ]
  };
}

/** Validate + normalise an imported design (from a file or another player). */
export function sanitizeDesign(raw) {
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const design = obj?.design || obj;
  if (!design || !Array.isArray(design.parts)) throw new Error('Not a Solar Odyssey rocket file.');
  const parts = design.parts
    .map(p => ({ id: String(p.id || ''), qty: Math.max(1, Math.min(50, parseInt(p.qty, 10) || 1)) }))
    .filter(p => PART_BY_ID.has(p.id))
    .slice(0, 120);
  if (!parts.length) throw new Error('That design contains no recognised parts.');
  return {
    version: 1,
    name: String(design.name || 'Imported rocket').slice(0, 48),
    parts
  };
}

export function exportDesign(design) {
  return JSON.stringify({ kind: 'solar-odyssey-rocket', version: 1, design }, null, 2);
}
