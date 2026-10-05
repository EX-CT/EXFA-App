// The exfa-formats WASM module (engines.lock pin of engine F) behind the formats layer.
import { beforeAll, describe, expect, it } from 'vitest';
import { formatsWasmBytes, hasFormatsWasm, id, miniDataset, requireFormatsWasm } from '../test/fixture';
import { newFit, toRequest, type Library } from '../fit/model';
import { BUILTIN_CHARACTERS } from '../data/presets';
import { exportFit, exportFits, fitFromStructured, formats, formatsStatus, importFits, initFormats } from './index';
import { shipstatsRequest } from './types';

const ds = miniDataset();
const lib: Library = { fits: {}, characters: Object.fromEntries(BUILTIN_CHARACTERS.map((c) => [c.id, c])), damagePatterns: {}, targetProfiles: {} };
const VEXOR = `[Vexor, W]
Drone Damage Amplifier II
Medium Armor Repairer II

10MN Afterburner II
Stasis Webifier II [1]

Heavy Neutron Blaster II, Void M
No Such Module II

Medium Auxiliary Nano Pump I

Hammerhead II x5

[1] Stasis Webifier II
  Unstable Stasis Webifier Mutaplasmid
  maxRange 12000, speedFactor -58
`;

describe.skipIf(!hasFormatsWasm && !requireFormatsWasm)('formats/exfa-formats (WASM)', () => {
  beforeAll(async () => {
    const st = await initFormats(formatsWasmBytes());
    expect(st.provider).toBe('exfa-formats');
  });
  it('web.unit.formats-wasm-active: the formats layer uses the WASM module once loaded', () => {
    expect(formatsStatus().provider).toBe('exfa-formats');
    expect(formats(ds).importFormats).toContain('xml');
    expect(formats(ds).exportFormats).toContain('shipstats');
  });
  it('web.unit.formats-wasm-eft-import: lenient EFT import (unknown items skipped), mutation, drones launched', () => {
    const r = importFits(ds, VEXOR);
    expect(r.kind).toBe('EFT');
    const f = r.fits[0];
    expect(f.name).toBe('W');
    expect(f.modules).toHaveLength(6);
    const web = f.modules.find((m) => m.mutation);
    expect(web?.mutation?.base_type_id).toBe(id('Stasis Webifier II'));
    expect(ds.name(web!.type_id, 'en')).toBe('Abyssal Stasis Webifier');
    expect(f.drones).toEqual([{ type_id: id('Hammerhead II'), quantity: 5, active: 5, mutation: null }].map(({ mutation, ...d }) => (mutation ? { ...d, mutation } : d)));
    expect(f.modules.find((m) => m.type_id === id('Heavy Neutron Blaster II'))?.charge_type_id).toBe(id('Void M'));
  });
  it('web.unit.formats-wasm-multi-eft: several pasted EFT fits import as several fits', () => {
    const r = importFits(ds, '[Rifter, Multi A]\n200mm AutoCannon II\n\n[Merlin, Multi B]\nLight Neutron Blaster II\n');
    expect(r.fits.map((f) => [ds.name(f.ship_type_id, 'en'), f.name])).toEqual([['Rifter', 'Multi A'], ['Merlin', 'Multi B']]);
  });
  it('web.unit.formats-wasm-multi-export: several fits as one EVE XML document and as multi-fit EFT, both re-import as every fit', () => {
    const fits = importFits(ds, '[Rifter, Multi A]\n200mm AutoCannon II\n\n[Merlin, Multi B]\nLight Neutron Blaster II\n').fits;
    const xml = exportFits(ds, fits, lib, 'xml');
    expect(xml.startsWith('<?xml version="1.0" ?>\n<fittings count="2">\n')).toBe(true);
    expect(importFits(ds, xml, 'auto', 'all.xml').fits.map((f) => f.name)).toEqual(['Multi A', 'Multi B']);
    const eft = exportFits(ds, fits, lib, 'eft');
    expect(importFits(ds, eft).fits.map((f) => [ds.name(f.ship_type_id, 'en'), f.name])).toEqual([['Rifter', 'Multi A'], ['Merlin', 'Multi B']]);
  });
  it('web.unit.formats-wasm-xml-roundtrip: EVE XML export and re-import keep the mutated module', () => {
    const f = importFits(ds, VEXOR).fits[0];
    const xml = exportFit(ds, f, lib, 'xml');
    expect(xml).toContain('<fitting name="W">');
    expect(xml).toContain('base_type="Stasis Webifier II"');
    const back = importFits(ds, xml).fits[0];
    expect(back.modules.map((m) => m.type_id).sort()).toEqual(f.modules.map((m) => m.type_id).sort());
  });
  it('web.unit.formats-wasm-eft-export: Pyfa EFT export of the structured request, round trip', () => {
    const f = importFits(ds, VEXOR).fits[0];
    const eft = exportFit(ds, f, lib, 'eft');
    expect(eft.startsWith('[Vexor, W]')).toBe(true);
    expect(eft).toContain('Stasis Webifier II [1]');
    expect(eft).toContain('Hammerhead II x5');
    const back = importFits(ds, eft).fits[0];
    expect(back.modules.map((m) => [m.type_id, m.charge_type_id])).toEqual(f.modules.map((m) => [m.type_id, m.charge_type_id]));
  });
  it('web.unit.formats-wasm-dna-esi: DNA and ESI JSON exports', () => {
    const f = fitFromStructured({ name: 'D', ship: { type_id: id('Rifter') }, modules: [{ type_id: id('200mm AutoCannon II'), slot: 'high', state: 'active', charge_type_id: id('EMP S') }], drones: [], fighters: [], implants: [], boosters: [], cargo: [] });
    expect(exportFit(ds, f, lib, 'dna')).toMatch(new RegExp(`^${id('Rifter')}:${id('200mm AutoCannon II')};1:`));
    const j = JSON.parse(exportFit(ds, f, lib, 'esi'));
    expect(j.ship_type_id).toBe(id('Rifter'));
  });
  it('web.unit.formats-wasm-shipstats-needs-stats: shipstats without engine stats is an error; request has no spool', () => {
    const f = newFit(id('Rifter'), 'S');
    expect(() => exportFit(ds, f, lib, 'shipstats')).toThrow(/NEEDS_STATS/);
    const req = shipstatsRequest({ ...toRequest(f, lib), modules: [{ type_id: 1, spool: { type: 'spool_scale', amount: 1 } }] }) as any;
    expect(req.options.include_attributes).toBe('all');
    expect(req.options.default_spool).toEqual({ type: 'spool_scale', amount: 0 });
    expect(req.modules[0].spool).toBeNull();
  });
  it('web.unit.formats-wasm-errors: unrecognised text and item lists are readable errors', () => {
    expect(() => importFits(ds, 'hello world')).toThrow(/UNRECOGNIZED_INPUT/);
  });
});
