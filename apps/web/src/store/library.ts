// Persistent fit library: IndexedDB (database "eve-fit-web": object store "docs" keyed by document id, store "kv"
// holding the library index under "index"), so a large library (hundreds of fits, Pyfa imports) is not bound by the
// localStorage quota and a change writes only the documents that changed. Documents are exfa/fit@1
// (@exfa/format). Version 1's "fits"/"kv" stores are kept untouched as a backup; the first v2 open migrates them
// through the format package's migrate. Falls back to localStorage when IndexedDB is unavailable (some private
// modes) and to memory as a last resort; the localStorage library of earlier versions (key eve-fit-web:v1) is
// migrated likewise and a copy kept under eve-fit-web:v1:migrated.
import { migrate, migrateFitDocument } from '@exfa/format';
import type { Character, DamagePattern, FitDoc, Library, TargetProfile } from '../fit/model';
import { ensureItemIds, type WorkspaceMeta } from '../fit/library';

export const LEGACY_KEY = 'eve-fit-web:v1';
const DB_NAME = 'eve-fit-web', DB_VERSION = 2;
/** The part of the library that is not fit documents, stored as one kv entry ("index"). `workspaces` is the
 *  workspace registry and `ws` the entity→workspace tag map for non-documents (groups, fleets); both are
 *  app-private fields inside the index JSON (docs carry their own tag on `doc.ui.ws`). */
export type LibraryIndex = Pick<Library, 'characters' | 'damage_patterns' | 'target_profiles' | 'scenarios' | 'fleets' | 'groups' | 'folders'> & {
  workspaces?: WorkspaceMeta[]; ws?: Record<string, string>;
};
export type StoredLibrary = LibraryIndex & { fits: Record<string, FitDoc> };

export interface LibraryBackend {
  readonly kind: 'indexeddb' | 'localstorage' | 'memory';
  load(): Promise<StoredLibrary | null>;
  /** put changed documents, delete removed ones, replace the index entry: one transaction */
  write(put: FitDoc[], del: string[], index: LibraryIndex | null): Promise<void>;
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error('transaction aborted')); });

const emptyIndex = (): LibraryIndex => ({ characters: {}, damage_patterns: {}, target_profiles: {}, scenarios: {}, fleets: {}, groups: {}, folders: [], workspaces: [{ id: 'default', name: 'Default' }], ws: {} });
const indexPart = (lib: StoredLibrary | Library): LibraryIndex => ({
  characters: userOnly(lib.characters ?? {}), damage_patterns: userOnly(lib.damage_patterns ?? {}), target_profiles: userOnly(lib.target_profiles ?? {}),
  scenarios: userOnly(lib.scenarios ?? {}), fleets: lib.fleets ?? {}, groups: lib.groups ?? {}, folders: lib.folders ?? [],
  workspaces: (lib as { workspaces?: WorkspaceMeta[] }).workspaces ?? emptyIndex().workspaces,
  ws: (lib as { ws?: Record<string, string> }).ws ?? {},
});
export async function indexedDbBackend(idb: IDBFactory = indexedDB, name = DB_NAME): Promise<LibraryBackend> {
  const open = idb.open(name, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    // v2 layout; the v1 "fits"/"kv" stores stay as a backup of the pre-migration data
    if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
  };
  const db = await req(open);
  const writeDocs = async (put: FitDoc[], del: string[], index: LibraryIndex | null) => {
    const tx = db.transaction(['docs', 'kv'], 'readwrite');
    const ds = tx.objectStore('docs'), ks = tx.objectStore('kv');
    for (const f of put) ds.put(f);
    for (const id of del) ds.delete(id);
    if (index) ks.put(index, 'index');
    ks.put(2, 'schema');
    await done(tx);
  };
  return {
    kind: 'indexeddb',
    async load() {
      const tx = db.transaction(['docs', 'kv'], 'readonly');
      const [docs, index] = await Promise.all([
        req(tx.objectStore('docs').getAll() as IDBRequest<FitDoc[]>),
        req(tx.objectStore('kv').get('index') as IDBRequest<LibraryIndex | undefined>),
      ]);
      if (index != null || docs.length)
        return { ...emptyIndex(), ...(index ?? {}), fits: Object.fromEntries(docs.map((f) => [f.id, f])) };
      // v1 leftovers ("fits" store + per-key kv entries): migrate to documents and persist under the v2 layout.
      if (!db.objectStoreNames.contains('fits')) return null;
      const ltx = db.transaction(['fits', 'kv'], 'readonly');
      const [fits, schema, ...kv] = await Promise.all([
        req(ltx.objectStore('fits').getAll() as IDBRequest<Record<string, unknown>[]>),
        req(ltx.objectStore('kv').get('schema')),
        ...['characters', 'damagePatterns', 'targetProfiles', 'folders'].map((k) => req(ltx.objectStore('kv').get(k))),
      ]);
      if (schema == null && !fits.length) return null;
      const [characters, damagePatterns, targetProfiles, folders] = kv as [Record<string, Character> | undefined, Record<string, DamagePattern> | undefined, Record<string, TargetProfile> | undefined, string[] | undefined];
      // storedPart drops built-ins: v1 could store them next to user entries
      const stored = fits.length
        ? storedPart(migrate({ fits: Object.fromEntries(fits.map((f) => [f.id as string ?? '', f])), characters: characters ?? {}, damagePatterns: damagePatterns ?? {}, targetProfiles: targetProfiles ?? {}, folders: folders ?? [] }))
        : { fits: {}, ...emptyIndex(), characters: userOnly(characters ?? {}), damage_patterns: userOnly(damagePatterns ?? {}), target_profiles: userOnly(targetProfiles ?? {}), folders: folders ?? [] };
      await writeDocs(Object.values(stored.fits), [], indexPart(stored));
      return stored;
    },
    write: writeDocs,
  };
}

export function localStorageBackend(storage: Storage = localStorage, key = 'eve-fit-web:library'): LibraryBackend {
  let cur: StoredLibrary | null = null;
  const persist = () => storage.setItem(key, JSON.stringify({ format: 'exfa/library@1', ...indexPart(cur!), fits: cur!.fits }));
  return {
    kind: 'localstorage',
    async load() {
      let raw: unknown = null;
      try { raw = JSON.parse(storage.getItem(key) ?? 'null'); } catch { /* corrupt */ }
      if (!raw || typeof raw !== 'object') return null;
      // stored as a canonical library; older shapes (camelCase kv / flat fits) go through migrateFitDocument per doc
      const src = raw as Record<string, unknown>;
      const fits = Object.fromEntries(Object.entries(src.fits as Record<string, unknown> ?? {}).map(([id, f]) => [id, migrateFitDocument(f, id)]));
      cur = {
        fits,
        characters: (src.characters ?? {}) as LibraryIndex['characters'],
        damage_patterns: ((src.damage_patterns ?? src.damagePatterns) ?? {}) as LibraryIndex['damage_patterns'],
        target_profiles: ((src.target_profiles ?? src.targetProfiles) ?? {}) as LibraryIndex['target_profiles'],
        scenarios: (src.scenarios ?? {}) as LibraryIndex['scenarios'],
        fleets: (src.fleets ?? {}) as LibraryIndex['fleets'],
        groups: (src.groups ?? {}) as LibraryIndex['groups'],
        folders: Array.isArray(src.folders) ? src.folders as string[] : [],
        workspaces: Array.isArray(src.workspaces) ? src.workspaces as WorkspaceMeta[] : emptyIndex().workspaces,
        ws: (src.ws && typeof src.ws === 'object' ? src.ws : {}) as Record<string, string>,
      };
      if (src.format !== 'exfa/library@1' || Object.values(src.fits as Record<string, unknown> ?? {}).some((f) => (f as Record<string, unknown>)?.format !== 'exfa/fit@1')) persist();
      return cur;
    },
    async write(put, del, index) {
      cur ??= { fits: {}, ...emptyIndex() };
      for (const f of put) cur.fits[f.id] = f;
      for (const id of del) delete cur.fits[id];
      if (index) Object.assign(cur, index);
      persist();
    },
  };
}

export function memoryBackend(): LibraryBackend {
  let cur: StoredLibrary | null = null;
  return {
    kind: 'memory',
    async load() { return cur && structuredClone(cur); },
    async write(put, del, index) {
      cur ??= { fits: {}, ...emptyIndex() };
      for (const f of put) cur.fits[f.id] = structuredClone(f);
      for (const id of del) delete cur.fits[id];
      if (index) Object.assign(cur, structuredClone(index));
    },
  };
}

const userOnly = <T extends { builtin?: boolean }>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([, v]) => !v.builtin));
/** The persisted part of a library: user documents, characters, profiles, scenarios, fleets and folders (no
 *  built-ins / SDE presets). */
export function storedPart(lib: Library): StoredLibrary {
  return {
    fits: lib.fits,
    characters: userOnly(lib.characters), damage_patterns: userOnly(lib.damage_patterns), target_profiles: userOnly(lib.target_profiles),
    scenarios: userOnly(lib.scenarios ?? {}), fleets: lib.fleets ?? {}, groups: lib.groups ?? {}, folders: lib.folders ?? [],
    workspaces: (lib as { workspaces?: WorkspaceMeta[] }).workspaces ?? emptyIndex().workspaces,
    ws: (lib as { ws?: Record<string, string> }).ws ?? {},
  };
}

/** Diff of two library states: documents by object identity (the UI replaces a document on every edit), the index
 *  by shallow entry comparison. */
export function diffLibrary(prev: StoredLibrary | null, next: StoredLibrary): { put: FitDoc[]; del: string[]; index: LibraryIndex | null } {
  const put = Object.values(next.fits).filter((f) => prev?.fits[f.id] !== f);
  const del = prev ? Object.keys(prev.fits).filter((id) => !next.fits[id]) : [];
  const pi = prev && indexPart(prev), ni = indexPart(next);
  // storedPart/indexPart build fresh objects every call; compare contents, not identity
  const index = !pi || JSON.stringify(pi) !== JSON.stringify(ni) ? ni : null;
  return { put, del, index };
}

/** Opens the best available backend; migrates the legacy localStorage library into it on first use. */
export async function openLibrary(legacyRaw: string | null = null): Promise<{ backend: LibraryBackend; lib: StoredLibrary; migrated: number; note?: string }> {
  let backend: LibraryBackend, note: string | undefined;
  try { backend = await indexedDbBackend(); } catch (e) {
    note = `IndexedDB unavailable (${(e as Error)?.message ?? e}): library kept in localStorage`;
    try { localStorage.getItem('x'); backend = localStorageBackend(); } catch { backend = memoryBackend(); note = 'no persistent storage: library kept in memory only'; }
  }
  let lib = await backend.load();
  let migrated = 0;
  if (!lib) {
    lib = { fits: {}, ...emptyIndex() };
    try {
      const legacy = JSON.parse(legacyRaw ?? 'null')?.lib;
      if (legacy) {
        const moved = migrate(legacy);
        lib = storedPart(moved);
        migrated = Object.keys(lib.fits).length;
      }
    } catch { /* no legacy library */ }
    lib = { ...lib, fits: Object.fromEntries(Object.entries(lib.fits).map(([id, f]) => [id, ensureItemIds(f)])) };
    await backend.write(Object.values(lib.fits), [], indexPart(lib));
    // keep a copy of the migrated library; the legacy key itself now holds the settings only (store/index.ts)
    try { if (migrated && legacyRaw) localStorage.setItem(`${LEGACY_KEY}:migrated`, legacyRaw); } catch { /* quota */ }
  } else {
    // one-time normalization: documents stored before equipment ids existed get them now (persisted once)
    const pairs = Object.entries(lib.fits).map(([id, f]) => [id, ensureItemIds(f)] as const);
    const fixed = pairs.filter(([id, f]) => f !== lib!.fits[id]).map(([, f]) => f);
    if (fixed.length) {
      lib = { ...lib, fits: Object.fromEntries(pairs) };
      await backend.write(fixed, [], null).catch(() => {});
    }
  }
  return { backend, lib, migrated, note };
}
