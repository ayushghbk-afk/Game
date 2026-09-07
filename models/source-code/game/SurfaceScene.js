// SurfaceScene — explorable procedural planetary surface for EVERY body
// (any planet/moon you have scanned). Each world gets a DISTINCT map
// shaped by its research theme (see surface/SurfaceThemes.js): named real
// landmarks, per-world sky/fog/palette, liquid pools, lava glows…
//
// On the surface you move in three ways — the UI adapts to each:
//   · shuttle — the hover landing craft (flies back to space)
//   · rover   — the ground car
//   · foot    — the ASTRONAUT: a humanoid you control directly —
//               run (WASD), sprint (Shift), JUMP (Space) under local gravity
//
// Economy on the ground:
//   · SUPPLY CACHES  — spare parts + goods, scattered randomly on the map
//   · EARTH ORDERS   — crates you order from Earth that land near the outpost
//   · SAMPLE SITE    — one science beacon per world (E to collect)
//   · BROKEN ROVERS  — find & repair for credits (needs spare parts)
//
// The scene stays decoupled from GameState: it purely tracks geometry,
// vehicle state and proximity — the Game orchestrates economy/jobs and
// feeds it inputs + hooks.
import * as THREE from 'three';
import { ValueNoise, fbm, mulberry32, clamp, lerp } from '../utils/Noise.js';
import { getGlowTexture } from '../planets/ProceduralTextures.js';
import { buildShipMesh } from '../spacecraft/Ship.js';
import { themeFor } from '../surface/SurfaceThemes.js';
import { ObjectStreamer } from '../world/ObjectStreamer.js';

// Playable surface is ~4× the original area (1800×1800) with denser
// tessellation so canyons, dunes and named landmarks actually read at range.
export const SIZE = 1800;
export const SEG = 140;
const BASE_RANGE = 40;        // how close you must be to enter the outpost
const ROVER_RANGE = 40;       // how close to a broken rover you must be to repair
const SHUTTLE_RANGE = 34;     // how close to the parked shuttle to re-board it
const CACHE_RANGE_FOOT = 8;   // pick-up radius on foot
const CACHE_RANGE_VEHICLE = 18;
/** Theme authoring was done on a 900-unit map — scale features up to match. */
export const THEME_SCALE = 2;
const FOOT_SPEED = 5.6;
const FOOT_SPRINT = 11.5;
const JUMP_HEIGHT = 2.6;      // ~2.6 m EVA jump (hang time scales w/ gravity)

/** Distance from point (x,z) to the segment centred at f.x,f.z (len,ang). */
function segDist(x, z, f) {
  const dx = x - f.x, dz = z - f.z;
  const ca = Math.cos(f.ang || 0), sa = Math.sin(f.ang || 0);
  const along = dx * ca + dz * sa;
  const perp = -dx * sa + dz * ca;
  const half = (f.len || 0) / 2;
  return Math.hypot(along > half ? along - half : along < -half ? along + half : 0, perp);
}
const sstep = (a, b, t) => { const x = clamp((t - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };

export class SurfaceScene {
  constructor(bodyCfg, quality, opts = {}) {
    this.cfg = bodyCfg;
    this.id = bodyCfg.id;
    this.quality = quality;
    this.streamQuality = opts.streaming || (quality === 'low' ? 'low' : 'medium');
    this.theme = this._scaleTheme(themeFor(bodyCfg));
    this.scene = new THREE.Scene();
    this.gravAccel = 3.4 * Math.sqrt(bodyCfg.gravity || 0.3);
    this.seedBase = 900 + (this.id.length * 131) + [...this.id].reduce((a, c) => a + c.charCodeAt(0), 0) * 7;
    this.worldSize = SIZE;

    // ship state (the hover shuttle)
    this.ship = buildShipMesh();
    this.shipState = {
      position: new THREE.Vector3(0, 60, 0),
      quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(),
      speed: 0
    };
    this.yaw = 0; this.pitch = -0.35;
    this.landed = false;
    this.collected = false;

    // vehicle the astronaut is currently using: 'shuttle' | 'rover' | 'foot'
    this.vehicleMode = 'shuttle';

    // astronaut (humanoid) state — used when vehicleMode === 'foot'
    this.footState = {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      camYaw: 0, camPitch: -0.4,
      facing: 0, grounded: true, walkPhase: 0
    };
    this.astro = null; // humanoid mesh refs

    this._noiseA = new ValueNoise(this.seedBase);
    this._noiseB = new ValueNoise(this.seedBase + 31);
    const cr = this.theme.craters || { count: 0 };
    this._craterRand = mulberry32(this.seedBase + 77);
    this._craters = [];
    for (let i = 0; i < cr.count; i++) {
      this._craters.push({
        x: (this._craterRand() - 0.5) * SIZE,
        z: (this._craterRand() - 0.5) * SIZE,
        r: (cr.rMin || 10) + this._craterRand() * ((cr.rMax || 30) - (cr.rMin || 10)),
        d: 0.8 + this._craterRand() * 0.5
      });
    }

    this._buildTerrain();
    this._buildSky();
    this._buildFeatureGlows();
    this._buildDetailMeshes();  // extra ridges / rock fields for the bigger map
    this._buildBase();      // must precede _buildProps: streaming keeps the pad clear
    this._buildProps();
    this._buildLandmarkLabels();
    this._buildRover();
    this._buildBrokenRovers();
    this._buildCaches();
    this._buildSampleSite();
    this._buildAstronaut();
    this.scene.add(this.ship.group);
  }

  /**
   * Theme coordinates were authored for a 900-unit map. Scale every planar
   * dimension so landmarks still sit in the right relative place on the
   * larger 1800-unit surface, and bump prop/cache counts for the extra area.
   */
  _scaleTheme(th) {
    const s = THEME_SCALE;
    const out = { ...th, features: (th.features || []).map(f => {
      const n = { ...f };
      if (n.x != null) n.x *= s;
      if (n.z != null) n.z *= s;
      if (n.r != null) n.r *= s;
      if (n.len != null) n.len *= s;
      if (n.w != null) n.w *= s;
      if (n.gap != null) n.gap *= s;
      return n;
    })};
    if (out.craters) {
      out.craters = {
        ...out.craters,
        count: Math.round((out.craters.count || 0) * 1.6),
        rMin: (out.craters.rMin || 10) * s * 0.85,
        rMax: (out.craters.rMax || 30) * s * 0.85
      };
    }
    if (out.props) {
      out.props = { ...out.props, count: Math.round((out.props.count || 0) * 3.2) };
    }
    if (out.caches) out.caches = Math.round(out.caches * 1.8);
    if (out.brokenRovers) out.brokenRovers = Math.round(out.brokenRovers * 1.5);
    // Slightly stronger relief so the bigger map still has readable hills.
    if (out.amp) out.amp = out.amp * 1.15;
    return out;
  }

  /** Mid-scale ridges & boulder clusters that the heightfield alone can't sell. */
  _buildDetailMeshes() {
    const th = this.theme;
    if (th.cloudDeck) return;
    const rand = mulberry32(this.seedBase + 404);
    const group = new THREE.Group();
    // Long geological ridges
    const ridgeMat = new THREE.MeshStandardMaterial({
      color: th.high || 0x888888, roughness: 0.95, flatShading: true
    });
    const ridgeCount = this.quality === 'low' ? 10 : 22;
    for (let i = 0; i < ridgeCount; i++) {
      const x = (rand() - 0.5) * SIZE * 0.85;
      const z = (rand() - 0.5) * SIZE * 0.85;
      if (Math.hypot(x, z) < 80) continue;
      const len = 40 + rand() * 120;
      const h = 2 + rand() * 7;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(4 + rand() * 6, h, len), ridgeMat);
      mesh.position.set(x, this.heightAt(x, z) + h * 0.35, z);
      mesh.rotation.y = rand() * Math.PI;
      mesh.rotation.z = (rand() - 0.5) * 0.15;
      group.add(mesh);
    }
    // Scattered large boulders (non-streamed landmarks)
    const rockMat = new THREE.MeshStandardMaterial({
      color: th.props?.color || th.low || 0x666666, roughness: 0.97, flatShading: true
    });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockN = this.quality === 'low' ? 18 : 40;
    for (let i = 0; i < rockN; i++) {
      const x = (rand() - 0.5) * SIZE * 0.8;
      const z = (rand() - 0.5) * SIZE * 0.8;
      if (Math.hypot(x, z) < 50) continue;
      const sc = 3 + rand() * 8;
      const m = new THREE.Mesh(rockGeo, rockMat);
      m.position.set(x, this.heightAt(x, z) + sc * 0.35, z);
      m.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      m.scale.set(sc, sc * (0.6 + rand() * 0.6), sc * (0.7 + rand() * 0.5));
      group.add(m);
    }
    this.scene.add(group);
    this._detailGroup = group;
  }

  // ------------------------------------------------ TERRAIN
  /** Apply one feature to the accumulating vertex channels. */
  _featureInto(f, x, z, o) {
    const d = Math.hypot(x - f.x, z - f.z);
    const t = d / (f.r || 1);
    switch (f.t) {
      case 'crater': {
        if (d < f.r) {
          const tt = d / f.r;
          o.dh += (-(1 - tt * tt) * f.r * 0.18 + Math.exp(-Math.pow((tt - 0.85) * 6, 2)) * f.r * 0.09) * (f.d || 1);
          if (f.brightFloor) o.bright += (1 - tt) * f.brightFloor;
        }
        if (f.peak && d < f.r * 0.2) o.dh += Math.exp(-Math.pow(d / (f.r * 0.14), 2)) * f.r * 0.1 * (f.d || 1);
        if (f.rays && d > f.r * 0.8) {
          const aa = Math.atan2(z - f.z, x - f.x);
          const ray = Math.pow(Math.abs(Math.cos(aa * 9)), 12);
          o.bright += ray * Math.exp(-Math.pow((d - f.r) / (f.r * 0.9), 2)) * 0.5;
        }
        break;
      }
      case 'basin': {
        if (d < f.r) {
          const tt = d / f.r;
          o.dh += -f.r * 0.13 * (f.d || 1) * Math.pow(1 - tt * tt, 1.4);
          if (f.ring) o.dh += Math.exp(-Math.pow((tt - 0.55) * 6.5, 2)) * f.r * 0.12 * (f.d || 1);
          if (f.peak && d < f.r * 0.2) o.dh += Math.exp(-Math.pow(d / (f.r * 0.12), 2)) * f.r * 0.09 * (f.d || 1);
        }
        break;
      }
      case 'dome': {
        o.dh += f.h * Math.exp(-t * t * 1.9);
        if (f.caldera && d < f.r * 0.22) o.dh -= f.h * 0.3 * Math.exp(-Math.pow(d / (f.r * 0.13), 2));
        break;
      }
      case 'patera': {
        o.dh -= (f.d || 4) * Math.exp(-t * t * 1.6);
        break;
      }
      case 'canyon': {
        const dp = segDist(x, z, f), w = f.w || 10;
        if (dp < w) o.dh -= (f.d || 8) * (1 - Math.pow(dp / w, 2));
        else if (dp < w * 1.6) o.dh += (f.d || 8) * 0.06 * Math.exp(-Math.pow((dp - w) / (w * 0.4), 2));
        break;
      }
      case 'plain': {
        const m = 1 - sstep(0.55, 1, t);
        if (f.flat !== undefined) { o.flatW += m; o.flatV += (f.flat || 2) * m; }
        if (f.dark) o.dark += m * f.dark;
        if (f.bright) o.bright += m * f.bright;
        break;
      }
      case 'highland': {
        const m = 1 - sstep(0.6, 1, t);
        if (m > 0) {
          const n = fbm(this._noiseB, x / 60, z / 60, 3);
          const bump = f.blocky ? (0.35 + 1.1 * Math.abs(n * 2 - 1)) : (0.8 + 0.4 * n);
          o.dh += f.h * m * bump;
        }
        break;
      }
      case 'caps': {
        const m = 1 - sstep(0.5, 1, t);
        o.dh += 2.4 * m; o.bright += m * 0.9;
        break;
      }
      case 'linea': {
        const dp = segDist(x, z, f);
        if (dp < 8) {
          o.dh += 1.6 * (Math.exp(-Math.pow((dp - 2.4) / 1.6, 2)) + Math.exp(-Math.pow((dp + 2.4) / 1.6, 2)));
          o.dh -= 1.1 * Math.exp(-Math.pow(dp / 0.9, 2));
          o.tint += Math.exp(-Math.pow(dp / 2.2, 2)) * 0.9;
        }
        break;
      }
      case 'lineae': {
        const sa = Math.sin(f.ang || 0), ca = Math.cos(f.ang || 0);
        for (let i = 0; i < f.n; i++) {
          const off = (i - (f.n - 1) / 2) * (f.gap || 30);
          this._featureInto({ t: 'linea', x: f.x - sa * off, z: f.z + ca * off, len: f.len, ang: f.ang }, x, z, o);
        }
        break;
      }
      case 'band': {
        const dp = segDist(x, z, f), w = f.w || 60;
        const m = 1 - sstep(0.6, 1, dp / w);
        if (m > 0) {
          if (f.flat !== undefined) { o.flatW += m; o.flatV += (f.flat || 2) * m; }
          if (f.dark) o.dark += m * f.dark;
        }
        break;
      }
      case 'chaos': {
        const m = 1 - sstep(0.75, 1, t);
        if (m > 0) {
          const v = fbm(this._noiseB, x / 26, z / 26, 3);
          o.dh += (v - 0.5) * 8 * m;
          if (v > 0.62) o.bright += (v - 0.62) * 1.4 * m;
        }
        break;
      }
      case 'dunes': {
        const m = 1 - sstep(0.7, 1, t);
        if (m > 0) {
          const ca = Math.cos(f.ang || 0), sa = Math.sin(f.ang || 0);
          const along = (x - f.x) * ca + (z - f.z) * sa;
          const across = (x - f.x) * -sa + (z - f.z) * ca;
          o.dh += Math.abs(Math.sin(across * 0.22 + along * 0.012)) * 2.3 * m;
        }
        break;
      }
      case 'lake': {
        const m = 1 - sstep(0.8, 1, t);
        o.flatW += m; o.flatV += (f.lvl ?? -1) * m;
        o.dark += m * 0.9;
        break;
      }
      case 'palimpsest': {
        if (t < 1) {
          o.dh += -3.0 * (1 - t * t) * 0.5;
          o.bright += Math.exp(-Math.pow((t - 0.8) * 4, 2)) * 0.5;
          o.dark += (1 - t) * 0.25;
        }
        break;
      }
      case 'cantaloupe': {
        const m = 1 - sstep(0.8, 1, t);
        if (m > 0) {
          const w = fbm(this._noiseA, x / 40, z / 40, 2) * 3;
          o.dh += Math.abs(Math.sin(x * 0.55 + w)) * 1.5 * m;
        }
        break;
      }
      case 'stripe': {
        const dp = segDist(x, z, f);
        if (dp < 3) {
          o.dh -= 1.6 * Math.exp(-Math.pow(dp / 1.1, 2));
          o.tint += Math.exp(-Math.pow(dp / 1.6, 2));
        }
        break;
      }
      case 'shadowed': {
        if (t < 1) {
          const m = 1 - t * t;
          o.dark += m;
          o.dh -= 3 * m;
          o.bright += Math.exp(-Math.pow(d / (f.r * 0.5), 2)) * 0.35 * m; // possible ice glints
        }
        break;
      }
      case 'veins':
      case 'flows': {
        const sa = Math.sin(f.ang || 0), ca = Math.cos(f.ang || 0);
        for (let i = 0; i < f.n; i++) {
          const off = (i - (f.n - 1) / 2) * 34;
          const cf = { x: f.x - sa * off, z: f.z + ca * off, len: f.len, ang: f.ang };
          const dp = segDist(x, z, cf);
          if (dp < 4) {
            const m = Math.exp(-Math.pow(dp / 1.4, 2));
            if (f.t === 'flows') { o.dh += 0.25 * Math.exp(-Math.pow((dp - 2) / 1, 2)) - 0.5 * m; o.dark += m * 0.55; }
            else o.dark += m * 0.8;
          }
        }
        break;
      }
      case 'spot': {
        const m = 1 - sstep(0.55, 1, t);
        o.tint += m * (f.amt || 0.8);
        break;
      }
      case 'corona': {
        if (t < 1) {
          o.dh += Math.exp(-Math.pow((t - 0.8) * 3.2, 2)) * 7;   // ring mountain
          if (d < f.r * 0.3) o.dh -= Math.exp(-Math.pow(d / (f.r * 0.2), 2)) * 5; // central pit
        }
        break;
      }
    }
  }

  _heightRaw(x, z) {
    // noise objects are hoisted (built once in ctor) — critical for perf
    const n = this._noiseA, n2 = this._noiseB;
    const th = this.theme;
    const u = x / SIZE * 8 + 10, v = z / SIZE * 8 + 10;
    let h = fbm(n, u, v, 5) * 2 - 1;
    if (this.id === 'mars') h = Math.pow(Math.abs(h), 0.8) * (h > 0 ? 1 : -1); // ridged mountains
    h += (fbm(n2, u * 3.1, v * 3.1, 3) - 0.5) * 0.5;
    let height = h * th.amp;
    // named research features (Caloris, Maat Mons, tiger stripes, dunes…)
    const o = this._tmpF;
    o.dh = 0; o.dark = 0; o.bright = 0; o.tint = 0; o.flatW = 0; o.flatV = 0;
    for (const f of th.features) this._featureInto(f, x, z, o);
    if (o.flatW > 0.001) height = lerp(height, o.flatV / o.flatW, Math.min(1, o.flatW));
    height += o.dh;
    // scattered impact craters
    for (const cr of this._craters) {
      const dx = x - cr.x, dz = z - cr.z;
      const d = Math.hypot(dx, dz);
      if (d < cr.r) {
        const tt = d / cr.r;
        height += (-(1 - tt * tt) * cr.r * 0.2 + Math.exp(-Math.pow((tt - 0.85) * 6, 2)) * cr.r * 0.08) * cr.d;
      }
    }
    return height;
  }

  _buildTerrain() {
    // scratch channel reused per vertex (kept off-heap churn)
    this._tmpF = { dh: 0, dark: 0, bright: 0, tint: 0, flatW: 0, flatV: 0 };
    this._dark = new Float32Array((SEG + 1) * (SEG + 1));
    this._bright = new Float32Array((SEG + 1) * (SEG + 1));
    this._tint = new Float32Array((SEG + 1) * (SEG + 1));

    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    this.heights = new Float32Array((SEG + 1) * (SEG + 1));
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const th = this.theme;
    const low = new THREE.Color(th.low), high = new THREE.Color(th.high);
    const darkC = new THREE.Color(th.dark), brightC = new THREE.Color(th.bright);
    const tintC = new THREE.Color(th.tintColor || th.high);
    const noiseMid = new ValueNoise(this.seedBase + 991);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this._heightRaw(x, z);
      pos.setY(i, h);
      this.heights[i] = h;
      this._dark[i] = this._tmpF.dark;
      this._bright[i] = this._tmpF.bright;
      this._tint[i] = this._tmpF.tint;
      if (this.id === 'earth') {
        if (h < 0.6) c.setHex(0xc2b280);
        else if (h < 5) c.setHex(0x3f7a34);
        else if (h < 9) c.setHex(0x5d6b46);
        else if (h < 13) c.setHex(0x6e6a63);
        else c.setHex(0xe8ecef);
      } else {
        const t = clamp((h + th.amp * 0.35) / (th.amp * 1.05), 0, 1);
        c.copy(low).lerp(high, t);
        const mid = fbm(noiseMid, x / 90, z / 90, 2);
        c.lerp(high, (mid - 0.5) * 0.24);
        c.lerp(darkC, Math.min(1, this._dark[i]) * 0.82);
        c.lerp(brightC, Math.min(1, this._bright[i]) * 0.7);
        c.lerp(tintC, Math.min(1, this._tint[i]) * 0.5);
      }
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    this.terrain = new THREE.Mesh(geo, mat);
    this.scene.add(this.terrain);

    if (th.water) {
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(SIZE * 1.6, SIZE * 1.6),
        new THREE.MeshStandardMaterial({
          color: th.water.color, transparent: true, opacity: th.water.opacity, roughness: 0.15, metalness: 0.4
        })
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = th.water.level;
      this.scene.add(water);
    }
  }

  // ------------------------------------------------ FEATURE GLOWS / POOLS
  _glowSprite(color1, color2, scale) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(color1, color2),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    s.scale.setScalar(scale);
    return s;
  }

  _buildFeatureGlows() {
    const th = this.theme;
    for (const f of th.features) {
      if (f.t === 'patera') {
        // glowing lava lake in the crater floor
        const y = this.heightAt(f.x, f.z) + 0.28;
        const lake = new THREE.Mesh(
          new THREE.CircleGeometry(f.r * 0.55, 24),
          new THREE.MeshBasicMaterial({ color: f.glow })
        );
        lake.rotation.x = -Math.PI / 2;
        lake.position.set(f.x, y, f.z);
        this.scene.add(lake);
        const g = this._glowSprite('rgba(255,140,60,0.9)', 'rgba(255,60,10,0.3)', f.r * 1.1);
        g.position.set(f.x, y + 3, f.z);
        this.scene.add(g);
      } else if (f.t === 'stripe') {
        // hot fault crack — emissive strip + glow puffs
        const sa = Math.sin(f.ang || 0), ca = Math.cos(f.ang || 0);
        const y = this.heightAt(f.x, f.z) + 0.12;
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(1.3, 0.1, f.len),
          new THREE.MeshBasicMaterial({ color: f.glow, transparent: true, opacity: 0.85 })
        );
        strip.position.set(f.x, y, f.z);
        strip.rotation.y = f.ang || 0;
        this.scene.add(strip);
        for (let k = -1; k <= 1; k++) {
          const g = this._glowSprite('rgba(255,200,150,0.8)', 'rgba(255,120,60,0.3)', 14);
          g.position.set(f.x - sa * k * f.len * 0.3, y + 2.4, f.z + ca * k * f.len * 0.3);
          this.scene.add(g);
        }
      } else if (f.t === 'lake') {
        // Titan: dark hydrocarbon sea, mirror-like
        const y = (f.lvl ?? -1) + 0.18;
        const pool = new THREE.Mesh(
          new THREE.CircleGeometry(f.r * 0.92, 28),
          new THREE.MeshStandardMaterial({ color: 0x0a0d14, roughness: 0.08, metalness: 0.55, transparent: true, opacity: 0.96 })
        );
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(f.x, y, f.z);
        this.scene.add(pool);
      }
    }
  }

  // ------------------------------------------------ SKY
  _buildSky() {
    const th = this.theme, sky = th.sky;
    const rand = mulberry32(31415);
    const n = Math.round(1400 * (sky.stars || 0));
    if (n > 0) {
      const positions = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const t = rand() * Math.PI * 2, p = Math.acos(rand() * 0.9);
        const r = 3000;
        positions[i * 3] = Math.sin(p) * Math.cos(t) * r;
        positions[i * 3 + 1] = Math.abs(Math.cos(p)) * r * (this.id === 'earth' ? 1 : 1.2) - 300;
        positions[i * 3 + 2] = Math.sin(p) * Math.sin(t) * r;
      }
      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      this.scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
        color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.85
      })));
    }
    const sunDir = new THREE.Vector3(0.5, 0.55, -0.4).normalize();
    const dir = new THREE.DirectionalLight(sky.sun, sky.sunIntensity);
    dir.position.copy(sunDir).multiplyScalar(500);
    this.scene.add(dir);
    this.scene.add(new THREE.AmbientLight(sky.ambient[0], sky.ambient[1]));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture('rgba(255,244,200,1)', 'rgba(255,190,90,0.4)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    glow.position.copy(sunDir).multiplyScalar(2600);
    glow.scale.setScalar(sky.stars ? 900 : 340);
    this.scene.add(glow);
    // Fog density was tuned for a 900-unit map — halve it so the bigger
    // world stays readable at range instead of disappearing into haze.
    if (sky.fog) this.scene.fog = new THREE.FogExp2(sky.fog[0], sky.fog[1] * 0.55);
  }

  // ------------------------------------------------ ROCKS / PROPS
  /**
   * Scatter props (boulders, debris, ice shards…) through the STREAMER instead
   * of instantiating the whole 1800×1800 map at once. Cells near the player are
   * generated on demand and everything the player walks away from is disposed,
   * so memory stays flat no matter how far you drive.
   */
  _buildProps() {
    const th = this.theme;
    const p = th.props;
    if (!p || !p.count) return;

    // Density per square unit, derived from the theme's old total count so
    // every world keeps the look it was tuned for.
    const density = (p.count * (this.quality === 'low' ? 0.5 : 1)) / (SIZE * SIZE * 0.81);
    const lakes = th.features.filter(f => f.t === 'lake');
    const propGeo = new THREE.DodecahedronGeometry(1, 0);
    this._propGeo = propGeo;

    this.streamer = new ObjectStreamer(this.scene, (cx, cz, b, seed) => {
      // Skip cells outside the playable map.
      if (Math.abs(b.cx) > SIZE * 0.5 || Math.abs(b.cz) > SIZE * 0.5) return null;
      const rand = mulberry32(seed);
      const count = Math.max(0, Math.round(density * b.size * b.size * (0.6 + rand() * 0.8)));
      if (!count) return null;

      const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.95, flatShading: true });
      const inst = new THREE.InstancedMesh(propGeo, mat, count);
      const d = new THREE.Object3D();
      let placed = 0;
      for (let i = 0; i < count; i++) {
        const x = b.x0 + rand() * b.size;
        const z = b.z0 + rand() * b.size;
        let inLake = false;
        for (const lk of lakes) if (Math.hypot(x - lk.x, z - lk.z) < lk.r + 8) { inLake = true; break; }
        if (inLake) continue;
        // Keep the landing pad and outpost clear.
        if (Math.hypot(x - this.basePos.x, z - this.basePos.z) < BASE_RANGE * 0.7) continue;
        const sc = 0.6 + rand() * 2.6;
        d.position.set(x, this.heightAt(x, z) + sc * 0.2, z);
        d.rotation.set(rand() * 3, rand() * 3, rand() * 3);
        d.scale.setScalar(sc);
        d.updateMatrix();
        inst.setMatrixAt(placed++, d.matrix);
      }
      if (!placed) { inst.dispose(); mat.dispose(); return null; }
      inst.count = placed;                 // trim to what actually got placed
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = true;
      // The shared geometry must survive cell disposal.
      inst.userData.sharedGeometry = true;
      return inst;
    }, { quality: this.streamQuality, seed: this.seedBase + 61 });

    // Prime the area around the landing site so the first frame isn't bare.
    for (let i = 0; i < 12; i++) this.streamer.update(this.basePos.x, this.basePos.z);
  }

  /** Feed the streamer the player's current ground position. */
  _updateStreaming() {
    if (!this.streamer) return;
    const p = this.vehicleMode === 'foot' ? this.footState.position
      : this.vehicleMode === 'rover' ? this.roverState.position
      : this.shipState.position;
    this.streamer.update(p.x, p.z);
  }

  // ------------------------------------------------ OUTPOST / BASE
  _material(color, rough = 0.6, metal = 0.5) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  }

  _buildBase() {
    this.baseGroup = new THREE.Group();
    const bPos = new THREE.Vector3(0, 0, 0);
    bPos.y = this.heightAt(0, 0);
    this.basePos = bPos;
    this.baseRadius = BASE_RANGE;

    const base = new THREE.Group();
    base.position.copy(bPos);

    const padMat = this._material(0x55606c, 0.7, 0.3);
    const hullMat = this._material(0xb8c4d0, 0.4, 0.7);
    const darkMat = this._material(0x3c4650, 0.6, 0.5);
    const accentMat = this._material(0xffb347, 0.4, 0.3);
    accentMat.emissive = new THREE.Color(0x5a3200);
    accentMat.emissiveIntensity = 0.5;

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 0.6, 24), padMat);
    pad.position.y = 0.3;
    base.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(15, 0.35, 8, 40), accentMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.62;
    base.add(ring);

    const dome = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hullMat);
    dome.position.y = 0.2;
    base.add(dome);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.4, 1.2, 20, 1, true), darkMat);
    rim.position.y = 0.6;
    base.add(rim);
    const winMat = this._material(0x9fe8c0, 0.3, 0.2);
    winMat.emissive = new THREE.Color(0x4fd0a0);
    winMat.emissiveIntensity = 0.9;
    const windows = new THREE.Mesh(new THREE.CylinderGeometry(5.9, 5.9, 1.1, 20, 1, true), winMat);
    windows.position.y = 2.2;
    base.add(windows);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 4, 12), darkMat);
    tube.rotation.z = Math.PI / 2;
    tube.position.set(6.8, 1.2, 0);
    base.add(tube);
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.5, 12), accentMat);
    hatch.rotation.z = Math.PI / 2;
    hatch.position.set(9, 1.2, 0);
    base.add(hatch);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 9, 8), darkMat);
    mast.position.set(-5, 4.5, -4);
    base.add(mast);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), winMat);
    beacon.position.set(-5, 9.2, -4);
    base.add(beacon);
    this.beacon = beacon;

    const solar = new THREE.Group();
    const panelMat = this._material(0x2f6fb4, 0.5, 0.6);
    panelMat.emissive = new THREE.Color(0x14324f);
    panelMat.emissiveIntensity = 0.4;
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 1.4), panelMat);
      p.position.set((i % 3) * 2.4 - 2.4, 0, Math.floor(i / 3) * 2.2 - 1.1);
      p.rotation.x = -0.5;
      solar.add(p);
    }
    solar.position.set(8, 2.2, -6);
    solar.rotation.y = -0.6;
    base.add(solar);

    this.baseGroup.add(base);
    this.scene.add(this.baseGroup);

    const label = this._makeLabel(this.cfg.name + ' OUTPOST');
    label.position.copy(bPos).add(new THREE.Vector3(0, 15, 0));
    this.scene.add(label);
  }

  _makeLabel(text, color = '#9fd8ff') {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(8,14,26,0.72)';
    ctx.roundRect?.(4, 12, 504, 72, 16);
    ctx.fill();
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text.toUpperCase(), 256, 50, 480);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.scale.set(16, 3, 1);
    return s;
  }

  _buildLandmarkLabels() {
    for (const f of this.theme.features) {
      if (!f.label || !f.name) continue;
      const label = this._makeLabel(f.name, '#ffd9a0');
      label.scale.set(18, 3.4, 1);
      label.position.set(f.x, this.heightAt(f.x, f.z) + 11, f.z);
      this.scene.add(label);
    }
  }

  // ------------------------------------------------ ROVER (the car)
  _buildRover() {
    this.rover = this._makeRoverMesh(0xff6a3a);
    this.roverState = {
      position: new THREE.Vector3(0, 0, 0),
      heading: 0,
      speed: 0,
      velocity: new THREE.Vector3()
    };
    const g = this.heightAt(14, 18);
    this.roverState.position.set(14, g + 1.2, 18);
    this.rover.group.position.copy(this.roverState.position);
    this.scene.add(this.rover.group);
  }

  _makeRoverMesh(color) {
    const group = new THREE.Group();
    const visual = new THREE.Group();
    group.add(visual);
    const bodyMat = this._material(color, 0.5, 0.5);
    const darkMat = this._material(0x2b333d, 0.7, 0.4);
    const glassMat = this._material(0x9fe8ff, 0.2, 0.8);
    glassMat.emissive = new THREE.Color(0x1c4a66);
    glassMat.emissiveIntensity = 0.5;

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.1, 2.2), bodyMat);
    chassis.position.y = 1.1;
    visual.add(chassis);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 1.9), darkMat);
    cab.position.set(-0.3, 2.0, 0);
    visual.add(cab);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 1.6), glassMat);
    canopy.position.set(-0.35, 2.5, 0);
    visual.add(canopy);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 6), darkMat);
    ant.position.set(1.2, 2.6, 0);
    visual.add(ant);
    const antLight = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), this._material(0xffb347, 0.3, 0.2));
    antLight.material.emissive = new THREE.Color(0xff8c2a);
    antLight.material.emissiveIntensity = 0.8;
    antLight.position.set(1.2, 3.8, 0);
    visual.add(antLight);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), darkMat);
    mast.rotation.z = -0.5;
    mast.position.set(-1.8, 2.0, 0);
    visual.add(mast);

    const wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.4, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = darkMat;
    for (const [wx, wz] of [[1.4, 1.05], [1.4, -1.05], [-1.4, 1.05], [-1.4, -1.05]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(wx, 0.6, wz);
      visual.add(w);
      wheels.push(w);
    }
    return { group, visual, wheels };
  }

  // ------------------------------------------------ BROKEN ROVERS
  _buildBrokenRovers() {
    const want = this.theme.brokenRovers ?? 8;
    if (want <= 0) { this.brokenRovers = []; return; }
    const count = this.quality === 'low' ? Math.max(3, Math.round(want * 0.6)) : want;
    const rand = mulberry32(this.seedBase + 700);
    this.brokenRovers = [];
    for (let i = 0; i < count; i++) {
      let x = 0, z = 0;
      for (let tries = 0; tries < 24; tries++) {
        x = (rand() - 0.5) * SIZE * 0.86;
        z = (rand() - 0.5) * SIZE * 0.86;
        if (Math.hypot(x - 0, z) > 90 && Math.hypot(x, z) < SIZE * 0.42) break;
      }
      const g = this.heightAt(x, z);
      const rover = this._makeRoverMesh(0x7a8594);
      rover.visual.rotation.set(0.25, rand() * Math.PI * 2, 0.4 + rand() * 0.3);
      rover.visual.rotation.z = 0.5 + rand() * 0.2;
      rover.visual.scale.setScalar(0.96);
      if (rover.wheels.length > 0) rover.wheels[0].visible = false;
      const group = rover.group;
      group.position.set(x, g + 0.6, z);
      group.scale.setScalar(0.94);
      this.scene.add(group);
      this.brokenRovers.push({ group, pos: group.position.clone(), fixed: false, radius: ROVER_RANGE, baseColor: 0x7a8594 });
    }
  }

  fixRover(index) {
    const r = this.brokenRovers[index];
    if (!r || r.fixed) return false;
    r.fixed = true;
    r.group.scale.setScalar(1);
    r.group.rotation.set(0, 0, 0);
    r.group.children[0].rotation.set(0, 0, 0);
    r.group.children[0].scale.setScalar(1);
    const mats = [];
    r.group.traverse(o => { if (o.isMesh) mats.push(o.material); });
    for (const m of mats) {
      if (m && m.color && typeof m.color.getHex === 'function' && m.color.getHex() === r.baseColor) {
        m.color.setHex(0xff6a3a);
      }
    }
    return true;
  }

  nearestBrokenRover(x, z, range = ROVER_RANGE) {
    let best = null, bestD = Infinity;
    for (let i = 0; i < this.brokenRovers.length; i++) {
      const r = this.brokenRovers[i];
      if (r.fixed) continue;
      const d = Math.hypot(r.pos.x - x, r.pos.z - z);
      if (d < range && d < bestD) { best = { i, d, meta: r }; bestD = d; }
    }
    return best;
  }

  // ------------------------------------------------ SUPPLY CACHES (spare parts found randomly on the map)
  _buildCaches() {
    const th = this.theme;
    const count = th.caches ?? 5;
    const rand = mulberry32(this.seedBase + 1301);
    const lakes = th.features.filter(f => f.t === 'lake');
    this.caches = [];
    for (let i = 0; i < count; i++) {
      let x = 0, z = 0;
      for (let tries = 0; tries < 30; tries++) {
        const a = rand() * Math.PI * 2;
        const d = 110 + rand() * (SIZE * 0.34);
        x = Math.cos(a) * d; z = Math.sin(a) * d;
        if (lakes.some(lk => Math.hypot(x - lk.x, z - lk.z) < lk.r + 24)) continue;
        break;
      }
      // payload: spare parts always, plus a themed bonus / ration bonus
      const payload = { parts: 1 + Math.floor(rand() * 2) };
      const r = rand();
      if (th.cacheExtra && r < 0.7) payload[th.cacheExtra] = 3 + Math.floor(rand() * 4);
      else if (r < 0.9) payload.food = 2 + Math.floor(rand() * 3);
      const pos = new THREE.Vector3(x, this.heightAt(x, z), z);
      const g = this._makeCrate(pos, 1.5, 0xffd97a, 'rgba(255,217,122,0.95)', 'rgba(255,150,50,0.35)', 5.5);
      this.scene.add(g);
      this.caches.push({ group: g, pos: pos.clone(), taken: false, payload, radius: CACHE_RANGE_VEHICLE });
    }
  }

  /** Crate + beacon + glow. Returns the group (caller adds it to the scene). */
  _makeCrate(pos, scale, color, g1, g2, glowSize) {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.2), this._material(color, 0.5, 0.55));
    box.position.y = 0.55;
    g.add(box);
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.18, 1.24), this._material(0x3c4650, 0.6, 0.4));
    band.position.y = 0.82;
    g.add(band);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.4, 6), this._material(0x8a94a4, 0.5, 0.6));
    pole.position.set(0.7, 1.7, 0.5);
    g.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this._material(0xffffff, 0.2, 0.2));
    lamp.material.emissive = new THREE.Color(color);
    lamp.material.emissiveIntensity = 1.4;
    lamp.position.set(0.7, 3.5, 0.5);
    g.add(lamp);
    const glow = this._glowSprite(g1, g2, glowSize);
    glow.position.y = 2.2;
    g.add(glow);
    g.position.copy(pos);
    g.scale.setScalar(scale);
    g.rotation.y = Math.random() * Math.PI * 2;
    return g;
  }

  nearestCache(x, z, range) {
    let best = null, bestD = Infinity;
    for (let i = 0; i < this.caches.length; i++) {
      const c = this.caches[i];
      if (c.taken) continue;
      const d = Math.hypot(c.pos.x - x, c.pos.z - z);
      if (d < range && d < bestD) { best = { i, d, meta: c }; bestD = d; }
    }
    return best;
  }

  takeCache(i) {
    const c = this.caches[i];
    if (!c || c.taken) return null;
    c.taken = true;
    c.group.visible = false;
    return c.payload;
  }

  // ------------------------------------------------ SAMPLE SITE
  _buildSampleSite() {
    const rand = mulberry32(this.seedBase + 1701);
    const a = rand() * Math.PI * 2;
    const d = 80 + rand() * 40;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const g = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 4.4, 8), this._material(0xb8c4d0, 0.4, 0.6));
    mast.position.y = 2.2;
    g.add(mast);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.4), this._material(0xe8ecf2, 0.3, 0.7));
    dish.position.y = 4.5;
    dish.rotation.x = -0.7;
    g.add(dish);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), this._material(0x4fd0a0, 0.2, 0.3));
    lens.material.emissive = new THREE.Color(0x4fd0a0);
    lens.material.emissiveIntensity = 1.1;
    lens.position.y = 4.6;
    g.add(lens);
    const glow = this._glowSprite('rgba(120,255,200,0.9)', 'rgba(60,180,120,0.3)', 7);
    glow.position.y = 4.8;
    g.add(glow);
    g.position.set(x, this.heightAt(x, z), z);
    this.scene.add(g);
    const label = this._makeLabel('SAMPLE SITE', '#7dffb0');
    label.scale.set(14, 2.8, 1);
    label.position.set(x, g.position.y + 9, z);
    this.scene.add(label);
    this.sampleSite = { pos: new THREE.Vector3(x, g.position.y, z), group: g, collected: false, radius: 12 };
  }

  // ------------------------------------------------ EARTH SUPPLY DELIVERIES
  /** Hash an order id to a stable pickup spot near the outpost. */
  _deliveryPos(orderId) {
    let h = 2166136261;
    for (let i = 0; i < orderId.length; i++) { h ^= orderId.charCodeAt(i); h = Math.imul(h, 16777619); }
    const a = ((h >>> 0) % 10000) / 10000 * Math.PI * 2;
    const d = 26 + (((h >>> 8) % 1000) / 1000) * 34;
    return new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
  }

  /** A supply crate from Earth has landed. (order: {id, item, qty}) */
  addDelivery(order) {
    const p = this._deliveryPos(order.id);
    p.y = this.heightAt(p.x, p.z);
    const g = this._makeCrate(p, 1.9, 0x6ec6ff, 'rgba(120,200,255,0.95)', 'rgba(60,140,255,0.4)', 8);
    this.scene.add(g);
    const label = this._makeLabel('EARTH SUPPLY — ' + order.item.toUpperCase() + ' ×' + order.qty, '#7ec8ff');
    label.scale.set(16, 3, 1);
    label.position.set(p.x, p.y + 7, p.z);
    this.scene.add(label);
    this.deliveries.push({ order, group: g, label, pos: p.clone(), taken: false, radius: CACHE_RANGE_VEHICLE });
    return this.deliveries[this.deliveries.length - 1];
  }
  get deliveries() { return this._deliveries || (this._deliveries = []); }

  nearestDelivery(x, z, range) {
    let best = null, bestD = Infinity;
    for (let i = 0; i < this.deliveries.length; i++) {
      const c = this.deliveries[i];
      if (c.taken) continue;
      const d = Math.hypot(c.pos.x - x, c.pos.z - z);
      if (d < range && d < bestD) { best = { i, d, meta: c }; bestD = d; }
    }
    return best;
  }

  takeDelivery(i) {
    const c = this.deliveries[i];
    if (!c || c.taken) return null;
    c.taken = true;
    c.group.visible = false;
    c.label.visible = false;
    return c.order;
  }

  // ------------------------------------------------ ASTRONAUT (foot mode)
  _buildAstronaut() {
    const g = new THREE.Group();
    const suit = this._material(0xe8ecf2, 0.5, 0.2);
    const suitDark = this._material(0x8a94a4, 0.6, 0.3);
    const pack = this._material(0x4a5568, 0.7, 0.4);
    const visor = this._material(0x16242f, 0.15, 0.85);
    visor.emissive = new THREE.Color(0x2a7a9a);
    visor.emissiveIntensity = 0.7;
    const accent = this._material(0xff6a3a, 0.5, 0.3);

    // NOTE ON ORIENTATION: the astronaut walks toward -Z (see `facing`,
    // computed as atan2(-vx, -vz)), so the FRONT of the suit is -Z and the
    // back is +Z. The original build had the visor and chest pack on +Z and
    // the backpack on -Z, i.e. the helmet's face was on the back of the head:
    // walking toward the camera you saw a blank white sphere, and the visor
    // stared backwards. Every part below is placed front = -Z.
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.55, 4, 10), suit);
    torso.position.y = 1.18;
    g.add(torso);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.14), pack);
    chest.position.set(0, 1.3, -0.4);           // control panel on the CHEST
    g.add(chest);
    const chestLight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), accent);
    chestLight.position.set(0.14, 1.32, -0.48);
    g.add(chestLight);
    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.78, 0.3), pack);
    backpack.position.set(0, 1.25, 0.42);        // life support on the BACK
    g.add(backpack);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.5, 8), suitDark);
    tank.position.set(0, 1.35, 0.62);
    g.add(tank);

    // ---- head ----
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.31, 18, 14), suit);
    helmet.position.y = 1.92;
    g.add(helmet);

    // The visor is a spherical CAP carved out of the helmet front rather than
    // a squashed sphere jammed through it — that intersection was what made
    // the face read as a smeared white blob at any distance.
    const visorGeo = new THREE.SphereGeometry(
      0.315, 20, 14,
      Math.PI * 0.5, Math.PI,          // horizontal sweep: the front half
      Math.PI * 0.22, Math.PI * 0.52   // vertical band: brow to chin
    );
    const visorMesh = new THREE.Mesh(visorGeo, visor);
    visorMesh.position.y = 1.92;
    visorMesh.rotation.y = Math.PI;    // sweep faces -Z (forward)
    g.add(visorMesh);

    // gold reflective sheen across the visor so the face catches the light
    const sheen = new THREE.Mesh(
      new THREE.SphereGeometry(0.322, 20, 10, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.3, Math.PI * 0.16),
      new THREE.MeshStandardMaterial({
        color: 0xffd58a, roughness: 0.12, metalness: 0.9,
        transparent: true, opacity: 0.35
      })
    );
    sheen.position.y = 1.92;
    sheen.rotation.y = Math.PI;
    g.add(sheen);

    // helmet trim ring + neck seal so the head joins the body cleanly
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 22), suitDark);
    trim.position.y = 1.92;
    trim.rotation.x = Math.PI / 2;
    g.add(trim);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.16, 12), suitDark);
    neck.position.y = 1.66;
    g.add(neck);

    // helmet lamps — two small emissive pods, unmistakably the front
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff3d0, emissive: new THREE.Color(0xffe6a8), emissiveIntensity: 1.4, roughness: 0.3
    });
    for (const sx of [-0.22, 0.22]) {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.09, 8), lampMat);
      lamp.position.set(sx, 2.02, -0.2);
      lamp.rotation.x = Math.PI / 2;
      g.add(lamp);
    }
    // antenna on the back of the helmet
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), suitDark);
    ant.position.set(0.16, 2.18, 0.18);
    ant.rotation.z = -0.3;
    g.add(ant);

    const mkLimb = (w0, l0, w1, l1) => {
      const upper = new THREE.Mesh(new THREE.BoxGeometry(w0, l0, w0), suit);
      upper.position.y = -l0 / 2;
      const lower = new THREE.Mesh(new THREE.BoxGeometry(w1, l1, w1), suitDark);
      lower.position.y = -l0 - l1 / 2 + 0.04;
      const grp = new THREE.Group();
      grp.add(upper, lower);
      return grp;
    };
    const lLeg = mkLimb(0.19, 0.46, 0.17, 0.42); lLeg.position.set(-0.2, 0.92, 0); g.add(lLeg);
    const rLeg = mkLimb(0.19, 0.46, 0.17, 0.42); rLeg.position.set(0.2, 0.92, 0); g.add(rLeg);
    const lArm = mkLimb(0.15, 0.4, 0.13, 0.36); lArm.position.set(-0.52, 1.52, 0); g.add(lArm);
    const rArm = mkLimb(0.15, 0.4, 0.13, 0.36); rArm.position.set(0.52, 1.52, 0); g.add(rArm);

    g.visible = false;
    this.scene.add(g);
    this.astro = { group: g, lLeg, rLeg, lArm, rArm, torso };
  }

  /** Step out of the current vehicle onto the surface in the EVA suit. */
  enterFoot(fromPos) {
    this.vehicleMode = 'foot';
    const fs = this.footState;
    const src = fromPos || this._lastVehiclePos || this.shipState.position;
    fs.position.set(src.x, this.heightAt(src.x, src.z) + 0.1, src.z);
    fs.velocity.set(0, 0, 0);
    fs.grounded = true;
    fs.camYaw = this.yaw;
    fs.facing = this.yaw;
    this._lastVehiclePos = { x: src.x, z: src.z };
    if (this.astro) this.astro.group.visible = true;
  }

  /** Jump velocity for ~JUMP_HEIGHT metres under this body's gravity. */
  jumpVel() { return Math.sqrt(2 * this.gravAccel * JUMP_HEIGHT); }

  // ------------------------------------------------ DISTANCES
  baseDistance(x, z) { return Math.hypot(this.basePos.x - x, this.basePos.z - z); }
  shuttleDistance(x, z) { return Math.hypot(this.shipState.position.x - x, this.shipState.position.z - z); }
  roverDistance(x, z) { return Math.hypot(this.roverState.position.x - x, this.roverState.position.z - z); }
  sampleDistance(x, z) { return Math.hypot(this.sampleSite.pos.x - x, this.sampleSite.pos.z - z); }

  /** Board the rover (called from Game). `fromPos` marks where the astronaut was. */
  enterRover(fromPos) {
    this.vehicleMode = 'rover';
    const ship = this.shipState.position;
    const r = this.roverState;
    r.speed = 0;
    r.velocity.set(0, 0, 0);
    if (fromPos) r.heading = Math.atan2(-(fromPos.x - r.position.x), -(fromPos.z - r.position.z));
    else r.heading = Math.atan2(-(ship.x - r.position.x), -(ship.z - r.position.z));
    const src = fromPos || ship;
    this._lastVehiclePos = { x: src.x, z: src.z };
    if (this.astro) this.astro.group.visible = false;
  }

  /** Park the rover / step out and board the shuttle. */
  enterShuttle(fromPos) {
    this.vehicleMode = 'shuttle';
    const r = this.roverState;
    r.speed = 0;
    r.velocity.set(0, 0, 0);
    const src = fromPos || this.shipState.position;
    this._lastVehiclePos = { x: src.x, z: src.z };
    if (this.astro) this.astro.group.visible = false;
  }

  /** Bilinear height sample in world XZ. */
  heightAt(x, z) {
    const half = SIZE / 2;
    const gx = clamp((x + half) / SIZE * SEG, 0, SEG);
    const gz = clamp((z + half) / SIZE * SEG, 0, SEG);
    const x0 = Math.floor(gx), z0 = Math.floor(gz);
    const fx = gx - x0, fz = gz - z0;
    const idx = (xx, zz) => clamp(zz, 0, SEG) * (SEG + 1) + clamp(xx, 0, SEG);
    const h00 = this.heights[idx(x0, z0)], h10 = this.heights[idx(x0 + 1, z0)];
    const h01 = this.heights[idx(x0, z0 + 1)], h11 = this.heights[idx(x0 + 1, z0 + 1)];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  get altitude() {
    return this.shipState.position.y - this.heightAt(this.shipState.position.x, this.shipState.position.z);
  }

  /** World position of the player's current vehicle (shuttle / rover / boots). */
  playerPos() {
    if (this.vehicleMode === 'rover') return this.roverState.position;
    if (this.vehicleMode === 'foot') return this.footState.position;
    return this.shipState.position;
  }

  /**
   * @param dt real dt
   * @param input from ShipController.sample()
   * @param camera the shared game camera (positioned here)
   * @param hooks {fuelAvailable, onCrash, onLeave}
   */
  update(dt, input, camera, hooks) {
    if (this.vehicleMode === 'rover') this._updateRover(dt, input, camera);
    else if (this.vehicleMode === 'foot') this._updateFoot(dt, input, camera);
    else this._updateShuttle(dt, input, camera, hooks);
    // Generate/erase world objects around wherever the player ended up.
    this._updateStreaming();
  }

  _updateShuttle(dt, input, camera, hooks) {
    const st = this.shipState;
    this.yaw -= (input.yawDelta || 0);
    this.pitch = clamp(this.pitch - (input.pitchDelta || 0), -1.2, 0.5);

    st.quaternion.setFromEuler(new THREE.Euler(0, this.yaw, 0));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const hasFuel = hooks.fuelAvailable();
    const thrust = 30;
    if (hasFuel) {
      if (input.throttleF) st.velocity.addScaledVector(fwd, input.throttleF * thrust * dt);
      if (input.strafe) st.velocity.addScaledVector(right, input.strafe * thrust * 0.7 * dt);
      if (input.vert > 0) { st.velocity.y += thrust * 1.15 * dt; this.landed = false; }
      if (input.vert < 0) st.velocity.y -= thrust * 0.7 * dt;
    }
    st.velocity.y -= this.gravAccel * dt;
    st.velocity.multiplyScalar(Math.max(0, 1 - 0.65 * dt));
    st.position.addScaledVector(st.velocity, dt);
    st.speed = st.velocity.length();

    const lim = SIZE * 0.46;
    st.position.x = clamp(st.position.x, -lim, lim);
    st.position.z = clamp(st.position.z, -lim, lim);

    const ground = this.heightAt(st.position.x, st.position.z);
    const alt = st.position.y - ground;
    if (alt < 1.4) {
      st.position.y = ground + 1.4;
      const vImpact = -st.velocity.y;
      st.velocity.y = Math.max(0, st.velocity.y);
      st.velocity.x *= 0.6; st.velocity.z *= 0.6;
      const horiz = Math.hypot(st.velocity.x, st.velocity.z);
      if (vImpact > 9 || horiz > 14) {
        hooks.onCrash(vImpact * 2 + horiz);
      } else {
        this.landed = true;
      }
    } else if (alt > 3) {
      this.landed = false;
    }

    if (alt > 160 && hooks.onLeave) hooks.onLeave();

    this.ship.group.position.copy(st.position);
    this.ship.group.quaternion.copy(st.quaternion);
    const thrusting = input.throttleF !== 0 || (input.vert || 0) > 0;
    const flameScale = thrusting ? 0.9 + Math.random() * 0.4 : 0.001;
    this.ship.flame.scale.setScalar(flameScale);
    this.ship.engineLight.intensity = thrusting ? 2.2 : 0;

    const camDist = 11, camHeight = 4.2;
    const cp = new THREE.Vector3(
      st.position.x + Math.sin(this.yaw) * camDist * Math.cos(this.pitch) + 0,
      st.position.y + camHeight - Math.sin(this.pitch) * camDist,
      st.position.z + Math.cos(this.yaw) * camDist * Math.cos(this.pitch)
    );
    cp.y = Math.max(cp.y, this.heightAt(cp.x, cp.z) + 1.6);
    camera.position.lerp(cp, 1 - Math.pow(0.0001, dt));
    camera.lookAt(st.position.x, st.position.y + 1.2, st.position.z);
  }

  _updateRover(dt, input, camera) {
    const r = this.roverState;
    const throttle = clamp((input.throttleF || 0), -1, 1);
    const steer = clamp((input.strafe || 0), -1, 1) - (input.yawDelta || 0) * 1.2;
    const maxSpeed = this.id === 'mars' ? 30 : 26;
    const accel = throttle * 22;

    r.speed += accel * dt;
    r.speed -= r.speed * (throttle === 0 ? 2.0 : 0.55) * dt;
    r.speed = clamp(r.speed, -maxSpeed * 0.5, maxSpeed);
    // BRAKE (B) acts as a handbrake on the surface rover
    if (input.brake) r.speed -= r.speed * 4 * dt;

    const steerRate = 1.7;
    r.heading -= steer * steerRate * dt * (Math.abs(r.speed) / maxSpeed + 0.15);

    const fwd = new THREE.Vector3(-Math.sin(r.heading), 0, -Math.cos(r.heading));
    r.position.addScaledVector(fwd, r.speed * dt);
    r.velocity.copy(fwd).multiplyScalar(r.speed);

    const lim = SIZE * 0.46;
    r.position.x = clamp(r.position.x, -lim, lim);
    r.position.z = clamp(r.position.z, -lim, lim);
    const newGround = this.heightAt(r.position.x, r.position.z);
    r.position.y += (newGround + 1.2 - r.position.y) * Math.min(1, 14 * dt);

    const grp = this.rover.group;
    grp.position.copy(r.position);
    grp.rotation.y = r.heading;
    grp.rotation.z = clamp(steer * 0.28, -0.3, 0.3);
    const spin = r.speed * 1.6 * dt;
    for (const w of this.rover.wheels) w.rotation.x += spin;

    const camDist = 13, camHeight = 6;
    const cp = new THREE.Vector3(
      r.position.x - fwd.x * camDist,
      r.position.y + camHeight,
      r.position.z - fwd.z * camDist
    );
    cp.y = Math.max(cp.y, this.heightAt(cp.x, cp.z) + 1.6);
    camera.position.lerp(cp, 1 - Math.pow(0.0001, dt));
    camera.lookAt(r.position.x, r.position.y + 1.4, r.position.z);
  }

  // ------------------------------------------------ ASTRONAUT UPDATE
  _updateFoot(dt, input, camera) {
    const fs = this.footState;
    fs.camYaw -= (input.yawDelta || 0);
    fs.camPitch = clamp(fs.camPitch - (input.pitchDelta || 0), -1.05, 1.25);

    const fx = -Math.sin(fs.camYaw), fz = -Math.cos(fs.camYaw);
    const rx = Math.cos(fs.camYaw), rz = -Math.sin(fs.camYaw);
    let mx = fx * (input.throttleF || 0) + rx * (input.strafe || 0);
    let mz = fz * (input.throttleF || 0) + rz * (input.strafe || 0);
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }

    const maxSp = input.boost ? FOOT_SPRINT : FOOT_SPEED;
    const accel = 40;
    fs.velocity.x += mx * accel * dt;
    fs.velocity.z += mz * accel * dt;
    const damp = (mx || mz) ? 1.4 : 7;
    fs.velocity.x -= fs.velocity.x * damp * dt;
    fs.velocity.z -= fs.velocity.z * damp * dt;
    let sp = Math.hypot(fs.velocity.x, fs.velocity.z);
    if (sp > maxSp) { fs.velocity.x *= maxSp / sp; fs.velocity.z *= maxSp / sp; sp = maxSp; }

    // JUMP (Space / touch JUMP): impulse scaled by local gravity
    if ((input.vert || 0) > 0 && fs.grounded) {
      fs.velocity.y = this.jumpVel();
      fs.grounded = false;
    }
    fs.velocity.y -= this.gravAccel * dt;

    const prevX = fs.position.x, prevZ = fs.position.z;
    fs.position.x += fs.velocity.x * dt;
    fs.position.z += fs.velocity.z * dt;
    fs.position.y += fs.velocity.y * dt;

    const lim = SIZE * 0.46;
    fs.position.x = clamp(fs.position.x, -lim, lim);
    fs.position.z = clamp(fs.position.z, -lim, lim);

    const ground = this.heightAt(fs.position.x, fs.position.z) + 0.02;
    // steep slopes slow the boots down (cliff guard)
    const step = Math.hypot(fs.position.x - prevX, fs.position.z - prevZ);
    const slope = step > 0.0001 ? Math.abs(ground - (fs.position.y - fs.velocity.y * dt)) / step : 0;
    const slopeScale = clamp(1.15 - slope, 0.2, 1);
    if (sp > 0) {
      fs.position.x = prevX + (fs.position.x - prevX) * slopeScale;
      fs.position.z = prevZ + (fs.position.z - prevZ) * slopeScale;
    }
    if (fs.position.y <= ground) {
      fs.position.y = ground;
      fs.velocity.y = Math.max(0, fs.velocity.y);
      fs.grounded = true;
    } else if (fs.position.y > ground + 0.35) {
      fs.grounded = false;
    }

    // body faces travel direction (smoothed)
    if (sp > 0.6) {
      const target = Math.atan2(-fs.velocity.x, -fs.velocity.z);
      let dAng = target - fs.facing;
      while (dAng > Math.PI) dAng -= Math.PI * 2;
      while (dAng < -Math.PI) dAng += Math.PI * 2;
      fs.facing += dAng * Math.min(1, 12 * dt);
    }
    // walk cycle
    if (fs.grounded && sp > 0.4) fs.walkPhase += sp * dt * 1.75;
    const a = this.astro;
    if (a) {
      a.group.position.copy(fs.position);
      a.group.rotation.y = fs.facing;
      const swing = fs.grounded ? Math.sin(fs.walkPhase) * clamp(sp / FOOT_SPEED, 0, 1) * 0.65 : 0.5;
      a.lLeg.rotation.x = swing;
      a.rLeg.rotation.x = -swing;
      a.lArm.rotation.x = -swing * 0.8;
      a.rArm.rotation.x = swing * 0.8;
      a.torso.position.y = 1.18 + (fs.grounded ? Math.abs(Math.cos(fs.walkPhase)) * 0.05 : 0);
    }

    // third-person camera over the shoulder
    const cd = 5.4, camHeight = 2.1;
    const cp = new THREE.Vector3(
      fs.position.x + Math.sin(fs.camYaw) * cd * Math.cos(fs.camPitch),
      fs.position.y + camHeight - Math.sin(fs.camPitch) * cd,
      fs.position.z + Math.cos(fs.camYaw) * cd * Math.cos(fs.camPitch)
    );
    cp.y = Math.max(cp.y, this.heightAt(cp.x, cp.z) + 0.9);
    camera.position.lerp(cp, 1 - Math.pow(0.00005, dt));
    camera.lookAt(fs.position.x, fs.position.y + 1.55, fs.position.z);
  }

  /** Sample collection rewards per world (theme-based). */
  collectRewards() {
    return this.theme.rewards || { iron: 10, rare: 1 };
  }

  dispose() {
    this.streamer?.clear();
    this._propGeo?.dispose?.();
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      }
    });
  }
}
