import type { Dataset } from '../data/dataset';
import type { FitStats } from '../engine/adapter';
import { t } from '../i18n';

export interface BuildInfo { dataset_tag?: string; engine_release?: string; engine_release_url?: string; web?: string; built_at?: string; run?: string; prices_snapshot?: string }

const GH = 'https://github.com/EX-CT';
const commit = (repo: string, sha?: string) => (sha ? <a href={`${GH}/${repo}/commit/${sha}`}><code>{sha}</code></a> : <span className="muted">n/a</span>);
const local = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { hour12: false, timeZoneName: 'short' }) : '—');
const duration = (ms: number | null) => ms == null ? '—' : `${ms.toFixed(1)} ms`;

export function About({ status, st, ds, build, datasetMs, engineMs, firstCalcMs }: {
  status: string; st: FitStats | null; ds: Dataset; build: BuildInfo | null;
  datasetMs: number | null; engineMs: number | null; firstCalcMs: number | null;
}) {
  const raw: any = ds.raw;
  const rows: [string, React.ReactNode][] = [
    [t('Engine status'), <span className="about-status">{status}</span>],
    [t('Engine (reported)'), <span className="about-engine">{st?.meta?.engine ?? '—'}{st?.meta?.sde_build ? ` · SDE ${st.meta.sde_build}` : ''}</span>],
    [t('Provenance (engine)'), <span className="about-prov">{st?.provenance ? <>SDE {st.provenance.sde_build}{st.provenance.sde_revision ? ` r${st.provenance.sde_revision}` : ''} ({st.provenance.sde_source ?? '?'}) · <code title={st.provenance.sde_hash}>{String(st.provenance.sde_hash ?? '').slice(0, 19)}</code>
      {' · '}{t('prices')}: {st.provenance.price_source ?? '—'}{st.provenance.price_snapshot_id ? ` ${st.provenance.price_snapshot_id}` : ''} · {local(st.provenance.snapshot_time)}</> : t('not reported by this engine')}</span>],
    [t('Startup timings'), <span className="about-timings">{t('Dataset')}: {duration(datasetMs)} · {t('Engine')}: {duration(engineMs)} · {t('First calc')}: {duration(firstCalcMs)}</span>],
    [t('Graphs and formats'), t('Engine v0.2.0 WASM')],
    [t('Engine release'), <>{build?.engine_release ? <a href={build.engine_release_url}>{build.engine_release}</a> : 'v0.2.0'} · LGPL-3.0-or-later</>],
    [t('Dataset'), <span className="about-dataset">SDE {raw.sde?.build} ({raw.sde?.release_date?.slice(0, 10)}) · r{raw.dataset_revision ?? 1} · {raw.generator}
      {build?.dataset_tag ? <> · <a href={`${GH}/EXFA-Data/releases/tag/${build.dataset_tag}`}>{build.dataset_tag}</a></> : null}</span>],
    [t('Price snapshot'), <span className="about-prices">{build?.prices_snapshot ? <a href={`${GH}/EXFA-Data/releases/tag/${build.prices_snapshot}`}>{build.prices_snapshot}</a> : '—'}</span>],
    [t('Site build'), <>{commit('EXFA-App', build?.web)} · {local(build?.built_at)}{build?.run ? <> · <a href={build.run}>{t('CI run')}</a></> : null}</>],
  ];
  return (
    <div className="about">
      <h4>{t('About EXFA')}</h4>
      <table className="grid small"><tbody>{rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
      <h4>{t('Repositories')}</h4>
      <ul className="about-links">
        <li><a href={`${GH}/EXFA-App`}>EXFA-App</a></li>
        <li><a href={`${GH}/EXFA-Engine`}>EXFA-Engine</a></li>
        <li><a href={`${GH}/EXFA-Format`}>EXFA-Format</a></li>
        <li><a href={`${GH}/EXFA-Bench`}>EXFA-Bench</a></li>
        <li><a href={`${GH}/EXFA-Data`}>EXFA-Data</a></li>
        <li><a href={`${GH}/EXFA-Docs`}>EXFA-Docs</a></li>
      </ul>
      <p className="muted small">{t('EVE Online data © CCP hf.')} {t('EXFA code: LGPL-3.0-or-later.')}</p>
    </div>
  );
}
