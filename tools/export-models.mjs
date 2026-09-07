// ============================================================
// export-models.mjs — extracts EVERY 3D model, animation and
// effect from Solar Odyssey into the `models/` folder so it can
// be shared with other people.
//
// The game has no binary asset files: every mesh, texture,
// animation and particle effect is generated procedurally by the
// code in src/. This tool loads that exact code under Node,
// builds every object the game can build, and writes each one
// out as a standard glTF-Binary (.glb) model — openable in
// Blender, Windows 3D Viewer, macOS Preview, three.js editor,
// https://gltf-viewer.donmccurdy.com and most game engines.
//
// It also copies the generating source code to
// models/source-code/ (the "animations" are code, not keyframe
// data, so the JS is the animation) and prints an index.
//
// Usage:
//   npm install
//   node tools/export-models.mjs
//
// Optional: export the full surface scene for specific bodies
// (default earth/mars/moon):
//   node tools/export-models.mjs --surface mars,europa,titan
// ============================================================

// ---------- 0. Node-side browser shims (must run BEFORE three loads) ----------
import { createCanvas, ImageData as NapiImageData } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'models');

// Make @napi-rs/canvas canvases pass `instanceof HTMLCanvasElement`
// (three's GLTFExporter type-checks its texture images).
class HTMLCanvasElement {}
{
  const probe = createCanvas(1, 1);
  Object.setPrototypeOf(HTMLCanvasElement.prototype, Object.getPrototypeOf(probe));
}
// glTF image encoding goes through canvas.toBlob + FileReader.
HTMLCanvasElement.prototype.toBlob = function (cb, type = 'image/png') {
  Promise.resolve(this.toBuffer(type)).then((buf) => cb(new Blob([buf], { type })));
};
function makeCanvas(w = 512, h = 512) {
  const c = createCanvas(w, h);
  Object.setPrototypeOf(c, HTMLCanvasElement.prototype);
  // @napi-rs/canvas exposes a `.data` METHOD on canvases; three's GLTFExporter
  // duck-types `image.data !== undefined` to detect DataTextures and would
  // take that path, exporting every texture as black. Shadow it so canvases
  // hit the normal drawImage path instead.
  Object.defineProperty(c, 'data', { value: undefined, configurable: true });
  return c;
}
class FileReaderShim {
  constructor() { this.result = null; this.onloadend = null; }
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => { this.result = buf; this.onloadend?.({ target: this }); });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`;
      this.onloadend?.({ target: this });
    });
  }
}
const fakeElement = () => ({
  style: {}, classList: { add() {}, remove() {}, toggle() {} },
  appendChild() {}, addEventListener() {}, removeEventListener() {}
});
globalThis.HTMLCanvasElement = HTMLCanvasElement;
globalThis.ImageData = NapiImageData;
globalThis.FileReader = FileReaderShim;
globalThis.window = globalThis;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
// Node ≥21 defines a getter-only `navigator` — override it (config.js reads it).
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node', maxTouchPoints: 0, hardwareConcurrency: 8, deviceMemory: 8 },
  configurable: true
});
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? makeCanvas() : fakeElement()),
  createElementNS: (_ns, tag) => (tag === 'canvas' ? makeCanvas() : fakeElement()),
  addEventListener() {}, removeEventListener() {}, body: { appendChild() {} }
};

// ---------- 1. Load three + the game's own model/animation/effect code ----------
const THREE = await import('three');
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
const cfg = await import('../src/config.js');
const { Body } = await import('../src/planets/Planet.js');
const { Moon } = await import('../src/planets/Moon.js');
const { getBodyTextures, getGlowTexture } = await import('../src/planets/ProceduralTextures.js');
const { buildShipMesh } = await import('../src/spacecraft/Ship.js');
const { buildRocketMesh, geoFor, matFor } = await import('../src/rockets/RocketMesh.js');
const { ROCKET_PARTS, starterDesign, expandParts } = await import('../src/rockets/RocketParts.js');
const { SpaceStation } = await import('../src/world/SpaceStation.js');
const { Starfield } = await import('../src/world/Starfield.js');
const { AsteroidField } = await import('../src/world/AsteroidField.js');
const { Effects } = await import('../src/fx/Effects.js');
const { SurfaceScene } = await import('../src/game/SurfaceScene.js');
const { ValueNoise, fbm, mulberry32 } = await import('../src/utils/Noise.js');

const exporter = new GLTFExporter();
const written = [];

/** Export any Object3D to models/<relPath> as a binary glTF (.glb). */
async function exportGLB(object, relPath, opts = {}) {
  // glTF cannot represent THREE.Sprite — drop them (their textures live on
  // in the glow/billboard effect models).
  const sprites = [];
  object.traverse((o) => { if (o.isSprite) sprites.push(o); });
  for (const s of sprites) s.removeFromParent();
  // Three color management: exported textures carry their sRGB bytes;
  // tell the exporter not to re-convert the already-encoded canvas data.
  const buf = await new Promise((resolve, reject) => {
    exporter.parse(object, resolve, reject, { binary: true, onlyVisible: false, ...opts });
  });
  const full = path.join(OUT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.from(buf));
  const kb = (fs.statSync(full).size / 1024).toFixed(1);
  written.push({ file: relPath, kb });
  console.log(`  ✓ ${relPath} (${kb} KB)`);
}

/** One full Y rotation as a glTF animation clip (the game's spin).
 *  `periodSeconds` may be negative — Venus and Uranus spin retrograde. */
function spinClip(nodeName, periodSeconds, trackName = 'spin') {
  if (!Number.isFinite(periodSeconds) || periodSeconds === 0) return null;
  const T = Math.abs(periodSeconds);
  const dir = Math.sign(periodSeconds);
  const q = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dir * a).toArray();
  const times = [0, T / 4, T / 2, (3 * T) / 4, T];
  const values = [...q(0), ...q(Math.PI / 2), ...q(Math.PI), ...q((3 * Math.PI) / 2), ...q(Math.PI * 2)];
  const clip = new THREE.AnimationClip(trackName, T, [
    new THREE.QuaternionKeyframeTrack(`${nodeName}.quaternion`, times, values)
  ]);
  return clip;
}

// Planet spin: the game spins at (2π/86400)·rotationSpeed rad per game-second
// (one "day" = 24 game-hours), clouds drift 1.25× faster (Planet.js update()).
// Negative rotationSpeed ⇒ retrograde (Venus, Uranus).
const spinPeriod = (c) => 86400 / (c.rotationSpeed ?? 0.2);

const strip = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

console.log('Extracting Solar Odyssey models → models/\n');

// ---------- 2. Player ship ----------
{
  const { group, visual } = buildShipMesh();
  const names = ['fuselage', 'nose-cone', 'cockpit', 'wing-left', 'wingtip-left', 'wing-right',
    'wingtip-right', 'tail-fin', 'engine-block', 'engine-glow', 'engine-light'];
  visual.children.forEach((c, i) => { c.name = names[i] || c.name || `part-${i}`; });
  group.name = 'odyssey-ship';
  await exportGLB(group, 'glb/ship.glb');
}

// ---------- 3. Rockets: the starter vehicle + every individual part ----------
{
  // 3a. The stock "Odyssey I" design, built by the game's own builder.
  const design = starterDesign();
  const rocket = buildRocketMesh(design);
  // Name each mesh after its catalogue part (buildRocketMesh and expandParts
  // walk the design in the same order).
  const parts = expandParts(design);
  const stageGroups = rocket.userData.stageGroups || [];
  let si = 0, pi = 0;
  for (const g of stageGroups) {
    let k = 0;
    while (k < g.children.length && pi < parts.length) {
      const part = parts[pi++];
      const mesh = g.children[k];
      if (part.stage) { mesh.name = `decoupler (${part.name})`; k++; continue; }
      mesh.name = part.name;
      k++;
      if (part.cat === 'engine' || part.cat === 'booster') {
        if (g.children[k]?.userData?.isFlame) { g.children[k].name = `${part.name} — flame glow`; k++; }
      }
    }
    si++;
  }
  rocket.name = design.name;
  await exportGLB(rocket, `glb/rockets/${strip(design.name)}.glb`);

  // 3b. Every part in the catalogue, as its own model (same geometry,
  // material and procedural texture the VAB and the flight use).
  for (const part of ROCKET_PARTS) {
    const mesh = new THREE.Mesh(geoFor(part), matFor(part));
    const h = part.h || 0.6;
    mesh.position.y = h / 2;                    // base at y=0, like on the pad
    if (part.shape === 'nozzle') mesh.rotation.x = Math.PI; // bell points down
    const g = new THREE.Group();
    g.name = part.name;
    g.add(mesh);
    await exportGLB(g, `glb/rockets/parts/${part.id}_${strip(part.name)}.glb`);
  }
}

// ---------- 4. Sun (shader baked to a texture, with its spin animation) ----------
{
  // The Sun is a live GLSL shader in-game (SolarSystem.js SUN_FRAG). We bake
  // the same fBm formula with the game's own ValueNoise at t=0 so the .glb
  // shows the same churning orange surface as a static texture + emissive.
  const W = 512, H = 256;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const n1 = new ValueNoise(7), n2 = new ValueNoise(13);
  const mix = (a, b, t) => a + (b - a) * t;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const px = u * 7, py = v * 7;                       // shader: p = vUv * 7.0
      const warp = fbm(n2, px * 1.8, py * 1.8, 4);
      const n = fbm(n1, px + warp * 1.4, py + warp * 1.4, 4);
      const r = Math.min(1, mix(1.0, 1.0, n) + 1.00 * Math.pow(n, 3) * 1.6);
      const g = Math.min(1, mix(0.42, 0.86, n) + 0.55 * Math.pow(n, 3) * 1.6);
      const b = Math.min(1, mix(0.05, 0.45, n) + 0.15 * Math.pow(n, 3) * 1.6);
      const i = (y * W + x) * 4;
      img.data[i] = r * 255; img.data[i + 1] = g * 255; img.data[i + 2] = b * 255; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(cfg.SUN_CONFIG.radius, 48, 24),
    new THREE.MeshStandardMaterial({
      map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.15,
      roughness: 1, metalness: 0
    })
  );
  sun.name = 'sun';
  const root = new THREE.Group();
  root.name = 'SOL';
  root.add(sun);
  // In-game: sun.rotation.y = gameSeconds * 0.005 → one lap ≈ 1256.6 s.
  await exportGLB(root, 'glb/sun.glb', { animations: [spinClip('sun', (Math.PI * 2) / 0.005)] });
}

// ---------- 5. Planets & moons (textures identical to the game's seeds) ----------
{
  // SolarSystem.buildPlanets() seeds bodies exactly like this — replicate it
  // so every exported texture matches what players see in-game.
  let seed = 1000;
  const bodySeeds = new Map();
  for (const p of cfg.PLANETS) bodySeeds.set(p.id, (seed += 101));
  for (const m of cfg.MOONS) bodySeeds.set(m.id, (seed += 77));

  const extractBody = async (cfgBody, kind, dir) => {
    const body = kind === 'moon' ? new Moon(cfgBody, bodySeeds.get(cfgBody.id), 'high')
                                 : new Body(cfgBody, kind, bodySeeds.get(cfgBody.id), 'high');
    const root = new THREE.Group();
    root.name = cfgBody.name;
    // Keep the axial tilt (Planet.js tilts around Z).
    body.tiltGroup.name = 'axial-tilt';
    const surface = body.lod.levels[0].object;   // highest-detail LOD level
    body.tiltGroup.remove(body.lod);
    surface.name = 'surface';
    body.tiltGroup.add(surface);
    if (body.cloudMesh) body.cloudMesh.name = 'clouds';
    if (body.ringMesh) body.ringMesh.name = 'rings';
    if (body.atmoMesh) {
      // Atmosphere is an additive BackSide shader in-game; glTF has neither,
      // so approximate with a translucent shell of the same colour/density.
      const a = cfgBody.atmosphere;
      body.atmoMesh.material.dispose();
      body.atmoMesh.material = new THREE.MeshBasicMaterial({
        color: a.color, transparent: true, opacity: 0.22 * (a.density || 1),
        side: THREE.DoubleSide, depthWrite: false
      });
      body.atmoMesh.name = 'atmosphere';
    }
    root.add(body.tiltGroup);

    const clips = [];
    const sp = spinClip('surface', spinPeriod(cfgBody));
    if (sp) clips.push(sp);
    if (body.cloudMesh) {
      const cp = spinClip('clouds', spinPeriod(cfgBody) / 1.25, 'cloud-drift');
      if (cp) clips.push(cp);
    }
    await exportGLB(root, `glb/${dir}/${cfgBody.id}.glb`, clips.length ? { animations: clips } : {});
  };

  for (const p of cfg.PLANETS) await extractBody(p, 'planet', 'planets');
  for (const m of cfg.MOONS) await extractBody(m, 'moon', 'moons');
}

// ---------- 6. Space stations ----------
{
  const names = ['habitat-ring', 'docking-hub', 'hub-cap', 'spoke-1', 'spoke-2', 'spoke-3', 'spoke-4',
    'window-strip', 'beacon'];
  for (const st of cfg.STATIONS) {
    const station = new SpaceStation(st, 'high');
    station.group.children.forEach((c, i) => { if (!c.isSprite) c.name = names[i] || c.name; });
    station.group.name = st.name;
    await exportGLB(station.group, `glb/stations/${st.id}.glb`);
  }
}

// ---------- 7. Asteroids (the game's shared deformed-icosahedron rock) ----------
{
  // Grab the exact geometry AsteroidField builds (same seed 777 deformation).
  const scratch = new THREE.Scene();
  const field = new AsteroidField(scratch, 'low');
  const rockGeo = field.mesh.geometry.clone();
  field.dispose();
  const TYPES = [
    { id: 'iron', name: 'IRON ASTEROID', color: 0x9c7a5c },
    { id: 'nickel', name: 'NICKEL ASTEROID', color: 0xa8b0b8 },
    { id: 'ice', name: 'ICE ASTEROID', color: 0xbfe0ee },
    { id: 'rare', name: 'RARE-MINERAL ASTEROID', color: 0xb98ae8 }
  ];
  for (const t of TYPES) {
    const rock = new THREE.Mesh(rockGeo, new THREE.MeshStandardMaterial({
      color: t.color, roughness: 0.95, metalness: 0.08, flatShading: true
    }));
    rock.name = t.id;
    const g = new THREE.Group();
    g.name = t.name;
    g.add(rock);
    await exportGLB(g, `glb/asteroids/${t.id}.glb`);
  }
}

// ---------- 8. Starfield (the game's exact seed-42 sky) ----------
{
  const scratch = new THREE.Scene();
  const sf = new Starfield(scratch, 'high');
  const layerNames = ['faint-stars', 'mid-stars', 'bright-stars'];
  sf.points.forEach((p, i) => { p.name = layerNames[i] || 'stars'; p.removeFromParent(); });
  // Nebulae are additive sprites in-game → textured billboards for glTF.
  sf.group.children.filter((c) => c.isSprite).forEach((sprite, i) => {
    const size = sprite.scale.x;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        map: sprite.material.map, transparent: true, opacity: 0.5,
        depthWrite: false, side: THREE.DoubleSide
      })
    );
    plane.position.copy(sprite.position);
    plane.lookAt(0, 0, 0);
    plane.name = `nebula-${i + 1}`;
    sprite.removeFromParent();
    sf.group.add(plane);
  });
  sf.group.name = 'starfield';
  await exportGLB(sf.group, 'glb/starfield.glb');
}

// ---------- 9. Effects (particle pools, beam, landing FX, glow billboards) ----------
{
  const scratch = new THREE.Scene();
  const fx = new Effects(scratch, 'high');

  // Let each pool actually burst so the exported points show a real spread.
  const zero = new THREE.Vector3(0, 0, 0);
  const dir = new THREE.Vector3();
  for (let i = 0; i < 90; i++) {
    dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    fx.enginePuff(zero, dir, 2.2, i % 2 === 0);
  }
  for (let i = 0; i < 70; i++) fx.mineSparks(zero);
  fx.explosion(new THREE.Vector3(0, 0, 0), 1);
  fx.explosion(new THREE.Vector3(0, 0, 0), 1.4);
  for (let i = 0; i < 14; i++) fx.update(1 / 30);   // let the bursts fly

  const pools = [
    ['enginePool', 'engine-sparks', 'Engine ion-spark particles (90-pool burst)'],
    ['minePool', 'mining-sparks', 'Mining laser sparks (70-pool burst)'],
    ['explosionPool', 'explosion', 'Explosion debris (140-pool double burst)']
  ];
  for (const [key, file, label] of pools) {
    const pts = fx[key].points;
    pts.removeFromParent();
    pts.name = file;
    const g = new THREE.Group();
    g.name = label;
    g.add(pts);
    await exportGLB(g, `glb/effects/particles-${file}.glb`);
  }

  // Mining beam, at a representative length (Effects.js builds it 1 unit
  // along -Z and scales it in-flight).
  fx.beam.visible = true;
  fx.beam.scale.set(1, 1, 12);
  fx.beam.name = 'mining-beam';
  const beamRoot = new THREE.Group();
  beamRoot.name = 'Mining beam';
  beamRoot.add(fx.beam);
  await exportGLB(beamRoot, 'glb/effects/mining-beam.glb');

  // Landing FX (LandingSequence.js): touchdown dust ring + entry streaks.
  const dustGeo = new THREE.RingGeometry(2, 18, 32);
  dustGeo.rotateX(-Math.PI / 2);
  const dust = new THREE.Mesh(dustGeo, new THREE.MeshBasicMaterial({
    color: 0xc8b090, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false
  }));
  dust.name = 'dust-ring';
  const dustRoot = new THREE.Group();
  dustRoot.name = 'Touchdown dust ring';
  dustRoot.add(dust);
  await exportGLB(dustRoot, 'glb/effects/landing-dust-ring.glb');

  const n = 60;
  const pos = new Float32Array(n * 3);
  const rand = mulberry32(31415);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rand() - 0.5) * 40;
    pos[i * 3 + 1] = rand() * 80;
    pos[i * 3 + 2] = (rand() - 0.5) * 40;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const streaks = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xffc070, size: 1.4, transparent: true, opacity: 0.85, depthWrite: false
  }));
  streaks.name = 'entry-streaks';
  const streakRoot = new THREE.Group();
  streakRoot.name = 'Atmospheric entry streaks';
  streakRoot.add(streaks);
  await exportGLB(streakRoot, 'glb/effects/entry-streaks.glb');

  // Glow billboards (in-game additive sprites): heat-shield glow + engine plume.
  const billboard = (inner, outer, size, name, label) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        map: getGlowTexture(inner, outer), transparent: true,
        depthWrite: false, side: THREE.DoubleSide
      })
    );
    m.name = name;
    const g = new THREE.Group();
    g.name = label;
    g.add(m);
    return g;
  };
  await exportGLB(billboard('rgba(255,200,120,1)', 'rgba(255,80,20,0.35)', 18,
    'heat-glow', 'Re-entry heat-shield glow'), 'glb/effects/glow-heat-shield.glb');
  await exportGLB(billboard('rgba(160,210,255,1)', 'rgba(60,120,255,0.4)', 6,
    'plume', 'Retro-burn engine plume'), 'glb/effects/glow-engine-plume.glb');

  fx.dispose();
}

// ---------- 10. Surface world: shared props + full scenes ----------
{
  // Props (identical on every world — built once from the Earth scene).
  const earth = new SurfaceScene(cfg.PLANETS.find((p) => p.id === 'earth'), 'high');

  const outpost = earth.baseGroup;
  outpost.name = 'outpost';
  const outRoot = new THREE.Group();
  outRoot.name = 'Planetary outpost (landing pad, habitat dome, solar array, comms mast)';
  outRoot.add(outpost.clone(true));
  await exportGLB(outRoot, 'glb/surface/props/outpost-base.glb');

  const rover = earth.rover.group.clone(true);
  rover.name = 'rover';
  const roverRoot = new THREE.Group();
  roverRoot.name = 'Surface rover';
  roverRoot.add(rover);
  await exportGLB(roverRoot, 'glb/surface/props/rover.glb');

  const astro = earth.astro.group.clone(true);
  astro.visible = true;
  astro.name = 'astronaut';
  const astroRoot = new THREE.Group();
  astroRoot.name = 'Astronaut (EVA suit)';
  astroRoot.add(astro);
  await exportGLB(astroRoot, 'glb/surface/props/astronaut.glb');

  const cache = earth.caches[0].group.clone(true);
  cache.name = 'supply-cache';
  const cacheRoot = new THREE.Group();
  cacheRoot.name = 'Supply cache crate + beacon';
  cacheRoot.add(cache);
  await exportGLB(cacheRoot, 'glb/surface/props/supply-cache.glb');

  const site = earth.sampleSite.group.clone(true);
  site.name = 'sample-site';
  const siteRoot = new THREE.Group();
  siteRoot.name = 'Science sample site (comms dish)';
  siteRoot.add(site);
  await exportGLB(siteRoot, 'glb/surface/props/sample-site.glb');

  // Full surface scenes — terrain, water, glows, ridges, streamed props,
  // outpost, rover, caches, sample site, astronaut — exactly as generated.
  const args = process.argv.find((a) => a.startsWith('--surface'));
  const ids = args ? args.split('=')[1].split(',').map((s) => s.trim())
    : ['earth', 'mars', 'moon'];
  for (const id of ids) {
    const cfgBody = [...cfg.PLANETS, ...cfg.MOONS].find((b) => b.id === id);
    if (!cfgBody) { console.warn(`  ! unknown body "${id}" — skipped`); continue; }
    const scene = id === 'earth' ? earth : new SurfaceScene(cfgBody, 'high');
    // Populate the object streamer around the outpost so the scene includes
    // the scattered boulders/debris a player actually sees near the base.
    for (let i = 0; i < 40; i++) scene.streamer.update(0, 0);
    scene.ship.group.visible = true;   // the parked shuttle is part of the scene
    scene.astro.group.visible = true;
    scene.scene.name = `${cfgBody.name} surface`;
    await exportGLB(scene.scene, `glb/surface/scenes/${id}-surface.glb`);
  }
}

// ---------- 11. Copy the generating source code (models + animations + effects) ----------
{
  const files = [
    ['src/config.js', 'config.js'],                                  // world data: planets, moons, stations
    ['src/utils/Noise.js', 'utils/Noise.js'],                        // seeded noise behind every texture
    ['src/spacecraft/Ship.js', 'spacecraft/Ship.js'],                // ship model + engine FX + flight trail
    ['src/rockets/RocketParts.js', 'rockets/RocketParts.js'],        // part catalogue
    ['src/rockets/PartTextures.js', 'rockets/PartTextures.js'],      // procedural part textures
    ['src/rockets/RocketMesh.js', 'rockets/RocketMesh.js'],          // design → 3D rocket + staging
    ['src/rockets/RocketDesign.js', 'rockets/RocketDesign.js'],      // v2 3D-placement designs
    ['src/rockets/BuilderScene.js', 'rockets/BuilderScene.js'],      // VAB assembly pad scene
    ['src/rockets/Builder2D.js', 'rockets/Builder2D.js'],            // 2D blueprint view
    ['src/rockets/PartDraw2D.js', 'rockets/PartDraw2D.js'],          // 2D part drawings
    ['src/rockets/LaunchSequence.js', 'rockets/LaunchSequence.js'],  // launch animation (ascent, staging)
    ['src/planets/ProceduralTextures.js', 'planets/ProceduralTextures.js'],
    ['src/planets/Planet.js', 'planets/Planet.js'],                  // planet mesh, LOD, rings, clouds, spin
    ['src/planets/Moon.js', 'planets/Moon.js'],
    ['src/planets/SolarSystem.js', 'planets/SolarSystem.js'],        // sun shader, orbits, stations, anomalies
    ['src/planets/PlanetData.js', 'planets/PlanetData.js'],
    ['src/world/SpaceStation.js', 'world/SpaceStation.js'],
    ['src/world/AsteroidField.js', 'world/AsteroidField.js'],
    ['src/world/Starfield.js', 'world/Starfield.js'],
    ['src/world/ObjectStreamer.js', 'world/ObjectStreamer.js'],
    ['src/fx/Effects.js', 'fx/Effects.js'],                          // pooled particles + mining beam
    ['src/fx/LandingSequence.js', 'fx/LandingSequence.js'],          // landing cinematic
    ['src/game/SurfaceScene.js', 'game/SurfaceScene.js'],            // terrain + every surface prop
    ['src/surface/SurfaceThemes.js', 'surface/SurfaceThemes.js']     // per-world terrain themes
  ];
  for (const [src, dest] of files) {
    const full = path.join(OUT, 'source-code', dest);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.copyFileSync(path.join(ROOT, src), full);
  }
  console.log(`  ✓ source-code/ (${files.length} modules copied)`);
}

// ---------- 12. Manifest + summary ----------
const describe = (rel) => {
  const f = rel.replace(/\\/g, '/');
  if (f === 'glb/ship.glb') return 'The player’s spacecraft — fuselage, cockpit, wings, tail, engine block and engine light.';
  if (f === 'glb/sun.glb') return 'SOL, the Sun — the game’s fBm shader surface baked to a texture, with its slow spin animation.';
  if (f.startsWith('glb/planets/')) return 'Planet — surface texture (and clouds / rings / atmosphere where the game has them), with the game’s spin animation. Venus and Uranus spin retrograde, as in-game.';
  if (f.startsWith('glb/moons/')) return 'Moon — same generator as the planets, seeded exactly like SolarSystem.buildPlanets().';
  if (f.startsWith('glb/stations/')) return 'Orbital space station — torus habitat, hub, spokes, window strip, beacon.';
  if (f.startsWith('glb/asteroids/')) return 'Asteroid — the game’s shared deformed-icosahedron rock (seed 777) in one of the four ore colours.';
  if (f === 'glb/starfield.glb') return 'The seed-42 starfield: three point layers + three nebula billboards.';
  if (f === 'glb/rockets/odyssey-i.glb') return '“Odyssey I” — the stock starter rocket, assembled by the game’s own builder, stage groups included.';
  if (f.startsWith('glb/rockets/parts/')) return 'A Vehicle-Assembly-Building part — the exact geometry, material and procedural texture used in-game.';
  if (f.startsWith('glb/surface/props/')) return 'Surface prop — shared by every planetary surface scene.';
  if (f.startsWith('glb/surface/scenes/')) return 'A complete procedural surface world: terrain, water, glows, ridges, streamed rocks, outpost, rover, caches, sample site and astronaut, laid out as in-game.';
  if (f.startsWith('glb/effects/')) return 'Effect geometry — a snapshot of a pooled particle burst, beam, dust ring or glow billboard.';
  return '';
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), JSON.stringify({
  game: 'Solar Odyssey',
  generated: new Date().toISOString(),
  format: 'glTF-Binary (.glb)',
  count: written.length,
  files: written.map((w) => ({ file: w.file, sizeKB: Number(w.kb), description: describe(w.file) }))
}, null, 2));

const totalKB = written.reduce((a, w) => a + parseFloat(w.kb), 0);
console.log(`\nDone — ${written.length} models exported (${(totalKB / 1024).toFixed(1)} MB of .glb)`);
console.log(`Index → models/MANIFEST.json`);
console.log(`Source code for every model, animation and effect → models/source-code/`);
