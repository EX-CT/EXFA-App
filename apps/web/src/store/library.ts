// Persistent fit library: IndexedDB (database "eve-fit-web": object store "fits" keyed by fit id, store "kv" for
// characters / profiles / folders), so a large library (hundreds of fits, Pyfa imports) is not bound by the
// localStorage quota and a change writes only the fits that changed. Falls back to localStorage when IndexedDB is
// unavailable (some private modes) and to memory as a last resort. The first run migrates the localStorage library
// of earlier versions (key eve-fit-web:v1) and keeps a copy of it under eve-fit-web:v1:migrated.
import type { Character, DamagePattern, Fit, Library, TargetProfile } from '../fit/model';

export const LEGACY_KEY = 'eve-fit-web:v1';
const DB_NAME = 'eve-fit-web', DB_VERSION = 1;
export type StoredLibrary = Pick<Library, 'fits' | 'characters' | 'damagePatterns' | 'targetProfiles'> & { folders: string[] };
type Kv = { characters: Record<string, Character>; damagePatterns: Record<string, DamagePattern>; targetProfiles: Record<string, TargetProfile>; folders: string[] };
const KV_KEYS = ['characters', 'damagePatterns', 'targetProfiles', 'folders'] as const;

export interface LibraryBackend {
  readonly kind: 'indexeddb' | 'localstorage' | 'memory';
  load(): Promise<StoredLibrary | null>;
  /** put changed fits, delete removed ones, replace the given kv entries: one transaction */
  write(put: Fit[], del: string[], kv: Partial<Kv>): Promise<void>;
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error('transaction aborted')); });

export async function indexedDbBackend(idb: IDBFactory = indexedDB, name = DB_NAME): Promise<LibraryBackend> {
  const open = idb.open(name, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains('fits')) db.createObjectStore('fits', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
  };
  const db = await req(open);
  return {
    kind: 'indexeddb',
    async load() {
      const tx = db.transaction(['fits', 'kv'], 'readonly');
      const [fits, schema, ...kv] = await Promise.all([
        req(tx.objectStore('fits').getAll() as IDBRequest<Fit[]>), req(tx.objectStore('kv').get('schema')),
        ...KV_KEYS.map((k) => req(tx.objectStore('kv').get(k))),
      ]);
      if (schema == null) return null;
      const [characters, damagePatterns, targetProfiles, folders] = kv as [Kv['characters'], Kv['damagePatterns'], Kv['targetProfiles'], string[]];
      return { fits: Object.fromEntries(fits.map((f) => [f.id, f])), characters: characters ?? {}, damagePatterns: damagePatterns ?? {}, targetProfiles: targetProfiles ?? {}, folders: folders ?? [] };
    },
    async write(put, del, kv) {
      const tx = db.transaction(['fits', 'kv'], 'readwrite');
      const fs = tx.objectStore('fits'), ks = tx.objectStore('kv');
      for (const f of put) fs.put(f);
      for (const id of del) fs.delete(id);
      for (const [k, v] of Object.entries(kv)) ks.put(v, k);
      ks.put(1, 'schema');
      await done(tx);
    },
  };
}

export function localStorageBackend(storage: Storage = localStorage, key = 'eve-fit-web:library'): LibraryBackend {
  let cur: StoredLibrary | null = null;
  return {
    kind: 'localstorage',
    async load() { try { cur = JSON.parse(storage.getItem(key) ?? 'null'); } catch { cur = null; } return cur; },
    async write(put, del, kv) {
      cur ??= { fits: {}, characters: {}, damagePatterns: {}, targetProfiles: {}, folders: [] };
      for (const f of put) cur.fits[f.id] = f;
      for (const id of del) delete cur.fits[id];
      Object.assign(cur, kv);
      storage.setItem(key, JSON.stringify(cur));
    },
  };
}

export function memoryBackend(): LibraryBackend {
  let cur: StoredLibrary | null = null;
  return {
    kind: 'memory',
    async load() { return cur && structuredClone(cur); },
    async write(put, del, kv) {
      cur ??= { fits: {}, characters: {}, damagePatterns: {}, targetProfiles: {}, folders: [] };
      for (const f of put) cur.fits[f.id] = structuredClone(f);
      for (const id of del) delete cur.fits[id];
      Object.assign(cur, structuredClone(kv));
    },
  };
}

const userOnly = <T extends { builtin?: boolean }>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([, v]) => !v.builtin));
/** The persisted part of a library: user fits, characters, profiles (no built-ins / SDE presets) and folders. */
export function storedPart(lib: Library): StoredLibrary {
  return { fits: lib.fits, characters: userOnly(lib.characters), damagePatterns: userOnly(lib.damagePatterns), targetProfiles: userOnly(lib.targetProfiles), folders: lib.folders ?? [] };
}

/** Diff of two library states: fits by object identity (the UI replaces a fit object on every edit), kv by identity
 *  of the filtered maps' entries. */
export function diffLibrary(prev: StoredLibrary | null, next: StoredLibrary): { put: Fit[]; del: string[]; kv: Partial<Kv> } {
  const put = Object.values(next.fits).filter((f) => prev?.fits[f.id] !== f);
  const del = prev ? Object.keys(prev.fits).filter((id) => !next.fits[id]) : [];
  const kv: Partial<Kv> = {};
  const sameMap = (a: Record<string, unknown> | undefined, b: Record<string, unknown>) =>
    !!a && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([k, v]) => a[k] === v);
  for (const k of ['characters', 'damagePatterns', 'targetProfiles'] as const) if (!sameMap(prev?.[k] as never, next[k] as never)) (kv as Record<string, unknown>)[k] = next[k];
  if (!prev || JSON.stringify(prev.folders) !== JSON.stringify(next.folders)) kv.folders = next.folders;
  return { put, del, kv };
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
    lib = { fits: {}, characters: {}, damagePatterns: {}, targetProfiles: {}, folders: [] };
    try {
      const legacy = JSON.parse(legacyRaw ?? 'null')?.lib;
      if (legacy) {
        lib = { fits: legacy.fits ?? {}, characters: userOnly(legacy.characters ?? {}), damagePatterns: userOnly(legacy.damagePatterns ?? {}), targetProfiles: userOnly(legacy.targetProfiles ?? {}), folders: [] };
        migrated = Object.keys(lib.fits).length;
      }
    } catch { /* no legacy library */ }
    await backend.write(Object.values(lib.fits), [], { characters: lib.characters, damagePatterns: lib.damagePatterns, targetProfiles: lib.targetProfiles, folders: lib.folders });
    // keep a copy of the migrated library; the legacy key itself now holds the settings only (store/index.ts)
    try { if (migrated && legacyRaw) localStorage.setItem(`${LEGACY_KEY}:migrated`, legacyRaw); } catch { /* quota */ }
  }
  return { backend, lib, migrated, note };
}
