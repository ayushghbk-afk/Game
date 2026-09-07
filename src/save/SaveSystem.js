// SaveSystem — browser persistence for Solar Odyssey.
//
// Layers (all optional, degrade gracefully):
//   · SETTINGS  — stored on their own key so they survive NEW GAME / a wiped
//                 career and apply before any save is loaded. Mirrored to the
//                 cloud (Supabase `settings`) when signed in.
//   · SLOTS     — up to 6 named careers, each with metadata (name, credits,
//                 level, play time, location, timestamp) so the main menu can
//                 list "past games".
//   · IDENTITY  — the guest/account identity used by the menu.
//
// v1 saves (single `solar-odyssey-save-v1` blob) are migrated into slot 0 on
// first read, so nobody loses a career.
const LEGACY_KEY = 'solar-odyssey-save-v1';
const SLOTS_KEY = 'solar-odyssey-slots-v2';
const SETTINGS_KEY = 'solar-odyssey-settings-v2';
const IDENTITY_KEY = 'solar-odyssey-identity-v1';
export const MAX_SLOTS = 6;

function storageAvailable() {
  try {
    const t = '__so_test__';
    localStorage.setItem(t, t);
    localStorage.removeItem(t);
    return true;
  } catch { return false; }
}
export const hasStorage = storageAvailable();

function readJSON(key, fallback) {
  if (!hasStorage) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch { return fallback; }
}
function writeJSON(key, value) {
  if (!hasStorage) return false;
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { console.warn('Save failed', e); return false; }
}

/** { slots: { "0": {...state}, ... }, meta: { "0": {...} }, active: 0 } */
function readAll() {
  const db = readJSON(SLOTS_KEY, null);
  if (db && db.slots) return db;
  // migrate the legacy single-slot save
  const legacy = readJSON(LEGACY_KEY, null);
  const fresh = { slots: {}, meta: {}, active: 0 };
  if (legacy && legacy.version === 1) {
    fresh.slots['0'] = legacy;
    fresh.meta['0'] = {
      name: 'Career 1',
      credits: legacy.credits || 0,
      level: 1,
      playTime: legacy.playTime || 0,
      savedAt: legacy.savedAt || Date.now(),
      location: 'Unknown'
    };
  }
  writeJSON(SLOTS_KEY, fresh);
  return fresh;
}

export const SaveSystem = {
  // -------------------------------------------------------------- settings
  loadSettings() { return readJSON(SETTINGS_KEY, null); },
  saveSettings(settings) { return writeJSON(SETTINGS_KEY, { ...settings, savedAt: Date.now() }); },

  // -------------------------------------------------------------- identity
  loadIdentity() { return readJSON(IDENTITY_KEY, null); },
  saveIdentity(identity) { return writeJSON(IDENTITY_KEY, identity); },
  clearIdentity() { if (hasStorage) try { localStorage.removeItem(IDENTITY_KEY); } catch { /* ignore */ } },

  // -------------------------------------------------------------- slots
  activeSlot() { return readAll().active ?? 0; },
  setActiveSlot(slot) {
    const db = readAll();
    db.active = slot;
    return writeJSON(SLOTS_KEY, db);
  },

  /** Metadata for every used slot, newest first. */
  listSlots() {
    const db = readAll();
    return Object.keys(db.slots)
      .map(k => ({ slot: parseInt(k, 10), ...(db.meta[k] || {}) }))
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  },

  hasAnySave() { return Object.keys(readAll().slots).length > 0; },

  firstFreeSlot() {
    const db = readAll();
    for (let i = 0; i < MAX_SLOTS; i++) if (!db.slots[String(i)]) return i;
    return -1;
  },

  /** Load a slot (defaults to the active one). */
  load(slot) {
    const db = readAll();
    const key = String(slot ?? db.active ?? 0);
    const data = db.slots[key];
    return data && data.version === 1 ? data : null;
  },

  /** Persist a career into a slot along with display metadata. */
  save(state, slot, meta = {}) {
    if (!hasStorage) return false;
    const db = readAll();
    const key = String(slot ?? db.active ?? 0);
    db.slots[key] = { ...state, savedAt: Date.now() };
    db.meta[key] = {
      name: meta.name || db.meta[key]?.name || `Career ${parseInt(key, 10) + 1}`,
      credits: state.credits || 0,
      level: meta.level || db.meta[key]?.level || 1,
      playTime: state.playTime || 0,
      location: meta.location || db.meta[key]?.location || 'Earth orbit',
      cloudId: meta.cloudId ?? db.meta[key]?.cloudId ?? null,
      savedAt: Date.now()
    };
    db.active = parseInt(key, 10);
    return writeJSON(SLOTS_KEY, db);
  },

  renameSlot(slot, name) {
    const db = readAll();
    const key = String(slot);
    if (!db.meta[key]) return false;
    db.meta[key].name = name;
    return writeJSON(SLOTS_KEY, db);
  },

  /** Erase one slot (or everything when `slot` is undefined). */
  reset(slot) {
    if (!hasStorage) return;
    if (slot === undefined) {
      try { localStorage.removeItem(SLOTS_KEY); localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
      return;
    }
    const db = readAll();
    delete db.slots[String(slot)];
    delete db.meta[String(slot)];
    writeJSON(SLOTS_KEY, db);
  },

  meta(slot) { return readAll().meta[String(slot)] || null; },

  lastSaveTime(slot) { return this.meta(slot ?? this.activeSlot())?.savedAt || 0; },

  /** Raw export for "share / backup my career". */
  exportSlot(slot) {
    const data = this.load(slot);
    if (!data) return null;
    return JSON.stringify({ kind: 'solar-odyssey-save', version: 1, meta: this.meta(slot), data }, null, 2);
  },

  importSlot(json, slot) {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json;
    const data = parsed?.data || parsed;
    if (!data || data.version !== 1) throw new Error('Not a Solar Odyssey save file.');
    const target = slot ?? this.firstFreeSlot();
    if (target < 0) throw new Error('All save slots are full — delete one first.');
    this.save(data, target, { name: parsed?.meta?.name || 'Imported career' });
    return target;
  }
};

// Kept for older imports.
SaveSystem.hasStorage = hasStorage;
