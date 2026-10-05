// Fit comparison: several saved fits computed by the active engine, one metric per row, best value highlighted and
// the difference to the first fit.
import { useEffect, useMemo, useState } from 'react';
import type { Dataset } from '../data/dataset';
import { engineBatch, type Engine, type FitStats } from '../engine/adapter';
import { compareTable } from '../fit/metrics';
import { toRequest, type Library } from '../fit/model';
import { t } from '../i18n';
import { fmt } from './common';

const sign = (v: number | null, d: number) => (v == null || v === 0 ? '' : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v), d)}`);

export function Compare({ ds, lib, activeId, engine, onOpen }: { ds: Dataset; lib: Library; activeId: string | null; engine: Engine | null; onOpen: (id: string) => void }) {
  const all = Object.values(lib.fits);
  const [sel, setSel] = useState<string[]>(() => {
    const act = activeId && lib.fits[activeId];
    const grp = act ? ds.type(act.ship_type_id)?.group : null;
    const same = all.filter((f) => f.id !== activeId && ds.type(f.ship_type_id)?.group === grp).slice(0, 3).map((f) => f.id);
    return [...(act ? [act.id] : []), ...same];
  });
  const ids = sel.filter((id) => lib.fits[id]);
  const reqs = useMemo(() => ids.map((id) => toRequest(lib.fits[id], lib)), [ids.join(','), lib]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = JSON.stringify(reqs);
  const [res, setRes] = useState<{ key: string; stats: (FitStats | null)[]; errors: string[]; ms: number; via: 'batch' | 'calc' } | null>(null);
  useEffect(() => {
    if (!engine || !reqs.length) return;
    let alive = true;
    const t0 = performance.now();
    // one engine `batch` call (docs/23) when the backend has it, else one calc per fit
    const viaBatch = async (): Promise<[FitStats | null, string][] | null> => {
      const b = await engineBatch(engine, { batch_version: 1, fits: reqs.map((fit, i) => ({ fit, label: lib.fits[ids[i]].name })) });
      if (!b) return null;
      const out: [FitStats | null, string][] = reqs.map(() => [null, 'no result']);
      for (const r of b.results ?? []) out[r.index] = r.error ? [null, `${r.error.code}: ${r.error.message}`] : [r.stats ?? null, ''];
      return out;
    };
    const viaCalc = () => Promise.all(reqs.map((r) => engine.calc(r).then((s) => [s, ''] as [FitStats | null, string], (e) => [null, (e as Error).message] as [FitStats | null, string])));
    viaBatch().catch((e) => reqs.map(() => [null, (e as Error).message] as [FitStats | null, string])).then(async (b) => {
      const out = b ?? await viaCalc();
      if (!alive) return;
      const v = { key, stats: out.map((o) => o[0]), errors: out.map((o) => o[1] || (o[0]?.error ? `${o[0].error.code}: ${o[0].error.message}` : '')), ms: performance.now() - t0, via: b ? 'batch' as const : 'calc' as const };
      setRes(v);
      (window as any).__lastCompare = { via: v.via, fits: ids.map((id) => lib.fits[id].name), rows: compareTable(v.stats).map((r) => ({ key: r.metric.key, values: r.values, best: r.best })) };
    });
    return () => { alive = false; };
  }, [key, engine]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = res && res.key === key ? res : null;
  const rows = cur ? compareTable(cur.stats) : [];
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const move = (id: string) => setSel((s) => [id, ...s.filter((x) => x !== id)]);
  return (
    <div className="compare">
      <details open={ids.length < 2}>
        <summary>{t('Fits to compare')} ({ids.length})</summary>
        <ul className="cmp-pick">{all.map((f) => (
          <li key={f.id}><label><input type="checkbox" className="cmp-fit" data-fit={f.name} checked={sel.includes(f.id)} onChange={() => toggle(f.id)} /> {f.name} <span className="muted">{ds.name(f.ship_type_id)}</span></label></li>
        ))}</ul>
      </details>
      {ids.length < 2 ? <p className="muted">{t('Pick two or more fits.')}</p> : !cur ? <p className="muted">{t('engine computing…')}</p> : (
        <table className="grid small cmp-table">
          <thead><tr><th>{t('Metric')}</th>{ids.map((id, i) => (
            <th key={id} className="num"><a href="#" title={t('open this fit')} onClick={(e) => { e.preventDefault(); onOpen(id); }}>{lib.fits[id].name}</a>
              {i > 0 && <button className="tiny" title={t('make this the baseline')} onClick={() => move(id)}>⇤</button>}
              {cur.errors[i] && <div className="error small">{cur.errors[i]}</div>}</th>
          ))}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.metric.key} data-metric={r.metric.key}><td>{t(r.metric.label)} <span className="muted">{r.metric.unit}</span></td>
              {r.values.map((v, i) => <td key={i} className={`num${r.best.includes(i) ? ' best' : ''}`}>{fmt(v, r.metric.digits)}{i > 0 && <span className={`delta ${(r.delta[i] ?? 0) * (r.metric.better === 'low' ? -1 : 1) > 0 ? 'up' : 'down'}`}> {sign(r.delta[i], r.metric.digits)}</span>}</td>)}</tr>
          ))}</tbody>
        </table>
      )}
      <p className="hint">{t('Each fit is computed by the active engine with its own character, profiles and options; deltas are against the first column.')}{cur ? <span className="cmp-via" data-via={cur.via}> {cur.via === 'batch' ? t('one engine batch call') : t('one calc per fit')} · {fmt(cur.ms, 0)} ms</span> : ''}</p>
    </div>
  );
}
