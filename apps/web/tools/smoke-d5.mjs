// Stage D-5 smoke: single .exfa.json document export, library .zip export (fflate + format toFiles),
// and zip import merging back through the Fits browser with added/skipped counts.
//   node tools/smoke-d5.mjs <url>   (CHROME=/path/to/chrome)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/EXFA-App/';
const EFT = `[Vexor, D5 Vexor]
10MN Afterburner II
Warp Disruptor II
Stasis Webifier II

Heavy Neutron Blaster II, Void M
Heavy Neutron Blaster II, Void M

Drone Damage Amplifier II
Medium Armor Repairer II

Hammerhead II x5
`;
const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'exfa-d5-'));

let passed = 0, failed = 0;
const check = (name, ok, info = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` — ${info}` : ''}`); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const p = (await b.pages())[0];
  const cdp = await p.createCDPSession();
  try { await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl }); }
  catch { await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl }); }
  await p.setViewport({ width: 1600, height: 900 });
  await p.goto(`${url}${url.includes('?') ? '&' : '?'}eft=${encodeURIComponent(EFT)}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.fit-area .mod', { timeout: 90000 });

  // dock -> Import-export tab
  await p.evaluate(() => [...document.querySelectorAll('.dock-head .tabs button')].find((x) => /Import-export|导入 ?\/ ?导出/.test(x.textContent))?.click());
  await p.waitForSelector('.import-export', { timeout: 10000 });

  // single .exfa.json export -> file on disk is an exfa/fit@1 document
  await p.click('.export-exfa');
  const docFile = await new Promise((res) => {
    const t = setInterval(() => {
      const f = fs.readdirSync(dl).find((x) => x.endsWith('.exfa.json') && !x.endsWith('.crdownload'));
      if (f) { clearInterval(t); res(f); }
    }, 100);
    setTimeout(() => { clearInterval(t); res(null); }, 10000);
  });
  const docJson = docFile ? JSON.parse(fs.readFileSync(path.join(dl, docFile), 'utf8')) : null;
  check('web.smoke.d5.exfa-export: current fit exports as an exfa/fit@1 .exfa.json document', docJson?.format === 'exfa/fit@1' && docJson?.name === 'D5 Vexor', docFile ?? 'no file');

  // library .zip export -> real zip file
  await p.click('.export-zip');
  const zipFile = await new Promise((res) => {
    const t = setInterval(() => {
      const f = fs.readdirSync(dl).find((x) => x.endsWith('.zip') && !x.endsWith('.crdownload'));
      if (f) { clearInterval(t); res(f); }
    }, 100);
    setTimeout(() => { clearInterval(t); res(null); }, 10000);
  });
  const zipBytes = zipFile ? fs.readFileSync(path.join(dl, zipFile)) : null;
  check('web.smoke.d5.zip-export: library exports as a .zip archive', !!zipBytes && zipBytes[0] === 0x50 && zipBytes[1] === 0x4b, zipFile ?? 'no file');

  // Fits tab: import the zip back through the library file input -> merge reports skipped (same ids)
  await p.evaluate(() => [...document.querySelectorAll('.tabs button')].find((x) => /^Fits|^配置/.test(x.textContent)).click());
  await p.waitForSelector('.fitbrowser .lib-import-file', { timeout: 15000 });
  const countBefore = await p.evaluate(() => document.querySelectorAll('.lib-fit').length);
  await (await p.$('.lib-import-file')).uploadFile(path.join(dl, zipFile));
  await p.waitForFunction(() => /\.zip: zip|\.zip.*added|skipped/.test(document.querySelector('.lib-msg')?.textContent ?? ''), { timeout: 15000 }).catch(() => null);
  const msg = await p.evaluate(() => document.querySelector('.lib-msg')?.textContent ?? '');
  const countAfter = await p.evaluate(() => document.querySelectorAll('.lib-fit').length);
  check('web.smoke.d5.zip-import: importing the library zip merges without duplicating (skip same ids)', countBefore === countAfter && /skipped/.test(msg), `${countBefore} -> ${countAfter}, msg: ${msg}`);

  // single .exfa.json import via the same input -> doc merges (skipped as identical)
  await (await p.$('.lib-import-file')).uploadFile(path.join(dl, docFile));
  await p.waitForFunction((before) => /fit@1|backup|skipped|added/.test(document.querySelector('.lib-msg')?.textContent ?? '') || document.querySelectorAll('.lib-fit').length > before, { timeout: 15000 }, countBefore).catch(() => null);
  const count2 = await p.evaluate(() => document.querySelectorAll('.lib-fit').length);
  check('web.smoke.d5.exfa-import: importing the .exfa.json document merges without duplicating', count2 === countBefore, `${countBefore} -> ${count2}`);
} finally {
  await b.close();
  fs.rmSync(dl, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
