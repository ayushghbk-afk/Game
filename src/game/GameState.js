// GameState — single authoritative player progress object + tiny event bus.
// Persisted through SaveSystem; everything (credits, upgrades, missions,
// discoveries, achievements, settings) lives here.
import { DEFAULT_SETTINGS, ECONOMY, LEVELS, UPGRADES } from '../config.js';
import { addResource, cargoUsed } from '../world/Resources.js';
import { SaveSystem } from '../save/SaveSystem.js';

export const ACHIEVEMENTS = [
  { id: 'first-orbit', name: 'FIRST ORBIT', desc: 'Enter your first planetary orbit.' },
  { id: 'moonwalker', name: 'MOONWALKER', desc: 'Visit the Moon.' },
  { id: 'red-planet', name: 'RED PLANET', desc: 'Reach Mars.' },
  { id: 'giant-step', name: 'GIANT STEP', desc: 'Reach Jupiter.' },
  { id: 'ring-world', name: 'RING WORLD', desc: 'Visit Saturn.' },
  { id: 'solar-explorer', name: 'SOLAR EXPLORER', desc: 'Visit every planet.' },
  { id: 'miner', name: 'PROSPECTOR', desc: 'Mine 200 units of ore.' },
  { id: 'tycoon', name: 'TYCOON', desc: 'Hold 10,000 credits.' },
  { id: 'tourist', name: 'PLANETFALL', desc: 'Land on a planet surface.' },
  { id: 'docked', name: 'HARBOR MASTER', desc: 'Dock at a space station.' },
  { id: 'watcher', name: 'THE WATCHER', desc: 'Discover a deep-space anomaly.' },
  { id: 'far-horizons', name: 'FAR HORIZONS', desc: 'Reach Neptune.' }
];

const PLANET_IDS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

export function freshState() {
  return {
    version: 1,
    credits: ECONOMY.startCredits,
    xp: 0,
    resources: { iron: 0, nickel: 0, water: 0, ice: 0, rare: 0 },
    upgrades: { engine: 1, tank: 1, shield: 1, scanner: 1, cargo: 1 },
    missions: { active: 'm1', completed: [], failed: [] },
    discoveries: [],     // bodies scanned
    visited: [],         // bodies entered SOI of
    anomalies: [],       // anomaly ids found
    achievements: [],
    stats: { orbits: 0, landings: 0, docks: 0, mined: 0, jumps: 0, scans: 0 },
    settings: { ...DEFAULT_SETTINGS },
    ship: null,          // filled by Game on save
    playTime: 0
  };
}

export class GameState {
  constructor() {
    this.state = freshState();
    this.listeners = new Map();
    this.saveMeta = { lastSaved: 0 };
  }

  on(evt, fn) { (this.listeners.get(evt) || this.listeners.set(evt, []).get(evt)).push(fn); }
  emit(evt, arg) { for (const fn of this.listeners.get(evt) || []) fn(arg); }

  // ---- credits / xp ----
  get credits() { return this.state.credits; }
  addCredits(n) {
    this.state.credits = Math.max(0, Math.round(this.state.credits + n));
    this.emit('credits', this.state.credits);
    if (this.state.credits >= 10000) this.award('tycoon');
  }
  spend(n) {
    if (this.state.credits < n) return false;
    this.addCredits(-n);
    return true;
  }
  addXP(n) {
    const before = this.level();
    this.state.xp += n;
    const after = this.level();
    this.emit('xp', this.state.xp);
    if (after > before) this.emit('levelup', after);
  }
  level() {
    let lvl = 1;
    for (let i = 0; i < LEVELS.length; i++) if (this.state.xp >= LEVELS[i]) lvl = i + 1;
    return lvl;
  }
  xpProgress() {
    const lvl = this.level();
    const cur = LEVELS[lvl - 1] ?? 0, next = LEVELS[lvl] ?? cur * 1.4 + 1000;
    return (this.state.xp - cur) / (next - cur);
  }

  // ---- cargo ----
  cargoCapacity() {
    return UPGRADES.cargo.tiers[this.state.upgrades.cargo - 1].capacity;
  }
  cargoUsed() { return cargoUsed(this.state.resources); }
  addCargo(type, amount, capacity) {
    const accepted = addResource(this.state.resources, type, amount, capacity);
    if (accepted > 0) this.emit('cargo');
    return accepted;
  }
  sellAll() {
    let total = 0;
    for (const k in this.state.resources) {
      total += this.state.resources[k] * ECONOMY.resources[k].price;
      this.state.resources[k] = 0;
    }
    if (total > 0) { this.addCredits(total); this.emit('cargo'); }
    return total;
  }
  sellOne(type, amount) {
    const have = this.state.resources[type] || 0;
    const n = Math.min(have, amount);
    if (n <= 0) return 0;
    this.state.resources[type] -= n;
    const value = n * ECONOMY.resources[type].price;
    this.addCredits(value);
    this.emit('cargo');
    return value;
  }

  // ---- discoveries / achievements ----
  discover(bodyId) {
    if (!this.state.discoveries.includes(bodyId)) {
      this.state.discoveries.push(bodyId);
      this.emit('discovery', bodyId);
      return true;
    }
    return false;
  }
  visit(bodyId) {
    if (!this.state.visited.includes(bodyId)) {
      this.state.visited.push(bodyId);
      this.emit('visit', bodyId);
      return true;
    }
    return false;
  }
  findAnomaly(id) {
    if (!this.state.anomalies.includes(id)) {
      this.state.anomalies.push(id);
      this.award('watcher');
      this.emit('anomaly', id);
      return true;
    }
    return false;
  }
  award(id) {
    if (this.state.achievements.includes(id)) return false;
    this.state.achievements.push(id);
    this.emit('achievement', id);
    return true;
  }

  // ---- persistence ----
  load() {
    const data = SaveSystem.load();
    if (data) {
      this.state = { ...freshState(), ...data, settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) } };
      this.emit('loaded');
      return true;
    }
    return false;
  }
  save(shipSnapshot) {
    if (shipSnapshot) this.state.ship = shipSnapshot;
    const ok = SaveSystem.save(this.state);
    if (ok) { this.saveMeta.lastSaved = Date.now(); this.emit('saved'); }
    return ok;
  }
  reset() { SaveSystem.reset(); this.state = freshState(); this.emit('reset'); }
  get canSave() { return SaveSystem.hasStorage; }
}
