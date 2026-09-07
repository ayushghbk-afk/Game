// ObjectStreamer — keeps a planet surface populated around the player without
// keeping the WHOLE map in memory.
//
// The surface is 1800×1800 units of terrain. Building every rock, boulder field
// and prop for all of it up front is what makes landing on a big world stutter
// and eventually blow the GPU budget on phones. Instead the map is divided into
// a grid of CELLS: cells inside the player's radius are GENERATED on demand,
// cells that fall outside are DISPOSED (geometry + material freed) and their
// contents forgotten. Walk back and the cell regenerates identically, because
// every cell's contents come from a deterministic seed derived from its
// coordinates — no bookkeeping, no drift.
//
// The generator callback owns what a cell contains; this class only owns the
// lifecycle. That keeps it reusable for surface props, debris, wildlife, etc.

/** Budget presets exposed in Settings → Object streaming. */
export const STREAM_BUDGETS = {
  // Slightly larger cells + higher live-cell caps so the 1800-unit surface
  // still feels dense without spiking frame time on mid-range GPUs.
  low: { cell: 110, radius: 2, maxCells: 30 },
  medium: { cell: 90, radius: 3, maxCells: 72 },
  high: { cell: 75, radius: 4, maxCells: 130 }
};

export class ObjectStreamer {
  /**
   * @param scene      THREE.Scene (or Group) cells are added to
   * @param generate   (cx, cz, bounds, seed) => THREE.Object3D | null
   * @param opts       { cellSize, radius, maxCells, quality }
   */
  constructor(scene, generate, opts = {}) {
    const budget = STREAM_BUDGETS[opts.quality] || STREAM_BUDGETS.medium;
    this.scene = scene;
    this.generate = generate;
    this.cellSize = opts.cellSize ?? budget.cell;
    this.radius = opts.radius ?? budget.radius;      // in cells
    this.maxCells = opts.maxCells ?? budget.maxCells;
    this.seedBase = opts.seed ?? 1;
    this.cells = new Map();      // "cx,cz" -> { obj, cx, cz, lastSeen }
    this.frame = 0;
    this.stats = { created: 0, disposed: 0, live: 0 };
    this._budgetPerTick = opts.budgetPerTick ?? 2;   // cells created per update
  }

  key(cx, cz) { return cx + ',' + cz; }

  cellOf(x, z) {
    return [Math.floor(x / this.cellSize), Math.floor(z / this.cellSize)];
  }

  /** Deterministic per-cell seed — same cell always yields the same content. */
  seedFor(cx, cz) {
    // Hash the signed coordinates into a positive 32-bit integer.
    let h = this.seedBase | 0;
    h = (h * 73856093) ^ (cx * 19349663) ^ (cz * 83492791);
    h = h >>> 0;
    return h || 1;
  }

  bounds(cx, cz) {
    const s = this.cellSize;
    return { x0: cx * s, z0: cz * s, x1: (cx + 1) * s, z1: (cz + 1) * s, size: s,
             cx: cx * s + s / 2, cz: cz * s + s / 2 };
  }

  /**
   * Call every frame with the player's position. Generates missing cells within
   * `radius` (rate-limited so a long walk never spikes a frame) and disposes
   * everything outside it.
   */
  update(x, z) {
    this.frame++;
    const [pcx, pcz] = this.cellOf(x, z);
    const r = this.radius;
    let budget = this._budgetPerTick;

    // ---- ensure cells near the player exist ----
    // Nearest-first so what is in front of the player appears first.
    const wanted = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        wanted.push({ cx: pcx + dx, cz: pcz + dz, d2 });
      }
    }
    wanted.sort((a, b) => a.d2 - b.d2);

    const alive = new Set();
    for (const w of wanted) {
      const k = this.key(w.cx, w.cz);
      alive.add(k);
      const existing = this.cells.get(k);
      if (existing) { existing.lastSeen = this.frame; continue; }
      if (budget <= 0) continue;
      budget--;
      this._create(w.cx, w.cz);
    }

    // ---- dispose everything the player has left behind ----
    for (const [k, cell] of this.cells) {
      if (alive.has(k)) continue;
      this._dispose(k, cell);
    }

    // Hard cap: if a pathological case (teleport, huge radius) leaves too many
    // cells alive, drop the least recently seen ones.
    if (this.cells.size > this.maxCells) {
      const sorted = [...this.cells.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      for (let i = 0; i < sorted.length - this.maxCells; i++) {
        this._dispose(sorted[i][0], sorted[i][1]);
      }
    }

    this.stats.live = this.cells.size;
    return this.stats;
  }

  _create(cx, cz) {
    let obj = null;
    try {
      obj = this.generate(cx, cz, this.bounds(cx, cz), this.seedFor(cx, cz));
    } catch (e) {
      console.warn('cell generation failed', cx, cz, e);
    }
    if (!obj) {
      // Remember the empty cell too, so we don't retry it every frame.
      this.cells.set(this.key(cx, cz), { obj: null, cx, cz, lastSeen: this.frame });
      return;
    }
    this.scene.add(obj);
    this.cells.set(this.key(cx, cz), { obj, cx, cz, lastSeen: this.frame });
    this.stats.created++;
  }

  _dispose(key, cell) {
    this.cells.delete(key);
    const obj = cell?.obj;
    if (!obj) return;
    obj.removeFromParent();
    obj.traverse?.((o) => {
      // Geometry flagged as shared (e.g. one boulder mesh reused by every
      // cell's InstancedMesh) belongs to the owner, not to the cell.
      if (!o.userData?.sharedGeometry) o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
    });
    this.stats.disposed++;
  }

  /** Free everything (leaving a planet). */
  clear() {
    for (const [k, cell] of [...this.cells]) this._dispose(k, cell);
    this.cells.clear();
    this.stats.live = 0;
  }

  setQuality(quality) {
    const b = STREAM_BUDGETS[quality] || STREAM_BUDGETS.medium;
    this.cellSize = b.cell;
    this.radius = b.radius;
    this.maxCells = b.maxCells;
    this.clear();
  }
}
