// SaveSystem — localStorage persistence (GitHub Pages friendly, no backend).
const KEY = 'solar-odyssey-save-v1';

function storageAvailable() {
  try {
    const t = '__so_test__';
    localStorage.setItem(t, t);
    localStorage.removeItem(t);
    return true;
  } catch { return false; }
}
export const hasStorage = storageAvailable();

export const SaveSystem = {
  load() {
    if (!hasStorage) return null;
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && data.version === 1 ? data : null;
    } catch (e) { console.warn('Save load failed', e); return null; }
  },

  save(state) {
    if (!hasStorage) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
      return true;
    } catch (e) { console.warn('Save failed', e); return false; }
  },

  reset() {
    if (!hasStorage) return;
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  },

  lastSaveTime() {
    if (!hasStorage) return 0;
    try { return JSON.parse(localStorage.getItem(KEY) || '{}').savedAt || 0; } catch { return 0; }
  }
};
