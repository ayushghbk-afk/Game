// Modal-state tracking — the single source of truth for "which overlay is
// actually on top right now".
//
// Game.modalOpen is read by a lot of decision points (ESC handling, pointer-
// lock recovery, interact/scan/land gating, map redraws, …). Historically it
// was pure bookkeeping: code that opened a full-screen modal without going
// through Game.openModal (the main-menu buttons call Menu's own show*()
// methods, the NEW GAME confirm is Menu-internal, the fast-travel dialog's
// CANCEL button closes the DOM without touching the flag) left the flag
// stale. A stale `null` meant ESC was a no-op while a full-viewport modal
// (z-index 45) sat above the main menu (z-index 40) swallowing every click —
// from the player's point of view "the buttons don't work". A stale non-null
// value (e.g. 'confirm' after cancelling a fast travel) silently disabled
// in-flight actions like SCAN/interact/land until the next ESC.
//
// Instead of trusting bookkeeping, Game.syncModalState() re-derives the
// value from the real DOM whenever it matters (ESC, pointer-lock loss,
// key toggles, action gates). The priority list mirrors the z-index stack:
// pause (42) → modals (45, confirm/missions/settings/ship/help/codex) →
// map (35) → dock (45, base layer of the dock stack) → planet info (30).
export const MODAL_PRIORITY = [
  'pause',
  'confirm',
  'account',
  'vab',
  'missions',
  'settings',
  'ship',
  'help',
  'codex',
  'base',
  'map',
  'docked',
  'planetinfo'
];

/**
 * Returns the kind of the topmost visible overlay, or null when nothing is
 * open. `registry` maps kind → element (or array of elements that all share
 * a kind, e.g. the NEW GAME confirm and the fast-travel dialog are both
 * 'confirm'). An overlay counts as visible when it is attached and does not
 * carry the `hidden` class.
 */
export function topVisibleModal(registry) {
  if (!registry) return null;
  for (const kind of MODAL_PRIORITY) {
    const els = registry[kind];
    if (!els) continue;
    const list = Array.isArray(els) ? els : [els];
    if (list.some((e) => e && e.isConnected && !e.classList.contains('hidden'))) {
      return kind;
    }
  }
  return null;
}
