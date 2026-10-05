import { describe, expect, it } from 'vitest';
import { compareTable, metric } from './metrics';

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
});
