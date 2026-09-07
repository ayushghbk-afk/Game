// End-to-end CONTROL test — boots the REAL game in headless Chromium and
// verifies the input paths players were reporting as dead:
//
//   DESKTOP  — mouse look via pointer lock (the normal path) and via the
//              drag-to-look fallback (the path that used to leave the mouse
//              completely dead when the browser refused the lock).
//   IFRAME   — the real-world failure environment: a page embedding the
//              game in an <iframe> without allow="pointer-lock". Chrome
//              silently ignores the lock request here (no error event, no
//              rejection) — exactly the "my mouse doesn't work" report.
//              The auto-fallback must detect that and make drag-look work.
//   TOUCH    — the PUBG/Free Fire layout: left move joystick, full right
//              drag-to-look zone, big E button (tap = interact, hold =
//              mine), and the aim-assist setting (on steers to target,
//              off doesn't).
//
// Skips (exit 0) when no Chromium/Chrome binary is available. Override with
// CHROME_PATH. Run: node test/browser-controls.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let require;
try { require = createRequire(import.meta.url); } catch { require = null; }

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try {
    const pw = require('playwright-core');
    for (const key of ['chromium', 'chromiumHeadlessShell']) {
      try {
        const exe = pw[key]?.executablePath?.();
        if (exe && fs.existsSync(exe)) return exe;
      } catch { /* not installed */ }
    }
  } catch { /* playwright-core not a dep here */ }
  return null;
}

const chrome = findChrome();
if (!chrome) {
  console.log('\n== BROWSER CONTROLS TEST ==');
  console.log('  – skipped (no Chromium/Chrome found; set CHROME_PATH to enable)');
  process.exit(0);
}

let playwright;
try { playwright = (await import('playwright-core')).default; }
catch {
  console.log('\n== BROWSER CONTROLS TEST ==');
  console.log('  – skipped (browser found but playwright-core is not installed)');
  process.exit(0);
}

import http from 'node:http';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png'
};
function startStaticServer(dir, port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(dir, path.normalize(p));
      if (!file.startsWith(dir)) { res.writeHead(403); res.end('forbidden'); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('nf ' + p); return; }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache'
        });
        res.end(data);
      });
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

let passed = 0, failed = 0;
const check = (name, ok, extra) => {
  if (ok) { passed++; console.log('  ✓', name); }
  else { failed++; console.error('  ✗', name, extra ? '— ' + extra : ''); }
};

const BASE_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--in-process-gpu', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'
];
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function launchBrowser() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await playwright.chromium.launch({ executablePath: chrome, headless: true, args: BASE_ARGS });
    } catch (e) {
      if (attempt === 3) throw e;
      console.log(`  … launch failed (attempt ${attempt}), retrying`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

/** Read the ship quaternion + a few state bits. */
const shipState = (pageOrFrame) => pageOrFrame.evaluate(() => {
  const g = window.__SOLAR_GAME;
  return {
    quat: g.shipState.quaternion.toArray(),
    speed: g.shipState.velocity.length(),
    locked: document.pointerLockElement === g.canvas,
    drag: g.controller.dragLookEnabled
  };
});
const quatChanged = (a, b) => {
  if (!a.quat || !b.quat) return false;
  let d = 0;
  for (let i = 0; i < 4; i++) d += (a.quat[i] - b.quat[i]) ** 2;
  return Math.sqrt(d) > 0.001;
};

async function bootAndLaunch(pageOrFrame, label, { tap = false } = {}) {
  try {
    await pageOrFrame.waitForFunction(() => window.__SOLAR_BOOTED === true, null, { timeout: 90000 });
  } catch {
    const err = await pageOrFrame.evaluate(() => {
      const b = document.getElementById('boot-error');
      return (b && !b.hidden) ? 'BOOT ERROR: ' + b.textContent.slice(0, 140) : 'never booted';
    });
    check(label + ': game boots', false, err);
    return false;
  }
  check(label + ': game boots', true);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { tap ? await pageOrFrame.tap('#mm-play', { timeout: 5000 }) : await pageOrFrame.click('#mm-play', { timeout: 5000 }); }
    catch { }
    await pageOrFrame.waitForTimeout(800);
    const inGame = await pageOrFrame.evaluate(() =>
      document.querySelector('.main-menu').classList.contains('hidden') &&
      !document.querySelector('.hud').classList.contains('hidden'));
    if (inGame) { check(label + ': LAUNCH starts the game', true); return true; }
  }
  check(label + ': LAUNCH starts the game', false, 'menu never hid after 3 attempts');
  return false;
}

async function ensureUnpaused(page) {
  for (let i = 0; i < 6; i++) {
    const shown = await page.evaluate(() => !document.querySelector('.pause-overlay').classList.contains('hidden'));
    if (!shown) return;
    try {
      await page.click('#pz-resume', { timeout: 3000 });
      await page.waitForTimeout(300);
    } catch { return; }
  }
}

// ============================ DESKTOP ============================
async function desktopSuite() {
  console.log('\n== DESKTOP: mouse look (pointer lock + drag fallback) ==');
  const server = await startStaticServer(root, 8101);
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    const threeRoot = path.join(root, 'node_modules/three');
    await page.route('**/cdn.jsdelivr.net/npm/three@*/**', (route) => {
      const sub = route.request().url().replace(/^https?:\/\/cdn\.jsdelivr\.net\/npm\/three@[^/]+\//, '');
      const file = path.join(threeRoot, sub);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) route.fulfill({ body: fs.readFileSync(file), contentType: 'text/javascript' });
      else route.fulfill({ status: 404, body: 'nf ' + sub });
    });
    await page.goto('http://127.0.0.1:8101/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!(await bootAndLaunch(page, 'desktop'))) return;

    // Click the canvas to request pointer lock (a real user gesture).
    await page.mouse.click(640, 400);
    await page.waitForFunction(() => {
      const g = window.__SOLAR_GAME;
      return document.pointerLockElement === g.canvas || g.controller.dragLookEnabled;
    }, { timeout: 4000 }).catch(() => {});
    // If the headless env does neither (and the click didn't hit the
    // canvas), ask through the game's own API — the no-gesture refusal is
    // itself one of the fallback triggers.
    let st = await shipState(page);
    if (!st.locked && !st.drag) {
      await page.evaluate(() => window.__SOLAR_GAME.controller.tryRequestPointerLock());
      await page.waitForTimeout(900);
      st = await shipState(page);
    }
    check('mouse: pointer lock engaged OR drag fallback armed', st.locked || st.drag,
      `locked=${st.locked} drag=${st.drag}`);

    // Perform a look and prove the ship actually rotates.
    const before = await shipState(page);
    if (st.locked) {
      await page.mouse.move(860, 480, { steps: 10 });
      await page.waitForTimeout(400);
    } else {
      await page.mouse.down();
      await page.mouse.move(860, 480, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(400);
    }
    let after = await shipState(page);
    if (!quatChanged(before, after)) {
      // Headless CDP delivers locked mouse moves as a canceling sawtooth
      // (net-zero movementX), which correctly nets to no rotation. A single
      // unambiguous synthetic event (movementX via defineProperty — the
      // constructor init is ignored by the browser) still proves the whole
      // locked-look pipeline: handler → frame delta → physics rotation.
      await page.evaluate(() => {
        const ev = new MouseEvent('mousemove', { bubbles: true });
        Object.defineProperty(ev, 'movementX', { get: () => 160 });
        Object.defineProperty(ev, 'movementY', { get: () => 0 });
        document.dispatchEvent(ev);
      });
      await page.waitForTimeout(400);
      after = await shipState(page);
    }
    check('mouse look rotates the ship (locked path)', quatChanged(before, after),
      st.locked ? `locked=${after.locked}` : 'drag path not expected here');

    if (st.drag) {
      const toast = await page.evaluate(() => {
        const t = [...document.querySelectorAll('.toast')].map(e => e.textContent).join(' ');
        return t.includes('Pointer lock is unavailable');
      });
      check('drag fallback shows one-time hint toast', toast);
    }

    // Keyboard regression: W must still thrust.
    await ensureUnpaused(page);
    const v0 = (await shipState(page)).speed;
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(800);
    await page.keyboard.up('KeyW');
    const v1 = (await shipState(page)).speed;
    check('keyboard W still thrusts the ship', v1 > v0 + 0.2, `v0=${v0.toFixed(3)} v1=${v1.toFixed(3)}`);

    check('no uncaught page errors (desktop)', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ').slice(0, 200));
  } finally {
    await browser.close();
    server.close();
  }
}

// ======================= IFRAME (real failure env) =======================
async function iframeSuite() {
  console.log('\n== IFRAME: silent pointer-lock refusal → drag fallback ==');
  const wrapDir = '/tmp/iframe-wrap';
  fs.rmSync(wrapDir, { recursive: true, force: true });
  fs.mkdirSync(wrapDir, { recursive: true });
  fs.writeFileSync(path.join(wrapDir, 'index.html'),
    '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#030614}</style>' +
    '<iframe id="f" src="/game/" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>');
  fs.symlinkSync(root, path.join(wrapDir, 'game'));

  const server = await startStaticServer(wrapDir, 8102);
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    const threeRoot = path.join(root, 'node_modules/three');
    await page.route('**/cdn.jsdelivr.net/npm/three@*/**', (route) => {
      const sub = route.request().url().replace(/^https?:\/\/cdn\.jsdelivr\.net\/npm\/three@[^/]+\//, '');
      const file = path.join(threeRoot, sub);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) route.fulfill({ body: fs.readFileSync(file), contentType: 'text/javascript' });
      else route.fulfill({ status: 404, body: 'nf ' + sub });
    });
    // Reproduce the exact failure mode of the environments where players'
    // mice go dead: the browser IGNORES the pointer-lock request with no
    // signal at all (no Promise, no pointerlockerror — observed in Chrome
    // embed/iframe contexts). The game's auto-fallback must catch this via
    // its "lock never engaged" timeout.
    await page.addInitScript(() => {
      Object.defineProperty(Element.prototype, 'requestPointerLock', {
        configurable: true, writable: true,
        value: function () { /* silent no-op — the environment refuses, silently */ }
      });
    });
    await page.goto('http://127.0.0.1:8102/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const frame = page.frames().find((f) => f !== page.mainFrame());
    if (!frame) { check('iframe: game frame present', false); return; }
    check('iframe: game frame present', true);
    if (!(await bootAndLaunch(frame, 'iframe'))) return;

    // Player clicks the canvas to "capture the mouse". In this environment
    // the browser silently ignores the lock request (no error, no
    // rejection) — the old code just… did nothing. The new auto-fallback
    // must arm drag-to-look within ~400ms.
    await page.mouse.click(640, 400);
    let armed = false;
    try {
      await frame.waitForFunction(() => window.__SOLAR_GAME.controller.dragLookEnabled, null, { timeout: 4000 });
      armed = true;
    } catch { }
    check('iframe: drag fallback auto-arms after refused lock', armed);

    // Drag-to-look: hold left button + move → the ship MUST rotate.
    const before = await shipState(frame);
    await page.mouse.down();
    await page.mouse.move(860, 470, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await shipState(frame);
    check('iframe: drag-to-look rotates the ship', quatChanged(before, after));

    const toast = await frame.evaluate(() => {
      const t = [...document.querySelectorAll('.toast')].map(e => e.textContent).join(' ');
      return t.includes('Pointer lock is unavailable');
    });
    check('iframe: one-time hint toast shown on first drag use', toast);

    check('no uncaught page errors (iframe)', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ').slice(0, 200));
  } finally {
    await browser.close();
    server.close();
  }
}

// ============================ TOUCH (PUBG/FFM) ============================
async function touchSuite() {
  console.log('\n== TOUCH: FFM/PUBG-style layout ==');
  const server = await startStaticServer(root, 8103);
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 414, height: 740 },
      hasTouch: true, isMobile: true, userAgent: IPHONE_UA
    });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    const threeRoot = path.join(root, 'node_modules/three');
    await page.route('**/cdn.jsdelivr.net/npm/three@*/**', (route) => {
      const sub = route.request().url().replace(/^https?:\/\/cdn\.jsdelivr\.net\/npm\/three@[^/]+\//, '');
      const file = path.join(threeRoot, sub);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) route.fulfill({ body: fs.readFileSync(file), contentType: 'text/javascript' });
      else route.fulfill({ status: 404, body: 'nf ' + sub });
    });
    await page.goto('http://127.0.0.1:8103/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!(await bootAndLaunch(page, 'touch', { tap: true }))) return;

    // Enable the touch overlay through the same path the Settings UI uses.
    const shown = await page.evaluate(() => {
      const g = window.__SOLAR_GAME;
      g.gs.state.settings.mobileControls = 'on';
      g._syncMobileControls();
      return !document.querySelector('.mobile-controls').classList.contains('hidden') &&
        !!document.querySelector('.mc-look-zone') &&
        !!document.querySelector('.mc-interact') &&
        !!document.querySelector('.mc-left');
    });
    check('touch: controls overlay shows (look zone, E button, move stick)', shown);

    // 1) Right-side drag-to-look (the FFM/PUBG aim area) must rotate the ship.
    await ensureUnpaused(page);
    const b1 = await shipState(page);
    await touch('touchStart', [{ x: 300, y: 400, id: 1 }]);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: 300 + i * 24, y: 400 + i * 10, id: 1 }]);
    await touch('touchEnd', []);
    await page.waitForTimeout(450);
    const a1 = await shipState(page);
    check('touch: drag-to-look zone rotates the ship', quatChanged(b1, a1));

    // 2) Left move joystick must thrust the ship (drag up = forward).
    await ensureUnpaused(page);
    const v0 = (await shipState(page)).speed;
    await touch('touchStart', [{ x: 66, y: 670, id: 2 }]);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: 66, y: 670 - i * 8, id: 2 }]);
    await page.waitForTimeout(1100); // hold the stick up
    await touch('touchEnd', []);
    await page.waitForTimeout(150);
    const v1 = (await shipState(page)).speed;
    check('touch: move joystick thrusts the ship', v1 > v0 + 0.2, `v0=${v0.toFixed(3)} v1=${v1.toFixed(3)}`);

    // 3) Big E button: tap = interact, hold = mine (interactHeld).
    await page.evaluate(() => {
      const g = window.__SOLAR_GAME;
      g.__eCalls = 0;
      g.doInteract = () => { g.__eCalls++; };
    });
    await touch('touchStart', [{ x: 362, y: 688, id: 3 }]);
    await page.waitForTimeout(80);
    await touch('touchEnd', []);
    await page.waitForTimeout(250);
    const taps = await page.evaluate(() => window.__SOLAR_GAME.__eCalls);
    check('touch: E button tap fires interact()', taps === 1, `calls=${taps}`);

    await touch('touchStart', [{ x: 362, y: 688, id: 4 }]);
    await page.waitForTimeout(450);
    const held = await page.evaluate(() => window.__SOLAR_GAME.controller.touch.interactHeld);
    await touch('touchEnd', []);
    await page.waitForTimeout(250);
    const afterHold = await page.evaluate(() => ({
      held: window.__SOLAR_GAME.controller.touch.interactHeld,
      calls: window.__SOLAR_GAME.__eCalls
    }));
    check('touch: E button hold = mine (interactHeld), no stray tap',
      held === true && afterHold.held === false && afterHold.calls === 1,
      `held=${held} calls=${afterHold.calls}`);

    // 4) Aim assist: on = steers the nose onto the target; off = hands off.
    const setAssist = (on) => page.evaluate((v) => {
      window.__SOLAR_GAME.gs.state.settings.aimAssist = v;
    }, on);
    const setupShip = (angle) => page.evaluate((ang) => {
      const g = window.__SOLAR_GAME;
      g.setTarget('sun');
      const V3 = g.shipState.position.constructor;
      const Q = g.shipState.quaternion.constructor;
      const pos = g.solar.sunPosition.clone().add(g.shipState.position.clone().normalize().multiplyScalar(300));
      g.shipState.position.copy(pos);
      g.shipState.velocity.set(0, 0, 0);
      const toSun = g.solar.sunPosition.clone().sub(pos).normalize();
      const qFace = new Q().setFromUnitVectors(new V3(0, 0, -1), toSun);
      const qOff = new Q().setFromAxisAngle(new V3(0, 1, 0), ang);
      g.shipState.quaternion.copy(qFace).multiply(qOff).normalize();
    }, angle);
    const noseAngle = () => page.evaluate(() => {
      const g = window.__SOLAR_GAME;
      const V3 = g.shipState.position.constructor;
      const fwd = new V3(0, 0, -1).applyQuaternion(g.shipState.quaternion);
      const dir = g.solar.sunPosition.clone().sub(g.shipState.position).normalize();
      return fwd.angleTo(dir);
    });

    await setAssist(true);
    await ensureUnpaused(page);
    await setupShip(0.5); // 28.6° off-axis — inside the ~35° assist cone
    let engaging = false;
    for (let i = 0; i < 25 && !engaging; i++) {
      await page.waitForTimeout(80);
      engaging = await page.evaluate(() => window.__SOLAR_GAME.aimAssistActive === true);
    }
    await page.waitForTimeout(1500);
    const angleOn = await noseAngle();
    check('aim assist ON steers the nose onto the target', engaging && angleOn < 0.05,
      `engaging=${engaging} angle=${angleOn.toFixed(4)}`);

    await setAssist(false);
    await ensureUnpaused(page);
    await setupShip(0.5);
    await page.waitForTimeout(2500);
    const angleOff = await noseAngle();
    check('aim assist OFF leaves the ship untouched', Math.abs(angleOff - 0.5) < 0.02,
      `angle=${angleOff.toFixed(4)}`);

    check('no uncaught page errors (touch)', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ').slice(0, 200));
  } finally {
    await browser.close();
    server.close();
  }
}

console.log('\n== BROWSER CONTROLS TEST (chromium:', chrome, ') ==');
for (const suite of [desktopSuite, iframeSuite, touchSuite]) {
  try {
    await suite();
  } catch (e) {
    check(suite.name + ' — completed without crash', false, String(e).split('\n')[0].slice(0, 200));
  }
}
console.log('\n=====================================');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
