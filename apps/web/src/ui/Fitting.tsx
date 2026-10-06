import { useEffect, useState } from 'react';
import { t } from '../i18n';
const tr = t;
import type { InfoCtx } from './Market';
import type { Dataset, Slot } from '../data/dataset';
import { addItemToFit, draggedType, moveModule, type Fit, type FitModule, type Library, type ModState } from '../fit/model';
import type { FitStats } from '../engine/adapter';
import { fmt, Tabs, TypeIcon } from './common';
import { applyImplantSet, saveUserImplantSets, useSdePresets, userImplantSets, type ImplantSet } from '../data/sdePresets';

const SLOTS: [Slot, string][] = [['high', 'High slots'], ['mid', 'Mid slots'], ['low', 'Low slots'], ['rig', 'Rigs'], ['subsystem', 'Subsystems'], ['service', 'Services']];
const STATES: ModState[] = ['offline', 'online', 'active', 'overheated'];
const STATE_ICON: Record<ModState, string> = { offline: '○', online: '◐', active: '●', overheated: '🔥' };

export interface FitProps {
  ds: Dataset; fit: Fit; lib: Library; stats: FitStats | null;
  onChange: (f: Fit) => void; onInfo: (id: number, ctx?: InfoCtx) => void;
}

function slotTotal(ds: Dataset, fit: Fit, stats: FitStats | null, s: Slot): number {
  const v = stats?.resources?.slots?.[s]?.total;
  if (v != null) return v;
  const attr = { high: 'hiSlots', mid: 'medSlots', low: 'lowSlots', rig: 'rigSlots', subsystem: 'maxSubSystems', service: 'serviceSlots' }[s];
  return ds.attr(fit.ship_type_id, attr) ?? 0;
}

/** index of the module being dragged (rack position change, Pyfa drag and drop) */
let dragFrom: number | null = null;
const dropProps = (fit: Fit, slot: Slot, to: number | null, onChange: (f: Fit) => void) => ({
  onDragOver: (e: React.DragEvent) => { if (dragFrom != null && fit.modules[dragFrom]?.slot === slot) e.preventDefault(); },
  onDrop: (e: React.DragEvent) => { e.preventDefault(); if (dragFrom != null) onChange(moveModule(fit, dragFrom, to)); dragFrom = null; },
});

/** Right-click context menu on a module row (Pyfa context menu): variation swap, state, info, remove. */
function CtxMenu({ x, y, ds, m, vars, nIdentical, grouped, onGroup, onInfo, onChange, onRemove, onClose }: {
  x: number; y: number; ds: Dataset; m: FitModule; vars: number[]; nIdentical?: number; grouped?: boolean; onGroup?: () => void;
  onInfo: (id: number, ctx?: InfoCtx) => void; onChange: (p: Partial<FitModule>) => void; onRemove: () => void; onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('click', close); window.addEventListener('contextmenu', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('contextmenu', close); };
  }, [onClose]);
  return (
    <div className="ctxmenu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <div className="ctxhead">{ds.name(m.type_id)}</div>
      <button onClick={() => { onInfo(m.type_id); onClose(); }}>{t('Show info')}</button>
      {(nIdentical ?? 0) > 1 && <button onClick={() => { onGroup!(); onClose(); }}>⛓ {t('Group identical modules')} (×{nIdentical})</button>}
      {grouped && <button onClick={() => { onChange({ group: null }); onClose(); }}>⛓ {t('Ungroup')}</button>}
      {vars.length > 1 && (
        <div className="ctxgroup">
          <div className="ctxlabel">{t('Variations')}</div>
          {vars.map((v) => <button key={v} className={v === m.type_id ? 'on' : ''} onClick={() => { onChange({ type_id: v, mutation: null }); onClose(); }}>{ds.name(v)}</button>)}
        </div>
      )}
      <div className="ctxgroup">
        <div className="ctxlabel">{t('State')}</div>
        {STATES.map((s) => <button key={s} className={s === m.state ? 'on' : ''} onClick={() => { onChange({ state: s }); onClose(); }}>{STATE_ICON[s]} {t(s)}</button>)}
      </div>
      <button className="danger" onClick={() => { onRemove(); onClose(); }}>{t('Remove')}</button>
    </div>
  );
}

function ModuleRow({ ds, m, idx, grp, fit, stats, onChange, onInfo, menu, setMenu }: { ds: Dataset; m: FitModule; idx: number; grp?: number[]; menu: { i: number; x: number; y: number } | null; setMenu: (v: { i: number; x: number; y: number } | null) => void } & FitProps) {
  const charges = ds.chargesFor(m.type_id);
  const mutas = ds.mutaplasmidsFor(m.mutation?.base_type_id ?? m.type_id);
  const [showMuta, setShowMuta] = useState(false);
  const targets = grp ?? [idx];
  const set = (patch: Partial<FitModule>) => onChange({ ...fit, modules: fit.modules.map((x, i) => (targets.includes(i) ? { ...x, ...patch } : x)) });
  const remove = () => onChange({ ...fit, modules: fit.modules.filter((_, i) => !targets.includes(i)) });
  const nIdentical = grp ? 0 : fit.modules.reduce((n, x) => n + (x.slot === m.slot && x.type_id === m.type_id && x.group == null ? 1 : 0), 0);
  const groupIdentical = () => {
    const gid = 1 + fit.modules.reduce((mx, x) => Math.max(mx, x.group ?? 0), 0);
    onChange({ ...fit, modules: fit.modules.map((x) => (x.slot === m.slot && x.type_id === m.type_id && x.group == null ? { ...x, group: gid } : x)) });
  };
  const cycle = (dir: number) => {
    const allowed = ds.slot(m.type_id) === 'rig' || ds.slot(m.type_id) === 'subsystem' ? ['offline', 'online'] as ModState[] : STATES;
    const i = allowed.indexOf(m.state);
    set({ state: allowed[(i + dir + allowed.length) % allowed.length] });
  };
  const wpn = stats?.offense?.weapons?.find((w: any) => w.module_index === idx);
  const modStats = stats?.modules?.find((x: any) => x.module_index === idx);
  const priceRow = stats?.price?.sections?.modules?.items?.find((x: any) => x.index === idx);
  const dpsTotal = grp ? grp.reduce((s, i) => s + (stats?.offense?.weapons?.find((w: any) => w.module_index === i)?.dps?.total ?? 0), 0) : wpn?.dps?.total;
  const iskTotal = grp ? grp.reduce((s, i) => s + (stats?.price?.sections?.modules?.items?.find((x: any) => x.index === i)?.unit_isk ?? 0), 0) : priceRow?.unit_isk;
  const sigRad = ds.attr(m.type_id, 'optimalSigRadius');
  const trackNorm = wpn?.tracking && sigRad ? (wpn.tracking * 40000) / sigRad : null;
  const baseRangeM = !wpn ? (ds.attr(m.type_id, 'maxRange') ?? null) : null;
  const viol = (stats?.violations ?? []).filter((v: any) => v.module_index === idx);
  const muta = m.mutation ? ds.raw.mutaplasmids?.[m.mutation.mutaplasmid_type_id] : null;
  return (
    <div className={'mod' + (viol.length ? ' bad' : '')} title={viol.map((v: any) => v.message).join('\n')} data-idx={idx}
      draggable onDragStart={(e) => { dragFrom = idx; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); }} onDragEnd={() => { dragFrom = null; }}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ i: idx, x: e.clientX, y: e.clientY }); }}
      onDragOver={(e) => {
        const id = draggedType.id;
        if (id != null && ds.kind(id) === 'charge' && ds.chargesFor(m.type_id).includes(id)) e.preventDefault();
        else if (dragFrom != null && fit.modules[dragFrom]?.slot === m.slot) e.preventDefault();
      }}
      onDrop={(e) => {
        const id = draggedType.id;
        if (id != null && ds.kind(id) === 'charge' && ds.chargesFor(m.type_id).includes(id)) { e.preventDefault(); e.stopPropagation(); set({ charge_type_id: id }); draggedType.id = null; return; }
        if (dragFrom != null) { e.preventDefault(); onChange(moveModule(fit, dragFrom, idx)); dragFrom = null; }
      }}>
      {menu?.i === idx && <CtxMenu x={menu.x} y={menu.y} ds={ds} m={m} vars={ds.variations(m.type_id)} nIdentical={nIdentical} grouped={!!grp} onGroup={groupIdentical} onInfo={onInfo} onChange={set} onRemove={remove} onClose={() => setMenu(null)} />}
      <button className={'state s-' + m.state} onClick={() => cycle(1)} title={`${t(m.state)} (${t('click: next state')})`}>{STATE_ICON[m.state]}</button>
      <TypeIcon id={m.mutation?.base_type_id ?? m.type_id} size={18} />
      <span className="mname" onClick={() => onInfo(m.type_id, { module: idx })}>{grp && <b className="gcount" title={t('grouped modules')}>×{grp.length} </b>}{ds.name(m.type_id)}{m.mutation ? ' ✦' : ''}</span>
      {m.charge_type_id ? <TypeIcon id={m.charge_type_id} size={18} /> : null}
      {charges.length > 0 && (
        <select value={m.charge_type_id ?? ''} onChange={(e) => set({ charge_type_id: e.target.value ? +e.target.value : null })}>
          <option value="">{t('— no charge —')}</option>
          {charges.map((c) => <option key={c} value={c}>{ds.name(c)}</option>)}
        </select>
      )}
      {(ds.attr(m.type_id, 'damageMultiplierBonusMax') != null || ds.attr(m.type_id, 'repairMultiplierBonusMax') != null) && (
        <select className="spool" title={t('spool-up for this module (default: fit option)')} value={m.spool == null ? '' : String(m.spool)} onChange={(e) => set({ spool: e.target.value === '' ? null : +e.target.value })}>
          <option value="">{t('spool: default')}</option>
          {[0, 0.25, 0.5, 0.75, 1].map((v) => <option key={v} value={v}>{t('spool')} {v * 100}%</option>)}
        </select>
      )}
      {mutas.length > 0 && <button className="mini" onClick={() => setShowMuta(!showMuta)} title={t('Mutaplasmid')}>✦</button>}
      {modStats?.heat && <span className="heat" title={`${t('expected overheat burnout')}: ${modStats.heat.burn_cycles} ${t('cycles')}`}>🔥 {fmtBurn(modStats.heat.burnout_s)}</span>}
      <span className="mcols">
        {modStats?.power != null && modStats.power > 0 && <span className="mc" title={t('powergrid (MW)')}>{fmt(modStats.power, 1) + ' MW'}</span>}
        {modStats?.cpu != null && modStats.cpu > 0 && <span className="mc" title={t('cpu (tf)')}>{fmt(modStats.cpu, 1) + ' tf'}</span>}
        {modStats?.cap_use_gj_s ? <span className="mc" title={t('capacitor use (GJ/s)')}>{fmt(modStats.cap_use_gj_s, 2) + ' GJ/s'}</span> : null}
        {modStats?.cycle_time_ms ? <span className="mc" title={t('cycle time')}>{fmt(modStats.cycle_time_ms / 1000, 1) + ' s'}</span> : null}
        {wpn?.optimal_m != null && <span className="mc" title={t('optimal + falloff')}>{fmt(wpn.optimal_m / 1000, 1) + (wpn.falloff_m ? '+' + fmt(wpn.falloff_m / 1000, 1) : '') + ' km'}</span>}
        {baseRangeM ? <span className="mc dim" title={t('max range (base attribute)')}>{fmt(baseRangeM / 1000, 1) + ' km'}</span> : null}
        {trackNorm != null && <span className="mc" title={t('tracking (normalized)')}>{fmt(trackNorm, 0)}</span>}
        {dpsTotal != null && dpsTotal > 0 && <span className="mc dps" title={t('damage per second')}>{dpsTotal.toFixed(1) + ' dps'}</span>}
        {iskTotal != null && iskTotal > 0 && <span className="mc" title={t('market price (Jita)')}>{fmt(iskTotal, 0) + ' ISK'}</span>}
      </span>
      <button className="mini rm" onClick={remove} title={t('Remove')}>✕</button>
      {showMuta && (
        <div className="muta">
          <select value={m.mutation?.mutaplasmid_type_id ?? ''} onChange={(e) => {
            const v = +e.target.value;
            if (!v) { set({ type_id: m.mutation?.base_type_id ?? m.type_id, mutation: null }); return; }
            const opt = mutas.find((x) => x.muta === v)!;
            const base = m.mutation?.base_type_id ?? m.type_id;
            const attrs = Object.fromEntries(Object.keys(ds.raw.mutaplasmids![v].attrs).map((a) => [a, ds.type(base)?.attrs[a] ?? 0]));
            set({ type_id: opt.output, mutation: { base_type_id: base, mutaplasmid_type_id: v, attributes: attrs } });
          }}>
            <option value="">{t('— not mutated —')}</option>
            {mutas.map((x) => <option key={x.muta} value={x.muta}>{ds.name(x.muta)}</option>)}
          </select>
          {muta && m.mutation && Object.entries(muta.attrs).map(([a, [lo, hi]]) => {
            const baseV = ds.type(m.mutation!.base_type_id)?.attrs[a] ?? 0;
            const cur = m.mutation!.attributes[a] ?? baseV;
            const info = ds.raw.attributes[a];
            return (
              <label key={a} className="mrow">{info?.display || info?.name}
                <input type="range" min={0} max={1000} value={baseV ? Math.round(((cur / baseV - lo) / (hi - lo)) * 1000) : 500}
                  onChange={(e) => { const f = lo + ((hi - lo) * +e.target.value) / 1000; set({ mutation: { ...m.mutation!, attributes: { ...m.mutation!.attributes, [a]: baseV * f } } }); }} />
                <span className="num">{+cur.toFixed(3)}</span>
                <span className="mrange muted" data-attr={a} data-lo={baseV * lo} data-hi={baseV * hi} title={t('roll range of the mutaplasmid')}>{+(baseV * Math.min(lo, hi)).toFixed(3)} … {+(baseV * Math.max(lo, hi)).toFixed(3)}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

const fmtBurn = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
const ehpTotal = (x: any) => (x?.ehp ? (x.ehp.shield ?? 0) + (x.ehp.armor ?? 0) + (x.ehp.hull ?? 0) : null);

function Qty({ value, onChange, min = 0, max = 999 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return <input className="qty" type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, +e.target.value || 0)))} />;
}

/** Implant sets: SDE sets (EXFA-Data presets) and user-saved sets; applying one replaces the implants in its slots. */
function ImplantSets({ ds, fit, onChange }: FitProps) {
  const sde = useSdePresets();
  const [user, setUser] = useState<ImplantSet[]>(userImplantSets);
  const slotOf = (id: number) => ds.attr(id, 'implantness') ?? undefined;
  const label = (s: ImplantSet) => {
    if (s.user || ds.lang !== 'zh') return s.name + (s.complete || s.user ? '' : ` (${s.members.length}/6)`);
    const zh = ds.name(s.members[0].type_id).replace(/\s*[-—–]\s*\S+型$/, '');
    return zh + (s.complete ? '' : ` (${s.members.length}/6)`);
  };
  const all = [...user, ...sde.implant_sets];
  const apply = (id: string) => { const s = all.find((x) => x.id === id); if (s) onChange({ ...fit, implants: applyImplantSet(fit.implants, s, slotOf) }); };
  const save = () => {
    if (!fit.implants.length) return;
    const name = prompt(t('Name for this implant set'), t('My implants'));
    if (!name) return;
    const set: ImplantSet = { id: 'user:' + Math.random().toString(36).slice(2, 8), name, grade: null, complete: true, user: true,
      members: fit.implants.map((id) => ({ type_id: id, slot: slotOf(id) ?? 0 })) };
    const next = [...user, set]; setUser(next); saveUserImplantSets(next);
  };
  const delUser = (id: string) => { const next = user.filter((x) => x.id !== id); setUser(next); saveUserImplantSets(next); };
  if (!all.length && !fit.implants.length) return null;
  return (
    <div className="implantsets">
      <select className="implantset" value="" onChange={(e) => e.target.value && apply(e.target.value)} title={t('Implant set')}>
        <option value="">{t('Implant set…')}</option>
        {user.length > 0 && <optgroup label={t('Saved sets')}>{user.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}</optgroup>}
        {sde.implant_sets.length > 0 && <optgroup label={t('Pirate / faction sets (SDE)')}>{sde.implant_sets.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}</optgroup>}
      </select>
      {fit.implants.length > 0 && <button className="mini saveset" onClick={save}>{t('Save implants as set')}</button>}
      {user.length > 0 && <select className="delset" value="" onChange={(e) => e.target.value && delUser(e.target.value)} title={t('Delete saved set')}>
        <option value="">{t('Delete saved set…')}</option>{user.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
    </div>
  );
}

function Bays(p: FitProps) {
  const { ds, fit, onChange, onInfo } = p;
  const dehp = (i: number) => ehpTotal(p.stats?.drones?.items?.find((x: any) => x.drone_index === i));
  const fehp = (i: number) => ehpTotal(p.stats?.fighters?.items?.find((x: any) => x.fighter_index === i));
  const rm = <K extends 'drones' | 'fighters' | 'implants' | 'boosters' | 'cargo'>(k: K, i: number) => onChange({ ...fit, [k]: (fit[k] as unknown[]).filter((_, j) => j !== i) });
  return (
    <>
      {fit.drones.length > 0 && <div className="bay"><h4>{t('Drones')}</h4>{fit.drones.map((d, i) => (
        <div className="mod" key={i}><TypeIcon id={d.type_id} size={18} /><span className="mname" onClick={() => onInfo(d.type_id, { drone: i })}>{ds.name(d.type_id)}</span>
          <span>{t('qty')} <Qty value={d.quantity} min={1} onChange={(v) => onChange({ ...fit, drones: fit.drones.map((x, j) => (j === i ? { ...x, quantity: v, active: Math.min(x.active, v) } : x)) })} /></span>
          <span>{t('active')} <Qty value={d.active} max={d.quantity} onChange={(v) => onChange({ ...fit, drones: fit.drones.map((x, j) => (j === i ? { ...x, active: v } : x)) })} /></span>
          {dehp(i) != null && <span className="muted dehp" title={t('EHP of one drone (damage pattern of the fit)')}>{Math.round(dehp(i)!)} EHP</span>}
          <button className="mini" onClick={() => rm('drones', i)}>✕</button></div>))}</div>}
      {fit.fighters.length > 0 && <div className="bay"><h4>{t('Fighters')}</h4>{fit.fighters.map((f, i) => (
        <div className="mod" key={i}><TypeIcon id={f.type_id} size={18} /><span className="mname" onClick={() => onInfo(f.type_id)}>{ds.name(f.type_id)}</span>
          <span>{t('squadron')} <Qty value={f.quantity} min={1} onChange={(v) => onChange({ ...fit, fighters: fit.fighters.map((x, j) => (j === i ? { ...x, quantity: v } : x)) })} /></span>
          <label><input type="checkbox" checked={f.active} onChange={(e) => onChange({ ...fit, fighters: fit.fighters.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)) })} /> {t('launched')}</label>
          {fehp(i) != null && <span className="muted fehp" title={t('EHP of one fighter (damage pattern of the fit)')}>{Math.round(fehp(i)!)} EHP</span>}
          <button className="mini" onClick={() => rm('fighters', i)}>✕</button>
          <div className="subopts">{ds.fighterAbilities(f.type_id).map((a, _k, all) => {
            const on = f.abilities ? f.abilities.includes(a.effect) : a.default;
            const toggle = () => {
              const cur = f.abilities ?? all.filter((x) => x.default).map((x) => x.effect);
              const next = on ? cur.filter((x) => x !== a.effect) : [...cur, a.effect];
              onChange({ ...fit, fighters: fit.fighters.map((x, j) => (j === i ? { ...x, abilities: next } : x)) });
            };
            return <label key={a.effect} title={`${t('effect')} ${a.effect}`}><input type="checkbox" className="ability" checked={on} onChange={toggle} /> {a.name}</label>;
          })}</div></div>))}</div>}
      <ImplantSets {...p} />
      {(fit.implants.length > 0 || fit.boosters.length > 0) && <div className="bay"><h4>{t('Implants & boosters')}</h4>
        {fit.implants.map((t, i) => <div className="mod" key={'i' + i}><TypeIcon id={t} size={18} /><span className="mname" onClick={() => onInfo(t)}>{ds.name(t)}</span><span className="muted">{tr('slot')} {ds.attr(t, 'implantness') ?? '?'}</span><button className="mini" onClick={() => rm('implants', i)}>✕</button></div>)}
        {fit.boosters.map((b, i) => <div className="mod" key={'b' + i}><TypeIcon id={b.type_id} size={18} /><span className="mname" onClick={() => onInfo(b.type_id)}>{ds.name(b.type_id)}</span><span className="muted">{t('booster slot')} {ds.attr(b.type_id, 'boosterness') ?? '?'}</span><button className="mini" onClick={() => rm('boosters', i)}>✕</button>
          <div className="subopts">{ds.boosterSideEffects(b.type_id).map((se) => {
            const on = (b.side_effects ?? []).includes(se.effect);
            const toggle = () => onChange({ ...fit, boosters: fit.boosters.map((x, j) => (j === i ? { ...x, side_effects: on ? (x.side_effects ?? []).filter((e) => e !== se.effect) : [...(x.side_effects ?? []), se.effect] } : x)) });
            return <label key={se.effect}><input type="checkbox" className="sidefx" checked={on} onChange={toggle} /> {se.name}{se.chance != null ? ` (${Math.round(se.chance * 100)}%)` : ''}</label>;
          })}</div></div>)}
      </div>}
      {fit.cargo.length > 0 && <div className="bay"><h4>{t('Cargo')}</h4>{fit.cargo.map((c, i) => (
        <div className="mod" key={i}><span className="mname" onClick={() => onInfo(c.type_id)}>{ds.name(c.type_id)}</span>
          <span>x <Qty value={c.quantity} min={1} max={1e6} onChange={(v) => onChange({ ...fit, cargo: fit.cargo.map((x, j) => (j === i ? { ...x, quantity: v } : x)) })} /></span>
          <button className="mini" onClick={() => rm('cargo', i)}>✕</button></div>))}</div>}
    </>
  );
}

function Projected(p: FitProps & { addProjected: boolean; setAddProjected: (b: boolean) => void }) {
  const { ds, fit, lib, onChange, onInfo } = p;
  const beacons = Object.entries(ds.raw.environment?.effect_beacons ?? {}).sort((a, b) => a[1].kind.localeCompare(b[1].kind) || a[1].name.localeCompare(b[1].name));
  const others = Object.values(lib.fits).filter((f) => f.id !== fit.id);
  const [pf, setPf] = useState('');
  const [bf, setBf] = useState('');
  const setP = (i: number, patch: object) => onChange({ ...fit, projected: fit.projected.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div>
      <label className="toggle"><input type="checkbox" checked={p.addProjected} onChange={(e) => p.setAddProjected(e.target.checked)} /> {t('add items from the market as')} <b>{t('projected onto this fit')}</b></label>
      <h4>{t('Projected onto this fit')}</h4>
      {fit.projected.length === 0 && <p className="muted">{t('Nothing projected. Turn on the toggle above and pick webs, paints, neuts, remote reps, drones… or project a saved fit.')}</p>}
      {fit.projected.map((x, i) => (
        <div className="mod" key={i}>
          <span className="mname" onClick={() => x.type_id && onInfo(x.type_id)}>{x.kind === 'fit' ? `${t('Fit')}: ${lib.fits[x.fit_id!]?.name ?? t('(deleted)')}` : ds.name(x.type_id!)}</span>
          <span>×<Qty value={x.amount} min={1} max={50} onChange={(v) => setP(i, { amount: v })} /></span>
          <span>{t('at')} <input className="qty wide" type="number" min={0} step={500} value={x.distance_m ?? ''} placeholder={t('any')} onChange={(e) => setP(i, { distance_m: e.target.value === '' ? null : +e.target.value })} /> m</span>
          <button className="mini" onClick={() => onChange({ ...fit, projected: fit.projected.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <div className="row">
        <select value={pf} onChange={(e) => setPf(e.target.value)}><option value="">{t('project a saved fit…')}</option>{others.map((f) => <option key={f.id} value={f.id}>{f.name} ({ds.name(f.ship_type_id)})</option>)}</select>
        <button disabled={!pf} onClick={() => { onChange({ ...fit, projected: [...fit.projected, { kind: 'fit', fit_id: pf, amount: 1, distance_m: 10000 }] }); setPf(''); }}>{t('Project fit')}</button>
      </div>
      <h4>{t('Fleet boosters (command bursts)')}</h4>
      {fit.fleet.booster_fit_ids.map((id) => (
        <div className="mod" key={id}><span className="mname">{lib.fits[id]?.name ?? t('(deleted)')}</span>
          <button className="mini" onClick={() => onChange({ ...fit, fleet: { ...fit.fleet, booster_fit_ids: fit.fleet.booster_fit_ids.filter((x) => x !== id) } })}>✕</button></div>
      ))}
      <div className="row">
        <select value={bf} onChange={(e) => setBf(e.target.value)}><option value="">{t('add booster fit…')}</option>{others.map((f) => <option key={f.id} value={f.id}>{f.name} ({ds.name(f.ship_type_id)})</option>)}</select>
        <button disabled={!bf} onClick={() => { onChange({ ...fit, fleet: { ...fit.fleet, booster_fit_ids: [...new Set([...fit.fleet.booster_fit_ids, bf])] } }); setBf(''); }}>{t('Add booster')}</button>
      </div>
      <h4>{t('Manual fleet buffs')}</h4>
      {fit.fleet.buffs.map((b, i) => (
        <div className="mod" key={'fb' + i}><span className="mname">{ds.warfareBuffs().find(([k]) => k === b.buff_id)?.[1] ?? `${t('buff')} ${b.buff_id}`}</span>
          <input className="qty wide" type="number" step={1} value={b.value} onChange={(e) => onChange({ ...fit, fleet: { ...fit.fleet, buffs: fit.fleet.buffs.map((x, j) => (j === i ? { ...x, value: +e.target.value } : x)) } })} />
          <button className="mini" onClick={() => onChange({ ...fit, fleet: { ...fit.fleet, buffs: fit.fleet.buffs.filter((_, j) => j !== i) } })}>✕</button></div>
      ))}
      <div className="row">
        <select className="buffsel" value="" onChange={(e) => e.target.value && onChange({ ...fit, fleet: { ...fit.fleet, buffs: [...fit.fleet.buffs, { buff_id: +e.target.value, value: -10 }] } })}>
          <option value="">{t('add a warfare buff (value as in-game %, e.g. -10)…')}</option>
          {ds.warfareBuffs().map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
      </div>
      <h4>{t('Environment')}</h4>
      <div className="row">
        <select value="" onChange={(e) => e.target.value && onChange({ ...fit, environment: [...new Set([...fit.environment, +e.target.value])] })}>
          <option value="">{t('add system effect / beacon…')}</option>
          {beacons.map(([k, b]) => <option key={k} value={k}>[{b.kind}] {ds.name(+k)}</option>)}
        </select>
        <select value={fit.system_security ?? ''} onChange={(e) => onChange({ ...fit, system_security: (e.target.value || null) as Fit['system_security'] })}>
          <option value="">{t('security: default (nullsec)')}</option><option value="hisec">{t('hisec')}</option><option value="lowsec">{t('lowsec')}</option><option value="nullsec">{t('nullsec')}</option><option value="wspace">{t('w-space')}</option>
        </select>
      </div>
      {fit.environment.map((id) => (
        <div className="mod" key={id}><span className="mname" onClick={() => onInfo(id)}>{ds.name(id)}</span><span className="muted">{ds.raw.environment?.effect_beacons?.[id]?.kind}</span>
          <button className="mini" onClick={() => onChange({ ...fit, environment: fit.environment.filter((x) => x !== id) })}>✕</button></div>
      ))}
    </div>
  );
}

export function Fitting(p: FitProps & { addProjected: boolean; setAddProjected: (b: boolean) => void }) {
  const { ds, fit, lib, stats, onChange } = p;
  const [tab, setTab] = useState<'fit' | 'proj' | 'opts'>('fit');
  const [menu, setMenu] = useState<{ i: number; x: number; y: number } | null>(null);
  const modes = ds.skills.length ? Object.entries(ds.raw.types).filter(([, t]) => t.group === 1306 && t.name.startsWith(ds.name(fit.ship_type_id, 'en') + ' ')).map(([k]) => +k) : [];
  // Pyfa: dropping a market item anywhere on the fitting canvas adds it to its natural slot/bay
  // (a charge dropped on a module row is handled by the row itself).
  const dropItem = {
    onDragOver: (e: React.DragEvent) => { if (draggedType.id != null) e.preventDefault(); },
    onDrop: (e: React.DragEvent) => {
      const id = draggedType.id;
      if (id == null) return;
      e.preventDefault();
      const next = addItemToFit(ds, fit, id, p.addProjected);
      if (next) onChange(next);
      draggedType.id = null;
    },
  };
  return (
    <div className="fitting" {...dropItem}>
      <div className="fithead">
        <span className="ship" onClick={() => p.onInfo(fit.ship_type_id, { ship: true })}>{ds.name(fit.ship_type_id)}</span>
        <input value={fit.name} onChange={(e) => onChange({ ...fit, name: e.target.value })} />
        {modes.length > 0 && (
          <select value={fit.mode_type_id ?? ''} onChange={(e) => onChange({ ...fit, mode_type_id: e.target.value ? +e.target.value : null })}>
            <option value="">{t('mode: default')}</option>{modes.map((m) => <option key={m} value={m}>{ds.name(m)}</option>)}
          </select>
        )}
        <select value={fit.character_id} onChange={(e) => onChange({ ...fit, character_id: e.target.value })} title={t('Character')}>
          {Object.values(lib.characters).map((c) => <option key={c.id} value={c.id}>👤 {c.name}</option>)}
        </select>
        <select value={fit.damage_pattern_id} onChange={(e) => onChange({ ...fit, damage_pattern_id: e.target.value })} title={t('Damage pattern (incoming)')}>
          {Object.values(lib.damagePatterns).filter((d) => !d.id.startsWith('sde:') || d.id === fit.damage_pattern_id).map((d) => <option key={d.id} value={d.id}>🛡 {d.name}</option>)}
        </select>
        <select value={fit.target_profile_id} onChange={(e) => onChange({ ...fit, target_profile_id: e.target.value })} title={t('Target profile (outgoing)')}>
          {Object.values(lib.targetProfiles).filter((x) => !x.id.startsWith('sde:') || x.id === fit.target_profile_id).map((x) => <option key={x.id} value={x.id}>🎯 {x.name}</option>)}
        </select>
      </div>
      <Tabs tabs={[['fit', t('Fitting')], ['proj', `${t('Projected / fleet / environment')} (${fit.projected.length + fit.fleet.booster_fit_ids.length + fit.environment.length})`], ['opts', t('Options')]]} value={tab} onChange={setTab} />
      {tab === 'fit' && (
        <>
          {SLOTS.map(([s, label]) => {
            const total = slotTotal(ds, fit, stats, s);
            const mods = fit.modules.map((m, i) => [m, i] as const).filter(([m]) => m.slot === s);
            if (!total && !mods.length) return null;
            return (
              <div className="slotgroup" key={s}>
                <h4>{t(label)} <span className="muted">{mods.length}/{total}</span></h4>
                {(() => {
                  const seenGroups = new Set<number>();
                  return mods.map(([m, i]) => {
                    if (m.group != null) {
                      if (seenGroups.has(m.group)) return null;
                      seenGroups.add(m.group);
                      const members = mods.filter(([x]) => x.group === m.group).map(([, j]) => j);
                      return <ModuleRow key={'g' + m.group} {...p} m={m} idx={i} grp={members} menu={menu} setMenu={setMenu} />;
                    }
                    return <ModuleRow key={i} {...p} m={m} idx={i} menu={menu} setMenu={setMenu} />;
                  });
                })()}
                {Array.from({ length: Math.max(0, total - mods.length) }, (_, i) => <div key={'e' + i} className="mod empty" {...dropProps(fit, s, null, onChange)}>{t(`[empty ${s} slot]`)}</div>)}
              </div>
            );
          })}
          <Bays {...p} />
        </>
      )}
      {tab === 'proj' && <Projected {...p} />}
      {tab === 'opts' && (
        <div className="opts">
          <label><input type="checkbox" checked={fit.options.factor_reload} onChange={(e) => onChange({ ...fit, options: { ...fit.options, factor_reload: e.target.checked } })} /> {t('factor in reload time')}</label>
          <label>{t('default spool-up')} <input type="range" min={0} max={1} step={0.05} value={fit.options.spool} onChange={(e) => onChange({ ...fit, options: { ...fit.options, spool: +e.target.value } })} /> {(fit.options.spool * 100).toFixed(0)}%</label>
          <label>{t('reactive armor hardener')} <select value={fit.options.rah} onChange={(e) => onChange({ ...fit, options: { ...fit.options, rah: e.target.value as 'adapt' | 'disable' } })}><option value="adapt">{t('adapt to damage pattern')}</option><option value="disable">{t('unadapted')}</option></select></label>
          <label>{t('notes')}<textarea value={fit.notes ?? ''} onChange={(e) => onChange({ ...fit, notes: e.target.value })} /></label>
        </div>
      )}
    </div>
  );
}
