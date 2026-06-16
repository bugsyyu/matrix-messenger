import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = '/home/cym/abeto/research/network';
fs.mkdirSync(OUT, { recursive: true });

const reqs = [];
const wsEvents = [];
const wsFrames = [];
let frameCount = 0;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 800 },
});
const page = await ctx.newPage();

page.on('request', (req) => {
  reqs.push({
    t: Date.now(),
    method: req.method(),
    url: req.url(),
    resourceType: req.resourceType(),
    headers: req.headers(),
  });
});
page.on('response', async (resp) => {
  const i = reqs.findIndex((r) => r.url === resp.url() && r.status === undefined);
  if (i !== -1) {
    reqs[i].status = resp.status();
    reqs[i].size = Number(resp.headers()['content-length'] || 0);
    reqs[i].respHeaders = resp.headers();
  }
});
page.on('websocket', (ws) => {
  const wsUrl = ws.url();
  wsEvents.push({ t: Date.now(), event: 'open', url: wsUrl });
  console.log('[WS open]', wsUrl);

  ws.on('framesent', (ev) => {
    frameCount++;
    const payload = ev.payload;
    const isBinary = payload instanceof Buffer;
    const meta = {
      t: Date.now(),
      dir: 'send',
      idx: frameCount,
      binary: isBinary,
      bytes: isBinary ? payload.length : payload.length,
      preview: isBinary ? payload.slice(0, 64).toString('hex') : payload.slice(0, 200),
    };
    wsFrames.push(meta);
    if (isBinary && frameCount <= 30) {
      fs.writeFileSync(path.join(OUT, `frame-send-${String(frameCount).padStart(3, '0')}.bin`), payload);
    }
  });
  ws.on('framereceived', (ev) => {
    frameCount++;
    const payload = ev.payload;
    const isBinary = payload instanceof Buffer;
    const meta = {
      t: Date.now(),
      dir: 'recv',
      idx: frameCount,
      binary: isBinary,
      bytes: isBinary ? payload.length : payload.length,
      preview: isBinary ? payload.slice(0, 64).toString('hex') : payload.slice(0, 200),
    };
    wsFrames.push(meta);
    if (isBinary && frameCount <= 30) {
      fs.writeFileSync(path.join(OUT, `frame-recv-${String(frameCount).padStart(3, '0')}.bin`), payload);
    }
  });
  ws.on('close', () => wsEvents.push({ t: Date.now(), event: 'close', url: wsUrl }));
});

console.log('Goto messenger.abeto.co ...');
await page.goto('https://messenger.abeto.co/', { waitUntil: 'load', timeout: 60000 });
console.log('Loaded, waiting 30s for WS + assets + click intro...');
// try to click anywhere to dismiss potential intro
try {
  await page.waitForTimeout(8000);
  await page.mouse.click(640, 400);
  await page.waitForTimeout(2000);
  await page.mouse.click(640, 400);
} catch (e) {
  console.log('click error', e.message);
}
await page.waitForTimeout(20000);

// dump
fs.writeFileSync(path.join(OUT, 'requests.json'), JSON.stringify(reqs, null, 2));
fs.writeFileSync(path.join(OUT, 'ws-events.json'), JSON.stringify(wsEvents, null, 2));
fs.writeFileSync(path.join(OUT, 'ws-frames.json'), JSON.stringify(wsFrames, null, 2));

// take screenshot
await page.screenshot({ path: path.join(OUT, 'screen.png'), fullPage: false });

console.log('Done. requests:', reqs.length, 'ws-frames:', wsFrames.length);
await browser.close();
