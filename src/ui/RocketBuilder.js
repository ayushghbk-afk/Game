// RocketBuilder — the Vehicle Assembly Building.
//
// Left:   the parts catalogue, grouped by category.
// Middle: the STACK (bottom → top) you are assembling, reorderable.
// Right:  live analysis — mass, thrust, TWR, delta-v per stage, what it can
//         reach, and every error/warning that would ruin the flight.
//
// Designs can be saved locally, exported to a file, imported from a file, and
// (with an account) published so other commanders can download them.
import { el, clearChildren, makeModal } from '../utils/UI.js';
import {
  ROCKET_PARTS, PART_CATEGORIES, getPart, analyzeDesign,
  starterDesign, sanitizeDesign, exportDesign, EARTH_ORBIT_DV
} from '../rockets/RocketParts.js';

const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString();

export class RocketBuilder {
  /**
   * @param hooks {gs, backend, toast, onLaunch(design), onClose, canLaunch()}
   */
  constructor(root, hooks) {
    this.hooks = hooks;
    this.modal = makeModal('vab-modal', 'ROCKET WORKSHOP');
    this.modal.root.classList.add('vab');
    root.appendChild(this.modal.root);

    this.design = null;
    this.tab = 'build';   // build | designs | shared
    this.category = 'command';
    this.modal.close = () => { this.hide(); };
  }

  show() {
    if (!this.design) this.design = this._loadActiveOrStarter();
    this.modal.root.classList.remove('hidden');
    this.render();
  }
  hide() {
    this.modal.root.classList.add('hidden');
    this.hooks.onClose?.();
  }
  get visible() { return !this.modal.root.classList.contains('hidden'); }

  _store() {
    const gs = this.hooks.gs;
    gs.state.rockets ||= { designs: [], active: null, built: [] };
    return gs.state.rockets;
  }

  _loadActiveOrStarter() {
    const store = this._store();
    const active = store.designs.find(d => d.id === store.active);
    if (active) return JSON.parse(JSON.stringify(active.design));
    return starterDesign();
  }

  // ================================================================ render
  render() {
    const b = this.modal.body;
    clearChildren(b);

    const tabs = el('div', 'vab-tabs');
    for (const [id, label] of [['build', 'BUILD'], ['designs', 'MY ROCKETS'], ['shared', 'SHARED']]) {
      const t = el('button', 'tab' + (this.tab === id ? ' active' : ''), label);
      t.addEventListener('click', () => { this.tab = id; this.render(); });
      tabs.appendChild(t);
    }
    b.appendChild(tabs);

    if (this.tab === 'build') this._renderBuild(b);
    else if (this.tab === 'designs') this._renderMyRockets(b);
    else this._renderShared(b);
  }

  // ---------------------------------------------------------------- BUILD
  _renderBuild(b) {
    const analysis = analyzeDesign(this.design);
    const grid = el('div', 'vab-grid');

    grid.appendChild(this._catalogue());
    grid.appendChild(this._stack(analysis));
    grid.appendChild(this._readout(analysis));
    b.appendChild(grid);

    // ---- bottom action bar ----
    const bar = el('div', 'vab-bar');
    const nameIn = el('input', 'input vab-name');
    nameIn.value = this.design.name || 'Untitled rocket';
    nameIn.maxLength = 48;
    nameIn.addEventListener('change', () => { this.design.name = nameIn.value.trim() || 'Untitled rocket'; });
    bar.appendChild(nameIn);

    const save = el('button', 'btn', '💾 SAVE');
    save.addEventListener('click', () => this._saveDesign());

    const exp = el('button', 'btn', '⤓ EXPORT');
    exp.addEventListener('click', () => this._exportFile());

    const imp = el('button', 'btn', '⤒ IMPORT');
    imp.addEventListener('click', () => this._importFile());

    const share = el('button', 'btn', '☁ SHARE');
    share.addEventListener('click', () => this._share());

    const clear = el('button', 'btn btn-danger', 'CLEAR');
    clear.addEventListener('click', () => { this.design = { version: 1, name: 'New rocket', parts: [] }; this.render(); });

    const launch = el('button', 'btn btn-primary vab-launch', '🚀 LAUNCH FROM EARTH');
    launch.disabled = !analysis.valid;
    if (!analysis.valid) launch.classList.add('disabled');
    launch.addEventListener('click', () => this._launch(analysis));

    bar.append(save, exp, imp, share, clear, launch);
    b.appendChild(bar);
  }

  _catalogue() {
    const col = el('div', 'vab-col vab-parts');
    col.appendChild(el('div', 'vab-col-title', 'PARTS'));

    const cats = el('div', 'vab-cats');
    for (const c of PART_CATEGORIES) {
      const t = el('button', 'btn btn-small' + (this.category === c.id ? ' active' : ''), c.name);
      t.addEventListener('click', () => { this.category = c.id; this.render(); });
      cats.appendChild(t);
    }
    col.appendChild(cats);

    const cat = PART_CATEGORIES.find(c => c.id === this.category);
    col.appendChild(el('div', 'vab-cat-desc dim', cat?.desc || ''));

    const list = el('div', 'vab-part-list');
    for (const p of ROCKET_PARTS.filter(p => p.cat === this.category)) {
      const row = el('div', 'part-row');
      const spec = [];
      if (p.mass) spec.push(`${p.mass} t`);
      if (p.fuel) spec.push(`${p.fuel} t fuel`);
      if (p.thrust) spec.push(`${p.thrust} kN`);
      if (p.isp) spec.push(`Isp ${p.isp}s`);
      if (p.crew) spec.push(`${p.crew} crew`);
      row.innerHTML = `
        <div class="pr-main">
          <div class="pr-name">${p.name}</div>
          <div class="pr-spec dim">${spec.join(' · ')}</div>
          <div class="pr-desc dim">${p.desc}</div>
        </div>
        <div class="pr-cost">${p.cost.toLocaleString()} CR</div>`;
      const add = el('button', 'btn btn-small btn-primary', '+');
      add.title = 'Add to the top of the stack';
      add.addEventListener('click', () => this._addPart(p.id));
      row.appendChild(add);
      list.appendChild(row);
    }
    col.appendChild(list);
    return col;
  }

  _stack(analysis) {
    const col = el('div', 'vab-col vab-stack');
    col.appendChild(el('div', 'vab-col-title', 'STACK — bottom to top'));

    const list = el('div', 'vab-stack-list');
    const parts = this.design.parts;
    if (!parts.length) {
      list.appendChild(el('div', 'empty-state dim',
        'Empty pad.<br>Start with an engine, add tanks, then a command pod on top. Or press LOAD STARTER below.'));
    }
    let stageNo = 1;
    parts.forEach((entry, i) => {
      const p = getPart(entry.id);
      if (!p) return;
      const row = el('div', 'stack-row' + (p.stage ? ' decoupler' : ''));
      const label = p.stage ? `— STAGE ${stageNo++} SEPARATION —` : p.name;
      row.appendChild(el('div', 'sr-name', label + (entry.qty > 1 ? ` ×${entry.qty}` : '')));
      const ctl = el('div', 'sr-ctl');
      const mk = (txt, title, fn, cls) => {
        const btn = el('button', 'btn btn-small ' + (cls || ''), txt);
        btn.title = title;
        btn.addEventListener('click', () => { fn(); this.render(); });
        return btn;
      };
      ctl.append(
        mk('−', 'Remove one', () => this._changeQty(i, -1)),
        mk('+', 'Add one', () => this._changeQty(i, 1)),
        mk('▲', 'Move up the stack', () => this._move(i, 1)),
        mk('▼', 'Move down the stack', () => this._move(i, -1)),
        mk('✕', 'Delete', () => { parts.splice(i, 1); }, 'btn-danger')
      );
      row.appendChild(ctl);
      list.appendChild(row);
    });
    col.appendChild(list);

    const quick = el('div', 'btn-row');
    const starter = el('button', 'btn btn-small', 'LOAD STARTER');
    starter.addEventListener('click', () => { this.design = starterDesign(); this.render(); });
    const dec = el('button', 'btn btn-small', '+ DECOUPLER');
    dec.addEventListener('click', () => this._addPart('dec-stack'));
    quick.append(starter, dec);
    col.appendChild(quick);
    return col;
  }

  _readout(a) {
    const col = el('div', 'vab-col vab-readout');
    col.appendChild(el('div', 'vab-col-title', 'FLIGHT ANALYSIS'));

    const stat = (k, v, cls) => {
      const r = el('div', 'ro-row' + (cls ? ' ' + cls : ''));
      r.appendChild(el('span', 'ro-k', k));
      r.appendChild(el('span', 'ro-v', v));
      return r;
    };
    const dvClass = a.deltaV >= EARTH_ORBIT_DV ? 'good' : 'bad';
    const twrClass = a.twr >= 1.15 ? 'good' : 'bad';

    col.append(
      stat('Total mass', fmt(a.wetMass, 2) + ' t'),
      stat('Dry mass', fmt(a.dryMass, 2) + ' t'),
      stat('Propellant', fmt(a.fuelMass, 2) + ' t'),
      stat('Thrust', fmt(a.thrust, 0) + ' kN'),
      stat('Isp (avg)', fmt(a.isp, 0) + ' s'),
      stat('TWR at lift-off', fmt(a.twr, 2), twrClass),
      stat('Delta-v', fmt(a.deltaV, 0) + ' m/s', dvClass),
      stat('Stages', String(a.stages.length)),
      stat('Crew', String(a.crew)),
      stat('Cost', a.cost.toLocaleString() + ' CR'),
      stat('Reach', a.reach, a.orbitCapable ? 'good' : '')
    );

    // delta-v budget bar
    const bar = el('div', 'dv-bar');
    const fill = el('div', 'dv-fill');
    fill.style.width = Math.min(100, (a.deltaV / EARTH_ORBIT_DV) * 100).toFixed(1) + '%';
    fill.classList.add(a.deltaV >= EARTH_ORBIT_DV ? 'good' : 'bad');
    bar.appendChild(fill);
    col.appendChild(el('div', 'ro-sub dim', `Orbit needs ${EARTH_ORBIT_DV.toLocaleString()} m/s`));
    col.appendChild(bar);

    if (a.stages.length) {
      col.appendChild(el('div', 'ro-sub', 'PER STAGE'));
      a.stages.forEach((s, i) => {
        col.appendChild(el('div', 'ro-stage dim',
          `Stage ${i + 1}: ${fmt(s.deltaV, 0)} m/s · TWR ${fmt(s.twr, 2)} · ${fmt(s.fuelMass, 1)} t fuel`));
      });
    }

    for (const e of a.errors) col.appendChild(el('div', 'ro-msg error', '✖ ' + e));
    for (const w of a.warnings) col.appendChild(el('div', 'ro-msg warn', '⚠ ' + w));
    if (a.valid && !a.warnings.length) col.appendChild(el('div', 'ro-msg ok', '✔ Flightworthy. Clear for launch.'));
    return col;
  }

  // ---------------------------------------------------------------- edits
  _addPart(id) {
    const parts = this.design.parts;
    const last = parts[parts.length - 1];
    // Stack identical consecutive parts as a quantity rather than 12 rows.
    if (last && last.id === id && !getPart(id)?.stage) last.qty = Math.min(50, (last.qty || 1) + 1);
    else parts.push({ id, qty: 1 });
    this.render();
  }
  _changeQty(i, d) {
    const e = this.design.parts[i];
    if (!e) return;
    e.qty = (e.qty || 1) + d;
    if (e.qty < 1) this.design.parts.splice(i, 1);
    else e.qty = Math.min(50, e.qty);
  }
  _move(i, dir) {
    const parts = this.design.parts;
    const j = i + (dir > 0 ? 1 : -1);
    if (j < 0 || j >= parts.length) return;
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }

  // ---------------------------------------------------------------- persist
  _saveDesign() {
    const store = this._store();
    const analysis = analyzeDesign(this.design);
    const id = this.design.id || ('r' + Date.now().toString(36));
    this.design.id = id;
    const record = {
      id, name: this.design.name, design: JSON.parse(JSON.stringify(this.design)),
      stats: { deltaV: Math.round(analysis.deltaV), mass: analysis.wetMass, cost: analysis.cost, reach: analysis.reach },
      savedAt: Date.now()
    };
    const idx = store.designs.findIndex(d => d.id === id);
    if (idx >= 0) store.designs[idx] = record; else store.designs.push(record);
    store.active = id;
    this.hooks.gs.save?.();
    this.hooks.toast?.('DESIGN SAVED', `"${record.name}" stored in this browser.`, 'success');
    this.render();
  }

  _renderMyRockets(b) {
    const store = this._store();
    const list = el('div', 'rocket-list');
    if (!store.designs.length) {
      list.appendChild(el('div', 'empty-state',
        'No saved rockets.<br><span class="dim">Build one in the BUILD tab and press SAVE.</span>'));
    }
    for (const d of [...store.designs].sort((a, b) => b.savedAt - a.savedAt)) {
      const card = el('div', 'rocket-card');
      card.innerHTML = `<div class="rc-name">${d.name}</div>
        <div class="rc-stats dim">${(d.stats?.deltaV || 0).toLocaleString()} m/s · ${fmt(d.stats?.mass || 0, 1)} t · ${(d.stats?.cost || 0).toLocaleString()} CR · ${d.stats?.reach || ''}</div>`;
      const acts = el('div', 'rc-actions');
      const load = el('button', 'btn btn-small btn-primary', 'EDIT');
      load.addEventListener('click', () => {
        this.design = JSON.parse(JSON.stringify(d.design));
        this.design.id = d.id;
        store.active = d.id;
        this.tab = 'build';
        this.render();
      });
      const launch = el('button', 'btn btn-small', '🚀 LAUNCH');
      launch.addEventListener('click', () => {
        this.design = JSON.parse(JSON.stringify(d.design));
        this._launch(analyzeDesign(this.design));
      });
      const share = el('button', 'btn btn-small', '☁ SHARE');
      share.addEventListener('click', () => { this.design = JSON.parse(JSON.stringify(d.design)); this._share(); });
      const del = el('button', 'btn btn-small btn-danger', 'DELETE');
      del.addEventListener('click', () => {
        store.designs = store.designs.filter(x => x.id !== d.id);
        this.hooks.gs.save?.();
        this.render();
      });
      acts.append(load, launch, share, del);
      card.appendChild(acts);
      list.appendChild(card);
    }
    b.appendChild(list);
  }

  _renderShared(b) {
    const list = el('div', 'rocket-list');
    b.appendChild(list);
    const be = this.hooks.backend;
    if (!be?.configured) {
      list.appendChild(el('div', 'empty-state',
        'Shared designs need a server.<br><span class="dim">Main menu → ACCOUNT → CONNECT SERVER. You can still export and import rocket files without one.</span>'));
      const imp = el('button', 'btn btn-primary', '⤒ IMPORT FROM FILE');
      imp.addEventListener('click', () => this._importFile());
      list.appendChild(imp);
      return;
    }
    list.appendChild(el('div', 'empty-state dim', 'Loading community designs…'));
    be.listSharedRockets().then(rows => {
      clearChildren(list);
      if (!rows.length) {
        list.appendChild(el('div', 'empty-state', 'No public designs yet — be the first to share one.'));
        return;
      }
      for (const r of rows) {
        const card = el('div', 'rocket-card');
        card.innerHTML = `<div class="rc-name">${r.name}</div>
          <div class="rc-stats dim">by ${r.owner_name || 'commander'} · ${(r.stats?.deltaV || 0).toLocaleString()} m/s · ${r.stats?.reach || ''}</div>`;
        const acts = el('div', 'rc-actions');
        const imp = el('button', 'btn btn-small btn-primary', '⤓ IMPORT');
        imp.addEventListener('click', () => {
          try {
            this.design = sanitizeDesign(r.design);
            this.tab = 'build';
            this.hooks.toast?.('IMPORTED', `"${this.design.name}" loaded into the workshop.`, 'success');
            this.render();
          } catch (e) { this.hooks.toast?.('IMPORT FAILED', e.message, 'warn'); }
        });
        acts.appendChild(imp);
        card.appendChild(acts);
        list.appendChild(card);
      }
    }).catch(e => {
      clearChildren(list);
      list.appendChild(el('div', 'empty-state', 'Could not load designs.<br><span class="dim">' + e.message + '</span>'));
    });
  }

  async _share() {
    const be = this.hooks.backend;
    if (!be?.signedIn) {
      this.hooks.toast?.('SHARE', 'Sign in (ACCOUNT) to publish rockets. You can EXPORT a file to share manually.', 'warn', 4500);
      return;
    }
    try {
      const a = analyzeDesign(this.design);
      await be.publishRocket({
        name: this.design.name, design: this.design,
        stats: { deltaV: Math.round(a.deltaV), mass: a.wetMass, cost: a.cost, reach: a.reach },
        isPublic: true
      });
      this.hooks.toast?.('PUBLISHED', `"${this.design.name}" is now public in SHARED.`, 'success');
    } catch (e) {
      this.hooks.toast?.('SHARE FAILED', e.message, 'warn');
    }
  }

  _exportFile() {
    const json = exportDesign(this.design);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (this.design.name || 'rocket').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.rocket.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.hooks.toast?.('EXPORTED', 'Rocket file downloaded — share it with anyone.', 'success');
  }

  _importFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          this.design = sanitizeDesign(String(reader.result));
          this.tab = 'build';
          this.hooks.toast?.('IMPORTED', `"${this.design.name}" loaded.`, 'success');
          this.render();
        } catch (e) {
          this.hooks.toast?.('IMPORT FAILED', e.message, 'warn');
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  _launch(analysis) {
    if (!analysis.valid) {
      this.hooks.toast?.('LAUNCH ABORTED', analysis.errors[0], 'warn', 4000);
      return;
    }
    const gs = this.hooks.gs;
    if (gs.credits < analysis.cost) {
      this.hooks.toast?.('LAUNCH ABORTED',
        `This vehicle costs ${analysis.cost.toLocaleString()} CR — you have ${gs.credits.toLocaleString()} CR.`, 'warn', 4500);
      return;
    }
    this.hide();
    this.hooks.onLaunch?.(JSON.parse(JSON.stringify(this.design)), analysis);
  }
}
