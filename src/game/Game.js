// Game — the orchestrator. Owns the renderer/scene, all world systems,
// game modes (menu / space / surface), interaction logic, economy hooks,
// save/load, missions, achievements, camera modes and the main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { PLANETS, MOONS, STATIONS, ANOMALIES, QUALITY, detectQuality, isTouchDevice, SUN_CONFIG } from '../config.js';
import { getBodyTextures, getCloudTexture } from '../planets/ProceduralTextures.js';
import { findBody } from '../planets/PlanetData.js';
import { SolarSystem } from '../planets/SolarSystem.js';
import { Starfield } from '../world/Starfield.js';
import { AsteroidField } from '../world/AsteroidField.js';
import { Effects } from '../fx/Effects.js';
import { buildShipMesh, ShipTrail } from '../spacecraft/Ship.js';
import { ShipPhysics } from '../spacecraft/ShipPhysics.js';
import { ShipController } from '../spacecraft/ShipController.js';
import { shipStats } from '../spacecraft/ShipUpgrades.js';
import { GameState, ACHIEVEMENTS } from './GameState.js';
import { TimeSystem } from './TimeSystem.js';
import { MissionManager } from '../missions/MissionManager.js';
import { AudioManager } from '../audio/AudioManager.js';
import { SurfaceScene } from './SurfaceScene.js';

import { HUD } from '../ui/HUD.js';
import { Menu } from '../ui/Menu.js';
import { MapView } from '../ui/Map.js';
import { PlanetInfoPanel } from '../ui/PlanetInfo.js';
import { MobileControls } from '../ui/MobileControls.js';
import { Codex } from '../ui/Codex.js';
import { DockPanel } from '../ui/DockPanel.js';
import { Toasts } from '../ui/Toasts.js';
import { LoadingScreen } from '../ui/LoadingScreen.js';

import { el, makeModal } from '../utils/UI.js';
import { formatDistance, formatSpeed } from '../planets/PlanetData.js';
import { cargoUsed } from '../world/Resources.js';
import { mulberry32, clamp } from '../utils/Noise.js';

const CHASE_DIST = 9, CHASE_HEIGHT = 3.6;

export class Game {
  constructor(canvas, root) {
    this.canvas = canvas;
    this.root = root;
    this.mode = 'loading';        // loading | menu | space | surface
    this.paused = false;
    this.modalOpen = null;        // 'map'|'codex'|'missions'|'ship'|'settings'|'help'|'docked'|'planetinfo'|'pause'|'confirm'
    this.cameraMode = 'chase';    // chase | free
    this.freeCam = { yaw: 0, pitch: 0.2, dist: 14 };
    this.cinematic = null;        // {body, t, dur}
    this.warp = null;             // {t, dur, dest, phase}
    this.scanning = null;         // {t, dur, targetId}
    this.miningTarget = null;
    this.orbiting = null;         // Body
    this.orbitAngle = 0;
    this.target = null;           // {id, name}
    this.surface = null;
    this.fpsFrames = 0; this.fpsTime = 0; this.fps = 60;
    this._frameGate = 0;
    this._autosaveT = 0;
    this._expectedUnlock = false;
    this._lastPerf = performance.now();

    // ---- core systems ----
    this.gs = new GameState();
    this.audio = new AudioManager();
    this.time = new TimeSystem();
    this.controller = new ShipController(canvas, { get invertY() { return game.gs.state.settings.invertY; } });
    const game = this;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance'
    });
    this.renderer.setClearColor(0x02040a);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 12000);
    this.composer = null;

    // ship runtime state
    this.shipState = {
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(),
      speed: 0,
      fuel: 100, energy: 100, shield: 100, hull: 100,
      lastStation: 'earth-station'
    };
    this.shipVisual = null;
    this.trail = null;
    this.physics = new ShipPhysics(this.shipState);

    this._buildUI();
    this._bindActions();
    window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  // ================================================================ UI
  _buildUI() {
    this.loading = new LoadingScreen(this.root);
    this.toasts = new Toasts(this.root);
    this.hud = new HUD(this.root, {
      map: () => this.toggleMap(),
      scan: () => this.tryScan(),
      missions: () => this.openModal('missions'),
      codex: () => this.openModal('codex'),
      timeWarp: () => { const s = this.time.cycleSpeed(); this.audio.click(); this.toasts.show('TIME WARP', s + '× speed', 'info', 1600); }
    });
    this.hud.root.querySelector('.hud-timewarp').addEventListener('click', () => {
      const s = this.time.cycleSpeed(); this.audio.click();
      this.toasts.show('TIME WARP', s + '× speed', 'info', 1600);
    });

    this.menu = new Menu(this.root, {
      play: () => this.continueGame(),
      newGame: () => this.newGame(),
      codex: () => this.openModal('codex'),
      resume: () => this.togglePause(),
      save: () => this.saveGame(true),
      quitToMenu: () => this.quitToMenu(),
      settingsChanged: (patch) => this.applySettings(patch)
    }, this.gs);

    this.mapView = new MapView(this.root, {
      close: () => this.closeModal(),
      select: (id) => { this.closeModal(); this.openPlanetInfo(id); }
    });
    this.planetInfo = new PlanetInfoPanel(this.root, {
      setTarget: (id) => { this.setTarget(id); this.audio.click(); },
      fastTravel: (id) => this.requestFastTravel(id),
      scan: () => this.tryScan(),
      codex: () => this.openModal('codex')
    });
    this.codex = new Codex(this.root, this.gs);
    this.dockPanel = new DockPanel(this.root, {
      gs: this.gs,
      getShip: () => this.shipState,
      onSell: (id, n) => { const v = this.gs.sellOne(id, n); this.audio.click(); if (v) this.toasts.show('SOLD', `+${v.toLocaleString()} CR`, 'success', 1800); },
      onRefuel: (cost) => {
        if (!this.gs.spend(cost)) return;
        this.shipState.fuel = shipStats(this.gs.state.upgrades).fuelCapacity;
        this.audio.dock();
        this.toastStats();
      },
      onRepair: (cost) => {
        if (!this.gs.spend(cost)) return;
        this.shipState.hull = 100;
        this.audio.dock();
        this.toastStats();
      },
      onBuy: (sysId, cost) => {
        if (!this.gs.spend(cost)) return;
        this.gs.state.upgrades[sysId]++;
        this.toasts.show('UPGRADE INSTALLED', `${sysId.toUpperCase()} → MK${this.gs.state.upgrades[sysId]}`, 'success');
        this.syncUpgradeDerived();
        this.gs.save(this.shipSnapshot());
      },
      onMissions: () => { this.menu.showMissions(); },
      onUndock: () => this.undock(),
      sound: (k) => this.audio[k === 'click' ? 'click' : 'levelUp']?.()
    });
    this.touch = isTouchDevice();
    this.mobile = new MobileControls(this.root, this.controller.touch, {
      interact: () => this.doInteract(),
      scan: () => this.tryScan(),
      map: () => this.toggleMap(),
      target: () => this.cycleTarget(),
      missions: () => this.toggleModal('missions'),
      codex: () => this.toggleModal('codex')
    });
    this.fpsEl = el('div', 'fps-counter hidden');
    this.root.appendChild(this.fpsEl);

    this.flashEl = el('div', 'screen-flash');
    this.root.appendChild(this.flashEl);
    this.fadeEl = el('div', 'screen-fade');
    this.root.appendChild(this.fadeEl);

    this.confirmM = makeModal('ft-modal', 'FAST TRAVEL');
    this.root.appendChild(this.confirmM.root);
  }

  toastStats() { this.toasts.show('SERVICE COMPLETE', `Fuel ${Math.round(this.shipState.fuel)} · Hull ${Math.round(this.shipState.hull)}%`, 'info', 2000); }

  _bindActions() {
    const c = this.controller;
    c.on('interact', () => this.doInteract());
    c.on('scan', () => this.tryScan());
    c.on('target', () => this.cycleTarget());
    c.on('map', () => this.toggleMap());
    c.on('info', () => { if (this.target) this.openPlanetInfo(this.target.id); });
    c.on('land', () => this.tryLand());
    c.on('camera', () => { this.cameraMode = this.cameraMode === 'chase' ? 'free' : 'chase'; this.toasts.show('CAMERA', this.cameraMode === 'chase' ? 'Chase camera' : 'Free look camera', 'info', 1500); });
    c.on('missions', () => this.toggleModal('missions'));
    c.on('help', () => this.toggleModal('help'));
    c.on('pause', () => {
      if (this.modalOpen) this.closeModal();
      else if (this.mode !== 'menu' && this.mode !== 'loading') this.togglePause();
    });
    c.on('pointerlocklost', () => {
      if (this._expectedUnlock) { this._expectedUnlock = false; return; }
      if (this.mode === 'space' && !this.modalOpen && !this.paused && !this.touch) this.togglePause();
    });
    c.requestPointerLock();

    // first gesture → audio unlock
    const unlock = () => {
      this.audio.init();
      this.audio.setVolumes(this.gs.state.settings.music, this.gs.state.settings.sfx);
      this.audio.startMusic();
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);

    this.gs.on('achievement', (id) => {
      const a = ACHIEVEMENTS.find(x => x.id === id);
      this.toasts.show('ACHIEVEMENT', `${a?.name || id} — ${a?.desc || ''}`, 'achievement');
      this.audio.levelUp();
    });
    this.gs.on('levelup', (lvl) => {
      this.toasts.show('LEVEL UP', `Commander level ${lvl}`, 'success');
      this.audio.levelUp();
    });
    this.gs.on('visit', (id) => {
      if (this.mode === 'menu' || this.mode === 'loading') return; // no banners during menus
      const body = this.solar?.getBody(id);
      if (body) this.toasts.show('DISCOVERED', body.name, 'discovery');
      this.gs.addXP(80);
      this.audio.arrival();
      this.startCinematic(body);
    });
  }

  // ================================================================ BOOT
  async boot() {
    const qualitySetting = this.gs.state.settings.quality;
    this.quality = qualitySetting === 'auto' ? detectQuality() : qualitySetting;
    this.gs.state.settings.resolvedQuality = this.quality;

    // progressive loading: pre-generate textures in chunks so the bar moves
    // (seed sequence must exactly match SolarSystem's build order)
    const bodies = [
      ...PLANETS.map(p => ({ cfg: p, inc: 101 })),
      ...MOONS.map(m => ({ cfg: m, inc: 77 }))
    ];
    const total = bodies.length + 3;
    let step = 0;
    const tick = () => new Promise(r => requestAnimationFrame(r));
    let seed = 1000;
    const texSize = this.quality === 'low' ? 256 : 512;
    for (const b of bodies) {
      seed += b.inc;
      try {
        getBodyTextures(b.cfg.texture, seed, texSize);
        if (b.cfg.clouds && this.quality !== 'low') getCloudTexture(seed + 5, texSize, 0.52);
      } catch (e) { console.warn('texture fallback', e); }
      step++;
      this.loading.progress(step / total, `Surveying ${b.cfg.name.toLowerCase()}…`);
      await tick();
    }

    this.loading.progress(step++ / total, 'Assembling solar system…');
    await tick();
    this.solar = new SolarSystem(this.scene, this.quality);
    this.solar.setOrbitLinesVisible(this.gs.state.settings.orbitLines);
    this.solar.update(this.time.simSeconds, 0);

    this.loading.progress(step++ / total, 'Charting the asteroid belt…');
    await tick();
    this.starfield = new Starfield(this.scene, this.quality);
    this.belt = new AsteroidField(this.scene, this.quality);
    this.effects = new Effects(this.scene, this.quality);

    this.loading.progress(step++ / total, 'Powering up spacecraft…');
    await tick();
    this.shipVisual = buildShipMesh();
    this.scene.add(this.shipVisual.group);
    this.trail = new ShipTrail(this.scene);

    this._setupComposer();
    this.loading.done();
    this.mode = 'menu';
    this.menu.showMain();
    this._loop();
  }

  _setupComposer() {
    const s = this.gs.state.settings;
    const useBloom = s.bloom && QUALITY[this.quality].bloom;
    if (useBloom) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.65, 0.82);
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(new OutputPass());
      this.composer.setSize(innerWidth, innerHeight);
    } else {
      this.composer = null;
    }
  }

  // ================================================================ GAME FLOW
  newGame() {
    this.gs.reset();
    this.missions = new MissionManager(this.gs, {
      toast: (t, s, k) => this.toasts.show(t, s, k),
      sound: () => this.audio.missionComplete(),
      shipSnapshot: () => this.shipSnapshot()
    });
    this.audio.init();
    this.audio.startMusic();
    this._spawnShip(true);
    this._enterPlay();
    this.toasts.show('WELCOME, COMMANDER', 'Mission 1: FIRST FLIGHT — leave Earth behind.', 'info', 6000);
  }

  continueGame() {
    const loaded = this.gs.load();
    this.missions = new MissionManager(this.gs, {
      toast: (t, s, k) => this.toasts.show(t, s, k),
      sound: () => this.audio.missionComplete(),
      shipSnapshot: () => this.shipSnapshot()
    });
    this.audio.init();
    this.audio.startMusic();
    const snap = this.gs.state.ship;
    if (loaded && snap) {
      this.shipState.position.fromArray(snap.position);
      this.shipState.quaternion.fromArray(snap.quaternion);
      this.shipState.velocity.set(0, 0, 0);
      this.shipState.fuel = snap.fuel;
      this.shipState.energy = snap.energy;
      this.shipState.shield = snap.shield;
      this.shipState.hull = snap.hull;
      this.shipState.lastStation = snap.lastStation || 'earth-station';
      this.syncUpgradeDerived();
    } else {
      this._spawnShip(true);
    }
    this._enterPlay();
    if (loaded && snap) this.toasts.show('SYSTEMS RESTORED', `Welcome back, Commander — LV ${this.gs.level()}, ${this.gs.credits.toLocaleString()} CR`, 'info');
  }

  _spawnShip(fresh) {
    // clear any transient session state
    this.orbiting = null;
    this.warp = null;
    this.scanning = null;
    this.mining = false;
    this.cinematic = null;
    this._insideSOI = new Set();
    const stats = shipStats(this.gs.state.upgrades);
    const station = this.solar.stations.find(s => s.id === 'earth-station');
    const base = station ? station.group.position.clone() : this.solar.getBody('earth').group.position.clone();
    this.shipState.position.copy(base).add(new THREE.Vector3(4, 2.5, 9));
    this.shipState.quaternion.identity();
    // look back at Earth
    const earth = this.solar.getBody('earth').group.position;
    const m = new THREE.Matrix4().lookAt(this.shipState.position, earth, new THREE.Vector3(0, 1, 0));
    this.shipState.quaternion.setFromRotationMatrix(m);
    this.shipState.velocity.set(0, 0, 0);
    this.shipState.fuel = stats.fuelCapacity;
    this.shipState.energy = 100;
    this.shipState.shield = stats.shieldMax;
    this.shipState.hull = 100;
    this.trail?.clear(this.shipState.position);
    if (fresh) {
      this.gs.visit('earth');
      this.gs.discover('earth');
      this.setTarget('moon');
    }
  }

  syncUpgradeDerived() {
    const stats = shipStats(this.gs.state.upgrades);
    this.shipState.fuel = Math.min(this.shipState.fuel, stats.fuelCapacity);
    this.shipState.shield = Math.min(this.shipState.shield, stats.shieldMax);
  }

  _enterPlay() {
    this.menu.hideMain();
    this.menu.hidePause();
    this.hud.show();
    if (this.touch) this.mobile.show();
    this.mode = 'space';
    this.paused = false;
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    this.missions?.reset();
    this.syncAnomalies();
    if (!this.touch) this.canvas.requestPointerLock?.();
  }

  /** Hide already-collected anomalies after a reload. */
  syncAnomalies() {
    if (!this.solar) return;
    for (const an of this.solar.anomalies)
      an.sprite.visible = !this.gs.state.anomalies.includes(an.cfg.id);
  }

  quitToMenu() {
    this.saveGame();
    this.hud.hide();
    this.mobile.hide();
    this.closeModal();
    this.menu.hidePause();
    this.menu.showMain();
    this.mode = 'menu';
    this.orbiting = null;
    if (this.surface) this._disposeSurface();
    document.exitPointerLock?.();
    this._expectedUnlock = true;
  }

  togglePause() {
    if (this.mode === 'menu' || this.mode === 'loading') return;
    this.paused = !this.paused;
    if (this.paused) {
      this.audio.setEngine(0, false);
      this.audio.setWarning(false);
      this.audio.stopMining();
      this.menu.showPause();
      this.modalOpen = 'pause';
      document.exitPointerLock?.();
      this._expectedUnlock = true;
    } else {
      this.menu.hidePause();
      this.modalOpen = null;
      if (!this.touch && this.mode === 'space') this.canvas.requestPointerLock?.();
    }
    this.audio.click();
  }

  // ================================================================ MODALS
  openModal(kind) {
    if (this.mode === 'menu') {
      if (kind === 'missions') this.menu.showMissions();
      if (kind === 'codex') this.codex.show();
      return;
    }
    this.closeModal();
    this.modalOpen = kind;
    this.audio.uiOpen();
    if (kind === 'map') this.mapView.show();
    else if (kind === 'codex') this.codex.show();
    else if (kind === 'missions') this.menu.showMissions();
    else if (kind === 'ship') this.menu.showShip();
    document.exitPointerLock?.();
    this._expectedUnlock = true;
  }
  closeModal() {
    if (this.dockPanel.visible) { this.undock(); return; }
    this.mapView.hide();
    this.codex.hide();
    this.planetInfo.hide();
    this.menu.missionsModal.close();
    this.menu.shipModal.close();
    this.menu.settingsModal.close();
    this.menu.helpModal.close();
    this.menu.confirmModal.close();
    this.confirmM.close();
    if (this.modalOpen === 'pause') { this.menu.hidePause(); this.paused = false; }
    this.modalOpen = null;
  }
  toggleModal(kind) {
    if (this.modalOpen === kind) this.closeModal();
    else this.openModal(kind);
  }
  toggleMap() {
    if (this.mode === 'menu') return;
    if (this.planetInfo.visible) this.planetInfo.hide();
    if (this.modalOpen === 'map') this.closeModal();
    else if (!this.modalOpen || this.modalOpen === 'pause') { if (this.modalOpen) this.closeModal(); this.openModal('map'); }
  }

  // ================================================================ MAIN LOOP
  _loop() {
    requestAnimationFrame(() => this._loop());
    const now = performance.now();
    let dt = (now - this._lastPerf) / 1000;
    this._lastPerf = now;
    if (dt > 0.1) dt = 0.1;

    // fps cap
    const cap = this.gs.state.settings.fpsCap || 60;
    this._frameGate += dt;
    if (this._frameGate < 1 / cap - 0.002) return;
    const step = this._frameGate;
    this._frameGate = 0;

    // fps counter
    this.fpsFrames++; this.fpsTime += step;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0; this.fpsTime = 0;
      if (this.gs.state.settings.showFps) this.fpsEl.textContent = this.fps + ' FPS';
    }

    const modalBlocking = this.modalOpen !== null || this.planetInfo.visible;
    if (!this.paused && !modalBlocking) this.time.update(step);
    // modal input gating: ship controls disabled whenever a panel is open
    this.controller.enabled = !this.paused && !modalBlocking;
    this.solar.update(this.time.simSeconds, step);

    if (!this.paused) {
      if (this.mode === 'menu') this._updateMenuCam(step);
      else if (this.mode === 'space') this._updateSpace(step);
      else if (this.mode === 'surface') this._updateSurface(step);
    }
    this._lastStep = step;

    this.effects.update(step);
    if (this.modalOpen === 'map') this.mapView.render(this);

    // autosave every 45s during play
    if ((this.mode === 'space' || this.mode === 'surface') && !this.paused) {
      this._autosaveT += step;
      if (this._autosaveT > 45) { this._autosaveT = 0; this.saveGame(); }
    }

    this._render();
  }

  _render() {
    if (this.mode === 'surface' && this.surface) {
      // surface scene replaces the space scene entirely (bloom off — cheap path)
      this.renderer.render(this.surface.scene, this.camera);
    } else if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  _updateMenuCam(dt) {
    const earth = this.solar.getBody('earth');
    const t = this.time.simSeconds * 0.00002 + 2;
    const r = 16;
    this.camera.position.set(
      earth.group.position.x + Math.cos(t) * r,
      earth.group.position.y + 3.2 + Math.sin(t * 0.7),
      earth.group.position.z + Math.sin(t) * r
    );
    this.camera.lookAt(earth.group.position);
    this.camera.fov = 60;
    this.camera.updateProjectionMatrix();
    if (this.shipVisual) this.shipVisual.group.visible = false;
    if (this.trail) this.trail.line.visible = false;
  }

  // ================================================================ SPACE
  _updateSpace(dt) {
    // frozen while docked: ship stays put at the station
    if (this.modalOpen === 'docked') {
      this.audio.setEngine(0, false);
      this.audio.setWarning(false);
      return;
    }
    const input = this.controller.sample(dt);
    this.shipVisual.group.visible = true;
    this.trail.line.visible = true;
    const stats = shipStats(this.gs.state.upgrades);

    // time-independent ship systems
    this.shipState.energy = Math.min(100, this.shipState.energy + 6 * dt);
    const statsShield = stats;
    if (this._now() - (this._lastHit || 0) > 4 && this.shipState.shield < statsShield.shieldMax) {
      const regen = Math.min(statsShield.shieldRegen * dt, statsShield.shieldMax - this.shipState.shield);
      if (this.shipState.energy > regen * 0.5) {
        this.shipState.shield += regen;
        this.shipState.energy -= regen * 0.5;
      }
    }
    // emergency ram-scoop: slow refuel when coasting
    const throttleOff = Math.abs(input.throttleF) < 0.05 && !input.boost;
    if (throttleOff) this.shipState.fuel = Math.min(stats.fuelCapacity, this.shipState.fuel + 0.9 * dt);

    if (this.warp) {
      this._updateWarp(dt, stats);
    } else if (this.orbiting) {
      this._updateOrbit(dt, input);
    } else {
      this.physics.update(dt, input, stats, [...this.solar.planets.values()], {
        onDamage: (amount, kind) => this.damageShip(amount, kind),
        onThrust: (mag, boosting) => this._onThrust(mag, boosting, dt)
      });
      this._postPhysics(dt);
    }

    // scan progress
    if (this.scanning) {
      this.scanning.t += dt * shipStats(this.gs.state.upgrades).scanSpeed;
      if (this.scanning.t >= this.scanning.dur) this._finishScan();
    }
    // mining
    this._updateMining(dt, input);

    // proximity visits
    this._checkProximity();

    // target marker projection
    this._updateTargetMarker();

    // missions + achievements
    this.missions?.update(this.missions.makeContext(this));
    this._checkAchievements();

    // warnings + audio
    const statsNow = shipStats(this.gs.state.upgrades);
    let warn = '';
    if (this.shipState.fuel < statsNow.fuelCapacity * 0.15) warn = '⚠ FUEL LOW — coasting recharges ram-scoop';
    else if (this.shipState.hull < 30) warn = '⚠ HULL CRITICAL — dock at a station for repairs';
    else if (this.shipState.shield <= 0 && this._now() - (this._lastHit || 0) < 4) warn = '⚠ SHIELDS DOWN';
    this.audio.setWarning(!!warn && !this.modalOpen);

    // HUD
    this._updateHUD(warn);
  }

  _onThrust(mag, boosting, dt) {
    this.audio.setEngine(mag, boosting);
    // exhaust particles + flame
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.shipState.quaternion);
    const enginePos = this.shipState.position.clone().addScaledVector(back, 2);
    const pf = QUALITY[this.quality].particles;
    if (Math.random() < pf * (boosting ? 2.2 : 1)) this.effects.enginePuff(enginePos, back, 1.2, boosting);
    this.shipVisual.flame.scale.setScalar((boosting ? 1.6 : 0.9) * (0.75 + Math.random() * 0.5));
    this.shipVisual.engineLight.intensity = boosting ? 4 : 2.2;
  }

  _postPhysics(dt) {
    const st = this.shipState;
    this.shipVisual.group.position.copy(st.position);
    this.shipVisual.group.quaternion.copy(st.quaternion);
    // banking flourish from yaw rate
    const yawRate = (this.controller.frame?.yawDelta || 0) / Math.max(dt, 0.001);
    const bank = clamp(-yawRate * 2.2, -0.5, 0.5);
    this.shipVisual.visual.rotation.z += (bank - this.shipVisual.visual.rotation.z) * Math.min(1, 8 * dt);
    this.trail.push(st.position);
    // asteroid collisions
    const dmg = this.belt.collideShip(st.position, 1.1, st.velocity);
    if (dmg > 1) this.damageShip(dmg, 'asteroid');
    // station soft collision
    for (const station of this.solar.stations) {
      const d = st.position.distanceTo(station.group.position);
      if (d < 3.2) {
        const n = st.position.clone().sub(station.group.position).normalize();
        st.position.copy(station.group.position).addScaledVector(n, 3.2);
        st.velocity.multiplyScalar(0.4);
      }
    }
    if (!this.controller.state.boost && this.controller.state.throttleF === 0) {
      this.shipVisual.flame.scale.setScalar(0.001);
      this.shipVisual.engineLight.intensity = 0;
    }
    this.audio.setEngine(
      Math.min(1, Math.abs(this.controller.state.throttleF) + Math.abs(this.controller.state.strafe) * 0.5),
      this.controller.state.boost);
  }

  // ---- orbit mode ----
  enterOrbit(body) {
    this.orbiting = body;
    const d = this.shipState.position.distanceTo(body.group.position);
    this.orbitRadius = clamp(d, body.radius * 1.8, body.soi * 0.85);
    this.orbitAngle = Math.atan2(
      this.shipState.position.z - body.group.position.z,
      this.shipState.position.x - body.group.position.x
    );
    this.shipState.velocity.set(0, 0, 0);
    this.gs.state.stats.orbits++;
    this.gs.award('first-orbit');
    this.toasts.show('ORBIT ACHIEVED', `Stable orbit around ${body.name}`, 'success');
    this.audio.arrival();
  }
  exitOrbit() {
    const body = this.orbiting;
    this.orbiting = null;
    // tangential escape velocity
    const n = this.shipState.position.clone().sub(body.group.position).normalize();
    const tangent = new THREE.Vector3(-n.z, 0, n.x);
    this.shipState.velocity.copy(tangent.multiplyScalar(shipStats(this.gs.state.upgrades).maxSpeed * 0.4));
    this.toasts.show('ORBIT BROKEN', 'Burn complete — you are free-flying.', 'info', 1800);
  }
  _updateOrbit(dt, input) {
    const body = this.orbiting;
    const speed = shipStats(this.gs.state.upgrades).maxSpeed;
    this.orbitAngle += (speed * 0.55 / this.orbitRadius) * dt;
    const p = this.shipState.position;
    p.set(
      body.group.position.x + Math.cos(this.orbitAngle) * this.orbitRadius,
      body.group.position.y,
      body.group.position.z + Math.sin(this.orbitAngle) * this.orbitRadius
    );
    const tangent = new THREE.Vector3(-Math.sin(this.orbitAngle), 0, Math.cos(this.orbitAngle));
    this.shipState.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().lookAt(p, body.group.position, new THREE.Vector3(0, 1, 0))
    );
    this.shipState.velocity.copy(tangent).multiplyScalar(speed * 0.4);
    this._postPhysics(dt);
  }

  // ---- interaction ----
  doInteract() {
    if (this.mode !== 'space' || this.modalOpen || this.paused || this.planetInfo.visible || this.warp) return;
    // 1) dock at station
    for (const station of this.solar.stations) {
      if (this.shipState.position.distanceTo(station.group.position) < station.dockRadius) {
        this.dock(station);
        return;
      }
    }
    // 2) investigate anomaly
    for (const an of this.solar.anomalies) {
      if (this.gs.state.anomalies.includes(an.cfg.id)) continue;
      if (this.shipState.position.distanceTo(an.sprite.position) < 12) {
        this._collectAnomaly(an);
        return;
      }
    }
    // 3) orbit toggle with nearest body in SOI
    const body = this._nearestBodyInSOI();
    if (body) {
      if (this.orbiting === body) this.exitOrbit();
      else if (this.orbiting) this.exitOrbit(), this.enterOrbit(body);
      else this.enterOrbit(body);
      return;
    }
    if (this.miningTarget) return; // E is being held to mine — handled per-frame
    this.audio.error();
  }

  _nearestBodyInSOI() {
    let best = null, bestD = Infinity;
    for (const body of this.solar.planets.values()) {
      const d = this.shipState.position.distanceTo(body.group.position);
      if (d < body.soi && d < bestD) { best = body; bestD = d; }
    }
    return best;
  }

  _collectAnomaly(an) {
    this.gs.findAnomaly(an.cfg.id);
    const stats = shipStats(this.gs.state.upgrades);
    let text = [];
    for (const k in an.cfg.reward) {
      const got = this.gs.addCargo(k, an.cfg.reward[k], stats.cargoCapacity);
      text.push(`${ECON_LABEL(k)} ×${Math.round(got)}`);
    }
    this.gs.addXP(200);
    this.gs.addCredits(500);
    this.effects.explosion(an.sprite.position, 0.6);
    an.sprite.visible = false;
    this.toasts.show('ANOMALY RECOVERED', an.cfg.name + ' — ' + text.join(', '), 'discovery', 6000);
    this.audio.missionComplete();
    this.gs.save(this.shipSnapshot());
  }

  // ---- scan ----
  tryScan() {
    if (this.mode !== 'space' || this.modalOpen || this.paused || this.planetInfo.visible || this.warp) return;
    if (this.scanning) return;
    if (!this.target) { this.toasts.show('SCANNER', 'No target — press T to cycle targets.', 'warn'); this.audio.error(); return; }
    const stats = shipStats(this.gs.state.upgrades);
    const isStar = this.targetKind === 'star';
    const body = this.targetKind === 'station' ? null : this.solar.getBody(this.target.id);
    const targetPos = this._targetWorldPos();
    const d = this.shipState.position.distanceTo(targetPos);
    if (d > stats.scanRange + (body?.radius || 0) + (isStar ? 400 : 0)) {
      this.toasts.show('SCANNER', 'Target out of range — get closer or upgrade scanner.', 'warn');
      this.audio.error();
      return;
    }
    this.scanning = { t: 0, dur: 1.6, targetId: this.target.id };
    this.audio.scan(1.6);
  }

  _finishScan() {
    const id = this.scanning.targetId;
    this.scanning = null;
    const first = this.gs.discover(id);
    this.gs.state.stats.scans++;
    const body = this.solar.getBody(id);
    const anom = this.solar.anomalies.find(a => a.cfg.id === id);
    const displayName = body?.name || anom?.cfg.name || findBody(id)?.cfg?.name || id;
    if (first) {
      this.gs.addXP(120);
      this.toasts.show('SCAN COMPLETE', `${displayName} — data added to codex · +120 XP`, 'discovery', 5000);
      this.gs.save(this.shipSnapshot());
    } else {
      this.gs.addXP(15);
      this.toasts.show('SCAN COMPLETE', 'Additional survey data recorded · +15 XP', 'info', 2200);
    }
    this.audio.uiOpen();
  }

  // ---- mining ----
  _updateMining(dt, input) {
    const holdInteract = this.controller.enabled &&
      (this.controller.keys.has('KeyE') || this.controller.touch.interactHeld);
    const stats = shipStats(this.gs.state.upgrades);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.shipState.quaternion);
    const target = this.belt.findMineTarget(this.shipState.position, forward, 11);
    this.miningTarget = target;

    if (this.mining && (!target || !holdInteract || this.shipState.energy < 1)) {
      this.mining = false;
      this.audio.stopMining();
      this.effects.setBeam(null, null, false);
    }
    if (target && holdInteract && !this.modalOpen && !this.orbiting && !this.warp) {
      if (cargoUsed(this.gs.state.resources) >= stats.cargoCapacity) {
        if (!this._cargoT || this._now() - this._cargoT > 4) {
          this._cargoT = this._now();
          this.toasts.show('CARGO FULL', 'Sell at a station (dock with E).', 'warn', 2500);
          this.audio.error();
        }
      } else if (this.shipState.energy >= 1) {
        this.mining = true;
        const result = this.belt.mine(target, 13 * dt);
        if (result) {
          this.shipState.energy = Math.max(0, this.shipState.energy - 8 * dt);
          let anyAccepted = false;
          for (const k in result.resources) {
            const got = this.gs.addCargo(k, result.resources[k], stats.cargoCapacity);
            if (got > 0) anyAccepted = true;
          }
          this.gs.state.stats.mined += result.amount;
          const astPos = new THREE.Vector3(target.x, target.y, target.z);
          this.effects.setBeam(this.shipState.position.clone(), astPos, true);
          if (Math.random() < QUALITY[this.quality].particles * 1.4) this.effects.mineSparks(astPos);
          if (!this._miningSfx) { this.audio.startMining(); this._miningSfx = true; }
        }
      }
    } else {
      this.effects.setBeam(null, null, false);
      if (this._miningSfx) { this.audio.stopMining(); this._miningSfx = false; }
    }
  }

  // ---- proximity / discovery ----
  _checkProximity() {
    if (this.warp) return;
    for (const body of this.solar.planets.values()) {
      const d = this.shipState.position.distanceTo(body.group.position);
      if (d < body.soi && !this._insideSOI?.has(body.id)) {
        (this._insideSOI ||= new Set()).add(body.id);
        this.gs.visit(body.id);
      } else if (d > body.soi * 1.3 && this._insideSOI?.has(body.id)) {
        this._insideSOI.delete(body.id);
      }
    }
  }

  _checkAchievements() {
    const v = this.gs.state.visited;
    if (v.includes('moon')) this.gs.award('moonwalker');
    if (v.includes('mars')) this.gs.award('red-planet');
    if (v.includes('jupiter')) this.gs.award('giant-step');
    if (v.includes('saturn')) this.gs.award('ring-world');
    if (v.includes('neptune')) this.gs.award('far-horizons');
    if (PLANETS.every(p => v.includes(p.id))) this.gs.award('solar-explorer');
    if (this.gs.state.stats.mined >= 200) this.gs.award('miner');
    if (this.gs.state.stats.docks >= 1) this.gs.award('docked');
    if (this.gs.state.stats.landings >= 1) this.gs.award('tourist');
  }

  // ---- targeting ----
  cycleTarget() {
    const list = [];
    for (const body of this.solar.planets.values()) list.push({ id: body.id, name: body.name, kind: 'body' });
    for (const st of this.solar.stations) list.push({ id: st.id, name: st.name, kind: 'station' });
    if (!list.length) return;
    const idx = this.target ? list.findIndex(t => t.id === this.target.id) : -1;
    const next = list[(idx + 1) % list.length];
    this.target = { id: next.id, name: next.name };
    this.targetKind = next.kind;
    this.audio.click();
  }
  setTarget(id) {
    if (id === 'sun') { this.target = { id: 'sun', name: SUN_CONFIG.name }; this.targetKind = 'star'; return; }
    const body = this.solar.getBody(id);
    const station = this.solar.stations.find(s => s.id === id);
    const anom = this.solar.anomalies.find(a => a.cfg.id === id);
    if (body) { this.target = { id, name: body.name }; this.targetKind = 'body'; }
    else if (station) { this.target = { id, name: station.name }; this.targetKind = 'station'; }
    else if (anom) { this.target = { id, name: anom.cfg.name }; this.targetKind = 'anomaly'; }
  }
  _targetWorldPos() {
    if (!this.target) return null;
    if (this.target.id === 'sun') return this.solar.sunPosition;
    const body = this.solar.getBody(this.target.id);
    if (body) return body.group.position;
    const station = this.solar.stations.find(s => s.id === this.target.id);
    if (station) return station.group.position;
    const an = this.solar.anomalies.find(a => a.cfg.id === this.target.id);
    return an ? an.sprite.position : null;
  }
  _updateTargetMarker() {
    if (!this.target || this.mode !== 'space') { this.hud.updateMarker(0, 0, false, ''); return; }
    const pos = this._targetWorldPos();
    if (!pos) { this.hud.updateMarker(0, 0, false, ''); return; }
    const v = pos.clone().project(this.camera);
    const behind = v.z > 1;
    const x = (v.x * 0.5 + 0.5) * this.canvas.clientWidth;
    const y = (-v.y * 0.5 + 0.5) * this.canvas.clientHeight;
    const onScreen = !behind && x > 30 && x < this.canvas.clientWidth - 30 && y > 30 && y < this.canvas.clientHeight - 30;
    this.hud.updateMarker(x, y, onScreen, this.target.name);
  }

  /** Opens the info card for any body/station/anomaly id. */
  openPlanetInfo(id) {
    this.setTarget(id);
    const pos = this._targetWorldPos();
    const d = pos ? this.shipState.position.distanceTo(pos) : 0;
    this.planetInfo.show(id, this.gs, formatDistance(d));
    this.audio.uiOpen();
    document.exitPointerLock?.();
    this._expectedUnlock = true;
  }

  // ---- landing ----
  tryLand() {
    if (this.mode === 'surface') return;
    if (!this.orbiting) { this.toasts.show('LANDING', 'Enter orbit first (get close, press E).', 'warn'); this.audio.error(); return; }
    if (!this.orbiting.cfg.landable) { this.toasts.show('LANDING', `No landing modules for ${this.orbiting.name}.`, 'warn'); this.audio.error(); return; }
    this._startLanding(this.orbiting);
  }

  _startLanding(body) {
    this._fade(true, () => {
      try {
        this.mining = false;
        this.audio.stopMining();
        this.audio.setWarning(false);
        this.effects.setBeam(null, null, false);
        this.surface = new SurfaceScene(body.cfg, this.quality);
        this.mode = 'surface';
        this.orbiting = null;
        this.hud.show();
        this.toasts.show('PLANETFALL', `Descending to ${body.name} — fly gently, land, press E to collect samples.`, 'info', 6000);
        this.gs.state.stats.landings++;
      } catch (e) {
        console.error('landing failed', e);
        this.toasts.show('LANDING FAILED', 'Surface module error — staying in orbit.', 'warn');
        this.mode = 'space';
      }
      setTimeout(() => this._fade(false), 120);
    });
  }

  _updateSurface(dt) {
    const input = this.controller.sample(dt);
    this.shipVisual.group.visible = false;
    this.trail.line.visible = false;
    const stats = shipStats(this.gs.state.upgrades);
    this.shipState.energy = Math.min(100, this.shipState.energy + 6 * dt);

    this.surface.update(dt, input, this.camera, {
      fuelAvailable: () => this.shipState.fuel > 0,
      onCrash: (impact) => {
        this.damageShip(impact, 'crash');
        this.surface.shipState.velocity.multiplyScalar(0.2);
      },
      onLeave: () => this._returnToOrbit()
    });
    // fuel burn while thrusting
    const thrusting = input.throttleF !== 0 || input.vert > 0;
    if (thrusting) this.shipState.fuel = Math.max(0, this.shipState.fuel - 1.4 * dt / stats.efficiency);
    this.audio.setEngine(thrusting ? Math.min(1, Math.abs(input.throttleF) + Math.max(0, input.vert)) : 0, false);

    this._updateHUDSurface();
    this.missions?.update(this.missions.makeContext(this));
    this._checkAchievements();

    // collect samples (E)
    const holdE = this.controller.enabled &&
      (this.controller.keys.has('KeyE') || this.controller.touch.interactHeld);
    if (this.surface.landed && holdE && !this.surface.collected && !this._collectLatch) {
      this._collectLatch = true;
      this.surface.collected = true;
      const rewards = this.surface.collectRewards();
      const parts = [];
      for (const k in rewards) {
        const got = this.gs.addCargo(k, rewards[k], stats.cargoCapacity);
        parts.push(`${ECON_LABEL(k)} ×${Math.round(got)}`);
      }
      this.gs.addXP(150);
      this.toasts.show('SAMPLES COLLECTED', parts.join(', ') + ' · +150 XP', 'discovery', 5000);
      this.audio.missionComplete();
      this.gs.save(this.shipSnapshot());
    }
    if (!holdE) this._collectLatch = false;
  }

  _returnToOrbit() {
    if (this._returningOrbit) return;
    this._returningOrbit = true;
    this._fade(true, () => {
      const body = this.solar.getBody(this.surface.id);
      this._disposeSurface();
      this.mode = 'space';
      // reappear in a clean orbit around the planet
      const r = body.radius * 3.2;
      this.shipState.position.copy(body.group.position).add(new THREE.Vector3(r, 0, 0));
      this.shipState.velocity.set(0, 0, 0);
      this.trail.clear(this.shipState.position);
      this.enterOrbit(body);
      this.orbitRadius = r;
      this._returningOrbit = false;
      setTimeout(() => this._fade(false), 100);
    });
  }

  _disposeSurface() {
    this.surface?.dispose();
    this.surface = null;
  }

  // ---- docking ----
  dock(station) {
    this.mode = 'space';
    this.modalOpen = 'docked';
    this.dockingStation = station;
    if (!this.gs.state.visited.includes(station.id)) this.gs.state.visited.push(station.id);
    this.gs.state.stats.docks++;
    this.shipState.lastStation = station.id;
    this.dockPanel.show(station.name);
    this.audio.dock();
    this.saveGame();
    document.exitPointerLock?.();
    this._expectedUnlock = true;
  }
  undock() {
    this.dockPanel.hide();
    this.modalOpen = null;
    this.toasts.show('UNDOCKED', `Clear of ${this.dockingStation?.name || 'station'}.`, 'info', 1600);
    if (!this.touch) this.canvas.requestPointerLock?.();
  }

  // ---- damage / death ----
  damageShip(amount, kind) {
    const st = this.shipState;
    this._lastHit = this._now();
    if (st.shield > 0) {
      const absorbed = Math.min(st.shield, amount);
      st.shield -= absorbed;
      amount -= absorbed;
    }
    if (amount > 0) {
      st.hull -= amount;
      this.effects.explosion(st.position, 0.35);
      if (st.hull <= 0) this._shipDestroyed();
      else this.toasts.show('HULL DAMAGE', `${kind === 'crash' ? 'Crash impact' : 'Impact'} — hull ${Math.round(st.hull)}%`, 'warn', 2200);
    }
  }
  _shipDestroyed() {
    if (this.mode === 'surface') { this._disposeSurface(); this.mode = 'space'; }
    this.effects.explosion(this.shipState.position, 2.2);
    this.audio.explosion?.();
    this.toasts.show('SHIP DESTROYED', 'Emergency beacon triggered…', 'warn', 5000);
    const station = this.solar.stations.find(s => s.id === this.shipState.lastStation) || this.solar.stations[0];
    // lose 25% cargo
    for (const k in this.gs.state.resources) this.gs.state.resources[k] = Math.floor(this.gs.state.resources[k] * 0.75);
    const stats = shipStats(this.gs.state.upgrades);
    this.shipState.position.copy(station.group.position).add(new THREE.Vector3(5, 3, 5));
    this.shipState.velocity.set(0, 0, 0);
    this.shipState.hull = 100;
    this.shipState.shield = stats.shieldMax;
    this.shipState.fuel = stats.fuelCapacity * 0.5;
    this.orbiting = null;
    this.trail.clear(this.shipState.position);
    this._flash('rgba(255,80,40,0.55)');
  }

  // ---- fast travel ----
  requestFastTravel(id) {
    if (id === 'sun') { this.toasts.show('FAST TRAVEL', 'The sun is not a safe destination.', 'warn'); return; }
    const body = this.solar.getBody(id);
    const station = this.solar.stations.find(s => s.id === id);
    const anom = this.solar.anomalies.find(a => a.cfg.id === id);
    if (!body && !station && !anom) return;
    const discovered = this.gs.state.visited.includes(id) || this.gs.state.discoveries.includes(id) ||
      this.gs.state.anomalies.includes(id);
    if (!discovered) { this.toasts.show('FAST TRAVEL', 'Destination unknown — scan or visit it first.', 'warn'); this.audio.error(); return; }
    const destPos = body ? body.group.position : station ? station.group.position : anom.sprite.position;
    const dist = this.shipState.position.distanceTo(destPos);
    const cost = Math.round(dist * 0.14);
    const time = clamp(dist / 380, 3, 14);

    const m = this.confirmM;
    m.body.innerHTML = '';
    m.body.appendChild(el('div', 'ft-route', `${this.dockingStation ? '' : 'SHIP'} → ${body?.name || station?.name || anom.cfg.name}`));
    m.body.appendChild(el('div', 'pi-k', 'Fuel required'));
    m.body.appendChild(el('div', 'pi-v', `${cost} (${Math.round(this.shipState.fuel)} available)`));
    m.body.appendChild(el('div', 'pi-k', 'Travel time'));
    m.body.appendChild(el('div', 'pi-v', `${time.toFixed(0)} seconds`));
    const row = el('div', 'btn-row');
    const go = el('button', 'btn btn-primary', 'CONFIRM');
    const no = el('button', 'btn', 'CANCEL');
    go.addEventListener('click', () => { m.close(); this._beginWarp(destPos, cost, id); });
    no.addEventListener('click', () => m.close());
    row.append(go, no);
    m.body.appendChild(row);
    m.root.classList.remove('hidden');
    this.modalOpen = 'confirm';
    this.audio.uiOpen();
    document.exitPointerLock?.();
    this._expectedUnlock = true;
  }

  _beginWarp(destPos, cost, destId) {
    const stats = shipStats(this.gs.state.upgrades);
    if (this.shipState.fuel < cost) { this.toasts.show('FAST TRAVEL', 'Not enough fuel.', 'warn'); this.audio.error(); return; }
    this.gs.spend(cost);
    this.gs.state.stats.jumps++;
    this.orbiting = null;
    this.mining = false;
    this.audio.stopMining();
    this.warp = {
      t: 0, dur: clamp(this.shipState.position.distanceTo(destPos) / 380, 3, 14),
      destPos: destPos.clone(), destId,
      startPos: this.shipState.position.clone(),
      repositioned: false
    };
    this.audio.boostBurst();
    this._flash('rgba(120,180,255,0.4)');
    this.closeModal();
    this.planetInfo.hide();
  }

  _updateWarp(dt, stats) {
    const w = this.warp;
    w.t += dt;
    const half = w.dur / 2;
    // FOV kick + shake
    const k = Math.sin(Math.min(1, w.t / w.dur) * Math.PI);
    this.camera.fov = 70 + k * 24;
    this.camera.updateProjectionMatrix();
    if (!w.repositioned && w.t >= half) {
      w.repositioned = true;
      // place ship near destination, facing it
      const dir = new THREE.Vector3(1, 0.25, 0.4).normalize();
      const offset = dir.multiplyScalar((this.solar.getBody(w.destId)?.radius || 8) * 4 + 10);
      this.shipState.position.copy(w.destPos).add(offset);
      const m = new THREE.Matrix4().lookAt(this.shipState.position, w.destPos, new THREE.Vector3(0, 1, 0));
      this.shipState.quaternion.setFromRotationMatrix(m);
      this.shipState.velocity.set(0, 0, 0);
      this.trail.clear(this.shipState.position);
      this._flash('rgba(200,230,255,0.5)');
      this.audio.arrival();
    }
    // tremble along direction
    const jitter = k * 0.5;
    this.shipVisual.group.position.copy(this.shipState.position)
      .add(new THREE.Vector3((Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter, (Math.random() - 0.5) * jitter));
    this.shipVisual.group.quaternion.copy(this.shipState.quaternion);
    this.effects.enginePuff(
      this.shipState.position.clone().add(new THREE.Vector3(0, 0, 2).applyQuaternion(this.shipState.quaternion)),
      new THREE.Vector3(0, 0, 1).applyQuaternion(this.shipState.quaternion), 0.6, true);
    this.audio.setEngine(1, true);

    if (w.t >= w.dur) {
      this.warp = null;
      this.camera.fov = 70;
      this.camera.updateProjectionMatrix();
      const body = this.solar.getBody(w.destId);
      if (body) this.startCinematic(body);
      this.missions?.update(this.missions.makeContext(this));
    }
  }

  // ---- cinematic ----
  startCinematic(body) {
    if (!body) return;
    this.cinematic = { body, t: 0, dur: 3.4 };
  }
  _updateCinematic(dt) {
    const c = this.cinematic;
    c.t += dt;
    const body = c.body;
    const r = body.radius * 4.2;
    const a = c.t * 0.55 + 1;
    const pos = body.group.position;
    this.camera.position.set(
      pos.x + Math.cos(a) * r,
      pos.y + r * 0.42,
      pos.z + Math.sin(a) * r
    );
    this.camera.lookAt(pos);
    return c.t >= c.dur;
  }

  // ================================================================ CAMERAS
  _updateCamera(dt, input) {
    if (this.mode === 'surface') return; // surface scene drives the camera
    if (this.cinematic) {
      if (this._updateCinematic(dt)) this.cinematic = null;
      return;
    }
    const st = this.shipState;
    if (this.cameraMode === 'free' && !this.touch) {
      const fc = this.freeCam;
      fc.yaw -= (input?.yawDelta || 0);
      fc.pitch = clamp(fc.pitch - (input?.pitchDelta || 0), -1.3, 1.3);
      const off = new THREE.Vector3(
        Math.sin(fc.yaw) * Math.cos(fc.pitch),
        Math.sin(fc.pitch),
        Math.cos(fc.yaw) * Math.cos(fc.pitch)
      ).multiplyScalar(fc.dist);
      this.camera.position.copy(st.position).add(off);
      this.camera.lookAt(st.position);
    } else {
      // chase camera with smoothing
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(st.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(st.quaternion);
      const desired = st.position.clone()
        .addScaledVector(back, CHASE_DIST)
        .addScaledVector(up, CHASE_HEIGHT);
      const smooth = 1 - Math.pow(0.0008, dt);
      this.camera.position.lerp(desired, smooth);
      const look = st.position.clone().addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(st.quaternion), 14);
      this.camera.lookAt(look);
      if (this.warp) this.camera.position.copy(st.position).addScaledVector(back, CHASE_DIST + 2);
    }
  }

  // ================================================================ HUD
  _now() { return performance.now() / 1000; }

  forwardFlat() {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.shipState.quaternion);
    f.y = 0;
    return f.normalize();
  }

  distToBody(id) {
    const body = this.solar.getBody(id);
    if (!body) return Infinity;
    return this.shipState.position.distanceTo(body.group.position);
  }

  _currentPrompt() {
    if (this.mode === 'surface') {
      if (this.surface.landed && !this.surface.collected) return this.touch ? 'E — COLLECT SAMPLES' : 'E — COLLECT SAMPLES';
      return '';
    }
    if (this.orbiting) {
      let p = 'E — LEAVE ORBIT';
      if (this.orbiting.cfg.landable) p += '  ·  L — LAND';
      return p;
    }
    for (const station of this.solar.stations)
      if (this.shipState.position.distanceTo(station.group.position) < station.dockRadius)
        return `E — DOCK · ${station.name}`;
    for (const an of this.solar.anomalies)
      if (!this.gs.state.anomalies.includes(an.cfg.id) && this.shipState.position.distanceTo(an.sprite.position) < 12)
        return 'E — INVESTIGATE ANOMALY';
    if (this.miningTarget) return this.touch ? 'HOLD E — MINE' : 'HOLD E — MINE ASTEROID';
    const body = this._nearestBodyInSOI();
    if (body) return `E — ENTER ORBIT · ${body.name}`;
    return '';
  }

  _updateHUD(warn) {
    const stats = shipStats(this.gs.state.upgrades);
    const st = this.shipState;
    const targetPos = this._targetWorldPos();
    const mission = this.missions?.active;
    const missionProgress = mission ? this.missions.active.progress(this.missions.makeContext(this)) : null;

    let action = null;
    if (this.scanning) action = { title: 'SCANNING…', p: this.scanning.t / this.scanning.dur };
    else if (this.mining) {
      const t = this.miningTarget;
      const ast = t;
      action = {
        title: `MINING ${ast.type.label} — CARGO ${cargoUsed(this.gs.state.resources)}/${stats.cargoCapacity}`,
        p: 1 - ast.ore / ast.maxOre
      };
    }

    this.hud.update({
      fuel: st.fuel, fuelMax: stats.fuelCapacity,
      shield: st.shield, shieldMax: stats.shieldMax,
      energy: st.energy, energyMax: 100,
      hull: st.hull, hullMax: 100,
      credits: this.gs.credits,
      level: this.gs.level(),
      clock: this.time.dateString(),
      timeSpeed: this.time.speed,
      warning: this.modalOpen ? '' : warn,
      mission: mission ? {
        name: mission.name,
        progressText: missionProgress ? `${Math.round(missionProgress[0])}/${Math.round(missionProgress[1])}` : ''
      } : null,
      prompt: this._currentPrompt(),
      action,
      target: targetPos ? {
        name: this.target.name,
        dist: formatDistance(this.shipState.position.distanceTo(targetPos))
      } : null,
      speed: formatSpeed(st.speed)
    });
    this._updateCamera(this._lastStep || 0.016, this.controller.frame);
  }

  _updateHUDSurface() {
    const stats = shipStats(this.gs.state.upgrades);
    const st = this.shipState;
    const alt = this.surface.altitude;
    const vspeed = this.surface.shipState.velocity.y;
    this.hud.update({
      fuel: st.fuel, fuelMax: stats.fuelCapacity,
      shield: st.shield, shieldMax: stats.shieldMax,
      energy: st.energy, energyMax: 100,
      hull: st.hull, hullMax: 100,
      credits: this.gs.credits,
      level: this.gs.level(),
      clock: this.time.dateString(),
      timeSpeed: this.time.speed,
      warning: st.fuel < stats.fuelCapacity * 0.15 ? '⚠ FUEL LOW' : '',
      mission: null,
      prompt: this._currentPrompt(),
      action: null,
      target: {
        name: this.surface.cfg.name + (this.surface.landed ? ' — TOUCHDOWN' : ' — FLIGHT'),
        dist: `ALT ${Math.max(0, alt).toFixed(0)} · VS ${vspeed.toFixed(1)}`
      },
      speed: formatSpeed(this.surface.shipState.speed * 4)
    });
  }

  // ================================================================ FX / SCREEN
  _flash(color) {
    this.flashEl.style.background = `radial-gradient(circle, ${color}, transparent 75%)`;
    this.flashEl.style.opacity = '1';
    setTimeout(() => { this.flashEl.style.opacity = '0'; }, 60);
  }
  _fade(toBlack, mid) {
    this.fadeEl.style.opacity = toBlack ? '1' : '0';
    if (mid) setTimeout(mid, 420);
  }

  // ================================================================ SETTINGS / SAVE
  applySettings(patch) {
    Object.assign(this.gs.state.settings, patch);
    const s = this.gs.state.settings;
    this.audio.setVolumes(s.music, s.sfx);
    this.audio.setEnabled(s.sfx > 0 || s.music > 0);

    if (patch.quality !== undefined) {
      const q = patch.quality === 'auto' ? detectQuality() : patch.quality;
      if (q !== this.quality) {
        this.quality = q;
        this._rebuildWorld();
      }
      this.gs.state.settings.resolvedQuality = this.quality;
    }
    if (patch.bloom !== undefined || patch.quality !== undefined) this._setupComposer();
    if (patch.orbitLines !== undefined) this.solar?.setOrbitLinesVisible(s.orbitLines);
    if (patch.showFps !== undefined) this.fpsEl.classList.toggle('hidden', !s.showFps);
    this.gs.save(this.shipSnapshot());
  }

  _rebuildWorld() {
    // preserve ship state; rebuild quality-dependent world objects
    const keep = this.shipState.position.clone();
    if (this.surface) this._disposeSurface(), this.mode = 'space';
    this.solar?.dispose();
    this.starfield?.dispose();
    this.belt?.dispose();
    this.effects?.dispose();
    this.solar = new SolarSystem(this.scene, this.quality);
    this.solar.setOrbitLinesVisible(this.gs.state.settings.orbitLines);
    this.solar.update(this.time.simSeconds, 0);
    this.starfield = new Starfield(this.scene, this.quality);
    this.belt = new AsteroidField(this.scene, this.quality);
    this.effects = new Effects(this.scene, this.quality);
    if (!this.shipVisual.parent) this.scene.add(this.shipVisual.group);
    this.trail.clear(keep);
    this._setupComposer();
    this.toasts.show('GRAPHICS', `Quality: ${this.quality.toUpperCase()}`, 'info', 2000);
  }

  shipSnapshot() {
    const st = this.shipState;
    return {
      position: st.position.toArray(),
      quaternion: st.quaternion.toArray(),
      fuel: st.fuel, energy: st.energy, shield: st.shield, hull: st.hull,
      lastStation: st.lastStation
    };
  }

  saveGame(manual) {
    if (!this.gs.canSave) { if (manual) this.toasts.show('SAVE', 'Storage unavailable in this browser.', 'warn'); return; }
    const ok = this.gs.save(this.shipSnapshot());
    if (manual) this.toasts.show(ok ? 'GAME SAVED' : 'SAVE FAILED', ok ? 'Progress stored locally.' : 'Storage error.', ok ? 'success' : 'warn', 2200);
  }

  // ================================================================ RESIZE
  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    const pr = Math.min(devicePixelRatio || 1, QUALITY[this.quality]?.pixelRatio || 1.5);
    this.renderer.setPixelRatio(pr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
  }
}

function ECON_LABEL(k) {
  return ({ iron: 'Iron', nickel: 'Nickel', water: 'Water', ice: 'Ice', rare: 'Rare Minerals' })[k] || k;
}
