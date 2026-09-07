// CSS input-layer regression test.
// Guards against the invisible-overlay bug where the blanket rule
// `#app > * { pointer-events: auto; }` (ID specificity 1,0,0) silently
// overrides the `pointer-events: none` on full-screen decorative layers
// (screen flash/fade, fading loader, toasts, HUD shell, mobile-controls
// shell). When that happened, an invisible full-viewport div sat above the
// main menu (z-index 55 > 40) and swallowed every click — the menu buttons
// appeared completely dead. The opt-out layers must win via higher
// specificity (`#app > .screen-flash` etc.), and interactive controls inside
// the passive HUD/mobile shells must stay clickable.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <div id="app">
    <div class="main-menu"><button id="mm-play">LAUNCH</button><button id="mm-new">NEW GAME</button></div>
    <div class="pause-overlay hidden"><button id="pz-resume">RESUME</button></div>
    <div class="modal hidden"><div class="modal-panel">panel</div></div>
    <div class="hud hidden">
      <button class="hud-btn" id="hud-btn-scan">SCAN</button>
      <div class="hud-timewarp" id="hud-warp">1× TIME</div>
    </div>
    <div class="loading-screen fade-out"></div>
    <div class="toast-container"></div>
    <div class="mobile-controls"><button class="mc-btn">M</button></div>
    <div class="screen-flash"></div>
    <div class="screen-fade"></div>
  </div>
</body></html>`, { url: 'https://solar-odyssey.test/' });
const { window } = dom;
const style = window.document.createElement('style');
style.textContent = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
window.document.head.appendChild(style);

let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.error('  ✗', name, '—', e.message); }
};
const assert = (c, m) => { if (!c) throw new Error(m || 'assert failed'); };
const pe = (sel) => window.getComputedStyle(window.document.querySelector(sel)).pointerEvents;

console.log('\n== CSS INPUT LAYERS (pointer-events) ==');

check('main menu overlay is interactive', () => assert(pe('.main-menu') === 'auto', `got ${pe('.main-menu')}`));
check('pause overlay is interactive', () => assert(pe('.pause-overlay') === 'auto', `got ${pe('.pause-overlay')}`));
check('modals are interactive', () => assert(pe('.modal') === 'auto', `got ${pe('.modal')}`));

check('screen-flash does not block clicks', () => assert(pe('.screen-flash') === 'none', `got ${pe('.screen-flash')}`));
check('screen-fade does not block clicks', () => assert(pe('.screen-fade') === 'none', `got ${pe('.screen-fade')}`));
check('fading loading screen does not block clicks', () => assert(pe('.loading-screen.fade-out') === 'none', `got ${pe('.loading-screen.fade-out')}`));
check('toast container does not block clicks', () => assert(pe('.toast-container') === 'none', `got ${pe('.toast-container')}`));
check('hud shell does not block clicks', () => assert(pe('.hud') === 'none', `got ${pe('.hud')}`));
check('mobile-controls shell does not block clicks', () => assert(pe('.mobile-controls') === 'none', `got ${pe('.mobile-controls')}`));

check('hud buttons stay clickable', () => assert(pe('.hud .hud-btn') === 'auto', `got ${pe('.hud .hud-btn')}`));
check('hud time-warp control stays clickable', () => assert(pe('.hud .hud-timewarp') === 'auto', `got ${pe('.hud .hud-timewarp')}`));
check('mobile control buttons stay clickable', () => assert(pe('.mobile-controls .mc-btn') === 'auto', `got ${pe('.mobile-controls .mc-btn')}`));

console.log(`\n=====================================`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
