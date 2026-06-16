// MicroRealm-style WebSocket client (control plane JSON, data plane JSON for simplicity).
// We keep wire-compat shape with abeto's protocol: {ping}/{r:[prefix,room]} out, {id}/{r}/{data}/{leave} in.
// Difference: data plane uses JSON (binary protobuf is overkill for our scale; flag-gated upgrade later).

export class MatrixNet extends EventTarget {
  constructor({ url, roomPrefix = 'matrix', room = 'zion', sendRateHz = 20, pingHz = 4 } = {}) {
    super();
    this.url = url ?? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    this.roomPrefix = roomPrefix;
    this.room = room;
    this.sendRateHz = sendRateHz;
    this.pingHz = pingHz;

    this.ws = null;
    this.connected = false;
    this.id = null;
    this.peers = new Map();           // id -> last data
    this.latency = 0;
    this.localData = { p: [0, 0, 0], r: [0, 0, 0], anim: 0, tag: '' };
    this.lastSent = 0;
    this.pendingPings = new Map();
    this.reconnectAttempt = 0;
  }

  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      this.dispatchEvent(new CustomEvent('error', { detail: e.message }));
      this._scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this._sendJson({ r: [this.roomPrefix, this.room] });
      this._heartbeat = setInterval(() => this._ping(), Math.floor(1000 / this.pingHz));
      this.dispatchEvent(new CustomEvent('open'));
    };
    this.ws.onmessage = (ev) => this._onMessage(ev);
    this.ws.onerror = (e) => this.dispatchEvent(new CustomEvent('error', { detail: e?.message ?? 'ws error' }));
    this.ws.onclose = () => {
      this.connected = false;
      clearInterval(this._heartbeat);
      this.dispatchEvent(new CustomEvent('close'));
      this._scheduleReconnect();
    };
  }

  disconnect() {
    if (!this.ws) return;
    try { this.ws.close(); } catch {}
    this.ws = null;
    clearInterval(this._heartbeat);
  }

  _scheduleReconnect() {
    const delay = Math.min(8000, 500 * 2 ** this.reconnectAttempt++);
    setTimeout(() => this.connect(), delay);
  }

  _sendJson(obj) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  _ping() {
    const t = performance.now();
    const nonce = Math.random().toString(36).slice(2, 8);
    this.pendingPings.set(nonce, t);
    this._sendJson({ ping: t, nonce });
  }

  _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)); }
    catch { return; }

    if (msg.id) {
      this.id = msg.id;
      this.connected = true;
      this.dispatchEvent(new CustomEvent('id', { detail: msg.id }));
      return;
    }
    if (msg.r && typeof msg.r === 'string') {
      this.peers.clear();
      this.room = msg.r;
      this.dispatchEvent(new CustomEvent('room', { detail: msg.r }));
      return;
    }
    if (msg.pong !== undefined) {
      const t0 = this.pendingPings.get(msg.nonce);
      if (t0) {
        this.latency = Math.round(performance.now() - t0);
        this.pendingPings.delete(msg.nonce);
      }
      return;
    }
    if (msg.leave) {
      this.peers.delete(msg.leave);
      this.dispatchEvent(new CustomEvent('leave', { detail: msg.leave }));
      return;
    }
    if (msg.data && msg.from) {
      const prev = this.peers.get(msg.from) ?? {};
      const merged = { ...prev, ...msg.data, _t: performance.now() };
      this.peers.set(msg.from, merged);
      this.dispatchEvent(new CustomEvent('peer', { detail: { from: msg.from, data: merged } }));
      // chat
      if (msg.data.chat) {
        this.dispatchEvent(new CustomEvent('chat', { detail: { from: msg.from, text: msg.data.chat } }));
      }
      return;
    }
  }

  /** Update local outgoing data; only diff is relayed at sendRateHz. */
  setLocal(patch) {
    Object.assign(this.localData, patch);
    const now = performance.now();
    if (now - this.lastSent >= 1000 / this.sendRateHz) {
      this.lastSent = now;
      this._sendJson({ data: this.localData });
    }
  }

  /** Send a one-shot chat / networkEvent (always relayed regardless of throttle). */
  sendChat(text) {
    this._sendJson({ data: { ...this.localData, chat: text } });
  }

  sendEvent(name, payload = {}) {
    this._sendJson({ data: { ...this.localData, networkEvent: JSON.stringify({ name, ...payload }) } });
  }
}
