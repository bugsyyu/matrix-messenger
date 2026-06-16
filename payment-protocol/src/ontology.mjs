// Inter-Agent Payment Protocol — ontology source of truth.
//
// Same pattern as ../../server/src/ontology.mjs: one WORLD literal, three
// surfaces (JSON-LD, Turtle, JS SDK), all derived from the literal so they
// can't drift.

export const WORLD = {
  id: 'urn:iap:protocol',
  name: 'Inter-Agent Payment Protocol',
  version: '0.1.0',
  description:
    'A machine-readable payment + trust schema for autonomous agents. ' +
    'Off-chain bilateral channels with signed state and a challenge window; ' +
    'observer-side TrustScore via EWMA + time decay. ' +
    'Designed so any agent can fetch /payment-ontology, import /payment-sdk.js, ' +
    'and begin transacting within a minute.',
  authority: { name: 'IAP reference impl', uri: 'http://localhost:3105/payment-ontology' },

  classes: [
    { id: 'Agent',           description: 'Anything that owns a keypair and can sign requests.' },
    { id: 'Account',         description: 'Per-asset balance bucket owned by exactly one Agent.' },
    { id: 'PaymentChannel',  description: 'Bilateral, single-asset, off-chain payment lane.' },
    { id: 'Transfer',        description: 'One signed (seq, balances) snapshot inside a channel.' },
    { id: 'Settlement',      description: 'Terminal on-chain effect of a channel.' },
    { id: 'TrustScore',      description: "Observer-side belief about a subject's reliability." },
  ],

  // OWL-ish object properties; agents that consume the ontology can build a
  // relationship graph without parsing English.
  relations: [
    { id: 'owns',           domain: 'Agent',          range: 'Account' },
    { id: 'participatesIn', domain: 'Account',        range: 'PaymentChannel' },
    { id: 'between',        domain: 'PaymentChannel', range: 'Agent',  cardinality: 2 },
    { id: 'hasState',       domain: 'PaymentChannel', range: 'Transfer', latest_wins: true },
    { id: 'signedBy',       domain: 'Transfer',       range: 'Agent',  cardinality: 2 },
    { id: 'closes',         domain: 'Settlement',     range: 'PaymentChannel' },
    { id: 'observedBy',     domain: 'TrustScore',     range: 'Agent' },
    { id: 'about',          domain: 'TrustScore',     range: 'Agent' },
    { id: 'basedOn',        domain: 'TrustScore',     range: 'Transfer*' },
  ],

  // Off-chain settlement parameters (matches DESIGN §2)
  channel_params: {
    deposit_unit: 'micro',                  // 1 micro = 10^-6 of the asset
    max_open_channels_per_pair: 16,         // 4-bit nonce in the URN
    challenge_window_ms: 5000,              // demo; production = 86_400_000
    challenge_reset_ms: 2500,               // each successful challenge halves remaining time
    challenge_reset_cap: 3,                 // bounded delay; after 3 resets, timer doesn't move
    seq_overflow_at: 2 ** 32,               // wraps would invalidate "highest seq wins" comparison
    signature: 'ed25519',
    state_hash: 'sha256',
  },

  // TrustScore tunables (matches DESIGN §3)
  trust_params: {
    cold_start: 0.30,
    alpha: 0.18,                            // EWMA mixing weight per observation
    weight_cap: 5.0,                        // value-based weight ceiling
    decay_grace_ms: 3_600_000,              // 1h grace before decay kicks in
    decay_halflife_ms: 86_400_000,          // 24h half-life toward cold_start
    score_range: [0, 1],
  },

  // Wire actions — the full surface agents need to expose
  actions: [
    {
      id: 'open',
      description: 'Open a channel between two agents with mutual deposits.',
      pre: ['both_online'], post: ['channel_OPEN'],
      who: ['party_a', 'party_b'], requires_signatures_from: 2,
      protocol: { type: 'control', send: { kind: 'open', a: '<agentA>', b: '<agentB>', deposit_a: '<u64>', deposit_b: '<u64>', asset: '<string>' } },
    },
    {
      id: 'pay',
      description: 'Move value within an open channel. Builds a new signed Transfer with seq = prev+1.',
      pre: ['channel_OPEN'], post: ['new_transfer_appended'],
      who: ['sender'], requires_signatures_from: 2,
      protocol: { type: 'data', send: { kind: 'pay', channel: '<urn>', amount: '<u64>', purpose: '<string?>', sig_sender: '<bytes>' }, recv: { ack: { sig_recipient: '<bytes>' } } },
    },
    {
      id: 'request_close',
      description: 'Begin the challenge window with the closer\'s latest known state.',
      pre: ['channel_OPEN'], post: ['channel_CLOSING'],
      who: ['party_a', 'party_b'],
      protocol: { type: 'control', send: { kind: 'request_close', channel: '<urn>', claim: '<Transfer>' } },
    },
    {
      id: 'challenge',
      description: 'Submit a higher-seq signed state during the window; replaces the closing claim, halves remaining timer (capped).',
      pre: ['channel_CLOSING', 'have_higher_seq_state'], post: ['claim_replaced'],
      who: ['party_a', 'party_b'],
      protocol: { type: 'control', send: { kind: 'challenge', channel: '<urn>', state: '<Transfer>' } },
    },
    {
      id: 'settle',
      description: 'After the window elapses, distribute balances per the surviving claim. Idempotent.',
      pre: ['channel_CLOSING', 'window_expired'], post: ['channel_SETTLED'],
      who: ['anyone'],
      protocol: { type: 'control', send: { kind: 'settle', channel: '<urn>' } },
    },
    {
      id: 'observe',
      description: 'Update the caller\'s local TrustScore about the counterparty using a witnessed transfer outcome.',
      pre: [], post: ['trust_score_updated'],
      who: ['observer'],
      protocol: { type: 'local', send: { kind: 'observe', subject: '<agent>', transfer: '<urn>', outcome: 'success|fail' } },
    },
  ],

  // What an agent must do to participate
  agent_contract: {
    minimal_loop: [
      '1. GET /payment-ontology -> cache schema',
      '2. generate ed25519 keypair (agentId = sha256(publicKey)[:16])',
      '3. open a channel with deposit: send {kind:"open", ...} to the counterparty (or arbiter)',
      '4. for each payment: build {seq+1, balances} -> sign -> send -> wait for counter-sig',
      '5. retain the latest fully-signed Transfer; that is your safety witness',
      '6. on request_close: arbiter posts the closing claim; if you hold higher seq, send {kind:"challenge"} before window elapses',
      '7. after settle event: feed outcome into local TrustScore via the observe action',
    ],
    sdk_url: '/payment-sdk.js',
    js_import: "import { Agent, Channel, Arbiter, TrustBook } from 'http://<host>/payment-sdk.js'",
  },
};

const NS = {
  '@vocab': 'urn:iap:vocab#',
  iap: 'urn:iap:vocab#',
  schema: 'https://schema.org/',
  prov: 'http://www.w3.org/ns/prov#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
};

export function ontologyJsonLd() {
  return {
    '@context': NS,
    '@id': WORLD.id,
    '@type': 'Protocol',
    'schema:name': WORLD.name,
    'schema:version': WORLD.version,
    'rdfs:comment': WORLD.description,
    authority: WORLD.authority,
    classes: WORLD.classes.map((c) => ({
      '@id': `urn:iap:class:${c.id}`,
      '@type': 'owl:Class',
      'schema:identifier': c.id,
      'rdfs:comment': c.description,
    })),
    relations: WORLD.relations.map((r) => ({
      '@id': `urn:iap:relation:${r.id}`,
      '@type': 'owl:ObjectProperty',
      'schema:identifier': r.id,
      domain: r.domain,
      range: r.range,
      ...(r.cardinality && { cardinality: r.cardinality }),
      ...(r.latest_wins && { latest_wins: true }),
    })),
    channel_params: { '@type': 'ChannelParams', ...WORLD.channel_params },
    trust_params:   { '@type': 'TrustParams',   ...WORLD.trust_params },
    actions: WORLD.actions.map((a) => ({
      '@id': `urn:iap:action:${a.id}`,
      '@type': 'Action',
      'schema:identifier': a.id,
      'rdfs:comment': a.description,
      precondition: a.pre,
      postcondition: a.post,
      caller: a.who,
      ...(a.requires_signatures_from && { requires_signatures_from: a.requires_signatures_from }),
      protocol: a.protocol,
    })),
    agent_contract: { '@type': 'AgentContract', ...WORLD.agent_contract },
  };
}

export function ontologyTurtle() {
  const w = WORLD;
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const lines = [];
  const T = (...t) => lines.push(t.join(' '));

  T('@prefix iap:    <urn:iap:vocab#> .');
  T('@prefix owl:    <http://www.w3.org/2002/07/owl#> .');
  T('@prefix rdfs:   <http://www.w3.org/2000/01/rdf-schema#> .');
  T('@prefix schema: <https://schema.org/> .');
  T('@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .');
  T('');
  T(`<${w.id}> a iap:Protocol ;`);
  T(`  schema:name "${esc(w.name)}" ;`);
  T(`  schema:version "${esc(w.version)}" ;`);
  T(`  rdfs:comment "${esc(w.description)}" ;`);
  T(`  iap:challengeWindowMs "${w.channel_params.challenge_window_ms}"^^xsd:integer ;`);
  T(`  iap:trustColdStart "${w.trust_params.cold_start}"^^xsd:decimal ;`);
  T(`  iap:trustAlpha "${w.trust_params.alpha}"^^xsd:decimal ;`);
  T(`  iap:ontologyUrl <http://localhost:3105/payment-ontology> .`);
  T('');

  for (const c of w.classes) {
    T(`<urn:iap:class:${c.id}> a owl:Class ;`);
    T(`  schema:identifier "${c.id}" ;`);
    T(`  rdfs:comment "${esc(c.description)}" .`);
    T('');
  }

  for (const r of w.relations) {
    T(`<urn:iap:relation:${r.id}> a owl:ObjectProperty ;`);
    T(`  schema:identifier "${r.id}" ;`);
    T(`  rdfs:domain "${r.domain}" ;`);
    T(`  rdfs:range "${r.range}" ${r.cardinality ? `; owl:cardinality "${r.cardinality}"^^xsd:integer ` : ''}.`);
    T('');
  }

  for (const a of w.actions) {
    T(`<urn:iap:action:${a.id}> a iap:Action ;`);
    T(`  schema:identifier "${a.id}" ;`);
    T(`  rdfs:comment "${esc(a.description)}" ;`);
    if (a.pre.length) T(`  iap:precondition ${a.pre.map((p) => `"${p}"`).join(', ')} ;`);
    if (a.post.length) T(`  iap:postcondition ${a.post.map((p) => `"${p}"`).join(', ')} ;`);
    T(`  iap:caller ${a.who.map((p) => `"${p}"`).join(', ')} ;`);
    T(`  iap:protocolKind "${a.protocol.type}" .`);
    T('');
  }

  return lines.join('\n') + '\n';
}

// Optional SDK source — kept as a separate file because it would otherwise
// dominate this module. The server reads it from ./sdk.mjs and serves verbatim.
