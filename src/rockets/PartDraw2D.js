// PartDraw2D — canvas-2D side-view painter for rocket parts.
//
// One painter used by TWO clients:
//   · Builder2D           — the 2D blueprint assembly mode (parts at scale)
//   · RocketBuilder       — the little icon next to each catalogue entry
//
// Only the canvas primitives our headless test stubs implement are used
// (fillRect / moveTo / lineTo / arc / gradients); anything fancier is
// feature-checked first, so a missing method can never break the builder.
import { texFamily } from './PartTextures.js';

export function hexToCss(hex, alpha = 1) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
function darken(hex, f = 0.55) {
  const r = ((hex >> 16) & 255) * f | 0, g = ((hex >> 8) & 255) * f | 0, b = (hex & 255) * f | 0;
  return `rgb(${r},${g},${b})`;
}

/** Outline path for a part silhouette (also used for clipping). */
function silhouettePath(ctx, part, x, y, r, h) {
  const x0 = x - r, x1 = x + r, y0 = y - h / 2, y1 = y + h / 2;
  ctx.beginPath();
  switch (part.shape) {
    case 'cone':
      ctx.moveTo(x, y0); ctx.lineTo(x1, y1); ctx.lineTo(x0, y1); ctx.closePath();
      return;
    case 'nozzle': {
      const nw = r * 0.55;
      ctx.moveTo(x - nw, y0); ctx.lineTo(x + nw, y0);
      ctx.lineTo(x + r * 0.82, (y0 + y1) / 2); ctx.lineTo(x1, y1);
      ctx.lineTo(x0, y1); ctx.lineTo(x - r * 0.82, (y0 + y1) / 2);
      ctx.closePath();
      return;
    }
    case 'taper':
      ctx.moveTo(x - r * 0.6, y0); ctx.lineTo(x + r * 0.6, y0);
      ctx.lineTo(x1, y1); ctx.lineTo(x0, y1); ctx.closePath();
      return;
    case 'sphere':
      ctx.arc(x, y, Math.min(r, h / 2), 0, Math.PI * 2);
      return;
    case 'dish':
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y0);
      ctx.lineTo(x + r * 0.18, y1); ctx.lineTo(x - r * 0.18, y1); ctx.closePath();
      return;
    case 'panel':
    case 'box':
    case 'ring':
    case 'cylinder':
    default:
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y1); ctx.lineTo(x0, y1); ctx.closePath();
      return;
  }
}

/**
 * Draw a part's side profile centred on (x, y).
 * @param scale px per world unit
 * @param opts  { ghost, snapped } — ghost renders translucent with a tint
 */
export function drawPartSide(ctx, part, x, y, scale, opts = {}) {
  const r = (part.r || 0.5) * scale;
  const h = Math.max(2, (part.h || 0.6) * scale);
  const x0 = x - r, y0 = y - h / 2, w = r * 2;

  ctx.save();
  if (opts.ghost) ctx.globalAlpha = 0.55;

  // ------------------------------------------------ silhouette
  silhouettePath(ctx, part, x, y, r, h);
  ctx.fillStyle = opts.ghost
    ? (opts.snapped ? '#7dffa8' : '#ff9d5c')
    : hexToCss(part.color ?? 0xcccccc);
  ctx.fill();
  // Panels are drawn as thin slabs regardless of `h`.
  if (part.shape === 'panel' && !opts.ghost) {
    ctx.fillStyle = darken(part.color ?? 0xcccccc, 0.85);
    ctx.fillRect(x - r * 1.05, y - Math.max(1.5, h * 0.1), r * 2.1, Math.max(3, h * 0.2));
  }

  if (!opts.ghost) {
    // Keep the surface detail inside the silhouette.
    silhouettePath(ctx, part, x, y, r, h);
    if (typeof ctx.clip === 'function') ctx.clip();
    drawDetail(ctx, part, texFamily(part), x, y, r, h, x0, x0 + w, y0, y0 + h);
  }
  ctx.restore();

  // outline on top of everything
  silhouettePath(ctx, part, x, y, r, h);
  ctx.strokeStyle = opts.ghost ? 'rgba(255,255,255,0.65)' : darken(part.color ?? 0xcccccc, 0.4);
  ctx.lineWidth = Math.max(1, scale * 0.045);
  ctx.stroke();
}

function drawDetail(ctx, part, fam, x, y, r, h, x0, x1, y0, y1) {
  const w = r * 2;
  const strokeV = (xx, a, b) => { ctx.beginPath(); ctx.moveTo(xx, a); ctx.lineTo(xx, b); ctx.stroke(); };
  const strokeH = (yy, a, b) => { ctx.beginPath(); ctx.moveTo(a, yy); ctx.lineTo(b, yy); ctx.stroke(); };

  switch (fam) {
    case 'tank':
    case 'cryo': {
      ctx.fillStyle = 'rgba(60,70,84,0.35)';
      ctx.fillRect(x0, y0 + h * 0.08, w, Math.max(1, h * 0.035));
      ctx.fillRect(x0, y1 - h * 0.115, w, Math.max(1, h * 0.035));
      ctx.fillStyle = 'rgba(40,50,64,0.28)';
      ctx.fillRect(x0, y - h * 0.1, w, h * 0.2);       // stencil band
      if (fam === 'cryo') {
        ctx.fillStyle = 'rgba(200,230,255,0.45)';
        for (let i = 0; i < 7; i++) ctx.fillRect(x0 + ((i * 37) % Math.max(1, w - 5)), y0 + ((i * 53) % Math.max(1, h - 5)), 4, 4);
      }
      break;
    }
    case 'radial': {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.30)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0.30)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, w, h);
      break;
    }
    case 'solid': {
      ctx.fillStyle = 'rgba(90,98,110,0.45)';
      const segs = 4;
      for (let i = 1; i < segs; i++) ctx.fillRect(x0, y0 + (h / segs) * i - 1, w, 2);
      ctx.fillStyle = '#e6b23a';
      ctx.fillRect(x0, y0, w, Math.max(2, h * 0.07));
      ctx.fillStyle = '#23262b';
      ctx.fillRect(x0 + w * 0.25, y0, w * 0.5, Math.max(2, h * 0.07));
      break;
    }
    case 'engine': {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, 'rgba(255,255,255,0.16)');
      g.addColorStop(1, 'rgba(120,70,30,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, w, h);
      ctx.strokeStyle = 'rgba(150,160,170,0.45)';
      for (let i = 1; i < 4; i++) strokeV(x0 + (w / 4) * i, y0, y1);
      break;
    }
    case 'hazard': {
      ctx.fillStyle = '#e8b83c';
      ctx.fillRect(x0, y0, w, h);
      ctx.fillStyle = '#23262b';
      const s = Math.max(3, w / 6);
      for (let i = -2; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(x0 + i * s, y1); ctx.lineTo(x0 + i * s + s / 2, y1);
        ctx.lineTo(x0 + i * s + s / 2 + h, y0); ctx.lineTo(x0 + i * s + h, y0);
        ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'capsule':
    case 'cockpit': {
      ctx.fillStyle = 'rgba(20,30,42,0.85)';
      const wy = y + h * 0.12;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(x + i * Math.min(w * 0.28, r * 0.55), wy, Math.max(1.5, h * 0.07), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(190,60,40,0.7)';
      ctx.fillRect(x0, y1 - h * 0.18, w, Math.max(1, h * 0.05));
      break;
    }
    case 'probe': {
      ctx.fillStyle = 'rgba(230,180,60,0.5)';
      const s = Math.max(2, w / 8);
      let k = 0;
      for (let yy = y0; yy < y1; yy += s) {
        for (let xx = x0; xx < x1; xx += s, k++) {
          if (k % 2 === 0) ctx.fillRect(xx, yy, s, s);
        }
      }
      break;
    }
    case 'solar': {
      ctx.fillStyle = '#14294a';
      ctx.fillRect(x0, y0, w, h);
      ctx.strokeStyle = '#9fb2c8';
      const s = Math.max(3, w / 6);
      for (let xx = x0; xx <= x1; xx += s) strokeV(xx, y0, y1);
      for (let yy = y0; yy <= y1; yy += s) strokeH(yy, x0, x1);
      break;
    }
    case 'ablator': {
      ctx.fillStyle = 'rgba(46,32,22,0.6)';
      ctx.fillRect(x0, y0, w, h);
      ctx.strokeStyle = 'rgba(130,98,70,0.85)';
      const s = Math.max(3, w / 7);
      for (let xx = x0; xx < x1; xx += s) strokeV(xx, y0, y1);
      for (let yy = y0; yy < y1; yy += s) strokeH(yy, x0, x1);
      break;
    }
    case 'battery': {
      ctx.fillStyle = '#57d977';
      const bw = Math.max(2, w * 0.16);
      for (let i = 0; i < 3; i++) ctx.fillRect(x0 + w * (0.18 + i * 0.28), y - h * 0.12, bw, Math.max(2, h * 0.24));
      break;
    }
    case 'girder': {
      ctx.strokeStyle = 'rgba(50,58,70,0.8)';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, y0); ctx.lineTo(x0, y1); ctx.stroke();
      break;
    }
    case 'dock': {
      ctx.strokeStyle = 'rgba(40,48,58,0.9)';
      ctx.beginPath(); ctx.arc(x, y, Math.max(2, Math.min(r * 0.5, h * 0.4)), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(120,220,140,0.9)';
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, r * 0.09), 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'dish': {
      ctx.strokeStyle = 'rgba(120,130,144,0.8)';
      for (let i = 1; i <= 2; i++) strokeH(y0 + h * i * 0.28, x0 + w * i * 0.12, x1 - w * i * 0.12);
      break;
    }
    case 'optics': {
      ctx.fillStyle = 'rgba(5,6,10,0.9)';
      ctx.beginPath(); ctx.arc(x, y, Math.max(2, Math.min(r, h / 2) * 0.4), 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(220,180,70,0.8)';
      ctx.beginPath(); ctx.arc(x, y, Math.max(2, Math.min(r, h / 2) * 0.4), 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'fins': {
      ctx.strokeStyle = 'rgba(170,80,50,0.85)';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.4, y1); ctx.lineTo(x, y1 - h * 0.4); ctx.lineTo(x + r * 0.4, y1);
      ctx.stroke();
      break;
    }
    case 'fairing': {
      ctx.strokeStyle = 'rgba(110,120,134,0.55)';
      strokeV(x, y0, y1);
      ctx.fillStyle = 'rgba(200,60,40,0.65)';
      ctx.fillRect(x0, y1 - Math.max(2, h * 0.09), w, Math.max(1.5, h * 0.05));
      break;
    }
    default: { // hull: panel seams + rivets
      ctx.strokeStyle = 'rgba(90,100,114,0.45)';
      strokeH(y0 + h * 0.33, x0, x1);
      strokeH(y0 + h * 0.66, x0, x1);
      ctx.fillStyle = 'rgba(70,80,94,0.5)';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.arc(x0 + w * (0.2 + i * 0.3), y0 + h * 0.1, Math.max(1, w * 0.015), 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
  }
}

/** Palette icon: fit the part into a small square canvas. */
export function drawPartIcon(canvas, part) {
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) return;
  try {
    const w = canvas.width || 44, h = canvas.height || 44;
    ctx.clearRect(0, 0, w, h);
    const scale = Math.min((w * 0.62) / Math.max(0.4, (part.r || 0.5) * 2), (h * 0.86) / Math.max(0.4, part.h || 0.6));
    drawPartSide(ctx, part, w / 2, h / 2, scale);
  } catch { /* cosmetic only */ }
}
