import { useEffect, useMemo, useState } from 'react';
import type { Dataset } from '../data/dataset';
import type { PriceOverride } from '../data/prices';
import type { Engine, FitStats } from '../engine/adapter';
import { metric } from '../fit/metrics';
import { applyAlternativeOption, applyMarketPick, requestFor, type FitDoc, type Library, type MarketMode, type MarketSelection } from '../fit/model';
import { applyEdits, characterScenarios, chargeScenarios, offlineScenarios, variationScenarios } from '../fit/whatif';
import { t } from '../i18n';
import { fmt, Tabs, TypeIcon } from './common';
import { VIOLATION_LABEL } from './Stats';

export type StripTab = 'variations' | 'charges' | 'offline' | 'characters' | 'alternatives';
type Category = 'propulsion' | 'weapons' | 'tank' | 'ewar' | 'capacitor' | 'general';
interface StripScenario { id: string; name: string; fit: FitDoc; typeId: number }
interface CalcTarget { id: string; key: string; request: Record<string, unknown> }
interface CalcJob {
  key: string; engine: Engine; request: Record<string, unknown>;
  resolve: (stats: FitStats | null) => void; started: boolean; cancelled: boolean;
}

const METRIC_GROUP: Record<Category, string[]> = {
  propulsion: ['speed', 'align', 'sig', 'cap_delta'],
  weapons: ['dps', 'weapon_range', 'tracking'],
  tank: ['ehp', 'active_tank', 'speed', 'sig'],
  ewar: ['cap_delta', 'module_range', 'speed'],
  capacitor: ['cap_delta', 'cap_stable', 'cap_time'],
  general: ['dps', 'ehp', 'tank', 'cap_delta', 'speed', 'align'],
};
const calcCache = new Map<string, FitStats | null>();
const calcQueue: CalcJob[] = [];
let activeCalcs = 0;

function drainCalcs() {
  while (activeCalcs < 3 && calcQueue.length) {
    const job = calcQueue.shift()!;
    if (job.cancelled) continue;
    if (calcCache.has(job.key)) { job.resolve(calcCache.get(job.key) ?? null); continue; }
    job.started = true;
    activeCalcs++;
    void job.engine.calc(job.request).catch(() => null).then((stats) => {
      calcCache.set(job.key, stats);
      job.resolve(stats);
    }).finally(() => { activeCalcs--; drainCalcs(); });
  }
}

function scheduleCalc(engine: Engine, request: Record<string, unknown>): { promise: Promise<FitStats | null>; cancel: () => void } {
  const key = JSON.stringify(request);
  if (calcCache.has(key)) return { promise: Promise.resolve(calcCache.get(key) ?? null), cancel: () => {} };
  let resolve!: (stats: FitStats | null) => void;
  const promise = new Promise<FitStats | null>((r) => { resolve = r; });
  const job: CalcJob = { key, engine, request, resolve, started: false, cancelled: false };
  calcQueue.push(job);
  drainCalcs();
  return {
    promise,
    cancel: () => {
      if (job.started || job.cancelled) return;
      job.cancelled = true;
      job.resolve(null);
    },
  };
}

function category(ds: Dataset, id: number | null): Category | null {
  if (id == null) return null;
  const type = ds.type(id);
  const text = `${ds.name(id, 'en')} ${ds.raw.groups[type?.group ?? 0]?.name ?? ''}`.toLowerCase();
  if (/afterburn|microwarp|micro jump|propulsion/.test(text)) return 'propulsion';
  if (/autocannon|artillery|projectile turret|beam laser|pulse laser|hybrid turret|railgun|blaster|missile launcher|rocket launcher|torpedo launcher/.test(text)
    || ds.hasEffect(id, 'projectileWeapon') || ds.hasEffect(id, 'missileLauncher') || ds.hasEffect(id, 'energyWeapon') || ds.hasEffect(id, 'hybridWeapon')) return 'weapons';
  if (/shield|armor|hull|damage control|tank/.test(text)) return 'tank';
  if (/webifier|warp scrambler|warp disrupt|neutralizer|nosferatu|sensor damp|tracking disrupt|target painter|ecm|tackle|electronic warfare/.test(text)) return 'ewar';
  if (/capacitor|cap battery|cap booster|energy transfer/.test(text)) return 'capacitor';
  if (ds.attr(id, 'maxVelocity') != null && (ds.attr(id, 'speedFactor') != null || ds.attr(id, 'warpScrambleStatus') != null)) return 'propulsion';
  if (ds.attr(id, 'damageMultiplier') != null || ds.attr(id, 'weaponRange') != null) return 'weapons';
  return 'general';
}

function selectedType(fit: FitDoc, sel: MarketSelection): number | null {
  if (!sel) return null;
  if (sel.list === 'modules') return fit.fit.modules[sel.index]?.type_id ?? null;
  if (sel.list === 'drones') return fit.fit.drones[sel.index]?.type_id ?? null;
  if (sel.list === 'fighters') return fit.fit.fighters[sel.index]?.type_id ?? null;
  return fit.fit.cargo[sel.index]?.type_id ?? null;
}

function warningText(reason: string): string {
  const messages: Record<string, string> = {
    'select-same-slot': 'Select a same-slot module first.',
    'slot-mismatch': 'Slot mismatch; this module cannot replace the selection.',
    'cannot-fit': 'This item cannot be added to the fit.',
  };
  return t(messages[reason] ?? reason);
}

function violationIdentity(v: any): string { return JSON.stringify([v?.code ?? '', v?.path ?? '']); }
function newViolations(stats: FitStats | null, base: FitStats | null): any[] {
  const prior = new Set((base?.violations ?? []).map(violationIdentity));
  return (stats?.violations ?? []).filter((v: any) => !prior.has(violationIdentity(v)));
}
function warningIdentity(w: any): string {
  return typeof w === 'string' ? w : JSON.stringify([w?.code ?? '', w?.path ?? '', w?.message ?? '']);
}
function newMissingSkills(stats: FitStats | null, base: FitStats | null): any[] {
  const prior = new Set((base?.warnings ?? []).map(warningIdentity));
  return (stats?.warnings ?? []).filter((w: any) => {
    const code = typeof w === 'string' ? w : w?.code ?? '';
    return /MISSING_SKILL/i.test(code) && !prior.has(warningIdentity(w));
  });
}
function violationTitle(items: any[]): string {
  return items.map((v) => `${t(VIOLATION_LABEL[v.code] ?? v.code)}${v.path ? ` · ${v.path}` : ''}`).join('\n');
}
function missingSkillTitle(items: any[]): string {
  return items.map((w) => {
    const path = typeof w === 'string' ? '' : w?.path ?? '';
    return `${t('Missing skill')}${path ? ` · ${path}` : ''}`;
  }).join('\n');
}

function valueTone(delta: number | null, better: 'high' | 'low' | null): string {
  if (delta == null || better == null) return '';
  if (delta === 0) return 'flat';
  return ((delta > 0) === (better === 'high')) ? 'up' : 'down';
}
function metricText(stats: FitStats | null, base: FitStats | null, key: string, moduleIndex?: number | null): { text: string; tone: string } {
  const m = metric(key);
  if (!m || !stats || stats.error) return { text: '—', tone: '' };
  const current = m.get(stats, moduleIndex);
  if (current == null) return { text: '—', tone: '' };
  const baseline = base && !base.error ? m.get(base, moduleIndex) : null;
  if (baseline == null) return { text: fmt(current, m.digits), tone: '' };
  const delta = current - baseline;
  const text = `${fmt(current, m.digits)} (${delta > 0 ? '+' : ''}${fmt(delta, m.digits)})`;
  return { text, tone: valueTone(delta, m.better) };
}

export function CompareStrip({ ds, fit, lib, engine, stats, sel, candidateId, mode, pins, priceOverrides, tab, onTab, onTogglePin, onMarketApply, onApplyFit, onAddAlternative }: {
  ds: Dataset; fit: FitDoc | null; lib: Library; engine: Engine | null; stats: FitStats | null;
  sel: MarketSelection; candidateId: number | null; mode: MarketMode; pins: Record<string, string[]>; priceOverrides: PriceOverride[];
  tab: StripTab; onTab: (tab: StripTab) => void;
  onTogglePin: (category: string, key: string) => void; onMarketApply: (id: number) => void; onApplyFit: (fit: FitDoc, label: string) => void;
  /** Adds the row's type to the selected item's Alternative (spec: "+ 可替代"). */
  onAddAlternative?: (typeId: number) => void;
}) {
  const selectedId = fit ? selectedType(fit, sel) : null;
  const currentCategory = category(ds, selectedId);
  const candidateCategory = category(ds, candidateId);
  const selectedModuleIndex = sel?.list === 'modules' ? sel.index : null;
  const pinCategory = currentCategory ?? candidateCategory ?? 'general';
  const differentCategories = !!currentCategory && !!candidateCategory && currentCategory !== candidateCategory;
  const rawMetricKeys = differentCategories
    ? [...METRIC_GROUP[currentCategory!], ...METRIC_GROUP[candidateCategory!]]
    : METRIC_GROUP[pinCategory];
  const uniqueKeys = [...new Set(rawMetricKeys)];
  const candidatePins = candidateCategory && candidateCategory !== currentCategory
    ? (pins[candidateCategory] ?? []).filter((key) => !currentCategory || !METRIC_GROUP[currentCategory].includes(key))
    : [];
  const pinned = [...new Set([...(pins[currentCategory ?? pinCategory] ?? []), ...candidatePins])];
  const metricCategory = (key: string) => currentCategory && METRIC_GROUP[currentCategory].includes(key)
    ? currentCategory
    : candidateCategory && METRIC_GROUP[candidateCategory].includes(key) ? candidateCategory : pinCategory;
  const categoryMetrics = [...pinned.filter((key) => uniqueKeys.includes(key)), ...uniqueKeys.filter((key) => !pinned.includes(key))]
    .slice(0, differentCategories ? 6 : 4);
  const candidate = useMemo(() => {
    if (!fit || candidateId == null) return null;
    return applyMarketPick(ds, fit, sel, candidateId, mode);
  }, [ds, fit, sel, candidateId, mode]);
  let candidateModuleIndex = selectedModuleIndex;
  if (candidate && candidateId != null && (candidateModuleIndex == null || candidate.note?.kind === 'added')) {
    for (let index = candidate.fit.fit.modules.length - 1; index >= 0; index--) {
      if (candidate.fit.fit.modules[index].type_id === candidateId) { candidateModuleIndex = index; break; }
    }
  }
  const scenarios = useMemo<StripScenario[]>(() => {
    if (!fit) return [];
    const out: StripScenario[] = [];
    if (tab === 'variations' && sel?.list === 'modules') {
      const variants = variationScenarios(ds, fit, sel.index).sort((a, b) => {
        const aId = a.edits.find((edit) => edit.op === 'replace')?.type_id ?? 0;
        const bId = b.edits.find((edit) => edit.op === 'replace')?.type_id ?? 0;
        return ds.metaLevel(aId) - ds.metaLevel(bId) || ds.name(aId).localeCompare(ds.name(bId));
      });
      for (const s of variants) {
        const next = applyEdits(ds, fit, s.edits);
        out.push({ id: s.id, name: s.label, fit: next, typeId: next.fit.modules[sel.index]?.type_id ?? selectedId ?? fit.fit.ship.type_id });
      }
    } else if (tab === 'variations' && (sel?.list === 'drones' || sel?.list === 'fighters') && selectedId != null) {
      const variants = ds.variations(selectedId).filter((v) => v !== selectedId)
        .sort((a, b) => ds.metaLevel(a) - ds.metaLevel(b) || ds.name(a).localeCompare(ds.name(b)));
      for (const id of variants) {
        const result = applyMarketPick(ds, fit, sel, id, 'replace');
        if (result.note?.kind !== 'warning') out.push({ id: `var-${sel.list}-${sel.index}-${id}`, name: ds.name(id), fit: result.fit, typeId: id });
      }
    } else if (tab === 'charges' && sel?.list === 'modules') {
      for (const s of chargeScenarios(ds, fit, sel.index)) out.push({ id: s.id, name: s.label, fit: applyEdits(ds, fit, s.edits), typeId: fit.fit.modules[sel.index]?.type_id ?? fit.fit.ship.type_id });
    } else if (tab === 'offline') {
      for (const s of offlineScenarios(ds, fit)) out.push({ id: s.id, name: s.label, fit: applyEdits(ds, fit, s.edits), typeId: fit.fit.modules[Number(s.id.slice(4))]?.type_id ?? fit.fit.ship.type_id });
    } else if (tab === 'alternatives' && sel && sel.list !== 'fighters') {
      const item = sel.list === 'modules' ? fit.fit.modules[sel.index] : sel.list === 'drones' ? fit.fit.drones[sel.index] : fit.fit.cargo[sel.index];
      const alt = item?.alt_id ? fit.alternatives.find((a) => a.id === item.alt_id) : null;
      alt?.options.forEach((opt, i) => {
        const charge = opt.charge_type_id ? ` + ${ds.name(opt.charge_type_id)}` : '';
        out.push({ id: `alt-${alt.id}-${i}`, name: `${ds.name(opt.type_id)}${charge}${opt.quantity != null ? ` ×${opt.quantity}` : ''}`, fit: applyAlternativeOption(fit, alt.id, i), typeId: opt.type_id });
      });
    } else if (tab === 'characters') {
      for (const s of characterScenarios(Object.values(lib.characters), fit)) out.push({ id: s.id, name: s.label, fit: applyEdits(ds, fit, s.edits), typeId: fit.fit.ship.type_id });
    }
    return out.slice(0, 60);
  }, [ds, fit, lib.characters, sel, selectedId, tab]);
  const targets = useMemo<CalcTarget[]>(() => {
    const list: { id: string; fit: FitDoc }[] = [];
    if (candidate?.note?.kind !== 'warning' && candidateId != null && candidate) list.push({ id: 'candidate', fit: candidate.fit });
    for (const s of scenarios) list.push({ id: s.id, fit: s.fit });
    return list.map(({ id, fit: rowFit }) => {
      const raw = requestFor(lib, rowFit);
      const request = { ...raw, options: { ...(raw.options as object), price: true }, ...(priceOverrides.length ? { price_overrides: priceOverrides } : {}) };
      return { id, request, key: JSON.stringify(request) };
    });
  }, [candidate, candidateId, scenarios, lib, priceOverrides]);
  const calcKey = JSON.stringify([sel, candidateId, targets.map(({ id, key }) => [id, key])]);
  const [calculated, setCalculated] = useState<{ key: string; stats: Record<string, FitStats | null> } | null>(null);
  useEffect(() => {
    if (!engine || !targets.length) { setCalculated({ key: calcKey, stats: {} }); return; }
    let alive = true;
    const jobs: { cancel: () => void }[] = [];
    const timer = window.setTimeout(() => {
      const unique = [...new Map(targets.map((target) => [target.key, target.request])).entries()];
      const promises = unique.map(([key, request]) => {
        const job = scheduleCalc(engine, request);
        jobs.push(job);
        return job.promise.then((result) => [key, result] as const);
      });
      Promise.all(promises).then((results) => {
        const byRequest = Object.fromEntries(results);
        if (alive) setCalculated({ key: calcKey, stats: Object.fromEntries(targets.map((target) => [target.id, byRequest[target.key] ?? null])) });
      });
    }, 150);
    return () => { alive = false; window.clearTimeout(timer); jobs.forEach((job) => job.cancel()); };
  }, [calcKey, engine]);
  const activeStats = calculated?.key === calcKey ? calculated.stats : {};
  const baseline = stats && !stats.error ? stats : null;
  const candidateStats = activeStats.candidate ?? null;
  const candidateWarnings = candidate?.note?.kind === 'warning' ? warningText(candidate.note.reason) : candidateStats?.error?.message ?? '';
  const baselineIcon = fit?.fit.ship.type_id ?? candidateId ?? 587;
  const fixedKeys = ['cpu_left', 'pg_left', 'cap_delta'];
  const metricKeys = [...fixedKeys, ...categoryMetrics, 'price'];
  const shownMetrics = [...new Set(metricKeys)].map((key) => metric(key)).filter((m) => m != null);
  const rowStatus = (rowStats: FitStats | null): { className: string; title: string } => {
    const violations = newViolations(rowStats, baseline);
    if (violations.length) return { className: 'strip-bad', title: violationTitle(violations) };
    const skills = newMissingSkills(rowStats, baseline);
    if (skills.length) return { className: 'strip-warn', title: missingSkillTitle(skills) };
    return { className: '', title: '' };
  };
  const metricModuleIndex = (key: string, row: 'baseline' | 'candidate' | 'variant') => {
    const scope: Category | null = key === 'weapon_range' || key === 'tracking' ? 'weapons' : key === 'module_range' ? 'ewar' : null;
    if (!scope) return undefined;
    if (row === 'candidate' && candidateCategory === scope) return candidateModuleIndex ?? undefined;
    if (currentCategory === scope) return selectedModuleIndex ?? undefined;
    return undefined;
  };
  const renderValues = (rowStats: FitStats | null, row: 'baseline' | 'candidate' | 'variant' = 'variant') => shownMetrics.map((m) => {
    const value = metricText(rowStats, row === 'baseline' ? null : baseline, m.key, metricModuleIndex(m.key, row));
    return <td key={m.key} className={`num compare-value ${value.tone}`}>{value.text}</td>;
  });
  return (
    <div className="compare-strip">
      <div className="strip-tools">
        <Tabs tabs={[
          ['variations', t('Variations')], ['charges', t('Charges')], ['offline', t('Offline')], ['characters', t('Characters')], ['alternatives', t('Alternatives')],
        ]} value={tab} onChange={(value) => onTab(value as StripTab)} />
        {sel && selectedId != null && <span className="strip-selection">{t('Selected')}: {ds.name(selectedId)}</span>}
      </div>
      {!fit && <p className="muted">{t('No fit selected.')}{candidateId != null ? ` · ${t('Candidate add preview')}: ${ds.name(candidateId)}` : ''}</p>}
      {fit && !sel && candidateId == null && <p className="muted">{t('Select a fitted item or preview a market item to compare.')}</p>}
      {fit && sel?.list !== 'modules' && tab === 'charges' && <p className="muted">{t('Select a fitted module to compare charges.')}</p>}
      {fit && !scenarios.length && candidateId == null && sel && tab !== 'offline' && <p className="muted">{t('No alternatives for this choice.')}</p>}
      {fit && (candidateId != null || scenarios.length > 0) && (
        <div className="strip-table-wrap">
          <table className="grid small strip-table">
            <thead><tr><th>{t('Fit / scenario')}</th>{shownMetrics.map((m) => {
              const canPin = categoryMetrics.includes(m.key);
              const keyCategory = metricCategory(m.key);
              const isPinned = (pins[keyCategory] ?? []).includes(m.key);
              return <th key={m.key} className="num">
                <span>{t(m.label)}{m.unit ? <small> {m.unit}</small> : null}</span>
                {canPin && <button className={`metric-pin${isPinned ? ' pinned' : ''}`} aria-label={t(isPinned ? 'Unpin metric' : 'Pin metric')}
                  title={t(isPinned ? 'Unpin metric' : 'Pin metric')} onClick={() => onTogglePin(keyCategory, m.key)}>
                  <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 1h4l-.5 3 2 2v1H6.5v4h-1V7H2.5V6l2-2z" /></svg>
                </button>}
              </th>;
            })}<th>{t('Apply')}</th></tr></thead>
            <tbody>
              <tr className="strip-base">
                <td><span className="strip-name"><TypeIcon id={baselineIcon} size={16} /><b>{fit.name}</b></span></td>
                {renderValues(baseline, 'baseline')}<td></td>
              </tr>
              {candidateId != null && candidate && (() => {
                const st = candidate?.note?.kind === 'warning' ? null : candidateStats;
                const status = rowStatus(st);
                const name = ds.name(candidateId);
                const err = candidateWarnings || (st?.error ? `${st.error.code}: ${st.error.message}` : '');
                return <tr key="candidate" className={`strip-candidate ${status.className}${err ? ' strip-error' : ''}`} title={err || status.title}>
                  <td><span className="strip-name"><TypeIcon id={candidateId} size={16} /><b>{name}</b><small>{t('Candidate')}</small></span>
                    {(err || status.title) && <span className="strip-tooltip">{err || status.title}</span>}</td>
                  {renderValues(st, 'candidate')}<td><button className="tiny" disabled={!!err} onClick={() => onMarketApply(candidateId)}>{t('Apply')}</button>
                    {onAddAlternative && sel && sel.list !== 'fighters' && <button className="tiny alt-add" title={t('add this type to the selected item’s alternatives')} onClick={() => onAddAlternative(candidateId)}>+{t('可替代')}</button>}</td>
                </tr>;
              })()}
              {scenarios.map((s) => {
                const st = activeStats[s.id] ?? null;
                const status = rowStatus(st);
                const err = st?.error ? `${st.error.code}: ${st.error.message}` : '';
                return <tr key={s.id} className={`strip-variant ${status.className}${err ? ' strip-error' : ''}`} title={err || status.title}>
                  <td><span className="strip-name"><TypeIcon id={s.typeId} size={16} /><span>{s.name}</span></span>
                    {(err || status.title) && <span className="strip-tooltip">{err || status.title}</span>}</td>
                  {renderValues(st, 'variant')}<td><button className="tiny" disabled={!st || !!st.error} onClick={() => onApplyFit(s.fit, s.name)}>{tab === 'alternatives' ? t('切换') : t('Apply')}</button>
                    {onAddAlternative && tab !== 'alternatives' && sel && sel.list !== 'fighters' && <button className="tiny alt-add" title={t('add this type to the selected item’s alternatives')} onClick={() => onAddAlternative(s.typeId)}>+{t('可替代')}</button>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
      {fit && !engine && (candidateId != null || scenarios.length > 0) && <p className="muted">{t('Engine is not ready.')}</p>}
      {fit && engine && (candidateId != null || scenarios.length > 0) && calculated?.key !== calcKey && <p className="muted">{t('engine computing…')}</p>}
      <p className="hint">{t('Every row is calculated by the Engine; select an item or preview a candidate to compare.')}</p>
    </div>
  );
}
