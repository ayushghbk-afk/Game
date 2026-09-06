// MissionManager — tracks the active mission chain, evaluates objectives
// every frame, pays rewards and fires UI/audio events on completion.
import { MISSIONS } from './MissionData.js';

export class MissionManager {
  constructor(gameState, hooks) {
    this.gs = gameState;
    this.hooks = hooks; // {toast, sound, cinematic}
    this.minedBaseline = gameState.state.stats.mined;
    // resume: skip already-completed missions from a loaded save
  }

  get active() {
    const done = this.gs.state.missions.completed;
    return MISSIONS.find(m => !done.includes(m.id)) || null;
  }

  completed() { return this.gs.state.missions.completed; }

  /** Context object handed to mission check/progress functions. */
  makeContext(game) {
    return {
      distTo: (id) => game.distToBody(id),
      visited: (id) => this.gs.state.visited.includes(id),
      stats: () => this.gs.state.stats,
      mined: () => this.gs.state.stats.mined - this.minedBaseline
    };
  }

  update(ctx) {
    const mission = this.active;
    if (!mission) return;
    if (mission.check(ctx)) this.complete(mission);
  }

  complete(mission) {
    this.gs.state.missions.completed.push(mission.id);
    this.gs.addCredits(mission.reward);
    this.gs.addXP(mission.xp);
    this.gs.save(this.hooks.shipSnapshot?.());
    this.hooks.toast('MISSION COMPLETE', `${mission.name} — +${mission.reward.toLocaleString()} CR`, 'success');
    this.hooks.sound?.('mission');
    this.hooks.cinematic?.();
  }

  reset() { this.minedBaseline = this.gs.state.stats.mined; }
}
