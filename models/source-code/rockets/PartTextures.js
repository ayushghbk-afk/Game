// PartTextures — procedural canvas textures for every rocket part.
//
// Rockets used to be flat-coloured primitives. This module paints each part
// family with a small 256×256 canvas texture (panel seams, rivets, tank
// stripes, engine heat discoloration, solar-cell grids, ablator tiles…) and
// caches one THREE.CanvasTexture per family so a hundred-part rocket reuses a
// dozen textures. Textures are mostly NEUTRAL (near-white with darker detail)
// so `part.color` still tints them — except the families listed in TINTLESS,
// which carry their own colours and get a white material.
//
// Everything is drawn with only the canvas primitives that our headless test
// stubs implement (fillRect / moveTo / lineTo / arc / gradients), and every
// painter is wrapped in try/catch: the game must still fly if a browser
// refuses canvas 2D.
import * as THREE from 'three';

const SIZE = 256;
const cache = new Map();

/** Families whose texture is full-colour — material colour must stay white. */
export const TINTLESS = new Set(['engine', 'solar', 'ablator', 'probe', 'battery', 'optics', 'hazard', 'dish']);

/** Pick the texture family for a part (explicit `tex` field wins). */
export function texFamily(part) {
  if (part?.tex) return part.tex;
  switch (part?.cat) {
    case 'command': return part?.shape === 'cylinder' ? 'probe' : 'capsule';
    case 'fuel': return 'tank';
    case 'engine': return 'engine';
    case 'booster': return 'solid';
    case 'structure': return part?.shape === 'cone' ? 'fairing' : 'girder';
    case 'payload': return 'hull';
    case 'utility': return 'hull';
    default: return 'hull';
  }
}

function mkCanvas() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const c = document.createElement('canvas');
  c.width = SIZE; c.height = SIZE;
  return c;
}

const line = (ctx, x0, y0, x1, y1) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
const dot = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
const rectStroke = (ctx, x, y, w, h) => {
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h);
  ctx.closePath(); ctx.stroke();
};

// ---------------------------------------------------------------- painters
const painters = {
  // Bare spacecraft bus: panels + rivets.
  hull(ctx) {
    ctx.fillStyle = 'rgba(120,128,140,0.16)';
    for (let x = 0; x <= SIZE; x += 64) ctx.fillRect(x, 0, 2, SIZE);
    for (let y = 0; y <= SIZE; y += 128) ctx.fillRect(0, y, SIZE, 2);
    ctx.fillStyle = 'rgba(90,98,110,0.35)';
    for (let x = 16; x < SIZE; x += 32) for (let y = 12; y < SIZE; y += 32) dot(ctx, x, y, 1.6);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (let x = 32; x < SIZE; x += 64) ctx.fillRect(x, 0, 10, SIZE);   // brushed highlight
  },

  // Crew capsule: windows + trim.
  capsule(ctx) {
    painters.hull(ctx);
    ctx.fillStyle = 'rgba(20,30,40,0.85)';
    for (let i = 0; i < 3; i++) dot(ctx, 64 + i * 64, 96, 12);        // portholes
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 3; i++) dot(ctx, 60 + i * 64, 92, 3);         // glint
    ctx.fillStyle = 'rgba(190,60,40,0.75)';
    ctx.fillRect(0, 150, SIZE, 10);                                    // trim stripe
    ctx.fillStyle = 'rgba(60,70,80,0.6)';
    ctx.fillRect(0, 226, SIZE, 8);
  },

  // Inline cockpit: big window band.
  cockpit(ctx) {
    painters.hull(ctx);
    ctx.fillStyle = 'rgba(16,28,40,0.9)';
    ctx.fillRect(0, 70, SIZE, 60);
    ctx.fillStyle = 'rgba(120,200,255,0.35)';
    ctx.fillRect(0, 74, SIZE, 16);
    ctx.strokeStyle = 'rgba(220,230,240,0.8)';
    for (let x = 0; x <= SIZE; x += 64) line(ctx, x, 70, x, 130);
  },

  // Gold-foil probe core.
  probe(ctx) {
    for (let y = 0; y < SIZE; y += 16) {
      for (let x = 0; x < SIZE; x += 16) {
        const k = ((x * 7 + y * 13) % 5) / 5;
        ctx.fillStyle = `rgba(${200 + k * 55 | 0},${150 + k * 60 | 0},${40 + k * 30 | 0},1)`;
        ctx.fillRect(x, y, 16, 16);
      }
    }
    ctx.strokeStyle = 'rgba(120,80,10,0.6)';
    for (let d = -SIZE; d < SIZE; d += 24) line(ctx, d, 0, d + SIZE, SIZE);
    ctx.fillStyle = 'rgba(70,76,88,1)';
    ctx.fillRect(0, 0, SIZE, 14); ctx.fillRect(0, SIZE - 14, SIZE, 14);
  },

  // Workhorse propellant tank: brushed metal, rivet rings, stencil band.
  tank(ctx) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let y = 0; y < SIZE; y += 4) ctx.fillRect(0, y, SIZE, 1 + (y % 8 === 0 ? 1 : 0));
    ctx.fillStyle = 'rgba(80,90,104,0.5)';
    for (let x = 8; x < SIZE; x += 16) { dot(ctx, x, 20, 1.8); dot(ctx, x, SIZE - 20, 1.8); }
    ctx.strokeStyle = 'rgba(70,80,92,0.55)';
    line(ctx, 0, 34, SIZE, 34); line(ctx, 0, SIZE - 34, SIZE, SIZE - 34);
    ctx.fillStyle = 'rgba(40,50,64,0.30)';
    ctx.fillRect(0, 104, SIZE, 52);                                    // stencil band
    ctx.fillStyle = 'rgba(240,244,250,0.85)';
    ctx.font = 'bold 26px monospace'; ctx.textAlign = 'center';
    ctx.fillText('LOX · LH2', SIZE / 2, 138);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(24, 0, 22, SIZE);                                     // sun highlight
  },

  // Insulated cryo tank: frosty with heavy seams.
  cryo(ctx) {
    painters.tank(ctx);
    ctx.fillStyle = 'rgba(160,210,255,0.22)';
    for (let i = 0; i < 40; i++) {
      const x = (i * 53) % SIZE, y = (i * 97) % SIZE;
      dot(ctx, x, y, 6 + (i % 4) * 3);
    }
    ctx.strokeStyle = 'rgba(90,130,170,0.6)';
    for (let y = 48; y < SIZE; y += 48) line(ctx, 0, y, SIZE, y);
  },

  // Radial (surface-attach) tank: rounded silhouette shading.
  radial(ctx) {
    painters.tank(ctx);
    const g = ctx.createLinearGradient(0, 0, SIZE, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
  },

  // Engine bell: dark steel + heat discoloration.
  engine(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, SIZE);
    g.addColorStop(0, '#3a4048'); g.addColorStop(0.55, '#23262c'); g.addColorStop(1, '#101216');
    ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = 'rgba(140,150,160,0.35)';
    for (let x = 0; x <= SIZE; x += 22) line(ctx, x, 0, x, SIZE);      // regen tubes
    const heat = ctx.createLinearGradient(0, SIZE * 0.5, 0, SIZE);
    heat.addColorStop(0, 'rgba(90,60,140,0)');
    heat.addColorStop(0.5, 'rgba(160,110,60,0.45)');
    heat.addColorStop(1, 'rgba(220,180,90,0.55)');
    ctx.fillStyle = heat; ctx.fillRect(0, SIZE * 0.5, SIZE, SIZE * 0.5);
    ctx.fillStyle = 'rgba(20,22,26,1)';
    ctx.fillRect(0, 0, SIZE, 26);                                      // mounting ring
    ctx.fillStyle = 'rgba(150,160,170,0.5)';
    for (let x = 10; x < SIZE; x += 20) dot(ctx, x, 13, 2.4);          // bolts
  },

  // Solid rocket booster: white segments + hazard tip.
  solid(ctx) {
    ctx.fillStyle = 'rgba(120,128,140,0.25)';
    for (let y = 42; y < SIZE; y += 42) ctx.fillRect(0, y, SIZE, 3);   // segment seams
    ctx.fillStyle = 'rgba(90,98,110,0.4)';
    for (let x = 12; x < SIZE; x += 24) for (let y = 20; y < SIZE; y += 42) dot(ctx, x, y, 1.5);
    // hazard tip
    for (let x = -32; x < SIZE + 32; x += 32) {
      ctx.fillStyle = '#e6b23a';
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 16, 0); ctx.lineTo(x - 10, 30); ctx.lineTo(x - 26, 30); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#20242a';
      ctx.beginPath(); ctx.moveTo(x + 16, 0); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 6, 30); ctx.lineTo(x - 10, 30); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(30,34,40,0.8)';
    ctx.fillRect(0, SIZE - 12, SIZE, 12);
  },

  // Decoupler: full-bleed hazard chevrons.
  hazard(ctx) {
    ctx.fillStyle = '#e8b83c'; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#23262b';
    for (let x = -SIZE; x < SIZE * 2; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, SIZE); ctx.lineTo(x + 32, SIZE); ctx.lineTo(x + SIZE + 32, 0); ctx.lineTo(x + SIZE, 0); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, SIZE, 10); ctx.fillRect(0, SIZE - 10, SIZE, 10);
  },

  // Payload fairing: smooth, few panel lines, warning edge.
  fairing(ctx) {
    ctx.fillStyle = 'rgba(110,120,134,0.14)';
    for (let x = 64; x < SIZE; x += 64) ctx.fillRect(x, 0, 2, SIZE);
    ctx.strokeStyle = 'rgba(100,110,124,0.4)';
    line(ctx, 0, SIZE * 0.4, SIZE, SIZE * 0.4);
    ctx.fillStyle = 'rgba(200,60,40,0.7)';
    ctx.fillRect(0, SIZE - 26, SIZE, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(30, 0, 30, SIZE);
  },

  // Solar array: dark cells, silver frame.
  solar(ctx) {
    ctx.fillStyle = '#14294a'; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#1d3a66';
    for (let y = 8; y < SIZE; y += 32) for (let x = 8; x < SIZE; x += 32) ctx.fillRect(x, y, 26, 26);
    ctx.strokeStyle = '#9fb2c8';
    for (let v = 0; v <= SIZE; v += 32) { line(ctx, v, 0, v, SIZE); line(ctx, 0, v, SIZE, v); }
    ctx.strokeStyle = '#d8e2ee';
    rectStroke(ctx, 2, 2, SIZE - 4, SIZE - 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    line(ctx, 0, 0, SIZE, SIZE);                                       // glint
  },

  // Heat shield: ablative tiles.
  ablator(ctx) {
    ctx.fillStyle = '#4a382c'; ctx.fillRect(0, 0, SIZE, SIZE);
    for (let row = 0; row < 8; row++) {
      const off = (row % 2) * 16;
      for (let x = -16; x < SIZE + 16; x += 32) {
        const shade = 66 + ((x * 3 + row * 37) % 26);
        ctx.fillStyle = `rgb(${shade + 10},${(shade * 0.72) | 0},${(shade * 0.55) | 0})`;
        ctx.fillRect(x + off + 2, row * 32 + 2, 28, 28);
      }
    }
  },

  // Battery bank: dark chassis + charge bars.
  battery(ctx) {
    ctx.fillStyle = '#2b3038'; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = '#3a414c';
    for (let x = 16; x < SIZE; x += 48) ctx.fillRect(x, 16, 32, SIZE - 32);
    ctx.fillStyle = '#57d977';
    ctx.fillRect(40, 108, 40, 40); ctx.fillRect(104, 108, 40, 40); ctx.fillRect(168, 108, 40, 40);
    ctx.fillStyle = '#20242a';
    ctx.fillRect(0, 0, SIZE, 10); ctx.fillRect(0, SIZE - 10, SIZE, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center';
    ctx.fillText('Z-4K', SIZE / 2, 72);
  },

  // Structure: girder lattice.
  girder(ctx) {
    ctx.fillStyle = 'rgba(96,104,118,0.25)'; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = 'rgba(60,68,80,0.8)';
    for (let x = -SIZE; x < SIZE; x += 42) { line(ctx, x, 0, x + SIZE, SIZE); line(ctx, x + SIZE, 0, x, SIZE); }
    ctx.strokeStyle = 'rgba(40,46,56,0.9)';
    rectStroke(ctx, 3, 3, SIZE - 6, SIZE - 6);
    ctx.fillStyle = 'rgba(30,36,44,0.8)';
    for (let x = 20; x < SIZE; x += 42) { dot(ctx, x, 10, 2.6); dot(ctx, x, SIZE - 10, 2.6); }
  },

  // Docking port face: bolt circle + guide cross.
  dock(ctx) {
    painters.hull(ctx);
    ctx.strokeStyle = 'rgba(50,58,70,0.9)';
    ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, 86, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, 48, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(40,48,58,1)';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      dot(ctx, SIZE / 2 + Math.cos(a) * 66, SIZE / 2 + Math.sin(a) * 66, 5);
    }
    ctx.fillStyle = 'rgba(120,220,140,0.9)';
    dot(ctx, SIZE / 2, SIZE / 2, 7);
  },

  // High-gain dish: white with concentric ribs.
  dish(ctx) {
    ctx.fillStyle = '#e8ecf2'; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = 'rgba(120,130,144,0.7)';
    for (let r = 24; r <= 140; r += 24) { ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = '#39424e';
    dot(ctx, SIZE / 2, SIZE / 2, 12);
  },

  // Space telescope: black baffle + gold rim.
  optics(ctx) {
    ctx.fillStyle = '#14161a'; ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = 'rgba(220,180,70,0.9)';
    for (let y = 20; y < SIZE; y += 40) line(ctx, 0, y, SIZE, y);
    ctx.fillStyle = '#05060a';
    ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, 90, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(90,120,180,0.5)';
    ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, 70, 0, Math.PI * 2); ctx.stroke();
  },

  // Aero surfaces: subtle chevrons.
  fins(ctx) {
    painters.hull(ctx);
    ctx.strokeStyle = 'rgba(170,80,50,0.75)';
    for (let x = 0; x < SIZE; x += 48) {
      line(ctx, x, SIZE, x + 24, SIZE - 40);
      line(ctx, x + 24, SIZE - 40, x + 48, SIZE);
    }
  }
};

/**
 * Get (and cache) the texture for a part.
 * @returns {{ map: THREE.CanvasTexture|null, tint: boolean }}
 *   tint=false → the material colour must be white (texture is full-colour).
 */
export function partTexture(part) {
  const family = texFamily(part);
  if (cache.has(family)) return cache.get(family);

  let map = null;
  const canvas = mkCanvas();
  if (canvas) {
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (ctx) {
      try {
        ctx.fillStyle = '#f2f4f8';
        ctx.fillRect(0, 0, SIZE, SIZE);
        (painters[family] || painters.hull)(ctx);
      } catch (e) { console.warn('part texture failed:', family, e); }
    }
    map = new THREE.CanvasTexture(canvas);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    if ('colorSpace' in map) map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
  }
  const entry = { map, tint: !TINTLESS.has(family) };
  cache.set(family, entry);
  return entry;
}

/** Test/teardown helper. */
export function _clearTextureCache() { cache.clear(); }
