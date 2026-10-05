import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importPyfaDb, isSqlite } from './pyfadb';
import { libraryFromStructured } from './index';
import { toRequest, type Library } from '../fit/model';
import { BUILTIN_CHARACTERS, BUILTIN_DAMAGE, BUILTIN_TARGETS } from '../data/presets';
import { id, miniDataset } from '../test/fixture';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const DB = new Uint8Array(readFileSync(here('../test/fixtures/pyfa-saveddata.db')));
// sql.js is hoisted to the monorepo root node_modules by npm workspaces
const SQL_WASM = { binary: readFileSync(fileURLToPath(import.meta.resolve('sql.js/dist/sql-wasm.wasm'))).buffer as ArrayBuffer };
const emptyLib = (): Library => ({
  fits: {}, characters: Object.fromEntries(BUILTIN_CHARACTERS.map((c) => [c.id, c])),
  damagePatterns: Object.fromEntries(BUILTIN_DAMAGE.map((d) => [d.id, d])), targetProfiles: Object.fromEntries(BUILTIN_TARGETS.map((t) => [t.id, t])),
});

describe('formats/pyfadb (Pyfa saveddata.db, fixture written by Pyfa 1d9f72b)', () => {
  const ds = miniDataset();
  const load = () => importPyfaDb(DB, ds, SQL_WASM);

  it('web.unit.pyfadb-fits: every saved fit with ship, mode, notes, module states, charges, cargo', async () => {
    expect(isSqlite(DB)).toBe(true);
    const sl = await load();
    expect(sl.kind).toBe('Pyfa database');
    expect(sl.fits.map((f) => f.name)).toEqual(['Pyfa Rifter', 'Pyfa Vexor', 'Pyfa Thanatos', 'Pyfa Svipul']);
    const rif = sl.fits[0];
    expect(rif.ship.type_id).toBe(id('Rifter'));
    expect(rif.notes).toBe('Saved in Pyfa\nsecond line');
    expect(rif.system_security).toBe('lowsec');
    const guns = rif.modules.filter((m) => m.type_id === id('200mm AutoCannon II'));
    expect(guns.map((m) => m.state)).toEqual(['active', 'offline', 'active']);
    expect(guns.every((m) => m.charge_type_id === id('Republic Fleet EMP S'))).toBe(true);
    expect(rif.modules.find((m) => m.type_id === id('1MN Afterburner II'))!.state).toBe('overheated');
    expect(rif.modules.map((m) => m.slot).filter((s) => s === 'rig')).toHaveLength(2);
    expect(rif.cargo).toEqual([{ type_id: id('Republic Fleet EMP S'), quantity: 200 }]);
    expect(rif.drones).toEqual([{ type_id: id('Warrior II'), quantity: 2, active: 1, mutation: null }]);
    expect(sl.fits[3].ship.mode_type_id).toBe(id('Svipul Defense Mode'));
  });

  it('web.unit.pyfadb-mutated-implants-boosters: mutated module, implants, booster side effects, drones kept in the bay', async () => {
    const vex = (await load()).fits[1];
    const web = vex.modules.find((m) => m.mutation)!;
    expect(web.mutation!.base_type_id).toBe(id('Stasis Webifier II'));
    expect(web.mutation!.mutaplasmid_type_id).toBe(id('Unstable Stasis Webifier Mutaplasmid'));
    expect(web.mutation!.attributes).toMatchObject({ 20: -58, 54: 12000 });
    expect(vex.implants).toEqual([id("Inherent Implants 'Noble' Repair Proficiency RP-905")]);
    expect(vex.boosters).toEqual([{ type_id: id('Improved Crash Booster'), side_effects: [] }]);
    expect(vex.drones.map((d) => [d.quantity, d.active])).toEqual([[5, 0], [5, 0]]);
  });

  it('web.unit.pyfadb-fighters: squadron size -1 = full squadron, ability toggles as active effect ids', async () => {
    const th = (await load()).fits[2];
    expect(th.fighters).toHaveLength(2);
    for (const f of th.fighters) expect(f.quantity).toBe(ds.attr(f.type_id, 'fighterSquadronMaxSize'));
    expect(th.fighters[0].abilities).toEqual([6431, 6465]);
    expect(th.fighters[1].abilities).toEqual([6465]);
  });

  it('web.unit.pyfadb-links-profiles: characters, profiles, implant sets, projected and command fits resolve to library ids', async () => {
    const sl = await load();
    expect(sl.characters.map((c) => [c.name, c.builtin ?? null])).toEqual([['All 5', 'all5'], ['All 0', 'all0'], ['Pyfa Pilot', null]]);
    const pilot = sl.characters[2];
    expect(pilot.default_level).toBe(4);
    expect(pilot.security_status).toBe(-2.5);
    expect(pilot.levels[id('Gunnery')]).toBe(5);
    expect(sl.implant_sets).toEqual([{ ref: 'set:1', name: 'Pyfa Set', implants: [id("Inherent Implants 'Noble' Repair Proficiency RP-905"), id("Zainou 'Snapshot' Heavy Missiles HM-703")] }]);
    const lib = emptyLib();
    const r = libraryFromStructured(sl, lib, { folder: 'Pyfa import' });
    expect(r.fits).toHaveLength(4);
    expect(r.characters.map((c) => c.name)).toEqual(['Pyfa Pilot']);
    expect(r.damagePatterns.map((d) => [d.name, d.em, d.explosive])).toEqual([['Pyfa Pattern', 10, 40]]); // unnamed 25/25/25/25 -> built-in Uniform
    expect(r.targetProfiles.map((t) => [t.name, t.kinetic, t.signature_radius])).toEqual([['Pyfa Target', 0.3, 80]]);
    const [rif, vex, , sv] = r.fits;
    expect(rif.damage_pattern_id).toBe(r.damagePatterns[0].id);
    expect(rif.target_profile_id).toBe(r.targetProfiles[0].id);
    expect(vex.character_id).toBe(r.characters[0].id);
    expect(sv.character_id).toBe('all0');
    expect(vex.projected).toEqual([{ kind: 'fit', fit_id: rif.id, amount: 1, distance_m: 5000 }]);
    expect(vex.fleet.booster_fit_ids).toEqual([sv.id]);
    expect(r.fits.every((f) => f.folder === 'Pyfa import' && f.created)).toBe(true);
    // the projected Rifter and the command Svipul reach the engine request
    for (const f of r.fits) lib.fits[f.id] = f;
    for (const c of r.characters) lib.characters[c.id] = c;
    const req = toRequest(vex, lib) as { projected: { kind: string; fit: { ship: { type_id: number } } }[]; fleet: { booster_fits: unknown[] }; character: { skills: { default_level: number } } };
    expect(req.projected[0].kind).toBe('fit');
    expect(req.projected[0].fit.ship.type_id).toBe(id('Rifter'));
    expect(req.fleet.booster_fits).toHaveLength(1);
    expect(req.character.skills.default_level).toBe(4);
  });

  it('web.unit.pyfadb-rejects: non-SQLite bytes and SQLite files without Pyfa tables are errors', async () => {
    await expect(importPyfaDb(new TextEncoder().encode('[Rifter, x]'), ds, SQL_WASM)).rejects.toThrow(/not an SQLite/);
    const { loadSqlJs } = await import('./pyfadb');
    const SQL = await loadSqlJs(SQL_WASM);
    const db = new SQL.Database(); db.run('CREATE TABLE t (a INTEGER)');
    const bytes = db.export(); db.close();
    await expect(importPyfaDb(bytes, ds, SQL_WASM)).rejects.toThrow(/not a Pyfa saved-fits database/);
  });
});
