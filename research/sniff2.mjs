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
  reqs.push({ t: Date.now(), method: req.method(), url: req.url(), resourceType: req.resourceType() });
});
page.on('response', async (resp) => {
  const i = reqs.findIndex((r) => r.url === resp.url() && r.status === undefined);
  if (i !== -1) {
    reqs[i].status = resp.status();
    reqs[i].size = Number(resp.headers()['content-length'] || 0);
  }
});
page.on('websocket', (ws) => {
  const wsUrl = ws.url();
  wsEvents.push({ t: Date.now(), event: 'open', url: wsUrl });
  console.log('[WS open]', wsUrl);

  const tap = (dir) => (ev) => {
    frameCount++;
    const payload = ev.payload;
    const isBinary = payload instanceof Buffer;
    const meta = {
      t: Date.now(),
      dir,
      idx: frameCount,
      binary: isBinary,
      bytes: isBinary ? payload.length : payload.length,
      preview: isBinary ? payload.slice(0, 64).toString('hex') : payload.slice(0, 200),
    };
    wsFrames.push(meta);
    if (frameCount <= 60) {
      const fn = path.join(OUT, `frame-${dir}-${String(frameCount).padStart(3, '0')}.${isBinary ? 'bin' : 'txt'}`);
      fs.writeFileSync(fn, payload);
    }
    if (frameCount % 5 === 0) console.log(`[WS ${dir}] frame#${frameCount} ${meta.bytes}B ${isBinary ? 'BIN' : 'TXT'}`);
  };
  ws.on('framesent', tap('send'));
  ws.on('framereceived', tap('recv'));
  ws.on('close', () => wsEvents.push({ t: Date.now(), event: 'close', url: wsUrl }));
});

console.log('Goto messenger.abeto.co ...');
let attempt = 0;
while (attempt < 3) {
  try {
    await page.goto('https://messenger.abeto.co/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    break;
  } catch (e) {
    attempt++;
    console.log(`goto retry ${attempt}: ${e.message}`);
    await page.waitForTimeout(3000);
  }
}
await page.waitForTimeout(10000);

// Screenshot intro
await page.screenshot({ path: path.join(OUT, 'intro.png') });

// click BEGIN — visible button at bottom center based on intro.png
console.log('Clicking BEGIN...');
await page.mouse.click(640, 540);
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(OUT, 'post-begin-1.png') });

// click anywhere to dismiss tutorial / skip intro animation
for (let i = 0; i < 6; i++) {
  await page.mouse.click(640, 400);
  await page.waitForTimeout(2000);
}
await page.screenshot({ path: path.join(OUT, 'post-begin-2.png') });

// try keyboard input — game might need WASD / Space
await page.keyboard.press('Space');
await page.waitForTimeout(1500);
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);

// move around to trigger multiplayer connection
for (const k of ['w', 'a', 's', 'd', 'w', 'd']) {
  await page.keyboard.down(k);
  await page.waitForTimeout(600);
  await page.keyboard.up(k);
}

await page.waitForTimeout(15000);
await page.screenshot({ path: path.join(OUT, 'gameplay.png') });

fs.writeFileSync(path.join(OUT, 'requests.json'), JSON.stringify(reqs, null, 2));
fs.writeFileSync(path.join(OUT, 'ws-events.json'), JSON.stringify(wsEvents, null, 2));
fs.writeFileSync(path.join(OUT, 'ws-frames.json'), JSON.stringify(wsFrames, null, 2));

console.log('Done. requests:', reqs.length, 'ws-events:', wsEvents.length, 'ws-frames:', wsFrames.length);
await browser.close();
