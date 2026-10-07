import { useEffect, useMemo, useState } from 'react';
import { t as tr } from '../i18n';
import type { Dataset, Kind } from '../data/dataset';
import type { Engine } from '../engine/adapter';
import { draggedType } from '../fit/model';
import { FloatMenu, TypeIcon } from './common';

const KIND_FILTERS: [string, Kind[] | null][] = [
  ['All', null], ['Ships', ['ship', 'structure']], ['Modules', ['module', 'subsystem']], ['Charges', ['charge']],
  ['Drones', ['drone']], ['Fighters', ['fighter']], ['Implants', ['implant']], ['Boosters', ['booster']],
];

function Node({ ds, id, onPick, onPreview, onInfo, depth, openIds, onToggle, locating, counts, candidateId, showSlot }: {
  ds: Dataset; id: number; onPick: (t: number) => void; onPreview: (t: number) => void; onInfo: (t: number) => void;
  depth: number; openIds: Set<number>; onToggle: (id: number) => void; locating: number | null; counts: Map<number, number>;
  candidateId: number | null; showSlot: boolean;
}) {
  const open = openIds.has(id);
  const kids = ds.mgChildren.get(id) ?? [];
  const types = ds.mgTypes.get(id) ?? [];
  return (
    <li>
      <div className="mg" style={{ paddingLeft: depth * 8 }} onClick={() => onToggle(id)}>
        <span className="mg-caret">{open ? '▾' : '▸'}</span><span className="mg-name">{ds.mgName(id)}</span><span className="mg-count">{counts.get(id) ?? 0}</span>
      </div>
      {open && (
        <ul>
          {kids.map((k) => <Node key={k} ds={ds} id={k} onPick={onPick} onPreview={onPreview} onInfo={onInfo} depth={depth + 1} openIds={openIds} onToggle={onToggle} locating={locating} counts={counts} candidateId={candidateId} showSlot={showSlot} />)}
          {types.map((t) => <TypeRowView key={t} ds={ds} id={t} onPick={onPick} onPreview={onPreview} onInfo={onInfo} depth={depth + 1} locating={locating} candidateId={candidateId} showSlot={showSlot} />)}
        </ul>
      )}
    </li>
  );
}

function metaBadge(ds: Dataset, id: number): { text: string; tone: string } | null {
  const type = ds.type(id);
  if (type?.meta_group === 1) return null;
  const groups: Record<number, [string, string]> = {
    2: ['T2', 't2'], 3: ['S', 'storyline'], 4: ['F', 'faction'], 5: ['O', 'officer'], 6: ['D', 'deadspace'],
  };
  const known = type?.meta_group == null ? null : groups[type.meta_group];
  if (known) return { text: known[0], tone: known[1] };
  const level = ds.metaLevel(id);
  return level > 0 ? { text: `M${level}`, tone: 'meta-level' } : null;
}

export function TypeRowView({ ds, id, onPick, onPreview, onInfo, depth = 0, locating, candidateId, showSlot = false }: {
  ds: Dataset; id: number; onPick: (t: number) => void; onPreview: (t: number) => void; onInfo: (t: number) => void;
  depth?: number; locating?: number | null; candidateId?: number | null; showSlot?: boolean;
}) {
  const slot = ds.slot(id);
  const badge = metaBadge(ds, id);
  const type = ds.type(id);
  const name = ds.name(id);
  const title = `${name} · ${ds.groupName(type?.group ?? 0)}`;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <li className={'trow' + (locating === id ? ' locating' : '') + (candidateId === id ? ' candidate' : '')} data-tid={id}
      style={{ paddingLeft: depth * 8 }} onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onPreview(id); }}
      onDoubleClick={() => onPick(id)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onPick(id); } }}
      title={tr('double-click or press Enter to apply; drag onto the fitting')}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      draggable onDragStart={(e) => { draggedType.id = id; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('application/x-exfa-type', String(id)); e.dataTransfer.setData('text/plain', `type:${id}`); }} onDragEnd={() => { draggedType.id = null; }}>
      <div className="trow-main" role="button" tabIndex={0} aria-label={title}>
        <TypeIcon id={id} size={32} />
        <span className="tname" title={title}>{name}</span>
        <span className={`meta${badge ? ` ${badge.tone}` : ' empty'}`}>{badge?.text ?? ''}</span>
        {showSlot && slot && <span className={`slot-badge slot-${slot}`}>{({ high: 'H', mid: 'M', low: 'L', rig: 'R', subsystem: 'S', service: 'S' })[slot]}</span>}
      </div>
      {menu && (
        <FloatMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <div className="ctxhead">{ds.name(id)}</div>
          <button onClick={() => { onInfo(id); setMenu(null); }}>{tr('Show info')}</button>
          <button onClick={() => { onPick(id); setMenu(null); }}>{tr('Apply pick')}</button>
        </FloatMenu>
      )}
      <button className="mini market-info" onClick={(e) => { e.stopPropagation(); onInfo(id); }} title={tr('Show info')}>i</button>
    </li>
  );
}

export function Market({ ds, engine, onPick, onPreview, onInfo, locate, candidateId }: {
  ds: Dataset; engine?: Engine | null; onPick: (t: number) => void; onPreview: (t: number) => void; onInfo: (t: number) => void;
  locate?: { id: number; n: number } | null; candidateId?: number | null;
}) {
  const [q, setQ] = useState('');
  const [kf, setKf] = useState(0);
  const [engineIds, setEngineIds] = useState<number[] | null>(null);
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [locating, setLocating] = useState<number | null>(null);
  const counts = useMemo(() => {
    const result = new Map<number, number>();
    const count = (id: number): number => {
      const value = (ds.mgTypes.get(id)?.length ?? 0) + (ds.mgChildren.get(id) ?? []).reduce((sum, child) => sum + count(child), 0);
      result.set(id, value);
      return value;
    };
    ds.mgRoots.forEach(count);
    return result;
  }, [ds]);
  const onToggle = (id: number) => setOpenIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // "Show in market": expand the tree to the type's market group and flash-highlight the row.
  useEffect(() => {
    if (!locate) return;
    const mg = ds.raw.market_groups ?? {};
    const chain: number[] = [];
    let g = ds.type(locate.id)?.market_group;
    while (g != null) { chain.push(g); g = mg[g]?.parent ?? null; }
    setQ('');
    setOpenIds((s) => new Set([...s, ...chain]));
    setLocating(locate.id);
    // Two frames so the newly expanded rows are in the DOM before scrolling.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelector(`.trow[data-tid="${locate.id}"]`)?.scrollIntoView({ block: 'center' });
      window.setTimeout(() => setLocating((x) => (x === locate.id ? null : x)), 2000);
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locate?.n]);
  // Pyfa-parity search: the engine's market.search does abbreviation shorthand (lse, 5mn mwd, dc ii) and re:
  // patterns; the local index stays as the fallback while the engine is off or busy.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2 || !engine?.rpcRaw) { setEngineIds(null); return; }
    let live = true;
    const h = setTimeout(() => {
      engine.rpcRaw!('market.search', { query, filter: 'everything' }).then((r) => {
        if (live) setEngineIds(r?.result?.type_ids ?? null);
      }).catch(() => { if (live) setEngineIds(null); });
    }, 150);
    return () => { live = false; clearTimeout(h); };
  }, [q, engine]);
  const kinds = KIND_FILTERS[kf][1] ?? undefined;
  const base = q.trim().length >= 2 ? (engineIds ?? ds.search(q, 80, KIND_FILTERS[kf][1] ?? undefined)) : [];
  const results = kinds ? base.filter((id) => kinds.includes(ds.kind(id))) : base.slice(0, 80);
  const showSlot = q.trim().length >= 2 || kf === 0;
  return (
    <div className="market">
      <input className="search" placeholder={tr('Search items (English / 中文)…')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">{KIND_FILTERS.map(([l], i) => <button key={l} className={i === kf ? 'on' : ''} onClick={() => setKf(i)}>{tr(l)}</button>)}</div>
      {q.trim().length >= 2 ? (
        <ul className="tree">{results.map((t) => <TypeRowView key={t} ds={ds} id={t} onPick={onPick} onPreview={onPreview} onInfo={onInfo} candidateId={candidateId} showSlot={showSlot} />)}
          {!results.length && <li className="muted">{tr('no matches')}</li>}</ul>
      ) : (
        <ul className="tree">{ds.mgRoots.map((r) => <Node key={r} ds={ds} id={r} onPick={onPick} onPreview={onPreview} onInfo={onInfo} depth={0} openIds={openIds} onToggle={onToggle} locating={locating} counts={counts} candidateId={candidateId ?? null} showSlot={showSlot} />)}</ul>
      )}
      <p className="hint">{tr('Single-click to preview; double-click or press Enter to apply. Drag onto the fitting to add.')}</p>
    </div>
  );
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '');

/** Where an info dialog was opened from: a fitted item gets its engine-computed ("fitted") attribute values. */
export type InfoCtx = { module?: number; drone?: number; ship?: boolean; charge?: boolean };

/** Curated attribute order for the quick-stats strip (only attrs the type actually has are shown). */
const QUICK_ATTRS = ['cpu', 'power', 'capacitorNeed', 'rateOfFire', 'duration', 'damageMultiplier', 'damage', 'optimalRange', 'falloff', 'trackingSpeed', 'missileVelocity', 'maxVelocity', 'optimalSigRadius', 'energyDestabilizationAmount', 'powerTransferAmount', 'shieldBonus', 'armorDamageAmount', 'mass', 'volume', 'capacity', 'signatureRadius', 'baseSensorStrength'];

export function ItemInfo({ ds, id, ctx, onClose, fitted, fittedNote, overrides, onOverride, onShow, onSwap }: {
  ds: Dataset; id: number; ctx?: InfoCtx; onClose: () => void; fitted?: Record<string, number> | null; fittedNote?: string;
  /** attribute id -> overridden base value for this type in the active fit; onOverride(attr, null) removes it */
  overrides?: Record<number, number>; onOverride?: (attr: number, value: number | null) => void;
  /** switch the pane to another type; swap the fitted module for another variation */
  onShow?: (id: number) => void; onSwap?: (id: number) => void;
}) {
  const [editOv, setEditOv] = useState(false);
  const t = ds.type(id);
  const [all, setAll] = useState(false);
  if (!t) return null;
  const traits = ds.raw.traits?.[id];
  const req = ds.raw.required_skills?.[id] ?? [];
  const vars = ds.variations(id);
  const quick = QUICK_ATTRS.map((n) => {
    const aid = ds.attrId(n);
    const v = aid != null ? t.attrs[aid] : undefined;
    const info = aid != null ? ds.raw.attributes[aid] : undefined;
    return v == null ? null : { n, v, info };
  }).filter(Boolean) as { n: string; v: number; info?: { display?: string; name?: string; unit?: number | null } }[];
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
    <div className="infopane">
      <h2 className="infohead"><TypeIcon id={id} size={40} render={ds.kind(id) === 'ship' || ds.kind(id) === 'structure'} /> {ds.name(id)} <small className="muted">#{id} · {ds.groupName(t.group)}</small>
        <button className="mini infoclose" title={tr('Close')} onClick={onClose}>✕</button></h2>
      {quick.length > 0 && (
        <div className="qstats">{quick.map((x) => (
          <span key={x.n}><b>{x.info?.display || x.info?.name || x.n}</b> {+x.v.toFixed(3)}{x.info?.unit != null ? ' ' + unit(x.info.unit) : ''}</span>
        ))}</div>
      )}
      {vars.length > 1 && (
        <div className="varrow">
          <span className="ctxlabel">{tr('Variations')}:</span>
          {vars.map((v) => (
            <span key={v} className="vchipwrap">
              <button className={'vchip' + (v === id ? ' on' : '')} onClick={() => onShow?.(v)}>{ds.name(v)}</button>
              {onSwap && ctx?.module != null && v !== id && <button className="vswap" title={tr('Swap fitted module')} onClick={() => onSwap(v)}>{tr('Swap')}</button>}
            </span>
          ))}
        </div>
      )}
      {ds.description(id) && <p className="desc">{stripTags(ds.description(id)!)}</p>}
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
    </div>
  );
}
