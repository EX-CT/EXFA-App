// Graph dock: every line comes from the Engine graph RPC. Series sources are fits (incl. branches as separate
// entries) × library scenarios (damage/application-family graphs take target+params from the scenario, the swept
// axis is overridden); other graphs draw one line per fit. X = any axis valid for the graph (graph_specs), Y =
// multi-select of the series valid on that axis. Legend clicks toggle lines, hover shows a crosshair tooltip,
// CSV / PNG export. Max 12 lines.
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { applyBranch, scenarioRequest, type Scenario } from '@exfa/format';
import type { Engine, FitStats, GraphRequest, GraphResult, GraphSpecs } from '../engine/adapter';
import { requestFor, type Library } from '../fit/model';
import { LineChart, type ChartSeries } from './common';

const KINDS = [
  ['dps', 'DPS vs range'], ['cap', 'Capacitor vs time'], ['regen', 'Cap regen vs fill %'], ['sregen', 'Shield regen vs fill %'],
  ['mobility', 'Speed & distance vs time'], ['lock', 'Lock time vs target signature'], ['warp', 'Warp time vs distance'],
  ['app', 'Application profile (best ammo) vs range'], ['ewar', 'EWAR strength vs range'], ['rr', 'Remote repairs vs range'],
  ['ecm', 'ECM burst + scan-res damps'],
] as const;
type K = (typeof KINDS)[number][0];
const ENGINE_GRAPH: Record<K, string> = { dps: 'damage', cap: 'capacitor', regen: 'capacitor', sregen: 'shield_regen', mobility: 'mobility', lock: 'lock_time', warp: 'warp_time', app: 'application_profile', ewar: 'ewar', rr: 'remote_reps', ecm: 'ecm_burst' };
/** Per-kind preferred axis when the engine offers several. */
const KIND_AXIS: Partial<Record<K, string>> = { cap: 'time_s', regen: 'cap_pct', sregen: 'shield_pct', warp: 'distance_m', ecm: 'tgt_scan_res_mm', lock: 'tgt_sig_m', mobility: 'time_s' };
/** Per-(graph.axis) overrides of the display meta (warp distance is read in AU, not km). */
const AXIS_OVER: Record<string, Partial<AxisMeta>> = {
  'warp_time.distance_m': { label: 'distance', unit: 'AU', def: [0.5, 50], toAxis: (au) => au * AU, fromAxis: (m) => m / AU },
};
const AU = 149597870700;
/** Graphs whose request carries a `target` — scenario sources apply to these. */
const SCN_GRAPHS = new Set(['damage', 'application_profile', 'ewar', 'remote_reps']);
/** ewar/remote_reps derive resists from `target.fit` only — profile/inline scenario targets are ignored there. */
const FIT_TARGET_ONLY = new Set(['ewar', 'remote_reps']);
/** Paired axis params: the engine resolves e.g. tgt_speed_mps over tgt_speed_pct regardless of which is the swept
 *  axis, so sweeping either side must clear both keys for the axis to take effect. */
const AXIS_PAIRS: Record<string, string[]> = {
  tgt_speed_mps: ['tgt_speed_pct'], tgt_speed_pct: ['tgt_speed_mps'],
  atk_speed_mps: ['atk_speed_pct'], atk_speed_pct: ['atk_speed_mps'],
  tgt_sig_m: ['tgt_sig_pct'], tgt_sig_pct: ['tgt_sig_m'],
};
const MAX_LINES = 12;
const DASH = [undefined, '6 3', '2 3', '10 3 2 3'];

/** Displayed axis meta: label/unit in display units; `toAxis`/`fromAxis` convert between display and engine units. */
interface AxisMeta { label: string; unit: string; def: [number, number]; toAxis: (v: number) => number; fromAxis: (v: number) => number }
const same = (label: string, unit: string, def: [number, number]): AxisMeta => ({ label, unit, def, toAxis: (v) => v, fromAxis: (v) => v });
const AXES: Record<string, AxisMeta> = {
  distance_m: { label: 'distance', unit: 'km', def: [0, 100], toAxis: (km) => km * 1000, fromAxis: (m) => m / 1000 },
  time_s: same('time', 's', [0, 600]),
  cap_pct: same('capacitor', '%', [0, 100]),
  shield_pct: same('shield', '%', [0, 100]),
  tgt_sig_m: same('target signature', 'm', [10, 1000]),
  tgt_sig_pct: same('target signature', '%', [10, 200]),
  tgt_scan_res_mm: same('scan resolution', 'mm', [10, 1000]),
  tgt_dps: same('enemy dps', 'HP/s', [10, 1000]),
  tgt_speed_mps: same('target speed', 'm/s', [0, 1000]),
  tgt_speed_pct: same('target speed', '%', [0, 100]),
  atk_speed_mps: same('attacker speed', 'm/s', [0, 1000]),
  atk_speed_pct: same('attacker speed', '%', [0, 100]),
  atk_angle_deg: same('attacker angle', '°', [0, 180]),
  tgt_angle_deg: same('target angle', '°', [0, 180]),
};
const axisMeta = (g: string, a: string): AxisMeta => ({ ...same('', '', [0, 100]), ...(AXES[a] ?? { label: a, unit: '', def: [0, 100] as [number, number] }), ...(AXIS_OVER[`${g}.${a}`] ?? {}) });

/** Default Y selection per (graph.axis) when the user hasn't picked yet. */
const Y_DEFAULT: Record<string, string[]> = {
  'damage.distance_m': ['dps'], 'application_profile.distance_m': ['dps'],
  'capacitor.time_s': ['cap_gj'], 'capacitor.cap_pct': ['cap_regen_gj_s'],
  'shield_regen.time_s': ['shield_hp'], 'shield_regen.shield_pct': ['shield_regen_hp_s'],
  'mobility.time_s': ['speed_mps', 'distance_m'],
  'ecm_burst.tgt_scan_res_mm': ['tgt_lock_time_s', 'tgt_lock_uptime_s'], 'ecm_burst.tgt_dps': ['src_damage'],
};
/** Display scale per (graph.series) (mobility also draws distance/bump km on a m/s axis). */
const Y_SCALE: Record<string, number> = { 'mobility.distance_m': 1e-3, 'mobility.bump_distance_m': 1e-3, 'mobility.momentum_kg_mps': 1e-6 };
const Y_NAME: Record<string, string> = {
  'mobility.distance_m': 'distance km', 'mobility.bump_distance_m': 'bump distance km', 'mobility.momentum_kg_mps': 'momentum ×10⁶ kg·m/s',
  'ecm_burst.src_damage': 'damage dealt', 'ecm_burst.tgt_lock_time_s': 'enemy lock time', 'ecm_burst.tgt_lock_uptime_s': 'enemy lock uptime',
};

interface FitSrc { key: string; name: string; req: Record<string, unknown> }
interface ScnSrc { key: string; name: string; fitTarget: boolean; make: (fitId: string) => { target?: unknown; params?: Record<string, unknown>; settings?: unknown } | null }
interface LineKey { fit: FitSrc; scn: ScnSrc | null; y: string }

const range = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
const cache = new Map<string, Promise<ChartSeries[]>>();
function cached(key: string, make: () => Promise<ChartSeries[]>): Promise<ChartSeries[]> {
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > 96) cache.delete(cache.keys().next().value!);
  const p = make().catch((e) => { cache.delete(key); throw e; });
  cache.set(key, p);
  return p;
}

function csvOf(view: ChartSeries[], xLabel: string): string {
  const xs = [...new Set(view.flatMap((s) => s.points.map((p) => p[0])))].sort((a, b) => a - b);
  const head = [xLabel, ...view.map((s) => s.name)];
  const rows = xs.map((x) => [x, ...view.map((s) => s.points.find((p) => p[0] === x)?.[1] ?? '')]);
  return [head, ...rows].map((r) => r.join(',')).join('\n');
}

async function svgToPng(svg: SVGSVGElement, name: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const orig = svg.querySelectorAll('*'), copy = clone.querySelectorAll('*');
  orig.forEach((el, i) => {
    const cs = getComputedStyle(el), c = copy[i] as SVGElement;
    for (const prop of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-size', 'font-family', 'opacity', 'text-anchor']) c.style.setProperty(prop, cs.getPropertyValue(prop));
    if (el.tagName === 'text' && cs.textAnchor) c.setAttribute('text-anchor', cs.textAnchor);
  });
  clone.style.background = getComputedStyle(svg).backgroundColor;
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const box = svg.getBoundingClientRect();
  const cv = document.createElement('canvas');
  cv.width = box.width * 2; cv.height = box.height * 2;
  const cx = cv.getContext('2d')!;
  cx.scale(2, 2); cx.drawImage(img, 0, 0, box.width, box.height);
  URL.revokeObjectURL(url);
  const a = document.createElement('a');
  a.href = cv.toDataURL('image/png'); a.download = name; a.click();
}

export function Graphs({ st, engine, request, engineReady, lib, fitId }: {
  st: FitStats | null;
  engine?: Engine | null; request?: Record<string, unknown> | null; engineReady?: number;
  lib?: Library; fitId?: string;
}) {
  const [k, setK] = useState<K>('dps');
  const [axis, setAxis] = useState<Record<K, string>>({} as Record<K, string>);
  const [rangeIn, setRangeIn] = useState<Record<string, [number, number]>>({});
  const [ySel, setYSel] = useState<Record<string, string[]>>({});
  const [fitSel, setFitSel] = useState<string[]>([]);
  const [scnSel, setScnSel] = useState<string[]>(['profile']);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [specs, setSpecs] = useState<GraphSpecs | null>(null);
  const [eng, setEng] = useState<{ key: string; view?: { s: ChartSeries[]; x: string; y: string }; error?: string } | null>(null);
  const [note, setNote] = useState('');
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSpecs(null);
    let alive = true;
    engine?.graphSpecs?.().then((s) => alive && setSpecs(s), () => {});
    return () => { alive = false; };
  }, [engine, engineReady]);

  const engGraph = ENGINE_GRAPH[k];
  const gspec = specs?.graphs[engGraph];
  const axes = Object.keys(gspec?.axes ?? {});
  const ax = axes.includes(axis[k]) ? axis[k] : (axes.includes(KIND_AXIS[k] ?? '') ? KIND_AXIS[k]! : axes.includes('distance_m') ? 'distance_m' : axes[0] ?? '');
  const meta = axisMeta(engGraph, ax);
  const [lo, hi] = rangeIn[`${k}.${ax}`] ?? meta.def;
  const validY = Object.entries(gspec?.series ?? {}).filter(([, s]) => { const ba = (s as { by_axis?: Record<string, unknown> }).by_axis; return !ba || ba[ax] != null; }).map(([y]) => y);
  const yArr = ((ySel[`${k}.${ax}`] ?? Y_DEFAULT[`${engGraph}.${ax}`] ?? validY).filter((y) => validY.includes(y)));

  // --- series sources: fits (current first; branches as separate entries) × scenarios -------------------------
  const fitEntries = useMemo<FitSrc[]>(() => {
    if (!lib) return request ? [{ key: '', name: 'fit', req: request }] : [];
    const out: FitSrc[] = [];
    const add = (id: string) => {
      const doc = lib.fits[id];
      if (!doc) return;
      out.push({ key: id, name: doc.name, req: requestFor(lib, doc) });
      for (const b of doc.branches ?? []) out.push({ key: `${id}@${b.id}`, name: `${doc.name} ▸ ${b.name}`, req: requestFor(lib, applyBranch(doc, b.id)) });
    };
    if (fitId) add(fitId);
    for (const id of Object.keys(lib.fits)) if (id !== fitId) add(id);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib, request, fitId]);
  const fits = fitEntries.filter((f) => (fitSel.length ? fitSel : [fitEntries[0]?.key]).includes(f.key));

  const scenarios = useMemo<ScnSrc[]>(() => {
    if (!lib) return [];
    const list: ScnSrc[] = [{
      key: 'profile', name: t('target profile'), fitTarget: false,
      make: (fid) => {
        const doc = lib.fits[fid];
        const pid = doc?.refs.target_profile_id ?? 'none';
        if (!lib.target_profiles[pid]) return null;
        try { return scenarioRequest(lib, { id: '', name: pid, target: { profile_id: pid }, params: {} } as Scenario); } catch { return null; }
      },
    }];
    for (const s of Object.values(lib.scenarios ?? {})) list.push({
      key: s.id, name: s.builtin ? t(s.name) : s.name, fitTarget: 'fit_id' in s.target,
      make: () => { try { return scenarioRequest(lib, s); } catch { return null; } },
    });
    return list;
  }, [lib]);
  const withScn = SCN_GRAPHS.has(engGraph);
  const offered = scenarios.filter((s) => !FIT_TARGET_ONLY.has(engGraph) || s.fitTarget);
  const scns = withScn ? offered.filter((s) => scnSel.includes(s.key)) : [];

  // --- requests: one engine call per (fit, scenario) × series group ------------------------------------------
  const key = useMemo(() => (!st || st.error || !gspec || !fits.length || !yArr.length || !ax ? ''
    : JSON.stringify([engGraph, ax, lo, hi, yArr, fits.map((f) => f.key), scns.map((s) => s.key), lib && Object.keys(lib.fits).length])),
    [st, gspec, engGraph, ax, lo, hi, yArr, fits, scns, withScn, lib]);

  useEffect(() => {
    if (!key || !engine?.graph) { setEng(null); return; }
    let alive = true;
    const t0 = performance.now();
    const timer = setTimeout(() => {
      const jobs: { fit: FitSrc; scn: ScnSrc | null; p: Promise<ChartSeries[]> }[] = [];
      const wanted: LineKey[] = [];
      outer: for (const f of fits) {
        const scnList = withScn && scns.length ? scns : [null];
        for (const s of scnList) for (const y of yArr) {
          wanted.push({ fit: f, scn: s, y });
          if (wanted.length > MAX_LINES) break outer;
        }
      }
      const overflow = fits.length * (withScn ? scns.length : 1) * yArr.length - wanted.length;
      setNote(overflow > 0 ? t('Showing {n} of {total} lines (max {m})').replace('{n}', String(wanted.length)).replace('{total}', String(wanted.length + overflow)).replace('{m}', String(MAX_LINES)) : '');
      for (const { fit, scn, y } of wanted) {
        const xVals = range(101, meta.toAxis(lo), meta.toAxis(hi));
        const scnReq = scn ? scn.make(fit.key.split('@')[0]) : null;
        if (scn && scnReq == null) continue;
        const { scenarios: _s, ...fitReq } = fit.req as Record<string, unknown>;
        const params = { ...(scnReq?.params as Record<string, unknown> | undefined) };
        delete params[ax];
        for (const p of AXIS_PAIRS[ax] ?? []) delete params[p];
        const req: GraphRequest = { schema_version: 1, graph: engGraph, fit: fitReq,
          ...(scnReq?.target ? { target: scnReq.target as Record<string, unknown> } : {}),
          ...(Object.keys(params).length ? { params } : {}),
          ...(scnReq?.settings ? { settings: scnReq.settings as Record<string, unknown> } : {}),
          x: { axis: ax, values: xVals }, y: [y] };
        const ck = JSON.stringify(req);
        const scale = Y_SCALE[`${engGraph}.${y}`] ?? 1;
        jobs.push({ fit, scn, p: cached(ck, () => engine.graph!(req).then((r: GraphResult) => {
          if (r.error || !r.series || !r.x) throw new Error(`${engGraph}: ${r.error?.code ?? 'BAD_RESPONSE'} ${r.error?.message ?? ''}`.trim());
          const xs = r.x.map(meta.fromAxis);
          return [{ name: Y_NAME[`${engGraph}.${y}`] ?? y, points: (r.series[y] ?? []).flatMap((v, i) => (v == null ? [] : [[xs[i], v * scale] as [number, number]])) }];
        })) });
      }
      Promise.all(jobs.map((j) => j.p)).then((parts) => {
        if (!alive) return;
        const multi = new Set(jobs.map((j) => j.fit.key)).size > 1 || new Set(jobs.map((j) => j.scn?.key)).size > 1;
        const view: ChartSeries[] = [];
        const fitIdx = new Map(fits.map((f, i) => [f.key, i])), scnIdx = new Map(scns.map((s, i) => [s.key, i]));
        jobs.forEach((j, i) => {
          for (const s of parts[i]) {
            const tag = multi ? `${j.fit.name}: ${j.scn ? `${j.scn.name}: ` : ''}${s.name}` : (yArr.length > 1 ? s.name : j.fit.name);
            view.push({ ...s, name: tag, color: fitIdx.get(j.fit.key) ?? 0, dash: DASH[(j.scn ? scnIdx.get(j.scn.key) ?? 0 : 0) % DASH.length] });
          }
        });
        setEng({ key, view: { s: view, x: `${meta.label} ${meta.unit}`.trim(), y: yArr.join(' · ') } });
        (window as unknown as { __lastGraph: unknown }).__lastGraph = {
          kind: k, axis: ax, source: 'engine', fits: fits.map((f) => f.name), scenarios: scns.map((s) => s.name),
          series: view.map((s) => ({ name: s.name, n: s.points.length, first: s.points[0], last: s.points[s.points.length - 1] })),
          ms: performance.now() - t0,
        };
      }, (e) => { if (alive) { setEng({ key, error: (e as Error).message }); (window as unknown as { __lastGraph: unknown }).__lastGraph = { kind: k, source: 'error', error: (e as Error).message }; } });
    }, 120);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, engine]);

  if (!st || st.error) return <div className="muted">{t('Compute a fit first.')}</div>;
  const graphBy = (specs && (engine?.graphInfo?.id ?? engine?.info.id)) || '';
  const kinds = KINDS.filter(([v]) => specs?.graphs[ENGINE_GRAPH[v]]);
  const engView = eng && eng.key === key ? eng : null;
  const source: 'engine' | 'pending' | 'error' = gspec && key ? (engView?.view ? 'engine' : engView?.error ? 'error' : 'pending') : gspec ? 'pending' : 'error';
  const view = source === 'engine' ? engView!.view! : null;
  const toggle = (list: string[], v: string, set: (x: string[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="graphs" ref={wrap}>
      <div className="row">
        <select className="graph-kind" value={k} onChange={(e) => { setK(e.target.value as K); setHidden(new Set()); }}>{kinds.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select>
        <label>{t('X axis')} <select className="graph-x" value={ax} onChange={(e) => setAxis((a) => ({ ...a, [k]: e.target.value }))}>
          {axes.map((a) => { const m = axisMeta(engGraph, a); return <option key={a} value={a}>{t(m.label || a)}{m.unit ? ` (${m.unit})` : ''}</option>; })}
        </select></label>
        <label>{t('from')} <input className="qty gx-min" type="number" value={lo} onChange={(e) => setRangeIn((r) => ({ ...r, [`${k}.${ax}`]: [+e.target.value, hi] }))} /></label>
        <label>{t('to')} <input className="qty gx-max" type="number" value={hi} onChange={(e) => setRangeIn((r) => ({ ...r, [`${k}.${ax}`]: [lo, +e.target.value] }))} /> {meta.unit}</label>
        <span className={`graph-src ${source}`} data-src={source} data-graph-backend={source === 'engine' ? graphBy : ''} title={engView?.error ?? ''}>
          {source === 'engine' ? `${t('engine-computed')} · ${graphBy}` : source === 'pending' ? t('engine computing…') : t('Engine graph unavailable')}
        </span>
        {view && <>
          <button className="mini g-csv" onClick={() => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([csvOf(view.s, view.x)], { type: 'text/csv' })); a.download = `exfa-graph-${k}.csv`; a.click();
          }}>{t('CSV')}</button>
          <button className="mini g-png" onClick={() => { const svg = wrap.current?.querySelector('svg.chart'); if (svg) void svgToPng(svg as SVGSVGElement, `exfa-graph-${k}.png`); }}>{t('PNG')}</button>
        </>}
      </div>
      <div className="row graph-y">
        <span className="muted">{t('Y')}</span>
        {validY.map((y) => <label key={y} className="ovfit"><input type="checkbox" data-y={y} checked={yArr.includes(y)} onChange={() => {
          const cur = ySel[`${k}.${ax}`] ?? Y_DEFAULT[`${engGraph}.${ax}`] ?? validY;
          setYSel((m) => ({ ...m, [`${k}.${ax}`]: cur.includes(y) ? cur.filter((x) => x !== y) : [...cur, y] }));
        }} /> {y}</label>)}
      </div>
      <div className="row graph-fits">
        <details className="graph-overlay"><summary>{t('Fits')} ({fits.length})</summary>
          {fitEntries.map((f) => <label key={f.key} className="ovfit"><input type="checkbox" data-fit={f.name} checked={fits.includes(f)} onChange={() => toggle((fitSel.length ? fitSel : [fitEntries[0]?.key ?? '']), f.key, setFitSel)} /> {f.name}</label>)}
        </details>
        {withScn && (
          <details className="graph-scn"><summary>{t('Scenarios')} ({scns.length})</summary>
            {offered.map((s) => <label key={s.key} className="ovfit"><input type="checkbox" data-scn={s.key} checked={scnSel.includes(s.key)} onChange={() => toggle(scnSel, s.key, setScnSel)} /> {s.name}</label>)}
          </details>
        )}
        {withScn && !!offered.length && !scns.length && <span className="muted">{t('pick at least one scenario')}</span>}
      </div>
      {note && <div className="muted small">{note}</div>}
      {view ? <LineChart series={view.s} xLabel={t(view.x)} yLabel={t(view.y)} hidden={hidden} onToggleHidden={(i) => setHidden((h) => { const n = new Set(h); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
        : source === 'pending' ? <div className="muted">…</div> : <div className="muted" role="alert">{engView?.error ?? t('No data for this graph.')}</div>}
      {source === 'engine' && <p className="hint">{t('Engine-computed by')} <code>{graphBy}</code> {t('via the graph RPC')}. {t('The total includes drones; distances are surface-to-surface.')}</p>}
    </div>
  );
}
