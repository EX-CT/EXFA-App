// e2e checks for the stats-ext outputs of F (20aa425: mining, outgoing reps, bombing, heat, drone EHP, validation). Called from tools/e2e.mjs with its page
// and helpers; every check has a stable id (web.e2e.<slug>, see docs/test-ids.md).
export async function itemChecks({ p, url, sep, engine, check, stats, waitNew, clickText }) {
  // F and the http bridge (eve-fit, same pin) return the stats-ext outputs; the other engines are only held to the UI
  // hiding what they do not return
  const EXT = engine === 'wasm-worker' || engine === 'http';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const load = async (eft, ship) => {
    await p.goto(`${url}${sep}engine=${engine}&eft=${encodeURIComponent(eft)}`, { waitUntil: 'networkidle0', timeout: 120000 });
    await p.waitForFunction((sh) => window.__lastStats?.ship?.name === sh && !window.__lastStats.error, { timeout: 120000 }, ship).catch(() => null);
    return stats();
  };
  const text = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.trim()), sel);
  const fmt = (v, d = 1) => { if (v == null || !Number.isFinite(v)) return '—'; const a = Math.abs(v); if (a >= 1e9) return (v / 1e9).toFixed(2) + 'b'; if (a >= 1e6) return (v / 1e6).toFixed(2) + 'm'; if (a >= 1e4) return (v / 1e3).toFixed(1) + 'k'; return v.toFixed(d); };
  const codes = (st) => [...new Set((st?.violations ?? []).map((v) => v.code))].sort();
  const uiCodes = () => p.evaluate(() => [...new Set([...document.querySelectorAll('.stats ul.viol li[data-code]')].map((li) => li.dataset.code))].sort());
  let s;

  // --- stats-ext 1.10 outputs (F 20aa425) ---
  s = await load('[Venture, E2E Venture]\n\n\nMiner II\nMiner II\n\n\nMining Drone I x2\n', 'Venture');
  const mt = await p.evaluate(() => document.querySelector('.stats .mining-total')?.textContent ?? null);
  check('web.e2e.mining-yield: mining section shows the engine yield (modules + drones = total m³/s)',
    EXT ? s.mining?.total_m3_s > 0 && Math.abs(s.mining.modules_m3_s + s.mining.drones_m3_s - s.mining.total_m3_s) < 1e-6 && mt === `${fmt(s.mining.total_m3_s, 2)} m³/s` : (s.mining?.total_m3_s > 0) === (mt != null),
    `${mt} (${JSON.stringify(s.mining)})`);

  s = await load('[Guardian, E2E Guardian]\n\n\nLarge Remote Armor Repairer II\nLarge Remote Capacitor Transmitter II\n', 'Guardian');
  const out = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.stats table.outgoing tr[data-key]')].map((r) => [r.dataset.key, r.children[1].textContent])));
  check('web.e2e.outgoing-reps: outgoing remote armor reps and capacitor transfer shown with the engine values',
    EXT ? s.outgoing?.current?.armor_per_s > 0 && s.outgoing.current.capacitor_per_s > 0 && out.armor_per_s === `${fmt(s.outgoing.current.armor_per_s)} HP/s` && out.capacitor_per_s === `${fmt(s.outgoing.current.capacitor_per_s)} GJ/s` && !out.shield_per_s : Object.keys(out).length === 0 || !!s.outgoing,
    JSON.stringify(out));

  // bombing table (bombs to kill, Covert Ops 0-5) of the Guardian
  const bt = await p.evaluate(() => { const d = document.querySelector('.stats details.bombing'); if (!d) return null; d.open = true; return Object.fromEntries([...d.querySelectorAll('tr[data-type]')].map((r) => [r.dataset.type, [...r.querySelectorAll('td.num')].map((x) => x.textContent)])); });
  check('web.e2e.bombing-table: bombs to kill per damage type and Covert Ops level match the engine',
    EXT ? bt && ['em', 'thermal', 'kinetic', 'explosive'].every((k) => bt[k]?.length === 6 && bt[k].every((v, l) => v === fmt(s.bombing[k][`covert_ops_${l}`], 1))) : bt == null || !!s.bombing,
    JSON.stringify(bt?.em));

  // overheat: burnout per overheated module (modules[].heat); the rack position changes the heat damage
  const HEAT = '[Rifter, E2E Heat]\nGyrostabilizer II\n\n1MN Afterburner II\nStasis Webifier II\nWarp Disruptor II\n\n200mm AutoCannon II, EMP S\n200mm AutoCannon II, EMP S\n200mm AutoCannon II, EMP S\n';
  s = await load(HEAT, 'Rifter');
  // EFT has no overheat flag: overheat AB, web and two guns with the state button (click = next state)
  const rowIdx = await p.evaluate(() => [...document.querySelectorAll('.fitting .mod[data-idx]')].map((r) => [+r.dataset.idx, r.querySelector('.mname').textContent]));
  const toHeat = [rowIdx.find(([, n]) => n === '1MN Afterburner II'), rowIdx.find(([, n]) => n === 'Stasis Webifier II'), ...rowIdx.filter(([, n]) => n === '200mm AutoCannon II').slice(0, 2)].map((x) => x?.[0]);
  for (const i of toHeat) {
    for (let k = 0; k < 4; k++) {
      const st = await p.evaluate((j) => document.querySelector(`.fitting .mod[data-idx="${j}"] .state`)?.className, i);
      if (!st || st.includes('s-overheated')) break;
      await p.evaluate((j) => document.querySelector(`.fitting .mod[data-idx="${j}"] .state`).click(), i);
      s = await waitNew(s).catch(() => s);
    }
  }
  await sleep(300); s = await stats();
  const heatRows = await p.evaluate(() => [...document.querySelectorAll('.fitting .mod[data-idx]')].filter((r) => r.querySelector('.heat')).map((r) => +r.dataset.idx));
  const heatStats = (s.modules ?? []).filter((m) => m.heat).map((m) => m.module_index);
  check('web.e2e.overheat-burnout: overheated modules show the expected burnout time (modules[].heat)',
    EXT ? heatStats.length === 4 && JSON.stringify(heatRows) === JSON.stringify(heatStats) : heatRows.length === heatStats.length,
    `${heatRows} / ${heatStats}`);

  // drone EHP (drones.items[]) in the drone rows
  s = await load('[Vexor, E2E Drones]\n\n\n\n\nHammerhead II x5\nHobgoblin II x3\n', 'Vexor');
  const dehp = await text('.bay .mod .dehp');
  const dexp = (s.drones?.items ?? []).sort((a, b) => a.drone_index - b.drone_index).map((x) => `${Math.round(x.ehp.shield + x.ehp.armor + x.ehp.hull)} EHP`);
  check('web.e2e.drone-ehp: each drone row shows the EHP of one drone (drones.items[])', EXT ? dexp.length === 2 && JSON.stringify(dehp) === JSON.stringify(dexp) : dehp.length === dexp.length, `${dehp} / ${dexp}`);

  // validation (F 2da8150): the formats layer drops what Pyfa would not fit, so the illegal items come from the market
  // (which adds them as asked): capital module on a frigate, a fifth gun (4 highs, 3 turrets), a medium rig, overloads
  s = await load('[Rifter, E2E Overfit]\n\nLarge Shield Extender II\nLarge Shield Extender II\nLarge Shield Extender II\n\n200mm AutoCannon II\n200mm AutoCannon II\n200mm AutoCannon II\n', 'Rifter');
  const market = async (name) => {
    await clickText('.left .tabs button', 'Market');
    await p.evaluate((n) => { const i = document.querySelector('.market .search'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, n); i.dispatchEvent(new Event('input', { bubbles: true })); }, name);
    await p.waitForFunction((n) => [...document.querySelectorAll('.market .tname')].some((e) => e.textContent === n), { timeout: 10000 }, name).catch(() => null);
    const ok = await p.evaluate((n) => { const e = [...document.querySelectorAll('.market .tname')].find((x) => x.textContent === n); e?.click(); return !!e; }, name);
    if (ok) s = await waitNew(s).catch(() => s);
    return ok;
  };
  for (const n of ['Capital Armor Repairer I', '200mm AutoCannon II', '200mm AutoCannon II', 'Medium Core Defense Field Extender I']) await market(n);
  const ui = await uiCodes();
  const labels = await p.evaluate(() => [...document.querySelectorAll('.stats ul.viol li[data-code] b')].map((x) => x.textContent));
  const want = ['POWER_OVERLOAD', 'SLOTS_EXCEEDED', 'TURRET_HARDPOINTS', 'RIG_SIZE', 'SHIP_RESTRICTION'];
  check('web.e2e.validation-problems: engine violations (capital module on a frigate, slots, turrets, rig size, powergrid) are listed in Problems with their labels',
    (EXT ? want.every((c) => ui.includes(c) && codes(s).includes(c)) : JSON.stringify(ui) === JSON.stringify(codes(s))) && labels.length > 0 && !labels.some((l) => /^[A-Z_]+$/.test(l)),
    `ui ${ui.join(',')}; engine ${codes(s).join(',')}; modules ${(s.modules ?? []).map((m) => `${m.slot}:${m.name}`).join(', ')}`);
}
