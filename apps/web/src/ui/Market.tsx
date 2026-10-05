import { useMemo, useState } from 'react';
import { t as tr } from '../i18n';
import type { Dataset, Kind } from '../data/dataset';

const KIND_FILTERS: [string, Kind[] | null][] = [
  ['All', null], ['Ships', ['ship', 'structure']], ['Modules', ['module', 'subsystem']], ['Charges', ['charge']],
  ['Drones', ['drone']], ['Fighters', ['fighter']], ['Implants', ['implant']], ['Boosters', ['booster']],
];

function Node({ ds, id, onPick, onInfo, depth }: { ds: Dataset; id: number; onPick: (t: number) => void; onInfo: (t: number) => void; depth: number }) {
  const [open, setOpen] = useState(false);
  const kids = ds.mgChildren.get(id) ?? [];
  const types = ds.mgTypes.get(id) ?? [];
  return (
    <li>
      <div className="mg" style={{ paddingLeft: depth * 12 }} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} {ds.mgName(id)}</div>
      {open && (
        <ul>
          {kids.map((k) => <Node key={k} ds={ds} id={k} onPick={onPick} onInfo={onInfo} depth={depth + 1} />)}
          {types.map((t) => <TypeRowView key={t} ds={ds} id={t} onPick={onPick} onInfo={onInfo} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

export function TypeRowView({ ds, id, onPick, onInfo, depth = 0 }: { ds: Dataset; id: number; onPick: (t: number) => void; onInfo: (t: number) => void; depth?: number }) {
  const slot = ds.slot(id);
  const ml = ds.type(id)?.meta_level;
  return (
    <li className="trow" style={{ paddingLeft: depth * 12 + 10 }} onDoubleClick={() => onPick(id)} title={tr('double-click to add')}>
      <span className={'kind k-' + ds.kind(id)}>{tr(slot ?? ds.kind(id))}</span>
      <span className="tname" onClick={() => onPick(id)}>{ds.name(id)}</span>
      {ml ? <span className="meta">M{ml}</span> : null}
      <button className="mini" onClick={(e) => { e.stopPropagation(); onInfo(id); }} title={tr('Show info')}>i</button>
    </li>
  );
}

export function Market({ ds, onPick, onInfo }: { ds: Dataset; onPick: (t: number) => void; onInfo: (t: number) => void }) {
  const [q, setQ] = useState('');
  const [kf, setKf] = useState(0);
  const results = useMemo(() => (q.trim().length >= 2 ? ds.search(q, 80, KIND_FILTERS[kf][1] ?? undefined) : []), [ds, q, kf]);
  return (
    <div className="market">
      <input className="search" placeholder={tr('Search items (English / 中文)…')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">{KIND_FILTERS.map(([l], i) => <button key={l} className={i === kf ? 'on' : ''} onClick={() => setKf(i)}>{tr(l)}</button>)}</div>
      {q.trim().length >= 2 ? (
        <ul className="tree">{results.map((t) => <TypeRowView key={t} ds={ds} id={t} onPick={onPick} onInfo={onInfo} />)}
          {!results.length && <li className="muted">{tr('no matches')}</li>}</ul>
      ) : (
        <ul className="tree">{ds.mgRoots.map((r) => <Node key={r} ds={ds} id={r} onPick={onPick} onInfo={onInfo} depth={0} />)}</ul>
      )}
      <p className="hint">{tr('Click an item to add it to the active fit (or to the projected list when “add to projected” is on). Ships create a new fit.')}</p>
    </div>
  );
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '');

/** Where an info dialog was opened from: a fitted item gets its engine-computed ("fitted") attribute values. */
export type InfoCtx = { module?: number; drone?: number; ship?: boolean; charge?: boolean };

export function ItemInfo({ ds, id, onClose, fitted, fittedNote, overrides, onOverride }: {
  ds: Dataset; id: number; onClose: () => void; fitted?: Record<string, number> | null; fittedNote?: string;
  /** attribute id -> overridden base value for this type in the active fit; onOverride(attr, null) removes it */
  overrides?: Record<number, number>; onOverride?: (attr: number, value: number | null) => void;
}) {
  const [editOv, setEditOv] = useState(false);
  const t = ds.type(id);
  const [all, setAll] = useState(false);
  if (!t) return null;
  const traits = ds.raw.traits?.[id];
  const req = ds.raw.required_skills?.[id] ?? [];
  const fittedById = new Map<number, number>();
  for (const [k, v] of Object.entries(fitted ?? {})) { const aid = /^\d+$/.test(k) ? +k : ds.attrId(k); if (aid != null && typeof v === 'number') fittedById.set(aid, v); }
  const ids = new Set([...Object.keys(t.attrs).map(Number), ...fittedById.keys()]);
  const attrs = [...ids]
    .map((a) => ({ a, v: t.attrs[a] as number | undefined, f: fittedById.get(a), info: ds.raw.attributes[a] }))
    .filter((x) => all || x.info?.published)
    .sort((x, y) => (x.info?.display ?? x.info?.name ?? '').localeCompare(y.info?.display ?? y.info?.name ?? ''));
  const unit = (u?: number | null) => (u != null ? ds.raw.units?.[u]?.display ?? '' : '');
  const zh = ds.lang === 'zh';
  const bonus = (b: { bonus: number | null; text: string; text_zh?: string; unit?: number | null }) =>
    `${b.bonus != null ? b.bonus + unit(b.unit) + ' ' : ''}${stripTags(zh && b.text_zh ? b.text_zh : b.text)}`;
  return (
    <div className="modal" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{ds.name(id)} <small className="muted">#{id} · {ds.groupName(t.group)}</small></h2>
        {traits && (
          <div className="traits">
            {Object.entries(traits.skills ?? {}).map(([sk, bs]) => (
              <div key={sk}><b>{ds.name(+sk)} {tr('bonuses (per level):')}</b><ul>{bs.map((b, i) => <li key={i}>{bonus(b)}</li>)}</ul></div>
            ))}
            {traits.role?.length ? <div><b>{tr('Role bonus:')}</b><ul>{traits.role.map((b, i) => <li key={i}>{bonus(b)}</li>)}</ul></div> : null}
            {traits.misc?.length ? <div><b>{tr('Misc:')}</b><ul>{traits.misc.map((b, i) => <li key={i}>{bonus(b)}</li>)}</ul></div> : null}
          </div>
        )}
        {req.length > 0 && <p><b>{tr('Required skills:')}</b> {req.map(([s, l]) => `${ds.name(s)} ${l}`).join(', ')}</p>}
        <label><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {tr('show unpublished attributes')}</label>
        {onOverride && <label> <input type="checkbox" className="editov" checked={editOv} onChange={(e) => setEditOv(e.target.checked)} /> {tr('edit attribute overrides (this fit)')}{overrides && Object.keys(overrides).length ? ` · ${Object.keys(overrides).length} ${tr('active')}` : ''}</label>}
        {fitted !== undefined && <p className="muted">{fitted ? tr('Fitted values computed by the engine (changed values highlighted).') : fittedNote ?? tr('computing fitted values…')}</p>}
        <table className="attrs">
          {(fitted || editOv) && <thead><tr><th>{tr('attribute')}</th><th className="num">{tr('base')}</th>{fitted && <th className="num">{tr('fitted')}</th>}{editOv && <th>{tr('override')}</th>}</tr></thead>}
          <tbody>
          {attrs.map((x) => {
            const fmt = (v: number | undefined) => (v == null ? '—' : `${+v.toFixed(4)} ${unit(x.info?.unit)}`);
            const changed = fitted && x.f != null && (x.v == null || Math.abs(x.f - x.v) > 1e-9 * Math.max(1, Math.abs(x.v)));
            const ov = overrides?.[x.a];
            return <tr key={x.a} data-attr={x.a} data-name={x.info?.name ?? ''} data-base={x.v ?? ''} data-fitted={x.f ?? ''} className={(changed ? 'changed' : '') + (ov != null ? ' overridden' : '')}><td>{x.info?.display || x.info?.name || x.a}</td><td className="num">{fmt(x.v)}{ov != null && !editOv ? ` → ${+ov.toFixed(4)}` : ''}</td>{fitted && <td className="num">{fmt(x.f)}</td>}
              {editOv && <td><input className="qty wide ovin" data-attr={x.a} type="number" value={ov ?? ''} placeholder="—" onChange={(e) => onOverride!(x.a, e.target.value === '' ? null : +e.target.value)} /></td>}</tr>;
          })}
        </tbody></table>
        <button onClick={onClose}>{tr('Close')}</button>
      </div>
    </div>
  );
}
