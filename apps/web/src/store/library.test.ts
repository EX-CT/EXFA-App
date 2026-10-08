import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { emptyLibrary, newFit, type FitDoc } from '../fit/model';
import { diffLibrary, indexedDbBackend, localStorageBackend, openLibrary, storedPart, LEGACY_KEY, type LibraryIndex } from './library';
import { BUILTIN_CHARACTERS } from '../data/presets';

class MemStorage implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}
const fit = (id: string, name = id): FitDoc => ({ ...newFit(587, name), id });
const index = (p: Partial<LibraryIndex> = {}): LibraryIndex => ({ characters: {}, damage_patterns: {}, target_profiles: {}, scenarios: {}, fleets: {}, groups: {}, folders: [], ...p });
const lib = (fits: Record<string, FitDoc>, p: Partial<LibraryIndex> = {}) =>
  ({ ...emptyLibrary(), fits, characters: Object.fromEntries(BUILTIN_CHARACTERS.map((c) => [c.id, c])), ...p });

describe('store/library (IndexedDB v2)', () => {
  it('web.unit.store-idb-roundtrip: documents and the index entry survive a new connection; puts, deletes and index replace in one transaction', async () => {
    const idb = new IDBFactory();
    const a = await indexedDbBackend(idb, 't1');
    expect(await a.load()).toBeNull();
    await a.write([fit('x'), fit('y')], [], index({ characters: { c1: { id: 'c1', name: 'Me', default_level: 4, levels: { 3300: 5 } } }, folders: ['PvP'] }));
    await a.write([fit('x', 'renamed')], ['y'], null);
    const b = await indexedDbBackend(idb, 't1');
    const l = await b.load();
    expect(Object.keys(l!.fits)).toEqual(['x']);
    expect(l!.fits.x.name).toBe('renamed');
    expect(l!.characters.c1.levels).toEqual({ 3300: 5 });
    expect(l!.folders).toEqual(['PvP']);
  });
  it('web.unit.store-idb-v1-migration: documents stored as v1 flat fits migrate to docs on first open, old stores kept as backup', async () => {
    const idb = new IDBFactory();
    const open = idb.open('t2', 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      db.createObjectStore('fits', { keyPath: 'id' });
      db.createObjectStore('kv');
    };
    const db = await new Promise<IDBDatabase>((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error); });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(['fits', 'kv'], 'readwrite');
      tx.objectStore('fits').put({ id: 'old', name: 'Old flat fit', ship_type_id: 587, modules: [{ type_id: 2873, slot: 'high', state: 'active' }], character_id: 'all4', folder: 'Legacy' });
      tx.objectStore('kv').put(1, 'schema');
      tx.objectStore('kv').put({ c1: { id: 'c1', name: 'Me', default_level: 3, levels: {} } }, 'characters');
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
    db.close();
    const backend = await indexedDbBackend(idb, 't2');
    const l = await backend.load();
    expect(l).not.toBeNull();
    const doc = l!.fits.old;
    expect(doc.format).toBe('exfa/fit@1');
    expect(doc.fit.ship.type_id).toBe(587);
    expect(doc.fit.modules[0].type_id).toBe(2873);
    expect(doc.refs.character_id).toBe('all4');
    expect(doc.folder).toBe('Legacy');
    expect(l!.characters.c1.name).toBe('Me');
    // migrated data was persisted under the v2 layout; a fresh open reads docs directly
    const again = await indexedDbBackend(idb, 't2');
    expect((await again.load())!.fits.old.fit.ship.type_id).toBe(587);
    db.close();
  });
  it('web.unit.store-index-groups-ws: groups, workspace registry and entity ws tags persist through the index (docs/27)', async () => {
    const idb = new IDBFactory();
    const a = await indexedDbBackend(idb, 'tws');
    const group = { format: 'exfa/group@1' as const, id: 'g1', name: 'pair', actors: [], relations: [] };
    const idx = index({ groups: { g1: group }, workspaces: [{ id: 'default', name: 'Default' }, { id: 'ws2', name: 'roam' }], ws: { g1: 'ws2', fl1: 'ws2' } });
    await a.write([fit('x')], [], idx);
    const l = (await indexedDbBackend(idb, 'tws').then((b) => b.load()))!;
    expect(l.groups.g1.name).toBe('pair');
    expect(l.workspaces?.map((w) => w.id)).toEqual(['default', 'ws2']);
    expect(l.ws).toEqual({ g1: 'ws2', fl1: 'ws2' });
    // storedPart/diffLibrary carry the same fields so index writes fire on group/workspace changes
    const s0 = storedPart(lib({ x: fit('x') }));
    const s1 = storedPart({ ...lib({ x: fit('x') }), groups: { g1: group } });
    expect(diffLibrary(s0, s1).index?.groups.g1.id).toBe('g1');
    const s2 = storedPart({ ...lib({ x: fit('x') }), workspaces: [{ id: 'w9', name: 'n' }], ws: { e: 'w9' } });
    expect(diffLibrary(s0, s2).index?.ws).toEqual({ e: 'w9' });
  });
  it('web.unit.store-diff: only changed documents are written, removed ones deleted, built-ins never stored', () => {
    const f1 = fit('a'), f2 = fit('b');
    const l = lib({ a: f1, b: f2 });
    const s0 = storedPart(l);
    expect(s0.characters).toEqual({});
    const first = diffLibrary(null, s0);
    expect(first.put).toHaveLength(2);
    const f1b = { ...f1, name: 'changed' };
    const d = diffLibrary(s0, storedPart({ ...l, fits: { a: f1b } }));
    expect(d.put).toEqual([f1b]);
    expect(d.del).toEqual(['b']);
    expect(d.index).toBeNull();
    expect(diffLibrary(s0, storedPart({ ...l, folders: ['X'] })).index?.folders).toEqual(['X']);
  });
  it('web.unit.store-migration: the localStorage library of earlier versions moves into IndexedDB once; a copy is kept', async () => {
    const g = globalThis as unknown as { indexedDB: IDBFactory; localStorage: Storage };
    g.indexedDB = new IDBFactory(); g.localStorage = new MemStorage();
    const legacy = JSON.stringify({ lib: { fits: { old: { id: 'old', name: 'Old flat fit', ship_type_id: 587, modules: [] } }, characters: { all5: { ...BUILTIN_CHARACTERS[0] }, me: { id: 'me', name: 'Me', default_level: 3, levels: {} } }, damagePatterns: {}, targetProfiles: {} }, settings: { lang: 'zh' } });
    const r1 = await openLibrary(legacy);
    expect(r1.backend.kind).toBe('indexeddb');
    expect(r1.migrated).toBe(1);
    expect(Object.keys(r1.lib.characters)).toEqual(['me']);
    expect(r1.lib.fits.old.format).toBe('exfa/fit@1');
    expect(g.localStorage.getItem(`${LEGACY_KEY}:migrated`)).toBe(legacy);
    const r2 = await openLibrary(legacy);
    expect(r2.migrated).toBe(0);
    expect(r2.lib.fits.old.name).toBe('Old flat fit');
  });
  it('web.unit.store-fallback: without IndexedDB the library goes to localStorage', async () => {
    const g = globalThis as unknown as { indexedDB: unknown; localStorage: Storage };
    g.indexedDB = { open() { throw new Error('blocked'); } };
    g.localStorage = new MemStorage();
    const r = await openLibrary(null);
    expect(r.backend.kind).toBe('localstorage');
    expect(r.note).toMatch(/IndexedDB unavailable/);
    await r.backend.write([fit('z')], [], index());
    expect(Object.keys((await localStorageBackend(g.localStorage).load())!.fits)).toEqual(['z']);
  });
});
