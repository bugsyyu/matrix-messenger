// Open our local Matrix Messenger and screenshot each phase: boot → planet → interaction.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = '/home/cym/abeto/research/visual';
fs.mkdirSync(OUT, { recursive: true });

const URL = process.env.URL || 'http://127.0.0.1:3006/';

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--proxy-bypass-list=*'],
  proxy: { server: 'direct://' },
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => { errs.push('pageerror: ' + e.message); console.error('PAGEERROR', e.message); });
page.on('console', (m) => {
  if (m.type() === 'error') { errs.push('console.error: ' + m.text()); console.log('CERR', m.text()); }
});

console.log('goto', URL);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, '01-boot.png') });

// dismiss boot — wait for the typed log to finish (~5s), then click the boot overlay to advance.
await page.waitForTimeout(5500);
await page.screenshot({ path: path.join(OUT, '01b-boot-ready.png') });
await page.click('#boot', { force: true }).catch(() => {});
await page.waitForTimeout(800);
await page.keyboard.press('Enter').catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, '02-planet.png') });

// walk
for (const k of ['KeyW', 'KeyW', 'KeyD', 'KeyD']) {
  await page.keyboard.down(k);
  await page.waitForTimeout(400);
  await page.keyboard.up(k);
}
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, '03-walking.png') });

// open the terminal and type a command
await page.click('#term-input');
await page.keyboard.type('/help');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.keyboard.type('/goto oracle');
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, '04-after-goto.png') });

// chat
await page.keyboard.type('the matrix has me');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, '05-chat.png') });

const hud = await page.locator('#hud').innerText().catch(() => '(no hud)');
const term = await page.locator('#term-log').innerText().catch(() => '(no term)');
console.log('\n--- HUD ---\n' + hud);
console.log('\n--- TERMINAL ---\n' + term);

fs.writeFileSync(path.join(OUT, 'errors.txt'), errs.join('\n'));
console.log('\nerrors:', errs.length);
await browser.close();
