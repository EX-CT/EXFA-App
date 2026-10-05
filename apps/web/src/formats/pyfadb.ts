// Pyfa saved-fits database (saveddata.db, SQLite) -> StructuredLibrary. Part of the formats layer: the database is
// read client-side with sql.js (SQLite compiled to WASM, MIT) and every fit becomes a structured fit before it
// reaches the library or an engine. Written from the database layout (table and column names) only; no Pyfa code.
// Tolerates older / newer Pyfa schemas: missing tables or columns read as empty / null.
import type { Dataset } from '../data/dataset';
import type {
  ModState, StructuredCharacter, StructuredLibrary, StructuredLibraryFit, StructuredMutation, StructuredProfile,
} from './types';

export type Row = Record<string, unknown>;
/** Runs one SELECT and returns its rows as objects (sql.js `exec` wrapped, or any SQLite binding in tests). */
export type Query = (sql: string, params?: unknown[]) => Row[];

/** Pyfa module states (eos FittingModuleState values stored in modules.state). */
const STATE: Record<number, ModState> = { [-1]: 'offline', 0: 'online', 1: 'active', 2: 'overheated' };
/** fits.systemSecurity values. */
const SEC = ['hisec', 'lowsec', 'nullsec', 'wspace'] as const;
/** characters saved by Pyfa itself (name, no owner) that are our built-in characters */
const BUILTIN_CHAR: Record<string, 'all5' | 'all4' | 'all0'> = { 'All 5': 'all5', 'All 4': 'all4', 'All 0': 'all0' };

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
const bool = (v: unknown) => v === 1 || v === true || v === '1';
const str = (v: unknown) => (v == null ? null : String(v));

/** True when the bytes look like a SQLite 3 database file. */
export function isSqlite(bytes: Uint8Array): boolean {
  const magic = 'SQLite format 3\0';
  if (bytes.length < 100) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic.charCodeAt(i)) return false;
  return true;
}

export function readPyfaDb(q: Query, ds: Dataset): StructuredLibrary {
  const warnings: string[] = [];
  const tables = new Set(q("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => String(r.name)));
  if (!tables.has('fits') || !tables.has('modules')) throw new Error('not a Pyfa saved-fits database (no fits / modules tables)');
  const cols = new Map<string, Set<string>>();
  const has = (t: string, c: string) => {
    if (!cols.has(t)) cols.set(t, new Set(tables.has(t) ? q(`PRAGMA table_info("${t}")`).map((r) => String(r.name)) : []));
    return cols.get(t)!.has(c);
  };
  const all = (t: string, order = '') => (tables.has(t) ? q(`SELECT * FROM "${t}"${order}`) : []);
  const col = (r: Row, t: string, c: string) => (has(t, c) ? r[c] : null);
  const known = (id: number | null, what: string): id is number => {
    if (id == null) return false;
    if (ds.type(id)) return true;
    warnings.push(`${what}: type ${id} is not in the dataset, skipped`);
    return false;
  };
  const group = <T>(rows: Row[], key: string, f: (r: Row) => T) => {
    const m = new Map<number, T[]>();
    for (const r of rows) { const k = Number(r[key]); m.set(k, [...(m.get(k) ?? []), f(r)]); }
    return m;
  };

  // ---- profiles and characters ----
  const characters: StructuredCharacter[] = [];
  const skills = group(all('characterSkills'), 'characterID', (r) => [Number(r.itemID), num(r._Skill__level ?? r.level) ?? 0] as const);
  for (const c of all('characters')) {
    const name = String(c.name ?? ''), ref = `char:${c.ID}`;
    const builtin = BUILTIN_CHAR[name];
    if (builtin && col(c, 'characters', 'ownerID') == null) { characters.push({ ref, name, default_level: 0, levels: {}, builtin }); continue; }
    const def = num(c.defaultLevel) ?? 0;
    const levels: Record<string, number> = {};
    for (const [sid, lvl] of skills.get(Number(c.ID)) ?? []) if (lvl !== def && ds.type(sid)) levels[sid] = lvl;
    if (num(col(c, 'characters', 'alphaCloneID')) != null) warnings.push(`character "${name}": alpha clone restrictions are not imported`);
    characters.push({ ref, name, default_level: def, levels, security_status: num(col(c, 'characters', 'secStatus')) });
  }
  const damage_patterns: StructuredProfile[] = all('damagePatterns').map((d) => ({
    ref: `dp:${d.ID}`, name: str(d.name) ?? '',
    em: num(d.emAmount) ?? 0, thermal: num(d.thermalAmount) ?? 0, kinetic: num(d.kineticAmount) ?? 0, explosive: num(d.explosiveAmount) ?? 0,
  }));
  const target_profiles: StructuredProfile[] = all('targetResists').map((t) => ({
    ref: `tp:${t.ID}`, name: str(t.name) ?? '',
    em: num(t.emAmount) ?? 0, thermal: num(t.thermalAmount) ?? 0, kinetic: num(t.kineticAmount) ?? 0, explosive: num(t.explosiveAmount) ?? 0,
    max_velocity: num(col(t, 'targetResists', 'maxVelocity')), signature_radius: num(col(t, 'targetResists', 'signatureRadius')), radius: num(col(t, 'targetResists', 'radius')),
  }));

  // ---- items shared by fits, characters and implant sets ----
  const implantRows = new Map(all('implants').map((r) => [Number(r.ID), r]));
  const implantsOf = (links: Row[], key: string) => group(links, key, (r) => implantRows.get(Number(r.implantID))).entries();
  const implant_sets = [...implantsOf(all('implantSetMap'), 'setID')].map(([setId, rows]) => ({ setId, ids: rows.filter(Boolean).map((r) => Number(r!.itemID)).filter((i) => ds.type(i)) }));
  const setNames = new Map(all('implantSets').map((r) => [Number(r.ID), String(r.name ?? '')]));
  const charImplants = new Map([...implantsOf(all('charImplants'), 'charID')].map(([k, rows]) => [k, rows.filter((r) => r && bool(r.active ?? 1)).map((r) => Number(r!.itemID))]));
  const fitImplants = new Map([...implantsOf(all('fitImplants'), 'fitID')]);
  const mutators = group(all('mutators'), 'moduleID', (r) => [Number(r.attrID), Number(r.value)] as const);
  const droneMutators = group(all('mutatorsDrones'), 'groupID', (r) => [Number(r.attrID), Number(r.value)] as const);
  const mutation = (base: unknown, muta: unknown, attrs: (readonly [number, number])[] | undefined, what: string): StructuredMutation | null => {
    const b = num(base), m = num(muta);
    if (b == null || m == null) return null;
    if (!ds.type(b) || !ds.type(m)) { warnings.push(`${what}: mutation base ${b} / mutaplasmid ${m} not in the dataset, kept unmutated`); return null; }
    return { base_type_id: b, mutaplasmid_type_id: m, attributes: Object.fromEntries((attrs ?? []).map(([a, v]) => [String(a), v])) };
  };
  const modulesByFit = group(all('modules', ' ORDER BY "fitID", "position", "ID"'), 'fitID', (r) => r);
  const dronesByFit = group(all('drones'), 'fitID', (r) => r);
  const fightersByFit = group(all('fighters'), 'fitID', (r) => r);
  const abilities = group(all('fightersAbilities'), 'groupID', (r) => [Number(r.effectID), bool(r.active)] as const);
  const cargoByFit = group(all('cargo'), 'fitID', (r) => r);
  const boostersByFit = group(all('boosters'), 'fitID', (r) => r);
  const sideEffects = group(all('boosterSideEffects'), 'boosterID', (r) => [Number(r.effectID), bool(r.active)] as const);
  const projectedOnto = group(all('projectedFits'), 'victimID', (r) => r);
  const commandOnto = group(all('commandFits'), 'boostedID', (r) => r);
  const overrides = all('overrides').map((r) => ({ type_id: Number(r.itemID), attribute_id: Number(r.attrID), value: Number(r.value) }));
  const beacons = ds.raw.environment?.effect_beacons ?? {};
  const squadron = (t: number) => ds.attr(t, 'fighterSquadronMaxSize') ?? 1;

  const fits: StructuredLibraryFit[] = [];
  for (const f of all('fits', ' ORDER BY "ID"')) {
    const id = Number(f.ID), fname = String(f.name ?? `Pyfa fit ${id}`), what = `fit "${fname}"`;
    const ship = num(f.shipID);
    if (!known(ship, what)) continue;
    const sf: StructuredLibraryFit = {
      ref: `fit:${id}`, name: fname, notes: str(col(f, 'fits', 'notes')) ?? undefined,
      ship: { type_id: ship, mode_type_id: num(col(f, 'fits', 'modeID')) },
      modules: [], drones: [], fighters: [], implants: [], boosters: [], cargo: [], projected: [], environment: [],
      character_ref: num(f.characterID) != null ? `char:${f.characterID}` : null,
      damage_pattern_ref: num(f.damagePatternID) != null ? `dp:${f.damagePatternID}` : null,
      target_profile_ref: num(col(f, 'fits', 'targetResistsID')) != null ? `tp:${f.targetResistsID}` : null,
      system_security: SEC[num(col(f, 'fits', 'systemSecurity')) ?? -1] ?? null,
      projected_fits: [], booster_fit_refs: [], overrides: [],
      created: str(col(f, 'fits', 'created')), modified: str(col(f, 'fits', 'modified')),
    };
    if (sf.ship.mode_type_id != null && !ds.type(sf.ship.mode_type_id)) { warnings.push(`${what}: mode ${sf.ship.mode_type_id} not in the dataset`); sf.ship.mode_type_id = null; }
    if (num(col(f, 'fits', 'builtinDamagePatternID')) != null) warnings.push(`${what}: Pyfa built-in damage pattern #${f.builtinDamagePatternID} is not mapped (uniform used)`);
    if (num(col(f, 'fits', 'builtinTargetResistsID')) != null) warnings.push(`${what}: Pyfa built-in target profile #${f.builtinTargetResistsID} is not mapped (none used)`);
    if (bool(col(f, 'fits', 'ignoreRestrictions'))) warnings.push(`${what}: "ignore restrictions" is not supported`);

    for (const m of modulesByFit.get(id) ?? []) {
      const t = num(m.itemID);
      if (t == null) continue; // dummy row of an empty slot
      if (!known(t, what)) continue;
      const charge = num(m.chargeID);
      const state = STATE[num(m.state) ?? 0] ?? 'online';
      const range = num(col(m, 'modules', 'projectionRange'));
      if (bool(m.projected)) {
        if (beacons[t]) { sf.environment!.push(t); continue; }
        const last = sf.projected!.at(-1);
        if (last && last.kind === 'module' && last.type_id === t && last.state === state && last.charge_type_id === charge && last.distance_m === range) last.amount++;
        else sf.projected!.push({ kind: 'module', type_id: t, state, charge_type_id: charge != null && ds.type(charge) ? charge : null, amount: 1, distance_m: range });
        continue;
      }
      const slot = ds.slot(t);
      if (!slot) { warnings.push(`${what}: ${ds.name(t, 'en')} is not a fittable module, skipped`); continue; }
      const st = num(col(m, 'modules', 'spoolType')), sa = num(col(m, 'modules', 'spoolAmount'));
      if (st != null && st !== 0 && sa != null) warnings.push(`${what}: spool-up of ${ds.name(t, 'en')} by time / cycles is not supported (fit default used)`);
      sf.modules.push({
        type_id: t, slot, state, charge_type_id: charge != null && known(charge, what) ? charge : null,
        mutation: mutation(col(m, 'modules', 'baseItemID'), col(m, 'modules', 'mutaplasmidID'), mutators.get(Number(m.ID)), what),
        spool: st === 0 && sa != null ? Math.max(0, Math.min(1, sa)) : null,
      });
    }
    for (const d of dronesByFit.get(id) ?? []) {
      const t = num(d.itemID);
      if (!known(t, what)) continue;
      const qty = num(d.amount) ?? 1;
      if (bool(d.projected)) { sf.projected!.push({ kind: 'drone', type_id: t, quantity: qty, amount: 1, distance_m: num(col(d, 'drones', 'projectionRange')) }); continue; }
      sf.drones.push({ type_id: t, quantity: qty, active: Math.min(qty, num(d.amountActive) ?? 0),
        mutation: mutation(col(d, 'drones', 'baseItemID'), col(d, 'drones', 'mutaplasmidID'), droneMutators.get(Number(d.groupID)), what) });
    }
    for (const x of fightersByFit.get(id) ?? []) {
      const t = num(x.itemID);
      if (!known(t, what)) continue;
      const amt = num(x.amount) ?? -1, qty = amt < 0 ? squadron(t) : amt;
      const ab = abilities.get(Number(x.groupID));
      const fe = { type_id: t, quantity: qty, active: bool(x.active ?? 1), abilities: ab ? ab.filter(([, a]) => a).map(([e]) => e) : null };
      if (bool(x.projected)) sf.projected!.push({ kind: 'fighter', type_id: t, quantity: qty, active: fe.active, amount: 1, distance_m: num(col(x, 'fighters', 'projectionRange')) });
      else sf.fighters.push(fe);
    }
    for (const c of cargoByFit.get(id) ?? []) { const t = num(c.itemID); if (known(t, what)) sf.cargo.push({ type_id: t, quantity: num(c.amount) ?? 1 }); }
    const imps = num(col(f, 'fits', 'implantLocation')) === 1
      ? (charImplants.get(num(f.characterID) ?? -1) ?? [])
      : (fitImplants.get(id) ?? []).filter((r) => r && bool(r.active ?? 1)).map((r) => Number(r!.itemID));
    for (const t of imps) if (known(t, what)) sf.implants.push(t);
    for (const b of boostersByFit.get(id) ?? []) {
      const t = num(b.itemID);
      if (!bool(b.active ?? 1) || !known(t, what)) continue;
      sf.boosters.push({ type_id: t, side_effects: (sideEffects.get(Number(b.ID)) ?? []).filter(([, a]) => a).map(([e]) => e) });
    }
    for (const p of projectedOnto.get(id) ?? []) if (bool(p.active)) sf.projected_fits!.push({ ref: `fit:${p.sourceID}`, amount: num(p.amount) ?? 1, distance_m: num(col(p, 'projectedFits', 'projectionRange')) });
    for (const c of commandOnto.get(id) ?? []) if (bool(c.active)) sf.booster_fit_refs!.push(`fit:${c.boosterID}`);
    // Pyfa overrides are global per type; a library fit gets those of the types it uses
    const used = new Set<number>([ship, ...sf.modules.flatMap((m) => [m.type_id, m.charge_type_id ?? 0]), ...sf.drones.map((d) => d.type_id), ...sf.fighters.map((x) => x.type_id)]);
    sf.overrides = overrides.filter((o) => used.has(o.type_id));
    fits.push(sf);
  }
  return {
    kind: 'Pyfa database', fits, characters, damage_patterns, target_profiles, warnings,
    implant_sets: implant_sets.filter((s) => s.ids.length).map((s) => ({ ref: `set:${s.setId}`, name: setNames.get(s.setId) ?? `Pyfa set ${s.setId}`, implants: s.ids })),
  };
}

/** sql.js, loaded on first use (the 0.6 MB SQLite WASM is fetched only when a database is imported). */
let sqlPromise: Promise<import('sql.js').SqlJsStatic> | null = null;
export function loadSqlJs(wasm?: { url?: string; binary?: ArrayBuffer }): Promise<import('sql.js').SqlJsStatic> {
  sqlPromise ??= import('sql.js').then(async (m) => {
    const init = m.default;
    if (wasm?.binary) return init({ wasmBinary: wasm.binary });
    const url = wasm?.url ?? (await import('sql.js/dist/sql-wasm.wasm?url')).default;
    return init({ locateFile: () => url });
  });
  return sqlPromise;
}

/** Opens database bytes with sql.js and reads them as a Pyfa library. */
export async function importPyfaDb(bytes: Uint8Array, ds: Dataset, wasm?: { url?: string; binary?: ArrayBuffer }): Promise<StructuredLibrary> {
  if (!isSqlite(bytes)) throw new Error('not an SQLite database');
  const SQL = await loadSqlJs(wasm);
  const db = new SQL.Database(bytes);
  try {
    const q: Query = (sql, params) => {
      const res = db.exec(sql, params as never);
      if (!res.length) return [];
      const { columns, values } = res[0];
      return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])));
    };
    return readPyfaDb(q, ds);
  } finally { db.close(); }
}
