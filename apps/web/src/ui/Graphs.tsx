// Graphs are always evaluated by the Engine graph RPC.
import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';
import type { Engine, FitStats, GraphRequest, GraphResult, GraphSpecs } from '../engine/adapter';
import { toRequest, type Library, type TargetProfile } from '../fit/model';
import { LineChart, type ChartSeries } from './common';

const KINDS = [
  ['dps', 'DPS vs range'], ['cap', 'Capacitor vs time'], ['regen', 'Regen vs fill %'], ['mobility', 'Speed & distance vs time'],
  ['lock', 'Lock time vs target signature'], ['warp', 'Warp time vs distance'],
  // engine-only graphs (no UI approximation): listed when the engine's graph_specs offers them
  ['app', 'Application profile (best ammo) vs range'], ['ewar', 'EWAR strength vs range'], ['rr', 'Remote repairs vs range'],
  ['ecm', 'ECM burst + scan-res damps'],
] as const;
type K = (typeof KINDS)[number][0];
const ENGINE_GRAPH: Record<K, string> = { dps: 'damage', cap: 'capacitor', regen: 'capacitor', mobility: 'mobility', lock: 'lock_time', warp: 'warp_time', app: 'application_profile', ewar: 'ewar', rr: 'remote_reps', ecm: 'ecm_burst' };
/** Graphs that accept `target.fit` (CONTRACT-GRAPHS 0.4). */
const TARGET_FIT: K[] = ['dps', 'app', 'ewar', 'rr'];
const AU = 149597870700;
const EWAR_Y = ['neut_gj_s', 'web_pct', 'ecm_strength', 'damp_lock_range_pct', 'td_optimal_pct', 'gd_range_pct', 'tp_sig_pct'];

/** One engine call: request + how to turn its series into chart series (x scale, y scale, display names). */
interface Plan { req: Omit<GraphRequest, 'schema_version' | 'fit'>; xs?: (x: number) => number; map: Partial<Record<string, { name: string; scale?: number }>>; dropZero?: boolean }
interface View { s: ChartSeries[]; x: string; y: string }
interface Src { id: string; name: string; req: Record<string, unknown> }

const range = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
const DASH = [undefined, '6 3', '2 3', '10 3 2 3'];

/** Overlay naming: with several fits every series is prefixed with its fit and drawn in the fit's dash style. */
function tag(s: ChartSeries[], fi: number, name: string, multi: boolean): ChartSeries[] {
  return multi ? s.map((x, j) => ({ ...x, name: `${name}: ${x.name}`, dash: DASH[fi % DASH.length], color: j })) : s;
}

export function Graphs({ st, target, engine, request, engineReady, lib, fitId }: {
  st: FitStats | null; target: TargetProfile | undefined;
  engine?: Engine | null; request?: Record<string, unknown> | null; engineReady?: number;
  lib?: Library; fitId?: string;
}) {
  const [k, setK] = useState<K>('dps');
  const [sig, setSig] = useState(target?.signature_radius ?? 125);
  const [vel, setVel] = useState(target?.max_velocity ?? 0);
  const [overlay, setOverlay] = useState<string[]>([]);
  const [targetFit, setTargetFit] = useState('');
  const [ecmY, setEcmY] = useState<'time' | 'damage'>('time');
  const [ecmDps, setEcmDps] = useState(200);
  const [specs, setSpecs] = useState<GraphSpecs | null>(null);
  const [eng, setEng] = useState<{ key: string; view?: View; error?: string } | null>(null);

  // Ask the engine which graph requests it supports.
  useEffect(() => {
    setSpecs(null);
    let alive = true;
    engine?.graphSpecs?.().then((s) => alive && setSpecs(s), () => {});
    return () => { alive = false; };
  }, [engine, engineReady]);

  const fitName = (fitId && lib?.fits[fitId]?.name) || 'fit';
  const others = lib ? Object.values(lib.fits).filter((f) => f.id !== fitId) : [];
  const ov = overlay.filter((id) => lib?.fits[id] && id !== fitId);
  const srcs = useMemo<Src[]>(() => (request ? [{ id: fitId ?? '', name: fitName, req: request }, ...ov.map((id) => ({ id, name: lib!.fits[id].name, req: toRequest(lib!.fits[id], lib!) }))] : []),
    [request, ov.join(','), lib, fitName]); // eslint-disable-line react-hooks/exhaustive-deps
  const multi = srcs.length > 1;
  const tgtFitReq = useMemo(() => (targetFit && lib?.fits[targetFit] ? toRequest(lib.fits[targetFit], lib) : null), [targetFit, lib]);

  const plans = useMemo<{ plans: Plan[]; x: string; y: string } | null>(() => {
    if (!st || st.error) return null;
    const profile = { em: 0, thermal: 0, kinetic: 0, explosive: 0, max_velocity: vel, signature_radius: sig > 0 ? sig : null, radius: target?.radius ?? 0, hp: null };
    const tgtObj = tgtFitReq && TARGET_FIT.includes(k) ? { fit: tgtFitReq, resist_mode: 'auto' } : { profile };
    const dpsFar = 100000;
    switch (k) {
      case 'dps': return { x: 'distance km', y: 'DPS', plans: [{ req: { graph: 'damage', target: tgtObj, x: { axis: 'distance_m', values: range(121, 0, dpsFar) }, y: ['dps'] }, xs: (x) => x / 1000, map: { dps: { name: 'total dps' } } }] };
      case 'app': return { x: 'distance km', y: 'DPS', plans: [{ req: { graph: 'application_profile', target: tgtObj, x: { axis: 'distance_m', values: range(121, 0, dpsFar) }, y: ['dps'] }, xs: (x) => x / 1000, map: { dps: { name: 'best-ammo dps' } } }] };
      case 'cap': return { x: 'time s', y: 'GJ', plans: [{ req: { graph: 'capacitor', x: { axis: 'time_s', values: range(201, 0, 600) }, y: ['cap_gj'] }, map: { cap_gj: { name: 'capacitor GJ' } } }] };
      case 'regen': return { x: 'fill %', y: 'per second', plans: [
        { req: { graph: 'capacitor', x: { axis: 'cap_pct', values: range(101, 0, 100) }, y: ['cap_regen_gj_s'] }, map: { cap_regen_gj_s: { name: 'capacitor GJ/s' } } },
        { req: { graph: 'shield_regen', x: { axis: 'shield_pct', values: range(101, 0, 100) }, y: ['shield_regen_hp_s'] }, map: { shield_regen_hp_s: { name: 'shield HP/s' } } }] };
      case 'mobility': return { x: 'time s', y: 'm/s · km', plans: [{ req: { graph: 'mobility', x: { axis: 'time_s', values: range(101, 0, 25) }, y: ['speed_mps', 'distance_m'] }, map: { speed_mps: { name: 'speed m/s' }, distance_m: { name: 'distance km', scale: 1e-3 } } }] };
      case 'lock': return { x: 'target signature m', y: 'seconds', plans: [{ req: { graph: 'lock_time', x: { axis: 'tgt_sig_m', values: range(100, 10, 1000) }, y: ['time_s'] }, map: { time_s: { name: 'lock time s' } } }] };
      case 'warp': return { x: 'distance AU', y: 'seconds', plans: [{ req: { graph: 'warp_time', x: { axis: 'distance_m', values: range(100, 0.5, 50).map((au) => au * AU) }, y: ['time_s'] }, xs: (x) => x / AU, map: { time_s: { name: 'warp time s' } } }] };
      case 'ewar': return { x: 'distance km', y: '% · GJ/s · points', plans: [{ req: { graph: 'ewar', ...(tgtFitReq ? { target: tgtObj } : {}), x: { axis: 'distance_m', values: range(121, 0, 100000) }, y: EWAR_Y }, xs: (x) => x / 1000, map: Object.fromEntries(EWAR_Y.map((y) => [y, { name: y }])), dropZero: true }] };
      case 'rr': return { x: 'distance km', y: 'HP/s', plans: [{ req: { graph: 'remote_reps', ...(tgtFitReq ? { target: tgtObj } : {}), x: { axis: 'distance_m', values: range(121, 0, 100000) }, y: ['rps'] }, xs: (x) => x / 1000, map: { rps: { name: 'remote reps HP/s' } } }] };
      // Pyfa "ECM Burst + Scanres Damps": the enemy re-locks after every 30 s burst (x = enemy scan resolution)
      case 'ecm': return ecmY === 'time'
        ? { x: 'enemy scan resolution mm', y: 'seconds', plans: [{ req: { graph: 'ecm_burst', x: { axis: 'tgt_scan_res_mm', values: range(100, 10, 1000) }, y: ['tgt_lock_time_s', 'tgt_lock_uptime_s'], params: { tgt_dps: ecmDps } }, map: { tgt_lock_time_s: { name: 'enemy lock time s' }, tgt_lock_uptime_s: { name: 'enemy lock uptime s / 30 s' } } }] }
        : { x: 'enemy scan resolution mm', y: 'HP', plans: [{ req: { graph: 'ecm_burst', x: { axis: 'tgt_scan_res_mm', values: range(100, 10, 1000) }, y: ['src_damage'], params: { tgt_dps: ecmDps } }, map: { src_damage: { name: 'damage dealt before dying HP' } } }] };
      default: return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, st, sig, vel, target?.radius, tgtFitReq, ecmY, ecmDps]);

  const engineBacked = !!(specs && plans && plans.plans.every((p) => specs.graphs[p.req.graph]));
  const key = engineBacked ? JSON.stringify([k, srcs.map((s) => s.req), plans]) : '';
  useEffect(() => {
    if (!engineBacked || !engine?.graph || !srcs.length || !plans) { setEng(null); return; }
    let alive = true;
    const t0 = performance.now();
    const timer = setTimeout(() => {
      const one = (src: Src) => Promise.all(plans.plans.map((p) => engine.graph!({ schema_version: 1, fit: src.req, ...p.req }).then((r: GraphResult) => {
        if (r.error || !r.series || !r.x) throw new Error(`${p.req.graph}: ${r.error?.code ?? 'BAD_RESPONSE'} ${r.error?.message ?? ''}`.trim());
        const xs = r.x;
        return Object.entries(p.map).flatMap(([y, m]) => (m ? [{ name: m.name, points: (r.series![y] ?? []).flatMap((v, i) => (v == null ? [] : [[p.xs ? p.xs(xs[i]) : xs[i], v * (m.scale ?? 1)] as [number, number]])) }] : []))
          .filter((s) => s.points.length && (!p.dropZero || s.points.some((q) => q[1] !== 0)));
      }))).then((parts) => parts.flat());
      Promise.all(srcs.map(one)).then((perFit) => {
        if (!alive) return;
        const view = { s: perFit.flatMap((s, i) => tag(s, i, srcs[i].name, multi)), x: plans.x, y: plans.y };
        setEng({ key, view });
        (window as any).__lastGraph = { kind: k, source: 'engine', fits: srcs.map((s) => s.name), target_fit: tgtFitReq ? lib?.fits[targetFit]?.name : null, series: view.s.map((s) => ({ name: s.name, n: s.points.length, first: s.points[0], last: s.points[s.points.length - 1] })), ms: performance.now() - t0 };
      }, (e) => { if (alive) { setEng({ key, error: (e as Error).message }); (window as any).__lastGraph = { kind: k, source: 'error', error: (e as Error).message }; } });
    }, 120);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, engine]);

  if (!st || st.error) return <div className="muted">{t('Compute a fit first.')}</div>;
  const graphBy = (specs && (engine?.graphInfo?.id ?? engine?.info.id)) || '';
  const kinds = KINDS.filter(([v]) => specs?.graphs[ENGINE_GRAPH[v]]);
  const engView = eng && eng.key === key ? eng : null;
  const source: 'engine' | 'pending' | 'error' = engineBacked ? (engView?.view ? 'engine' : engView?.error ? 'error' : 'pending') : 'error';
  const view = source === 'engine' ? engView!.view! : null;
  return (
    <div className="graphs">
      <div className="row">
        <select className="graph-kind" value={k} onChange={(e) => setK(e.target.value as K)}>{kinds.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select>
        {(k === 'dps' || k === 'app') && !tgtFitReq && <>
          <label>{t('target sig')} <input className="qty wide" type="number" min={0} value={sig} onChange={(e) => setSig(+e.target.value)} /> m</label>
          <label>{t('transversal')} <input className="qty wide" type="number" min={0} value={vel} onChange={(e) => setVel(+e.target.value)} /> m/s</label>
        </>}
        {k === 'ecm' && <>
          <select className="ecm-y" value={ecmY} onChange={(e) => setEcmY(e.target.value as 'time' | 'damage')}><option value="time">{t('enemy lock time / uptime')}</option><option value="damage">{t('damage dealt before dying')}</option></select>
          <label>{t('enemy dps')} <input className="qty wide ecm-dps" type="number" min={1} value={ecmDps} onChange={(e) => setEcmDps(+e.target.value)} /></label>
        </>}
        <span className={`graph-src ${source}`} data-src={source} data-graph-backend={source === 'engine' ? graphBy : ''} title={engView?.error ?? ''}>
          {source === 'engine' ? `${t('engine-computed')} · ${graphBy}` : source === 'pending' ? t('engine computing…') : t('Engine graph unavailable')}
        </span>
      </div>
      {lib && others.length > 0 && (
        <div className="row graph-fits">
          <details className="graph-overlay"><summary>{t('Overlay fits')} ({ov.length})</summary>
            {others.map((f) => <label key={f.id} className="ovfit"><input type="checkbox" data-fit={f.name} checked={overlay.includes(f.id)} onChange={() => setOverlay((o) => (o.includes(f.id) ? o.filter((x) => x !== f.id) : [...o, f.id]))} /> {f.name}</label>)}
          </details>
          {TARGET_FIT.includes(k) && specs && (
            <label>{t('target fit')} <select className="graph-target" value={targetFit} onChange={(e) => setTargetFit(e.target.value)}>
              <option value="">{t('— target profile —')}</option>{others.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select></label>
          )}
        </div>
      )}
      {view ? <LineChart series={view.s} xLabel={t(view.x)} yLabel={t(view.y)} /> : source === 'pending' ? <div className="muted">…</div> : <div className="muted" role="alert">{engView?.error ?? t('No data for this graph.')}</div>}
      {source === 'engine' && <p className="hint">{t('Engine-computed by')} <code>{graphBy}</code> {t('via the graph RPC')} (CONTRACT-GRAPHS rev 0.4{specs?.contract ? `; ${specs.contract}` : ''}). {t('The total includes drones; distances are surface-to-surface, the target moves at the given transversal speed.')}{tgtFitReq && TARGET_FIT.includes(k) ? ` ${t('Target: the selected fit (its speed, signature and resists).')}` : ''}</p>}
    </div>
  );
}
