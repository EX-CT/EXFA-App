import type { Dataset } from '../data/dataset';
import type { ModState } from '../formats/types';

export const STATES: ModState[] = ['offline', 'online', 'active', 'overheated'];

/** States a type can actually be put in — mirrors the engine's normalisation (contract 1.4.6):
 *  active needs an activatable effect (cat 1|2) and activationBlocked <= 0; overheated needs an
 *  overload effect (cat 5) on top of that. Edit-time constraint so the UI never offers a state
 *  the engine would have to correct. */
export function allowedStates(ds: Dataset, id: number): ModState[] {
  const t = ds.type(id);
  if (!t) return ['offline', 'online'];
  const cats = t.effects.map(([e]) => ds.raw.effects[e]?.category);
  const active = cats.some((c) => c === 1 || c === 2) && (ds.attr(id, 'activationBlocked') ?? 0) <= 0;
  if (!active) return ['offline', 'online'];
  return cats.some((c) => c === 5) ? ['offline', 'online', 'active', 'overheated'] : ['offline', 'online', 'active'];
}

/** Pyfa-like default state of a newly fitted module: modules that can be activated are active, passive ones online. */
export function defaultState(ds: Dataset, id: number): ModState {
  return allowedStates(ds, id).includes('active') ? 'active' : 'online';
}
