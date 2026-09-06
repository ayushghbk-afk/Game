// Resource & cargo helpers (pure functions over GameState state).
import { ECONOMY } from '../config.js';

export function cargoUsed(resources) {
  let n = 0;
  for (const k in resources) n += resources[k];
  return n;
}

/** Adds up to `amount` of resource, respecting capacity. Returns accepted amount. */
export function addResource(resources, type, amount, capacity) {
  const free = capacity - cargoUsed(resources);
  const accepted = Math.max(0, Math.min(amount, free));
  if (accepted > 0) resources[type] = (resources[type] || 0) + accepted;
  return accepted;
}

export function cargoValue(resources) {
  let v = 0;
  for (const k in resources) v += resources[k] * ECONOMY.resources[k].price;
  return v;
}

export const RESOURCE_IDS = Object.keys(ECONOMY.resources);
