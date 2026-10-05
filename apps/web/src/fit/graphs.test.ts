import { describe, expect, it } from 'vitest';
import { lockTime, turretChance, capVsTime } from './graphs';

describe('fit/graphs (UI approximations)', () => {
  it('web.unit.graph-turret-chance: hit chance 1 in optimal, 0.5 at optimal + falloff, lower with tracking', () => {
    const w = { optimal_m: 1000, falloff_m: 5000, tracking: 0.1 };
    expect(turretChance(w, 500, null)).toBe(1);
    expect(turretChance(w, 6000, null)).toBeCloseTo(0.5, 12);
    expect(turretChance(w, 1000, { signature_radius: 40, velocity: 400 })).toBeLessThan(1);
  });
  it('web.unit.graph-lock-time: 40000 / scanRes / asinh(sig)^2, capped at 1800 s', () => {
    const s = lockTime({ targeting: { scan_resolution: 500 } } as never)[0].points;
    expect(s[0][1]).toBeCloseTo(40000 / 500 / Math.asinh(10) ** 2, 12);
    expect(lockTime({ targeting: { scan_resolution: 0.001 } } as never)[0].points[0][1]).toBe(1800);
  });
  it('web.unit.graph-cap-stable: a fit with no cap use stays full', () => {
    const s = capVsTime({ capacitor: { capacity: 400, recharge_time_s: 150, use_gj_s: 0 } } as never, 300)[0].points;
    expect(s.every(([, c]) => Math.abs(c - 400) < 1e-9)).toBe(true);
  });
});
