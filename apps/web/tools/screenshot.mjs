// Dev helper: node tools/screenshot.mjs <url> <out.png> [widthxheight] [js-to-run-after-first-calc|startup]
import puppeteer from 'puppeteer-core';
const [url, out, viewport = '1500x950', action] = process.argv.slice(2);
const [width, height] = viewport.split('x').map(Number);
const startup = action === 'startup';
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: width || 1500, height: height || 950 });
const logs = []; p.on('console', (m) => logs.push(m.text())); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
if (startup) {
  await p.setRequestInterception(true);
  p.on('request', (request) => {
    if (/dataset\.json\.gz|exfa_wasm\.wasm/.test(request.url())) setTimeout(() => request.continue(), 4000);
    else request.continue();
  });
}
await p.goto(url, { waitUntil: startup ? 'domcontentloaded' : 'networkidle0' });
if (startup) await p.waitForSelector('.skeleton-fit', { timeout: 15000 });
else await p.waitForFunction(() => window.__lastStats, { timeout: 60000 });
if (action && !startup) { await p.evaluate(action); await new Promise(r => setTimeout(r, 1500)); }
await p.screenshot({ path: out });
console.log(logs.filter(l => /ERR|error|warn/i.test(l)).join('\n'));
await b.close();
