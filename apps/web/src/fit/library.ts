// Fit library operations (pure functions over Library): folders, tags, search, rename / duplicate / delete, and the
// JSON backup format. The UI (ui/FitBrowser.tsx) and the persistence layer (store/) build on these. Documents are
// exfa/fit@1 (FitDocument); legacy libraries are upgraded by @exfa/format migrate.
import { mergePackage, migrate, newGroup } from '@exfa/format';
import type { Dataset } from '../data/dataset';
import { uid, type FitDoc, type Fleet, type Group, type GroupActor, type GroupRelation, type Library, type Package } from './model';

export const normFolder = (p: string | null | undefined) => (p ?? '').split('/').map((s) => s.trim()).filter(Boolean).join('/');
export const normTags = (tags: Iterable<string>) => [...new Set([...tags].map((t) => t.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
export const parseTags = (s: string) => normTags(s.split(/[,;]/));

/** Mint an `id` on every module/drone/fighter/cargo entry that lacks one (docs/27: relations select source items
 *  by these stable equipment ids). Documents are normalized once on load and on import; existing ids are kept. */
export function ensureItemIds(doc: FitDoc): FitDoc {
  const fill = <T extends { id?: string }>(items: T[]): T[] => (items.some((i) => !i.id) ? items.map((i) => (i.id ? i : { ...i, id: uid() })) : items);
  const modules = fill(doc.fit.modules), drones = fill(doc.fit.drones), fighters = fill(doc.fit.fighters), cargo = fill(doc.fit.cargo);
  if (modules === doc.fit.modules && drones === doc.fit.drones && fighters === doc.fit.fighters && cargo === doc.fit.cargo) return doc;
  return { ...doc, fit: { ...doc.fit, modules, drones, fighters, cargo } };
}

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
 *  newer `modified` timestamp (ties keep the stored one). Characters / profiles / scenarios / fleets / groups are
 *  unioned (import wins on equal ids). Imported items get item ids and — when `ws` is given — the active workspace
 *  tag (docs on `doc.ui.ws`, groups/fleets in the `ws` map). */
export function mergeLibrary(lib: Library, add: Partial<Library>, ws?: string): MergeResult {
  const fits = { ...lib.fits };
  const added: string[] = [], updated: string[] = [], skipped: string[] = [];
  for (const [id, f0] of Object.entries(add.fits ?? {})) {
    const f = ws ? setDocWs(ensureItemIds(f0), ws) : ensureItemIds(f0);
    const cur = fits[id];
    if (!cur) { fits[id] = f; added.push(id); continue; }
    const newer = (f.modified ?? '') > (cur.modified ?? '');
    const same = JSON.stringify({ ...cur, ui: undefined }) === JSON.stringify({ ...f, ui: undefined });
    if (same || !newer) { skipped.push(id); continue; }
    fits[id] = f; updated.push(id);
  }
  const mergeMap = <T>(a: Record<string, T>, b: Record<string, T> | undefined) => ({ ...a, ...(b ?? {}) });
  const wsMap: Record<string, string> = { ...(lib as WsFields).ws, ...(add as WsFields).ws };
  if (ws) for (const id of [...Object.keys(add.groups ?? {}), ...Object.keys(add.fleets ?? {})]) wsMap[id] = ws;
  const workspaces = mergeWorkspaces((lib as WsFields).workspaces, (add as WsFields).workspaces);
  return {
    added, updated, skipped,
    lib: {
      ...lib, fits,
      characters: mergeMap(lib.characters, add.characters),
      damage_patterns: mergeMap(lib.damage_patterns, add.damage_patterns),
      target_profiles: mergeMap(lib.target_profiles, add.target_profiles),
      scenarios: mergeMap(lib.scenarios, add.scenarios),
      fleets: mergeMap(lib.fleets, add.fleets),
      groups: mergeMap(lib.groups, add.groups),
      folders: normTags([...(lib.folders ?? []), ...(add.folders ?? [])]),
      workspaces, ws: wsMap,
    },
  };
}

// ---- Configuration groups (exfa/group@1 documents in `library.groups`) ----
export const newGroupDoc = (name?: string): Group => ({ ...newGroup(name), folder: '' });
/** Upserts a group document (auto-persisted like fits/fleets through the library index). */
export const upsertGroup = (lib: Library, g: Group): Library => ({ ...lib, groups: { ...lib.groups, [g.id]: g } });
/** Deletes a group; its workspace tag goes with it. */
export function removeGroup(lib: Library, id: string): Library {
  if (!lib.groups[id]) return lib;
  const groups = { ...lib.groups };
  delete groups[id];
  const ws = { ...(lib as WsFields).ws };
  delete ws[id];
  return { ...lib, groups, ws } as Library;
}
const patchGroup = (lib: Library, id: string, patch: Partial<Group>): Library =>
  lib.groups[id] ? upsertGroup(lib, { ...lib.groups[id], ...patch }) : lib;
export const renameGroup = (lib: Library, id: string, name: string) => patchGroup(lib, id, { name: name.trim() || lib.groups[id].name });
/** Add a fit as a group actor (deduped by fit_id); returns the new actor id. */
export function addGroupActor(lib: Library, groupId: string, fitId: string, label?: string, role?: string): { lib: Library; actorId: string } {
  const g = lib.groups[groupId];
  if (!g) return { lib, actorId: '' };
  const actor = { id: uid(), fit_id: fitId, ...(label ? { label } : {}), ...(role ? { role } : {}) };
  return { lib: patchGroup(lib, groupId, { actors: [...g.actors, actor] }), actorId: actor.id };
}
/** Removes an actor and every relation edge that references it (as source or target). */
export function removeGroupActor(lib: Library, groupId: string, actorId: string): Library {
  const g = lib.groups[groupId];
  if (!g) return lib;
  const relations = g.relations
    .filter((r) => r.source !== actorId)
    .map((r) => (r.targets.includes(actorId) ? { ...r, targets: r.targets.filter((x) => x !== actorId) } : r))
    .filter((r) => r.targets.length > 0);
  return patchGroup(lib, groupId, { actors: g.actors.filter((a) => a.id !== actorId), relations });
}
/** Shallow-patches one actor of a group (label / fit_id / role). */
export const updateGroupActor = (lib: Library, groupId: string, actorId: string, patch: Partial<GroupActor>): Library => {
  const g = lib.groups[groupId];
  if (!g) return lib;
  return patchGroup(lib, groupId, { actors: g.actors.map((a) => (a.id === actorId ? { ...a, ...patch } : a)) });
};
/** Upserts a relation edge on a group (see GroupRelation in @exfa/format). */
export function upsertGroupRelation(lib: Library, groupId: string, rel: GroupRelation): Library {
  const g = lib.groups[groupId];
  if (!g) return lib;
  const rest = g.relations.filter((r) => r.id !== rel.id);
  return patchGroup(lib, groupId, { relations: [...rest, rel] });
}
/** Shallow-patches one relation edge (kind / source / targets / items / amount / distance / enabled). */
export const updateGroupRelation = (lib: Library, groupId: string, relId: string, patch: Partial<GroupRelation>): Library => {
  const g = lib.groups[groupId];
  if (!g) return lib;
  return patchGroup(lib, groupId, { relations: g.relations.map((r) => (r.id === relId ? { ...r, ...patch } : r)) });
};
export function removeGroupRelation(lib: Library, groupId: string, relId: string): Library {
  const g = lib.groups[groupId];
  if (!g) return lib;
  return patchGroup(lib, groupId, { relations: g.relations.filter((r) => r.id !== relId) });
}
/** Fit documents the group may reference (actors always point at library fits). */
export const groupFits = (lib: Library, g: Group): FitDoc[] =>
  g.actors.map((a) => lib.fits[a.fit_id]).filter((f): f is FitDoc => !!f);

// ---- Workspaces (docs/27 §5.4): host-side partition of the library by a `ws` tag ----
/** App-private index fields carried on the in-memory Library object (JsonObject extras; persisted via the
 *  library index and round-tripped by format toFiles/fromFiles). */
export interface WorkspaceMeta { id: string; name: string; notes?: string; created?: string; folders?: string[]; tags?: string[] }
export interface WsFields { workspaces?: WorkspaceMeta[]; ws?: Record<string, string> }
export const DEFAULT_WS = 'default';
export const defaultWorkspace = (): WorkspaceMeta => ({ id: DEFAULT_WS, name: 'Default', created: new Date().toISOString() });
const wsFields = (lib: Library): WsFields => lib as WsFields;
/** Registered workspaces plus any ws tag found on documents/groups/fleets (self-healing for hand-made files). */
export function workspacesOf(lib: Library): WorkspaceMeta[] {
  const seen = new Map<string, WorkspaceMeta>();
  for (const w of wsFields(lib).workspaces ?? []) seen.set(w.id, w);
  if (!seen.has(DEFAULT_WS)) seen.set(DEFAULT_WS, { id: DEFAULT_WS, name: 'Default' });
  for (const doc of Object.values(lib.fits)) if (doc.ui?.ws && !seen.has(doc.ui.ws as string)) seen.set(doc.ui.ws as string, { id: doc.ui.ws as string, name: doc.ui.ws as string });
  for (const id of Object.values(wsFields(lib).ws ?? {})) if (!seen.has(id)) seen.set(id, { id, name: id });
  return [...seen.values()];
}
export const mergeWorkspaces = (a: WorkspaceMeta[] | undefined, b: WorkspaceMeta[] | undefined): WorkspaceMeta[] => {
  const m = new Map<string, WorkspaceMeta>();
  for (const w of [...(a ?? []), ...(b ?? [])]) m.set(w.id, { ...m.get(w.id), ...w });
  return m.size ? [...m.values()] : [defaultWorkspace()];
};
/** A fit document's workspace (ui.ws; absent = 'default'). */
export const docWs = (doc: FitDoc): string => (doc.ui?.ws as string | undefined) || DEFAULT_WS;
export const setDocWs = (doc: FitDoc, ws: string): FitDoc => ({ ...doc, ui: { ...doc.ui, ws } });
/** Workspace of a non-document entity (groups, fleets): the parallel `ws` id→workspace map in the index. */
export const entityWs = (lib: Library, id: string): string => wsFields(lib).ws?.[id] ?? DEFAULT_WS;
export const setEntityWs = (lib: Library, id: string, ws: string): Library =>
  ({ ...lib, ws: { ...(wsFields(lib).ws ?? {}), [id]: ws } } as Library);
/** The slice of the library belonging to one workspace (fits by doc.ui.ws, groups/fleets by the ws map). */
export function filterWorkspace(lib: Library, ws: string): Library {
  const fits = Object.fromEntries(Object.entries(lib.fits).filter(([, f]) => docWs(f) === ws));
  const groups = Object.fromEntries(Object.entries(lib.groups ?? {}).filter(([id]) => entityWs(lib, id) === ws));
  const fleets = Object.fromEntries(Object.entries(lib.fleets ?? {}).filter(([id]) => entityWs(lib, id) === ws));
  return { ...lib, fits, groups, fleets };
}
/** Documents + groups per workspace id (for the workspace manager's delete guard). */
export function wsCounts(lib: Library): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of Object.values(lib.fits)) counts[docWs(f)] = (counts[docWs(f)] ?? 0) + 1;
  for (const id of Object.keys(lib.groups ?? {})) { const w = entityWs(lib, id); counts[w] = (counts[w] ?? 0) + 1; }
  for (const id of Object.keys(lib.fleets ?? {})) { const w = entityWs(lib, id); counts[w] = (counts[w] ?? 0) + 1; }
  return counts;
}
export function upsertWorkspace(lib: Library, ws: WorkspaceMeta): Library {
  const rest = (wsFields(lib).workspaces ?? []).filter((w) => w.id !== ws.id);
  return { ...lib, workspaces: [...rest, ws] } as Library;
}
export function removeWorkspace(lib: Library, id: string): Library {
  if (id === DEFAULT_WS) return lib;
  const workspaces = (wsFields(lib).workspaces ?? []).filter((w) => w.id !== id);
  const ws = Object.fromEntries(Object.entries(wsFields(lib).ws ?? {}).filter(([, w]) => w !== id));
  return { ...lib, workspaces, ws } as Library;
}
/** The active-workspace slice with the workspace name as index metadata (for zip/dir export). */
export function workspaceExportLib(lib: Library, ws: string): Library {
  const view = filterWorkspace(lib, ws);
  const meta = workspacesOf(lib).find((w) => w.id === ws);
  return { ...view, workspaces: meta ? [meta] : [], ws: {}, name: meta?.name ?? ws } as Library;
}
/** Folder picker list inside a workspace: the workspace's own folder list plus the folders its fits/fleets use. */
export function wsFolders(lib: Library, ws: string): string[] {
  const meta = workspacesOf(lib).find((w) => w.id === ws);
  const view = filterWorkspace(lib, ws);
  return allFolders({ ...view, folders: meta?.folders ?? [] });
}
/** Tag chips inside a workspace: the workspace's tag list plus the tags on its fits. */
export function wsTags(lib: Library, ws: string): string[] {
  const meta = workspacesOf(lib).find((w) => w.id === ws);
  return normTags([...(meta?.tags ?? []), ...allTags(filterWorkspace(lib, ws))]);
}
/** Adds folder paths / tag names to the workspace's own lists (so they show in its pickers). */
export function wsRegister(lib: Library, ws: string, patch: { folders?: string[]; tags?: string[] }): Library {
  const meta = workspacesOf(lib).find((w) => w.id === ws) ?? { id: ws, name: ws };
  const next: WorkspaceMeta = { ...meta };
  if (patch.folders) next.folders = normTags([...(meta.folders ?? []), ...patch.folders]);
  if (patch.tags) next.tags = normTags([...(meta.tags ?? []), ...patch.tags]);
  return upsertWorkspace(lib, next);
}

// ---- Packages (exfa/package@1): dependency-closure import/export ----
/** Merges an exfa/package@1 into the library (rename-on-conflict) and tags everything it carries with the active
 *  workspace. Package fit docs keep `ui.ws` through conflict renames; new groups/fleets get a `ws` map entry. */
export function importPackage(lib: Library, pkg: Package, ws: string): { lib: Library; issues: string[] } {
  const p = structuredClone(pkg);
  for (const d of Object.values(p.library.fits ?? {})) d.ui = { ...(d.ui ?? {}), ws };
  const next = structuredClone(lib) as Library & WsFields;
  const beforeGroups = new Set(Object.keys(next.groups ?? {}));
  const beforeFleets = new Set(Object.keys(next.fleets ?? {}));
  const res = mergePackage(next, p, { onConflict: 'rename' });
  const wsMap = { ...(next.ws ?? {}) };
  for (const id of Object.keys(next.groups ?? {})) if (!beforeGroups.has(id)) wsMap[id] = ws;
  for (const id of Object.keys(next.fleets ?? {})) if (!beforeFleets.has(id)) wsMap[id] = ws;
  next.ws = wsMap;
  return { lib: next, issues: res.issues };
}
/** Serializes a package as one `.exfa.json` file (name fit/group + root id, same convention as toFiles). */
export const packageToFile = (pkg: Package, label: string): { path: string; text: string } => ({
  path: `${label.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) || 'package'}.${encodeURIComponent(pkg.root.id)}.exfa.json`,
  text: JSON.stringify(pkg, null, 2) + '\n',
});
