import type { FitStats } from '../engine/adapter';
import { t as tr } from '../i18n';
import type { Dataset } from '../data/dataset';
import type { Fit } from '../fit/model';
import { Bar, Section, fmt, pctFmt } from './common';

const DT = ['em', 'thermal', 'kinetic', 'explosive'] as const;
const DT_SHORT: Record<string, string> = { em: 'EM', thermal: 'Th', kinetic: 'Ki', explosive: 'Ex' };

/** Localised weapon label: the engines report English type names; map type_id (or the fit module at module_index) to the
 *  dataset name in the current language, plus the loaded charge. Falls back to the engine string. */
export function weaponName(w: any, ds?: Dataset | null, fit?: Fit | null): string {
  if (!ds) return w.name ?? '';
  const m = fit && Number.isInteger(w.module_index) ? fit.modules[w.module_index] : undefined;
  const tid = w.type_id ?? m?.type_id;
  const base = tid != null && ds.raw.types?.[tid] ? ds.name(tid) : (w.name ?? '');
  const ch = w.charge_type_id ?? m?.charge_type_id;
  return ch && ds.raw.types?.[ch] ? `${base} · ${ds.name(ch)}` : base;
}

export function Stats({ st, busy, ms, error, ds, fit }: { st: FitStats | null; busy: boolean; ms: number | null; error: string | null; ds?: Dataset | null; fit?: Fit | null }) {
  if (error) return <div className="stats"><div className="error">{tr('Engine error')}: {error}</div></div>;
  if (!st) return <div className="stats muted">{busy ? tr('calculating…') : tr('no stats yet')}</div>;
  if (st.error) return <div className="stats"><div className="error">{st.error.code}: {st.error.message} {st.error.path}</div></div>;
  const r = st.resources ?? {}, o = st.offense ?? {}, d = st.defense ?? {}, c = st.capacitor ?? {}, n = st.navigation ?? {}, t = st.targeting ?? {};
  const res = (x: any, l: string) => (x && (x.total || x.used) ? <Bar label={l} used={x.used ?? 0} total={x.total ?? 0} /> : null);
  return (
    <div className="stats">
      <div className="statmeta muted">{st.meta?.engine} · SDE {st.meta?.sde_build}{ms != null ? ` · ${ms.toFixed(1)} ms` : ''}{busy ? ' · …' : ''}</div>
      {(st.violations?.length ?? 0) > 0 && (
        <Section title={`${tr('Problems')} (${st.violations.length})`}>
          <ul className="viol">{st.violations.map((v: any, i: number) => <li key={i} data-code={v.code} title={v.code}><b>{VIOLATION_LABEL[v.code] ? tr(VIOLATION_LABEL[v.code]) : v.code}</b> {v.message}</li>)}</ul>
        </Section>
      )}
      {(st.warnings?.length ?? 0) > 0 && <Section title={tr('Engine warnings')}><ul className="viol warn">{st.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul></Section>}
      <Section title={tr('Resources')}>
        {res(r.cpu, tr('CPU'))}{res(r.power, tr('Powergrid'))}{res(r.calibration, tr('Calibration'))}
        {res(r.drone_bandwidth, tr('Drone bandwidth'))}{res(r.drone_bay, tr('Drone bay m³'))}{res(r.fighter_bay, tr('Fighter bay m³'))}{res(r.cargo, tr('Cargo m³'))}
        <div className="kv">
          {r.hardpoints && <span>{tr('Turrets')} {r.hardpoints.turret?.used}/{r.hardpoints.turret?.total}</span>}
          {r.hardpoints && <span>{tr('Launchers')} {r.hardpoints.launcher?.used}/{r.hardpoints.launcher?.total}</span>}
          {r.fighter_tubes?.total?.total ? <span>{tr('Tubes')} {r.fighter_tubes.total.used}/{r.fighter_tubes.total.total}</span> : null}
        </div>
      </Section>
      <Section title={tr('Offense')} right={<b>{fmt(o.total?.dps?.total)} dps</b>}>
        <table className="grid"><thead><tr><th></th><th>DPS</th><th>{tr('Volley')}</th></tr></thead><tbody>
          <tr><td>{tr('Weapons')}</td><td className="num">{fmt(o.total?.weapon_dps)}</td><td className="num">{fmt(o.total?.weapon_volley)}</td></tr>
          <tr><td>{tr('Drones')}</td><td className="num">{fmt(o.total?.drone_dps)}</td><td className="num">{fmt(o.total?.drone_volley)}</td></tr>
          {o.total?.fighter_dps ? <tr><td>{tr('Fighters')}</td><td className="num">{fmt(o.total?.fighter_dps)}</td><td className="num">{fmt(o.total?.fighter_volley)}</td></tr> : null}
          <tr><td><b>{tr('Total')}</b></td><td className="num"><b>{fmt(o.total?.dps?.total)}</b></td><td className="num"><b>{fmt(o.total?.volley?.total)}</b></td></tr>
          {o.vs_target_profile && (o.vs_target_profile.dps !== o.total?.dps?.total) && <tr><td>{tr('vs target')}</td><td className="num">{fmt(o.vs_target_profile.dps)}</td><td className="num">{fmt(o.vs_target_profile.volley)}</td></tr>}
        </tbody></table>
        <div className="kv">{DT.map((k) => <span key={k} className={'dt-' + k}>{DT_SHORT[k]} {fmt(o.total?.dps?.[k])}</span>)}</div>
        {(o.weapons ?? []).length > 0 && (
          <table className="grid small"><thead><tr><th>{tr('Weapon')}</th><th>{tr('dps')}</th><th>{tr('Range')}</th><th>{tr('Cycle s')}</th></tr></thead><tbody>
            {o.weapons.map((w: any, i: number) => (
              <tr key={i}><td className="wname">{weaponName(w, ds, fit)}</td><td className="num">{fmt(w.dps?.total)}</td>
                <td className="num">{w.kind === 'missile' ? `${fmt((w.range_m ?? 0) / 1000)} km` : w.optimal_m != null ? `${fmt(w.optimal_m / 1000)}+${fmt((w.falloff_m ?? 0) / 1000)} km` : '—'}</td>
                <td className="num">{fmt((w.cycle_time_ms ?? 0) / 1000, 2)}</td></tr>
            ))}
          </tbody></table>
        )}
      </Section>
      <Section title={tr('Defense')} right={<b>{fmt(d.ehp?.total, 0)} EHP</b>}>
        <table className="grid"><thead><tr><th></th><th>HP</th><th>EHP</th>{DT.map((k) => <th key={k} className={'dt-' + k}>{DT_SHORT[k]}</th>)}</tr></thead><tbody>
          {(['shield', 'armor', 'hull'] as const).map((l) => (
            <tr key={l}><td>{tr(l)}</td><td className="num">{fmt(d.hp?.[l], 0)}</td><td className="num">{fmt(d.ehp?.[l], 0)}</td>
              {DT.map((k) => <td key={k} className="num">{d.resonance?.[l]?.[k] != null ? pctFmt(1 - d.resonance[l][k]) : '—'}</td>)}</tr>
          ))}
        </tbody></table>
        {d.tank && (
          <table className="grid small"><thead><tr><th>{tr('tank HP/s')}</th><th>{tr('raw')}</th><th>{tr('effective')}</th><th>{tr('sustained')}</th><th>{tr('sust. eff.')}</th></tr></thead><tbody>
            {(['passive_shield', 'shield_repair', 'armor_repair', 'hull_repair'] as const).map((k) => (
              (d.tank.raw?.[k] || d.tank.effective?.[k]) ? <tr key={k}><td>{tr(k.replace('_', ' '))}</td><td className="num">{fmt(d.tank.raw?.[k])}</td><td className="num">{fmt(d.tank.effective?.[k])}</td>
                <td className="num">{fmt(d.tank.sustained?.[k])}</td><td className="num">{fmt(d.tank.sustained_effective?.[k])}</td></tr> : null
            ))}
          </tbody></table>
        )}
      </Section>
      <Section title={tr('Capacitor')} right={<b>{c.stable ? `${tr('stable')} ${fmt(c.stable_percent)}%` : c.depletes_in_s != null ? `${tr('lasts')} ${fmtTime(c.depletes_in_s)}` : ''}</b>}>
        <div className="kv"><span>{fmt(c.capacity, 0)} GJ</span><span>{tr('recharge')} {fmt(c.recharge_time_s)} s</span><span>{tr('peak')} +{fmt(c.peak_recharge_gj_s, 2)} GJ/s</span>
          <span>{tr('use')} −{fmt(c.use_gj_s, 2)} GJ/s</span>{c.injected_gj_s ? <span>{tr('injected')} +{fmt(c.injected_gj_s, 2)}</span> : null}<span>Δ {fmt(c.delta_gj_s, 2)} GJ/s</span></div>
      </Section>
      <Section title={tr('Navigation')}>
        <div className="kv"><span>{fmt(n.max_velocity)} m/s</span><span>{tr('align')} {fmt(n.align_time_s, 2)} s</span><span>{tr('sig')} {fmt(n.signature_radius, 0)} m</span>
          <span>{tr('mass')} {fmt(n.mass, 0)} kg</span><span>{tr('agility')} {fmt(n.agility, 4)}</span><span>{tr('warp')} {fmt(n.warp_speed_au_s, 2)} AU/s</span>
          {n.warp_scramble_status ? <span>{tr('warp core')} {n.warp_scramble_status > 0 ? '+' : ''}{n.warp_scramble_status}</span> : null}</div>
      </Section>
      <Section title={tr('Targeting')}>
        <div className="kv"><span>{t.max_targets} {tr('targets')}</span><span>{fmt((t.max_range_m ?? 0) / 1000)} km</span><span>{tr('scan res')} {fmt(t.scan_resolution, 0)} mm</span>
          <span>{tr(t.sensor_type ?? '')} {fmt(t.sensor_strength, 1)}</span><span>{tr('probe size')} {fmt(t.probe_size, 2)}</span>
          {t.jam_chance_percent ? <span className="bad">{tr('jam chance')} {fmt(t.jam_chance_percent)}%</span> : null}</div>
        {t.lock_time_s && <div className="kv small">{Object.entries(t.lock_time_s).filter(([, v]) => v != null).map(([k, v]) => <span key={k}>{k.replace('sig_', '')}: {fmt(v as number, 2)} s</span>)}</div>}
      </Section>
      <Section title={tr('Drones')}>
        <div className="kv"><span>{tr('active')} {st.drones?.active}/{st.drones?.max_active}</span><span>{tr('control range')} {fmt((st.drones?.control_range_m ?? 0) / 1000)} km</span></div>
      </Section>
      {st.remote && <Section title={tr('Remote assistance')}><div className="kv">{Object.entries(st.remote).map(([k, v]) => <span key={k}>{k}: {fmt(v as number, 2)}</span>)}</div></Section>}
      <Mining m={st.mining} />
      <Outgoing o={st.outgoing} />
      <Bombing b={st.bombing} />
    </div>
  );
}

/** Engine violation codes (contract 1.x validate + exfa 2da8150) -> label */
export const VIOLATION_LABEL: Record<string, string> = {
  CPU_OVERLOAD: 'CPU overloaded', POWER_OVERLOAD: 'Powergrid overloaded', CALIBRATION_OVERLOAD: 'Calibration exceeded', DRONE_BANDWIDTH: 'Drone bandwidth exceeded',
  SLOTS_EXCEEDED: 'Too many modules in a rack', TURRET_HARDPOINTS: 'Not enough turret hardpoints', LAUNCHER_HARDPOINTS: 'Not enough launcher hardpoints',
  RIG_SIZE: 'Wrong rig size', SHIP_RESTRICTION: 'Not allowed on this ship', NOT_FITTABLE: 'Not a fittable module', MAX_TYPE_FITTED: 'Too many of this type',
  MAX_GROUP_FITTED: 'Too many of this group', MAX_GROUP_ONLINE: 'Too many of this group online', MAX_GROUP_ACTIVE: 'Too many of this group active',
  CHARGE_GROUP: 'Charge does not fit this module', CHARGE_SIZE: 'Wrong charge size', CHARGE_CAPACITY: 'Charge too large for the module', MISSING_SKILL: 'Missing skill',
};

const nz = (o: Record<string, number> | undefined) => !!o && Object.values(o).some((v) => typeof v === 'number' && v > 0);

/** Mining yield (F stats-ext 1.10 `mining`): m³/s of modules and drones, and with residue/waste (drain). */
function Mining({ m }: { m: any }) {
  if (!nz(m)) return null;
  return (
    <Section title={tr('Mining')} right={<b className="mining-total">{fmt(m.total_m3_s, 2)} m³/s</b>}>
      <table className="grid small mining"><thead><tr><th></th><th>{tr('yield m³/s')}</th><th>{tr('with waste m³/s')}</th></tr></thead><tbody>
        <tr><td>{tr('Modules')}</td><td className="num">{fmt(m.modules_m3_s, 3)}</td><td className="num">{fmt(m.modules_drain_m3_s, 3)}</td></tr>
        <tr><td>{tr('Drones')}</td><td className="num">{fmt(m.drones_m3_s, 3)}</td><td className="num">{fmt(m.drones_drain_m3_s, 3)}</td></tr>
        <tr><td><b>{tr('Total')}</b></td><td className="num"><b>{fmt(m.total_m3_s, 3)}</b></td><td className="num">{fmt((m.modules_drain_m3_s ?? 0) + (m.drones_drain_m3_s ?? 0), 3)}</td></tr>
      </tbody></table>
      <div className="muted small">{tr('m³ per hour')}: {fmt((m.total_m3_s ?? 0) * 3600, 0)}</div>
    </Section>
  );
}

const OUT_KEYS = [['shield_per_s', 'Shield', 'HP/s'], ['armor_per_s', 'Armor', 'HP/s'], ['hull_per_s', 'Hull', 'HP/s'], ['capacitor_per_s', 'Capacitor', 'GJ/s']] as const;
/** Outgoing remote repairs and capacitor transfer (F stats-ext 1.10 `outgoing`), with the spool range of mutadaptive repairers. */
function Outgoing({ o }: { o: any }) {
  if (!o || !(nz(o.current) || nz(o.spool_max))) return null;
  const spools = OUT_KEYS.some(([k]) => (o.spool_min?.[k] ?? 0) !== (o.spool_max?.[k] ?? 0));
  return (
    <Section title={tr('Remote repairs (outgoing)')}>
      <table className="grid small outgoing"><thead><tr><th></th><th>{tr('current')}</th>{spools && <><th>{tr('spool min')}</th><th>{tr('spool max')}</th></>}</tr></thead><tbody>
        {OUT_KEYS.filter(([k]) => o.current?.[k] || o.spool_max?.[k]).map(([k, l, u]) => (
          <tr key={k} data-key={k}><td>{tr(l)}</td><td className="num">{fmt(o.current?.[k], 1)} {u}</td>
            {spools && <><td className="num">{fmt(o.spool_min?.[k], 1)}</td><td className="num">{fmt(o.spool_max?.[k], 1)}</td></>}</tr>
        ))}
      </tbody></table>
    </Section>
  );
}

/** Bombs needed to kill this ship (F stats-ext 1.10 `bombing`, Pyfa's bombing view): per bomb damage type and Covert Ops level. */
function Bombing({ b }: { b: any }) {
  if (!b || !b.em) return null;
  return (
    <details className="bombing">
      <summary>{tr('Bombs to kill')} <span className="muted small">({tr('by damage type and Covert Ops level')})</span></summary>
      <table className="grid small"><thead><tr><th>{tr('bomb')}</th>{[0, 1, 2, 3, 4, 5].map((l) => <th key={l}>CO {l}</th>)}</tr></thead><tbody>
        {DT.map((k) => <tr key={k} data-type={k}><td className={'dt-' + k}>{tr(k)}</td>{[0, 1, 2, 3, 4, 5].map((l) => <td key={l} className="num">{fmt(b[k]?.[`covert_ops_${l}`], 1)}</td>)}</tr>)}
      </tbody></table>
    </details>
  );
}

function fmtTime(s: number) { const m = Math.floor(s / 60); return m ? `${m}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`; }
