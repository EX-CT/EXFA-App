// Format RPCs run through the same worker as calc and graph requests.
import type { Dataset, Slot } from '../data/dataset';
import { newFit, toRequest, uid, type Character, type DamagePattern, type Fit, type Library, type Projected, type TargetProfile } from '../fit/model';
import { requestToStructured } from './convert';
import type { ExportFormat, ExportOptions, ImportFormat, StructuredFit, StructuredLibrary } from './types';
import { shipstatsRequest } from './types';

export type { ExportFormat, ImportFormat, StructuredFit, StructuredLibrary } from './types';
export { shipstatsRequest } from './types';

type RpcResponse = { result?: any; error?: { code: string; message?: string } };
export type EngineRpc = (method: string, params: unknown) => Promise<RpcResponse>;
let engineRpc: EngineRpc | null = null;

export const setEngineFormatsRpc = (rpc: EngineRpc) => { engineRpc = rpc; };

const rpc = async (method: string, params: unknown) => {
  if (!engineRpc) throw new Error('engine not ready');
  const response = await engineRpc(method, params);
  const error = response?.error ?? response?.result?.error;
  if (error) throw new Error(`${error.code}: ${error.message ?? ''}`.trim());
  return response?.result ?? null;
};

const splitEft = (text: string) => {
  const lines = text.replace(/\r/g, '').split('\n');
  const heads = lines.map((line, i) => (/^\[[^\],]+,[^\]]*\]\s*$/.test(line.trim()) ? i : -1)).filter((i) => i >= 0);
  return heads.length > 1 ? heads.map((h, i) => lines.slice(h, heads[i + 1] ?? lines.length).join('\n')) : [text];
};

/** StructuredFit -> UI fit with library defaults (character, profiles, options). Drones of an imported fit start
 *  launched (as with the engine's eft_parse and the web's earlier importers) when the format left them all in the bay. */
export function fitFromStructured(sf: StructuredFit, opts: { launchDrones?: boolean } = {}): Fit {
  const f = newFit(sf.ship.type_id, sf.name);
  f.mode_type_id = sf.ship.mode_type_id ?? null;
  f.modules = sf.modules.map((m) => ({ type_id: m.type_id, slot: m.slot, state: m.state, charge_type_id: m.charge_type_id ?? null, mutation: m.mutation ?? null, ...(m.spool != null ? { spool: m.spool } : {}) }));
  const launch = (opts.launchDrones ?? true) && sf.drones.length > 0 && sf.drones.every((d) => !d.active);
  f.drones = sf.drones.map((d) => ({ ...d, active: launch ? d.quantity : d.active }));
  f.fighters = sf.fighters.map((x) => ({ ...x }));
  f.implants = [...sf.implants];
  f.boosters = sf.boosters.map((b) => ({ ...b }));
  f.cargo = sf.cargo.map((c) => ({ ...c }));
  if (sf.notes) f.notes = sf.notes;
  return f;
}

export interface ImportResult { kind: string; fits: Fit[]; warnings: string[] }
export async function importFits(ds: Dataset, text: string, format?: ImportFormat, path?: string): Promise<ImportResult> {
  const chunks = format === 'auto' || format === 'eft' ? splitEft(text) : [text];
  const warnings: string[] = [];
  const fits: Fit[] = [];
  let kind = '';
  for (const chunk of chunks) {
    const result = await rpc('format_import', { text: chunk, format: chunks.length > 1 ? 'eft' : format ?? 'auto', ...(path ? { path } : {}) });
    if (!result?.fits) throw new Error(`${result?.kind ?? 'input'}: an item list, not a fit (${(result?.items ?? []).length} items)`);
    kind = result.kind ?? kind;
    for (const request of result.fits) {
      const structured = requestToStructured(ds, request, request.name, request.notes, warnings);
      fits.push(fitFromStructured(structured));
    }
    warnings.push(...(result.warnings ?? []));
  }
  return { kind, fits, warnings };
}
/** One fit from text (share links, the demo fit): the first fit of the text. */
export async function importFit(ds: Dataset, text: string, format?: ImportFormat): Promise<Fit> {
  const r = await importFits(ds, text, format);
  if (!r.fits.length) throw new Error('no fit in the text');
  return r.fits[0];
}

export interface ExportExtra { options?: ExportOptions; stats?: unknown; slotTotals?: Partial<Record<Slot, number>> }
/** The FitRequest an export sees (and, through shipstatsRequest, the request whose stats `shipstats` needs). */
export function exportRequest(fit: Fit, lib: Library) { return toRequest(fit, lib); }
export async function exportFit(_ds: Dataset, fit: Fit, lib: Library, format: ExportFormat, extra: ExportExtra = {}): Promise<string> {
  const result = await rpc('format_export', {
    fit: exportRequest(fit, lib), name: fit.name, format,
    ...(extra.options ? { options: extra.options } : {}),
    ...(extra.stats ? { stats_json: JSON.stringify(extra.stats) } : {}),
  });
  if (typeof result?.text !== 'string') throw new Error('format export returned no text');
  return result.text;
}
/** shipstats export: calculate shipstatsRequest(fit), then let the Engine formats RPC render the text. */
export async function exportShipstats(ds: Dataset, fit: Fit, lib: Library, calc: (req: unknown) => Promise<unknown>): Promise<string> {
  const stats = await calc(shipstatsRequest(exportRequest(fit, lib)));
  if ((stats as { error?: { message?: string } })?.error) throw new Error(`engine: ${(stats as { error: { message?: string } }).error.message}`);
  return await exportFit(ds, fit, lib, 'shipstats', { stats });
}

export interface LibraryImport {
  kind: string; fits: Fit[]; characters: Character[]; damagePatterns: DamagePattern[]; targetProfiles: TargetProfile[];
  implantSets: { name: string; implants: number[] }[]; warnings: string[];
}
const sameVals = (a: Record<string, unknown>, b: Record<string, unknown>, keys: string[]) => keys.every((k) => (a[k] ?? null) === (b[k] ?? null));
const DT = ['em', 'thermal', 'kinetic', 'explosive'];

/** StructuredLibrary (e.g. a Pyfa database) -> UI library entries with fresh ids. Library references (character,
 *  profiles, projected / booster fits) are resolved to those ids; characters and profiles equal to an existing one
 *  (built-in or the user's) are reused instead of duplicated. Saved states are kept as they are (no drone launch). */
export function libraryFromStructured(sl: StructuredLibrary, lib: Library, meta: { folder?: string; tags?: string[] } = {}): LibraryImport {
  const warnings = [...sl.warnings];
  const out: LibraryImport = { kind: sl.kind, fits: [], characters: [], damagePatterns: [], targetProfiles: [], implantSets: [], warnings };
  const charId = new Map<string, string>(), dpId = new Map<string, string>(), tpId = new Map<string, string>(), fitId = new Map<string, string>();
  for (const c of sl.characters) {
    if (c.builtin && lib.characters[c.builtin]) { charId.set(c.ref, c.builtin); continue; }
    const same = Object.values(lib.characters).find((x) => x.name === c.name && x.default_level === c.default_level && JSON.stringify(x.levels) === JSON.stringify(c.levels));
    if (same) { charId.set(c.ref, same.id); continue; }
    const nc: Character = { id: uid(), name: c.name || 'Pyfa character', default_level: c.default_level, levels: { ...c.levels }, security_status: c.security_status ?? null };
    out.characters.push(nc); charId.set(c.ref, nc.id);
  }
  const profiles = <P extends DamagePattern | TargetProfile>(src: StructuredLibrary['damage_patterns'], have: Record<string, P>, keys: string[], ids: Map<string, string>, add: P[], label: string) => {
    for (const p of src) {
      const vals = { ...p } as Record<string, unknown>;
      const same = Object.values(have).find((x) => (!p.name || x.name === p.name) && sameVals(x as unknown as Record<string, unknown>, vals, keys));
      if (same) { ids.set(p.ref, same.id); continue; }
      const np = { ...p, id: uid(), name: p.name || `${label} ${p.ref.split(':')[1]}` } as unknown as P & { ref?: string };
      delete np.ref;
      add.push(np); ids.set(p.ref, np.id);
    }
  };
  profiles(sl.damage_patterns, lib.damagePatterns, DT, dpId, out.damagePatterns, 'Pyfa pattern');
  profiles(sl.target_profiles, lib.targetProfiles, [...DT, 'signature_radius', 'max_velocity', 'radius'], tpId, out.targetProfiles, 'Pyfa target');
  for (const sf of sl.fits) fitId.set(sf.ref, uid());
  const now = new Date().toISOString();
  for (const sf of sl.fits) {
    const f = fitFromStructured(sf, { launchDrones: false });
    f.id = fitId.get(sf.ref)!;
    if (sf.character_ref && charId.has(sf.character_ref)) f.character_id = charId.get(sf.character_ref)!;
    if (sf.damage_pattern_ref && dpId.has(sf.damage_pattern_ref)) f.damage_pattern_id = dpId.get(sf.damage_pattern_ref)!;
    if (sf.target_profile_ref && tpId.has(sf.target_profile_ref)) f.target_profile_id = tpId.get(sf.target_profile_ref)!;
    f.system_security = sf.system_security ?? null;
    f.environment = [...(sf.environment ?? [])];
    f.projected = (sf.projected ?? []).map((p): Projected => ({ kind: p.kind, type_id: p.type_id, state: p.state, charge_type_id: p.charge_type_id ?? null, quantity: p.quantity, amount: p.amount, distance_m: p.distance_m }));
    for (const pf of sf.projected_fits ?? []) {
      const id = fitId.get(pf.ref);
      if (id) f.projected.push({ kind: 'fit', fit_id: id, amount: pf.amount, distance_m: pf.distance_m });
      else warnings.push(`fit "${sf.name}": projected fit ${pf.ref} not in the database`);
    }
    f.fleet = { ...f.fleet, booster_fit_ids: (sf.booster_fit_refs ?? []).map((r) => fitId.get(r)).filter((x): x is string => !!x) };
    if (sf.overrides?.length) f.overrides = sf.overrides.map((o) => ({ ...o }));
    f.folder = sf.folder ?? meta.folder ?? '';
    f.tags = [...new Set([...(sf.tags ?? []), ...(meta.tags ?? [])])];
    f.created = sf.created ? new Date(sf.created.replace(' ', 'T') + (sf.created.includes('Z') ? '' : 'Z')).toISOString() : now;
    f.modified = sf.modified ? new Date(sf.modified.replace(' ', 'T') + (sf.modified.includes('Z') ? '' : 'Z')).toISOString() : f.created;
    out.fits.push(f);
  }
  out.implantSets = sl.implant_sets.map((s) => ({ name: s.name, implants: [...s.implants] }));
  return out;
}

/** Several fits in one text: EFT blocks separated by blank lines (Pyfa's multi-fit export), or one EVE XML document
 *  with every fit (the shape of Pyfa's "Backup all fittings"), built from the Engine formats RPC's per-fit exports. */
export async function exportFits(ds: Dataset, fits: Fit[], lib: Library, format: 'eft' | 'xml' | 'dna'): Promise<string> {
  if (format !== 'xml') return (await Promise.all(fits.map(async (f) => (await exportFit(ds, f, lib, format)).trimEnd()))).join(format === 'eft' ? '\n\n\n' : '\n') + '\n';
  const blocks = await Promise.all(fits.map(async (f) => {
    const x = await exportFit(ds, f, lib, 'xml');
    const a = x.indexOf('<fitting '), b = x.lastIndexOf('</fitting>');
    if (a < 0 || b < 0) throw new Error(`XML export of "${f.name}" has no <fitting>`);
    return '\t' + x.slice(a, b + '</fitting>'.length);
  }));
  return `<?xml version="1.0" ?>\n<fittings count="${fits.length}">\n${blocks.join('\n')}\n</fittings>\n`;
}
