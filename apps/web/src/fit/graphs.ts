// Graph series computed in the UI from one engine response (FitStats) using public EVE formulas
// (EVE University wiki / CCP dev blogs): turret hit chance, missile application, capacitor and shield regen
// curves, align/speed, lock time. They are presentation-level approximations, not engine output.
import type { Dataset } from '../data/dataset';
import type { FitStats } from '../engine/adapter';

export interface Series { name: string; points: [number, number][]; dash?: string; color?: number }
export interface Target { signature_radius: number; velocity: number }

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function turretChance(w: any, d: number, t: Target | null): number {
  const opt = w.optimal_m ?? 0, fo = w.falloff_m ?? 0;
  const rangeTerm = fo > 0 ? Math.max(0, d - opt) / fo : d > opt ? Infinity : 0;
  let trackTerm = 0;
  if (t && t.velocity > 0 && w.tracking > 0 && d > 0) {
    const angular = t.velocity / d; // rad/s, full transversal
    trackTerm = (angular * 40000) / (w.tracking * t.signature_radius);
  }
  return Math.pow(0.5, trackTerm * trackTerm + rangeTerm * rangeTerm);
}

export function missileFactor(ds: Dataset, w: any, t: Target | null): number {
  if (!t) return 1;
  const er = w.explosion_radius ?? 0, ev = w.explosion_velocity ?? 0;
  if (!er) return 1;
  const drf = (w.charge_type_id && ds.attr(w.charge_type_id, 'aoeDamageReductionFactor')) || 0.5;
  const a = t.signature_radius / er;
  const b = t.velocity > 0 ? Math.pow((t.signature_radius * ev) / (er * t.velocity), drf) : Infinity;
  return Math.min(1, a, b);
}

/** DPS vs distance: turrets (range + tracking), missiles (flight range, application), drones (within control range). */
export function dpsVsRange(ds: Dataset, st: FitStats, t: Target | null, maxRange?: number): Series[] {
  const weapons: any[] = st.offense?.weapons ?? [];
  const drones: any[] = st.offense?.drones ?? [];
  const ctrl = st.drones?.control_range_m ?? 0;
  const far = maxRange ?? Math.max(10000, ...weapons.map((w) => (w.optimal_m ?? 0) + 2 * (w.falloff_m ?? 0)), ...weapons.map((w) => w.range_m ?? 0), drones.length ? ctrl : 0) * 1.1;
  const xs = Array.from({ length: 121 }, (_, i) => (far * i) / 120);
  const dps = (w: any, d: number) => {
    const total = w.dps?.total ?? 0;
    if (w.kind === 'turret') return total * turretChance(w, d, t);
    if (w.kind === 'missile') return d <= (w.range_m ?? Infinity) ? total * missileFactor(ds, w, t) : 0;
    if (w.optimal_m != null) return total * turretChance(w, d, null);
    return total;
  };
  const wSeries: [number, number][] = xs.map((d) => [d, sum(weapons.map((w) => dps(w, d)))]);
  const dSeries: [number, number][] = xs.map((d) => [d, d <= ctrl ? sum(drones.map((x) => (x.dps?.total ?? 0) * (t && x.tracking ? turretChance({ ...x, optimal_m: Infinity }, Math.max(d, 1000), t) : 1))) : 0]);
  const out: Series[] = [{ name: 'weapons', points: wSeries }];
  if (drones.length) out.push({ name: 'drones', points: dSeries }, { name: 'total', points: xs.map((d, i) => [d, wSeries[i][1] + dSeries[i][1]]) });
  return out;
}

/** Capacitor (GJ) vs time with the average use rate from the engine: dC/dt = 10·Cmax/τ·(√c − c) − use. */
export function capVsTime(st: FitStats, seconds?: number): Series[] {
  const c = st.capacitor ?? {};
  const cmax = c.capacity ?? 0, tau = c.recharge_time_s ?? 0, use = (c.use_gj_s ?? 0) - (c.injected_gj_s ?? 0);
  if (!cmax || !tau) return [];
  const T = seconds ?? Math.min(Math.max(c.depletes_in_s ? c.depletes_in_s * 1.2 : tau * 1.5, 60), 3600);
  const pts: [number, number][] = [];
  let C = cmax;
  const dt = T / 2000;
  for (let i = 0; i <= 2000; i++) {
    if (i % 10 === 0) pts.push([i * dt, C]);
    const f = Math.max(C / cmax, 0);
    C = Math.min(cmax, Math.max(0, C + (10 * cmax / tau * (Math.sqrt(f) - f) - use) * dt));
  }
  return [{ name: 'capacitor GJ', points: pts }];
}

/** Regeneration rate vs fill level: 10·X/τ·(√p − p) for capacitor and (via passive peak) shield. */
export function regenVsPercent(st: FitStats): Series[] {
  const out: Series[] = [];
  const c = st.capacitor ?? {};
  if (c.capacity && c.recharge_time_s) out.push({ name: 'capacitor GJ/s', points: pct((p) => (10 * c.capacity / c.recharge_time_s) * (Math.sqrt(p) - p)) });
  const peak = st.defense?.tank?.raw?.passive_shield, hp = st.defense?.hp?.shield;
  if (peak && hp) out.push({ name: 'shield HP/s', points: pct((p) => peak * 4 * (Math.sqrt(p) - p)) });
  return out;
}
const pct = (f: (p: number) => number): [number, number][] => Array.from({ length: 101 }, (_, i) => [i, f(i / 100)]);

/** Speed and distance vs time from standstill: v(t) = vmax·(1 − e^(−t·1e6/(m·agility))). */
export function mobility(st: FitStats): Series[] {
  const n = st.navigation ?? {};
  const v = n.max_velocity ?? 0, k = (n.mass ?? 0) * (n.agility ?? 0) / 1e6;
  if (!v || !k) return [];
  const T = Math.max(n.align_time_s ?? 10, 5) * 2.5;
  const xs = Array.from({ length: 101 }, (_, i) => (T * i) / 100);
  return [
    { name: 'speed m/s', points: xs.map((t) => [t, v * (1 - Math.exp(-t / k))]) },
    { name: 'distance km', points: xs.map((t) => [t, (v * (t - k * (1 - Math.exp(-t / k)))) / 1000]) },
  ];
}

/** Lock time vs target signature: 40000 / (scanRes · asinh(sig)²), capped at 1800 s. */
export function lockTime(st: FitStats): Series[] {
  const sr = st.targeting?.scan_resolution ?? 0;
  if (!sr) return [];
  return [{ name: 'lock time s', points: Array.from({ length: 100 }, (_, i) => { const sig = 10 + i * 10; const a = Math.asinh(sig); return [sig, Math.min(40000 / sr / (a * a), 1800)] as [number, number]; }) }];
}

/** Warp time vs distance (EVE warp profile: accel k=warp speed, decel k=min(warp/3, 2), max subwarp 1/2 speed exit). */
export function warpTime(st: FitStats): Series[] {
  const n = st.navigation ?? {};
  const vw = (n.warp_speed_au_s ?? 0) * 149597870700; // m/s
  const vs = n.max_velocity ?? 0;
  if (!vw || !vs) return [];
  const ka = n.warp_speed_au_s, kd = Math.min(ka / 3, 2);
  const AU = 149597870700;
  const time = (dist: number) => {
    const accelDist = vw / ka, decelDist = vw / kd;
    const minDist = accelDist + decelDist;
    if (dist < minDist) {
      const vmax = (dist * ka * kd) / (ka + kd);
      return Math.log(vmax / ka) / ka + Math.log(vmax / Math.min(vs / 2, 100)) / kd;
    }
    return Math.log(vw / ka) / ka + (dist - minDist) / vw + Math.log(vw / Math.min(vs / 2, 100)) / kd;
  };
  return [{ name: 'warp time s', points: Array.from({ length: 100 }, (_, i) => { const au = 0.5 + i * 0.5; return [au, time(au * AU)] as [number, number]; }) }];
}
