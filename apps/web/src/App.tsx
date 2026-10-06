import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadSdePresets } from './data/sdePresets';
import { setUiLang, t } from './i18n';
import { Dataset } from './data/dataset';
import { createEngine, enginePricesLoad, type Engine, type FitStats } from './engine/adapter';
import { fetchLatestSnapshot, loadPriceSettings, savePriceSettings, PRICE_REFRESH_MS, SNAPSHOT_URL, type PriceSettings } from './data/prices';
import { formatsRpc, importFit, initFormats } from './formats';
import { defaultState } from './fit/states';
import { newFit, toRequest, type Fit, type Library } from './fit/model';
import { libraryReady, useAppState } from './store';
import { CharacterEditor } from './ui/Character';
import { EngineSettings } from './ui/EngineSettings';
import { Fitting } from './ui/Fitting';
import { Graphs } from './ui/Graphs';
import { Compare } from './ui/Compare';
import { WhatIf } from './ui/WhatIf';
import { ImportExport } from './ui/ImportExport';
import { ItemInfo, Market, type InfoCtx } from './ui/Market';
import { FitBrowser } from './ui/FitBrowser';
import { PriceBox, type SnapshotState } from './ui/PriceBox';
import { Profiles } from './ui/Profiles';
import { About, type BuildInfo } from './ui/About';
import { Stats } from './ui/Stats';
import { Tabs } from './ui/common';

const PRICE_BACKENDS = ['wasm-worker', 'http'];

const DEMO_EFT = `[Rifter, Demo Rifter]
Gyrostabilizer II
200mm Steel Plates II
Small Armor Repairer II

1MN Afterburner II
Warp Scrambler II
Stasis Webifier II

200mm AutoCannon II, Republic Fleet EMP S
200mm AutoCannon II, Republic Fleet EMP S
200mm AutoCannon II, Republic Fleet EMP S
[Empty High slot]

Small Projectile Burst Aerator I
Small Projectile Collision Accelerator I
[Empty Rig slot]
`;

export default function App() {
  const [state, update, storeStatus] = useAppState();
  const [ds, setDs] = useState<Dataset | null>(null);
  const [loadMsg, setLoadMsg] = useState(t('loading…'));
  const [engineStatus, setEngineStatus] = useState(t('starting engine…'));
  const engineRef = useRef<Engine | null>(null);
  const [engineReady, setEngineReady] = useState(0);
  const [stats, setStats] = useState<FitStats | null>(null);
  const [calcErr, setCalcErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ms, setMs] = useState<number | null>(null);
  const [left, setLeft] = useState<'market' | 'fits' | 'char' | 'profiles' | 'about'>('market');
  const [center, setCenter] = useState<'fit' | 'graphs' | 'compare' | 'whatif'>('fit');
  const [infoState, setInfoState] = useState<{ id: number; ctx?: InfoCtx } | null>(null);
  const [fitted, setFitted] = useState<Record<string, number> | null | undefined>(undefined);
  const [fittedNote, setFittedNote] = useState<string | undefined>(undefined);
  const setInfo = (id: number | null, ctx?: InfoCtx) => setInfoState(id == null ? null : { id, ctx });
  const info = infoState?.id ?? null;
  const [showIO, setShowIO] = useState(false);
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const [graphBackend, setGraphBackend] = useState<string | null>(null);
  useEffect(() => { fetch(`${import.meta.env.BASE_URL}build-info.json`).then((r) => (r.ok ? r.json() : null)).then(setBuild, () => {}); }, []);
  // SDE-derived NPC damage / target profiles (EXFA-Data presets.json) join the built-in profiles (not persisted).
  useEffect(() => { loadSdePresets().then((p) => update((s) => ({ ...s, lib: { ...s.lib,
    damagePatterns: { ...s.lib.damagePatterns, ...Object.fromEntries(p.damage.map((d) => [d.id, d])) },
    targetProfiles: { ...s.lib.targetProfiles, ...Object.fromEntries(p.targets.map((t) => [t.id, t])) } } }))); }, [update]);
  const [addProjected, setAddProjected] = useState(false);
  // prices (engine price block, docs/23): local "my prices" overrides + optional injected latest market snapshot
  const [priceSet, setPriceSetState] = useState<PriceSettings>(() => loadPriceSettings());
  const setPriceSet = useCallback((s: PriceSettings) => { savePriceSettings(s); setPriceSetState(s); }, []);
  const [snapState, setSnapState] = useState<SnapshotState>({ state: 'off' });
  const [pricesVer, setPricesVer] = useState(0);
  const injectedSnapId = useRef<string | null>(null);
  const { lib, settings } = state;
  const fit = settings.activeFitId ? lib.fits[settings.activeFitId] ?? null : null;

  // dataset (UI copy) from the pipeline release, deployed with the site
  useEffect(() => {
    // the formats layer (exfa-formats WASM, same engine release as exfa_wasm.wasm) must be ready before
    // ?eft= / ?dna= are parsed; ?formats=builtin forces the built-in TypeScript parsers
    const fq = new URLSearchParams(location.search).get('formats');
    const formatsUrl = fq === 'builtin' ? null : new URL(`${import.meta.env.BASE_URL}engines/f/exfa_formats_wasm.wasm`, location.href).href;
    Promise.all([Dataset.load(settings.engine.datasetUrl, setLoadMsg), initFormats(formatsUrl), libraryReady])
      .then(([d, fs]) => { d.lang = settings.lang; (window as any).__eveFormats = fs; (window as any).__eveFormatsRpc = formatsRpc(); setDs(d); }, (e) => setLoadMsg(`${t('failed to load dataset')}: ${e.message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // engine backend (swappable at runtime)
  const ecfg = settings.engine;
  useEffect(() => {
    const eng = createEngine(ecfg);
    engineRef.current = eng;
    setEngineStatus(`starting ${eng.info.id}…`);
    let alive = true;
    eng.init().then((s) => { if (alive) { setEngineStatus(`✔ ${s}`); setEngineReady((n) => n + 1); (window as any).__eveEngine = eng; } }, (e) => alive && setEngineStatus(`✖ ${eng.info.id}: ${e.message}`));
    return () => { alive = false; eng.dispose(); };
  }, [ecfg.backend, ecfg.httpUrl, ecfg.datasetUrl, ecfg.wasmUrl]);

  // which backend answers graph requests (own graph RPC, GRAPH_FALLBACK, or none = UI approximations)
  useEffect(() => {
    setGraphBackend(null);
    const eng = engineRef.current;
    if (!engineReady || !eng?.graphSpecs) return;
    let alive = true;
    eng.graphSpecs().then((sp) => alive && setGraphBackend(sp ? eng.graphInfo?.id ?? eng.info.id : null), () => {});
    return () => { alive = false; };
  }, [engineReady]);

  const setLib = useCallback((l: Library) => update((s) => ({ ...s, lib: l })), [update]);
  const putFit = useCallback((f: Fit) => update((s) => ({ ...s, lib: { ...s.lib, fits: { ...s.lib.fits, [f.id]: { ...f, modified: new Date().toISOString() } } } })), [update]);
  // undo / redo per fit (rapid changes such as slider drags are coalesced)
  const stateRef = useRef(state); stateRef.current = state;
  const hist = useRef<Record<string, { past: Fit[]; future: Fit[]; at: number }>>({});
  const [, setHistTick] = useState(0);
  const setFit = useCallback((f: Fit) => {
    const prev = stateRef.current.lib.fits[f.id];
    const h = (hist.current[f.id] ??= { past: [], future: [], at: 0 });
    const now = Date.now();
    if (prev && now - h.at > 400) { h.past.push(prev); if (h.past.length > 100) h.past.shift(); }
    h.at = now; h.future = [];
    putFit(f); setHistTick((x) => x + 1);
  }, [putFit]);
  const undoRedo = useCallback((dir: 'undo' | 'redo') => {
    const id = stateRef.current.settings.activeFitId;
    const cur = id ? stateRef.current.lib.fits[id] : null;
    const h = id ? hist.current[id] : null;
    if (!cur || !h) return;
    const from = dir === 'undo' ? h.past : h.future, to = dir === 'undo' ? h.future : h.past;
    const f = from.pop();
    if (!f) return;
    to.push(cur); h.at = 0;
    putFit(f); setHistTick((x) => x + 1);
  }, [putFit]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoRedo('undo'); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); undoRedo('redo'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoRedo]);
  const addFit = useCallback((f: Fit) => { const now = new Date().toISOString(); f = { ...f, created: f.created ?? now, modified: f.modified ?? now }; update((s) => ({ ...s, lib: { ...s.lib, fits: { ...s.lib.fits, [f.id]: f } }, settings: { ...s.settings, activeFitId: f.id } })); }, [update]);

  // first visit / ?dna= / ?eft= : seed a fit so the page computes something right away
  useEffect(() => {
    if (!ds) return;
    const q = new URLSearchParams(location.search);
    try {
      if (q.get('dna')) { addFit(importFit(ds, q.get('dna')!, 'dna')); return; }
      if (q.get('eft')) { addFit(importFit(ds, q.get('eft')!, 'eft')); return; }
    } catch (e) { console.warn(e); }
    if (!Object.keys(lib.fits).length) addFit(importFit(ds, DEMO_EFT, 'eft'));
    else if (!fit) update((s) => ({ ...s, settings: { ...s.settings, activeFitId: Object.keys(s.lib.fits)[0] } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds]);

  // backends with the docs/23 price block (engine F: in-browser WASM, or a native F behind the HTTP bridge)
  const pricing = PRICE_BACKENDS.includes(ecfg.backend);
  const request = useMemo(() => {
    if (!fit) return null;
    const r = toRequest(fit, lib);
    return pricing ? { ...r, options: { ...(r.options as object), price: true }, ...(priceSet.mine.length ? { price_overrides: priceSet.mine } : {}) } : r;
  }, [fit, lib, pricing, priceSet.mine]);
  const reqJson = useMemo(() => JSON.stringify(request), [request]);

  // stateless calc on every change (debounced, latest wins)
  const seq = useRef(0);
  useEffect(() => {
    if (!request || !engineReady || !engineRef.current) return;
    const my = ++seq.current;
    const fitId = settings.activeFitId;
    const t = setTimeout(() => {
      setBusy(true);
      const t0 = performance.now();
      engineRef.current!.calc(request).then((r) => {
        if (my !== seq.current) return;
        setStats(r); setCalcErr(null); setMs(performance.now() - t0); setBusy(false);
        (window as any).__lastStats = r; (window as any).__lastStatsFit = fitId; (window as any).__lastRequest = request;
      }, (e) => { if (my === seq.current) { setCalcErr(e.message); setBusy(false); } });
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqJson, engineReady, settings.activeFitId, pricesVer]);

  // "update prices": inject the latest EXFA-Data snapshot into the engine session (prices_load); off = the
  // snapshot embedded in the engine. While enabled the deployed snapshot is re-fetched hourly and re-injected
  // when it changed; a failed re-poll keeps the previously injected snapshot.
  useEffect(() => {
    const eng = engineRef.current;
    if (!engineReady || !eng || !pricing) { setSnapState({ state: 'off' }); return; }
    let alive = true;
    if (!priceSet.update) {
      setSnapState({ state: 'off' });
      injectedSnapId.current = null;
      enginePricesLoad(eng, null).then(() => alive && setPricesVer((v) => v + 1), () => {});
      return () => { alive = false; };
    }
    const pull = async (fresh: boolean) => {
      try {
        const snap = await fetchLatestSnapshot(SNAPSHOT_URL, fresh);
        if (!alive) return;
        const changed = snap.id !== injectedSnapId.current;
        if (changed && !(await enginePricesLoad(eng, snap.data))) throw new Error(t('this engine cannot load prices'));
        injectedSnapId.current = snap.id;
        setSnapState({ state: 'loaded', snap, at: Date.now() });
        if (changed) setPricesVer((v) => v + 1);
      } catch (e) {
        if (alive) setSnapState((s) => (s.state === 'loaded' ? { ...s, err: (e as Error).message } : { state: 'error', error: (e as Error).message }));
      }
    };
    setSnapState((s) => (s.state === 'loaded' ? s : { state: 'loading' }));
    pull(false);
    const iv = setInterval(() => pull(true), PRICE_REFRESH_MS);
    return () => { alive = false; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady, priceSet.update, pricing]);

  // "Show info" on a fitted item: one extra calc with include_attributes=all
  useEffect(() => {
    const ctx = infoState?.ctx;
    if (!ctx || !request || !engineRef.current) { setFitted(undefined); return; }
    setFitted(null); setFittedNote(undefined);
    (window as any).__lastInfoCtx = ctx;
    const req = { ...request, options: { ...(request as { options: object }).options, include_attributes: 'all' } };
    let live = true;
    engineRef.current.calc(req).then((r) => {
      if (!live) return;
      const a = (r as { attributes?: { ship?: Record<string, number>; modules?: { module_index?: number; attributes?: Record<string, number> }[]; drones?: { drone_index?: number; attributes?: Record<string, number> }[] } }).attributes;
      let v: Record<string, number> | undefined;
      if (ctx.ship) v = a?.ship;
      else if (ctx.module != null) v = (a?.modules ?? []).find((m, i) => (m.module_index ?? i) === ctx.module)?.attributes;
      else if (ctx.drone != null) v = (a?.drones ?? []).find((m, i) => (m.drone_index ?? i) === ctx.drone)?.attributes;
      if (v) setFitted(v); else { setFitted(null); setFittedNote(t('this engine did not return fitted attribute values')); }
    }, (e) => { if (live) { setFitted(null); setFittedNote(`${t('fitted values unavailable')}: ${e.message}`); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoState, reqJson]);

  const pick = (id: number) => {
    if (!ds) return;
    const k = ds.kind(id);
    if (k === 'ship' || k === 'structure') { addFit(newFit(id, `${ds.name(id, 'en')} fit`)); return; }
    if (!fit) return;
    if (ds.raw.environment?.effect_beacons?.[id]) { setFit({ ...fit, environment: [...new Set([...fit.environment, id])] }); return; }
    if (addProjected && (k === 'module' || k === 'drone' || k === 'fighter')) {
      setFit({ ...fit, projected: [...fit.projected, { kind: k, type_id: id, state: 'active', quantity: k === 'fighter' ? ds.attr(id, 'fighterSquadronMaxSize') ?? 1 : 1, amount: 1, distance_m: 5000 }] });
      return;
    }
    switch (k) {
      case 'module': case 'subsystem': {
        const slot = ds.slot(id);
        if (!slot) return;
        let modules = fit.modules;
        if (slot === 'subsystem') { const sub = ds.attr(id, 'subSystemSlot'); modules = modules.filter((m) => m.slot !== 'subsystem' || ds.attr(m.type_id, 'subSystemSlot') !== sub); }
        setFit({ ...fit, modules: [...modules, { type_id: id, slot, state: defaultState(ds, id), charge_type_id: null }] });
        return;
      }
      case 'charge': {
        const ok = fit.modules.map((m) => ds.chargesFor(m.type_id).includes(id));
        if (ok.some(Boolean)) setFit({ ...fit, modules: fit.modules.map((m, i) => (ok[i] ? { ...m, charge_type_id: id } : m)) });
        else setFit({ ...fit, cargo: [...fit.cargo, { type_id: id, quantity: 1 }] });
        return;
      }
      case 'drone': {
        const ex = fit.drones.findIndex((d) => d.type_id === id);
        if (ex >= 0) setFit({ ...fit, drones: fit.drones.map((d, i) => (i === ex ? { ...d, quantity: d.quantity + 1, active: d.active + 1 } : d)) });
        else setFit({ ...fit, drones: [...fit.drones, { type_id: id, quantity: 1, active: 1 }] });
        return;
      }
      case 'fighter': setFit({ ...fit, fighters: [...fit.fighters, { type_id: id, quantity: ds.attr(id, 'fighterSquadronMaxSize') ?? 1, active: true }] }); return;
      case 'implant': { const s = ds.attr(id, 'implantness'); setFit({ ...fit, implants: [...fit.implants.filter((x) => ds.attr(x, 'implantness') !== s), id] }); return; }
      case 'booster': { const s = ds.attr(id, 'boosterness'); setFit({ ...fit, boosters: [...fit.boosters.filter((x) => ds.attr(x.type_id, 'boosterness') !== s), { type_id: id }] }); return; }
      default: setInfo(id);
    }
  };

  if (!ds) return <div className="loading"><h1>EXFA Web</h1><p>{loadMsg}</p></div>;
  const setLang = (l: 'en' | 'zh') => { ds.lang = l; update((s) => ({ ...s, settings: { ...s.settings, lang: l } })); };
  ds.lang = settings.lang;
  setUiLang(settings.lang);
  return (
    <div className="app">
      <header>
        <h1>EXFA Web</h1>
        <span className="muted">SDE {ds.build}{ds.raw.dataset_revision ? ` r${ds.raw.dataset_revision}` : ''}</span>
        <EngineSettings cfg={settings.engine} status={engineStatus} onChange={(c) => update((s) => ({ ...s, settings: { ...s.settings, engine: c } }))} />
        <button className="undo" title={t('Undo (Ctrl+Z)')} disabled={!(fit && hist.current[fit.id]?.past.length)} onClick={() => undoRedo('undo')}>{t('↶ Undo')}</button>
        <button className="redo" title={t('Redo (Ctrl+Y)')} disabled={!(fit && hist.current[fit.id]?.future.length)} onClick={() => undoRedo('redo')}>{t('↷ Redo')}</button>
        <button onClick={() => setShowIO(true)}>{t('Import / export')}</button>
        <select value={settings.lang} onChange={(e) => setLang(e.target.value as 'en' | 'zh')}><option value="en">English</option><option value="zh">中文</option></select>
      </header>
      <main>
        <aside className="left">
          <Tabs tabs={[['market', t('Market')], ['fits', `${t('Fits')} (${Object.keys(lib.fits).length})`], ['char', t('Character')], ['profiles', t('Profiles')], ['about', t('About')]]} value={left} onChange={setLeft} />
          {left === 'market' && <Market ds={ds} onPick={pick} onInfo={setInfo} />}
          {left === 'fits' && <FitBrowser ds={ds} lib={lib} activeId={fit?.id ?? null} status={storeStatus}
            onOpen={(id) => update((s) => ({ ...s, settings: { ...s.settings, activeFitId: id } }))} onLib={setLib} />}
          {left === 'char' && <CharacterEditor ds={ds} lib={lib} fit={fit} onLib={setLib} />}
          {left === 'profiles' && <Profiles lib={lib} fit={fit} onLib={setLib} onFit={setFit} />}
          {left === 'about' && <About cfg={settings.engine} status={engineStatus} st={stats} ds={ds} build={build} graphBackend={graphBackend} />}
        </aside>
        <section className="center">
          <Tabs tabs={[['fit', t('Fit')], ['graphs', t('Graphs')], ['compare', t('Compare')], ['whatif', t('What-if')]]} value={center} onChange={setCenter} />
          {center === 'compare' ? <Compare ds={ds} lib={lib} activeId={fit?.id ?? null} engine={engineReady ? engineRef.current : null} onOpen={(id) => { update((s) => ({ ...s, settings: { ...s.settings, activeFitId: id } })); setCenter('fit'); }} />
          : !fit ? <p className="muted">{t('No fit selected.')}</p> : center === 'whatif' ? <WhatIf ds={ds} fit={fit} lib={lib} engine={engineReady ? engineRef.current : null} onApply={setFit} />
          : center === 'fit'
            ? <Fitting ds={ds} fit={fit} lib={lib} stats={stats} onChange={setFit} onInfo={setInfo} addProjected={addProjected} setAddProjected={setAddProjected} />
            : <Graphs ds={ds} st={stats} target={lib.targetProfiles[fit.target_profile_id]} engine={engineReady ? engineRef.current : null} request={request} engineReady={engineReady} lib={lib} fitId={fit.id} />}
        </section>
        <aside className="right"><Stats st={stats} busy={busy} ms={ms} error={calcErr} ds={ds} fit={fit} /><PriceBox ds={ds} st={stats} backend={ecfg.backend} settings={priceSet} onSettings={setPriceSet} snapshot={snapState} /></aside>
      </main>
      <footer className="muted">
        {t('Engine via a swappable adapter (in-browser WASM worker or HTTP). Data:')} <a href="https://github.com/EX-CT/EXFA-Data/releases">EX-CT/EXFA-Data</a> {t('release')}.
        {t('EVE Online data © CCP hf.')} · <a href="https://github.com/EX-CT/EXFA-App">{t('source')}</a>
        {build && <> · {t('build')} <a href={build.run}>{build.web}</a> ({build.built_at?.replace('T', ' ').replace(/:\d\dZ$/, ' UTC')}) · {t('dataset')} {build.dataset_tag} · {t('engine')} <a href={build.engine_release_url}>{build.engine_release ?? 'n/a'}</a></>}
      </footer>
      {info != null && <ItemInfo ds={ds} id={info} fitted={fitted} fittedNote={fittedNote} onClose={() => setInfo(null)}
        overrides={fit ? Object.fromEntries((fit.overrides ?? []).filter((o) => o.type_id === info).map((o) => [o.attribute_id, o.value])) : undefined}
        onOverride={fit ? (a, v) => setFit({ ...fit, overrides: [...(fit.overrides ?? []).filter((o) => !(o.type_id === info && o.attribute_id === a)), ...(v == null ? [] : [{ type_id: info, attribute_id: a, value: v }])] }) : undefined} />}
      {showIO && <ImportExport ds={ds} fit={fit} lib={lib} stats={stats} calc={engineReady && engineRef.current ? (r) => engineRef.current!.calc(r) : null} onImport={(f) => { addFit(f); setShowIO(false); }} onClose={() => setShowIO(false)} />}
    </div>
  );
}
