// Multiplayer — co-op session over Supabase Realtime (Phoenix channels).
//
// Players who JOIN the same server share a Realtime channel. Each peer
// broadcasts ship/surface pose + a shared cargo pool. The host (lowest
// user id, or the server owner) is authoritative for shared resources so
// two players don't double-spend the same ore.
//
// No extra npm deps — talks the Phoenix channel protocol the Realtime
// gateway already speaks. Works with the existing servers/presence tables.
import { RESOURCE_IDS } from '../world/Resources.js';

const TICK_HZ = 8;                 // pose broadcasts per second
const STALE_MS = 4500;             // drop peers we haven't heard from
const RECONNECT_MS = 2500;
const HEARTBEAT_MS = 25000;        // phoenix heartbeat

function emptyCargo() {
  const c = {};
  for (const id of RESOURCE_IDS) c[id] = 0;
  return c;
}

function mergeCargo(a, b) {
  const out = emptyCargo();
  for (const id of RESOURCE_IDS) out[id] = Math.max(0, (a?.[id] || 0) + (b?.[id] || 0));
  return out;
}

/**
 * Minimal Phoenix / Supabase Realtime client.
 * Topic format:  realtime:public:<channel>
 * Events we use: broadcast (phx_reply / broadcast)
 */
class RealtimeSocket {
  constructor(url, key, accessToken) {
    this.url = url;
    this.key = key;
    this.accessToken = accessToken;
    this.ws = null;
    this.ref = 0;
    this.joined = new Map();       // topic → { status, onMsg }
    this._pending = new Map();     // ref → { resolve, reject, t }
    this._hb = null;
    this._alive = false;
    this.onStatus = null;          // 'open' | 'close' | 'error'
    this.onBroadcast = null;       // (topic, event, payload) => void
  }

  _nextRef() { return String(++this.ref); }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    const base = this.url.replace(/^http/, 'ws').replace(/\/+$/, '');
    const params = new URLSearchParams({
      apikey: this.key,
      vsn: '1.0.0'
    });
    if (this.accessToken) params.set('token', this.accessToken);
    const wsUrl = `${base}/realtime/v1/websocket?${params.toString()}`;
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      this.onStatus?.('error', e);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this._alive = true;
      this.onStatus?.('open');
      // rejoin any topics that were open before a reconnect
      for (const [topic, meta] of this.joined) this._join(topic, meta.payload || {});
      this._hb = setInterval(() => this._heartbeat(), HEARTBEAT_MS);
    };
    ws.onclose = () => {
      this._alive = false;
      clearInterval(this._hb);
      this._hb = null;
      this.onStatus?.('close');
    };
    ws.onerror = (e) => this.onStatus?.('error', e);
    ws.onmessage = (ev) => this._onMessage(ev.data);
  }

  disconnect() {
    clearInterval(this._hb);
    this._hb = null;
    try { this.ws?.close(); } catch { /* */ }
    this.ws = null;
    this._alive = false;
    this.joined.clear();
  }

  _send(msg) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    try { this.ws.send(JSON.stringify(msg)); return true; }
    catch { return false; }
  }

  _heartbeat() {
    this._send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: this._nextRef() });
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { topic, event, payload, ref } = msg || {};
    if (ref && this._pending.has(ref)) {
      const p = this._pending.get(ref);
      this._pending.delete(ref);
      if (payload?.status === 'ok' || event === 'phx_reply') p.resolve(payload);
      else p.reject(payload);
    }
    if (event === 'phx_reply' && payload?.status === 'ok') {
      const meta = this.joined.get(topic);
      if (meta) meta.status = 'joined';
    }
    // Realtime broadcast frames arrive as event === 'broadcast'
    // (payload = { event, payload }) or as the custom event name itself.
    if (event === 'broadcast' && payload) {
      this.onBroadcast?.(topic, payload.event || 'message', payload.payload || payload);
    } else if (event && event !== 'phx_reply' && event !== 'phx_close' && event !== 'phx_error' && event !== 'presence_state' && event !== 'presence_diff') {
      this.onBroadcast?.(topic, event, payload);
    }
  }

  _join(topic, payload = {}) {
    const ref = this._nextRef();
    return new Promise((resolve, reject) => {
      this._pending.set(ref, { resolve, reject, t: Date.now() });
      this._send({
        topic,
        event: 'phx_join',
        payload: {
          config: {
            broadcast: { ack: false, self: false },
            presence: { key: '' },
            private: false
          },
          access_token: this.accessToken || this.key,
          ...payload
        },
        ref,
        join_ref: ref
      });
      // Don't hang forever if the gateway never answers.
      setTimeout(() => {
        if (this._pending.has(ref)) {
          this._pending.delete(ref);
          resolve({ status: 'timeout' });
        }
      }, 6000);
    });
  }

  async subscribe(topic) {
    this.joined.set(topic, { status: 'joining', payload: {} });
    if (!this._alive) this.connect();
    else await this._join(topic);
    return topic;
  }

  unsubscribe(topic) {
    if (!this.joined.has(topic)) return;
    this._send({ topic, event: 'phx_leave', payload: {}, ref: this._nextRef() });
    this.joined.delete(topic);
  }

  /** Fire-and-forget broadcast to everyone else on the topic. */
  broadcast(topic, event, payload) {
    return this._send({
      topic,
      event: 'broadcast',
      payload: { type: 'broadcast', event, payload },
      ref: this._nextRef()
    });
  }
}

/**
 * High-level multiplayer session bound to one game server row.
 */
export class MultiplayerSession {
  /**
   * @param backend  Backend instance
   * @param hooks {
   *   getLocalState(): { handle, mode, position, quaternion, velocity,
   *                      location, resources, fuel, energy, shield, hull }
   *   onPeers(peersMap)
   *   onSharedCargo(resources, credits)
   *   onChat?(msg)
   *   onStatus?(text, kind)
   *   isHost?(): boolean
   * }
   */
  constructor(backend, hooks = {}) {
    this.backend = backend;
    this.hooks = hooks;
    this.server = null;
    this.socket = null;
    this.topic = null;
    this.peers = new Map();          // userId → last snapshot
    this.sharedCargo = emptyCargo();
    this.sharedCredits = 0;
    this.connected = false;
    this.isHost = false;
    this._tickT = 0;
    this._pollT = 0;
    this._reconnectT = 0;
    this._lastPush = 0;
    this._seq = 0;
    this._cargoEpoch = 0;
    this._disposed = false;
    this._useRealtime = true;
    this._fallbackOnly = false;
  }

  get active() { return !!(this.server && !this._disposed); }
  get playerCount() { return 1 + this.peers.size; }
  get peerList() { return [...this.peers.values()]; }

  async join(server) {
    if (!server?.id) throw new Error('No server selected.');
    this._disposed = false;
    this.server = server;
    this.peers.clear();
    this.sharedCargo = emptyCargo();
    this.sharedCredits = 0;
    this._cargoEpoch = 0;
    this.isHost = !!(this.backend.userId && server.owner_id === this.backend.userId);

    // Presence is the durable "who is on this server" signal.
    try {
      await this.backend.setPresence(server.id, 'in-game', 'Joining…');
    } catch { /* offline is fine — local fallback still works */ }

    // Seed shared cargo from the local player so the first host push has data.
    const local = this.hooks.getLocalState?.();
    if (local?.resources) this.sharedCargo = { ...emptyCargo(), ...local.resources };
    if (Number.isFinite(local?.credits)) this.sharedCredits = local.credits;

    await this._connectSocket();
    this.connected = true;
    this.hooks.onStatus?.(`Joined ${server.name}`, 'success');
    // Immediate presence pull so friends already in-game appear right away.
    this._pollPresence().catch(() => {});
    return true;
  }

  async leave() {
    this._disposed = true;
    if (this.topic && this.socket) {
      try { this.socket.broadcast(this.topic, 'leave', { id: this.backend.userId }); } catch { /* */ }
      this.socket.unsubscribe(this.topic);
    }
    this.socket?.disconnect();
    this.socket = null;
    this.topic = null;
    this.peers.clear();
    this.connected = false;
    const sid = this.server?.id;
    this.server = null;
    if (sid && this.backend.signedIn) {
      try { await this.backend.setPresence(null, 'online', 'Main menu'); } catch { /* */ }
      try { await this.backend.serverHeartbeat(sid, Math.max(0, 0)); } catch { /* */ }
    }
  }

  async _connectSocket() {
    if (!this.backend.configured || !this.server) return;
    if (!this.backend.signedIn) {
      // Guests still get a local "solo co-op" room via BroadcastChannel when
      // two tabs share the browser — Realtime needs a JWT.
      this._fallbackOnly = true;
      this._openLocalBus();
      return;
    }
    this._fallbackOnly = false;
    const sock = new RealtimeSocket(this.backend.url, this.backend.key, this.backend.session?.access_token);
    this.socket = sock;
    sock.onStatus = (s) => {
      if (s === 'close' && !this._disposed) this._reconnectT = RECONNECT_MS / 1000;
      if (s === 'open') this.connected = true;
    };
    sock.onBroadcast = (topic, event, payload) => {
      if (topic !== this.topic) return;
      this._onEvent(event, payload);
    };
    // Public broadcast channel keyed by server id — every client on this
    // server joins the same topic.
    this.topic = `realtime:public:so-server-${this.server.id}`;
    sock.connect();
    try {
      await sock.subscribe(this.topic);
    } catch (e) {
      console.warn('[mp] realtime join failed, falling back to presence poll', e);
      this._useRealtime = false;
    }
    // Always keep the local bus too so two tabs on the same machine can play
    // even if Realtime is blocked by a network filter.
    this._openLocalBus();
  }

  _openLocalBus() {
    try {
      if (typeof BroadcastChannel === 'undefined' || !this.server) return;
      this._bus?.close?.();
      this._bus = new BroadcastChannel('solar-odyssey-mp-' + this.server.id);
      this._bus.onmessage = (ev) => {
        const { event, payload } = ev.data || {};
        if (!event) return;
        // Ignore our own echoes.
        if (payload?.id && payload.id === (this.backend.userId || this._guestId())) return;
        this._onEvent(event, payload);
      };
    } catch { /* private browsing etc. */ }
  }

  _guestId() {
    if (!this._gid) {
      try {
        let g = sessionStorage.getItem('so-mp-gid');
        if (!g) { g = 'g-' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('so-mp-gid', g); }
        this._gid = g;
      } catch { this._gid = 'g-' + Math.random().toString(36).slice(2, 10); }
    }
    return this._gid;
  }

  _emit(event, payload) {
    if (this.topic && this.socket) this.socket.broadcast(this.topic, event, payload);
    try { this._bus?.postMessage({ event, payload }); } catch { /* */ }
  }

  _onEvent(event, payload) {
    if (!payload) return;
    if (event === 'state' || event === 'pose') this._acceptPeer(payload);
    else if (event === 'cargo') this._acceptCargo(payload);
    else if (event === 'leave' && payload.id) {
      this.peers.delete(payload.id);
      this.hooks.onPeers?.(this.peers);
    } else if (event === 'chat') {
      this.hooks.onChat?.(payload);
    } else if (event === 'invite') {
      this.hooks.onInvite?.(payload);
    }
  }

  _acceptPeer(p) {
    if (!p?.id) return;
    const self = this.backend.userId || this._guestId();
    if (p.id === self) return;
    const prev = this.peers.get(p.id) || {};
    this.peers.set(p.id, {
      ...prev,
      ...p,
      lastSeen: performance.now()
    });
    // Host election: lowest id wins (stable, no chatter).
    this._reelectHost();
    this.hooks.onPeers?.(this.peers);
  }

  _reelectHost() {
    const self = this.backend.userId || this._guestId();
    let host = self;
    for (const id of this.peers.keys()) {
      if (String(id) < String(host)) host = id;
    }
    // Server owner always preferred when present.
    if (this.server?.owner_id && (this.peers.has(this.server.owner_id) || this.server.owner_id === self)) {
      host = this.server.owner_id;
    }
    this.isHost = host === self;
  }

  _acceptCargo(msg) {
    if (!msg || typeof msg !== 'object') return;
    // Only accept cargo from the host, or a newer epoch if we have no host yet.
    const epoch = Number(msg.epoch) || 0;
    if (epoch < this._cargoEpoch && this.peers.size > 0) return;
    this._cargoEpoch = Math.max(this._cargoEpoch, epoch);
    if (msg.resources) {
      this.sharedCargo = { ...emptyCargo(), ...msg.resources };
      this.hooks.onSharedCargo?.(this.sharedCargo, msg.credits);
    }
    if (Number.isFinite(msg.credits)) this.sharedCredits = msg.credits;
  }

  /**
   * Push the local shared-cargo snapshot (host only). Non-hosts call
   * requestCargoChange() so the host can apply and rebroadcast.
   */
  pushCargo(resources, credits) {
    this.sharedCargo = { ...emptyCargo(), ...resources };
    if (Number.isFinite(credits)) this.sharedCredits = credits;
    this._cargoEpoch++;
    this._emit('cargo', {
      id: this.backend.userId || this._guestId(),
      epoch: this._cargoEpoch,
      resources: this.sharedCargo,
      credits: this.sharedCredits,
      host: this.isHost
    });
  }

  /** Non-host proposes a cargo delta; host applies on next tick via hook. */
  proposeCargoDelta(delta, creditDelta = 0) {
    this._emit('cargo_delta', {
      id: this.backend.userId || this._guestId(),
      delta, creditDelta,
      t: Date.now()
    });
    // Optimistic local apply so the UI feels instant; host will correct.
    if (delta) {
      for (const k of RESOURCE_IDS) {
        if (delta[k]) this.sharedCargo[k] = Math.max(0, (this.sharedCargo[k] || 0) + delta[k]);
      }
      this.hooks.onSharedCargo?.(this.sharedCargo, this.sharedCredits + creditDelta);
    }
  }

  /** Per-frame update — call from the game loop with real dt. */
  update(dt) {
    if (!this.active) return;
    this._tickT += dt;
    this._pollT += dt;
    if (this._reconnectT > 0) {
      this._reconnectT -= dt;
      if (this._reconnectT <= 0) this._connectSocket().catch(() => {});
    }

    // Drop stale peers.
    const now = performance.now();
    let changed = false;
    for (const [id, p] of this.peers) {
      if (now - (p.lastSeen || 0) > STALE_MS) { this.peers.delete(id); changed = true; }
    }
    if (changed) this.hooks.onPeers?.(this.peers);

    // Broadcast local pose at TICK_HZ.
    if (this._tickT >= 1 / TICK_HZ) {
      this._tickT = 0;
      this._pushState();
    }

    // Presence + player count heartbeat every ~4s.
    if (this._pollT >= 4) {
      this._pollT = 0;
      this._pollPresence().catch(() => {});
      if (this.isHost && this.server?.id && this.backend.signedIn) {
        this.backend.serverHeartbeat(this.server.id, this.playerCount).catch(() => {});
      }
    }
  }

  _pushState() {
    const local = this.hooks.getLocalState?.();
    if (!local) return;
    const id = this.backend.userId || this._guestId();
    const payload = {
      id,
      handle: local.handle || this.backend.handle || 'Commander',
      mode: local.mode || 'space',
      bodyId: local.bodyId || null,
      pos: local.position ? [local.position.x, local.position.y, local.position.z] : null,
      quat: local.quaternion ? [local.quaternion.x, local.quaternion.y, local.quaternion.z, local.quaternion.w] : null,
      vel: local.velocity ? [local.velocity.x, local.velocity.y, local.velocity.z] : null,
      location: local.location || null,
      fuel: local.fuel, energy: local.energy, shield: local.shield, hull: local.hull,
      seq: ++this._seq,
      t: Date.now(),
      host: this.isHost
    };
    this._emit('state', payload);

    // Host rebroadcasts cargo occasionally so late joiners catch up.
    if (this.isHost && (this._seq % 16 === 0)) {
      this._emit('cargo', {
        id,
        epoch: this._cargoEpoch,
        resources: this.sharedCargo,
        credits: this.sharedCredits,
        host: true
      });
    }
  }

  async _pollPresence() {
    if (!this.backend.configured || !this.server?.id) return;
    try {
      // Presence rows for everyone on this server — used as a discovery
      // fallback when Realtime is blocked, and to paint the roster.
      const rows = await this.backend.listServerPresence(this.server.id);
      const self = this.backend.userId;
      const now = performance.now();
      for (const r of rows || []) {
        if (!r.user_id || r.user_id === self) continue;
        if (r.status === 'offline') continue;
        // Don't overwrite a fresher realtime pose.
        const existing = this.peers.get(r.user_id);
        if (existing && now - (existing.lastSeen || 0) < 2000) continue;
        let loc = r.location || '';
        let parsed = null;
        if (loc.startsWith('{')) {
          try { parsed = JSON.parse(loc); } catch { /* plain string */ }
        }
        this.peers.set(r.user_id, {
          id: r.user_id,
          handle: r.handle || existing?.handle || 'Commander',
          mode: parsed?.mode || existing?.mode || 'space',
          bodyId: parsed?.bodyId || existing?.bodyId || null,
          pos: parsed?.pos || existing?.pos || null,
          quat: parsed?.quat || existing?.quat || null,
          location: parsed?.location || loc,
          lastSeen: existing?.lastSeen || now,
          via: 'presence'
        });
      }
      this._reelectHost();
      this.hooks.onPeers?.(this.peers);
    } catch (e) {
      // Presence is best-effort.
      console.warn('[mp] presence poll', e?.message || e);
    }

    // Also stamp our own presence with a compact pose so friends who only
    // read the table still see us.
    if (this.backend.signedIn) {
      const local = this.hooks.getLocalState?.();
      if (local) {
        const compact = JSON.stringify({
          mode: local.mode,
          bodyId: local.bodyId || null,
          pos: local.position ? [
            Math.round(local.position.x * 10) / 10,
            Math.round(local.position.y * 10) / 10,
            Math.round(local.position.z * 10) / 10
          ] : null,
          location: local.location || null
        });
        this.backend.setPresence(this.server.id, 'in-game', compact).catch(() => {});
      }
    }
  }

  /** Seed shared cargo from the solo player's hold when first joining. */
  seedFromLocal(resources, credits) {
    this.sharedCargo = mergeCargo(emptyCargo(), resources || {});
    this.sharedCredits = credits || 0;
    this._cargoEpoch++;
  }
}

export { emptyCargo, mergeCargo };
