import { describe, expect, it } from 'vitest';
import { id, miniDataset } from '../test/fixture';
import { builtinFormats, detect, exportDna, parseDna, parseEft, splitEft } from './builtin';

const ds = miniDataset();
const RIFTER = `[Rifter, Demo Rifter]
Gyrostabilizer II
200mm Steel Plates II
Small Armor Repairer II

1MN Afterburner II
Warp Scrambler II /OFFLINE
Stasis Webifier II [1]

200mm AutoCannon II, Republic Fleet EMP S
200mm AutoCannon II, Republic Fleet EMP S
[Empty High slot]

Small Projectile Burst Aerator I
[Empty Rig slot]

Hobgoblin II x2
Nanite Repair Paste x50

[1] Stasis Webifier II
  Unstable Stasis Webifier Mutaplasmid
  maxRange 12000, speedFactor -58
`;

describe('formats/builtin', () => {
  it('web.unit.builtin-eft-import: slots, charges, /OFFLINE, drones, cargo, empty slots skipped', () => {
    const w: string[] = [];
    const f = parseEft(ds, RIFTER, w);
    expect(f.ship.type_id).toBe(id('Rifter'));
    expect(f.name).toBe('Demo Rifter');
    expect(f.modules.map((m) => m.slot)).toEqual(['low', 'low', 'low', 'mid', 'mid', 'mid', 'high', 'high', 'rig']);
    expect(f.modules.find((m) => m.type_id === id('Warp Scrambler II'))?.state).toBe('offline');
    expect(f.modules.find((m) => m.type_id === id('1MN Afterburner II'))?.state).toBe('active');
    expect(f.modules.filter((m) => m.charge_type_id === id('Republic Fleet EMP S'))).toHaveLength(2);
    expect(f.drones).toEqual([{ type_id: id('Hobgoblin II'), quantity: 2, active: 2 }]);
    expect(f.cargo).toEqual([{ type_id: id('Nanite Repair Paste'), quantity: 50 }]);
    expect(w).toEqual([]);
  });
  it('web.unit.builtin-eft-mutation: mutated block resolves to the abyssal type with rolled attributes', () => {
    const f = parseEft(ds, RIFTER);
    const web = f.modules[5];
    expect(web.mutation?.base_type_id).toBe(id('Stasis Webifier II'));
    expect(web.mutation?.mutaplasmid_type_id).toBe(id('Unstable Stasis Webifier Mutaplasmid'));
    expect(ds.name(web.type_id, 'en')).toBe('Abyssal Stasis Webifier');
    expect(web.mutation?.attributes[String(ds.attrId('maxRange'))]).toBe(12000);
  });
  it('web.unit.builtin-eft-unknown-item: unknown names are warnings, not errors; unknown ship throws', () => {
    const w: string[] = [];
    const f = parseEft(ds, '[Rifter, X]\nNo Such Module II\n200mm AutoCannon II\n', w);
    expect(f.modules).toHaveLength(1);
    expect(w).toEqual(['unknown item "No Such Module II"']);
    expect(() => parseEft(ds, '[Nope, X]\n')).toThrow(/unknown ship/);
  });
  it('web.unit.builtin-eft-roundtrip: export -> import keeps every item', () => {
    const fm = builtinFormats(ds);
    const f = parseEft(ds, RIFTER);
    const text = fm.export({ name: f.name, fit: f as never }, 'eft');
    expect(text.startsWith('[Rifter, Demo Rifter]\n')).toBe(true);
    expect(text).toContain('Warp Scrambler II /OFFLINE');
    expect(text).toContain('Stasis Webifier II [1]\n');
    const back = parseEft(ds, text);
    expect(back.modules.map((m) => [m.type_id, m.state, m.charge_type_id])).toEqual(f.modules.map((m) => [m.type_id, m.state, m.charge_type_id]));
    expect(back.drones).toEqual(f.drones);
  });
  it('web.unit.builtin-multi-eft: a Pyfa multi-export splits into one fit per header', () => {
    expect(splitEft('[Rifter, A]\n200mm AutoCannon II\n\n[Merlin, B]\nLight Neutron Blaster II\n')).toHaveLength(2);
    const r = builtinFormats(ds).parse('[Rifter, A]\n200mm AutoCannon II\n\n[Merlin, B]\nLight Neutron Blaster II\n');
    expect(r.fits.map((f) => f.name)).toEqual(['A', 'B']);
  });
  it('web.unit.builtin-dna: DNA import assigns charges to compatible modules, export round trip', () => {
    const dna = `${id('Rifter')}:${id('200mm AutoCannon II')};2:${id('EMP S')};100::`;
    expect(detect(dna)).toBe('dna');
    const f = parseDna(ds, dna);
    expect(f.modules.map((m) => m.charge_type_id)).toEqual([id('EMP S'), id('EMP S')]);
    expect(exportDna(f)).toBe(dna);
  });
  it('web.unit.builtin-esi: ESI fitting JSON round trip (slots from flags, drone bay)', () => {
    const fm = builtinFormats(ds);
    const f = parseEft(ds, RIFTER);
    const j = JSON.parse(fm.export({ name: 'E', fit: f as never }, 'esi'));
    expect(j.ship_type_id).toBe(id('Rifter'));
    expect(j.items.find((i: { flag: string }) => i.flag === 'HiSlot0').type_id).toBe(id('200mm AutoCannon II'));
    const back = fm.parse(JSON.stringify(j), 'auto').fits[0];
    expect(back.modules.map((m) => m.slot).sort()).toEqual(f.modules.map((m) => m.slot).sort());
  });
  it('web.unit.builtin-limits: Pyfa-only formats need the exfa-formats module', () => {
    const fm = builtinFormats(ds);
    expect(() => fm.parse('<?xml version="1.0"?><fittings/>', 'xml')).toThrow(/exfa-formats/);
    expect(() => fm.export({ name: 'x', fit: parseEft(ds, RIFTER) as never }, 'shipstats')).toThrow(/exfa-formats/);
  });
});
