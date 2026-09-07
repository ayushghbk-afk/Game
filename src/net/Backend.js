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
import { DEFAULT_BACKEND } from './backendConfig.js';

const CRED_KEY = 'solar-odyssey-backend-v1';
const SESSION_KEY = 'solar-odyssey-session-v1';

// Where confirmation / password-reset emails should bring players back to.
// Normally derived from window.location at runtime (see Backend.appUrl) so it
// is always the URL the game is actually running on — the production GitHub
// Pages deployment for this repository is https://ayushghbk-afk.github.io/Game/
// and this constant is only the fallback for non-browser contexts.
const FALLBACK_APP_URL = 'https://ayushghbk-afk.github.io/Game/';

function ls() {
  try {
    const t = '__so__'; localStorage.setItem(t, t); localStorage.removeItem(t);
    return localStorage;
  } catch { return null; }
}

/**
 * Where the game connects by default. Priority:
 *   1. build-time env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
 *   2. the shipped default project (src/net/backendConfig.js)
 * A player-entered project (ACCOUNT → CONNECT SERVER) overrides both at
 * runtime — see _restore().
 */
function envDefaults() {
  try {
    const env = import.meta.env || {};
    if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
      return { url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_ANON_KEY };
    }
  } catch { /* no bundler env */ }
  if (DEFAULT_BACKEND?.url && DEFAULT_BACKEND?.key) {
    return { url: DEFAULT_BACKEND.url.replace(/\/+$/, ''), key: DEFAULT_BACKEND.key };
  }
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

  /** Forget a custom project and fall back to the shipped default server. */
  disconnect() {
    this.session = null;
    this.profile = null;
    this.store?.removeItem(SESSION_KEY);
    this.store?.removeItem(CRED_KEY);
    const env = envDefaults();
    this.url = env?.url || null;
    this.key = env?.key || null;
    this.emit('config', this.configured);
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

  /**
   * Call a Postgres function. Multiplayer state and counters are no longer
   * writable straight from the browser (see supabase/schema-v2.sql) — the
   * database only accepts them through these, which re-check who you are
   * server-side. A client that fakes the request just gets an exception.
   */
  _rpc(fn, args = {}) {
    return this._fetch('/rest/v1/rpc/' + fn, {
      method: 'POST',
      body: JSON.stringify(args)
    });
  }

  // ---------------------------------------------------------------- auth
  /**
   * The URL of the page the game is running on — where Supabase should send
   * players back after email confirmation / password reset. Derived from
   * window.location so it is correct on the production GitHub Pages site
   * (https://ayushghbk-afk.github.io/Game/) AND in local dev, instead of
   * letting Supabase fall back to whatever Site URL happens to be
   * configured in the dashboard (the old localhost:3000 bug).
   */
  get appUrl() {
    try {
      const loc = typeof window !== 'undefined' ? window.location : null;
      if (loc && typeof loc.origin === 'string' && /^https?:/.test(loc.origin)) {
        let path = loc.pathname || '/';
        if (path.endsWith('index.html')) path = path.slice(0, -'index.html'.length);
        if (!path.endsWith('/')) path += '/';
        return loc.origin + path;
      }
    } catch { /* non-browser context — use the fallback below */ }
    return FALLBACK_APP_URL;
  }

  async signUp(email, password, handle) {
    const redirectTo = this.appUrl;
    // IMPORTANT: GoTrue reads redirect_to from the QUERY STRING of the
    // request (this is also how supabase-js sends it) — a field in the JSON
    // body is ignored, which is why it lives on the URL.
    const body = await this._fetch('/auth/v1/signup?redirect_to=' + encodeURIComponent(redirectTo), {
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
    // Email confirmation is on for this project: the confirmation link
    // brings the player back to `redirectTo`, where handleAuthRedirect()
    // picks the session up.
    return { confirmed: false, redirectTo };
  }

  /**
   * Supabase hands sessions back from email links in the URL FRAGMENT:
   *   https://…/Game/#access_token=…&refresh_token=…&type=signup|recovery
   * (GoTrue's verify endpoint 302s to redirect_to and blindly appends
   * "#<params>"). Parse that, validate the token against /auth/v1/user,
   * persist the session and strip the tokens out of the address bar.
   * Returns true when a session was recovered. Must run before any UI
   * checks backend.signedIn.
   */
  async handleAuthRedirect() {
    try {
      if (typeof window === 'undefined') return false;
      const rawHash = window.location?.hash || '';
      if (!rawHash) return false;

      // A redirect_to that already carried a fragment ("…#reset-password")
      // ends up with a DOUBLE fragment because GoTrue appends "#params"
      // unconditionally — the token block is always the segment containing
      // access_token=.
      const segments = rawHash.split('#').filter(Boolean);
      const tokenSeg = segments.find((s) => s.includes('access_token='));
      if (!tokenSeg) {
        if (segments.some((s) => s.startsWith('error='))) {
          const err = new URLSearchParams(segments[segments.length - 1]);
          console.warn('[Solar Odyssey] Auth link rejected:',
            err.get('error_description') || err.get('error'));
          this._cleanUrl();
        }
        return false;
      }

      const params = new URLSearchParams(tokenSeg);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (!accessToken || !refreshToken) return false;

      const expiresIn = Number(params.get('expires_in') || 3600);
      this.session = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: expiresIn,
        expires_at: Math.floor(Date.now() / 1000) + expiresIn,
        token_type: params.get('token_type') || 'bearer',
        // 'signup' = email just confirmed, 'recovery' = password-reset link
        type: params.get('type') || 'signup'
      };

      const user = await this._fetch('/auth/v1/user');
      this.session.user = user;
      this._persistSession();

      await this.ensureProfile();
      this._cleanUrl();
      this.emit('auth', this.user);
      return true;
    } catch (err) {
      console.error('[Solar Odyssey] Failed to process auth redirect:', err);
      this.session = null;
      this._persistSession();
      return false;
    }
  }

  /** Remove the token fragment from the visible address bar. */
  _cleanUrl() {
    try {
      if (typeof window === 'undefined' || !window.location) return;
      window.history?.replaceState({}, (typeof document !== 'undefined' && document.title) || '',
        window.location.origin + window.location.pathname + window.location.search);
    } catch { /* file:// or sandboxed iframe — cosmetic only */ }
  }

  /**
   * Email a password-reset link. It brings the player back to the game with
   * a recovery session in the fragment (type=recovery), which
   * handleAuthRedirect() picks up on next boot — ACCOUNT then offers
   * "SET NEW PASSWORD". NOTE: redirect_to intentionally has NO #fragment:
   * GoTrue appends its own "#access_token=…" and a fragment here would end
   * up doubled.
   */
  async sendPasswordReset(email) {
    const redirectTo = this.appUrl;
    return this._fetch('/auth/v1/recover?redirect_to=' + encodeURIComponent(redirectTo), {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  }

  /**
   * Change the signed-in player's password. This is the last step of the
   * reset flow: the recovery link already signed the player in
   * (session.type === 'recovery'), this replaces the actual password.
   */
  async updatePassword(newPassword) {
    if (!this.signedIn) throw new Error('Sign in first — open the reset link from your email.');
    await this._fetch('/auth/v1/user', {
      method: 'PUT',
      body: JSON.stringify({ password: newPassword })
    });
    if (this.session) {
      delete this.session.type; // reset finished
      this._persistSession();
    }
    return true;
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
    return this._rpc('update_presence', {
      target_server: serverId || null,
      new_status: status || 'online',
      new_location: location || null
    });
  }

  /**
   * Tell the server we are still hosting. Only the owner may call it, and it
   * cannot change `official` or `owner_id` — the whole reason server updates
   * are no longer a plain PATCH.
   */
  async serverHeartbeat(serverId, players) {
    if (!this.signedIn) return null;
    return this._rpc('server_heartbeat', {
      target_server: serverId,
      reported_players: Number.isFinite(players) ? players : null
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

  /**
   * Search commanders by callsign. PostgREST `ilike.*foo*` needs the pattern
   * quoted when it contains reserved characters — without quotes the `*` is
   * eaten by the URL parser and the search silently returns nothing. We also
   * try the RPC if the project has schema-v3 installed (works for guests on
   * the public profiles view).
   */
  async findPlayers(handle) {
    if (!this.configured) return [];
    const raw = String(handle || '').trim();
    if (raw.length < 2) return [];
    // Prefer the SECURITY DEFINER RPC when available — it works whether or
    // not the caller is signed in, and uses a proper parameterized ILIKE.
    try {
      const viaRpc = await this._rpc('search_players', { query: raw, max_rows: 15 });
      if (Array.isArray(viaRpc)) return viaRpc;
    } catch { /* RPC missing on older projects — fall through to REST */ }

    // REST fallback. Quote the pattern so `*`, commas and spaces survive.
    const pattern = `*${raw.replace(/[*",]/g, '')}*`;
    const q = 'handle=ilike.' + encodeURIComponent('"' + pattern + '"') +
      '&select=id,handle,region,last_seen&limit=15&order=handle.asc';
    try {
      return (await this._rest('profiles', q)) || [];
    } catch (e) {
      // Last resort: exact prefix match without wildcards.
      try {
        const q2 = 'handle=ilike.' + encodeURIComponent(raw.replace(/[%_*,"]/g, '') + '%') +
          '&select=id,handle,region,last_seen&limit=15';
        return (await this._rest('profiles', q2)) || [];
      } catch {
        throw e;
      }
    }
  }

  /**
   * Everyone currently on a given server (for the co-op roster / multiplayer
   * discovery when Realtime is unavailable). Joins profiles so the UI has
   * handles without a second round-trip.
   */
  async listServerPresence(serverId) {
    if (!this.configured || !serverId) return [];
    // Try the embed first; fall back to a plain select + manual join if the
    // FK relationship isn't exposed.
    try {
      const rows = await this._rest(
        'presence',
        'server_id=eq.' + encodeURIComponent(serverId) +
          '&status=neq.offline&select=user_id,status,location,updated_at,profiles(handle,region)&order=updated_at.desc'
      );
      return (rows || []).map(r => ({
        user_id: r.user_id,
        status: r.status,
        location: r.location,
        updated_at: r.updated_at,
        handle: r.profiles?.handle || r.handle || null,
        region: r.profiles?.region || null
      }));
    } catch {
      const rows = (await this._rest(
        'presence',
        'server_id=eq.' + encodeURIComponent(serverId) +
          '&status=neq.offline&select=user_id,status,location,updated_at&order=updated_at.desc'
      )) || [];
      if (!rows.length) return rows;
      const ids = rows.map(r => r.user_id).filter(Boolean);
      let people = [];
      if (ids.length) {
        people = (await this._rest('profiles', 'id=in.(' + ids.join(',') + ')&select=id,handle,region')) || [];
      }
      const byId = new Map(people.map(p => [p.id, p]));
      return rows.map(r => {
        const p = byId.get(r.user_id);
        return { ...r, handle: p?.handle || null, region: p?.region || null };
      });
    }
  }

  /**
   * Drop an invite notice into the friend's presence.location so their client
   * can pick it up on the next poll. Realtime carries the live invite; this
   * is the durable fallback.
   */
  async sendInvite(friendId, server) {
    if (!this.signedIn) throw new Error('Sign in to invite friends.');
    if (!friendId || !server?.id) throw new Error('Missing friend or server.');
    return this._rpc('send_coop_invite', {
      target_user: friendId,
      target_server: server.id,
      server_name: server.name || 'Co-op expedition'
    });
  }

  async addFriend(friendId) {
    if (!this.signedIn) throw new Error('Sign in to add friends.');
    if (friendId === this.userId) throw new Error('You cannot befriend yourself, Commander.');
    return this._rpc('send_friend_request', { target_user: friendId });
  }

  /** Answer a pending request. Only the recipient can — enforced in SQL. */
  async acceptFriend(rowId) {
    return this._rpc('respond_friend_request', {
      request_id: rowId, new_status: 'accepted'
    });
  }

  async blockFriend(rowId) {
    return this._rpc('respond_friend_request', {
      request_id: rowId, new_status: 'blocked'
    });
  }

  /**
   * Remove a relationship. Takes the OTHER PLAYER's user id (the RPC works on
   * the pair), not the friends-row id the old REST delete used.
   */
  async removeFriend(otherUserId) {
    return this._rpc('remove_friend', { target_user: otherUserId });
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

  /** Like / unlike a shared design. Returns true if it is now liked. */
  async toggleRocketLike(rocketId) {
    if (!this.signedIn) throw new Error('Sign in to like designs.');
    return this._rpc('toggle_rocket_like', { target_rocket: rocketId });
  }

  /** Which shared designs the signed-in player has already liked. */
  async myRocketLikes() {
    if (!this.signedIn) return new Set();
    const rows = (await this._rest('rocket_likes',
      'user_id=eq.' + this.userId + '&select=rocket_id')) || [];
    return new Set(rows.map(r => r.rocket_id));
  }

  /**
   * Count a download. The browser cannot bump the counter directly any more,
   * so a failure here must never block the player from getting their rocket.
   */
  async recordRocketDownload(rocketId) {
    if (!this.signedIn) return null;
    try {
      return await this._rpc('record_rocket_download', { target_rocket: rocketId });
    } catch {
      return null;
    }
  }
}

export const backend = new Backend();
