// Modal-state regression test — the "dead buttons on GitHub Pages" bug.
//
// Full-screen overlays (menu modals z-45, pause z-42, map z-35, dock z-45,
// planet info z-30) sit above the main menu (z-40). The game gates ESC,
// pointer-lock recovery and in-flight actions on `Game.modalOpen`, which was
// pure bookkeeping. Modals opened outside Game.openModal() — the main-menu
// MISSIONS/SHIP/SETTINGS/HELP buttons (Menu's own show*() methods), the NEW
// GAME confirm, the dock-stacked MISSIONS panel — left the flag stale:
//
//   * stale `null`  → ESC is a no-op, the full-screen modal stays open and
//                     swallows every click → "buttons don't work";
//   * stale 'confirm' (fast-travel CANCEL) → SCAN/interact/land stay gated.
//
// The fix re-derives the flag from the DOM via topVisibleModal() before
// those decisions. This test exercises that derivation against the REAL
// UI classes (same construction style as ui-smoke.mjs) plus the reported
// menu-mode flow end to end.
import { JSDOM } from 'jsdom';
import { GameState } from '../src/game/GameState.js';
import { Menu } from '../src/ui/Menu.js';
import { Codex } from '../src/ui/Codex.js';
import { MapView } from '../src/ui/Map.js';
import { PlanetInfoPanel } from '../src/ui/PlanetInfo.js';
import { DockPanel } from '../src/ui/DockPanel.js';
import { topVisibleModal, MODAL_PRIORITY } from '../src/utils/modalState.js';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'https://solar-odyssey.test/'
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.localStorage = dom.window.localStorage;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.matchMedia = () => ({ matches: false });
dom.window.Element.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
};
const ctx2d = () => ({
  fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', globalAlpha: 1,
  setTransform: () => {}, clearRect: () => {}, fillRect: () => {}, strokeRect: () => {},
  fillText: () => {}, beginPath: () => {}, arc: () => {}, fill: () => {}, stroke: () => {},
  moveTo: () => {}, lineTo: () => {}, save: () => {}, restore: () => {}, translate: () => {},
  rotate: () => {}, scale: () => {}, closePath: () => {}, setLineDash: () => {}, drawImage: () => {}
});
dom.window.HTMLCanvasElement.prototype.getContext = function () { return ctx2d(); };

let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.error('  ✗', name, '—', e.message); if (process.env.VERBOSE) console.error(e.stack); }
};
const assert = (c, m) => { if (!c) throw new Error(m || 'assert failed'); };

const root = document.getElementById('app');
const gs = new GameState();
const noop = () => {};
let menu, codex, map, pinfo, dock, ftDialog, ftBtns;

// A faithful stand-in for Game's ESC/close sequence: sync from the DOM, then
// closeModal() — which hides every overlay and, when the pause overlay is the
// tracked top layer, unpauses. Mirrors src/game/Game.js closeModal() exactly.
function makeGameLike(registry, extra) {
  const game = { modalOpen: topVisibleModal(registry), ...extra };
  game.syncModalState = () => { game.modalOpen = topVisibleModal(registry); };
  game.closeModal = () => {
    if (dock.visible) { game.undock(); return; }
    map.hide(); codex.hide(); pinfo.hide();
    menu.missionsModal.close(); menu.shipModal.close(); menu.settingsModal.close();
    menu.helpModal.close(); menu.confirmModal.close(); ftDialog.classList.add('hidden');
    if (game.modalOpen === 'pause') { menu.hidePause(); game.paused = false; }
    game.modalOpen = null;
  };
  game.undock = () => {
    dock.hide();
    menu.missionsModal.close(); // Game.undock() also clears the stacked panel
    game.modalOpen = null;
  };
  return game;
}

console.log('\n== MODAL STATE (topVisibleModal) ==');

check('real UI classes construct', () => {
  menu = new Menu(root, {
    play: noop, newGame: noop, codex: noop, resume: noop, save: noop,
    quitToMenu: noop, settingsChanged: noop
  }, gs);
  codex = new Codex(root, gs);
  map = new MapView(root, { close: noop, select: noop });
  pinfo = new PlanetInfoPanel(root, { setTarget: noop, fastTravel: noop, scan: noop, codex: noop });
  dock = new DockPanel(root, {
    gs, getShip: () => ({ fuel: 40, hull: 55 }),
    onSell: noop, onRefuel: noop, onRepair: noop, onBuy: noop,
    onMissions: noop, onUndock: noop, sound: noop
  });
  assert(menu.overlay.parentElement === root && codex.modal.root.parentElement === root);
});

check('registry mirrors Game._modalRegistry (same kinds as the real code)', () => {
  // The registry Game builds in _buildUI:
  const registry = {
    pause: menu.pause,
    confirm: [menu.confirmModal.root, document.createElement('div')], // + ft dialog
    missions: menu.missionsModal.root,
    settings: menu.settingsModal.root,
    ship: menu.shipModal.root,
    help: menu.helpModal.root,
    redeem: menu.redeemModal.root,
    codex: codex.modal.root,
    account: document.createElement('div'),
    vab: document.createElement('div'),
    base: document.createElement('div'),
    map: map.rootEl,
    docked: dock.modal.root,
    planetinfo: pinfo.rootEl
  };
  ftDialog = document.createElement('div');
  ftDialog.className = 'modal hidden';
  ftDialog.id = 'ft-modal';
  root.appendChild(ftDialog);
  registry.confirm = [menu.confirmModal.root, ftDialog];
  globalThis.__registry = registry;
  for (const kind of MODAL_PRIORITY) assert(registry[kind], `registry missing kind "${kind}"`);
});

const top = () => topVisibleModal(globalThis.__registry);
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

check('nothing open → null', () => assert(top() === null, `got ${top()}`));

check('clicking main-menu MISSIONS (real button) → "missions"', () => {
  click(menu.overlay.querySelector('#mm-missions'));
  assert(!menu.missionsModal.root.classList.contains('hidden'), 'missions modal did not open');
  assert(top() === 'missions', `got ${top()}`);
});

check('ESC sequence (sync + closeModal) closes it — the reported dead-buttons flow', () => {
  const game = makeGameLike(globalThis.__registry);
  // what Game's ESC handler now does:
  game.syncModalState();
  assert(game.modalOpen === 'missions', `sync saw ${game.modalOpen}`);
  game.closeModal();
  assert(top() === null, `still ${top()} after ESC`);
  assert(menu.missionsModal.root.classList.contains('hidden'), 'missions modal still visible');
});

check('menu button → modal → ESC works for every menu-originated modal', () => {
  const cases = [
    ['#mm-missions', 'missionsModal'], ['#mm-ship', 'shipModal'],
    ['#mm-settings', 'settingsModal'], ['#mm-help', 'helpModal']
  ];
  for (const [btn, modalKey] of cases) {
    click(menu.overlay.querySelector(btn));
    assert(!menu[modalKey].root.classList.contains('hidden'), `${btn} did not open modal`);
    const game = makeGameLike(globalThis.__registry);
    game.syncModalState();
    assert(game.modalOpen, `ESC: sync saw null for ${btn} (would be a no-op — the bug)`);
    game.closeModal();
    assert(menu[modalKey].root.classList.contains('hidden'), `${modalKey} wedged open`);
  }
});

check('NEW GAME confirm: real button opens it; ESC closes it', () => {
  click(menu.overlay.querySelector('#mm-new'));
  assert(!menu.confirmModal.root.classList.contains('hidden'), 'confirm modal did not open');
  assert(top() === 'confirm', `got ${top()}`);
  const game = makeGameLike(globalThis.__registry);
  game.syncModalState();
  assert(game.modalOpen === 'confirm', `sync saw ${game.modalOpen}`);
  game.closeModal();
  assert(menu.confirmModal.root.classList.contains('hidden'), 'confirm wedged open');
});

check('pause overlay + stacked settings → top is "pause" (closeModal resumes game)', () => {
  menu.showPause();
  menu.showSettings();
  assert(top() === 'pause', `got ${top()}`);
  const game = makeGameLike(globalThis.__registry, { paused: true });
  game.syncModalState();
  game.closeModal();
  assert(game.paused === false, 'game not unpaused');
  assert(menu.pause.classList.contains('hidden'), 'pause overlay still visible');
  assert(menu.settingsModal.root.classList.contains('hidden'), 'settings wedged open');
});

check('docked + stacked MISSIONS → top is "missions"; undock clears both', () => {
  dock.show('Earth Station');
  menu.showMissions();
  assert(top() === 'missions', `got ${top()}`);
  const game = makeGameLike(globalThis.__registry);
  game.syncModalState();
  game.closeModal(); // ESC while docked → undock() path
  assert(!dock.visible, 'dock still visible after undock');
  assert(menu.missionsModal.root.classList.contains('hidden'), 'missions panel wedged above HUD');
  assert(top() === null, `top is ${top()}`);
});

check('fast-travel dialog + planet info → top is "confirm"', () => {
  pinfo.show('earth', gs, 1234);
  ftDialog.classList.remove('hidden');
  assert(top() === 'confirm', `got ${top()}`);
  ftDialog.classList.add('hidden');
  assert(top() === 'planetinfo', `got ${top()}`);
  pinfo.hide();
});

check('map and codex each track as their own kind', () => {
  map.show();
  assert(top() === 'map', `got ${top()}`);
  map.hide();
  codex.show();
  assert(top() === 'codex', `got ${top()}`);
  codex.hide();
  assert(top() === null, `got ${top()}`);
});

// ---- ESC master key: must fire even while input is gated (paused/modal) ----
console.log('\n== ESC MASTER KEY (ShipController) ==');
const { ShipController } = await import('../src/spacecraft/ShipController.js');

check('ESC emits pause while enabled=false (paused or modal open)', () => {
  const canvas = dom.window.document.createElement('canvas');
  const c = new ShipController(canvas, { invertY: false });
  c.enabled = false; // what Game sets while paused / a modal is open
  let pauseFired = 0, mapFired = 0;
  c.on('pause', () => pauseFired++);
  c.on('map', () => mapFired++);
  window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code: 'Escape' }));
  assert(pauseFired === 1, `Escape did not reach the pause handler (fired ${pauseFired}x)`);
  // …while ordinary UI keys stay gated
  window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code: 'KeyM' }));
  assert(mapFired === 0, 'KeyM should stay gated while disabled');
  // …and work again once enabled
  c.enabled = true;
  window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code: 'KeyM' }));
  assert(mapFired === 1, 'KeyM should fire when enabled');
});

console.log('\n=====================================');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
