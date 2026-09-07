// SpaceStation — torus habitat orbiting a planet. Dock point = station center.
import * as THREE from 'three';

function makeLabelSprite(text, color = '#9fd8ff') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(8,14,26,0.72)';
  ctx.roundRect?.(4, 12, 504, 72, 16);
  ctx.fill();
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 50, 480);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(10, 1.9, 1);
  return s;
}

export class SpaceStation {
  constructor(cfg, quality) {
    this.cfg = cfg;
    this.id = cfg.id;
    this.name = cfg.name;
    this.discovered = false;
    this.group = new THREE.Group();

    const hullMat = new THREE.MeshStandardMaterial({ color: 0xb8c4d0, roughness: 0.4, metalness: 0.7 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.6, metalness: 0.5 });
    const glowMat = new THREE.MeshStandardMaterial({
      color: cfg.color, emissive: cfg.color, emissiveIntensity: 1.4, roughness: 0.5
    });

    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.55, quality === 'low' ? 8 : 14, quality === 'low' ? 22 : 36), hullMat);
    ring.rotation.x = Math.PI / 2;
    this.group.add(ring);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.6, 10), darkMat);
    this.group.add(hub);
    const hubTop = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.2, 10), darkMat);
    hubTop.position.y = 1.9;
    this.group.add(hubTop);

    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 3.2, 6), darkMat);
      spoke.rotation.z = Math.PI / 2;
      spoke.rotation.y = (i / 4) * Math.PI * 2;
      spoke.position.set(Math.cos((i / 4) * Math.PI * 2) * 1.6, 0, -Math.sin((i / 4) * Math.PI * 2) * 1.6);
      spoke.lookAt(0, 0, 0);
      spoke.rotateX(Math.PI / 2);
      this.group.add(spoke);
    }

    // window strip
    const windows = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.08, 6, 30), glowMat);
    windows.rotation.x = Math.PI / 2;
    windows.position.y = 0.42;
    this.group.add(windows);

    // beacon
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), glowMat);
    this.beacon.position.y = 2.9;
    this.group.add(this.beacon);

    const label = makeLabelSprite(cfg.name, '#' + cfg.color.toString(16).padStart(6, '0'));
    label.position.y = 5.2;
    this.group.add(label);

    this.group.scale.setScalar(0.85);
    this.dockRadius = 7;
  }

  update(gameSeconds, parentPos) {
    // slow orbit around parent planet (one lap ≈ 6 game-hours)
    const w = (Math.PI * 2) / (6 * 3600);
    const a = (this.cfg.phase || 0) + w * gameSeconds;
    const r = this.cfg.orbitRadius;
    this.group.position.set(
      parentPos.x + Math.cos(a) * r,
      parentPos.y,
      parentPos.z - Math.sin(a) * r
    );
    this.ringPhase = (this.ringPhase || 0) + 0.02;
    this.beacon.material.emissiveIntensity = 1 + Math.sin(gameSeconds * 4) * 0.8;
  }
}
