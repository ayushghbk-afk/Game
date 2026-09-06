// Starfield — thousands of GPU-cheap points in 3 brightness layers + a few
// procedural nebula sprites. Counts scale with the graphics quality preset.
import * as THREE from 'three';
import { QUALITY, SCALE } from '../config.js';
import { getNebulaTexture } from '../planets/ProceduralTextures.js';
import { mulberry32, randomOnSphere } from '../utils/Noise.js';

export class Starfield {
  constructor(scene, quality) {
    const count = QUALITY[quality].stars;
    this.group = new THREE.Group();
    const rand = mulberry32(42);
    const layers = [
      { n: Math.floor(count * 0.6), size: 1.4, opacity: 0.55 },
      { n: Math.floor(count * 0.3), size: 2.2, opacity: 0.8 },
      { n: Math.floor(count * 0.1), size: 3.4, opacity: 1.0 }
    ];
    const palette = [0xffffff, 0xdfe8ff, 0xffe9c4, 0xffd2a1, 0xc4d8ff];
    this.points = [];
    for (const layer of layers) {
      const positions = new Float32Array(layer.n * 3);
      const colors = new Float32Array(layer.n * 3);
      for (let i = 0; i < layer.n; i++) {
        const [x, y, z] = randomOnSphere(rand);
        const r = SCALE.START_RADIUS * (0.82 + rand() * 0.18);
        positions[i * 3] = x * r; positions[i * 3 + 1] = y * r; positions[i * 3 + 2] = z * r;
        const c = new THREE.Color(palette[(rand() * palette.length) | 0]);
        const b = 0.55 + rand() * 0.45;
        colors[i * 3] = c.r * b; colors[i * 3 + 1] = c.g * b; colors[i * 3 + 2] = c.b * b;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        size: layer.size, sizeAttenuation: false, vertexColors: true,
        transparent: true, opacity: layer.opacity, depthWrite: false
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      this.points.push(pts);
      this.group.add(pts);
    }

    // subtle nebulae
    const nebulae = [
      { color: '#3b2a6e', seed: 11, scale: 5200, pos: [-3300, 900, -3600] },
      { color: '#16324a', seed: 23, scale: 4600, pos: [3800, -600, -3200] },
      { color: '#4a1e3a', seed: 37, scale: 4000, pos: [1200, 2200, 3900] }
    ];
    for (const n of nebulae) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getNebulaTexture(n.color, n.seed),
        transparent: true, opacity: 0.5, depthWrite: false,
        blending: THREE.AdditiveBlending
      }));
      s.scale.setScalar(n.scale);
      s.position.set(...n.pos);
      this.group.add(s);
    }
    scene.add(this.group);
  }

  dispose() {
    for (const p of this.points) { p.geometry.dispose(); p.material.dispose(); }
    this.group.removeFromParent();
  }
}
