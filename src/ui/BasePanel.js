// BasePanel — planetary OUTPOST services. This is the habitat the
// astronaut lives in after landing: rest (restore energy), eat food to
// recover satiety, run station-maintenance jobs for credits, manage
// the surface rover, step OUT ON FOOT (EVA), and use the SUPPLY LINE to
// order spare parts / food / minerals from EARTH (paid transit that
// lands a pick-up crate near the outpost).
// Docking with the outpost auto-saves the game.
import { el, clearChildren, makeModal } from '../utils/UI.js';
import { ECONOMY } from '../config.js';
import { cargoUsed } from '../world/Resources.js';

export class BasePanel {
  constructor(root, hooks) {
    this.hooks = hooks; // {gs, onRest, onEat, onMaintain, onRover, onEva, onLeave, sound,
                        //  brokenRovers, maintainCooldownRemaining, getOrders, supplyQuote}
    const m = makeModal('base-modal', 'OUTPOST');
    this.modal = m;
    root.appendChild(m.root);
    this.content = el('div', 'base-content');
    m.body.appendChild(this.content);
    this.leaveBtn = el('button', 'btn btn-primary base-leave', 'LEAVE OUTPOST');
    this.leaveBtn.addEventListener('click', () => hooks.onLeave());
    m.body.appendChild(this.leaveBtn);
    this._lastRender = 0;
  }

  show(name, vehicleMode) {
    this.modal.head.querySelector('.modal-title').textContent = name || 'PLANETARY OUTPOST';
    this.vehicleMode = vehicleMode;
    this.modal.root.classList.remove('hidden');
    this.render();
  }
  hide() { this.modal.root.classList.add('hidden'); }
  get visible() { return !this.modal.root.classList.contains('hidden'); }

  /** Throttled re-render (called from the game loop while open) so supply
   *  line countdowns tick live. */
  tick(nowMs) {
    if (!this.visible) return;
    if (nowMs - this._lastRender < 500) return;
    this._lastRender = nowMs;
    this.render();
  }

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
    head.appendChild(el('span', '', `CARGO: <b>${cargoUsed(gs.state.resources)}/${gs.cargoCapacity()}</b>`));
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

    // ---- EVA / ON FOOT ----
    const onFoot = this.vehicleMode === 'foot';
    const eva = this._card('EVA — ON FOOT', onFoot
      ? 'You are walking the surface in your suit (WASD run, Space jump). Board your shuttle when you are done.'
      : 'Step out of your vehicle and walk the surface: RUN with WASD, SPRINT with Shift, JUMP with Space. Find supply caches on foot.',
      onFoot ? 'BOARD SHUTTLE' : 'GO ON FOOT', true,
      () => { this.hooks.onEva?.(); this.hooks.sound?.('click'); this.render(); });
    wrap.appendChild(eva);

    // ---- SUPPLY LINE: ORDER FROM EARTH ----
    if (typeof this.hooks.getOrders === 'function') {
      const supply = this._card('SUPPLY LINE — ORDER FROM EARTH',
        'Earth logistics will ship a crate to this outpost. Cost & transit time scale with distance — transit runs on sim time (time warp speeds it up).',
        null, true, null);
      supply.classList.add('base-supply');
      const grid = el('div', 'supply-grid');
      for (const it of ECONOMY.surface.supplyLine.items) {
        const q = this.hooks.supplyQuote?.(it.id, it.qty) || null;
        const cell = el('div', 'supply-cell');
        cell.appendChild(el('div', 'supply-item', `${it.name} ×${it.qty}`));
        if (q) cell.appendChild(el('div', 'supply-cost', `${q.cost.toLocaleString()} CR · ETA ${q.etaText}`));
        const b = el('button', 'btn btn-tiny', q && gs.credits >= q.cost ? 'ORDER' : 'TOO POOR');
        if (!q || gs.credits < q.cost) b.disabled = true;
        b.addEventListener('click', () => { this.hooks.orderItem?.(it.id, it.qty); this.hooks.sound?.('click'); this.render(); });
        cell.appendChild(b);
        grid.appendChild(cell);
      }
      supply.appendChild(grid);
      // in-transit orders for THIS outpost
      const orders = this.hooks.getOrders() || [];
      if (orders.length) {
        const list = el('div', 'supply-orders');
        for (const o of orders) {
          if (o.taken) continue;
          const remain = Math.max(0, o.dueAt - (o.now || 0));
          const mins = Math.floor(remain / 60), secs = Math.round(remain % 60);
          const row = el('div', 'supply-order-row');
          row.appendChild(el('span', '', o.delivered
            ? `📦 ${o.item.toUpperCase()} ×${o.qty} — CRATE ON THE GROUND (E to load)`
            : `🚚 ${o.item.toUpperCase()} ×${o.qty} — in transit from Earth, arrives in ${mins}m ${secs}s (game time)`));
          list.appendChild(row);
        }
        supply.appendChild(list);
      }
      wrap.appendChild(supply);
    }

    // ---- BROKEN ROVERS PROGRESS ----
    const rovers = typeof this.hooks.brokenRovers === 'function' ? (this.hooks.brokenRovers() || []) : (this.hooks.brokenRovers || []);
    const done = rovers.filter(r => r.fixed).length;
    const total = rovers.length;
    const job = this._card('FIELD JOBS', total
      ? `${done}/${total} broken rover(s) repaired on this world. Drive out with the rover and press E to repair.`
      : 'No broken rovers reported on this world (cloud deck). Supply caches still hide spare parts.',
      total ? `${done}/${total} FIXED` : '0/0', true, () => {});
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
    if (btnLabel) {
      const b = el('button', 'btn', btnLabel);
      if (!enabled) b.disabled = true;
      b.addEventListener('click', () => { fn(); });
      card.appendChild(b);
    }
    return card;
  }
}
