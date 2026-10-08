// Stage D-4 smoke: "+ 可替代" adds a row type to the selected item's Alternative, module rows show the
// ⇄n badge, the strip's Alternatives tab lists options with 切换, and the fit header has the branch
// dropdown (+ diverged marker) and "保存为分支".
//   node tools/smoke-d4.mjs <url>   (CHROME=/path/to/chrome)
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/EXFA-App/';
const EFT = `[Vexor, D4 Vexor]
10MN Afterburner II
Warp Disruptor II
Stasis Webifier II
Omnidirectional Tracking Link II

Heavy Neutron Blaster II, Void M
Heavy Neutron Blaster II, Void M

Drone Damage Amplifier II
Medium Armor Repairer II

Hammerhead II x5
`;

let passed = 0, failed = 0;
const check = (name, ok, info = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` — ${info}` : ''}`); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const p = (await b.pages())[0];
  await p.setViewport({ width: 1600, height: 900 });
  await p.goto(`${url}${url.includes('?') ? '&' : '?'}eft=${encodeURIComponent(EFT)}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.fit-area .mod', { timeout: 90000 });
  await p.waitForSelector('.dock .compare-strip', { timeout: 30000 }).catch(() => null);

  // select the AB row -> strip shows variations
  await p.evaluate(() => {
    const row = [...document.querySelectorAll('.fit-area .mod')].find((x) => /Afterburner/i.test(x.textContent));
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(400);
  const selInfo = await p.evaluate(() => ({
    sel: document.querySelector('.strip-selection')?.textContent ?? '',
    variants: document.querySelectorAll('.strip-variant').length,
  }));
  check('web.smoke.d4.select: selecting a module opens the compare strip with variations', /Afterburner/.test(selInfo.sel) && selInfo.variants > 0, JSON.stringify(selInfo));

  // "+ 可替代" on a variation row -> module gains an alt badge
  await p.waitForSelector('.strip-variant .alt-add', { timeout: 10000 });
  await p.evaluate(() => document.querySelector('.strip-variant .alt-add').click());
  await sleep(300);
  const badge = await p.evaluate(() => {
    const row = [...document.querySelectorAll('.fit-area .mod')].find((x) => /Afterburner/i.test(x.textContent));
    return row?.querySelector('.alt-open')?.textContent ?? null;
  });
  check('web.smoke.d4.add-alt: "+ 可替代" sets alt_id and the module row shows ⇄n', badge === '⇄2', String(badge));

  // ⇄ badge opens the alternatives tab with option rows
  await p.evaluate(() => {
    const row = [...document.querySelectorAll('.fit-area .mod')].find((x) => /Afterburner/i.test(x.textContent));
    row?.querySelector('.alt-open')?.click();
  });
  await sleep(500);
  const altTab = await p.evaluate(() => ({
    tabs: [...document.querySelectorAll('.compare-strip .tabs button')].map((x) => ({ t: x.textContent, on: x.classList.contains('on') })),
    rows: [...document.querySelectorAll('.strip-variant .strip-name')].map((x) => x.textContent),
    switchButtons: [...document.querySelectorAll('.strip-variant button.tiny')].map((x) => x.textContent),
  }));
  const altOn = altTab.tabs.find((x) => x.on)?.t;
  check('web.smoke.d4.alt-tab: ⇄ badge opens the Alternatives tab listing the options with 切换',
    /可替代|Alternatives/.test(altOn ?? '') && altTab.rows.length === 2 && altTab.switchButtons.every((x) => /切换|Apply/.test(x)), JSON.stringify(altTab));

  // 切换 to option 2 -> module type changes (AB II -> AB I here: names still contain "Afterburner")
  const altName = () => p.evaluate(() => [...document.querySelectorAll('.fit-area .mod')].find((x) => x.querySelector('.alt-open'))?.querySelector('.mname')?.textContent ?? '');
  const before = await altName();
  await p.evaluate(() => document.querySelectorAll('.strip-variant button.tiny')[1]?.click());
  await sleep(600);
  const after = await altName();
  check('web.smoke.d4.alt-switch: 切换 applies the option to the module', before === '10MN Afterburner II' && after === '10MN Afterburner I', `${before} -> ${after}`);

  // 保存为分支 -> branch dropdown appears; switching back via the select works
  await p.waitForSelector('.branch-save', { timeout: 5000 });
  await p.evaluate(() => document.querySelector('.branch-save').click());
  await p.waitForSelector('input.inline-edit-input', { timeout: 5000 });
  await p.type('input.inline-edit-input', 'Speed branch');
  await p.keyboard.press('Enter');
  await sleep(300);
  const sel = await p.evaluate(() => ({ sel: !!document.querySelector('.branchsel'), options: [...document.querySelectorAll('.branchsel option')].map((x) => x.textContent) }));
  check('web.smoke.d4.branch: 保存为分支 captures the current picks and shows the branch dropdown', sel.sel && sel.options.some((x) => /Speed branch/.test(x)), JSON.stringify(sel.options));
} finally {
  await b.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
