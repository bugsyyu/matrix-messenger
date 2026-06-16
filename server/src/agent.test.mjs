// Test the public agent SDK end-to-end:
// 1. fetch /agent-sdk.js as text and eval it (no transformations)
// 2. instantiate AgentClient, ingest ontology, connect, walk between districts
// 3. verify peer table updates and deliveries are emittable
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const HTTP = process.env.HTTP || 'http://127.0.0.1:3006';
const WS   = HTTP.replace(/^http/, 'ws') + '/ws';

// fetch sdk source from server
const sdkRes = await fetch(HTTP + '/agent-sdk.js');
if (!sdkRes.ok) throw new Error('sdk fetch ' + sdkRes.status);
const sdkSrc = await sdkRes.text();

// expose WebSocket as global so the SDK's dynamic check sees it
globalThis.WebSocket = WebSocket;
globalThis.fetch = fetch;

// import via data URL (works for ESM)
const dataUrl = 'data:text/javascript;base64,' + Buffer.from(sdkSrc).toString('base64');
const { AgentClient } = await import(dataUrl);

const failures = [];
const ok = (m) => console.log('ok  ', m);
const fail = (m) => { failures.push(m); console.error('FAIL', m); };

// agent A: ingests ontology, walks
const a = new AgentClient({ url: WS, tag: 'redbot', room: 'agent-' + Math.random().toString(36).slice(2, 5), sendHz: 20 });
const world = await a.ingestOntology(HTTP + '/ontology');
world && Array.isArray(world.districts) ? ok('A ingested ontology (' + world.districts.length + ' districts)') : fail('no ontology');

let aId = null;
a.onId((id) => { aId = id; });

await a.connect();
await new Promise((r) => setTimeout(r, 300));
aId ? ok('A got id: ' + aId) : fail('A no id');

// agent B: joins same room as a peer observer
const b = new AgentClient({ url: WS, tag: 'blubot', room: a.room.replace('matrix/', ''), sendHz: 20 });
let aSeen = false;
b.onPeer(({ from, data }) => { if (from === aId) aSeen = true; });
await b.ingestOntology(HTTP + '/ontology');
await b.connect();
await new Promise((r) => setTimeout(r, 300));

// command A to walk to oracle
a.goto('oracle');
await new Promise((r) => setTimeout(r, 1500));
aSeen ? ok('B saw A moving') : fail('B never saw A');

// chat
let chatHeard = false;
b.onChat((from, text) => { if (from === aId && text === 'follow me') chatHeard = true; });
a.say('follow me');
await new Promise((r) => setTimeout(r, 300));
chatHeard ? ok('B heard A chat') : fail('B did not hear A chat');

// event
let evt = null;
b.onEvent((from, e) => { if (from === aId && e.name === 'delivery_complete') evt = e; });
a.emit('delivery_complete', { type: 'redpill', reward: 30 });
await new Promise((r) => setTimeout(r, 300));
evt ? ok('B saw delivery_complete: ' + JSON.stringify(evt)) : fail('B did not see event');

// position moved on the planet (sanity)
const startedAt = world.districts.find((d) => d['schema:identifier'] === 'zion').direction_unit_vector;
const movedTo = a.state.p;
const movedDist = Math.hypot(movedTo[0] - startedAt[0] * 50, movedTo[1] - startedAt[1] * 50, movedTo[2] - startedAt[2] * 50);
movedDist > 4 ? ok('A moved ' + movedDist.toFixed(1) + 'm toward oracle') : fail('A barely moved: ' + movedDist.toFixed(2));

a.disconnect();
b.disconnect();

if (failures.length === 0) {
  console.log('\nALL AGENT-SDK TESTS PASS');
  process.exit(0);
} else {
  console.error('\n' + failures.length + ' failures');
  process.exit(1);
}
