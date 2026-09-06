// Derives live ship statistics from the player's purchased upgrade tiers.
import { UPGRADES } from '../config.js';

export function shipStats(upgrades) {
  const eng = UPGRADES.engine.tiers[upgrades.engine - 1];
  const tank = UPGRADES.tank.tiers[upgrades.tank - 1];
  const shield = UPGRADES.shield.tiers[upgrades.shield - 1];
  const scanner = UPGRADES.scanner.tiers[upgrades.scanner - 1];
  const cargo = UPGRADES.cargo.tiers[upgrades.cargo - 1];
  return {
    maxSpeed: eng.maxSpeed,
    boostSpeed: eng.maxSpeed * 1.8,
    thrust: 26 * eng.thrust,
    efficiency: eng.efficiency,
    fuelCapacity: tank.capacity,
    shieldMax: shield.max,
    shieldRegen: shield.regen,
    scanRange: scanner.range,
    scanSpeed: scanner.speed,
    cargoCapacity: cargo.capacity
  };
}

export function upgradeTierInfo(system, level) {
  return UPGRADES[system].tiers[level - 1];
}

export function nextUpgradeCost(system, currentLevel) {
  const tiers = UPGRADES[system].tiers;
  if (currentLevel >= tiers.length) return null;
  return tiers[currentLevel].price;
}
