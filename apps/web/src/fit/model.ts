// UI-side fit model and its conversion into a stateless FitRequest (EXFA-Docs 05-api-schema, contract 1.4.2).
import type { Dataset, Slot } from '../data/dataset';
import { defaultState } from './states';

export type ModState = 'offline' | 'online' | 'active' | 'overheated';
export interface Mutation { base_type_id: number; mutaplasmid_type_id: number; attributes: Record<string, number> }
export interface FitModule { type_id: number; slot: Slot; state: ModState; charge_type_id?: number | null; mutation?: Mutation | null; spool?: number | null;
  /** Pyfa "group modules": members sharing a group id render as one stacked row and are edited together. */
  group?: number | null }
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
export type MarketMode = 'smart' | 'replace' | 'add';
export type MarketSelection = { list: 'modules' | 'drones' | 'fighters' | 'cargo'; index: number } | null;
export type MarketPickNote =
  | { kind: 'added'; typeId: number }
  | { kind: 'loaded'; typeId: number }
  | { kind: 'replaced'; from: number; to: number; count: number }
  | { kind: 'new-ship' }
  | { kind: 'warning'; reason: 'select-same-slot' | 'slot-mismatch' | 'cannot-fit' };
export interface MarketPickResult { fit: Fit; sel: MarketSelection; note: MarketPickNote | null }
export interface Character { id: string; name: string; default_level: number; levels: Record<string, number>; security_status?: number | null; builtin?: boolean;
  /** Alpha clone: engine caps every skill at its Alpha level (Pyfa alphaCloneID). */
  alpha_clone?: boolean }
export interface DamagePattern { id: string; name: string; em: number; thermal: number; kinetic: number; explosive: number; builtin?: boolean }
export interface TargetProfile { id: string; name: string; em: number; thermal: number; kinetic: number; explosive: number;
  signature_radius?: number | null; max_velocity?: number | null; radius?: number | null; builtin?: boolean }

export const uid = () => Math.random().toString(36).slice(2, 10);

/** type id of the market item being dragged (set on dragstart; HTML5 dragover can't read payload data) */
export const draggedType = { id: null as number | null };

export function newFit(ship: number, name = 'New fit', id = uid()): Fit {
  return {
    id, name, ship_type_id: ship, mode_type_id: null, modules: [], drones: [], fighters: [], implants: [], boosters: [],
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
    character: { skills: { default_level: ch?.default_level ?? 5, levels: ch?.levels ?? {} }, security_status: ch?.security_status ?? null, alpha_clone: ch?.alpha_clone === true },
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
/** Add a market item to a fit by its natural kind (Pyfa click/drag-add). Returns the new fit, or null when the item
 *  does not fit anywhere (ship types create new fits — handled by the caller). `projected` mirrors the
 *  "add to projected" toggle: modules/drones/fighters go to the projected list instead of the racks. */
export function addItemToFit(ds: Dataset, fit: Fit, id: number, projected = false): Fit | null {
  if (ds.raw.environment?.effect_beacons?.[id]) return { ...fit, environment: [...new Set([...fit.environment, id])] };
  const k = ds.kind(id);
  if (projected && (k === 'module' || k === 'drone' || k === 'fighter')) {
    return { ...fit, projected: [...fit.projected, { kind: k, type_id: id, state: 'active',
      quantity: k === 'fighter' ? ds.attr(id, 'fighterSquadronMaxSize') ?? 1 : 1, amount: 1, distance_m: 5000 }] };
  }
  switch (k) {
    case 'module': case 'subsystem': {
      const slot = ds.slot(id);
      if (!slot) return null;
      let modules = fit.modules;
      if (slot === 'subsystem') { const sub = ds.attr(id, 'subSystemSlot'); modules = modules.filter((m) => m.slot !== 'subsystem' || ds.attr(m.type_id, 'subSystemSlot') !== sub); }
      return { ...fit, modules: [...modules, { type_id: id, slot, state: defaultState(ds, id), charge_type_id: null }] };
    }
    case 'charge': {
      const ok = fit.modules.map((m) => ds.chargesFor(m.type_id).includes(id));
      if (ok.some(Boolean)) return { ...fit, modules: fit.modules.map((m, i) => (ok[i] ? { ...m, charge_type_id: id } : m)) };
      return { ...fit, cargo: [...fit.cargo, { type_id: id, quantity: 1 }] };
    }
    case 'drone': {
      const ex = fit.drones.findIndex((d) => d.type_id === id);
      if (ex >= 0) return { ...fit, drones: fit.drones.map((d, i) => (i === ex ? { ...d, quantity: d.quantity + 1, active: d.active + 1 } : d)) };
      return { ...fit, drones: [...fit.drones, { type_id: id, quantity: 1, active: 1 }] };
    }
    case 'fighter': return { ...fit, fighters: [...fit.fighters, { type_id: id, quantity: ds.attr(id, 'fighterSquadronMaxSize') ?? 1, active: true }] };
    case 'implant': { const s = ds.attr(id, 'implantness'); return { ...fit, implants: [...fit.implants.filter((x) => ds.attr(x, 'implantness') !== s), id] }; }
    case 'booster': { const s = ds.attr(id, 'boosterness'); return { ...fit, boosters: [...fit.boosters.filter((b) => ds.attr(b.type_id, 'boosterness') !== s), { type_id: id }] }; }
    default: return null;
  }
}

export function applyMarketPick(ds: Dataset, fit: Fit, sel: MarketSelection, typeId: number, mode: MarketMode): MarketPickResult {
  const unchanged = (reason: Extract<MarketPickNote, { kind: 'warning' }>['reason']): MarketPickResult =>
    ({ fit, sel, note: { kind: 'warning', reason } });
  const added = (next: Fit | null, replaced?: number, selection: MarketSelection = sel): MarketPickResult =>
    next ? { fit: next, sel: selection, note: replaced == null ? { kind: 'added', typeId } : { kind: 'replaced', from: replaced, to: typeId, count: 1 } }
      : unchanged('cannot-fit');
  if (ds.isShip(typeId)) return {
    fit: newFit(typeId, `${ds.name(typeId, 'en')} fit`, `market-${fit.id}-${typeId}`),
    sel: null, note: { kind: 'new-ship' },
  };

  const kind = ds.kind(typeId);
  if (kind === 'module' || kind === 'subsystem') {
    const selected = sel?.list === 'modules' ? fit.modules[sel.index] : undefined;
    const sameSlot = !!selected && ds.slot(typeId) === selected.slot;
    if (mode === 'replace' && !selected) return unchanged('select-same-slot');
    if (mode === 'replace' && selected && !sameSlot) return unchanged('slot-mismatch');
    if (selected && sameSlot && mode !== 'add') {
      const indexes = selected.group == null
        ? [sel!.index]
        : fit.modules.flatMap((m, i) => m.group === selected.group ? [i] : []);
      const modules = fit.modules.map((m, i) => {
        if (!indexes.includes(i)) return m;
        return {
          ...m,
          type_id: typeId,
          state: m.state === 'offline' ? 'offline' : defaultState(ds, typeId),
          charge_type_id: m.charge_type_id != null && ds.chargesFor(typeId).includes(m.charge_type_id) ? m.charge_type_id : null,
          mutation: null,
        };
      });
      return { fit: { ...fit, modules }, sel, note: { kind: 'replaced', from: selected.type_id, to: typeId, count: indexes.length } };
    }
    let replaced: number | undefined;
    let replacedIndex = -1;
    if (kind === 'subsystem') {
      const slot = ds.attr(typeId, 'subSystemSlot');
      replacedIndex = fit.modules.findIndex((m) => m.slot === 'subsystem' && ds.attr(m.type_id, 'subSystemSlot') === slot);
      replaced = replacedIndex < 0 ? undefined : fit.modules[replacedIndex].type_id;
    }
    const next = addItemToFit(ds, fit, typeId);
    const selection = next && sel?.list === 'modules' && replacedIndex >= 0
      ? { ...sel, index: sel.index === replacedIndex ? next.modules.length - 1 : sel.index > replacedIndex ? sel.index - 1 : sel.index }
      : sel;
    return added(next, replaced, selection);
  }

  if (kind === 'charge') {
    const selected = sel?.list === 'modules' ? fit.modules[sel.index] : undefined;
    if (mode !== 'add' && selected && ds.chargesFor(selected.type_id).includes(typeId)) {
      const indexes = selected.group == null
        ? [sel!.index]
        : fit.modules.flatMap((m, i) => m.group === selected.group ? [i] : []);
      const modules = fit.modules.map((m, i) => indexes.includes(i) && ds.chargesFor(m.type_id).includes(typeId)
        ? { ...m, charge_type_id: typeId } : m);
      return { fit: { ...fit, modules }, sel, note: { kind: 'loaded', typeId } };
    }
    const next = addItemToFit(ds, fit, typeId);
    if (!next) return unchanged('cannot-fit');
    return { fit: next, sel, note: fit.modules.some((m) => ds.chargesFor(m.type_id).includes(typeId)) ? { kind: 'loaded', typeId } : { kind: 'added', typeId } };
  }

  if (kind === 'drone' && mode !== 'add' && sel?.list === 'drones' && fit.drones[sel.index]) {
    const current = fit.drones[sel.index];
    const drones = fit.drones.map((d, i) => i === sel.index ? { ...d, type_id: typeId, mutation: null } : d);
    return { fit: { ...fit, drones }, sel, note: { kind: 'replaced', from: current.type_id, to: typeId, count: 1 } };
  }

  if (kind === 'fighter' && mode !== 'add' && sel?.list === 'fighters' && fit.fighters[sel.index]) {
    const current = fit.fighters[sel.index];
    const max = ds.attr(typeId, 'fighterSquadronMaxSize') ?? current.quantity;
    const fighters = fit.fighters.map((f, i) => i === sel.index
      ? { ...f, type_id: typeId, quantity: Math.min(f.quantity, max), abilities: null } : f);
    return { fit: { ...fit, fighters }, sel, note: { kind: 'replaced', from: current.type_id, to: typeId, count: 1 } };
  }

  let replaced: number | undefined;
  if (kind === 'implant') {
    const slot = ds.attr(typeId, 'implantness');
    replaced = fit.implants.find((x) => ds.attr(x, 'implantness') === slot);
  } else if (kind === 'booster') {
    const slot = ds.attr(typeId, 'boosterness');
    replaced = fit.boosters.find((b) => ds.attr(b.type_id, 'boosterness') === slot)?.type_id;
  }
  return added(addItemToFit(ds, fit, typeId), replaced);
}

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
