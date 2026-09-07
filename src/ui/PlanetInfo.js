// PlanetInfo — the codex-style info card for a selected body, with actions:
// set target / fast travel / scan / open codex.
import { el, clearChildren } from '../utils/UI.js';
import { findBody, factsLines } from '../planets/PlanetData.js';

export class PlanetInfoPanel {
  constructor(root, actions) {
    this.rootEl = el('div', 'planet-info hidden');
    this.actions = actions;
    root.appendChild(this.rootEl);
  }

  show(bodyId, gs, dist) {
    const found = findBody(bodyId);
    if (!found) return;
    this.bodyId = bodyId;
    const cfg = found.cfg;
    const scanned = gs.state.discoveries.includes(bodyId);
    const visited = gs.state.visited.includes(bodyId);
    const status = visited ? 'EXPLORED' : scanned ? 'SCANNED' : 'UNKNOWN';

    clearChildren(this.rootEl);
    this.rootEl.appendChild(el('div', 'pi-name', cfg.name));
    this.rootEl.appendChild(el('div', 'pi-status ' + (visited || scanned ? 'ok' : ''), `STATUS: ${status}`));

    const table = el('div', 'pi-facts');
    for (const [k, v] of factsLines(cfg)) {
      table.appendChild(el('div', 'pi-k', k));
      table.appendChild(el('div', 'pi-v', String(v)));
    }
    table.appendChild(el('div', 'pi-k', 'Distance'));
    table.appendChild(el('div', 'pi-v', dist));
    this.rootEl.appendChild(table);

    if (scanned || visited) {
      const codex = el('div', 'pi-codex', cfg.codex || '');
      this.rootEl.appendChild(codex);
    } else {
      this.rootEl.appendChild(el('div', 'pi-codex dim', 'Scan this body to reveal its survey data.'));
    }

    const row = el('div', 'pi-actions');
    const mkBtn = (label, fn, primary) => {
      const b = el('button', 'btn' + (primary ? ' btn-primary' : ''), label);
      b.addEventListener('click', fn);
      row.appendChild(b);
    };
    mkBtn('SET TARGET', () => this.actions.setTarget(bodyId));
    mkBtn('FAST TRAVEL', () => this.actions.fastTravel(bodyId));
    mkBtn('SCAN', () => this.actions.scan());
    mkBtn('CODEX', () => this.actions.codex(bodyId));
    this.rootEl.appendChild(row);

    const close = el('button', 'btn-icon pi-close', '✕');
    close.addEventListener('click', () => this.hide());
    this.rootEl.appendChild(close);

    this.rootEl.classList.remove('hidden');
  }

  hide() { this.rootEl.classList.add('hidden'); }
  get visible() { return !this.rootEl.classList.contains('hidden'); }
}
