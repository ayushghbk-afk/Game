// Solar Odyssey — entry point. Checks WebGL, shows friendly errors,
// boots the Game, and keeps global failures from hard-crashing silently.
// (Stylesheet is loaded via <link> in index.html: Vite bundles it into the
// production build, and a plain <link> is what a static host needs —
// `import './style.css'` would be rejected as a non-JS MIME type.)
import { Game } from './game/Game.js';

function hideBootError() {
  document.getElementById('boot-error')?.remove();
}

function fatalError(title, msg) {
  hideBootError();
  // Don't duplicate error panels.
  if (document.querySelector('.fatal-error')) return;
  const d = document.createElement('div');
  d.className = 'fatal-error';
  d.innerHTML = `<div class="fe-box"><h1>${title}</h1><p>${msg}</p></div>`;
  document.body.appendChild(d);
}

function webglAvailable() {
  // Three.js r180+ (this project's renderer) requires WebGL 2 — simply
  // having WebGL 1 is not enough and would create a blank/broken canvas.
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch { return false; }
}

window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
  if (!window.__SOLAR_BOOTED) window.__solarBootError?.((e?.message) || 'The game failed to start. Refresh the page to try again.');
});

async function start() {
  if (!webglAvailable()) {
    fatalError('WEBGL2 UNAVAILABLE', 'Solar Odyssey needs WebGL 2. Try updating your browser, enabling hardware acceleration, or using a recent Chrome / Edge / Firefox / Safari.');
    return;
  }
  const canvas = document.getElementById('game-canvas');
  const root = document.getElementById('app');
  try {
    const game = new Game(canvas, root);
    await game.boot();
    window.__SOLAR_BOOTED = true;
    hideBootError();
  } catch (e) {
    console.error(e);
    fatalError('LAUNCH FAILURE', 'Something went wrong while starting the game. Please refresh the page. (' + (e?.message || e) + ')');
  }
}

start();
