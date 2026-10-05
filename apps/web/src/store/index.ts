// Client-side persistence: the fit library (fits, characters, profiles, folders) in IndexedDB (./library.ts), the
// settings in localStorage. The engine itself is stateless.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BUILTIN_CHARACTERS, BUILTIN_DAMAGE, BUILTIN_TARGETS } from '../data/presets';
import type { Library } from '../fit/model';
import type { EngineConfig } from '../engine/adapter';
import { canonicalBackend, DEFAULT_BACKEND } from '../engine/defaults';
import { diffLibrary, LEGACY_KEY, openLibrary, storedPart, type LibraryBackend, type StoredLibrary } from './library';

const KEY = LEGACY_KEY;

export interface Settings { engine: EngineConfig; lang: 'en' | 'zh'; activeFitId: string | null }
export interface AppState { lib: Library; settings: Settings }

const base = import.meta.env.BASE_URL;

export function defaultEngineConfig(): EngineConfig {
  const q = new URLSearchParams(location.search);
  return {
    backend: canonicalBackend(q.get('engine') ?? DEFAULT_BACKEND),
    httpUrl: q.get('http') ?? 'http://127.0.0.1:8080',
    datasetUrl: new URL(`${base}data/dataset.json.gz`, location.href).href,
    wasmUrl: new URL(`${base}engines/f/exfa_wasm.wasm`, location.href).href,
  };
}

/** A saved backend that equals the default of the build that saved it was never chosen by the user: follow the current default. */
function savedBackend(e: { backend?: string; default_at_save?: string } | undefined): string {
  if (!e?.backend) return DEFAULT_BACKEND;
  return e.backend === (e.default_at_save ?? 'ts-worker') ? DEFAULT_BACKEND : canonicalBackend(e.backend);
}

function initial(): AppState {
  const lib: Library = { fits: {}, characters: {}, damagePatterns: {}, targetProfiles: {}, folders: [] };
  let settings: Settings = { engine: defaultEngineConfig(), lang: 'en', activeFitId: null };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved) settings = { ...settings, ...saved.settings, engine: { ...defaultEngineConfig(), backend: savedBackend(saved.settings?.engine), httpUrl: saved.settings?.engine?.httpUrl ?? settings.engine.httpUrl } };
  } catch { /* ignore corrupt storage */ }
  const q = new URLSearchParams(location.search);
  if (q.get('engine')) settings.engine.backend = canonicalBackend(q.get('engine')!);
  if (q.get('http')) settings.engine.httpUrl = q.get('http')!;
  for (const c of BUILTIN_CHARACTERS) lib.characters[c.id] = c;
  for (const d of BUILTIN_DAMAGE) lib.damagePatterns[d.id] = d;
  for (const t of BUILTIN_TARGETS) lib.targetProfiles[t.id] = t;
  return { lib, settings };
}

export interface StoreStatus { kind: LibraryBackend['kind'] | 'loading'; fits: number; migrated: number; note?: string; error?: string; saves: number }

/** App state with a persistent library. `ready` resolves once the stored library is merged into the state (the
 *  app waits for it before seeding a demo fit or reading ?eft= / ?dna=). Library writes are debounced (150 ms) and
 *  incremental; `window.__eveStore.flush()` waits for pending writes (e2e reload checks). */
let readyResolve: () => void;
export const libraryReady = new Promise<void>((r) => { readyResolve = r; });

/** The localStorage value of earlier versions (library + settings), read before the settings are written back. */
const legacyRaw = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();

export function useAppState() {
  const [state, setState] = useState<AppState>(initial);
  const [status, setStatus] = useState<StoreStatus>({ kind: 'loading', fits: 0, migrated: 0, saves: 0 });
  const backend = useRef<LibraryBackend | null>(null);
  const saved = useRef<StoredLibrary | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(state); latest.current = state;
  useEffect(() => {
    let alive = true;
    openLibrary(legacyRaw).then(({ backend: b, lib, migrated, note }) => {
      if (!alive) return;
      backend.current = b;
      setState((s) => {
        const merged: Library = { ...s.lib, fits: { ...lib.fits, ...s.lib.fits }, characters: { ...s.lib.characters, ...lib.characters },
          damagePatterns: { ...s.lib.damagePatterns, ...lib.damagePatterns }, targetProfiles: { ...s.lib.targetProfiles, ...lib.targetProfiles }, folders: lib.folders };
        saved.current = { ...lib, fits: { ...lib.fits } };
        return { ...s, lib: merged };
      });
      setStatus({ kind: b.kind, fits: Object.keys(lib.fits).length, migrated, note, saves: 0 });
      readyResolve();
    }, (e) => { setStatus((x) => ({ ...x, kind: 'memory', error: String(e?.message ?? e) })); readyResolve(); });
    return () => { alive = false; };
  }, []);
  const flush = useCallback(() => {
    const b = backend.current;
    if (!b) return chain.current;
    const next = storedPart(latest.current.lib);
    const d = diffLibrary(saved.current, next);
    if (!d.put.length && !d.del.length && !Object.keys(d.kv).length) return chain.current;
    saved.current = { ...next, fits: { ...next.fits } };
    chain.current = chain.current.then(() => b.write(d.put, d.del, d.kv)).then(
      () => setStatus((x) => ({ ...x, fits: Object.keys(next.fits).length, saves: x.saves + 1, error: undefined })),
      (e) => setStatus((x) => ({ ...x, error: `saving failed: ${e?.message ?? e}` })));
    return chain.current;
  }, []);
  useEffect(() => {
    if (!backend.current) return;
    const t = setTimeout(flush, 150);
    return () => clearTimeout(t);
  }, [state.lib, status.kind, flush]);
  useEffect(() => {
    // not before the library is open: until then the key may still hold the legacy library to migrate
    if (status.kind === 'loading') return;
    localStorage.setItem(KEY, JSON.stringify({
      settings: { ...state.settings, engine: { backend: state.settings.engine.backend, default_at_save: DEFAULT_BACKEND, httpUrl: state.settings.engine.httpUrl } },
    }));
  }, [state.settings, status.kind]);
  useEffect(() => {
    const onHide = () => { void flush(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    (window as unknown as { __eveStore: unknown }).__eveStore = { status, flush };
    return () => { window.removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onHide); };
  }, [status, flush]);
  const update = useCallback((f: (s: AppState) => AppState) => setState((s) => f(s)), []);
  return [state, update, status] as const;
}
