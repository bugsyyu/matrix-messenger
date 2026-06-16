// Open the live GitHub Pages URL and screenshot it as proof of deploy.
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = process.argv[2] || 'https://bugsyyu.github.io/matrix-messenger/';
const OUT = '/home/cym/abeto/docs/screens/07-live.png';

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

console.log('GET', URL);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

// boot screen typed log: wait ~6s, then enable pointer-events + click to advance
await page.waitForTimeout(6000);
await page.screenshot({ path: '/home/cym/abeto/docs/screens/07a-live-boot.png' });

// boot listens for keydown OR click on #boot once pointer-events is auto
await page.evaluate(() => { const b = document.getElementById('boot'); if (b) b.style.pointerEvents = 'auto'; });
await page.locator('#boot').click({ force: true }).catch(() => {});
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);

// give the offline-fallback enough time to trigger so the screenshot shows the OFFLINE badge
await page.waitForTimeout(4500);

await page.screenshot({ path: OUT });
const hud = await page.locator('#hud').innerText().catch(() => '(no hud)');
const term = await page.locator('#term-log').innerText().catch(() => '(no term)');
console.log('\n--- HUD ---\n' + hud);
console.log('\n--- TERM ---\n' + term);
console.log('\nerrors:', errs.length);
for (const e of errs.slice(0, 5)) console.log('  ' + e);
await browser.close();
