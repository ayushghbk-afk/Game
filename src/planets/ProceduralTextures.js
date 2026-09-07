// ============================================================
// Procedural texture factory — every planet surface is painted
// on an offscreen canvas at load time (512px), so the game ships
// with zero multi-megabyte image downloads. Results are cached.
// ============================================================
import * as THREE from 'three';
import { ValueNoise, fbm, mulberry32, clamp, smoothstep } from '../utils/Noise.js';

const cache = new Map();

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return c;
}

function toTexture(canvas, { srgb = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Sample palette by value v in [0,1] with soft blending between stops. */
function paletteSample(ctx2, palette, v) {
  const n = palette.length - 1;
  const x = clamp(v, 0, 1) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const f = x - i;
  return mixHex(palette[i], palette[i + 1], f);
}

function hexToRgb(hex) {
  const h = parseInt(hex.replace('#', ''), 16);
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
}

/** Generic painted terrain: fBm palette + optional craters + polar caps. */
function paintRocky(canvas, palette, seed, { craters = 0, roughness = 1.0, caps = 0, bump = null } = {}) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const noise = new ValueNoise(seed);
  const noise2 = new ValueNoise(seed + 7);
  const scale = 5 * roughness;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      let n = fbm(noise, u * scale, v * scale * 0.5 + 0.13, 5);
      n = n * 0.75 + fbm(noise2, u * scale * 2.7, v * scale * 1.35 + 0.7, 3) * 0.25;
      const col = paletteSample(ctx, palette, n);
      const idx = (y * W + x) * 4;
      img.data[idx] = parseInt(col.slice(4));
      img.data[idx + 1] = parseInt(col.split(',')[1]);
      img.data[idx + 2] = parseInt(col.split(',')[2]);
      img.data[idx + 3] = 255;
      if (bump) bump.data[idx] = bump.data[idx + 1] = bump.data[idx + 2] = n * 255;
      if (bump) bump.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // latitude shading near poles (subtle)
  if (caps > 0) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, `rgba(235,240,245,${caps})`);
    grad.addColorStop(0.12, 'rgba(235,240,245,0)');
    grad.addColorStop(0.88, 'rgba(235,240,245,0)');
    grad.addColorStop(1, `rgba(235,240,245,${caps})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }
  // craters: stamped radial gradients (wrap in x)
  if (craters > 0) {
    const rand = mulberry32(seed * 31 + 5);
    for (let i = 0; i < craters; i++) {
      const cx = rand() * W, cy = H * 0.08 + rand() * H * 0.84;
      const r = 2 + Math.pow(rand(), 2.2) * W * 0.045;
      for (const ox of [-W, 0, W]) {
        const g = ctx.createRadialGradient(cx + ox, cy, r * 0.1, cx + ox, cy, r);
        g.addColorStop(0, 'rgba(0,0,0,0.28)');
        g.addColorStop(0.72, 'rgba(0,0,0,0.10)');
        g.addColorStop(0.85, 'rgba(255,255,255,0.14)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx + ox, cy, r, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
}

/** Earth: continents, oceans, ice caps; separate night-lights + clouds + land mask. */
function paintEarth(canvas, seed) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const noise = new ValueNoise(seed);
  const detail = new ValueNoise(seed + 99);
  const img = ctx.createImageData(W, H);
  const landMask = new Float32Array(W * H);
  const scale = 4.2;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const lat = Math.abs(v - 0.5) * 2;
      let n = fbm(noise, u * scale, v * scale * 0.5 + 0.31, 6);
      n += fbm(detail, u * scale * 3, v * scale * 1.5, 3) * 0.22 - 0.11;
      n -= lat * 0.06;
      const idx = (y * W + x) * 4;
      let r, g, b;
      if (n > 0.52) { // land
        landMask[y * W + x] = 1;
        const t = smoothstep(0.52, 0.75, n);
        if (lat > 0.78 || (lat < 0.05 && n < 0.56)) { r = 235; g = 240; b = 245; } // ice
        else {
          const desert = fbm(detail, u * scale * 0.8 + 5, v * scale * 0.4, 3);
          r = 60 + t * 90 + desert * 70; g = 95 + t * 60 + desert * 30; b = 45 + t * 40;
          if (lat > 0.62) { r = r * 0.7 + 150 * 0.3; g = g * 0.7 + 150 * 0.3; b = b * 0.7 + 155 * 0.3; }
        }
      } else { // ocean — depth shading
        const d = smoothstep(0.52, 0.2, n);
        r = 12 + (1 - d) * 20; g = 40 + (1 - d) * 50; b = 90 + (1 - d) * 70;
        if (lat > 0.85) { r = 200; g = 215; b = 225; }
      }
      img.data[idx] = r; img.data[idx + 1] = g; img.data[idx + 2] = b; img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return landMask;
}

/** Night-lights texture: city clusters on land, near coasts. */
function paintEarthNight(canvas, landMask, seed) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const rand = mulberry32(seed + 1234);
  const clusters = 90;
  for (let c = 0; c < clusters; c++) {
    // pick a land pixel
    let cx = 0, cy = 0, tries = 0;
    do { cx = (rand() * W) | 0; cy = (rand() * H) | 0; tries++; }
    while (landMask[cy * W + cx] !== 1 && tries < 40);
    if (tries >= 40) continue;
    const count = 4 + rand() * 26;
    for (let i = 0; i < count; i++) {
      const px = cx + (rand() - 0.5) * 26, py = cy + (rand() - 0.5) * 14;
      const s = 0.6 + rand() * 1.4;
      const a = 0.35 + rand() * 0.5;
      ctx.fillStyle = `rgba(255,${190 + rand() * 50 | 0},${110 + rand() * 60 | 0},${a})`;
      ctx.fillRect(px, py, s, s);
    }
  }
}

/** Clouds: transparent fBm wisps. */
function paintClouds(canvas, seed, coverage = 0.55, streak = 1.0) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const noise = new ValueNoise(seed);
  const warp = new ValueNoise(seed + 41);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const wu = u + fbm(warp, u * 3, v * 3, 2) * 0.12;
      let n = fbm(noise, wu * 4 * streak, v * 4 + 3.7, 5);
      n = smoothstep(1 - coverage, 1 - coverage + 0.28, n);
      const idx = (y * W + x) * 4;
      img.data[idx] = img.data[idx + 1] = img.data[idx + 2] = 255;
      img.data[idx + 3] = n * 235;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Gas giant: latitude bands distorted by turbulence + optional great storm. */
function paintGas(canvas, palette, seed, { bands = 12, storm = false } = {}) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const noise = new ValueNoise(seed);
  const turb = new ValueNoise(seed + 17);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const w = (fbm(turb, u * 6, v * 9, 4) - 0.5) * 0.16;
      const band = Math.sin((v + w) * bands * Math.PI) * 0.5 + 0.5;
      const n = band * 0.72 + fbm(noise, u * 9, v * 22, 3) * 0.28;
      const col = paletteSample(ctx, palette, n);
      const idx = (y * W + x) * 4;
      img.data[idx] = parseInt(col.slice(4));
      img.data[idx + 1] = parseInt(col.split(',')[1]);
      img.data[idx + 2] = parseInt(col.split(',')[2]);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (storm) { // the great red spot
    const rand = mulberry32(seed + 3);
    const sx = W * 0.3, sy = H * 0.62;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(1.6, 1);
    for (let i = 5; i >= 0; i--) {
      ctx.fillStyle = `rgba(${140 + i * 8},${50 + i * 12},${30 + i * 8},${0.5})`;
      ctx.beginPath();
      ctx.arc(0, 0, 8 + i * 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Venus/Titan-style swirled cloud deck. */
function paintCloudDeck(canvas, palette, seed) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const noise = new ValueNoise(seed);
  const warp = new ValueNoise(seed + 23);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const w = (fbm(warp, u * 4, v * 7, 3) - 0.5) * 0.35;
      const n = fbm(noise, u * 5 + w, v * 10 + w, 4);
      const col = paletteSample(ctx, palette, n);
      const idx = (y * W + x) * 4;
      img.data[idx] = parseInt(col.slice(4));
      img.data[idx + 1] = parseInt(col.split(',')[1]);
      img.data[idx + 2] = parseInt(col.split(',')[2]);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Planetary rings: radial band strip (256x4), mapped by ring UV. */
function paintRings(canvas, baseColor, seed) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(seed);
  const [r, g, b] = hexToRgb(baseColor);
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  let pos = 0;
  while (pos < 1) {
    const w = 0.02 + rand() * 0.09;
    const a = rand() < 0.16 ? 0.05 : 0.25 + rand() * 0.65;
    grad.addColorStop(clamp(pos, 0, 1), `rgba(${r},${g},${b},${a.toFixed(2)})`);
    pos += w;
    if (rand() < 0.2) {
      grad.addColorStop(clamp(pos, 0, 1), `rgba(${r},${g},${b},0.03)`);
      pos += 0.015;
    }
  }
  grad.addColorStop(1, `rgba(${r},${g},${b},0.15)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

/** Soft radial glow sprite (sun glow, engine flame, arrival flash). */
function paintGlow(canvas, inner, outer) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const g = ctx.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, W);
}

/** Wispy nebula sprite for background dressing. */
function paintNebula(canvas, color, seed) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const noise = new ValueNoise(seed);
  const img = ctx.createImageData(W, W);
  const [r, g, b] = hexToRgb(color);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W * 3, v = y / W * 3;
      const n = fbm(noise, u, v, 4);
      const dx = x / W - 0.5, dy = y / W - 0.5;
      const fall = Math.max(0, 1 - (dx * dx + dy * dy) * 4.4);
      const a = clamp((n - 0.42) * 2.2, 0, 1) * fall;
      const idx = (y * W + x) * 4;
      img.data[idx] = r; img.data[idx + 1] = g; img.data[idx + 2] = b;
      img.data[idx + 3] = a * 160;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------- Public API ----------

/**
 * Returns { map, bumpMap?, nightMap?, cloudMap? } for a body config.
 * size: 512 default; 256 for low quality.
 */
export function getBodyTextures(textureCfg, seedBase, size = 512) {
  const key = JSON.stringify(textureCfg) + seedBase + '_' + size;
  if (cache.has(key)) return cache.get(key);
  const seed = Math.abs(hashString(key)) % 100000;
  const out = {};
  const kind = textureCfg.kind;
  if (kind === 'rocky' || kind === 'mars') {
    const c = makeCanvas(size);
    const bump = { data: new Uint8ClampedArray(size * size * 4) };
    const opts = { craters: textureCfg.craters || 0, roughness: textureCfg.roughness || 1, caps: 0, bump };
    if (kind === 'mars') { opts.caps = 0.5; opts.craters = (textureCfg.craters || 45); }
    paintRocky(c, textureCfg.palette || ['#555', '#777', '#999', '#bbb'], seed, opts);
    out.map = toTexture(c);
    const bc = makeCanvas(size);
    bc.getContext('2d').putImageData(new ImageData(bump.data, size, size), 0, 0);
    out.bumpMap = toTexture(bc, { srgb: false });
  } else if (kind === 'earth') {
    const c = makeCanvas(size);
    const landMask = paintEarth(c, seed);
    out.map = toTexture(c);
    const night = makeCanvas(size);
    paintEarthNight(night, landMask, seed);
    out.nightMap = toTexture(night);
  } else if (kind === 'venus') {
    const c = makeCanvas(size);
    paintCloudDeck(c, textureCfg.palette, seed);
    out.map = toTexture(c);
  } else if (kind === 'gas') {
    const c = makeCanvas(size);
    paintGas(c, textureCfg.palette, seed, textureCfg);
    out.map = toTexture(c);
  } else if (kind === 'ice') {
    const c = makeCanvas(size);
    paintCloudDeck(c, textureCfg.palette, seed); // smooth gradient-ish clouds work for ice giants
    out.map = toTexture(c);
  }
  cache.set(key, out);
  return out;
}

export function getCloudTexture(seed = 777, size = 512, coverage = 0.5, streak = 1.0) {
  const key = `cloud${seed}_${size}_${coverage}_${streak}`;
  if (cache.has(key)) return cache.get(key);
  const c = makeCanvas(size);
  paintClouds(c, seed, coverage, streak);
  const tex = toTexture(c);
  cache.set(key, tex);
  return tex;
}

export function getRingTexture(colorHex, seed = 5, width = 256) {
  const key = `ring${colorHex}_${seed}_${width}`;
  if (cache.has(key)) return cache.get(key);
  const c = makeCanvas(width);
  c.height = 8;
  paintRings(c, colorHex, seed);
  const tex = toTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  cache.set(key, tex);
  return tex;
}

export function getGlowTexture(inner = 'rgba(255,240,200,1)', outer = 'rgba(255,160,60,0.35)', size = 256) {
  const key = `glow${inner}${outer}${size}`;
  if (cache.has(key)) return cache.get(key);
  const c = makeCanvas(size);
  paintGlow(c, inner, outer);
  const tex = toTexture(c, { srgb: false });
  cache.set(key, tex);
  return tex;
}

export function getNebulaTexture(color = '#3b2a6e', seed = 9, size = 256) {
  const key = `neb${color}${seed}${size}`;
  if (cache.has(key)) return cache.get(key);
  const c = makeCanvas(size);
  paintNebula(c, color, seed);
  const tex = toTexture(c, { srgb: false });
  cache.set(key, tex);
  return tex;
}

export function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; }
  return h;
}
