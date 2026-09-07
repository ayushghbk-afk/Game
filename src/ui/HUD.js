// HUD — bars, target info, reticle, prompts, scan/mining progress, warnings.
import { el, makeBar } from '../utils/UI.js';
import { formatNumber } from '../utils/Noise.js';

export class HUD {
  constructor(root, actions) {
    this.root = el('div', 'hud hidden');
    this.actions = actions;
    this.root.innerHTML = `
      <div class="hud-top-left">
        <div id="hud-bars"></div>
        <div class="hud-credits">
          <span id="hud-credits-val">0</span> CR
          <span class="hud-level" id="hud-level">LV 1</span>
        </div>
      </div>
      <div class="hud-top-center">
        <div class="hud-clock" id="hud-clock">2087.03.14 06:00</div>
        <div class="hud-timewarp" id="hud-warp">1× TIME</div>
        <div class="hud-warning" id="hud-warning"></div>
      </div>
      <div class="hud-top-right">
        <button class="hud-btn" id="hud-btn-map">MAP</button>
        <button class="hud-btn" id="hud-btn-scan">SCAN</button>
        <button class="hud-btn" id="hud-btn-missions">MISSIONS</button>
        <button class="hud-btn" id="hud-btn-codex">CODEX</button>
      </div>
      <div class="hud-reticle">
        <div class="reticle-ring"></div>
        <div class="reticle-dot"></div>
      </div>
      <div class="hud-target-marker hidden" id="hud-target-marker">
        <div class="marker-brackets"></div>
        <div class="marker-label" id="hud-marker-label"></div>
      </div>
      <div class="hud-bottom">
        <div class="hud-mission" id="hud-mission"></div>
        <div class="hud-prompt hidden" id="hud-prompt"></div>
        <div class="hud-action-progress hidden" id="hud-action-progress">
          <div class="ap-title" id="hud-ap-title">SCANNING…</div>
          <div class="ap-bar"><div class="ap-fill" id="hud-ap-fill"></div></div>
        </div>
        <div class="hud-target-info" id="hud-target-info">
          <span class="ti-label">NO TARGET</span>
        </div>
        <div class="hud-speed" id="hud-speed"></div>
      </div>`;
    root.appendChild(this.root);

    const bars = this.root.querySelector('#hud-bars');
    this.bars = {
      fuel: makeBar('FUEL', 'c-fuel'),
      shield: makeBar('SHIELD', 'c-shield'),
      energy: makeBar('ENERGY', 'c-energy'),
      hull: makeBar('HULL', 'c-hull'),
      satiety: makeBar('FOOD', 'c-food')
    };
    this.bars.satiety.set(0); // keep a finite inline width even while hidden
    this.bars.satiety.root.classList.add('hidden');
    Object.values(this.bars).forEach(b => bars.appendChild(b.root));

    this.credits = this.root.querySelector('#hud-credits-val');
    this.level = this.root.querySelector('#hud-level');
    this.clock = this.root.querySelector('#hud-clock');
    this.warpLabel = this.root.querySelector('#hud-warp');
    this.warning = this.root.querySelector('#hud-warning');
    this.mission = this.root.querySelector('#hud-mission');
    this.prompt = this.root.querySelector('#hud-prompt');
    this.actionProgress = this.root.querySelector('#hud-action-progress');
    this.apTitle = this.root.querySelector('#hud-ap-title');
    this.apFill = this.root.querySelector('#hud-ap-fill');
    this.targetInfo = this.root.querySelector('#hud-target-info');
    this.speed = this.root.querySelector('#hud-speed');
    this.marker = this.root.querySelector('#hud-target-marker');
    this.markerLabel = this.root.querySelector('#hud-marker-label');

    const bind = (id, fn) => this.root.querySelector(id).addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    bind('#hud-btn-map', actions.map);
    bind('#hud-btn-scan', actions.scan);
    bind('#hud-btn-missions', actions.missions);
    bind('#hud-btn-codex', actions.codex);

    this._warnAcc = 0;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  /** @param d data snapshot — called every frame (cheap string writes only when changed) */
  update(d) {
    this.bars.fuel.set(d.fuel / d.fuelMax);
    this.bars.shield.set(d.shield / d.shieldMax);
    this.bars.energy.set(d.energy / d.energyMax);
    this.bars.hull.set(d.hull / d.hullMax);
    // astronaut satiety — only visible on a planetary surface
    if (d.satiety !== undefined) {
      this.bars.satiety.root.classList.remove('hidden');
      this.bars.satiety.set(d.satiety);
    } else {
      this.bars.satiety.root.classList.add('hidden');
    }
    if (this._credits !== d.credits) { this._credits = d.credits; this.credits.textContent = formatNumber(d.credits); }
    if (this._level !== d.level) { this._level = d.level; this.level.textContent = 'LV ' + d.level; }
    if (this._clock !== d.clock) { this._clock = d.clock; this.clock.textContent = d.clock; }
    if (this._warp !== d.timeSpeed) {
      this._warp = d.timeSpeed;
      this.warpLabel.textContent = d.timeSpeed + '× TIME';
    }

    // warnings
    let warn = d.warning || '';
    if (warn && this._warn !== warn) { this._warn = warn; this.warning.textContent = warn; this.warning.classList.add('on'); }
    else if (!warn && this._warn) { this._warn = ''; this.warning.classList.remove('on'); }
    this._warnAcc += 1;

    // mission tracker
    const mText = d.mission ? `▸ ${d.mission.name}: ${d.mission.progressText}` : '';
    if (this._mission !== mText) { this._mission = mText; this.mission.textContent = mText; }

    // prompt
    if (this._prompt !== d.prompt) {
      this._prompt = d.prompt;
      if (d.prompt) { this.prompt.textContent = d.prompt; this.prompt.classList.remove('hidden'); }
      else this.prompt.classList.add('hidden');
    }

    // scan / mining progress bar
    if (d.action) {
      this.actionProgress.classList.remove('hidden');
      this.apTitle.textContent = d.action.title;
      this.apFill.style.width = (d.action.p * 100).toFixed(1) + '%';
    } else this.actionProgress.classList.add('hidden');

    // target info
    const ti = d.target
      ? `TARGET: <b>${d.target.name}</b>&nbsp;&nbsp;DIST: <b>${d.target.dist}</b>`
      : '<span class="ti-label">NO TARGET — press T</span>';
    if (this._ti !== ti) { this._ti = ti; this.targetInfo.innerHTML = ti; }
    const sp = `SPEED: <b>${d.speed}</b>`;
    if (this._sp !== sp) { this._sp = sp; this.speed.innerHTML = sp; }
  }

  /** Screen-space target marker. project = world→NDC or null if behind. */
  updateMarker(x, y, visible, label) {
    if (!visible) { this.marker.classList.add('hidden'); return; }
    this.marker.classList.remove('hidden');
    this.marker.style.transform = `translate(${x}px, ${y}px)`;
    if (this._ml !== label) { this._ml = label; this.markerLabel.textContent = label; }
  }
}
