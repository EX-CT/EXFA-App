// Fit library operations (pure functions over Library): folders, tags, search, rename / duplicate / delete, and the
// JSON backup format. The UI (ui/FitBrowser.tsx) and the persistence layer (store/) build on these. Documents are
// exfa/fit@1 (FitDocument); legacy libraries are upgraded by @exfa/format migrate.
import { migrate } from '@exfa/format';
import type { Dataset } from '../data/dataset';
import { uid, type FitDoc, type Fleet, type Library } from './model';

export const normFolder = (p: string | null | undefined) => (p ?? '').split('/').map((s) => s.trim()).filter(Boolean).join('/');
export const normTags = (tags: Iterable<string>) => [...new Set([...tags].map((t) => t.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
export const parseTags = (s: string) => normTags(s.split(/[,;]/));

/** Every folder path of the library (explicit folders, folders of fits and fleets, and their parents), sorted. */
export function allFolders(lib: Library): string[] {
  const out = new Set<string>();
  const add = (p: string) => { const parts = normFolder(p).split('/').filter(Boolean); for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/')); };
  for (const f of lib.folders ?? []) add(f);
  for (const f of Object.values(lib.fits)) if (f.folder) add(f.folder);
  for (const f of Object.values(lib.fleets ?? {})) if (f.folder) add(f.folder);
  return [...out].sort((a, b) => a.localeCompare(b));
}
export function allTags(lib: Library): string[] { return normTags(Object.values(lib.fits).flatMap((f) => f.tags ?? [])); }

/** Search over fit name, ship name (current UI language and English), folder, tags and notes; all words must match.
 *  `tag:<name>` words filter by tag. */
export function searchFits(ds: Dataset, lib: Library, query: string): FitDoc[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return Object.values(lib.fits).filter((f) => {
    const hay = [f.name, ds.name(f.fit.ship.type_id), ds.name(f.fit.ship.type_id, 'en'), f.folder ?? '', ...(f.tags ?? []), f.notes ?? ''].join('\n').toLowerCase();
    return words.every((w) => (w.startsWith('tag:') ? (f.tags ?? []).some((t) => t.toLowerCase() === w.slice(4)) : hay.includes(w)));
  });
}

const touch = (f: FitDoc, patch: Partial<FitDoc>): FitDoc => ({ ...f, ...patch, modified: new Date().toISOString() });
export function updateFits(lib: Library, ids: string[], patch: (f: FitDoc) => Partial<FitDoc>): Library {
  const fits = { ...lib.fits };
  for (const id of ids) if (fits[id]) fits[id] = touch(fits[id], patch(fits[id]));
  return { ...lib, fits };
}
export const renameFit = (lib: Library, id: string, name: string) => updateFits(lib, [id], () => ({ name: name.trim() || lib.fits[id].name }));
export const moveFits = (lib: Library, ids: string[], folder: string) => {
  const l = updateFits(lib, ids, () => ({ folder: normFolder(folder) }));
  return folder ? { ...l, folders: normTags([...(l.folders ?? []), normFolder(folder)]) } : l;
};
export const tagFits = (lib: Library, ids: string[], add: string[], remove: string[] = []) =>
  updateFits(lib, ids, (f) => ({ tags: normTags([...(f.tags ?? []), ...add].filter((t) => !remove.includes(t))) }));

/** A copy of a fit document with a new id and "(copy)" name, in the same folder with the same tags. Alternatives
 *  and branches travel with the copy (they are part of the fit); recorded history starts fresh. */
export function duplicateFit(f: FitDoc, name = `${f.name} (copy)`): FitDoc {
  const now = new Date().toISOString();
  const copy = { ...structuredClone(f), id: uid(), name, created: now, modified: now, history: [] };
  delete copy.active_branch;
  return copy;
}

/** Deletes fits; links to them (projected fits, fleet boosters, fleet memberships) are removed from the
 *  remaining fits and fleets. Empty fleets are kept (a fleet is a first-class object). */
export function deleteFits(lib: Library, ids: string[]): Library {
  const gone = new Set(ids);
  const fits: Record<string, FitDoc> = {};
  for (const [id, f] of Object.entries(lib.fits)) {
    if (gone.has(id)) continue;
    const projected = f.links.projected_fits.filter((p) => !gone.has(p.fit_id));
    const boosters = f.links.booster_fit_ids.filter((b) => !gone.has(b));
    fits[id] = projected.length !== f.links.projected_fits.length || boosters.length !== f.links.booster_fit_ids.length
      ? { ...f, links: { ...f.links, projected_fits: projected, booster_fit_ids: boosters } } : f;
  }
  const fleets = Object.fromEntries(Object.entries(lib.fleets ?? {}).map(([id, fl]) => [id, { ...fl, members: fl.members.filter((m) => !gone.has(m.fit_id)) }]));
  return { ...lib, fits, fleets };
}

const under = (p: string | undefined, folder: string) => !!p && (p === folder || p.startsWith(folder + '/'));
/** Renames (moves) a folder with its subfolders, fits and fleets. */
export function renameFolder(lib: Library, from: string, to: string): Library {
  from = normFolder(from); to = normFolder(to);
  if (!from || from === to) return lib;
  const re = (p: string) => (under(p, from) ? normFolder(to + p.slice(from.length)) : p);
  const l = updateFits(lib, Object.values(lib.fits).filter((f) => under(f.folder, from)).map((f) => f.id), (f) => ({ folder: re(f.folder!) }));
  const fleets = Object.fromEntries(Object.entries(l.fleets ?? {}).map(([id, fl]) => [id, under(fl.folder, from) ? { ...fl, folder: re(fl.folder!) } : fl]));
  return { ...l, fleets, folders: normTags((lib.folders ?? []).map(re).filter(Boolean)) };
}
/** Deletes a folder; its fits, fleets and subfolders move to the parent folder (fits are never deleted with a folder). */
export function deleteFolder(lib: Library, folder: string): Library {
  folder = normFolder(folder);
  const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '';
  const re = (p: string) => (under(p, folder) ? normFolder(parent + p.slice(folder.length)) : p);
  const l = updateFits(lib, Object.values(lib.fits).filter((f) => under(f.folder, folder)).map((f) => f.id), (f) => ({ folder: re(f.folder!) }));
  const fleets = Object.fromEntries(Object.entries(l.fleets ?? {}).map(([id, fl]) => [id, under(fl.folder, folder) ? { ...fl, folder: re(fl.folder!) } : fl]));
  return { ...l, fleets, folders: normTags((lib.folders ?? []).filter((p) => p !== folder).map(re).filter(Boolean)) };
}

// ---- Fleets (exfa/library@1 fleets map; members reference fit ids with a role) ----
export const newFleet = (name: string, folder = ''): Fleet => ({ id: uid(), name: name.trim() || 'Fleet', folder: normFolder(folder), members: [] });
/** Fleets a fit belongs to (usually one). */
export const fleetsOf = (lib: Library, fitId: string): Fleet[] => Object.values(lib.fleets ?? {}).filter((fl) => fl.members.some((m) => m.fit_id === fitId));
/** Adds a fit to a fleet (or creates a new fleet named `name` when fleetId is null). A fit belongs to at most one
 *  fleet, so membership entries in other fleets are removed. */
export function joinFleet(lib: Library, fleetId: string | null, fitId: string, name?: string): { lib: Library; fleetId: string } {
  const fleets = { ...lib.fleets };
  let id = fleetId;
  if (!id) {
    const fl = newFleet(name ?? 'Fleet');
    fleets[fl.id] = fl;
    id = fl.id;
  }
  const fl = fleets[id];
  if (!fl) return { lib, fleetId: id };
  for (const [fid, o] of Object.entries(fleets)) {
    if (fid !== id && o.members.some((m) => m.fit_id === fitId)) fleets[fid] = { ...o, members: o.members.filter((m) => m.fit_id !== fitId) };
  }
  if (!fl.members.some((m) => m.fit_id === fitId)) fleets[id] = { ...fl, members: [...fl.members, { fit_id: fitId, role: 'member' }] };
  return { lib: { ...lib, fleets }, fleetId: id };
}
export function setFleetRole(lib: Library, fleetId: string, fitId: string, role: 'command' | 'member'): Library {
  const fl = lib.fleets[fleetId];
  if (!fl) return lib;
  return { ...lib, fleets: { ...lib.fleets, [fleetId]: { ...fl, members: fl.members.map((m) => (m.fit_id === fitId ? { ...m, role } : m)) } } };
}
/** Removes a fit from every fleet (its per-fleet role entries disappear). */
export function leaveFleets(lib: Library, fitId: string): Library {
  const fleets = Object.fromEntries(Object.entries(lib.fleets ?? {}).map(([id, fl]) => [id, { ...fl, members: fl.members.filter((m) => m.fit_id !== fitId) }]));
  return { ...lib, fleets };
}
export const renameFleet = (lib: Library, fleetId: string, name: string) =>
  lib.fleets[fleetId] ? { ...lib, fleets: { ...lib.fleets, [fleetId]: { ...lib.fleets[fleetId], name: name.trim() || lib.fleets[fleetId].name } } } : lib;
export const moveFleet = (lib: Library, fleetId: string, folder: string) =>
  lib.fleets[fleetId] ? { ...lib, fleets: { ...lib.fleets, [fleetId]: { ...lib.fleets[fleetId], folder: normFolder(folder) } } } : lib;
export const deleteFleet = (lib: Library, fleetId: string) => {
  const fleets = { ...lib.fleets };
  delete fleets[fleetId];
  return { ...lib, fleets };
};

// ---- JSON backup (exfa/library@1 through @exfa/format migrate; eve-fit-web-library backups still import) ----
export const BACKUP_FORMAT = 'eve-fit-web-library';
export interface Backup { format: typeof BACKUP_FORMAT; version: 3; exported_at?: string; lib: Library; implant_sets?: unknown[] }
const userOnly = <T extends { builtin?: boolean }>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([, v]) => !v.builtin));
/** A backup keeps the canonical library shape plus the app-specific implant sets on the side. */
export function makeBackup(lib: Library, implantSets: unknown[] = []): Backup {
  return { format: BACKUP_FORMAT, version: 3, exported_at: new Date().toISOString(), implant_sets: implantSets,
    lib: { ...lib, fits: lib.fits, characters: userOnly(lib.characters), damage_patterns: userOnly(lib.damage_patterns), target_profiles: userOnly(lib.target_profiles) } };
}
/** Parses a backup or a bare library (exfa/library@1, eve-fit-web-library v1-3, legacy stored library) through the
 *  format package's migrate; implant_sets ride back out to the caller. */
export function parseBackup(text: string): Backup {
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new Error('not an eve-fit-web backup'); }
  const lib = migrate(j);
  const implantSets = (j as { implant_sets?: unknown[] })?.implant_sets
    ?? ((lib as { ui?: { legacy?: { backup?: { implant_sets?: unknown[] } } } }).ui?.legacy?.backup?.implant_sets) ?? [];
  return { format: BACKUP_FORMAT, version: 3, lib, implant_sets: implantSets };
}
export interface MergeResult { lib: Library; added: string[]; updated: string[]; skipped: string[] }
/** Merges imported documents into the library by id: a new id is added, an existing id keeps whichever side has the
 *  newer `modified` timestamp (ties keep the stored one). Characters / profiles / scenarios / fleets / folders are
 *  unioned (import wins on equal ids). */
export function mergeLibrary(lib: Library, add: Partial<Library>): MergeResult {
  const fits = { ...lib.fits };
  const added: string[] = [], updated: string[] = [], skipped: string[] = [];
  for (const [id, f] of Object.entries(add.fits ?? {})) {
    const cur = fits[id];
    if (!cur) { fits[id] = f; added.push(id); continue; }
    const newer = (f.modified ?? '') > (cur.modified ?? '');
    const same = JSON.stringify(cur) === JSON.stringify(f);
    if (same || !newer) { skipped.push(id); continue; }
    fits[id] = f; updated.push(id);
  }
  const mergeMap = <T>(a: Record<string, T>, b: Record<string, T> | undefined) => ({ ...a, ...(b ?? {}) });
  return {
    added, updated, skipped,
    lib: {
      ...lib, fits,
      characters: mergeMap(lib.characters, add.characters),
      damage_patterns: mergeMap(lib.damage_patterns, add.damage_patterns),
      target_profiles: mergeMap(lib.target_profiles, add.target_profiles),
      scenarios: mergeMap(lib.scenarios, add.scenarios),
      fleets: mergeMap(lib.fleets, add.fleets),
      folders: normTags([...(lib.folders ?? []), ...(add.folders ?? [])]),
    },
  };
}
