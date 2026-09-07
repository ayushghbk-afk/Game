// SurfaceScene — explorable procedural planetary surface for landable
// bodies (Earth, Moon, Mars). Heightfield terrain, a planetary OUTPOST
// (where the astronaut lives, eats and works), a drivable ROVER, and
// scattered BROKEN ROVERS to find and repair for credits.
//
// The scene stays decoupled from GameState: it purely tracks geometry,
// vehicle state and proximity — the Game orchestrates economy/jobs and
// feeds it inputs + hooks.
import * as THREE from 'three';
import { ValueNoise, fbm, mulberry32, clamp } from '../utils/Noise.js';
import { getGlowTexture } from '../planets/ProceduralTextures.js';
import { buildShipMesh } from '../spacecraft/Ship.js';

const SIZE = 900;
const SEG = 88;
const BASE_RANGE = 46;         // how close you must be to enter the outpost
const ROVER_RANGE = 34;        // how close to a broken rover you must be to repair
const SHUTTLE_RANGE = 30;      // how close to the parked shuttle to re-board it

export class SurfaceScene {
  constructor(bodyCfg, quality) {
    this.cfg = bodyCfg;
    this.id = bodyCfg.id;
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.gravAccel = 3.4 * Math.sqrt(bodyCfg.gravity || 0.3);

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

    // vehicle the astronaut is currently driving: 'shuttle' | 'rover'
    this.vehicleMode = 'shuttle';

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
    this._buildBase();
    this._buildRover();
    this._buildBrokenRovers();
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

  // ------------------------------------------------ OUTPOST / BASE
  _material(color, rough = 0.6, metal = 0.5) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  }

  _buildBase() {
    this.baseGroup = new THREE.Group();
    // sit the outpost on the ground near origin
    const bPos = new THREE.Vector3(0, 0, 0);
    const ground = this.heightAt(bPos.x, bPos.z);
    bPos.y = ground;
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

    // landing pad (flat disc)
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 0.6, 24), padMat);
    pad.position.y = 0.3;
    base.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(15, 0.35, 8, 40), accentMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.62;
    base.add(ring);

    // habitat dome
    const dome = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hullMat);
    dome.position.y = 0.2;
    base.add(dome);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.4, 1.2, 20, 1, true), darkMat);
    rim.position.y = 0.6;
    base.add(rim);
    // window band (glow)
    const winMat = this._material(0x9fe8c0, 0.3, 0.2);
    winMat.emissive = new THREE.Color(0x4fd0a0);
    winMat.emissiveIntensity = 0.9;
    const windows = new THREE.Mesh(new THREE.CylinderGeometry(5.9, 5.9, 1.1, 20, 1, true), winMat);
    windows.position.y = 2.2;
    base.add(windows);
    // airlock tube
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 4, 12), darkMat);
    tube.rotation.z = Math.PI / 2;
    tube.position.set(6.8, 1.2, 0);
    base.add(tube);
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.5, 12), accentMat);
    hatch.rotation.z = Math.PI / 2;
    hatch.position.set(9, 1.2, 0);
    base.add(hatch);

    // antenna mast
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 9, 8), darkMat);
    mast.position.set(-5, 4.5, -4);
    base.add(mast);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), winMat);
    beacon.position.set(-5, 9.2, -4);
    base.add(beacon);
    this.beacon = beacon;

    // solar array
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

    base.scale.setScalar(1);
    this.baseGroup.add(base);
    this.scene.add(this.baseGroup);

    // friendly label sprite
    const label = this._makeLabel(this.cfg.name + ' OUTPOST');
    label.position.copy(bPos).add(new THREE.Vector3(0, 15, 0));
    this.scene.add(label);
  }

  _makeLabel(text) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(8,14,26,0.72)';
    ctx.roundRect?.(4, 12, 504, 72, 16);
    ctx.fill();
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#9fd8ff';
    ctx.fillText(text, 256, 50, 480);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.scale.set(16, 3, 1);
    return s;
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
    // antenna on the back
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 6), darkMat);
    ant.position.set(1.2, 2.6, 0);
    visual.add(ant);
    const antLight = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), this._material(0xffb347, 0.3, 0.2));
    antLight.material.emissive = new THREE.Color(0xff8c2a);
    antLight.material.emissiveIntensity = 0.8;
    antLight.position.set(1.2, 3.8, 0);
    visual.add(antLight);
    // front sensor mast
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), darkMat);
    mast.rotation.z = -0.5;
    mast.position.set(-1.8, 2.0, 0);
    visual.add(mast);

    // wheels
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
    const rand = mulberry32(this.id === 'mars' ? 700 : this.id === 'moon' ? 701 : 702);
    const count = this.quality === 'low' ? 5 : 8;
    this.brokenRovers = [];
    for (let i = 0; i < count; i++) {
      // scatter away from the base so you must drive out to find them
      let x = 0, z = 0;
      for (let tries = 0; tries < 24; tries++) {
        x = (rand() - 0.5) * SIZE * 0.86;
        z = (rand() - 0.5) * SIZE * 0.86;
        if (Math.hypot(x - 0, z) > 90 && Math.hypot(x, z) < SIZE * 0.42) break;
      }
      const g = this.heightAt(x, z);
      const rover = this._makeRoverMesh(0x7a8594);
      // wreck it: tilt, remove a wheel, sink one corner
      rover.visual.rotation.set(0.25, rand() * Math.PI * 2, 0.4 + rand() * 0.3);
      rover.visual.rotation.z = 0.5 + rand() * 0.2;
      rover.visual.scale.setScalar(0.96);
      if (rover.wheels.length > 0) rover.wheels[0].visible = false; // missing wheel
      const group = rover.group;
      group.position.set(x, g + 0.6, z);
      group.scale.setScalar(0.94);
      this.scene.add(group);
      this.brokenRovers.push({
        group, pos: group.position.clone(), fixed: false,
        radius: ROVER_RANGE, baseColor: 0x7a8594
      });
    }
  }

  /** Mark a broken rover repaired: straighten it and give it a working look. */
  fixRover(index) {
    const r = this.brokenRovers[index];
    if (!r || r.fixed) return false;
    r.fixed = true;
    r.group.scale.setScalar(1);
    r.group.rotation.set(0, 0, 0);
    r.group.children[0].rotation.set(0, 0, 0);
    r.group.children[0].scale.setScalar(1);
    // recolor the hull to a freshly-repaired look
    const mats = [];
    r.group.traverse(o => { if (o.isMesh) mats.push(o.material); });
    for (const m of mats) {
      if (m && m.color && typeof m.color.getHex === 'function' && m.color.getHex() === r.baseColor) {
        m.color.setHex(0xff6a3a);
      }
    }
    return true;
  }

  /** Nearest broken (unrepaired) rover within interact range of a point. */
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

  /** Distance from a point to the outpost centre. */
  baseDistance(x, z) { return Math.hypot(this.basePos.x - x, this.basePos.z - z); }

  /** Distance from a point to the parked shuttle. */
  shuttleDistance(x, z) { return Math.hypot(this.shipState.position.x - x, this.shipState.position.z - z); }

  /** Distance from a point to the rover. */
  roverDistance(x, z) { return Math.hypot(this.roverState.position.x - x, this.roverState.position.z - z); }

  /** Switch to driving the rover (called from Game when boarding). */
  enterRover() {
    // take the astronaut's current spot into the rover's seat
    this.vehicleMode = 'rover';
    const ship = this.shipState.position;
    const r = this.roverState;
    r.speed = 0;
    r.velocity.set(0, 0, 0);
    // head the rover toward where the shuttle was
    r.heading = Math.atan2(-(ship.x - r.position.x), -(ship.z - r.position.z));
  }

  /** Park the rover and switch back to the shuttle. */
  enterShuttle() {
    this.vehicleMode = 'shuttle';
    const r = this.roverState;
    r.speed = 0;
    r.velocity.set(0, 0, 0);
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
   * @param hooks {fuelAvailable, onCrash, onLeave}
   */
  update(dt, input, camera, hooks) {
    if (this.vehicleMode === 'rover') this._updateRover(dt, input, camera);
    else this._updateShuttle(dt, input, camera, hooks);
  }

  _updateShuttle(dt, input, camera, hooks) {
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

  _updateRover(dt, input, camera) {
    const r = this.roverState;

    // throttle forward/back (W/S), steering (A/D), gentle mouse-look steer
    const throttle = clamp((input.throttleF || 0), -1, 1);
    const steer = clamp((input.strafe || 0), -1, 1) - (input.yawDelta || 0) * 1.2;
    const maxSpeed = this.id === 'mars' ? 30 : 26; // ground rover top speed
    const accel = throttle * 22;

    r.speed += accel * dt;
    // drag + engine braking
    r.speed -= r.speed * (throttle === 0 ? 2.0 : 0.55) * dt;
    r.speed = clamp(r.speed, -maxSpeed * 0.5, maxSpeed);

    // steer only when moving (like a car)
    const steerRate = 1.7;
    r.heading -= steer * steerRate * dt * (Math.abs(r.speed) / maxSpeed + 0.15);

    // forward vector (matches shuttle yaw convention: heading 0 faces -Z)
    const fwd = new THREE.Vector3(-Math.sin(r.heading), 0, -Math.cos(r.heading));
    r.position.addScaledVector(fwd, r.speed * dt);
    r.velocity.copy(fwd).multiplyScalar(r.speed);

    // keep inside the map + follow the terrain
    const lim = SIZE * 0.46;
    r.position.x = clamp(r.position.x, -lim, lim);
    r.position.z = clamp(r.position.z, -lim, lim);
    const newGround = this.heightAt(r.position.x, r.position.z);
    // smooth vertical follow so the rover hugs the ground without jarring
    r.position.y += (newGround + 1.2 - r.position.y) * Math.min(1, 14 * dt);

    // rover visual
    const grp = this.rover.group;
    grp.position.copy(r.position);
    grp.rotation.y = r.heading;
    // banks slightly into turns
    grp.rotation.z = clamp(steer * 0.28, -0.3, 0.3);
    // spin wheels by speed
    const spin = r.speed * 1.6 * dt;
    for (const w of this.rover.wheels) w.rotation.x += spin;

    // chase camera
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
