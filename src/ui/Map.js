// Map — full-screen 2D solar system chart. Click a planet to inspect /
// set target / fast travel. Live positions from the running simulation.
import { el } from '../utils/UI.js';
import { PLANETS, MOONS, STATIONS, ANOMALIES } from '../config.js';

const MAX_ORBIT = Math.max(...PLANETS.map(p => p.orbitRadius));

export class MapView {
  constructor(root, callbacks) {
    this.rootEl = el('div', 'map-view hidden');
    this.rootEl.innerHTML = `
      <div class="map-head">
        <div class="map-title">SOLAR SYSTEM CHART</div>
        <div class="map-hint">Click a body to inspect · T in flight to cycle targets</div>
        <button class="btn btn-small" id="map-close">CLOSE</button>
      </div>
      <canvas class="map-canvas"></canvas>`;
    root.appendChild(this.rootEl);
    this.canvas = this.rootEl.querySelector('.map-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.rootEl.querySelector('#map-close').addEventListener('click', () => callbacks.close());
    this.canvas.addEventListener('pointerdown', (e) => this._onClick(e));
    this.onSelect = callbacks.select;
    this._resize = () => this._fit();
    window.addEventListener('resize', this._resize);
    this.planetInfo = {};
    for (const p of PLANETS) this.planetInfo[p.id] = p;
    this.open = false;
  }

  show() { this.rootEl.classList.remove('hidden'); this.open = true; this._fit(); }
  hide() { this.rootEl.classList.add('hidden'); this.open = false; }

  _fit() {
    const r = this.rootEl.getBoundingClientRect();
    this.canvas.width = r.width * devicePixelRatio;
    this.canvas.height = r.height * devicePixelRatio;
  }

  /** radial compression: sqrt-ish so outer planets still fit */
  _mapRadius(orbitRadius, maxR) {
    return maxR * Math.pow(orbitRadius / MAX_ORBIT, 0.62);
  }

  _project(x, y, size) {
    const maxR = Math.min(size.w, size.h) * 0.42;
    const r = Math.hypot(x, y);
    if (r < 1e-6) return { x: size.w / 2, y: size.h / 2, rr: 0 };
    const mr = this._mapRadius(r, maxR);
    return { x: size.w / 2 + (x / r) * mr, y: size.h / 2 + (y / r) * mr, rr: mr };
  }

  render(game) {
    if (!this.open) return;
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    const dpr = devicePixelRatio;
    ctx.scale(dpr, dpr);
    const W = w / dpr, H = h / dpr;
    const maxR = Math.min(W, H) * 0.44;

    // deep-space backdrop (gradient when the 2D context supports it)
    if (typeof ctx.createRadialGradient === 'function') {
      const bg = ctx.createRadialGradient(W / 2, H / 2, 4, W / 2, H / 2, maxR * 1.2);
      bg.addColorStop(0, 'rgba(20, 36, 70, 0.55)');
      bg.addColorStop(0.55, 'rgba(6, 12, 28, 0.2)');
      bg.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = bg;
    } else {
      ctx.fillStyle = 'rgba(8, 14, 28, 0.35)';
    }
    ctx.fillRect(0, 0, W, H);

    // faint star dust
    if (!this._stars) {
      this._stars = Array.from({ length: 90 }, () => ({
        x: Math.random(), y: Math.random(), r: 0.4 + Math.random() * 1.2, a: 0.25 + Math.random() * 0.55
      }));
    }
    for (const s of this._stars) {
      ctx.fillStyle = `rgba(200,220,255,${s.a})`;
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // AU grid rings (subtle distance markers)
    ctx.strokeStyle = 'rgba(90,120,170,0.12)';
    ctx.lineWidth = 1;
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(120,150,190,0.45)';
    ctx.textAlign = 'left';
    for (const au of [0.5, 1, 2, 5, 10, 20, 30]) {
      // match config compression roughly: 40 + 120 * AU^0.72
      const orbit = 40 + 120 * Math.pow(au, 0.72);
      const mr = this._mapRadius(orbit, maxR);
      ctx.beginPath(); ctx.arc(W / 2, H / 2, mr, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText(au + ' AU', W / 2 + mr + 4, H / 2 - 2);
    }

    // planetary orbits (thicker, labelled)
    for (const p of PLANETS) {
      const mr = this._mapRadius(p.orbitRadius, maxR);
      ctx.strokeStyle = 'rgba(110,150,210,0.32)';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, mr, 0, Math.PI * 2);
      ctx.stroke();
    }
    // belt band
    const rb1 = this._mapRadius(252, maxR);
    const rb2 = this._mapRadius(300, maxR);
    ctx.strokeStyle = 'rgba(180,140,80,0.28)';
    ctx.lineWidth = Math.max(6, (rb2 - rb1));
    ctx.beginPath(); ctx.arc(W / 2, H / 2, (rb1 + rb2) / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = 'rgba(200,160,90,0.45)';
    ctx.beginPath(); ctx.arc(W / 2, H / 2, (rb1 + rb2) / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    const dots = [];
    const dot = (x, y, r, color, label, id, kind, glow) => {
      const p = this._project(x, y, { w: W, h: H });
      dots.push({ ...p, id, kind, label, r });
      if (glow && typeof ctx.createRadialGradient === 'function') {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
        g.addColorStop(0, color + 'aa');
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      // rim
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.fillStyle = 'rgba(220,235,255,0.92)';
      ctx.font = kind === 'planet' ? 'bold 11px system-ui, sans-serif' : '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, p.x, p.y - r - 6);
    };

    // sun
    dot(0, 0, 9, '#ffcf6e', 'SOL', 'sun', 'star', true);
    // planets + moons + stations
    for (const p of PLANETS) {
      const body = game.solar.getBody(p.id);
      if (!body) continue;
      const pos = body.group.position;
      const vis = game.gs.state.visited.includes(p.id);
      const scanned = game.gs.state.discoveries.includes(p.id);
      const col = vis
        ? '#' + p.color.toString(16).padStart(6, '0')
        : scanned ? '#8aa0c0' : '#4a5568';
      const pr = p.radius > 6 ? 6.5 : p.radius > 3 ? 5 : 3.8;
      dot(pos.x, pos.z, pr, col, p.name, p.id, 'planet', vis);
      // landable marker
      if (scanned) {
        const pp = this._project(pos.x, pos.z, { w: W, h: H });
        ctx.strokeStyle = 'rgba(125,255,168,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(pp.x, pp.y, pr + 4, 0, Math.PI * 2); ctx.stroke();
      }
      for (const moon of (game.solar.moonsByPlanet.get(p.id) || [])) {
        const mp = moon.group.position;
        const mvis = game.gs.state.visited.includes(moon.id);
        const mscan = game.gs.state.discoveries.includes(moon.id);
        dot(mp.x, mp.z, 2.2, mvis ? '#cfd8e8' : mscan ? '#8a96aa' : '#3a4558', moon.name, moon.id, 'moon', false);
      }
    }
    for (const st of game.solar.stations) {
      dot(st.group.position.x, st.group.position.z, 2.8,
        '#' + st.cfg.color.toString(16).padStart(6, '0'), '◆ ' + (st.name || ''), st.id, 'station', false);
    }
    for (const an of game.solar.anomalies) {
      if (game.gs.state.anomalies.includes(an.cfg.id)) continue;
      dot(an.pos.x, an.pos.z, 2.6, '#e86aff', '?', an.cfg.id, 'anomaly', true);
    }

    // crew ships (multiplayer)
    if (game.mp?.active) {
      for (const p of game.mp.peerList) {
        if (!p.pos || (typeof p.mode === 'string' && p.mode.startsWith('surface'))) continue;
        const rp = this._project(p.pos[0], p.pos[2], { w: W, h: H });
        ctx.fillStyle = '#7dffa8';
        ctx.beginPath();
        ctx.moveTo(rp.x, rp.y - 5); ctx.lineTo(rp.x + 3.5, rp.y + 4); ctx.lineTo(rp.x - 3.5, rp.y + 4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(125,255,168,0.9)';
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.handle || 'CREW', rp.x, rp.y + 14);
      }
    }

    // ship
    const sp = this._project(game.shipState.position.x, game.shipState.position.z, { w: W, h: H });
    ctx.save();
    ctx.translate(sp.x, sp.y);
    const fwd = game.forwardFlat();
    ctx.rotate(Math.atan2(fwd.x, -fwd.z) * -1 + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(110,198,255,0.8)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(5, 7); ctx.lineTo(0, 4); ctx.lineTo(-5, 7);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('YOU', sp.x, sp.y + 18);

    // target line
    const tgt = game.target;
    if (tgt) {
      const tp = dots.find(d => d.id === tgt.id);
      if (tp) {
        ctx.strokeStyle = 'rgba(255,180,80,0.8)';
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(tp.x, tp.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#ffb450';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(tp.x, tp.y, 11, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    // legend
    ctx.textAlign = 'left';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(180,200,230,0.7)';
    ctx.fillText('● visited   ○ scanned (landable)   ◆ station   ? anomaly', 16, H - 14);

    this._dots = dots;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  _onClick(e) {
    if (!this._dots) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let best = null, bestD = 22;
    for (const d of this._dots) {
      const dist = Math.hypot(d.x - mx, d.y - my);
      if (dist < bestD) { best = d; bestD = dist; }
    }
    if (best && this.onSelect) this.onSelect(best.id, best.kind);
  }
}
