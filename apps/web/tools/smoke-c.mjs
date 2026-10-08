// Stage C smoke: scenario editor (Profiles tab), right-column scenario results (stats.scenario_results),
// graph dock (all axes, multi-Y, fit x scenario lines, legend toggle, crosshair, CSV/PNG export).
//   node tools/smoke-c.mjs <url>   (CHROME=/path/to/chrome)
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/EXFA-App/';
const EFT = `[Vexor, C Vexor]
10MN Afterburner II
Warp Disruptor II
Stasis Webifier II

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
  // record downloads (a.click on anchor[download]) instead of saving files
  await p.evaluateOnNewDocument(() => {
    window.__dl = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl.push(this.download); return; } return orig.call(this); };
  });
  await p.goto(`${url}${url.includes('?') ? '&' : '?'}eft=${encodeURIComponent(EFT)}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.fit-area .mod', { timeout: 90000 });
  await p.waitForFunction(() => window.__lastStats?.offense?.total?.dps?.total > 0, { timeout: 60000 });

  // --- C-1: scenario editor in the Profiles tab -------------------------------------------------
  await p.evaluate(() => [...document.querySelectorAll('.left .tabs button')].find((x) => /Profiles|配置文件/.test(x.textContent))?.click());
  await p.waitForSelector('.profiles .scn-list', { timeout: 10000 });
  const builtin = await p.evaluate(() => [...document.querySelectorAll('.profiles .scn-row .scn-name')].map((x) => x.textContent));
  check('web.smoke.c.scn-builtin: builtin "current target 10km orbit" scenario listed', builtin.some((x) => /orbit|环绕/.test(x)), builtin.join('|'));

  // expand builtin -> read-only note
  await p.evaluate(() => [...document.querySelectorAll('.profiles .scn-row .scn-name')].find((x) => /orbit|环绕/.test(x.textContent))?.click());
  const readonly = await p.evaluate(() => document.querySelector('.profiles .scn-edit.muted')?.textContent ?? '');
  check('web.smoke.c.scn-builtin-ro: builtin scenario is read-only', /read only|只读/.test(readonly), readonly.trim().slice(0, 40));

  // + scenario -> inline editor -> target kinds
  await p.click('.profiles .scn-add');
  await p.waitForSelector('.profiles .scn-edit select', { timeout: 10000 });
  await p.evaluate(() => {
    const inp = document.querySelector('.profiles .scn-edit label input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, 'Smoke Scn'); inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.select('.profiles .scn-edit label select', 'inline');
  const nInline = await p.evaluate(() => document.querySelectorAll('.scn-inline input').length);
  await p.select('.profiles .scn-edit label select', 'fit');
  const fitOpts = await p.evaluate(() => [...document.querySelector('.scn-target').options].map((o) => o.text));
  const kindOk = nInline >= 6 && fitOpts.some((x) => x.includes('C Vexor'));
  check('web.smoke.c.scn-editor: new scenario editor switches target kinds (inline fields / library fits)', kindOk, `inline=${nInline} fits=${fitOpts.join(',')}`);
  // distance field edits params (km display -> m store)
  await p.evaluate(() => {
    const lb = [...document.querySelectorAll('.scn-params label')].find((l) => /distance|距离/.test(l.textContent));
    const inp = lb.querySelector('input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '25'); inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  const summary = await p.evaluate(() => [...document.querySelectorAll('.profiles .scn-row .muted')].map((x) => x.textContent).join('|'));
  check('web.smoke.c.scn-params: distance edits land in the scenario (25 km summary)', /25[\s,]*km|25/.test(summary), summary.slice(0, 80));

  // --- C-2: right-column scenario checkboxes ----------------------------------------------------
  await p.waitForSelector('.scenarios .scn-check', { timeout: 10000 });
  await p.evaluate(() => document.querySelector('.scenarios input[data-scn="orbit-10k"]').click());
  const scnRes = await p.waitForFunction(() => {
    const r = window.__lastStats?.scenario_results;
    return Array.isArray(r) && r.some((x) => x?.id === 'orbit-10k' && typeof x.dps === 'number') && r;
  }, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);
  check('web.smoke.c.scn-results: checking a scenario returns effective dps/volley (scenario_results)', !!scnRes, scnRes ? `dps=${scnRes[0]?.dps?.toFixed?.(1)}` : 'none');
  const rowDps = await p.evaluate(() => document.querySelector('.scenarios .scn-dps')?.textContent ?? '');
  check('web.smoke.c.scn-row: scenario row shows dps and % of paper', /\d/.test(rowDps) && /%/.test(rowDps), rowDps.trim().slice(0, 60));

  // --- C-3: graph dock --------------------------------------------------------------------------
  await p.evaluate(() => [...document.querySelectorAll('.center .tabs button')].find((x) => /Graphs|图表/.test(x.textContent))?.click());
  await p.waitForSelector('.graphs select.graph-kind', { timeout: 15000 });
  await p.select('.graphs select.graph-kind', 'dps');
  const axes = await p.evaluate(() => [...document.querySelectorAll('.graphs select.graph-x option')].map((o) => o.value));
  check('web.smoke.c.axes: damage graph exposes every engine x axis', ['distance_m', 'time_s', 'tgt_speed_mps', 'tgt_speed_pct', 'tgt_sig_m', 'tgt_sig_pct', 'atk_speed_mps', 'atk_speed_pct', 'atk_angle_deg', 'tgt_angle_deg'].every((a) => axes.includes(a)), axes.join(','));
  const ys = await p.evaluate(() => [...document.querySelectorAll('.graph-y input[data-y]')].map((i) => i.dataset.y));
  check('web.smoke.c.yseries: damage graph offers dps/volley/damage y series', ['dps', 'volley', 'damage'].every((y) => ys.includes(y)), ys.join(','));

  await p.waitForFunction(() => window.__lastGraph?.kind === 'dps' && window.__lastGraph.source === 'engine' && window.__lastGraph.series?.length >= 1, { timeout: 60000 });

  // scenario overlay: check orbit-10k -> fit x (profile + scenario) lines
  await p.evaluate(() => { const d = document.querySelector('.graph-scn'); d.open = true; d.querySelector('input[data-scn="orbit-10k"]').click(); });
  const g2 = await p.waitForFunction(() => window.__lastGraph?.kind === 'dps' && window.__lastGraph.series?.length >= 2 && window.__lastGraph.scenarios?.length === 2 && window.__lastGraph, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);
  check('web.smoke.c.graph-scn: checking a scenario adds a second line (fit x scenarios)', !!g2, g2 ? g2.series.map((s) => s.name).join(' | ') : 'none');

  // axis switch: target speed %
  await p.select('.graphs select.graph-x', 'tgt_speed_pct');
  const g3 = await p.waitForFunction(() => window.__lastGraph?.axis === 'tgt_speed_pct' && window.__lastGraph.source === 'engine' && window.__lastGraph, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);
  check('web.smoke.c.axis-switch: sweeping target speed % recomputes on the engine', g3?.axis === 'tgt_speed_pct' && g3.series?.some((s) => s.n > 0), g3 ? `axis=${g3.axis} pts=${g3.series?.map((s) => s.n).join('/')}` : 'none');

  // legend toggle hides a line (SVG elements have no .click — dispatch a mouse event)
  await p.select('.graphs select.graph-x', 'distance_m');
  await p.waitForFunction(() => window.__lastGraph?.axis === 'distance_m' && window.__lastGraph.series?.length >= 2, { timeout: 60000 });
  const before = await p.evaluate(() => document.querySelectorAll('svg.chart polyline').length);
  await p.evaluate(() => document.querySelector('svg.chart .legend-item.toggle').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await sleep(200);
  const after = await p.evaluate(() => document.querySelectorAll('svg.chart polyline').length);
  const off = await p.evaluate(() => document.querySelector('svg.chart .legend-item[data-off]') != null);
  check('web.smoke.c.legend: legend click hides a line (dimmed in legend)', before >= 2 && after === before - 1 && off, `${before} -> ${after}`);

  // crosshair tooltip (scroll the chart fully into the viewport first — the dock column is tall)
  await p.evaluate(() => document.querySelector('svg.chart').scrollIntoView({ block: 'center' }));
  const box = await (await p.$('svg.chart')).boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 120));
  await sleep(150);
  const tip = await p.evaluate(() => document.querySelector('.chart-tip')?.textContent ?? '');
  check('web.smoke.c.crosshair: hover shows the crosshair tooltip', /x =/.test(tip), tip.trim().slice(0, 60).replace(/\s+/g, ' '));

  // CSV + PNG export via recorded downloads
  await p.click('.g-csv'); await p.click('.g-png'); await sleep(500);
  const dl = await p.evaluate(() => window.__dl);
  check('web.smoke.c.export: CSV and PNG export buttons produce downloads', dl.some((d) => d.endsWith('.csv')) && dl.some((d) => d.endsWith('.png')), dl.join(','));
} finally {
  await b.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
