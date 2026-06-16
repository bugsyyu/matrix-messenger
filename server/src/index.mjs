// Matrix Messenger server: microrealm-style WS relay + ontology endpoints + static client serve.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { WebSocketServer } from 'ws';
import { ontologyJsonLd, ontologyTurtle, agentSdkSource } from './ontology.mjs';

const PORT = Number(process.env.PORT ?? 3005);
const HOST = process.env.HOST ?? '0.0.0.0';
const REPO_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const DIST_DIR  = path.join(REPO_ROOT, 'dist');
const CLIENT_DIR = path.join(REPO_ROOT, 'client');

const rooms = new Map(); // room -> Set<ws>
const stats = { totalConns: 0, totalMessages: 0, started: Date.now() };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.wasm': 'application/wasm',
  '.ico':  'image/x-icon',
  '.ttl':  'text/turtle; charset=utf-8',
};

function reply(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : String(body ?? ''));
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': buf.length,
    ...headers,
  });
  res.end(buf);
}

function serveFile(res, fp) {
  const ext = path.extname(fp).toLowerCase();
  const ct = MIME[ext] || 'application/octet-stream';
  fs.readFile(fp, (err, buf) => {
    if (err) return reply(res, 500, err.message);
    reply(res, 200, buf, { 'content-type': ct });
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const cors = { 'access-control-allow-origin': '*' };

  if (u.pathname === '/healthz') {
    return reply(res, 200, JSON.stringify({ ok: true, uptime: process.uptime(), rooms: rooms.size, ...stats }), {
      'content-type': 'application/json; charset=utf-8', ...cors,
    });
  }
  if (u.pathname === '/ontology' || u.pathname === '/ontology/' || u.pathname === '/ontology.jsonld') {
    return reply(res, 200, JSON.stringify(ontologyJsonLd(), null, 2), {
      'content-type': 'application/ld+json; charset=utf-8', 'cache-control': 'no-store', ...cors,
    });
  }
  if (u.pathname === '/ontology.ttl') {
    return reply(res, 200, ontologyTurtle(), { 'content-type': 'text/turtle; charset=utf-8', ...cors });
  }
  if (u.pathname === '/agent-sdk.js') {
    return reply(res, 200, agentSdkSource(), {
      'content-type': 'application/javascript; charset=utf-8', ...cors,
    });
  }
  if (u.pathname === '/stats') {
    return reply(res, 200, JSON.stringify({
      rooms: [...rooms.entries()].map(([k, s]) => ({ room: k, peers: s.size })),
      ...stats,
    }, null, 2), { 'content-type': 'application/json; charset=utf-8', ...cors });
  }

  // serve client (production: dist/, dev: client/)
  const fileRoot = fs.existsSync(DIST_DIR) ? DIST_DIR : CLIENT_DIR;
  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  p = path.normalize(p).replace(/^(\.\.\/|\/)+/, '/');
  const fp = path.join(fileRoot, p);
  if (!fp.startsWith(fileRoot)) return reply(res, 403, 'nope');
  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) {
      if (fileRoot === CLIENT_DIR) {
        return reply(res, 404, `not found: ${p}\n\n(dev mode — run \`npm run dev:client\` for vite hot reload.)\n`);
      }
      return serveFile(res, path.join(fileRoot, 'index.html'));
    }
    serveFile(res, fp);
  });
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (u.pathname === '/ws' || u.pathname === '/') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

function wsSend(ws, obj) {
  if (ws.readyState !== 1) return;
  try { ws.send(JSON.stringify(obj)); } catch {}
}

wss.on('connection', (ws) => {
  stats.totalConns += 1;
  ws.id = shortId();
  ws.room = null;
  ws.lastData = null;
  ws.alive = true;

  wsSend(ws, { id: ws.id });

  ws.on('message', (raw) => {
    stats.totalMessages += 1;
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
    } catch {
      return;
    }

    if (msg.ping !== undefined) {
      wsSend(ws, { pong: msg.ping, nonce: msg.nonce });
      ws.alive = true;
      return;
    }
    if (Array.isArray(msg.r) && msg.r.length === 2) {
      const [prefix, name] = msg.r.map(String);
      const full = `${prefix}/${name}`.replace(/[^a-zA-Z0-9_/.-]/g, '_').slice(0, 64);
      leaveRoom(ws);
      joinRoom(ws, full);
      wsSend(ws, { r: full });
      return;
    }
    if (msg.data && ws.room) {
      ws.lastData = msg.data;
      const peers = rooms.get(ws.room);
      if (!peers) return;
      const out = JSON.stringify({ data: msg.data, from: ws.id });
      for (const p of peers) {
        if (p !== ws && p.readyState === 1) p.send(out);
      }
      return;
    }
  });

  ws.on('close', () => { leaveRoom(ws); });
  ws.on('error', () => { try { ws.terminate(); } catch {} });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.alive === false) { try { ws.terminate(); } catch {} continue; }
    ws.alive = false;
  }
}, 30_000);

function joinRoom(ws, room) {
  ws.room = room;
  let set = rooms.get(room);
  if (!set) { set = new Set(); rooms.set(room, set); }
  set.add(ws);
  for (const p of set) {
    if (p !== ws && p.lastData) wsSend(ws, { data: p.lastData, from: p.id });
  }
}

function leaveRoom(ws) {
  if (!ws.room) return;
  const set = rooms.get(ws.room);
  if (set) {
    set.delete(ws);
    const out = JSON.stringify({ leave: ws.id });
    for (const p of set) if (p.readyState === 1) p.send(out);
    if (set.size === 0) rooms.delete(ws.room);
  }
  ws.room = null;
}

function shortId(n = 4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

server.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${PORT}`);
  console.log(`         ws:   ws://${HOST}:${PORT}/ws`);
  console.log(`         api:  /ontology  /ontology.ttl  /agent-sdk.js  /healthz  /stats`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));
