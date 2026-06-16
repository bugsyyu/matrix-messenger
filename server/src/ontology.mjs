// Machine-readable physics + game ontology.
// Three representations of the SAME source-of-truth structure:
//   - WORLD: plain JS object (used by server + client + agents)
//   - ontologyJsonLd(): JSON-LD (W3C RDF graph, agent-readable)
//   - ontologyTurtle(): Turtle (.ttl) — same triples, human-friendlier
//
// The shape is deliberately small so an LLM agent reading /ontology can ingest
// the entire world in one fetch and start playing immediately.

export const WORLD = {
  id: 'urn:matrix-messenger:world',
  name: 'Matrix Messenger',
  version: '0.1.0',
  description:
    'A small simulated planet. Couriers route encrypted packets between districts. ' +
    'Physics is sphere-walking under radial gravity. Multiplayer relayed by a generic ' +
    'broker (microrealm-compatible). Agents can ingest this ontology and play.',
  authority: { name: 'Source Node', uri: 'http://localhost:3005/ontology' },

  // -- physics constants ----
  physics: {
    space: 'spherical',         // single sphere world
    planet_radius_m: 50,        // visible body radius
    gravity_m_s2: 28,           // toward planet center
    walk_speed_m_s: 9,          // surface speed
    jump_impulse_m_s: 12,       // radial impulse on jump
    surface_friction: 0.8,
    air_friction: 0.0,
    tick_rate_hz: 60,           // client physics
    network_update_hz: 20,      // outbound RealmData rate
    network_heartbeat_hz: 4,    // ping/pong
    time_scale: 1.0,
    coordinate_frame: 'world',  // positions in world space, m units
    local_up_rule: 'normalize(position - planet_center)',
  },

  // -- 6 districts (== gameplay nodes on the planet surface) ----
  // Each district carries (id) for our world + (abeto_alias) for the source game's ambiance ID,
  // so cross-domain agents can reconcile both vocabularies. Seam stability verified per ontology
  // Watson critic (2026-06-16, domain=complex, method_family=hybrid).
  districts: [
    {
      id: 'zion',         name: 'Zion Dock',           color: '#00ff41',
      abeto_alias: 'beach', abeto_ambiance: 'ambiances/beach.ogg',
      direction: [ 0,  1,  0],
      description: 'Last free city. Mail comes in raw.',
      role: ['hub', 'safe_house'],
    },
    {
      id: 'construct',    name: 'The Construct',       color: '#9eff00',
      abeto_alias: 'factory', abeto_ambiance: 'ambiances/factory.ogg',
      direction: [ 1,  0.2,  0],
      description: 'Loading program. Anything you can imagine, you can deliver.',
      role: ['training', 'sandbox'],
    },
    {
      id: 'mainframe',    name: 'Mainframe Spire',     color: '#39ff14',
      abeto_alias: 'city', abeto_ambiance: 'ambiances/city.ogg',
      direction: [-0.6,  0.3,  0.8],
      description: 'Sysadmin tower. Bureaucratic agents stamp the packets.',
      role: ['authority', 'audit'],
    },
    {
      id: 'loop',         name: 'The Loop',            color: '#39ffd1',
      abeto_alias: 'forest', abeto_ambiance: 'ambiances/forest.ogg',
      direction: [ 0.8, -0.3, -0.6],
      description: 'Recursive suburb. Couriers from the future leave you notes.',
      role: ['paradox'],
    },
    {
      id: 'source',       name: 'The Source',          color: '#ffb000',
      abeto_alias: 'temple', abeto_ambiance: 'ambiances/temple.ogg',
      direction: [-0.7, -0.4, -0.5],
      description: 'Where every package goes to be born and to die.',
      role: ['origin', 'sink'],
    },
    {
      id: 'oracle',       name: 'The Oracle’s Kitchen', color: '#ff8a00',
      abeto_alias: 'waterfalls', abeto_ambiance: 'ambiances/waterfalls.ogg',
      direction: [ 0,  -1,  0],
      description: 'Cookies, prophecies, gossip. Pickup on the counter.',
      role: ['rumor_market'],
    },
  ],

  // -- delivery types (== packets the courier can carry) ----
  delivery_types: [
    { id: 'redpill',     label: 'Redpill cache',    weight_kg: 0.4,  base_reward_rep: 30, danger: 'low' },
    { id: 'bluepill',    label: 'Bluepill memo',    weight_kg: 0.2,  base_reward_rep: 10, danger: 'low' },
    { id: 'glitch',      label: 'Glitch fragment',  weight_kg: 1.2,  base_reward_rep: 60, danger: 'medium' },
    { id: 'kernel',      label: 'Kernel update',    weight_kg: 0.8,  base_reward_rep: 45, danger: 'medium' },
    { id: 'whisper',     label: 'Oracle’s whisper', weight_kg: 0.05, base_reward_rep: 25, danger: 'low' },
    { id: 'agent_smith', label: 'Cursed packet',    weight_kg: 0.6,  base_reward_rep: -5, danger: 'high' },
  ],

  // -- quest state machine ----
  quest_lifecycle: {
    states: ['offered', 'pickup', 'deliver', 'complete', 'cancelled'],
    transitions: [
      { from: 'offered',  to: 'pickup',   on: 'accept' },
      { from: 'pickup',   to: 'deliver',  on: 'reach_source',   trigger_radius_m: 4.5 },
      { from: 'deliver',  to: 'complete', on: 'reach_target',   trigger_radius_m: 4.5 },
      { from: 'pickup',   to: 'cancelled',on: 'abandon' },
      { from: 'deliver',  to: 'cancelled',on: 'abandon' },
    ],
    reward_on: 'complete',
  },

  // -- actions an agent can perform ----
  actions: [
    {
      id: 'connect',
      description: 'Open WebSocket and join a room.',
      pre: [], post: ['joined'],
      protocol: { type: 'control', send: { r: ['<prefix>', '<room>'] } },
    },
    {
      id: 'set_state',
      description: 'Update your position/rotation/animation. Relayed @ 20Hz to peers.',
      pre: ['joined'], post: [],
      protocol: { type: 'data', send: { p: '[x,y,z] float', r: '[rx,ry,rz] float', anim: 'uint32', tag: 'string' } },
    },
    {
      id: 'chat',
      description: 'Send a chat line to everyone in the room.',
      pre: ['joined'], post: [],
      protocol: { type: 'data', send: { chat: '<text>' } },
    },
    {
      id: 'emit_event',
      description: 'Broadcast a named gameplay event (delivery_complete, emote, etc).',
      pre: ['joined'], post: [],
      protocol: { type: 'data', send: { networkEvent: 'JSON string {name, ...payload}' } },
    },
    {
      id: 'accept_quest',
      description: 'Locally accept the next offered quest. Server is fire-and-forget.',
      pre: ['joined'], post: ['quest_active'],
      protocol: { type: 'local' },
    },
    {
      id: 'pickup',
      description: 'Auto-fires when you enter trigger_radius of quest source.',
      pre: ['quest_active'], post: ['carrying'],
      protocol: { type: 'local', auto: true },
    },
    {
      id: 'deliver',
      description: 'Auto-fires when you enter trigger_radius of quest target.',
      pre: ['carrying'], post: ['quest_complete'],
      protocol: { type: 'local', auto: true },
    },
  ],

  // -- wire protocol (microrealm-compatible) ----
  network: {
    transport: 'websocket',
    endpoint: '/ws',
    subprotocols: [],
    control_plane: 'json',
    data_plane: 'json',
    client_to_server: {
      join_room: { r: ['<prefix>', '<room>'] },
      heartbeat: { ping: '<ts_ms>', nonce: '<string>' },
      state_update: { data: '<RealmData object>' },
    },
    server_to_client: {
      id_assignment: { id: '<4-char id>' },
      room_ack: { r: '<full_room_name>' },
      pong: { pong: '<ts_ms>', nonce: '<string>' },
      peer_data: { data: '<RealmData>', from: '<peer_id>' },
      peer_leave: { leave: '<peer_id>' },
    },
    realm_data_schema: {
      p: { type: 'float[3]', desc: 'position xyz in world space, meters' },
      r: { type: 'float[3]', desc: 'rotation as Euler XYZ, radians' },
      anim: { type: 'uint32', desc: 'animation id; 0=idle, 1=walk, 2=jump' },
      tag: { type: 'string', desc: 'display name, ≤16 chars' },
      chat: { type: 'string', desc: 'optional chat line (one-shot)' },
      networkEvent: { type: 'string', desc: 'optional JSON-encoded {name, ...}' },
    },
  },

  // -- agent contract ----
  agent_contract: {
    minimal_loop: [
      '1. GET /ontology  → cache world model',
      '2. open WS to /ws ; send {r:[prefix,room]}',
      '3. on {id} arrival, start sending {data:{p,r,anim,tag}} @ 20Hz',
      '4. on {data,from} arriving, update local peer table',
      '5. compute target = nearest district direction × radius',
      '6. step toward target each tick (constant speed * dt)',
      '7. when within 4.5m of a quest source → fire pickup ; same for target → fire deliver',
      '8. emit `{networkEvent: JSON.stringify({name:"delivery_complete", ...})}` on success',
    ],
    sdk_url: '/agent-sdk.js',
    example_javascript_import: "import {AgentClient} from 'http://localhost:3005/agent-sdk.js'",
  },
};

// ---------- JSON-LD ----------
const NS = {
  '@vocab': 'urn:matrix-messenger:vocab#',
  schema: 'https://schema.org/',
  geo: 'https://schema.org/GeoCoordinates',
  prov: 'http://www.w3.org/ns/prov#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
};

export function ontologyJsonLd() {
  return {
    '@context': NS,
    '@id': WORLD.id,
    '@type': 'World',
    'schema:name': WORLD.name,
    'schema:version': WORLD.version,
    'rdfs:comment': WORLD.description,
    authority: WORLD.authority,
    physics: { '@type': 'Physics', ...WORLD.physics },
    districts: WORLD.districts.map((d) => ({
      '@id': `urn:matrix-messenger:district:${d.id}`,
      '@type': 'District',
      'schema:identifier': d.id,
      'schema:name': d.name,
      color: d.color,
      direction_unit_vector: d.direction,
      'rdfs:comment': d.description,
      role: d.role,
      // cross-domain reconciliation (Watson critic recommendation 2026-06-16):
      // these alias fields let an agent that knows abeto's vocabulary map to ours and back.
      'schema:sameAs': d.abeto_alias ? `urn:abeto:ambiance:${d.abeto_alias}` : undefined,
      abeto_alias: d.abeto_alias,
      abeto_ambiance: d.abeto_ambiance,
    })),
    delivery_types: WORLD.delivery_types.map((t) => ({
      '@id': `urn:matrix-messenger:delivery_type:${t.id}`,
      '@type': 'DeliveryType',
      'schema:identifier': t.id,
      'schema:name': t.label,
      weight_kg: t.weight_kg,
      base_reward_rep: t.base_reward_rep,
      danger: t.danger,
    })),
    quest_lifecycle: { '@type': 'StateMachine', ...WORLD.quest_lifecycle },
    actions: WORLD.actions.map((a) => ({
      '@id': `urn:matrix-messenger:action:${a.id}`,
      '@type': 'Action',
      'schema:identifier': a.id,
      'rdfs:comment': a.description,
      precondition: a.pre,
      postcondition: a.post,
      protocol: a.protocol,
    })),
    network: { '@type': 'NetworkProtocol', ...WORLD.network },
    agent_contract: { '@type': 'AgentContract', ...WORLD.agent_contract },
  };
}

// ---------- Turtle ----------
export function ontologyTurtle() {
  const w = WORLD;
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const triples = [];
  const T = (...t) => triples.push(t.join(' '));

  T('@prefix mm:   <urn:matrix-messenger:vocab#> .');
  T('@prefix schema: <https://schema.org/> .');
  T('@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .');
  T('@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .');
  T('');
  T(`<${w.id}> a mm:World ;`);
  T(`  schema:name "${esc(w.name)}" ;`);
  T(`  schema:version "${esc(w.version)}" ;`);
  T(`  rdfs:comment "${esc(w.description)}" ;`);
  T(`  mm:planetRadius "${w.physics.planet_radius_m}"^^xsd:decimal ;`);
  T(`  mm:gravity "${w.physics.gravity_m_s2}"^^xsd:decimal ;`);
  T(`  mm:walkSpeed "${w.physics.walk_speed_m_s}"^^xsd:decimal ;`);
  T(`  mm:tickRateHz "${w.physics.tick_rate_hz}"^^xsd:integer ;`);
  T(`  mm:networkUpdateHz "${w.physics.network_update_hz}"^^xsd:integer ;`);
  T(`  mm:ontologyUrl <http://localhost:3005/ontology> .`);
  T('');

  for (const d of w.districts) {
    T(`<urn:matrix-messenger:district:${d.id}> a mm:District ;`);
    T(`  schema:identifier "${d.id}" ;`);
    T(`  schema:name "${esc(d.name)}" ;`);
    T(`  mm:color "${d.color}" ;`);
    T(`  mm:directionX "${d.direction[0]}"^^xsd:decimal ;`);
    T(`  mm:directionY "${d.direction[1]}"^^xsd:decimal ;`);
    T(`  mm:directionZ "${d.direction[2]}"^^xsd:decimal ;`);
    T(`  mm:role ${d.role.map((r) => `"${r}"`).join(', ')} ;`);
    if (d.abeto_alias) {
      T(`  mm:abetoAlias "${d.abeto_alias}" ;`);
      T(`  schema:sameAs <urn:abeto:ambiance:${d.abeto_alias}> ;`);
    }
    T(`  rdfs:comment "${esc(d.description)}" .`);
    T('');
  }

  for (const t of w.delivery_types) {
    T(`<urn:matrix-messenger:delivery_type:${t.id}> a mm:DeliveryType ;`);
    T(`  schema:identifier "${t.id}" ;`);
    T(`  schema:name "${esc(t.label)}" ;`);
    T(`  mm:weightKg "${t.weight_kg}"^^xsd:decimal ;`);
    T(`  mm:baseRewardRep "${t.base_reward_rep}"^^xsd:integer ;`);
    T(`  mm:danger "${t.danger}" .`);
    T('');
  }

  for (const a of w.actions) {
    T(`<urn:matrix-messenger:action:${a.id}> a mm:Action ;`);
    T(`  schema:identifier "${a.id}" ;`);
    T(`  rdfs:comment "${esc(a.description)}" ;`);
    if (a.pre.length) T(`  mm:precondition ${a.pre.map((p) => `"${p}"`).join(', ')} ;`);
    if (a.post.length) T(`  mm:postcondition ${a.post.map((p) => `"${p}"`).join(', ')} ;`);
    T(`  mm:protocolType "${a.protocol.type}" .`);
    T('');
  }

  return triples.join('\n') + '\n';
}

// ---------- Drop-in agent SDK ----------
export function agentSdkSource() {
  return `// Matrix Messenger agent SDK.
// Import into any browser or Node 22+:
//   import { AgentClient } from 'http://<host>/agent-sdk.js';
//
// Usage:
//   const c = new AgentClient({ url: 'ws://localhost:3005/ws', tag: 'mybot' });
//   await c.connect();
//   await c.ingestOntology('http://localhost:3005/ontology');
//   // c.world is now the full machine-readable world
//   c.goto('oracle');                  // walk toward a district
//   c.onPeer(p => console.log(p));
//   c.onChat((from, text) => c.say('I hear you, ' + from));

const fetchFn = (typeof fetch === 'function') ? fetch : (await import('node:https')).then(() => null);

const Vec = {
  sub: (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]],
  add: (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]],
  mul: (a, k) => [a[0]*k, a[1]*k, a[2]*k],
  norm: (a) => { const L = Math.hypot(...a) || 1; return [a[0]/L, a[1]/L, a[2]/L]; },
  len: (a) => Math.hypot(...a),
  dist: (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]),
};

export class AgentClient {
  constructor({ url, tag = 'agent', roomPrefix = 'matrix', room = 'zion', sendHz = 10 } = {}) {
    this.url = url; this.tag = tag; this.roomPrefix = roomPrefix; this.room = room;
    this.sendHz = sendHz;
    this.world = null;
    this.id = null;
    this.peers = new Map();
    this.state = { p: [0, 0, 0], r: [0, 0, 0], anim: 0, tag };
    this.handlers = { peer: [], chat: [], event: [], open: [], close: [], id: [] };
    this._goalDistrict = null;
    this._tickTimer = null;
  }

  async ingestOntology(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('ontology fetch ' + res.status);
    this.world = await res.json();
    const physics = this.world.physics || {};
    this.planetRadius = physics.planet_radius_m ?? 50;
    this.walkSpeed = physics.walk_speed_m_s ?? 9;
    // place ourselves at zion by default
    const zion = (this.world.districts || []).find((d) => d['schema:identifier'] === 'zion');
    if (zion) {
      const dir = Vec.norm(zion.direction_unit_vector);
      this.state.p = Vec.mul(dir, this.planetRadius + 0.5);
    }
    return this.world;
  }

  async connect() {
    const WSImpl = (typeof WebSocket !== 'undefined')
      ? WebSocket
      : (await import('ws')).default;
    return new Promise((resolve, reject) => {
      this.ws = new WSImpl(this.url);
      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({ r: [this.roomPrefix, this.room] }));
        for (const h of this.handlers.open) h();
        this._startTick();
        resolve();
      };
      this.ws.onmessage = (ev) => this._onMessage(ev);
      this.ws.onerror = (e) => reject(e?.message || e);
      this.ws.onclose = () => { this._stopTick(); for (const h of this.handlers.close) h(); };
    });
  }

  _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); }
    catch { return; }
    if (msg.id) { this.id = msg.id; for (const h of this.handlers.id) h(msg.id); return; }
    if (msg.r && typeof msg.r === 'string') { this.room = msg.r; return; }
    if (msg.pong !== undefined) return;
    if (msg.leave) { this.peers.delete(msg.leave); return; }
    if (msg.data && msg.from) {
      const prev = this.peers.get(msg.from) || {};
      const merged = { ...prev, ...msg.data, _t: Date.now() };
      this.peers.set(msg.from, merged);
      for (const h of this.handlers.peer) h({ from: msg.from, data: merged });
      if (msg.data.chat) for (const h of this.handlers.chat) h(msg.from, msg.data.chat);
      if (msg.data.networkEvent) {
        try { const e = JSON.parse(msg.data.networkEvent); for (const h of this.handlers.event) h(msg.from, e); } catch {}
      }
    }
  }

  _startTick() {
    this._stopTick();
    const dt = 1 / this.sendHz;
    this._tickTimer = setInterval(() => this._tick(dt), Math.floor(1000 / this.sendHz));
  }
  _stopTick() { if (this._tickTimer) clearInterval(this._tickTimer); this._tickTimer = null; }

  _tick(dt) {
    if (this._goalDistrict && this.world) {
      const d = (this.world.districts || []).find((x) => x['schema:identifier'] === this._goalDistrict);
      if (d) {
        const targetDir = Vec.norm(d.direction_unit_vector);
        const myDir = Vec.norm(this.state.p);
        // angle between current and target on the sphere (radians)
        const dot = Math.max(-1, Math.min(1, myDir[0]*targetDir[0] + myDir[1]*targetDir[1] + myDir[2]*targetDir[2]));
        const angle = Math.acos(dot);
        if (angle < 0.01) {
          this._goalDistrict = null;
          this.state.anim = 0;
        } else {
          this.state.anim = 1;
          // angular speed = walkSpeed / radius (great circle)
          // small jitter on near-antipodal so we don't sit in the cos≈-1 singularity
          const omega = this.walkSpeed / this.planetRadius;
          const step = Math.min(omega * dt, angle);
          // slerp from myDir to targetDir by fraction (step/angle)
          const t = step / angle;
          let nextDir;
          if (Math.abs(angle - Math.PI) < 0.05) {
            // near antipode: pick an arbitrary tangent
            const ortho = Math.abs(myDir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
            const tangent = Vec.norm([
              ortho[1] * myDir[2] - ortho[2] * myDir[1],
              ortho[2] * myDir[0] - ortho[0] * myDir[2],
              ortho[0] * myDir[1] - ortho[1] * myDir[0],
            ]);
            nextDir = [
              myDir[0] * Math.cos(step) + tangent[0] * Math.sin(step),
              myDir[1] * Math.cos(step) + tangent[1] * Math.sin(step),
              myDir[2] * Math.cos(step) + tangent[2] * Math.sin(step),
            ];
          } else {
            const s = Math.sin(angle);
            const w1 = Math.sin((1 - t) * angle) / s;
            const w2 = Math.sin(t * angle) / s;
            nextDir = [
              myDir[0] * w1 + targetDir[0] * w2,
              myDir[1] * w1 + targetDir[1] * w2,
              myDir[2] * w1 + targetDir[2] * w2,
            ];
          }
          this.state.p = Vec.mul(Vec.norm(nextDir), this.planetRadius);
        }
      }
    }
    this._send({ data: { ...this.state } });
  }

  _send(obj) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  goto(districtId) { this._goalDistrict = districtId; }
  say(text) { this._send({ data: { ...this.state, chat: text } }); }
  emit(name, payload = {}) {
    this._send({ data: { ...this.state, networkEvent: JSON.stringify({ name, ...payload }) } });
  }
  setTag(tag) { this.tag = tag; this.state.tag = tag; }

  onPeer(fn) { this.handlers.peer.push(fn); }
  onChat(fn) { this.handlers.chat.push(fn); }
  onEvent(fn) { this.handlers.event.push(fn); }
  onOpen(fn)  { this.handlers.open.push(fn); }
  onClose(fn) { this.handlers.close.push(fn); }
  onId(fn)    { this.handlers.id.push(fn); }

  disconnect() { this._stopTick(); try { this.ws?.close(); } catch {} }
}

export default AgentClient;
`;
}
