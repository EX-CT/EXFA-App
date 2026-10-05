import { BACKENDS, type EngineConfig } from '../engine/adapter';
import { t } from '../i18n';

export function EngineSettings({ cfg, status, onChange }: { cfg: EngineConfig; status: string; onChange: (c: EngineConfig) => void }) {
  return (
    <div className="engine">
      <select value={cfg.backend} onChange={(e) => onChange({ ...cfg, backend: e.target.value })} title={t('Engine backend')}>
        {BACKENDS.map((b) => <option key={b.id} value={b.id}>{t(b.label)}</option>)}
      </select>
      {cfg.backend === 'http' && <input value={cfg.httpUrl} onChange={(e) => onChange({ ...cfg, httpUrl: e.target.value })} placeholder="http://127.0.0.1:8080" title={t('engine base URL')} />}
      <span className="status" title={status}>{status}</span>
    </div>
  );
}
