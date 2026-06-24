import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { WeaponConfig, PeerPlayer, KillFeedItem, PlayzoneState, AirdropState, LootBoxState } from '../types';
import { WEAPONS, SKILLS } from '../constants';
import { playVoiceSynthesis } from './AudioVoiceController';
import { Crosshair } from 'lucide-react';

interface ThreeGameProps {
  socket: WebSocket | null;
  mode: '1v1' | 'FFA' | 'TDM';
  team: 'Red' | 'Blue' | 'FFA';
  playerName: string;
  activeWeapon: WeaponConfig;
  activeWeather: 'clear' | 'rain' | 'snow' | 'sandstorm';
  onStatsUpdate: (kills: number, deaths: number, score: number) => void;
  onHealthChange: (health: number) => void;
  onEnergyChange: (energy: number) => void;
  onAmmoChange: (ammo: number, maxAmmo: number, reloading: boolean) => void;
  onKillFeedUpdate: (item: KillFeedItem) => void;
  onPeerSpeakingUpdate: (speakingNames: string[]) => void;
  
  // Game trigger ref to allow parent HUD interactions (like triggering skills)
  gameTriggerRef: React.MutableRefObject<((skillType: 'dash' | 'heal' | 'scan') => void) | null>;

  // --- Battle Royale Callbacks ---
  onInventoryUpdate?: (inv: { helmetLevel: number; vestLevel: number; medkits: number; boosters: number }) => void;
  onPlayzoneUpdate?: (pz: PlayzoneState, dist: number) => void;
  onGlidingChange?: (gliding: boolean) => void;
  onLootProximityChange?: (loot: { id: string; name: string; type: 'airdrop' | 'lootbox' } | null) => void;
}

export const ThreeGame: React.FC<ThreeGameProps> = ({
  socket,
  mode,
  team,
  playerName,
  activeWeapon,
  activeWeather,
  onStatsUpdate,
  onHealthChange,
  onEnergyChange,
  onAmmoChange,
  onKillFeedUpdate,
  onPeerSpeakingUpdate,
  gameTriggerRef,
  onInventoryUpdate,
  onPlayzoneUpdate,
  onGlidingChange,
  onLootProximityChange
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const myIdRef = useRef<string | null>(null);

  // Core gameplay states
  const [health, setHealth] = useState(100);
  const [energy, setEnergy] = useState(100);
  const [ammo, setAmmo] = useState(activeWeapon.ammoMax);
  const [reloading, setReloading] = useState(false);
  
  // Game scores (accumulated locally in active round)
  const statsRef = useRef({ kills: 0, deaths: 0, score: 0 });

  // Refs for animation loop & physics variables
  const requestRef = useRef<number | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const clockRef = useRef<THREE.Clock | null>(null);

  // Player controls & Euler-Cromer Physics parameters
  const pointerLocked = useRef(false);
  const keys = useRef<{ [key: string]: boolean }>({});
  const moveSpeed = useRef(14); // basic run speed
  const velocity = useRef(new THREE.Vector3());
  const playerPosition = useRef(new THREE.Vector3(0, 1.6, 0)); // player eyes height is 1.6
  const cameraRotation = useRef({ yaw: 0, pitch: 0 });
  const isGrounded = useRef(true);

  // Weather physics parameters
  const frictionFactor = useRef(0.9); // speed decay coefficient
  const windDrift = useRef(new THREE.Vector3()); // sandstorm drift force

  // Weapons & fire parameters
  const currentWeaponRef = useRef<WeaponConfig>(activeWeapon);
  const currentAmmoRef = useRef(activeWeapon.ammoMax);
  const isReloadingRef = useRef(false);
  const lastFiredTime = useRef(0);
  const isShootingInput = useRef(false);

  // Dynamic meshes lists
  const destructibleBlocks = useRef<Map<string, { mesh: THREE.Mesh; hp: number }>>(new Map());
  const peersMap = useRef<Map<string, PeerPlayer>>(new Map());
  const peerMeshes = useRef<Map<string, { group: THREE.Group; nameplate: THREE.Sprite }>>(new Map());
  const bulletsGroup = useRef<THREE.Group | null>(null);
  const particleSystemRef = useRef<THREE.Points | null>(null); // Rain/Snow/Sand particles
  const particleCount = 3000;

  // Battle Royale dynamic structures and refs
  const playzoneMeshRef = useRef<THREE.Mesh | null>(null);
  const targetZoneRingRef = useRef<THREE.Mesh | null>(null);
  const airdropMeshes = useRef<Map<string, THREE.Group>>(new Map());
  const lootBoxMeshes = useRef<Map<string, THREE.Group>>(new Map());
  
  // Local state cache for fast comparison & propagation
  const localInventory = useRef({ helmetLevel: 1, vestLevel: 1, medkits: 1, boosters: 2 });
  const localGliding = useRef(false);
  const localPlayzone = useRef<PlayzoneState | null>(null);
  const currentLootProximity = useRef<{ id: string; name: string; type: 'airdrop' | 'lootbox' } | null>(null);

  // Sound Synth queue
  const latestSpeakerTimer = useRef<{ [pid: string]: number }>({});

  // Establish state hook connections with parent HUD
  useEffect(() => {
    onHealthChange(health);
  }, [health]);

  useEffect(() => {
    onEnergyChange(energy);
  }, [energy]);

  useEffect(() => {
    onAmmoChange(ammo, currentWeaponRef.current.ammoMax, reloading);
  }, [ammo, reloading, activeWeapon]);

  // Sync active weapon if changed in props
  useEffect(() => {
    currentWeaponRef.current = activeWeapon;
    setAmmo(activeWeapon.ammoMax);
    currentAmmoRef.current = activeWeapon.ammoMax;
    setReloading(false);
    isReloadingRef.isCurrentlyTransmitting = false;
    onAmmoChange(activeWeapon.ammoMax, activeWeapon.ammoMax, false);
  }, [activeWeapon]);

  // Handle weather-specific parameters on prop update
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;

    switch (activeWeather) {
      case 'rain':
        scene.fog = new THREE.FogExp2(0x1e293b, 0.025); // misty blue-grey
        frictionFactor.current = 0.88; // slightly slippery muddy ground
        windDrift.current.set(0, 0, 0);
        break;
      case 'snow':
        scene.fog = new THREE.FogExp2(0xe2e8f0, 0.035); // heavy foggy snow atmosphere
        frictionFactor.current = 0.96; // highly slippery icy sliding!
        windDrift.current.set(0, 0, 0);
        break;
      case 'sandstorm':
        scene.fog = new THREE.FogExp2(0x78350f, 0.075); // super dense orange sandstorm visibility blocker!
        frictionFactor.current = 0.86; // heavy kinetic air resistance
        break;
      default:
        scene.fog = new THREE.FogExp2(0x0f172a, 0.01); // clear optimal futuristic space
        frictionFactor.current = 0.90; // standard friction
        windDrift.current.set(0, 0, 0);
        break;
    }
  }, [activeWeather]);

  // Initialize Game trigger operations for Parent HUD
  useEffect(() => {
    gameTriggerRef.current = (skillType) => {
      triggerActiveSkill(skillType);
    };
    return () => {
      gameTriggerRef.current = null;
    };
  }, [energy, health]);

  const triggerActiveSkill = (skillType: 'dash' | 'heal' | 'scan') => {
    const matched = SKILLS.find(s => s.id === skillType);
    if (!matched || energy < matched.cost) return;

    // Deduct local energy
    const newEnergy = Math.max(0, energy - matched.cost);
    setEnergy(newEnergy);

    // Notify WebSocket server
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'use_skill',
        skillType,
        cost: matched.cost
      }));
    }

    // Apply skill logic locally
    if (skillType === 'dash') {
      // Dash in direction of movement, or straight forward if idle
      const forwardVec = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraRotation.current.yaw);
      let dashDir = forwardVec.clone().normalize();
      
      if (keys.current['KeyW']) dashDir.copy(forwardVec);
      else if (keys.current['KeyS']) dashDir.copy(forwardVec).multiplyScalar(-1);
      
      if (keys.current['KeyA']) {
        const left = forwardVec.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
        dashDir.add(left);
      }
      if (keys.current['KeyD']) {
        const right = forwardVec.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
        dashDir.add(right);
      }

      dashDir.normalize().multiplyScalar(10); // 10 meter dash
      playerPosition.current.add(dashDir);
      
      // Spawn flash particles at old position
      spawnFlashTracer(playerPosition.current.clone().sub(dashDir), playerPosition.current, 0xffd700);
    } 
    else if (skillType === 'heal') {
      setHealth(prev => Math.min(100, prev + 40));
      // Render flash ring locally
      spawnMuzzleFlashParticles(playerPosition.current.clone().setY(0.2), 0x10b981);
    }
    else if (skillType === 'scan') {
      // Brief sonar highlight: Make columns or peer labels glow!
      spawnMuzzleFlashParticles(playerPosition.current, 0x3b82f6);
      peerMeshes.current.forEach(({ nameplate }) => {
        nameplate.scale.set(6, 1.5, 1); // temporarily make peer nameplates massive
        setTimeout(() => {
          nameplate.scale.set(4, 1, 1);
        }, 4000);
      });
    }
  };

  // Weapon fire local handling
  const triggerShootWeapon = () => {
    if (reloading || isReloadingRef.current) return;
    if (currentAmmoRef.current <= 0) {
      // Auto trigger reload
      triggerReload();
      return;
    }

    const now = performance.now();
    const interval = 60000 / currentWeaponRef.current.fireRate;
    if (now - lastFiredTime.current < interval) return;
    lastFiredTime.current = now;

    // Expend bullet
    const newAmmo = currentAmmoRef.current - 1;
    currentAmmoRef.current = newAmmo;
    setAmmo(newAmmo);

    // Apply realistic weapon recoil: slightly shift pitch up
    cameraRotation.current.pitch = Math.min(Math.PI / 2.2, cameraRotation.current.pitch + currentWeaponRef.current.recoil);

    // Compute raycast forward
    const camera = cameraRef.current;
    if (!camera) return;

    const raycaster = new THREE.Raycaster();
    // Center of screen vector
    const centerPoint = new THREE.Vector2(0, 0);
    raycaster.setFromCamera(centerPoint, camera);

    // Bullet endpoint (default forward trajectory)
    const forwardDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    let bulletEndPoint = playerPosition.current.clone().add(forwardDir.clone().multiplyScalar(80));

    // Gather intersectables: destructible blocks + peer hitboxes
    const intersectables: THREE.Object3D[] = [];
    destructibleBlocks.current.forEach(block => {
      if (block.hp > 0) intersectables.push(block.mesh);
    });

    // Match meshes back to clientIds
    const peerHitboxesMap: { [uuid: string]: string } = {};
    peerMeshes.current.forEach(({ group }, clientId) => {
      group.traverse(child => {
        if (child instanceof THREE.Mesh) {
          intersectables.push(child);
          peerHitboxesMap[child.uuid] = clientId;
        }
      });
    });

    const intersects = raycaster.intersectObjects(intersectables);

    if (intersects.length > 0) {
      const firstHit = intersects[0];
      bulletEndPoint.copy(firstHit.point);

      // Check if we hit a destructible block
      let hitBlockId: string | null = null;
      destructibleBlocks.current.forEach((block, id) => {
        if (block.mesh === firstHit.object) {
          hitBlockId = id;
        }
      });

      if (hitBlockId) {
        // Damage destructible block
        const dmgAmount = currentWeaponRef.current.damage;
        const block = destructibleBlocks.current.get(hitBlockId)!;
        block.hp = Math.max(0, block.hp - dmgAmount);
        
        // Spawn sparks concrete color particles
        spawnImpactParticles(firstHit.point, 0xd1d5db);

        // Inform WebSocket server
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'destroy_block',
            blockId: hitBlockId,
            damage: dmgAmount
          }));
        }

        // Handle local destruction visual
        if (block.hp <= 0) {
          sceneRef.current?.remove(block.mesh);
          spawnDestructionDebris(firstHit.point, 0xd1d5db);
        }
      }

      // Check if we hit another player
      const hitPeerId = peerHitboxesMap[firstHit.object.uuid];
      if (hitPeerId) {
        // High fidelity headshot calculation: was the ray intercept near the upper boundary of the head box?
        const relativeY = firstHit.point.y - firstHit.object.position.y;
        const isHeadshot = relativeY > 0.6; // head hitbox sits higher
        const dmg = isHeadshot ? currentWeaponRef.current.damage * 2.5 : currentWeaponRef.current.damage;

        spawnImpactParticles(firstHit.point, 0xef4444); // blood impact spark

        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'hit_player',
            targetId: hitPeerId,
            damage: Math.round(dmg),
            isHeadshot
          }));
        }
      }
    }

    // Render tracer line
    const gunMuzzlePos = playerPosition.current.clone()
      .add(new THREE.Vector3(0.2, -0.3, -0.5).applyQuaternion(camera.quaternion));
    spawnTracerLine(gunMuzzlePos, bulletEndPoint);

    // Play local muzzle flash particles
    spawnMuzzleFlashParticles(gunMuzzlePos, 0xffa500);

    // Notify peers about weapon fire
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'weapon_fire',
        origin: { x: gunMuzzlePos.x, y: gunMuzzlePos.y, z: gunMuzzlePos.z },
        direction: { x: forwardDir.x, y: forwardDir.y, z: forwardDir.z }
      }));
    }
  };

  const triggerReload = () => {
    if (reloading || isReloadingRef.current || currentAmmoRef.current === currentWeaponRef.current.ammoMax) return;
    isReloadingRef.current = true;
    setReloading(true);

    setTimeout(() => {
      setAmmo(currentWeaponRef.current.ammoMax);
      currentAmmoRef.current = currentWeaponRef.current.ammoMax;
      setReloading(false);
      isReloadingRef.current = false;
    }, currentWeaponRef.current.reloadTime);
  };

  // Spawn visual bullet tracer lines that dissolve procedurally
  const spawnTracerLine = (start: THREE.Vector3, end: THREE.Vector3) => {
    const material = new THREE.LineBasicMaterial({ 
      color: 0xfffda1, 
      transparent: true, 
      opacity: 0.85 
    });
    const points = [start, end];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    sceneRef.current?.add(line);

    // Shrink and dissolve tracer
    let frames = 0;
    const animateTracer = () => {
      frames++;
      material.opacity -= 0.12;
      if (material.opacity <= 0) {
        sceneRef.current?.remove(line);
        geometry.dispose();
        material.dispose();
      } else {
        requestAnimationFrame(animateTracer);
      }
    };
    animateTracer();
  };

  const spawnFlashTracer = (start: THREE.Vector3, end: THREE.Vector3, colorVal: number) => {
    const material = new THREE.LineBasicMaterial({ 
      color: colorVal, 
      transparent: true, 
      opacity: 1 
    });
    const points = [start, end];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    sceneRef.current?.add(line);

    setTimeout(() => {
      sceneRef.current?.remove(line);
      geometry.dispose();
      material.dispose();
    }, 150);
  };

  // Spark / Impact hit points
  const spawnImpactParticles = (position: THREE.Vector3, colorHex: number) => {
    const particleGeo = new THREE.BufferGeometry();
    const positions: number[] = [];
    const velocities: THREE.Vector3[] = [];

    for (let i = 0; i < 15; i++) {
      positions.push(position.x, position.y, position.z);
      velocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        Math.random() * 4 + 1,
        (Math.random() - 0.5) * 5
      ));
    }

    particleGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ 
      color: colorHex, 
      size: 0.12, 
      transparent: true, 
      opacity: 0.9 
    });
    const points = new THREE.Points(particleGeo, material);
    sceneRef.current?.add(points);

    // Particle decay loop
    let decayFrames = 0;
    const animateSparks = () => {
      decayFrames++;
      const posArr = points.geometry.attributes.position.array as any;
      
      for (let i = 0; i < 15; i++) {
        const vel = velocities[i];
        posArr[i * 3] += vel.x * 0.016;
        posArr[i * 3 + 1] += vel.y * 0.016;
        posArr[i * 3 + 2] += vel.z * 0.016;
        
        // apply gravity to sparks
        vel.y -= 0.15;
      }
      points.geometry.attributes.position.needsUpdate = true;
      material.opacity -= 0.04;

      if (material.opacity <= 0) {
        sceneRef.current?.remove(points);
        particleGeo.dispose();
        material.dispose();
      } else {
        requestAnimationFrame(animateSparks);
      }
    };
    animateSparks();
  };

  const spawnMuzzleFlashParticles = (position: THREE.Vector3, colorVal: number) => {
    const material = new THREE.PointsMaterial({ color: colorVal, size: 0.15, transparent: true, opacity: 1 });
    const geometry = new THREE.BufferGeometry();
    const arr = [position.x, position.y, position.z];
    for (let i = 0; i < 8; i++) {
      arr.push(
        position.x + (Math.random() - 0.5) * 0.3,
        position.y + (Math.random() - 0.5) * 0.3,
        position.z + (Math.random() - 0.5) * 0.3
      );
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const p = new THREE.Points(geometry, material);
    sceneRef.current?.add(p);

    setTimeout(() => {
      sceneRef.current?.remove(p);
      geometry.dispose();
      material.dispose();
    }, 100);
  };

  // Voxel shattering debris
  const spawnDestructionDebris = (position: THREE.Vector3, colorHex: number) => {
    const debrisList: THREE.Mesh[] = [];
    const velocities: THREE.Vector3[] = [];

    // Spawn 8 tiny cubes
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
      const mat = new THREE.MeshLambertMaterial({ color: colorHex });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(position).add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5
      ));
      sceneRef.current?.add(m);
      debrisList.push(m);
      velocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        Math.random() * 5 + 2,
        (Math.random() - 0.5) * 6
      ));
    }

    let debrisFrames = 0;
    const animateDebris = () => {
      debrisFrames++;
      debrisList.forEach((mesh, index) => {
        const vel = velocities[index];
        mesh.position.addScaledVector(vel, 0.016);
        mesh.rotation.x += 0.05;
        mesh.rotation.y += 0.05;
        
        // Gravity pull
        vel.y -= 0.18;
      });

      if (debrisFrames > 60) {
        debrisList.forEach(m => {
          sceneRef.current?.remove(m);
          m.geometry.dispose();
          if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose());
          else m.material.dispose();
        });
      } else {
        requestAnimationFrame(animateDebris);
      }
    };
    animateDebris();
  };

  // Render text textures for floating peer nameplates
  const createNameplateSprite = (name: string, pHealth: number, isSpeaking: boolean, team: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.Sprite();

    // Semi transparent slate background
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.beginPath();
    ctx.roundRect(4, 4, 248, 56, 12);
    ctx.fill();

    // Border line based on team color
    ctx.lineWidth = 2;
    ctx.strokeStyle = team === 'Red' ? '#ef4444' : team === 'Blue' ? '#3b82f6' : '#10b981';
    ctx.stroke();

    // Render Speaker active voice indicator wave icon
    if (isSpeaking) {
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(24, 32, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Soldier ID Text
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 16px Courier New, sans-serif';
    ctx.fillText(name, isSpeaking ? 38 : 16, 28);

    // HP Bar status
    ctx.fillStyle = '#334155';
    ctx.fillRect(16, 38, 224, 6);
    
    ctx.fillStyle = pHealth < 35 ? '#ef4444' : '#10b981';
    ctx.fillRect(16, 38, Math.max(0, pHealth * 2.24), 6);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    return new THREE.Sprite(material);
  };

  // Main canvas initialization, controls setup and three.js context building
  useEffect(() => {
    if (!mountRef.current) return;

    // Build standard perspective Camera
    const camera = new THREE.PerspectiveCamera(75, mountRef.current.clientWidth / mountRef.current.clientHeight, 0.1, 1000);
    cameraRef.current = camera;
    camera.position.set(0, 1.6, 0);

    // Build core Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x0a0f1d); // deep immersive slate space
    scene.fog = new THREE.FogExp2(0x0f172a, 0.01);

    // Add Bullet tracers group
    const bullets = new THREE.Group();
    bulletsGroup.current = bullets;
    scene.add(bullets);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 40, 20);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Add Floor Arena
    const floorGeo = new THREE.PlaneGeometry(160, 160);
    const floorMat = new THREE.MeshStandardMaterial({ 
      color: 0x1e293b, 
      roughness: 0.65, 
      metalness: 0.2 
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Grid details on floor for high speed visual perception
    const gridHelper = new THREE.GridHelper(160, 40, 0x475569, 0x334155);
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

    // Spawn 8 giant columns for cover and shooting geometry
    const columnGeo = new THREE.CylinderGeometry(1.5, 1.5, 12, 12);
    const columnMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });
    const colsCoords = [
      [-15, -15], [-15, 15], [15, -15], [15, 15],
      [-30, 0], [30, 0], [0, -30], [0, 30]
    ];
    colsCoords.forEach(([cx, cz]) => {
      const col = new THREE.Mesh(columnGeo, columnMat);
      col.position.set(cx, 6, cz);
      scene.add(col);
    });

    // Spawn Boundary futuristic wall barricades
    const wallGeo = new THREE.BoxGeometry(160, 8, 1);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x020617 });
    const wallSouth = new THREE.Mesh(wallGeo, wallMat); wallSouth.position.set(0, 4, 80); scene.add(wallSouth);
    const wallNorth = new THREE.Mesh(wallGeo, wallMat); wallNorth.position.set(0, 4, -80); scene.add(wallNorth);
    
    const wallEast = new THREE.Mesh(wallGeo, wallMat); 
    wallEast.rotation.y = Math.PI / 2;
    wallEast.position.set(80, 4, 0); 
    scene.add(wallEast);

    const wallWest = new THREE.Mesh(wallGeo, wallMat); 
    wallWest.rotation.y = Math.PI / 2;
    wallWest.position.set(-80, 4, 0); 
    scene.add(wallWest);

    // --- Battle Royale Playzone Setup ---
    // Blue cylinder, unit radius (radius=1), scaled dynamically during tick updates
    const playzoneCylGeo = new THREE.CylinderGeometry(1, 1, 150, 32, 1, true);
    const playzoneCylMat = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      wireframe: true
    });
    const playzoneMesh = new THREE.Mesh(playzoneCylGeo, playzoneCylMat);
    playzoneMesh.position.set(0, 75, 0);
    scene.add(playzoneMesh);
    playzoneMeshRef.current = playzoneMesh;

    // Green target safe circle, unit radius (radius=1), scaled dynamically during tick updates
    const ringGeo = new THREE.RingGeometry(0.98, 1.0, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, side: THREE.DoubleSide });
    const targetZoneRing = new THREE.Mesh(ringGeo, ringMat);
    targetZoneRing.rotation.x = -Math.PI / 2;
    targetZoneRing.position.set(0, 0.05, 0);
    scene.add(targetZoneRing);
    targetZoneRingRef.current = targetZoneRing;

    // Initialize 20 Destructible concrete barricade box meshes
    const boxGeo = new THREE.BoxGeometry(2, 2, 2);
    // Visual crack color map: box color gets darker as HP diminishes
    for (let i = 0; i < 20; i++) {
      const boxMat = new THREE.MeshStandardMaterial({ 
        color: 0x64748b, // slate concrete
        roughness: 0.9 
      });
      const boxMesh = new THREE.Mesh(boxGeo, boxMat);
      
      // Scatter barricade blocks across middle region
      const gridX = (i % 5) * 6 - 12;
      const gridZ = Math.floor(i / 5) * 6 - 12;
      boxMesh.position.set(gridX, 1, gridZ);
      boxMesh.castShadow = true;
      boxMesh.receiveShadow = true;
      scene.add(boxMesh);

      destructibleBlocks.current.set(`box_${i}`, {
        mesh: boxMesh,
        hp: 100
      });
    }

    // Setup Dynamic Weather Particle System (Rain/Snow/SandStorm)
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      particlePositions[i] = (Math.random() - 0.5) * 160;
      particlePositions[i + 1] = Math.random() * 40;
      particlePositions[i + 2] = (Math.random() - 0.5) * 160;
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.15,
      transparent: true,
      opacity: 0.7
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);
    particleSystemRef.current = particles;

    // WebGL Renderer Setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    rendererRef.current = renderer;
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.shadowMap.enabled = true;
    mountRef.current.appendChild(renderer.domElement);

    const clock = new THREE.Clock();
    clockRef.current = clock;

    // Keyboard controls action tracking
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore controls if typing in custom modals
      if (document.activeElement?.tagName === 'INPUT') return;

      keys.current[e.code] = true;
      
      if (e.code === 'KeyR') {
        triggerReload();
      }

      // Space key for jumping (must verify isGrounded)
      if (e.code === 'Space') {
        if (isGrounded.current) {
          velocity.current.y = 8; // upward impulse velocity
          isGrounded.current = false;
        }
      }

      // Loot interaction Key F
      if (e.code === 'KeyF') {
        const p = currentLootProximity.current;
        if (p && socket && socket.readyState === WebSocket.OPEN) {
          if (p.type === 'airdrop') {
            socket.send(JSON.stringify({ type: 'loot_airdrop', airdropId: p.id }));
          } else if (p.type === 'lootbox') {
            socket.send(JSON.stringify({ type: 'loot_box', boxId: p.id }));
          }
        }
      }

      // Medical use Key H
      if (e.code === 'KeyH') {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'use_item', item: 'medkit' }));
        }
      }

      // Energy recovery boost Key J
      if (e.code === 'KeyJ') {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'use_item', item: 'booster' }));
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };

    // Mouse movement rotation handler (Pointer Lock look around)
    const handleMouseMove = (e: MouseEvent) => {
      if (!pointerLocked.current) return;
      
      const sensitivity = 0.0022;
      cameraRotation.current.yaw -= e.movementX * sensitivity;
      cameraRotation.current.pitch -= e.movementY * sensitivity;

      // Bound pitch to prevent flip overs
      cameraRotation.current.pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, cameraRotation.current.pitch));
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (!pointerLocked.current) {
        // Request pointer lock
        mountRef.current?.requestPointerLock();
        return;
      }
      
      if (e.button === 0) { // left click
        isShootingInput.current = true;
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        isShootingInput.current = false;
      }
    };

    const handlePointerLockChange = () => {
      pointerLocked.current = document.pointerLockElement === mountRef.current;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    // Initial WebSocket Join trigger
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'join_lobby',
        name: playerName,
        mode: mode
      }));
    }

    // Resize Handler
    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      cameraRef.current.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    // Clean up Three.js structures
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      window.removeEventListener('resize', handleResize);

      // Dispose geometries & materials
      floorGeo.dispose();
      floorMat.dispose();
      columnGeo.dispose();
      columnMat.dispose();
      wallGeo.dispose();
      wallMat.dispose();
      boxGeo.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      
      destructibleBlocks.current.forEach(b => b.mesh.geometry.dispose());

      if (renderer.domElement && mountRef.current?.contains(renderer.domElement)) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // Set up WebSocket peer, damage, block and weather listeners
  useEffect(() => {
    if (!socket) return;

    const handleSocketMessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        const scene = sceneRef.current;
        if (!scene) return;

        switch (msg.type) {
          case 'joined_room': {
            if (msg.playerState) {
              myIdRef.current = msg.playerState.id;
              // Set initial equipment from server join state
              localInventory.current = {
                helmetLevel: msg.playerState.helmetLevel || 1,
                vestLevel: msg.playerState.vestLevel || 1,
                medkits: msg.playerState.medkits !== undefined ? msg.playerState.medkits : 1,
                boosters: msg.playerState.boosters !== undefined ? msg.playerState.boosters : 2
              };
              onInventoryUpdate?.(localInventory.current);
            }

            // Update blocks health status with synced data
            if (msg.room && msg.room.destructibles) {
              Object.keys(msg.room.destructibles).forEach(bId => {
                const hp = msg.room.destructibles[bId];
                const block = destructibleBlocks.current.get(bId);
                if (block) {
                  block.hp = hp;
                  if (hp <= 0) {
                    scene.remove(block.mesh);
                  } else {
                    // Update color representing cracks
                    const mat = block.mesh.material as THREE.MeshStandardMaterial;
                    const r = 0.39 + (100 - hp) * 0.003;
                    const g = 0.45 - (100 - hp) * 0.003;
                    const b = 0.54 - (100 - hp) * 0.003;
                    mat.color.setRGB(r, g, b);
                  }
                }
              });
            }
            break;
          }

          case 'room_sync': {
            // 1. Sync Playzone Safe Circle
            if (msg.playzone) {
              const pz = msg.playzone;
              localPlayzone.current = pz;

              // Move and scale the Blue Zone cylinder
              if (playzoneMeshRef.current) {
                playzoneMeshRef.current.position.set(pz.centerX, 75, pz.centerZ);
                playzoneMeshRef.current.scale.set(pz.radius, 1, pz.radius);
              }

              // Move and scale the green Safe Circle line loop ring
              if (targetZoneRingRef.current) {
                targetZoneRingRef.current.position.set(pz.targetCenterX, 0.05, pz.targetCenterZ);
                targetZoneRingRef.current.scale.set(pz.targetRadius, pz.targetRadius, 1);
              }

              // Propagate playzone details to parent HUD
              const dx = playerPosition.current.x - pz.centerX;
              const dz = playerPosition.current.z - pz.centerZ;
              const distFromCenter = Math.sqrt(dx * dx + dz * dz);
              const distToSafeZone = Math.max(0, distFromCenter - pz.radius);
              onPlayzoneUpdate?.(pz, distToSafeZone);
            }

            // 2. Sync Airdrops (Supply Crates)
            if (msg.airdrops) {
              const syncedAirdrops = msg.airdrops as AirdropState[];
              const activeIds = new Set(syncedAirdrops.filter(ad => !ad.looted).map(ad => ad.id));

              // Clean up looted or deleted drops
              airdropMeshes.current.forEach((meshGroup, id) => {
                if (!activeIds.has(id)) {
                  scene.remove(meshGroup);
                  airdropMeshes.current.delete(id);
                }
              });

              // Add or update active drops
              syncedAirdrops.forEach(ad => {
                if (ad.looted) return;

                if (!airdropMeshes.current.has(ad.id)) {
                  const adGroup = new THREE.Group();

                  // Base red metal supply box
                  const boxGeo = new THREE.BoxGeometry(2.2, 2.2, 2.2);
                  const boxMat = new THREE.MeshStandardMaterial({ 
                    color: 0xef4444, 
                    roughness: 0.65, 
                    metalness: 0.2 
                  });
                  const baseBox = new THREE.Mesh(boxGeo, boxMat);
                  baseBox.position.y = 1.1;
                  baseBox.castShadow = true;
                  baseBox.receiveShadow = true;
                  adGroup.add(baseBox);

                  // Blue canvas tarp top
                  const tarpGeo = new THREE.BoxGeometry(2.35, 0.6, 2.35);
                  const tarpMat = new THREE.MeshStandardMaterial({ 
                    color: 0x3b82f6, 
                    roughness: 0.45 
                  });
                  const tarp = new THREE.Mesh(tarpGeo, tarpMat);
                  tarp.position.y = 2.25;
                  adGroup.add(tarp);

                  // High-visibility vertical smoke trail column (red neon light beam)
                  const smokeGeo = new THREE.CylinderGeometry(0.18, 0.18, 25, 8, 1, true);
                  const smokeMat = new THREE.MeshBasicMaterial({ 
                    color: 0xef4444, 
                    transparent: true, 
                    opacity: 0.5 
                  });
                  const smoke = new THREE.Mesh(smokeGeo, smokeMat);
                  smoke.position.y = 12.5;
                  adGroup.add(smoke);

                  // Canvas parachute overlay if drop is still high in the sky descending
                  if (ad.y > 1.2) {
                    const chuteGeo = new THREE.SphereGeometry(1.9, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2);
                    const chuteMat = new THREE.MeshBasicMaterial({ 
                      color: 0xe2e8f0, 
                      side: THREE.DoubleSide, 
                      transparent: true, 
                      opacity: 0.8 
                    });
                    const chute = new THREE.Mesh(chuteGeo, chuteMat);
                    chute.name = "chute_mesh";
                    chute.position.y = 5.5;
                    adGroup.add(chute);
                  }

                  adGroup.position.set(ad.x, ad.y, ad.z);
                  scene.add(adGroup);
                  airdropMeshes.current.set(ad.id, adGroup);
                } else {
                  // Position update
                  const adGroup = airdropMeshes.current.get(ad.id);
                  if (adGroup) {
                    adGroup.position.set(ad.x, ad.y, ad.z);
                    // Remove parachute representation if it has landed safely
                    if (ad.y <= 1.2) {
                      const chute = adGroup.getObjectByName("chute_mesh");
                      if (chute) adGroup.remove(chute);
                    }
                  }
                }
              });
            }

            // 3. Sync LootBoxes (Death Crates of fallen players)
            if (msg.lootBoxes) {
              const syncedBoxes = msg.lootBoxes as LootBoxState[];
              const activeIds = new Set(syncedBoxes.filter(box => !box.looted).map(box => box.id));

              // Clean up looted crates
              lootBoxMeshes.current.forEach((meshGroup, id) => {
                if (!activeIds.has(id)) {
                  scene.remove(meshGroup);
                  lootBoxMeshes.current.delete(id);
                }
              });

              // Add/update active crates
              syncedBoxes.forEach(box => {
                if (box.looted) return;

                if (!lootBoxMeshes.current.has(box.id)) {
                  const boxGroup = new THREE.Group();

                  // Olive green wooden supply casket
                  const crateGeo = new THREE.BoxGeometry(1.3, 0.8, 0.8);
                  const crateMat = new THREE.MeshStandardMaterial({ 
                    color: 0x14532d, 
                    roughness: 0.8 
                  });
                  const crate = new THREE.Mesh(crateGeo, crateMat);
                  crate.position.y = 0.4;
                  crate.castShadow = true;
                  crate.receiveShadow = true;
                  boxGroup.add(crate);

                  // Glowing emerald light pillar beacon for quick discovery
                  const glowGeo = new THREE.CylinderGeometry(0.1, 0.1, 6, 8, 1, true);
                  const glowMat = new THREE.MeshBasicMaterial({ 
                    color: 0x10b981, 
                    transparent: true, 
                    opacity: 0.45 
                  });
                  const glow = new THREE.Mesh(glowGeo, glowMat);
                  glow.position.y = 3;
                  boxGroup.add(glow);

                  boxGroup.position.set(box.x, box.y, box.z);
                  scene.add(boxGroup);
                  lootBoxMeshes.current.set(box.id, boxGroup);
                } else {
                  const boxGroup = lootBoxMeshes.current.get(box.id);
                  if (boxGroup) {
                    boxGroup.position.set(box.x, box.y, box.z);
                  }
                }
              });
            }
            break;
          }

          case 'loot_success': {
            // Update armor & med counts immediately
            localInventory.current = {
              helmetLevel: msg.helmetLevel,
              vestLevel: msg.vestLevel,
              medkits: msg.medkits,
              boosters: msg.boosters
            };
            onInventoryUpdate?.(localInventory.current);
            playVoiceSynthesis('System', `Looted supply package: ${msg.item}!`, 'FFA');
            break;
          }

          case 'inventory_sync': {
            // Sync medcounts from server usage operations
            localInventory.current.medkits = msg.medkits;
            localInventory.current.boosters = msg.boosters;
            onInventoryUpdate?.(localInventory.current);
            
            if (msg.health !== undefined) {
              setHealth(msg.health);
            }
            if (msg.energy !== undefined) {
              setEnergy(msg.energy);
            }
            break;
          }

          case 'player_joined': {
            const p = msg.player;
            if (peerMeshes.current.has(p.id)) return;

            // Spawn elegant 3D body representation for other soldiers
            const group = new THREE.Group();
            
            // Core body mesh
            const bodyGeo = new THREE.BoxGeometry(0.8, 1.8, 0.8);
            const teamColor = p.team === 'Red' ? 0xef4444 : p.team === 'Blue' ? 0x3b82f6 : 0x10b981;
            const bodyMat = new THREE.MeshStandardMaterial({ 
              color: teamColor, 
              roughness: 0.5, 
              metalness: 0.3 
            });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.y = 0.9;
            body.castShadow = true;
            group.add(body);

            // Arm visor pointing forward
            const gunMockGeo = new THREE.BoxGeometry(0.2, 0.2, 0.7);
            const gunMockMat = new THREE.MeshStandardMaterial({ color: 0x1e293b });
            const gunMock = new THREE.Mesh(gunMockGeo, gunMockMat);
            gunMock.position.set(0.3, 1.1, -0.6);
            group.add(gunMock);

            // Floating Nameplate
            const nameplate = createNameplateSprite(p.name, p.health, p.isSpeaking, p.team);
            nameplate.position.y = 2.4;
            nameplate.scale.set(4, 1, 1);
            group.add(nameplate);

            group.position.set(p.x, p.y, p.z);
            scene.add(group);

            peerMeshes.current.set(p.id, { group, nameplate });
            peersMap.current.set(p.id, { ...p, isWalking: false, isShooting: false, lastUpdate: Date.now() });
            break;
          }

          case 'peer_update': {
            const pId = msg.id;
            const peer = peerMeshes.current.get(pId);
            const data = peersMap.current.get(pId);

            if (peer && data) {
              peer.group.position.set(msg.x, msg.y, msg.z);
              peer.group.rotation.y = msg.ry;

              // Animate leg walking bobbing using timestamp
              const bodyMesh = peer.group.children[0] as THREE.Mesh;
              if (msg.isWalking) {
                const bob = Math.sin(performance.now() * 0.01) * 0.12;
                bodyMesh.position.y = 0.9 + bob;
              } else {
                bodyMesh.position.y = 0.9;
              }

              data.x = msg.x;
              data.y = msg.y;
              data.z = msg.z;
              data.ry = msg.ry;
              data.weapon = msg.weapon;
              data.isWalking = msg.isWalking;
              data.isShooting = msg.isShooting;
              data.lastUpdate = Date.now();
            }
            break;
          }

          case 'peer_fire': {
            const pId = msg.id;
            const tracerColor = msg.weapon === 'Apex-Valkyrie Railgun' ? 0xa855f7 : 0xfffda1;
            
            // Draw a tracer bullet origin from peer weapon muzzle
            const peer = peerMeshes.current.get(pId);
            if (peer && msg.origin) {
              const startPos = new THREE.Vector3(msg.origin.x, msg.origin.y, msg.origin.z);
              const dir = new THREE.Vector3(msg.direction.x, msg.direction.y, msg.direction.z).normalize();
              const endPos = startPos.clone().add(dir.multiplyScalar(80));

              // Check if ray hits anything for terminating tracer early
              const rc = new THREE.Raycaster(startPos, dir);
              const obstacles: THREE.Object3D[] = [];
              destructibleBlocks.current.forEach(b => { if (b.hp > 0) obstacles.push(b.mesh); });
              const hits = rc.intersectObjects(obstacles);
              if (hits.length > 0) {
                endPos.copy(hits[0].point);
              }

              spawnTracerLine(startPos, endPos);
              spawnMuzzleFlashParticles(startPos, tracerColor);
            }
            break;
          }

          case 'peer_skill': {
            const pId = msg.id;
            const skillType = msg.skillType;
            const peer = peerMeshes.current.get(pId);
            if (peer) {
              if (skillType === 'dash') {
                spawnMuzzleFlashParticles(peer.group.position, 0xffd700);
              } else if (skillType === 'heal') {
                spawnMuzzleFlashParticles(peer.group.position, 0x10b981);
              } else if (skillType === 'scan') {
                spawnMuzzleFlashParticles(peer.group.position, 0x3b82f6);
              }
            }
            break;
          }

          case 'block_damaged': {
            const bId = msg.blockId;
            const hp = msg.hp;
            const block = destructibleBlocks.current.get(bId);
            if (block) {
              block.hp = hp;
              if (hp <= 0) {
                scene.remove(block.mesh);
                spawnDestructionDebris(block.mesh.position, 0x64748b);
              } else {
                // Dim color of block as cracks build up
                const mat = block.mesh.material as THREE.MeshStandardMaterial;
                const r = 0.39 + (100 - hp) * 0.003;
                const g = 0.45 - (100 - hp) * 0.003;
                const b = 0.54 - (100 - hp) * 0.003;
                mat.color.setRGB(r, g, b);
              }
            }
            break;
          }

          case 'player_damaged': {
            const targetId = msg.id;
            const hp = msg.health;
            
            if (targetId === socket.url) { // Wait! We should check if targetId matches our client welcome ID
              // But socket.url doesn't hold the client ID, we'll map that separately.
            }

            // Sync peer visual health bar above nameplate
            const peer = peerMeshes.current.get(targetId);
            const data = peersMap.current.get(targetId);
            if (peer && data) {
              data.health = hp;
              
              // Redraw Nameplate Canvas Texture
              scene.remove(peer.group); // replace nameplate
              const teamColor = data.team === 'Red' ? 0xef4444 : data.team === 'Blue' ? 0x3b82f6 : 0x10b981;
              
              const freshNameplate = createNameplateSprite(data.name, hp, data.isSpeaking, data.team);
              freshNameplate.position.y = 2.4;
              freshNameplate.scale.set(4, 1, 1);
              
              peer.group.children[2] = freshNameplate; // index 2 is nameplate Sprite
              peer.nameplate = freshNameplate;
              scene.add(peer.group);
            }
            break;
          }

          case 'peer_voice_indicator':
          case 'peer_voice': {
            const pid = msg.id;
            const isSpk = msg.isSpeaking;
            const peer = peerMeshes.current.get(pid);
            const data = peersMap.current.get(pid);

            if (peer && data) {
              data.isSpeaking = isSpk;

              // Re-draw nameplate with green wave speaking feedback active
              const freshNameplate = createNameplateSprite(data.name, data.health, isSpk, data.team);
              freshNameplate.position.y = 2.4;
              freshNameplate.scale.set(4, 1, 1);
              peer.group.children[2] = freshNameplate;
              peer.nameplate = freshNameplate;

              // If quick tactical phrase/text macro is sent, speak it locally using Web Speech Synthesis!
              if (msg.textMacro) {
                const now = Date.now();
                if (!latestSpeakerTimer.current[pid] || now - latestSpeakerTimer.current[pid] > 2000) {
                  latestSpeakerTimer.current[pid] = now;
                  playVoiceSynthesis(data.name, msg.textMacro, data.team);
                }
              }
            }

            // Sync Speaking names in state back to parent HUD
            const activeSpeakers: string[] = [];
            peersMap.current.forEach(p => {
              if (p.isSpeaking) activeSpeakers.push(p.name);
            });
            onPeerSpeakingUpdate(activeSpeakers);
            break;
          }

          case 'player_killed': {
            const victimId = msg.victimId;
            const killerId = msg.killerId;
            const isHs = msg.isHeadshot;

            const victimData = peersMap.current.get(victimId);
            const killerData = peersMap.current.get(killerId);

            const vName = victimId === 'self' ? playerName : (victimData?.name || 'Unknown');
            const kName = killerId === 'self' ? playerName : (killerData?.name || 'Unknown');

            onKillFeedUpdate({
              id: Math.random().toString(),
              killerName: kName,
              killerTeam: killerId === 'self' ? team : killerData?.team,
              victimName: vName,
              victimTeam: victimId === 'self' ? team : victimData?.team,
              weapon: msg.weapon,
              isHeadshot: isHs
            });

            // Handle death of player self
            if (victimId === 'self') {
              setHealth(0);
              statsRef.current.deaths++;
              onStatsUpdate(statsRef.current.kills, statsRef.current.deaths, statsRef.current.score);
              
              // Trigger local flash bang indicator on death
              spawnMuzzleFlashParticles(playerPosition.current, 0xff0000);
            } 
            else if (killerId === 'self') {
              statsRef.current.kills++;
              statsRef.current.score += isHs ? 150 : 100;
              onStatsUpdate(statsRef.current.kills, statsRef.current.deaths, statsRef.current.score);
            }

            // Trigger peer removal visual
            const peer = peerMeshes.current.get(victimId);
            if (peer) {
              scene.remove(peer.group);
              spawnDestructionDebris(peer.group.position, 0xef4444);
              peerMeshes.current.delete(victimId);
              peersMap.current.delete(victimId);
            }
            break;
          }

          case 'player_respawned': {
            const id = msg.id;
            if (id === 'self' || id === myIdRef.current) {
              setHealth(100);
              setEnergy(100);
              playerPosition.current.set(msg.x, msg.y, msg.z);
              velocity.current.set(0, 0, 0);
              isGrounded.current = false; // sky drop parachute!

              // Reset starting equipment upon respawning
              localInventory.current = {
                helmetLevel: 1,
                vestLevel: 1,
                medkits: 1,
                boosters: 2
              };
              onInventoryUpdate?.(localInventory.current);
            } else {
              // Re-add respawning peer
              // Socket will trigger another player_joined automatically or we can spawn manually.
            }
            break;
          }

          case 'player_left': {
            const leftId = msg.id;
            const peer = peerMeshes.current.get(leftId);
            if (peer) {
              scene.remove(peer.group);
              peerMeshes.current.delete(leftId);
              peersMap.current.delete(leftId);
            }

            const activeSpeakers: string[] = [];
            peersMap.current.forEach(p => {
              if (p.isSpeaking) activeSpeakers.push(p.name);
            });
            onPeerSpeakingUpdate(activeSpeakers);
            break;
          }
        }
      } catch (err) {
        console.error('WebSocket client receiving parse error:', err);
      }
    };

    socket.addEventListener('message', handleSocketMessage);
    return () => {
      socket.removeEventListener('message', handleSocketMessage);
    };
  }, [socket, playerName, team, mode]);

  // Main 3D Physics & Animation Frame Render loop
  useEffect(() => {
    let frameId: number;

    const tick = () => {
      if (!sceneRef.current || !cameraRef.current || !rendererRef.current || !clockRef.current) return;

      const delta = Math.min(0.05, clockRef.current.getDelta()); // cap delta to prevent crazy clipping

      // 1. Move weather particles according to wind/gravity multipliers
      if (particleSystemRef.current && activeWeather !== 'clear') {
        const points = particleSystemRef.current;
        const posAttr = points.geometry.attributes.position.array as any;
        
        for (let i = 0; i < particleCount * 3; i += 3) {
          // move y downwards
          if (activeWeather === 'rain') {
            posAttr[i + 1] -= delta * 32; // rapid rain drop
            // rain drift
            posAttr[i] += delta * 1;
          } else if (activeWeather === 'snow') {
            posAttr[i + 1] -= delta * 4; // slow drifting snow
            // sway
            posAttr[i] += Math.sin(performance.now() * 0.001 + i) * 0.05;
          } else if (activeWeather === 'sandstorm') {
            posAttr[i + 1] -= delta * 12; // horizontal blowing dust
            posAttr[i] -= delta * 25; // heavy horizontal wind!
          }

          // reset particles hitting the floor
          if (posAttr[i + 1] <= 0) {
            posAttr[i + 1] = 40;
            posAttr[i] = (Math.random() - 0.5) * 160;
            posAttr[i + 2] = (Math.random() - 0.5) * 160;
          }
        }
        points.geometry.attributes.position.needsUpdate = true;
      }

      // 2. Perform player movement input & Euler-Cromer Physics Integration
      if (pointerLocked.current && health > 0) {
        const moveVec = new THREE.Vector3();
        
        // Front/back directions
        if (keys.current['KeyW']) moveVec.z -= 1;
        if (keys.current['KeyS']) moveVec.z += 1;
        // Strafe directions
        if (keys.current['KeyA']) moveVec.x -= 1;
        if (keys.current['KeyD']) moveVec.x += 1;

        moveVec.normalize();
        
        // Rotate input into camera yaw coordinate grid orientation
        moveVec.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraRotation.current.yaw);

        // Apply Weather movement speed modifiers
        let speedMultiplier = 1.0;
        if (activeWeather === 'rain') speedMultiplier = 0.82; // mud slowing down sprinting
        else if (activeWeather === 'snow') speedMultiplier = 0.95; // slippery movement
        else if (activeWeather === 'sandstorm') speedMultiplier = 0.75; // heavy storm headwind

        // Integrate acceleration into velocity
        velocity.current.x += moveVec.x * moveSpeed.current * speedMultiplier * delta * 6;
        velocity.current.z += moveVec.z * moveSpeed.current * speedMultiplier * delta * 6;
      }

      // Apply standard decay friction factors (slippery or sand resistance)
      velocity.current.x *= frictionFactor.current;
      velocity.current.z *= frictionFactor.current;

      // Gravity integration with Parachute Glide
      if (!isGrounded.current) {
        if (playerPosition.current.y > 1.62) {
          // If in sky, apply parachute slow terminal descend limit!
          // Slow descend: max -3.5 units/sec falling velocity
          velocity.current.y = Math.max(-3.5, velocity.current.y - 12 * delta);
          
          // Enhanced gliding controls! WASD moves the player faster in the air to allow landing selection
          if (pointerLocked.current && health > 0) {
            const glideVec = new THREE.Vector3();
            if (keys.current['KeyW']) glideVec.z -= 1.8; // forward steer
            if (keys.current['KeyS']) glideVec.z += 1.2;
            if (keys.current['KeyA']) glideVec.x -= 1.2;
            if (keys.current['KeyD']) glideVec.x += 1.2;
            
            glideVec.normalize();
            glideVec.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraRotation.current.yaw);
            
            playerPosition.current.x += glideVec.x * delta * 18;
            playerPosition.current.z += glideVec.z * delta * 18;
          }
        } else {
          velocity.current.y -= 25 * delta; // standard heavy gravitational acceleration
        }
      }

      // Sandstorm active blowing drift force
      if (activeWeather === 'sandstorm') {
        velocity.current.x -= delta * 2.5; // sandstorm wind drift
      }

      // Integrate velocity into player coordinates
      playerPosition.current.x += velocity.current.x * delta;
      playerPosition.current.y += velocity.current.y * delta;
      playerPosition.current.z += velocity.current.z * delta;

      // Floor collision checks
      if (playerPosition.current.y <= 1.6) {
        playerPosition.current.y = 1.6;
        velocity.current.y = 0;
        isGrounded.current = true;
      }

      // Column barriers boundaries collisions check
      const columnsCoords = [
        [-15, -15], [-15, 15], [15, -15], [15, 15],
        [-30, 0], [30, 0], [0, -30], [0, 30]
      ];
      columnsCoords.forEach(([cx, cz]) => {
        const dx = playerPosition.current.x - cx;
        const dz = playerPosition.current.z - cz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const colRadius = 1.65; // radius + player buffer
        if (dist < colRadius) {
          // Push player out of cylinder bounds
          const pushX = (dx / dist) * colRadius;
          const pushZ = (dz / dist) * colRadius;
          playerPosition.current.x = cx + pushX;
          playerPosition.current.z = cz + pushZ;
          velocity.current.set(0, velocity.current.y, 0); // stall speed
        }
      });

      // Boundary perimeter walls check
      if (playerPosition.current.x < -78) playerPosition.current.x = -78;
      if (playerPosition.current.x > 78) playerPosition.current.x = 78;
      if (playerPosition.current.z < -78) playerPosition.current.z = -78;
      if (playerPosition.current.z > 78) playerPosition.current.z = 78;

      // --- Battle Royale Active Proximity & Steer Updates ---
      const isCurrentlyGliding = playerPosition.current.y > 1.62;
      if (localGliding.current !== isCurrentlyGliding) {
        localGliding.current = isCurrentlyGliding;
        onGlidingChange?.(isCurrentlyGliding);
        if (!isCurrentlyGliding) {
          playVoiceSynthesis('System', "Glider landed! Engage ground combat.", 'FFA');
        }
      }

      // Safe Zone real-time distance update
      if (localPlayzone.current) {
        const pz = localPlayzone.current;
        const dx = playerPosition.current.x - pz.centerX;
        const dz = playerPosition.current.z - pz.centerZ;
        const distFromCenter = Math.sqrt(dx * dx + dz * dz);
        const distToSafeZone = Math.max(0, distFromCenter - pz.radius);
        onPlayzoneUpdate?.(pz, distToSafeZone);
      }

      // Active loot selection proximity check
      let nearestLoot: { id: string; name: string; type: 'airdrop' | 'lootbox' } | null = null;
      let minDist = 4.5;

      airdropMeshes.current.forEach((meshGroup, id) => {
        const dist = playerPosition.current.distanceTo(meshGroup.position);
        if (dist < minDist) {
          minDist = dist;
          nearestLoot = { id, name: "SUPPLY DROP CRATE", type: 'airdrop' };
        }
      });

      lootBoxMeshes.current.forEach((meshGroup, id) => {
        const dist = playerPosition.current.distanceTo(meshGroup.position);
        if (dist < minDist) {
          minDist = dist;
          nearestLoot = { id, name: "DEATH CRATE LOOT", type: 'lootbox' };
        }
      });

      if (JSON.stringify(currentLootProximity.current) !== JSON.stringify(nearestLoot)) {
        currentLootProximity.current = nearestLoot;
        onLootProximityChange?.(nearestLoot);
      }

      // 3. Update Camera parameters (Apply pointer locked pitch/yaw)
      const camQuat = new THREE.Quaternion()
        .setFromEuler(new THREE.Euler(cameraRotation.current.pitch, cameraRotation.current.yaw, 0, 'YXZ'));
      cameraRef.current.quaternion.copy(camQuat);
      cameraRef.current.position.copy(playerPosition.current);

      // 4. Continuously fire bullets if input held (Automatic rifles)
      if (isShootingInput.current && currentWeaponRef.current.type === 'Rifle') {
        triggerShootWeapon();
      } else if (isShootingInput.current && currentWeaponRef.current.type !== 'Rifle') {
        triggerShootWeapon();
        isShootingInput.current = false; // Semi autos fire only on single click
      }

      // 5. Send regular position/rotation sync updates to WebSocket server (throlled)
      if (socket && socket.readyState === WebSocket.OPEN && health > 0) {
        const isWalk = Math.abs(velocity.current.x) > 0.1 || Math.abs(velocity.current.z) > 0.1;
        socket.send(JSON.stringify({
          type: 'player_update',
          x: playerPosition.current.x,
          y: playerPosition.current.y,
          z: playerPosition.current.z,
          ry: cameraRotation.current.yaw,
          rx: cameraRotation.current.pitch,
          isWalking: isWalk,
          isShooting: isShootingInput.current
        }));
      }

      // Render Scene
      rendererRef.current.render(sceneRef.current, cameraRef.current);
      frameId = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [activeWeather, health, energy, reloading]);

  return (
    <div 
      ref={mountRef} 
      id="three-fps-canvas-container" 
      className="w-full h-full relative cursor-crosshair overflow-hidden"
    >
      {/* Pointer Lock Help message Overlay (displays if not pointer locked) */}
      {!pointerLocked.current && (
        <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm flex flex-col items-center justify-center text-white p-6 z-30 text-center">
          <Crosshair className="w-12 h-12 text-emerald-400 mb-4 animate-pulse" />
          <h2 className="text-md font-extrabold uppercase tracking-widest text-slate-100">
            Tactical Simulation Ready
          </h2>
          <p className="text-xs text-slate-400 max-w-sm mt-1 mb-6 leading-relaxed">
            Click inside the display port to initialize pointer lock mouse controls. Move with <span className="text-white bg-slate-800 px-1 py-0.5 rounded font-mono font-bold">WASD</span>, jump with <span className="text-white bg-slate-800 px-1.5 py-0.5 rounded font-mono font-bold">SPACE</span>, and shoot with <span className="text-white bg-slate-800 px-1 py-0.5 rounded font-mono font-bold">CLICK</span>.
          </p>
          <button 
            onClick={() => mountRef.current?.requestPointerLock()}
            className="px-6 py-2.5 bg-emerald-500 text-slate-950 text-xs font-bold uppercase tracking-widest rounded-lg transition-all shadow-lg shadow-emerald-500/10 cursor-pointer"
          >
            Lock Target Coordinates
          </button>
        </div>
      )}
    </div>
  );
};
