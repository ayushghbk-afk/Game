// End-to-end click test — boots the REAL game in a real headless Chromium
// (WebGL2 via SwiftShader) and clicks the buttons the players complain
// about. This is the regression guard for "buttons don't work on GitHub
// Pages": an invisible full-screen layer, or a modal that ESC cannot close,
// shows up here as a Playwright actionability timeout.
//
// Two deployment modes are covered:
//   raw   — the repo root served as-is (GitHub Pages "Deploy from a branch";
//           `three` resolves through the import map — here we route the
//           jsDelivr URL to the local node_modules copy so the test also
//           works offline);
//   built — `vite build` output served from dist/ (the Actions workflow
//           deploy; built on the fly when dist/ is missing).
//
// Skips (exit 0) when no Chromium/Chrome binary is available, so `npm test`
// stays green in minimal environments. Override with CHROME_PATH.
//
// Run: node test/browser-clicks.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

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
  console.log('\n== BROWSER CLICK TEST ==');
  console.log('  – skipped (no Chromium/Chrome found; set CHROME_PATH to enable)');
  process.exit(0);
}

let playwright;
try { playwright = (await import('playwright-core')).default; }
catch {
  console.log('\n== BROWSER CLICK TEST ==');
  console.log('  – skipped (browser found but playwright-core is not installed)');
  process.exit(0);
}

// ---------- minimal static server (mimics GitHub Pages) ----------
import http from 'node:http';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff': 'font/woff', '.woff2': 'font/woff2'
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

async function runSuite(label, dir, port, routeThree, touch) {
  console.log(`\n== ${label} ==`);
  const server = await startStaticServer(dir, port);
  let browser;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      browser = await playwright.chromium.launch({ executablePath: chrome, headless: true, args: BASE_ARGS });
      break;
    } catch (e) {
      if (attempt === 3) throw e;
      console.log(`  … launch failed (attempt ${attempt}), retrying`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: !!touch, isMobile: !!touch });
    const page = await ctx.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    if (routeThree) {
      const threeRoot = path.join(root, 'node_modules/three');
      await page.route('**/cdn.jsdelivr.net/npm/three@*/**', (route) => {
        const sub = route.request().url().replace(/^https?:\/\/cdn\.jsdelivr\.net\/npm\/three@[^/]+\//, '');
        const file = path.join(threeRoot, sub);
        if (fs.existsSync(file) && fs.statSync(file).isFile()) route.fulfill({ body: fs.readFileSync(file), contentType: 'text/javascript' });
        else route.fulfill({ status: 404, body: 'nf ' + sub });
      });
    }

    // Headless Chrome sometimes drops pointer lock on its own; the game then
    // (correctly, as it would for a real user) auto-pauses. Re-resume so the
    // in-flight checks test the game, not the lock.
    const ensureUnpaused = async () => {
      for (let i = 0; i < 6; i++) {
        const shown = await page.evaluate(() => !document.querySelector('.pause-overlay').classList.contains('hidden'));
        if (!shown) return;
        try {
          await page.click('#pz-resume', { timeout: 3000 });
          await page.waitForTimeout(300);
        } catch { return; }
      }
    };

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    let booted = true;
    try {
      // The main menu is in the DOM from the start (covered by the loading
      // screen during boot), so the real "booted" condition is the loader
      // being gone — otherwise clicks land on the full-screen loader.
      await page.waitForSelector('.main-menu #mm-play', { timeout: 60000 });
      await page.waitForFunction(() => !document.querySelector('#app > .loading-screen'), { timeout: 60000 });
    } catch {
      booted = false;
      const err = await page.evaluate(() => {
        const b = document.getElementById('boot-error');
        const ls = document.querySelector('#app > .loading-screen');
        return (b && !b.hidden) ? 'BOOT ERROR overlay: ' + b.textContent.slice(0, 160)
          : ls ? 'still on loading screen (' + ls.textContent.slice(0, 60).replace(/\s+/g, ' ') + ')'
          : 'menu never appeared';
      });
      check('game boots to main menu', false, err);
    }
    if (!booted) return;
    check('game boots to main menu', true);

    // ---- main menu buttons (the reported bug) ----
    const menuModalCases = [
      ['#mm-missions', 'missions-modal', 'MISSIONS'],
      ['#mm-ship', 'ship-modal', 'SHIP'],
      ['#mm-settings', 'settings-modal', 'SETTINGS'],
      ['#mm-help', 'help-modal', 'HELP']
    ];
    for (const [btn, modal, name] of menuModalCases) {
      try {
        await page.click(btn, { timeout: 5000 });
        await page.waitForSelector(`#${modal}:not(.hidden)`, { timeout: 4000 });
        // ESC MUST close it — if it cannot, the full-screen modal wedges open
        // and every other button underneath is dead.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const closed = await page.evaluate((id) => document.getElementById(id).classList.contains('hidden'), modal);
        check(`${name} button opens modal; ESC closes it`, closed);
      } catch (e) {
        check(`${name} button opens modal; ESC closes it`, false, String(e).split('\n')[0].slice(0, 140));
      }
    }

    // NEW GAME confirm dialog: open → ESC → closes
    try {
      await page.click('#mm-new', { timeout: 5000 });
      await page.waitForSelector('#confirm-modal:not(.hidden)', { timeout: 4000 });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const closed = await page.evaluate(() => document.getElementById('confirm-modal').classList.contains('hidden'));
      check('NEW GAME confirm opens; ESC closes it', closed);
    } catch (e) {
      check('NEW GAME confirm opens; ESC closes it', false, String(e).split('\n')[0].slice(0, 140));
    }

    // ---- LAUNCH / CONTINUE ----
    let inGame = false;
    try {
      const clicker = touch ? page.tap('#mm-play') : page.click('#mm-play');
      await clicker.then((c) => c).catch(() => {});
      await page.waitForTimeout(600);
      inGame = await page.evaluate(() =>
        document.querySelector('.main-menu').classList.contains('hidden') &&
        !document.querySelector('.hud').classList.contains('hidden'));
      check('LAUNCH button starts the game (menu hides, HUD shows)', inGame,
        touch ? 'touch tap' : '');
    } catch (e) {
      check('LAUNCH button starts the game (menu hides, HUD shows)', false, String(e).split('\n')[0].slice(0, 140));
    }
    if (!inGame) return;

    if (!touch) {
      // ---- in-game: ESC pause + RESUME, then back to menu ----
      try {
        await page.keyboard.press('Escape');
        await page.waitForSelector('.pause-overlay:not(.hidden)', { timeout: 4000 });
        await page.click('#pz-resume', { timeout: 5000 });
        await page.waitForTimeout(300);
        const resumed = await page.evaluate(() => document.querySelector('.pause-overlay').classList.contains('hidden'));
        check('ESC opens pause; RESUME button closes it', resumed);
      } catch (e) {
        check('ESC opens pause; RESUME button closes it', false, String(e).split('\n')[0].slice(0, 140));
      }
      // ESC again must UNPAUSE — the regression for gated keyboard input:
      // while paused, controller.enabled is false and ESC used to be
      // swallowed, leaving the player stuck on the pause overlay.
      try {
        await ensureUnpaused();
        await page.waitForTimeout(250);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.pause-overlay:not(.hidden)', { timeout: 4000 });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const unpaused = await page.evaluate(() => document.querySelector('.pause-overlay').classList.contains('hidden'));
        check('ESC while paused unpauses the game', unpaused);
      } catch (e) {
        check('ESC while paused unpauses the game', false, String(e).split('\n')[0].slice(0, 140));
      }
      // map: M opens it, ESC closes it (ESC is the master close key;
      // movement/UI keys are deliberately gated while a panel is open)
      try {
        await ensureUnpaused();
        await page.waitForTimeout(250); // let the frame loop settle
        await page.keyboard.press('KeyM');
        await page.waitForSelector('.map-view:not(.hidden)', { timeout: 4000 });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const closed = await page.evaluate(() => document.querySelector('.map-view').classList.contains('hidden'));
        check('M opens map; ESC closes it', closed);
      } catch (e) {
        check('M opens map; ESC closes it', false, String(e).split('\n')[0].slice(0, 140));
      }
      // in-game MISSIONS (HUD/keyboard path sets modalOpen directly)
      try {
        await ensureUnpaused();
        await page.waitForTimeout(250); // let the frame loop settle
        await page.keyboard.press('KeyJ');
        await page.waitForSelector('#missions-modal:not(.hidden)', { timeout: 4000 });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const closed = await page.evaluate(() => document.getElementById('missions-modal').classList.contains('hidden'));
        check('J opens MISSIONS in flight; ESC closes it', closed);
      } catch (e) {
        check('J opens MISSIONS in flight; ESC closes it', false, String(e).split('\n')[0].slice(0, 140));
      }
    }

    check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ').slice(0, 200));
    // CDN import-map mode can log benign warnings; only hard module failures matter.
    const hard = consoleErrors.filter((e) => /Failed to (resolve|fetch|load)|import map/i.test(e));
    check('no module-load console errors', hard.length === 0, hard.slice(0, 2).join(' | ').slice(0, 200));
  } finally {
    await browser.close();
    server.close();
  }
}

console.log('\n== BROWSER CLICK TEST (chromium:', chrome, ') ==');
const modes = [];
modes.push(['RAW REPO (GitHub Pages "deploy from branch")', root, 8091, true, false]);
// built mode: build on demand (skipped when vite is unavailable)
try {
  if (!fs.existsSync(path.join(root, 'dist/index.html'))) {
    execSync('npx vite build', { cwd: root, stdio: 'pipe', timeout: 180000 });
  }
  if (fs.existsSync(path.join(root, 'dist/index.html'))) {
    modes.push(['BUILT DIST (Actions workflow deploy)', path.join(root, 'dist'), 8092, false, false]);
  }
} catch (e) {
  console.log('  – built mode skipped (vite build failed:', String(e.message || e).split('\n')[0].slice(0, 80), ')');
}
// touch simulation of a phone player (raw mode only)
modes.push(['RAW REPO, TOUCH (phone emulation)', root, 8093, true, true]);

for (const [label, dir, port, routeThree, touch] of modes) {
  try {
    await runSuite(label, dir, port, routeThree, touch);
  } catch (e) {
    check(label + ' — suite completed without crash', false, String(e).slice(0, 200));
  }
}

console.log('\n=====================================');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
