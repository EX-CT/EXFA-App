import { describe, expect, it } from 'vitest';
import { compareTable, METRICS, metric } from './metrics';

const st = (dps: number, align: number, viol = 0) => ({ offense: { total: { dps: { total: dps } } }, navigation: { align_time_s: align }, violations: Array(viol).fill({}) });

describe('fit/metrics compareTable', () => {
  it('web.unit.compare-best-delta: best per direction (high dps, low align) and deltas vs the first fit', () => {
    const rows = compareTable([st(100, 5), st(150, 4), st(120, 6)] as never);
    const dps = rows.find((r) => r.metric.key === 'dps')!, al = rows.find((r) => r.metric.key === 'align')!;
    expect(dps.best).toEqual([1]);
    expect(dps.delta).toEqual([0, 50, 20]);
    expect(al.best).toEqual([1]);
  });
  it('web.unit.compare-ties-missing: equal values mark no best; all-zero rows dropped; errored stats are missing', () => {
    const rows = compareTable([st(100, 5), st(100, 5), { error: { code: 'X' } }] as never);
    expect(rows.find((r) => r.metric.key === 'dps')!.best).toEqual([]);
    expect(rows.find((r) => r.metric.key === 'dps')!.values[2]).toBeNull();
    expect(rows.some((r) => r.metric.key === 'violations')).toBe(false);
  });
  it('web.unit.metric-lock-range-km: lock range is reported in km', () => {
    expect(metric('lock_range')!.get({ targeting: { max_range_m: 45000 } } as never)).toBe(45);
  });
  it('web.unit.category-metrics: compare-strip range, tracking, active tank, cap time and price are available', () => {
    const stats = {
      offense: { weapons: [{ module_index: 0, kind: 'turret', optimal_m: 12000, falloff_m: 8000, tracking: 0.25 }, { module_index: 1, kind: 'missile', range_m: 26000, tracking: 0.5 }] },
      defense: { tank: { active_effective: { em: 12, thermal: 8 } } },
      capacitor: { depletes_in_s: 45 },
      price: { total_isk: 123456 },
      modules: [{ module_index: 0, range_m: 10000 }, { module_index: 1, range_m: 30000 }],
    };
    expect(metric('weapon_range')!.get(stats as never)).toBe(26);
    expect(metric('weapon_range')!.get(stats as never, 0)).toBe(20);
    expect(metric('tracking')!.get(stats as never)).toBe(0.5);
    expect(metric('tracking')!.get(stats as never, 0)).toBe(0.25);
    expect(metric('module_range')!.get(stats as never, 0)).toBe(10);
    expect(metric('active_tank')!.get(stats as never)).toBe(20);
    expect(metric('cap_time')!.get(stats as never)).toBe(45);
    expect(metric('price')!.get(stats as never)).toBe(123456);
    expect(METRICS.every((item) => item.better === 'high' || item.better === 'low')).toBe(true);
  });
});
