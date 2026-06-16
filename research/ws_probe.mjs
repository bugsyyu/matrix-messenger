// Probe the multiplayer WS to learn protocol shape
import WebSocket from 'ws';
import fs from 'node:fs';

const URL = 'wss://multiplayer-server-76608060529.us-central1.run.app/';
const OUT = '/home/cym/abeto/research/network';
const log = [];

function send(ws, buf, label) {
  log.push({ t: Date.now(), dir: 'send', label, bytes: buf.length, hex: buf.toString('hex').slice(0, 200) });
  ws.send(buf);
}

const ws = new WebSocket(URL, {
  headers: {
    Origin: 'https://messenger.abeto.co',
    'User-Agent': 'Mozilla/5.0',
  },
});
ws.binaryType = 'nodebuffer';

ws.on('open', () => {
  console.log('Connected');
  log.push({ t: Date.now(), dir: 'meta', event: 'open' });

  // probe: send a tiny empty binary frame and one byte each opcode 0..15
  send(ws, Buffer.from([]), 'empty');
  setTimeout(() => send(ws, Buffer.from([0x00]), 'byte:00'), 200);
  setTimeout(() => send(ws, Buffer.from([0x01]), 'byte:01'), 400);
  setTimeout(() => send(ws, Buffer.from([0x02]), 'byte:02'), 600);
  setTimeout(() => send(ws, Buffer.from([0xff]), 'byte:ff'), 800);
  setTimeout(() => send(ws, Buffer.from('HELLO'), 'text:HELLO'), 1000);
  setTimeout(() => send(ws, JSON.stringify({ type: 'join', room: 'test' }), 'json:join'), 1200);
  setTimeout(() => ws.close(), 5000);
});

ws.on('message', (data, isBinary) => {
  const meta = { t: Date.now(), dir: 'recv', bytes: data.length, binary: isBinary };
  if (isBinary) {
    meta.hex = data.toString('hex').slice(0, 400);
    fs.writeFileSync(`${OUT}/ws-direct-recv-${log.length}.bin`, data);
  } else {
    meta.text = data.toString().slice(0, 400);
  }
  log.push(meta);
  console.log('[recv]', meta.bytes, 'B', isBinary ? 'BIN' : 'TXT', '→', meta.hex || meta.text);
});

ws.on('close', (code, reason) => {
  log.push({ t: Date.now(), dir: 'meta', event: 'close', code, reason: reason?.toString() });
  console.log('Closed', code, reason?.toString());
  fs.writeFileSync(`${OUT}/ws-direct-probe.json`, JSON.stringify(log, null, 2));
  process.exit(0);
});

ws.on('error', (e) => {
  log.push({ t: Date.now(), dir: 'meta', event: 'error', message: e.message });
  console.error('error', e.message);
});

setTimeout(() => process.exit(0), 10000);
