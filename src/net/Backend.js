// Backend — thin, dependency-free Supabase client (REST + GoTrue over fetch).
//
// Why not @supabase/supabase-js? This game ships as plain ES modules that must
// also run straight from a static host (GitHub Pages "deploy from a branch")
// through the import map in index.html. A ~40 KB extra dependency for what is
// really "POST /auth/v1/token" + "GET /rest/v1/table" is not worth it.
//
// Credentials are NOT baked into the build: the player (or you) pastes the
// project URL + anon key once in ACCOUNT → CONNECT SERVER, and they are kept
// in localStorage. Until then the whole game runs in GUEST mode against
// browser storage, and every cloud call resolves to a friendly error.
const CRED_KEY = 'solar-odyssey-backend-v1';
const SESSION_KEY = 'solar-odyssey-session-v1';

function ls() {
  try {
    const t = '__so__'; localStorage.setItem(t, t); localStorage.removeItem(t);
    return localStorage;
  } catch { return null; }
}

/** Optional build-time defaults (Vite env), so you can ship keys if you want. */
function envDefaults() {
  try {
    const env = import.meta.env || {};
    if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
      return { url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_ANON_KEY };
    }
  } catch { /* no bundler env */ }
  return null;
}

export class Backend {
  constructor() {
    this.store = ls();
    this.url = null;
    this.key = null;
    this.session = null;   // { access_token, refresh_token, expires_at, user }
    this.profile = null;
    this._listeners = new Map();
    this._restore();
  }

  // ---------------------------------------------------------------- events
  on(evt, fn) { (this._listeners.get(evt) || this._listeners.set(evt, []).get(evt)).push(fn); }
  emit(evt, arg) { for (const fn of this._listeners.get(evt) || []) { try { fn(arg); } catch (e) { console.warn(e); } } }

  // ---------------------------------------------------------------- config
  _restore() {
    const env = envDefaults();
    if (env) { this.url = env.url; this.key = env.key; }
    if (!this.store) return;
    try {
      const c = JSON.parse(this.store.getItem(CRED_KEY) || 'null');
      if (c?.url && c?.key) { this.url = c.url.replace(/\/+$/, ''); this.key = c.key; }
      const s = JSON.parse(this.store.getItem(SESSION_KEY) || 'null');
      if (s?.access_token) this.session = s;
    } catch { /* corrupt — ignore */ }
  }

  /** True when a Supabase project is configured (cloud features available). */
  get configured() { return !!(this.url && this.key); }
  /** True when a real (non-guest) account is signed in. */
  get signedIn() { return !!(this.configured && this.session?.access_token); }
  get user() { return this.session?.user || null; }
  get userId() { return this.session?.user?.id || null; }

  configure(url, key) {
    if (!url || !key) throw new Error('Both the project URL and the anon key are required.');
    url = String(url).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url)) throw new Error('The project URL must start with https://');
    this.url = url;
    this.key = String(key).trim();
    this.store?.setItem(CRED_KEY, JSON.stringify({ url: this.url, key: this.key }));
    this.emit('config', true);
    return true;
  }

  disconnect() {
    this.session = null;
    this.profile = null;
    this.store?.removeItem(SESSION_KEY);
    this.store?.removeItem(CRED_KEY);
    this.url = this.key = null;
    this.emit('config', false);
    this.emit('auth', null);
  }

  _persistSession() {
    if (this.session) this.store?.setItem(SESSION_KEY, JSON.stringify(this.session));
    else this.store?.removeItem(SESSION_KEY);
  }

  // ---------------------------------------------------------------- fetch
  async _fetch(path, opts = {}) {
    if (!this.configured) throw new Error('No server connected. Main menu → ACCOUNT → CONNECT SERVER.');
    const headers = {
      apikey: this.key,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    };
    if (this.session?.access_token) headers.Authorization = 'Bearer ' + this.session.access_token;
    else headers.Authorization = 'Bearer ' + this.key;

    let res;
    try {
      res = await fetch(this.url + path, { ...opts, headers });
    } catch (e) {
      throw new Error('Cannot reach the server — check your connection.');
    }
    if (res.status === 401 && this.session?.refresh_token && !opts._retried) {
      const ok = await this.refresh();
      if (ok) return this._fetch(path, { ...opts, _retried: true });
    }
    const text = await res.text();
    let body = null;
    if (text) { try { body = JSON.parse(text); } catch { body = text; } }
    if (!res.ok) {
      const msg = (body && (body.error_description || body.msg || body.message || body.error)) || ('Request failed (' + res.status + ')');
      throw new Error(msg);
    }
    return body;
  }

  _rest(table, query = '', opts = {}) {
    return this._fetch('/rest/v1/' + table + (query ? '?' + query : ''), opts);
  }

  // ---------------------------------------------------------------- auth
  async signUp(email, password, handle) {
    const body = await this._fetch('/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, data: { handle } })
    });
    if (body?.access_token) {
      this.session = body;
      this._persistSession();
      await this.ensureProfile(handle);
      this.emit('auth', this.user);
      return { confirmed: true };
    }
    // Email confirmation is on for this project.
    return { confirmed: false };
  }

  async signIn(email, password) {
    const body = await this._fetch('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    this.session = body;
    this._persistSession();
    await this.ensureProfile();
    this.emit('auth', this.user);
    return this.user;
  }

  async refresh() {
    if (!this.session?.refresh_token) return false;
    try {
      const body = await this._fetch('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        _retried: true,
        body: JSON.stringify({ refresh_token: this.session.refresh_token })
      });
      this.session = body;
      this._persistSession();
      return true;
    } catch {
      this.session = null;
      this._persistSession();
      this.emit('auth', null);
      return false;
    }
  }

  async signOut() {
    try { if (this.signedIn) await this._fetch('/auth/v1/logout', { method: 'POST' }); } catch { /* offline is fine */ }
    this.session = null;
    this.profile = null;
    this._persistSession();
    this.emit('auth', null);
  }

  // ---------------------------------------------------------------- profile
  async ensureProfile(handle) {
    if (!this.signedIn) return null;
    const id = this.userId;
    const rows = await this._rest('profiles', 'id=eq.' + id + '&select=*');
    if (rows && rows.length) { this.profile = rows[0]; return this.profile; }
    const name = handle || this.user?.user_metadata?.handle ||
      (this.user?.email || 'commander').split('@')[0];
    const created = await this._rest('profiles', '', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ id, handle: name })
    });
    this.profile = Array.isArray(created) ? created[0] : created;
    return this.profile;
  }

  get handle() {
    return this.profile?.handle || this.user?.user_metadata?.handle ||
      (this.user?.email || '').split('@')[0] || 'GUEST';
  }

  // ---------------------------------------------------------------- saves
  async listSaves() {
    if (!this.signedIn) return [];
    return (await this._rest('saves', 'user_id=eq.' + this.userId + '&select=*&order=updated_at.desc')) || [];
  }

  async pushSave(slot, name, state, meta = {}) {
    if (!this.signedIn) throw new Error('Sign in to sync saves to the cloud.');
    return this._rest('saves', 'on_conflict=user_id,slot', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        user_id: this.userId, slot, name, data: state,
        play_time: meta.playTime || 0, credits: meta.credits || 0, level: meta.level || 1,
        updated_at: new Date().toISOString()
      })
    });
  }

  async pullSave(slot) {
    if (!this.signedIn) return null;
    const rows = await this._rest('saves', `user_id=eq.${this.userId}&slot=eq.${slot}&select=*`);
    return rows?.[0]?.data || null;
  }

  async deleteSave(slot) {
    if (!this.signedIn) return;
    await this._rest('saves', `user_id=eq.${this.userId}&slot=eq.${slot}`, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------- settings
  async pushSettings(settings) {
    if (!this.signedIn) return null;
    return this._rest('settings', 'on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: this.userId, data: settings, updated_at: new Date().toISOString() })
    });
  }

  async pullSettings() {
    if (!this.signedIn) return null;
    const rows = await this._rest('settings', 'user_id=eq.' + this.userId + '&select=data');
    return rows?.[0]?.data || null;
  }

  // ---------------------------------------------------------------- servers
  async listServers(region) {
    const q = 'select=*&order=official.desc,players.desc' + (region && region !== 'all' ? '&region=eq.' + region : '');
    return (await this._rest('servers', q)) || [];
  }

  async createServer({ name, region, mode = 'coop', capacity = 16 }) {
    if (!this.signedIn) throw new Error('Sign in to host a server.');
    return this._rest('servers', '', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name, region, mode, capacity, owner_id: this.userId })
    });
  }

  async setPresence(serverId, status, location) {
    if (!this.signedIn) return null;
    return this._rest('presence', 'on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: this.userId, server_id: serverId || null,
        status: status || 'online', location: location || null,
        updated_at: new Date().toISOString()
      })
    });
  }

  // ---------------------------------------------------------------- friends
  async listFriends() {
    if (!this.signedIn) return { friends: [], incoming: [], outgoing: [] };
    const rows = (await this._rest('friends', `or=(user_id.eq.${this.userId},friend_id.eq.${this.userId})&select=*`)) || [];
    const ids = new Set();
    for (const r of rows) { ids.add(r.user_id); ids.add(r.friend_id); }
    ids.delete(this.userId);
    let people = [];
    if (ids.size) {
      people = (await this._rest('profiles', 'id=in.(' + [...ids].join(',') + ')&select=id,handle,region,last_seen')) || [];
    }
    let presence = [];
    if (ids.size) {
      presence = (await this._rest('presence', 'user_id=in.(' + [...ids].join(',') + ')&select=*')) || [];
    }
    const byId = new Map(people.map(p => [p.id, p]));
    const presById = new Map(presence.map(p => [p.user_id, p]));
    const wrap = (r) => {
      const otherId = r.user_id === this.userId ? r.friend_id : r.user_id;
      const p = byId.get(otherId) || { id: otherId, handle: 'commander' };
      return { row: r, id: otherId, handle: p.handle, region: p.region, presence: presById.get(otherId) || null };
    };
    return {
      friends: rows.filter(r => r.status === 'accepted').map(wrap),
      incoming: rows.filter(r => r.status === 'pending' && r.friend_id === this.userId).map(wrap),
      outgoing: rows.filter(r => r.status === 'pending' && r.user_id === this.userId).map(wrap)
    };
  }

  async findPlayers(handle) {
    if (!this.configured) return [];
    const q = 'handle=ilike.*' + encodeURIComponent(handle) + '*&select=id,handle,region&limit=15';
    return (await this._rest('profiles', q)) || [];
  }

  async addFriend(friendId) {
    if (!this.signedIn) throw new Error('Sign in to add friends.');
    if (friendId === this.userId) throw new Error('You cannot befriend yourself, Commander.');
    return this._rest('friends', '', {
      method: 'POST',
      headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: this.userId, friend_id: friendId, status: 'pending' })
    });
  }

  async acceptFriend(rowId) {
    return this._rest('friends', 'id=eq.' + rowId, {
      method: 'PATCH', body: JSON.stringify({ status: 'accepted' })
    });
  }

  async removeFriend(rowId) {
    return this._rest('friends', 'id=eq.' + rowId, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------- rockets
  async listMyRockets() {
    if (!this.signedIn) return [];
    return (await this._rest('rockets', 'owner_id=eq.' + this.userId + '&select=*&order=updated_at.desc')) || [];
  }

  async listSharedRockets(limit = 40) {
    if (!this.configured) return [];
    return (await this._rest('rockets', 'public=eq.true&select=*&order=updated_at.desc&limit=' + limit)) || [];
  }

  async publishRocket({ id, name, design, stats, isPublic }) {
    if (!this.signedIn) throw new Error('Sign in to share rockets.');
    const payload = {
      owner_id: this.userId, owner_name: this.handle, name,
      design, stats: stats || {}, public: !!isPublic,
      updated_at: new Date().toISOString()
    };
    if (id) {
      return this._rest('rockets', 'id=eq.' + id, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload)
      });
    }
    return this._rest('rockets', '', {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload)
    });
  }

  async deleteRocket(id) {
    return this._rest('rockets', 'id=eq.' + id, { method: 'DELETE' });
  }
}

export const backend = new Backend();
