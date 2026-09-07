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
  starterDesign, EARTH_ORBIT_DV
} from '../rockets/RocketParts.js';
import {
  upgradeDesign, emptyDesign, sanitizeDesign2, exportDesign2,
  derivedStages, structuralIssues, designBounds, findPart
} from '../rockets/RocketDesign.js';
import { BuilderScene } from '../rockets/BuilderScene.js';

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
    this._startLoop();
  }
  hide() {
    this.modal.root.classList.add('hidden');
    this._stopLoop();
    this.builder?.dispose();
    this.builder = null;
    this.hooks.onClose?.();
  }

  _startLoop() {
    if (this._raf) return;
    const tick = () => {
      // Stop as soon as there is nothing to draw — a hidden panel, or a
      // browser with no WebGL — so we never spin a pointless frame loop.
      if (!this.builder || this.modal.root.classList.contains('hidden')) {
        this._raf = null;
        return;
      }
      this.builder.render();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }
  _stopLoop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
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
    // Older careers hold v1 linear stacks — upgrade them to 3D placements.
    if (active) return upgradeDesign(JSON.parse(JSON.stringify(active.design)));
    return upgradeDesign(starterDesign());
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
  // ---------------------------------------------------------------- BUILD
  _renderBuild(b) {
    const analysis = this._analyze();
    const grid = el('div', 'vab-grid');

    grid.appendChild(this._catalogue());
    grid.appendChild(this._viewport());
    grid.appendChild(this._readout(analysis));
    b.appendChild(grid);
    b.appendChild(this._actionBar(analysis));

    // The WebGL scene must be created AFTER the canvas is in the document,
    // so it can measure itself.
    requestAnimationFrame(() => this._mountScene());
  }

  /** Re-run the analysis, folding in 3D-only structural problems. */
  _analyze() {
    const a = analyzeDesign(this.design);
    const issues = structuralIssues(this.design);
    // Floating parts are a hard error: the flight model cannot fly them.
    a.errors = [...a.errors, ...issues];
    a.valid = a.errors.length === 0;
    a.orbitCapable = a.valid && a.deltaV >= EARTH_ORBIT_DV && a.twr >= 1.15;
    return a;
  }

  _viewport() {
    const col = el('div', 'vab-col vab-viewport');
    const head = el('div', 'vab-view-head');
    head.appendChild(el('div', 'vab-col-title', '3D ASSEMBLY'));

    const symWrap = el('label', 'vab-sym');
    const sym = el('input');
    sym.type = 'checkbox';
    sym.checked = this._symmetry !== false;
    sym.addEventListener('change', () => {
      this._symmetry = sym.checked;
      this.builder?.setSymmetry(sym.checked);
    });
    symWrap.append(sym, document.createTextNode(' SYMMETRY'));
    head.appendChild(symWrap);
    col.appendChild(head);

    const canvas = el('canvas', 'vab-canvas');
    this._canvas = canvas;
    col.appendChild(canvas);

    col.appendChild(el('div', 'vab-hint dim',
      'Tap a part to add it · drag parts to move and snap · drag empty space to orbit · pinch or scroll to zoom'));

    // selection toolbar (delete / mirror / nudge)
    const tools = el('div', 'vab-tools');
    this._toolsEl = tools;
    col.appendChild(tools);
    this._renderTools(null);
    return col;
  }

  _renderTools(uid) {
    const t = this._toolsEl;
    if (!t) return;
    clearChildren(t);
    if (!uid) {
      t.appendChild(el('span', 'dim tiny', 'No part selected'));
      return;
    }
    const p = findPart(this.design, uid);
    const part = p && getPart(p.id);
    if (!part) return;
    t.appendChild(el('span', 'vab-sel-name', part.name));
    const mk = (label, title, fn, cls) => {
      const btn = el('button', 'btn btn-small ' + (cls || ''), label);
      btn.title = title;
      btn.addEventListener('click', () => { fn(); this._afterChange(); });
      t.appendChild(btn);
    };
    mk('▲', 'Move up', () => this.builder?.nudgeSelected(0, 0.25, 0));
    mk('▼', 'Move down', () => this.builder?.nudgeSelected(0, -0.25, 0));
    mk('◀', 'Move left', () => this.builder?.nudgeSelected(-0.25, 0, 0));
    mk('▶', 'Move right', () => this.builder?.nudgeSelected(0.25, 0, 0));
    mk('⇋', 'Mirror to the opposite side', () => this.builder?.mirrorSelected());
    mk('✕', 'Delete this part', () => this.builder?.deleteSelected(), 'btn-danger');
  }

  _mountScene() {
    if (!this._canvas || !this._canvas.isConnected) return;
    this.builder?.dispose();
    try {
      this.builder = new BuilderScene(this._canvas, this.design, {
        onChange: () => this._afterChange(),
        onSelect: (uid) => this._renderTools(uid),
        sound: (k) => this.hooks.sound?.(k)
      });
      this.builder.setSymmetry(this._symmetry !== false);
      this.builder.resize();
      if (!this._resizeBound) {
        this._resizeBound = () => this.builder?.resize();
        window.addEventListener('resize', this._resizeBound);
      }
      this._startLoop();
    } catch (e) {
      // WebGL can be unavailable (headless tests, blocked GPU) — the builder
      // must still be usable through the parts list and readout.
      console.warn('3D builder unavailable', e);
      this._canvas.replaceWith(el('div', 'empty-state dim',
        '3D preview unavailable in this browser — parts and analysis still work.'));
    }
  }

  /** Called whenever the design changes: refresh the readout in place. */
  _afterChange() {
    const a = this._analyze();
    const fresh = this._readout(a);
    this._readoutEl?.replaceWith(fresh);
    this._readoutEl = fresh;
    const launch = this.modal.body.querySelector('.vab-launch');
    if (launch) {
      launch.disabled = !a.valid;
      launch.classList.toggle('disabled', !a.valid);
    }
    this._renderTools(this.builder?.selected || null);
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
      const row = el('div', 'part-row clickable');
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
      add.title = 'Add to the rocket, then drag it into place';
      const place = () => {
        if (this.builder) { this.builder.beginPlace(p.id); this.builder.commitHeld(); }
        else this._addWithoutScene(p.id);
        this._afterChange();
      };
      add.addEventListener('click', (e) => { e.stopPropagation(); place(); });
      row.addEventListener('click', place);
      row.appendChild(add);
      list.appendChild(row);
    }
    col.appendChild(list);
    return col;
  }

  /** Fallback when WebGL is unavailable: stack the part on top. */
  _addWithoutScene(partId) {
    const part = getPart(partId);
    if (!part) return;
    const b = designBounds(this.design);
    this.design.parts.push({
      uid: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      id: partId,
      pos: [0, (this.design.parts.length ? b.maxY : 0) + (part.h || 0.6) / 2, 0],
      radial: false
    });
  }

  _actionBar(analysis) {
    const bar = el('div', 'vab-bar');
    const nameIn = el('input', 'input vab-name');
    nameIn.value = this.design.name || 'Untitled rocket';
    nameIn.maxLength = 48;
    nameIn.addEventListener('change', () => { this.design.name = nameIn.value.trim() || 'Untitled rocket'; });
    bar.appendChild(nameIn);

    const mk = (label, cls, fn) => {
      const btn = el('button', 'btn ' + (cls || ''), label);
      btn.addEventListener('click', fn);
      bar.appendChild(btn);
      return btn;
    };
    mk('💾 SAVE', '', () => this._saveDesign());
    mk('⤓ EXPORT', '', () => this._exportFile());
    mk('⤒ IMPORT', '', () => this._importFile());
    mk('☁ SHARE', '', () => this._share());
    mk('CLEAR', 'btn-danger', () => {
      this.design = emptyDesign('New rocket');
      this.builder?.setDesign(this.design);
      this._afterChange();
    });
    mk('STARTER', '', () => {
      this.design = upgradeDesign(starterDesign());
      this.builder?.setDesign(this.design);
      this._afterChange();
    });

    const launch = mk('🚀 LAUNCH FROM EARTH', 'btn-primary vab-launch', () => this._launch(this._analyze()));
    launch.disabled = !analysis.valid;
    if (!analysis.valid) launch.classList.add('disabled');
    return bar;
  }

  _readout(a) {
    const col = el('div', 'vab-col vab-readout');
    this._readoutEl = col;
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
    const analysis = this._analyze();
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
        this.design = upgradeDesign(JSON.parse(JSON.stringify(d.design)));
        this.design.id = d.id;
        store.active = d.id;
        this.tab = 'build';
        this.render();
      });
      const launch = el('button', 'btn btn-small', '🚀 LAUNCH');
      launch.addEventListener('click', () => {
        this.design = upgradeDesign(JSON.parse(JSON.stringify(d.design)));
        this._launch(this._analyze());
      });
      const share = el('button', 'btn btn-small', '☁ SHARE');
      share.addEventListener('click', () => { this.design = upgradeDesign(JSON.parse(JSON.stringify(d.design))); this._share(); });
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
            this.design = sanitizeDesign2(r.design);
            this.builder?.setDesign(this.design);
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
      const a = this._analyze();
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
    const json = exportDesign2(this.design);
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
          this.design = sanitizeDesign2(String(reader.result));
          this.builder?.setDesign(this.design);
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
