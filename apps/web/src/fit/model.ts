// UI-side fit model: exfa/fit@1 documents (@exfa/format v1). A library entry is a FitDocument: the calc payload
// lives in `doc.fit`, references (character / profiles / scenarios) in `doc.refs`, links to other fits (projected
// fits, fleet booster fits) in `doc.links`, and folder/tags/name/history on the document itself. Engine requests
// are produced by the format package's resolve (EXFA-Docs 05-api-schema, contract 1.4.2).
import { resolveFit } from '@exfa/format';
import type { FitRequest, FitDocument, Fit, Library, ProjectedItem } from '@exfa/format';
import type { Dataset } from '../data/dataset';
import { defaultState } from './states';

export type {
  FitRequest, FitDocument, Fit, Library, Character, DamagePattern, TargetProfile, FitModule, FitDrone,
  FitFighter, FitCargo, ProjectedItem, Mutation, ModState, Security, Fleet, Scenario, Alternative, Branch,
} from '@exfa/format';
export type { Slot } from '@exfa/format';

/** The unit the UI edits and the library stores: a fit document. */
export type FitDoc = FitDocument;
/** A projected fit link (kept on the document, not in fit.projected). */
export type ProjectedFit = FitDocument['links']['projected_fits'][number];

export type MarketMode = 'smart' | 'replace' | 'add';
export type MarketSelection = { list: 'modules' | 'drones' | 'fighters' | 'cargo'; index: number } | null;
export type MarketPickNote =
  | { kind: 'added'; typeId: number }
  | { kind: 'loaded'; typeId: number }
  | { kind: 'replaced'; from: number; to: number; count: number }
  | { kind: 'new-ship' }
  | { kind: 'warning'; reason: 'select-same-slot' | 'slot-mismatch' | 'cannot-fit' };
export interface MarketPickResult { fit: FitDoc; sel: MarketSelection; note: MarketPickNote | null }

export const uid = () => Math.random().toString(36).slice(2, 10);

/** type id of the market item being dragged (set on dragstart; HTML5 dragover can't read payload data) */
export const draggedType = { id: null as number | null };

export function emptyLibrary(): Library {
  return {
    format: 'exfa/library@1', folders: [], fits: {}, characters: {},
    damage_patterns: {}, target_profiles: {}, scenarios: {}, fleets: {},
  };
}

export function newFit(ship: number, name = 'New fit', id = uid()): FitDoc {
  return {
    format: 'exfa/fit@1', id, name,
    fit: {
      ship: { type_id: ship, mode_type_id: null }, modules: [], drones: [], fighters: [], implants: [], boosters: [],
      cargo: [], projected: [], fleet_buffs: [], environment: { effect_type_ids: [], system_security: null },
      options: { factor_reload: false, spool: 1, rah: 'adapt' },
    },
    refs: { character_id: 'all5', damage_pattern_id: 'uniform', target_profile_id: 'none', scenario_ids: [] },
    links: { booster_fit_ids: [], projected_fits: [] },
    alternatives: [], branches: [], history: [],
  };
}

/** The calc part of a document (`doc.fit`) with a shallow patch. */
export const patchFit = (doc: FitDoc, patch: Partial<Fit>): FitDoc => ({ ...doc, fit: { ...doc.fit, ...patch } });
/** `doc.refs` / `doc.links` with a shallow patch. */
export const patchRefs = (doc: FitDoc, patch: Partial<FitDoc['refs']>): FitDoc => ({ ...doc, refs: { ...doc.refs, ...patch } });
export const patchLinks = (doc: FitDoc, patch: Partial<FitDoc['links']>): FitDoc => ({ ...doc, links: { ...doc.links, ...patch } });

/** Document -> contract FitRequest (format resolveFit; branches are already applied to the stored document). */
export function requestFor(lib: Library, doc: FitDoc): FitRequest {
  return resolveFit(doc.fit, { library: lib, refs: doc.refs, links: doc.links, document_id: doc.id });
}

/** Switches every module/drone/cargo item carrying `altId` to the alternative's option `optionIndex`, using the same
 *  mapping as format applyBranch (type, charge for modules, quantity for stacks). */
export function applyAlternativeOption(doc: FitDoc, altId: string, optionIndex: number): FitDoc {
  const alt = doc.alternatives.find((a) => a.id === altId);
  const opt = alt?.options[optionIndex];
  if (!alt || !opt) return doc;
  const pick = <T extends { alt_id?: string | null; type_id: number; charge_type_id?: number | null; quantity?: number }>(item: T, list: 'modules' | 'drones' | 'cargo'): T => {
    if (item.alt_id !== altId) return item;
    const next = { ...item, type_id: opt.type_id };
    if (list === 'modules' && Object.hasOwn(opt, 'charge_type_id')) next.charge_type_id = opt.charge_type_id ?? null;
    if (list !== 'modules' && typeof opt.quantity === 'number') next.quantity = opt.quantity;
    return next;
  };
  return {
    ...doc,
    fit: {
      ...doc.fit,
      modules: doc.fit.modules.map((m) => pick(m, 'modules')),
      drones: doc.fit.drones.map((d) => pick(d, 'drones')),
      cargo: doc.fit.cargo.map((c) => pick(c, 'cargo')),
    },
  };
}

/** Rack position (Pyfa: drag a module onto another slot of the same rack): the module at `from` takes the place of
 *  the module at `to` and they swap; `to` = null moves it to the end of its rack. Positions in other racks are
 *  unchanged. The order inside a rack is the slot order the engine sees (it matters for overheat damage). */
export function moveModule(doc: FitDoc, from: number, to: number | null): FitDoc {
  const modules = doc.fit.modules;
  const a = modules[from];
  if (!a || from === to) return doc;
  if (to == null) {
    const rest = modules.filter((_, i) => i !== from);
    let last = -1;
    rest.forEach((m, i) => { if (m.slot === a.slot) last = i; });
    const at = last < 0 ? rest.length : last + 1;
    return patchFit(doc, { modules: [...rest.slice(0, at), a, ...rest.slice(at)] });
  }
  const b = modules[to];
  if (!b || b.slot !== a.slot) return doc;
  const next = modules.slice();
  next[from] = b; next[to] = a;
  return patchFit(doc, { modules: next });
}

/** Add a market item to a fit by its natural kind (Pyfa click/drag-add). Returns the new document, or null when the
 *  item does not fit anywhere (ship types create new fits — handled by the caller). `projected` mirrors the
 *  "add to projected" toggle: modules/drones/fighters go to the projected list instead of the racks. */
export function addItemToFit(ds: Dataset, doc: FitDoc, id: number, projected = false): FitDoc | null {
  const fit = doc.fit;
  if (ds.raw.environment?.effect_beacons?.[id])
    return patchFit(doc, { environment: { ...fit.environment, effect_type_ids: [...new Set([...fit.environment.effect_type_ids, id])] } });
  const k = ds.kind(id);
  if (projected && (k === 'module' || k === 'drone' || k === 'fighter')) {
    return patchFit(doc, {
      projected: [...fit.projected, { kind: k, type_id: id, state: 'active',
        quantity: k === 'fighter' ? ds.attr(id, 'fighterSquadronMaxSize') ?? 1 : 1, amount: 1, distance_m: 5000 } as ProjectedItem],
    });
  }
  switch (k) {
    case 'module': case 'subsystem': {
      const slot = ds.slot(id);
      if (!slot) return null;
      let modules = fit.modules;
      if (slot === 'subsystem') { const sub = ds.attr(id, 'subSystemSlot'); modules = modules.filter((m) => m.slot !== 'subsystem' || ds.attr(m.type_id, 'subSystemSlot') !== sub); }
      return patchFit(doc, { modules: [...modules, { type_id: id, slot, state: defaultState(ds, id), charge_type_id: null }] });
    }
    case 'charge': {
      const ok = fit.modules.map((m) => ds.chargesFor(m.type_id).includes(id));
      if (ok.some(Boolean)) return patchFit(doc, { modules: fit.modules.map((m, i) => (ok[i] ? { ...m, charge_type_id: id } : m)) });
      return patchFit(doc, { cargo: [...fit.cargo, { type_id: id, quantity: 1 }] });
    }
    case 'drone': {
      const ex = fit.drones.findIndex((d) => d.type_id === id);
      if (ex >= 0) return patchFit(doc, { drones: fit.drones.map((d, i) => (i === ex ? { ...d, quantity: d.quantity + 1, active: d.active + 1 } : d)) });
      return patchFit(doc, { drones: [...fit.drones, { type_id: id, quantity: 1, active: 1 }] });
    }
    case 'fighter': return patchFit(doc, { fighters: [...fit.fighters, { type_id: id, quantity: ds.attr(id, 'fighterSquadronMaxSize') ?? 1, active: true }] });
    case 'implant': { const s = ds.attr(id, 'implantness'); return patchFit(doc, { implants: [...fit.implants.filter((x) => ds.attr(x, 'implantness') !== s), id] }); }
    case 'booster': { const s = ds.attr(id, 'boosterness'); return patchFit(doc, { boosters: [...fit.boosters.filter((b) => ds.attr(b.type_id, 'boosterness') !== s), { type_id: id }] }); }
    default: return null;
  }
}

export function applyMarketPick(ds: Dataset, doc: FitDoc, sel: MarketSelection, typeId: number, mode: MarketMode): MarketPickResult {
  const fit = doc.fit;
  const unchanged = (reason: Extract<MarketPickNote, { kind: 'warning' }>['reason']): MarketPickResult =>
    ({ fit: doc, sel, note: { kind: 'warning', reason } });
  const added = (next: FitDoc | null, replaced?: number, selection: MarketSelection = sel): MarketPickResult =>
    next ? { fit: next, sel: selection, note: replaced == null ? { kind: 'added', typeId } : { kind: 'replaced', from: replaced, to: typeId, count: 1 } }
      : unchanged('cannot-fit');
  if (ds.isShip(typeId)) return {
    fit: newFit(typeId, `${ds.name(typeId, 'en')} fit`, `market-${doc.id}-${typeId}`),
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
      return { fit: patchFit(doc, { modules }), sel, note: { kind: 'replaced', from: selected.type_id, to: typeId, count: indexes.length } };
    }
    let replaced: number | undefined;
    let replacedIndex = -1;
    if (kind === 'subsystem') {
      const slot = ds.attr(typeId, 'subSystemSlot');
      replacedIndex = fit.modules.findIndex((m) => m.slot === 'subsystem' && ds.attr(m.type_id, 'subSystemSlot') === slot);
      replaced = replacedIndex < 0 ? undefined : fit.modules[replacedIndex].type_id;
    }
    const next = addItemToFit(ds, doc, typeId);
    const selection = next && sel?.list === 'modules' && replacedIndex >= 0
      ? { ...sel, index: sel.index === replacedIndex ? next.fit.modules.length - 1 : sel.index > replacedIndex ? sel.index - 1 : sel.index }
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
      return { fit: patchFit(doc, { modules }), sel, note: { kind: 'loaded', typeId } };
    }
    const next = addItemToFit(ds, doc, typeId);
    if (!next) return unchanged('cannot-fit');
    return { fit: next, sel, note: fit.modules.some((m) => ds.chargesFor(m.type_id).includes(typeId)) ? { kind: 'loaded', typeId } : { kind: 'added', typeId } };
  }

  if (kind === 'drone' && mode !== 'add' && sel?.list === 'drones' && fit.drones[sel.index]) {
    const current = fit.drones[sel.index];
    const drones = fit.drones.map((d, i) => i === sel.index ? { ...d, type_id: typeId, mutation: null } : d);
    return { fit: patchFit(doc, { drones }), sel, note: { kind: 'replaced', from: current.type_id, to: typeId, count: 1 } };
  }

  if (kind === 'fighter' && mode !== 'add' && sel?.list === 'fighters' && fit.fighters[sel.index]) {
    const current = fit.fighters[sel.index];
    const max = ds.attr(typeId, 'fighterSquadronMaxSize') ?? current.quantity;
    const fighters = fit.fighters.map((f, i) => i === sel.index
      ? { ...f, type_id: typeId, quantity: Math.min(f.quantity, max), abilities: null } : f);
    return { fit: patchFit(doc, { fighters }), sel, note: { kind: 'replaced', from: current.type_id, to: typeId, count: 1 } };
  }

  let replaced: number | undefined;
  if (kind === 'implant') {
    const slot = ds.attr(typeId, 'implantness');
    replaced = fit.implants.find((x) => ds.attr(x, 'implantness') === slot);
  } else if (kind === 'booster') {
    const slot = ds.attr(typeId, 'boosterness');
    replaced = fit.boosters.find((b) => ds.attr(b.type_id, 'boosterness') === slot)?.type_id;
  }
  return added(addItemToFit(ds, doc, typeId), replaced);
}
