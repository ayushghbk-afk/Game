// ShipPhysics — arcade-newtonian flight: thrust, momentum, gravity, drag,
// soft speed limit, collisions with planets/moons/stations. Smooth accel only.
import * as THREE from 'three';
import { applyGravity } from '../physics/GravitySystem.js';

const FWD = new THREE.Vector3(0, 0, -1);
const RIGHT = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _acc = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _n = new THREE.Vector3();

export class ShipPhysics {
  constructor(ship) {
    this.ship = ship; // state container {position, quaternion, velocity, fuel, energy, shield, hull,...}
  }

  /**
   * @param dt            real delta seconds
   * @param input         {throttleF:-1..1, strafe:-1..1, vert:-1..1, boost, brake, yawDelta, pitchDelta, rollDelta}
   * @param stats         from shipStats()
   * @param bodies        gravity sources (planets+moons)
   * @param events        {onDamage(amount), onThrust(amount)} optional
   */
  update(dt, input, stats, bodies, events = {}) {
    const ship = this.ship;
    const q = ship.quaternion;

    // ---- rotation (mouse deltas this frame, radians) ----
    if (input.yawDelta || input.pitchDelta || input.rollDelta) {
      const dq = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(input.pitchDelta, input.yawDelta, input.rollDelta, 'YXZ')
      );
      q.multiply(dq).normalize();
    }

    // ---- thrust ----
    _acc.set(0, 0, 0);
    _dir.copy(FWD).applyQuaternion(q);
    _n.copy(RIGHT).applyQuaternion(q);
    const up = UP.clone().applyQuaternion(q);

    const hasFuel = ship.fuel > 0;
    const boosting = input.boost && hasFuel && ship.energy > 1;
    const thrustMul = boosting ? 2.7 : 1;

    if (hasFuel) {
      const t = stats.thrust * thrustMul;
      if (input.throttleF !== 0) _acc.addScaledVector(_dir, t * input.throttleF * (input.throttleF < 0 ? 0.55 : 1));
      if (input.strafe !== 0) _acc.addScaledVector(_n, t * 0.6 * input.strafe);
      if (input.vert !== 0) _acc.addScaledVector(up, t * 0.6 * input.vert);
    }
    const throttleMag = Math.min(1, Math.abs(input.throttleF) + Math.abs(input.strafe) * 0.6 + Math.abs(input.vert) * 0.6);
    if (throttleMag > 0 && events.onThrust) events.onThrust(throttleMag, boosting);

    // fuel burn
    if (hasFuel && throttleMag > 0) {
      ship.fuel = Math.max(0, ship.fuel - (throttleMag * 1.5 + (boosting ? 3.4 : 0)) * dt / stats.efficiency);
    }
    if (boosting) ship.energy = Math.max(0, ship.energy - 3 * dt);

    // ---- gravity ----
    this.lastGravityBody = applyGravity(ship.position, bodies, _acc);

    // ---- integrate ----
    ship.velocity.addScaledVector(_acc, dt);
    if (input.brake) ship.velocity.multiplyScalar(Math.max(0, 1 - 3.2 * dt));
    // light "solar wind" drag keeps the ship controllable
    ship.velocity.multiplyScalar(Math.max(0, 1 - 0.06 * dt));

    const maxS = boosting ? stats.boostSpeed : stats.maxSpeed;
    const speed = ship.velocity.length();
    if (speed > maxS) {
      // soft-clamp: decay excess quickly, allow ≤5% overspeed (gravity assists feel fun)
      const target = speed > maxS * 1.05 ? maxS * 1.05 : speed - (speed - maxS) * Math.min(1, 3 * dt);
      ship.velocity.multiplyScalar(target / speed);
    }

    ship.position.addScaledVector(ship.velocity, dt);
    ship.speed = ship.velocity.length();

    // ---- collisions with celestial bodies ----
    this.collideBodies(bodies, events, dt);
  }

  collideBodies(bodies, events, dt) {
    const ship = this.ship;
    for (const body of bodies) {
      _n.subVectors(ship.position, body.group.position);
      const d = _n.length();
      const min = body.radius + 0.65;
      if (d < min) {
        _n.normalize();
        ship.position.copy(body.group.position).addScaledVector(_n, min);
        const into = -ship.velocity.dot(_n);
        if (into > 0) {
          ship.velocity.addScaledVector(_n, into * 1.35); // bounce out
          ship.velocity.multiplyScalar(0.55);
          const dmg = into * 3.2;
          if (dmg > 1 && events.onDamage) events.onDamage(dmg, 'impact');
        }
      }
    }
  }
}
