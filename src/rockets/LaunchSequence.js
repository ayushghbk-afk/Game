// LaunchSequence — flies a player-built rocket off the pad at Earth and into
// orbit, then hands control back to the normal space game.
//
// This is a scripted-but-physical ascent: real thrust, real mass flow, real
// staging. The rocket burns the fuel its design actually carries, sheds stages
// when they run dry, gravity-turns downrange, and either makes orbit or fails
// out — using the numbers analyzeDesign() showed in the VAB, so the build
// screen never lies to the player.
import * as THREE from 'three';
import { analyzeDesign, G0, EARTH_ORBIT_DV } from './RocketParts.js';
import { buildRocketMesh } from './RocketMesh.js';

const PAD_ALTITUDE = 0.02;      // world units above the surface
const TURN_START = 0.6;         // km-ish (scaled) where the gravity turn begins
const TARGET_ALT = 6.5;         // world units above Earth's surface = orbital altitude
const ORBITAL_SPEED = 7800;     // m/s — you are not in orbit until you are THIS fast

export class LaunchSequence {
  /**
   * @param design  rocket design ({version, name, parts})
   * @param earth   the Earth Body (for position/radius)
   * @param scene   THREE.Scene to add the rocket to
   */
  constructor(design, earth, scene) {
    this.design = design;
    this.analysis = analyzeDesign(design);
    this.earth = earth;
    this.scene = scene;

    this.t = 0;
    this.phase = 'countdown';   // countdown | liftoff | gravityturn | coast | orbit | failed
    this.countdown = 5;
    this.altitude = 0;          // world units above the surface
    this.downrange = 0;
    this.speed = 0;             // m/s (scaled for display)
    this.deltaVUsed = 0;
    this.stageIndex = 0;
    this.stages = this.analysis.stages.map(s => ({ ...s, fuelLeft: s.fuelMass }));
    this.massAbove = 0;
    this.failReason = null;
    this.events = [];           // human-readable flight log
    this.apoapsis = 0;

    this.mesh = buildRocketMesh(design);
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    scene.add(this.group);
    this._place();
  }

  /** Current total mass (t) of everything still attached. */
  currentMass() {
    let m = 0;
    for (let i = this.stageIndex; i < this.stages.length; i++) {
      m += this.stages[i].dryMass + this.stages[i].fuelLeft;
    }
    return m;
  }

  get stage() { return this.stages[this.stageIndex] || null; }

  log(msg) {
    this.events.push({ t: this.t, msg });
    if (this.events.length > 60) this.events.shift();
  }

  _padPosition() {
    // Launch from Earth's surface, on the sunward side so the ascent is lit.
    const p = this.earth.group.position;
    return new THREE.Vector3(p.x, p.y + this.earth.radius + PAD_ALTITUDE, p.z);
  }

  _place() {
    const pad = this._padPosition();
    const up = new THREE.Vector3(0, 1, 0);
    // Pitch over as the ascent progresses (gravity turn).
    const pitch = Math.min(Math.PI / 2 * 0.92, (this.altitude / TARGET_ALT) * Math.PI / 2 * 1.05);
    this.group.position.set(
      pad.x + Math.sin(pitch) * this.downrange,
      pad.y + this.altitude,
      pad.z
    );
    this.group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, -1), pitch);
    this.group.up.copy(up);
  }

  /** Advance the ascent. Returns the current phase. */
  update(dt) {
    if (this.phase === 'orbit' || this.phase === 'failed') return this.phase;

    if (!this.analysis.valid) {
      this.phase = 'failed';
      this.failReason = this.analysis.errors[0] || 'The vehicle is not flightworthy.';
      return this.phase;
    }

    this.t += dt;

    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'liftoff';
        this.log('LIFT-OFF — the tower is clear.');
      }
      return this.phase;
    }

    const st = this.stage;
    if (!st) return this._endBurn();

    // ---- thrust & mass flow -------------------------------------------
    const mass = Math.max(0.1, this.currentMass());       // tonnes
    const thrust = st.thrust;                              // kN
    const accel = thrust / mass;                           // kN/t = m/s²
    const gravity = G0 * Math.pow(this.earth.radius / (this.earth.radius + this.altitude), 2);
    const netAccel = accel - gravity * Math.cos(Math.min(1, this.altitude / TARGET_ALT) * Math.PI / 2);

    if (st.fuelLeft > 0 && st.isp > 0) {
      const flow = thrust / (st.isp * G0);                 // t/s
      const burned = Math.min(st.fuelLeft, flow * dt);
      st.fuelLeft -= burned;
      this.deltaVUsed += accel * dt;
      this.speed = Math.max(0, this.speed + netAccel * dt);
    } else {
      // Stage dry — separate and light the next one.
      if (this.stageIndex < this.stages.length - 1) {
        this.stageIndex++;
        this.log(`STAGE ${this.stageIndex} SEPARATION — next engine ignition.`);
        this.mesh.dropStage?.(this.stageIndex);
      } else {
        return this._endBurn();
      }
      this.speed = Math.max(0, this.speed - gravity * dt);
    }

    // ---- integrate the trajectory (scaled to world units) --------------
    // 1 world unit ≈ 1000 km, so metres per second become a small number of
    // units per second; we exaggerate slightly so an ascent is watchable.
    const unitSpeed = this.speed / 1000 * 0.9;
    const pitchFrac = Math.min(1, this.altitude / TARGET_ALT);
    this.altitude += unitSpeed * dt * (1 - pitchFrac * 0.75);
    if (this.altitude > TURN_START) this.downrange += unitSpeed * dt * pitchFrac * 0.9;
    this.apoapsis = Math.max(this.apoapsis, this.altitude);

    if (this.altitude < 0) {
      this.phase = 'failed';
      this.failReason = 'The vehicle came back down. Not enough thrust to climb.';
      return this.phase;
    }

    if (this.phase === 'liftoff' && this.altitude > TURN_START) {
      this.phase = 'gravityturn';
      this.log('PITCH PROGRAM — beginning the gravity turn.');
    }

    // Orbit is altitude AND velocity. Coasting up to 6,500 km with 800 m/s on
    // the clock is a very expensive way to fall back down, so the ascent
    // keeps burning (and keeps staging) until the vehicle is actually fast
    // enough to stay up.
    if (this.altitude >= TARGET_ALT && this.speed >= ORBITAL_SPEED) {
      this.phase = 'orbit';
      this.log('ORBIT ACHIEVED — main engine cut-off. Welcome to space.');
    } else if (this.altitude >= TARGET_ALT) {
      // Hold at altitude and keep accelerating downrange (circularisation).
      this.altitude = TARGET_ALT;
      if (this.phase !== 'coast') {
        this.phase = 'coast';
        this.log('APOAPSIS REACHED — burning to circularise.');
      }
    }

    this._place();
    return this.phase;
  }

  _endBurn() {
    // Out of fuel. Did we build up enough total delta-v to be in orbit?
    if (this.analysis.deltaV >= EARTH_ORBIT_DV && this.altitude > TARGET_ALT * 0.55 && this.speed > ORBITAL_SPEED * 0.75) {
      this.phase = 'orbit';
      this.log('ORBIT ACHIEVED on the last of the propellant.');
    } else {
      this.phase = 'failed';
      this.failReason = `Ran out of propellant at ${Math.round(this.altitude * 1000)} km doing ${Math.round(this.speed)} m/s — the design carries ${Math.round(this.analysis.deltaV)} m/s of delta-v, orbit needs ${EARTH_ORBIT_DV}.`;
    }
    return this.phase;
  }

  /** Camera target: a chase view that pulls back as the rocket climbs. */
  cameraFor(camera) {
    const p = this.group.position;
    const back = 8 + this.altitude * 1.6;
    const upOff = 2.5 + this.altitude * 0.5;
    camera.position.set(p.x + back * 0.7, p.y + upOff, p.z + back);
    camera.lookAt(p);
  }

  /** Telemetry for the launch HUD. */
  telemetry() {
    return {
      phase: this.phase,
      countdown: Math.max(0, Math.ceil(this.countdown)),
      altitudeKm: Math.round(this.altitude * 1000),
      speed: Math.round(this.speed),
      stage: this.stageIndex + 1,
      stages: this.stages.length,
      fuelPct: this.stage && this.stage.fuelMass > 0
        ? Math.max(0, this.stage.fuelLeft / this.stage.fuelMass) : 0,
      apoapsisKm: Math.round(this.apoapsis * 1000),
      deltaV: Math.round(this.analysis.deltaV),
      failReason: this.failReason,
      events: this.events
    };
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(o => {
      o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
      else o.material?.dispose?.();
    });
  }
}
