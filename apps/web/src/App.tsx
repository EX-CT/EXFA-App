import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { loadSdePresets } from './data/sdePresets';
import { setUiLang, t } from './i18n';
import { Dataset } from './data/dataset';
import { createEngine, enginePricesLoad, type Engine, type FitStats } from './engine/adapter';
import { fetchLatestSnapshot, loadPriceSettings, savePriceSettings, PRICE_REFRESH_MS, SNAPSHOT_URL, type PriceSettings } from './data/prices';
import { importFit, setEngineFormatsRpc } from './formats';
import { addItemToFit, newFit, toRequest, type Fit, type Library } from './fit/model';
import { useAppState } from './store';
import { CharacterEditor } from './ui/Character';
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
import { Popover, Tabs } from './ui/common';
import { notify, ToastViewport } from './ui/notify';

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
  const [datasetMs, setDatasetMs] = useState<number | null>(null);
  const [engineMs, setEngineMs] = useState<number | null>(null);
  const [firstCalcMs, setFirstCalcMs] = useState<number | null>(null);
  const firstCalcSeen = useRef(false);
  const [stats, setStats] = useState<FitStats | null>(null);
  const [calcErr, setCalcErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ms, setMs] = useState<number | null>(null);
  const [left, setLeft] = useState<'market' | 'fits' | 'char' | 'profiles'>('market');
  const [dockTab, setDockTab] = useState<'strip' | 'graphs' | 'compare' | 'import-export' | 'whatif'>('strip');
  const [infoState, setInfoState] = useState<{ id: number; ctx?: InfoCtx } | null>(null);
  const [fitted, setFitted] = useState<Record<string, number> | null | undefined>(undefined);
  const [fittedNote, setFittedNote] = useState<string | undefined>(undefined);
  const setInfo = (id: number | null, ctx?: InfoCtx) => setInfoState(id == null ? null : { id, ctx });
  const [locate, setLocate] = useState<{ id: number; n: number } | null>(null);
  // Pyfa-parity: a click on a fitted/market item fills the info pane AND reveals it in the
  // market tree (left column switches to Market, group expanded, row highlighted).
  const locateType = (id: number, ctx?: InfoCtx) => { setInfo(id, ctx); setLeft('market'); setLocate({ id, n: Date.now() }); };
  /** Swap the fitted module named by the info ctx to another variation (all group members). */
  const swapInfoType = (v: number) => {
    const ctx = infoState?.ctx;
    if (!fit || ctx?.module == null) return;
    const cur = fit.modules[ctx.module];
    const members = cur?.group != null
      ? new Set(fit.modules.map((m, i) => (m.group === cur.group ? i : -1)).filter((i) => i >= 0))
      : new Set([ctx.module]);
    setFit({ ...fit, modules: fit.modules.map((m, i) => (members.has(i) ? { ...m, type_id: v, mutation: null } : m)) });
    setInfo(v, ctx);
  };
  const [build, setBuild] = useState<BuildInfo | null>(null);
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

  // Dataset and Engine initialize independently so the shell can report each startup phase.
  useEffect(() => {
    const started = performance.now();
    Dataset.load(settings.engine.datasetUrl, setLoadMsg).then((d) => {
      d.lang = settings.lang;
      setDatasetMs(performance.now() - started);
      setDs(d);
    }, (e) => setLoadMsg(`${t('failed to load dataset')}: ${e.message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The single Engine WASM worker owns calc, graph, price and format RPCs.
  const ecfg = settings.engine;
  useEffect(() => {
    const eng = createEngine(ecfg);
    engineRef.current = eng;
    const started = performance.now();
    let alive = true;
    setEngineStatus(t('starting engine…'));
    eng.init().then((s) => {
      if (!alive) return;
      setEngineMs(performance.now() - started);
      setEngineStatus(`✔ ${s}`);
      if (eng.rpcRaw) setEngineFormatsRpc((method, params) => eng.rpcRaw!(method, params));
      setEngineReady((n) => n + 1);
      (window as any).__eveEngine = eng;
    }, (e) => alive && setEngineStatus(`✖ ${eng.info.id}: ${e.message}`));
    return () => { alive = false; eng.dispose(); };
  }, [ecfg.datasetUrl, ecfg.wasmUrl]);

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

  // First visit / share link: format input is parsed by the Engine worker before the first calc.
  useEffect(() => {
    if (!ds || !engineReady || storeStatus.kind === 'loading') return;
    let alive = true;
    void (async () => {
      const q = new URLSearchParams(location.search);
      try {
        if (q.get('dna')) { const imported = await importFit(ds, q.get('dna')!, 'dna'); if (alive) addFit(imported); return; }
        if (q.get('eft')) { const imported = await importFit(ds, q.get('eft')!, 'eft'); if (alive) addFit(imported); return; }
        const current = stateRef.current;
        if (!Object.keys(current.lib.fits).length) { const demo = await importFit(ds, DEMO_EFT, 'eft'); if (alive) addFit(demo); }
        else if (!current.settings.activeFitId || !current.lib.fits[current.settings.activeFitId]) {
          update((s) => ({ ...s, settings: { ...s.settings, activeFitId: Object.keys(s.lib.fits)[0] } }));
        }
      } catch (e) {
        if (alive) setLoadMsg(`${t('failed to load fit')}: ${(e as Error).message}`);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, engineReady, storeStatus.kind]);

  const request = useMemo(() => {
    if (!fit) return null;
    const r = toRequest(fit, lib);
    return { ...r, options: { ...(r.options as object), price: true }, ...(priceSet.mine.length ? { price_overrides: priceSet.mine } : {}) };
  }, [fit, lib, priceSet.mine]);
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
        const elapsed = performance.now() - t0;
        setStats(r); setCalcErr(null); setMs(elapsed); setBusy(false);
        if (!firstCalcSeen.current) { firstCalcSeen.current = true; setFirstCalcMs(elapsed); }
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
    if (!engineReady || !eng) { setSnapState({ state: 'off' }); return; }
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
  }, [engineReady, priceSet.update]);

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
    const next = addItemToFit(ds, fit, id, addProjected);
    if (next) setFit(next); else setInfo(id);
  };
  const writeBackAdjustments = () => {
    if (!fit || !stats?.adjustments?.length) return;
    const previous = fit;
    let next = { ...fit };
    let count = 0;
    const implants = new Set<number>(), boosters = new Set<number>();
    for (const adjustment of stats.adjustments as { code: string; path: string; to: unknown }[]) {
      let match: RegExpMatchArray | null;
      if (adjustment.code === 'STATE_CLAMPED' && (match = adjustment.path.match(/^\/modules\/(\d+)\/state$/))) {
        const index = Number(match[1]), state = adjustment.to as Fit['modules'][number]['state'];
        if (next.modules[index] && next.modules[index].state !== state) {
          next = { ...next, modules: next.modules.map((m, i) => i === index ? { ...m, state } : m) }; count++;
        }
      } else if (adjustment.code === 'FIGHTER_QUANTITY_CLAMPED' && (match = adjustment.path.match(/^\/fighters\/(\d+)\/quantity$/))) {
        const index = Number(match[1]), quantity = Number(adjustment.to);
        if (next.fighters[index] && next.fighters[index].quantity !== quantity) {
          next = { ...next, fighters: next.fighters.map((f, i) => i === index ? { ...f, quantity } : f) }; count++;
        }
      } else if (adjustment.code === 'FIGHTER_QUANTITY_CLAMPED' && (match = adjustment.path.match(/^\/projected\/(\d+)\/fighter\/quantity$/))) {
        const index = Number(match[1]), quantity = Number(adjustment.to);
        if (next.projected[index]?.kind === 'fighter' && next.projected[index].quantity !== quantity) {
          next = { ...next, projected: next.projected.map((p, i) => i === index ? { ...p, quantity } : p) }; count++;
        }
      } else if (adjustment.code === 'SLOT_OCCUPIED_SKIPPED' && (match = adjustment.path.match(/^\/implants\/(\d+)$/))) {
        implants.add(Number(match[1]));
      } else if (adjustment.code === 'SLOT_OCCUPIED_SKIPPED' && (match = adjustment.path.match(/^\/boosters\/(\d+)\/type_id$/))) {
        boosters.add(Number(match[1]));
      } else if (adjustment.code === 'MODE_DEFAULTED' && adjustment.path === '/ship/mode_type_id') {
        const mode = adjustment.to == null ? null : Number(adjustment.to);
        if (next.mode_type_id !== mode) { next = { ...next, mode_type_id: mode }; count++; }
      } else if (adjustment.code === 'SECURITY_DEFAULTED' && adjustment.path === '/environment/system_security') {
        if (next.system_security !== null) { next = { ...next, system_security: null }; count++; }
      }
    }
    if (implants.size) {
      const remaining = next.implants.filter((_, i) => !implants.has(i));
      count += next.implants.length - remaining.length;
      next = { ...next, implants: remaining };
    }
    if (boosters.size) {
      const remaining = next.boosters.filter((_, i) => !boosters.has(i));
      count += next.boosters.length - remaining.length;
      next = { ...next, boosters: remaining };
    }
    if (!count) return;
    setFit(next);
    notify({ kind: 'info', text: `${t('Written back')} ${count} ${t('items')}`, ms: 6000,
      action: { label: t('Undo'), onClick: () => setFit(previous) } });
  };

  const [aboutOpen, setAboutOpen] = useState(false);
  const setLang = (l: 'en' | 'zh') => { if (ds) ds.lang = l; update((s) => ({ ...s, settings: { ...s.settings, lang: l } })); };
  if (ds) ds.lang = settings.lang;
  setUiLang(settings.lang);
  const setDockHeight = (dockHeight: number) => update((s) => ({ ...s, settings: { ...s.settings, dockHeight } }));
  const setInfoHeight = (infoHeight: number) => update((s) => ({ ...s, settings: { ...s.settings, infoHeight } }));
  const updateSettings = (patch: Partial<typeof settings>) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const beginResize = (e: ReactPointerEvent<HTMLDivElement>, area: 'dock' | 'info') => {
    e.preventDefault();
    const box = document.querySelector(area === 'dock' ? '.center' : '.left');
    if (!box) return;
    const startY = e.clientY, rect = box.getBoundingClientRect();
    const start = area === 'dock' ? settings.dockHeight : settings.infoHeight;
    const move = (ev: globalThis.PointerEvent) => {
      const delta = startY - ev.clientY;
      if (area === 'dock') setDockHeight(Math.max(18, Math.min(76, start + delta / rect.height * 100)));
      else setInfoHeight(Math.max(96, Math.min(rect.height * 0.62, start + delta)));
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  };
  const phase = firstCalcMs != null ? 'ready' : !datasetMs ? 'dataset' : !engineMs ? 'engine' : 'calc';
  const progress = phase === 'ready' ? 100 : phase === 'dataset' ? 18 : phase === 'engine' ? 52 : 82;
  return (
    <div className="app">
      <header>
        <div className="brand-wrap">
          <button className="brand" onClick={() => setAboutOpen((open) => !open)} aria-label={t('About EXFA')} aria-expanded={aboutOpen}>
            <img src={`${import.meta.env.BASE_URL}exfa-32.png`} alt="" />EXFA
          </button>
          {ds && <Popover open={aboutOpen} onClose={() => setAboutOpen(false)} className="about-popover">
            <About status={engineStatus} st={stats} ds={ds} build={build} datasetMs={datasetMs} engineMs={engineMs} firstCalcMs={firstCalcMs} />
          </Popover>}
        </div>
        <span className="header-meta">{ds ? `SDE ${ds.build}${ds.raw.dataset_revision ? ` r${ds.raw.dataset_revision}` : ''} · ${engineStatus}` : `${loadMsg} · ${engineStatus}`}</span>
        <button className="undo" title={t('Undo (Ctrl+Z)')} disabled={!(fit && hist.current[fit.id]?.past.length)} onClick={() => undoRedo('undo')}>{t('↶ Undo')}</button>
        <button className="redo" title={t('Redo (Ctrl+Y)')} disabled={!(fit && hist.current[fit.id]?.future.length)} onClick={() => undoRedo('redo')}>{t('↷ Redo')}</button>
        <select value={settings.lang} onChange={(e) => setLang(e.target.value as 'en' | 'zh')}><option value="en">English</option><option value="zh">中文</option></select>
      </header>
      <div className={`startup-progress phase-${phase}`} aria-label={t('Startup progress')}
        title={t(phase === 'dataset' ? 'Loading dataset' : phase === 'engine' ? 'Starting Engine' : phase === 'calc' ? 'Calculating first fit' : 'Ready')}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <main className={ds ? '' : 'starting'}>
        <aside className="left">
          <Tabs tabs={[[ 'market', t('Market')], ['fits', `${t('Fits')} (${Object.keys(lib.fits).length})`], ['char', t('Character')], ['profiles', t('Profiles')]]} value={left} onChange={setLeft} />
          <div className="leftbody">
          {!ds ? <div className="skeleton-list"><i /><i /><i /><i /><i /><i /><i /></div> : <>
          {left === 'market' && <Market ds={ds} engine={engineReady ? engineRef.current : null} onPick={pick} onInfo={setInfo} locate={locate} />}
          {left === 'fits' && <FitBrowser ds={ds} lib={lib} activeId={fit?.id ?? null} status={storeStatus}
            onOpen={(id) => update((s) => ({ ...s, settings: { ...s.settings, activeFitId: id } }))} onLib={setLib} onInfo={locateType} />}
          {left === 'char' && <CharacterEditor ds={ds} lib={lib} fit={fit} onLib={setLib} onFit={setFit} />}
          {left === 'profiles' && <Profiles lib={lib} fit={fit} onLib={setLib} onFit={setFit} />}
          </>}
          </div>
          <section className={`infobar${settings.infoCollapsed ? ' collapsed' : ''}`} style={{ height: settings.infoCollapsed ? 26 : settings.infoHeight }}>
            <div className="info-resize" onPointerDown={(e) => beginResize(e, 'info')} onDoubleClick={() => updateSettings({ infoCollapsed: !settings.infoCollapsed })} title={t('Drag to resize info pane')} />
            <div className="info-pane-head">
              <button className="mini" onClick={() => updateSettings({ infoCollapsed: !settings.infoCollapsed })}>{settings.infoCollapsed ? '▴' : '▾'}</button>
              <span>{t('Item info')}</span>
            </div>
            {!settings.infoCollapsed && (infoState != null && ds ? (
              <div className="info-pane-content">
                <ItemInfo ds={ds} id={infoState.id} ctx={infoState.ctx} fitted={fitted} fittedNote={fittedNote} onClose={() => setInfo(null)} onShow={setInfo} onSwap={fit ? swapInfoType : undefined}
                  overrides={fit ? Object.fromEntries((fit.overrides ?? []).filter((o) => o.type_id === infoState.id).map((o) => [o.attribute_id, o.value])) : undefined}
                  onOverride={fit ? (a, v) => setFit({ ...fit, overrides: [...(fit.overrides ?? []).filter((o) => !(o.type_id === infoState.id && o.attribute_id === a)), ...(v == null ? [] : [{ type_id: infoState.id, attribute_id: a, value: v }])] }) : undefined} />
              </div>
            ) : <div className="info-empty muted">{t('Select an item to see details.')}</div>)}
          </section>
        </aside>
        <section className="center">
          <div className="fit-area">
            {!ds ? <div className="skeleton-fit"><i /><i /><i /><i /><i /><i /><i /><i /></div>
              : fit ? <Fitting ds={ds} fit={fit} lib={lib} stats={stats} onChange={setFit} onInfo={locateType} addProjected={addProjected} setAddProjected={setAddProjected} />
                : <p className="muted">{t('No fit selected.')}</p>}
          </div>
          <div className="dock-resize" onPointerDown={(e) => beginResize(e, 'dock')} onDoubleClick={() => updateSettings({ dockCollapsed: !settings.dockCollapsed })} title={t('Drag to resize dock')} />
          <section className={`dock${settings.dockCollapsed ? ' collapsed' : ''}`} style={{ height: settings.dockCollapsed ? 26 : `${settings.dockHeight}%` }}>
            <div className="dock-head">
              <Tabs tabs={[
                ['strip', t('Compare strip')], ['graphs', t('Graphs')], ['compare', t('Fit compare')],
                ['import-export', t('Import-export')], ['whatif', t('What-if')],
              ]} value={dockTab} onChange={setDockTab} />
              <button className="mini dock-collapse" onClick={() => updateSettings({ dockCollapsed: !settings.dockCollapsed })} title={settings.dockCollapsed ? t('Expand dock') : t('Collapse dock')}>{settings.dockCollapsed ? '▴' : '▾'}</button>
            </div>
            {!settings.dockCollapsed && <div className="dock-content">
              {!ds ? <div className="skeleton-list"><i /><i /><i /><i /></div>
                : dockTab === 'strip' ? <div className="dock-placeholder muted">{t('Compare strip placeholder')}</div>
                  : dockTab === 'graphs' ? fit
                    ? <Graphs st={stats} target={lib.targetProfiles[fit.target_profile_id]} engine={engineReady ? engineRef.current : null} request={request} engineReady={engineReady} lib={lib} fitId={fit.id} />
                    : <p className="muted">{t('No fit selected.')}</p>
                    : dockTab === 'compare' ? <Compare ds={ds} lib={lib} activeId={fit?.id ?? null} engine={engineReady ? engineRef.current : null} onOpen={(id) => { update((s) => ({ ...s, settings: { ...s.settings, activeFitId: id } })); setDockTab('strip'); }} />
                      : dockTab === 'import-export' ? <ImportExport ds={ds} fit={fit} lib={lib} stats={stats}
                        calc={engineReady && engineRef.current ? (r) => engineRef.current!.calc(r) : null}
                        onImport={(f) => addFit(f)} />
                        : fit ? <WhatIf ds={ds} fit={fit} lib={lib} engine={engineReady ? engineRef.current : null} onApply={setFit} />
                          : <p className="muted">{t('No fit selected.')}</p>}
            </div>}
          </section>
        </section>
        <aside className="right">{ds ? <>
          <Stats st={stats} busy={busy} ms={ms} error={calcErr} ds={ds} fit={fit} onWriteBack={writeBackAdjustments} />
          <PriceBox ds={ds} st={stats} settings={priceSet} onSettings={setPriceSet} snapshot={snapState} />
        </> : <div className="skeleton-list"><i /><i /><i /><i /><i /><i /></div>}</aside>
      </main>
      <footer className="muted">
        {t('EXFA Engine v0.2.0 · WASM-only. Data:')} <a href="https://github.com/EX-CT/EXFA-Data/releases">EX-CT/EXFA-Data</a> {t('release')}.
        {t('EVE Online data © CCP hf.')} · <a href="https://github.com/EX-CT/EXFA-App">{t('source')}</a>
        {build && <> · {t('build')} <a href={build.run}>{build.web}</a> ({build.built_at?.replace('T', ' ').replace(/:\d\dZ$/, ' UTC')}) · {t('dataset')} {build.dataset_tag} · {t('engine')} <a href={build.engine_release_url}>{build.engine_release ?? 'n/a'}</a></>}
      </footer>
      <ToastViewport />
    </div>
  );
}
