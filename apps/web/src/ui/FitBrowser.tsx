// Fit library: saved fits (persisted in IndexedDB, see store/library.ts) by folder or ship group, with search, tags,
// rename / move / tag, duplicate, delete, bulk export (EFT, EVE XML), JSON backup / restore and imports of fit files
// and Pyfa's saved-fits database (saveddata.db). Every import goes through the formats layer.
import { useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import type { Dataset } from '../data/dataset';
import type { Fit, Library } from '../fit/model';
import {
  allFolders, allTags, deleteFits, deleteFolder, duplicateFit, makeBackup, mergeLibrary, moveFits, normFolder, parseBackup, parseTags,
  renameFit, renameFolder, searchFits, tagFits, updateFits,
} from '../fit/library';
import { exportFits, importFits, libraryFromStructured } from '../formats';
import { importPyfaDb, isSqlite } from '../formats/pyfadb';
import { saveUserImplantSets, userImplantSets } from '../data/sdePresets';
import type { StoreStatus } from '../store';
import { FloatMenu, InlineEdit, Popover, TypeIcon } from './common';
import { notify } from './notify';

const download = (name: string, text: string, type: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const today = () => new Date().toISOString().slice(0, 10);
const STORE_LABEL: Record<string, string> = { indexeddb: 'IndexedDB', localstorage: 'localStorage', memory: 'memory only', loading: 'loading…' };

export const PYFA_FOLDER = 'Pyfa import';

export function FitBrowser({ ds, lib, activeId, status, onOpen, onLib, onInfo }: {
  ds: Dataset; lib: Library; activeId: string | null; status: StoreStatus;
  onOpen: (id: string | null) => void; onLib: (l: Library) => void; onInfo?: (id: number) => void;
}) {
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const libRef = useRef(lib); libRef.current = lib;
  const folders = useMemo(() => allFolders(lib), [lib]);
  const tags = useMemo(() => allTags(lib), [lib]);
  const [mode, setMode] = useState<'folder' | 'ship'>(() => (folders.length ? 'folder' : 'ship'));
  const [tag, setTag] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [edit, setEdit] = useState<{ id: string; name: string; folder: string; tags: string } | null>(null);
  const [folderRename, setFolderRename] = useState<string | null>(null);
  const [popover, setPopover] = useState<{ kind: 'new' | 'move' | 'tags'; value: string } | null>(null);
  const [target, setTarget] = useState('');
  const fits = searchFits(ds, lib, q).filter((f) => !tag || (f.tags ?? []).includes(tag));
  const selected = sel.filter((id) => lib.fits[id]);
  const selFits = selected.map((id) => lib.fits[id]);
  const sortFits = (fs: Fit[]) => [...fs].sort((a, b) => ds.name(a.ship_type_id).localeCompare(ds.name(b.ship_type_id)) || a.name.localeCompare(b.name));

  const groups: [string, string, Fit[]][] = []; // [key, label, fits]
  if (mode === 'ship') {
    const m = new Map<string, Fit[]>();
    for (const f of fits) { const g = ds.groupName(ds.type(f.ship_type_id)?.group ?? 0) || t('Other'); m.set(g, [...(m.get(g) ?? []), f]); }
    for (const [g, fs] of [...m].sort((a, b) => a[0].localeCompare(b[0]))) groups.push([g, g, fs]);
  } else {
    const shown = q || tag ? [...new Set(fits.map((f) => normFolder(f.folder)))].sort() : ['', ...folders];
    for (const p of shown) {
      const fs = fits.filter((f) => normFolder(f.folder) === p);
      if (!fs.length && (q || tag || !p)) continue;
      groups.push([p, p || t('(no folder)'), fs]);
    }
  }

  const apply = (l: Library, note?: string) => { onLib(l); if (note) setMsg(note); };
  const remove = (ids: string[]) => {
    const removed = ids.map((id) => lib.fits[id]).filter((f): f is Fit => !!f);
    if (!removed.length) return;
    apply(deleteFits(lib, removed.map((f) => f.id)));
    setSel((s) => s.filter((x) => !ids.includes(x)));
    const activeWasRemoved = !!activeId && ids.includes(activeId);
    if (activeWasRemoved) onOpen(null);
    notify({ kind: 'ok', text: `${t('deleted')}: ${removed.length}`, action: { label: t('Undo'), onClick: () => {
      const current = libRef.current;
      onLib({ ...current, fits: { ...current.fits, ...Object.fromEntries(removed.map((f) => [f.id, f])) } });
      setSel((s) => [...new Set([...s, ...removed.map((f) => f.id)])]);
      if (activeWasRemoved && activeId) onOpen(activeId);
    } } });
  };
  const removeFolder = (key: string) => {
    const moved = Object.values(lib.fits).filter((f) => normFolder(f.folder) === key || normFolder(f.folder).startsWith(`${key}/`));
    const previousFolders = lib.folders ?? [];
    apply(deleteFolder(lib, key));
    notify({ kind: 'ok', text: `${t('deleted')}: ${key}`, action: { label: t('Undo'), onClick: () => {
      const current = libRef.current;
      const fits = { ...current.fits };
      for (const old of moved) if (fits[old.id]) fits[old.id] = { ...fits[old.id], folder: old.folder };
      onLib({ ...current, fits, folders: [...new Set([...(current.folders ?? []), ...previousFolders])] });
    } } });
  };
  const submitPopover = () => {
    if (!popover) return;
    const value = popover.value.trim();
    if (popover.kind === 'tags') {
      if (value) apply(tagFits(lib, selected, parseTags(value)));
    } else {
      const folder = normFolder(value);
      if (folder) {
        if (popover.kind === 'move') {
          let next = moveFits(lib, selected, folder);
          next = { ...next, folders: [...new Set([...(next.folders ?? []), folder])] };
          apply(next);
        } else {
          apply({ ...lib, folders: [...new Set([...(lib.folders ?? []), folder])] });
          setMode('folder');
        }
      }
    }
    setPopover(null);
  };
  const duplicate = (f: Fit) => { const c = duplicateFit(f, `${f.name} ${t('(copy)')}`); apply({ ...lib, fits: { ...lib.fits, [c.id]: c } }); onOpen(c.id); };
  const saveEdit = () => {
    if (!edit) return;
    let l = renameFit(lib, edit.id, edit.name);
    l = moveFits(l, [edit.id], edit.folder);
    l = updateFits(l, [edit.id], () => ({ tags: parseTags(edit.tags) }));
    apply(l); setEdit(null);
  };
  const exportSel = async (fmt: 'eft' | 'xml', fs: Fit[]) => {
    setBusy(true);
    try {
      const text = await exportFits(ds, fs, lib, fmt);
      download(`exfa-fits-${today()}.${fmt === 'eft' ? 'txt' : 'xml'}`, text, fmt === 'eft' ? 'text/plain' : 'application/xml');
      (window as any).__lastLibraryExport = { format: fmt, fits: fs.length, text };
      setMsg(`${t('exported')}: ${fs.length} (${fmt.toUpperCase()})`);
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };
  const backup = () => {
    const text = JSON.stringify(makeBackup(lib, userImplantSets()), null, 1);
    download(`exfa-web-backup-${today()}.json`, text, 'application/json');
    (window as any).__lastLibraryExport = { format: 'json', fits: Object.keys(lib.fits).length, text };
  };

  /** Fit files (EFT / DNA / ESI / XML / EFT cfg), JSON backups and Pyfa databases; several files at once. */
  const importFiles = async (files: File[]) => {
    setBusy(true);
    let l = lib; const notes: string[] = []; let total = 0; let first: string | null = null;
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (isSqlite(bytes)) {
          const sl = await importPyfaDb(bytes, ds);
          const r = libraryFromStructured(sl, l, { folder: PYFA_FOLDER });
          const m = mergeLibrary(l, {
            fits: Object.fromEntries(r.fits.map((f) => [f.id, f])), characters: Object.fromEntries(r.characters.map((c) => [c.id, c])),
            damagePatterns: Object.fromEntries(r.damagePatterns.map((d) => [d.id, d])), targetProfiles: Object.fromEntries(r.targetProfiles.map((x) => [x.id, x])),
            folders: [PYFA_FOLDER],
          });
          l = m.lib; total += m.added.length; first ??= m.added[0] ?? null;
          if (r.implantSets.length) {
            const have = userImplantSets();
            saveUserImplantSets([...have, ...r.implantSets.filter((s) => !have.some((h) => h.name === s.name)).map((s) => ({
              id: `user:${Math.random().toString(36).slice(2, 10)}`, name: s.name, grade: null, complete: false, user: true,
              members: s.implants.map((ti) => ({ type_id: ti, slot: ds.attr(ti, 'implantness') ?? 0 })),
            }))]);
          }
          (window as any).__lastLibraryImport = { kind: r.kind, fits: r.fits.map((f) => f.name), characters: r.characters.length, damagePatterns: r.damagePatterns.length, targetProfiles: r.targetProfiles.length, implantSets: r.implantSets.length, warnings: r.warnings };
          notes.push(`${file.name}: ${r.kind}, ${m.added.length} ${t('fit(s)')}, ${r.characters.length} ${t('characters')}, ${r.damagePatterns.length + r.targetProfiles.length} ${t('profiles')}${r.warnings.length ? `; ${t('warnings')}: ${r.warnings.length}` : ''}`);
          continue;
        }
        const text = new TextDecoder().decode(bytes);
        if (/^\s*\{/.test(text) && text.includes('eve-fit-web-library')) {
          const b = parseBackup(text);
          const m = mergeLibrary(l, b.lib);
          l = m.lib; total += m.added.length; first ??= m.added[0] ?? null;
          notes.push(`${file.name}: ${t('backup')}, ${m.added.length} ${t('fit(s)')}`);
          continue;
        }
      const r = await importFits(ds, text, 'auto', file.name);
        const now = new Date().toISOString();
        const fs = r.fits.map((f) => ({ ...f, folder: normFolder(target), created: now, modified: now }));
        const m = mergeLibrary(l, { fits: Object.fromEntries(fs.map((f) => [f.id, f])), folders: target ? [normFolder(target)] : [] });
        l = m.lib; total += m.added.length; first ??= m.added[0] ?? null;
        notes.push(`${file.name}: ${r.kind}, ${m.added.length} ${t('fit(s)')}${r.warnings.length ? `; ${t('warnings')}: ${r.warnings.join('; ')}` : ''}`);
      } catch (e) { notes.push(`${file.name}: ${(e as Error).message}`); }
    }
    apply(l, `${t('Imported')} ${total} ${t('fit(s)')} · ${notes.join(' · ')}`);
    if (first) onOpen(first);
    if (l.folders?.includes(PYFA_FOLDER)) setMode('folder');
    setBusy(false);
  };

  const [fmenu, setFmenu] = useState<{ x: number; y: number; f: Fit } | null>(null);

  const fitRow = (f: Fit) => (
    <li key={f.id} className={'lib-fit' + (f.id === activeId ? ' on' : '')} data-fit-id={f.id} data-fit-name={f.name} onClick={() => onOpen(f.id)}
      onContextMenu={(e) => { e.preventDefault(); setFmenu({ x: e.clientX, y: e.clientY, f }); }}>
      <input type="checkbox" className="lib-sel" checked={selected.includes(f.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => setSel((s) => (e.target.checked ? [...s, f.id] : s.filter((x) => x !== f.id)))} />
      {edit?.id === f.id ? (
        <span className="lib-edit" onClick={(e) => e.stopPropagation()}>
          <input className="lib-edit-name" value={edit.name} autoFocus onChange={(e) => setEdit({ ...edit, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEdit(null); }} placeholder={t('name')} />
          <input className="lib-edit-folder" list="lib-folders" value={edit.folder} onChange={(e) => setEdit({ ...edit, folder: e.target.value })} placeholder={t('folder (a/b)')} />
          <input className="lib-edit-tags" value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} placeholder={t('tags, comma separated')} />
          <button className="mini lib-edit-save" onClick={saveEdit}>✔</button><button className="mini" onClick={() => setEdit(null)}>✕</button>
        </span>
      ) : (
        <span className="lib-name"><TypeIcon id={f.ship_type_id} size={24} /> <b>{ds.name(f.ship_type_id)}</b> {f.name}
          {(f.tags ?? []).map((x) => <span key={x} className="tag">{x}</span>)}</span>
      )}
      <span className="right">
        <button className="mini lib-rename" title={t('Rename / move / tags')} onClick={(e) => { e.stopPropagation(); setEdit({ id: f.id, name: f.name, folder: f.folder ?? '', tags: (f.tags ?? []).join(', ') }); }}>✎</button>
        <button className="mini lib-dup" title={t('Duplicate')} onClick={(e) => { e.stopPropagation(); duplicate(f); }}>⧉</button>
        <button className="mini lib-del" title={t('Delete')} onClick={(e) => { e.stopPropagation(); remove([f.id]); }}>✕</button>
      </span>
    </li>
  );

  return (
    <div className="fitbrowser">
      {fmenu && (
        <FloatMenu x={fmenu.x} y={fmenu.y} onClose={() => setFmenu(null)}>
          <div className="ctxhead">{fmenu.f.name}</div>
          <button onClick={() => { onOpen(fmenu.f.id); setFmenu(null); }}>{t('Open')}</button>
          {onInfo && <button onClick={() => { onInfo(fmenu.f.ship_type_id); setFmenu(null); }}>{t('Show info')}</button>}
          <button onClick={() => { setEdit({ id: fmenu.f.id, name: fmenu.f.name, folder: fmenu.f.folder ?? '', tags: (fmenu.f.tags ?? []).join(', ') }); setFmenu(null); }}>{t('Rename / move / tags')}</button>
          <button onClick={() => { duplicate(fmenu.f); setFmenu(null); }}>{t('Duplicate')}</button>
          <button className="danger" onClick={() => { remove([fmenu.f.id]); setFmenu(null); }}>{t('Delete')}</button>
        </FloatMenu>
      )}
      <div className="row lib-head">
        <span className="lib-status muted small" data-kind={status.kind} data-fits={status.fits} data-saves={status.saves} title={status.note ?? status.error ?? ''}>
          {Object.keys(lib.fits).length} {t('fit(s)')} · {t(STORE_LABEL[status.kind] ?? status.kind)}{status.error ? ` · ${status.error}` : ''}{status.migrated ? ` · ${t('migrated from localStorage')}: ${status.migrated}` : ''}
        </span>
        <select className="lib-mode" value={mode} onChange={(e) => setMode(e.target.value as 'folder' | 'ship')} title={t('group by')}>
          <option value="folder">{t('by folder')}</option><option value="ship">{t('by ship group')}</option>
        </select>
      </div>
      <input className="search" placeholder={t('search fits / ships…')} value={q} onChange={(e) => setQ(e.target.value)} />
      {tags.length > 0 && <div className="chips lib-tags">{tags.map((x) => <button key={x} data-tag={x} className={x === tag ? 'on' : ''} onClick={() => setTag(x === tag ? '' : x)}>#{x}</button>)}</div>}
      <datalist id="lib-folders">{folders.map((p) => <option key={p} value={p} />)}</datalist>
      {groups.map(([key, label, fs]) => (
        <details key={(mode === 'folder' ? 'd:' : 'g:') + key} open className={mode === 'folder' ? 'lib-folder' : 'lib-group'} data-folder={mode === 'folder' ? key : undefined}>
          <summary>{folderRename === key
            ? <span className="folder-inline" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                <InlineEdit value={key} placeholder={t('Rename folder')} onCommit={(to) => { apply(renameFolder(lib, key, to)); setFolderRename(null); }} />
              </span>
            : <>{mode === 'folder' && key.includes('/') ? <span className="muted">{key.slice(0, key.lastIndexOf('/') + 1)}</span> : null}{mode === 'folder' && key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : label}</>} <span className="muted">({fs.length})</span>
            {mode === 'folder' && key && <span className="right">
              <button className="mini lib-folder-rename" title={t('Rename folder')} onClick={(e) => { e.preventDefault(); setFolderRename(key); }}>✎</button>
              <button className="mini lib-folder-del" title={t('Delete folder (fits move to the parent folder)')} onClick={(e) => { e.preventDefault(); removeFolder(key); }}>✕</button>
            </span>}
          </summary>
          <ul className="fits">{sortFits(fs).map(fitRow)}</ul>
        </details>
      ))}
      {fits.length === 0 && <p className="muted">{q || tag ? t('No fit matches.') : t('Pick a ship in the Market tab to start a new fit.')}</p>}
      {selected.length > 0 && (
        <div className="row lib-bulk">
          <span className="muted">{t('selected')}: {selected.length}</span>
          <div className="popover-anchor">
            <select className="lib-move" value="" onChange={(e) => { const v = e.target.value; if (v === '\u0000new') setPopover({ kind: 'move', value: '' }); else if (v === '\u0000root') apply(moveFits(lib, selected, '')); else if (v) apply(moveFits(lib, selected, v)); }}>
              <option value="">{t('move to…')}</option><option value={'\u0000root'}>{t('(no folder)')}</option>
              {folders.map((p) => <option key={p} value={p}>{p}</option>)}<option value={'\u0000new'}>{t('new folder…')}</option>
            </select>
            <Popover open={popover?.kind === 'move'} onClose={() => setPopover(null)} className="library-popover">
              <form onSubmit={(e) => { e.preventDefault(); submitPopover(); }}>
                <label>{t('New folder')}</label>
                <input autoFocus value={popover?.kind === 'move' ? popover.value : ''} placeholder={t('folder (a/b)')} onChange={(e) => setPopover((p) => p?.kind === 'move' ? { ...p, value: e.target.value } : p)} />
                <button>{t('Move')}</button><button type="button" onClick={() => setPopover(null)}>{t('Cancel')}</button>
              </form>
            </Popover>
          </div>
          <div className="popover-anchor">
            <button className="lib-tag-add" onClick={() => setPopover({ kind: 'tags', value: '' })}>+ {t('tag')}</button>
            <Popover open={popover?.kind === 'tags'} onClose={() => setPopover(null)} className="library-popover">
              <form onSubmit={(e) => { e.preventDefault(); submitPopover(); }}>
                <label>{t('Add tags (comma separated)')}</label>
                <input autoFocus value={popover?.kind === 'tags' ? popover.value : ''} placeholder={t('tags, comma separated')} onChange={(e) => setPopover((p) => p?.kind === 'tags' ? { ...p, value: e.target.value } : p)} />
                <button>{t('Add')}</button><button type="button" onClick={() => setPopover(null)}>{t('Cancel')}</button>
              </form>
            </Popover>
          </div>
          {tag && <button className="lib-tag-remove" onClick={() => apply(tagFits(lib, selected, [], [tag]))}>− #{tag}</button>}
          <button className="lib-export-eft" onClick={() => exportSel('eft', selFits)}>{t('Export EFT')}</button>
          <button className="lib-export-xml" onClick={() => exportSel('xml', selFits)}>{t('Export XML')}</button>
          <button className="lib-del-sel" onClick={() => remove(selected)}>{t('Delete')}</button>
          <button className="mini" onClick={() => setSel([])}>✕</button>
        </div>
      )}
      <div className="row lib-actions">
        <div className="popover-anchor">
          <button className="lib-newfolder" onClick={() => setPopover({ kind: 'new', value: '' })}>+ {t('folder')}</button>
          <Popover open={popover?.kind === 'new'} onClose={() => setPopover(null)} className="library-popover">
            <form onSubmit={(e) => { e.preventDefault(); submitPopover(); }}>
              <label>{t('New folder')}</label>
              <input autoFocus value={popover?.kind === 'new' ? popover.value : ''} placeholder={t('folder (a/b)')} onChange={(e) => setPopover((p) => p?.kind === 'new' ? { ...p, value: e.target.value } : p)} />
              <button>{t('Create')}</button><button type="button" onClick={() => setPopover(null)}>{t('Cancel')}</button>
            </form>
          </Popover>
        </div>
        <button className="lib-backup" onClick={backup} title={t('Download all fits, characters and profiles as JSON')}>{t('Backup library')}</button>
        <button className="lib-backup-xml" disabled={!Object.keys(lib.fits).length} onClick={() => exportSel('xml', sortFits(Object.values(lib.fits)))} title={t('All fits as one EVE XML file (like Pyfa’s backup)')}>{t('Export all (XML)')}</button>
      </div>
      <div className="row lib-actions">
        <label className="button">{busy ? '…' : t('Import / restore files…')}<input type="file" multiple className="lib-import-file" accept=".db,.sqlite,application/x-sqlite3,application/json,.json,.xml,.cfg,.txt,.eft" style={{ display: 'none' }}
          onChange={(e) => { const fl = [...(e.target.files ?? [])]; e.target.value = ''; if (fl.length) void importFiles(fl); }} /></label>
        <select className="lib-import-folder" value={target} onChange={(e) => setTarget(e.target.value)} title={t('folder for imported fit files')}>
          <option value="">{t('(no folder)')}</option>{folders.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <p className="hint">{t('Fit files (EFT, DNA, ESI JSON, EVE XML, EFT config), JSON backups and Pyfa’s saved-fits database (saveddata.db, in ~/.pyfa or %USERPROFILE%\\.pyfa) are read in the browser; nothing is uploaded.')}</p>
      {msg && <p className="muted lib-msg">{msg}</p>}
    </div>
  );
}
