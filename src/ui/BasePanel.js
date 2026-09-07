// BasePanel — planetary OUTPOST services. This is the habitat the
// astronaut lives in after landing: rest (restore energy), eat food to
// recover satiety, run station-maintenance jobs for credits, and manage
// the surface rover. Docking with the outpost auto-saves the game.
import { el, clearChildren, makeModal } from '../utils/UI.js';
import { ECONOMY } from '../config.js';
import { cargoUsed } from '../world/Resources.js';

export class BasePanel {
  constructor(root, hooks) {
    this.hooks = hooks; // {gs, onRest, onEat, onMaintain, onRover, onLeave, sound}
    const m = makeModal('base-modal', 'OUTPOST');
    this.modal = m;
    root.appendChild(m.root);
    this.content = el('div', 'base-content');
    m.body.appendChild(this.content);
    this.leaveBtn = el('button', 'btn btn-primary base-leave', 'LEAVE OUTPOST');
    this.leaveBtn.addEventListener('click', () => hooks.onLeave());
    m.body.appendChild(this.leaveBtn);
  }

  show(name, vehicleMode) {
    this.modal.head.querySelector('.modal-title').textContent = name || 'PLANETARY OUTPOST';
    this.vehicleMode = vehicleMode;
    this.modal.root.classList.remove('hidden');
    this.render();
  }
  hide() { this.modal.root.classList.add('hidden'); }
  get visible() { return !this.modal.root.classList.contains('hidden'); }

  render() {
    const gs = this.hooks.gs;
    clearChildren(this.content);
    const s = ECONOMY.surface;
    const sat = Math.round(gs.satiety);
    const foods = gs.foodCount();
    const parts = gs.state.resources.parts || 0;

    const head = el('div', 'base-head');
    head.appendChild(el('span', '', `CREDITS: <b>${gs.credits.toLocaleString()}</b>`));
    head.appendChild(el('span', '', `SATIETY: <b>${sat}%</b>`));
    head.appendChild(el('span', '', `FOOD: <b>${foods}</b>`));
    head.appendChild(el('span', '', `PARTS: <b>${parts}</b>`));
    this.content.appendChild(head);

    const wrap = el('div', 'base-cards');

    // ---- LIVE / REST ----
    const rest = this._card('LIVE / REST', 'Lie down in the habitat and let your energy regenerate. A little simulation time passes.',
      'REST', true, () => {
        this.hooks.onRest();
        this.hooks.sound?.('click');
        this.render();
      });
    wrap.appendChild(rest);

    // ---- EAT ----
    const eat = this._card('EAT FOOD', `Consume 1 food ration → +${s.satietyPerMeal} satiety. Have ${foods} ration(s).`,
      foods > 0 ? `EAT (${foods})` : 'NO FOOD', foods > 0,
      () => { this.hooks.onEat(); this.hooks.sound?.('click'); this.render(); });
    wrap.appendChild(eat);

    // ---- MAINTAIN STATION (job) ----
    const maintainOk = parts >= s.maintainParts;
    const maintain = this._card('MAINTAIN STATION',
      `Run a maintenance routine on the outpost — pays ${s.maintainCredits.toLocaleString()} CR · ${s.maintainXP} XP, uses ${s.maintainParts} part(s).`,
      maintainOk ? `MAINTAIN (${s.maintainCredits.toLocaleString()} CR)` : 'NEED PARTS', maintainOk,
      () => { const r = this.hooks.onMaintain(); this.hooks.sound?.('click'); if (r && r.ok) this.render(); });
    wrap.appendChild(maintain);

    // ---- ROVER ----
    const inRover = this.vehicleMode === 'rover';
    const rover = this._card('SURFACE ROVER', inRover
      ? 'You are driving the rover. Return here to park it and re-board the shuttle.'
      : 'Take the rover out to explore the terrain and find broken rovers to repair.',
      inRover ? 'PARK ROVER' : 'DRIVE ROVER', true,
      () => { this.hooks.onRover(); this.hooks.sound?.('click'); this.render(); });
    wrap.appendChild(rover);

    // ---- BROKEN ROVERS PROGRESS ----
    const rovers = typeof this.hooks.brokenRovers === 'function' ? (this.hooks.brokenRovers() || []) : (this.hooks.brokenRovers || []);
    const done = rovers.filter(r => r.fixed).length;
    const total = rovers.length;
    const job = this._card('FIELD JOBS', `${done}/${total} broken rover(s) repaired on this world. Drive out with the rover and press E to repair.`,
      `${done}/${total} FIXED`, true, () => {});
    job.classList.add('base-info');
    wrap.appendChild(job);

    // ---- maintenance cooldown note ----
    const cd = this.hooks.maintainCooldownRemaining ? this.hooks.maintainCooldownRemaining() : 0;
    if (cd > 0) wrap.appendChild(el('div', 'base-cooldown', `Station maintenance in ${Math.ceil(cd)}s…`));

    this.content.appendChild(wrap);
    this.content.appendChild(el('p', 'dim', 'Your progress auto-saves while you are at the outpost.'));
  }

  _card(title, sub, btnLabel, enabled, fn) {
    const card = el('div', 'base-card');
    card.appendChild(el('div', 'base-card-title', title));
    card.appendChild(el('div', 'base-card-sub', sub));
    const b = el('button', 'btn', btnLabel);
    if (!enabled) b.disabled = true;
    b.addEventListener('click', () => { fn(); });
    card.appendChild(b);
    return card;
  }
}
