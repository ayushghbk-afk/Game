// DockPanel — station services: trade resources, refuel, repair,
// buy upgrades, review missions. Docking auto-saves the game.
import { el, clearChildren, makeModal } from '../utils/UI.js';
import { ECONOMY, UPGRADES } from '../config.js';
import { cargoUsed, cargoValue } from '../world/Resources.js';
import { shipStats } from '../spacecraft/ShipUpgrades.js';
import { nextUpgradeCost, upgradeTierInfo } from '../spacecraft/ShipUpgrades.js';

export class DockPanel {
  constructor(root, hooks) {
    this.hooks = hooks; // {gs, onRefuel, onRepair, onBuy, onSell, onUndock, sound}
    const m = makeModal('dock-modal', 'STATION');
    this.modal = m;
    root.appendChild(m.root);
    this.tabs = el('div', 'dock-tabs');
    this.content = el('div', 'dock-content');
    m.body.appendChild(this.tabs);
    m.body.appendChild(this.content);
    this.undockBtn = el('button', 'btn btn-primary dock-undock', 'UNDOCK');
    this.undockBtn.addEventListener('click', () => hooks.onUndock());
    m.body.appendChild(this.undockBtn);
    this.active = 'TRADE';
    for (const t of ['TRADE', 'SERVICES', 'UPGRADES']) {
      const b = el('button', 'dock-tab', t);
      b.addEventListener('click', () => { this.active = t; this.render(); });
      this.tabs.appendChild(b);
    }
  }

  show(stationName) {
    this.modal.head.querySelector('.modal-title').textContent = stationName;
    this.modal.root.classList.remove('hidden');
    this.render();
  }
  hide() { this.modal.root.classList.add('hidden'); }
  get visible() { return !this.modal.root.classList.contains('hidden'); }

  render() {
    const gs = this.hooks.gs;
    for (const b of this.tabs.children) b.classList.toggle('active', b.textContent === this.active);
    clearChildren(this.content);
    const head = el('div', 'dock-head');
    head.appendChild(el('span', '', `CREDITS: <b>${gs.credits.toLocaleString()}</b>`));
    head.appendChild(el('span', '', `CARGO: <b>${cargoUsed(gs.state.resources)} / ${gs.cargoCapacity()}</b>`));
    this.content.appendChild(head);

    if (this.active === 'TRADE') this.renderTrade();
    else if (this.active === 'SERVICES') this.renderServices();
    else this.renderUpgrades();
  }

  renderTrade() {
    const gs = this.hooks.gs;
    const grid = el('div', 'trade-grid');
    grid.appendChild(el('div', 'th', 'RESOURCE'));
    grid.appendChild(el('div', 'th', 'HELD'));
    grid.appendChild(el('div', 'th', 'UNIT PRICE'));
    grid.appendChild(el('div', 'th', 'SELL'));
    let totalValue = 0;
    for (const id in ECONOMY.resources) {
      const r = ECONOMY.resources[id];
      const have = gs.state.resources[id] || 0;
      totalValue += have * r.price;
      grid.appendChild(el('div', 'td res-name', `<span style="color:${r.color}">■</span> ${r.name}`));
      grid.appendChild(el('div', 'td', String(have)));
      grid.appendChild(el('div', 'td', r.price + ' CR'));
      const cell = el('div', 'td btn-row');
      for (const n of [1, 10, 'ALL']) {
        const b = el('button', 'btn btn-tiny', String(n));
        if (have <= 0) b.disabled = true;
        b.addEventListener('click', () => {
          const amount = n === 'ALL' ? have : Math.min(n, have);
          this.hooks.onSell(id, amount);
          this.hooks.sound?.('click');
          this.render();
        });
        cell.appendChild(b);
      }
      grid.appendChild(cell);
    }
    this.content.appendChild(grid);
    const foot = el('div', 'dock-foot', `Full cargo value: <b>${totalValue.toLocaleString()} CR</b>`);
    this.content.appendChild(foot);
  }

  renderServices() {
    const gs = this.hooks.gs;
    const stats = shipStats(gs.state.upgrades);
    const wrap = el('div', 'services');
    const mkService = (title, sub, btnLabel, enabled, fn) => {
      const card = el('div', 'service-card');
      card.appendChild(el('div', 'sc-title', title));
      card.appendChild(el('div', 'sc-sub', sub));
      const b = el('button', 'btn', btnLabel);
      if (!enabled) b.disabled = true;
      b.addEventListener('click', () => { fn(); this.hooks.sound?.('click'); this.render(); });
      card.appendChild(b);
      wrap.appendChild(card);
    };
    const ship = this.hooks.getShip ? this.hooks.getShip() : null;
    const fuelMissing = ship ? Math.ceil(stats.fuelCapacity - ship.fuel) : 0;
    const fuelCost = Math.ceil(fuelMissing * 1.5);
    mkService('REFUEL', `+${Math.max(0, fuelMissing)} units — ${fuelCost} CR`,
      fuelMissing > 0 ? `REFUEL (${fuelCost} CR)` : 'TANK FULL',
      fuelMissing > 0 && gs.credits >= fuelCost,
      () => this.hooks.onRefuel(fuelCost));
    const hullMissing = ship ? Math.ceil(100 - ship.hull) : 0;
    const hullCost = Math.ceil(hullMissing * 2);
    mkService('REPAIR HULL', `${hullMissing}% damage — ${hullCost} CR`,
      hullMissing > 0 ? `REPAIR (${hullCost} CR)` : 'HULL INTACT',
      hullMissing > 0 && gs.credits >= hullCost,
      () => this.hooks.onRepair(hullCost));
    mkService('MISSIONS', 'Review active mission chain', 'VIEW MISSIONS', true,
      () => this.hooks.onMissions());
    this.content.appendChild(wrap);
    this.content.appendChild(el('p', 'dim', 'Progress auto-saves while docked.'));
  }

  renderUpgrades() {
    const gs = this.hooks.gs;
    const stats = shipStats(gs.state.upgrades);
    for (const sysId in UPGRADES) {
      const sys = UPGRADES[sysId];
      const lvl = gs.state.upgrades[sysId];
      const cur = upgradeTierInfo(sysId, lvl);
      const cost = nextUpgradeCost(sysId, lvl);
      const card = el('div', 'upgrade-card');
      card.appendChild(el('div', 'uc-title', `${sys.icon} ${sys.name} — ${cur.name}`));
      const statsLine = Object.entries(cur).filter(([k]) => !['name', 'price'].includes(k))
        .map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(' · ');
      card.appendChild(el('div', 'uc-stats', statsLine));
      const row = el('div', 'btn-row');
      if (cost === null) {
        row.appendChild(el('span', 'uc-maxed', 'MAX LEVEL'));
      } else {
        const next = upgradeTierInfo(sysId, lvl + 1);
        const nextLine = Object.entries(next).filter(([k]) => !['name', 'price'].includes(k))
          .map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(' · ');
        card.appendChild(el('div', 'uc-next', `➜ ${next.name}: ${nextLine}`));
        const b = el('button', 'btn btn-primary', `BUY ${next.name} — ${cost.toLocaleString()} CR`);
        if (gs.credits < cost) b.disabled = true;
        b.addEventListener('click', () => {
          this.hooks.onBuy(sysId, cost);
          this.hooks.sound?.('levelup');
          this.render();
        });
        row.appendChild(b);
      }
      card.appendChild(row);
      this.content.appendChild(card);
    }
  }
}
