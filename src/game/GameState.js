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
  { id: 'far-horizons', name: 'FAR HORIZONS', desc: 'Reach Neptune.' },
  { id: 'planetfall', name: 'PLANETFALL', desc: 'Land on a planet and settle in at its outpost.' },
  { id: 'mechanic', name: 'ROVER MECHANIC', desc: 'Repair your first broken rover on the surface.' },
  { id: 'steward', name: 'STATION STEWARD', desc: 'Complete a maintenance routine on a planetary outpost.' },
  { id: 'astronaut', name: 'FIELD ASTRONAUT', desc: 'Live, eat and work at a planetary outpost.' },
  { id: 'walker', name: 'FIRST STEPS', desc: 'Suit up and walk on a planet on foot.' },
  { id: 'scavenger', name: 'SCAVENGER', desc: 'Recover 5 supply caches (spare parts) on planet surfaces.' },
  { id: 'rocketeer', name: 'ROCKETEER', desc: 'Design a rocket and fly it from Earth to orbit.' },
  { id: 'logistics', name: 'LOGISTICS CHAIN', desc: 'Receive your first supply delivery from Earth.' }
];

const PLANET_IDS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

export function freshState() {
  return {
    version: 1,
    credits: ECONOMY.startCredits,
    xp: 0,
    resources: { iron: 0, nickel: 0, water: 0, ice: 0, food: 0, parts: 0, rare: 0 },
    survival: { satiety: 100 },   // astronaut food meter (0 = starving)
    upgrades: { engine: 1, tank: 1, shield: 1, scanner: 1, cargo: 1 },
    missions: { active: 'm1', completed: [], failed: [] },
    discoveries: [],     // bodies scanned
    visited: [],         // bodies entered SOI of
    anomalies: [],       // anomaly ids found
    achievements: [],
    supplyOrders: [],    // orders placed from Earth to a planetary outpost
    collectedCaches: [], // "planetId:cacheIndex" — caches already recovered (no re-farming)
    rockets: { designs: [], active: null, built: [] }, // VAB: saved rocket designs
    stats: { orbits: 0, landings: 0, docks: 0, mined: 0, jumps: 0, scans: 0,
             repairs: 0, caches: 0, deliveries: 0, evas: 0 },
    settings: { ...DEFAULT_SETTINGS },
    careerName: null,    // display name in the careers list
    ship: null,          // filled by Game on save
    playTime: 0
  };
}

export class GameState {
  constructor() {
    this.state = freshState();
    this.listeners = new Map();
    this.saveMeta = { lastSaved: 0 };
    this.slot = SaveSystem.activeSlot();
    // Settings are global (not per-career) — apply them immediately.
    this.loadSettings();
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

  // ---- survival (astronaut food) ----
  get satiety() { const s = this.state.survival.satiety; return Math.max(0, Math.min(100, s)); }
  foodCount() { return this.state.resources.food || 0; }
  /** Consume food units; restores satiety (never wastes rations when full). Returns satiety gained. */
  eatFood(count = 1) {
    const need = 100 - this.state.survival.satiety;
    if (need <= 0) return 0; // already full — don't waste a ration
    const have = this.state.resources.food || 0;
    const neededUnits = Math.max(1, Math.ceil(need / ECONOMY.surface.satietyPerMeal));
    const n = Math.min(have, count, neededUnits);
    if (n <= 0) return 0;
    this.state.resources.food -= n;
    const gain = Math.min(need, n * ECONOMY.surface.satietyPerMeal);
    this.state.survival.satiety += gain;
    this.emit('cargo');
    this.emit('survival', this.state.survival.satiety);
    return gain;
  }
  /** Drain satiety over time (hunger). Returns new satiety. */
  drainSatiety(amount) {
    this.state.survival.satiety = Math.max(0, this.state.survival.satiety - amount);
    this.emit('survival', this.state.survival.satiety);
    return this.state.survival.satiety;
  }
  /** Consume spare parts for a job. Returns true if enough. */
  consumeParts(n = 1) {
    if ((this.state.resources.parts || 0) < n) return false;
    this.state.resources.parts -= n;
    this.emit('cargo');
    return true;
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
  /** Merge a raw persisted blob into live state (used by disk and cloud loads). */
  hydrate(data) {
    if (!data || data.version !== 1) return false;
    const fresh = freshState();
    this.state = {
      ...fresh,
      ...data,
      // deep-merge so saves from before the survival/economy expansion
      // keep their old fields while picking up food/parts + satiety defaults
      resources: { ...fresh.resources, ...(data.resources || {}) },
      survival: { ...fresh.survival, ...(data.survival || {}) },
      rockets: { ...fresh.rockets, ...(data.rockets || {}) },
      // Settings live on their own storage key so they survive NEW GAME and
      // apply before any career is loaded — the on-disk settings win over
      // whatever was frozen into the save blob.
      settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}), ...(SaveSystem.loadSettings() || {}) }
    };
    this.emit('loaded');
    return true;
  }

  load(slot) {
    if (slot !== undefined) this.slot = slot;
    const data = SaveSystem.load(slot ?? this.slot);
    return this.hydrate(data);
  }

  /** Load standalone settings (before any career exists). */
  loadSettings() {
    const s = SaveSystem.loadSettings();
    if (s) this.state.settings = { ...DEFAULT_SETTINGS, ...s };
    return this.state.settings;
  }

  /** Persist settings on their own key (+ notify listeners so the cloud can mirror). */
  saveSettings() {
    const ok = SaveSystem.saveSettings(this.state.settings);
    this.emit('settings', this.state.settings);
    return ok;
  }

  save(shipSnapshot, meta = {}) {
    if (shipSnapshot) this.state.ship = shipSnapshot;
    const ok = SaveSystem.save(this.state, this.slot, {
      level: this.level(),
      ...meta
    });
    SaveSystem.saveSettings(this.state.settings);
    if (ok) { this.saveMeta.lastSaved = Date.now(); this.emit('saved', this.slot); }
    return ok;
  }

  /** Wipe the CURRENT career only — settings and other slots are untouched. */
  reset() {
    const settings = { ...this.state.settings };
    SaveSystem.reset(this.slot);
    this.state = freshState();
    this.state.settings = settings;
    this.emit('reset');
  }

  get canSave() { return SaveSystem.hasStorage; }
}
