// Tiny HTTP server: /payment-ontology(.ttl) + /payment-sdk.js + /healthz.
// Mirrors the abeto server's surface so consumers see one pattern across both.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { ontologyJsonLd, ontologyTurtle, WORLD } from './ontology.mjs';

const PORT = Number(process.env.PORT ?? 3105);
const HOST = process.env.HOST ?? '0.0.0.0';
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SDK_PATH = path.join(HERE, 'sdk.mjs');

function reply(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''));
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': buf.length,
    'access-control-allow-origin': '*',
    ...headers,
  });
  res.end(buf);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (u.pathname === '/healthz') return reply(res, 200, JSON.stringify({ ok: true, version: WORLD.version }), { 'content-type': 'application/json; charset=utf-8' });
  if (u.pathname === '/payment-ontology' || u.pathname === '/payment-ontology.jsonld') {
    return reply(res, 200, JSON.stringify(ontologyJsonLd(), null, 2), { 'content-type': 'application/ld+json; charset=utf-8', 'cache-control': 'no-store' });
  }
  if (u.pathname === '/payment-ontology.ttl') {
    return reply(res, 200, ontologyTurtle(), { 'content-type': 'text/turtle; charset=utf-8' });
  }
  if (u.pathname === '/payment-sdk.js') {
    fs.readFile(SDK_PATH, (err, buf) => {
      if (err) return reply(res, 200, '// payment-sdk.js: agent helper not yet packaged for browser-import\n', { 'content-type': 'application/javascript; charset=utf-8' });
      return reply(res, 200, buf, { 'content-type': 'application/javascript; charset=utf-8' });
    });
    return;
  }
  reply(res, 404, `not found: ${u.pathname}\nendpoints: /payment-ontology  /payment-ontology.ttl  /payment-sdk.js  /healthz\n`);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, HOST, () => {
    console.log(`[iap] listening on http://${HOST}:${PORT}`);
    console.log(`      endpoints: /payment-ontology(.ttl) /payment-sdk.js /healthz`);
  });
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT',  () => server.close(() => process.exit(0)));
}

export { server };
