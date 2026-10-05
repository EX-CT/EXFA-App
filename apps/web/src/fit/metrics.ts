// Named fit metrics read from FitStats, shared by the compare and what-if views: value, unit, which direction is
// better, display precision.
import type { FitStats } from '../engine/adapter';

export interface Metric { key: string; label: string; unit: string; better: 'high' | 'low' | null; digits: number; get: (s: FitStats) => number | null | undefined }
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const sum = (o: Record<string, unknown> | undefined) => (o ? Object.values(o).reduce((a: number, v) => a + (n(v) ?? 0), 0) : null);

export const METRICS: Metric[] = [
  { key: 'dps', label: 'DPS', unit: 'HP/s', better: 'high', digits: 1, get: (s) => n(s.offense?.total?.dps?.total) },
  { key: 'weapon_dps', label: 'Weapon DPS', unit: 'HP/s', better: 'high', digits: 1, get: (s) => n(s.offense?.total?.weapon_dps) },
  { key: 'drone_dps', label: 'Drone DPS', unit: 'HP/s', better: 'high', digits: 1, get: (s) => n(s.offense?.total?.drone_dps) },
  { key: 'volley', label: 'Volley', unit: 'HP', better: 'high', digits: 0, get: (s) => n(s.offense?.total?.volley?.total) },
  { key: 'dps_vs_target', label: 'DPS vs target', unit: 'HP/s', better: 'high', digits: 1, get: (s) => n(s.offense?.vs_target_profile?.dps) },
  { key: 'ehp', label: 'EHP', unit: 'HP', better: 'high', digits: 0, get: (s) => n(s.defense?.ehp?.total) },
  { key: 'ehp_shield', label: 'Shield EHP', unit: 'HP', better: 'high', digits: 0, get: (s) => n(s.defense?.ehp?.shield) },
  { key: 'ehp_armor', label: 'Armor EHP', unit: 'HP', better: 'high', digits: 0, get: (s) => n(s.defense?.ehp?.armor) },
  { key: 'ehp_hull', label: 'Hull EHP', unit: 'HP', better: 'high', digits: 0, get: (s) => n(s.defense?.ehp?.hull) },
  { key: 'tank', label: 'Effective tank', unit: 'HP/s', better: 'high', digits: 1, get: (s) => sum(s.defense?.tank?.effective) },
  { key: 'tank_sustained', label: 'Sustained tank', unit: 'HP/s', better: 'high', digits: 1, get: (s) => sum(s.defense?.tank?.sustained_effective) },
  { key: 'cap_delta', label: 'Cap Δ', unit: 'GJ/s', better: 'high', digits: 2, get: (s) => n(s.capacitor?.delta_gj_s) },
  { key: 'cap_stable', label: 'Cap stable at', unit: '%', better: 'high', digits: 1, get: (s) => (s.capacitor?.stable ? n(s.capacitor?.stable_percent) : 0) },
  { key: 'speed', label: 'Max velocity', unit: 'm/s', better: 'high', digits: 0, get: (s) => n(s.navigation?.max_velocity) },
  { key: 'align', label: 'Align time', unit: 's', better: 'low', digits: 2, get: (s) => n(s.navigation?.align_time_s) },
  { key: 'sig', label: 'Signature', unit: 'm', better: 'low', digits: 0, get: (s) => n(s.navigation?.signature_radius) },
  { key: 'scan_res', label: 'Scan resolution', unit: 'mm', better: 'high', digits: 0, get: (s) => n(s.targeting?.scan_resolution) },
  { key: 'lock_range', label: 'Lock range', unit: 'km', better: 'high', digits: 1, get: (s) => { const v = n(s.targeting?.max_range_m); return v == null ? null : v / 1000; } },
  { key: 'cpu_left', label: 'CPU left', unit: 'tf', better: 'high', digits: 1, get: (s) => { const r = s.resources?.cpu; return r ? (n(r.total) ?? 0) - (n(r.used) ?? 0) : null; } },
  { key: 'pg_left', label: 'Powergrid left', unit: 'MW', better: 'high', digits: 1, get: (s) => { const r = s.resources?.power; return r ? (n(r.total) ?? 0) - (n(r.used) ?? 0) : null; } },
  { key: 'violations', label: 'Problems', unit: '', better: 'low', digits: 0, get: (s) => (Array.isArray(s.violations) ? s.violations.length : 0) },
];
export const metric = (k: string) => METRICS.find((m) => m.key === k);

export interface CompareRow { metric: Metric; values: (number | null)[]; best: number[]; delta: (number | null)[] }
/** metric x fit table: values, indices of the best fit(s) and deltas against the first column. Rows where every
 *  value is missing or zero are dropped. Errored stats count as missing. */
export function compareTable(stats: (FitStats | null)[], metrics: Metric[] = METRICS): CompareRow[] {
  const rows: CompareRow[] = [];
  for (const m of metrics) {
    const values = stats.map((s) => (s && !s.error ? m.get(s) ?? null : null));
    if (values.every((v) => v == null || v === 0)) continue;
    const present = values.filter((v): v is number => v != null);
    const bestV = m.better === 'high' ? Math.max(...present) : m.better === 'low' ? Math.min(...present) : null;
    const best = bestV == null || present.every((v) => v === bestV) ? [] : values.flatMap((v, i) => (v === bestV ? [i] : []));
    const base = values[0];
    rows.push({ metric: m, values, best, delta: values.map((v) => (v == null || base == null ? null : v - base)) });
  }
  return rows;
}
