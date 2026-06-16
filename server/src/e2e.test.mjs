// End-to-end test: spin up 2 ws clients, join the same room, exchange data, verify relay.
import WebSocket from 'ws';

const URL = process.env.URL || 'ws://127.0.0.1:3006/ws';
const ROOM = ['matrix', 'e2e-' + Math.random().toString(36).slice(2, 6)];

function client(name) {
  const ws = new WebSocket(URL);
  ws.name = name;
  ws.log = [];
  ws.recv = (msg) => ws.log.push(msg);
  return new Promise((resolve) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({ r: ROOM }));
      resolve(ws);
    });
    ws.on('message', (raw) => {
      try { ws.recv(JSON.parse(raw.toString('utf8'))); } catch {}
    });
  });
}

const failures = [];
const ok = (m) => console.log('ok  ', m);
const fail = (m) => { failures.push(m); console.error('FAIL', m); };

const a = await client('A');
const b = await client('B');

await new Promise((r) => setTimeout(r, 300));

// Each should have received an id and a room ack
const hasId = (c) => c.log.some((m) => m.id);
const hasRoom = (c) => c.log.some((m) => m.r);
hasId(a) ? ok('A got id')   : fail('A did not get id');
hasId(b) ? ok('B got id')   : fail('B did not get id');
hasRoom(a) ? ok('A got room ack') : fail('A no room ack');
hasRoom(b) ? ok('B got room ack') : fail('B no room ack');

// A sends data; B should receive it
a.send(JSON.stringify({ data: { p: [1, 2, 3], r: [0, 0, 0], tag: 'alice', chat: 'hello' } }));
await new Promise((r) => setTimeout(r, 200));
const bSawA = b.log.find((m) => m.data && m.data.tag === 'alice');
bSawA ? ok('B received A\'s data: ' + JSON.stringify(bSawA.data)) : fail('B did not see A data');
bSawA && bSawA.from ? ok('B got from=' + bSawA.from) : fail('no from field');

// Ping/pong
const nonce = 'tn' + Math.random().toString(36).slice(2, 6);
a.send(JSON.stringify({ ping: Date.now(), nonce }));
await new Promise((r) => setTimeout(r, 100));
const pong = a.log.find((m) => m.pong !== undefined && m.nonce === nonce);
pong ? ok('A got pong nonce=' + nonce) : fail('A no pong');

// Leave: close A, B should get {leave}
a.close();
await new Promise((r) => setTimeout(r, 200));
const sawLeave = b.log.find((m) => m.leave);
sawLeave ? ok('B saw leave for ' + sawLeave.leave) : fail('B did not see leave');

b.close();

if (failures.length === 0) {
  console.log('\nALL E2E PASS');
  process.exit(0);
} else {
  console.log('\n' + failures.length + ' failures');
  process.exit(1);
}
