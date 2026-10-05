import type { Dataset } from '../data/dataset';
import type { ModState } from '../formats/types';

/** Pyfa-like default state of a newly fitted module: modules that can be activated are active, passive ones online. */
export function defaultState(ds: Dataset, id: number): ModState {
  const t = ds.type(id);
  if (!t) return 'online';
  const activatable = t.effects.some(([e]) => { const c = ds.raw.effects[e]?.category; return c === 1 || c === 2 || c === 3; });
  return activatable ? 'active' : 'online';
}
