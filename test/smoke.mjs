// Headless smoke test — stubs just enough DOM to construct and exercise
// every game system under Node. Catches reference errors, config errors,
// broken physics/mission/economy logic and save/load regressions.
// Run: node test/smoke.mjs   (after `npm run build` ideally also passes)

// ---------- minimal DOM/browser stubs ----------
const noop = () => {};
const ctx2d = () => ({
  canvas: null,
  fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: '', textBaseline: '',
  globalAlpha: 1,
  fillRect: noop, strokeRect: noop, clearRect: noop, fillText: noop, strokeText: noop,
  beginPath: noop, closePath: noop, arc: noop, fill: noop, stroke: noop,
  save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
  putImageData: noop, drawImage: noop,
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  createRadialGradient: () => ({ addColorStop: noop }),
  createLinearGradient: () => ({ addColorStop: noop }),
  measureText: () => ({ width: 10 }),
});
function makeCanvas() {
  return {
    width: 300, height: 150,
    getContext: (kind) => (kind === '2d' ? ctx2d() : null),
    addEventListener: noop, setPointerCapture: noop, releasePointerCapture: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    requestPointerLock: noop, style: {},
  };
}
class ImageDataPoly {
  constructor(data, w, h) { this.data = data; this.width = w; this.height = h; }
}
const storage = new Map();
globalThis.window = globalThis;
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? makeCanvas() : { style: {}, appendChild: noop, addEventListener: noop, classList: { add: noop, remove: noop, toggle: noop } }),
  addEventListener: noop, removeEventListener: noop,
  pointerLockElement: null, hidden: false,
  body: { appendChild: noop },
};
globalThis.ImageData = ImageDataPoly;
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k),
};
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', maxTouchPoints: 0, hardwareConcurrency: 8 }, configurable: true });
globalThis.matchMedia = () => ({ matches: false });
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };

let passed = 0, failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓', name);
  } catch (e) {
    failed++;
    console.error('  ✗', name, '—', e.message);
    if (process.env.VERBOSE) console.error(e.stack);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// ---------- module imports ----------
const { PLANETS, MOONS, SUN_CONFIG, STATIONS, ANOMALIES, BELT, ECONOMY, UPGRADES, QUALITY, LEVELS, EARTH_OMEGA, detectQuality, isTouchDevice } =
  await import('../src/config.js');
const { ValueNoise, fbm, mulberry32, clamp } = await import('../src/utils/Noise.js');
const { getBodyTextures, getCloudTexture, getRingTexture, getGlowTexture, getNebulaTexture } =
  await import('../src/planets/ProceduralTextures.js');
const { Body } = await import('../src/planets/Planet.js');
const { Moon } = await import('../src/planets/Moon.js');
const { SolarSystem } = await import('../src/planets/SolarSystem.js');
const { Starfield } = await import('../src/world/Starfield.js');
const { AsteroidField } = await import('../src/world/AsteroidField.js');
const { SpaceStation } = await import('../src/world/SpaceStation.js');
const { cargoUsed, addResource, cargoValue } = await import('../src/world/Resources.js');
const { buildShipMesh, ShipTrail } = await import('../src/spacecraft/Ship.js');
const { ShipPhysics } = await import('../src/spacecraft/ShipPhysics.js');
const { ShipController } = await import('../src/spacecraft/ShipController.js');
const { shipStats, nextUpgradeCost } = await import('../src/spacecraft/ShipUpgrades.js');
const { GameState, ACHIEVEMENTS, freshState } = await import('../src/game/GameState.js');
const { TimeSystem } = await import('../src/game/TimeSystem.js');
const { MISSIONS } = await import('../src/missions/MissionData.js');
const { MissionManager } = await import('../src/missions/MissionManager.js');
const { SurfaceScene } = await import('../src/game/SurfaceScene.js');
const { SURFACE_THEMES, themeFor } = await import('../src/surface/SurfaceThemes.js');
const { SaveSystem } = await import('../src/save/SaveSystem.js');
const { Effects } = await import('../src/fx/Effects.js');
const AudioManagerMod = await import('../src/audio/AudioManager.js');
const THREE = (await import('three')).default ?? (await import('three'));

console.log('\n== CONFIG INTEGRITY ==');
check('every moon parent exists', () => {
  const ids = new Set(PLANETS.map(p => p.id));
  for (const m of MOONS) assert(ids.has(m.parent), `moon ${m.id} parent ${m.parent} missing`);
});
check('every station parent exists', () => {
  const ids = new Set(PLANETS.map(p => p.id));
  for (const s of STATIONS) assert(ids.has(s.parent), `station ${s.id} parent missing`);
});
check('unique ids / orbits ascending', () => {
  const ids = new Set();
  for (const p of PLANETS) {
    assert(!ids.has(p.id), 'duplicate planet id ' + p.id);
    ids.add(p.id);
  }
  let last = 0;
  for (const p of PLANETS) { assert(p.orbitRadius > last, 'orbits not ascending'); last = p.orbitRadius; }
});
check('upgrade tiers well-formed', () => {
  for (const k in UPGRADES) {
    const tiers = UPGRADES[k].tiers;
    assert(Array.isArray(tiers) && tiers.length >= 2, `${k} needs >=2 tiers`);
    assert(tiers[0].price === 0, `${k} tier1 must be free`);
  }
});
check('achievements all have name+desc', () => {
  for (const a of ACHIEVEMENTS) assert(a.id && a.name && a.desc);
});
check('missions all have check+progress+reward', () => {
  for (const m of MISSIONS) assert(typeof m.check === 'function' && typeof m.progress === 'function' && m.reward > 0);
});
check('quality presets complete', () => {
  for (const q of ['low', 'medium', 'high', 'ultra']) {
    const p = QUALITY[q];
    assert(p.stars > 0 && p.segments > 0 && typeof p.bloom === 'boolean');
  }
});

console.log('\n== PROCEDURAL TEXTURES ==');
check('rocky planet textures generate', () => {
  const t = getBodyTextures({ kind: 'rocky', palette: ['#111', '#222', '#333'], craters: 10 }, 42, 128);
  assert(t.map && t.bumpMap);
});
check('earth day+night textures generate', () => {
  const t = getBodyTextures({ kind: 'earth' }, 43, 128);
  assert(t.map && t.nightMap);
});
check('gas giant / ice / venus textures generate', () => {
  assert(getBodyTextures({ kind: 'gas', palette: ['#111', '#222'], bands: 8, storm: true }, 44, 128).map);
  assert(getBodyTextures({ kind: 'ice', palette: ['#111', '#222'] }, 45, 128).map);
  assert(getBodyTextures({ kind: 'venus', palette: ['#111', '#222'] }, 46, 128).map);
});
check('cache dedupes', () => {
  const a = getBodyTextures({ kind: 'earth' }, 43, 128);
  const b = getBodyTextures({ kind: 'earth' }, 43, 128);
  assert(a === b);
});
check('clouds/rings/glow/nebula generate', () => {
  assert(getCloudTexture(1, 64, 0.5).isTexture || getCloudTexture(1, 64, 0.5));
  assert(getRingTexture('#cdbb90', 2, 64));
  assert(getGlowTexture('rgba(255,255,255,1)', 'rgba(0,0,0,0)', 64));
  assert(getNebulaTexture('#3b2a6e', 3, 64));
});

console.log('\n== WORLD CONSTRUCTION ==');
const scene = new THREE.Scene();
check('solar system builds (sun + 8 planets + 10 moons + 4 stations)', () => {
  globalThis.__solar = new SolarSystem(scene, 'low');
  assert(globalThis.__solar.planets.size === 8 + 10, 'expected 18 bodies, got ' + globalThis.__solar.planets.size);
  assert(globalThis.__solar.stations.length === 4);
  assert(globalThis.__solar.anomalies.length === ANOMALIES.length);
});
check('starfield builds', () => { new Starfield(scene, 'low'); });
check('asteroid belt builds with pooled instances', () => {
  globalThis.__belt = new AsteroidField(scene, 'low');
  assert(globalThis.__belt.data.length > 100);
});
check('effects build', () => { globalThis.__fx = new Effects(scene, 'low'); });
check('ship mesh builds', () => { globalThis.__shipMesh = buildShipMesh(); scene.add(globalThis.__shipMesh.group); });

check('simulation update: orbits move consistently', () => {
  const solar = globalThis.__solar;
  solar.update(0, 0);
  const earth = solar.getBody('earth');
  const moon = solar.getBody('moon');
  const p0 = earth.group.position.clone();
  const m0 = moon.group.position.clone();
  assert(p0.length() > 0, 'earth at origin?');
  assert(Math.abs(m0.distanceTo(p0) - moon.cfg.orbitRadius) < 0.001, 'moon not at configured orbit radius');
  solar.update(3600 * 60, 0); // +1 game-hour
  assert(!earth.group.position.equals(p0), 'earth did not move');
  // omega consistency: after 1h the angle advanced by omega*3600
  const expected = (Math.PI * 2) / (60 * 60 * 12) * 3600 * 60;
  const actualAngle = Math.atan2(-earth.group.position.z, earth.group.position.x);
  const expectedAngle = expected % (Math.PI * 2);
  assert(Math.abs(((actualAngle - expectedAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 1e-6, 'earth omega mismatch');
});
check('station orbits its parent', () => {
  const solar = globalThis.__solar;
  const st = solar.stations[0];
  const parent = solar.getBody(st.cfg.parent);
  solar.update(12345, 0);
  const d = st.group.position.distanceTo(parent.group.position);
  assert(Math.abs(d - st.cfg.orbitRadius) < 0.01, `station distance ${d} != ${st.cfg.orbitRadius}`);
});
check('planets have LOD + spin', () => {
  const solar = globalThis.__solar;
  const earth = solar.getBody('earth');
  assert(earth.lod && earth.lod.levels.length === 3, 'LOD levels');
  assert(earth.lod.levels[1].distance > earth.lod.levels[0].distance);
});
check('saturn has rings, uranus has rings, mercury does not', () => {
  const solar = globalThis.__solar;
  assert(solar.getBody('saturn').ringMesh);
  assert(solar.getBody('uranus').ringMesh);
  assert(!solar.getBody('mercury').ringMesh);
});
check('earth has clouds + night lights (medium quality)', () => {
  const earth = new Body(PLANETS.find(p => p.id === 'earth'), 'planet', 777, 'medium');
  assert(earth.cloudMesh, 'cloud layer missing');
  const mat = earth.lod.levels[0].object.material;
  assert(mat.emissiveMap, 'night lights missing');
  earth.dispose();
});
check('kepler: mercury orbits faster than neptune', () => {
  const solar = globalThis.__solar;
  assert(solar.getBody('mercury').orbitOmega > solar.getBody('neptune').orbitOmega * 100);
});

console.log('\n== PHYSICS ==');
check('ship thrust + fuel burn + speed clamp', () => {
  const ship = {
    position: new THREE.Vector3(500, 0, 0), quaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(), fuel: 100, energy: 100, shield: 100, hull: 100, speed: 0
  };
  const physics = new ShipPhysics(ship);
  const stats = shipStats(freshState().upgrades);
  const bodies = [...globalThis.__solar.planets.values()];
  const input = { throttleF: 1, strafe: 0, vert: 0, boost: false, brake: false, yawDelta: 0, pitchDelta: 0, rollDelta: 0 };
  for (let i = 0; i < 240; i++) physics.update(1 / 60, input, stats, bodies, {});
  assert(ship.speed > 10, 'ship did not accelerate: ' + ship.speed);
  assert(ship.speed <= stats.maxSpeed + 5, 'speed exceeded max: ' + ship.speed);
  assert(ship.fuel < 100, 'fuel did not burn');
});
check('gravity pulls ship toward planet', () => {
  const solar = globalThis.__solar;
  solar.update(0, 0);
  const earth = solar.getBody('earth');
  const ship = {
    position: earth.group.position.clone().add(new THREE.Vector3(14, 0, 0)),
    quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(),
    fuel: 100, energy: 100, shield: 100, hull: 100, speed: 0
  };
  const physics = new ShipPhysics(ship);
  const stats = shipStats(freshState().upgrades);
  const zero = { throttleF: 0, strafe: 0, vert: 0, boost: false, brake: false, yawDelta: 0, pitchDelta: 0, rollDelta: 0 };
  const d0 = ship.position.distanceTo(earth.group.position);
  physics.update(1 / 60, zero, stats, [earth], {});
  const d1 = ship.position.distanceTo(earth.group.position);
  assert(d1 < d0, `gravity did not attract: ${d0} -> ${d1}`);
});
check('collision pushes ship out of planet surface', () => {
  const solar = globalThis.__solar;
  solar.update(0, 0);
  const earth = solar.getBody('earth');
  const ship = {
    position: earth.group.position.clone().add(new THREE.Vector3(1, 0, 0)),
    quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(-5, 0, 0),
    fuel: 100, energy: 100, shield: 100, hull: 100, speed: 0
  };
  const physics = new ShipPhysics(ship);
  let damaged = 0;
  const events = { onDamage: (a) => { damaged += a; } };
  physics.collideBodies([earth], events, 1 / 60);
  const d = ship.position.distanceTo(earth.group.position);
  assert(d >= earth.radius, 'ship inside planet');
  assert(damaged > 0, 'no impact damage');
});
check('yaw rotation input turns ship', () => {
  const ship = {
    position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(), fuel: 100, energy: 100, shield: 100, hull: 100, speed: 0
  };
  const physics = new ShipPhysics(ship);
  const stats = shipStats(freshState().upgrades);
  const input = { throttleF: 0, strafe: 0, vert: 0, boost: false, brake: false, yawDelta: 0.1, pitchDelta: 0, rollDelta: 0 };
  const q0 = ship.quaternion.clone();
  physics.update(1 / 60, input, stats, [], {});
  assert(ship.quaternion.angleTo(q0) > 0.05, 'ship did not rotate');
});

console.log('\n== ASTEROIDS & MINING ==');
check('belt: find target, mine, deplete, recycle', () => {
  const belt = globalThis.__belt;
  // put ship on top of first asteroid
  const ast = belt.data[0];
  const shipPos = new THREE.Vector3(ast.x, ast.y, ast.z);
  const forward = new THREE.Vector3(0, 0, -1);
  const target = belt.findMineTarget(shipPos, forward, 40);
  assert(target, 'no mining target found next to asteroid');
  const before = target.ore;
  const res = belt.mine(target, 10);
  assert(res.amount === 10 && target.ore === before - 10);
  let total = 0;
  for (const k in res.resources) total += res.resources[k];
  assert(Math.abs(total - 10) < 1e-9, 'composition must sum to 100%');
  target.ore = 0; belt.mine(target, 1);
  assert(target.depleted, 'asteroid should be depleted');
  // move ship far away, recycle should respawn it
  shipPos.set(9000, 0, 9000);
  belt.recycle(shipPos);
  assert(!target.depleted, 'depleted asteroid was not recycled');
});
check('belt collision damages ship', () => {
  const belt = globalThis.__belt;
  const ast = belt.data[1];
  const pos = new THREE.Vector3(ast.x + 0.1, ast.y, ast.z);
  const vel = new THREE.Vector3(10, 0, 0);
  const dmg = belt.collideShip(pos, 1, vel);
  assert(dmg > 0, 'no collision damage');
});

console.log('\n== GAME STATE / ECONOMY / SAVE ==');
check('credits, xp, levels', () => {
  const gs = new GameState();
  gs.addCredits(500);
  assert(gs.credits === ECONOMY.startCredits + 500);
  assert(gs.spend(200) && gs.credits === ECONOMY.startCredits + 300);
  assert(!gs.spend(1e9));
  gs.addXP(LEVELS[1] + 1);
  assert(gs.level() === 2, 'level should be 2');
});
check('cargo capacity + sell', () => {
  const gs = new GameState();
  const cap = gs.cargoCapacity();
  const got = gs.addCargo('iron', cap + 100, cap);
  assert(got === cap, 'overflow not clamped');
  assert(cargoUsed(gs.state.resources) === cap);
  const v = gs.sellAll();
  assert(v === cap * ECONOMY.resources.iron.price, 'sell value wrong');
  assert(gs.credits === ECONOMY.startCredits + v);
  assert(cargoUsed(gs.state.resources) === 0);
});
check('save/load round-trip', () => {
  storage.clear();
  const gs = new GameState();
  gs.state.upgrades.engine = 2;
  gs.addCredits(1234);
  gs.discover('mars');
  gs.award('miner');
  const ok = gs.save({ position: [1, 2, 3], quaternion: [0, 0, 0, 1], fuel: 50, energy: 1, shield: 1, hull: 99, lastStation: 'mars-station' });
  assert(ok);
  const gs2 = new GameState();
  assert(gs2.load(), 'load failed');
  assert(gs2.state.upgrades.engine === 2);
  assert(gs2.state.ship.fuel === 50);
  assert(gs2.state.discoveries.includes('mars'));
  assert(gs2.state.achievements.includes('miner'));
  gs2.reset();
  const gs3 = new GameState();
  assert(!gs3.load(), 'reset did not clear save');
});
check('SaveSystem tolerates corrupted data', () => {
  storage.clear();
  storage.set('solar-odyssey-save-v1', '{broken json!!');
  const gs = new GameState();
  assert(!gs.load());
  storage.set('solar-odyssey-save-v1', JSON.stringify({ version: 99 }));
  assert(!gs.load(), 'wrong version must be rejected');
});

console.log('\n== MISSIONS ==');
check('mission chain completes in order with rewards', () => {
  storage.clear();
  const gs = new GameState();
  const events = [];
  const mm = new MissionManager(gs, {
    toast: (...a) => events.push(a[0]),
    sound: () => {},
    shipSnapshot: () => null,
  });
  const fakeCtx = {
    distTo: (id) => (id === 'earth' ? 100 : 999),
    visited: (id) => ['moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].includes(id),
    stats: () => gs.state.stats,
    mined: () => 200,
  };
  // leave earth orbit → m1
  mm.update(fakeCtx);
  assert(gs.state.missions.completed.includes('m1'), 'm1 not completed');
  // scan → m2
  gs.state.stats.scans = 1;
  mm.update(fakeCtx);
  assert(gs.state.missions.completed.includes('m2'), 'm2 not completed');
  // dock → m4 onwards
  gs.state.stats.docks = 1;
  // the rest
  for (let i = 0; i < 12; i++) mm.update(fakeCtx);
  assert(gs.state.missions.completed.length === MISSIONS.length, 'not all missions completed: ' + gs.state.missions.completed.length);
  assert(mm.active === null || mm.active === undefined, 'active should be null');
  const expectedCredits = ECONOMY.startCredits + MISSIONS.reduce((a, m) => a + m.reward, 0);
  assert(gs.credits === expectedCredits, 'mission rewards mispaid');
});
check('m1 does NOT complete while still near earth', () => {
  storage.clear();
  const gs = new GameState();
  const mm = new MissionManager(gs, { toast: () => {}, sound: () => {}, shipSnapshot: () => null });
  mm.update({ distTo: () => 10, visited: () => false, stats: () => gs.state.stats, mined: () => 0 });
  assert(!gs.state.missions.completed.includes('m1'));
});

console.log('\n== TIME SYSTEM ==');
check('1 real second = 1 game minute at 1x', () => {
  const t = new TimeSystem();
  t.update(1);
  assert(Math.abs(t.simSeconds - 60) < 1e-9, 'expected 60 game-s, got ' + t.simSeconds);
  t.setSpeed(100);
  t.update(1);
  assert(Math.abs(t.simSeconds - 6060) < 1e-9);
  assert(t.dateString().startsWith('2087.03.14'), 'date: ' + t.dateString());
});
check('time pause works', () => {
  const t = new TimeSystem();
  t.paused = true;
  t.update(5);
  assert(t.simSeconds === 0);
});

console.log('\n== SHIP CONTROLLER ==');
check('keyboard sampling + delta consumption', () => {
  const canvas = makeCanvas();
  const listeners = {};
  globalThis.window.addEventListener = (k, fn) => { (listeners[k] ||= []).push(fn); };
  const ctrl = new ShipController(canvas, { invertY: false });
  ctrl.keys.add('KeyW');
  ctrl.keys.add('ShiftLeft');
  const i1 = ctrl.sample(1 / 60);
  assert(i1.throttleF === 1 && i1.boost === true, 'W+Shift not read');
  ctrl.frame.yawDelta = 0.5;
  const i2 = ctrl.sample(1 / 60);
  assert(Math.abs(i2.yawDelta - 0.5) < 1e-9, 'delta not delivered');
  const i3 = ctrl.sample(1 / 60);
  assert(i3.yawDelta === 0, 'delta not consumed — ship would spin forever');
  ctrl.enabled = false;
  const i4 = ctrl.sample(1 / 60);
  assert(i4.throttleF === 0 && !i4.boost, 'disabled controller still inputs');
  globalThis.window.addEventListener = () => {};
});
check('touch stick merge', () => {
  const canvas = makeCanvas();
  const ctrl = new ShipController(canvas, { invertY: false });
  ctrl.touch = { move: { x: 0, y: 0.9 }, look: { x: 0, y: 0 }, active: true, vertUp: true, boost: false, brake: false, interactHeld: false };
  const i = ctrl.sample(1 / 60);
  assert(i.throttleF === 0.9 && i.vert === 1, 'touch merge failed');
});

console.log('\n== SURFACE SCENES ==');
for (const id of ['earth', 'moon', 'mars']) {
  check(`${id} surface builds, gravity + height sampling work`, () => {
    const cfg = id === 'earth' ? PLANETS.find(p => p.id === 'earth') : id === 'moon' ? MOONS.find(m => m.id === 'moon') : PLANETS.find(p => p.id === 'mars');
    const surf = new SurfaceScene(cfg, 'low');
    const h0 = surf.heightAt(0, 0);
    assert(Number.isFinite(h0), 'height not finite');
    const h1 = surf.heightAt(3, 7);
    assert(Number.isFinite(h1), 'bilinear height not finite');
    assert(surf.gravAccel > 0);
    assert(surf.altitude > 0, 'start below ground');
    // simulate falling (drag makes descent slow; ~80s sim)
    const camera = new THREE.PerspectiveCamera();
    const input = { throttleF: 0, strafe: 0, vert: 0, yawDelta: 0, pitchDelta: 0, rollDelta: 0 };
    let crashed = false, left = false;
    for (let i = 0; i < 2400; i++) {
      surf.update(1 / 30, input, camera, {
        fuelAvailable: () => false,
        onCrash: () => { crashed = true; },
        onLeave: () => { left = true; },
      });
    }
    assert(surf.landed || crashed, 'neither landed nor crashed after falling');
    assert(!left, 'accidental space exit');
    surf.dispose();
  });
}

console.log('\n== SURFACE EXPANSION (all worlds + EVA + supply line) ==');
check('every planet & moon has a research surface theme', () => {
  for (const cfg of [...PLANETS, ...MOONS]) {
    const th = themeFor(cfg);
    assert(th, `no theme for ${cfg.id}`);
    assert(th.amp > 0 && Array.isArray(th.features), `bad theme for ${cfg.id}`);
    assert(th.rewards && Object.keys(th.rewards).length > 0, `no sample rewards for ${cfg.id}`);
    assert(cfg.surface && cfg.surface.theme, `${cfg.id} missing surface.theme in config`);
    assert(SURFACE_THEMES[cfg.surface.theme], `${cfg.id} theme key not found`);
  }
});
check('all 18 bodies build distinct surfaces with caches + sample site', () => {
  const seenTitles = new Set();
  for (const cfg of [...PLANETS, ...MOONS]) {
    const surf = new SurfaceScene(cfg, 'low');
    for (const [x, z] of [[0, 0], [120, -90], [-300, 200], [400, 350]]) {
      assert(Number.isFinite(surf.heightAt(x, z)), `${cfg.id} height not finite`);
    }
    assert(surf.gravAccel > 0, `${cfg.id} gravity`);
    assert(surf.altitude > 0, `${cfg.id} ship starts below ground`);
    assert(surf.caches.length > 0, `${cfg.id} has no supply caches`);
    assert(surf.caches.every(c => Number.isFinite(c.pos.y)), `${cfg.id} cache pos not finite`);
    assert(surf.sampleSite && Number.isFinite(surf.sampleSite.pos.y), `${cfg.id} sample site`);
    assert(Array.isArray(surf.brokenRovers), `${cfg.id} brokenRovers array`);
    if (surf.theme.cloudDeck) assert(surf.brokenRovers.length === 0, `${cfg.id} cloud deck should have no broken rovers`);
    seenTitles.add(surf.theme.title);
    // every body must offer at least parts recovery somewhere
    const c = surf.caches[0];
    assert(c.payload && c.payload.parts >= 1, `${cfg.id} cache missing spare parts`);
  }
  assert(seenTitles.size >= 12, 'expected a distinct map per world');
});
check('supply cache recover (spare parts) + delivery from Earth round-trip', () => {
  const cfg = PLANETS.find(p => p.id === 'mars');
  const surf = new SurfaceScene(cfg, 'low');
  const c = surf.caches[0];
  const near = surf.nearestCache(c.pos.x, c.pos.z, 16);
  assert(near && near.i === 0, 'nearestCache missed the cache');
  const payload = surf.takeCache(0);
  assert(payload && payload.parts >= 1, 'takeCache payload');
  assert(surf.nearestCache(c.pos.x, c.pos.z, 16) === null, 'cache still pickable after take');
  const order = { id: 'o-test-1', planet: 'mars', item: 'parts', qty: 1 };
  surf.addDelivery(order);
  const dPos = surf.deliveries[0].pos;
  const d = surf.nearestDelivery(dPos.x, dPos.z, 16);
  assert(d, 'nearestDelivery missed the crate');
  const taken = surf.takeDelivery(d.i);
  assert(taken && taken.id === 'o-test-1', 'takeDelivery order');
  surf.dispose();
});
check('astronaut EVA: runs, jumps under local gravity, lands', () => {
  const cfg = PLANETS.find(p => p.id === 'mars');
  const surf = new SurfaceScene(cfg, 'low');
  surf.enterFoot({ x: 40, z: 40 });
  const cam = new THREE.PerspectiveCamera();
  // hold JUMP for 1 second (one clean hop), then run on flat ground
  const input = { throttleF: 1, strafe: 0, vert: 1, yawDelta: 0, pitchDelta: 0, rollDelta: 0, boost: false };
  let airborne = false, maxY = -Infinity;
  for (let i = 0; i < 900; i++) {
    input.vert = i < 30 ? 1 : 0;
    surf.update(1 / 30, input, cam, { fuelAvailable: () => false, onCrash: () => {}, onLeave: () => {} });
    if (!surf.footState.grounded) airborne = true;
    maxY = Math.max(maxY, surf.footState.position.y - surf.heightAt(surf.footState.position.x, surf.footState.position.z));
  }
  const start = Math.hypot(40, 40), end = surf.footState.position;
  assert(airborne, 'astronaut never left the ground (jump failed)');
  assert(maxY > 1.2, `jump apex too low (${maxY.toFixed(2)})`);
  const travelled = Math.hypot(end.x - 40, end.z - 40);
  assert(travelled > 10, `astronaut did not run (moved ${travelled.toFixed(1)})`);
  assert(surf.footState.grounded, 'astronaut not grounded at end of sim');
  assert(surf.vehicleMode === 'foot', 'vehicle mode should stay foot');
  surf.dispose();
});
check('low-gravity world gives longer hang time (Phobos EVA)', () => {
  const cfg = MOONS.find(m => m.id === 'phobos');
  const surf = new SurfaceScene(cfg, 'low');
  surf.enterFoot({ x: 10, z: 10 });
  const cam = new THREE.PerspectiveCamera();
  const input = { throttleF: 0, strafe: 0, vert: 1, yawDelta: 0, pitchDelta: 0, rollDelta: 0, boost: false };
  let airborneFrames = 0;
  for (let i = 0; i < 60 * 12; i++) {
    surf.update(1 / 30, input, cam, { fuelAvailable: () => false, onCrash: () => {}, onLeave: () => {} });
    if (!surf.footState.grounded) airborneFrames++;
  }
  assert(airborneFrames > 30, 'low-g jump should hang in the air a long time');
  surf.dispose();
});
check('supply line quotes scale with distance from Earth', () => {
  const sl = ECONOMY.surface.supplyLine;
  assert(Array.isArray(sl.items) && sl.items.length >= 4, 'supply items');
  const dfMars = Math.abs(202.5 - 160) / 300;
  const dfJupiter = Math.abs(433.2 - 160) / 300;
  const cMars = Math.ceil(ECONOMY.resources.parts.price * 1 * (1 + sl.costPerDist * dfMars));
  const cJup = Math.ceil(ECONOMY.resources.parts.price * 1 * (1 + sl.costPerDist * dfJupiter));
  assert(cJup > cMars > 0, 'cost must scale with distance');
  const eMars = sl.baseEtaGameSec + sl.etaPerDist * dfMars;
  const eJup = sl.baseEtaGameSec + sl.etaPerDist * dfJupiter;
  assert(eJup > eMars > 0, 'ETA must scale with distance');
});
check('fresh state persists supply orders + new stats fields', () => {
  const st = freshState();
  assert(Array.isArray(st.supplyOrders), 'supplyOrders array');
  assert(typeof st.stats.caches === 'number' && typeof st.stats.deliveries === 'number' && typeof st.stats.evas === 'number', 'new stats');
  assert(ACHIEVEMENTS.some(a => a.id === 'scavenger') && ACHIEVEMENTS.some(a => a.id === 'logistics') && ACHIEVEMENTS.some(a => a.id === 'walker'), 'new achievements registered');
});

console.log('\n== AUDIO MANAGER (no audio hardware) ==');
check('audio manager no-ops safely without AudioContext', () => {
  const am = new AudioManagerMod.AudioManager();
  am.init(); // should not throw
  am.setEngine(0.5, false);
  am.click(); am.scan(0.5); am.missionComplete(); am.arrival();
  am.startMining(); am.stopMining();
  am.setWarning(true); am.setWarning(false);
  am.startMusic(); am.stopMusic();
  am.setVolumes(0.5, 0.5);
});

console.log('\n== FULL WORLD TICK (20 simulated frames) ==');
check('integrated update does not explode', () => {
  const solar = globalThis.__solar;
  const belt = globalThis.__belt;
  const fx = globalThis.__fx;
  const ship = {
    position: new THREE.Vector3(170, 0, 0), quaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(10, 0, 0), fuel: 100, energy: 100, shield: 100, hull: 100, speed: 0
  };
  const physics = new ShipPhysics(ship);
  const stats = shipStats(freshState().upgrades);
  const bodies = [...solar.planets.values()];
  const input = { throttleF: 1, strafe: 0, vert: 0, boost: true, brake: false, yawDelta: 0.01, pitchDelta: 0.005, rollDelta: 0 };
  for (let i = 0; i < 20; i++) {
    solar.update(i * 60, 1 / 60);
    physics.update(1 / 60, input, stats, bodies, { onDamage: () => {} });
    belt.update(1 / 60, ship.position);
    fx.update(1 / 60);
    fx.setBeam(ship.position, ship.position.clone().add(new THREE.Vector3(1, 0, 0)), true);
    fx.mineSparks(ship.position);
    fx.explosion(ship.position, 1);
    assert(Number.isFinite(ship.position.x) && Number.isFinite(ship.position.y) && Number.isFinite(ship.position.z), 'ship position diverged');
  }
});

console.log(`\n=====================================`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
