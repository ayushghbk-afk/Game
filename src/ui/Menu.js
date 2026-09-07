// Menu — main menu, pause overlay, settings, help, missions & ship panels.
import { el, clearChildren, makeModal } from '../utils/UI.js';
import { MISSIONS } from '../missions/MissionData.js';
import { UPGRADES, QUALITY, LEVELS } from '../config.js';
import { shipStats } from '../spacecraft/ShipUpgrades.js';
import { hasStorage } from '../save/SaveSystem.js';

export class Menu {
  constructor(root, actions, gs) {
    this.gs = gs;
    this.actions = actions; // {play, newGame, missions, ship, codex, settingsChanged, help, save, quitToMenu}
    this.overlay = el('div', 'main-menu');
    this.overlay.innerHTML = `
      <div class="menu-inner">
        <div class="menu-subtitle">DEEP SPACE EXPLORATION PROGRAM</div>
        <h1 class="menu-title">SOLAR<br><span>ODYSSEY</span></h1>
        <nav class="menu-nav">
          <button class="menu-btn primary" id="mm-play">▶ LAUNCH</button>
          <button class="menu-btn" id="mm-new">NEW GAME</button>
          <button class="menu-btn" id="mm-missions">MISSIONS</button>
          <button class="menu-btn" id="mm-ship">SHIP</button>
          <button class="menu-btn" id="mm-codex">CODEX</button>
          <button class="menu-btn" id="mm-settings">SETTINGS</button>
          <button class="menu-btn" id="mm-help">HELP</button>
        </nav>
        <div class="menu-footer">${hasStorage ? '' : '⚠ storage unavailable — progress will not persist'} · v1.0</div>
      </div>`;
    root.appendChild(this.overlay);

    this.overlay.querySelector('#mm-play').addEventListener('click', actions.play);
    this.overlay.querySelector('#mm-new').addEventListener('click', () => this._confirmNewGame());
    this.overlay.querySelector('#mm-missions').addEventListener('click', () => { this.showMissions(); });
    this.overlay.querySelector('#mm-ship').addEventListener('click', () => { this.showShip(); });
    this.overlay.querySelector('#mm-codex').addEventListener('click', actions.codex);
    this.overlay.querySelector('#mm-settings').addEventListener('click', () => { this.showSettings(); });
    this.overlay.querySelector('#mm-help').addEventListener('click', () => { this.showHelp(); });

    // pause overlay
    this.pause = el('div', 'pause-overlay hidden');
    this.pause.innerHTML = `
      <div class="pause-inner">
        <div class="pause-title">PAUSED</div>
        <button class="menu-btn primary" id="pz-resume">RESUME</button>
        <button class="menu-btn" id="pz-save">SAVE GAME</button>
        <button class="menu-btn" id="pz-settings">SETTINGS</button>
        <button class="menu-btn" id="pz-help">HELP</button>
        <button class="menu-btn" id="pz-quit">QUIT TO MENU</button>
      </div>`;
    root.appendChild(this.pause);
    this.pause.querySelector('#pz-resume').addEventListener('click', actions.resume);
    this.pause.querySelector('#pz-save').addEventListener('click', actions.save);
    this.pause.querySelector('#pz-settings').addEventListener('click', () => { this.showSettings(); });
    this.pause.querySelector('#pz-help').addEventListener('click', () => { this.showHelp(); });
    this.pause.querySelector('#pz-quit').addEventListener('click', actions.quitToMenu);

    this._buildModals(root);
  }

  _buildModals(root) {
    this.missionsModal = makeModal('missions-modal', 'MISSION LOG');
    this.shipModal = makeModal('ship-modal', 'SHIP SYSTEMS');
    this.settingsModal = makeModal('settings-modal', 'SETTINGS');
    this.helpModal = makeModal('help-modal', 'FLIGHT MANUAL');
    this.confirmModal = makeModal('confirm-modal', 'CONFIRM');
    for (const m of [this.missionsModal, this.shipModal, this.settingsModal, this.helpModal, this.confirmModal])
      root.appendChild(m.root);
  }

  // ---- main menu visibility ----
  showMain() { this.overlay.classList.remove('hidden'); this.pause.classList.add('hidden'); this.refreshPlayLabel(); }
  hideMain() { this.overlay.classList.add('hidden'); }
  showPause() { this.pause.classList.remove('hidden'); }
  hidePause() { this.pause.classList.add('hidden'); }

  refreshPlayLabel() {
    const has = hasStorage && !!this.gs.state.ship;
    const btn = this.overlay.querySelector('#mm-play');
    btn.innerHTML = has ? '▶ CONTINUE' : '▶ LAUNCH';
  }

  _confirmNewGame() {
    const m = this.confirmModal;
    m.body.innerHTML = '';
    m.body.appendChild(el('p', '', hasStorage
      ? 'Start a new career? Your current save will be erased.'
      : 'Start a new career?'));
    const row = el('div', 'btn-row');
    const yes = el('button', 'btn btn-danger', 'NEW GAME');
    const no = el('button', 'btn', 'CANCEL');
    yes.addEventListener('click', () => { m.close(); this.actions.newGame(); });
    no.addEventListener('click', () => m.close());
    row.append(yes, no);
    m.body.appendChild(row);
    m.root.classList.remove('hidden');
  }

  // ---- MISSIONS modal ----
  showMissions() {
    const m = this.missionsModal;
    clearChildren(m.body);
    const done = this.gs.state.missions.completed;
    for (const mission of MISSIONS) {
      const isDone = done.includes(mission.id);
      const isActive = this.gs.state.missions.completed.findIndex(x => x === mission.id) === -1 &&
        MISSIONS.findIndex(x => x.id === mission.id) === done.length;
      const card = el('div', 'mission-card ' + (isDone ? 'done' : isActive ? 'active' : 'locked'));
      card.appendChild(el('div', 'mc-name', `${isDone ? '✔' : isActive ? '▸' : '·'} ${mission.name}`));
      card.appendChild(el('div', 'mc-desc', mission.desc));
      card.appendChild(el('div', 'mc-reward', `Reward: ${mission.reward.toLocaleString()} CR · ${mission.xp} XP`));
      if (isActive && mission.hint) card.appendChild(el('div', 'mc-hint', mission.hint));
      m.body.appendChild(card);
    }
    m.root.classList.remove('hidden');
  }

  // ---- SHIP modal ----
  showShip() {
    const m = this.shipModal;
    clearChildren(m.body);
    const stats = shipStats(this.gs.state.upgrades);
    const grid = el('div', 'ship-stats');
    const rows = [
      ['Engine', `MK${this.gs.state.upgrades.engine} — top speed ${stats.maxSpeed} u/s`],
      ['Fuel Tank', `MK${this.gs.state.upgrades.tank} — ${stats.fuelCapacity} units`],
      ['Shield', `MK${this.gs.state.upgrades.shield} — ${stats.shieldMax} pts`],
      ['Scanner', `MK${this.gs.state.upgrades.scanner} — range ${stats.scanRange} u`],
      ['Cargo Hold', `MK${this.gs.state.upgrades.cargo} — ${stats.cargoCapacity} units`],
      ['Credits', this.gs.credits.toLocaleString() + ' CR'],
      ['Level', `${this.gs.level()} (${this.gs.state.xp} XP)`]
    ];
    for (const [k, v] of rows) {
      grid.appendChild(el('div', 'pi-k', k));
      grid.appendChild(el('div', 'pi-v', v));
    }
    m.body.appendChild(grid);
    m.body.appendChild(el('p', 'dim', 'Upgrade your ship at any space station. Earn credits by mining asteroids and selling resources.'));
    m.root.classList.remove('hidden');
  }

  // ---- SETTINGS modal ----
  showSettings() {
    const m = this.settingsModal;
    clearChildren(m.body);
    const s = this.gs.state.settings;

    const mkRow = (label, control) => {
      const row = el('div', 'settings-row');
      row.appendChild(el('div', 'settings-label', label));
      row.appendChild(control);
      m.body.appendChild(row);
    };
    const mkSelect = (opts, val, fn) => {
      const sel = el('select', 'input');
      for (const [v, label] of opts) {
        const o = el('option', '', label);
        o.value = v;
        sel.appendChild(o);
      }
      sel.value = val;
      sel.addEventListener('change', () => fn(sel.value));
      return sel;
    };
    const mkToggle = (val, fn) => {
      const b = el('button', 'btn btn-small toggle' + (val ? ' on' : ''), val ? 'ON' : 'OFF');
      b.addEventListener('click', () => {
        const nv = !val; val = nv;
        b.textContent = nv ? 'ON' : 'OFF';
        b.classList.toggle('on', nv);
        fn(nv);
      });
      return b;
    };
    const mkSlider = (val, fn) => {
      const i = el('input', 'input');
      i.type = 'range'; i.min = 0; i.max = 1; i.step = 0.05; i.value = val;
      i.addEventListener('input', () => fn(parseFloat(i.value)));
      return i;
    };

    mkRow('Quality', mkSelect([
      ['auto', 'AUTO'], ['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH'], ['ultra', 'ULTRA']
    ], s.quality, v => this.actions.settingsChanged({ quality: v })));
    mkRow('Bloom', mkToggle(s.bloom, v => this.actions.settingsChanged({ bloom: v })));
    mkRow('Orbit lines', mkToggle(s.orbitLines, v => this.actions.settingsChanged({ orbitLines: v })));
    mkRow('Mobile controls', mkSelect([
      ['auto', 'AUTO'], ['on', 'ON'], ['off', 'OFF']
    ], s.mobileControls || 'auto', v => this.actions.settingsChanged({ mobileControls: v })));
    mkRow('FPS cap', mkSelect([['30', '30'], ['60', '60']], String(s.fpsCap), v => this.actions.settingsChanged({ fpsCap: parseInt(v) })));
    mkRow('Show FPS', mkToggle(s.showFps, v => this.actions.settingsChanged({ showFps: v })));
    mkRow('Invert Y', mkToggle(s.invertY, v => this.actions.settingsChanged({ invertY: v })));
    mkRow('Music', mkSlider(s.music, v => this.actions.settingsChanged({ music: v })));
    mkRow('Sound FX', mkSlider(s.sfx, v => this.actions.settingsChanged({ sfx: v })));

    const danger = el('div', 'btn-row');
    const reset = el('button', 'btn btn-danger', 'RESET SAVE');
    reset.addEventListener('click', () => this._confirmNewGame());
    danger.appendChild(reset);
    m.body.appendChild(danger);
    m.root.classList.remove('hidden');
  }

  // ---- HELP modal ----
  showHelp() {
    const m = this.helpModal;
    clearChildren(m.body);
    m.body.innerHTML = `
      <table class="help-table">
        <tr><td>W / S</td><td>Thrust forward / reverse</td></tr>
        <tr><td>A / D</td><td>Strafe left / right</td></tr>
        <tr><td>SPACE / CTRL</td><td>Ascend / descend</td></tr>
        <tr><td>MOUSE</td><td>Look (click canvas to capture)</td></tr>
        <tr><td>Q / X</td><td>Roll left / right</td></tr>
        <tr><td>SHIFT</td><td>Boost (uses more fuel & energy)</td></tr>
        <tr><td>B</td><td>Brake</td></tr>
        <tr><td>E</td><td>Interact — orbit · dock · mine (hold) · collect</td></tr>
        <tr><td>R</td><td>Scan targeted body</td></tr>
        <tr><td>T</td><td>Cycle target</td></tr>
        <tr><td>I</td><td>Info panel for current target</td></tr>
        <tr><td>M</td><td>Solar system map</td></tr>
        <tr><td>J</td><td>Mission log</td></tr>
        <tr><td>L</td><td>Land (when orbiting Earth / Moon / Mars)</td></tr>
        <tr><td>V</td><td>Toggle chase / free camera</td></tr>
        <tr><td>ESC</td><td>Pause</td></tr>
        <tr><td>TOUCH</td><td>On-screen joysticks & buttons — enable in Settings → Mobile controls</td></tr>
      </table>
      <p class="dim">Goal: explore, scan, mine, trade and upgrade — complete the mission chain all the way to Neptune.</p>`;
    m.root.classList.remove('hidden');
  }
}
