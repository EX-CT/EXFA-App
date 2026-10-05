// What-if: variants of the active fit (module variations, charges, each module offline, other characters), each
// computed by the active engine and ranked by a metric as a delta against the fit as it is.
import { useEffect, useMemo, useState } from 'react';
import type { Dataset } from '../data/dataset';
import type { Engine, FitStats } from '../engine/adapter';
import { METRICS, metric } from '../fit/metrics';
import { toRequest, type Fit, type Library } from '../fit/model';
import { applyEdits, characterScenarios, chargeScenarios, offlineScenarios, variationScenarios, type Scenario } from '../fit/whatif';
import { t } from '../i18n';
import { fmt } from './common';

type Mode = 'variations' | 'charges' | 'offline' | 'character';
const SHOWN = ['dps', 'ehp', 'tank', 'cap_delta', 'speed', 'align', 'cpu_left', 'pg_left'];

export function WhatIf({ ds, fit, lib, engine, onApply }: { ds: Dataset; fit: Fit; lib: Library; engine: Engine | null; onApply: (f: Fit) => void }) {
  const [mode, setMode] = useState<Mode>('variations');
  const firstLoaded = Math.max(0, fit.modules.findIndex((m) => m.charge_type_id));
  const [index, setIndex] = useState(0);
  const [sortBy, setSortBy] = useState('dps');
  const idx = Math.min(index, Math.max(0, fit.modules.length - 1));
  const scenarios = useMemo<Scenario[]>(() => {
    switch (mode) {
      case 'variations': return variationScenarios(ds, fit, idx);
      case 'charges': return chargeScenarios(ds, fit, idx);
      case 'offline': return offlineScenarios(ds, fit);
      case 'character': return characterScenarios(Object.values(lib.characters), fit);
    }
  }, [mode, idx, fit, ds, lib.characters]);
  const variants = useMemo(() => scenarios.slice(0, 60).map((s) => ({ s, fit: applyEdits(ds, fit, s.edits) })), [scenarios, ds, fit]);
  const reqs = useMemo(() => [toRequest(fit, lib), ...variants.map((v) => toRequest(v.fit, lib))], [variants, fit, lib]);
  const key = JSON.stringify(reqs);
  const [res, setRes] = useState<{ key: string; stats: (FitStats | null)[]; ms: number } | null>(null);
  useEffect(() => {
    if (!engine) return;
    let alive = true;
    const t0 = performance.now();
    const timer = setTimeout(() => {
      Promise.all(reqs.map((r) => engine.calc(r).catch(() => null))).then((stats) => {
        if (!alive) return;
        setRes({ key, stats, ms: performance.now() - t0 });
        const m = metric(sortBy)!;
        (window as any).__lastWhatIf = { mode, base: m.get(stats[0]!) ?? null, rows: variants.map((v, i) => ({ label: v.s.label, value: stats[i + 1] && !stats[i + 1]!.error ? m.get(stats[i + 1]!) ?? null : null })) };
      });
    }, 80);
    return () => { alive = false; clearTimeout(timer); };
  }, [key, engine]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = res && res.key === key ? res : null;
  const base = cur?.stats[0] ?? null;
  const sm = metric(sortBy)!;
  const val = (s: FitStats | null, k: string) => (s && !s.error ? metric(k)!.get(s) ?? null : null);
  const rows = cur ? variants.map((v, i) => ({ ...v, st: cur.stats[i + 1] }))
    .sort((a, b) => ((val(b.st, sortBy) ?? -Infinity) - (val(a.st, sortBy) ?? -Infinity)) * (sm.better === 'low' ? -1 : 1)) : [];
  const shown = [sortBy, ...SHOWN.filter((k) => k !== sortBy)].map((k) => metric(k)!);
  const d = (s: FitStats | null, k: string) => { const a = val(s, k), b = val(base, k); return a == null || b == null ? null : a - b; };
  return (
    <div className="whatif">
      <div className="row">
        <select className="wi-mode" value={mode} onChange={(e) => { const v = e.target.value as Mode; setMode(v); if (v === 'charges' && !fit.modules[idx]?.charge_type_id) setIndex(firstLoaded); }}>
          <option value="variations">{t('Module variations')}</option><option value="charges">{t('Charges')}</option>
          <option value="offline">{t('Each module offline')}</option><option value="character">{t('Characters')}</option>
        </select>
        {(mode === 'variations' || mode === 'charges') && (
          <select className="wi-module" value={idx} onChange={(e) => setIndex(+e.target.value)}>
            {fit.modules.map((m, i) => <option key={i} value={i}>{i + 1}. {ds.name(m.type_id)}{m.charge_type_id ? ` · ${ds.name(m.charge_type_id)}` : ''}</option>)}
          </select>
        )}
        <label>{t('sort by')} <select className="wi-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>{METRICS.filter((m) => m.better).map((m) => <option key={m.key} value={m.key}>{t(m.label)}</option>)}</select></label>
      </div>
      {!variants.length ? <p className="muted">{t('No alternatives for this choice.')}</p> : !cur ? <p className="muted">{t('engine computing…')}</p> : (
        <table className="grid small wi-table">
          <thead><tr><th>{t('Scenario')}</th>{shown.map((m) => <th key={m.key} className="num">{t(m.label)}</th>)}<th></th></tr></thead>
          <tbody>
            <tr className="wi-base"><td><b>{t('current fit')}</b></td>{shown.map((m) => <td key={m.key} className="num">{fmt(val(base, m.key), m.digits)}</td>)}<td></td></tr>
            {rows.map(({ s, fit: vf, st }) => (
              <tr key={s.id} className={st?.error ? 'bad' : (st?.violations?.length ?? 0) > (base?.violations?.length ?? 0) ? 'warnrow' : ''} title={st?.violations?.map((v: { message: string }) => v.message).join('\n') ?? ''}>
                <td>{s.label}</td>
                {shown.map((m) => { const x = d(st ?? null, m.key); const good = x != null && x !== 0 && (x > 0) === (m.better !== 'low'); return <td key={m.key} className={`num ${x ? (good ? 'up' : 'down') : ''}`}>{x == null ? '—' : x === 0 ? '·' : `${x > 0 ? '+' : '−'}${fmt(Math.abs(x), m.digits)}`}</td>; })}
                <td><button className="tiny wi-apply" onClick={() => onApply({ ...vf, id: fit.id })}>{t('Apply')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint">{t('Deltas against the current fit; rows that add fitting problems are marked. Apply replaces the fit (undo restores it).')}{cur ? ` ${variants.length} ${t('variants')}, ${fmt(cur.ms, 0)} ms` : ''}</p>
    </div>
  );
}
