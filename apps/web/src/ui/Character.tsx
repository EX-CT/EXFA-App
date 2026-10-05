import { useMemo, useState } from 'react';
import { t } from '../i18n';
import type { Dataset } from '../data/dataset';
import { uid, type Character, type Fit, type Library } from '../fit/model';

export function requiredSkills(ds: Dataset, fit: Fit): Map<number, number> {
  const out = new Map<number, number>();
  const ids = [fit.ship_type_id, ...fit.modules.flatMap((m) => [m.type_id, m.charge_type_id ?? 0]), ...fit.drones.map((d) => d.type_id),
    ...fit.fighters.map((f) => f.type_id), ...fit.implants, ...fit.boosters.map((b) => b.type_id)].filter(Boolean);
  const visit = (id: number, depth: number) => {
    for (const [s, l] of ds.raw.required_skills?.[id] ?? []) {
      if ((out.get(s) ?? 0) < l) out.set(s, l);
      if (depth < 6) visit(s, depth + 1);
    }
  };
  ids.forEach((id) => visit(id, 0));
  return out;
}

export function CharacterEditor({ ds, lib, fit, onLib }: { ds: Dataset; lib: Library; fit: Fit | null; onLib: (l: Library) => void }) {
  const [sel, setSel] = useState(fit?.character_id ?? 'all5');
  const [q, setQ] = useState('');
  const ch = lib.characters[sel] ?? lib.characters['all5'];
  const groups = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const s of ds.skills) { const g = ds.type(s)!.group; m.set(g, [...(m.get(g) ?? []), s]); }
    return [...m].sort((a, b) => ds.groupName(a[0]).localeCompare(ds.groupName(b[0])));
  }, [ds]);
  const req = fit ? requiredSkills(ds, fit) : new Map<number, number>();
  const level = (s: number) => ch.levels[s] ?? ch.default_level;
  const missing = [...req].filter(([s, l]) => level(s) < l);
  const save = (c: Character) => onLib({ ...lib, characters: { ...lib.characters, [c.id]: c } });
  const clone = () => { const c = { ...ch, id: uid(), name: ch.name + ' (copy)', builtin: false, levels: { ...ch.levels } }; save(c); setSel(c.id); };
  const setLevel = (s: number, l: number) => { if (ch.builtin) return; save({ ...ch, levels: { ...ch.levels, [s]: l } }); };
  const ql = q.trim().toLowerCase();
  return (
    <div className="character">
      <div className="row">
        <select value={ch.id} onChange={(e) => setSel(e.target.value)}>{Object.values(lib.characters).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button onClick={clone}>{t('Clone')}</button>
        {!ch.builtin && <button onClick={() => { const { [ch.id]: _drop, ...rest } = lib.characters; void _drop; onLib({ ...lib, characters: rest }); setSel('all5'); }}>{t('Delete')}</button>}
      </div>
      {ch.builtin ? <p className="muted">{t('Built-in characters are read-only: clone to customise.')}</p> : (
        <div className="row">
          <input value={ch.name} onChange={(e) => save({ ...ch, name: e.target.value })} />
          <label>{t('default level')} <select value={ch.default_level} onChange={(e) => save({ ...ch, default_level: +e.target.value })}>{[0, 1, 2, 3, 4, 5].map((l) => <option key={l}>{l}</option>)}</select></label>
          <label>{t('security status')} <input className="qty wide" type="number" step={0.1} min={-10} max={5} value={ch.security_status ?? ''} onChange={(e) => save({ ...ch, security_status: e.target.value === '' ? null : +e.target.value })} /></label>
        </div>
      )}
      {fit && (
        <div className={missing.length ? 'warnbox' : 'okbox'}>
          {missing.length ? <>{t('Missing for this fit')} ({missing.length}): {missing.map(([s, l]) => `${ds.name(s)} ${l} (${t('have')} ${level(s)})`).join(', ')}
            {!ch.builtin && <button onClick={() => save({ ...ch, levels: { ...ch.levels, ...Object.fromEntries(missing) } })}>{t('Train required')}</button>}</> : <>{t('All required skills trained')} ({req.size}).</>}
        </div>
      )}
      <input className="search" placeholder={t('filter skills…')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="skills">
        {groups.map(([g, skills]) => {
          const shown = skills.filter((s) => !ql || ds.name(s).toLowerCase().includes(ql) || ds.name(s, 'en').toLowerCase().includes(ql));
          if (!shown.length) return null;
          return (
            <details key={g} open={!!ql}>
              <summary>{ds.groupName(g)} <span className="muted">({skills.length})</span></summary>
              {shown.map((s) => (
                <div key={s} className={'skill' + (req.has(s) ? ' req' : '')}>
                  <span>{ds.name(s)}</span>
                  <span className="lv">{[0, 1, 2, 3, 4, 5].map((l) => <button key={l} disabled={ch.builtin} className={level(s) >= l && l > 0 ? 'on' : ''} onClick={() => setLevel(s, l)}>{l}</button>)}</span>
                </div>
              ))}
            </details>
          );
        })}
      </div>
    </div>
  );
}
