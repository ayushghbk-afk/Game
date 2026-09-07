// UI smoke test — constructs every UI module inside jsdom, simulates
// gameplay data flows (HUD updates, dock transactions, map rendering,
// codex unlocking, planet info actions) and catches DOM-level errors.
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
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.matchMedia = () => ({ matches: false });
globalThis.performance = performance;
dom.window.Element.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
};
// canvas 2d stub (map drawing)
const noop = () => {};
const ctx2d = () => ({
  fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', globalAlpha: 1,
  setTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop, fillText: noop,
  beginPath: noop, arc: noop, fill: noop, stroke: noop, moveTo: noop, lineTo: noop,
  save: noop, restore: noop, translate: noop, rotate: noop, scale: noop, closePath: noop,
  setLineDash: noop, drawImage: noop,
});
dom.window.HTMLCanvasElement.prototype.getContext = function () { return ctx2d(); };

const { PLANETS, ECONOMY } = await import('../src/config.js');
const { GameState, ACHIEVEMENTS } = await import('../src/game/GameState.js');
const { HUD } = await import('../src/ui/HUD.js');
const { Menu } = await import('../src/ui/Menu.js');
const { MapView } = await import('../src/ui/Map.js');
const { PlanetInfoPanel } = await import('../src/ui/PlanetInfo.js');
const { MobileControls } = await import('../src/ui/MobileControls.js');
const { Codex } = await import('../src/ui/Codex.js');
const { DockPanel } = await import('../src/ui/DockPanel.js');
const { BasePanel } = await import('../src/ui/BasePanel.js');
const { Toasts } = await import('../src/ui/Toasts.js');
const { LoadingScreen } = await import('../src/ui/LoadingScreen.js');
const { MISSIONS } = await import('../src/missions/MissionData.js');

let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.error('  ✗', name, '—', e.message); if (process.env.VERBOSE) console.error(e.stack); }
};
const assert = (c, m) => { if (!c) throw new Error(m || 'assert failed'); };

const root = document.getElementById('app');
const gs = new GameState();

console.log('\n== UI CONSTRUCTION ==');
let hud, menu, map, pinfo, mobile, codex, dock, base, toasts, loading;
check('HUD constructs', () => {
  hud = new HUD(root, { map: noop, scan: noop, missions: noop, codex: noop });
  assert(hud.root.parentElement === root);
});
check('Menu constructs (with pause + 5 modals)', () => {
  menu = new Menu(root, {
    play: noop, newGame: noop, codex: noop, resume: noop, save: noop,
    quitToMenu: noop, settingsChanged: noop,
  }, gs);
  assert(menu.overlay.parentElement === root);
});
check('MapView constructs', () => { map = new MapView(root, { close: noop, select: noop }); });
check('PlanetInfoPanel constructs', () => {
  pinfo = new PlanetInfoPanel(root, { setTarget: noop, fastTravel: noop, scan: noop, codex: noop });
});
check('Codex constructs', () => { codex = new Codex(root, gs); });
check('DockPanel constructs', () => {
  dock = new DockPanel(root, {
    gs, getShip: () => ({ fuel: 40, hull: 55 }),
    onSell: noop, onRefuel: noop, onRepair: noop, onBuy: noop, onMissions: noop, onUndock: noop, sound: noop,
  });
});
check('BasePanel constructs + renders outpost services', () => {
  base = new BasePanel(root, {
    gs,
    onRest: noop, onEat: noop, onMaintain: () => ({ ok: true }), onRover: noop, onLeave: noop, sound: noop,
    brokenRovers: () => [{ fixed: false }, { fixed: true }],
    maintainCooldownRemaining: () => 0,
  });
  gs.state.survival.satiety = 60;
  base.show('MARS OUTPOST', 'rover');
  const text = base.modal.body.textContent;
  assert(text.includes('LIVE / REST') && text.includes('EAT FOOD') && text.includes('MAINTAIN STATION') && text.includes('SURFACE ROVER'));
  base.hide();
  assert(!base.visible);
});
check('MobileControls constructs', () => {
  const touch = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, active: false };
  mobile = new MobileControls(root, touch, { interact: noop, scan: noop, map: noop, target: noop, missions: noop, codex: noop });
});
check('BasePanel renders supply line from Earth, EVA + field jobs', () => {
  const panelRoot = document.createElement('div');
  const panel = new BasePanel(panelRoot, {
    gs,
    onRest: noop, onEat: noop, onMaintain: () => ({ ok: true }), onRover: noop, onLeave: noop, sound: noop,
    onEva: noop,
    brokenRovers: () => [{ fixed: false }],
    maintainCooldownRemaining: () => 0,
    supplyQuote: () => ({ cost: 123, etaGameSec: 1600 }),
    orderItem: noop,
    getOrders: () => [{ id: 'o1', item: 'food', qty: 5, cost: 900, placedAt: 1000, dueAt: 2500 }],
  });
  panel.show('MARS OUTPOST', 'shuttle');
  const text = panel.modal.body.textContent;
  assert(text.includes('SURFACE ROVER'), 'rover action missing');
  assert(text.includes('SUPPLY LINE FROM EARTH') || text.includes('ORDER FROM EARTH'), 'supply card missing');
  assert(text.includes('123 CR'), 'supply quote missing');
  assert(text.includes('in transit') && text.includes('arrives in'), 'in-transit order row missing');
  panel.hide();
});
check('HUD mode chip + bars track the active vehicle', () => {
  const hidden = (b) => hud.bars[b].root.classList.contains('hidden');
  hud.show();
  // space: ship bars, no satiety
  hud.setMode('space');
  hud.update({ fuel: 50, fuelMax: 100, shield: 90, shieldMax: 100, energy: 40, energyMax: 100, hull: 100, hullMax: 100, credits: 100, level: 1, clock: '', timeSpeed: 1, speed: '10 KM/S', prompt: '' });
  assert(hud.modeChip.textContent.includes('SHIP'), 'ship chip');
  assert(!hidden('fuel'), 'fuel row hidden in space');
  assert(!hidden('cargo'), 'cargo row hidden in space');
  assert(hidden('satiety'), 'satiety row visible in space');
  assert(hud.bars.energy.labelEl.textContent === 'ENERGY', 'space energy label');
  // rover: different chip + body, rover cell label, satiety appears
  hud.setMode('rover', 'MARS');
  hud.update({ satiety: 77, cargo: 5, cargoMax: 15, energy: 80, energyMax: 100, hull: 100, hullMax: 100, credits: 100, level: 1, clock: '', timeSpeed: 1, speed: '12 KM/H', prompt: '' });
  assert(hud.modeChip.textContent.includes('ROVER'), 'rover chip');
  assert(hud.modeChip.textContent.includes('MARS'), 'rover chip shows body');
  assert(hud.bars.energy.labelEl.textContent === 'ROVER CELL', 'rover energy label');
  assert(hidden('fuel'), 'fuel row should be hidden on rover');
  assert(!hidden('cargo'), 'cargo row on surface');
  assert(!hidden('satiety'), 'satiety row on surface');
  // astronaut: O2 label
  hud.setMode('foot', 'MARS');
  hud.update({ satiety: 77, cargo: 5, cargoMax: 15, energy: 80, energyMax: 100, hull: 100, hullMax: 100, credits: 100, level: 1, clock: '', timeSpeed: 1, speed: '12 KM/H', prompt: '' });
  assert(hud.modeChip.textContent.includes('ASTRONAUT'), 'astronaut chip');
  assert(hud.bars.energy.labelEl.textContent === 'O₂ / VITALS', 'astronaut energy label');
  hud.setMode('space');
  assert(hud.modeChip.textContent.includes('SHIP'), 'back to ship chip');
  assert(hidden('satiety'), 'satiety hidden back in space');
});
check('MobileControls buttons follow the active vehicle', () => {
  const q = (sel) => mobile.wrap.querySelector(sel);
  mobile.setMode('space');
  assert(!q('.mc-boost').classList.contains('hidden'), 'boost in space');
  assert(!q('[data-tap="land"]').classList.contains('hidden'), 'land in space');
  assert(q('.mc-jump').classList.contains('hidden'), 'jump hidden in space');
  assert(q('.mc-eva').classList.contains('hidden'), 'eva hidden in space');
  mobile.setMode('foot');
  assert(!q('.mc-jump').classList.contains('hidden'), 'jump on EVA');
  assert(!q('.mc-eva').classList.contains('hidden'), 'eva toggle on EVA');
  assert(q('.mc-eva').textContent === 'SHUTTLE', 'eva label on foot');
  assert(q('.mc-boost').classList.contains('hidden'), 'boost hidden on EVA');
  assert(q('[data-tap="land"]').classList.contains('hidden'), 'land hidden on EVA');
  mobile.setMode('rover');
  assert(q('.mc-eva').textContent === 'EVA', 'eva label on rover');
  assert(!q('.mc-boost').classList.contains('hidden'), 'boost on rover');
  mobile.setMode('space');
  assert(q('.mc-eva').classList.contains('hidden'), 'eva hidden back in space');
});
check('Toasts + LoadingScreen construct', () => {
  toasts = new Toasts(root);
  loading = new LoadingScreen(root);
  loading.progress(0.5, 'test');
  loading.done();
});

console.log('\n== HUD DATA FLOW ==');
check('HUD update with full snapshot (no NaN in DOM)', () => {
  hud.show();
  hud.update({
    fuel: 50, fuelMax: 100, shield: 90, shieldMax: 100, energy: 40, energyMax: 100,
    hull: 100, hullMax: 100, credits: 12345, level: 3,
    clock: '2087.03.14 12:00', timeSpeed: 10, warning: '⚠ FUEL LOW',
    mission: { name: 'FIRST FLIGHT', progressText: '10/45' },
    prompt: 'E — ENTER ORBIT · EARTH',
    action: { title: 'SCANNING…', p: 0.4 },
    target: { name: 'MARS', dist: '1.20M KM' },
    speed: '55,000 KM/S',
  });
  assert(hud.credits.textContent === '12,345');
  assert(hud.prompt.textContent.includes('ENTER ORBIT'));
  assert(hud.warning.classList.contains('on'));
  const widths = [...hud.root.querySelectorAll('.bar-fill')].map(b => parseFloat(b.style.width));
  assert(widths.every(w => Number.isFinite(w) && w >= 0 && w <= 100), 'bad bar widths: ' + widths);
});
check('HUD marker positioning', () => {
  hud.updateMarker(120, 80, true, 'MARS');
  assert(!hud.marker.classList.contains('hidden'));
  assert(hud.markerLabel.textContent === 'MARS');
  assert(hud.marker.style.transform.includes('120px'));
  hud.updateMarker(0, 0, false, '');
  assert(hud.marker.classList.contains('hidden'));
});

console.log('\n== MENU FLOWS ==');
check('missions modal lists all missions with active flag', () => {
  menu.showMissions();
  const cards = menu.missionsModal.body.querySelectorAll('.mission-card');
  assert(cards.length === MISSIONS.length);
  assert(cards[0].className.includes('active'), 'first mission should be active');
  assert(cards[1].className.includes('locked'));
  menu.missionsModal.close();
});
check('ship panel shows upgrade tiers', () => {
  menu.showShip();
  assert(menu.shipModal.body.textContent.includes('Engine'));
  assert(menu.shipModal.body.textContent.includes('MK1'));
  menu.shipModal.close();
});
check('settings modal renders all controls', () => {
  menu.showSettings();
  const rows = menu.settingsModal.body.querySelectorAll('.settings-row');
  assert(rows.length >= 10, 'expected at least 10 setting rows, got ' + rows.length);
  const text = menu.settingsModal.body.textContent;
  assert(text.includes('Mobile controls'), 'mobile controls setting missing');
  assert(text.includes('Aim assist'), 'aim assist setting missing');
  assert(text.includes('UI click sounds'), 'click-sound setting missing');
  assert(text.includes('Back button'), 'back-button setting missing');
  assert(text.includes('Object streaming'), 'streaming setting missing');
  assert(text.includes('Cloud sync'), 'cloud sync setting missing');
  menu.settingsModal.close();
});
check('help modal renders controls table', () => {
  menu.showHelp();
  assert(menu.helpModal.body.querySelectorAll('tr').length >= 15);
  menu.helpModal.close();
});
check('play label switches to CONTINUE when save exists', () => {
  // The label now reflects real SAVE SLOTS (the careers list), not just a
  // ship snapshot hanging off live state.
  gs.state.ship = { position: [0, 0, 0] };
  gs.save({ position: [0, 0, 0], quaternion: [0, 0, 0, 1], fuel: 1, energy: 1, shield: 1, hull: 1 });
  menu.refreshPlayLabel();
  assert(menu.overlay.querySelector('#mm-play').textContent.includes('CONTINUE'));
  gs.state.ship = null;
  menu.refreshPlayLabel();
});

console.log('\n== PLANET INFO ==');
check('info card shows real facts + actions', () => {
  pinfo.show('earth', gs, '12,400 KM');
  const text = pinfo.rootEl.textContent;
  assert(text.includes('EARTH') && text.includes('9.81') && text.includes('SET TARGET') && text.includes('FAST TRAVEL'));
  pinfo.hide();
  assert(!pinfo.visible);
});
check('locked body hides codex text', () => {
  pinfo.show('neptune', gs, 'far');
  assert(pinfo.rootEl.textContent.includes('UNKNOWN'));
  assert(!pinfo.rootEl.textContent.includes('supersonic'), 'codex leaked for unscanned body');
  pinfo.hide();
});

console.log('\n== CODEX ==');
check('codex locks unexplored, unlocks discovered', () => {
  codex.show();
  let locked = codex.content.querySelectorAll('.codex-entry.locked').length;
  assert(locked > 5, 'expected locked entries');
  gs.state.visited.push('mars');
  codex.render();
  const marsRow = [...codex.content.querySelectorAll('.ce-title')].find(t => t.textContent === 'MARS');
  assert(marsRow && !marsRow.parentElement.classList.contains('locked'));
  // resources tab
  codex.activeTab = 'RESOURCES'; codex.render();
  assert(codex.content.textContent.includes('IRON'));
  // achievements tab
  codex.activeTab = 'ACHIEVEMENTS'; codex.render();
  assert(codex.content.textContent.includes('FIRST ORBIT'));
  codex.hide();
});

console.log('\n== DOCK PANEL ==');
check('trade tab renders + sell button flow', () => {
  gs.state.resources.iron = 25;
  dock.active = 'TRADE';
  dock.show('EARTH STATION');
  const btns = [...dock.content.querySelectorAll('button')].filter(b => b.textContent === '10');
  assert(btns.length >= 1, 'sell-10 button missing');
  let sold = 0;
  // click the iron row's "10" button (first resource row)
  btns[0].click();
  assert(true); // onSell stub is noop — DOM click must not throw
  dock.hide();
});
check('services shows refuel + repair with live ship values', () => {
  dock.active = 'SERVICES';
  dock.render();
  const text = dock.content.textContent;
  assert(text.includes('REFUEL') && text.includes('REPAIR HULL'));
  assert(text.includes('60 units'), 'fuel calc wrong: ' + text.match(/\+\d+ units/)?.[0]);
  assert(text.includes('45% damage'), 'hull calc wrong');
});
check('upgrades tab lists 5 systems with prices', () => {
  gs.state.credits = 99999; // affordable so the buy button is enabled
  dock.active = 'UPGRADES';
  dock.render();
  const text = dock.content.textContent;
  for (const k of ['Engine', 'Fuel Tank', 'Shield', 'Scanner', 'Cargo Hold']) assert(text.includes(k), k + ' missing');
  assert(text.includes('BUY MK2 — 1,500 CR'), 'engine upgrade price wrong');
  // buy flow with enough credits
  gs.state.credits = 99999;
  let bought = null;
  dock.hooks.onBuy = (sys, cost) => { bought = [sys, cost]; };
  const buyBtn = [...dock.content.querySelectorAll('button')].find(b => b.textContent.startsWith('BUY'));
  buyBtn.click();
  assert(bought && bought[0] === 'engine' && bought[1] === 1500);
});
check('poor player sees disabled buy buttons', () => {
  gs.state.credits = 10;
  gs.state.upgrades.engine = 1;
  dock.render();
  const buyBtn = [...dock.content.querySelectorAll('button')].find(b => b.textContent.startsWith('BUY'));
  assert(buyBtn.disabled === true);
});

console.log('\n== MOBILE CONTROLS ==');
check('joystick drag feeds touch state', () => {
  const touch = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, active: false, boost: false, brake: false, vertUp: false, vertDown: false, interactHeld: false };
  const mc = new MobileControls(root, touch, { interact: noop, scan: noop, map: noop, target: noop, missions: noop, codex: noop });
  mc.show();
  assert(touch.active === true);
  const zone = mc.wrap.querySelector('.mc-left');
  // jsdom has no pointer capture; simulate manually
  const rect = { left: 0, top: 500, width: 128, height: 128 };
  mc.wrap.querySelector('.mc-left').getBoundingClientRect = () => rect;
  const nub = zone.querySelector('.joy-nub');
  // emulate: pointerdown at center + move right-down
  zone.dispatchEvent(new dom.window.PointerEvent('pointerdown', { pointerId: 1, clientX: 64, clientY: 564, bubbles: true }));
  zone.dispatchEvent(new dom.window.PointerEvent('pointermove', { pointerId: 1, clientX: 96, clientY: 596, bubbles: true }));
  assert(touch.move.x > 0.2 && touch.move.y < -0.2, 'joystick vectors wrong: ' + JSON.stringify(touch.move));
  zone.dispatchEvent(new dom.window.PointerEvent('pointerup', { pointerId: 1, clientX: 64, clientY: 564, bubbles: true }));
  assert(touch.move.x === 0 && touch.move.y === 0, 'joystick did not recenter');
  mc.hide();
  assert(touch.active === false);
});
check('hold buttons set flags; tap buttons fire actions', () => {
  const touch = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, active: false };
  let tapped = 0;
  const mc = new MobileControls(root, touch, { interact: () => tapped++, scan: noop, map: noop, target: noop, missions: noop, codex: noop });
  const boost = mc.wrap.querySelector('[data-hold="boost"]');
  boost.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true }));
  assert(touch.boost === true);
  boost.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true }));
  assert(touch.boost === false);
  const eBtn = mc.wrap.querySelector('[data-holdTap="interact"]');
  eBtn.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true }));
  eBtn.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true }));
  assert(tapped === 1, 'E tap should fire interact');
});

console.log('\n== MAP VIEW ==');
check('map show/hide + render with fake game', () => {
  const fakeGame = {
    gs,
    solar: {
      getBody: (id) => PLANETS.find(p => p.id === id)
        ? { group: { position: { x: PLANETS.find(p => p.id === id).orbitRadius, z: 0, y: 0 } } }
        : null,
      stations: [],
      moonsByPlanet: new Map(PLANETS.map(p => [p.id, []])),
      anomalies: [],
    },
    shipState: { position: { x: 160, y: 0, z: 0 } },
    target: null,
    forwardFlat: () => ({ x: 0, z: -1 }),
  };
  map.show();
  assert(map.open);
  map.render(fakeGame); // must not throw
  map._dots && assert(map._dots.length >= 9, 'dots missing');
  map.hide();
  assert(!map.open);
});

console.log(`\n=====================================`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
