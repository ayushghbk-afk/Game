// Static-host smoke test — verifies the game can boot from the repo root
// with NO bundler: the mode GitHub Pages uses when configured with
// "Deploy from a branch" (it publishes the raw repo: index.html + src/).
//
// In that mode the browser must:
//   1. resolve bare `three` / `three/addons/...` imports via the import map
//      in index.html (CDN, version-pinned to package.json),
//   2. load the stylesheet through a plain <link> (a `.css` module import
//      is rejected by the MIME check),
//   3. run the whole module graph (40+ game files) and reach the WebGL2
//      check — anything earlier means the boot overlay would show
//      "A required game file could not be loaded".
//
// Run: node test/static-host.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mainSrc = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const threeVersion = lock.packages['node_modules/three'].version;

let passed = 0, failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✓', name);
  } catch (e) {
    failed++;
    console.error('  ✗', name, '—', e.message);
    if (process.env.VERBOSE) console.error(e.stack);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// ---------- static analysis of the non-bundled boot path ----------
console.log('\n== STATIC-HOST BOOT PATH (GitHub Pages "deploy from branch") ==');

await check('index.html has an import map for three, pinned to the locked version', () => {
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert(m, 'no import map in index.html');
  const map = JSON.parse(m[1]);
  assert(map.imports?.three, 'three mapping missing');
  assert(map.imports['three/addons/'], 'three/addons/ prefix mapping missing');
  assert(map.imports.three.includes(`three@${threeVersion}`), `three mapping not pinned to ${threeVersion}: ${map.imports.three}`);
  assert(map.imports['three/addons/'].includes(`three@${threeVersion}`), `addons mapping not pinned to ${threeVersion}`);
  assert(map.imports.three.endsWith('/three.module.js'), 'three must map to build/three.module.js');
  assert(map.imports['three/addons/'].endsWith('/'), 'addons mapping must be a prefix (trailing slash)');
  // the map must be registered before the first module script runs
  const mapPos = html.indexOf('type="importmap"');
  const modPos = html.indexOf('type="module"');
  assert(mapPos > -1 && modPos > -1 && mapPos < modPos, 'import map must precede the module script');
});

await check('every bare import in src/ is covered by the import map', () => {
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  const specs = new Set();
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      const s = fs.statSync(p);
      if (s.isDirectory()) walk(p);
      else if (f.endsWith('.js')) {
        const re = /from\s+['"]([^'"]+)['"]/g;
        let m;
        while ((m = re.exec(fs.readFileSync(p, 'utf8')))) if (!m[1].startsWith('.')) specs.add(m[1]);
      }
    }
  })(path.join(root, 'src'));
  assert(specs.size > 0, 'no bare imports found — check the scan regex');
  for (const s of specs) {
    const hit = Object.keys(map).find(k => (k.endsWith('/') ? s.startsWith(k) : s === k));
    assert(hit, `bare import "${s}" not covered by the import map`);
  }
});

await check('all relative imports in src/ resolve on disk', () => {
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      const s = fs.statSync(p);
      if (s.isDirectory()) walk(p);
      else if (f.endsWith('.js')) {
        const re = /from\s+['"](\.[^'"]+)['"]/g;
        let m;
        while ((m = re.exec(fs.readFileSync(p, 'utf8')))) {
          const t = path.resolve(path.dirname(p), m[1]);
          assert(fs.existsSync(t), `missing ${m[1]} imported by ${path.relative(root, p)}`);
        }
      }
    }
  })(path.join(root, 'src'));
});

await check('entry module exists and is referenced by index.html', () => {
  assert(fs.existsSync(path.join(root, 'src/main.js')), 'src/main.js missing');
  assert(/<script type="module"[^>]+src="\.\/src\/main\.js"/.test(html), 'index.html must load ./src/main.js');
});

await check('CSS is loaded via <link>, not a module import', () => {
  const linkOk = /<link[^>]*rel="stylesheet"[^>]*href="\.\/src\/style\.css"/.test(html) ||
                 /<link[^>]*href="\.\/src\/style\.css"[^>]*rel="stylesheet"/.test(html);
  assert(linkOk, 'no <link rel="stylesheet" href="./src/style.css"> in index.html');
  assert(!/^\s*import\s+['"]\.\/style\.css['"]\s*;?/m.test(mainSrc), 'main.js must not statically import CSS (breaks plain static hosts)');
});

// ---------- runtime: actually execute the module graph without Vite ----------
// Node stands in for a plain static host: no import-map machinery (we
// assert it separately above), bare 'three' resolves from node_modules,
// import.meta.env is undefined, and the DOM stubs mimic the page.
const noop = () => {};
const bodyEls = [];
const headEls = [];
globalThis.window = globalThis;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.document = {
  getElementById: () => null,
  querySelector: () => null,
  createElement: (tag) => {
    if (tag === 'canvas') {
      // no webgl2 → main.js must show the friendly WebGL2 message,
      // which proves the entire module graph loaded and ran.
      return { width: 0, height: 0, getContext: () => null, style: {}, addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
    }
    return { tagName: String(tag).toUpperCase(), className: '', innerHTML: '', style: {}, children: [], appendChild: noop, addEventListener: noop, classList: { add: noop, remove: noop, toggle: noop } };
  },
  body: { appendChild: (el) => bodyEls.push(el) },
  head: { appendChild: (el) => headEls.push(el) },
  addEventListener: noop,
  removeEventListener: noop,
  pointerLockElement: null,
  hidden: false,
};
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', maxTouchPoints: 0, hardwareConcurrency: 8 }, configurable: true });
globalThis.matchMedia = () => ({ matches: false });
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);

await check('module graph executes: main.js boots all the way to the WebGL2 check', async () => {
  await import('../src/main.js');
  // start() runs synchronously up to the WebGL2 check; the fatal-error
  // panel (not the "required game file" overlay) must be in the DOM.
  const fatal = bodyEls.find(el => el.className === 'fatal-error');
  assert(fatal, 'no fatal-error panel — boot did not reach start()');
  assert(fatal.innerHTML.includes('WEBGL2 UNAVAILABLE'), `expected WebGL2 message, got: ${fatal.innerHTML.slice(0, 80)}`);
});

console.log(`\n=====================================`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
