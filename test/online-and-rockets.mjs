// Feature test for the v2 systems:
//   · settings persistence (browser storage, survives NEW GAME)
//   · multi-slot save system (the "past games" list) + export/import
//   · guest identity & the Supabase-backed Backend client (fetch mocked)
//   · rocket parts / design analysis / staging / import-export
//   · spawn safety (the "summoned inside the Sun" bug)
//   · object streaming (generate + erase around the player)
//   · the new main-menu browser, account panel and rocket workshop UI
//   · Android/browser Back behaving like ESC
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div><canvas id="c"></canvas></body></html>', {
  pretendToBeVisual: true,
  url: 'https://solar-odyssey.test/',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.localStorage = dom.window.localStorage;
globalThis.history = dom.window.history;
globalThis.location = dom.window.location;
globalThis.Blob = dom.window.Blob;
globalThis.FileReader = dom.window.FileReader;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.matchMedia = () => ({ matches: false });
globalThis.performance = performance;
dom.window.Element.prototype.getBoundingClientRect = () =>
  ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
const noop = () => {};
dom.window.HTMLCanvasElement.prototype.getContext = function () {
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', globalAlpha: 1,
    setTransform: noop, clearRect: noop, fillRect: noop, fillText: noop, beginPath: noop,
    arc: noop, fill: noop, stroke: noop, moveTo: noop, lineTo: noop, save: noop, restore: noop,
    translate: noop, rotate: noop, scale: noop, closePath: noop, createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }), measureText: () => ({ width: 10 }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: noop, drawImage: noop, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
};

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }
// Every check is awaited, so async assertions cannot silently skip.
async function check(name, fn) {
  try {
    await fn();
    passed++; console.log('  ✓ ' + name);
  } catch (e) {
    failed++; console.log('  ✗ ' + name + ' — ' + e.message);
  }
}

const { SaveSystem, hasStorage, MAX_SLOTS } = await import('../src/save/SaveSystem.js');
const { GameState } = await import('../src/game/GameState.js');
const {
  ROCKET_PARTS, analyzeDesign, starterDesign, sanitizeDesign,
  exportDesign, expandParts, stagesOf, getPart, EARTH_ORBIT_DV
} = await import('../src/rockets/RocketParts.js');
const { safeSpawn, insideSun, anchoredPosition, resolveAnchored, SUN_SAFE_RADIUS } = await import('../src/utils/SpawnSafety.js');
const { ObjectStreamer } = await import('../src/world/ObjectStreamer.js');
const { Backend } = await import('../src/net/Backend.js');
const { BackButton } = await import('../src/ui/BackButton.js');
const { UISound } = await import('../src/audio/UISound.js');
const { AccountPanel, randomGuestName } = await import('../src/ui/AccountPanel.js');
const { RocketBuilder } = await import('../src/ui/RocketBuilder.js');
const { Menu } = await import('../src/ui/Menu.js');

// =====================================================================
console.log('\n== SETTINGS PERSISTENCE (browser storage) ==');
await check('settings save to their own key and reload', () => {
  localStorage.clear();
  const gs = new GameState();
  gs.state.settings.music = 0.15;
  gs.state.settings.uiClicks = false;
  gs.saveSettings();
  const gs2 = new GameState();
  assert(gs2.state.settings.music === 0.15, 'music not restored');
  assert(gs2.state.settings.uiClicks === false, 'uiClicks not restored');
});
await check('settings SURVIVE starting a new career', () => {
  localStorage.clear();
  const gs = new GameState();
  gs.state.settings.music = 0.05;
  gs.state.settings.invertY = true;
  gs.saveSettings();
  gs.save({ position: [1, 2, 3], quaternion: [0, 0, 0, 1], fuel: 5, energy: 5, shield: 5, hull: 5 });
  gs.reset();                       // NEW GAME wipes the career...
  assert(gs.state.settings.music === 0.05, 'settings lost on reset');
  assert(gs.state.settings.invertY === true, 'settings lost on reset');
  const gs2 = new GameState();      // ...and still there on a fresh boot
  assert(gs2.state.settings.music === 0.05);
});
await check('settings from disk beat stale settings inside an old save blob', () => {
  localStorage.clear();
  const gs = new GameState();
  gs.state.settings.music = 0.9;
  gs.save({ position: [0, 0, 0], quaternion: [0, 0, 0, 1], fuel: 1, energy: 1, shield: 1, hull: 1 });
  gs.state.settings.music = 0.2;    // player changes it later
  gs.saveSettings();
  const gs2 = new GameState();
  gs2.load();
  assert(gs2.state.settings.music === 0.2, 'save blob overwrote newer settings');
});

// =====================================================================
console.log('\n== SAVE SLOTS (list of past games) ==');
await check('multiple careers live in separate slots', () => {
  localStorage.clear();
  const a = new GameState(); a.slot = 0; a.state.credits = 1111;
  a.save({ position: [0, 0, 0], quaternion: [0, 0, 0, 1], fuel: 1, energy: 1, shield: 1, hull: 1 }, { name: 'Alpha' });
  const b = new GameState(); b.slot = 1; b.state.credits = 2222;
  b.save({ position: [0, 0, 0], quaternion: [0, 0, 0, 1], fuel: 1, energy: 1, shield: 1, hull: 1 }, { name: 'Beta' });
  const slots = SaveSystem.listSlots();
  assert(slots.length === 2, 'expected 2 slots, got ' + slots.length);
  assert(slots.some(s => s.name === 'Alpha') && slots.some(s => s.name === 'Beta'));
  const loadA = new GameState(); loadA.load(0);
  assert(loadA.state.credits === 1111, 'slot 0 wrong');
  const loadB = new GameState(); loadB.load(1);
  assert(loadB.state.credits === 2222, 'slot 1 wrong');
});
await check('slot metadata carries level, credits, location and timestamp', () => {
  localStorage.clear();
  const gs = new GameState();
  gs.state.credits = 4321; gs.state.xp = 900; gs.state.playTime = 3600;
  gs.save({ position: [0, 0, 0], quaternion: [0, 0, 0, 1], fuel: 1, energy: 1, shield: 1, hull: 1 },
    { name: 'Voyager', location: 'Mars orbit' });
  const m = SaveSystem.meta(gs.slot);
  assert(m.name === 'Voyager' && m.credits === 4321 && m.location === 'Mars orbit');
  assert(m.savedAt > 0 && m.playTime === 3600);
});
await check('deleting one career leaves the others intact', () => {
  localStorage.clear();
  for (const [slot, name] of [[0, 'One'], [1, 'Two'], [2, 'Three']]) {
    const gs = new GameState(); gs.slot = slot;
    gs.save({ position: [0, 0, 0], quaternion: [0, 0, 0, 1], fuel: 1, energy: 1, shield: 1, hull: 1 }, { name });
  }
  SaveSystem.reset(1);
  const names = SaveSystem.listSlots().map(s => s.name).sort();
  assert(names.length === 2 && names.join(',') === 'One,Three', 'got ' + names);
});
await check('firstFreeSlot respects the slot cap', () => {
  localStorage.clear();
  for (let i = 0; i < MAX_SLOTS; i++) {
    const gs = new GameState(); gs.slot = i;
    gs.save({ position: [0, 0, 0], quaternion: [0, 0, 0, 1], fuel: 1, energy: 1, shield: 1, hull: 1 });
  }
  assert(SaveSystem.firstFreeSlot() === -1, 'should report full');
  SaveSystem.reset(3);
  assert(SaveSystem.firstFreeSlot() === 3);
});
await check('legacy v1 single save migrates into slot 0', () => {
  localStorage.clear();
  localStorage.setItem('solar-odyssey-save-v1', JSON.stringify({ version: 1, credits: 777, savedAt: Date.now() }));
  const slots = SaveSystem.listSlots();
  assert(slots.length === 1 && slots[0].credits === 777, 'legacy save not migrated');
  const gs = new GameState();
  assert(gs.load(0) && gs.state.credits === 777);
});
await check('career export → import round-trips', () => {
  localStorage.clear();
  const gs = new GameState();
  gs.state.credits = 5150; gs.state.discoveries.push('mars');
  gs.save({ position: [0, 0, 0], quaternion: [0, 0, 0, 1], fuel: 1, energy: 1, shield: 1, hull: 1 }, { name: 'Exported' });
  const json = SaveSystem.exportSlot(0);
  assert(json.includes('5150'));
  const target = SaveSystem.importSlot(json);
  const back = new GameState(); back.load(target);
  assert(back.state.credits === 5150 && back.state.discoveries.includes('mars'));
});
await check('importing junk is rejected cleanly', () => {
  let threw = false;
  try { SaveSystem.importSlot('{"hello":"world"}'); } catch { threw = true; }
  assert(threw, 'should reject non-save JSON');
});

// =====================================================================
console.log('\n== SPAWN SAFETY (the "spawned inside the Sun" bug) ==');
const SUN = { x: 0, y: 0, z: 0 };
await check('the origin is correctly identified as inside the Sun', () => {
  assert(insideSun({ x: 0, y: 0, z: 0 }, SUN), 'origin must be unsafe');
  assert(insideSun({ x: 20, y: 0, z: 10 }, SUN), 'near-star must be unsafe');
  assert(!insideSun({ x: 160, y: 0, z: 0 }, SUN), 'Earth orbit must be safe');
});
await check('NaN / undefined positions never spawn the player', () => {
  assert(insideSun({ x: NaN, y: 0, z: 0 }, SUN));
  assert(insideSun(null, SUN));
  const r = safeSpawn({ x: NaN, y: 0, z: 0 }, [{ position: { x: 160, y: 0, z: 0 } }], SUN);
  assert(r.relocated && r.reason === 'invalid coordinates');
  assert(Number.isFinite(r.position.x) && !insideSun(r.position, SUN));
});
await check('a save pointing at the origin relocates to the station, not the star', () => {
  const station = { position: { x: 160, y: 0, z: 4 } };
  const r = safeSpawn({ x: 0, y: 0, z: 0 }, [station], SUN);
  assert(r.relocated && r.reason === 'inside the Sun');
  assert(Math.hypot(r.position.x, r.position.z) > SUN_SAFE_RADIUS, 'still too close to the Sun');
});
await check('a valid position is passed through untouched', () => {
  const r = safeSpawn({ x: 164, y: 2, z: 9 }, [], SUN);
  assert(!r.relocated && r.position.x === 164 && r.position.y === 2);
});
await check('with no usable fallback it still lands somewhere safe', () => {
  const r = safeSpawn({ x: 0, y: 0, z: 0 }, [{ position: { x: 1, y: 0, z: 1 } }], SUN);
  assert(!insideSun(r.position, SUN), 'last-resort spawn is inside the Sun');
});
await check('positions are saved RELATIVE to a moving body and resolve later', () => {
  // Earth at t0, then Earth orbits to a completely different place.
  const earthT0 = { id: 'earth', position: { x: 160, y: 0, z: 0 } };
  const shipPos = { x: 164, y: 2.5, z: 9 };
  const snap = anchoredPosition(shipPos, [earthT0]);
  assert(snap.anchor === 'earth', 'should anchor to earth');
  const earthT1 = { position: { x: -120, y: 0, z: 105 } };  // half an orbit later
  const resolved = resolveAnchored(snap, () => earthT1);
  assert(Math.abs(resolved.x - (-116)) < 0.001, 'x drifted: ' + resolved.x);
  assert(Math.abs(resolved.z - 114) < 0.001, 'z drifted: ' + resolved.z);
  assert(!insideSun(resolved, SUN), 'reloaded ship ended up in the Sun');
});
await check('legacy absolute saves (no anchor) still load', () => {
  const resolved = resolveAnchored({ position: [200, 1, 3] }, () => null);
  assert(resolved.x === 200 && resolved.z === 3);
});

// =====================================================================
console.log('\n== ROCKET PARTS & DESIGN ANALYSIS ==');
await check('the parts catalogue is well-formed', () => {
  assert(ROCKET_PARTS.length >= 30, 'expected a deep catalogue, got ' + ROCKET_PARTS.length);
  const ids = new Set();
  for (const p of ROCKET_PARTS) {
    assert(p.id && !ids.has(p.id), 'duplicate/missing id: ' + p.id);
    ids.add(p.id);
    assert(p.name && p.cat && p.desc, 'incomplete part ' + p.id);
    assert(typeof p.mass === 'number' && p.mass >= 0, 'bad mass on ' + p.id);
    assert(typeof p.cost === 'number', 'bad cost on ' + p.id);
    if (p.cat === 'engine' || p.cat === 'booster') assert(p.thrust > 0 && p.isp > 0, 'motor without thrust/isp: ' + p.id);
  }
});
await check('the starter design actually reaches orbit', () => {
  const a = analyzeDesign(starterDesign());
  assert(a.valid, 'starter invalid: ' + a.errors.join('; '));
  assert(a.twr >= 1.15, 'starter TWR too low: ' + a.twr);
  assert(a.deltaV >= EARTH_ORBIT_DV, 'starter delta-v too low: ' + a.deltaV);
  assert(a.orbitCapable && a.reach !== 'Suborbital hop');
});
await check('an empty design is rejected with a helpful error', () => {
  const a = analyzeDesign({ version: 1, name: 'x', parts: [] });
  assert(!a.valid && a.errors.length, 'empty design should error');
});
await check('no command pod = error; two pods = error', () => {
  const noPod = analyzeDesign({ parts: [{ id: 'tank-m', qty: 1 }, { id: 'eng-swivel', qty: 1 }] });
  assert(noPod.errors.some(e => /command pod/i.test(e)));
  const twoPods = analyzeDesign({ parts: [{ id: 'cmd-mk1', qty: 2 }, { id: 'eng-swivel', qty: 1 }] });
  assert(twoPods.errors.some(e => /more than one/i.test(e)));
});
await check('a brick with no engine cannot leave the pad', () => {
  const a = analyzeDesign({ parts: [{ id: 'cmd-mk1', qty: 1 }, { id: 'tank-l', qty: 1 }] });
  assert(!a.valid && a.errors.some(e => /engines|boosters/i.test(e)));
});
await check('an underpowered rocket is caught by the TWR check', () => {
  // Huge tank, tiny engine.
  const a = analyzeDesign({ parts: [{ id: 'eng-ant', qty: 1 }, { id: 'tank-xl', qty: 1 }, { id: 'cmd-mk1', qty: 1 }] });
  assert(a.twr < 1.15, 'TWR should be terrible, got ' + a.twr);
  assert(a.errors.some(e => /thrust-to-weight/i.test(e)), 'no TWR error raised');
});
await check('adding fuel increases delta-v; adding dead mass decreases it', () => {
  const base = { parts: [{ id: 'eng-swivel', qty: 1 }, { id: 'tank-m', qty: 1 }, { id: 'cmd-probe', qty: 1 }] };
  const more = { parts: [{ id: 'eng-swivel', qty: 1 }, { id: 'tank-m', qty: 2 }, { id: 'cmd-probe', qty: 1 }] };
  const heavy = { parts: [{ id: 'eng-swivel', qty: 1 }, { id: 'tank-m', qty: 1 }, { id: 'pay-hab', qty: 1 }, { id: 'cmd-probe', qty: 1 }] };
  assert(analyzeDesign(more).deltaV > analyzeDesign(base).deltaV, 'more fuel must give more dv');
  assert(analyzeDesign(heavy).deltaV < analyzeDesign(base).deltaV, 'dead mass must cost dv');
});
await check('staging splits the stack and beats a single stage of the same mass', () => {
  const staged = {
    parts: [
      { id: 'eng-skipper', qty: 1 }, { id: 'tank-l', qty: 1 }, { id: 'dec-stack', qty: 1 },
      { id: 'eng-swivel', qty: 1 }, { id: 'tank-m', qty: 1 }, { id: 'cmd-probe', qty: 1 }
    ]
  };
  const a = analyzeDesign(staged);
  assert(a.stages.length === 2, 'expected 2 stages, got ' + a.stages.length);
  assert(a.stages.every(s => s.deltaV > 0), 'every stage should contribute dv');
  assert(Math.abs(a.deltaV - (a.stages[0].deltaV + a.stages[1].deltaV)) < 1, 'total dv != sum of stages');
});
await check('stagesOf / expandParts handle quantities', () => {
  const parts = expandParts({ parts: [{ id: 'srb-med', qty: 4 }, { id: 'cmd-mk1', qty: 1 }] });
  assert(parts.length === 5, 'qty not expanded: ' + parts.length);
  assert(stagesOf(parts).length === 1, 'no decoupler = one stage');
});
await check('the nuclear engine is efficient but feeble (catalogue sanity)', () => {
  const nerv = getPart('eng-nerv'), main = getPart('eng-mainsail');
  assert(nerv.isp > main.isp * 2, 'NERV should be far more efficient');
  assert(nerv.thrust < main.thrust / 10, 'NERV should be far weaker');
});
await check('missing parachute / heat shield warn a crewed design', () => {
  const a = analyzeDesign({
    parts: [{ id: 'eng-mainsail', qty: 1 }, { id: 'tank-xl', qty: 1 }, { id: 'cmd-mk2', qty: 1 }]
  });
  assert(a.warnings.some(w => /parachute/i.test(w)), 'no parachute warning');
  assert(a.warnings.some(w => /heat shield/i.test(w)), 'no heat shield warning');
});
await check('design export → sanitize round-trips', () => {
  const d = starterDesign();
  const restored = sanitizeDesign(exportDesign(d));
  assert(restored.name === d.name && restored.parts.length === d.parts.length);
  assert(analyzeDesign(restored).deltaV === analyzeDesign(d).deltaV, 'imported rocket flies differently');
});
await check('a hostile imported design is sanitised, not trusted', () => {
  const evil = {
    kind: 'solar-odyssey-rocket',
    design: {
      name: 'x'.repeat(500),
      parts: [
        { id: 'cmd-mk1', qty: 99999 },        // clamped
        { id: '../../etc/passwd', qty: 1 },   // dropped
        { id: 'tank-m', qty: -5 }             // clamped up to 1
      ]
    }
  };
  const clean = sanitizeDesign(evil);
  assert(clean.name.length <= 48, 'name not truncated');
  assert(clean.parts.every(p => getPart(p.id)), 'unknown part survived');
  assert(clean.parts.every(p => p.qty >= 1 && p.qty <= 50), 'quantity not clamped');
});
await check('sanitize rejects a file with nothing recognisable', () => {
  let threw = false;
  try { sanitizeDesign({ design: { name: 'n', parts: [{ id: 'nope' }] } }); } catch { threw = true; }
  assert(threw);
});

// =====================================================================
console.log('\n== OBJECT STREAMING (generate + erase around the player) ==');
function fakeObj() {
  const disposed = { geo: 0, mat: 0 };
  return {
    obj: {
      removeFromParent() { this.removed = true; },
      traverse(fn) { fn(this); },
      geometry: { dispose: () => disposed.geo++ },
      material: { dispose: () => disposed.mat++ },
      userData: {}
    },
    disposed
  };
}
await check('cells generate around the player and are freed behind them', () => {
  const scene = { add() {} };
  let created = 0;
  const s = new ObjectStreamer(scene, () => { created++; return fakeObj().obj; },
    { cellSize: 50, radius: 2, budgetPerTick: 999 });
  s.update(0, 0);
  const nearHome = s.cells.size;
  assert(nearHome > 0, 'nothing generated');
  // Walk far away — the original cells must be disposed.
  s.update(5000, 5000);
  for (const cell of s.cells.values()) {
    assert(Math.abs(cell.cx * 50 - 5000) < 400, 'stale far cell survived');
  }
  assert(s.stats.disposed >= nearHome, 'old cells were not erased');
});
await check('walking back regenerates the SAME content (deterministic seeds)', () => {
  const s = new ObjectStreamer({ add() {} }, () => fakeObj().obj, { cellSize: 40, radius: 1, seed: 7 });
  const a = s.seedFor(3, -4);
  const b = s.seedFor(3, -4);
  assert(a === b, 'seed is not stable');
  assert(s.seedFor(3, -4) !== s.seedFor(4, -4), 'neighbouring cells share a seed');
});
await check('geometry and materials are actually disposed', () => {
  const f = fakeObj();
  const s = new ObjectStreamer({ add() {} }, () => f.obj, { cellSize: 100, radius: 0, budgetPerTick: 9 });
  s.update(0, 0);
  s.clear();
  assert(f.disposed.geo > 0 && f.disposed.mat > 0, 'GPU resources leaked');
});
await check('shared geometry is NOT disposed with the cell', () => {
  let geoDisposed = 0;
  const shared = {
    removeFromParent() {}, traverse(fn) { fn(this); },
    geometry: { dispose: () => geoDisposed++ },
    material: { dispose: () => {} },
    userData: { sharedGeometry: true }
  };
  const s = new ObjectStreamer({ add() {} }, () => shared, { cellSize: 100, radius: 0 });
  s.update(0, 0);
  s.clear();
  assert(geoDisposed === 0, 'shared geometry was destroyed');
});
await check('the live cell count stays bounded no matter how far you travel', () => {
  const s = new ObjectStreamer({ add() {} }, () => fakeObj().obj,
    { cellSize: 30, radius: 3, maxCells: 40, budgetPerTick: 999 });
  for (let i = 0; i < 300; i++) s.update(i * 25, i * 12);
  assert(s.cells.size <= 40, 'cell budget exceeded: ' + s.cells.size);
});
await check('generator errors do not crash the stream', () => {
  const s = new ObjectStreamer({ add() {} }, () => { throw new Error('boom'); }, { cellSize: 50, radius: 1 });
  s.update(0, 0);   // must not throw
  assert(true);
});

// =====================================================================
console.log('\n== BACKEND CLIENT (Supabase, fetch mocked) ==');
function mockFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body, headers: opts.headers });
    for (const [pattern, res] of routes) {
      if (url.includes(pattern)) {
        return {
          ok: res.status ? res.status < 400 : true,
          status: res.status || 200,
          text: async () => JSON.stringify(res.body ?? null)
        };
      }
    }
    return { ok: false, status: 404, text: async () => JSON.stringify({ message: 'no route' }) };
  };
  return calls;
}
await check('an unconfigured backend fails with a helpful message, never a crash', async () => {
  localStorage.clear();
  const be = new Backend();
  assert(!be.configured && !be.signedIn);
  let msg = '';
  try { await be.listSaves(); } catch (e) { msg = e.message; }
  assert((await be.listSaves()).length === 0, 'listSaves should be empty, not throw');
  try { await be.pushSave(0, 'x', {}); } catch (e) { msg = e.message; }
  assert(/sign in/i.test(msg), 'unhelpful error: ' + msg);
});
await check('configure() validates the URL and persists credentials', () => {
  localStorage.clear();
  const be = new Backend();
  let threw = false;
  try { be.configure('not-a-url', 'key'); } catch { threw = true; }
  assert(threw, 'bad URL accepted');
  be.configure('https://demo.supabase.co/', 'anon-key');
  assert(be.configured && be.url === 'https://demo.supabase.co', 'trailing slash not trimmed');
  const be2 = new Backend();
  assert(be2.configured && be2.key === 'anon-key', 'credentials did not persist');
});
await check('sign-in stores the session and survives a reload', async () => {
  localStorage.clear();
  mockFetch([
    ['/auth/v1/token', { body: { access_token: 'tok', refresh_token: 'ref', user: { id: 'u1', email: 'a@b.c' } } }],
    ['/rest/v1/profiles', { body: [{ id: 'u1', handle: 'IronPilot' }] }]
  ]);
  const be = new Backend();
  be.configure('https://demo.supabase.co', 'anon');
  await be.signIn('a@b.c', 'pw');
  assert(be.signedIn && be.userId === 'u1' && be.handle === 'IronPilot');
  const be2 = new Backend();
  assert(be2.signedIn, 'session lost across reload');
});
await check('saves push with the merge-duplicates upsert header', async () => {
  const calls = mockFetch([['/rest/v1/saves', { body: [{ id: 's1' }] }]]);
  const be = new Backend();
  await be.pushSave(2, 'Career', { version: 1, credits: 10 }, { credits: 10, level: 3 });
  const c = calls.find(c => c.url.includes('/saves'));
  assert(c.method === 'POST' && /merge-duplicates/.test(c.headers.Prefer), 'upsert not requested');
  assert(JSON.parse(c.body).slot === 2 && JSON.parse(c.body).level === 3);
});
await check('friends are grouped into accepted / incoming / outgoing', async () => {
  mockFetch([
    ['/rest/v1/friends', { body: [
      { id: 'f1', user_id: 'u1', friend_id: 'u2', status: 'accepted' },
      { id: 'f2', user_id: 'u3', friend_id: 'u1', status: 'pending' },
      { id: 'f3', user_id: 'u1', friend_id: 'u4', status: 'pending' }
    ] }],
    ['/rest/v1/profiles', { body: [{ id: 'u2', handle: 'Nova' }, { id: 'u3', handle: 'Vesper' }, { id: 'u4', handle: 'Halo' }] }],
    ['/rest/v1/presence', { body: [{ user_id: 'u2', status: 'in-game', location: 'MARS SURFACE' }] }]
  ]);
  const be = new Backend();
  const f = await be.listFriends();
  assert(f.friends.length === 1 && f.friends[0].handle === 'Nova', 'accepted wrong');
  assert(f.friends[0].presence.location === 'MARS SURFACE', 'presence missing');
  assert(f.incoming.length === 1 && f.incoming[0].handle === 'Vesper', 'incoming wrong');
  assert(f.outgoing.length === 1 && f.outgoing[0].handle === 'Halo', 'outgoing wrong');
});
await check('a network failure surfaces as a readable error', async () => {
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  const be = new Backend();
  let msg = '';
  try { await be.listServers('all'); } catch (e) { msg = e.message; }
  assert(/cannot reach the server/i.test(msg), 'raw network error leaked: ' + msg);
});
await check('disconnect wipes credentials and session', () => {
  const be = new Backend();
  be.configure('https://demo.supabase.co', 'anon');
  be.disconnect();
  assert(!be.configured && !be.signedIn);
  assert(!new Backend().configured, 'credentials survived disconnect');
});

// =====================================================================
console.log('\n== BACK BUTTON = ESC ==');
await check('Back closes a modal, then pauses, then releases the page', () => {
  const seen = [];
  let state = 'modal';
  const bb = new BackButton(() => {
    seen.push(state);
    if (state === 'modal') { state = 'playing'; return true; }
    if (state === 'playing') { state = 'menu'; return true; }
    return false; // menu: let the browser go
  });
  bb.arm();
  window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  assert(seen.join(',') === 'modal,playing,menu', 'got ' + seen.join(','));
  bb.dispose();
});
await check('a throwing handler cannot break the Back trap', () => {
  const warn = console.warn; console.warn = () => {};   // expected noise
  const bb = new BackButton(() => { throw new Error('boom'); });
  bb.arm();
  window.dispatchEvent(new dom.window.PopStateEvent('popstate'));  // must not throw
  bb.dispose();
  console.warn = warn;
  assert(true);
});
await check('a disarmed Back button ignores popstate', () => {
  let hits = 0;
  const bb = new BackButton(() => { hits++; return true; });
  bb.arm(); bb.disarm();
  window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
  assert(hits === 0);
  bb.dispose();
});

// =====================================================================
console.log('\n== UI CLICK SOUNDS ==');
await check('clicks on interactive elements play a sound; dead space does not', () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  root.innerHTML = `<button id="b">go</button><div id="plain">text</div>
    <input id="slider" type="range"><button class="btn btn-danger" id="danger">del</button>
    <div class="server-row" id="row">row</div><button id="off" data-noclick>quiet</button>`;
  const played = [];
  const audio = { click: () => played.push('click'), tick: () => played.push('tick'), thud: () => played.push('thud') };
  const us = new UISound(root, audio, { enabled: () => true });
  const down = (id) => root.querySelector('#' + id)
    .dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
  down('b'); assert(played.length === 1 && played[0] === 'click', 'button did not click');
  down('plain'); assert(played.length === 1, 'plain text made a sound');
  down('slider'); assert(played[1] === 'tick', 'slider should tick');
  down('danger'); assert(played[2] === 'thud', 'danger button should thud');
  down('row'); assert(played[3] === 'click', 'list row should click');
  down('off'); assert(played.length === 4, 'data-noclick was ignored');
  us.dispose();
});
await check('the sound respects the settings toggle', () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  root.innerHTML = '<button id="q">go</button>';
  const played = [];
  let on = false;
  const us = new UISound(root, { click: () => played.push(1) }, { enabled: () => on });
  root.querySelector('#q').dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
  assert(played.length === 0, 'played while disabled');
  on = true;
  root.querySelector('#q').dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
  assert(played.length === 1, 'silent while enabled');
  us.dispose();
});

// =====================================================================
console.log('\n== MAIN MENU BROWSER UI ==');
const root = document.createElement('div');
document.body.appendChild(root);
localStorage.clear();
const gs = new GameState();
const menuActions = {};
const menu = new Menu(root, new Proxy(menuActions, {
  get: (t, k) => t[k] || (() => {})
}), gs);

await check('the menu renders careers, servers and friends tabs', () => {
  assert(menu.overlay.querySelector('[data-tab="saves"]'), 'no careers tab');
  assert(menu.overlay.querySelector('[data-tab="servers"]'), 'no servers tab');
  assert(menu.overlay.querySelector('[data-tab="friends"]'), 'no friends tab');
  assert(menu.overlay.querySelector('#mm-vab'), 'no rocket workshop button');
  assert(menu.overlay.querySelector('#mm-account'), 'no account button');
});
await check('an empty careers list shows guidance, not a blank box', () => {
  menu.renderSaves();
  assert(menu.panels.saves.textContent.includes('No careers yet'), 'missing empty state');
});
await check('saved careers appear as cards with their stats', () => {
  const g = new GameState(); g.slot = 0; g.state.credits = 8800; g.state.xp = 3000;
  g.save({ position: [0, 0, 0], quaternion: [0, 0, 0, 1], fuel: 1, energy: 1, shield: 1, hull: 1 },
    { name: 'Odyssey Prime', location: 'Titan surface' });
  menu.renderSaves();
  const text = menu.panels.saves.textContent;
  assert(menu.panels.saves.querySelectorAll('.slot-card').length === 1, 'no card rendered');
  assert(text.includes('Odyssey Prime') && text.includes('8,800') && text.includes('Titan surface'), text.slice(0, 200));
});
await check('career buttons call through to the game', () => {
  let loaded = null, deleted = null;
  menuActions.loadSlot = (s) => { loaded = s; };
  menuActions.deleteSlot = (s) => { deleted = s; };
  menu.renderSaves();
  menu.panels.saves.querySelector('.slot-actions .btn-primary').click();
  assert(loaded === 0, 'CONTINUE did not load slot 0');
  menu.panels.saves.querySelector('.slot-actions .btn-danger').click();  // opens confirm
  menu.confirmModal.body.querySelector('.btn-danger').click();
  assert(deleted === 0, 'DELETE did not reach the game');
});
await check('the server browser lists regional servers with pings', async () => {
  menuActions.listServers = async () => ([
    { name: 'Sol Gateway — Mumbai', region: 'ap-south', mode: 'coop', players: 12, capacity: 32, official: true, ping: 24 },
    { name: 'Sol Gateway — London', region: 'eu-west', mode: 'freeplay', players: 3, capacity: 32, ping: 190 }
  ]);
  menu.selectTab('servers');
  await new Promise(r => setTimeout(r, 30));
  const rows = menu.panels.servers.querySelectorAll('.server-row');
  assert(rows.length === 2, 'expected 2 servers, got ' + rows.length);
  const t = menu.panels.servers.textContent;
  assert(t.includes('Mumbai') && t.includes('AP-SOUTH') && t.includes('12/32') && t.includes('24ms'), t.slice(0, 200));
  assert(menu.panels.servers.querySelector('.sv-ping.good'), 'low ping not highlighted');
  assert(menu.panels.servers.querySelector('.sv-ping.bad'), 'high ping not flagged');
});
await check('JOIN reaches the game', async () => {
  let joined = null;
  menuActions.joinServer = (s) => { joined = s; };
  menu.selectTab('servers');
  await new Promise(r => setTimeout(r, 30));
  menu.panels.servers.querySelector('.server-row .btn-primary').click();
  assert(joined?.region === 'ap-south', 'join did not fire');
});
await check('a server-list failure shows an explanation, not a crash', async () => {
  menuActions.listServers = async () => { throw new Error('offline'); };
  menu.selectTab('servers');
  await new Promise(r => setTimeout(r, 30));
  assert(menu.panels.servers.textContent.includes('unavailable'), 'no error state');
});
await check('friends tab explains itself to guests', async () => {
  menuActions.listFriends = async () => null;   // guest
  menu.selectTab('friends');
  await new Promise(r => setTimeout(r, 30));
  assert(menu.panels.friends.textContent.includes('account'), 'no guest guidance');
});
await check('friends render with online state and requests', async () => {
  menuActions.listFriends = async () => ({
    friends: [{ row: { id: 'f1' }, handle: 'Nova', presence: { status: 'in-game', location: 'MARS SURFACE' } }],
    incoming: [{ row: { id: 'f2' }, handle: 'Vesper' }],
    outgoing: []
  });
  menu.selectTab('friends');
  await new Promise(r => setTimeout(r, 30));
  const t = menu.panels.friends.textContent;
  assert(t.includes('Nova') && t.includes('MARS SURFACE'), 'friend not shown');
  assert(t.includes('Vesper') && t.includes('REQUESTS'), 'request not shown');
  assert(menu.panels.friends.querySelector('.friend-row.online'), 'online state missing');
});
await check('the account strip reflects guest vs signed-in', () => {
  menuActions.accountInfo = () => ({ name: 'GUEST42', online: false });
  menu.refreshAccount();
  assert(menu.overlay.querySelector('.ma-name').textContent === 'GUEST42');
  assert(!menu.overlay.querySelector('#mm-account-strip').classList.contains('online'));
  menuActions.accountInfo = () => ({ name: 'IronPilot', online: true });
  menu.refreshAccount();
  assert(menu.overlay.querySelector('#mm-account-strip').classList.contains('online'), 'online state missing');
});

// =====================================================================
console.log('\n== ACCOUNT PANEL ==');
await check('guest mode is presented as fully playable', () => {
  localStorage.clear();
  const be = new Backend();
  let identity = { name: randomGuestName(), mode: 'guest' };
  const panel = new AccountPanel(root, {
    backend: be, identity: () => identity,
    setIdentity: (p) => { identity = { ...identity, ...p }; },
    toast: () => {}, onChanged: () => {}
  });
  panel.show();
  const t = panel.modal.body.textContent;
  assert(t.includes('Guest'), 'guest state not shown');
  assert(t.includes('CONNECT SERVER'), 'no way to go online');
  assert(/fully playable/i.test(t), 'guests should be reassured');
});
await check('a guest can rename their commander and it persists', () => {
  let identity = { name: 'OldName' };
  let saved = null;
  const panel = new AccountPanel(root, {
    backend: new Backend(), identity: () => identity,
    setIdentity: (p) => { identity = { ...identity, ...p }; saved = p; },
    toast: () => {}, onChanged: () => {}
  });
  panel.show();
  const input = panel.modal.body.querySelector('input[type="text"]');
  input.value = 'NovaRunner';
  panel.modal.body.querySelectorAll('button').forEach(b => { if (b.textContent === 'RENAME') b.click(); });
  assert(saved?.name === 'NovaRunner', 'rename did not save');
});
await check('the connect form validates before saving junk credentials', () => {
  localStorage.clear();
  const be = new Backend();
  const panel = new AccountPanel(root, {
    backend: be, identity: () => ({ name: 'G' }), setIdentity: () => {}, toast: () => {}, onChanged: () => {}
  });
  panel.show();
  panel.mode = 'connect';
  panel.render();
  const inputs = panel.modal.body.querySelectorAll('input');
  inputs[0].value = 'ftp://bad';
  inputs[1].value = 'key';
  panel.modal.body.querySelectorAll('button').forEach(b => { if (b.textContent === 'CONNECT') b.click(); });
  assert(panel.modal.body.querySelector('.form-status.error'), 'bad URL was not rejected');
  assert(!be.configured, 'junk credentials were stored');
});

// =====================================================================
console.log('\n== ROCKET WORKSHOP UI ==');
await check('the workshop opens with a flightworthy starter rocket', () => {
  const g = new GameState();
  const vab = new RocketBuilder(root, { gs: g, backend: new Backend(), toast: () => {}, onLaunch: () => {} });
  vab.show();
  const t = vab.modal.body.textContent;
  assert(t.includes('FLIGHT ANALYSIS'), 'no readout');
  assert(t.includes('Delta-v'), 'no delta-v');
  assert(vab.modal.body.querySelector('.ro-msg.ok'), 'starter should be flightworthy');
  assert(!vab.modal.body.querySelector('.vab-launch').disabled, 'launch button disabled for a valid rocket');
});
await check('parts can be added and the analysis updates live', () => {
  const g = new GameState();
  const vab = new RocketBuilder(root, { gs: g, backend: new Backend(), toast: () => {}, onLaunch: () => {} });
  vab.show();
  const before = analyzeDesign(vab.design).wetMass;
  vab.category = 'fuel'; vab.render();
  vab.modal.body.querySelector('.part-row .btn-primary').click();
  assert(analyzeDesign(vab.design).wetMass > before, 'adding a tank did not add mass');
});
await check('clearing the stack blocks launch and explains why', () => {
  const g = new GameState();
  const vab = new RocketBuilder(root, { gs: g, backend: new Backend(), toast: () => {}, onLaunch: () => {} });
  vab.show();
  vab.design = { version: 1, name: 'Empty', parts: [] };
  vab.render();
  assert(vab.modal.body.querySelector('.vab-launch').disabled, 'empty rocket can launch');
  assert(vab.modal.body.querySelector('.ro-msg.error'), 'no error explained');
});
await check('a design saves into the career and reappears under MY ROCKETS', () => {
  localStorage.clear();
  const g = new GameState();
  const vab = new RocketBuilder(root, { gs: g, backend: new Backend(), toast: () => {}, onLaunch: () => {} });
  vab.show();
  vab.design.name = 'Test Bird';
  vab._saveDesign();
  assert(g.state.rockets.designs.length === 1, 'design not stored in state');
  vab.tab = 'designs'; vab.render();
  assert(vab.modal.body.textContent.includes('Test Bird'), 'saved rocket not listed');
});
await check('launch is refused when the player cannot afford the vehicle', () => {
  const g = new GameState();
  g.state.credits = 10;
  let launched = false, warned = '';
  const vab = new RocketBuilder(root, {
    gs: g, backend: new Backend(),
    toast: (t, m) => { warned = m; }, onLaunch: () => { launched = true; }
  });
  vab.show();
  vab.modal.body.querySelector('.vab-launch').click();
  assert(!launched, 'launched without paying');
  assert(/CR/.test(warned), 'no cost explanation: ' + warned);
});
await check('an affordable, valid rocket launches', () => {
  const g = new GameState();
  g.state.credits = 500000;
  let got = null;
  const vab = new RocketBuilder(root, {
    gs: g, backend: new Backend(), toast: () => {}, onLaunch: (d, a) => { got = { d, a }; }
  });
  vab.show();
  vab.modal.body.querySelector('.vab-launch').click();
  assert(got && got.a.orbitCapable, 'launch did not fire');
  assert(got.d.parts.length > 0, 'design not handed over');
});
await check('the SHARED tab degrades gracefully with no server', () => {
  const g = new GameState();
  const vab = new RocketBuilder(root, { gs: g, backend: new Backend(), toast: () => {}, onLaunch: () => {} });
  vab.show();
  vab.tab = 'shared'; vab.render();
  const t = vab.modal.body.textContent;
  assert(t.includes('CONNECT SERVER'), 'no guidance for offline players');
  assert(t.includes('IMPORT FROM FILE'), 'no offline import path');
});

// =====================================================================
console.log('\n== LAUNCH SEQUENCE (Earth to orbit) ==');
const THREE = await import('three');
const { LaunchSequence } = await import('../src/rockets/LaunchSequence.js');
const { buildRocketMesh } = await import('../src/rockets/RocketMesh.js');

function fakeEarth() {
  const g = new THREE.Group();
  g.position.set(160, 0, 0);
  return { group: g, radius: 2.2, cfg: { id: 'earth', name: 'EARTH' } };
}
function flyToCompletion(seq, maxSeconds = 900) {
  const dt = 1 / 30;
  for (let t = 0; t < maxSeconds / dt; t++) {
    const phase = seq.update(dt);
    if (phase === 'orbit' || phase === 'failed') return phase;
  }
  return seq.phase;
}

await check('a rocket mesh is built from the design and can shed stages', () => {
  const mesh = buildRocketMesh(starterDesign());
  assert(mesh.children.length > 0, 'nothing built');
  const stages = mesh.userData.stageGroups;
  assert(stages.length >= 2, 'staging groups missing: ' + stages.length);
  mesh.dropStage(1);
  assert(stages[0].visible === false, 'spent stage still visible');
  assert(stages[stages.length - 1].visible === true, 'live stage was hidden');
});
await check('the countdown runs before anything moves', () => {
  const seq = new LaunchSequence(starterDesign(), fakeEarth(), new THREE.Scene());
  assert(seq.phase === 'countdown');
  seq.update(1);
  assert(seq.phase === 'countdown' && seq.altitude === 0, 'moved during countdown');
  for (let i = 0; i < 10; i++) seq.update(1);
  assert(seq.phase !== 'countdown', 'never lifted off');
});
await check('the starter rocket reaches orbit', () => {
  const seq = new LaunchSequence(starterDesign(), fakeEarth(), new THREE.Scene());
  const phase = flyToCompletion(seq);
  assert(phase === 'orbit', 'expected orbit, got ' + phase + ' — ' + seq.failReason);
  assert(seq.altitude > 0 && Number.isFinite(seq.altitude), 'bad altitude');
  assert(seq.events.some(e => /LIFT-OFF/.test(e.msg)), 'no lift-off event');
  assert(seq.events.some(e => /ORBIT/.test(e.msg)), 'no orbit event');
});
await check('stages separate during the ascent', () => {
  const seq = new LaunchSequence(starterDesign(), fakeEarth(), new THREE.Scene());
  flyToCompletion(seq);
  assert(seq.stageIndex > 0, 'never staged');
  assert(seq.events.some(e => /SEPARATION/.test(e.msg)), 'no separation logged');
});
await check('an underpowered rocket fails instead of cheating into orbit', () => {
  const dud = { version: 1, name: 'Dud', parts: [
    { id: 'eng-ant', qty: 1 }, { id: 'tank-xl', qty: 1 }, { id: 'cmd-mk1', qty: 1 }] };
  const seq = new LaunchSequence(dud, fakeEarth(), new THREE.Scene());
  const phase = flyToCompletion(seq);
  assert(phase === 'failed', 'a dud reached orbit: ' + phase);
  assert(seq.failReason && seq.failReason.length > 10, 'no reason given');
});
await check('a rocket with too little delta-v runs dry and reports why', () => {
  const short = { version: 1, name: 'Short', parts: [
    { id: 'srb-small', qty: 4 }, { id: 'cmd-probe', qty: 1 }] };
  const seq = new LaunchSequence(short, fakeEarth(), new THREE.Scene());
  const phase = flyToCompletion(seq);
  assert(phase === 'failed', 'got ' + phase);
  assert(/propellant|thrust|down/i.test(seq.failReason), seq.failReason);
});
await check('telemetry stays finite and sane the whole way up', () => {
  const seq = new LaunchSequence(starterDesign(), fakeEarth(), new THREE.Scene());
  for (let i = 0; i < 4000; i++) {
    seq.update(1 / 30);
    const t = seq.telemetry();
    assert(Number.isFinite(t.altitudeKm) && t.altitudeKm >= 0, 'bad altitude ' + t.altitudeKm);
    assert(Number.isFinite(t.speed) && t.speed >= 0, 'bad speed ' + t.speed);
    assert(t.fuelPct >= 0 && t.fuelPct <= 1, 'bad fuel ' + t.fuelPct);
    assert(t.stage >= 1 && t.stage <= t.stages, 'bad stage ' + t.stage);
    if (seq.phase === 'orbit' || seq.phase === 'failed') break;
  }
});
await check('the rocket launches FROM EARTH, not from the Sun or the origin', () => {
  const earth = fakeEarth();
  const seq = new LaunchSequence(starterDesign(), earth, new THREE.Scene());
  const p = seq.group.position;
  assert(Math.abs(p.x - 160) < 1, 'not at Earth: x=' + p.x);
  assert(p.y > earth.radius, 'started below the surface');
  assert(!insideSun({ x: p.x, y: p.y, z: p.z }, { x: 0, y: 0, z: 0 }), 'launched inside the Sun');
  flyToCompletion(seq);
  const q = seq.group.position;
  assert(!insideSun({ x: q.x, y: q.y, z: q.z }, { x: 0, y: 0, z: 0 }), 'flew into the Sun');
});
await check('dispose() releases the rocket from the scene', () => {
  const scene = new THREE.Scene();
  const seq = new LaunchSequence(starterDesign(), fakeEarth(), scene);
  assert(scene.children.length === 1, 'rocket not added');
  seq.dispose();
  assert(scene.children.length === 0, 'rocket not removed');
});

// =====================================================================
console.log('\n== SURFACE STREAMING INTEGRATION ==');
const { SurfaceScene } = await import('../src/game/SurfaceScene.js');
const { PLANETS } = await import('../src/config.js');
const marsCfg = PLANETS.find(p => p.id === 'mars');

await check('a landed surface streams props instead of building the whole map', () => {
  const surf = new SurfaceScene(marsCfg, 'medium', { streaming: 'medium' });
  assert(surf.streamer, 'no streamer created');
  assert(surf.streamer.cells.size > 0, 'nothing streamed in around the landing site');
  surf.dispose();
});
await check('driving across the world creates and erases objects', () => {
  const surf = new SurfaceScene(marsCfg, 'medium', { streaming: 'medium' });
  const before = surf.streamer.stats.created;
  surf.vehicleMode = 'rover';
  for (let i = 0; i < 60; i++) {
    surf.roverState.position.set(-400 + i * 12, 0, -400 + i * 12);
    surf._updateStreaming();
  }
  assert(surf.streamer.stats.created > before, 'no new cells while driving');
  assert(surf.streamer.stats.disposed > 0, 'nothing was erased behind the player');
  assert(surf.streamer.cells.size <= surf.streamer.maxCells, 'cell budget blown');
  surf.dispose();
});
await check('the landing pad and outpost are kept clear of debris', () => {
  const surf = new SurfaceScene(marsCfg, 'medium', {});
  // Every streamed instance must sit outside the outpost keep-out radius.
  let violations = 0;
  const m = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const cell of surf.streamer.cells.values()) {
    const inst = cell.obj;
    if (!inst?.isInstancedMesh) continue;
    for (let i = 0; i < inst.count; i++) {
      inst.getMatrixAt(i, m);
      v.setFromMatrixPosition(m);
      if (Math.hypot(v.x - surf.basePos.x, v.z - surf.basePos.z) < 20) violations++;
    }
  }
  assert(violations === 0, violations + ' props spawned on the landing pad');
  surf.dispose();
});
await check('the low streaming budget keeps fewer objects than high', () => {
  const low = new SurfaceScene(marsCfg, 'medium', { streaming: 'low' });
  const high = new SurfaceScene(marsCfg, 'medium', { streaming: 'high' });
  assert(low.streamer.maxCells < high.streamer.maxCells, 'budgets not differentiated');
  low.dispose(); high.dispose();
});

// =====================================================================
console.log('\n== ASTRONAUT MODEL ORIENTATION (the "broken face" bug) ==');
await check('the visor and chest face FORWARD (-Z); the backpack faces back', () => {
  const surf = new SurfaceScene(marsCfg, 'medium', {});
  const g = surf.astro.group;
  // Collect the head-area meshes by their z offset.
  const zs = [];
  g.traverse(o => { if (o.isMesh) zs.push({ y: o.position.y, z: o.position.z, o }); });
  const backpack = zs.find(m => Math.abs(m.y - 1.25) < 0.01 && Math.abs(Math.abs(m.z) - 0.42) < 0.01);
  const chest = zs.find(m => Math.abs(m.y - 1.3) < 0.01 && Math.abs(Math.abs(m.z) - 0.4) < 0.01);
  assert(backpack && backpack.z > 0, 'backpack is not on the back');
  assert(chest && chest.z < 0, 'chest pack is not on the chest');
  const lamps = zs.filter(m => Math.abs(m.y - 2.02) < 0.01);
  assert(lamps.length === 2 && lamps.every(l => l.z < 0), 'helmet lamps do not face forward');
  surf.dispose();
});
await check('the astronaut walks in the direction it faces', () => {
  const surf = new SurfaceScene(marsCfg, 'medium', {});
  surf.enterFoot({ x: 0, y: 0, z: 0 });
  const fs = surf.footState;
  fs.camYaw = 0;
  // Push forward on the stick for a second.
  for (let i = 0; i < 30; i++) {
    surf.update(1 / 30, { throttleF: 1, strafe: 0, vert: 0, yawDelta: 0, pitchDelta: 0 },
      new THREE.PerspectiveCamera(), { fuelAvailable: () => true, onCrash: () => {}, onLeave: () => {} });
  }
  assert(fs.position.z < -1, 'did not move forward (-Z), z=' + fs.position.z);
  // facing should point the same way it travelled
  const travel = Math.atan2(-0, -(-1));
  assert(Math.abs(Math.atan2(-fs.velocity.x, -fs.velocity.z) - fs.facing) < 0.6, 'model faces away from travel');
  surf.dispose();
});

console.log('\n=====================================');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
