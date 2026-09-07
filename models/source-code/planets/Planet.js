// Body — one celestial object (planet OR moon). Handles mesh + LOD + atmosphere
// + rings + clouds + spin/orbit driven by the shared simulation clock.
import * as THREE from 'three';
import { getBodyTextures, getCloudTexture, getRingTexture } from './ProceduralTextures.js';
import { QUALITY } from '../config.js';

const ATMO_VERT = `
  varying vec3 vN;
  void main() {
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const ATMO_FRAG = `
  uniform vec3 uColor;
  uniform float uDensity;
  varying vec3 vN;
  void main() {
    float i = pow(clamp(0.74 - dot(vN, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 2.0);
    gl_FragColor = vec4(uColor, i * uDensity);
  }`;

export class Body {
  constructor(cfg, kind, seed, quality) {
    this.cfg = cfg;
    this.kind = kind;               // 'planet' | 'moon'
    this.id = cfg.id;
    this.name = cfg.name;
    this.radius = cfg.radius;
    this.seed = seed;
    this.quality = quality;
    this.discovered = false;

    this.group = new THREE.Group();          // positioned each frame
    this.tiltGroup = new THREE.Group();      // axial tilt
    this.tiltGroup.rotation.z = THREE.MathUtils.degToRad(cfg.tilt || 0);
    this.group.add(this.tiltGroup);

    this.spin = 0;
    this.angle = cfg.phase || 0;
    this.buildMesh();
    if (cfg.rings) this.buildRings();
    if (cfg.atmosphere && QUALITY[quality].atmospheres) this.buildAtmosphere();
    this.buildOrbitLine = null;
  }

  buildMesh() {
    const q = QUALITY[this.quality];
    const tex = getBodyTextures(this.cfg.texture, this.seed, this.quality === 'low' ? 256 : 512);
    const mat = new THREE.MeshStandardMaterial({
      map: tex.map,
      roughness: 0.94,
      metalness: 0.02
    });
    if (tex.bumpMap) { mat.bumpMap = tex.bumpMap; mat.bumpScale = this.radius * 0.02; }
    if (tex.nightMap) {
      mat.emissiveMap = tex.nightMap;
      mat.emissive = new THREE.Color(0xffc478);
      mat.emissiveIntensity = 0.85;
    }
    const lod = new THREE.LOD();
    const segs = [q.segments, Math.max(10, q.segments / 2 | 0), 10];
    const dists = [0, this.radius * 22, this.radius * 90];
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(this.radius, segs[i], Math.max(6, segs[i] / 2 | 0)), mat);
      lod.addLevel(mesh, dists[i]);
    }
    this.lod = lod;
    this.tiltGroup.add(lod);

    // cloud layer (Earth)
    if (this.cfg.clouds && QUALITY[this.quality].clouds) {
      const cloudMat = new THREE.MeshLambertMaterial({
        map: getCloudTexture(this.seed + 5, this.quality === 'low' ? 256 : 512, 0.52),
        transparent: true,
        depthWrite: false
      });
      this.cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(this.radius * 1.018, 32, 16), cloudMat);
      this.tiltGroup.add(this.cloudMesh);
    }
  }

  buildAtmosphere() {
    const a = this.cfg.atmosphere;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(a.color) },
        uDensity: { value: 0.9 * (a.density || 1) }
      },
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    });
    const scale = 1.055 + (a.density || 1) * 0.02;
    this.atmoMesh = new THREE.Mesh(new THREE.SphereGeometry(this.radius * scale, 32, 16), mat);
    this.tiltGroup.add(this.atmoMesh);
  }

  buildRings() {
    const r = this.cfg.rings;
    const inner = this.radius * r.inner, outer = this.radius * r.outer;
    const geo = new THREE.RingGeometry(inner, outer, 128, 1);
    // remap UVs so texture u follows radius (paintRings draws a radial strip)
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const rad = Math.hypot(pos.getX(i), pos.getY(i));
      uv.setXY(i, (rad - inner) / (outer - inner), 0.5);
    }
    const mat = new THREE.MeshBasicMaterial({
      map: getRingTexture('#' + r.color.toString(16).padStart(6, '0'), this.seed),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: r.opacity,
      depthWrite: false
    });
    this.ringMesh = new THREE.Mesh(geo, mat);
    this.ringMesh.rotation.x = -Math.PI / 2;
    this.tiltGroup.add(this.ringMesh);
  }

  /** Position for time t (game seconds). Overridden by Moon. */
  computePosition(t, out) {
    const w = this.orbitOmega;
    this.angle = (this.cfg.phase || 0) + w * t;
    out.set(Math.cos(this.angle) * this.cfg.orbitRadius, 0, -Math.sin(this.angle) * this.cfg.orbitRadius);
    return out;
  }

  update(t, dtGameSeconds, parentPos) {
    this.computePosition(t, this.group.position);
    if (parentPos) this.group.position.add(parentPos);
    // spin: rotationSpeed 1.0 ⇒ one day per 24 game-minutes
    const spinW = (Math.PI * 2) / (24 * 60) * (this.cfg.rotationSpeed || 0.2);
    this.spin = spinW * t;
    this.lod.rotation.y = this.spin;
    if (this.cloudMesh) this.cloudMesh.rotation.y = this.spin * 1.25;
  }

  /** Surface gravity accel constant μ = g·r² (clamped gameplay value). */
  get mu() {
    return 3.2 * Math.sqrt(this.cfg.gravity || 0.1) * this.radius * this.radius;
  }
  get soi() {
    return this.radius * 6 + 8;
  }

  dispose() {
    this.lod.levels.forEach(l => { l.object.geometry.dispose(); });
    this.tiltGroup.traverse(o => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      }
      if (o.geometry) o.geometry.dispose();
    });
  }
}
