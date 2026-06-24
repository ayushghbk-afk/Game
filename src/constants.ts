import { WeaponConfig } from './types';

export const WEAPONS: WeaponConfig[] = [
  {
    id: 'rifle',
    name: 'M4-Sentinel Rifle',
    type: 'Rifle',
    damage: 24,
    fireRate: 600, // 100ms interval
    ammoMax: 30,
    reloadTime: 1800,
    recoil: 0.03,
    energyCost: 0,
    description: 'Versatile automatic energy rifle. Balanced fire rate, manageable recoil, and highly dependable in all ranges.',
    color: '#3b82f6'
  },
  {
    id: 'sniper',
    name: 'Apex-Valkyrie Railgun',
    type: 'Sniper',
    damage: 85,
    fireRate: 50, // 1200ms interval
    ammoMax: 5,
    reloadTime: 2500,
    recoil: 0.12,
    energyCost: 15,
    description: 'Precision hyper-velocity rail sniper. Massive single-bullet damage. Pierces through targets, uses minor skill energy to zoom-stabilize.',
    color: '#a855f7'
  },
  {
    id: 'shotgun',
    name: 'Havoc-Scatter Cannon',
    type: 'Shotgun',
    damage: 15, // per pellet (multiplied by 8 pellets = 120 max point blank)
    fireRate: 85, // 700ms interval
    ammoMax: 8,
    reloadTime: 2200,
    recoil: 0.1,
    energyCost: 0,
    description: 'Close-quarters heavy kinetic scattergun. Deploys 8 fragmentation pellets per blast for unmatched damage up close.',
    color: '#ef4444'
  },
  {
    id: 'pistol',
    name: 'Quantum Blaster',
    type: 'Pistol',
    damage: 18,
    fireRate: 350, // 170ms interval
    ammoMax: 15,
    reloadTime: 1100,
    recoil: 0.01,
    energyCost: 35, // Charging the shot uses 35 energy
    description: 'Lightweight sidearm. Infinite backup reload, holds 15 energy bolts. Skill action triggers a tracking Plasma Burst using energy.',
    color: '#10b981'
  }
];

export const SKILLS = [
  {
    id: 'dash',
    name: 'Quantum Warp (Dash)',
    cost: 40,
    description: 'Instantly warp 8 meters in the moving direction to dodge fire or close in.',
    cooldown: 3000
  },
  {
    id: 'heal',
    name: 'Nanite Regen Burst',
    cost: 60,
    description: 'Inject a cloud of micro-nanites to restore 40 Health and increase movement speed briefly.',
    cooldown: 8000
  },
  {
    id: 'scan',
    name: 'Sonar Wall-Pulse',
    cost: 30,
    description: 'Emit an electromagnetic pulse that pings all enemy coordinates in the arena.',
    cooldown: 6000
  }
];

export const MAP_GRID_SIZE = 100;
export const SPAWN_RANGE = 40;
