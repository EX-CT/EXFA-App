import { describe, expect, it } from 'vitest';
import { id, miniDataset } from '../test/fixture';

const ds = miniDataset();
describe('dataset chargesFor (charge picker)', () => {
  it('web.unit.charges-valid-only: the charge picker offers only charges of the module charge groups, size and capacity', () => {
    for (const mod of ['200mm AutoCannon II', 'Light Neutron Blaster II', 'Heavy Neutron Blaster II']) {
      const m = id(mod);
      const groups = [1, 2, 3, 4, 5, 6].map((i) => ds.attr(m, `chargeGroup${i}`)).filter(Boolean);
      const size = ds.attr(m, 'chargeSize'), cap = ds.type(m)?.capacity ?? 0;
      const cs = ds.chargesFor(m);
      expect(cs.length).toBeGreaterThan(0);
      for (const c of cs) {
        expect(groups).toContain(ds.type(c)!.group);
        if (size) expect(ds.attr(c, 'chargeSize') ?? size).toBe(size);
        expect(ds.type(c)!.volume ?? 0).toBeLessThanOrEqual(cap);
      }
    }
    expect(ds.chargesFor(id('Light Neutron Blaster II'))).not.toContain(id('Void M'));
    expect(ds.chargesFor(id('Heavy Neutron Blaster II'))).toContain(id('Void M'));
    expect(ds.chargesFor(id('200mm AutoCannon II'))).not.toContain(id('Void M'));
  });
});
