// Moon — orbits its parent planet. Positions are parent-relative.
import { Body } from './Planet.js';

export class Moon extends Body {
  constructor(cfg, seed, quality) {
    super(cfg, 'moon', seed, quality);
    this.parentId = cfg.parent;
    this.periodGameMin = cfg.period || 120;
    this.orbitOmega = (Math.PI * 2) / (this.periodGameMin * 60); // rad per game-second
  }

  computePosition(t, out) {
    this.angle = (this.cfg.phase || 0) + this.orbitOmega * t;
    out.set(Math.cos(this.angle) * this.cfg.orbitRadius, 0, -Math.sin(this.angle) * this.cfg.orbitRadius);
    return out;
  }

  /** World position = parent world position + local offset. */
  update(t, dtGameSeconds, parentPos) {
    super.update(t, dtGameSeconds, parentPos);
  }
}
