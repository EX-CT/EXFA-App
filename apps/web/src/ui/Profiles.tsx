import { uid, type DamagePattern, type FitDoc, type Library, type TargetProfile } from '../fit/model';
import { useState } from 'react';
import { t } from '../i18n';
const tr = t;

const DT = ['em', 'thermal', 'kinetic', 'explosive'] as const;

export function Profiles({ lib, fit, onLib, onFit }: { lib: Library; fit: FitDoc | null; onLib: (l: Library) => void; onFit: (f: FitDoc) => void }) {
  const [showSde, setShowSde] = useState(false);
  // SDE-derived NPC profiles (ids 'sde:…', from EXFA-Data presets.json) are hidden unless toggled on or selected.
  const vis = (id: string, sel?: string) => showSde || !id.startsWith('sde:') || id === sel;
  const dps = Object.values(lib.damage_patterns).filter((d) => vis(d.id, fit?.refs.damage_pattern_id)), tps = Object.values(lib.target_profiles).filter((x) => vis(x.id, fit?.refs.target_profile_id));
  const nSde = Object.keys(lib.damage_patterns).filter((k) => k.startsWith('sde:')).length + Object.keys(lib.target_profiles).filter((k) => k.startsWith('sde:')).length;
  const saveD = (d: DamagePattern) => onLib({ ...lib, damage_patterns: { ...lib.damage_patterns, [d.id]: d } });
  const saveT = (t: TargetProfile) => onLib({ ...lib, target_profiles: { ...lib.target_profiles, [t.id]: t } });
  return (
    <div className="profiles">
      {nSde > 0 && <label className="sdetoggle"><input type="checkbox" checked={showSde} onChange={(e) => setShowSde(e.target.checked)} /> {t('Show NPC profiles from the SDE')} ({nSde})</label>}
      <h4>{t('Damage patterns (incoming damage, for EHP / RAH)')}</h4>
      <table className="grid small"><thead><tr><th></th><th>{t('name')}</th>{DT.map((k) => <th key={k}>{t(k)}</th>)}<th></th></tr></thead><tbody>
        {dps.map((d) => (
          <tr key={d.id} className={fit?.refs.damage_pattern_id === d.id ? 'sel' : ''}>
            <td><input type="radio" disabled={!fit} checked={fit?.refs.damage_pattern_id === d.id} onChange={() => fit && onFit({ ...fit, refs: { ...fit.refs, damage_pattern_id: d.id } })} /></td>
            <td>{d.builtin ? d.name : <input value={d.name} onChange={(e) => saveD({ ...d, name: e.target.value })} />}</td>
            {DT.map((k) => <td key={k}>{d.builtin ? d[k] : <input className="qty" type="number" min={0} value={d[k]} onChange={(e) => saveD({ ...d, [k]: +e.target.value })} />}</td>)}
            <td>{!d.builtin && <button className="mini" onClick={() => { const { [d.id]: _x, ...rest } = lib.damage_patterns; void _x; onLib({ ...lib, damage_patterns: rest }); }}>✕</button>}</td>
          </tr>
        ))}
      </tbody></table>
      <button onClick={() => saveD({ id: uid(), name: tr('Custom pattern'), em: 25, thermal: 25, kinetic: 25, explosive: 25 })}>{t('+ damage pattern')}</button>
      <h4>{t('Target profiles (outgoing DPS, graphs)')}</h4>
      <table className="grid small"><thead><tr><th></th><th>{t('name')}</th>{DT.map((k) => <th key={k}>{t(k)} {t('res')}</th>)}<th>{t('sig m')}</th><th>{t('speed')}</th><th></th></tr></thead><tbody>
        {tps.map((t) => (
          <tr key={t.id}>
            <td><input type="radio" disabled={!fit} checked={fit?.refs.target_profile_id === t.id} onChange={() => fit && onFit({ ...fit, refs: { ...fit.refs, target_profile_id: t.id } })} /></td>
            <td>{t.builtin ? t.name : <input value={t.name} onChange={(e) => saveT({ ...t, name: e.target.value })} />}</td>
            {DT.map((k) => <td key={k}>{t.builtin ? `${(t[k] * 100).toFixed(0)}%` : <input className="qty" type="number" min={0} max={100} value={Math.round(t[k] * 100)} onChange={(e) => saveT({ ...t, [k]: +e.target.value / 100 })} />}</td>)}
            <td>{t.builtin ? t.signature_radius ?? '—' : <input className="qty" type="number" value={t.signature_radius ?? ''} onChange={(e) => saveT({ ...t, signature_radius: e.target.value === '' ? null : +e.target.value })} />}</td>
            <td>{t.builtin ? t.max_velocity ?? '—' : <input className="qty" type="number" value={t.max_velocity ?? ''} onChange={(e) => saveT({ ...t, max_velocity: e.target.value === '' ? null : +e.target.value })} />}</td>
            <td>{!t.builtin && <button className="mini" onClick={() => { const { [t.id]: _x, ...rest } = lib.target_profiles; void _x; onLib({ ...lib, target_profiles: rest }); }}>✕</button>}</td>
          </tr>
        ))}
      </tbody></table>
      <button onClick={() => saveT({ id: uid(), name: tr('Custom target'), em: 0.3, thermal: 0.3, kinetic: 0.3, explosive: 0.3, signature_radius: 150, max_velocity: 200, radius: 150 })}>{t('+ target profile')}</button>
    </div>
  );
}
