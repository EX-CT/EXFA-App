// Fit price from the engine's `price` block (EXFA-Docs docs/23): per item unit/total ISK with its source (my prices =
// request override, injected snapshot, embedded snapshot), missing items and provenance. The site computes nothing:
// it sends "my prices" as price_overrides and optionally injects the latest EXFA-Data snapshot.
import { useState } from 'react';
import type { Dataset } from '../data/dataset';
import type { FitStats } from '../engine/adapter';
import { overrideProblem, overrideTarget, setTypePrice, SNAPSHOT_RELEASES, TARGETS, type OverrideTarget, type PriceOverride, type PriceSettings, type Snapshot } from '../data/prices';
import { Section } from './common';
import { t } from '../i18n';

export const isk = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}b` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}m` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(0)) + ' ISK';
const SECTION_LABEL: Record<string, string> = { ship: 'Ship', modules: 'Fittings', charges: 'Charges', drones: 'Drones', fighters: 'Fighters', implants: 'Implants', boosters: 'Boosters', cargo: 'Cargo' };
const SOURCE_LABEL: Record<string, string> = { override: 'my price', request: 'my price', injected: 'updated snapshot', file: 'updated snapshot', snapshot: 'embedded snapshot' };
/** engine price sources: snapshot | injected | request | override:<type|market_group|group|category> */
const sourceLabel = (s: string) => t(SOURCE_LABEL[s.split(':')[0]] ?? s);
const TARGET_LABEL: Record<OverrideTarget, string> = { type_id: 'Type', market_group_id: 'Market group', group_id: 'Group', category_id: 'Category' };
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { hour12: false, timeZoneName: 'short' }) : '—');

export type SnapshotState = { state: 'off' } | { state: 'loading' } | { state: 'loaded'; snap: Snapshot; at?: number; err?: string } | { state: 'error'; error: string };

interface Line { kind: string; index: number; type_id: number; name: string | null; quantity: number; unit_isk: number; total_isk: number; source: string; layer: string; multiplier?: number }

export function PriceBox({ ds, st, backend, settings, onSettings, snapshot }: {
  ds: Dataset; st: FitStats | null; backend: string; settings: PriceSettings; onSettings: (s: PriceSettings) => void; snapshot: SnapshotState;
}) {
  const price = st?.price;
  const prov = st?.provenance;
  const mineType = new Map(settings.mine.filter((o) => o.type_id != null && o.price != null).map((o) => [o.type_id!, o.price!]));
  const lines: Line[] = price ? Object.values(price.sections ?? {}).flatMap((s: any) => s.items ?? []) : [];
  return (
    <Section title={t('Price')} right={price ? <b className="pricetotal">{isk(price.total_isk)}</b> : null}>
      {!price ? <p className="muted small price-unsupported">{t('Prices are computed by the engine; this backend has no price block')} (<code>{backend}</code>). {t('Use the default backend (wasm-worker).')}</p> : <>
        <div className="kv price-sections">{Object.entries(price.sections ?? {}).filter(([, s]: [string, any]) => s.total_isk > 0).map(([k, s]: [string, any]) => <span key={k} data-section={k}>{t(SECTION_LABEL[k] ?? k)} {isk(s.total_isk)}</span>)}</div>
        <details className="price-items">
          <summary>{t('Items')} ({lines.length}){price.complete ? '' : ` · ${t('missing')} ${price.missing.length}`}</summary>
          <table className="grid small"><tbody>{lines.map((l) => (
            <tr key={`${l.kind}-${l.index}`} data-type={l.type_id} data-source={l.source}>
              <td>{l.name ?? ds.name(l.type_id)}{l.quantity > 1 ? ` ×${l.quantity}` : ''}</td>
              <td className="num">{isk(l.total_isk)}</td>
              <td className="muted" title={`${t('layer')} ${l.layer}${l.multiplier != null && l.multiplier !== 1 ? ` ×${l.multiplier}` : ''}`}>{sourceLabel(l.source)}</td>
              <td>{mineType.has(l.type_id)
                ? <button className="mini mine-remove" title={t('remove my price')} onClick={() => onSettings(setTypePrice(settings, l.type_id, null))}>×</button>
                : <button className="mini self-made" title={t('self-produced: price 0')} onClick={() => onSettings(setTypePrice(settings, l.type_id, 0))}>0</button>}</td>
            </tr>))}</tbody></table>
          {!price.complete && <ul className="price-missing small">{price.missing.map((m: any) => <li key={`${m.kind}-${m.index}`} data-type={m.type_id}>{m.name ?? ds.name(m.type_id)}: {t('no price')} ({m.reason})</li>)}</ul>}
        </details>
      </>}
      <label className="small"><input type="checkbox" className="price-update" checked={settings.update} onChange={(e) => onSettings({ ...settings, update: e.target.checked })} /> {t('Update prices (latest EXFA-Data snapshot)')}</label>
      <span className="muted small price-snapshot" data-state={snapshot.state}>{' '}
        {snapshot.state === 'loading' ? t('loading…') : snapshot.state === 'error' ? <span className="error">{snapshot.error}</span>
          : snapshot.state === 'loaded' ? <>{snapshot.snap.id} · {snapshot.snap.types} {t('types')} · {when(snapshot.snap.market_time)}{snapshot.at ? ` · ${t('checked')} ${new Date(snapshot.at).toLocaleTimeString(undefined, { hour12: false })}` : ''} · {t('auto hourly')}{snapshot.err ? <span className="error"> · {snapshot.err}</span> : null}</> : null}
        {' '}<a href={SNAPSHOT_RELEASES}>{t('releases')}</a></span>
      {prov && <div className="muted small price-prov" data-source={prov.price_source ?? ''}>
        {t('Price source')}: {prov.price_source ? sourceLabel(prov.price_source) : '—'}{prov.price_snapshot_id ? ` · ${prov.price_snapshot_id}` : ''} · {when(prov.snapshot_time)}
        {' · SDE '}{prov.sde_build}{prov.sde_revision ? ` r${prov.sde_revision}` : ''}{prov.sde_source ? ` (${prov.sde_source})` : ''}</div>}
      <MyPrices ds={ds} settings={settings} onSettings={onSettings} />
    </Section>
  );
}

/** Local "my prices": docs/23 price overrides kept in localStorage, sent with every calc. */
function MyPrices({ ds, settings, onSettings }: { ds: Dataset; settings: PriceSettings; onSettings: (s: PriceSettings) => void }) {
  const [draft, setDraft] = useState<{ target: OverrideTarget; id: string; mode: 'price' | 'multiplier'; value: string }>({ target: 'type_id', id: '', mode: 'price', value: '0' });
  const cand: PriceOverride = { [draft.target]: Number(draft.id), [draft.mode]: Number(draft.value) } as PriceOverride;
  const problem = draft.id === '' ? null : overrideProblem(cand);
  const add = () => { if (!overrideProblem(cand)) { onSettings({ ...settings, mine: [...settings.mine.filter((o) => !(overrideTarget(o) === draft.target && o[draft.target] === cand[draft.target])), cand] }); setDraft({ ...draft, id: '' }); } };
  return (
    <details className="my-prices">
      <summary>{t('My prices')} ({settings.mine.length})</summary>
      <table className="grid small"><tbody>{settings.mine.map((o, i) => {
        const tg = overrideTarget(o)!;
        return (
          <tr key={i} data-target={tg} data-id={o[tg]}>
            <td>{t(TARGET_LABEL[tg])} {o[tg]}{tg === 'type_id' ? ` · ${ds.name(o[tg]!)}` : ''}</td>
            <td className="num">{o.price != null ? isk(o.price) : `×${o.multiplier}`}</td>
            <td><button className="mini mine-delete" onClick={() => onSettings({ ...settings, mine: settings.mine.filter((_, j) => j !== i) })}>×</button></td>
          </tr>);
      })}</tbody></table>
      <div className="row small my-prices-add">
        <select className="mp-target" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value as OverrideTarget })}>{TARGETS.map((k) => <option key={k} value={k}>{t(TARGET_LABEL[k])}</option>)}</select>
        <input className="mp-id" type="number" min={1} placeholder="id" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} style={{ width: '6em' }} />
        <select className="mp-mode" value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as 'price' | 'multiplier' })}><option value="price">{t('fixed ISK')}</option><option value="multiplier">{t('multiplier')}</option></select>
        <input className="mp-value" type="number" min={0} step="any" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} style={{ width: '7em' }} />
        <button className="mini mp-add" disabled={draft.id === '' || !!problem} onClick={add}>{t('add')}</button>
      </div>
      {problem && <p className="error small">{t(problem)}</p>}
      <p className="hint">{t('Stored in this browser only. Most specific wins: type > market group > group > category; a multiplier scales the market price.')}</p>
    </details>
  );
}
