// End-to-end check of the main UI flows against a running site (any engine backend):
//   node tools/e2e.mjs <url> [engine-id]      (url may carry a query, e.g. ...?http=http://127.0.0.1:8787 for engine http)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/EXFA-App/';
const engine = process.argv[3] ?? 'wasm-worker';
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
// confirm() / prompt() answers for the fit library (next prompt value, else accept)
let promptAnswer = null;
p.on('dialog', (d) => { const v = promptAnswer; promptAnswer = null; d.accept(v ?? undefined); });
// Check names: stable id `web.e2e.<slug>` + description (docs/test-ids.md maps ids to the old names).
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };
const stats = () => p.evaluate(() => window.__lastStats);
const waitNew = async (prev) => { await p.waitForFunction((pr) => window.__lastStats && JSON.stringify(window.__lastStats) !== pr, { timeout: 60000 }, JSON.stringify(prev)); return stats(); };
const clickText = (sel, text) => p.evaluate((s, t) => { const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(t)); if (!el) return false; el.click(); return true; }, sel, text);

const sep = url.includes("?") ? "&" : "?";
await p.goto(`${url}${sep}engine=${engine}&eft=${encodeURIComponent(EFT)}`, { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__lastStats?.offense, { timeout: 120000 });
// The page must run the backend under test (a malformed URL used to fall back to the default backend silently).
const active = await p.evaluate(() => window.__eveEngine?.info?.id);
if (active !== engine) { console.log(`FAIL  active backend  — wanted ${engine}, page runs ${active}`); await b.close(); process.exit(1); }
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
await p.evaluate(() => [...document.querySelectorAll('.trow .tname')].find((e) => e.textContent === 'Stasis Webifier II').click());
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
// Backends with the graph RPC (CONTRACT-GRAPHS 0.2) must render engine-computed series; the others the UI approximation.
// E2E_GRAPH_RPC=1/0 forces it; otherwise wasm-worker (F) has it, and an http engine has it if it answers graph_specs.
const GRAPH_RPC = process.env.E2E_GRAPH_RPC ? process.env.E2E_GRAPH_RPC === '1'
  : engine === 'wasm-worker' || (engine === 'http' && (await p.evaluate(async () => !!(await window.__eveEngine?.graphSpecs?.()))));
const kinds = ['dps', 'cap', 'regen', 'mobility', 'lock', 'warp', ...(GRAPH_RPC ? ['app', 'ewar', 'rr'] : [])];
if (GRAPH_RPC) await p.waitForFunction(() => document.querySelector('.graphs select option[value="app"]'), { timeout: 30000 }).catch(() => {});
const offered = await p.evaluate(() => [...document.querySelectorAll('.graphs select option')].map((o) => o.value));
check(GRAPH_RPC ? 'web.e2e.graph-set: graphs: engine-only graphs offered' : 'web.e2e.graph-set: graphs: approximation set only', GRAPH_RPC ? ['app', 'ewar', 'rr'].every((x) => offered.includes(x)) : !offered.includes('app'), offered.join(','));
for (const g of kinds) {
  await p.select('.graphs select', g);
  const want = GRAPH_RPC ? 'engine' : 'approx';
  const src = await p.waitForFunction((w) => { const e = document.querySelector('.graph-src'); return e && e.dataset.src === w && e.dataset.src; }, { timeout: 30000 }, want).then((h) => h.jsonValue(), () => p.evaluate(() => document.querySelector('.graph-src')?.dataset.src + ' ' + (document.querySelector('.graph-src')?.title ?? '')));
  const n = await p.evaluate(() => document.querySelectorAll('svg.chart polyline').length);
  const lg = await p.evaluate(() => window.__lastGraph);
  if (GRAPH_RPC && g === 'dps') {
    // which backend computed the graph: the engine itself, or its GRAPH_FALLBACK
    const by = await p.evaluate(() => document.querySelector('.graph-src')?.dataset.graphBackend);
    const wantBy = engine;
    check('web.e2e.graph-backend-label: graph backend label', by === wantBy, `${by} (fit stats: ${engine})`);
  }
  check(`web.e2e.graph-${g}: graph ${g} (${want})`, n > 0 && src === want && (!GRAPH_RPC || lg?.kind === g), `${n} lines, ${src}${lg?.series ? ', ' + lg.series.map((x) => `${x.name}:${x.n}`).join(' ') : ''}`);
  if (GRAPH_RPC && g === 'lock') {
    // lock time = min(40000 / scanRes / asinh(sig)^2, 1800) at sig 10 m, from the stats of the same engine
    const sr = s.targeting?.scan_resolution, want10 = Math.min(40000 / sr / Math.asinh(10) ** 2, 1800), got = lg?.series?.[0]?.first;
    check('web.e2e.graph-lock-time-matches-stats: engine lock-time graph matches stats', got && Math.abs(got[1] - want10) <= 1e-6 * want10, `${got?.[1]} vs ${want10}`);
  }
  if (GRAPH_RPC && g === 'ewar') check('web.e2e.graph-ewar-web-neut: engine ewar graph has web + neut', ['web_pct', 'neut_gj_s'].every((y) => lg?.series?.some((x) => x.name === y)), lg?.series?.map((x) => x.name).join(','));
  if (GRAPH_RPC && g === 'cap') check('web.e2e.graph-cap-within-capacity: engine capacitor graph within capacity', lg?.series?.[0]?.first?.[1] > 0 && lg.series[0].first[1] <= s.capacitor?.capacity * (1 + 1e-9), `t=0 ${lg?.series?.[0]?.first?.[1]} (after first activations, capsim) of ${s.capacitor?.capacity} GJ`);
}

// booster side effect toggle (armor HP penalty)
await clickText('.center .tabs button', 'Fit');
await clickText('.tabs button', 'Fitting');
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
await p.waitForFunction(() => document.querySelector('.dialog table.attrs thead') || document.querySelector('.dialog')?.textContent.includes('unavailable') || document.querySelector('.dialog')?.textContent.includes('did not return'), { timeout: 30000 });
const fi = await p.evaluate(() => ({ head: !!document.querySelector('.dialog table.attrs thead'), changed: document.querySelectorAll('.dialog tr.changed').length, note: document.querySelector('.dialog p.muted')?.textContent }));
check('web.e2e.show-info-fitted-values: show info: fitted attribute values', fi.head && fi.changed > 0, `${fi.changed} changed; ${fi.note}`);
if (fi.head) {
  // ENG-CORE-006: every fitted value shown is the engine's (independent include_attributes=all calc of the same fit),
  // and two of them match the skill formula: Heavy Neutron Blaster II with all skills V on a Vexor (no damage / RoF
  // modules): damage multiplier x 1.25 (Gallente Cruiser 5 %/level) x 1.25 (Medium Hybrid Turret) x 1.10 (Medium
  // Blaster Specialization) x 1.15 (Surgical Strike), rate of fire x 0.90 (Gunnery) x 0.80 (Rapid Firing)
  const fv = await p.evaluate(async () => {
    const rows = Object.fromEntries([...document.querySelectorAll('.dialog table.attrs tr[data-attr]')].map((r) => [r.dataset.attr, { name: r.dataset.name, base: r.dataset.base === '' ? null : +r.dataset.base, fitted: r.dataset.fitted === '' ? null : +r.dataset.fitted }]));
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
await p.click('.dialog input.editov');
await p.waitForSelector('.dialog input.ovin[data-attr="64"]');
await p.type('.dialog input.ovin[data-attr="64"]', '10');
s = await waitNew(s);
check('web.e2e.attribute-override: attribute override raises weapon dps', s.offense?.total?.weapon_dps > wd0 * 1.5, `${wd0} -> ${s.offense?.total?.weapon_dps}`);
await p.evaluate(() => { const i = document.querySelector('.dialog input.ovin[data-attr="64"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); });
s = await waitNew(s);
check('web.e2e.attribute-override-removed: removing the override restores dps', Math.abs(s.offense?.total?.weapon_dps - wd0) < 1e-6, s.offense?.total?.weapon_dps);
await clickText('.dialog button', 'Close');

// manual fleet buff (shield harmonizing)
await clickText('.tabs button', 'Projected');
const sr0 = s.defense?.resonance?.shield?.em;
const buffId = await p.evaluate(() => [...document.querySelector('select.buffsel').options].find((o) => o.text === 'Shield Burst: Shield Harmonizing: Shield Resistance')?.value);
await p.select('select.buffsel', buffId);
s = await waitNew(s);
check('web.e2e.manual-fleet-buff: manual fleet buff raises shield resist (lower resonance)', s.defense?.resonance?.shield?.em < sr0, `${sr0} -> ${s.defense?.resonance?.shield?.em}`);

// export EFT round trip
await clickText('header button', 'Import / export');
await clickText('.dialog button', 'Export EFT');
const eft = await p.evaluate(() => document.querySelector('textarea.eft').value);
check('web.e2e.eft-export: EFT export', eft.startsWith('[Vexor, E2E Vexor]') && eft.includes('Hammerhead II x5'), eft.split('\n')[0]);
check('web.e2e.eft-export-mutated: mutated module EFT round trip', eft.includes('Stasis Webifier II [1]') && eft.includes('[1] Stasis Webifier II\n  Unstable Stasis Webifier Mutaplasmid\n') && eft.includes('maxRange 12000'), eft.split('\n').slice(-3).join(' / '));
await clickText('.dialog button', 'Export DNA');
const dna = await p.evaluate(() => document.querySelector('textarea.eft').value);
check('web.e2e.dna-export: DNA export', /^626:/.test(dna) && dna.endsWith('::'), dna);
await clickText('.dialog button', 'Export multibuy');
const mb = await p.evaluate(() => document.querySelector('textarea.eft').value);
check('web.e2e.multibuy-export: multibuy export', /^Vexor\n/.test(mb) && mb.includes('Hammerhead II x5') && mb.includes('Heavy Neutron Blaster II x2'), mb.split('\n').length + ' lines');
await clickText('.dialog button', 'Export ESI JSON');
const esi = await p.evaluate(() => document.querySelector('textarea.eft').value);
let ej = null; try { ej = JSON.parse(esi); } catch {}
check('web.e2e.esi-json-export: ESI JSON export', ej?.ship_type_id === 626 && ej.items.some((i) => i.flag === 27 || i.flag === 'HiSlot0') && ej.items.some((i) => i.flag === 87 || i.flag === 'DroneBay'), ej ? ej.items.length + ' items' : esi.slice(0, 80));
// Pyfa formats through the exfa-formats module: EVE XML export, ship-stats text (engine stats of the shipstats request)
const prov = await p.evaluate(() => document.querySelector('.formats-provider')?.dataset.provider);
check('web.e2e.formats-provider: imports / exports run through exfa-formats (WASM)', prov === 'exfa-formats', prov);
let xml = '';
if (await p.$('.dialog button.export-xml')) { await p.click('.dialog button.export-xml'); xml = await p.evaluate(() => document.querySelector('textarea.eft').value); }
check('web.e2e.xml-export: EVE XML export', xml.includes('<fitting name="E2E Vexor">') && xml.includes('base_type="Stasis Webifier II"'), xml.split('\n').length + ' lines');
let ss = '';
if (await p.$('.dialog button.export-shipstats')) {
  await p.click('.dialog button.export-shipstats');
  ss = await p.waitForFunction(() => { const v = document.querySelector('textarea.eft').value; return v && !v.startsWith('<?xml') ? v : null; }, { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => '');
}
check('web.e2e.shipstats-export: ship stats export (engine stats + formats module)', /Vexor/.test(ss) && /DPS|dps/.test(ss), ss.split('\n').slice(0, 2).join(' / '));
if (await p.$('.dialog')) await clickText('.dialog button', 'Close');

// implant sets (SDE presets): applying High-grade Snake fills slots 1-6, keeps the slot-7+ implant, raises velocity
await clickText('.center .tabs button', 'Fit');
await clickText('.center .tabs button', 'Fitting');
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
await clickText('.center .tabs button', 'Fit');
const chSel = await p.$('.fithead select[title=Character]');
const cid = await p.evaluate(() => [...document.querySelector('.fithead select[title=Character]').options].find((o) => o.text.includes('(copy)'))?.value);
await chSel.select(cid);
s = await waitNew(s);
check('web.e2e.custom-character: custom character (all 0) lowers dps', s.offense.total.dps.total < d5, `${d5} -> ${s.offense.total.dps.total}`);
check('web.e2e.missing-skills: missing skills reported', (s.violations ?? []).some((v) => v.code === 'MISSING_SKILL'));
// per-module spool-up (Triglavian disintegrator)
await p.goto(`${url}${sep}engine=${engine}&eft=${encodeURIComponent('[Vedmak, E2E Vedmak]\n\nHeavy Entropic Disintegrator II, Baryon Exotic Plasma M\n')}`, { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__lastStats?.ship?.name === 'Vedmak', { timeout: 120000 });
s = await stats();
const sp1 = s.offense?.total?.weapon_dps;
await p.select('select.spool', '0');
s = await waitNew(s);
check('web.e2e.per-module-spool: per-module spool 0% lowers disintegrator dps', s.offense?.total?.weapon_dps < sp1, `${sp1} -> ${s.offense?.total?.weapon_dps}`);

// ESI JSON re-import (new fit)
await clickText('header button', 'Import / export');
await p.evaluate((t) => { const ta = document.querySelector('textarea.eft'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, t); ta.dispatchEvent(new Event('input', { bubbles: true })); }, esi);
await clickText('.dialog button', 'Import');
await new Promise((r) => setTimeout(r, 500));
await new Promise((r) => setTimeout(r, 1500));
const imp = await p.evaluate(() => ({ open: !!document.querySelector('.dialog'), msg: document.querySelector('.dialog p.muted')?.textContent ?? '', ship: window.__lastStats?.ship?.name, mods: window.__lastStats?.modules?.length }));
// ESI fitting JSON carries no mutation data: like Pyfa, the import drops the abyssal web (15 -> 14 modules)
check('web.e2e.esi-json-reimport: ESI JSON re-import', !imp.open && imp.ship === 'Vexor' && imp.mods === 14, imp.msg || `${imp.ship}, ${imp.mods} modules`);

// EVE XML re-import (formats module) -> new fit with the mutated web
if (xml) {
  await clickText('header button', 'Import / export');
  await p.evaluate((t) => { const ta = document.querySelector('textarea.eft'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, t); ta.dispatchEvent(new Event('input', { bubbles: true })); }, xml);
  await clickText('.dialog button', 'Import');
  await new Promise((r) => setTimeout(r, 1500));
  const xi = await p.evaluate(() => ({ open: !!document.querySelector('.dialog'), msg: document.querySelector('.dialog p.muted')?.textContent ?? '', ship: window.__lastStats?.ship?.name, mods: window.__lastStats?.modules?.length, abyssal: document.body.textContent.includes('Abyssal Stasis Webifier') }));
  check('web.e2e.xml-reimport: EVE XML re-import keeps the mutated module', !xi.open && xi.ship === 'Vexor' && xi.mods === 15 && xi.abyssal, xi.msg || `${xi.ship}, ${xi.mods} modules`);
} else check('web.e2e.xml-reimport: EVE XML re-import keeps the mutated module', false, 'no XML export');

// multi-fit EFT paste + fit browser grouping
await clickText('header button', 'Import / export');
await p.evaluate((t) => { const ta = document.querySelector('textarea.eft'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, t); ta.dispatchEvent(new Event('input', { bubbles: true })); }, '[Rifter, Multi A]\n200mm AutoCannon II\n\n[Merlin, Multi B]\nLight Neutron Blaster II\n');
await clickText('.dialog button', 'Import');
await new Promise((r) => setTimeout(r, 800));
await clickText('.left .tabs button', 'Fits');
const fb = await p.evaluate(() => ({ groups: [...document.querySelectorAll('.fitbrowser summary')].map((x) => x.textContent), names: [...document.querySelectorAll('.fitbrowser li')].map((x) => x.textContent) }));
check('web.e2e.multi-fit-eft-import: multi-fit EFT import + fit browser groups', fb.names.some((n) => n.includes('Multi A')) && fb.names.some((n) => n.includes('Multi B')) && fb.groups.some((g) => g.startsWith('Frigate')), fb.groups.join(', '));
await p.type('.fitbrowser .search', 'Merlin');
const fbn = await p.evaluate(() => document.querySelectorAll('.fitbrowser li').length);
check('web.e2e.fit-browser-search: fit browser search', fbn === 1, fbn);

// prices: the engine's price block (docs/23) on F backends; "update prices" injects the deployed latest
// EXFA-Data snapshot (prices_load); "my prices" are local price_overrides (self-made = 0), kept in localStorage
const PRICING = engine === 'wasm-worker' || engine === 'http';
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
} else {
  const un = await p.waitForSelector('.price-unsupported', { timeout: 10000 }).then(() => true).catch(() => false);
  check('web.e2e.price-unsupported: backends without the engine price block say so', un);
}

// fighters: abilities
await p.goto(`${url}${sep}engine=${engine}&eft=${encodeURIComponent(CARRIER)}`, { waitUntil: 'networkidle0', timeout: 120000 });
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
// --- milestone 3: what-if, compare, multi-fit graphs, target fit, ECM burst graph (library now holds several fits) ---
const RIFTER = '[Rifter, E2E Rifter]\nGyrostabilizer II\n\n1MN Afterburner II\n\n200mm AutoCannon II, EMP S\n200mm AutoCannon II, EMP S\n';
await p.goto(`${url}${sep}engine=${engine}&eft=${encodeURIComponent(RIFTER)}`, { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__lastStats?.ship?.name === 'Rifter', { timeout: 120000 });
s = await stats();
const rd0 = s.offense?.total?.dps?.total;
await clickText('.center .tabs button', 'What-if');
await p.waitForSelector('.whatif select.wi-module');
const acIdx = await p.evaluate(() => [...document.querySelector('.whatif select.wi-module').options].find((o) => o.text.includes('200mm AutoCannon II'))?.value);
await p.select('.whatif select.wi-module', acIdx);
const wv = await p.waitForFunction(() => window.__lastWhatIf?.mode === 'variations' && window.__lastWhatIf.rows.some((r) => r.label.includes('AutoCannon')) && window.__lastWhatIf, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);
const t1 = wv?.rows.find((r) => r.label === '200mm AutoCannon I');
check('web.e2e.whatif-variations: what-if lists module variations with engine dps (T1 below T2)', wv && wv.rows.length >= 3 && t1 && t1.value < wv.base && Math.abs(wv.base - rd0) < 1e-6, wv ? `${wv.rows.length} variants; base ${wv.base}, T1 ${t1?.value}` : 'no result');
await p.select('.whatif select.wi-mode', 'charges');
const wc = await p.waitForFunction(() => window.__lastWhatIf?.mode === 'charges' && window.__lastWhatIf.rows.length && window.__lastWhatIf, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);
check('web.e2e.whatif-charges: what-if ranks compatible charges', wc && wc.rows.length >= 5 && wc.rows.some((r) => r.value > wc.base) && wc.rows.some((r) => r.value < wc.base), wc ? `${wc.rows.length} charges, base ${wc.base}` : 'no result');
await p.click('.whatif .wi-table tbody tr:nth-child(2) .wi-apply');
s = await waitNew(s);
check('web.e2e.whatif-apply: applying a scenario changes the fit; undo restores it', Math.abs(s.offense?.total?.dps?.total - rd0) > 1e-6, `${rd0} -> ${s.offense?.total?.dps?.total}`);
await clickText('header button', '↶ Undo');
s = await waitNew(s);
check('web.e2e.whatif-undo: undo after apply', Math.abs(s.offense?.total?.dps?.total - rd0) < 1e-6, s.offense?.total?.dps?.total);
// compare: the active Rifter against the other frigates in the library (Multi A Rifter, Multi B Merlin)
await clickText('.center .tabs button', 'Compare');
await p.waitForSelector('.compare');
await p.evaluate(() => { for (const n of ['Multi A', 'Multi B']) { const c = document.querySelector(`.compare input.cmp-fit[data-fit="${n}"]`); if (c && !c.checked) c.click(); } });
const cmp = await p.waitForFunction(() => window.__lastCompare?.fits?.length >= 3 && window.__lastCompare, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);
const dpsRow = cmp?.rows.find((r) => r.key === 'dps');
check('web.e2e.compare-batch: the compare window computes all fits in one engine batch call (docs/23) on F backends, one calc per fit elsewhere', cmp?.via === (engine === 'wasm-worker' || engine === 'http' ? 'batch' : 'calc') && await p.evaluate((v) => document.querySelector('.cmp-via')?.dataset.via === v, cmp?.via), cmp?.via);
check('web.e2e.compare-fits: compare table of 3 fits with best values marked', cmp && cmp.fits[0] === 'E2E Rifter' && dpsRow && dpsRow.values.length === cmp.fits.length && Math.abs(dpsRow.values[0] - rd0) < 1e-6 && cmp.rows.some((r) => r.best.length) && await p.evaluate(() => document.querySelectorAll('.cmp-table td.best').length > 0), cmp ? `${cmp.fits.join(' | ')}; ${cmp.rows.length} metrics` : 'no result');
// graphs: overlay Multi A on the dps graph, then Multi B as the target fit, then the ECM burst graph
await clickText('.center .tabs button', 'Graphs');
await p.waitForSelector('.graphs select.graph-kind');
await p.select('.graphs select.graph-kind', 'dps');
await p.evaluate(() => { document.querySelector('.graph-overlay').open = true; document.querySelector('.graph-overlay input[data-fit="Multi A"]').click(); });
const og = await p.waitForFunction(() => window.__lastGraph?.fits?.length === 2 && window.__lastGraph.series?.some((x) => x.name.startsWith('Multi A:')) && window.__lastGraph, { timeout: 60000 }).then((h) => h.jsonValue()).catch(() => null);
const nLines = await p.evaluate(() => document.querySelectorAll('svg.chart polyline').length);
check('web.e2e.graph-overlay: dps graph overlays a second fit', og && og.source === (GRAPH_RPC ? 'engine' : 'approx') && nLines >= 2, og ? `${og.source}: ${og.series.map((x) => x.name).join(', ')}` : 'no overlay');
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
await clickText('.center .tabs button', 'Fit');

// About / engine page
await clickText('.left .tabs button', 'About');
const ab2 = await p.evaluate(() => ({ be: document.querySelector('.about-backend')?.textContent, eng: document.querySelector('.about-engine')?.textContent ?? '',
  data: document.querySelector('.about-dataset')?.textContent ?? '', links: document.querySelectorAll('.about a').length }));
const abG = await p.evaluate(() => document.querySelector('.about-graphs')?.textContent ?? '');
check('web.e2e.about-graph-engine: about page: graph engine', GRAPH_RPC ? abG.startsWith(engine) : abG.startsWith('UI approximation'), abG);
check('web.e2e.about-page: about page: backend, engine, dataset, links', ab2.be === engine && ab2.eng.length > 3 && !ab2.eng.startsWith('—') && ab2.data.includes('3569502') && ab2.links >= 8, JSON.stringify(ab2));
// full zh-CN UI: tabs, stats sections, slot headers and the import/export dialog are in Chinese (no English UI words left)
await langSel('zh');
await new Promise((r) => setTimeout(r, 300));
const zhUi = await p.evaluate(() => ({ tabs: [...document.querySelectorAll('.tabs button')].map((x) => x.textContent.replace(/\s*\(\d+\)$/, '')),
  sections: [...document.querySelectorAll('.stats .section h3')].map((x) => x.firstChild?.textContent ?? ''), slots: [...document.querySelectorAll('.slotgroup h4')].map((x) => x.firstChild?.textContent ?? '') }));
await clickText('header button', '导入 / 导出');
const zhIo = await p.evaluate(() => ({ h: document.querySelector('.dialog h2')?.textContent, btns: [...document.querySelectorAll('.dialog button')].map((x) => x.textContent) }));
await p.evaluate(() => document.querySelector('.modal')?.click());
await langSel('en');
const latin = (xs) => xs.filter((x) => /[a-z]{3,}/.test(x.replace(/DPS|EFT|DNA|ESI|JSON|XML|Ctrl/g, '')));
const zhAll = [...zhUi.tabs, ...zhUi.sections, ...zhUi.slots, zhIo.h ?? '', ...zhIo.btns];
check('web.e2e.zh-ui: zh-CN UI (tabs, stats sections, slots, import/export dialog) has no untranslated labels', zhUi.tabs.includes('假设分析') && zhUi.tabs.includes('对比') && zhUi.sections.length > 3 && zhIo.h === '导入 / 导出' && latin(zhAll).length === 0, latin(zhAll).join(' | ') || `${zhAll.length} labels`);
// ---- fit library (IndexedDB): Pyfa saved-fits database import, folders / tags, rename, duplicate, delete, exports,
// backup / restore, persistence across reloads, DNA import, migration of the localStorage library ----
{
const FIX = new URL('../src/test/fixtures/', import.meta.url).pathname;
const pyfaStats = JSON.parse(fs.readFileSync(FIX + 'pyfa-saveddata.stats.json', 'utf8'));
const PRECISE = engine === 'wasm-worker' || engine === 'http'; // engine-backed stats are held to the engine's exact numbers
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
  PRECISE ? cmp.every((c) => c.ok) : cmp.every((c) => c.got), cmp.map((c) => `${c.n}: ${c.got ? c.got.dps.toFixed(2) : '—'}/${c.want.dps.toFixed(2)} dps${c.ok ? '' : ' ✗'}`).join('; '));
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
promptAnswer = 'PvP/Small';
await p.evaluate(() => document.querySelector('details.lib-folder[data-folder="PvP/Frigates"] .lib-folder-rename').click());
await new Promise((r) => setTimeout(r, 300));
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
await new Promise((r) => setTimeout(r, 300));
lf = await libFits();
check('web.e2e.library-duplicate-delete: duplicate keeps folder and tags; delete removes the fit', dupOk && lf.length === nBefore && !lf.some((f) => f.name.endsWith('(copy)')), `${nBefore} -> ${lf.length}`);

// bulk export: selected fits as one EVE XML (Pyfa backup shape) and as multi-fit EFT; XML re-import
for (const n of ['Pyfa Vexor', 'Pyfa Svipul']) await p.evaluate((nm) => document.querySelector(`.lib-fit[data-fit-name="${nm}"] .lib-sel`).click(), n);
await p.click('.lib-export-xml');
const xe = await p.evaluate(() => window.__lastLibraryExport);
await p.click('.lib-export-eft');
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
  await clickText('header button', 'Import / export');
  await p.evaluate((t) => { const ta = document.querySelector('textarea.eft'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, t); ta.dispatchEvent(new Event('input', { bubbles: true })); }, text);
  const prev = await p.evaluate(() => window.__lastStatsFit);
  await clickText('.dialog button', 'Import');
  const st = await p.waitForFunction((pf) => window.__lastStatsFit !== pf && window.__lastStats?.offense && window.__lastStats, { timeout: 60000 }, prev).then((h) => h.jsonValue()).catch(() => null);
  await clickText('header button', 'Import / export');
  await clickText('.dialog button', 'Export DNA');
  const back = await p.evaluate(() => document.querySelector('textarea.eft').value);
  await clickText('.dialog button', 'Close');
  return { st, back };
};
await clickText('.left .tabs button', 'Fits');
const rs = await openFit('Renamed Rifter', 'Rifter');
await clickText('header button', 'Import / export');
await clickText('.dialog button', 'Export DNA');
const rdna = await p.evaluate(() => document.querySelector('textarea.eft').value);
await clickText('.dialog button', 'Close');
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
await p.goto(`${url}${sep}engine=${engine}`, { waitUntil: 'networkidle0', timeout: 120000 });
await p.waitForFunction(() => window.__lastStats?.offense, { timeout: 120000 });
await clickText('.left .tabs button', 'Fits');
await p.select('.lib-mode', 'folder');
const after = (await libFits()).map((f) => `${f.name}|${f.folder}|${f.tags}`).sort();
const kind = await p.evaluate(() => document.querySelector('.lib-status')?.dataset.kind);
const vx = await openFit({ id: pyfaVexorId }, 'Vexor');
check('web.e2e.library-reload-persistence: fits, folders and tags survive a reload (IndexedDB)', st0.kind === 'indexeddb' && kind === 'indexeddb' && after.length === before.length && after.join('\n') === before.join('\n') && after.some((x) => x.startsWith('Renamed Rifter|PvP/Small|brawler,solo')) && (!PRECISE || Math.abs(vx?.navigation?.max_velocity - pyfaStats['Pyfa Vexor'].max_velocity) < 1e-6),
  `${kind}: ${before.length} -> ${after.length} fits, Vexor ${vx ? vx.navigation?.max_velocity : "no stats"}; ${before.filter((x) => !after.includes(x)).join(' / ')} => ${after.filter((x) => !before.includes(x)).join(' / ')}`);

// migration: a fresh profile holding only the localStorage library of earlier versions
{
  const ctx = await b.createBrowserContext();
  const q = await ctx.newPage();
  q.on('pageerror', (e) => errors.push(`migration page: ${e.message}`));
  const legacy = { lib: { fits: { legacy1: { id: 'legacy1', name: 'Legacy Rifter', ship_type_id: 587, mode_type_id: null, modules: [], drones: [], fighters: [], implants: [], boosters: [], cargo: [], projected: [], fleet: { booster_fit_ids: [], buffs: [] }, environment: [], system_security: null, character_id: 'all5', damage_pattern_id: 'uniform', target_profile_id: 'none', options: { factor_reload: false, spool: 1, rah: 'adapt' } } }, characters: {}, damagePatterns: {}, targetProfiles: {} }, settings: { activeFitId: 'legacy1', lang: 'en' } };
  await q.evaluateOnNewDocument((v) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('eve-fit-web:v1', v); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(legacy));
  await q.goto(`${url}${sep}engine=${engine}`, { waitUntil: 'networkidle0', timeout: 120000 });
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

// stats-ext outputs of F 20aa425 (tools/e2e-items.mjs)
{
  const { itemChecks } = await import('./e2e-items.mjs');
  await itemChecks({ p, url, sep, engine, check, stats, waitNew, clickText }).catch((e) => check('web.e2e.items-run: item checks ran to the end', false, e.stack?.split('\n').slice(0, 3).join(' | ')));
}

check('web.e2e.no-page-errors: no page errors', errors.length === 0, errors.join(' | '));

await b.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail !== '' ? '  — ' + r.detail : ''}`);
const fails = results.filter((r) => !r.ok).length;
console.log(`${results.length - fails}/${results.length} passed (${engine})`);
process.exit(fails ? 1 : 0);
