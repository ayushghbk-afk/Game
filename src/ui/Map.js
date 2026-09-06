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
    const size = { w, h };
    ctx.clearRect(0, 0, w, h);
    const dpr = devicePixelRatio;
    ctx.scale(dpr, dpr);
    const W = w / dpr, H = h / dpr;

    // orbits
    for (const p of PLANETS) {
      const mr = this._mapRadius(p.orbitRadius, Math.min(W, H) * 0.42);
      ctx.strokeStyle = 'rgba(110,140,190,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, mr, 0, Math.PI * 2);
      ctx.stroke();
    }
    // belt
    const rb1 = this._mapRadius(252, Math.min(W, H) * 0.42);
    const rb2 = this._mapRadius(300, Math.min(W, H) * 0.42);
    ctx.strokeStyle = 'rgba(160,130,90,0.3)';
    ctx.setLineDash([2, 5]);
    ctx.beginPath(); ctx.arc(W / 2, H / 2, (rb1 + rb2) / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    const dots = [];
    const dot = (x, y, r, color, label, id, kind) => {
      const p = this._project(x, y, { w: W, h: H });
      dots.push({ ...p, id, kind, label });
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(210,225,255,0.85)';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, p.x, p.y - r - 5);
    };

    // sun
    dot(0, 0, 7, '#ffcf6e', 'SOL', 'sun', 'star');
    // planets + moons + stations
    for (const p of PLANETS) {
      const body = game.solar.getBody(p.id);
      const pos = body.group.position;
      const vis = game.gs.state.visited.includes(p.id);
      dot(pos.x, pos.z, p.radius > 6 ? 5 : 3.4, vis ? '#' + p.color.toString(16).padStart(6, '0') : '#5a6a85',
        p.name, p.id, 'planet');
      for (const moon of (game.solar.moonsByPlanet.get(p.id) || [])) {
        const mp = moon.group.position;
        const mvis = game.gs.state.visited.includes(moon.id);
        dot(mp.x, mp.z, 2, mvis ? '#cfd8e8' : '#4a5568', moon.name, moon.id, 'moon');
      }
    }
    for (const st of game.solar.stations) {
      dot(st.group.position.x, st.group.position.z, 2.6, '#' + st.cfg.color.toString(16).padStart(6, '0'), '◆', st.id, 'station');
    }
    for (const an of game.solar.anomalies) {
      if (game.gs.state.anomalies.includes(an.cfg.id)) continue;
      dot(an.pos.x, an.pos.z, 2.4, '#e86aff', '?', an.cfg.id, 'anomaly');
    }

    // ship
    const sp = this._project(game.shipState.position.x, game.shipState.position.z, { w: W, h: H });
    ctx.save();
    ctx.translate(sp.x, sp.y);
    const fwd = game.forwardFlat();
    ctx.rotate(Math.atan2(fwd.x, -fwd.z) * -1 + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(4.5, 6); ctx.lineTo(0, 3.4); ctx.lineTo(-4.5, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('YOU', sp.x, sp.y + 18);

    // target line
    const tgt = game.target;
    if (tgt) {
      const tp = dots.find(d => d.id === tgt.id);
      if (tp) {
        ctx.strokeStyle = 'rgba(255,180,80,0.75)';
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(tp.x, tp.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#ffb450';
        ctx.beginPath(); ctx.arc(tp.x, tp.y, 9, 0, Math.PI * 2); ctx.stroke();
      }
    }
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
