// Game — the orchestrator. Owns the renderer/scene, all world systems,
// game modes (menu / space / surface), interaction logic, economy hooks,
// save/load, missions, achievements, camera modes and the main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { PLANETS, MOONS, STATIONS, ANOMALIES, QUALITY, detectQuality, isTouchDevice, SUN_CONFIG, ECONOMY } from '../config.js';
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
import { computeAimAssist } from '../utils/AimAssist.js';
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
import { BasePanel } from '../ui/BasePanel.js';
import { Toasts } from '../ui/Toasts.js';
import { LoadingScreen } from '../ui/LoadingScreen.js';

import { el, makeModal } from '../utils/UI.js';
import { topVisibleModal } from '../utils/modalState.js';
import { safeSpawn, anchoredPosition, resolveAnchored, insideSun } from '../utils/SpawnSafety.js';
import { backend } from '../net/Backend.js';
import { SaveSystem } from '../save/SaveSystem.js';
import { UISound } from '../audio/UISound.js';
import { BackButton } from '../ui/BackButton.js';
import { RocketBuilder } from '../ui/RocketBuilder.js';
import { AccountPanel, randomGuestName } from '../ui/AccountPanel.js';
import { LaunchSequence } from '../rockets/LaunchSequence.js';
import { formatDistance, formatSpeed } from '../planets/PlanetData.js';
import { cargoUsed } from '../world/Resources.js';
import { mulberry32, clamp } from '../utils/Noise.js';

const CHASE_DIST = 9, CHASE_HEIGHT = 3.6;
const SHUTTLE_RANGE = 30;   // board/park the rover within this range

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
    this.repairJob = null;        // {index, t, dur} — fixing a broken rover on the surface
    this._maintainReady = 0;      // time.simSeconds at which maintenance is available again
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
      settingsChanged: (patch) => this.applySettings(patch),
      // --- account / online ---
      account: () => this.openAccount(),
      accountInfo: () => this.accountInfo(),
      rocketBuilder: () => this.openRocketBuilder(),
      // --- careers ---
      loadSlot: (slot) => this.loadSlot(slot),
      deleteSlot: (slot) => this.deleteSlot(slot),
      syncSlot: (slot) => this.syncSlot(slot),
      exportSlot: (slot) => this.exportSlot(slot),
      importSave: () => this.importSaveFile(),
      // --- servers ---
      listServers: (region) => this.listServers(region),
      joinServer: (s) => this.joinServer(s),
      hostServer: () => this.hostServer(),
      // --- friends ---
      listFriends: () => this.listFriends(),
      findFriends: (q) => this.findFriends(q),
      addFriend: (p) => this.addFriend(p),
      acceptFriend: (f) => this.acceptFriend(f),
      removeFriend: (f) => this.removeFriend(f),
      inviteFriend: (f) => this.inviteFriend(f)
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

    // Planetary outpost — live, eat, maintain, rover, EVA + supply line.
    this.basePanel = new BasePanel(this.root, {
      gs: this.gs,
      onRest: () => this._restAtBase(),
      onEat: () => this._eatAtBase(),
      onMaintain: () => this._maintainBase(),
      onRover: () => this._toggleRover(),
      onEva: () => this._toggleFoot(),
      onLeave: () => this.closeModal(),
      sound: (k) => this.audio[k === 'click' ? 'click' : 'levelUp']?.(),
      brokenRovers: () => (this.surface?.brokenRovers || []),
      maintainCooldownRemaining: () => Math.max(0, this._maintainReady - this.time.simSeconds),
      getOrders: () => this._surfaceOrders(),
      supplyQuote: (id, qty) => this._supplyQuote(id, qty),
      orderItem: (id, qty) => this._orderSupply(id, qty)
    });

    // ---- account / online identity ----
    this.backend = backend;
    this.identity = SaveSystem.loadIdentity() || { name: randomGuestName(), mode: 'guest', createdAt: Date.now() };
    SaveSystem.saveIdentity(this.identity);

    this.accountPanel = new AccountPanel(this.root, {
      backend: this.backend,
      identity: () => this.identity,
      setIdentity: (patch) => {
        this.identity = { ...this.identity, ...patch };
        SaveSystem.saveIdentity(this.identity);
      },
      toast: (t, m, k) => this.toasts.show(t, m, k),
      onChanged: () => { this.menu.refreshAccount(); this.menu.renderTab(); this._onAccountChanged(); },
      syncAll: () => this.syncAllSaves()
    });

    // ---- rocket workshop (VAB) ----
    this.rocketBuilder = new RocketBuilder(this.root, {
      gs: this.gs,
      backend: this.backend,
      toast: (t, m, k, d) => this.toasts.show(t, m, k, d),
      onLaunch: (design, analysis) => this.launchRocket(design, analysis),
      onClose: () => { this.modalOpen = null; this.syncModalState(); }
    });

    this.touchCapable = isTouchDevice();
    this.mobileActive = false;
    this.mobile = new MobileControls(this.root, this.controller.touch, {
      interact: () => this.doInteract(),
      scan: () => this.tryScan(),
      map: () => this.toggleMap(),
      target: () => this.cycleTarget(),
      land: () => this.tryLand(),
      eva: () => this._toggleFoot(),
      missions: () => this.toggleModal('missions'),
      codex: () => this.toggleModal('codex'),
      pause: () => {
        this.syncModalState();
        if (this.modalOpen) this.closeModal();
        else if (this.mode !== 'menu' && this.mode !== 'loading') this.togglePause();
      }
    });
    // The drag-to-look fallback fires this on the player's first actual
    // use (mouse environments where the browser refused/silently failed the
    // pointer lock) — the moment a "my mouse doesn't work" situation
    // becomes real.
    this.controller.onDragLook = () => {
      if (this.mode !== 'space' || this._dragLookToasted) return;
      this._dragLookToasted = true;
      this.toasts.show('MOUSE', 'Pointer lock is unavailable in this browser — keep holding the left mouse button and move to look around.', 'info', 6000);
    };
    this.fpsEl = el('div', 'fps-counter hidden');
    this.root.appendChild(this.fpsEl);

    this.flashEl = el('div', 'screen-flash');
    this.root.appendChild(this.flashEl);
    this.fadeEl = el('div', 'screen-fade');
    this.root.appendChild(this.fadeEl);

    this.confirmM = makeModal('ft-modal', 'FAST TRAVEL');
    this.root.appendChild(this.confirmM.root);

    // Every full-viewport overlay, keyed by modal kind. syncModalState()
    // re-derives this.modalOpen from these real DOM nodes so a modal shown
    // outside openModal() (main-menu buttons, NEW GAME confirm) can never
    // wedge the UI: ESC closes what is actually visible, and action gates
    // see the truth instead of stale bookkeeping.
    this._modalRegistry = {
      pause: this.menu.pause,
      confirm: [this.menu.confirmModal.root, this.confirmM.root],
      missions: this.menu.missionsModal.root,
      settings: this.menu.settingsModal.root,
      ship: this.menu.shipModal.root,
      help: this.menu.helpModal.root,
      codex: this.codex.modal.root,
      map: this.mapView.rootEl,
      docked: this.dockPanel.modal.root,
      base: this.basePanel.modal.root,
      account: this.accountPanel.modal.root,
      vab: this.rocketBuilder.modal.root,
      planetinfo: this.planetInfo.rootEl
    };
    this.syncModalState();
  }

  /** Re-derive modalOpen from the actual DOM (see modalState.js). */
  syncModalState() {
    this.modalOpen = topVisibleModal(this._modalRegistry);
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
      // Re-sync from the DOM first: modals opened outside openModal()
      // (main-menu buttons, NEW GAME confirm) would otherwise leave
      // modalOpen null and ESC would do nothing while a full-screen modal
      // still blocks every button.
      this.syncModalState();
      if (this.modalOpen) this.closeModal();
      else if (this.mode !== 'menu' && this.mode !== 'loading') this.togglePause();
    });
    c.on('pointerlocklost', () => {
      if (this._expectedUnlock) { this._expectedUnlock = false; return; }
      this.syncModalState();
      if (this.mode === 'space' && !this.modalOpen && !this.paused && !this.mobileActive) this.togglePause();
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

    // Click / tap feedback on EVERY interactive element (buttons, sliders,
    // touch controls, list rows) — one capture listener instead of 80
    // hand-written audio.click() calls that were easy to forget.
    this.uiSound = new UISound(this.root, this.audio, {
      enabled: () => this.gs.state.settings.uiClicks !== false && this.gs.state.settings.sfx > 0
    });
    // Short haptic buzz to go with it on touch devices.
    this.root.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      if (this.gs.state.settings.haptics === false) return;
      if (!e.target?.closest?.('button, .btn, .mc-btn, .mc-interact, [role="button"]')) return;
      navigator.vibrate?.(12);
    }, true);

    // ANDROID BACK / browser Back behaves exactly like ESC: close the topmost
    // panel, or open the pause menu. Only leaves the page when nothing is open
    // and the player is sitting on the main menu.
    this.backButton = new BackButton(() => this._handleBack());
    this.backButton.arm();

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
    this._finishEmailLink();
  }

  /**
   * The player arrived from a "confirm your email" / "reset password" link:
   * Supabase redirected them back here with a session in the URL fragment.
   * Turn it into a signed-in account and tell them so.
   */
  async _finishEmailLink() {
    if (!this.backend?.hasPendingEmailLink) return;
    let result = null;
    try { result = await this.backend.completeEmailLink(); } catch (e) { console.warn('email link', e); }
    if (!result) return;
    if (result.error) {
      this.toasts.show('EMAIL LINK', result.message, 'warn', 8000);
      return;
    }
    this.menu.refreshAccount();
    this.menu.renderTab();
    if (result.type === 'recovery') {
      this.toasts.show('PASSWORD RESET', 'You are signed in — choose a new password now.', 'success', 7000);
      this.accountPanel.showPasswordReset();
      this.modalOpen = 'account';
    } else {
      this.toasts.show('EMAIL CONFIRMED', 'Welcome aboard, ' + this.backend.handle + ' — you are signed in and cloud sync is ready.', 'success', 7000);
    }
    this._onAccountChanged();
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
    // A new career gets its own slot so past games stay in the list.
    const free = SaveSystem.firstFreeSlot();
    if (free >= 0) { this.gs.slot = free; SaveSystem.setActiveSlot(free); }
    this.gs.reset();
    this.gs.state.careerName = (this.backend?.signedIn ? this.backend.handle : this.identity?.name || 'Commander') + "'s career";
    this._grantStarterSupply();
    this.missions = new MissionManager(this.gs, {
      toast: (t, s, k) => this.toasts.show(t, s, k),
      sound: () => this.audio.missionComplete(),
      shipSnapshot: () => this.shipSnapshot()
    });
    this.audio.init();
    this.audio.startMusic();
    this._spawnShip(true);
    this._enterPlay();
    // A career BEGINS ON EARTH: your first job is to design a rocket and fly
    // it to orbit. Everything else in the solar system opens up from there.
    this.startCareerOnEarth();
  }

  /**
   * Opening beat of a new career: you are on the pad at Earth with a grant,
   * and the Rocket Workshop is already open. Build → launch → orbit → explore.
   */
  startCareerOnEarth() {
    this.gs.state.careerStage = 'first-launch';
    this.toasts.show('WELCOME TO THE PROGRAM',
      'You are on the pad at Earth. Design your first rocket in the ROCKET WORKSHOP, then LAUNCH FROM EARTH to reach orbit.',
      'info', 9000);
    // Give them a moment to read it, then open the workshop with the starter.
    setTimeout(() => {
      if (this.mode === 'space' && this.gs.state.careerStage === 'first-launch') {
        this.openRocketBuilder();
        this.toasts.show('TIP',
          'Press LOAD STARTER for a rocket that already reaches orbit, or drag your own together — then 🚀 LAUNCH FROM EARTH.',
          'info', 8000);
      }
    }, 1200);
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
      this._restoreShipPosition(snap);
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
      this._grantStarterSupply();
    }
    this._enterPlay();
    if (loaded && snap) this.toasts.show('SYSTEMS RESTORED', `Welcome back, Commander — LV ${this.gs.level()}, ${this.gs.credits.toLocaleString()} CR`, 'info');
  }

  /** Restore a saved ship position, never inside the Sun (see SpawnSafety). */
  _restoreShipPosition(snap) {
    const resolved = resolveAnchored(snap, (id) => {
      const st = this.solar.stations.find(s => s.id === id);
      if (st) return { position: st.group.position };
      const body = this.solar.getBody(id);
      return body ? { position: body.group.position } : null;
    });
    const station = this.solar.stations.find(s => s.id === (snap.lastStation || 'earth-station')) || this.solar.stations[0];
    const earth = this.solar.getBody('earth');
    const fallbacks = [
      station ? { position: station.group.position } : null,
      earth ? { position: earth.group.position } : null
    ].filter(Boolean);
    const safe = safeSpawn(resolved, fallbacks, this.solar.sunPosition);
    this.shipState.position.set(safe.position.x, safe.position.y, safe.position.z);
    if (safe.relocated) {
      this.toasts.show('NAVIGATION RECOVERY',
        `Your saved position was ${safe.reason} — the ship has been relocated to ${station?.name || 'Earth orbit'}.`,
        'warn', 5200);
    }
    return safe;
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
    const earth = this.solar.getBody('earth');
    const base = station ? station.group.position.clone() : earth.group.position.clone();
    const wanted = base.clone().add(new THREE.Vector3(4, 2.5, 9));
    // Guard rail: if the station/planet lookup ever fails, `base` would be the
    // origin — which is the middle of the Sun. safeSpawn() never allows that.
    const safe = safeSpawn(wanted, [
      station ? { position: station.group.position } : null,
      earth ? { position: earth.group.position } : null
    ].filter(Boolean), this.solar.sunPosition);
    this.shipState.position.set(safe.position.x, safe.position.y, safe.position.z);
    this.shipState.quaternion.identity();
    // look back at Earth
    const m = new THREE.Matrix4().lookAt(this.shipState.position, earth.group.position, new THREE.Vector3(0, 1, 0));
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

  /** Issue the astronaut a starter kit (rations + spare parts) for a new career. */
  _grantStarterSupply() {
    const cap = shipStats(this.gs.state.upgrades).cargoCapacity;
    if ((this.gs.state.resources.food || 0) === 0) this.gs.addCargo('food', 6, cap);
    if ((this.gs.state.resources.parts || 0) === 0) this.gs.addCargo('parts', 3, cap);
  }

  _enterPlay() {
    this.menu.hideMain();
    this.menu.hidePause();
    this.hud.show();
    this.mode = 'space';
    this.paused = false;
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    this.missions?.reset();
    this.syncAnomalies();
    this._syncMobileControls();
    this.syncModalState(); // never carry stale modal state into flight
    this.backButton?.arm();
    if (this.backend?.signedIn) this.backend.setPresence(this.currentServer?.id, 'in-game', this.currentLocation()).catch(() => {});
    if (!this.mobileActive) this.controller.tryRequestPointerLock();
  }

  _wantsMobileControls() {
    const s = this.gs.state.settings.mobileControls;
    return s === 'on' || (s !== 'off' && this.touchCapable);
  }

  _syncMobileControls() {
    if (this.mode === 'menu' || this.mode === 'loading') {
      if (this.mobileActive) {
        this.mobileActive = false;
        this.mobile.hide();
      }
      return;
    }
    const want = this._wantsMobileControls();
    if (this.mobileActive === want) return;
    this.mobileActive = want;
    if (want) this.mobile.show();
    else this.mobile.hide();
    // Pointer lock belongs to desktop play only. When controls are shown,
    // release the pointer so the player can press on-screen buttons.
    if (this.mode === 'space' && !this.paused && !this.modalOpen) {
      if (want) {
        document.exitPointerLock?.();
        this._expectedUnlock = true;
      } else {
        this.controller.tryRequestPointerLock();
      }
    }
    this._syncMobileMode();
  }

  /** Re-skin the touch layout for the current vehicle (ship/shuttle/rover/foot). */
  _syncMobileMode() {
    if (!this.mobile) return;
    this.mobile.setMode(this.mode === 'surface' ? (this.surface?.vehicleMode || 'shuttle') : 'space');
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
    this.mobileActive = false;
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
      // Re-enable input immediately instead of waiting for the next
      // per-frame update in _loop — otherwise a key pressed in the same
      // instant as RESUME (e.g. M to open the map right away) is lost.
      this.controller.enabled = true;
      if (!this.mobileActive && this.mode === 'space') this.controller.tryRequestPointerLock();
    }
    this.audio.click();
  }

  // ================================================================ MODALS
  openModal(kind) {
    if (this.mode === 'menu') {
      // Menu mode has no pointer lock to release, but the modal MUST be
      // tracked: with modalOpen left null, ESC is a no-op and the open
      // full-screen modal blocks every menu button behind it.
      if (kind === 'missions') this.menu.showMissions();
      else if (kind === 'codex') this.codex.show();
      else if (kind === 'ship') this.menu.showShip();
      else if (kind === 'settings') this.menu.showSettings();
      else if (kind === 'help') this.menu.showHelp();
      this.modalOpen = kind;
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
    this.basePanel.hide();
    this.menu.missionsModal.close();
    this.menu.shipModal.close();
    this.menu.settingsModal.close();
    this.menu.helpModal.close();
    this.menu.confirmModal.close();
    this.confirmM.close();
    this.accountPanel.hide();
    this.rocketBuilder.modal.root.classList.add('hidden');
    if (this.modalOpen === 'pause') {
      this.menu.hidePause();
      this.paused = false;
      this.controller.enabled = true; // same instant-resume rationale as togglePause
    }
    this.modalOpen = null;
  }
  toggleModal(kind) {
    this.syncModalState();
    if (this.modalOpen === kind) this.closeModal();
    else this.openModal(kind);
  }
  toggleMap() {
    if (this.mode === 'menu') return;
    this.syncModalState();
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
      else if (this.mode === 'launch') this._updateLaunch(step);
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

    // aim assist (FFM/PUBG-style auto-aim): gently pull the nose toward the
    // current target in free flight. Disabled while orbiting/warping/modal.
    if (!this.warp && !this.orbiting && this.gs.state.settings.aimAssist !== false) {
      const tp = this._targetWorldPos();
      if (tp && this.target) {
        const aid = computeAimAssist(
          this.shipState.quaternion, this.shipState.position, tp, dt,
          { enabled: true }
        );
        if (aid.engaging) {
          input.yawDelta += aid.yawDelta;
          input.pitchDelta += aid.pitchDelta;
          this.aimAssistActive = true;
        } else {
          this.aimAssistActive = false;
        }
      } else {
        this.aimAssistActive = false;
      }
    }

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

    // Earth supply orders coming due while we're in space
    this._checkSupplyOrders();

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
    this.syncModalState();
    if (this.mode === 'surface') { this._surfaceInteract(); return; }
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

  // ---- surface (outpost / rover / EVA / repairs / supplies) ----
  _surfacePos() {
    const s = this.surface;
    const p = s.playerPos();
    return { x: p.x, z: p.z };
  }

  _surfaceInteract() {
    this.syncModalState();
    if (this.mode !== 'surface' || this.modalOpen || this.paused) return;
    const surf = this.surface;
    const pos = surf.playerPos();
    const x = pos.x, z = pos.z;
    const onFoot = surf.vehicleMode === 'foot';
    const range = onFoot ? 7 : 16; // pick-up radius by vehicle
    // 1) enter the outpost
    if (surf.baseDistance(x, z) < surf.baseRadius) { this._openBase(); return; }
    // 2) don't re-trigger a repair in progress
    if (this.repairJob) return;
    // 3) repair a nearby broken rover
    const br = surf.nearestBrokenRover(x, z);
    if (br) { this._startRepair(br.i); return; }
    // 4) recover a supply cache (spare parts found on the map)
    const cache = surf.nearestCache(x, z, range);
    if (cache) { this._takeCache(cache.i); return; }
    // 5) load an Earth supply delivery crate
    const deliv = surf.nearestDelivery(x, z, range);
    if (deliv) { this._takeDelivery(deliv.i); return; }
    // 6) collect the world's science sample at the sample site
    if (!surf.sampleSite.collected && surf.sampleDistance(x, z) < surf.sampleSite.radius) {
      this._collectSamples(); return;
    }
    // 7) vehicle transitions
    if (surf.vehicleMode === 'rover') {
      if (surf.shuttleDistance(x, z) < SHUTTLE_RANGE) {
        surf.enterShuttle(pos);
        this.toasts.show('ROVER', 'Rover parked. Back in the landing shuttle.', 'info', 2200);
      } else if (Math.abs(surf.roverState.speed) < 1.5) {
        this._stepOutFoot();
      } else {
        this.toasts.show('EVA', 'Stop the rover to step out — or return to the shuttle.', 'warn', 2400);
      }
    } else if (surf.vehicleMode === 'shuttle') {
      if (surf.roverDistance(x, z) < SHUTTLE_RANGE) {
        surf.enterRover(pos);
        this.toasts.show('ROVER', 'Boarded the rover — drive out, find broken rovers and supply caches.', 'info', 3500);
      } else if (surf.landed) {
        this._stepOutFoot();
      }
    } else { // on foot
      if (surf.roverDistance(x, z) < SHUTTLE_RANGE * 0.6) {
        surf.enterRover(pos);
        this.toasts.show('ROVER', 'Boarded the rover.', 'info', 2000);
      } else if (surf.shuttleDistance(x, z) < SHUTTLE_RANGE * 0.6) {
        surf.enterShuttle(pos);
        this.toasts.show('SHUTTLE', 'Re-boarded the landing shuttle.', 'info', 2000);
      }
    }
    this._syncMobileMode();
  }

  /** Step out of the current vehicle on foot (EVA). */
  _stepOutFoot() {
    const surf = this.surface;
    if (surf.vehicleMode === 'shuttle' && !surf.landed) {
      this.toasts.show('EVA', 'Land the shuttle first (touch down gently), then step out.', 'warn', 2600);
      this.audio.error();
      return;
    }
    if (surf.vehicleMode === 'rover' && Math.abs(surf.roverState.speed) > 1.5) {
      this.toasts.show('EVA', 'Stop the rover before stepping out.', 'warn', 2200);
      this.audio.error();
      return;
    }
    surf.enterFoot(surf.playerPos());
    this.gs.state.stats.evas = (this.gs.state.stats.evas || 0) + 1;
    this.gs.award('walker');
    this.toasts.show('EVA — ON FOOT', 'Suit up! Run WASD · Sprint SHIFT · JUMP SPACE · look with the mouse.', 'info', 5000);
    this._syncMobileMode();
  }

  /** EVA toggle used by the outpost panel + the mobile EVA button. */
  _toggleFoot() {
    const surf = this.surface;
    if (!surf || this.mode !== 'surface') return;
    const pos = surf.playerPos();
    if (surf.vehicleMode === 'foot') {
      if (surf.shuttleDistance(pos.x, pos.z) < SHUTTLE_RANGE + 8) {
        surf.enterShuttle(pos);
        this.toasts.show('SHUTTLE', 'Re-boarded the landing shuttle.', 'info', 2200);
      } else if (surf.roverDistance(pos.x, pos.z) < SHUTTLE_RANGE + 8) {
        surf.enterRover(pos);
        this.toasts.show('ROVER', 'Boarded the rover.', 'info', 2200);
      } else {
        this.toasts.show('EVA', 'Walk back near your shuttle or rover to board it.', 'warn', 2600);
        this.audio.error();
      }
    } else {
      this._stepOutFoot();
    }
    this._syncMobileMode();
  }

  /** Recover a supply cache: spare parts + bonuses straight into cargo. */
  _takeCache(i) {
    const surf = this.surface;
    const logKey = `${surf.id}:${i}`;
    if (this.gs.state.collectedCaches.includes(logKey)) return;
    const payload = surf.takeCache(i);
    if (!payload) return;
    this.gs.state.collectedCaches.push(logKey);
    const stats = shipStats(this.gs.state.upgrades);
    const bits = [];
    for (const k in payload) {
      const got = this.gs.addCargo(k, payload[k], stats.cargoCapacity);
      bits.push(`${ECON_LABEL(k)} ×${Math.round(got)}`);
    }
    this.gs.state.stats.caches = (this.gs.state.stats.caches || 0) + 1;
    this.gs.addXP(60);
    this.toasts.show('SUPPLY CACHE RECOVERED', `${bits.join(', ')} · +60 XP — sell at a station for credits.`, 'success', 4200);
    this.audio.missionComplete();
    this._checkAchievements();
    this.gs.save(this.shipSnapshot());
  }

  /** Load an Earth delivery crate into cargo. */
  _takeDelivery(i) {
    const surf = this.surface;
    const order = surf.takeDelivery(i);
    if (!order) return;
    const stats = shipStats(this.gs.state.upgrades);
    const got = this.gs.addCargo(order.item, order.qty, stats.cargoCapacity);
    const stored = this.gs.state.supplyOrders.find(o => o.id === order.id);
    if (stored) stored.taken = true;
    this.gs.state.stats.deliveries = (this.gs.state.stats.deliveries || 0) + 1;
    this.gs.addXP(40);
    this.toasts.show('DELIVERY LOADED', `+${Math.round(got)} ${ECON_LABEL(order.item)} from Earth · +40 XP`, 'success', 4200);
    this.audio.missionComplete();
    this._checkAchievements();
    this.gs.save(this.shipSnapshot());
  }

  /** Collect this world's science sample (once per landing session). */
  _collectSamples() {
    const surf = this.surface;
    if (surf.collected) return;
    surf.collected = true;
    surf.sampleSite.collected = true;
    const stats = shipStats(this.gs.state.upgrades);
    const rewards = surf.collectRewards();
    const bits = [];
    for (const k in rewards) {
      const got = this.gs.addCargo(k, rewards[k], stats.cargoCapacity);
      bits.push(`${ECON_LABEL(k)} ×${Math.round(got)}`);
    }
    this.gs.addXP(150);
    this.toasts.show('SAMPLES COLLECTED', bits.join(', ') + ' · +150 XP', 'discovery', 5000);
    this.audio.missionComplete();
    this.gs.save(this.shipSnapshot());
  }

  _openBase() {
    if (this.mode !== 'surface') return;
    this.modalOpen = 'base';
    this.basePanel.show(`${this.surface.cfg.name} OUTPOST`, this.surface.vehicleMode);
    this.audio.uiOpen();
    this.saveGame();
    document.exitPointerLock?.();
    this._expectedUnlock = true;
  }

  _startRepair(index) {
    const surf = this.surface;
    const job = surf.brokenRovers[index];
    if (!job || job.fixed) return;
    if ((this.gs.state.resources.parts || 0) < ECONOMY.surface.repairParts) {
      this.toasts.show('REPAIR', 'You need spare parts — buy them at a station or outpost.', 'warn', 3200);
      this.audio.error();
      return;
    }
    // halt the vehicle so it doesn't drift out of range mid-repair
    if (surf.vehicleMode === 'rover') { surf.roverState.speed = 0; surf.roverState.velocity.set(0, 0, 0); }
    else { surf.shipState.velocity.set(0, 0, 0); this.surface.landed = true; }
    this.repairJob = { index, t: 0, dur: 6 };
    this.audio.scan?.(6);
    this.toasts.show('REPAIR', 'Repairing rover — stay close until it is back online.', 'info', 3000);
  }

  _finishRepair(job) {
    const surf = this.surface;
    const s = ECONOMY.surface;
    this.gs.consumeParts(s.repairParts);
    surf.fixRover(job.index);
    this.gs.addCredits(s.repairCredits);
    this.gs.addXP(s.repairXP);
    this.gs.award('mechanic');
    this.gs.state.stats.repairs = (this.gs.state.stats.repairs || 0) + 1;
    this.toasts.show('ROVER REPAIRED', `+${s.repairCredits.toLocaleString()} CR · +${s.repairXP} XP`, 'success', 5000);
    this.audio.missionComplete();
    this.gs.save(this.shipSnapshot());
  }

  _updateRepairJob(dt) {
    const job = this.repairJob;
    if (!job) return;
    const surf = this.surface;
    const rover = surf.brokenRovers[job.index];
    const pos = this._surfacePos();
    // cancelled if the player drifts away or the rover is already fixed
    if (!rover || rover.fixed || Math.hypot(rover.pos.x - pos.x, rover.pos.z - pos.z) > rover.radius + 8) {
      this.repairJob = null;
      if (rover && !rover.fixed) this.toasts.show('REPAIR', 'Repair interrupted — you moved away.', 'warn', 2200);
      return;
    }
    job.t += dt;
    if (job.t >= job.dur) {
      this._finishRepair(job);
      this.repairJob = null;
    }
  }

  _restAtBase() {
    this.shipState.energy = 100;
    this.time.simSeconds += 60 * 5; // sleep ~5 game-minutes
    this.toasts.show('RESTED', 'Energy restored to 100% · a few minutes passed.', 'info', 2600);
    this.audio.levelUp?.();
    this.saveGame();
  }

  _eatAtBase() {
    const gain = this.gs.eatFood(1);
    if (gain <= 0) {
      this.toasts.show('NO FOOD', 'Your rations are empty — buy food at a station or outpost.', 'warn', 3000);
      this.audio.error();
      return;
    }
    this.gs.award('astronaut');
    this.toasts.show('MEAL EATEN', `+${Math.round(gain)} satiety · ${this.gs.foodCount()} rations left`, 'success', 3000);
    this.audio.levelUp?.();
    this.saveGame();
  }

  _maintainBase() {
    const s = ECONOMY.surface;
    const now = this.time.simSeconds;
    if (now < this._maintainReady) {
      this.toasts.show('MAINTENANCE', 'Outpost systems already optimized.', 'info', 2200);
      return { ok: false };
    }
    if (!this.gs.consumeParts(s.maintainParts)) {
      this.toasts.show('MAINTENANCE', 'You need a spare part.', 'warn', 2600);
      return { ok: false };
    }
    this.gs.addCredits(s.maintainCredits);
    this.gs.addXP(s.maintainXP);
    this.gs.award('steward');
    this._maintainReady = now + s.maintainCooldown;
    this.toasts.show('STATION MAINTAINED', `+${s.maintainCredits.toLocaleString()} CR · +${s.maintainXP} XP · systems at 100%`, 'success', 4200);
    this.audio.missionComplete();
    this.saveGame();
    return { ok: true };
  }

  _toggleRover() {
    const surf = this.surface;
    if (surf.vehicleMode === 'rover') {
      surf.enterShuttle(surf.playerPos());
      this.toasts.show('ROVER', 'Rover parked. Back in the landing shuttle.', 'info', 2400);
    } else if (surf.vehicleMode === 'foot') {
      if (surf.roverDistance(surf.playerPos().x, surf.playerPos().z) < SHUTTLE_RANGE + 8) {
        surf.enterRover(surf.playerPos());
        this.toasts.show('ROVER', 'Boarded the rover.', 'info', 2400);
      } else {
        this.toasts.show('ROVER', 'Walk back near the rover to board it.', 'warn', 2600);
      }
    } else {
      surf.enterRover(surf.playerPos());
      this.toasts.show('ROVER', 'Boarded the rover — drive out and find broken rovers to repair.', 'info', 3400);
    }
    this._syncMobileMode();
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
    this.syncModalState();
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
    if (this.gs.state.stats.landings >= 1) this.gs.award('planetfall');
    if ((this.gs.state.stats.repairs || 0) >= 1) this.gs.award('mechanic');
    if ((this.gs.state.stats.caches || 0) >= 5) this.gs.award('scavenger');
    if ((this.gs.state.stats.deliveries || 0) >= 1) this.gs.award('logistics');
    if ((this.gs.state.stats.evas || 0) >= 1) this.gs.award('walker');
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
  // Any planet or moon is landable — but only after you have SCANNED it
  // (target T → scan R). Gas/ice giants give you a cloud-deck surface.
  tryLand() {
    if (this.mode === 'surface') return;
    if (!this.orbiting) { this.toasts.show('LANDING', 'Enter orbit first (get close, press E).', 'warn'); this.audio.error(); return; }
    const cfg = this.orbiting.cfg;
    const scanned = this.gs.state.discoveries.includes(cfg.id);
    if (!scanned) {
      this.toasts.show('LANDING', `${cfg.name} is unscanned — scan it first (T target, R scan) to unlock the surface.`, 'warn', 3600);
      this.audio.error();
      return;
    }
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
        this.repairJob = null;
        // restore world state that outlives a single visit:
        // delivered-but-unloaded Earth crates + already-recovered caches
        for (const o of this.gs.state.supplyOrders) {
          if (o.planet === body.id && o.delivered && !o.taken) this.surface.addDelivery(o);
        }
        for (const key of this.gs.state.collectedCaches) {
          const [pid, idx] = key.split(':');
          if (pid === body.id) this.surface.takeCache(parseInt(idx, 10));
        }
        this.hud.show();
        const cloud = this.surface.theme?.cloudDeck;
        this.toasts.show('PLANETFALL', cloud
          ? `Descending through the cloud layer — touching down on the ${body.name} CLOUD DECK. Rover, EVA (E) and supply caches await.`
          : `Touchdown on ${body.name} — land near the outpost, board the rover (E), or step out on foot (EVA) and hunt supply caches.`, 'info', 6500);
        this.gs.state.stats.landings++;
        this.gs.award('planetfall');
        this._syncMobileMode();
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
    const surf = this.surface;

    // energy regen — slower when the astronaut is hungry
    const satiety = this.gs.satiety;
    const energyRegen = satiety <= 0 ? 1.2 : satiety < ECONOMY.surface.hungerWarnAt ? 2.6 : 6;
    this.shipState.energy = Math.min(100, this.shipState.energy + energyRegen * dt);

    // runs out of food over time (survival)
    this.gs.drainSatiety(ECONOMY.surface.hungerDrainPerSec * dt);

    // surface sim (shuttle or rover)
    const hasFuel = () => this.shipState.fuel > 0;
    const onCrash = (impact) => {
      this.damageShip(impact, 'crash');
      this.surface.shipState.velocity.multiplyScalar(0.2);
    };
    const onLeave = () => this._returnToOrbit();
    surf.update(dt, input, this.camera, { fuelAvailable: hasFuel, onCrash, onLeave });

    // fuel burn while the shuttle thrusts (shuttle only — rover runs on its
    // cell, the astronaut on O₂; both covered by the ENERGY bar)
    const thrusting = input.throttleF !== 0 || input.vert > 0;
    if (surf.vehicleMode === 'shuttle' && thrusting) this.shipState.fuel = Math.max(0, this.shipState.fuel - 1.4 * dt / stats.efficiency);
    this.audio.setEngine(surf.vehicleMode === 'shuttle' && thrusting ? Math.min(1, Math.abs(input.throttleF) + Math.max(0, input.vert)) : 0, false);

    // rover repair job progress
    this._updateRepairJob(dt);

    // Earth supply orders that come due while we're on this world land crates
    this._checkSupplyOrders();

    // live supply-line countdown in the outpost panel
    this.basePanel?.tick?.(performance.now());

    this._updateHUDSurface();
    this.missions?.update(this.missions.makeContext(this));
    this._checkAchievements();
  }

  // ---- SUPPLY LINE: order from Earth ----
  /** Distance factor of the current outpost from Earth (0 on Earth). */
  _distFactor(bodyCfg) {
    const parent = bodyCfg?.parent ? PLANETS.find(p => p.id === bodyCfg.parent) : bodyCfg;
    const orbit = parent?.orbitRadius || 160;
    return clamp(Math.abs(orbit - 160) / 300, 0, 2.6);
  }

  _supplyQuote(itemId, qty) {
    if (!this.surface) return null;
    const sl = ECONOMY.surface.supplyLine;
    const base = ECONOMY.resources[itemId]?.price || 0;
    const df = this._distFactor(this.surface.cfg);
    const cost = Math.ceil(base * qty * (1 + sl.costPerDist * df));
    const eta = sl.baseEtaGameSec + sl.etaPerDist * df; // game-seconds
    const etaText = `${Math.floor(eta / 60)}m ${Math.round(eta % 60)}s`;
    return { cost, eta, etaText };
  }

  _orderSupply(itemId, qty) {
    if (this.mode !== 'surface' || !this.surface) return;
    const q = this._supplyQuote(itemId, qty);
    if (!q) return;
    if (!this.gs.spend(q.cost)) {
      this.toasts.show('SUPPLY LINE', 'Not enough credits for that order.', 'warn', 2600);
      this.audio.error();
      return;
    }
    const o = {
      id: 'o' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      planet: this.surface.id,
      item: itemId,
      qty,
      cost: q.cost,
      placedAt: this.time.simSeconds,
      dueAt: this.time.simSeconds + q.eta,
      delivered: false,
      taken: false,
      notified: false
    };
    this.gs.state.supplyOrders.push(o);
    this.toasts.show('ORDER FROM EARTH', `${ECON_LABEL(itemId)} ×${qty} en route to ${this.surface.cfg.name} — ETA ${q.etaText} (game time, warp-able).`, 'success', 5200);
    this.audio.levelUp?.();
    this.gs.save(this.shipSnapshot());
  }

  /** Orders for the outpost the player is currently on (panel view). */
  _surfaceOrders() {
    if (!this.surface) return [];
    const now = this.time.simSeconds;
    return this.gs.state.supplyOrders
      .filter(o => o.planet === this.surface.id && !o.taken)
      .map(o => ({ ...o, now }));
  }

  /** Land due delivery crates (surface) or announce arrivals (space). */
  _checkSupplyOrders() {
    const orders = this.gs.state.supplyOrders;
    if (!orders.length) return;
    const now = this.time.simSeconds;
    for (const o of orders) {
      if (o.taken || o.delivered || now < o.dueAt) continue;
      const body = this.solar?.getBody(o.planet);
      const bodyName = body?.name || o.planet.toUpperCase();
      if (this.mode === 'surface' && this.surface && this.surface.id === o.planet) {
        this.surface.addDelivery(o);
        o.delivered = true;
        this.toasts.show('DELIVERY FROM EARTH', `${ECON_LABEL(o.item)} ×${o.qty} crate landed near the ${bodyName} outpost — walk/drive over it and press E to load.`, 'success', 5600);
        this.audio.arrival();
        this.gs.save(this.shipSnapshot());
      } else if (!o.notified) {
        o.notified = true;
        this.toasts.show('DELIVERY IN TRANSIT', `Your Earth order has arrived at ${bodyName} — land there to collect the crate.`, 'info', 5200);
        this.gs.save(this.shipSnapshot());
      }
    }
  }

  _returnToOrbit() {
    if (this._returningOrbit) return;
    this._returningOrbit = true;
    this._fade(true, () => {
      const body = this.solar.getBody(this.surface?.id);
      this.repairJob = null;
      this._disposeSurface();
      this.mode = 'space';
      this._syncMobileMode();
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
    this.repairJob = null;
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
    // The MISSIONS panel can be stacked on top of the dock (dock → MISSIONS);
    // closing it here so undocking never leaves a stray full-screen modal
    // wedged above the HUD.
    this.menu.missionsModal.close();
    this.modalOpen = null;
    this.toasts.show('UNDOCKED', `Clear of ${this.dockingStation?.name || 'station'}.`, 'info', 1600);
    if (!this.mobileActive) this.controller.tryRequestPointerLock();
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
    if (this.mode === 'surface') { this._disposeSurface(); this.mode = 'space'; this._syncMobileMode(); }
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
    // Close the dialog AND re-sync modal state — a stale 'confirm' flag
    // would otherwise keep gating SCAN/interact/land until the next ESC.
    const closeFt = () => { m.close(); this.syncModalState(); };
    go.addEventListener('click', () => { closeFt(); this._beginWarp(destPos, cost, id); });
    no.addEventListener('click', closeFt);
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
    if (this.cameraMode === 'free' && !this.mobileActive) {
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
      const s = this.surface;
      if (this.repairJob) return 'REPAIRING…';
      const pos = this._surfacePos();
      const range = s.vehicleMode === 'foot' ? 7 : 16;
      if (s.baseDistance(pos.x, pos.z) < s.baseRadius) return 'E — ENTER OUTPOST';
      if (s.nearestBrokenRover(pos.x, pos.z)) return 'E — REPAIR ROVER (1 PART)';
      if (s.nearestCache(pos.x, pos.z, range)) return 'E — TAKE SUPPLY CACHE';
      if (s.nearestDelivery(pos.x, pos.z, range)) return 'E — LOAD EARTH DELIVERY';
      if (!s.sampleSite.collected && s.sampleDistance(pos.x, pos.z) < s.sampleSite.radius) return 'E — COLLECT SAMPLES';
      if (s.vehicleMode === 'rover') {
        if (s.shuttleDistance(pos.x, pos.z) < SHUTTLE_RANGE) return 'E — BOARD SHUTTLE';
        if (Math.abs(s.roverState.speed) < 1.5) return 'E — EVA (ON FOOT)';
        return 'STOP TO EVA — W drive · A/D steer · B brake';
      }
      if (s.vehicleMode === 'shuttle') {
        if (s.roverDistance(pos.x, pos.z) < SHUTTLE_RANGE) return 'E — BOARD ROVER';
        if (s.landed) return 'E — EVA (ON FOOT)  ·  W/S fly · SPACE up · climb >160 to return to orbit';
        return 'W/S fly · SPACE ascend · land near the outpost';
      }
      // on foot
      if (s.roverDistance(pos.x, pos.z) < SHUTTLE_RANGE * 0.6) return 'E — BOARD ROVER';
      if (s.shuttleDistance(pos.x, pos.z) < SHUTTLE_RANGE * 0.6) return 'E — BOARD SHUTTLE';
      return 'WASD run · SHIFT sprint · SPACE jump · E interact';
    }
    if (this.orbiting) {
      let p = 'E — LEAVE ORBIT';
      const scanned = this.gs.state.discoveries.includes(this.orbiting.id);
      p += scanned ? '  ·  L — LAND' : '  ·  L — LAND (SCAN FIRST)';
      return p;
    }
    for (const station of this.solar.stations)
      if (this.shipState.position.distanceTo(station.group.position) < station.dockRadius)
        return `E — DOCK · ${station.name}`;
    for (const an of this.solar.anomalies)
      if (!this.gs.state.anomalies.includes(an.cfg.id) && this.shipState.position.distanceTo(an.sprite.position) < 12)
        return 'E — INVESTIGATE ANOMALY';
    if (this.miningTarget) return this.mobileActive ? 'HOLD E — MINE' : 'HOLD E — MINE ASTEROID';
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
    this.hud.setMode('space');

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
      cargo: cargoUsed(this.gs.state.resources),
      cargoMax: stats.cargoCapacity,
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
    const s = this.surface;
    const satiety = this.gs.satiety;
    const alt = s.altitude;
    const vspeed = s.shipState.velocity.y;
    const mode = s.vehicleMode; // 'shuttle' | 'rover' | 'foot'
    this.hud.setMode(mode, s.cfg.name);

    // build a warning stack (fuel + hunger)
    let warn = '';
    if (mode !== 'foot' && st.fuel < stats.fuelCapacity * 0.15) warn += '⚠ FUEL LOW';
    if (satiety <= 0) warn += (warn ? '  ·  ' : '') + '⚠ STARVING — eat at the outpost';
    else if (satiety < ECONOMY.surface.hungerWarnAt) warn += (warn ? '  ·  ' : '') + '⚠ HUNGRY — eat at the outpost';

    let action = null;
    if (this.repairJob) action = { title: 'REPAIRING ROVER…', p: Math.min(1, this.repairJob.t / this.repairJob.dur) };

    let vehicleLabel, distText, speedText;
    if (mode === 'rover') {
      vehicleLabel = 'ROVER';
      distText = `CELL ${Math.round(st.energy)}% · TERRAIN HUG`;
      speedText = formatSpeed(s.roverState.speed * 4);
    } else if (mode === 'foot') {
      vehicleLabel = 'ON FOOT (EVA)';
      distText = `GRAVITY ${(s.gravAccel).toFixed(2)} · JUMP SPACE`;
      speedText = s.footState.velocity.length().toFixed(1) + ' M/S' + (s.footState.grounded ? '' : ' · AIRBORNE');
    } else {
      vehicleLabel = s.landed ? 'SHUTTLE — GROUNDED' : 'SHUTTLE — AIRBORNE';
      distText = `ALT ${Math.max(0, alt).toFixed(0)} · VS ${vspeed.toFixed(1)}`;
      speedText = formatSpeed(s.shipState.speed * 4);
    }

    this.hud.update({
      fuel: st.fuel, fuelMax: stats.fuelCapacity,
      shield: st.shield, shieldMax: stats.shieldMax,
      energy: st.energy, energyMax: 100,
      hull: st.hull, hullMax: 100,
      satiety: satiety / 100,
      cargo: cargoUsed(this.gs.state.resources),
      cargoMax: stats.cargoCapacity,
      credits: this.gs.credits,
      level: this.gs.level(),
      clock: this.time.dateString(),
      timeSpeed: this.time.speed,
      warning: warn,
      mission: null,
      prompt: this._currentPrompt(),
      action,
      target: {
        name: `${s.cfg.name} · ${vehicleLabel}`,
        dist: distText
      },
      speed: speedText,
      speedLabel: mode === 'foot' ? 'GROUND SPD' : 'SPEED'
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
  applySettings(patch, opts = {}) {
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
    if (patch.mobileControls !== undefined) this._syncMobileControls();
    if (patch.streaming !== undefined) this.surface?.streamer?.setQuality(s.streaming);

    // Settings live on their own storage key, so they persist even when there
    // is no career yet and survive starting a new one.
    this.gs.saveSettings();
    if (this.mode !== 'menu' && this.mode !== 'loading') this.gs.save(this.shipSnapshot());

    // Mirror to the account when cloud sync is on.
    if (!opts.skipCloud && s.cloudSync && this.backend?.signedIn) {
      this.backend.pushSettings(s).catch((e) => console.warn('settings sync', e));
    }
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
    this._syncMobileMode();
    this.toasts.show('GRAPHICS', `Quality: ${this.quality.toUpperCase()}`, 'info', 2000);
  }

  /** Every body/station the ship could sensibly be parked next to. */
  _anchorList() {
    const list = [];
    for (const st of this.solar?.stations || []) list.push({ id: st.id, position: st.group.position });
    for (const [id, body] of this.solar?.planets || []) list.push({ id, position: body.group.position });
    return list;
  }

  shipSnapshot() {
    const st = this.shipState;
    // Positions are saved RELATIVE to the nearest body (see SpawnSafety):
    // planets orbit, so absolute coordinates rot and used to strand reloaded
    // players in deep space — or, at the origin, inside the Sun.
    const anchored = anchoredPosition(st.position, this._anchorList());
    return {
      position: st.position.toArray(),   // legacy field, kept for old clients
      anchor: anchored.anchor,
      offset: anchored.offset,
      quaternion: st.quaternion.toArray(),
      fuel: st.fuel, energy: st.energy, shield: st.shield, hull: st.hull,
      lastStation: st.lastStation
    };
  }

  /** Human-readable "where am I" used in the careers list. */
  currentLocation() {
    if (this.mode === 'surface' && this.surface) return (this.surface.cfg?.name || 'Surface') + ' surface';
    if (this.mode === 'launch') return 'Launch pad';
    if (this.modalOpen === 'docked' && this.dockingStation) return this.dockingStation.name;
    if (this.orbiting) return (this.orbiting.cfg?.name || 'Planet') + ' orbit';
    if (this.target) return 'En route to ' + this.target.name;
    return 'Deep space';
  }

  saveGame(manual) {
    if (!this.gs.canSave) { if (manual) this.toasts.show('SAVE', 'Storage unavailable in this browser.', 'warn'); return; }
    const ok = this.gs.save(this.shipSnapshot(), {
      name: this.gs.state.careerName || SaveSystem.meta(this.gs.slot)?.name || (this.identity?.name + "'s career"),
      location: this.currentLocation()
    });
    // Cloud mirror (fire-and-forget — never blocks or breaks local saving).
    if (ok && this.gs.state.settings.cloudSync && this.backend?.signedIn) {
      this.backend.pushSave(this.gs.slot, SaveSystem.meta(this.gs.slot)?.name || 'Career', this.gs.state, {
        playTime: this.gs.state.playTime, credits: this.gs.credits, level: this.gs.level()
      }).catch(() => {});
    }
    if (manual) this.toasts.show(ok ? 'GAME SAVED' : 'SAVE FAILED',
      ok ? (this.gs.state.settings.cloudSync && this.backend?.signedIn ? 'Progress stored locally and in the cloud.' : 'Progress stored in this browser.')
         : 'Storage error.', ok ? 'success' : 'warn', 2200);
  }


  // ================================================================ BACK / ESC
  /**
   * One place that decides what "go back" means. Used by ESC, by the Android
   * hardware Back button and by the on-screen pause button, so all three can
   * never disagree.
   * @returns true when the press was consumed.
   */
  _handleBack() {
    if (this.gs.state.settings.backPauses === false && this.mode !== 'menu') return false;
    this.syncModalState();
    if (this.modalOpen) { this.closeModal(); return true; }
    if (this.mode === 'space' || this.mode === 'surface' || this.mode === 'launch') {
      this.togglePause();
      return true;
    }
    if (this.mode === 'menu') {
      // On the main menu, Back backs out of a browser tab first.
      if (this.menu.tab !== 'saves') { this.menu.selectTab('saves'); return true; }
      return false; // let the browser leave the page
    }
    return true;
  }

  // ================================================================ ACCOUNT
  accountInfo() {
    return {
      name: this.backend.signedIn ? this.backend.handle : this.identity.name,
      online: this.backend.signedIn,
      connected: this.backend.configured,
      mode: this.backend.signedIn ? 'account' : 'guest'
    };
  }

  openAccount() {
    this.accountPanel.show();
    this.modalOpen = 'account';
  }

  async _onAccountChanged() {
    if (!this.backend.signedIn) return;
    // Pull cloud settings (they win — that's the point of syncing) and
    // announce any cloud careers the player can restore.
    try {
      const remote = await this.backend.pullSettings();
      if (remote) {
        this.applySettings(remote, { silent: true, skipCloud: true });
        this.toasts.show('SETTINGS SYNCED', 'Your preferences were restored from your account.', 'info', 3000);
      }
      const saves = await this.backend.listSaves();
      if (saves.length) {
        this.toasts.show('CLOUD SAVES', `${saves.length} career${saves.length > 1 ? 's' : ''} available in your account.`, 'info', 4000);
      }
      this.backend.setPresence(null, 'online', 'Main menu').catch(() => {});
    } catch (e) { console.warn('account sync', e); }
  }

  // ================================================================ CAREERS
  loadSlot(slot) {
    this.gs.slot = slot;
    SaveSystem.setActiveSlot(slot);
    this.continueGame();
  }

  deleteSlot(slot) {
    SaveSystem.reset(slot);
    if (this.backend.signedIn) this.backend.deleteSave(slot).catch(() => {});
    this.toasts.show('CAREER DELETED', 'That save slot is now empty.', 'info', 2200);
    this.menu.renderSaves();
    this.menu.refreshPlayLabel();
  }

  async syncSlot(slot) {
    if (!this.backend.signedIn) {
      this.toasts.show('CLOUD SYNC', 'Sign in first — ACCOUNT → SIGN IN. Guest careers stay in this browser.', 'warn', 4500);
      return;
    }
    const data = SaveSystem.load(slot);
    const meta = SaveSystem.meta(slot);
    if (!data) return;
    try {
      await this.backend.pushSave(slot, meta?.name || `Career ${slot + 1}`, data, {
        playTime: data.playTime, credits: data.credits, level: meta?.level || 1
      });
      this.toasts.show('UPLOADED', `"${meta?.name || 'Career'}" is safe in the cloud.`, 'success');
    } catch (e) {
      this.toasts.show('SYNC FAILED', e.message, 'warn', 4000);
    }
  }

  async syncAllSaves() {
    for (const s of SaveSystem.listSlots()) await this.syncSlot(s.slot);
  }

  exportSlot(slot) {
    const json = SaveSystem.exportSlot(slot);
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'solar-odyssey-career-' + (slot + 1) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.toasts.show('EXPORTED', 'Career file downloaded.', 'success');
  }

  importSaveFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const slot = SaveSystem.importSlot(String(r.result));
          this.toasts.show('IMPORTED', 'Career restored into slot ' + (slot + 1) + '.', 'success');
          this.menu.renderSaves();
          this.menu.refreshPlayLabel();
        } catch (e) {
          this.toasts.show('IMPORT FAILED', e.message, 'warn', 4000);
        }
      };
      r.readAsText(f);
    });
    input.click();
  }

  // ================================================================ SERVERS
  /** Guess the player's region from their timezone — no IP lookup needed. */
  detectRegion() {
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* older browsers */ }
    const off = -new Date().getTimezoneOffset() / 60;
    if (/Kolkata|Calcutta|Colombo|Karachi|Dhaka/.test(tz)) return 'ap-south';
    if (/Singapore|Bangkok|Jakarta|Kuala/.test(tz)) return 'ap-south-east';
    if (/Tokyo|Seoul|Shanghai|Hong_Kong|Taipei/.test(tz)) return 'ap-north-east';
    if (/Sydney|Melbourne|Auckland|Brisbane/.test(tz)) return 'ap-southeast-2';
    if (/London|Dublin|Lisbon/.test(tz)) return 'eu-west';
    if (/Berlin|Paris|Madrid|Rome|Warsaw|Amsterdam|Stockholm/.test(tz)) return 'eu-central';
    if (/New_York|Toronto|Chicago|Bogota|Lima/.test(tz)) return 'us-east';
    if (/Los_Angeles|Denver|Vancouver|Phoenix/.test(tz)) return 'us-west';
    if (/Sao_Paulo|Buenos_Aires|Santiago/.test(tz)) return 'sa-east';
    if (off >= 4 && off <= 6.5) return 'ap-south';
    if (off >= 7 && off <= 9) return 'ap-north-east';
    if (off >= -1 && off <= 3) return 'eu-central';
    if (off <= -4 && off >= -6) return 'us-east';
    if (off <= -7) return 'us-west';
    return 'eu-west';
  }

  async listServers(region) {
    const want = !region || region === 'auto' ? this.detectRegion() : region;
    if (!this.backend.configured) {
      // Offline: still show the regional gateways so the browser is not a dead
      // screen, flagged as unreachable.
      return this._offlineServers(want);
    }
    try {
      const rows = await this.backend.listServers(region === 'all' ? 'all' : want);
      const list = rows.length ? rows : await this.backend.listServers('all');
      return list.map(s => ({ ...s, ping: this._estimatePing(s.region, want) }));
    } catch (e) {
      return this._offlineServers(want);
    }
  }

  _offlineServers(want) {
    const REGIONS = [
      ['ap-south', 'Sol Gateway — Mumbai'], ['ap-south-east', 'Sol Gateway — Singapore'],
      ['ap-north-east', 'Sol Gateway — Tokyo'], ['ap-southeast-2', 'Sol Gateway — Sydney'],
      ['eu-central', 'Sol Gateway — Frankfurt'], ['eu-west', 'Sol Gateway — London'],
      ['us-east', 'Sol Gateway — Virginia'], ['us-west', 'Sol Gateway — Oregon'],
      ['sa-east', 'Sol Gateway — Sao Paulo']
    ];
    return REGIONS.map(([region, name]) => ({
      name, region, mode: 'coop', players: 0, capacity: 32, official: true,
      offline: true, ping: this._estimatePing(region, want)
    })).sort((a, b) => a.ping - b.ping);
  }

  /** Rough distance-based latency estimate between two regions. */
  _estimatePing(region, home) {
    if (!region) return null;
    if (region === home) return 18 + Math.round(Math.random() * 20);
    const CONT = {
      'ap-south': 'asia', 'ap-south-east': 'asia', 'ap-north-east': 'asia', 'ap-southeast-2': 'oceania',
      'eu-west': 'europe', 'eu-central': 'europe', 'us-east': 'americas', 'us-west': 'americas', 'sa-east': 'americas'
    };
    return CONT[region] === CONT[home] ? 60 + Math.round(Math.random() * 50) : 170 + Math.round(Math.random() * 120);
  }

  async joinServer(server) {
    if (server.offline || !this.backend.configured) {
      this.toasts.show('SERVER UNREACHABLE',
        'No game server is connected. ACCOUNT → CONNECT SERVER to go online — single-player works without it.', 'warn', 5200);
      return;
    }
    this.currentServer = server;
    try { await this.backend.setPresence(server.id, 'online', 'Lobby'); } catch { /* best effort */ }
    this.toasts.show('CONNECTED', `Joined ${server.name} (${server.region.toUpperCase()}).`, 'success', 3000);
    this.menu.renderServers();
  }

  async hostServer() {
    if (!this.backend.signedIn) {
      this.toasts.show('HOST', 'Sign in to host a server for your friends.', 'warn', 4000);
      return;
    }
    try {
      await this.backend.createServer({
        name: `${this.backend.handle}'s expedition`,
        region: this.detectRegion(),
        mode: 'coop', capacity: 8
      });
      this.toasts.show('SERVER HOSTED', 'Your friends can now find you in the server list.', 'success');
      this.menu.renderServers();
    } catch (e) {
      this.toasts.show('HOST FAILED', e.message, 'warn', 4000);
    }
  }

  // ================================================================ FRIENDS
  async listFriends() {
    if (!this.backend.signedIn) return null;
    try { return await this.backend.listFriends(); }
    catch (e) { throw e; }
  }
  async findFriends(query) {
    if (!query || query.trim().length < 2) {
      this.toasts.show('SEARCH', 'Type at least two characters.', 'warn', 2200);
      return;
    }
    if (!this.backend.configured) {
      this.toasts.show('SEARCH', 'Connect a server to find other commanders.', 'warn', 3600);
      return;
    }
    try {
      const people = await this.backend.findPlayers(query.trim());
      this.menu.showSearchResults(people.filter(p => p.id !== this.backend.userId));
    } catch (e) { this.toasts.show('SEARCH FAILED', e.message, 'warn'); }
  }
  async addFriend(person) {
    try {
      await this.backend.addFriend(person.id);
      this.toasts.show('REQUEST SENT', `Waiting for ${person.handle} to accept.`, 'success');
      this.menu.renderFriends();
    } catch (e) { this.toasts.show('FAILED', e.message, 'warn'); }
  }
  async acceptFriend(f) {
    try { await this.backend.acceptFriend(f.row.id); this.toasts.show('FRIEND ADDED', f.handle + ' is now on your crew list.', 'success'); this.menu.renderFriends(); }
    catch (e) { this.toasts.show('FAILED', e.message, 'warn'); }
  }
  async removeFriend(f) {
    // The RPC works on the PAIR of players, so it needs the other player's
    // user id (f.id), not the friends-row id.
    try { await this.backend.removeFriend(f.id); this.menu.renderFriends(); }
    catch (e) { this.toasts.show('FAILED', e.message, 'warn'); }
  }
  inviteFriend(f) {
    if (!this.currentServer) {
      this.toasts.show('INVITE', 'Join a server first, then invite your friends to it.', 'warn', 3600);
      return;
    }
    this.toasts.show('INVITE SENT', `${f.handle} was invited to ${this.currentServer.name}.`, 'success');
  }

  // ================================================================ ROCKETS
  openRocketBuilder() {
    if (this.mode !== 'menu' && !this.paused) this.togglePause();
    this.rocketBuilder.show();
    this.modalOpen = 'vab';
  }

  /**
   * Fly a player-built rocket off the pad at Earth. This is a full game mode:
   * the space scene stays loaded, the camera follows the ascent, and reaching
   * orbit drops the player back into normal flight in Earth orbit.
   */
  launchRocket(design, analysis) {
    this.closeModal();
    this.paused = false;
    const earth = this.solar.getBody('earth');
    if (!earth) return;
    this.gs.spend(analysis.cost);
    this.launch = new LaunchSequence(design, earth, this.scene);
    this.mode = 'launch';
    this.hud.hide();
    this.mobile.hide();
    if (this.shipVisual) this.shipVisual.group.visible = false;
    if (this.trail) this.trail.line.visible = false;
    this.menu.hideMain();
    this.menu.hidePause();
    this._buildLaunchHUD();
    this.toasts.show('LAUNCH SEQUENCE', `${design.name} is on the pad. T-minus 5.`, 'info', 4000);
  }

  _buildLaunchHUD() {
    if (!this.launchHUD) {
      this.launchHUD = el('div', 'launch-hud');
      this.launchHUD.innerHTML = `
        <div class="lh-top"><div class="lh-count"></div><div class="lh-phase"></div></div>
        <div class="lh-stats">
          <div><span>ALT</span><b class="lh-alt">0 km</b></div>
          <div><span>SPEED</span><b class="lh-speed">0 m/s</b></div>
          <div><span>STAGE</span><b class="lh-stage">1/1</b></div>
          <div><span>Δv</span><b class="lh-dv">0</b></div>
        </div>
        <div class="lh-fuel"><div class="lh-fuel-fill"></div></div>
        <div class="lh-log"></div>
        <button class="btn btn-danger lh-abort">ABORT</button>`;
      this.root.appendChild(this.launchHUD);
      this.launchHUD.querySelector('.lh-abort').addEventListener('click', () => this._endLaunch(false, 'Launch aborted by flight control.'));
    }
    this.launchHUD.classList.remove('hidden');
  }

  _updateLaunch(dt) {
    if (!this.launch) return;
    const phase = this.launch.update(dt);
    this.launch.cameraFor(this.camera);
    const t = this.launch.telemetry();

    const h = this.launchHUD;
    if (h) {
      h.querySelector('.lh-count').textContent = phase === 'countdown' ? 'T−' + t.countdown : 'T+' + Math.round(this.launch.t);
      h.querySelector('.lh-phase').textContent = ({
        countdown: 'HOLDING ON THE PAD', liftoff: 'ASCENT', gravityturn: 'GRAVITY TURN',
        coast: 'CIRCULARISATION BURN', orbit: 'ORBIT ACHIEVED', failed: 'FLIGHT FAILURE'
      })[phase] || phase.toUpperCase();
      h.querySelector('.lh-alt').textContent = t.altitudeKm.toLocaleString() + ' km';
      h.querySelector('.lh-speed').textContent = t.speed.toLocaleString() + ' m/s';
      h.querySelector('.lh-stage').textContent = t.stage + '/' + t.stages;
      h.querySelector('.lh-dv').textContent = t.deltaV.toLocaleString();
      h.querySelector('.lh-fuel-fill').style.width = (t.fuelPct * 100).toFixed(0) + '%';
      const last = t.events[t.events.length - 1];
      h.querySelector('.lh-log').textContent = last ? last.msg : '';
    }

    // engine roar + flame while burning
    const burning = phase === 'liftoff' || phase === 'gravityturn' || phase === 'coast';
    this.audio.setEngine(burning ? 1 : 0, burning);
    this.launch.mesh.setFlame?.(this.launch.stageIndex, burning ? 1 : 0);
    if (burning && this.effects) {
      this.effects.thrust?.(this.launch.group.position, new THREE.Vector3(0, -1, 0), true);
    }

    if (phase === 'orbit') this._endLaunch(true);
    else if (phase === 'failed') this._endLaunch(false, this.launch.failReason);
  }

  _endLaunch(success, reason) {
    if (!this.launch || this._endingLaunch) return;
    this._endingLaunch = true;
    const design = this.launch.design;
    const analysis = this.launch.analysis;
    this.audio.setEngine(0, false);
    this._fade(true, () => {
      this.launch?.dispose();
      this.launch = null;
      this.launchHUD?.classList.add('hidden');
      this.mode = 'space';
      const earth = this.solar.getBody('earth');
      if (success) {
        // Park the ship in Earth orbit and bank the rewards.
        const r = earth.radius * 3.2;
        this.shipState.position.copy(earth.group.position).add(new THREE.Vector3(r, 0, 0));
        this.shipState.velocity.set(0, 0, 0);
        this.trail.clear(this.shipState.position);
        this.enterOrbit?.(earth);
        const payout = Math.round(analysis.cost * 0.6 + analysis.science * 40 + analysis.crew * 250);
        this.gs.addCredits(payout);
        this.gs.addXP(150 + analysis.science * 5);
        this.gs.award('rocketeer');
        this.gs.state.rockets ||= { designs: [], active: null, built: [] };
        this.gs.state.rockets.built.push({ name: design.name, at: Date.now(), reach: analysis.reach });
        this.toasts.show('ORBIT ACHIEVED',
          `${design.name} is in orbit. Mission payout +${payout.toLocaleString()} CR.`, 'success', 6000);
        this.audio.levelUp();
        // First orbit unlocks the rest of the game: now go land somewhere.
        if (this.gs.state.careerStage === 'first-launch') {
          this.gs.state.careerStage = 'explore';
          setTimeout(() => this.toasts.show('NEXT OBJECTIVE',
            'You are in orbit. Target a world (T), fly to it, SCAN it (R), enter orbit (E) and press L to LAND.',
            'info', 9000), 6200);
        }
      } else {
        this._spawnShip(false);
        this.toasts.show('FLIGHT FAILURE', reason || 'The vehicle was lost.', 'warn', 6500);
      }
      this.hud.show();
      this._enterPlay();
      this._endingLaunch = false;
      setTimeout(() => this._fade(false), 120);
    });
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
  return ({ iron: 'Iron', nickel: 'Nickel', water: 'Water', ice: 'Ice', food: 'Food', parts: 'Spare Parts', rare: 'Rare Minerals' })[k] || k;
}
