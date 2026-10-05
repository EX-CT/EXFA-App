import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { newFit, type Fit } from '../fit/model';
import { diffLibrary, indexedDbBackend, localStorageBackend, openLibrary, storedPart, LEGACY_KEY } from './library';
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
const fit = (id: string, name = id): Fit => ({ ...newFit(587, name), id });

describe('store/library (IndexedDB)', () => {
  it('web.unit.store-idb-roundtrip: fits and kv survive a new connection; puts, deletes and kv replace in one transaction', async () => {
    const idb = new IDBFactory();
    const a = await indexedDbBackend(idb, 't1');
    expect(await a.load()).toBeNull();
    await a.write([fit('x'), fit('y')], [], { characters: { c1: { id: 'c1', name: 'Me', default_level: 4, levels: { 3300: 5 } } }, folders: ['PvP'] });
    await a.write([fit('x', 'renamed')], ['y'], {});
    const b = await indexedDbBackend(idb, 't1');
    const l = await b.load();
    expect(Object.keys(l!.fits)).toEqual(['x']);
    expect(l!.fits.x.name).toBe('renamed');
    expect(l!.characters.c1.levels).toEqual({ 3300: 5 });
    expect(l!.folders).toEqual(['PvP']);
  });
  it('web.unit.store-diff: only changed fits are written, removed ones deleted, built-ins never stored', () => {
    const f1 = fit('a'), f2 = fit('b');
    const lib = { fits: { a: f1, b: f2 }, characters: Object.fromEntries(BUILTIN_CHARACTERS.map((c) => [c.id, c])), damagePatterns: {}, targetProfiles: {}, folders: [] };
    const s0 = storedPart(lib);
    expect(s0.characters).toEqual({});
    const first = diffLibrary(null, s0);
    expect(first.put).toHaveLength(2);
    const f1b = { ...f1, name: 'changed' };
    const d = diffLibrary(s0, storedPart({ ...lib, fits: { a: f1b } }));
    expect(d.put).toEqual([f1b]);
    expect(d.del).toEqual(['b']);
    expect(d.kv).toEqual({});
    expect(diffLibrary(s0, storedPart({ ...lib, folders: ['X'] })).kv).toEqual({ folders: ['X'] });
  });
  it('web.unit.store-migration: the localStorage library of earlier versions moves into IndexedDB once; a copy is kept', async () => {
    const g = globalThis as unknown as { indexedDB: IDBFactory; localStorage: Storage };
    g.indexedDB = new IDBFactory(); g.localStorage = new MemStorage();
    const legacy = JSON.stringify({ lib: { fits: { old: fit('old', 'Old fit') }, characters: { all5: { ...BUILTIN_CHARACTERS[0] }, me: { id: 'me', name: 'Me', default_level: 3, levels: {} } }, damagePatterns: {}, targetProfiles: {} }, settings: { lang: 'zh' } });
    const r1 = await openLibrary(legacy);
    expect(r1.backend.kind).toBe('indexeddb');
    expect(r1.migrated).toBe(1);
    expect(Object.keys(r1.lib.characters)).toEqual(['me']);
    expect(g.localStorage.getItem(`${LEGACY_KEY}:migrated`)).toBe(legacy);
    const r2 = await openLibrary(legacy);
    expect(r2.migrated).toBe(0);
    expect(r2.lib.fits.old.name).toBe('Old fit');
  });
  it('web.unit.store-fallback: without IndexedDB the library goes to localStorage', async () => {
    const g = globalThis as unknown as { indexedDB: unknown; localStorage: Storage };
    g.indexedDB = { open() { throw new Error('blocked'); } };
    g.localStorage = new MemStorage();
    const r = await openLibrary(null);
    expect(r.backend.kind).toBe('localstorage');
    expect(r.note).toMatch(/IndexedDB unavailable/);
    await r.backend.write([fit('z')], [], {});
    expect(Object.keys((await localStorageBackend(g.localStorage).load())!.fits)).toEqual(['z']);
  });
});
