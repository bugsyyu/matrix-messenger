// 50-peer broadcast load test.
//
// 1. spin up a fresh server on an ephemeral port
// 2. spawn N ws clients, all join the same room
// 3. one client (the "sender") sends a {data} frame every TICK_MS
//    with a high-resolution timestamp in `t`
// 4. every receiving client measures: receive_time - t  =>  one latency sample
// 5. after WARMUP_MS discard early samples, then collect for STEADY_MS
// 6. report P50/P95/P99 of broadcast latency, plus heap/conn stats
//
// Usage:
//   node scripts/loadtest.mjs                    # 50 peers, default
//   PEERS=100 STEADY_MS=20000 node scripts/loadtest.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import url from 'node:url';
import WebSocket from 'ws';

const PEERS      = Number(process.env.PEERS ?? 50);
const TICK_MS    = Number(process.env.TICK_MS ?? 50);    // 20 Hz sender — matches client default
const WARMUP_MS  = Number(process.env.WARMUP_MS ?? 3000);
const STEADY_MS  = Number(process.env.STEADY_MS ?? 10000);
const ROOM       = `load-${Math.random().toString(36).slice(2, 6)}`;
const PORT       = Number(process.env.PORT ?? 3010);

const REPO_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const SERVER    = path.join(REPO_ROOT, 'server', 'src', 'index.mjs');

const fmtMB = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

async function waitForListen(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/healthz`, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(300, () => { req.destroy(); resolve(false); });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function probeServer() {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${PORT}/stats`, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

console.log(`[load] peers=${PEERS} sender_hz=${(1000 / TICK_MS).toFixed(0)} warmup=${WARMUP_MS}ms steady=${STEADY_MS}ms room=${ROOM}`);

// ---- launch server ----
const heapBefore = process.memoryUsage().heapUsed;
const srv = spawn(process.execPath, [SERVER], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
srv.stdout.on('data', (b) => serverLog.push(['out', b.toString()]));
srv.stderr.on('data', (b) => serverLog.push(['err', b.toString()]));

const cleanup = () => { try { srv.kill('SIGTERM'); } catch {} };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

if (!await waitForListen(PORT)) {
  console.error('[load] server did not come up in time');
  console.error(serverLog.map(([k, v]) => `[${k}] ${v}`).join(''));
  process.exit(1);
}
console.log(`[load] server up on :${PORT}`);

// ---- spawn clients ----
const url_ws = `ws://127.0.0.1:${PORT}/ws`;
const samples = [];
let sender = null;
let connectedCount = 0;
let totalFrames = 0;
let inSteady = false;

async function makeClient(idx) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url_ws);
    ws.idx = idx;
    ws.id = null;
    ws.binaryType = 'nodebuffer';
    const to = setTimeout(() => reject(new Error('open timeout idx=' + idx)), 5000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ r: ['load', ROOM] }));
    });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
      if (msg.id && !ws.id) {
        ws.id = msg.id;
        connectedCount++;
        clearTimeout(to);
        resolve(ws);
        return;
      }
      if (msg.data && msg.data.t !== undefined && ws !== sender) {
        const lat = performance.now() - msg.data.t;
        // count every frame; only retain samples during the steady window
        totalFrames++;
        if (inSteady) samples.push(lat);
      }
    });
    ws.on('error', () => {});
    ws.on('close', () => {});
  });
}

const startConn = performance.now();
const clients = [];
for (let i = 0; i < PEERS; i++) {
  // small jitter so we don't open all sockets in one syscall storm
  if (i % 10 === 0 && i > 0) await new Promise((r) => setTimeout(r, 50));
  try { clients.push(await makeClient(i)); }
  catch (e) { console.error('  [load] client', i, 'failed:', e.message); }
}
const connDur = performance.now() - startConn;
console.log(`[load] ${connectedCount}/${PEERS} connected in ${connDur.toFixed(0)}ms`);

sender = clients[0];
console.log(`[load] sender = id ${sender.id}`);

// ---- sender loop ----
const sendInterval = setInterval(() => {
  if (sender.readyState !== 1) return;
  sender.send(JSON.stringify({
    data: { p: [0, 50, 0], r: [0, 0, 0], tag: 'sender', t: performance.now() },
  }));
}, TICK_MS);

// warmup
await new Promise((r) => setTimeout(r, WARMUP_MS));
const samplesBeforeSteady = totalFrames;
inSteady = true;
console.log(`[load] entering steady state (warmup frames dropped: ${samplesBeforeSteady})`);

await new Promise((r) => setTimeout(r, STEADY_MS));
inSteady = false;
clearInterval(sendInterval);

// give in-flight frames a moment to land
await new Promise((r) => setTimeout(r, 200));

const heapAfter   = process.memoryUsage().heapUsed;
const serverStats = await probeServer();

// ---- report ----
samples.sort((a, b) => a - b);
const N      = samples.length;
const mean   = N ? samples.reduce((a, b) => a + b, 0) / N : NaN;
const p50    = percentile(samples, 0.50);
const p95    = percentile(samples, 0.95);
const p99    = percentile(samples, 0.99);
const min    = samples[0];
const max    = samples[N - 1];
const fanout = PEERS - 1;                                        // recipients per send
const tps    = N / (STEADY_MS / 1000) / fanout;                  // sender frames/sec (= 1000/TICK_MS in theory)

console.log('\n=== broadcast latency (ms) ===');
console.log(`peers connected: ${connectedCount}`);
console.log(`sender hz:       ${(1000 / TICK_MS).toFixed(0)}`);
console.log(`fan-out:         1 sender → ${fanout} recipients`);
console.log(`samples:         ${N}  (≈${(N / (STEADY_MS/1000)).toFixed(0)} frames/sec recv overall, ${tps.toFixed(1)} sender hz)`);
console.log(`min / mean / max:  ${min?.toFixed(2)} / ${mean.toFixed(2)} / ${max?.toFixed(2)}`);
console.log(`P50 / P95 / P99:   ${p50?.toFixed(2)} / ${p95?.toFixed(2)} / ${p99?.toFixed(2)}`);

console.log('\n=== memory ===');
console.log(`client heap before:  ${fmtMB(heapBefore)}`);
console.log(`client heap after:   ${fmtMB(heapAfter)}  (Δ ${fmtMB(heapAfter - heapBefore)})`);
if (serverStats) {
  console.log(`server stats:        rooms=${serverStats.rooms.length}  conns=${serverStats.totalConns}  msgs=${serverStats.totalMessages}`);
}

// ---- shut down clients ----
for (const c of clients) try { c.close(); } catch {}
await new Promise((r) => setTimeout(r, 300));
cleanup();

// emit machine-readable summary on the last line for README copy-paste
const summary = {
  peers_connected: connectedCount,
  sender_hz: 1000 / TICK_MS,
  samples: N,
  ms: { p50, p95, p99, mean, min, max },
  client_heap_delta_mb: Number(((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)),
  server_stats: serverStats,
};
console.log('\nJSON ' + JSON.stringify(summary));

// exit code = 0 if P95 < 50 ms (loopback should be way under that)
if (p95 > 50) {
  console.error(`\n[load] P95 ${p95.toFixed(2)}ms > 50ms threshold — FAIL`);
  process.exit(1);
}
process.exit(0);
