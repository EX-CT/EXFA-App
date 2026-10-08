import { useMemo, useState } from 'react';
import { t } from '../i18n';
import type { Dataset } from '../data/dataset';
import { uid, type Character, type FitDoc, type Library } from '../fit/model';
import { esiClientId, importEsiCharacter, loadEsiCharacters, login, setEsiClientId, unlinkEsiCharacter } from '../esi/client';

export function requiredSkills(ds: Dataset, fit: FitDoc): Map<number, number> {
  const out = new Map<number, number>();
  const ids = [fit.fit.ship.type_id, ...fit.fit.modules.flatMap((m) => [m.type_id, m.charge_type_id ?? 0]), ...fit.fit.drones.map((d) => d.type_id),
    ...fit.fit.fighters.map((f) => f.type_id), ...fit.fit.implants, ...fit.fit.boosters.map((b) => b.type_id)].filter(Boolean);
  const visit = (id: number, depth: number) => {
    for (const [s, l] of ds.raw.required_skills?.[id] ?? []) {
      if ((out.get(s) ?? 0) < l) out.set(s, l);
      if (depth < 6) visit(s, depth + 1);
    }
  };
  ids.forEach((id) => visit(id, 0));
  return out;
}

export function CharacterEditor({ ds, lib, fit, onLib, onFit }: { ds: Dataset; lib: Library; fit: FitDoc | null; onLib: (l: Library) => void; onFit?: (f: FitDoc) => void }) {
  const [sel, setSel] = useState(fit?.refs.character_id ?? 'all5');
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
          <label title={t('Alpha clone: engine caps skills at their Alpha level')}><input type="checkbox" checked={ch.alpha_clone === true} onChange={(e) => save({ ...ch, alpha_clone: e.target.checked })} /> {t('alpha clone')}</label>
        </div>
      )}
      <EsiPanel ds={ds} lib={lib} fit={fit} onLib={onLib} onFit={onFit} onSel={setSel} />
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

/** ESI single sign-on panel: link characters, import their trained skills / implants into a local Character. */
function EsiPanel({ ds, lib, fit, onLib, onFit, onSel }: { ds: Dataset; lib: Library; fit: FitDoc | null; onLib: (l: Library) => void; onFit?: (f: FitDoc) => void; onSel: (id: string) => void }) {
  const [, bump] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [cid, setCid] = useState(esiClientId());
  const chars = Object.values(loadEsiCharacters());
  const doImport = async (id: number) => {
    setBusy(id); setErr('');
    try {
      const ec = await importEsiCharacter(loadEsiCharacters()[id]);
      const existing = Object.values(lib.characters).find((c) => c.name === ec.character_name && !c.builtin);
      const c: Character = {
        ...(existing ?? { id: uid(), default_level: 0 }),
        name: ec.character_name, builtin: false,
        levels: { ...Object.fromEntries(ds.skills.map((s) => [s, 0])), ...ec.skills },
        security_status: ec.security_status ?? existing?.security_status ?? null,
      };
      delete c.levels['0'];
      onLib({ ...lib, characters: { ...lib.characters, [c.id]: c } });
      onSel(c.id);
      // Pyfa: importing a character also plugs its implants into the current fit
      if (fit && onFit && ec.implants?.length) onFit({ ...fit, fit: { ...fit.fit, implants: ec.implants }, refs: { ...fit.refs, character_id: c.id } });
    } catch (e) { setErr(String(e)); }
    setBusy(null); bump((n) => n + 1);
  };
  return (
    <details className="esipanel">
      <summary>{t('ESI (log in with EVE Online)')} <span className="muted">{chars.length ? `${chars.length} ${t('linked')}` : ''}</span></summary>
      {!esiClientId() && (
        <div className="row">
          <label className="grow">{t('ESI client_id')} <input value={cid} placeholder={t('developers.eveonline.com app')} onChange={(e) => setCid(e.target.value)} onBlur={() => setEsiClientId(cid)} /></label>
        </div>
      )}
      <div className="row">
        <button disabled={!esiClientId()} onClick={() => login().catch((e) => setErr(String(e)))}>{t('Log in with EVE Online')}</button>
        {err && <span className="error">{err}</span>}
      </div>
      {chars.map((ec) => (
        <div className="row esichar" key={ec.character_id}>
          <b>{ec.character_name}</b>
          {ec.imported_at && <span className="muted small">{Object.keys(ec.skills ?? {}).length} {t('skills')} · {ec.implants?.length ?? 0} {t('implants')}{ec.security_status != null ? ` · sec ${ec.security_status.toFixed(2)}` : ''} · {new Date(ec.imported_at).toLocaleString(undefined, { hour12: false })}</span>}
          <button disabled={busy === ec.character_id} onClick={() => doImport(ec.character_id)}>{busy === ec.character_id ? t('importing…') : t('Import skills / implants')}</button>
          <button className="danger" onClick={() => { unlinkEsiCharacter(ec.character_id); bump((n) => n + 1); }}>{t('Unlink')}</button>
        </div>
      ))}
      <p className="muted small">{t('ESI grants read access to your character sheet (skills, implants). Tokens are stored only in this browser.')}</p>
    </details>
  );
}
