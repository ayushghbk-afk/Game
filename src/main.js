// Solar Odyssey — entry point. Checks WebGL, shows friendly errors,
// boots the Game, and keeps global failures from hard-crashing silently.
import './style.css';
import { Game } from './game/Game.js';

function fatalError(title, msg) {
  const d = document.createElement('div');
  d.className = 'fatal-error';
  d.innerHTML = `<div class="fe-box"><h1>${title}</h1><p>${msg}</p></div>`;
  document.body.appendChild(d);
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
});

async function start() {
  if (!webglAvailable()) {
    fatalError('WEBGL UNAVAILABLE', 'Your browser cannot run WebGL, which this game requires. Try updating your browser or enabling hardware acceleration.');
    return;
  }
  const canvas = document.getElementById('game-canvas');
  const root = document.getElementById('app');
  try {
    const game = new Game(canvas, root);
    await game.boot();
  } catch (e) {
    console.error(e);
    fatalError('LAUNCH FAILURE', 'Something went wrong while starting the game. Please refresh the page. (' + (e?.message || e) + ')');
  }
}

start();
