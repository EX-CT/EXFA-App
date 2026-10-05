// FitRequest JSON (engine contract / exfa-formats output, optional fields may be null or missing) <-> StructuredFit.
import type { Dataset, Slot } from '../data/dataset';
import { defaultState } from '../fit/states';
import type { ModState, StructuredFit, StructuredMutation } from './types';

const STATES: ModState[] = ['offline', 'online', 'active', 'overheated'];
const mutation = (m: any): StructuredMutation | null =>
  m && m.base_type_id && m.mutaplasmid_type_id ? { base_type_id: m.base_type_id, mutaplasmid_type_id: m.mutaplasmid_type_id, attributes: { ...(m.attributes ?? {}) } } : null;

/** Normalise a FitRequest-shaped object (missing slot -> from the dataset, missing state -> Pyfa default state,
 *  fighter squadron size -> the type's max) into a StructuredFit. Modules without a slot are dropped with a warning. */
export function requestToStructured(ds: Dataset, req: any, name?: string | null, notes?: string | null, warnings: string[] = []): StructuredFit {
  const sf: StructuredFit = {
    name: name || req.name || `${ds.name(req.ship?.type_id, 'en')} fit`,
    ship: { type_id: req.ship?.type_id, mode_type_id: req.ship?.mode_type_id ?? null },
    modules: [], drones: [], fighters: [], implants: [...(req.implants ?? [])],
    boosters: (req.boosters ?? []).map((b: any) => ({ type_id: b.type_id, side_effects: [...(b.side_effects ?? [])] })),
    cargo: (req.cargo ?? []).map((c: any) => ({ type_id: c.type_id, quantity: c.quantity ?? 1 })),
  };
  const n = notes ?? req.notes;
  if (n) sf.notes = n;
  for (const m of req.modules ?? []) {
    const slot: Slot | null = m.slot ?? ds.slot(m.type_id);
    if (!slot) { warnings.push(`${ds.name(m.type_id, 'en')} is not a fittable module`); continue; }
    sf.modules.push({ type_id: m.type_id, slot, state: STATES.includes(m.state) ? m.state : defaultState(ds, m.type_id), charge_type_id: m.charge_type_id ?? null, mutation: mutation(m.mutation) });
  }
  for (const d of req.drones ?? []) sf.drones.push({ type_id: d.type_id, quantity: d.quantity ?? 1, active: d.active ?? d.quantity ?? 1, ...(mutation(d.mutation) ? { mutation: mutation(d.mutation) } : {}) });
  for (const f of req.fighters ?? []) sf.fighters.push({ type_id: f.type_id, quantity: f.quantity ?? ds.attr(f.type_id, 'fighterSquadronMaxSize') ?? 1, active: f.active ?? true, abilities: f.abilities ?? null });
  return sf;
}
