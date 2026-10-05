import { describe, expect, it } from 'vitest';
import { id, miniDataset } from '../test/fixture';
import { newFit } from './model';
import { applyEdits, chargeScenarios, offlineScenarios, variationScenarios } from './whatif';

const ds = miniDataset();
const rifter = () => {
  const f = newFit(id('Rifter'), 'R');
  f.modules = [
    { type_id: id('200mm AutoCannon II'), slot: 'high', state: 'active', charge_type_id: id('EMP S') },
    { type_id: id('200mm AutoCannon II'), slot: 'high', state: 'active', charge_type_id: id('EMP S') },
    { type_id: id('Gyrostabilizer II'), slot: 'low', state: 'online', charge_type_id: null },
  ];
  return f;
};

describe('fit/whatif', () => {
  it('web.unit.whatif-variations: meta variations of a module, the fitted type excluded, charge kept', () => {
    const f = rifter();
    const sc = variationScenarios(ds, f, 0);
    expect(sc.map((s) => s.label)).toContain('200mm AutoCannon I');
    expect(sc.map((s) => s.label)).not.toContain('200mm AutoCannon II');
    const v = applyEdits(ds, f, sc.find((s) => s.label === '200mm AutoCannon I')!.edits);
    expect(v.modules[0].type_id).toBe(id('200mm AutoCannon I'));
    expect(v.modules[0].charge_type_id).toBe(id('EMP S'));
    expect(f.modules[0].type_id).toBe(id('200mm AutoCannon II'));
  });
  it('web.unit.whatif-charges: a charge scenario loads every module of that type', () => {
    const f = rifter();
    const sc = chargeScenarios(ds, f, 0).find((s) => s.label === 'Republic Fleet EMP S')!;
    const v = applyEdits(ds, f, sc.edits);
    expect(v.modules.slice(0, 2).map((m) => m.charge_type_id)).toEqual([id('Republic Fleet EMP S'), id('Republic Fleet EMP S')]);
  });
  it('web.unit.whatif-offline-remove: offline and remove edits, out-of-range indices ignored', () => {
    const f = rifter();
    expect(offlineScenarios(ds, f)).toHaveLength(3);
    const v = applyEdits(ds, f, [{ op: 'state', index: 2, state: 'offline' }, { op: 'remove', index: 0 }, { op: 'remove', index: 9 }]);
    expect(v.modules.map((m) => m.state)).toEqual(['active', 'offline']);
  });
});
