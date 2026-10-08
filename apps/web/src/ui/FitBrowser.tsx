// Fit library: saved fits (persisted in IndexedDB, see store/library.ts) as a folder tree (any depth) with fleets,
// fit branches and recorded history as expandable nodes. Search, tags, rename / move / tag, duplicate, delete, bulk
// export (EFT, EVE XML), JSON backup / restore and imports of fit files and Pyfa's saved-fits database (saveddata.db).
// Every import goes through the formats layer; JSON documents/libraries go through @exfa/format migrate.
import { useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { applyBranch, branchDiverged, migrateFitDocument, packageGroup, restoreHistory } from '@exfa/format';
import type { Dataset } from '../data/dataset';
import { uid, type FitDoc, type Fleet, type Group, type Library } from '../fit/model';
import {
  DEFAULT_WS, deleteFleet, deleteFits, deleteFolder, duplicateFit, entityWs, filterWorkspace, fleetsOf, importPackage,
  joinFleet, leaveFleets, makeBackup, mergeLibrary, moveFleet, moveFits, newGroupDoc, normFolder, normTags, packageToFile,
  parseBackup, parseTags, removeGroup, removeWorkspace, renameFit, renameFolder, searchFits, setDocWs, setEntityWs,
  setFleetRole, tagFits, updateFits, upsertGroup, upsertWorkspace, workspacesOf, wsCounts, wsFolders, wsRegister, wsTags,
} from '../fit/library';
import { exportFits, importFits, libraryFromStructured } from '../formats';
import { importPyfaDb, isSqlite } from '../formats/pyfadb';
import { filesToLibrary, isZip, splitPackages, unzipFiles } from '../formats/zipfiles';
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

/** The fit id being dragged (HTML5 dragover can't read payload data). */
let dragFitId: string | null = null;

/** One folder of the tree: children are nested folders; fits/fleets live at their own folder. */
interface TNode { path: string; name: string; children: TNode[]; fits: FitDoc[]; fleets: Fleet[] }
function buildTree(lib: Library): TNode {
  const root: TNode = { path: '', name: '', children: [], fits: [], fleets: [] };
  const nodes = new Map<string, TNode>([['', root]]);
  const at = (p: string): TNode => {
    let n = nodes.get(p);
    if (n) return n;
    const parent = at(p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
    n = { path: p, name: p.slice(p.lastIndexOf('/') + 1), children: [], fits: [], fleets: [] };
    nodes.set(p, n);
    parent.children.push(n);
    return n;
  };
  for (const p of lib.folders ?? []) { const np = normFolder(p); if (np) at(np); }
  for (const f of Object.values(lib.fits)) at(normFolder(f.folder)).fits.push(f);
  for (const fl of Object.values(lib.fleets ?? {})) at(normFolder(fl.folder)).fleets.push(fl);
  const sort = (n: TNode) => { n.children.sort((a, b) => a.name.localeCompare(b.name)); n.children.forEach(sort); };
  sort(root);
  return root;
}
const countIn = (n: TNode): number => n.fits.length + n.children.reduce((s, c) => s + countIn(c), 0);

export function FitBrowser({ ds, lib, activeId, status, wsId, onWs, onOpenGroup, onOpen, onLib, onInfo, onSaveDoc }: {
  ds: Dataset; lib: Library; activeId: string | null; status: StoreStatus;
  /** Active workspace id (docs/27 §5.4): the tree, search, groups and folder/tag pickers are scoped to it. */
  wsId: string; onWs: (id: string) => void; onOpenGroup: (id: string) => void;
  onOpen: (id: string | null) => void; onLib: (l: Library) => void; onInfo?: (id: number) => void;
  /** Saves a changed document through the app's history-recording path (App setFit); falls back to onLib. */
  onSaveDoc?: (doc: FitDoc) => void;
}) {
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const libRef = useRef(lib); libRef.current = lib;
  const view = useMemo(() => filterWorkspace(lib, wsId), [lib, wsId]);
  const folders = useMemo(() => wsFolders(lib, wsId), [lib, wsId]);
  const tags = useMemo(() => wsTags(lib, wsId), [lib, wsId]);
  const tree = useMemo(() => buildTree(view), [view]);
  const cfgGroups = useMemo(() => Object.values(lib.groups ?? {}).filter((g) => entityWs(lib, g.id) === wsId)
    .sort((a, b) => a.name.localeCompare(b.name)), [lib, wsId]);
  const wsList = useMemo(() => workspacesOf(lib), [lib]);
  const counts = useMemo(() => wsCounts(lib), [lib]);
  const [wsMenu, setWsMenu] = useState(false);
  const [wsNew, setWsNew] = useState('');
  const [groupmenu, setGroupmenu] = useState<{ x: number; y: number; g: Group } | null>(null);
  const [mode, setMode] = useState<'folder' | 'ship'>(() => (folders.length ? 'folder' : 'ship'));
  const [tag, setTag] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [edit, setEdit] = useState<{ id: string; name: string; folder: string; tags: string } | null>(null);
  const [folderRename, setFolderRename] = useState<string | null>(null);
  const [popover, setPopover] = useState<{ kind: 'new' | 'move' | 'tags'; value: string; path?: string } | null>(null);
  const [target, setTarget] = useState('');
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set());
  const [openFits, setOpenFits] = useState<Set<string>>(new Set());
  const [fmenu, setFmenu] = useState<{ x: number; y: number; f: FitDoc } | null>(null);
  const [foldermenu, setFoldermenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [fleetmenu, setFleetmenu] = useState<{ x: number; y: number; fleet: Fleet } | null>(null);
  const [membermenu, setMembermenu] = useState<{ x: number; y: number; fleet: Fleet; fitId: string } | null>(null);
  const [fleetRename, setFleetRename] = useState<string | null>(null);
  const fits = searchFits(ds, view, q).filter((f) => !tag || (f.tags ?? []).includes(tag));
  const filtering = !!(q || tag);
  const selected = sel.filter((id) => lib.fits[id]);
  const selFits = selected.map((id) => lib.fits[id]);
  const sortFits = (fs: FitDoc[]) => [...fs].sort((a, b) => ds.name(a.fit.ship.type_id).localeCompare(ds.name(b.fit.ship.type_id)) || a.name.localeCompare(b.name));

  /** Ship-group view (unchanged flat groups) and the filtered view (flat per folder of the match). */
  const groups: [string, string, FitDoc[]][] = [];
  if (mode === 'ship' && !filtering) {
    const m = new Map<string, FitDoc[]>();
    for (const f of fits) { const g = ds.groupName(ds.type(f.fit.ship.type_id)?.group ?? 0) || t('Other'); m.set(g, [...(m.get(g) ?? []), f]); }
    for (const [g, fs] of [...m].sort((a, b) => a[0].localeCompare(b[0]))) groups.push([g, g, fs]);
  } else if (filtering) {
    const shown = [...new Set(fits.map((f) => normFolder(f.folder)))].sort();
    for (const p of shown) groups.push([p, p || t('(no folder)'), fits.filter((f) => normFolder(f.folder) === p)]);
  }

  const apply = (l: Library, note?: string) => { onLib(l); if (note) setMsg(note); };
  /** Save a doc through the app path (recordHistory + undo stack) when wired; otherwise merge directly. */
  const saveDoc = (doc: FitDoc) => {
    if (onSaveDoc) { onSaveDoc(doc); return; }
    onLib({ ...libRef.current, fits: { ...libRef.current.fits, [doc.id]: doc } });
  };
  const remove = (ids: string[]) => {
    const removed = ids.map((id) => lib.fits[id]).filter((f): f is FitDoc => !!f);
    if (!removed.length) return;
    apply(deleteFits(lib, removed.map((f) => f.id)));
    setSel((s) => s.filter((x) => !ids.includes(x)));
    const activeWasRemoved = !!activeId && ids.includes(activeId);
    if (activeWasRemoved) onOpen(null);
    const text = removed.length === 1
      ? t('Deleted “{name}”').replace('{name}', () => removed[0].name)
      : t('Deleted {n} fits').replace('{n}', String(removed.length));
    notify({ kind: 'ok', text, action: { label: t('Undo'), onClick: () => {
      const current = libRef.current;
      onLib({ ...current, fits: { ...current.fits, ...Object.fromEntries(removed.map((f) => [f.id, f])) } });
      setSel((s) => [...new Set([...s, ...removed.map((f) => f.id)])]);
      if (activeWasRemoved && activeId) onOpen(activeId);
    } } });
  };
  /** `p` equals `f` or sits under it. */
  const underP = (p: string, f: string) => !!p && (p === f || p.startsWith(f + '/'));
  /** Applies `map` to the active workspace's own folder list (kept in sync with renames/deletes). */
  const wsFolderMap = (l: Library, map: (p: string) => string) => {
    const meta = workspacesOf(l).find((w) => w.id === wsId);
    return meta?.folders?.length ? upsertWorkspace(l, { ...meta, folders: normTags(meta.folders.map(map).filter(Boolean)) }) : l;
  };
  const renameFolderWs = (from: string, to: string) =>
    wsFolderMap(renameFolder(lib, from, to), (p) => (underP(p, normFolder(from)) ? normFolder(normFolder(to) + p.slice(normFolder(from).length)) : p));
  const removeFolder = (key: string) => {
    const moved = Object.values(lib.fits).filter((f) => normFolder(f.folder) === key || normFolder(f.folder).startsWith(`${key}/`));
    const previousFolders = lib.folders ?? [];
    const parent = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '';
    apply(wsFolderMap(deleteFolder(lib, key), (p) => (underP(p, key) ? normFolder(parent + p.slice(key.length)) : p)));
    const text = t('Deleted folder “{name}”').replace('{name}', () => key);
    notify({ kind: 'ok', text, action: { label: t('Undo'), onClick: () => {
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
      if (value) apply(wsRegister(tagFits(lib, selected, parseTags(value)), wsId, { tags: parseTags(value) }));
    } else {
      const folder = normFolder(value);
      if (folder) {
        let next = moveFits(lib, selected, folder);
        next = { ...next, folders: [...new Set([...(next.folders ?? []), folder])] };
        apply(wsRegister(next, wsId, { folders: [folder] }));
      }
    }
    setPopover(null);
  };
  /** Create `folders` entry `path` (after an inline tree edit) and switch to folder mode. */
  const addFolder = (path: string) => {
    const p = normFolder(path);
    if (p) apply(wsRegister({ ...lib, folders: [...new Set([...(lib.folders ?? []), p])] }, wsId, { folders: [p] }));
    setPopover(null);
  };
  /** New fleet around `f` created at the fit's folder; lands in rename mode (Pyfa-style create-then-name). */
  const newFleetFor = (f: FitDoc) => {
    const { lib: next, fleetId } = joinFleet(lib, null, f.id, t('New fleet'));
    apply(setEntityWs({ ...next, fleets: { ...next.fleets, [fleetId]: { ...next.fleets[fleetId], folder: normFolder(f.folder) } } }, fleetId, wsId));
    setFleetRename(fleetId);
    setMode('folder');
  };
  /** New group in the active workspace, opened in the Groups dock tab. */
  const newGroup = () => {
    const g = newGroupDoc(t('New configuration group'));
    apply(setEntityWs(upsertGroup(lib, g), g.id, wsId));
    onOpenGroup(g.id);
  };
  const exportGroup = (g: Group) => {
    const file = packageToFile(packageGroup(lib, g), g.name || 'group');
    download(file.path.slice(file.path.lastIndexOf('/') + 1), file.text, 'application/json');
    setMsg(`${t('exported')}: ${g.name} (exfa/package@1)`);
  };
  const removeGroupWs = (g: Group) => {
    if (!window.confirm(t('Delete this configuration group?'))) return;
    apply(removeGroup(lib, g.id));
  };
  const duplicate = (f: FitDoc) => { const c = setDocWs(duplicateFit(f, `${f.name} ${t('(copy)')}`), wsId); apply({ ...lib, fits: { ...lib.fits, [c.id]: c } }); onOpen(c.id); };
  const saveEdit = () => {
    if (!edit) return;
    let l = renameFit(lib, edit.id, edit.name);
    l = moveFits(l, [edit.id], edit.folder);
    l = updateFits(l, [edit.id], () => ({ tags: parseTags(edit.tags) }));
    apply(l); setEdit(null);
  };
  const exportSel = async (fmt: 'eft' | 'xml', fs: FitDoc[]) => {
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
  const toggleFolder = (path: string, open: boolean) => setClosedFolders((s) => { const n = new Set(s); if (open) n.delete(path); else n.add(path); return n; });
  const toggleFit = (id: string) => setOpenFits((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  /** Drag a fit row onto a folder summary (or the root) to move it. */
  const folderDrop = (path: string) => ({
    onDragOver: (e: React.DragEvent) => { if (dragFitId) { e.preventDefault(); e.stopPropagation(); } },
    onDrop: (e: React.DragEvent) => {
      if (!dragFitId) return;
      e.preventDefault(); e.stopPropagation();
      const id = dragFitId; dragFitId = null;
      if (normFolder(lib.fits[id]?.folder) !== path) apply(moveFits(lib, [id], path));
    },
  });
  const setBranch = (f: FitDoc, branchId: string) => {
    const prev = f;
    const next = applyBranch(f, branchId);
    if (next === f) return;
    saveDoc(next);
    notify({ kind: 'ok', text: `${t('Branch')}: ${next.branches.find((b) => b.id === branchId)?.name ?? branchId}`, action: { label: t('Undo'), onClick: () => saveDoc(prev) } });
  };
  const restoreAt = (f: FitDoc, i: number) => {
    const prev = f;
    saveDoc(restoreHistory(f, i));
    notify({ kind: 'ok', text: t('Restored'), action: { label: t('Undo'), onClick: () => saveDoc(prev) } });
  };

  /** Fit files (EFT / DNA / ESI / XML / EFT cfg), JSON backups/documents and Pyfa databases; several files at once. */
  const importFiles = async (files: File[]) => {
    setBusy(true);
    let l = lib; const notes: string[] = []; let total = 0; let first: string | null = null;
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (isZip(bytes)) {
          const { packages, files: ff } = splitPackages(unzipFiles(bytes));
          const m = mergeLibrary(l, filesToLibrary(ff), wsId);
          l = m.lib; total += m.added.length + m.updated.length; first ??= m.added[0] ?? m.updated[0] ?? null;
          for (const p of packages) { const r = importPackage(l, p, wsId); l = r.lib; }
          notes.push(`${file.name}: zip, ${m.added.length} ${t('added')}, ${m.updated.length} ${t('updated')}, ${m.skipped.length} ${t('skipped')}${packages.length ? `, ${packages.length} ${t('package(s)')}` : ''}`);
          continue;
        }
        if (isSqlite(bytes)) {
          const sl = await importPyfaDb(bytes, ds);
          const r = libraryFromStructured(sl, l, { folder: PYFA_FOLDER });
          const m = mergeLibrary(l, {
            fits: Object.fromEntries(r.fits.map((f) => [f.id, f])), characters: Object.fromEntries(r.characters.map((c) => [c.id, c])),
            damage_patterns: Object.fromEntries(r.damagePatterns.map((d) => [d.id, d])), target_profiles: Object.fromEntries(r.targetProfiles.map((x) => [x.id, x])),
            folders: [PYFA_FOLDER],
          }, wsId);
          l = m.lib; total += m.added.length + m.updated.length; first ??= m.added[0] ?? m.updated[0] ?? null;
          if (r.implantSets.length) {
            const have = userImplantSets();
            saveUserImplantSets([...have, ...r.implantSets.filter((s) => !have.some((h) => h.name === s.name)).map((s) => ({
              id: `user:${Math.random().toString(36).slice(2, 10)}`, name: s.name, grade: null, complete: false, user: true,
              members: s.implants.map((ti) => ({ type_id: ti, slot: ds.attr(ti, 'implantness') ?? 0 })),
            }))]);
          }
          (window as any).__lastLibraryImport = { kind: r.kind, fits: r.fits.map((f) => f.name), characters: r.characters.length, damagePatterns: r.damagePatterns.length, targetProfiles: r.targetProfiles.length, implantSets: r.implantSets.length, warnings: r.warnings };
          notes.push(`${file.name}: ${r.kind}, ${m.added.length} ${t('added')}, ${m.updated.length} ${t('updated')}, ${m.skipped.length} ${t('skipped')}, ${r.characters.length} ${t('characters')}${r.warnings.length ? `; ${t('warnings')}: ${r.warnings.length}` : ''}`);
          continue;
        }
        const text = new TextDecoder().decode(bytes);
        if (/^\s*\{/.test(text) && (text.includes('eve-fit-web-library') || text.includes('exfa/library@1') || text.includes('exfa/fit@1') || text.includes('exfa/package@1'))) {
          const j = JSON.parse(text);
          if (j?.format === 'exfa/package@1') {
            const r = importPackage(l, j, wsId);
            l = r.lib; total += Object.keys(j.library?.fits ?? {}).length;
            notes.push(`${file.name}: ${t('package')}${r.issues.length ? `; ${t('warnings')}: ${r.issues.join('; ')}` : ''}`);
            continue;
          }
          const doc = j?.format === 'exfa/fit@1' ? migrateFitDocument(j, uid()) : null;
          const m = doc ? mergeLibrary(l, { fits: { [doc.id]: doc } }, wsId) : mergeLibrary(l, parseBackup(text).lib, wsId);
          l = m.lib; total += m.added.length + m.updated.length; first ??= m.added[0] ?? m.updated[0] ?? null;
          notes.push(`${file.name}: ${t('backup')}, ${m.added.length} ${t('added')}, ${m.updated.length} ${t('updated')}, ${m.skipped.length} ${t('skipped')}`);
          continue;
        }
      const r = await importFits(ds, text, 'auto', file.name);
        const now = new Date().toISOString();
        const fs = r.fits.map((f) => ({ ...f, folder: normFolder(target), created: now, modified: now }));
        const m = mergeLibrary(l, { fits: Object.fromEntries(fs.map((f) => [f.id, f])), folders: target ? [normFolder(target)] : [] }, wsId);
        l = m.lib; total += m.added.length; first ??= m.added[0] ?? null;
        notes.push(`${file.name}: ${r.kind}, ${m.added.length} ${t('fit(s)')}${r.warnings.length ? `; ${t('warnings')}: ${r.warnings.join('; ')}` : ''}`);
      } catch (e) { notes.push(`${file.name}: ${(e as Error).message}`); }
    }
    apply(l, `${t('Imported')} ${total} ${t('fit(s)')} · ${notes.join(' · ')}`);
    if (first) onOpen(first);
    if (l.folders?.includes(PYFA_FOLDER)) setMode('folder');
    setBusy(false);
  };

  const fitRow = (f: FitDoc) => {
    const sub = f.branches.length + f.history.length;
    const open = openFits.has(f.id);
    return (
      <li key={f.id} className={'lib-fit' + (f.id === activeId ? ' on' : '') + (open ? ' open' : '')} data-fit-id={f.id} data-fit-name={f.name}
        draggable onDragStart={() => { dragFitId = f.id; }} onDragEnd={() => { dragFitId = null; }}
        onClick={() => onOpen(f.id)} onContextMenu={(e) => { e.preventDefault(); setFmenu({ x: e.clientX, y: e.clientY, f }); }}>
        <input type="checkbox" className="lib-sel" checked={selected.includes(f.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => setSel((s) => (e.target.checked ? [...s, f.id] : s.filter((x) => x !== f.id)))} />
        {sub > 0 && <button className="mini lib-exp" title={t('branches / history')} onClick={(e) => { e.stopPropagation(); toggleFit(f.id); }}>{open ? '▾' : '▸'}</button>}
        {edit?.id === f.id ? (
          <span className="lib-edit" onClick={(e) => e.stopPropagation()}>
            <input className="lib-edit-name" value={edit.name} autoFocus onChange={(e) => setEdit({ ...edit, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEdit(null); }} placeholder={t('name')} />
            <input className="lib-edit-folder" list="lib-folders" value={edit.folder} onChange={(e) => setEdit({ ...edit, folder: e.target.value })} placeholder={t('folder (a/b)')} />
            <input className="lib-edit-tags" value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} placeholder={t('tags, comma separated')} />
            <button className="mini lib-edit-save" onClick={saveEdit}>{t('Save')}</button><button className="mini" onClick={() => setEdit(null)}>✕</button>
          </span>
        ) : (
          <span className="lib-name"><TypeIcon id={f.fit.ship.type_id} size={24} /> <b>{ds.name(f.fit.ship.type_id)}</b> {f.name}
            {f.active_branch && <span className="tag" title={t('on branch')}>{f.branches.find((b) => b.id === f.active_branch)?.name ?? f.active_branch}</span>}
            {(f.tags ?? []).map((x) => <span key={x} className="tag">{x}</span>)}</span>
        )}
        <span className="right">
          <button className="mini lib-rename" title={t('Rename / move / tags')} onClick={(e) => { e.stopPropagation(); setEdit({ id: f.id, name: f.name, folder: f.folder ?? '', tags: (f.tags ?? []).join(', ') }); }}>{t('Edit')}</button>
          <button className="mini lib-dup" title={t('Duplicate')} onClick={(e) => { e.stopPropagation(); duplicate(f); }}>{t('Duplicate')}</button>
          <button className="mini lib-del" title={t('Delete')} onClick={(e) => { e.stopPropagation(); remove([f.id]); }}>✕</button>
        </span>
        {open && (
          <div className="lib-sub" onClick={(e) => e.stopPropagation()}>
            {f.branches.map((b) => {
              const diverged = f.active_branch === b.id && branchDiverged(f);
              return <div key={b.id} className={'lib-branch' + (f.active_branch === b.id ? ' on' : '')} data-branch={b.id} title={t('switch to this branch')}>
                <button className="mini" onClick={() => setBranch(f, b.id)}>⎇ {b.name}{f.active_branch === b.id ? (diverged ? ' *' : '') : ''}</button>
              </div>;
            })}
            {f.history.length > 0 && <div className="lib-hist-head muted">{t('version history')}</div>}
            {[...f.history].reverse().map((h, ri) => {
              const i = f.history.length - 1 - ri;
              return <div key={i} className="lib-hist" data-hist={i}>
                <span className="muted">{new Date(h.at).toLocaleString(undefined, { hour12: false })}</span>
                <button className="mini lib-hist-restore" onClick={() => restoreAt(f, i)}>{t('restore')}</button>
              </div>;
            })}
          </div>
        )}
      </li>
    );
  };

  const fleetNode = (fl: Fleet) => (
    <li key={fl.id} className="lib-fleet" data-fleet-id={fl.id} onContextMenu={(e) => { e.preventDefault(); setFleetmenu({ x: e.clientX, y: e.clientY, fleet: fl }); }}>
      <details open>
        <summary>
          <span className="fleet-badge">⚑</span>
          {fleetRename === fl.id
            ? <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><InlineEdit autoEdit value={fl.name} placeholder={t('Fleet name')} onCommit={(v) => { apply({ ...lib, fleets: { ...lib.fleets, [fl.id]: { ...fl, name: v || fl.name } } }); setFleetRename(null); }} /></span>
            : <b>{fl.name}</b>}
          <span className="muted"> ({fl.members.length})</span>
        </summary>
        <ul className="fits lib-fleet-members">
          {fl.members.map((m) => {
            const f = lib.fits[m.fit_id];
            return (
              <li key={m.fit_id} className={'lib-member' + (m.fit_id === activeId ? ' on' : '')} data-fit-id={m.fit_id}
                onClick={() => f && onOpen(m.fit_id)}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMembermenu({ x: e.clientX, y: e.clientY, fleet: fl, fitId: m.fit_id }); }}>
                {f ? <TypeIcon id={f.fit.ship.type_id} size={18} /> : null}
                <span className="lib-name">{f ? `${ds.name(f.fit.ship.type_id)} · ${f.name}` : `${t('(deleted)')} ${m.fit_id}`}</span>
                <span className={'role-badge ' + (m.role === 'command' ? 'cmd' : 'mbr')}>{m.role === 'command' ? t('指挥') : t('成员')}</span>
              </li>
            );
          })}
        </ul>
      </details>
    </li>
  );

  /** Recursive folder node; e2e relies on `.lib-fit` being inside `details[data-folder]`. */
  const folderNode = (node: TNode, depth: number): React.ReactNode => (
    <details key={'d:' + node.path} className="lib-folder" data-folder={node.path} open={!closedFolders.has(node.path)}
      onToggle={(e) => { if (e.currentTarget.open === closedFolders.has(node.path)) toggleFolder(node.path, e.currentTarget.open); }}
      {...folderDrop(node.path)}>
      <summary onContextMenu={(e) => { e.preventDefault(); setFoldermenu({ x: e.clientX, y: e.clientY, path: node.path }); }}
        onDoubleClick={(e) => { if ((e.target as HTMLElement).closest('button, input')) return; if (node.path) setFolderRename(node.path); }}>
        {folderRename === node.path
          ? <span className="folder-inline" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <InlineEdit autoEdit value={node.path} placeholder={t('Rename folder')} onCommit={(to) => { apply(renameFolderWs(node.path, to)); setFolderRename(null); }} />
            </span>
          : (node.path ? node.name : t('(no folder)'))} <span className="muted">({countIn(node)})</span>
        {node.path ? <span className="right">
          <button className="mini lib-folder-rename" title={t('Rename folder')} onClick={(e) => { e.preventDefault(); setFolderRename(node.path); }}>{t('Rename')}</button>
          <button className="mini lib-folder-del" title={t('Delete folder (fits move to the parent folder)')} onClick={(e) => { e.preventDefault(); removeFolder(node.path); }}>✕</button>
        </span> : null}
      </summary>
      <ul className="fits">{node.fleets.map(fleetNode)}{sortFits(node.fits).map(fitRow)}</ul>
      {popover?.kind === 'new' && popover.path === node.path && (
        <div className="lib-newfolder-inline">
          <InlineEdit autoEdit value="" placeholder={t('folder (a/b)')} onCommit={(v) => addFolder(v ? `${node.path}/${v}` : '')} />
        </div>
      )}
      {node.children.map((c) => folderNode(c, depth + 1))}
    </details>
  );

  return (
    <div className="fitbrowser">
      {fmenu && (
        <FloatMenu x={fmenu.x} y={fmenu.y} onClose={() => setFmenu(null)}>
          <div className="ctxhead">{fmenu.f.name}</div>
          <button onClick={() => { onOpen(fmenu.f.id); setFmenu(null); }}>{t('Open')}</button>
          {onInfo && <button onClick={() => { onInfo(fmenu.f.fit.ship.type_id); setFmenu(null); }}>{t('Show info')}</button>}
          <button onClick={() => { setEdit({ id: fmenu.f.id, name: fmenu.f.name, folder: fmenu.f.folder ?? '', tags: (fmenu.f.tags ?? []).join(', ') }); setFmenu(null); }}>{t('Rename / move / tags')}</button>
          <button onClick={() => { duplicate(fmenu.f); setFmenu(null); }}>{t('Duplicate')}</button>
          {(() => {
            const inFleets = fleetsOf(lib, fmenu.f.id);
            return (
              <div className="ctxgroup">
                <div className="ctxlabel">{t('Fleet')}</div>
                {Object.values(lib.fleets).map((fl) => (
                  <button key={fl.id} className={inFleets.some((x) => x.id === fl.id) ? 'on' : ''} onClick={() => { apply(joinFleet(lib, fl.id, fmenu.f.id).lib); setFmenu(null); }}>{t('加入编队')} {fl.name}</button>
                ))}
                <button onClick={() => { newFleetFor(fmenu.f); setFmenu(null); }}>{t('加入编队')} {t('新编队…')}</button>
                {inFleets.map((fl) => {
                  const role = fl.members.find((m) => m.fit_id === fmenu.f.id)?.role ?? 'member';
                  return (
                    <button key={fl.id} onClick={() => { apply(setFleetRole(lib, fl.id, fmenu.f.id, role === 'command' ? 'member' : 'command')); setFmenu(null); }}>
                      {role === 'command' ? t('设为成员') : t('设为指挥')} · {fl.name}
                    </button>
                  );
                })}
                {inFleets.length > 0 && <button onClick={() => { apply(leaveFleets(lib, fmenu.f.id)); setFmenu(null); }}>{t('移出编队')}</button>}
              </div>
            );
          })()}
          <button className="danger" onClick={() => { remove([fmenu.f.id]); setFmenu(null); }}>{t('Delete')}</button>
        </FloatMenu>
      )}
      {foldermenu && (
        <FloatMenu x={foldermenu.x} y={foldermenu.y} onClose={() => setFoldermenu(null)}>
          <div className="ctxhead">{foldermenu.path || t('(no folder)')}</div>
          {foldermenu.path && <button onClick={() => { setFolderRename(foldermenu.path); setFoldermenu(null); }}>{t('Rename folder')}</button>}
          <button onClick={() => { setPopover({ kind: 'new', value: '', path: foldermenu.path }); setFoldermenu(null); }}>{t('New subfolder…')}</button>
          {foldermenu.path && <button className="danger" onClick={() => { removeFolder(foldermenu.path); setFoldermenu(null); }}>{t('Delete folder')}</button>}
        </FloatMenu>
      )}
      {fleetmenu && (
        <FloatMenu x={fleetmenu.x} y={fleetmenu.y} onClose={() => setFleetmenu(null)}>
          <div className="ctxhead">{fleetmenu.fleet.name}</div>
          <button onClick={() => { setFleetRename(fleetmenu.fleet.id); setFleetmenu(null); }}>{t('Rename fleet')}</button>
          <div className="ctxgroup">
            <div className="ctxlabel">{t('Move to folder')}</div>
            <button className={!fleetmenu.fleet.folder ? 'on' : ''} onClick={() => { apply(moveFleet(lib, fleetmenu.fleet.id, '')); setFleetmenu(null); }}>{t('(no folder)')}</button>
            {folders.map((p) => <button key={p} className={normFolder(fleetmenu.fleet.folder) === p ? 'on' : ''} onClick={() => { apply(moveFleet(lib, fleetmenu.fleet.id, p)); setFleetmenu(null); }}>{p}</button>)}
          </div>
          <button className="danger" onClick={() => { apply(deleteFleet(lib, fleetmenu.fleet.id)); setFleetmenu(null); }}>{t('Delete fleet')}</button>
        </FloatMenu>
      )}
      {membermenu && (
        <FloatMenu x={membermenu.x} y={membermenu.y} onClose={() => setMembermenu(null)}>
          <div className="ctxhead">{lib.fits[membermenu.fitId]?.name ?? membermenu.fitId} · {membermenu.fleet.name}</div>
          <button onClick={() => { onOpen(membermenu.fitId); setMembermenu(null); }}>{t('Open')}</button>
          {(() => {
            const role = membermenu.fleet.members.find((m) => m.fit_id === membermenu.fitId)?.role ?? 'member';
            return <button onClick={() => { apply(setFleetRole(lib, membermenu.fleet.id, membermenu.fitId, role === 'command' ? 'member' : 'command')); setMembermenu(null); }}>{role === 'command' ? t('设为成员') : t('设为指挥')}</button>;
          })()}
          <button className="danger" onClick={() => {
            const fl = membermenu.fleet;
            apply({ ...lib, fleets: { ...lib.fleets, [fl.id]: { ...fl, members: fl.members.filter((m) => m.fit_id !== membermenu.fitId) } } });
            setMembermenu(null);
          }}>{t('移出编队')}</button>
        </FloatMenu>
      )}
      {groupmenu && (
        <FloatMenu x={groupmenu.x} y={groupmenu.y} onClose={() => setGroupmenu(null)}>
          <div className="ctxhead">{groupmenu.g.name}</div>
          <button onClick={() => { onOpenGroup(groupmenu.g.id); setGroupmenu(null); }}>{t('Open')}</button>
          <button onClick={() => { exportGroup(groupmenu.g); setGroupmenu(null); }}>{t('Export .exfa.json (package)')}</button>
          <button className="danger" onClick={() => { removeGroupWs(groupmenu.g); setGroupmenu(null); }}>{t('Delete group')}</button>
        </FloatMenu>
      )}
      <div className="row lib-head">
        <div className="popover-anchor">
          <select className="lib-ws" value={wsId} onChange={(e) => onWs(e.target.value)} title={t('Workspace')}>
            {wsList.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <button className="mini lib-ws-mgr" title={t('Manage workspaces')} onClick={() => setWsMenu((v) => !v)}>⚙</button>
          <Popover open={wsMenu} onClose={() => setWsMenu(false)} className="library-popover">
            <div className="ctxlabel">{t('Workspaces')}</div>
            {wsList.map((w) => {
              const n = counts[w.id] ?? 0;
              const locked = w.id === wsId || w.id === DEFAULT_WS || n > 0;
              return (
                <div className="row" key={w.id} data-ws={w.id}>
                  <InlineEdit value={w.name} placeholder={t('Workspace name')} onCommit={(v) => apply(upsertWorkspace(lib, { ...w, name: v || w.name }))} />
                  <span className="muted">{n} {t('items')}</span>
                  {w.id === wsId && <span className="tag">{t('current')}</span>}
                  <button className="mini" disabled={locked}
                    title={w.id === wsId ? t('Cannot delete the active workspace') : w.id === DEFAULT_WS ? t('Cannot delete the default workspace') : n > 0 ? t('Workspace is not empty') : t('Delete workspace')}
                    onClick={() => { if (window.confirm(`${t('Delete workspace')} “${w.name}”?`)) { apply(removeWorkspace(lib, w.id)); } }}>✕</button>
                </div>
              );
            })}
            <form className="row" onSubmit={(e) => {
              e.preventDefault();
              const name = wsNew.trim();
              if (!name) return;
              const w = { id: uid(), name, created: new Date().toISOString() };
              apply(upsertWorkspace(lib, w));
              setWsNew(''); setWsMenu(false); onWs(w.id);
            }}>
              <input value={wsNew} placeholder={t('New workspace…')} onChange={(e) => setWsNew(e.target.value)} />
              <button disabled={!wsNew.trim()}>{t('Create')}</button>
            </form>
            <p className="muted small">{t('Workspaces partition the library; fits and groups you create or import land in the active workspace.')}</p>
          </Popover>
        </div>
        <span className="lib-status muted small" data-kind={status.kind} data-fits={status.fits} data-saves={status.saves} title={status.note ?? status.error ?? ''}>
          {Object.keys(view.fits).length} {t('fit(s)')} · {t(STORE_LABEL[status.kind] ?? status.kind)}{status.error ? ` · ${status.error}` : ''}{status.migrated ? ` · ${t('migrated from localStorage')}: ${status.migrated}` : ''}
        </span>
        <select className="lib-mode" value={mode} onChange={(e) => setMode(e.target.value as 'folder' | 'ship')} title={t('group by')}>
          <option value="folder">{t('by folder')}</option><option value="ship">{t('by ship group')}</option>
        </select>
      </div>
      <input className="search" placeholder={t('search fits / ships…')} value={q} onChange={(e) => setQ(e.target.value)} />
      {tags.length > 0 && <div className="chips lib-tags">{tags.map((x) => <button key={x} data-tag={x} className={x === tag ? 'on' : ''} onClick={() => setTag(x === tag ? '' : x)}>#{x}</button>)}</div>}
      <datalist id="lib-folders">{folders.map((p) => <option key={p} value={p} />)}</datalist>
      <details className="lib-folder lib-groups" open={cfgGroups.length > 0 || undefined}>
        <summary>{t('Groups')} <span className="muted">({cfgGroups.length})</span>
          <span className="right"><button className="mini lib-group-new" title={t('New configuration group')} onClick={(e) => { e.preventDefault(); newGroup(); }}>+ {t('group')}</button></span>
        </summary>
        <ul className="fits">
          {cfgGroups.map((g) => (
            <li key={g.id} className="lib-fit lib-group" data-group-id={g.id} onClick={() => onOpenGroup(g.id)}
              onContextMenu={(e) => { e.preventDefault(); setGroupmenu({ x: e.clientX, y: e.clientY, g }); }}>
              <span className="lib-name"><span className="fleet-badge">▦</span> {g.name} <span className="muted">({g.actors.length} {t('actors')})</span></span>
            </li>
          ))}
          {!cfgGroups.length && <li className="muted lib-group-empty">{t('No groups in this workspace.')}</li>}
        </ul>
      </details>
      {mode === 'folder' && !filtering ? (
        <div className="lib-tree">
          {tree.fleets.length + tree.fits.length + tree.children.length === 0 && <p className="muted">{t('Pick a ship in the Market tab to start a new fit.')}</p>}
          {(tree.fleets.length + tree.fits.length) > 0 && (
            <details className="lib-folder" data-folder="" open {...folderDrop('')}>
              <summary onContextMenu={(e) => { e.preventDefault(); setFoldermenu({ x: e.clientX, y: e.clientY, path: '' }); }}>
                {t('(no folder)')} <span className="muted">({tree.fits.length})</span>
              </summary>
              <ul className="fits">{tree.fleets.map(fleetNode)}{sortFits(tree.fits).map(fitRow)}</ul>
            </details>
          )}
          {popover?.kind === 'new' && !popover.path && (
            <div className="lib-newfolder-inline"><InlineEdit autoEdit value="" placeholder={t('folder (a/b)')} onCommit={addFolder} /></div>
          )}
          {tree.children.map((c) => folderNode(c, 0))}
        </div>
      ) : (
        groups.map(([key, label, fs]) => (
          <details key={(mode === 'folder' || filtering ? 'd:' : 'g:') + key} open className={mode === 'folder' || filtering ? 'lib-folder' : 'lib-group'} data-folder={mode === 'folder' || filtering ? key : undefined}>
            <summary>{(mode === 'folder' || filtering) && folderRename === key
              ? <span className="folder-inline" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <InlineEdit autoEdit value={key} placeholder={t('Rename folder')} onCommit={(to) => { apply(renameFolderWs(key, to)); setFolderRename(null); }} />
                </span>
              : <>{(mode === 'folder' || filtering) && key.includes('/') && <span className="muted">{key.slice(0, key.lastIndexOf('/') + 1)}</span>}{(mode === 'folder' || filtering) && key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : label}</>} <span className="muted">({fs.length})</span>
              {(mode === 'folder' || filtering) && key && <span className="right">
                <button className="mini lib-folder-rename" title={t('Rename folder')} onClick={(e) => { e.preventDefault(); setFolderRename(key); }}>{t('Rename')}</button>
                <button className="mini lib-folder-del" title={t('Delete folder (fits move to the parent folder)')} onClick={(e) => { e.preventDefault(); removeFolder(key); }}>✕</button>
              </span>}
            </summary>
            <ul className="fits">{sortFits(fs).map(fitRow)}</ul>
          </details>
        ))
      )}
      {mode === 'ship' && !filtering && fits.length === 0 && <p className="muted">{t('Pick a ship in the Market tab to start a new fit.')}</p>}
      {filtering && fits.length === 0 && <p className="muted">{t('No fit matches.')}</p>}
      {selected.length > 0 && (
        <div className="row lib-bulk">
          <span className="muted">{t('selected')}: {selected.length}</span>
          <div className="popover-anchor">
            <select className="lib-move" value="" onChange={(e) => { const v = e.target.value; if (v === ' new') setPopover({ kind: 'move', value: '' }); else if (v === ' root') apply(moveFits(lib, selected, '')); else if (v) apply(moveFits(lib, selected, v)); }}>
              <option value="">{t('move to…')}</option><option value={' root'}>{t('(no folder)')}</option>
              {folders.map((p) => <option key={p} value={p}>{p}</option>)}<option value={' new'}>{t('new folder…')}</option>
            </select>
            <Popover open={popover?.kind === 'move'} onClose={() => setPopover(null)} className="library-popover">
              <form onSubmit={(e) => { e.preventDefault(); submitPopover(); }}>
                <label>{t('Move to folder')}</label>
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
        </div>
        <button className="lib-backup" onClick={backup} title={t('Download all fits, characters and profiles as JSON')}>{t('Backup library')}</button>
        <button className="lib-backup-xml" disabled={!Object.keys(lib.fits).length} onClick={() => exportSel('xml', sortFits(Object.values(lib.fits)))} title={t('All fits as one EVE XML file (like Pyfa’s backup)')}>{t('Export all (XML)')}</button>
      </div>
      <div className="row lib-actions">
        <label className="button">{busy ? '…' : t('Import / restore files…')}<input type="file" multiple className="lib-import-file" accept=".db,.sqlite,application/x-sqlite3,application/json,.json,.xml,.cfg,.txt,.eft,.zip" style={{ display: 'none' }}
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
