// SolarSystem — owns the Sun, every planet & moon, stations, the asteroid
// belt anchors, anomalies and orbit lines. All motion derives from the
// shared simulation clock so orbits stay perfectly consistent.
import * as THREE from 'three';
import { PLANETS, MOONS, SUN_CONFIG, STATIONS, ANOMALIES, EARTH_OMEGA, ORBIT } from '../config.js';
import { Body } from './Planet.js';
import { Moon } from './Moon.js';
import { getGlowTexture } from './ProceduralTextures.js';
import { SpaceStation } from '../world/SpaceStation.js';

const SUN_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const SUN_FRAG = `
  uniform float uTime;
  varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
    return v;
  }
  void main() {
    vec2 p = vUv * 7.0;
    float n = fbm(p + uTime * 0.06 + fbm(p * 1.8 - uTime * 0.04) * 1.4);
    vec3 col = mix(vec3(1.0, 0.42, 0.05), vec3(1.0, 0.86, 0.45), n);
    col += vec3(1.0, 0.55, 0.15) * pow(n, 3.0) * 1.6;
    gl_FragColor = vec4(col, 1.0);
  }`;

export class SolarSystem {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.planets = new Map();   // id -> Body
    this.moonsByPlanet = new Map();
    this.stations = [];
    this.anomalies = [];
    this.time = 0;

    this.buildSun();
    this.buildPlanets();
    this.buildStations();
    this.buildAnomalies();
    this.buildLights();
  }

  buildSun() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: SUN_VERT,
      fragmentShader: SUN_FRAG
    });
    this.sunMat = mat;
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_CONFIG.radius, 48, 24), mat);
    this.group.add(this.sun);

    // layered glow sprites (cheap "bloom" that works on low-end too)
    const glowInner = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture('rgba(255,240,190,0.9)', 'rgba(255,150,40,0.35)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    glowInner.scale.setScalar(SUN_CONFIG.radius * 5.2);
    const glowOuter = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture('rgba(255,200,110,0.35)', 'rgba(255,110,30,0.12)'),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    }));
    glowOuter.scale.setScalar(SUN_CONFIG.radius * 11);
    this.sun.add(glowInner, glowOuter);
  }

  buildPlanets() {
    let seed = 1000;
    for (const cfg of PLANETS) {
      const body = new Body(cfg, 'planet', seed += 101, this.quality);
      body.orbitOmega = EARTH_OMEGA / Math.pow(cfg.au, 1.5);
      this.planets.set(cfg.id, body);
      this.group.add(body.group);
      this.moonsByPlanet.set(cfg.id, []);
    }
    for (const cfg of MOONS) {
      const moon = new Moon(cfg, seed += 77, this.quality);
      this.planets.set(cfg.id, moon);
      this.moonsByPlanet.get(cfg.parent).push(moon);
      this.group.add(moon.group);
    }
    this.buildOrbitLines();
  }

  buildOrbitLines() {
    this.orbitLines = new THREE.Group();
    const mkLine = (radius, color, opacity) => {
      const pts = [];
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
    };
    for (const cfg of PLANETS) this.orbitLines.add(mkLine(cfg.orbitRadius, 0x445a7a, 0.35));
    for (const moons of this.moonsByPlanet.values())
      for (const m of moons) this.orbitLines.add(mkLine(m.cfg.orbitRadius, 0x3a4a63, 0.25));
    // belt guide ring
    this.orbitLines.add(mkLine((ORBIT.BELT_INNER + ORBIT.BELT_OUTER) / 2, 0x5a4a3a, 0.18));
    this.orbitLines.add(mkLine(ORBIT.BELT_INNER, 0x5a4a3a, 0.10));
    this.orbitLines.add(mkLine(ORBIT.BELT_OUTER, 0x5a4a3a, 0.10));
    this.group.add(this.orbitLines);
  }

  buildStations() {
    for (const cfg of STATIONS) {
      const st = new SpaceStation(cfg, this.quality);
      this.stations.push(st);
      this.group.add(st.group);
    }
  }

  buildAnomalies() {
    const beltW = (ORBIT.BELT_INNER + ORBIT.BELT_OUTER) / 2;
    for (const cfg of ANOMALIES) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        color: cfg.color, transparent: true, opacity: 0.9,
        map: getGlowTexture('rgba(255,255,255,1)', 'rgba(180,180,255,0.4)', 128),
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      sprite.scale.setScalar(2.6);
      const a = cfg.phase;
      const pos = new THREE.Vector3(Math.cos(a) * (cfg.beltRadius || beltW), 0.5, -Math.sin(a) * (cfg.beltRadius || beltW));
      sprite.position.copy(pos);
      this.group.add(sprite);
      this.anomalies.push({ cfg, sprite, pos });
    }
  }

  buildLights() {
    this.sunLight = new THREE.PointLight(0xfff1dc, 2.4, 0, 0);
    this.group.add(this.sunLight);
    this.ambient = new THREE.AmbientLight(0x30405a, 0.55);
    this.group.add(this.ambient);
  }

  setOrbitLinesVisible(v) { this.orbitLines.visible = v; }

  update(gameSeconds, dt) {
    this.time = gameSeconds;
    this.sunMat.uniforms.uTime.value = gameSeconds % 1000;
    this.sun.rotation.y = gameSeconds * 0.005;
    for (const body of this.planets.values()) {
      if (body instanceof Moon) {
        const parent = this.planets.get(body.parentId);
        body.update(gameSeconds, 0, parent.group.position);
      } else {
        body.update(gameSeconds, 0, null);
      }
    }
    for (const st of this.stations) {
      const parent = this.planets.get(st.cfg.parent);
      st.update(gameSeconds, parent.group.position);
    }
  }

  getBody(id) { return this.planets.get(id) || null; }
  get sunPosition() { return this.sun.position; }

  dispose() {
    for (const b of this.planets.values()) b.dispose();
    this.group.removeFromParent();
  }
}
