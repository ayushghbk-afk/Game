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
  },
  {
    id: 'awm',
    name: 'AWM-Vanguard Bolt Sniper',
    type: 'Sniper',
    damage: 120,
    fireRate: 45,
    ammoMax: 5,
    reloadTime: 3200,
    recoil: 0.18,
    energyCost: 10,
    description: 'Legendary magnum bolt-action sniper rifle. Devastating damage at long distances, equipped with specialized armor-piercing rounds.',
    color: '#10b981'
  },
  {
    id: 'groza',
    name: 'Groza-S Bullpup AR',
    type: 'Rifle',
    damage: 28,
    fireRate: 750,
    ammoMax: 30,
    reloadTime: 1800,
    recoil: 0.04,
    energyCost: 0,
    description: 'Integrated silenced bullpup assault rifle. High rate of fire with heavy stopping power up close.',
    color: '#f59e0b'
  },
  {
    id: 'm249',
    name: 'M249-Titan Heavy LMG',
    type: 'LMG',
    damage: 19,
    fireRate: 900,
    ammoMax: 100,
    reloadTime: 4200,
    recoil: 0.05,
    energyCost: 0,
    description: 'High-capacity squad automatic weapon. 100-round belt-fed capacity allows for relentless suppression of multiple enemies.',
    color: '#ec4899'
  },
  {
    id: 'vector',
    name: 'Vector-Vortex SMG',
    type: 'SMG',
    damage: 13,
    fireRate: 1200,
    ammoMax: 33,
    reloadTime: 1400,
    recoil: 0.02,
    energyCost: 0,
    description: 'Extreme rate of fire submachine gun. Shreds enemies in close quarters with absolute recoil stability.',
    color: '#06b6d4'
  },
  {
    id: 'deagle',
    name: 'Deagle-Plasma Sidearm',
    type: 'Pistol',
    damage: 38,
    fireRate: 240,
    ammoMax: 7,
    reloadTime: 1300,
    recoil: 0.07,
    energyCost: 10,
    description: 'High-caliber plasma hand cannon. Deals serious damage per shot with high stopping power.',
    color: '#e11d48'
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
