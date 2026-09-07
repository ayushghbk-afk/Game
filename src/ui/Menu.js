// Menu — main menu, pause overlay, settings, help, missions & ship panels.
import { el, clearChildren, makeModal } from '../utils/UI.js';
import { MISSIONS } from '../missions/MissionData.js';
import { UPGRADES, QUALITY, LEVELS } from '../config.js';
import { shipStats } from '../spacecraft/ShipUpgrades.js';
import { hasStorage, SaveSystem } from '../save/SaveSystem.js';

export class Menu {
  constructor(root, actions, gs) {
    this.gs = gs;
    this.actions = actions; // {play, newGame, missions, ship, codex, settingsChanged, help, save, quitToMenu, redeem}
    this.overlay = el('div', 'main-menu');
    this.overlay.innerHTML = `
      <div class="menu-shell">
        <aside class="menu-side">
          <div class="menu-subtitle">DEEP SPACE EXPLORATION PROGRAM</div>
          <h1 class="menu-title">SOLAR<br><span>ODYSSEY</span></h1>
          <div class="menu-account" id="mm-account-strip">
            <span class="ma-dot"></span>
            <span class="ma-name">GUEST</span>
            <button class="btn btn-small" id="mm-account">ACCOUNT</button>
          </div>
          <nav class="menu-nav">
            <button class="menu-btn primary" id="mm-play">▶ LAUNCH</button>
            <button class="menu-btn" id="mm-new">NEW CAREER</button>
            <button class="menu-btn" id="mm-vab">🚀 ROCKET WORKSHOP</button>
            <button class="menu-btn" id="mm-missions">MISSIONS</button>
            <button class="menu-btn" id="mm-ship">SHIP</button>
            <button class="menu-btn" id="mm-codex">CODEX</button>
            <button class="menu-btn" id="mm-redeem">🎁 REDEEM CODE</button>
            <button class="menu-btn" id="mm-settings">SETTINGS</button>
            <button class="menu-btn" id="mm-help">HELP</button>
          </nav>
          <div class="menu-footer">${hasStorage ? '' : '⚠ storage unavailable — progress will not persist'} · v2.0</div>
        </aside>

        <section class="menu-browser">
          <div class="menu-tabs" role="tablist">
            <button class="tab active" role="tab" data-tab="saves">MY CAREERS</button>
            <button class="tab" role="tab" data-tab="servers">SERVERS</button>
            <button class="tab" role="tab" data-tab="friends">FRIENDS</button>
          </div>
          <div class="menu-tabpanel" id="mm-panel-saves"></div>
          <div class="menu-tabpanel hidden" id="mm-panel-servers"></div>
          <div class="menu-tabpanel hidden" id="mm-panel-friends"></div>
        </section>
      </div>`;
    root.appendChild(this.overlay);

    this.overlay.querySelector('#mm-play').addEventListener('click', () => actions.play());
    this.overlay.querySelector('#mm-new').addEventListener('click', () => this._confirmNewGame());
    this.overlay.querySelector('#mm-vab').addEventListener('click', () => actions.rocketBuilder?.());
    this.overlay.querySelector('#mm-account').addEventListener('click', () => actions.account?.());
    this.overlay.querySelector('#mm-missions').addEventListener('click', () => { this.showMissions(); });
    this.overlay.querySelector('#mm-ship').addEventListener('click', () => { this.showShip(); });
    this.overlay.querySelector('#mm-codex').addEventListener('click', actions.codex);
    this.overlay.querySelector('#mm-redeem').addEventListener('click', () => { this.showRedeem(); });
    this.overlay.querySelector('#mm-settings').addEventListener('click', () => { this.showSettings(); });
    this.overlay.querySelector('#mm-help').addEventListener('click', () => { this.showHelp(); });

    this.tab = 'saves';
    for (const t of this.overlay.querySelectorAll('.menu-tabs .tab')) {
      t.addEventListener('click', () => this.selectTab(t.dataset.tab));
    }
    this.panels = {
      saves: this.overlay.querySelector('#mm-panel-saves'),
      servers: this.overlay.querySelector('#mm-panel-servers'),
      friends: this.overlay.querySelector('#mm-panel-friends')
    };

    // pause overlay
    this.pause = el('div', 'pause-overlay hidden');
    this.pause.innerHTML = `
      <div class="pause-inner">
        <div class="pause-title">PAUSED</div>
        <button class="menu-btn primary" id="pz-resume">RESUME</button>
        <button class="menu-btn" id="pz-save">SAVE GAME</button>
        <button class="menu-btn" id="pz-redeem">🎁 REDEEM CODE</button>
        <button class="menu-btn" id="pz-vab">🚀 ROCKET WORKSHOP</button>
        <button class="menu-btn" id="pz-settings">SETTINGS</button>
        <button class="menu-btn" id="pz-help">HELP</button>
        <button class="menu-btn" id="pz-quit">QUIT TO MENU</button>
      </div>`;
    root.appendChild(this.pause);
    this.pause.querySelector('#pz-resume').addEventListener('click', actions.resume);
    this.pause.querySelector('#pz-save').addEventListener('click', actions.save);
    this.pause.querySelector('#pz-redeem').addEventListener('click', () => { this.showRedeem(); });
    this.pause.querySelector('#pz-vab').addEventListener('click', () => actions.rocketBuilder?.());
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
    this.redeemModal = makeModal('redeem-modal', 'REDEEM CODE');
    for (const m of [this.missionsModal, this.shipModal, this.settingsModal, this.helpModal, this.confirmModal, this.redeemModal])
      root.appendChild(m.root);
  }

  // ---- main menu visibility ----
  showMain() {
    this.overlay.classList.remove('hidden');
    this.pause.classList.add('hidden');
    this.refreshPlayLabel();
    this.refreshAccount();
    this.renderTab();
  }
  hideMain() { this.overlay.classList.add('hidden'); }
  showPause() { this.pause.classList.remove('hidden'); }
  hidePause() { this.pause.classList.add('hidden'); }

  refreshPlayLabel() {
    const has = hasStorage && SaveSystem.hasAnySave();
    const btn = this.overlay.querySelector('#mm-play');
    btn.innerHTML = has ? '▶ CONTINUE' : '▶ LAUNCH';
  }

  /** Identity strip: guest / signed-in handle + connection state. */
  refreshAccount() {
    const strip = this.overlay.querySelector('#mm-account-strip');
    if (!strip) return;
    const info = this.actions.accountInfo?.() || { name: 'GUEST', online: false, mode: 'guest' };
    strip.querySelector('.ma-name').textContent = info.name;
    strip.classList.toggle('online', !!info.online);
    strip.querySelector('.ma-dot').title = info.online ? 'Signed in' : 'Guest — data stored in this browser';
  }

  // ---- browser tabs (careers · servers · friends) ----
  selectTab(name) {
    this.tab = name;
    for (const t of this.overlay.querySelectorAll('.menu-tabs .tab'))
      t.classList.toggle('active', t.dataset.tab === name);
    for (const k in this.panels) this.panels[k].classList.toggle('hidden', k !== name);
    this.renderTab();
  }

  renderTab() {
    if (this.tab === 'saves') this.renderSaves();
    else if (this.tab === 'servers') this.renderServers();
    else this.renderFriends();
  }

  _timeAgo(ts) {
    if (!ts) return 'never';
    const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }
  _playTime(sec) {
    const m = Math.round((sec || 0) / 60);
    return m < 60 ? m + ' min' : (m / 60).toFixed(1) + ' h';
  }

  /** LIST OF PAST GAMES — every local save slot plus any cloud saves. */
  renderSaves() {
    const p = this.panels.saves;
    clearChildren(p);
    const slots = SaveSystem.listSlots();
    const head = el('div', 'panel-head');
    head.appendChild(el('div', 'panel-title', 'MY CAREERS'));
    const newBtn = el('button', 'btn btn-small', '+ NEW');
    newBtn.addEventListener('click', () => this._confirmNewGame());
    const importBtn = el('button', 'btn btn-small', 'IMPORT');
    importBtn.addEventListener('click', () => this.actions.importSave?.());
    const row = el('div', 'panel-head-actions');
    row.append(newBtn, importBtn);
    head.appendChild(row);
    p.appendChild(head);

    if (!slots.length) {
      p.appendChild(el('div', 'empty-state',
        'No careers yet.<br><span class="dim">Press LAUNCH to begin your first expedition — progress saves automatically to this browser.</span>'));
      return;
    }

    const active = SaveSystem.activeSlot();
    for (const s of slots) {
      const card = el('div', 'slot-card' + (s.slot === active ? ' active' : ''));
      card.appendChild(el('div', 'slot-name', s.name || `Career ${s.slot + 1}`));
      const meta = el('div', 'slot-meta');
      meta.innerHTML = `
        <span>LV ${s.level || 1}</span>
        <span>${(s.credits || 0).toLocaleString()} CR</span>
        <span>${s.location || 'Earth orbit'}</span>
        <span>${this._playTime(s.playTime)}</span>
        <span class="dim">${this._timeAgo(s.savedAt)}</span>`;
      card.appendChild(meta);
      const acts = el('div', 'slot-actions');
      const load = el('button', 'btn btn-small btn-primary', 'CONTINUE');
      load.addEventListener('click', (e) => { e.stopPropagation(); this.actions.loadSlot?.(s.slot); });
      const cloud = el('button', 'btn btn-small', '☁ SYNC');
      cloud.title = 'Upload this career to your account';
      cloud.addEventListener('click', (e) => { e.stopPropagation(); this.actions.syncSlot?.(s.slot); });
      const exp = el('button', 'btn btn-small', 'EXPORT');
      exp.addEventListener('click', (e) => { e.stopPropagation(); this.actions.exportSlot?.(s.slot); });
      const del = el('button', 'btn btn-small btn-danger', 'DELETE');
      del.addEventListener('click', (e) => { e.stopPropagation(); this._confirmDeleteSlot(s); });
      acts.append(load, cloud, exp, del);
      card.appendChild(acts);
      card.addEventListener('click', () => this.actions.loadSlot?.(s.slot));
      p.appendChild(card);
    }
  }

  _confirmDeleteSlot(slot) {
    const m = this.confirmModal;
    clearChildren(m.body);
    m.body.appendChild(el('p', '', `Delete "${slot.name || 'career'}"? This cannot be undone.`));
    const row = el('div', 'btn-row');
    const yes = el('button', 'btn btn-danger', 'DELETE');
    const no = el('button', 'btn', 'CANCEL');
    yes.addEventListener('click', () => { m.close(); this.actions.deleteSlot?.(slot.slot); });
    no.addEventListener('click', () => m.close());
    row.append(yes, no);
    m.body.appendChild(row);
    m.root.classList.remove('hidden');
  }

  /** ONLINE SERVERS, grouped by region. */
  renderServers() {
    const p = this.panels.servers;
    clearChildren(p);
    const head = el('div', 'panel-head');
    head.appendChild(el('div', 'panel-title', 'ONLINE SERVERS'));
    const acts = el('div', 'panel-head-actions');
    const regionSel = el('select', 'input input-small');
    for (const [v, label] of [['auto', 'NEAREST'], ['all', 'ALL REGIONS'],
      ['ap-south', 'ASIA — SOUTH'], ['ap-south-east', 'ASIA — SE'], ['ap-north-east', 'ASIA — NE'],
      ['ap-southeast-2', 'OCEANIA'], ['eu-west', 'EUROPE — WEST'], ['eu-central', 'EUROPE — CENTRAL'],
      ['us-east', 'US — EAST'], ['us-west', 'US — WEST'], ['sa-east', 'SOUTH AMERICA']]) {
      const o = el('option', '', label); o.value = v; regionSel.appendChild(o);
    }
    regionSel.value = this._region || 'auto';
    regionSel.addEventListener('change', () => { this._region = regionSel.value; this.renderServers(); });
    const refresh = el('button', 'btn btn-small', '⟳ REFRESH');
    refresh.addEventListener('click', () => this.renderServers(true));
    const host = el('button', 'btn btn-small', '+ HOST');
    host.addEventListener('click', () => this.actions.hostServer?.());
    acts.append(regionSel, refresh, host);
    head.appendChild(acts);
    p.appendChild(head);

    const list = el('div', 'server-list');
    p.appendChild(list);
    list.appendChild(el('div', 'empty-state dim', 'Scanning relay network…'));

    Promise.resolve(this.actions.listServers?.(this._region || 'auto'))
      .then((servers) => {
        clearChildren(list);
        if (!servers || !servers.length) {
          list.appendChild(el('div', 'empty-state',
            'No servers reachable.<br><span class="dim">Connect a server in ACCOUNT to see the live list, or keep playing solo — single-player needs no connection.</span>'));
          return;
        }
        for (const s of servers) {
          const row = el('div', 'server-row');
          const ping = s.ping == null ? '—' : s.ping + 'ms';
          const pingClass = s.ping == null ? '' : s.ping < 80 ? 'good' : s.ping < 180 ? 'ok' : 'bad';
          row.innerHTML = `
            <div class="sv-main">
              <div class="sv-name">${s.official ? '★ ' : ''}${s.name}</div>
              <div class="sv-sub dim">${(s.region || '').toUpperCase()} · ${(s.mode || 'coop').toUpperCase()}</div>
            </div>
            <div class="sv-players">${s.players ?? 0}/${s.capacity ?? 16}</div>
            <div class="sv-ping ${pingClass}">${ping}</div>`;
          const join = el('button', 'btn btn-small btn-primary', 'JOIN');
          join.addEventListener('click', (e) => { e.stopPropagation(); this.actions.joinServer?.(s); });
          row.appendChild(join);
          list.appendChild(row);
        }
      })
      .catch((e) => {
        clearChildren(list);
        list.appendChild(el('div', 'empty-state', 'Server list unavailable.<br><span class="dim">' + (e?.message || e) + '</span>'));
      });
  }

  /** FRIENDS — requests, online status, invites. */
  renderFriends() {
    const p = this.panels.friends;
    clearChildren(p);
    const head = el('div', 'panel-head');
    head.appendChild(el('div', 'panel-title', 'FRIENDS'));
    const acts = el('div', 'panel-head-actions');
    const search = el('input', 'input input-small');
    search.placeholder = 'Find commander…';
    const find = el('button', 'btn btn-small', 'SEARCH');
    find.addEventListener('click', () => this.actions.findFriends?.(search.value));
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.actions.findFriends?.(search.value); });
    acts.append(search, find);
    head.appendChild(acts);
    p.appendChild(head);

    const list = el('div', 'friend-list');
    p.appendChild(list);
    list.appendChild(el('div', 'empty-state dim', 'Loading…'));

    Promise.resolve(this.actions.listFriends?.())
      .then((data) => {
        clearChildren(list);
        if (!data) {
          list.appendChild(el('div', 'empty-state',
            'Friends need an account.<br><span class="dim">ACCOUNT → SIGN IN to add friends, see who is online and share rocket designs.</span>'));
          return;
        }
        const section = (title, rows, render) => {
          if (!rows.length) return;
          list.appendChild(el('div', 'list-section', title));
          for (const f of rows) list.appendChild(render(f));
        };
        section('REQUESTS', data.incoming || [], (f) => {
          const r = el('div', 'friend-row');
          r.appendChild(el('div', 'fr-name', f.handle));
          const accept = el('button', 'btn btn-small btn-primary', 'ACCEPT');
          accept.addEventListener('click', () => this.actions.acceptFriend?.(f));
          const deny = el('button', 'btn btn-small btn-danger', 'DECLINE');
          deny.addEventListener('click', () => this.actions.removeFriend?.(f));
          r.append(accept, deny);
          return r;
        });
        section('FRIENDS', data.friends || [], (f) => {
          const online = f.presence?.status && f.presence.status !== 'offline';
          const r = el('div', 'friend-row' + (online ? ' online' : ''));
          r.innerHTML = `<div class="fr-name"><span class="fr-dot"></span>${f.handle}</div>
            <div class="fr-status dim">${online ? (f.presence.location || 'In game') : 'Offline'}</div>`;
          const invite = el('button', 'btn btn-small', 'INVITE');
          invite.addEventListener('click', () => this.actions.inviteFriend?.(f));
          const rm = el('button', 'btn btn-small btn-danger', 'REMOVE');
          rm.addEventListener('click', () => this.actions.removeFriend?.(f));
          r.append(invite, rm);
          return r;
        });
        section('PENDING', data.outgoing || [], (f) => {
          const r = el('div', 'friend-row');
          r.innerHTML = `<div class="fr-name">${f.handle}</div><div class="fr-status dim">Request sent</div>`;
          const rm = el('button', 'btn btn-small btn-danger', 'CANCEL');
          rm.addEventListener('click', () => this.actions.removeFriend?.(f));
          r.appendChild(rm);
          return r;
        });
        if (!list.children.length) {
          list.appendChild(el('div', 'empty-state',
            'No friends yet.<br><span class="dim">Search for a commander by name to send a request.</span>'));
        }
      })
      .catch((e) => {
        clearChildren(list);
        list.appendChild(el('div', 'empty-state', 'Could not load friends.<br><span class="dim">' + (e?.message || e) + '</span>'));
      });
  }

  /** Show search results in the friends panel. */
  showSearchResults(people) {
    this.selectTab('friends');
    const list = this.panels.friends.querySelector('.friend-list');
    if (!list) return;
    clearChildren(list);
    list.appendChild(el('div', 'list-section', 'SEARCH RESULTS'));
    if (!people.length) { list.appendChild(el('div', 'empty-state dim', 'No commander found by that name.')); return; }
    for (const p of people) {
      const r = el('div', 'friend-row');
      r.appendChild(el('div', 'fr-name', p.handle));
      const add = el('button', 'btn btn-small btn-primary', '+ ADD');
      add.addEventListener('click', () => this.actions.addFriend?.(p));
      r.appendChild(add);
      list.appendChild(r);
    }
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

  // ---- REDEEM CODE modal ----
  showRedeem() {
    const m = this.redeemModal;
    clearChildren(m.body);
    m.body.appendChild(el('p', 'dim',
      'Got a secret code, Commander? Type it below and press REDEEM — the reward lands in your current career instantly. Each code works once per career.'));
    const row = el('div', 'form-row');
    const input = el('input', 'input');
    input.type = 'text';
    input.placeholder = 'Enter secret code';
    input.autocomplete = 'off';
    input.spellcheck = false;
    row.appendChild(input);
    m.body.appendChild(row);
    const status = el('div', 'form-status', '');
    const submit = () => {
      const code = input.value;
      if (!code.trim()) {
        status.textContent = 'Type a code first.';
        status.className = 'form-status error';
        return;
      }
      const res = this.actions.redeem?.(code) || { ok: false, reason: 'invalid' };
      if (res.ok) {
        status.textContent = `✔ ${res.label} — +${res.credits.toLocaleString()} CR added to this career.`;
        status.className = 'form-status ok';
        input.value = '';
      } else if (res.reason === 'already') {
        status.textContent = 'That code was already redeemed in this career.';
        status.className = 'form-status error';
      } else {
        status.textContent = 'Invalid code — check it and try again.';
        status.className = 'form-status error';
      }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const btnRow = el('div', 'btn-row');
    const go = el('button', 'btn btn-primary', 'REDEEM');
    go.addEventListener('click', submit);
    const back = el('button', 'btn', 'CLOSE');
    back.addEventListener('click', () => m.close());
    btnRow.append(go, back);
    m.body.appendChild(btnRow);
    m.body.appendChild(status);
    m.root.classList.remove('hidden');
    setTimeout(() => input.focus(), 0);
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
    mkRow('Aim assist', mkToggle(s.aimAssist !== false, v => this.actions.settingsChanged({ aimAssist: v })));
    mkRow('Music', mkSlider(s.music, v => this.actions.settingsChanged({ music: v })));
    mkRow('Sound FX', mkSlider(s.sfx, v => this.actions.settingsChanged({ sfx: v })));

    mkRow('UI click sounds', mkToggle(s.uiClicks !== false, v => this.actions.settingsChanged({ uiClicks: v })));
    mkRow('Haptics (touch)', mkToggle(s.haptics !== false, v => this.actions.settingsChanged({ haptics: v })));
    mkRow('Back button = pause', mkToggle(s.backPauses !== false, v => this.actions.settingsChanged({ backPauses: v })));
    mkRow('Object streaming', mkSelect([
      ['low', 'LOW — fewest objects'], ['medium', 'BALANCED'], ['high', 'HIGH — richest world']
    ], s.streaming || 'medium', v => this.actions.settingsChanged({ streaming: v })));
    mkRow('Cloud sync', mkToggle(s.cloudSync === true, v => this.actions.settingsChanged({ cloudSync: v })));

    m.body.appendChild(el('p', 'dim',
      'Settings are saved in this browser the moment you change them, and mirrored to your account when cloud sync is on — they survive starting a new career.'));

    const danger = el('div', 'btn-row');
    const reset = el('button', 'btn btn-danger', 'ERASE THIS CAREER');
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
        <tr><td>MOUSE</td><td>Look — click the canvas to capture. If the browser refuses pointer lock, hold the left mouse button and move to look.</td></tr>
        <tr><td>Q / X</td><td>Roll left / right</td></tr>
        <tr><td>SHIFT</td><td>Boost (uses more fuel & energy)</td></tr>
        <tr><td>B</td><td>Brake</td></tr>
        <tr><td>E</td><td>Interact — orbit · dock · mine (hold) · collect</td></tr>
        <tr><td>R</td><td>Scan targeted body</td></tr>
        <tr><td>T</td><td>Cycle target</td></tr>
        <tr><td>I</td><td>Info panel for current target</td></tr>
        <tr><td>M</td><td>Solar system map</td></tr>
        <tr><td>J</td><td>Mission log</td></tr>
        <tr><td>L</td><td>Land on any scanned body (cinematic descent → huge surface map)</td></tr>
        <tr><td>CO-OP</td><td>SERVERS → JOIN a gateway (or HOST your own). Friends on the same server share the map, see each other's ships and pool a shared cargo hold. INVITE from the FRIENDS tab.</td></tr>
        <tr><td>V</td><td>Toggle chase / free camera</td></tr>
        <tr><td>ESC</td><td>Pause</td></tr>
        <tr><td>SURFACE</td><td>After landing: E near the outpost = enter it (rest · eat · maintain · drive the rover). E near a broken rover = repair it for credits. E near the parked rover/shuttle = board it. Drive the rover with W/A/S/D; it follows the terrain.</td></tr>
        <tr><td>FOOD</td><td>Your astronaut gets hungry over time. Eat food rations at the outpost to restore satiety; buy more at stations / outposts. Run out of fuel is fatal — keep rations stocked.</td></tr>
        <tr><td>TOUCH</td><td>FPS layout (PUBG / Free Fire): left = move stick, right side = drag to look, big E = interact / hold to mine. Settings → Mobile controls.</td></tr>
      </table>
      <p class="dim">Aim assist (Settings) gently steers the nose toward the current target, like auto-aim in FFM / PUBG — toggle it off if you want full manual control.</p>
      <p class="dim">Goal: explore, scan, mine, trade and upgrade — complete the mission chain all the way to Neptune.</p>`;
    m.root.classList.remove('hidden');
  }
}
