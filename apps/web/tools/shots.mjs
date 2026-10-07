// Visual-review screenshots for the v2 review checklist (docs/v2/HANDOFF.md §"Still to do").
// Captures each scene at 1920x1080 and 1600x900 into <outdir>:
//   node tools/shots.mjs <url> <outdir>            (CHROME=/path/to/chrome)
// Scenes: compact market rows, selected autocannon with Variations deltas, overpowered
// candidate with red frame + tooltip, Afterburner selected with MWD candidate, replace toast.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [url = 'http://127.0.0.1:4173/EXFA-App/', outdir = 'shots'] = process.argv.slice(2);
const FIT = '[Rifter, Shot Rifter]\nGyrostabilizer II\n\n1MN Afterburner II\n\n200mm AutoCannon II, EMP S\n200mm AutoCannon II, EMP S\n';
const SIZES = [[1920, 1080], [1600, 900]];

const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
fs.mkdirSync(outdir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = (p, sel, text) => p.evaluate((s, t) => { const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(t)); if (!el) return false; el.click(); return true; }, sel, text);
const selectModule = (p, name) => p.evaluate((n) => { const row = [...document.querySelectorAll('.fit-area .mod[data-idx]')].find((el) => el.querySelector('.mname')?.textContent.includes(n)); row?.click(); return !!row; }, name);
const marketSearch = async (p, name) => {
  await p.click('.market .search');
  await p.keyboard.down('Control'); await p.keyboard.press('a'); await p.keyboard.up('Control');
  await p.keyboard.press('Backspace');
  await p.type('.market .search', name);
  await p.waitForFunction((n) => [...document.querySelectorAll('.trow .tname')].some((e) => e.textContent.trim() === n), { timeout: 30000 }, name);
  return p.evaluate((n) => Number([...document.querySelectorAll('.trow')].find((r) => r.querySelector('.tname')?.textContent.trim() === n)?.dataset.tid), name);
};

const scenes = [
  ['market-compact', async (p) => {
    await clickText(p, 'aside.left .tabs button', 'Market');
    await p.click('.market .search');
    await p.type('.market .search', 'autocannon');
    await p.waitForFunction(() => document.querySelectorAll('.market .trow').length > 3, { timeout: 30000 });
    await sleep(300);
  }],
  ['variations-autocannon', async (p) => {
    await clickText(p, '.center .tabs button', 'Compare strip');
    await selectModule(p, '200mm AutoCannon II');
    await p.waitForFunction(() => document.querySelectorAll('.strip-variant').length > 0, { timeout: 30000 });
    await sleep(300);
  }],
  ['replace-red-frame', async (p) => {
    await clickText(p, '.center .tabs button', 'Compare strip');
    await selectModule(p, '200mm AutoCannon II');
    const id = await marketSearch(p, '650mm Artillery Cannon II');
    await p.click(`.market .trow[data-tid="${id}"]`);
    await p.waitForFunction(() => document.querySelector('.strip-candidate.strip-bad .strip-tooltip'), { timeout: 30000 });
    await sleep(400);
    await p.hover('.strip-candidate');
    await sleep(200);
  }],
  ['ab-mwd-candidate', async (p) => {
    await clickText(p, '.center .tabs button', 'Compare strip');
    await selectModule(p, '1MN Afterburner II');
    const id = await marketSearch(p, '5MN Microwarpdrive II');
    await p.click(`.market .trow[data-tid="${id}"]`);
    await p.waitForFunction(() => document.querySelector('.strip-candidate') && !document.querySelector('.compare-strip .muted')?.textContent.includes('computing'), { timeout: 30000 });
    await sleep(400);
  }],
  ['replace-toast', async (p) => {
    await clickText(p, '.center .tabs button', 'Compare strip');
    await selectModule(p, '200mm AutoCannon II');
    const id = await marketSearch(p, '125mm Gatling AutoCannon II');
    await p.click(`.market .trow[data-tid="${id}"]`, { count: 2 });
    await p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((el) => el.textContent.includes('Replaced')), { timeout: 10000 });
  }],
];

for (const [w, h] of SIZES) {
  for (const [name, act] of scenes) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: h });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${url}${url.includes('?') ? '&' : '?'}eft=${encodeURIComponent(FIT)}`, { waitUntil: 'networkidle0', timeout: 120000 });
    await p.waitForFunction(() => window.__lastStats?.ship?.name === 'Rifter' && !window.__lastStats.error, { timeout: 120000 });
    try {
      await act(p);
      const file = path.join(outdir, `${name}-${w}x${h}.png`);
      await p.screenshot({ path: file });
      console.log(`${errs.length ? 'ERRS' : 'OK  '} ${file}${errs.length ? '  ' + errs.join(' | ') : ''}`);
    } catch (e) {
      console.log(`FAIL ${name}-${w}x${h}: ${e.message}`);
    }
    await p.close();
  }
}
await b.close();
