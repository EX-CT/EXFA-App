import { uid, type DamagePattern, type FitDoc, type Library, type Scenario, type TargetProfile } from '../fit/model';
import { useState } from 'react';
import { t } from '../i18n';
const tr = t;

const DT = ['em', 'thermal', 'kinetic', 'explosive'] as const;
const RESIST_MODE = ['auto', 'shield', 'armor', 'hull', 'weighted_average'] as const;
const DRONE_MODE = ['auto', 'follow_attacker', 'follow_target'] as const;

/** One-line summary of a scenario's params for the list row. */
function scenarioSummary(lib: Library, s: Scenario): string {
  const p = s.params ?? {};
  const tt = s.target as { profile_id?: string; fit_id?: string };
  const tgt = tt.profile_id != null ? lib.target_profiles[tt.profile_id]?.name ?? tt.profile_id
    : tt.fit_id != null ? lib.fits[tt.fit_id]?.name ?? tt.fit_id : tr('inline values');
  const bits = [tgt];
  if (p.distance_m != null) bits.push(`${(+p.distance_m / 1000).toLocaleString()} km`);
  if (p.tgt_speed_mps != null) bits.push(`${p.tgt_speed_mps} m/s`); else if (p.tgt_speed_pct != null) bits.push(`${p.tgt_speed_pct}%`);
  if (p.tgt_angle_deg != null) bits.push(`${p.tgt_angle_deg}°`);
  return bits.join(' · ');
}

/** Editable field set of one scenario (non-builtin). */
function ScenarioEditor({ lib, s, save }: { lib: Library; s: Scenario; save: (s: Scenario) => void }) {
  const p = s.params ?? {};
  const setP = (patch: Partial<NonNullable<Scenario['params']>>) => save({ ...s, params: { ...p, ...patch } });
  const setT = (target: Scenario['target']) => save({ ...s, target });
  const setS = (patch: Partial<NonNullable<Scenario['settings']>>) => save({ ...s, settings: { ...s.settings, ...patch } });
  const tgt = s.target as { profile_id?: string; fit_id?: string; resist_mode?: 'auto'; profile?: Omit<TargetProfile, 'id' | 'name' | 'builtin'> };
  const kind = tgt.fit_id != null ? 'fit' : tgt.profile != null ? 'inline' : 'profile';
  const tFit = tgt.fit_id ?? '';
  const tProf = tgt.profile_id ?? 'frigate';
  const inProf = tgt.profile ?? { em: 0, thermal: 0, kinetic: 0, explosive: 0, signature_radius: null, max_velocity: null, radius: null, hp: null };
  const fits = Object.values(lib.fits);
  const spdUnit = p.tgt_speed_mps != null ? 'mps' : 'pct';
  const atkUnit = p.atk_speed_mps != null ? 'mps' : 'pct';
  const num = (v: unknown) => (v == null ? '' : Number(v));
  const speed = (val: number | '', unit: 'mps' | 'pct', mpsKey: 'tgt_speed_mps' | 'atk_speed_mps', pctKey: 'tgt_speed_pct' | 'atk_speed_pct') =>
    setP(unit === 'mps' ? { [mpsKey]: val === '' ? null : val, [pctKey]: null } : { [pctKey]: val === '' ? null : val, [mpsKey]: null });
  return (
    <div className="scn-edit">
      <label>{t('name')} <input value={s.name} onChange={(e) => save({ ...s, name: e.target.value })} /></label>
      <label>{t('target')} <select value={kind} onChange={(e) => {
        const k = e.target.value;
        if (k === 'fit') setT({ fit_id: fits[0]?.id ?? '', resist_mode: 'auto' });
        else if (k === 'inline') setT({ profile: { em: 0.3, thermal: 0.3, kinetic: 0.3, explosive: 0.3, signature_radius: 125, max_velocity: 200, radius: 150, hp: null } });
        else setT({ profile_id: lib.target_profiles[tProf] ? tProf : 'none' });
      }}>
        <option value="profile">{t('target profile')}</option><option value="fit">{t('library fit')}</option><option value="inline">{t('inline values')}</option>
      </select></label>
      {kind === 'profile' && <select className="scn-target" value={tProf} onChange={(e) => setT({ profile_id: e.target.value })}>
        {Object.values(lib.target_profiles).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>}
      {kind === 'fit' && <>
        <select className="scn-target" value={tFit} onChange={(e) => setT({ fit_id: e.target.value, resist_mode: tgt.resist_mode ?? 'auto' })}>
          {fits.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <label>{t('resists')} <select value={tgt.resist_mode ?? 'auto'} onChange={(e) => setT({ fit_id: tFit, resist_mode: e.target.value as 'auto' })}>
          {RESIST_MODE.map((m) => <option key={m} value={m}>{t(m)}</option>)}
        </select></label>
      </>}
      {kind === 'inline' && <div className="scn-inline">
        {DT.map((k) => <label key={k}>{t(k)} % <input className="qty" type="number" min={0} max={100} value={Math.round(Number(inProf[k] ?? 0) * 100)} onChange={(e) => setT({ profile: { ...inProf, [k]: +e.target.value / 100 } })} /></label>)}
        <label>{t('sig m')} <input className="qty" type="number" min={0} value={num(inProf.signature_radius)} onChange={(e) => setT({ profile: { ...inProf, signature_radius: e.target.value === '' ? null : +e.target.value } })} /></label>
        <label>{t('speed')} m/s <input className="qty" type="number" min={0} value={num(inProf.max_velocity)} onChange={(e) => setT({ profile: { ...inProf, max_velocity: e.target.value === '' ? null : +e.target.value } })} /></label>
        <label>{t('radius')} m <input className="qty" type="number" min={0} value={num(inProf.radius)} onChange={(e) => setT({ profile: { ...inProf, radius: e.target.value === '' ? null : +e.target.value } })} /></label>
      </div>}
      <div className="scn-params">
        <label>{t('distance')} km <input className="qty" type="number" min={0} value={p.distance_m == null ? '' : +p.distance_m / 1000} onChange={(e) => setP({ distance_m: e.target.value === '' ? null : +e.target.value * 1000 })} /></label>
        <label>{t('target speed')} <input className="qty" type="number" min={0} value={num(p.tgt_speed_mps ?? p.tgt_speed_pct)} onChange={(e) => speed(e.target.value === '' ? '' : +e.target.value, spdUnit, 'tgt_speed_mps', 'tgt_speed_pct')} />
          <select value={spdUnit} onChange={(e) => speed(num(p.tgt_speed_mps ?? p.tgt_speed_pct), e.target.value as 'mps', 'tgt_speed_mps', 'tgt_speed_pct')}>
            <option value="mps">m/s</option><option value="pct">%</option>
          </select></label>
        <label>{t('target angle')}° <input className="qty" type="number" min={0} max={360} value={num(p.tgt_angle_deg)} onChange={(e) => setP({ tgt_angle_deg: e.target.value === '' ? null : +e.target.value })} /></label>
        <label>{t('my speed')} <input className="qty" type="number" min={0} value={num(p.atk_speed_mps ?? p.atk_speed_pct)} onChange={(e) => speed(e.target.value === '' ? '' : +e.target.value, atkUnit, 'atk_speed_mps', 'atk_speed_pct')} />
          <select value={atkUnit} onChange={(e) => speed(num(p.atk_speed_mps ?? p.atk_speed_pct), e.target.value as 'mps', 'atk_speed_mps', 'atk_speed_pct')}>
            <option value="mps">m/s</option><option value="pct">%</option>
          </select></label>
        <label>{t('my angle')}° <input className="qty" type="number" min={0} max={360} value={num(p.atk_angle_deg)} onChange={(e) => setP({ atk_angle_deg: e.target.value === '' ? null : +e.target.value })} /></label>
        <label>{t('target sig override')} m <input className="qty" type="number" min={1} value={num(p.tgt_sig_m)} onChange={(e) => setP({ tgt_sig_m: e.target.value === '' ? null : +e.target.value })} /></label>
      </div>
      <div className="scn-settings">
        <label><input type="checkbox" checked={!!s.settings?.ignore_resists} onChange={(e) => setS({ ignore_resists: e.target.checked })} /> {t('ignore resists')}</label>
        <label><input type="checkbox" checked={!!s.settings?.apply_projected} onChange={(e) => setS({ apply_projected: e.target.checked })} /> {t('apply own webs/TPs')}</label>
        <label><input type="checkbox" checked={!!s.settings?.ignore_lock_range} onChange={(e) => setS({ ignore_lock_range: e.target.checked })} /> {t('ignore lock range')}</label>
        <label><input type="checkbox" checked={!!s.settings?.ignore_drone_control_range} onChange={(e) => setS({ ignore_drone_control_range: e.target.checked })} /> {t('ignore drone control range')}</label>
        <label>{t('drone mode')} <select value={s.settings?.mobile_drone_mode ?? 'auto'} onChange={(e) => setS({ mobile_drone_mode: e.target.value as 'auto' })}>
          {DRONE_MODE.map((m) => <option key={m} value={m}>{t(m)}</option>)}
        </select></label>
      </div>
    </div>
  );
}

export function Profiles({ lib, fit, onLib, onFit }: { lib: Library; fit: FitDoc | null; onLib: (l: Library) => void; onFit: (f: FitDoc) => void }) {
  const [showSde, setShowSde] = useState(false);
  const [editScn, setEditScn] = useState<string | null>(null);
  // SDE-derived NPC profiles (ids 'sde:…', from EXFA-Data presets.json) are hidden unless toggled on or selected.
  const vis = (id: string, sel?: string) => showSde || !id.startsWith('sde:') || id === sel;
  const dps = Object.values(lib.damage_patterns).filter((d) => vis(d.id, fit?.refs.damage_pattern_id)), tps = Object.values(lib.target_profiles).filter((x) => vis(x.id, fit?.refs.target_profile_id));
  const nSde = Object.keys(lib.damage_patterns).filter((k) => k.startsWith('sde:')).length + Object.keys(lib.target_profiles).filter((k) => k.startsWith('sde:')).length;
  const saveD = (d: DamagePattern) => onLib({ ...lib, damage_patterns: { ...lib.damage_patterns, [d.id]: d } });
  const saveT = (t: TargetProfile) => onLib({ ...lib, target_profiles: { ...lib.target_profiles, [t.id]: t } });
  const saveS = (s: Scenario) => onLib({ ...lib, scenarios: { ...lib.scenarios, [s.id]: s } });
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
      <h4>{t('Scenarios (effective dps / volley, graph targets)')}</h4>
      <ul className="scn-list">
        {Object.values(lib.scenarios ?? {}).map((s) => (
          <li key={s.id} className={'scn' + (editScn === s.id ? ' open' : '')}>
            <div className="scn-row">
              <span className="scn-name" onClick={() => setEditScn(editScn === s.id ? null : s.id)}>{s.builtin ? t(s.name) : s.name}</span>
              <span className="muted small">{scenarioSummary(lib, s)}</span>
              <button className="mini" onClick={() => setEditScn(editScn === s.id ? null : s.id)}>{editScn === s.id ? '▴' : '✎'}</button>
              {!s.builtin && <button className="mini" onClick={() => {
                const { [s.id]: _x, ...rest } = lib.scenarios; void _x;
                // detach it from every fit's refs
                const fits = Object.fromEntries(Object.entries(lib.fits).map(([id, f]) => [id, f.refs.scenario_ids?.includes(s.id) ? { ...f, refs: { ...f.refs, scenario_ids: f.refs.scenario_ids.filter((x) => x !== s.id) } } : f]));
                onLib({ ...lib, scenarios: rest, fits });
              }}>✕</button>}
            </div>
            {editScn === s.id && (s.builtin ? <div className="scn-edit muted small">{t('builtin scenario — read only')}</div> : <ScenarioEditor lib={lib} s={s} save={saveS} />)}
          </li>
        ))}
      </ul>
      <button className="scn-add" onClick={() => {
        const s: Scenario = { id: uid(), name: tr('New scenario'), target: { profile_id: lib.target_profiles['frigate'] ? 'frigate' : 'none' }, params: { distance_m: 10000, tgt_speed_pct: 100, tgt_angle_deg: 90, atk_speed_pct: 0 } };
        saveS(s); setEditScn(s.id);
      }}>{t('+ scenario')}</button>
    </div>
  );
}
