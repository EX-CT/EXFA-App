// Dev helper: node tools/screenshot.mjs <url> <out.png> [js-to-run-after-first-calc]
import puppeteer from 'puppeteer-core';
const [url, out, action] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 950 });
const logs = []; p.on('console', (m) => logs.push(m.text())); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
await p.goto(url, { waitUntil: 'networkidle0' });
await p.waitForFunction(() => window.__lastStats, { timeout: 60000 });
if (action) { await p.evaluate(action); await new Promise(r => setTimeout(r, 1500)); }
await p.screenshot({ path: out });
console.log(logs.filter(l => /ERR|error|warn/i.test(l)).join('\n'));
await b.close();
