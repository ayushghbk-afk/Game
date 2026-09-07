// TimeSystem — accelerated game clock.
// 1 real second = 1 game minute at speed 1x (configurable 1x/10x/100x).
// Planet orbits, moons, rotation and stations all read this single clock.
const START_DATE = Date.UTC(2087, 2, 14, 6, 0, 0);

export class TimeSystem {
  constructor() {
    this.simSeconds = 0;   // elapsed game seconds
    this.speed = 1;        // 1 | 10 | 100
    this.paused = false;
  }

  update(dtReal) {
    if (!this.paused) this.simSeconds += dtReal * 60 * this.speed;
  }

  get gameMinutes() { return this.simSeconds / 60; }

  setSpeed(s) { this.speed = s; }
  cycleSpeed() {
    this.speed = this.speed === 1 ? 10 : this.speed === 10 ? 100 : 1;
    return this.speed;
  }

  /** In-game stardate string. */
  dateString() {
    const d = new Date(START_DATE + this.simSeconds * 1000);
    return d.toISOString().slice(0, 10).replace(/-/g, '.') + ' ' +
      d.toISOString().slice(11, 16);
  }
}
