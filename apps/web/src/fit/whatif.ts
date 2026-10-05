// What-if scenarios: variants of one fit, each built by applying edits to a copy, computed through the engine and
// shown as deltas against the base fit.
import type { Dataset } from '../data/dataset';
import type { Fit, ModState } from './model';
import { defaultState } from './states';

export type Edit =
  | { op: 'replace'; index: number; type_id: number }
  | { op: 'charge'; index: number; charge_type_id: number | null; all?: boolean }
  | { op: 'state'; index: number; state: ModState }
  | { op: 'remove'; index: number }
  | { op: 'character'; character_id: string }
  | { op: 'drones'; type_id: number; active: number };
export interface Scenario { id: string; label: string; edits: Edit[] }

/** Apply edits to a copy of the fit. Out-of-range indices are ignored. Replacing keeps a still-compatible charge. */
export function applyEdits(ds: Dataset, fit: Fit, edits: Edit[]): Fit {
  const f: Fit = structuredClone(fit);
  const removed = new Set<number>();
  for (const e of edits) {
    if ('index' in e && !f.modules[e.index]) continue;
    switch (e.op) {
      case 'replace': {
        const m = f.modules[e.index];
        const keep = m.charge_type_id != null && ds.chargesFor(e.type_id).includes(m.charge_type_id) ? m.charge_type_id : null;
        f.modules[e.index] = { type_id: e.type_id, slot: ds.slot(e.type_id) ?? m.slot, state: m.state === 'offline' ? 'offline' : defaultState(ds, e.type_id), charge_type_id: keep, mutation: null };
        break;
      }
      case 'charge': {
        const tid = f.modules[e.index].type_id;
        f.modules.forEach((m, i) => { if (i === e.index || (e.all && m.type_id === tid)) m.charge_type_id = e.charge_type_id; });
        break;
      }
      case 'state': f.modules[e.index].state = e.state; break;
      case 'remove': removed.add(e.index); break;
      case 'character': f.character_id = e.character_id; break;
      case 'drones': f.drones = f.drones.map((d) => (d.type_id === e.type_id ? { ...d, active: Math.max(0, Math.min(d.quantity, e.active)) } : d)); break;
    }
  }
  if (removed.size) f.modules = f.modules.filter((_, i) => !removed.has(i));
  return f;
}

/** One scenario per meta variation of module `index` (Pyfa's "variations" menu), the current type excluded. */
export function variationScenarios(ds: Dataset, fit: Fit, index: number): Scenario[] {
  const m = fit.modules[index];
  if (!m) return [];
  const base = m.mutation ? m.mutation.base_type_id : m.type_id;
  return ds.variations(base).filter((v) => v !== m.type_id && ds.slot(v) === m.slot)
    .map((v) => ({ id: `var-${index}-${v}`, label: ds.name(v), edits: [{ op: 'replace', index, type_id: v }] }));
}
/** One scenario per compatible charge, loaded into every module of the same type. */
export function chargeScenarios(ds: Dataset, fit: Fit, index: number): Scenario[] {
  const m = fit.modules[index];
  if (!m) return [];
  return ds.chargesFor(m.type_id).filter((c) => c !== m.charge_type_id)
    .map((c) => ({ id: `chg-${index}-${c}`, label: ds.name(c), edits: [{ op: 'charge', index, charge_type_id: c, all: true }] }));
}
/** Each module offline in turn (what each one contributes). */
export function offlineScenarios(ds: Dataset, fit: Fit): Scenario[] {
  return fit.modules.flatMap((m, i) => (m.state === 'offline' ? [] : [{ id: `off-${i}`, label: `${ds.name(m.type_id)} #${i + 1} offline`, edits: [{ op: 'state', index: i, state: 'offline' } as Edit] }]));
}
/** The fit with other characters (skill levels). */
export function characterScenarios(chars: { id: string; name: string }[], fit: Fit): Scenario[] {
  return chars.filter((c) => c.id !== fit.character_id).map((c) => ({ id: `chr-${c.id}`, label: c.name, edits: [{ op: 'character', character_id: c.id }] }));
}
