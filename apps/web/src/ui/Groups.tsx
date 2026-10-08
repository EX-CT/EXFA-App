// Configuration groups (docs/27 §7): actors + directed relations compile into one exfa/compute@1 batch
// via @exfa/format compileGroup. The engine stays workspace-agnostic — this panel owns the host side.
import { useMemo, useRef, useState } from 'react';
import { compileGroup, type Group, type GroupActor, type GroupRelation } from '@exfa/format';
import { uid, type FitDoc, type Library } from '../fit/model';
import {
  addGroupActor, ensureItemIds, entityWs, filterWorkspace, newGroupDoc, removeGroup, removeGroupActor,
  removeGroupRelation, setEntityWs, updateGroupActor, updateGroupRelation, upsertGroup, upsertGroupRelation,
} from '../fit/library';
import { metric } from '../fit/metrics';
import { fmt } from './common';
import { engineCompute, type Engine, type EngineBatchResult, type FitStats } from '../engine/adapter';
import type { Dataset } from '../data/dataset';
import { t } from '../i18n';
import { notify } from './notify';

const KINDS: GroupRelation['kind'][] = ['project', 'command'];
const KIND_LABEL: Record<GroupRelation['kind'], string> = { project: 'project (投射)', command: 'command (指挥加成)' };
const ROLES = ['DPS', '后勤', '指挥', '侦察', '拦截', '电子战'];

/** Key stats of the per-actor result table (same stats paths as the compare strip). */
const RESULT_METRICS = ['dps', 'volley', 'ehp', 'tank', 'speed', 'cap_stable'] as const;

interface RunResult { at: number; issues: string[]; res: EngineBatchResult | null }

/** Every equipment entry a `project` relation can select (modules/drones/fighters), labelled `type name (id)`. */
function srcItems(ds: Dataset, doc: FitDoc | null | undefined): { id: string; label: string }[] {
  if (!doc) return [];
  const out: { id: string; label: string }[] = [];
  const nm = (type_id: number) => ds.name(type_id) || `#${type_id}`;
  for (const m of doc.fit.modules) if (m.id) out.push({ id: m.id, label: `${nm(m.type_id)} (${m.id.slice(0, 8)})` });
  for (const d of doc.fit.drones) if (d.id) out.push({ id: d.id, label: `${nm(d.type_id)} ×${d.quantity ?? 1} (${d.id.slice(0, 8)})` });
  for (const f of doc.fit.fighters) if (f.id) out.push({ id: f.id, label: `${nm(f.type_id)} ×${f.quantity ?? 1} (${f.id.slice(0, 8)})` });
  return out;
}

export function Groups({ ds, lib, groupId, wsId, engine, onLib, onSelect, onOpenFit }: {
  ds: Dataset; lib: Library; groupId: string | null; wsId: string; engine: Engine | null;
  onLib: (lib: Library) => void; onSelect: (id: string | null) => void; onOpenFit: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<RunResult | null>(null);
  const gen = useRef(0);
  const group: Group | null = groupId ? lib.groups[groupId] ?? null : null;
  const fits = useMemo(() => Object.values(filterWorkspace(lib, wsId).fits)
    .sort((a, b) => a.name.localeCompare(b.name)), [lib, wsId]);
  const groups = useMemo(() => Object.values(lib.groups ?? {}).filter((g) => entityWs(lib, g.id) === wsId)
    .sort((a, b) => a.name.localeCompare(b.name)), [lib, wsId]);
  const actorById = useMemo(() => {
    const m = new Map<string, GroupActor>();
    for (const a of group?.actors ?? []) m.set(a.id, a);
    return m;
  }, [group]);

  const create = () => {
    const g = newGroupDoc(t('New configuration group'));
    onLib(setEntityWs(upsertGroup(lib, g), g.id, wsId));
    onSelect(g.id);
  };
  const del = () => {
    if (!group || !window.confirm(t('Delete this configuration group?'))) return;
    onLib(removeGroup(lib, group.id));
    onSelect(null);
  };
  /** Mint item ids on a fit the first time a relation needs them as selectable source items (docs/27 §7.3). */
  const ensureDoc = (fitId: string | undefined) => {
    const doc = fitId ? lib.fits[fitId] : null;
    if (!doc) return;
    const fixed = ensureItemIds(doc);
    if (fixed !== doc) onLib({ ...lib, fits: { ...lib.fits, [fixed.id]: fixed } });
  };

  const runCompute = async () => {
    if (!engine || !group || busy) return;
    const my = ++gen.current;
    setBusy(true);
    try {
      const { request, issues } = compileGroup(lib, group, {});
      const n = (request.batch.fits as unknown[] | undefined)?.length ?? 0;
      if (!n) {
        setRun({ at: Date.now(), issues: issues.length ? issues : [t('Add an actor with a fit first.')], res: null });
        notify({ kind: 'warn', text: t('Group has nothing to compute.') });
        return;
      }
      const res = (await engineCompute(engine, request)) as EngineBatchResult;
      if (gen.current === my) setRun({ at: Date.now(), issues, res });
    } catch (e) {
      if (gen.current === my) setRun({ at: Date.now(), issues: [(e as Error).message], res: null });
    } finally {
      if (gen.current === my) setBusy(false);
    }
  };

  const cell = (stats: FitStats | undefined, key: string) => {
    if (!stats) return '—';
    const m = metric(key);
    const v = m?.get(stats);
    return v == null ? '—' : fmt(v, m!.digits);
  };

  return (
    <div className="groups-panel">
      <div className="row">
        <select className="group-sel" value={group?.id ?? ''} onChange={(e) => onSelect(e.target.value || null)}>
          <option value="">{groups.length ? t('(select group)') : t('(no groups in this workspace)')}</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <button className="group-new" onClick={create}>{t('New group')}</button>
        {group && <button className="group-del" onClick={del}>{t('Delete')}</button>}
        {group && <>
          <span style={{ flex: 1 }} />
          <button className="group-compute" disabled={busy || !engine} onClick={() => void runCompute()}>{busy ? t('Computing…') : t('Compute')}</button>
        </>}
      </div>
      {!group ? <p className="muted">{t('Pick a group, or create one. A group batches its fits and directed project / command relations into one compute request.')}</p> : (
        <>
          <div className="row">
            <label>{t('Name')} <input className="group-name" value={group.name} onChange={(e) => onLib(upsertGroup(lib, { ...group, name: e.target.value }))} /></label>
            <label style={{ flex: 1 }}>{t('Notes')} <input value={group.notes ?? ''} placeholder={t('notes')} onChange={(e) => onLib(upsertGroup(lib, { ...group, notes: e.target.value || undefined }))} /></label>
          </div>

          <div className="section">
            <div className="row">
              <h4 style={{ flex: 1 }}>{t('Actors')} ({group.actors.length})</h4>
              <button className="group-actor-add" disabled={!fits.length} onClick={() => onLib(addGroupActor(lib, group.id, fits[0]?.id ?? '').lib)}>{t('Add actor')}</button>
            </div>
            {!group.actors.length && <p className="muted">{t('No actors yet — each actor references one fit from the library.')}</p>}
            {group.actors.map((a) => (
              <div className="row" key={a.id} data-actor={a.id}>
                <label>{t('Label')} <input style={{ width: 110 }} value={a.label ?? ''} onChange={(e) => onLib(updateGroupActor(lib, group.id, a.id, { label: e.target.value || undefined }))} /></label>
                <label style={{ flex: 1 }}>{t('Fit')} <select value={a.fit_id} onChange={(e) => { onLib(updateGroupActor(lib, group.id, a.id, { fit_id: e.target.value })); ensureDoc(e.target.value); }}>
                  <option value="">{t('(select fit)')}</option>
                  {fits.map((f) => <option key={f.id} value={f.id}>{ds.name(f.fit.ship.type_id)} · {f.name}</option>)}
                </select></label>
                <label>{t('Role')} <input style={{ width: 80 }} list="group-roles" value={a.role ?? ''} onChange={(e) => onLib(updateGroupActor(lib, group.id, a.id, { role: e.target.value || undefined }))} /></label>
                <button title={t('Open fit')} disabled={!a.fit_id} onClick={() => onOpenFit(a.fit_id)}>↗</button>
                <button className="danger" title={t('Remove actor')} onClick={() => onLib(removeGroupActor(lib, group.id, a.id))}>×</button>
              </div>
            ))}
            <datalist id="group-roles">{ROLES.map((r) => <option key={r} value={r} />)}</datalist>
          </div>

          <div className="section">
            <div className="row">
              <h4 style={{ flex: 1 }}>{t('Relations')} ({group.relations.length})</h4>
              <button className="group-rel-add" disabled={!group.actors.length}
                onClick={() => onLib(upsertGroupRelation(lib, group.id, { id: uid(), kind: 'project', source: group.actors[0].id, targets: [], enabled: true }))}>
                {t('Add relation')}
              </button>
            </div>
            {!group.relations.length && <p className="muted">{t('No relations — a lone actor group just batches its fits.')}</p>}
            {group.relations.map((r) => {
              const src = actorById.get(r.source);
              const items = r.kind === 'project' ? srcItems(ds, src ? lib.fits[src.fit_id] : null) : [];
              const patch = (p: Partial<GroupRelation>) => onLib(updateGroupRelation(lib, group.id, r.id, p));
              return (
                <div key={r.id} data-relation={r.id} style={{ borderTop: '1px solid var(--line)', padding: '3px 0' }}>
                  <div className="row">
                    <label>{t('Kind')} <select value={r.kind} onChange={(e) => patch({ kind: e.target.value as GroupRelation['kind'], source_item_ids: undefined })}>
                      {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select></label>
                    <label>{t('Source')} <select value={r.source} onChange={(e) => { patch({ source: e.target.value, source_item_ids: undefined }); ensureDoc(actorById.get(e.target.value)?.fit_id); }}>
                      {group.actors.map((a) => <option key={a.id} value={a.id}>{a.label || a.id.slice(0, 8)}</option>)}
                    </select></label>
                    <label style={{ flex: 1 }}>{t('Targets')} <select multiple size={Math.min(4, Math.max(2, group.actors.length))} value={r.targets}
                      onChange={(e) => patch({ targets: [...e.target.selectedOptions].map((o) => o.value) })}>
                      {group.actors.filter((a) => a.id !== r.source).map((a) => <option key={a.id} value={a.id}>{a.label || a.id.slice(0, 8)}</option>)}
                    </select></label>
                    <label>{t('On')} <input type="checkbox" checked={r.enabled !== false} onChange={(e) => patch({ enabled: e.target.checked })} /></label>
                    <button className="danger" title={t('Remove relation')} onClick={() => onLib(removeGroupRelation(lib, group.id, r.id))}>×</button>
                  </div>
                  <div className="row">
                    {r.kind === 'project' && (
                      <label style={{ flex: 1 }}>{t('Source items')} <select multiple size={Math.min(4, Math.max(2, items.length))} value={r.source_item_ids ?? []}
                        onChange={(e) => patch({ source_item_ids: [...e.target.selectedOptions].map((o) => o.value) })}>
                        {items.map((it) => <option key={it.id} value={it.id}>{it.label}</option>)}
                      </select></label>
                    )}
                    <label>{t('Amount')} <input type="number" style={{ width: 60 }} value={r.amount ?? ''} onChange={(e) => patch({ amount: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                    <label>{t('km')} <input type="number" style={{ width: 60 }} value={r.distance_m != null ? r.distance_m / 1000 : ''}
                      onChange={(e) => patch({ distance_m: e.target.value === '' ? undefined : Number(e.target.value) * 1000 })} /></label>
                    <label style={{ flex: 1 }}>{t('Notes')} <input value={r.notes ?? ''} onChange={(e) => patch({ notes: e.target.value || undefined })} /></label>
                  </div>
                </div>
              );
            })}
          </div>

          {run && (
            <div className="section group-result">
              <h4>{t('Group compute')} · {new Date(run.at).toLocaleTimeString()}</h4>
              {run.issues.map((s, i) => <div key={i} className="warnbox">⚠ {s}</div>)}
              {run.res && (
                <table className="table">
                  <thead><tr>
                    <th>{t('Actor')}</th>
                    {RESULT_METRICS.map((k) => <th key={k} className="num">{t(metric(k)?.label ?? k)}</th>)}
                  </tr></thead>
                  <tbody>
                    {(run.res.results ?? []).map((row) => {
                      const actor = group.actors.find((a) => a.id === row.id);
                      return (
                        <tr key={row.index}>
                          <td><span className="muted">{row.index}</span> {row.label || actor?.label || row.id || '—'}</td>
                          {row.error
                            ? <td colSpan={RESULT_METRICS.length} className="error">{row.error.code}: {row.error.message}</td>
                            : RESULT_METRICS.map((k) => <td key={k} className="num">{cell(row.stats, k)}</td>)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
