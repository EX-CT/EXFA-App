// UI-side fit model and its conversion into a stateless FitRequest (EXFA-Docs 05-api-schema, contract 1.4.2).
import type { Slot } from '../data/dataset';

export type ModState = 'offline' | 'online' | 'active' | 'overheated';
export interface Mutation { base_type_id: number; mutaplasmid_type_id: number; attributes: Record<string, number> }
export interface FitModule { type_id: number; slot: Slot; state: ModState; charge_type_id?: number | null; mutation?: Mutation | null; spool?: number | null }
export interface FitDrone { type_id: number; quantity: number; active: number; mutation?: Mutation | null }
export interface FitFighter { type_id: number; quantity: number; active: boolean; abilities?: number[] | null }
export interface FitBooster { type_id: number; side_effects?: number[] }
export interface Projected {
  kind: 'module' | 'drone' | 'fighter' | 'fit';
  type_id?: number; state?: ModState; charge_type_id?: number | null; quantity?: number; fit_id?: string;
  amount: number; distance_m: number | null;
}
export interface Fit {
  id: string; name: string; ship_type_id: number; mode_type_id?: number | null;
  modules: FitModule[]; drones: FitDrone[]; fighters: FitFighter[]; implants: number[]; boosters: FitBooster[];
  cargo: { type_id: number; quantity: number }[];
  projected: Projected[];
  fleet: { booster_fit_ids: string[]; buffs: { buff_id: number; value: number }[] };
  environment: number[]; system_security: 'hisec' | 'lowsec' | 'nullsec' | 'wspace' | null;
  character_id: string; damage_pattern_id: string; target_profile_id: string;
  options: { factor_reload: boolean; spool: number; rah: 'adapt' | 'disable' };
  notes?: string;
  /** Pyfa-style attribute overrides: base value of an attribute for every item of a type in this fit */
  overrides?: { type_id: number; attribute_id: number; value: number }[];
  /** fit library: folder path ("PvP/Frigates", "" or absent = top level), free tags, timestamps (ISO) */
  folder?: string; tags?: string[]; created?: string; modified?: string;
}
export interface Character { id: string; name: string; default_level: number; levels: Record<string, number>; security_status?: number | null; builtin?: boolean }
export interface DamagePattern { id: string; name: string; em: number; thermal: number; kinetic: number; explosive: number; builtin?: boolean }
export interface TargetProfile { id: string; name: string; em: number; thermal: number; kinetic: number; explosive: number;
  signature_radius?: number | null; max_velocity?: number | null; radius?: number | null; builtin?: boolean }

export const uid = () => Math.random().toString(36).slice(2, 10);

export function newFit(ship: number, name = 'New fit'): Fit {
  return {
    id: uid(), name, ship_type_id: ship, mode_type_id: null, modules: [], drones: [], fighters: [], implants: [], boosters: [],
    cargo: [], projected: [], fleet: { booster_fit_ids: [], buffs: [] }, environment: [], system_security: null,
    character_id: 'all5', damage_pattern_id: 'uniform', target_profile_id: 'none',
    options: { factor_reload: false, spool: 1, rah: 'adapt' },
  };
}

export interface Library {
  fits: Record<string, Fit>; characters: Record<string, Character>;
  damagePatterns: Record<string, DamagePattern>; targetProfiles: Record<string, TargetProfile>;
  /** folder paths of the fit library, kept even when empty */
  folders?: string[];
}

function moduleReq(m: FitModule) {
  return {
    type_id: m.type_id, slot: m.slot, state: m.state, charge_type_id: m.charge_type_id ?? null, mutation: m.mutation ?? null,
    spool: m.spool != null ? { type: 'spool_scale', amount: m.spool } : null,
  };
}

/** UI fit -> FitRequest. `depth` guards nested fits (projected / fleet booster fits are one level deep, as in Pyfa). */
export function toRequest(fit: Fit, lib: Library, depth = 0): Record<string, unknown> {
  const ch = lib.characters[fit.character_id] ?? lib.characters['all5'];
  const dp = lib.damagePatterns[fit.damage_pattern_id];
  const tp = lib.targetProfiles[fit.target_profile_id];
  const nested = (id: string) => (depth === 0 && lib.fits[id] ? toRequest(lib.fits[id], lib, depth + 1) : null);
  const projected = depth > 0 ? [] : fit.projected.flatMap((p): Record<string, unknown>[] => {
    const base = { amount: p.amount, distance_m: p.distance_m };
    if (p.kind === 'fit') { const f = p.fit_id ? nested(p.fit_id) : null; return f ? [{ kind: 'fit', fit: f, ...base }] : []; }
    if (p.kind === 'drone') return [{ kind: 'drone', drone: { type_id: p.type_id, quantity: p.quantity ?? 1, active: p.quantity ?? 1 }, ...base }];
    if (p.kind === 'fighter') return [{ kind: 'fighter', fighter: { type_id: p.type_id, quantity: p.quantity ?? 1, active: true, abilities: null }, ...base }];
    return [{ kind: 'module', module: { type_id: p.type_id, state: p.state ?? 'active', charge_type_id: p.charge_type_id ?? null }, ...base }];
  });
  return {
    schema_version: 1,
    ship: { type_id: fit.ship_type_id, mode_type_id: fit.mode_type_id ?? null },
    character: { skills: { default_level: ch?.default_level ?? 5, levels: ch?.levels ?? {} }, security_status: ch?.security_status ?? null },
    modules: fit.modules.map(moduleReq),
    drones: fit.drones.map((d) => ({ type_id: d.type_id, quantity: d.quantity, active: d.active, ...(d.mutation ? { mutation: d.mutation } : {}) })),
    fighters: fit.fighters.map((f) => ({ type_id: f.type_id, quantity: f.quantity, active: f.active, abilities: f.abilities ?? null })),
    implants: fit.implants,
    boosters: fit.boosters.map((b) => ({ type_id: b.type_id, side_effects: b.side_effects ?? [] })),
    cargo: fit.cargo,
    fleet: {
      buffs: fit.fleet.buffs,
      booster_fits: depth > 0 ? [] : fit.fleet.booster_fit_ids.map(nested).filter((x) => x),
    },
    projected,
    environment: { effect_type_ids: fit.environment, system_security: fit.system_security },
    damage_pattern: dp && dp.id !== 'uniform' ? { em: dp.em, thermal: dp.thermal, kinetic: dp.kinetic, explosive: dp.explosive } : null,
    target_profile: tp && tp.id !== 'none'
      ? { em: tp.em, thermal: tp.thermal, kinetic: tp.kinetic, explosive: tp.explosive, signature_radius: tp.signature_radius ?? null,
          max_velocity: tp.max_velocity ?? null, radius: tp.radius ?? null }
      : null,
    overrides: fit.overrides ?? [],
    options: {
      factor_reload: fit.options.factor_reload, default_spool: { type: 'spool_scale', amount: fit.options.spool },
      rah: fit.options.rah, include_attributes: 'none', sources: false, validate: true,
      cap_sim: { reload: false, stagger: false, max_time_s: null },
    },
  };
}

/** Rack position (Pyfa: drag a module onto another slot of the same rack): the module at `from` takes the place of the
 *  module at `to` and they swap; `to` = null moves it to the end of its rack. Positions in other racks are unchanged.
 *  The order inside a rack is the slot order the engine sees (it matters for overheat damage). */
export function moveModule(fit: Fit, from: number, to: number | null): Fit {
  const a = fit.modules[from];
  if (!a || from === to) return fit;
  if (to == null) {
    const rest = fit.modules.filter((_, i) => i !== from);
    let last = -1;
    rest.forEach((m, i) => { if (m.slot === a.slot) last = i; });
    const at = last < 0 ? rest.length : last + 1;
    return { ...fit, modules: [...rest.slice(0, at), a, ...rest.slice(at)] };
  }
  const b = fit.modules[to];
  if (!b || b.slot !== a.slot) return fit;
  const modules = fit.modules.slice();
  modules[from] = b; modules[to] = a;
  return { ...fit, modules };
}
