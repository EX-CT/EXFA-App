// Right-column "Scenarios" section: the library's scenarios as checkboxes feeding doc.refs.scenario_ids.
// Checked rows show the engine's effective dps / volley (stats.scenario_results) and the share of paper dps.
import { t } from '../i18n';
import { patchRefs, type FitDoc, type Library, type Scenario } from '../fit/model';
import type { FitStats } from '../engine/adapter';
import { fmt } from './common';

function resultFor(stats: FitStats | null, id: string): { dps?: number | null; volley?: number | null; error?: { code?: string; message?: string } } | null {
  const r = stats?.scenario_results;
  return Array.isArray(r) ? (r.find((x: { id?: string }) => x?.id === id) ?? null) : null;
}

export function Scenarios({ lib, fit, stats, onFit }: { lib: Library; fit: FitDoc; stats: FitStats | null; onFit: (f: FitDoc) => void }) {
  const scenarios = Object.values(lib.scenarios ?? {});
  if (!scenarios.length) return null;
  const sel = fit.refs.scenario_ids ?? [];
  const toggle = (id: string, on: boolean) =>
    onFit(patchRefs(fit, { scenario_ids: on ? [...sel, id] : sel.filter((x) => x !== id) }));
  const paper = stats?.offense?.total?.dps?.total;
  return (
    <section className="scenarios">
      <h4>{t('Scenarios')}</h4>
      <ul className="scn-check">
        {scenarios.map((s: Scenario) => {
          const on = sel.includes(s.id);
          const r = on ? resultFor(stats, s.id) : null;
          const pct = r?.dps != null && typeof paper === 'number' && paper > 0 ? (r.dps / paper) * 100 : null;
          return (
            <li key={s.id} className={on ? 'on' : ''}>
              <label>
                <input type="checkbox" checked={on} onChange={(e) => toggle(s.id, e.target.checked)} data-scn={s.id} />
                <span className="scn-name">{s.builtin ? t(s.name) : s.name}</span>
                {on && r?.error && <span className="scn-err" title={r.error.message}>{r.error.code ?? t('error')}</span>}
                {on && r && !r.error && r.dps == null && <span className="muted">…</span>}
                {on && r && !r.error && r.dps != null && (
                  <span className="num scn-dps">
                    {fmt(r.dps, 1)} <span className="muted">dps · {fmt(r.volley ?? 0, 0)} {t('volley')}{pct != null ? ` · ${pct.toFixed(0)}%` : ''}</span>
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
