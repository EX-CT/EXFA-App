import { describe, expect, it } from 'vitest';
import { Dataset } from '../data/dataset';
import { id, miniDataset } from '../test/fixture';
import { applyMarketPick, newFit, patchFit, type FitDoc } from './model';
import { defaultState } from './states';

const ds = miniDataset();
const rifter = () => newFit(id('Rifter'), 'Rifter');
const gunFit = (): FitDoc => patchFit(rifter(), {
  modules: [
    { type_id: id('200mm AutoCannon II'), slot: 'high', state: 'offline', charge_type_id: id('EMP S'), group: 7 },
    { type_id: id('200mm AutoCannon II'), slot: 'high', state: 'active', charge_type_id: id('Republic Fleet EMP S'), group: 7 },
    { type_id: id('200mm AutoCannon II'), slot: 'high', state: 'active', charge_type_id: id('EMP S') },
    { type_id: id('Gyrostabilizer II'), slot: 'low', state: 'online', charge_type_id: null },
  ],
});

describe('fit/model applyMarketPick', () => {
  it('web.unit.market-smart-replace: Smart replaces the selected link group, keeps compatible charges and offline state', () => {
    const fit = gunFit();
    const next = applyMarketPick(ds, fit, { list: 'modules', index: 0 }, id('200mm AutoCannon I'), 'smart');
    expect(next.fit.fit.modules.slice(0, 2).map((m) => m.type_id)).toEqual([id('200mm AutoCannon I'), id('200mm AutoCannon I')]);
    expect(next.fit.fit.modules.slice(0, 2).map((m) => m.charge_type_id)).toEqual([id('EMP S'), id('Republic Fleet EMP S')]);
    expect(next.fit.fit.modules.slice(0, 2).map((m) => m.state)).toEqual(['offline', defaultState(ds, id('200mm AutoCannon I'))]);
    expect(next.fit.fit.modules[2]).toEqual(fit.fit.modules[2]);
    expect(next.note).toEqual({ kind: 'replaced', from: id('200mm AutoCannon II'), to: id('200mm AutoCannon I'), count: 2 });
    expect(next.sel).toEqual({ list: 'modules', index: 0 });
  });

  it('web.unit.market-smart-add: Smart adds with no selection or a different slot', () => {
    const fit = gunFit();
    const none = applyMarketPick(ds, fit, null, id('200mm AutoCannon I'), 'smart');
    const mismatch = applyMarketPick(ds, fit, { list: 'modules', index: 3 }, id('200mm AutoCannon I'), 'smart');
    expect(none.fit.fit.modules).toHaveLength(fit.fit.modules.length + 1);
    expect(mismatch.fit.fit.modules).toHaveLength(fit.fit.modules.length + 1);
    expect(none.fit.fit.modules.slice(0, fit.fit.modules.length)).toEqual(fit.fit.modules);
    expect(mismatch.fit.fit.modules.slice(0, fit.fit.modules.length)).toEqual(fit.fit.modules);
    expect(none.note).toEqual({ kind: 'added', typeId: id('200mm AutoCannon I') });
  });

  it('web.unit.market-replace-requires-slot: Replace without a module or with a mismatched slot does not change the fit', () => {
    const fit = gunFit();
    const none = applyMarketPick(ds, fit, null, id('200mm AutoCannon I'), 'replace');
    const mismatch = applyMarketPick(ds, fit, { list: 'modules', index: 3 }, id('200mm AutoCannon I'), 'replace');
    expect(none.fit).toBe(fit);
    expect(none.note).toEqual({ kind: 'warning', reason: 'select-same-slot' });
    expect(mismatch.fit).toBe(fit);
    expect(mismatch.note).toEqual({ kind: 'warning', reason: 'slot-mismatch' });
  });

  it('web.unit.market-replace-selected: Replace swaps the selected same-slot module', () => {
    const fit = gunFit();
    const next = applyMarketPick(ds, fit, { list: 'modules', index: 0 }, id('200mm AutoCannon I'), 'replace');
    expect(next.fit.fit.modules[0].type_id).toBe(id('200mm AutoCannon I'));
    expect(next.note).toEqual({ kind: 'replaced', from: id('200mm AutoCannon II'), to: id('200mm AutoCannon I'), count: 2 });
  });

  it('web.unit.market-add-always-adds: Add ignores a selected same-slot module', () => {
    const fit = gunFit();
    const next = applyMarketPick(ds, fit, { list: 'modules', index: 0 }, id('200mm AutoCannon I'), 'add');
    expect(next.fit.fit.modules).toHaveLength(fit.fit.modules.length + 1);
    expect(next.fit.fit.modules[0]).toEqual(fit.fit.modules[0]);
  });

  it('web.unit.market-charge-group: a selected module loads its charge into only its link group', () => {
    const fit = gunFit();
    const next = applyMarketPick(ds, fit, { list: 'modules', index: 0 }, id('Republic Fleet EMP S'), 'smart');
    expect(next.fit.fit.modules.slice(0, 3).map((m) => m.charge_type_id)).toEqual([
      id('Republic Fleet EMP S'), id('Republic Fleet EMP S'), id('EMP S'),
    ]);
    expect(next.note).toEqual({ kind: 'loaded', typeId: id('Republic Fleet EMP S') });
  });

  it('web.unit.market-charge-add: no selection and Add mode retain the existing compatible-charge behavior', () => {
    const fit = gunFit();
    const none = applyMarketPick(ds, fit, null, id('Republic Fleet EMP S'), 'smart');
    const add = applyMarketPick(ds, fit, { list: 'modules', index: 0 }, id('Republic Fleet EMP S'), 'add');
    expect(none.fit.fit.modules.slice(0, 3).map((m) => m.charge_type_id)).toEqual(Array(3).fill(id('Republic Fleet EMP S')));
    expect(add.fit.fit.modules.slice(0, 3).map((m) => m.charge_type_id)).toEqual(Array(3).fill(id('Republic Fleet EMP S')));
  });

  it('web.unit.market-charge-fallback: an incompatible selected module keeps the existing charge-add behavior', () => {
    const fit = gunFit();
    fit.fit.modules.push({ type_id: id('Heavy Neutron Blaster II'), slot: 'high', state: 'active', charge_type_id: null });
    const next = applyMarketPick(ds, fit, { list: 'modules', index: 0 }, id('Void M'), 'smart');
    expect(next.fit.fit.modules.slice(0, 3).map((m) => m.charge_type_id)).toEqual(fit.fit.modules.slice(0, 3).map((m) => m.charge_type_id));
    expect(next.fit.fit.modules[4].charge_type_id).toBe(id('Void M'));
    expect(next.note).toEqual({ kind: 'loaded', typeId: id('Void M') });
  });

  it('web.unit.market-charge-cargo: a charge with no compatible modules is added to cargo', () => {
    const fit = rifter();
    const next = applyMarketPick(ds, fit, null, id('Void M'), 'smart');
    expect(next.fit.fit.cargo).toEqual([{ id: expect.any(String), type_id: id('Void M'), quantity: 1 }]);
    expect(next.note).toEqual({ kind: 'added', typeId: id('Void M') });
  });

  it('web.unit.market-drone-replace: replacing a selected drone preserves quantity and active count', () => {
    const fit = rifter();
    fit.fit.drones = [{ type_id: id('Hobgoblin II'), quantity: 5, active: 3, mutation: null }];
    const next = applyMarketPick(ds, fit, { list: 'drones', index: 0 }, id('Warrior II'), 'smart');
    expect(next.fit.fit.drones).toEqual([{ type_id: id('Warrior II'), quantity: 5, active: 3, mutation: null }]);
    expect(next.note).toEqual({ kind: 'replaced', from: id('Hobgoblin II'), to: id('Warrior II'), count: 1 });
  });

  it('web.unit.market-drone-add: without a selected drone the existing add behavior remains', () => {
    const fit = rifter();
    fit.fit.drones = [{ type_id: id('Hobgoblin II'), quantity: 1, active: 1 }];
    const next = applyMarketPick(ds, fit, null, id('Warrior II'), 'smart');
    expect(next.fit.fit.drones.map((d) => d.type_id)).toEqual([id('Hobgoblin II'), id('Warrior II')]);
  });

  it('web.unit.market-fighter-replace: fighter replacement clamps quantity to the new squadron maximum', () => {
    const fighterId = id('Firbolg II');
    const limited = Object.create(ds) as typeof ds;
    limited.attr = (typeId: number, name: string) => typeId === id('Einherji II') && name === 'fighterSquadronMaxSize' ? 2 : ds.attr(typeId, name);
    const fit = rifter();
    fit.fit.fighters = [{ type_id: fighterId, quantity: 5, active: true, abilities: [1] }];
    const next = applyMarketPick(limited, fit, { list: 'fighters', index: 0 }, id('Einherji II'), 'replace');
    expect(next.fit.fit.fighters).toEqual([{ type_id: id('Einherji II'), quantity: 2, active: true, abilities: null }]);
  });

  it('web.unit.market-fighter-add: Add creates a squadron and does not replace a selected fighter', () => {
    const fit = rifter();
    fit.fit.fighters = [{ type_id: id('Firbolg II'), quantity: 2, active: false }];
    const next = applyMarketPick(ds, fit, { list: 'fighters', index: 0 }, id('Einherji II'), 'add');
    expect(next.fit.fit.fighters).toHaveLength(2);
    expect(next.fit.fit.fighters[0]).toEqual(fit.fit.fighters[0]);
    expect(next.fit.fit.fighters[1].quantity).toBe(ds.attr(id('Einherji II'), 'fighterSquadronMaxSize'));
  });

  it('web.unit.market-ship: selecting a ship creates a new fit', () => {
    const fit = rifter();
    const next = applyMarketPick(ds, fit, { list: 'modules', index: 0 }, id('Rifter'), 'smart');
    expect(next.fit.id).not.toBe(fit.id);
    expect(applyMarketPick(ds, fit, { list: 'modules', index: 0 }, id('Rifter'), 'smart')).toEqual(next);
    expect(next.fit.fit.ship.type_id).toBe(id('Rifter'));
    expect(next.note).toEqual({ kind: 'new-ship' });
    expect(next.sel).toBeNull();
  });

  it('web.unit.market-slot-items: implants and boosters replace the occupied slot', () => {
    const fit = rifter();
    const implantId = id('Zainou \'Snapshot\' Heavy Missiles HM-703');
    const boosterId = id('Improved Crash Booster');
    const nextImplantId = 9999991;
    const nextBoosterId = 9999992;
    const expanded = new Dataset({ ...ds.raw, types: {
      ...ds.raw.types,
      [nextImplantId]: { ...ds.raw.types[implantId], name: 'Alternate Snapshot Implant' },
      [nextBoosterId]: { ...ds.raw.types[boosterId], name: 'Alternate Crash Booster' },
    } });
    fit.fit.implants = [implantId];
    fit.fit.boosters = [{ type_id: boosterId }];
    const implant = applyMarketPick(expanded, fit, null, nextImplantId, 'add');
    const booster = applyMarketPick(expanded, fit, null, nextBoosterId, 'add');
    expect(implant.fit.fit.implants).toEqual([nextImplantId]);
    expect(implant.note).toEqual({ kind: 'replaced', from: implantId, to: nextImplantId, count: 1 });
    expect(booster.fit.fit.boosters).toEqual([{ type_id: nextBoosterId }]);
    expect(booster.note).toEqual({ kind: 'replaced', from: boosterId, to: nextBoosterId, count: 1 });
  });

  it('web.unit.market-cannot-fit: an unsupported market type leaves the fit unchanged with a warning', () => {
    const fit = rifter();
    const next = applyMarketPick(ds, fit, null, 9999999, 'smart');
    expect(next.fit).toBe(fit);
    expect(next.note).toEqual({ kind: 'warning', reason: 'cannot-fit' });
  });
});
