// Ship — procedural low-poly spacecraft mesh + engine FX + flight trail.
import * as THREE from 'three';
import { getGlowTexture } from '../planets/ProceduralTextures.js';

export function buildShipMesh() {
  const ship = new THREE.Group();
  const visual = new THREE.Group(); // banking/roll flourish only
  ship.add(visual);

  const hullMat = new THREE.MeshStandardMaterial({ color: 0x9aa7b8, roughness: 0.45, metalness: 0.65 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x39424e, roughness: 0.6, metalness: 0.5 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xff8c3a, roughness: 0.4, metalness: 0.3, emissive: 0xa33f00, emissiveIntensity: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x7fd4ff, roughness: 0.1, metalness: 0.9, emissive: 0x1c4a66, emissiveIntensity: 0.6 });

  // fuselage
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.7, 4, 10), hullMat);
  body.rotation.x = Math.PI / 2;
  visual.add(body);
  // nose
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 10), accentMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -1.75;
  visual.add(nose);
  // cockpit
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), glassMat);
  cockpit.scale.set(0.8, 0.55, 1.15);
  cockpit.position.set(0, 0.34, -0.72);
  visual.add(cockpit);
  // wings
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.09, 0.85), darkMat);
    wing.position.set(side * 1.05, -0.05, 0.5);
    wing.rotation.z = side * -0.16;
    wing.rotation.y = side * 0.22;
    visual.add(wing);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.6), accentMat);
    tip.position.set(side * 1.82, 0.16, 0.62);
    visual.add(tip);
  }
  // tail fin
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.7), darkMat);
  fin.position.set(0, 0.4, 1.0);
  visual.add(fin);
  // engine block
  const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.5, 10), darkMat);
  engine.rotation.x = Math.PI / 2;
  engine.position.z = 1.28;
  visual.add(engine);

  // engine glow sprite + flame cone
  const flameMat = new THREE.SpriteMaterial({
    map: getGlowTexture('rgba(180,220,255,1)', 'rgba(90,140,255,0.45)'),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
  });
  const flame = new THREE.Sprite(flameMat);
  flame.position.z = 1.62;
  flame.scale.setScalar(0.01);
  visual.add(flame);

  const engineLight = new THREE.PointLight(0x66aaff, 0, 18, 0);
  engineLight.position.z = 1.8;
  visual.add(engineLight);

  return { group: ship, visual, flame, engineLight };
}

/** Fading flight trail behind the ship (line strip ring buffer). */
export class ShipTrail {
  constructor(scene, length = 90) {
    this.length = length;
    this.positions = new Float32Array(length * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.line = new THREE.Line(this.geo, new THREE.LineBasicMaterial({
      color: 0x5fb0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.line.frustumCulled = false;
    this.count = 0;
    scene.add(this.line);
  }
  push(p) {
    // shift back by one vertex
    this.positions.copyWithin(3, 0, (this.length - 1) * 3);
    this.positions[0] = p.x; this.positions[1] = p.y; this.positions[2] = p.z;
    this.count = Math.min(this.count + 1, this.length);
    this.geo.setDrawRange(0, this.count);
    this.geo.attributes.position.needsUpdate = true;
  }
  clear(at) {
    for (let i = 0; i < this.length; i++) { this.positions[i * 3] = at.x; this.positions[i * 3 + 1] = at.y; this.positions[i * 3 + 2] = at.z; }
    this.geo.attributes.position.needsUpdate = true;
  }
  dispose() { this.geo.dispose(); this.line.material.dispose(); this.line.removeFromParent(); }
}
