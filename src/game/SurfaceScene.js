// SurfaceScene — explorable procedural planetary surface for landable
// bodies (Earth, Moon, Mars). Heightfield terrain, props, local gravity,
// gentle hover-flight + touchdown detection + sample collection.
import * as THREE from 'three';
import { ValueNoise, fbm, mulberry32, clamp } from '../utils/Noise.js';
import { getGlowTexture } from '../planets/ProceduralTextures.js';
import { buildShipMesh } from '../spacecraft/Ship.js';

const SIZE = 900;
const SEG = 88;

export class SurfaceScene {
  constructor(bodyCfg, quality) {
    this.cfg = bodyCfg;
    this.id = bodyCfg.id;
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.gravAccel = 3.4 * Math.sqrt(bodyCfg.gravity || 0.3);

    // ship state
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

    const seedBase = this.id === 'moon' ? 900 : this.id === 'mars' ? 901 : 902;
    this._noiseA = new ValueNoise(seedBase);
    this._noiseB = new ValueNoise(seedBase + 31);
    this._craterRand = mulberry32(seedBase + 77);
    this._craters = [];
    if (this.id !== 'earth') {
      for (let i = 0; i < 26; i++) {
        this._craters.push({
          x: (this._craterRand() - 0.5) * SIZE,
          z: (this._craterRand() - 0.5) * SIZE,
          r: 12 + this._craterRand() * 42
        });
      }
    }

    this._buildTerrain();
    this._buildSky();
    this._buildProps();
    this.scene.add(this.ship.group);
  }

  _heightRaw(x, z) {
    // noise objects are hoisted (built once in ctor) — critical for perf
    const n = this._noiseA, n2 = this._noiseB;
    const u = x / SIZE * 8 + 10, v = z / SIZE * 8 + 10;
    let h = fbm(n, u, v, 5) * 2 - 1;
    if (this.id === 'mars') h = Math.pow(Math.abs(h), 0.8) * (h > 0 ? 1 : -1); // ridged mountains
    h += fbm(n2, u * 3.1, v * 3.1, 3) * 0.25;
    const amp = this.id === 'earth' ? 11 : this.id === 'mars' ? 22 : 7;
    let height = h * amp + amp * 0.35;
    // craters for the Moon (and a few on Mars)
    if (this._craters.length) {
      for (const cr of this._craters) {
        const dx = x - cr.x, dz = z - cr.z;
        const r = cr.r;
        const d = Math.hypot(dx, dz);
        if (d < r) {
          const t = d / r;
          const bowl = (1 - t * t) * -r * 0.22;
          const rim = Math.exp(-Math.pow((t - 0.85) * 6, 2)) * r * 0.09;
          height += bowl + rim;
        }
      }
    }
    return height;
  }

  _buildTerrain() {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    this.heights = new Float32Array((SEG + 1) * (SEG + 1));
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const noise = new ValueNoise(555);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this._heightRaw(x, z);
      pos.setY(i, h);
      this.heights[i] = h;
      // vertex coloring per body
      if (this.id === 'earth') {
        if (h < 0.6) c.setHex(0xc2b280);
        else if (h < 5) c.setHex(0x3f7a34);
        else if (h < 9) c.setHex(0x5d6b46);
        else if (h < 13) c.setHex(0x6e6a63);
        else c.setHex(0xe8ecef);
      } else if (this.id === 'mars') {
        const t = clamp((h + 8) / 30, 0, 1);
        c.setHex(0x8a3018).lerp(new THREE.Color(0xd88a5a), t);
        if (h > 16) c.lerp(new THREE.Color(0xf0e0d8), 0.5);
      } else {
        const g = 0.42 + fbm(noise, x / 40, z / 40, 2) * 0.22;
        c.setRGB(g, g, g * 1.02);
      }
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    this.terrain = new THREE.Mesh(geo, mat);
    this.scene.add(this.terrain);

    if (this.id === 'earth') {
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(SIZE * 1.6, SIZE * 1.6),
        new THREE.MeshStandardMaterial({
          color: 0x1a5f9e, transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.4
        })
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.55;
      this.scene.add(water);
    }
  }

  _buildSky() {
    // stars
    const rand = mulberry32(31415);
    const n = 1400;
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

    // sun light + glow
    const sunDir = new THREE.Vector3(0.5, 0.55, -0.4).normalize();
    const dir = new THREE.DirectionalLight(0xfff2dc, this.id === 'moon' ? 2.6 : 2.2);
    dir.position.copy(sunDir).multiplyScalar(500);
    this.scene.add(dir);
    this.scene.add(new THREE.AmbientLight(this.id === 'mars' ? 0x664433 : 0x445566, this.id === 'earth' ? 0.8 : 0.35));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture('rgba(255,244,200,1)', 'rgba(255,190,90,0.4)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    glow.position.copy(sunDir).multiplyScalar(2600);
    glow.scale.setScalar(900);
    this.scene.add(glow);

    // atmosphere haze
    if (this.id === 'earth') this.scene.fog = new THREE.FogExp2(0x8db8e0, 0.0011);
    else if (this.id === 'mars') this.scene.fog = new THREE.FogExp2(0xc47a4a, 0.0015);
  }

  _buildProps() {
    const rand = mulberry32(this.id === 'mars' ? 61 : 62);
    const count = this.quality === 'low' ? 40 : 90;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: this.id === 'mars' ? 0x7a3a20 : this.id === 'earth' ? 0x4a5240 : 0x5a5a58,
      roughness: 0.95, flatShading: true
    });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const d = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const x = (rand() - 0.5) * SIZE * 0.9, z = (rand() - 0.5) * SIZE * 0.9;
      const s = 0.6 + rand() * 2.6;
      d.position.set(x, this.heightAt(x, z) + s * 0.2, z);
      d.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      d.scale.setScalar(s);
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
    }
    this.scene.add(inst);
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

  /**
   * @param dt real dt
   * @param input from ShipController.sample()
   * @param camera the shared game camera (positioned here)
   * @param hooks {onCollect, onCrash, onLeave}
   */
  update(dt, input, camera, hooks) {
    const st = this.shipState;
    // yaw/pitch from look input
    this.yaw -= (input.yawDelta || 0);
    this.pitch = clamp(this.pitch - (input.pitchDelta || 0), -1.2, 0.5);

    // orientation: hover-ship stays upright, banks slightly
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
    // gravity + drag
    st.velocity.y -= this.gravAccel * dt;
    st.velocity.multiplyScalar(Math.max(0, 1 - 0.65 * dt));
    st.position.addScaledVector(st.velocity, dt);
    st.speed = st.velocity.length();

    // keep inside the map
    const lim = SIZE * 0.46;
    st.position.x = clamp(st.position.x, -lim, lim);
    st.position.z = clamp(st.position.z, -lim, lim);

    // ground collision
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

    // fly back to space
    if (alt > 160 && hooks.onLeave) hooks.onLeave();

    // ship visual
    this.ship.group.position.copy(st.position);
    this.ship.group.quaternion.copy(st.quaternion);
    const thrusting = input.throttleF !== 0 || (input.vert || 0) > 0;
    const flameScale = thrusting ? 0.9 + Math.random() * 0.4 : 0.001;
    this.ship.flame.scale.setScalar(flameScale);
    this.ship.engineLight.intensity = thrusting ? 2.2 : 0;

    // chase camera
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

  /** Sample collection rewards per body. */
  collectRewards() {
    return this.id === 'earth' ? { water: 12, rare: 1 }
      : this.id === 'moon' ? { iron: 14, rare: 2 }
        : { iron: 10, ice: 8, rare: 1 };
  }

  dispose() {
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      }
    });
  }
}
