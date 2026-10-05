// Fit library operations (pure functions over Library): folders, tags, search, rename / duplicate / delete, and the
// JSON backup format. The UI (ui/FitBrowser.tsx) and the persistence layer (store/) build on these.
import type { Dataset } from '../data/dataset';
import { uid, type Fit, type Library } from './model';

export const normFolder = (p: string | null | undefined) => (p ?? '').split('/').map((s) => s.trim()).filter(Boolean).join('/');
export const normTags = (tags: Iterable<string>) => [...new Set([...tags].map((t) => t.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
export const parseTags = (s: string) => normTags(s.split(/[,;]/));

/** Every folder path of the library (explicit folders, folders of fits, and their parents), sorted. */
export function allFolders(lib: Library): string[] {
  const out = new Set<string>();
  const add = (p: string) => { const parts = normFolder(p).split('/').filter(Boolean); for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/')); };
  for (const f of lib.folders ?? []) add(f);
  for (const f of Object.values(lib.fits)) if (f.folder) add(f.folder);
  return [...out].sort((a, b) => a.localeCompare(b));
}
export function allTags(lib: Library): string[] { return normTags(Object.values(lib.fits).flatMap((f) => f.tags ?? [])); }

/** Search over fit name, ship name (current UI language and English), folder, tags and notes; all words must match.
 *  `tag:<name>` words filter by tag. */
export function searchFits(ds: Dataset, lib: Library, query: string): Fit[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return Object.values(lib.fits).filter((f) => {
    const hay = [f.name, ds.name(f.ship_type_id), ds.name(f.ship_type_id, 'en'), f.folder ?? '', ...(f.tags ?? []), f.notes ?? ''].join('\n').toLowerCase();
    return words.every((w) => (w.startsWith('tag:') ? (f.tags ?? []).some((t) => t.toLowerCase() === w.slice(4)) : hay.includes(w)));
  });
}

const touch = (f: Fit, patch: Partial<Fit>): Fit => ({ ...f, ...patch, modified: new Date().toISOString() });
export function updateFits(lib: Library, ids: string[], patch: (f: Fit) => Partial<Fit>): Library {
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

/** A copy of a fit with a new id and "(copy)" name, in the same folder with the same tags. */
export function duplicateFit(f: Fit, name = `${f.name} (copy)`): Fit {
  const now = new Date().toISOString();
  return { ...structuredClone(f), id: uid(), name, created: now, modified: now };
}

/** Deletes fits; links to them (projected fits, fleet boosters) are removed from the remaining fits. */
export function deleteFits(lib: Library, ids: string[]): Library {
  const gone = new Set(ids);
  const fits: Record<string, Fit> = {};
  for (const [id, f] of Object.entries(lib.fits)) {
    if (gone.has(id)) continue;
    const proj = f.projected.filter((p) => !(p.kind === 'fit' && p.fit_id && gone.has(p.fit_id)));
    const boosters = f.fleet.booster_fit_ids.filter((b) => !gone.has(b));
    fits[id] = proj.length !== f.projected.length || boosters.length !== f.fleet.booster_fit_ids.length ? { ...f, projected: proj, fleet: { ...f.fleet, booster_fit_ids: boosters } } : f;
  }
  return { ...lib, fits };
}

const under = (p: string | undefined, folder: string) => !!p && (p === folder || p.startsWith(folder + '/'));
/** Renames (moves) a folder with its subfolders and fits. */
export function renameFolder(lib: Library, from: string, to: string): Library {
  from = normFolder(from); to = normFolder(to);
  if (!from || from === to) return lib;
  const re = (p: string) => (under(p, from) ? normFolder(to + p.slice(from.length)) : p);
  const l = updateFits(lib, Object.values(lib.fits).filter((f) => under(f.folder, from)).map((f) => f.id), (f) => ({ folder: re(f.folder!) }));
  return { ...l, folders: normTags((lib.folders ?? []).map(re).filter(Boolean)) };
}
/** Deletes a folder; its fits and subfolders move to the parent folder (fits are never deleted with a folder). */
export function deleteFolder(lib: Library, folder: string): Library {
  folder = normFolder(folder);
  const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '';
  const re = (p: string) => (under(p, folder) ? normFolder(parent + p.slice(folder.length)) : p);
  const l = updateFits(lib, Object.values(lib.fits).filter((f) => under(f.folder, folder)).map((f) => f.id), (f) => ({ folder: re(f.folder!) }));
  return { ...l, folders: normTags((lib.folders ?? []).filter((p) => p !== folder).map(re).filter(Boolean)) };
}

// ---- JSON backup (format eve-fit-web-library; version 2 adds folders, tags, timestamps and implant sets) ----
export const BACKUP_FORMAT = 'eve-fit-web-library';
export interface Backup { format: typeof BACKUP_FORMAT; version: 1 | 2; exported_at?: string; lib: Library; implant_sets?: unknown[] }
const userOnly = <T extends { builtin?: boolean }>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([, v]) => !v.builtin));
export function makeBackup(lib: Library, implantSets: unknown[] = []): Backup {
  return { format: BACKUP_FORMAT, version: 2, exported_at: new Date().toISOString(), implant_sets: implantSets,
    lib: { fits: lib.fits, characters: userOnly(lib.characters), damagePatterns: userOnly(lib.damagePatterns), targetProfiles: userOnly(lib.targetProfiles), folders: lib.folders ?? [] } };
}
export function parseBackup(text: string): Backup {
  let j: Backup;
  try { j = JSON.parse(text); } catch { throw new Error('not an eve-fit-web backup'); }
  if (j?.format !== BACKUP_FORMAT || !j.lib?.fits) throw new Error('not an eve-fit-web backup');
  const l = j.lib as Partial<Library> & { fits: Library['fits'] };
  return { ...j, lib: { fits: l.fits, characters: l.characters ?? {}, damagePatterns: l.damagePatterns ?? {}, targetProfiles: l.targetProfiles ?? {}, folders: l.folders ?? [] } };
}
/** Merges an imported library part. Fits whose id already exists get a new id when their content differs (restoring
 *  the same backup twice does not duplicate fits). Links between imported fits are remapped to the new ids. */
export function mergeLibrary(lib: Library, add: Partial<Library>): { lib: Library; added: string[] } {
  const ids = new Map<string, string>();
  const added: string[] = [];
  for (const [id, f] of Object.entries(add.fits ?? {})) {
    const cur = lib.fits[id];
    if (cur && JSON.stringify(cur) === JSON.stringify(f)) continue;
    const nid = cur ? uid() : id;
    ids.set(id, nid); added.push(nid);
  }
  const fits = { ...lib.fits };
  for (const [old, nid] of ids) {
    const f = add.fits![old];
    fits[nid] = { ...f, id: nid,
      projected: f.projected.map((p) => (p.kind === 'fit' && p.fit_id && ids.has(p.fit_id) ? { ...p, fit_id: ids.get(p.fit_id) } : p)),
      fleet: { ...f.fleet, booster_fit_ids: f.fleet.booster_fit_ids.map((b) => ids.get(b) ?? b) } };
  }
  return {
    added,
    lib: { ...lib, fits, characters: { ...lib.characters, ...add.characters }, damagePatterns: { ...lib.damagePatterns, ...add.damagePatterns },
      targetProfiles: { ...lib.targetProfiles, ...add.targetProfiles }, folders: normTags([...(lib.folders ?? []), ...(add.folders ?? [])]) },
  };
}
