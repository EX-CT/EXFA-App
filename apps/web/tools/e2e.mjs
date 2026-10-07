// End-to-end check of the main UI flows against the WASM-only site:
//   node tools/e2e.mjs <url> [wasm-worker]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/EXFA-App/';
const engine = process.argv[3] ?? 'wasm-worker';
if (engine !== 'wasm-worker') throw new Error(`EXFA-App is WASM-only; unsupported engine ${engine}`);
const EFT = `[Vexor, E2E Vexor]
Drone Damage Amplifier II
Drone Damage Amplifier II
Medium Armor Repairer II
Energized Adaptive Nano Membrane II
Damage Control II

10MN Afterburner II
Warp Disruptor II
Stasis Webifier II [1]
Omnidirectional Tracking Link II

Drone Link Augmentor II
Small Energy Neutralizer II
Heavy Neutron Blaster II, Void M
Heavy Neutron Blaster II, Void M

Medium Auxiliary Nano Pump I
Medium Auxiliary Nano Pump I
Medium Capacitor Control Circuit I

Hammerhead II x5
Hobgoblin II x5

Inherent Implants 'Noble' Repair Proficiency RP-905
Improved Crash Booster

[1] Stasis Webifier II
  Unstable Stasis Webifier Mutaplasmid
  capacitorNeed 6, cpu 22.5, maxRange 12000, speedFactor -58
`;
const CARRIER = `[Thanatos, E2E Thanatos]

Fighter Support Unit II

Einherji II x9
Firbolg II x9
`;
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1500, height: 1000 });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
const results = [];
// Check names: stable id `web.e2e.<slug>` + description (docs/test-ids.md maps ids to the old names).
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };
const stats = () => p.evaluate(() => window.__lastStats);
const waitNew = async (prev) => { await p.waitForFunction((pr) => window.__lastStats && JSON.stringify(window.__lastStats) !== pr, { timeout: 60000 }, JSON.stringify(prev)); return stats(); };
const clickText = (sel, text) => p.evaluate((s, t) => { const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(t)); if (!el) return false; el.click(); return true; }, sel, text);
const setText = (text) => p.evaluate((t) => {
  const ta = document.querySelector('textarea.eft');
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(ta, t);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}, text);

const withQuery = (query) => `${url}${url.includes('?') ? '&' : '?'}${query}`;
await p.goto(withQuery(`eft=${encodeURIComponent(EFT)}`), { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__lastStats?.offense, { timeout: 120000 });
// The page must run the pinned WASM worker.
const active = await p.evaluate(() => window.__eveEngine?.info?.id);
if (active !== engine) { console.log(`FAIL  active engine  — wanted ${engine}, page runs ${active}`); await b.close(); process.exit(1); }
let s = await stats();
check('web.e2e.eft-share-link-import: EFT import via ?eft=, ship', s.ship?.name === 'Vexor', s.ship?.name);
check('web.e2e.drone-dps: drones dps', s.offense?.total?.drone_dps > 0, s.offense?.total?.drone_dps);
check('web.e2e.weapon-dps-charges: weapon dps (charges)', s.offense?.total?.weapon_dps > 0, s.offense?.total?.weapon_dps);
check('web.e2e.armor-tank: armor tank', s.defense?.tank?.raw?.armor_repair > 0, s.defense?.tank?.raw?.armor_repair);
check('web.e2e.mutated-module-import: mutated module imported', await p.evaluate(() => document.body.textContent.includes('Abyssal Stasis Webifier')));
check('web.e2e.no-violations: no violations', (s.violations ?? []).length === 0, JSON.stringify(s.violations));
// Chinese mode: weapon names in the stats table come from the dataset (zh), not the engine's English strings
const langSel = async (l) => p.evaluate((v) => { const sel = [...document.querySelectorAll('header select')].find((x) => [...x.options].some((o) => o.value === 'zh')); sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); }, l);
await langSel('zh');
await new Promise((r) => setTimeout(r, 300));
const zhW = await p.evaluate(() => [...document.querySelectorAll('.stats td.wname')].map((x) => x.textContent));
check('web.e2e.zh-weapon-names: zh weapon names', zhW.length > 0 && zhW.every((n) => /[\u4e00-\u9fff]/.test(n) && !n.includes('Heavy Neutron')), zhW.join(' | '));
await langSel('en');
await new Promise((r) => setTimeout(r, 300));
const enW = await p.evaluate(() => [...document.querySelectorAll('.stats td.wname')].map((x) => x.textContent));
check('web.e2e.en-weapon-names-restored: en weapon names restored', enW.some((n) => n.startsWith('Heavy Neutron Blaster II')), enW.join(' | '));

// projected web from the market
const v0 = s.navigation.max_velocity;
await clickText('.tabs button', 'Projected');
await p.evaluate(() => { const c = document.querySelector('.toggle input'); c.click(); });
await p.type('.market .search', 'Stasis Webifier II');
await p.waitForFunction(() => [...document.querySelectorAll('.trow .tname')].some((e) => e.textContent === 'Stasis Webifier II'));
const webRowId = await p.evaluate(() => Number([...document.querySelectorAll('.trow .tname')].find((e) => e.textContent === 'Stasis Webifier II').closest('.trow')?.dataset.tid));
await p.dragAndDrop(`.market .trow[data-tid="${webRowId}"]`, '.fit-area .fitting');
s = await waitNew(s);
check('web.e2e.projected-web: projected web slows the ship', s.navigation.max_velocity < v0 * 0.6, `${v0} -> ${s.navigation.max_velocity}`);

// environment beacon (wormhole)
const beacon = await p.evaluate(() => { const sel = [...document.querySelectorAll('select')].find((x) => x.options[0]?.text.startsWith('add system effect')); const o = [...sel.options].find((x) => x.text.startsWith('[wormhole]')); return o?.value; });
const sels = await p.$$('select');
for (const el of sels) { const first = await el.evaluate((x) => x.options[0]?.text); if (first?.startsWith('add system effect')) { await el.select(beacon); break; } }
s = await waitNew(s);
check('web.e2e.environment-beacon: environment beacon applied', s.meta && (await p.evaluate(() => document.body.textContent.includes('wormhole'))), beacon);

// graphs
await clickText('.center .tabs button', 'Graphs');
// The WASM-only app must offer and render Engine graph RPC results for every graph kind.
const GRAPH_RPC = true;
const kinds = ['dps', 'cap', 'regen', 'mobility', 'lock', 'warp', 'app', 'ewar', 'rr'];
await p.waitForFunction(() => document.querySelector('.graphs select option[value="app"]'), { timeout: 30000 });
const offered = await p.evaluate(() => [...document.querySelectorAll('.graphs select option')].map((o) => o.value));
check('web.e2e.graph-set: Engine graphs are offered', ['app', 'ewar', 'rr'].every((x) => offered.includes(x)), offered.join(','));
for (const g of kinds) {
  await p.select('.graphs select', g);
  const want = 'engine';
  const src = await p.waitForFunction((w) => { const e = document.querySelector('.graph-src'); return e && e.dataset.src === w && e.dataset.src; }, { timeout: 30000 }, want).then((h) => h.jsonValue(), () => p.evaluate(() => document.querySelector('.graph-src')?.dataset.src + ' ' + (document.querySelector('.graph-src')?.title ?? '')));
  const n = await p.evaluate(() => document.querySelectorAll('svg.chart polyline').length);
  const lg = await p.evaluate(() => window.__lastGraph);
  check(`web.e2e.graph-${g}: graph ${g} (${want})`, n > 0 && src === want && lg?.kind === g, `${n} lines, ${src}${lg?.series ? ', ' + lg.series.map((x) => `${x.name}:${x.n}`).join(' ') : ''}`);
  if (g === 'lock') {
    // lock time = min(40000 / scanRes / asinh(sig)^2, 1800) at sig 10 m, from the stats of the same engine
    const sr = s.targeting?.scan_resolution, want10 = Math.min(40000 / sr / Math.asinh(10) ** 2, 1800), got = lg?.series?.[0]?.first;
    check('web.e2e.graph-lock-time-matches-stats: engine lock-time graph matches stats', got && Math.abs(got[1] - want10) <= 1e-6 * want10, `${got?.[1]} vs ${want10}`);
  }
  if (g === 'ewar') check('web.e2e.graph-ewar-web-neut: engine ewar graph has web + neut', ['web_pct', 'neut_gj_s'].every((y) => lg?.series?.some((x) => x.name === y)), lg?.series?.map((x) => x.name).join(','));
  if (g === 'cap') check('web.e2e.graph-cap-within-capacity: engine capacitor graph within capacity', lg?.series?.[0]?.first?.[1] > 0 && lg.series[0].first[1] <= s.capacitor?.capacity * (1 + 1e-9), `t=0 ${lg?.series?.[0]?.first?.[1]} (after first activations, capsim) of ${s.capacitor?.capacity} GJ`);
}

// booster side effect toggle (armor HP penalty)
await clickText('.fit-area .tabs button', 'Fitting');
const a0 = s.defense?.hp?.armor;
const toggled = await p.evaluate(() => { const l = [...document.querySelectorAll('.subopts label')].find((x) => x.textContent.includes('Armor Hp')); if (!l) return false; l.querySelector('input').click(); return true; });
s = await waitNew(s);
check('web.e2e.booster-side-effect: booster side effect lowers armor HP', toggled && s.defense?.hp?.armor < a0, `${a0} -> ${s.defense?.hp?.armor}`);

// undo / redo
await clickText('header button', '↶ Undo');
s = await waitNew(s);
const aU = s.defense?.hp?.armor;
await clickText('header button', '↷ Redo');
s = await waitNew(s);
check('web.e2e.undo-redo: undo / redo', aU === a0 && s.defense?.hp?.armor < a0, `${a0} -undo-> ${aU} -redo-> ${s.defense?.hp?.armor}`);

// show info on a fitted module -> engine-computed fitted values
await p.evaluate(() => [...document.querySelectorAll('.mod .mname')].find((e) => e.textContent.startsWith('Heavy Neutron Blaster II')).click());
await p.waitForFunction(() => document.querySelector('.infopane table.attrs thead') || document.querySelector('.infopane')?.textContent.includes('unavailable') || document.querySelector('.infopane')?.textContent.includes('did not return'), { timeout: 30000 });
const fi = await p.evaluate(() => ({ head: !!document.querySelector('.infopane table.attrs thead'), changed: document.querySelectorAll('.infopane tr.changed').length, note: document.querySelector('.infopane p.muted')?.textContent }));
check('web.e2e.show-info-fitted-values: show info: fitted attribute values', fi.head && fi.changed > 0, `${fi.changed} changed; ${fi.note}`);
if (fi.head) {
  // ENG-CORE-006: every fitted value shown is the engine's (independent include_attributes=all calc of the same fit),
  // and two of them match the skill formula: Heavy Neutron Blaster II with all skills V on a Vexor (no damage / RoF
  // modules): damage multiplier x 1.25 (Gallente Cruiser 5 %/level) x 1.25 (Medium Hybrid Turret) x 1.10 (Medium
  // Blaster Specialization) x 1.15 (Surgical Strike), rate of fire x 0.90 (Gunnery) x 0.80 (Rapid Firing)
  const fv = await p.evaluate(async () => {
    const rows = Object.fromEntries([...document.querySelectorAll('.infopane table.attrs tr[data-attr]')].map((r) => [r.dataset.attr, { name: r.dataset.name, base: r.dataset.base === '' ? null : +r.dataset.base, fitted: r.dataset.fitted === '' ? null : +r.dataset.fitted }]));
    const mi = window.__lastInfoCtx?.module;
    const req = window.__lastRequest;
    const r = await window.__eveEngine.calc({ ...req, options: { ...(req.options ?? {}), include_attributes: 'all' } });
    const mods = r.attributes?.modules ?? [];
    const eng = (mods.find((m, i) => (m.module_index ?? i) === mi) ?? {}).attributes ?? {};
    return { rows, eng, mi };
  });
  const shown = Object.entries(fv.rows).filter(([, v]) => v.fitted != null);
  const diff = shown.filter(([, v]) => fv.eng[v.name] == null || Math.abs(v.fitted - fv.eng[v.name]) > 1e-9 * Math.max(1, Math.abs(fv.eng[v.name])));
  check('web.e2e.show-info-engine-values: every fitted value in show info equals the engine attribute value', shown.length > 10 && !diff.length, `${shown.length} values, module ${fv.mi}; mismatches ${diff.slice(0, 3).map(([, v]) => `${v.name}: ${v.fitted} vs ${fv.eng[v.name]}`).join(', ') || 'none'}`);
  const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 1e-6 * Math.abs(b);
  const dm = fv.rows[64], rof = fv.rows[51];
  check('web.e2e.show-info-skill-formula: fitted damage multiplier and rate of fire match the all-V skill formula', near(dm?.fitted, dm?.base * 1.25 * 1.25 * 1.10 * 1.15) && near(rof?.fitted, rof?.base * 0.9 * 0.8),
    `damage ${dm?.base} -> ${dm?.fitted} (want ${dm?.base * 1.9765625}); rof ${rof?.base} -> ${rof?.fitted} (want ${rof?.base * 0.72})`);
}
// attribute override (Pyfa-style): damageMultiplier of the blaster type
const wd0 = s.offense?.total?.weapon_dps;
await p.click('.infopane input.editov');
await p.waitForSelector('.infopane input.ovin[data-attr="64"]');
await p.type('.infopane input.ovin[data-attr="64"]', '10');
s = await waitNew(s);
check('web.e2e.attribute-override: attribute override raises weapon dps', s.offense?.total?.weapon_dps > wd0 * 1.5, `${wd0} -> ${s.offense?.total?.weapon_dps}`);
await p.evaluate(() => { const i = document.querySelector('.infopane input.ovin[data-attr="64"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); });
s = await waitNew(s);
check('web.e2e.attribute-override-removed: removing the override restores dps', Math.abs(s.offense?.total?.weapon_dps - wd0) < 1e-6, s.offense?.total?.weapon_dps);
await p.click('.infopane .infoclose');

// manual fleet buff (shield harmonizing)
await clickText('.tabs button', 'Projected');
const sr0 = s.defense?.resonance?.shield?.em;
const buffId = await p.evaluate(() => [...document.querySelector('select.buffsel').options].find((o) => o.text === 'Shield Burst: Shield Harmonizing: Shield Resistance')?.value);
await p.select('select.buffsel', buffId);
s = await waitNew(s);
check('web.e2e.manual-fleet-buff: manual fleet buff raises shield resist (lower resonance)', s.defense?.resonance?.shield?.em < sr0, `${sr0} -> ${s.defense?.resonance?.shield?.em}`);

// export EFT round trip through the Engine formats RPC in the dock
await clickText('.center .tabs button', 'Import-export');
await clickText('.import-export button', 'Export EFT');
await p.waitForFunction(() => document.querySelector('textarea.eft')?.value.startsWith('[Vexor, E2E Vexor]'), { timeout: 30000 });
const eft = await p.evaluate(() => document.querySelector('textarea.eft').value);
check('web.e2e.eft-export: EFT export', eft.startsWith('[Vexor, E2E Vexor]') && eft.includes('Hammerhead II x5'), eft.split('\n')[0]);
check('web.e2e.eft-export-mutated: mutated module EFT round trip', eft.includes('Stasis Webifier II [1]') && eft.includes('[1] Stasis Webifier II\n  Unstable Stasis Webifier Mutaplasmid\n') && eft.includes('maxRange 12000'), eft.split('\n').slice(-3).join(' / '));
await clickText('.import-export button', 'Export DNA');
await p.waitForFunction(() => /^\d+:/.test(document.querySelector('textarea.eft')?.value ?? '') && document.querySelector('textarea.eft').value.endsWith('::'), { timeout: 30000 });
const dna = await p.evaluate(() => document.querySelector('textarea.eft').value);
check('web.e2e.dna-export: DNA export', /^626:/.test(dna) && dna.endsWith('::'), dna);
await clickText('.import-export button', 'Export multibuy');
await p.waitForFunction(() => document.querySelector('textarea.eft')?.value.startsWith('Vexor\n'), { timeout: 30000 });
const mb = await p.evaluate(() => document.querySelector('textarea.eft').value);
check('web.e2e.multibuy-export: multibuy export', /^Vexor\n/.test(mb) && mb.includes('Hammerhead II x5') && mb.includes('Heavy Neutron Blaster II x2'), mb.split('\n').length + ' lines');
await clickText('.import-export button', 'Export ESI JSON');
await p.waitForFunction(() => {
  try { return JSON.parse(document.querySelector('textarea.eft')?.value ?? '').ship_type_id === 626; } catch { return false; }
}, { timeout: 30000 });
const esi = await p.evaluate(() => document.querySelector('textarea.eft').value);
let ej = null; try { ej = JSON.parse(esi); } catch {}
check('web.e2e.esi-json-export: ESI JSON export', ej?.ship_type_id === 626 && ej.items.some((i) => i.flag === 27 || i.flag === 'HiSlot0') && ej.items.some((i) => i.flag === 87 || i.flag === 'DroneBay'), ej ? ej.items.length + ' items' : esi.slice(0, 80));
// Pyfa formats through the main Engine WASM: EVE XML export and ship-stats text.
const prov = await p.evaluate(() => document.querySelector('.formats-provider')?.dataset.provider);
check('web.e2e.formats-provider: imports / exports run through the main Engine WASM', prov === 'engine-wasm', prov);
let xml = '';
if (await p.$('.import-export button.export-xml')) {
  await p.click('.import-export button.export-xml');
  await p.waitForFunction(() => document.querySelector('textarea.eft')?.value.includes('<fitting name="E2E Vexor">'), { timeout: 30000 });
  xml = await p.evaluate(() => document.querySelector('textarea.eft').value);
}
check('web.e2e.xml-export: EVE XML export', xml.includes('<fitting name="E2E Vexor">') && xml.includes('base_type="Stasis Webifier II"'), xml.split('\n').length + ' lines');
let ss = '';
if (await p.$('.import-export button.export-shipstats')) {
  await p.click('.import-export button.export-shipstats');
  ss = await p.waitForFunction(() => { const v = document.querySelector('textarea.eft').value; return v && !v.startsWith('<?xml') ? v : null; }, { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => '');
}
check('web.e2e.shipstats-export: ship stats export (Engine stats + formats RPC)', /Vexor/.test(ss) && /DPS|dps/.test(ss), ss.split('\n').slice(0, 2).join(' / '));

// implant sets (SDE presets): applying High-grade Snake fills slots 1-6, keeps the slot-7+ implant, raises velocity
await clickText('.fit-area .tabs button', 'Fitting');
s = await stats();
const hasSets = await p.evaluate(() => !!document.querySelector('select.implantset option[value="snake.high-grade"]'));
if (hasSets) {
  const v0s = s.navigation?.max_velocity;
  await p.select('select.implantset', 'snake.high-grade');
  s = await waitNew(s);
  const imps = await p.evaluate(() => [...document.querySelectorAll('.bay .mod .mname')].map((x) => x.textContent).filter((n) => /Snake|RP-905/.test(n)));
  check('web.e2e.implant-set: implant set applied (6 Snake + kept RP-905, faster)', imps.filter((n) => n.includes('High-grade Snake')).length === 6 && imps.some((n) => n.includes('RP-905')) && s.navigation?.max_velocity > v0s, `${imps.length} implants; ${v0s} -> ${s.navigation?.max_velocity} m/s`);
} else check('web.e2e.implant-set: implant set applied (6 Snake + kept RP-905, faster)', false, 'no SDE implant sets loaded');
// SDE NPC damage profile in the Profiles tab changes EHP
await clickText('.left .tabs button', 'Profiles');
await p.evaluate(() => document.querySelector('.sdetoggle input')?.click());
const ehp0 = s.defense?.ehp?.total;
const picked = await p.evaluate(() => { const tr = [...document.querySelectorAll('.profiles tr')].find((r) => r.textContent.includes('[NPC] Guristas Pirates')); tr?.querySelector('input[type=radio]')?.click(); return !!tr; });
if (picked) s = await waitNew(s);
check('web.e2e.sde-npc-damage-profile: SDE NPC damage profile (Guristas) changes EHP', picked && s.defense?.ehp?.total !== ehp0, `${ehp0} -> ${s.defense?.ehp?.total}`);
// PRF-DMG-001: the site's own patterns are only the exact ones (Uniform + one damage type)
const own = await p.evaluate(() => [...document.querySelectorAll('.profiles table')][0] && [...[...document.querySelectorAll('.profiles table')][0].querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].slice(1, 6).map((c) => c.textContent.trim()).join('/')).filter((x) => !x.startsWith('[')));
check('web.e2e.builtin-damage-exact: the built-in damage patterns are exactly Uniform, EM, Thermal, Kinetic, Explosive', JSON.stringify(own) === JSON.stringify(['Uniform/25/25/25/25', 'EM/100/0/0/0', 'Thermal/0/100/0/0', 'Kinetic/0/0/100/0', 'Explosive/0/0/0/100']), own.join(', '));
await p.evaluate(() => { const tr = [...document.querySelectorAll('.profiles tr')].find((r) => r.textContent.trim().startsWith('Uniform')); tr?.querySelector('input[type=radio]')?.click(); });
s = await waitNew(s);
// character: clone All 5 and drop to level 0 -> less dps
const d5 = s.offense.total.dps.total;
await clickText('.left .tabs button', 'Character');
await clickText('.character button', 'Clone');
await p.evaluate(() => { const sel = [...document.querySelectorAll('.character select')].find((x) => x.closest('label')?.textContent.includes('default level')); sel.value = '0'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
const chSel = await p.$('.fithead select[title=Character]');
const cid = await p.evaluate(() => [...document.querySelector('.fithead select[title=Character]').options].find((o) => o.text.includes('(copy)'))?.value);
await chSel.select(cid);
s = await waitNew(s);
check('web.e2e.custom-character: custom character (all 0) lowers dps', s.offense.total.dps.total < d5, `${d5} -> ${s.offense.total.dps.total}`);
check('web.e2e.missing-skills: missing skills reported', (s.violations ?? []).some((v) => v.code === 'MISSING_SKILL'));
// per-module spool-up (Triglavian disintegrator)
await p.goto(withQuery(`eft=${encodeURIComponent('[Vedmak, E2E Vedmak]\n\nHeavy Entropic Disintegrator II, Baryon Exotic Plasma M\n')}`), { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__lastStats?.ship?.name === 'Vedmak', { timeout: 120000 });
s = await stats();
const sp1 = s.offense?.total?.weapon_dps;
await p.select('select.spool', '0');
s = await waitNew(s);
check('web.e2e.per-module-spool: per-module spool 0% lowers disintegrator dps', s.offense?.total?.weapon_dps < sp1, `${sp1} -> ${s.offense?.total?.weapon_dps}`);

// ESI JSON re-import (new fit)
await clickText('.center .tabs button', 'Import-export');
const prevEsiFit = await p.evaluate(() => window.__lastStatsFit);
await setText(esi);
await clickText('.import-export button', 'Import');
await p.waitForFunction((prev) => window.__lastStatsFit !== prev && window.__lastStats?.ship?.name === 'Vexor', { timeout: 30000 }, prevEsiFit).catch(() => null);
const imp = await p.evaluate(() => {
  const msg = document.querySelector('.import-export p.muted')?.textContent ?? '';
  return { open: !!document.querySelector('.import-export'), msg, kind: msg.match(/\((JSON|XML|EFT)\)$/)?.[1] ?? '', ship: window.__lastStats?.ship?.name, mods: window.__lastStats?.modules?.length, fit: window.__lastStatsFit, requestShip: window.__lastRequest?.ship?.type_id };
});
// ESI fitting JSON carries no mutation data: like Pyfa, the import drops the abyssal web (15 -> 14 modules)
check('web.e2e.esi-json-reimport: ESI JSON re-import', imp.open && imp.kind === 'JSON' && imp.ship === 'Vexor' && imp.mods === 14, `${imp.msg}; ${imp.ship}, ${imp.mods} modules (type ${imp.requestShip}, fit ${imp.fit})`);

// EVE XML re-import through the Engine formats RPC -> new fit with the mutated web
if (xml) {
  await clickText('.center .tabs button', 'Import-export');
  const prevXmlFit = await p.evaluate(() => window.__lastStatsFit);
  await setText(xml);
  await clickText('.import-export button', 'Import');
  await p.waitForFunction((prev) => window.__lastStatsFit !== prev && window.__lastStats?.ship?.name === 'Vexor', { timeout: 30000 }, prevXmlFit).catch(() => null);
  const xi = await p.evaluate(() => {
    const msg = document.querySelector('.import-export p.muted')?.textContent ?? '';
    return { open: !!document.querySelector('.import-export'), msg, kind: msg.match(/\((JSON|XML|EFT)\)$/)?.[1] ?? '', ship: window.__lastStats?.ship?.name, mods: window.__lastStats?.modules?.length, abyssal: document.body.textContent.includes('Abyssal Stasis Webifier'), fit: window.__lastStatsFit, requestShip: window.__lastRequest?.ship?.type_id };
  });
  check('web.e2e.xml-reimport: EVE XML re-import keeps the mutated module', xi.open && xi.kind === 'XML' && xi.ship === 'Vexor' && xi.mods === 15 && xi.abyssal, `${xi.msg}; ${xi.ship}, ${xi.mods} modules; abyssal ${xi.abyssal} (type ${xi.requestShip}, fit ${xi.fit})`);
} else check('web.e2e.xml-reimport: EVE XML re-import keeps the mutated module', false, 'no XML export');

// multi-fit EFT paste + fit browser grouping
await clickText('.center .tabs button', 'Import-export');
await p.evaluate((t) => { const ta = document.querySelector('textarea.eft'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, t); ta.dispatchEvent(new Event('input', { bubbles: true })); }, '[Rifter, Multi A]\n200mm AutoCannon II\n\n[Merlin, Multi B]\nLight Neutron Blaster II\n');
await clickText('.import-export button', 'Import');
await new Promise((r) => setTimeout(r, 800));
await clickText('.left .tabs button', 'Fits');
const fb = await p.evaluate(() => ({ groups: [...document.querySelectorAll('.fitbrowser summary')].map((x) => x.textContent), names: [...document.querySelectorAll('.fitbrowser li')].map((x) => x.textContent) }));
check('web.e2e.multi-fit-eft-import: multi-fit EFT import + fit browser groups', fb.names.some((n) => n.includes('Multi A')) && fb.names.some((n) => n.includes('Multi B')) && fb.groups.some((g) => g.startsWith('Frigate')), fb.groups.join(', '));
await p.type('.fitbrowser .search', 'Merlin');
const fbn = await p.evaluate(() => document.querySelectorAll('.fitbrowser li').length);
check('web.e2e.fit-browser-search: fit browser search', fbn === 1, fbn);

// Prices use the Engine price block; "update prices" injects the deployed latest
// EXFA-Data snapshot (prices_load); "my prices" are local price_overrides (self-made = 0), kept in localStorage
const PRICING = true;
if (PRICING) {
  const pr = await p.waitForFunction(() => window.__lastStats?.price && window.__lastStats, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);
  const ui = await p.evaluate(() => ({ total: document.querySelector('.pricetotal')?.textContent ?? '', prov: document.querySelector('.price-prov')?.dataset.source ?? '' }));
  check('web.e2e.engine-price-block: fit price from the engine price block (embedded Jita snapshot) with provenance', pr && pr.price.total_isk > 0 && /ISK$/.test(ui.total) && pr.provenance?.price_source === 'snapshot' && pr.provenance?.price_snapshot_id && ui.prov === 'snapshot',
    pr ? `${ui.total}; ${pr.provenance?.price_source} ${pr.provenance?.price_snapshot_id}; sources ${JSON.stringify(pr.price.sources)}` : 'no price block');
  const embeddedId = pr?.provenance?.price_snapshot_id;
  await p.click('.price-update');
  const up = await p.waitForFunction(() => (window.__lastStats?.provenance?.price_source === 'file' && window.__lastStats) || (document.querySelector('.price-snapshot .error')?.textContent), { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => 'timeout');
  check('web.e2e.price-update-snapshot: "update prices" injects the latest EXFA-Data snapshot into the engine', up?.price?.sources?.injected > 0 && up.provenance.price_snapshot_id && await p.evaluate(() => document.querySelector('.price-snapshot')?.dataset.state === 'loaded'),
    typeof up === 'string' ? up : `${embeddedId} -> ${up.provenance.price_snapshot_id} (${up.provenance.snapshot_time}); sources ${JSON.stringify(up.price.sources)}`);
  const before = up?.price?.total_isk;
  await p.evaluate(() => { document.querySelector('.price-items').open = true; });
  const tid = await p.evaluate(() => { const r = [...document.querySelectorAll('.price-items tr[data-type]')].find((x) => x.querySelector('.self-made') && x.dataset.source !== 'snapshot'); r?.querySelector('.self-made').click(); return r ? +r.dataset.type : null; });
  const mine = await p.waitForFunction((t) => window.__lastStats?.price && Object.values(window.__lastStats.price.sections).flatMap((x) => x.items).some((l) => l.type_id === t && l.source.startsWith('override') && l.unit_isk === 0) && window.__lastStats, { timeout: 30000 }, tid).then((h) => h.jsonValue()).catch(() => null);
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('eve-fit-web-my-prices') ?? 'null'));
  check('web.e2e.my-prices-self-made: a "my price" (self-produced = 0) is sent as price_override and stored locally', mine && mine.price.total_isk < before && stored?.mine?.some((o) => o.type_id === tid && o.price === 0) && stored.update === true,
    mine ? `type ${tid}: ${before} -> ${mine.price.total_isk}; stored ${JSON.stringify(stored)}` : `type ${tid}: no override line`);
  // my prices editor: a category multiplier (category 6 = ships) via the add row, then remove both entries
  await p.evaluate(() => { document.querySelector('.my-prices').open = true; });
  await p.select('.my-prices .mp-target', 'category_id');
  await p.type('.my-prices .mp-id', '6');
  await p.select('.my-prices .mp-mode', 'multiplier');
  await p.evaluate(() => { const i = document.querySelector('.my-prices .mp-value'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '2'); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('.my-prices .mp-add');
  const mult = await p.waitForFunction(() => window.__lastStats?.price?.sections?.ship?.items?.[0]?.source?.startsWith('override') && window.__lastStats.price.sections.ship.items[0], { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => null);
  check('web.e2e.my-prices-editor: a category multiplier from the "my prices" editor scales the ship price', mult && mult.multiplier === 2 && mult.layer === 'request', mult ? JSON.stringify(mult) : 'no override on the ship');
  for (let i = 0; i < 5 && await p.$('.my-prices .mine-delete'); i++) { await p.click('.my-prices .mine-delete'); await new Promise((r) => setTimeout(r, 100)); }
  await p.click('.price-update');
  const back = await p.waitForFunction(() => window.__lastStats?.provenance?.price_source === 'snapshot' && !Object.keys(window.__lastStats.price.sources).some((s) => s.startsWith('override')) && window.__lastStats, { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => null);
  check('web.e2e.price-reset: clearing my prices and "update prices" returns to the embedded snapshot', back && back.provenance.price_snapshot_id === embeddedId, back ? JSON.stringify(back.price.sources) : 'not reset');
}

// fighters: abilities
await p.goto(withQuery(`eft=${encodeURIComponent(CARRIER)}`), { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__lastStats?.ship?.name === 'Thanatos', { timeout: 120000 });
s = await stats();
const f0 = s.offense?.total?.fighter_dps ?? s.offense?.total?.drone_dps;
check('web.e2e.fighter-dps: fighter dps', f0 > 0, f0);
const ab = await p.evaluate(() => [...document.querySelectorAll('.subopts label')].filter((l) => l.querySelector('input.ability')).map((l) => l.textContent.trim() + (l.querySelector('input').checked ? '*' : '')));
check('web.e2e.fighter-abilities: fighter abilities listed', ab.length >= 4, ab.join(', '));
await p.evaluate(() => { const l = [...document.querySelectorAll('.subopts label')].find((x) => x.querySelector('input.ability')?.checked && x.textContent.includes('Attack')); l.querySelector('input').click(); });
s = await waitNew(s);
const f1 = s.offense?.total?.fighter_dps ?? s.offense?.total?.drone_dps;
check('web.e2e.fighter-ability-toggle: disabling an attack ability lowers fighter dps', f1 < f0, `${f0} -> ${f1}`);
// --- milestone 3: market compare, multi-fit graphs, target fit, ECM burst graph (library now holds several fits) ---
const RIFTER = '[Rifter, E2E Rifter]\nGyrostabilizer II\n\n1MN Afterburner II\n\n200mm AutoCannon II, EMP S\n200mm AutoCannon II, EMP S\n';
await p.goto(withQuery(`eft=${encodeURIComponent(RIFTER)}`), { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__lastStats?.ship?.name === 'Rifter', { timeout: 120000 });
s = await stats();
const rd0 = s.offense?.total?.dps?.total;
await clickText('aside.left .tabs button', 'Market');
await clickText('.center .tabs button', 'Compare strip');
await clickText('.operation-mode button', 'Smart');
await p.click('.market .search');
await p.keyboard.press('w');
const modeWhileTyping = await p.$eval('.operation-mode button[aria-pressed="true"]', (el) => el.textContent.trim());
check('web.e2e.market-hotkey-typing: operation hotkeys do not change mode while typing', modeWhileTyping.startsWith('Smart'), modeWhileTyping);
await p.keyboard.press('Control+a');
await p.keyboard.press('Backspace');
await p.click('.operation-mode button[aria-pressed="true"]');
await p.keyboard.press('w');
const hotkeyMode = await p.$eval('.operation-mode button[aria-pressed="true"]', (el) => el.textContent.trim());
check('web.e2e.market-hotkey: W selects Replace outside a text field', hotkeyMode.startsWith('Replace'), hotkeyMode);
await clickText('.operation-mode button', 'Smart');
const marketSearch = async (name) => {
  await p.click('.market .search');
  await p.keyboard.down('Control'); await p.keyboard.press('a'); await p.keyboard.up('Control');
  await p.keyboard.press('Backspace');
  await p.type('.market .search', name);
  await p.waitForFunction((n) => [...document.querySelectorAll('.trow .tname')].some((e) => e.textContent.trim() === n), { timeout: 30000 }, name);
  return p.evaluate((n) => Number([...document.querySelectorAll('.trow')].find((row) => row.querySelector('.tname')?.textContent.trim() === n)?.dataset.tid), name);
};
const selectModule = async (name) => p.evaluate((n) => {
  const row = [...document.querySelectorAll('.fit-area .mod[data-idx]')].find((el) => el.querySelector('.mname')?.textContent.includes(n));
  row?.click();
  return !!row;
}, name);
const fitModuleNames = async () => p.$$eval('.fit-area .mod[data-idx] .mname', (els) => els.map((el) => el.textContent.trim()));
const autoCannonRow = await p.evaluate(() => [...document.querySelectorAll('.fit-area .mod[data-idx]')]
  .find((el) => el.querySelector('.mname')?.textContent.includes('200mm AutoCannon II'))?.dataset.idx);
const needsGroup = await p.evaluate((idx) => !document.querySelector(`.fit-area .mod[data-idx="${idx}"] .gcount`), autoCannonRow);
if (needsGroup) {
  await p.click(`.fit-area .mod[data-idx="${autoCannonRow}"]`, { button: 'right' });
  await p.waitForSelector('.ctxmenu button');
  await clickText('.ctxmenu button', 'Group identical modules');
}
await selectModule('200mm AutoCannon II');
const selectedGun = await p.$eval('.fit-area .mod.selected .mname', (el) => el.textContent.trim()).catch(() => '');
check('web.e2e.market-select-module: selecting a fitted gun highlights it', selectedGun.includes('200mm AutoCannon II'), selectedGun);
const originalGunRows = await fitModuleNames();
const originalModuleCount = await p.evaluate(() => window.__lastRequest?.modules?.length ?? 0);
const gatlingId = await marketSearch('125mm Gatling AutoCannon II');
await p.click(`.market .trow[data-tid="${gatlingId}"]`);
await p.waitForFunction(() => document.querySelector('.market .trow.candidate') && document.querySelector('.strip-candidate'));
const previewGunRows = await fitModuleNames();
check('web.e2e.market-smart-preview: single-click pins the candidate without changing the fit',
  previewGunRows.join('|') === originalGunRows.join('|') && await p.evaluate((n) => window.__lastRequest?.modules?.length === n, originalModuleCount)
    && Math.abs((await stats()).offense?.total?.dps?.total - rd0) < 1e-6
    && await p.$eval('.market .trow.candidate', (el) => !!el) && await p.$eval('.strip-candidate', (el) => !!el),
  `${previewGunRows.join(' | ')}; DPS ${(await stats()).offense?.total?.dps?.total}`);
await p.click(`.market .trow[data-tid="${gatlingId}"]`, { clickCount: 2 });
s = await waitNew(s);
const replacedGunRows = await fitModuleNames();
const replaceToast = await p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((el) => /Replaced ×\d+ 200mm AutoCannon II → 125mm Gatling AutoCannon II/.test(el.textContent)), { timeout: 10000 })
  .then(() => p.$$eval('.toast', (els) => els.map((el) => el.textContent).find((text) => text.includes('125mm Gatling AutoCannon II')) ?? ''));
check('web.e2e.market-smart-replace: double-click replaces the selected gun group and offers Undo',
  replacedGunRows.some((name) => name.includes('×2') && name.includes('125mm Gatling AutoCannon II'))
    && replaceToast.includes('Replaced ×2') && replaceToast.includes('Undo'),
  `${replacedGunRows.join(' | ')}; ${replaceToast}`);
await p.evaluate(() => document.activeElement?.blur());
await p.keyboard.press('Control+z');
s = await waitNew(s);
check('web.e2e.market-ctrl-z: Ctrl+Z restores the replaced guns',
  Math.abs(s.offense?.total?.dps?.total - rd0) < 1e-6 && (await fitModuleNames()).join('|') === originalGunRows.join('|'),
  `${s.offense?.total?.dps?.total}; ${(await fitModuleNames()).join(' | ')}`);
await p.keyboard.press('Control+y');
s = await waitNew(s);
check('web.e2e.market-ctrl-y: Ctrl+Y redoes the market replacement',
  Math.abs(s.offense?.total?.dps?.total - rd0) > 1e-6 && (await fitModuleNames()).some((name) => name.includes('125mm Gatling AutoCannon II')),
  `${s.offense?.total?.dps?.total}; ${(await fitModuleNames()).join(' | ')}`);
await clickText('.toast button:not(.toast-dismiss)', 'Undo');
s = await waitNew(s);
check('web.e2e.market-toast-undo: the replacement toast action restores the previous fit',
  Math.abs(s.offense?.total?.dps?.total - rd0) < 1e-6 && (await fitModuleNames()).join('|') === originalGunRows.join('|'),
  `${s.offense?.total?.dps?.total}; ${(await fitModuleNames()).join(' | ')}`);

await clickText('.operation-mode button', 'Add');
const beforeAddCount = await p.evaluate(() => window.__lastRequest?.modules?.length ?? 0);
await p.click(`.market .trow[data-tid="${gatlingId}"]`);
await p.click(`.market .trow[data-tid="${gatlingId}"]`, { clickCount: 2 });
s = await waitNew(s);
const afterAddCount = await p.evaluate(() => window.__lastRequest?.modules?.length ?? 0);
check('web.e2e.market-add: Add mode adds instead of replacing', afterAddCount === beforeAddCount + 1
  && (await fitModuleNames()).some((name) => name.includes('200mm AutoCannon II'))
  && (await fitModuleNames()).some((name) => name.includes('125mm Gatling AutoCannon II')), `${beforeAddCount} -> ${afterAddCount}`);
await p.evaluate(() => document.activeElement?.blur());
await p.keyboard.press('Control+z');
s = await waitNew(s);

const beforeCompareApplyCount = await p.evaluate(() => window.__lastRequest?.modules?.length ?? 0);
await p.click(`.market .trow[data-tid="${gatlingId}"]`);
await p.waitForSelector('.strip-candidate button:not(:disabled)', { timeout: 30000 });
await p.click('.strip-candidate button');
s = await waitNew(s);
const afterCompareApplyCount = await p.evaluate(() => window.__lastRequest?.modules?.length ?? 0);
check('web.e2e.market-compare-apply: compare Apply uses Smart semantics even while Add mode is active',
  afterCompareApplyCount === beforeCompareApplyCount && (await fitModuleNames()).some((name) => name.includes('×2') && name.includes('125mm Gatling AutoCannon II')),
  `${beforeCompareApplyCount} -> ${afterCompareApplyCount}; ${(await fitModuleNames()).join(' | ')}`);
await p.evaluate(() => document.activeElement?.blur());
await p.keyboard.press('Control+z');
s = await waitNew(s);

await clickText('.operation-mode button', 'Replace');
await p.keyboard.press('Escape');
const beforeInvalidReplace = JSON.stringify(await stats());
await p.click(`.market .trow[data-tid="${gatlingId}"]`, { clickCount: 2 });
const noSelectionToast = await p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((el) => el.textContent.includes('Select a same-slot module first.')), { timeout: 10000 })
  .then(() => p.$$eval('.toast', (els) => els.map((el) => el.textContent).find((text) => text.includes('Select a same-slot module first.')) ?? ''));
check('web.e2e.market-replace-without-selection: warns and leaves the fit unchanged',
  JSON.stringify(await stats()) === beforeInvalidReplace && noSelectionToast.includes('Select a same-slot module first.'),
  `${noSelectionToast}; ${JSON.stringify(await stats()) === beforeInvalidReplace}`);

await selectModule('200mm AutoCannon II');
const artilleryId = await marketSearch('650mm Artillery Cannon II');
await p.click(`.market .trow[data-tid="${artilleryId}"]`);
await p.waitForFunction(() => document.querySelector('.strip-candidate.strip-bad .strip-tooltip'));
await p.hover('.strip-candidate');
const violationTooltip = await p.$eval('.strip-candidate .strip-tooltip', (el) => el.textContent.trim());
check('web.e2e.market-overflow-warning: an overpowered same-slot candidate has a red frame and reason',
  await p.$eval('.strip-candidate', (el) => el.classList.contains('strip-bad')) && /Powergrid overloaded/.test(violationTooltip),
  violationTooltip);
// compare: the active Rifter against the other frigates in the library (Multi A Rifter, Multi B Merlin)
await clickText('.center .tabs button', 'Fit compare');
await p.waitForSelector('.compare');
await p.evaluate(() => { for (const n of ['Multi A', 'Multi B']) { const c = document.querySelector(`.compare input.cmp-fit[data-fit="${n}"]`); if (c && !c.checked) c.click(); } });
const cmp = await p.waitForFunction(() => window.__lastCompare?.fits?.length >= 3 && window.__lastCompare, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);
const dpsRow = cmp?.rows.find((r) => r.key === 'dps');
check('web.e2e.compare-batch: the compare window computes all fits in one Engine batch call', cmp?.via === 'batch' && await p.evaluate((v) => document.querySelector('.cmp-via')?.dataset.via === v, cmp?.via), cmp?.via);
check('web.e2e.compare-fits: compare table of 3 fits with best values marked', cmp && cmp.fits[0] === 'E2E Rifter' && dpsRow && dpsRow.values.length === cmp.fits.length && Math.abs(dpsRow.values[0] - rd0) < 1e-6 && cmp.rows.some((r) => r.best.length) && await p.evaluate(() => document.querySelectorAll('.cmp-table td.best').length > 0), cmp ? `${cmp.fits.join(' | ')}; ${cmp.rows.length} metrics` : 'no result');
// graphs: overlay Multi A on the dps graph, then Multi B as the target fit, then the ECM burst graph
await clickText('.center .tabs button', 'Graphs');
await p.waitForSelector('.graphs select.graph-kind');
await p.select('.graphs select.graph-kind', 'dps');
await p.evaluate(() => { document.querySelector('.graph-overlay').open = true; document.querySelector('.graph-overlay input[data-fit="Multi A"]').click(); });
const og = await p.waitForFunction(() => window.__lastGraph?.fits?.length === 2 && window.__lastGraph.series?.some((x) => x.name.startsWith('Multi A:')) && window.__lastGraph, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);
const nLines = await p.evaluate(() => document.querySelectorAll('svg.chart polyline').length);
check('web.e2e.graph-overlay: dps graph overlays a second fit', og && og.source === 'engine' && nLines >= 2, og ? `${og.source}: ${og.series.map((x) => x.name).join(', ')}` : 'no overlay');
if (GRAPH_RPC) {
  const mb = await p.evaluate(() => [...document.querySelector('.graphs select.graph-target').options].find((o) => o.text === 'Multi B')?.value);
  await p.select('.graphs select.graph-target', mb);
  const tg = await p.waitForFunction(() => window.__lastGraph?.target_fit === 'Multi B' && window.__lastGraph, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);
  check('web.e2e.graph-target-fit: damage graph against a target fit (engine)', tg && tg.source === 'engine' && tg.series.length >= 2, tg ? tg.series.map((x) => `${x.name}:${x.n}`).join(' ') : 'none');
  await p.select('.graphs select.graph-target', '');
  await p.evaluate(() => document.querySelector('.graph-overlay input[data-fit="Multi A"]').click());
  await p.select('.graphs select.graph-kind', 'ecm');
  const eg = await p.waitForFunction(() => window.__lastGraph?.kind === 'ecm' && window.__lastGraph.source === 'engine' && window.__lastGraph.fits?.length === 1 && window.__lastGraph, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);
  // enemy lock time at scan res 10 mm on the Rifter's signature (no damps): min(40000 / 10 / asinh(sig)^2, 1800)
  const sigR = s.navigation?.signature_radius, want = Math.min(40000 / 10 / Math.asinh(sigR) ** 2, 1800), got = eg?.series?.find((x) => x.name.startsWith('enemy lock time'))?.first;
  check('web.e2e.graph-ecm-burst: ECM burst graph (engine) matches the lock-time formula', got && Math.abs(got[1] - want) <= 1e-6 * want, `${got?.[1]} vs ${want}`);
  await p.select('.graphs select.ecm-y', 'damage');
  const ed = await p.waitForFunction(() => window.__lastGraph?.kind === 'ecm' && window.__lastGraph.series?.some((x) => x.name.startsWith('damage dealt')) && window.__lastGraph, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);
  check('web.e2e.graph-ecm-damage: ECM burst graph, damage dealt before dying', ed && ed.series[0].n > 10, ed ? `${ed.series[0].n} points` : 'none');
}
// About is an anchored popover from the brand.
await clickText('.brand', 'EXFA');
const ab2 = await p.evaluate(() => ({ status: document.querySelector('.about-status')?.textContent ?? '',
  eng: document.querySelector('.about-engine')?.textContent ?? '', data: document.querySelector('.about-dataset')?.textContent ?? '',
  timings: document.querySelector('.about-timings')?.textContent ?? '', links: document.querySelectorAll('.about a').length }));
check('web.e2e.about-page: About popover shows engine, dataset, startup timings and repository links',
  ab2.status.includes('exfa-engine 0.2.0') && /\bSDE \d+\b/.test(ab2.eng) && /\bSDE \d+\b/.test(ab2.data) && ab2.timings.includes('Dataset') && ab2.timings.includes('First calc') && ab2.links >= 6,
  JSON.stringify(ab2));
// Full zh-CN UI: tabs, stats sections, slot headers and import/export controls have no untranslated labels.
await langSel('zh');
await new Promise((r) => setTimeout(r, 300));
const zhUi = await p.evaluate(() => ({ tabs: [...document.querySelectorAll('.tabs button')].map((x) => x.textContent.replace(/\s*\(\d+\)$/, '')),
  dockTabs: [...document.querySelectorAll('.dock-head .tabs button')].map((x) => x.textContent.trim()),
  sections: [...document.querySelectorAll('.stats .section h3')].map((x) => x.firstChild?.textContent ?? ''), slots: [...document.querySelectorAll('.slotgroup h4')].map((x) => x.firstChild?.textContent ?? '') }));
await clickText('.center .tabs button', '导入 / 导出');
const zhIo = await p.evaluate(() => [...document.querySelectorAll('.import-export button')].map((x) => x.textContent));
await langSel('en');
const latin = (xs) => xs.filter((x) => /[a-z]{3,}/.test(x.replace(/DPS|EFT|DNA|ESI|JSON|XML|Ctrl/g, '')));
const zhAll = [...zhUi.tabs, ...zhUi.sections, ...zhUi.slots, ...zhIo];
check('web.e2e.zh-ui: zh-CN UI (dock tabs, stats sections, slots, import/export controls) has no untranslated labels',
  zhUi.tabs.includes('对比栏') && zhUi.tabs.includes('配置对比') && zhUi.sections.length > 3 && zhIo.includes('导入') && latin(zhAll).length === 0,
  latin(zhAll).join(' | ') || `${zhAll.length} labels`);
check('web.e2e.whatif-tab-removed: the four-tab dock uses the compare strip instead of What-if',
  zhUi.dockTabs.length === 4 && zhUi.dockTabs.some((x) => x.startsWith('对比栏')) && !zhUi.dockTabs.some((x) => x.includes('假设分析')),
  zhUi.dockTabs.join(' | '));
// ---- fit library (IndexedDB): Pyfa saved-fits database import, folders / tags, rename, duplicate, delete, exports,
// backup / restore, persistence across reloads, DNA import, migration of the localStorage library ----
{
const FIX = new URL('../src/test/fixtures/', import.meta.url).pathname;
const pyfaStats = JSON.parse(fs.readFileSync(FIX + 'pyfa-saveddata.stats.json', 'utf8'));
const libFits = () => p.evaluate(() => [...document.querySelectorAll('.lib-fit')].map((l) => ({ id: l.dataset.fitId, name: l.dataset.fitName, folder: l.closest('details')?.dataset.folder ?? null, tags: [...l.querySelectorAll('.tag')].map((x) => x.textContent) })));
// name, or { id } (names are not unique: the XML re-import below adds a second "Pyfa Vexor")
const openFit = async (name, ship) => {
  const sel = typeof name === 'string' ? `.lib-fit[data-fit-name="${name}"]` : `.lib-fit[data-fit-id="${name.id}"]`;
  const id = await p.evaluate((s) => { const el = document.querySelector(s); el?.click(); return el?.dataset.fitId; }, sel);
  return p.waitForFunction((sh, fid) => window.__lastStatsFit === fid && window.__lastStats?.ship?.name === sh && !window.__lastStats.error && window.__lastStats, { timeout: 60000 }, ship, id).then((h) => h.jsonValue()).catch(() => null);
};
await clickText('.left .tabs button', 'Fits');
await p.evaluate(() => { const i = document.querySelector('.fitbrowser .search'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); });
const st0 = await p.evaluate(() => ({ kind: document.querySelector('.lib-status')?.dataset.kind, fits: document.querySelectorAll('.lib-fit').length }));
await (await p.$('.lib-import-file')).uploadFile(FIX + 'pyfa-saveddata.db');
const pi = await p.waitForFunction(() => window.__lastLibraryImport, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);
await p.select('.lib-mode', 'folder');
let lf = await libFits();
const pyfaNames = Object.keys(pyfaStats);
const pyfaVexorId = lf.find((f) => f.name === 'Pyfa Vexor')?.id;
check('web.e2e.pyfa-db-import: Pyfa saveddata.db import (sql.js): every fit, character, profiles, implant set, into folder "Pyfa import"',
  pi && pi.kind === 'Pyfa database' && pyfaNames.every((n) => lf.some((f) => f.name === n && f.folder === 'Pyfa import')) && pi.characters === 1 && pi.damagePatterns === 1 && pi.targetProfiles === 1 && pi.implantSets === 1 && pi.warnings.length === 0,
  pi ? `${pi.fits.join(', ')}; warnings ${pi.warnings.length}` : 'no import');
// Pyfa's own numbers for the same database (pyfa_stats.py): its dps is against the fit's target profile
const cmp = [];
for (const n of pyfaNames) {
  const st = await openFit(n, n.split(' ')[1]);
  const want = pyfaStats[n];
  const got = st && { dps: st.offense?.vs_target_profile?.dps ?? st.offense?.total?.dps?.total, ehp: st.defense?.ehp?.total, max_velocity: st.navigation?.max_velocity, cpu_used: st.resources?.cpu?.used };
  const ok = got && ['dps', 'ehp', 'max_velocity', 'cpu_used'].every((k) => Math.abs(got[k] - want[k]) <= 1e-6 * Math.max(1, Math.abs(want[k])));
  cmp.push({ n, ok, got, want });
}
check('web.e2e.pyfa-db-stats: Pyfa database fits compute Pyfa\'s numbers (dps vs target profile, EHP vs damage pattern, speed with a projected web, CPU)',
  cmp.every((c) => c.ok), cmp.map((c) => `${c.n}: ${c.got ? c.got.dps.toFixed(2) : '—'}/${c.want.dps.toFixed(2)} dps${c.ok ? '' : ' ✗'}`).join('; '));
await openFit('Pyfa Vexor', 'Vexor');
const links = await p.evaluate(() => ({ tab: [...document.querySelectorAll('.center .tabs button')].map((b) => b.textContent).find((x) => x.includes('(')) ?? '', char: document.querySelector('.fithead select[title=Character]')?.selectedOptions[0]?.textContent }));
check('web.e2e.pyfa-db-links: projected fit and fleet booster fit links, saved character', links.tab.includes('(2)') && links.char?.includes('Pyfa Pilot'), JSON.stringify(links));

// rename + move + tags (one edit), tag filter, folder rename
const rif = lf.find((f) => f.name === 'Pyfa Rifter');
await p.evaluate((id) => document.querySelector(`.lib-fit[data-fit-id="${id}"] .lib-rename`).click(), rif.id);
const setIn = (sel, v) => p.evaluate((s2, v2) => { const i = document.querySelector(s2); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, v2); i.dispatchEvent(new Event('input', { bubbles: true })); }, sel, v);
await setIn('.lib-edit-name', 'Renamed Rifter'); await setIn('.lib-edit-folder', 'PvP/Frigates'); await setIn('.lib-edit-tags', 'solo, brawler');
await p.click('.lib-edit-save');
await new Promise((r) => setTimeout(r, 300));
lf = await libFits();
const rr = lf.find((f) => f.id === rif.id);
check('web.e2e.library-rename-move-tag: rename, move to a nested folder and tag a fit', rr && rr.name === 'Renamed Rifter' && rr.folder === 'PvP/Frigates' && rr.tags.join() === 'brawler,solo', JSON.stringify(rr));
await p.evaluate(() => document.querySelector('.lib-tags button[data-tag="solo"]').click());
const tagged = (await libFits()).map((f) => f.name);
await p.evaluate(() => document.querySelector('.lib-tags button[data-tag="solo"]').click());
await p.type('.fitbrowser .search', 'pyfa thanatos');
const found = (await libFits()).map((f) => f.name);
await setIn('.fitbrowser .search', '');
check('web.e2e.library-search-tags: tag filter and search (ship name)', tagged.join() === 'Renamed Rifter' && found.join() === 'Pyfa Thanatos', `${tagged} | ${found}`);
await p.evaluate(() => document.querySelector('details.lib-folder[data-folder="PvP/Frigates"] .lib-folder-rename').click());
await p.click('details.lib-folder[data-folder="PvP/Frigates"] .inline-edit');
await setIn('details.lib-folder[data-folder="PvP/Frigates"] input.inline-edit-input', 'PvP/Small');
await p.keyboard.press('Enter');
await p.waitForFunction((id) => [...document.querySelectorAll('.lib-fit')].some((x) => x.dataset.fitId === id && x.closest('details')?.dataset.folder === 'PvP/Small'), { timeout: 10000 }, rif.id);
lf = await libFits();
check('web.e2e.library-folder-rename: renaming a folder moves its fits', lf.find((f) => f.id === rif.id)?.folder === 'PvP/Small', lf.find((f) => f.id === rif.id)?.folder);

// duplicate + delete
const nBefore = lf.length;
await p.evaluate((id) => document.querySelector(`.lib-fit[data-fit-id="${id}"] .lib-dup`).click(), rif.id);
await new Promise((r) => setTimeout(r, 300));
lf = await libFits();
const dup = lf.find((f) => f.name === 'Renamed Rifter (copy)');
const dupOk = lf.length === nBefore + 1 && dup && dup.folder === 'PvP/Small' && dup.tags.join() === 'brawler,solo';
await p.evaluate((id) => document.querySelector(`.lib-fit[data-fit-id="${id}"] .lib-del`).click(), dup?.id);
await p.waitForSelector('.toast button:not(.toast-dismiss)', { timeout: 10000 });
const immediatelyDeleted = await p.waitForFunction((id) => ![...document.querySelectorAll('.lib-fit')].some((x) => x.dataset.fitId === id), { timeout: 10000 }, dup?.id).then(() => true).catch(() => false);
const deleteToast = await p.$$eval('.toast', (els, name) => els.map((el) => el.textContent ?? '').find((text) => text.includes(`Deleted “${name}”`)) ?? '', dup?.name);
const namedDeleteNotice = deleteToast.includes(`Deleted “${dup?.name}”`);
await p.click('.toast button:not(.toast-dismiss)');
const restored = await p.waitForFunction((id) => [...document.querySelectorAll('.lib-fit')].some((x) => x.dataset.fitId === id), { timeout: 10000 }, dup?.id).then(() => true).catch(() => false);
await p.evaluate((id) => document.querySelector(`.lib-fit[data-fit-id="${id}"] .lib-del`).click(), dup?.id);
await p.waitForFunction((id) => ![...document.querySelectorAll('.lib-fit')].some((x) => x.dataset.fitId === id), { timeout: 10000 }, dup?.id);
lf = await libFits();
check('web.e2e.library-duplicate-delete: duplicate keeps folder and tags; delete is immediate and Undo restores it',
  dupOk && immediatelyDeleted && namedDeleteNotice && restored && lf.length === nBefore && !lf.some((f) => f.name.endsWith('(copy)')),
  `${nBefore} -> ${lf.length}; deleted ${immediatelyDeleted}, named notice ${namedDeleteNotice}, undo ${restored}; ${deleteToast}`);

// bulk export: selected fits as one EVE XML (Pyfa backup shape) and as multi-fit EFT; XML re-import
for (const n of ['Pyfa Vexor', 'Pyfa Svipul']) await p.evaluate((nm) => document.querySelector(`.lib-fit[data-fit-name="${nm}"] .lib-sel`).click(), n);
await p.click('.lib-export-xml');
await p.waitForFunction(() => {
  const x = window.__lastLibraryExport;
  return x?.format === 'xml' && x.fits === 2 && (x.text.match(/<fitting /g) ?? []).length === 2;
}, { timeout: 30000 });
const xe = await p.evaluate(() => window.__lastLibraryExport);
await p.click('.lib-export-eft');
await p.waitForFunction(() => {
  const x = window.__lastLibraryExport;
  return x?.format === 'eft' && x.fits === 2 && (x.text.match(/^\[[^\]\n]+, [^\]\n]+\]$/gm) ?? []).length === 2;
}, { timeout: 30000 });
const ee = await p.evaluate(() => window.__lastLibraryExport);
const xmlFile = path.join(os.tmpdir(), `e2e-library-${process.pid}.xml`);
fs.writeFileSync(xmlFile, xe?.text ?? '');
await p.select('.lib-import-folder', 'Pyfa import');
await (await p.$('.lib-import-file')).uploadFile(xmlFile);
await p.waitForFunction(() => /e2e-library-.*XML, 2 /.test(document.querySelector('.lib-msg')?.textContent ?? ''), { timeout: 30000 }).catch(() => null);
await new Promise((r) => setTimeout(r, 300));
const xmsg = await p.evaluate(() => document.querySelector('.lib-msg')?.textContent ?? '');
lf = await libFits();
check('web.e2e.library-export-xml-eft: bulk export (one EVE XML with 2 fittings, multi-fit EFT) and XML re-import',
  xe?.fits === 2 && (xe.text.match(/<fitting /g) ?? []).length === 2 && /<fittings count="2">/.test(xe.text) && ee?.format === 'eft' && (ee.text.match(/^\[[^\]\n]+, [^\]\n]+\]$/gm) ?? []).length === 2 && lf.filter((f) => f.name === 'Pyfa Svipul').length === 2, xmsg);

// JSON backup -> restore (twice: no duplicates)
await p.click('.lib-backup');
const bk = await p.evaluate(() => window.__lastLibraryExport);
const bkFile = path.join(os.tmpdir(), `e2e-backup-${process.pid}.json`);
fs.writeFileSync(bkFile, bk?.text ?? '');
const nb = (await libFits()).length;
await (await p.$('.lib-import-file')).uploadFile(bkFile);
await new Promise((r) => setTimeout(r, 800));
const na = (await libFits()).length;
const bj = JSON.parse(bk?.text || '{}');
check('web.e2e.library-backup-restore: JSON backup (v2: folders, tags) restores without duplicating fits', bj.version === 2 && bj.lib?.folders?.includes('PvP/Small') && Object.keys(bj.lib.fits).length === nb && na === nb, `${nb} fits, after restore ${na}`);

// DNA import (dialog): a fit's DNA, plain and as an in-game fitting link; each gives the same
// fit back (DNA round trip, drones launched, same stats for both)
const dnaImport = async (text) => {
  await clickText('.center .tabs button', 'Import-export');
  await setText(text);
  const prev = await p.evaluate(() => window.__lastStatsFit);
  await clickText('.import-export button', 'Import');
  const st = await p.waitForFunction((pf) => window.__lastStatsFit !== pf && window.__lastStats?.offense && window.__lastStats, { timeout: 60000 }, prev).then((h) => h.jsonValue()).catch(() => null);
  await clickText('.center .tabs button', 'Import-export');
  await setText('');
  await clickText('.import-export button', 'Export DNA');
  await p.waitForFunction((ship) => {
    const value = document.querySelector('textarea.eft')?.value ?? '';
    return value.startsWith(`${ship}:`) && value.endsWith('::');
  }, { timeout: 30000 }, st?.ship?.type_id ?? -1).catch(() => null);
  const back = await p.evaluate(() => document.querySelector('textarea.eft').value);
  return { st, back };
};
await clickText('.left .tabs button', 'Fits');
const rs = await openFit('Renamed Rifter', 'Rifter');
await clickText('.center .tabs button', 'Import-export');
await clickText('.import-export button', 'Export DNA');
await p.waitForFunction(() => {
  const value = document.querySelector('textarea.eft')?.value ?? '';
  return /^\d+:/.test(value) && value.endsWith('::');
}, { timeout: 30000 });
const rdna = await p.evaluate(() => document.querySelector('textarea.eft').value);
const d1 = await dnaImport(rdna);
const d2 = await dnaImport(`<url=fitting:${rdna}>DNA link Rifter</url>`);
const dOk = (d) => d.st && d.st.ship?.name === 'Rifter' && d.back === rdna && d.st.offense.total.drone_dps > 0 && d.st.modules?.length === rs?.modules?.length && /(^|:)21898;/.test(rdna);
check('web.e2e.dna-import: DNA import (plain and fitting link) round trip: same DNA back, ship, modules, charges, drones launched',
  dOk(d1) && dOk(d2) && Math.abs(d1.st.offense.total.dps.total - d2.st.offense.total.dps.total) < 1e-9,
  `${rdna}: ${d1.st?.modules?.length}/${rs?.modules?.length} modules, dna ${d1.back === dna ? '=' : '≠'} / ${d2.back === dna ? '=' : '≠'}, dps ${d1.st?.offense?.total?.dps?.total} / ${d2.st?.offense?.total?.dps?.total}`);

// persistence: flush the IndexedDB writes, reload, the library is still there (names, folders, tags, links)
await clickText('.left .tabs button', 'Fits');
const before = (await libFits()).map((f) => `${f.name}|${f.folder}|${f.tags}`).sort();
await p.evaluate(() => window.__eveStore.flush());
// same page without ?eft= (that would import the e2e Vexor again)
await p.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__lastStats?.offense, { timeout: 120000 });
await clickText('.left .tabs button', 'Fits');
await p.select('.lib-mode', 'folder');
const after = (await libFits()).map((f) => `${f.name}|${f.folder}|${f.tags}`).sort();
const kind = await p.evaluate(() => document.querySelector('.lib-status')?.dataset.kind);
const vx = await openFit({ id: pyfaVexorId }, 'Vexor');
check('web.e2e.library-reload-persistence: fits, folders and tags survive a reload (IndexedDB)', st0.kind === 'indexeddb' && kind === 'indexeddb' && after.length === before.length && after.join('\n') === before.join('\n') && after.some((x) => x.startsWith('Renamed Rifter|PvP/Small|brawler,solo')) && Math.abs(vx?.navigation?.max_velocity - pyfaStats['Pyfa Vexor'].max_velocity) < 1e-6,
  `${kind}: ${before.length} -> ${after.length} fits, Vexor ${vx ? vx.navigation?.max_velocity : "no stats"}; ${before.filter((x) => !after.includes(x)).join(' / ')} => ${after.filter((x) => !before.includes(x)).join(' / ')}`);

// migration: a fresh profile holding only the localStorage library of earlier versions
{
  const ctx = await b.createBrowserContext();
  const q = await ctx.newPage();
  q.on('pageerror', (e) => errors.push(`migration page: ${e.message}`));
  const legacy = { lib: { fits: { legacy1: { id: 'legacy1', name: 'Legacy Rifter', ship_type_id: 587, mode_type_id: null, modules: [], drones: [], fighters: [], implants: [], boosters: [], cargo: [], projected: [], fleet: { booster_fit_ids: [], buffs: [] }, environment: [], system_security: null, character_id: 'all5', damage_pattern_id: 'uniform', target_profile_id: 'none', options: { factor_reload: false, spool: 1, rah: 'adapt' } } }, characters: {}, damagePatterns: {}, targetProfiles: {} }, settings: { activeFitId: 'legacy1', lang: 'en' } };
  await q.evaluateOnNewDocument((v) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('eve-fit-web:v1', v); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(legacy));
  await q.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
  await q.waitForFunction(() => window.__lastStats?.ship?.name === 'Rifter', { timeout: 120000 }).catch(() => null);
  await q.evaluate(() => window.__eveStore.flush());
  const m = await q.evaluate(() => ({ status: window.__eveStore?.status, ls: localStorage.getItem('eve-fit-web:v1'), backup: !!localStorage.getItem('eve-fit-web:v1:migrated') }));
  await q.reload({ waitUntil: 'networkidle0' });
  await q.waitForFunction(() => window.__lastStats?.ship?.name === 'Rifter', { timeout: 120000 }).catch(() => null);
  const m2 = await q.evaluate(() => window.__eveStore?.status);
  check('web.e2e.library-migration: the localStorage library of earlier versions moves to IndexedDB (copy kept)', m.status?.migrated === 1 && m.status.kind === 'indexeddb' && !JSON.parse(m.ls ?? '{}').lib && m.backup && m2?.fits === 1 && m2.migrated === 0, JSON.stringify({ s1: m.status, s2: m2 }));
  await ctx.close();
}
}

// Stats-ext outputs from the Engine WASM RPC.
{
  const { itemChecks } = await import('./e2e-items.mjs');
  await itemChecks({ p, withQuery, check, stats, waitNew, clickText }).catch((e) => check('web.e2e.items-run: item checks ran to the end', false, e.stack?.split('\n').slice(0, 3).join(' | ')));
}

// Engine adjustments are visible, writable to the fit, and reversible from the notification.
await p.goto(withQuery(`eft=${encodeURIComponent('[Confessor, E2E mode correction]\nDamage Control II\n')}`), { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__lastStats?.ship?.name === 'Confessor' && !window.__lastStats.error, { timeout: 120000 });
const defaultModeStats = await stats();
await p.evaluate(() => {
  const mode = [...document.querySelectorAll('.fithead select')].find((select) => [...select.options].some((option) => option.textContent.includes('mode: default')));
  if (!mode) return false;
  mode.value = '';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
});
const correctionStats = await waitNew(defaultModeStats);
const modeAdjustment = correctionStats.adjustments?.find((a) => a.code === 'MODE_DEFAULTED');
const adjustmentTitle = await p.evaluate(() => document.querySelector('.adjustments li')?.title ?? '');
check('web.e2e.adjustments-feedback: Engine corrections show localized details and can be written back',
  !!modeAdjustment && adjustmentTitle.includes('/ship/mode_type_id') && adjustmentTitle.includes('From') && adjustmentTitle.includes('To'),
  JSON.stringify({ adjustments: correctionStats.adjustments, title: adjustmentTitle }));
if (modeAdjustment) {
  await p.click('.adjustments-head button');
  const written = await waitNew(correctionStats);
  await p.waitForFunction(() => [...document.querySelectorAll('.toast')].some((el) => el.textContent?.includes('Applied one correction to the fit')), { timeout: 10000 });
  const toastText = await p.$$eval('.toast', (els) => els.map((el) => el.textContent ?? '').find((text) => text.includes('Applied one correction to the fit')) ?? '');
  check('web.e2e.adjustments-writeback: write back clears the correction and offers Undo',
    !(written.adjustments?.length) && /Applied one correction to the fit/.test(toastText) && /Undo/.test(toastText),
    `${JSON.stringify(written.adjustments)}; ${toastText}`);
  await p.click('.toast button:not(.toast-dismiss)');
  const restored = await waitNew(written);
  check('web.e2e.adjustments-undo: Undo restores the corrected request',
    restored.adjustments?.some((a) => a.code === 'MODE_DEFAULTED'),
    JSON.stringify(restored.adjustments));
} else {
  check('web.e2e.adjustments-writeback: write back clears the correction and offers Undo', false, 'no MODE_DEFAULTED adjustment');
  check('web.e2e.adjustments-undo: Undo restores the corrected request', false, 'no MODE_DEFAULTED adjustment');
}

await p.goto(withQuery(`eft=${encodeURIComponent(EFT)}`), { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__lastStats?.ship?.name === 'Vexor' && !window.__lastStats.error, { timeout: 120000 });
for (const [width, height] of [[1600, 900], [1920, 1080]]) {
  await p.setViewport({ width, height });
  const layout = await p.evaluate(() => {
    const panels = ['aside.left', '.center', 'aside.right'].map((selector) => {
      const el = document.querySelector(selector);
      return { selector, clientWidth: el?.clientWidth ?? 0, scrollWidth: el?.scrollWidth ?? Infinity };
    });
    const outside = [...document.querySelectorAll('main, main *')].flatMap((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.right > window.innerWidth + 1
        ? [`${el.tagName.toLowerCase()}.${String(el.className).replaceAll(' ', '.')}: ${rect.right.toFixed(1)}px`]
        : [];
    });
    return { panels, outside };
  });
  check(`web.e2e.layout-panel-overflow-${width}: left, center and right fit their columns`,
    layout.panels.every((panel) => panel.clientWidth > 0 && panel.scrollWidth <= panel.clientWidth + 1), JSON.stringify(layout.panels));
  check(`web.e2e.layout-viewport-overflow-${width}: no main element extends beyond the viewport`,
    layout.outside.length === 0, layout.outside.slice(0, 8).join('; '));
}

const activeFitId = await p.evaluate(() => window.__lastStatsFit);
if (activeFitId) {
  await p.evaluate(() => [...document.querySelectorAll('aside.left .tabs button')].find((button) => button.textContent?.startsWith('Fits'))?.click());
  await p.waitForSelector(`.lib-fit[data-fit-id="${activeFitId}"] .lib-del`, { timeout: 10000 });
  await p.evaluate((id) => document.querySelector(`.lib-fit[data-fit-id="${id}"] .lib-del`)?.click(), activeFitId);
  await p.waitForFunction(() => document.querySelector('aside.right')?.textContent?.includes('No fit selected') && window.__lastStats === null, { timeout: 10000 });
  const emptyRight = await p.$eval('aside.right', (el) => ({ text: el.textContent ?? '', tables: el.querySelectorAll('table').length }));
  check('web.e2e.no-fit-clears-stats: deleting the active fit clears stats and shows the empty state',
    /No fit selected/.test(emptyRight.text) && emptyRight.tables === 0, JSON.stringify(emptyRight));
} else {
  check('web.e2e.no-fit-clears-stats: deleting the active fit clears stats and shows the empty state', false, 'no active fit id');
}

check('web.e2e.no-page-errors: no page errors', errors.length === 0, errors.join(' | '));

await b.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail !== '' ? '  — ' + r.detail : ''}`);
const fails = results.filter((r) => !r.ok).length;
console.log(`${results.length - fails}/${results.length} passed (${engine})`);
process.exit(fails ? 1 : 0);
