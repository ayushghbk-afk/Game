// Codex — in-game encyclopedia. Entries unlock as the player scans/visits.
// Tabs: PLANETS · MOONS · RESOURCES · DISCOVERIES · ACHIEVEMENTS
import { el, clearChildren, makeModal } from '../utils/UI.js';
import { PLANETS, MOONS, ANOMALIES, ECONOMY, UPGRADES, SUN_CONFIG } from '../config.js';
import { ACHIEVEMENTS } from '../game/GameState.js';
import { factsLines } from '../planets/PlanetData.js';

export class Codex {
  constructor(root, gs) {
    this.gs = gs;
    const m = makeModal('codex-modal', 'CODEX');
    this.modal = m;
    root.appendChild(m.root);

    this.tabs = el('div', 'codex-tabs');
    this.content = el('div', 'codex-content');
    m.body.appendChild(this.tabs);
    m.body.appendChild(this.content);
    this.activeTab = 'PLANETS';
    for (const t of ['PLANETS', 'MOONS', 'RESOURCES', 'DISCOVERIES', 'ACHIEVEMENTS']) {
      const b = el('button', 'codex-tab', t);
      b.addEventListener('click', () => { this.activeTab = t; this.render(); });
      this.tabs.appendChild(b);
    }
  }

  show() { this.modal.root.classList.remove('hidden'); this.render(); }
  hide() { this.modal.root.classList.add('hidden'); }
  get visible() { return !this.modal.root.classList.contains('hidden'); }

  render() {
    for (const b of this.tabs.children) b.classList.toggle('active', b.textContent === this.activeTab);
    clearChildren(this.content);
    switch (this.activeTab) {
      case 'PLANETS': this.renderBodies([{ cfg: SUN_CONFIG }, ...PLANETS.map(p => ({ cfg: p }))], 'planet'); break;
      case 'MOONS': this.renderBodies(MOONS.map(mm => ({ cfg: mm })), 'moon'); break;
      case 'RESOURCES': this.renderResources(); break;
      case 'DISCOVERIES': this.renderDiscoveries(); break;
      case 'ACHIEVEMENTS': this.renderAchievements(); break;
    }
  }

  entryRow(title, unlocked, sub, detail) {
    const row = el('div', 'codex-entry' + (unlocked ? '' : ' locked'));
    row.appendChild(el('div', 'ce-title', unlocked ? title : '??? LOCKED'));
    if (sub) row.appendChild(el('div', 'ce-sub', sub));
    if (unlocked && detail) row.appendChild(el('div', 'ce-detail', detail));
    return row;
  }

  renderBodies(list, kind) {
    for (const { cfg } of list) {
      const unlocked = this.gs.state.discoveries.includes(cfg.id) || this.gs.state.visited.includes(cfg.id);
      const facts = unlocked
        ? factsLines(cfg).map(([k, v]) => `${k}: ${v}`).join(' · ')
        : '';
      this.content.appendChild(this.entryRow(cfg.name, unlocked, facts, unlocked ? cfg.codex : 'Scan or visit to unlock this entry.'));
    }
  }

  renderResources() {
    for (const id in ECONOMY.resources) {
      const r = ECONOMY.resources[id];
      this.content.appendChild(this.entryRow(r.name.toUpperCase(), true,
        `Value: ${r.price} CR/unit · In cargo: ${this.gs.state.resources[id] || 0}`,
        id === 'rare'
          ? 'Exotic elements found in rare-metal asteroids and deep-space anomalies. Extremely valuable.'
          : id === 'water' || id === 'ice'
            ? 'Volatile ices from cometary bodies and ice asteroids. Life support & fuel feedstock.'
            : id === 'food'
              ? 'Ration packs grown and stored at planetary outposts. Eat to keep the astronaut fed — 1 ration restores 45 satiety.'
              : id === 'parts'
                ? 'Spare parts used to repair broken rovers and maintain outpost systems in the field.'
                : 'Common structural metals from the main asteroid belt.'));
    }
    this.content.appendChild(this.entryRow('SHIP SYSTEMS', true,
      'Engines · Tanks · Shields · Scanners · Cargo',
      Object.keys(UPGRADES).map(k => `${UPGRADES[k].name}: MK${this.gs.state.upgrades[k]}`).join(' · ')));
  }

  renderDiscoveries() {
    for (const an of ANOMALIES) {
      const found = this.gs.state.anomalies.includes(an.cfg.id);
      this.content.appendChild(this.entryRow(an.cfg.name, found,
        found ? 'Anomaly investigated.' : 'An unidentified contact somewhere in the main belt.',
        found ? an.cfg.codex : ''));
    }
    if (!this.gs.state.anomalies.length)
      this.content.appendChild(el('div', 'ce-hint', 'Rumors speak of strange signals drifting inside the asteroid belt…'));
  }

  renderAchievements() {
    for (const a of ACHIEVEMENTS) {
      const got = this.gs.state.achievements.includes(a.id);
      const row = this.entryRow(a.name, true, a.desc, got ? '✔ EARNED' : 'Not yet earned');
      row.classList.add(got ? 'earned' : 'not-earned');
      this.content.appendChild(row);
    }
  }
}
