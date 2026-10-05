// Headless smoke test: open the site, wait for the demo fit to be computed by the selected engine backend,
// print key stats. Usage: node tools/smoke.mjs <url> [engine-id]   (CHROME=/path/to/chrome)
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/EXFA-App/';
const engine = process.argv[3];
const target = engine ? `${url}${url.includes('?') ? '&' : '?'}engine=${engine}` : url;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', ...(process.env.SMOKE_ALLOW_LOCAL ? ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults'] : [])] });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(target, { waitUntil: 'networkidle0', timeout: 120000 });
try {
  await page.waitForFunction(() => window.__lastStats && window.__lastStats.offense, { timeout: 120000 });
} catch (e) {
  console.error('no stats computed', logs.join('\n'));
  console.error(await page.evaluate(() => document.querySelector('.engine .status')?.textContent));
  await browser.close();
  process.exit(1);
}
const r = await page.evaluate(() => {
  const s = window.__lastStats;
  return { engine: s.meta?.engine, sde: s.meta?.sde_build, ship: s.ship?.name, dps: s.offense?.total?.dps?.total, ehp: s.defense?.ehp?.total,
    status: document.querySelector('.engine .status')?.textContent, dpsLabel: document.querySelector('.section h3 .right')?.textContent };
});
console.log(JSON.stringify(r));
await browser.close();
if (!(r.dps > 0 && r.ehp > 0)) process.exit(1);
