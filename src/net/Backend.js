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

function ls() {
  try {
    const t = '__so__'; localStorage.setItem(t, t); localStorage.removeItem(t);
    return localStorage;
  } catch { return null; }
}

/**
 * The page the game is running on, without query string or hash — e.g.
 * `https://user.github.io/Game/` or `http://localhost:5173/`. This is where
 * Supabase must send the player back to after they click the "Confirm your
 * email" / "Reset password" link.
 *
 * Without an explicit redirect target Supabase falls back to the project's
 * "Site URL", which every new project ships as `http://localhost:3000` — so
 * the verification link would land on a dead localhost page even though the
 * account had in fact been confirmed. Computing it from `location` means
 * GitHub Pages, a custom domain, `npm run dev` and `npm run preview` all just
 * work without touching the dashboard.
 *
 * Returns null for `file://` and non-browser environments (Node tests):
 * Supabase would reject a `null`/`file:` origin anyway, and omitting the
 * parameter is the same behaviour as before.
 */
export function siteUrl(loc = (typeof location !== 'undefined' ? location : null)) {
  if (!loc || !/^https?:$/.test(loc.protocol || '')) return null;
  let path = loc.pathname || '/';
  // Strip an explicit document name so a link to `.../index.html#access_token`
  // and `.../#access_token` both come back to the same canonical page.
  path = path.replace(/\/index\.html?$/i, '/');
  return loc.origin + path;
}

/**
 * Parse the fragment Supabase appends when it sends the player back after an
 * email link (implicit flow): `#access_token=…&refresh_token=…&type=signup`.
 * Errors come back the same way: `#error=access_denied&error_code=otp_expired
 * &error_description=…`. Returns null when the hash is not an auth payload.
 */
export function parseAuthFragment(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  if (params.get('access_token')) {
    const expiresIn = Number(params.get('expires_in')) || 3600;
    const expiresAt = Number(params.get('expires_at')) || Math.floor(Date.now() / 1000) + expiresIn;
    return {
      kind: 'session',
      type: params.get('type') || 'signup',
      session: {
        access_token: params.get('access_token'),
        refresh_token: params.get('refresh_token') || null,
        token_type: params.get('token_type') || 'bearer',
        expires_in: expiresIn,
        expires_at: expiresAt
      }
    };
  }
  if (params.get('error') || params.get('error_description') || params.get('error_code')) {
    const desc = params.get('error_description') || params.get('error') || 'Authentication failed.';
    return {
      kind: 'error',
      code: params.get('error_code') || params.get('error') || 'error',
      message: desc
    };
  }
  return null;
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
    // Grab (and scrub) any auth tokens Supabase put in the URL fragment right
    // away — before the Back-button history trap copies location.href.
    this._pendingLink = this._captureEmailLink();
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
   * Where the email links (confirm / reset password) should bring the player
   * back to: this very page. Sent as `redirect_to` on every auth call that
   * triggers an email — the parameter the Supabase JS client sends for
   * `emailRedirectTo` — so the project's default Site URL (localhost:3000 on
   * a fresh project) is never used.
   */
  get redirectTo() { return siteUrl(); }

  _redirectQuery() {
    const to = this.redirectTo;
    return to ? '?redirect_to=' + encodeURIComponent(to) : '';
  }

  async signUp(email, password, handle) {
    const body = await this._fetch('/auth/v1/signup' + this._redirectQuery(), {
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

  /** Send the "confirm your email" mail again (sign-up was not confirmed). */
  async resendConfirmation(email) {
    if (!email) throw new Error('Enter your email address first.');
    await this._fetch('/auth/v1/resend' + this._redirectQuery(), {
      method: 'POST',
      body: JSON.stringify({ type: 'signup', email })
    });
    return true;
  }

  /** Email a password-reset link that brings the player back to this page. */
  async requestPasswordReset(email) {
    if (!email) throw new Error('Enter your email address first.');
    await this._fetch('/auth/v1/recover' + this._redirectQuery(), {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    return true;
  }

  /** Set a new password for the signed-in user (after a recovery link). */
  async updatePassword(password) {
    if (!this.signedIn) throw new Error('Open the reset link from your email first.');
    if (!password || password.length < 6) throw new Error('Use at least 6 characters.');
    const user = await this._fetch('/auth/v1/user', {
      method: 'PUT',
      body: JSON.stringify({ password })
    });
    if (user?.id) {
      this.session = { ...this.session, user };
      this._persistSession();
    }
    return true;
  }

  /**
   * Synchronous half of the email-link flow: read the auth payload out of the
   * URL fragment and scrub it from the address bar + history entry right
   * away, so a reload, bookmark, screenshot or the Back-button history trap
   * (which copies location.href) never carries a live session.
   * Returns the parsed payload (see parseAuthFragment) or null.
   */
  _captureEmailLink(win = (typeof window !== 'undefined' ? window : null)) {
    const loc = win?.location;
    let parsed = null;
    try { parsed = parseAuthFragment(loc?.hash); } catch { parsed = null; }
    if (!parsed) return null;
    try {
      win.history.replaceState(win.history.state, '', loc.pathname + loc.search);
    } catch { try { loc.hash = ''; } catch { /* ignore */ } }
    return parsed;
  }

  /** True when the page was opened from an email link that still needs finishing. */
  get hasPendingEmailLink() { return !!this._pendingLink; }

  /**
   * Finish an email link. When the player clicks "Confirm your email" (or a
   * password-reset link) Supabase verifies the token and redirects to
   * `redirect_to` with the new session in the URL fragment:
   *   https://…/Game/#access_token=…&refresh_token=…&type=signup
   * Call this once on boot: it takes the tokens captured by the constructor
   * (or reads them from `win` when one is passed), stores the session — the
   * player is now signed in, no second sign-in needed — and reports what
   * happened so the UI can say so.
   *
   * @returns {null | {type, user} | {error, message}}
   */
  async completeEmailLink(win) {
    const parsed = win ? this._captureEmailLink(win) : this._pendingLink;
    this._pendingLink = null;
    if (!parsed) return null;

    if (parsed.kind === 'error') {
      const expired = /expired|invalid/i.test(parsed.code + ' ' + parsed.message);
      return {
        error: parsed.code,
        message: expired
          ? 'That email link has expired or was already used. Sign in — or request a new link from the ACCOUNT panel.'
          : parsed.message
      };
    }
    if (!this.configured) {
      return { error: 'no_server', message: 'The link is valid but no game server is connected. Main menu → ACCOUNT → CONNECT SERVER, then sign in.' };
    }
    this.session = parsed.session;
    try {
      const user = await this._fetch('/auth/v1/user');
      if (!user?.id) throw new Error('No user in response');
      this.session = { ...this.session, user };
      this._persistSession();
      await this.ensureProfile();
      this.emit('auth', this.user);
      return { type: parsed.type, user: this.user };
    } catch (e) {
      this.session = null;
      this._persistSession();
      return { error: 'session', message: 'Could not finish signing you in from the email link (' + (e?.message || e) + '). Please sign in with your password.' };
    }
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

  async findPlayers(handle) {
    if (!this.configured) return [];
    const q = 'handle=ilike.*' + encodeURIComponent(handle) + '*&select=id,handle,region&limit=15';
    return (await this._rest('profiles', q)) || [];
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
