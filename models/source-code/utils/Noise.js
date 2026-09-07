// Seeded PRNG + value noise / fBm used by every procedural generator in the game.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash-based gradient-free value noise on a wrap-around lattice (tileable). */
export class ValueNoise {
  constructor(seed, size = 256) {
    this.size = size;
    const rand = mulberry32(seed);
    this.values = new Float32Array(size * size);
    for (let i = 0; i < this.values.length; i++) this.values[i] = rand();
  }
  at(ix, iy) {
    const s = this.size;
    return this.values[((iy % s + s) % s) * s + ((ix % s + s) % s)];
  }
  sample(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = this.at(ix, iy), b = this.at(ix + 1, iy);
    const c = this.at(ix, iy + 1), d = this.at(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
}

/** Tileable fractal Brownian motion, output in [0,1]. */
export function fbm(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise.sample(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, t) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};
export function formatNumber(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
/** Random point on unit sphere (uniform). */
export function randomOnSphere(rand) {
  const u = rand() * 2 - 1;
  const t = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return [r * Math.cos(t), u, r * Math.sin(t)];
}
