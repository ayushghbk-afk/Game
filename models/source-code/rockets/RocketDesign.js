// RocketDesign — the v2 rocket format: parts placed in 3D SPACE.
//
// v1 was a linear stack (`parts: [{id, qty}]`), which is all a text list can
// express. The 3D builder lets you drag a part anywhere, snap it to another
// part's attachment node, and strap boosters onto the sides — so a design is
// now a set of PLACEMENTS:
//
//     { version: 2, name, parts: [{ uid, id, pos: [x, y, z], radial }] }
//
// `pos` is the part's CENTRE in builder space (metres, +Y up). `radial` marks
// a part attached to the side of the core rather than stacked in-line, which
// is what makes strap-on boosters burn with the first stage instead of
// forming their own.
//
// Staging is derived from geometry rather than list order: parts are grouped
// by height, and every decoupler is a stage boundary — everything BELOW it
// separates when its fuel is spent. That means the stages you see in the 3D
// view are exactly the ones the flight simulates.
import { getPart, PART_BY_ID, setStageResolver } from './RocketParts.js';

export const DESIGN_VERSION = 2;

let uidCounter = 0;
export function newUid() {
  uidCounter++;
  return 'p' + Date.now().toString(36) + '-' + uidCounter.toString(36);
}

/**
 * Attachment nodes a part exposes, in LOCAL space (relative to its centre).
 *   top / bottom — in-line stacking
 *   radial       — surface attach points around the hull (boosters, RCS…)
 */
export function nodesOf(part) {
  if (!part) return [];
  const h = part.h || 0.6;
  const r = part.r || 0.5;
  const nodes = [];
  // Nose cones and capsules only attach underneath.
  const noTop = part.nose || (part.shape === 'cone' && (part.cat === 'command' || part.id === 'fairing'));
  if (!noTop) nodes.push({ kind: 'top', x: 0, y: h / 2, z: 0 });
  nodes.push({ kind: 'bottom', x: 0, y: -h / 2, z: 0 });
  // Radial nodes around the hull for tanks and structural parts.
  if (!part.nose && (part.cat === 'fuel' || part.cat === 'structure' || part.cat === 'booster')) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      nodes.push({ kind: 'radial', x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r, angle: a });
    }
  }
  return nodes;
}

/** World-space attachment nodes for a placement. */
export function worldNodes(placement) {
  const part = getPart(placement.id);
  const [px, py, pz] = placement.pos;
  return nodesOf(part).map(n => ({
    ...n,
    uid: placement.uid,
    wx: px + n.x, wy: py + n.y, wz: pz + n.z
  }));
}

export function partHeight(placement) {
  return getPart(placement.id)?.h || 0.6;
}
export function partRadius(placement) {
  return getPart(placement.id)?.r || 0.5;
}

/** An empty design. */
export function emptyDesign(name = 'New rocket') {
  return { version: DESIGN_VERSION, name, parts: [] };
}

/**
 * Where would `partId` land if dropped near (x, y, z)?
 * Returns { pos, snapped, node } — snapping to the closest free attachment
 * node within `tolerance`, otherwise the raw position (resting on the ground).
 */
export function resolveDrop(design, partId, x, y, z, tolerance = 1.4, ignoreUid = null) {
  const part = getPart(partId);
  if (!part) return null;
  const h = part.h || 0.6;
  const r = part.r || 0.5;

  let best = null, bestD = Infinity;
  for (const placement of design.parts) {
    if (placement.uid === ignoreUid) continue;
    for (const node of worldNodes(placement)) {
      // Where our part's centre would sit if we attached here.
      let cx = node.wx, cy = node.wy, cz = node.wz, radial = false;
      if (node.kind === 'top') cy += h / 2;
      else if (node.kind === 'bottom') cy -= h / 2;
      else {
        // Radial: push out by our own radius so the hulls touch.
        const len = Math.hypot(node.x, node.z) || 1;
        cx = node.wx + (node.x / len) * r;
        cz = node.wz + (node.z / len) * r;
        radial = true;
      }
      const d = Math.hypot(cx - x, cy - y, cz - z);
      if (d < bestD && d <= tolerance) {
        bestD = d;
        best = { pos: [cx, cy, cz], snapped: true, radial, node: node.kind, parentUid: placement.uid };
      }
    }
  }
  if (best) return best;
  // Free placement — never below the pad.
  return { pos: [x, Math.max(h / 2, y), z], snapped: false, radial: false, node: null, parentUid: null };
}

/** Add a part, returning the new placement. */
export function addPart(design, partId, pos, opts = {}) {
  if (!PART_BY_ID.has(partId)) return null;
  const placement = {
    uid: newUid(),
    id: partId,
    pos: [pos[0], pos[1], pos[2]],
    radial: !!opts.radial
  };
  design.parts.push(placement);
  return placement;
}

export function removePart(design, uid) {
  const i = design.parts.findIndex(p => p.uid === uid);
  if (i >= 0) design.parts.splice(i, 1);
  return i >= 0;
}

export function findPart(design, uid) {
  return design.parts.find(p => p.uid === uid) || null;
}

/** Duplicate a placement slightly offset (the builder's COPY action). */
export function clonePart(design, uid) {
  const src = findPart(design, uid);
  if (!src) return null;
  const p = addPart(design, src.id, [src.pos[0] + (partRadius(src) * 2.2), src.pos[1], src.pos[2]], { radial: src.radial });
  return p;
}

/**
 * Mirror a radial part to the opposite side of the core — the "symmetry"
 * button every rocket builder needs so boosters come in balanced pairs.
 */
export function mirrorPart(design, uid) {
  const src = findPart(design, uid);
  if (!src) return null;
  const [x, y, z] = src.pos;
  if (Math.abs(x) < 0.01 && Math.abs(z) < 0.01) return null; // on the axis
  return addPart(design, src.id, [-x, y, -z], { radial: true });
}

/**
 * Derive flight STAGES from the 3D layout.
 * Parts are sorted bottom→top by their centre height. Each decoupler closes
 * the stage below it. Radial boosters join the stage they physically sit
 * alongside (matched by height overlap), which is how strap-ons behave.
 */
export function stackOrder(design) {
  const core = design.parts.filter(p => !p.radial).sort((a, b) => a.pos[1] - b.pos[1]);
  const radial = design.parts.filter(p => p.radial);
  return { core, radial };
}

export function derivedStages(design) {
  const { core, radial } = stackOrder(design);
  const stages = [];
  let current = [];
  for (const p of core) {
    if (getPart(p.id)?.stage) {
      stages.push(current);
      current = [];
    } else {
      current.push(p);
    }
  }
  stages.push(current);
  const nonEmpty = stages.filter(s => s.length);
  if (!nonEmpty.length) return radial.length ? [radial] : [];

  // Attach each radial part to the stage whose height range it overlaps most.
  for (const rp of radial) {
    const ry = rp.pos[1];
    let best = 0, bestD = Infinity;
    nonEmpty.forEach((stage, i) => {
      for (const sp of stage) {
        const d = Math.abs(sp.pos[1] - ry);
        if (d < bestD) { bestD = d; best = i; }
      }
    });
    nonEmpty[best].push(rp);
  }
  return nonEmpty;
}

/** Flat list of part definitions, bottom→top (for mass/cost sums). */
export function flatParts(design) {
  return derivedStages(design).flat().map(p => getPart(p.id)).filter(Boolean);
}

/** Overall bounding info, for camera framing and the ground plane. */
export function designBounds(design) {
  if (!design.parts.length) return { minY: 0, maxY: 1, height: 1, radius: 1 };
  let minY = Infinity, maxY = -Infinity, radius = 0.5;
  for (const p of design.parts) {
    const h = partHeight(p), r = partRadius(p);
    minY = Math.min(minY, p.pos[1] - h / 2);
    maxY = Math.max(maxY, p.pos[1] + h / 2);
    radius = Math.max(radius, Math.hypot(p.pos[0], p.pos[2]) + r);
  }
  return { minY, maxY, height: maxY - minY, radius };
}

/**
 * Is the rocket physically sound? Geometry problems the analysis cannot see:
 * floating parts, and a stack that does not reach the pad.
 */
export function structuralIssues(design) {
  const issues = [];
  if (!design.parts.length) return issues;
  const { minY } = designBounds(design);
  if (minY > 0.35) issues.push('The rocket is floating above the pad — drag the bottom part down.');

  // A part is "supported" when it touches another part or the ground.
  for (const p of design.parts) {
    const h = partHeight(p), r = partRadius(p);
    if (p.pos[1] - h / 2 <= 0.4) continue;               // on the pad
    const touches = design.parts.some(q => {
      if (q.uid === p.uid) return false;
      const qh = partHeight(q), qr = partRadius(q);
      const dy = Math.abs(p.pos[1] - q.pos[1]);
      const dxz = Math.hypot(p.pos[0] - q.pos[0], p.pos[2] - q.pos[2]);
      const vertical = dy <= (h + qh) / 2 + 0.25 && dxz <= Math.max(r, qr) + 0.25;
      const side = dxz <= r + qr + 0.3 && dy < (h + qh) / 2;
      return vertical || side;
    });
    if (!touches) {
      issues.push(`"${getPart(p.id)?.name || p.id}" is floating — nothing is holding it up.`);
    }
  }
  return [...new Set(issues)];
}

/** Convert a v1 linear stack into v2 placements (bottom→top). */
export function upgradeDesign(design) {
  if (!design) return emptyDesign();
  if (design.version === DESIGN_VERSION && Array.isArray(design.parts) && design.parts.every(p => p.pos)) {
    return { ...design, parts: design.parts.map(p => ({ ...p, uid: p.uid || newUid() })) };
  }
  const out = emptyDesign(design.name || 'Imported rocket');
  let y = 0;
  for (const entry of design.parts || []) {
    const part = getPart(entry.id);
    if (!part) continue;
    const qty = Math.max(1, Math.min(50, entry.qty || 1));
    for (let i = 0; i < qty; i++) {
      const h = part.h || 0.6;
      out.parts.push({ uid: newUid(), id: entry.id, pos: [0, y + h / 2, 0], radial: false });
      y += h;
    }
  }
  return out;
}

/** Validate + normalise an imported v2 design (file or another player). */
export function sanitizeDesign2(raw) {
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const design = obj?.design || obj;
  if (!design || !Array.isArray(design.parts)) throw new Error('Not a Solar Odyssey rocket file.');
  if (design.version !== DESIGN_VERSION) return upgradeDesign(design);

  const parts = design.parts
    .filter(p => PART_BY_ID.has(p.id) && Array.isArray(p.pos) && p.pos.length === 3)
    .filter(p => p.pos.every(n => Number.isFinite(n) && Math.abs(n) < 500))
    .slice(0, 250)
    .map(p => ({
      uid: newUid(),
      id: String(p.id),
      pos: [Number(p.pos[0]), Number(p.pos[1]), Number(p.pos[2])],
      radial: !!p.radial
    }));
  if (!parts.length) throw new Error('That design contains no recognised parts.');
  return { version: DESIGN_VERSION, name: String(design.name || 'Imported rocket').slice(0, 48), parts };
}

export function exportDesign2(design) {
  return JSON.stringify({ kind: 'solar-odyssey-rocket', version: DESIGN_VERSION, design }, null, 2);
}

// Teach analyzeDesign() how to stage a 3D design (see setStageResolver).
setStageResolver((design) => derivedStages(design).map(stage =>
  stage.map(p => getPart(p.id)).filter(Boolean)));
